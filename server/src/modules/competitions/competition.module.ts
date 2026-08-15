import { Module } from "@nestjs/common";
import { CompetitionController } from "./competition.controller";
import { CompetitionService } from "./competition.service";
import { RealtimeModule } from "../../realtime/realtime.module";
import { CompanyFieldsModule } from "../company-fields/company-fields.module";

@Module({
  imports: [RealtimeModule, CompanyFieldsModule],
  controllers: [CompetitionController],
  providers: [CompetitionService],
  exports: [CompetitionService],
})
export class CompetitionModule {}
