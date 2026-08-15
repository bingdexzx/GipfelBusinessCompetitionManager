import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CreateMapNodeTypeDto,
  UpdateMapNodeTypeDto,
  CreatePathTypeDto,
  UpdatePathTypeDto,
  CreateMapNodeDto,
  UpdateMapNodeDto,
  CreateMapEdgeDto,
  UpdateMapEdgeDto,
} from "./dto/map.dto";
import { assertSameCompetition } from "../../common/scope";
import { applyUpdatedAfter, buildIncrementalResult, serverNowIso } from "../../common/sync";
import { DeleteImpact, DeleteImpactItem } from "../../common/types/delete-impact";

@Injectable()
export class MapService {
  constructor(private prisma: PrismaService) {}

  // ===== Full Map Data =====
  async getFullMap(competitionId?: number, updatedAfter?: string, requireExistingIds = false) {
    const baseWhere = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const [nodes, edges, nodeTypes, pathTypes] = await Promise.all([
        this.prisma.mapNode.findMany({ where, include: { nodeType: true }, orderBy: { updatedAt: "desc" } }),
        this.prisma.mapEdge.findMany({
          where,
          include: { fromNode: true, toNode: true, pathType: true },
          orderBy: { updatedAt: "desc" },
        }),
        this.prisma.mapNodeType.findMany({ where, orderBy: { updatedAt: "desc" } }),
        this.prisma.pathType.findMany({ where, orderBy: { updatedAt: "desc" } }),
      ]);
      // 仅当显式要求（周期/重连对账）时才计算各子资源的全量 id，否则跳过以降低服务端压力
      let existingIds: any = {};
      if (requireExistingIds) {
        const [exNodes, exEdges, exNodeTypes, exPathTypes] = await Promise.all([
          this.prisma.mapNode.findMany({ where: baseWhere, select: { id: true } }),
          this.prisma.mapEdge.findMany({ where: baseWhere, select: { id: true } }),
          this.prisma.mapNodeType.findMany({ where: baseWhere, select: { id: true } }),
          this.prisma.pathType.findMany({ where: baseWhere, select: { id: true } }),
        ]);
        existingIds = {
          nodes: exNodes.map((e) => e.id),
          edges: exEdges.map((e) => e.id),
          nodeTypes: exNodeTypes.map((e) => e.id),
          pathTypes: exPathTypes.map((e) => e.id),
        };
      }
      return {
        nodes,
        edges,
        nodeTypes,
        pathTypes,
        existingIds,
        serverTime: serverNowIso(),
        incremental: true,
      };
    }
    const [nodes, edges, nodeTypes, pathTypes] = await Promise.all([
      this.prisma.mapNode.findMany({ where, include: { nodeType: true } }),
      this.prisma.mapEdge.findMany({ where, include: { fromNode: true, toNode: true, pathType: true } }),
      this.prisma.mapNodeType.findMany({ where }),
      this.prisma.pathType.findMany({ where }),
    ]);
    return { nodes, edges, nodeTypes, pathTypes };
  }

  // ===== MapNodeType =====
  async findAllNodeTypes(page = 1, pageSize = 50, competitionId?: number, updatedAfter?: string, requireExistingIds = false) {
    const baseWhere = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.mapNodeType.findMany({ where, orderBy: { updatedAt: "desc" } });
      const existingIds = requireExistingIds
        ? (await this.prisma.mapNodeType.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, existingIds);
    }
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.mapNodeType.findMany({ where, skip, take: pageSize, orderBy: { updatedAt: "desc" } }),
      this.prisma.mapNodeType.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findNodeType(id: number) {
    const item = await this.prisma.mapNodeType.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("地图节点类型不存在");
    return item;
  }

  async createNodeType(dto: CreateMapNodeTypeDto) {
    return this.prisma.mapNodeType.create({ data: dto });
  }

  async updateNodeType(id: number, dto: UpdateMapNodeTypeDto) {
    await this.findNodeType(id);
    return this.prisma.mapNodeType.update({ where: { id }, data: dto });
  }

  /**
   * 计算删除该地图节点类型时将级联删除的子数据（用于前端删除前的危险提示）。
   * 删除节点类型会级联删除其下所有地图节点（MapNode.nodeType onDelete: Cascade），
   * 进而级联删除这些节点关联的所有地图边（MapEdge 引用被删节点 onDelete: Cascade）。
   */
  async getNodeTypeImpact(id: number): Promise<DeleteImpact> {
    const item = await this.findNodeType(id);
    const children: DeleteImpactItem[] = [];
    const nodeIds = (
      await this.prisma.mapNode.findMany({ where: { nodeTypeId: id }, select: { id: true } })
    ).map((n) => n.id);
    if (nodeIds.length > 0) {
      children.push({ label: "下属地图节点（含其关联地图边）", count: nodeIds.length });
      const edgeCount = await this.prisma.mapEdge.count({
        where: { OR: [{ fromNodeId: { in: nodeIds } }, { toNodeId: { in: nodeIds } }] },
      });
      if (edgeCount > 0) {
        children.push({ label: "关联的地图边", count: edgeCount });
      }
    }
    return { name: item.name, children };
  }

  async removeNodeType(id: number, competitionId?: number) {
    const item = await this.findNodeType(id);
    assertSameCompetition(item.competitionId, competitionId);
    await this.prisma.mapNodeType.delete({ where: { id } });
    return { message: "已删除" };
  }

  // ===== PathType =====
  async findAllPathTypes(page = 1, pageSize = 50, competitionId?: number, updatedAfter?: string, requireExistingIds = false) {
    const baseWhere = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.pathType.findMany({ where, orderBy: { updatedAt: "desc" } });
      const existingIds = requireExistingIds
        ? (await this.prisma.pathType.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, existingIds);
    }
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.pathType.findMany({ where, skip, take: pageSize, orderBy: { updatedAt: "desc" } }),
      this.prisma.pathType.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findPathType(id: number) {
    const item = await this.prisma.pathType.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("路径类型不存在");
    return item;
  }

  async createPathType(dto: CreatePathTypeDto) {
    return this.prisma.pathType.create({ data: dto });
  }

  async updatePathType(id: number, dto: UpdatePathTypeDto) {
    await this.findPathType(id);
    return this.prisma.pathType.update({ where: { id }, data: dto });
  }

  /**
   * 计算删除该路径类型时将级联删除的子数据（用于前端删除前的危险提示）。
   * 删除路径类型会级联删除所有使用该类型的地图边（MapEdge.pathType onDelete: Cascade），
   * 以及载具通行配置（VehiclePathType onDelete: Cascade）。
   */
  async getPathTypeImpact(id: number): Promise<DeleteImpact> {
    const item = await this.findPathType(id);
    const children: DeleteImpactItem[] = [];
    const edgeCount = await this.prisma.mapEdge.count({ where: { pathTypeId: id } });
    if (edgeCount > 0) {
      children.push({ label: "使用该类型的地图边", count: edgeCount });
    }
    const vehicleCount = await this.prisma.vehiclePathType.count({ where: { pathTypeId: id } });
    if (vehicleCount > 0) {
      children.push({ label: "载具通行配置", count: vehicleCount });
    }
    return { name: item.name, children };
  }

  async removePathType(id: number, competitionId?: number) {
    const item = await this.findPathType(id);
    assertSameCompetition(item.competitionId, competitionId);
    await this.prisma.pathType.delete({ where: { id } });
    return { message: "已删除" };
  }

  // ===== MapNode =====
  async findAllMapNodes(page = 1, pageSize = 50, competitionId?: number, updatedAfter?: string, requireExistingIds = false) {
    const baseWhere = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.mapNode.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        include: { nodeType: true },
      });
      const existingIds = requireExistingIds
        ? (await this.prisma.mapNode.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, existingIds);
    }
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.mapNode.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
        include: { nodeType: true },
      }),
      this.prisma.mapNode.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findMapNode(id: number) {
    const item = await this.prisma.mapNode.findUnique({
      where: { id },
      include: { nodeType: true },
    });
    if (!item) throw new NotFoundException("地图节点不存在");
    return item;
  }

  async createMapNode(dto: CreateMapNodeDto) {
    return this.prisma.mapNode.create({
      data: dto,
      include: { nodeType: true },
    });
  }

  async updateMapNode(id: number, dto: UpdateMapNodeDto) {
    await this.findMapNode(id);
    return this.prisma.mapNode.update({
      where: { id },
      data: dto,
      include: { nodeType: true },
    });
  }

  async removeMapNode(id: number, competitionId?: number) {
    const item = await this.findMapNode(id);
    assertSameCompetition(item.competitionId, competitionId);
    await this.prisma.mapNode.delete({ where: { id } });
    return { message: "已删除" };
  }

  /**
   * 计算删除该地图节点时将级联删除的子数据（用于前端删除前的危险提示）。
   * 删除节点会级联删除其关联的所有地图边（MapEdge.fromNode/toNode onDelete: Cascade）。
   */
  async getMapNodeImpact(id: number): Promise<DeleteImpact> {
    const item = await this.findMapNode(id);
    const children: DeleteImpactItem[] = [];
    const edgeCount = await this.prisma.mapEdge.count({
      where: { OR: [{ fromNodeId: id }, { toNodeId: id }] },
    });
    if (edgeCount > 0) {
      children.push({ label: "关联的地图边", count: edgeCount });
    }
    return { name: item.name, children };
  }

  // ===== MapEdge =====
  async findAllMapEdges(page = 1, pageSize = 50, competitionId?: number, updatedAfter?: string, requireExistingIds = false) {
    const baseWhere = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.mapEdge.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        include: { fromNode: true, toNode: true, pathType: true },
      });
      const existingIds = requireExistingIds
        ? (await this.prisma.mapEdge.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, existingIds);
    }
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.mapEdge.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
        include: { fromNode: true, toNode: true, pathType: true },
      }),
      this.prisma.mapEdge.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findMapEdge(id: number) {
    const item = await this.prisma.mapEdge.findUnique({
      where: { id },
      include: { fromNode: true, toNode: true, pathType: true },
    });
    if (!item) throw new NotFoundException("地图边不存在");
    return item;
  }

  async createMapEdge(dto: CreateMapEdgeDto) {
    const { fromNodeId, toNodeId, distance, pathTypeId, ...rest } = dto;
    // 规范化: fromId < toId
    const [fid, tid] = fromNodeId < toNodeId ? [fromNodeId, toNodeId] : [toNodeId, fromNodeId];
    const existing = await this.prisma.mapEdge.findUnique({
      where: { fromNodeId_toNodeId: { fromNodeId: fid, toNodeId: tid } },
    });
    if (existing) throw new ConflictException("这两个节点之间已存在路径");
    return this.prisma.mapEdge.create({
      data: {
        fromNodeId: fid,
        toNodeId: tid,
        distance: distance ?? 0,
        pathTypeId: pathTypeId ?? 1,
        ...rest,
      },
      include: { fromNode: true, toNode: true, pathType: true },
    });
  }

  async updateMapEdge(id: number, dto: UpdateMapEdgeDto) {
    await this.findMapEdge(id);
    return this.prisma.mapEdge.update({
      where: { id },
      data: dto,
      include: { fromNode: true, toNode: true, pathType: true },
    });
  }

  async removeMapEdge(id: number, competitionId?: number) {
    const item = await this.findMapEdge(id);
    assertSameCompetition(item.competitionId, competitionId);
    await this.prisma.mapEdge.delete({ where: { id } });
    return { message: "已删除" };
  }

  /**
   * 计算删除该地图边时的级联影响（地图边无子数据，仅作占位以保证删除体验一致）。
   */
  async getMapEdgeImpact(id: number): Promise<DeleteImpact> {
    const item = await this.findMapEdge(id);
    return { name: `边#${item.id}`, children: [] };
  }
}
