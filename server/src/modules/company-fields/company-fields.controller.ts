import { Controller, Get, Put, Body, Param, Query, UseGuards, ParseIntPipe } from "@nestjs/common";
import { CompanyFieldsService } from "./company-fields.service";
import { SetCompanyFieldValuesDto } from "./company-fields.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { Ownership } from "../../common/guards/ownership.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { canReadCompanyAllFields } from "../../permissions/catalog";

@Controller("company-fields")
@UseGuards(JwtAuthGuard)
export class CompanyFieldsController {
  constructor(private service: CompanyFieldsService) {}

  // 读取某公司产业字段当前值（读权限按「公司可见字段范围 viewCompanyScopes」划分）：
  //  - SUPER_ADMIN / 拥有 company:manage / data:region:edit：恒可读该公司全部（visible）字段。
  //      （data:region:edit 放开，因为「区域总览 → 添加数据框」发布动作需先看见全部字段。）
  //  - 仅拥有 company:view 的角色：受 viewCompanyScopes 约束——
  //        scopes 为空 → 可读全部公司的全量字段（向后兼容：未配置范围即不限制）；
  //        scopes 非空 → 仅 scopes 内公司可读全量字段，范围外公司只能读「已发布到区域总览」的公开字段。
  //  - 其余已登录角色：仅可读「已发布到区域总览」的字段（见 company-fields.service 的 publishedOnly 逻辑）。
  //  注：viewCompanyScopes 与 companyScopes（contract:audit 审核范围）相互独立。
  // 支持 ?updatedAfter 增量查询。
  @Get(":companyId")
  getValues(
    @Param("companyId", ParseIntPipe) companyId: number,
    @Query("updatedAfter") updatedAfter?: string,
    @Query("includeHidden") includeHidden?: string,
    @CurrentUser()
    user?: { role?: string; permissions?: string[]; companyScopes?: number[]; viewCompanyScopes?: number[] },
  ) {
    // canReadCompanyAllFields 已按 viewCompanyScopes 判定：范围外公司仅回公开字段（publishedOnly=true）
    const canReadAll = canReadCompanyAllFields(
      user?.role,
      user?.permissions,
      user?.viewCompanyScopes,
      companyId,
    );
    const inc = includeHidden === "true" || includeHidden === "1";
    return this.service.getValues(companyId, updatedAfter, !canReadAll, inc);
  }

  // 批量写入某公司产业字段值（写：仅超管/有 company:manage 权限，且限本比赛归属）。
  @Ownership({ viaCompany: true, param: "companyId" })
  @Put(":companyId")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("company:manage")
  setValues(
    @Param("companyId", ParseIntPipe) companyId: number,
    @Body() dto: SetCompanyFieldValuesDto,
  ) {
    return this.service.setValues(companyId, dto);
  }
}
