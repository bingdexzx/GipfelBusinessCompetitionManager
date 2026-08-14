import { Injectable } from "@nestjs/common";

@Injectable()
export class ConfigService {
  get port(): number {
    return parseInt(process.env.PORT || "3000", 10);
  }

  get jwtSecret(): string {
    // 安全策略：禁止硬编码默认密钥。未配置 JWT_SECRET 时直接抛错，
    // 使服务在启动阶段 fail-closed，避免任何部署遗漏环境变量即可伪造令牌。
    const v = process.env.JWT_SECRET;
    if (!v) {
      throw new Error(
        "JWT_SECRET 环境变量未配置：服务拒绝启动（安全策略禁止硬编码默认密钥，请在生产 .env 中设置强随机值）",
      );
    }
    return v;
  }

  get jwtExpiresIn(): string {
    return process.env.JWT_EXPIRES_IN || "24h";
  }

  /** JWT 签发者声明，用于受众绑定，降低令牌被其它系统误用的风险。 */
  get jwtIssuer(): string {
    return process.env.JWT_ISSUER || "gipfel-competition";
  }

  /** JWT 受众声明，与服务端校验的 audience 对应。 */
  get jwtAudience(): string {
    return process.env.JWT_AUDIENCE || "gipfel-competition-client";
  }

  get logLevel(): string {
    return process.env.LOG_LEVEL || "info";
  }

  get logDir(): string {
    return process.env.LOG_DIR || "./logs";
  }
}
