import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from "@nestjs/common";
import { ContractTypeService } from "./contract-type.service";
import { CreateContractTypeDto, UpdateContractTypeDto } from "./dto/contract-type.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";
import { NoCompetitionScope } from "../../common/decorators/no-competition-scope.decorator";

@Controller("contract-types")
@NoCompetitionScope()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("contractType:view")
export class ContractTypeController {
  constructor(private readonly service: ContractTypeService) {}

  @Get()
  findAll(
    @Query("enabledOnly") enabledOnly?: string,
    @Query("updatedAfter") updatedAfter?: string,
    @Query("requireExistingIds") requireExistingIds?: string,
  ) {
    return this.service.findAll(enabledOnly === "true", updatedAfter, requireExistingIds === "true");
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("contractType:manage")
  create(@Body() dto: CreateContractTypeDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("contractType:manage")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateContractTypeDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("contractType:manage")
  remove(@Param("id", ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
