import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeService } from "../../realtime/realtime.service";
import * as fs from "fs";
import * as path from "path";

/** 已上传文件的最小结构（避免依赖 @types/multer）。 */
interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/** 背景图元信息（持久化进 Competition.mapBackground 的 JSON）。 */
export interface BackgroundMeta {
  url: string;
  filename: string;
  width: number | null;
  height: number | null;
}

// 与 main.ts 中静态服务目录保持一致：进程工作目录下的 uploads/map-backgrounds
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "map-backgrounds");

// 仅允许常见图片格式，规避非图片/可执行文件上传风险。
const ALLOWED_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
};

@Injectable()
export class FilesService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
  ) {}

  private ensureDir() {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  /** 解析 PNG / JPEG 的像素尺寸；其他格式或解析失败返回 null（前端加载后再补）。 */
  private readDimensions(
    buf: Buffer,
    mime: string,
  ): { width: number | null; height: number | null } {
    try {
      if (mime === "image/png" && buf.length >= 24) {
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        return { width, height };
      }
      if (mime === "image/jpeg") {
        let off = 2;
        while (off + 9 < buf.length) {
          if (buf[off] !== 0xff) break; // 非 JPEG 标记，停止
          const marker = buf[off + 1];
          // SOF0..SOF15 中除 0xC4/0xC8/0xCC（分别为 DHT、JPG、DAC）外均含尺寸信息
          if (
            marker >= 0xc0 &&
            marker <= 0xcf &&
            marker !== 0xc4 &&
            marker !== 0xc8 &&
            marker !== 0xcc
          ) {
            const height = buf.readUInt16BE(off + 5);
            const width = buf.readUInt16BE(off + 7);
            return { width, height };
          }
          const len = buf.readUInt16BE(off + 2);
          off += 2 + len;
        }
      }
    } catch {
      /* 尺寸解析失败不阻塞上传，前端以实际加载结果为准 */
    }
    return { width: null, height: null };
  }

  /**
   * 解析目标比赛 ID：
   * - 超管：使用请求中指定的 competitionId（必填，否则 400）。
   * - 归属账号：强制使用其所属比赛（忽略请求值，杜绝越权写他人比赛背景）。
   */
  private resolveTarget(user: any, requested?: number): number {
    if (user?.role === "SUPER_ADMIN") {
      if (requested == null || Number.isNaN(requested)) {
        throw new BadRequestException("请指定比赛 ID");
      }
      return requested;
    }
    const own = user?.competitionId ?? null;
    if (own == null) {
      throw new ForbiddenException("账号未归属比赛，无法操作地图背景");
    }
    return own;
  }

  private parseMeta(raw: string | null): BackgroundMeta | null {
    if (!raw) return null;
    try {
      const m = JSON.parse(raw);
      if (m && typeof m.url === "string") return m as BackgroundMeta;
    } catch {
      /* 损坏数据当作无背景 */
    }
    return null;
  }

  /** 删除已落盘的背景图文件（忽略不存在 / 异常）。 */
  private deleteFileSafe(filename: string | undefined) {
    if (!filename) return;
    try {
      const p = path.join(UPLOAD_DIR, filename);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* 文件删除失败不影响主流程 */
    }
  }

  async getBackground(
    user: any,
    requested?: number,
  ): Promise<BackgroundMeta | null> {
    const cid = this.resolveTarget(user, requested);
    const comp = await this.prisma.competition.findUnique({ where: { id: cid } });
    if (!comp) throw new NotFoundException("比赛不存在");
    return this.parseMeta(comp.mapBackground);
  }

  async upload(
    user: any,
    file: UploadedFile,
    requested?: number,
  ): Promise<BackgroundMeta> {
    if (!file || !file.buffer) throw new BadRequestException("未收到文件");
    const ext = ALLOWED_MIME[file.mimetype];
    if (!ext) {
      throw new BadRequestException("仅支持图片文件（PNG / JPEG / GIF / WebP / BMP）");
    }

    const cid = this.resolveTarget(user, requested);
    const comp = await this.prisma.competition.findUnique({ where: { id: cid } });
    if (!comp) throw new NotFoundException("比赛不存在");

    this.ensureDir();
    const safeName = `comp-${cid}-${Date.now()}${ext}`;
    const fullPath = path.join(UPLOAD_DIR, safeName);
    fs.writeFileSync(fullPath, file.buffer);

    const { width, height } = this.readDimensions(file.buffer, file.mimetype);

    // 清理旧背景文件（保留 Competition.mapBackground 旧值用于取文件名）
    const oldMeta = this.parseMeta(comp.mapBackground);
    this.deleteFileSafe(oldMeta?.filename);

    const meta: BackgroundMeta = {
      url: `/uploads/map-backgrounds/${safeName}`,
      filename: safeName,
      width,
      height,
    };

    const updated = await this.prisma.competition.update({
      where: { id: cid },
      data: { mapBackground: JSON.stringify(meta) },
    });
    // 强时效：背景变更实时广播给该比赛所有前端，使其立即刷新背景图层。
    this.realtime.broadcastToCompetition(cid, "competition:changed", updated);
    return meta;
  }

  async remove(user: any, requested?: number): Promise<{ ok: true }> {
    const cid = this.resolveTarget(user, requested);
    const comp = await this.prisma.competition.findUnique({ where: { id: cid } });
    if (!comp) throw new NotFoundException("比赛不存在");

    const oldMeta = this.parseMeta(comp.mapBackground);
    if (oldMeta) {
      this.deleteFileSafe(oldMeta.filename);
      const updated = await this.prisma.competition.update({
        where: { id: cid },
        data: { mapBackground: null },
      });
      this.realtime.broadcastToCompetition(cid, "competition:changed", updated);
    }
    return { ok: true };
  }
}
