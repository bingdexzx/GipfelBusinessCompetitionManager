import { Module } from "@nestjs/common";
import { CompetitionController } from "./competition.controller";
import { CompetitionService } from "./competition.service";
import { RealtimeModule } from "../../realtime/realtime.module";

@Module({
  imports: [RealtimeModule],
  controllers: [CompetitionController],
  providers: [CompetitionService],
  exports: [CompetitionService],
})
export class CompetitionModule {}
