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
          expiresIn: cfg.jwtExpiresIn,
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
