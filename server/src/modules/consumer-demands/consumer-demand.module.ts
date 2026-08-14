import { Module } from "@nestjs/common";
import { ConsumerDemandController } from "./consumer-demand.controller";
import { ConsumerDemandService } from "./consumer-demand.service";
import { RealtimeModule } from "../../realtime/realtime.module";

@Module({
  imports: [RealtimeModule],
  controllers: [ConsumerDemandController],
  providers: [ConsumerDemandService],
  exports: [ConsumerDemandService],
})
export class ConsumerDemandsModule {}
