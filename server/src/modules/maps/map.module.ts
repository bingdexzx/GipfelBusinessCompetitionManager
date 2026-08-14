import { Module } from "@nestjs/common";
import { MapController } from "./map.controller";
import { MapNodeTypeController } from "./map-node-type.controller";
import { PathTypeController } from "./path-type.controller";
import { MapNodeController } from "./map-node.controller";
import { MapEdgeController } from "./map-edge.controller";
import { MapService } from "./map.service";

@Module({
  controllers: [
    MapController,
    MapNodeTypeController,
    PathTypeController,
    MapNodeController,
    MapEdgeController,
  ],
  providers: [MapService],
})
export class MapModule {}
