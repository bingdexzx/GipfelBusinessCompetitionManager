import { Module } from "@nestjs/common";
import { ContractTypeController } from "./contract-type.controller";
import { ContractTypeService } from "./contract-type.service";
import { ContractController } from "./contract.controller";
import { ContractService } from "./contract.service";
import { ContractEngineService } from "./contract-engine.service";
import { RealtimeModule } from "../../realtime/realtime.module";
import { CompanyFieldsModule } from "../company-fields/company-fields.module";

@Module({
  imports: [RealtimeModule, CompanyFieldsModule],
  controllers: [ContractTypeController, ContractController],
  providers: [ContractTypeService, ContractService, ContractEngineService],
  exports: [ContractEngineService],
})
export class ContractsModule {}
