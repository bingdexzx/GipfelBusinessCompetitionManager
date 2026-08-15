import { Module } from "@nestjs/common";
import { StockController } from "./stock.controller";
import { StockService } from "./stock.service";
import { RealtimeModule } from "../../realtime/realtime.module";
import { RegionsModule } from "../regions/region.module";

@Module({
  imports: [RealtimeModule, RegionsModule],
  controllers: [StockController],
  providers: [StockService],
})
export class StockModule {}
