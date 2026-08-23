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
import { assertImageMime } from "../../common/image-mime";

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
  /**
   * 背景图在画布中的变换（世界坐标）：
   * - x/y：图片左上角的世界坐标（与节点同坐标系）。
   * - scale：缩放倍率，1 表示「适配节点包围盒」。
   * null 表示未手动编辑，前端按节点包围盒自动适配；一旦用户进入编辑模式并拖拽/缩放即写入。
   */
  transform?: { x: number; y: number; scale: number } | null;
}

// 与 main.ts 中静态服务目录保持一致：进程工作目录下的 uploads/map-backgrounds
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "map-backgrounds");

/** 各 MIME 类型对应的 magic bytes（文件头前缀）。 */
const MAGIC_BYTES: Record<string, Buffer> = {
  "image/png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  "image/jpeg": Buffer.from([0xff, 0xd8, 0xff]),
  "image/gif": Buffer.from([0x47, 0x49, 0x46, 0x38]),
  "image/webp": Buffer.from([0x52, 0x49, 0x46, 0x46]), // RIFF....WEBP 需额外校验偏移 8..11
  "image/bmp": Buffer.from([0x42, 0x4d]),
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

  /** 校验文件头 magic bytes，确保文件内容与声称的 MIME 类型一致。 */
  private validateMagicBytes(buffer: Buffer, mime: string): boolean {
    const expected = MAGIC_BYTES[mime];
    if (!expected) return true; // 无已知签名则跳过
    if (buffer.length < expected.length) return false;
    for (let i = 0; i < expected.length; i++) {
      if (buffer[i] !== expected[i]) return false;
    }
    // WebP 特殊处理：RIFF 头之后偏移 8..11 必须为 "WEBP"
    if (mime === "image/webp") {
      if (buffer.length < 12) return false;
      const webpSig = Buffer.from([0x57, 0x45, 0x42, 0x50]); // "WEBP"
      for (let i = 0; i < 4; i++) {
        if (buffer[8 + i] !== webpSig[i]) return false;
      }
    }
    return true;
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
      // 安全校验：防止路径遍历攻击
      // 1. 只允许文件名，不允许路径分隔符
      if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
        return;
      }
      const p = path.join(UPLOAD_DIR, filename);
      // 2. 确保解析后的路径确实在 UPLOAD_DIR 内
      const resolved = path.resolve(p);
      if (!resolved.startsWith(path.resolve(UPLOAD_DIR))) {
        return;
      }
      if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
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
    const ext = assertImageMime(file.mimetype);

    if (!this.validateMagicBytes(file.buffer, file.mimetype)) {
      throw new BadRequestException("文件内容与声称的格式不一致");
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
      transform: null, // 新上传默认按节点包围盒自动适配，不写入变换
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

  /**
   * 更新背景图的画布变换（位置 + 缩放），供管理端「背景编辑模式」持久化。
   * 仅写入变换参数，不动已上传的图片文件；未设置背景图时拒绝。
   */
  async updateTransform(
    user: any,
    dto: { x: number; y: number; scale: number },
    requested?: number,
  ): Promise<BackgroundMeta> {
    const cid = this.resolveTarget(user, requested);
    const comp = await this.prisma.competition.findUnique({ where: { id: cid } });
    if (!comp) throw new NotFoundException("比赛不存在");

    const oldMeta = this.parseMeta(comp.mapBackground);
    if (!oldMeta) {
      throw new BadRequestException("该比赛尚未设置背景图，无法编辑变换");
    }

    // 限制 scale 范围，避免极端值导致画布不可用。
    const scale = Math.max(0.1, Math.min(10, dto.scale));
    const transform = { x: dto.x, y: dto.y, scale };
    const meta: BackgroundMeta = { ...oldMeta, transform };

    const updated = await this.prisma.competition.update({
      where: { id: cid },
      data: { mapBackground: JSON.stringify(meta) },
    });
    // 强时效：变换变更实时广播给该比赛所有前端。
    this.realtime.broadcastToCompetition(cid, "competition:changed", updated);
    return meta;
  }
}
