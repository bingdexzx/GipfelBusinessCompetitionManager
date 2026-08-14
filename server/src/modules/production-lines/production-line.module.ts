import { Module } from "@nestjs/common";
import { ProductionLineController } from "./production-line.controller";
import { ProductionLineService } from "./production-line.service";

@Module({
  controllers: [ProductionLineController],
  providers: [ProductionLineService],
})
export class ProductionLineModule {}
