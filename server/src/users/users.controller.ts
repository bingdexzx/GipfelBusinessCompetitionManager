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
import { UsersService } from "./users.service";
import { CreateUserDto, UpdateUserDto, UpdatePasswordDto } from "./dto/user.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { Ownership } from "../common/guards/ownership.guard";
import { PermissionsGuard } from "../permissions/permissions.guard";
import { RequirePermissions } from "../permissions/permissions.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";

@Ownership({ model: "user" })
@Controller("users")
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions("account:manage")
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  findAll(
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("competitionId") competitionId?: string,
    @Query("updatedAfter") updatedAfter?: string,
    @Query("requireExistingIds") requireExistingIds?: string,
  ) {
    let cid: number | null | undefined;
    if (competitionId === undefined) cid = undefined;
    else if (competitionId === "null" || competitionId === "") cid = null;
    else cid = parseInt(competitionId, 10);
    return this.usersService.findAll(
      parseInt(page || "1"),
      parseInt(pageSize || "20"),
      cid,
      updatedAfter,
     requireExistingIds === "true");
  }

  @Get(":id")
  findOne(@Param("id", ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @Post()
  create(@CurrentUser() actor: any, @Body() dto: CreateUserDto) {
    return this.usersService.create(actor, dto);
  }

  @Patch(":id")
  update(
    @CurrentUser() actor: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(actor, id, dto);
  }

  @Patch(":id/password")
  updatePassword(
    @CurrentUser() actor: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdatePasswordDto,
  ) {
    return this.usersService.updatePassword(actor, id, dto);
  }

  @Delete(":id")
  remove(@Param("id", ParseIntPipe) id: number) {
    return this.usersService.remove(id);
  }
}
