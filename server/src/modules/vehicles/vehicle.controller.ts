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
import { VehicleService } from "./vehicle.service";
import { CreateVehicleDto, UpdateVehicleDto } from "./dto/vehicle.dto";
import { parsePagination } from "../../common/pagination";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { Ownership } from "../../common/guards/ownership.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";

@Ownership({ model: "vehicle" })
@Controller("vehicles")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("data:vehicle:view")
export class VehicleController {
  constructor(private service: VehicleService) {}

  @Get()
  findAll(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("competitionId") competitionId?: string,
    @Query("updatedAfter") updatedAfter?: string,
    @Query("requireExistingIds") requireExistingIds?: string,
  ) {
    const { page: p, pageSize: ps } = parsePagination({ page, pageSize });
    return this.service.findAll(
      p,
      ps,
      competitionId ? parseInt(competitionId) : undefined,
      updatedAfter,
     requireExistingIds === "true");
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:vehicle:edit")
  create(@Body() dto: CreateVehicleDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:vehicle:edit")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateVehicleDto) {
    return this.service.update(id, dto);
  }

  @Get(":id/impact")
  getDeleteImpact(@Param("id", ParseIntPipe) id: number) {
    return this.service.getVehicleImpact(id);
  }

  @Delete(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:vehicle:edit")
  remove(@Param("id", ParseIntPipe) id: number, @Query("competitionId") competitionId?: string) {
    return this.service.remove(id, competitionId ? parseInt(competitionId) : undefined);
  }
}
