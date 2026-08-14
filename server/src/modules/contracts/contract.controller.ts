import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
} from "@nestjs/common";
import { ContractService } from "./contract.service";
import {
  CreateContractDto,
  ExecuteContractDto,
  UpdateContractStatusDto,
  UpdatePartyNumbersDto,
} from "./dto/contract.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Ownership } from "../../common/guards/ownership.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";
import { ContractReviewGuard } from "./contract-review.guard";
import { ContractEditGuard } from "./contract-edit.guard";

@Ownership({ model: "contract" })
@Controller("contracts")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("contract:view")
export class ContractController {
  constructor(private readonly service: ContractService) {}

  @Get()
  findAll(
    @Query("competitionId") competitionId?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("updatedAfter") updatedAfter?: string,
    @Query("requireExistingIds") requireExistingIds?: string,
    @Req() req?: any,
  ) {
    return this.service.findAll(
      competitionId ? parseInt(competitionId) : undefined,
      status,
      parseInt(page || "1"),
      parseInt(pageSize || "50"),
      req?.user,
      updatedAfter,
     requireExistingIds === "true");
  }

  @Get(":id")
  findOne(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user?: { role?: string; permissions?: string[]; contractViewCompanyScopes?: number[] },
  ) {
    return this.service.findOne(id, user);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("contract:manage")
  create(@Body() dto: CreateContractDto, @Req() req?: any) {
    return this.service.create(dto, req?.user);
  }

  @Post(":id/execute")
  @UseGuards(ContractReviewGuard)
  execute(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto?: ExecuteContractDto,
    @Req() req?: any,
  ) {
    return this.service.execute(id, dto, req?.user);
  }

  @Patch(":id/party-numbers")
  @UseGuards(ContractEditGuard)
  updatePartyNumbers(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdatePartyNumbersDto,
    @Req() req?: any,
  ) {
    return this.service.updatePartyNumbers(id, dto.partyNumbers, req?.user);
  }

  @Post(":id/precheck")
  @UseGuards(ContractReviewGuard)
  precheck(@Param("id", ParseIntPipe) id: number, @Req() req?: any) {
    return this.service.precheck(id, req?.user);
  }

  @Patch(":id/status")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("contract:manage")
  setStatus(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateContractStatusDto) {
    return this.service.setStatus(id, dto.status);
  }

  @Get(":id/impact")
  getDeleteImpact(@Param("id", ParseIntPipe) id: number) {
    return this.service.getContractImpact(id);
  }

  @Delete(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("contract:manage")
  remove(@Param("id", ParseIntPipe) id: number, @Query("competitionId") competitionId?: string) {
    return this.service.remove(id, competitionId ? parseInt(competitionId) : undefined);
  }
}
