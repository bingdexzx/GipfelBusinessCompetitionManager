import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { MapService } from "./map.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";

@Controller("maps")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("data:map:view")
export class MapController {
  constructor(private service: MapService) {}

  @Get("full")
  getFullMap(
    @Query("competitionId") competitionId?: string,
    @Query("updatedAfter") updatedAfter?: string,
    @Query("requireExistingIds") requireExistingIds?: string,
  ) {
    return this.service.getFullMap(
      competitionId ? parseInt(competitionId) : undefined,
      updatedAfter,
     requireExistingIds === "true");
  }
}
