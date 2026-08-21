import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from "@nestjs/common";
import { RegionService } from "./region.service";
import { CreateRegionDto, UpdateRegionDto, SaveOverviewCardsDto } from "./dto/region.dto";
import { parsePagination } from "../../common/pagination";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { Ownership } from "../../common/guards/ownership.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";

@Ownership({ model: "region" })
@Controller("regions")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("data:region:view")
export class RegionController {
  constructor(private service: RegionService) {}

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

  // 地图区域总览：区域来自地图节点去重，必须在 :id 路由之前注册
  @Get("map-overview")
  getMapOverview(@Query("competitionId") competitionId?: string) {
    return this.service.getMapOverview(competitionId ? parseInt(competitionId) : undefined);
  }

  // 按区域名保存总览卡片配置（find-or-create）
  @Put("by-name/:name/overview-cards")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:region:edit")
  saveOverviewCardsByName(
    @Param("name") name: string,
    @Query("competitionId") competitionId: string | undefined,
    @Body() dto: SaveOverviewCardsDto,
  ) {
    return this.service.saveOverviewCardsByName(
      competitionId ? parseInt(competitionId) : undefined,
      decodeURIComponent(name),
      dto,
    );
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Get(":id/companies")
  getCompanies(@Param("id", ParseIntPipe) id: number) {
    return this.service.getCompanies(id);
  }

  @Get(":id/overview")
  getOverview(@Param("id", ParseIntPipe) id: number) {
    return this.service.getOverview(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:region:edit")
  create(@Body() dto: CreateRegionDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:region:edit")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateRegionDto) {
    return this.service.update(id, dto);
  }

  @Put(":id/overview-cards")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:region:edit")
  saveOverviewCards(@Param("id", ParseIntPipe) id: number, @Body() dto: SaveOverviewCardsDto) {
    return this.service.saveOverviewCards(id, dto);
  }

  @Delete(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:region:edit")
  remove(
    @Param("id", ParseIntPipe) id: number,
    @Query("competitionId") competitionId?: string,
  ) {
    return this.service.remove(id, competitionId ? parseInt(competitionId) : undefined);
  }
}
