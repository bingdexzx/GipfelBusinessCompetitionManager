import { Module } from "@nestjs/common";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";
import { PrismaModule } from "../../prisma/prisma.module";
import { RealtimeModule } from "../../realtime/realtime.module";

@Module({
  imports: [PrismaModule, RealtimeModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
