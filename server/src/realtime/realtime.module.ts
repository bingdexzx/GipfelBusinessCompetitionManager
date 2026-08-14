import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "../common/config/config.service";
import { PrismaModule } from "../prisma/prisma.module";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeService } from "./realtime.service";

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.jwtSecret,
        signOptions: {
          // @nestjs/jwt v11: expiresIn 类型为 number | StringValue（非普通 string）；ConfigService 返回 string 需断言（'24h' 运行时合法）
          expiresIn: cfg.jwtExpiresIn as any,
          issuer: cfg.jwtIssuer,
          audience: cfg.jwtAudience,
        },
      }),
    }),
  ],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
