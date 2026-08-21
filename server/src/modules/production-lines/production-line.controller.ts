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
import { ProductionLineService } from "./production-line.service";
import { CreateProductionLineDto, UpdateProductionLineDto } from "./dto/production-line.dto";
import { parsePagination } from "../../common/pagination";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { Ownership } from "../../common/guards/ownership.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";

@Ownership({ model: "productionLine" })
@Controller("production-lines")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("data:productionLine:view")
export class ProductionLineController {
  constructor(private service: ProductionLineService) {}

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
      competitionId ? parseInt(competitionId) : undefined,
      updatedAfter,
     requireExistingIds === "true",
     undefined,
     p,
     ps);
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:productionLine:edit")
  create(@Body() dto: CreateProductionLineDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:productionLine:edit")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateProductionLineDto) {
    return this.service.update(id, dto);
  }

  @Get(":id/impact")
  getDeleteImpact(@Param("id", ParseIntPipe) id: number) {
    return this.service.getProductionLineImpact(id);
  }

  @Delete(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:productionLine:edit")
  remove(@Param("id", ParseIntPipe) id: number, @Query("competitionId") competitionId?: string) {
    return this.service.remove(id, competitionId ? parseInt(competitionId) : undefined);
  }
}
