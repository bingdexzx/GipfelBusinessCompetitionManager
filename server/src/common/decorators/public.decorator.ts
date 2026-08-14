import { SetMetadata } from "@nestjs/common";

/** 标记路由为公开（跳过 JWT 鉴权）。用于登录、健康检查等无需身份的端点。 */
export const IS_PUBLIC_KEY = "isPublic";

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
