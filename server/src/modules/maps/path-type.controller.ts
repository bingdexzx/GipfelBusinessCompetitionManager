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
import { MapService } from "./map.service";
import { CreatePathTypeDto, UpdatePathTypeDto } from "./dto/map.dto";
import { parsePagination } from "../../common/pagination";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { Ownership } from "../../common/guards/ownership.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";

@Ownership({ model: "pathType" })
@Controller("path-types")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("data:map:view")
export class PathTypeController {
  constructor(private service: MapService) {}

  @Get()
  findAll(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("competitionId") competitionId?: string,
    @Query("updatedAfter") updatedAfter?: string,
    @Query("requireExistingIds") requireExistingIds?: string,
  ) {
    const { page: p, pageSize: ps } = parsePagination({ page, pageSize });
    return this.service.findAllPathTypes(
      p,
      ps,
      competitionId ? parseInt(competitionId) : undefined,
      updatedAfter,
     requireExistingIds === "true");
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.service.findPathType(id);
  }

  @Get(":id/impact")
  getDeleteImpact(@Param("id", ParseIntPipe) id: number) {
    return this.service.getPathTypeImpact(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:map:edit")
  create(@Body() dto: CreatePathTypeDto) {
    return this.service.createPathType(dto);
  }

  @Patch(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:map:edit")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdatePathTypeDto) {
    return this.service.updatePathType(id, dto);
  }

  @Delete(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:map:edit")
  remove(@Param("id", ParseIntPipe) id: number, @Query("competitionId") competitionId?: string) {
    return this.service.removePathType(id, competitionId ? parseInt(competitionId) : undefined);
  }
}
