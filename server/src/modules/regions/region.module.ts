import { Module } from "@nestjs/common";
import { RegionController } from "./region.controller";
import { RegionService } from "./region.service";
import { RealtimeModule } from "../../realtime/realtime.module";

@Module({
  imports: [RealtimeModule],
  controllers: [RegionController],
  providers: [RegionService],
  exports: [RegionService],
})
export class RegionsModule {}
