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
import { CompanyService } from "./company.service";
import { CreateCompanyDto, UpdateCompanyDto } from "./dto/company.dto";
import { parsePagination } from "../../common/pagination";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { Ownership } from "../../common/guards/ownership.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { companyListScopes } from "../../permissions/catalog";

@Ownership({ model: "company" })
@Controller("companies")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("company:view")
export class CompanyController {
  constructor(private service: CompanyService) {}

  @Get()
  findAll(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("competitionId") competitionId?: string,
    @Query("updatedAfter") updatedAfter?: string,
    @Query("requireExistingIds") requireExistingIds?: string,
    @Query("regionId") regionId?: string,
    @CurrentUser() user?: { role?: string; permissions?: string[]; companyScopes?: number[]; viewCompanyScopes?: number[] },
  ) {
    const { page: p, pageSize: ps } = parsePagination({ page, pageSize });
    // 非超管/管理者/区域发布者：按 viewCompanyScopes 过滤可见公司列表（空范围=不限制）
    const scopes = user
      ? companyListScopes(user.role, user.permissions, user.viewCompanyScopes)
      : null;
    return this.service.findAll(
      competitionId ? parseInt(competitionId) : undefined,
      updatedAfter,
      regionId !== undefined && regionId !== "" ? parseInt(regionId) : undefined,
      scopes ?? undefined,
     requireExistingIds === "true",
     undefined,
     p,
     ps);
  }

  @Get(":id")
  findOne(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user?: { role?: string; permissions?: string[]; companyScopes?: number[]; viewCompanyScopes?: number[] },
  ) {
    // 范围外公司（仅 company:view 角色受限）：拒绝访问
    const scopes = user
      ? companyListScopes(user.role, user.permissions, user.viewCompanyScopes)
      : null;
    return this.service.findOne(id, scopes ?? undefined);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("company:manage")
  create(@Body() dto: CreateCompanyDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("company:manage")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateCompanyDto) {
    return this.service.update(id, dto);
  }

  @Get(":id/impact")
  getDeleteImpact(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user?: { role?: string; permissions?: string[]; companyScopes?: number[]; viewCompanyScopes?: number[] },
  ) {
    const scopes = user
      ? companyListScopes(user.role, user.permissions, user.viewCompanyScopes)
      : null;
    return this.service.getCompanyImpact(id, scopes ?? undefined);
  }

  @Delete(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("company:manage")
  remove(@Param("id", ParseIntPipe) id: number, @Query("competitionId") competitionId?: string) {
    return this.service.remove(id, competitionId ? parseInt(competitionId) : undefined);
  }
}
