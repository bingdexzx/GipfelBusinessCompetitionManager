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
import { MaterialService } from "./material.service";
import { CreateMaterialDto, UpdateMaterialDto } from "./dto/material.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { Ownership } from "../../common/guards/ownership.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";

@Ownership({ model: "material" })
@Controller("materials")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("data:material:view")
export class MaterialController {
  constructor(private service: MaterialService) {}

  @Get()
  findAll(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("competitionId") competitionId?: string,
    @Query("updatedAfter") updatedAfter?: string,
    @Query("requireExistingIds") requireExistingIds?: string,
  ) {
    return this.service.findAll(
      parseInt(page || "1"),
      parseInt(pageSize || "50"),
      competitionId ? parseInt(competitionId) : undefined,
      updatedAfter,
     requireExistingIds === "true");
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Get(":id/impact")
  getDeleteImpact(@Param("id", ParseIntPipe) id: number) {
    return this.service.getDeleteImpact(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:material:edit")
  create(@Body() dto: CreateMaterialDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:material:edit")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateMaterialDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:material:edit")
  remove(@Param("id", ParseIntPipe) id: number, @Query("competitionId") competitionId?: string) {
    return this.service.remove(id, competitionId ? parseInt(competitionId) : undefined);
  }
}
