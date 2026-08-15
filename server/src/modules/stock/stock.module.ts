import { Module } from "@nestjs/common";
import { StockController } from "./stock.controller";
import { StockService } from "./stock.service";
import { RealtimeModule } from "../../realtime/realtime.module";

@Module({
  imports: [RealtimeModule],
  controllers: [StockController],
  providers: [StockService],
})
export class StockModule {}
