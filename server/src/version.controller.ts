import { Controller, Get } from "@nestjs/common";
import { Public } from "./common/decorators/public.decorator";
import { readFileSync } from "fs";
import { join } from "path";

/** 兜底版本号，与 server/package.json 的 version 保持一致；读取失败时回退到此值。 */
const SERVER_VERSION_FALLBACK = "1.0.0";

/**
 * 解析服务端版本：优先从 server/package.json 读取（dev 的 src 与 prod 的 dist 均能通过
 * `__dirname/../package.json` 定位到 server 根），读取失败则回退内置常量。
 * 这样服务端版本始终跟随 package.json，发版时只需改一处。
 */
function resolveServerVersion(): string {
  const candidates = [join(process.cwd(), "package.json"), join(__dirname, "..", "package.json")];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, "utf-8"));
      if (pkg && typeof pkg.version === "string" && pkg.version) return pkg.version;
    } catch {
      // 尝试下一个候选路径
    }
  }
  return SERVER_VERSION_FALLBACK;
}

const SERVER_VERSION = resolveServerVersion();

/**
 * 版本接口（公开，无需鉴权）：客户端启动时用它判断「服务端版本是否比自身新」，
 * 若新则提示用户联系管理员获取最新安装包。
 * 路由：GET /api/version → { code:0, data:{ version }, message:"成功" }
 */
@Controller()
export class VersionController {
  @Get("version")
  @Public()
  getVersion(): { version: string } {
    return { version: SERVER_VERSION };
  }
}
