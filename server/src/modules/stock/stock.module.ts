import { Module } from "@nestjs/common";
import { StockController } from "./stock.controller";
import { StockService } from "./stock.service";
import { RealtimeModule } from "../../realtime/realtime.module";
import { RegionModule } from "../regions/region.module";
import { CompanyFieldsModule } from "../company-fields/company-fields.module";

@Module({
  imports: [RealtimeModule, RegionModule, CompanyFieldsModule],
  controllers: [StockController],
  providers: [StockService],
})
export class StockModule {}
