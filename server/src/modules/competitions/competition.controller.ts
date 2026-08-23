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
import { CreateCompetitionDto, UpdateCompetitionDto, CreateFiscalYearDto, UpdateFiscalYearDto } from "./dto/competition.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";
import { NoCompetitionScope } from "../../common/decorators/no-competition-scope.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";

@Controller("competitions")
@NoCompetitionScope()
export class CompetitionController {
  constructor(private service: CompetitionService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @CurrentUser() user: any,
    @Query("updatedAfter") updatedAfter?: string,
    @Query("requireExistingIds") requireExistingIds?: string,
  ) {
    if (user.role === "SUPER_ADMIN") {
      return this.service.findAll(updatedAfter, requireExistingIds === "true");
    }
    // Non-super-admin: only see their own competition
    if (user.competitionId) {
      return this.service.findOne(user.competitionId);
    }
    return [];
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  async findOne(@CurrentUser() user: any, @Param("id", ParseIntPipe) id: number) {
    // Non-super-admin can only view their own competition
    if (user.role !== "SUPER_ADMIN" && user.competitionId !== id) {
      return null;
    }
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
  getFiscalYears(@CurrentUser() user: any, @Param("id", ParseIntPipe) id: number) {
    // 非超管只能查看自身所属比赛的财年，防止越权读取其他比赛配置。
    if (user.role !== "SUPER_ADMIN" && user.competitionId !== id) {
      return [];
    }
    return this.service.getFiscalYears(id);
  }

  @Post(":id/fiscal-years")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("competition:manage")
  createFiscalYear(@Param("id", ParseIntPipe) id: number, @Body() dto: CreateFiscalYearDto) {
    return this.service.createFiscalYear(id, dto);
  }

  @Patch("fiscal-years/:fyId")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("competition:manage")
  updateFiscalYear(@Param("fyId", ParseIntPipe) fyId: number, @Body() dto: UpdateFiscalYearDto) {
    return this.service.updateFiscalYear(fyId, dto);
  }

  @Delete("fiscal-years/:fyId")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("competition:manage")
  deleteFiscalYear(@Param("fyId", ParseIntPipe) fyId: number) {
    return this.service.deleteFiscalYear(fyId);
  }
}
