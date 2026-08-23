import { BadRequestException } from "@nestjs/common";

/**
 * 允许的图片 MIME 类型 → 文件扩展名映射（唯一真源）。
 * files / messages 两处上传逻辑原本各自维护一份完全相同的映射，此处统一。
 * 注意：映射值带前导点（`.png`），保存文件时直接拼接即可。
 */
export const IMAGE_EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
};

/** 允许的图片 MIME 类型白名单（values）。用于 multer fileFilter 等"仅判断类型"的场景。 */
export const ALLOWED_IMAGE_MIME: string[] = Object.keys(IMAGE_EXT_BY_MIME);

/** 统一的中文错误提示。 */
export const IMAGE_MIME_ERROR = "仅支持图片文件（PNG / JPEG / GIF / WebP / BMP）";

/** 判断 MIME 是否为允许的图片类型。 */
export function isAllowedImageMime(mimetype: string): boolean {
  return mimetype in IMAGE_EXT_BY_MIME;
}

/** 非允许图片类型立即抛出 400；允许则返回其扩展名（含前导点）。 */
export function assertImageMime(mimetype: string): string {
  const ext = IMAGE_EXT_BY_MIME[mimetype];
  if (!ext) {
    throw new BadRequestException(IMAGE_MIME_ERROR);
  }
  return ext;
}
