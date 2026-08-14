import { Module } from "@nestjs/common";
import { CompanyFieldsService } from "./company-fields.service";
import { CompanyFieldsController } from "./company-fields.controller";
import { RealtimeModule } from "../../realtime/realtime.module";
import { IndustryTypeModule } from "../industry-types/industry-type.module";

@Module({
  imports: [RealtimeModule, IndustryTypeModule],
  controllers: [CompanyFieldsController],
  providers: [CompanyFieldsService],
  exports: [CompanyFieldsService],
})
export class CompanyFieldsModule {}
