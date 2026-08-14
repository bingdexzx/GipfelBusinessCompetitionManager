import { Module } from "@nestjs/common";
import { IndustryTypeController } from "./industry-type.controller";
import { IndustryTypeService } from "./industry-type.service";
import { IndustryCalcEngineService } from "./industry-calc-engine.service";

@Module({
  controllers: [IndustryTypeController],
  providers: [IndustryTypeService, IndustryCalcEngineService],
  exports: [IndustryTypeService, IndustryCalcEngineService],
})
export class IndustryTypeModule {}
