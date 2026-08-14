import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "./common/config/config.module";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthController } from "./health.controller";
import { VersionController } from "./version.controller";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { MustChangePasswordGuard } from "./common/guards/must-change-password.guard";
import { CompetitionScopeGuard } from "./common/guards/competition-scope.guard";
import { OwnershipGuard } from "./common/guards/ownership.guard";
import { PermissionsGuard } from "./permissions/permissions.guard";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { MaterialModule } from "./modules/materials/material.module";
import { PartModule } from "./modules/parts/part.module";
import { ProductModule } from "./modules/products/product.module";
import { MapModule } from "./modules/maps/map.module";
import { InfrastructureModule } from "./modules/infrastructures/infrastructure.module";
import { TechTreeModule } from "./modules/tech-tree/tech-tree.module";
import { FuelModule } from "./modules/fuels/fuel.module";
import { VehicleModule } from "./modules/vehicles/vehicle.module";
import { WarehouseModule } from "./modules/warehouses/warehouse.module";
import { ProductionLineModule } from "./modules/production-lines/production-line.module";
import { CompetitionModule } from "./modules/competitions/competition.module";
import { CompanyModule } from "./modules/companies/company.module";
import { FilesModule } from "./modules/files/files.module";
import { IndustryTypeModule } from "./modules/industry-types/industry-type.module";
import { CompanyFieldsModule } from "./modules/company-fields/company-fields.module";
import { ContractsModule } from "./modules/contracts/contracts.module";
import { RegionsModule } from "./modules/regions/region.module";
import { ConsumerDemandsModule } from "./modules/consumer-demands/consumer-demand.module";
import { RealtimeModule } from "./realtime/realtime.module";

@Module({
  controllers: [HealthController, VersionController],
  providers: [
    // 全局守卫执行顺序：鉴权 → 强制改密 → 比赛归属 → 资源归属 → 路由级 RBAC（PermissionsGuard）。
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
    { provide: APP_GUARD, useClass: CompetitionScopeGuard },
    { provide: APP_GUARD, useClass: OwnershipGuard },
    PermissionsGuard,
  ],
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    MaterialModule,
    PartModule,
    ProductModule,
    MapModule,
    InfrastructureModule,
    TechTreeModule,
    FuelModule,
    VehicleModule,
    WarehouseModule,
    ProductionLineModule,
    CompetitionModule,
    FilesModule,
    CompanyModule,
    IndustryTypeModule,
    CompanyFieldsModule,
    ContractsModule,
    RegionsModule,
    ConsumerDemandsModule,
    RealtimeModule,
  ],
})
export class AppModule {}
