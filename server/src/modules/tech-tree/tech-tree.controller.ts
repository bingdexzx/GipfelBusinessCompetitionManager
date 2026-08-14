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
import { TechTreeService } from "./tech-tree.service";
import { CreateTechNodeDto, UpdateTechNodeDto } from "./dto/tech-node.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { Ownership } from "../../common/guards/ownership.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";

@Ownership({ model: "techNode" })
@Controller("tech-nodes")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("data:tech:view")
export class TechTreeController {
  constructor(private service: TechTreeService) {}

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

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:tech:edit")
  create(@Body() dto: CreateTechNodeDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:tech:edit")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateTechNodeDto) {
    return this.service.update(id, dto);
  }

  @Get(":id/impact")
  getDeleteImpact(@Param("id", ParseIntPipe) id: number) {
    return this.service.getTechNodeImpact(id);
  }

  @Delete(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:tech:edit")
  remove(@Param("id", ParseIntPipe) id: number, @Query("competitionId") competitionId?: string) {
    return this.service.remove(id, competitionId ? parseInt(competitionId) : undefined);
  }
}
