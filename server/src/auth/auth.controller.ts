import { Controller, Post, Get, Body, UseGuards, Req } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { registerLoginFailure, resetLoginFailure } from "../common/security/login-throttle";

@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post("login")
  @Public()
  async login(@Req() req: any, @Body() loginDto: LoginDto) {
    const ip = req.ip || "unknown";
    try {
      const result = await this.authService.login(loginDto);
      // 登录成功：清除失败计数，避免正常登录被历史失败拖入锁定。
      resetLoginFailure(ip, loginDto.username);
      return result;
    } catch (e) {
      // 登录失败（用户不存在 / 密码错误）：累计失败次数，达到阈值触发锁定。
      registerLoginFailure(ip, loginDto.username);
      throw e;
    }
  }

  @Post("change-password")
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: any,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, dto);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: any) {
    return this.authService.getProfile(user.id);
  }
}
