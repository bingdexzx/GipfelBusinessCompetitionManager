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
import { CreateMapEdgeDto, UpdateMapEdgeDto } from "./dto/map.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { Ownership } from "../../common/guards/ownership.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";

@Ownership({ model: "mapEdge" })
@Controller("map-edges")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("data:map:view")
export class MapEdgeController {
  constructor(private service: MapService) {}

  @Get()
  findAll(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("competitionId") competitionId?: string,
    @Query("updatedAfter") updatedAfter?: string,
    @Query("requireExistingIds") requireExistingIds?: string,
  ) {
    return this.service.findAllMapEdges(
      parseInt(page || "1"),
      parseInt(pageSize || "50"),
      competitionId ? parseInt(competitionId) : undefined,
      updatedAfter,
     requireExistingIds === "true");
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.service.findMapEdge(id);
  }

  @Get(":id/impact")
  getDeleteImpact(@Param("id", ParseIntPipe) id: number) {
    return this.service.getMapEdgeImpact(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:map:edit")
  create(@Body() dto: CreateMapEdgeDto) {
    return this.service.createMapEdge(dto);
  }

  @Patch(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:map:edit")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateMapEdgeDto) {
    return this.service.updateMapEdge(id, dto);
  }

  @Delete(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:map:edit")
  remove(@Param("id", ParseIntPipe) id: number, @Query("competitionId") competitionId?: string) {
    return this.service.removeMapEdge(id, competitionId ? parseInt(competitionId) : undefined);
  }
}
