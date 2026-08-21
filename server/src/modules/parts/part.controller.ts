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
import { PartService } from "./part.service";
import { CreatePartDto, UpdatePartDto } from "./dto/part.dto";
import { parsePagination } from "../../common/pagination";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { Ownership } from "../../common/guards/ownership.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";

@Ownership({ model: "part" })
@Controller("parts")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("data:part:view")
export class PartController {
  constructor(private service: PartService) {}

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

  @Get(":id/impact")
  getDeleteImpact(@Param("id", ParseIntPipe) id: number) {
    return this.service.getDeleteImpact(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:part:edit")
  create(@Body() dto: CreatePartDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:part:edit")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdatePartDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:part:edit")
  remove(@Param("id", ParseIntPipe) id: number, @Query("competitionId") competitionId?: string) {
    return this.service.remove(id, competitionId ? parseInt(competitionId) : undefined);
  }
}
