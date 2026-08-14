import { Module } from "@nestjs/common";
import { TechTreeController } from "./tech-tree.controller";
import { TechTreeService } from "./tech-tree.service";

@Module({
  controllers: [TechTreeController],
  providers: [TechTreeService],
})
export class TechTreeModule {}
