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
import { ConsumerDemandService } from "./consumer-demand.service";
import { CreateConsumerDemandDto, UpdateConsumerDemandDto } from "./dto/consumer-demand.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";
import { Ownership } from "../../common/guards/ownership.guard";

@Controller("consumer-demands")
@UseGuards(JwtAuthGuard)
export class ConsumerDemandController {
  constructor(private service: ConsumerDemandService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:region:view")
  findAll(
    @Query("competitionId") competitionId?: string,
    @Query("region") region?: string,
  ) {
    return this.service.findAll(
      competitionId ? parseInt(competitionId) : undefined,
      region,
    );
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:region:edit")
  create(@Body() dto: CreateConsumerDemandDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:region:edit")
  @Ownership({ model: "consumerDemand" })
  update(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateConsumerDemandDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("data:region:edit")
  remove(
    @Param("id", ParseIntPipe) id: number,
    @Query("competitionId") competitionId?: string,
  ) {
    return this.service.remove(id, competitionId ? parseInt(competitionId) : undefined);
  }
}
