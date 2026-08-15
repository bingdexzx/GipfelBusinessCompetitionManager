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
import { CreateMapNodeDto, UpdateMapNodeDto } from "./dto/map.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { Ownership } from "../../common/guards/ownership.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";

@Ownership({ model: "mapNode" })
@Controller("map-nodes")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("data:map:view")
export class MapNodeController {
  constructor(private service: MapService) {}

  @Get()
  findAll(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("competitionId") competitionId?: string,
    @Query("updatedAfter") updatedAfter?: string,
    @Query("requireExistingIds") requireExistingIds?: string,
  ) {
    return this.service.findAllMapNodes(
      parseInt(page || "1"),
      parseInt(pageSize || "50"),
      competitionId ? parseInt(competitionId) : undefined,
      updatedAfter,
     requireExistingIds === "true");
  }

  @Get(":id")
  @RequirePermissions("data:map:view")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.service.findMapNode(id);
  }

  @Get(":id/impact")
  @RequirePermissions("data:map:view")
  getDeleteImpact(@Param("id", ParseIntPipe) id: number) {
    return this.service.getMapNodeImpact(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:map:edit")
  create(@Body() dto: CreateMapNodeDto) {
    return this.service.createMapNode(dto);
  }

  @Patch(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:map:edit")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateMapNodeDto) {
    return this.service.updateMapNode(id, dto);
  }

  @Delete(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:map:edit")
  remove(@Param("id", ParseIntPipe) id: number, @Query("competitionId") competitionId?: string) {
    return this.service.removeMapNode(id, competitionId ? parseInt(competitionId) : undefined);
  }
}
