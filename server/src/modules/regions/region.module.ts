import { Module } from "@nestjs/common";
import { RegionController } from "./region.controller";
import { RegionService } from "./region.service";
import { RealtimeModule } from "../../realtime/realtime.module";
import { CompanyFieldsModule } from "../company-fields/company-fields.module";

@Module({
  imports: [RealtimeModule, CompanyFieldsModule],
  controllers: [RegionController],
  providers: [RegionService],
  exports: [RegionService],
})
export class RegionModule {}
