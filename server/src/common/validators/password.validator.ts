import { registerDecorator, ValidationArguments, ValidationOptions } from "class-validator";

/**
 * 密码强度校验：长度 8-64 位，且同时包含字母与数字。
 * 统一用于新建账号、自助改密、管理员重置密码，前后端规则保持一致。
 */
export function IsPasswordStrong(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isPasswordStrong",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, _args: ValidationArguments) {
          if (typeof value !== "string") return false;
          if (value.length < 8 || value.length > 64) return false;
          return /[a-zA-Z]/.test(value) && /\d/.test(value);
        },
        defaultMessage(_args: ValidationArguments) {
          return "密码长度需为 8-64 位，且同时包含字母和数字";
        },
      },
    });
  };
}
