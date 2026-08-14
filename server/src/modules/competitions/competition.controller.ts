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
import { CompetitionService } from "./competition.service";
import { CreateCompetitionDto, UpdateCompetitionDto } from "./dto/competition.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";
import { NoCompetitionScope } from "../../common/decorators/no-competition-scope.decorator";

@Controller("competitions")
@NoCompetitionScope()
export class CompetitionController {
  constructor(private service: CompetitionService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll(
    @Query("updatedAfter") updatedAfter?: string,
    @Query("requireExistingIds") requireExistingIds?: string,
  ) {
    return this.service.findAll(updatedAfter, requireExistingIds === "true");
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("competition:manage")
  create(@Body() dto: CreateCompetitionDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("competition:manage")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateCompetitionDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("competition:manage")
  remove(@Param("id", ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  // ===== 财年 =====
  @Get(":id/fiscal-years")
  @UseGuards(JwtAuthGuard)
  getFiscalYears(@Param("id", ParseIntPipe) id: number) {
    return this.service.getFiscalYears(id);
  }

  @Post(":id/fiscal-years")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("competition:manage")
  createFiscalYear(@Param("id", ParseIntPipe) id: number, @Body() dto: { year: number }) {
    return this.service.createFiscalYear(id, dto);
  }

  @Patch("fiscal-years/:fyId")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("competition:manage")
  updateFiscalYear(@Param("fyId", ParseIntPipe) fyId: number, @Body() dto: { status?: string }) {
    return this.service.updateFiscalYear(fyId, dto);
  }

  @Delete("fiscal-years/:fyId")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("competition:manage")
  deleteFiscalYear(@Param("fyId", ParseIntPipe) fyId: number) {
    return this.service.deleteFiscalYear(fyId);
  }
}
