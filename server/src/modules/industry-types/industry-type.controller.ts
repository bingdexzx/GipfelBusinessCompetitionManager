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
import { IndustryTypeService } from "./industry-type.service";
import {
  CreateIndustryTypeDto,
  UpdateIndustryTypeDto,
  CreateIndustryFieldDto,
  UpdateIndustryFieldDto,
} from "./dto/industry-type.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";
import { NoCompetitionScope } from "../../common/decorators/no-competition-scope.decorator";

@Controller("industry-types")
@NoCompetitionScope()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("industryType:view")
export class IndustryTypeController {
  constructor(private service: IndustryTypeService) {}

  @Get()
  findAll(
    @Query("updatedAfter") updatedAfter?: string,
    @Query("requireExistingIds") requireExistingIds?: string,
  ) {
    return this.service.findAll(updatedAfter, requireExistingIds === "true");
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("industryType:manage")
  create(@Body() dto: CreateIndustryTypeDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("industryType:manage")
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateIndustryTypeDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("industryType:manage")
  remove(@Param("id", ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  // ============ 产业字段 ============

  @Get(":id/fields")
  listFields(@Param("id", ParseIntPipe) id: number) {
    return this.service.listFields(id);
  }

  @Post(":id/fields")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("industryType:manage")
  createField(@Param("id", ParseIntPipe) id: number, @Body() dto: CreateIndustryFieldDto) {
    return this.service.createField(id, dto);
  }

  @Patch("fields/:fieldId")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("industryType:manage")
  updateField(
    @Param("fieldId", ParseIntPipe) fieldId: number,
    @Body() dto: UpdateIndustryFieldDto,
  ) {
    return this.service.updateField(fieldId, dto);
  }

  @Delete("fields/:fieldId")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("industryType:manage")
  removeField(@Param("fieldId", ParseIntPipe) fieldId: number) {
    return this.service.removeField(fieldId);
  }
}
