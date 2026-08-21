import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CreateIndustryTypeDto,
  UpdateIndustryTypeDto,
  CreateIndustryFieldDto,
  UpdateIndustryFieldDto,
  INDUSTRY_FIELD_TYPES,
} from "./dto/industry-type.dto";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";
import { parseFieldConfig } from "../../common/json.util";
import { cleanupFieldReferences } from "../../common/field-ref-cleanup";

const FIELD_TYPES = INDUSTRY_FIELD_TYPES;

// 给产业类型（含 fields）附加解析后的 config 对象，并把字段 config 字段替换为对象。
function withParsedFields(item: any) {
  const fields = (item.fields || []).map((f: any) => ({
    ...f,
    config: parseFieldConfig(f.config),
  }));
  return { ...item, fields };
}

// 校验计算字段的 calcGraph：必须是合法的 GGraph JSON（{ nodes:[...], edges:[...] }），
// 且恰好含一个 output 节点。仅做结构校验，语义求值在服务端级联重算时进行。
function validateCalcGraph(json: string | undefined): void {
  if (json == null || !json.trim()) return; // 允许空（非计算字段）
  let g: any;
  try {
    g = JSON.parse(json);
  } catch {
    throw new BadRequestException("产业计算图不是合法的 JSON");
  }
  if (!g || typeof g !== "object" || !Array.isArray(g.nodes) || !Array.isArray(g.edges))
    throw new BadRequestException("产业计算图格式错误：须含 nodes / edges 数组");
  const outputs = g.nodes.filter((n: any) => n && n.type === "output");
  if (outputs.length === 0)
    throw new BadRequestException("产业计算图必须包含恰好一个「输出」节点");
  if (outputs.length > 1)
    throw new BadRequestException("产业计算图只能包含一个「输出」节点");
  for (const n of g.nodes) {
    if (!n || typeof n !== "object" || !n.id || !n.type)
      throw new BadRequestException("产业计算图节点缺少 id / type");
  }
  for (const e of g.edges) {
    if (!e || !e.source || !e.target || !e.sourceHandle || !e.targetHandle)
      throw new BadRequestException("产业计算图连线缺少 source / target / 端口");
  }
}

// 校验结构化字段的 config：
// - DICTIONARY -> { entries:[{key,label,defaultValue?}], valueType? }
// - LIST       -> { itemType }
// 基础类型允许空 config。
function validateFieldConfig(fieldType: string, config: Record<string, any> | undefined) {
  const cfg = config || {};
  if (fieldType === "DICTIONARY") {
    if (!Array.isArray(cfg.entries))
      throw new BadRequestException("字典字段 entries 必须是数组");
    const keys = new Set<string>();
    for (const e of cfg.entries) {
      if (!e || typeof e.key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.key))
        throw new BadRequestException(
          `字典项 key 非法：${e?.key}（只能字母/数字/下划线，且不以数字开头）`,
        );
      if (typeof e.label !== "string" || !e.label.trim())
        throw new BadRequestException(`字典项「${e.key}」缺少 label`);
      if (keys.has(e.key)) throw new BadRequestException(`字典项 key 重复：${e.key}`);
      keys.add(e.key);
    }
    const vt = cfg.valueType || "NUMBER";
    if (!["NUMBER", "STRING", "BOOLEAN"].includes(vt))
      throw new BadRequestException(`字典 valueType 非法：${vt}`);
  } else if (fieldType === "LIST") {
    const it = cfg.itemType || "STRING";
    if (!["NUMBER", "STRING", "BOOLEAN"].includes(it))
      throw new BadRequestException(`列表 itemType 非法：${it}`);
  }
}

// 校验财年定时器设定：
// - 启用时必须给定触发时机(FY_START/FY_END)与设定值；
// - 设定值按字段类型校验格式（NUMBER 数值 / BOOLEAN true|false / DICTIONARY JSON 对象 / LIST JSON 数组 / STRING 任意）。
function validateTimerSpec(
  fieldType: string,
  trigger: string | undefined,
  value: string | undefined,
) {
  if (!trigger || !["FY_START", "FY_END"].includes(trigger))
    throw new BadRequestException("财年定时器触发时机必须是 FY_START 或 FY_END");
  if (value == null || !String(value).trim())
    throw new BadRequestException("启用财年定时器时必须填写触发后写入的设定值");
  // 引用本产业字段模式：timerValue 形如 `field:<fieldKey>`，跳过字面量类型校验
  if (typeof value === "string" && value.startsWith("field:")) {
    if (!value.slice("field:".length).trim())
      throw new BadRequestException("定时器的字段引用格式必须为 field:<字段键>");
    return;
  }
  const v = String(value);
  switch (fieldType) {
    case "NUMBER":
      if (!Number.isFinite(parseFloat(v)))
        throw new BadRequestException("定时器设定值必须为数值");
      break;
    case "BOOLEAN":
      if (!["true", "false"].includes(v.trim().toLowerCase()))
        throw new BadRequestException("定时器设定值必须为 true 或 false");
      break;
    case "DICTIONARY": {
      let o: any;
      try {
        o = JSON.parse(v);
      } catch {
        throw new BadRequestException("字典定时器的设定值必须是合法 JSON 对象");
      }
      if (!o || typeof o !== "object" || Array.isArray(o))
        throw new BadRequestException("字典定时器的设定值必须是 JSON 对象");
      break;
    }
    case "LIST": {
      let a: any;
      try {
        a = JSON.parse(v);
      } catch {
        throw new BadRequestException("列表定时器的设定值必须是合法 JSON 数组");
      }
      if (!Array.isArray(a))
        throw new BadRequestException("列表定时器的设定值必须是 JSON 数组");
      break;
    }
    case "STRING":
    default:
      break;
  }
}

@Injectable()
export class IndustryTypeService {
  constructor(private prisma: PrismaService) {}

  // ============ 产业类型 ============

  async findAll(updatedAfter?: string, requireExistingIds = false, previousIds?: number[]) {
    const baseWhere = {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const rows = await this.prisma.industryType.findMany({
          where,
          orderBy: { code: "asc" },
          include: {
            fields: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
            _count: { select: { companies: true } },
          },
        });
      const allCurrentIds = requireExistingIds
        ? (await this.prisma.industryType.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(rows.map(withParsedFields), allCurrentIds, previousIds);
    }
    const items = await this.prisma.industryType.findMany({
      where,
      orderBy: { code: "asc" },
      include: {
        fields: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        _count: { select: { companies: true } },
      },
    });
    return items.map(withParsedFields);
  }

  async findOne(id: number) {
    const item = await this.prisma.industryType.findUnique({
      where: { id },
      include: {
        fields: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
        _count: { select: { companies: true } },
      },
    });
    if (!item) throw new NotFoundException("产业类型不存在");
    return withParsedFields(item);
  }

  async findByCode(code: number) {
    const item = await this.prisma.industryType.findUnique({
      where: { code },
      include: { fields: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
    });
    return item ? withParsedFields(item) : null;
  }

  private async nextCode() {
    const last = await this.prisma.industryType.findFirst({
      orderBy: { code: "desc" },
      select: { code: true },
    });
    return (last?.code ?? 100) + 1;
  }

  async create(dto: CreateIndustryTypeDto) {
    const name = (dto.name || "").trim();
    if (!name) throw new BadRequestException("产业类型名称不能为空");

    const code = dto.code ?? (await this.nextCode());
    const exists = await this.prisma.industryType.findUnique({ where: { code } });
    if (exists) throw new BadRequestException(`产业编号 ${code} 已被占用`);

    const created = await this.prisma.industryType.create({
      data: {
        name,
        code,
        description: dto.description ?? null,
        icon: dto.icon ?? null,
      },
    });
    // 每个产业类型自动带一个「所在地」字段：公司据此填写所在地图节点名称，
    // 与产业类型本身无关（每家公司各自选择）。合同引擎按此字段取参与方所在地。
    await this.ensureLocationField(created.id);
    return this.findOne(created.id);
  }

  /**
   * 为产业类型创建默认的「所在地」字段（若不存在）。
   * 字段存「地图节点名称」字符串；未设置时为空，前端显示「未设定」。
   * fieldKey 固定为 "location"，config.isLocation=true 供前端识别为节点选择器。
   */
  private async ensureLocationField(industryTypeId: number) {
    const existing = await this.prisma.industryField.findUnique({
      where: { industryTypeId_fieldKey: { industryTypeId, fieldKey: "location" } },
    });
    if (existing) return existing;
    return this.prisma.industryField.create({
      data: {
        industryTypeId,
        name: "所在地",
        fieldKey: "location",
        fieldType: "STRING",
        config: JSON.stringify({ isLocation: true }),
        defaultValue: null,
        isCalculated: false,
        formula: null,
        sortOrder: -1,
      },
    });
  }

  async update(id: number, dto: UpdateIndustryTypeDto) {
    await this.findOne(id);

    if (dto.code !== undefined) {
      const other = await this.prisma.industryType.findUnique({
        where: { code: dto.code },
      });
      if (other && other.id !== id) throw new BadRequestException(`产业编号 ${dto.code} 已被占用`);
    }

    const data: any = {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.code !== undefined ? { code: dto.code } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
    };

    const item = await this.prisma.industryType.update({
      where: { id },
      data,
      include: { fields: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
    });
    return withParsedFields(item);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    if (item._count.companies > 0) {
      // 产业类型是全局模板，引用它的公司可能分布在任意比赛中；
      // 而公司界面按当前比赛过滤，因此需要在报错里点名这些公司及其所属比赛，便于定位。
      const blocking = await this.prisma.company.findMany({
        where: { industryTypeId: id },
        select: { name: true, competition: { select: { name: true } } },
        orderBy: { id: "asc" },
        take: 20,
      });
      const listed = blocking
        .map((c) => `「${c.name}」（比赛：${c.competition?.name ?? "未归属比赛"}）`)
        .join("、");
      const more =
        item._count.companies > blocking.length ? ` 等共 ${item._count.companies} 家` : "";
      throw new BadRequestException(
        `该产业类型下仍有公司在使用，无法删除。涉及：${listed}${more}。` +
          `请先切换到对应比赛，在「公司管理」中移除这些公司的产业类型（或删除公司）后再试。`,
      );
    }
    await this.prisma.industryType.delete({ where: { id } });
    return { success: true };
  }

  // ============ 产业字段 ============

  async listFields(industryTypeId: number) {
    await this.findOne(industryTypeId);
    const fields = await this.prisma.industryField.findMany({
      where: { industryTypeId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    return fields.map((f) => ({ ...f, config: parseFieldConfig(f.config) }));
  }

  private validateField(
    dto: CreateIndustryFieldDto | UpdateIndustryFieldDto,
    effectiveType?: string,
  ) {
    const type = effectiveType || dto.fieldType || "NUMBER";
    if (dto.fieldType && !FIELD_TYPES.includes(dto.fieldType))
      throw new BadRequestException(`字段类型只能是 ${FIELD_TYPES.join(" / ")}`);
    if (dto.config !== undefined) validateFieldConfig(type, dto.config);
    if (dto.isCalculated) {
      if (!dto.calcGraph || !dto.calcGraph.trim())
        throw new BadRequestException("计算字段必须配置产业计算图（可视化蓝图）");
      validateCalcGraph(dto.calcGraph);
    }
    if (dto.timerEnabled) {
      if (dto.isCalculated)
        throw new BadRequestException(
          "财年定时器字段不可同时设为计算字段（定时器写入值会被级联重算覆盖）",
        );
      validateTimerSpec(type, dto.timerTrigger, dto.timerValue);
    }
  }

  async createField(industryTypeId: number, dto: CreateIndustryFieldDto) {
    await this.findOne(industryTypeId);
    const fieldKey = (dto.fieldKey || "").trim();
    const name = (dto.name || "").trim();
    if (!name) throw new BadRequestException("字段名称不能为空");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(fieldKey))
      throw new BadRequestException("字段键只能包含字母、数字、下划线，且不能以数字开头");
    this.validateField(dto);

    const dup = await this.prisma.industryField.findUnique({
      where: { industryTypeId_fieldKey: { industryTypeId, fieldKey } },
    });
    if (dup) throw new BadRequestException(`字段键 ${fieldKey} 已存在`);

    return this.prisma.industryField.create({
      data: {
        industryTypeId,
        name,
        fieldKey,
        fieldType: dto.fieldType || "NUMBER",
        config: JSON.stringify(dto.config || {}),
        defaultValue: dto.defaultValue ?? null,
        isCalculated: !!dto.isCalculated,
        calcGraph: dto.calcGraph ?? null,
        formula: null, // 旧公式引擎已废弃，新计算字段一律用 calcGraph
        sortOrder: dto.sortOrder ?? 0,
        visible: dto.visible ?? true,
        // 财年定时器：仅在启用时落库触发时机与设定值；未启用则三列皆为默认(null/false)
        timerEnabled: !!dto.timerEnabled,
        timerTrigger: dto.timerEnabled ? dto.timerTrigger ?? null : null,
        timerValue: dto.timerEnabled ? dto.timerValue ?? null : null,
      },
    });
  }

  async updateField(fieldId: number, dto: UpdateIndustryFieldDto) {
    const field = await this.prisma.industryField.findUnique({
      where: { id: fieldId },
    });
    if (!field) throw new NotFoundException("产业字段不存在");
    this.validateField(dto, field.fieldType);

    // 计算定时器启用的有效值：timerEnabled 未传时沿用已有值，避免部分更新误清空 trigger/value
    const effTimerEnabled =
      dto.timerEnabled !== undefined ? dto.timerEnabled : !!field.timerEnabled;

    if (dto.fieldKey !== undefined) {
      const fieldKey = dto.fieldKey.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(fieldKey))
        throw new BadRequestException("字段键只能包含字母、数字、下划线，且不能以数字开头");
      const dup = await this.prisma.industryField.findUnique({
        where: {
          industryTypeId_fieldKey: {
            industryTypeId: field.industryTypeId,
            fieldKey,
          },
        },
      });
      if (dup && dup.id !== fieldId) throw new BadRequestException(`字段键 ${fieldKey} 已存在`);
    }

    return this.prisma.industryField.update({
      where: { id: fieldId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.fieldKey !== undefined ? { fieldKey: dto.fieldKey.trim() } : {}),
        ...(dto.fieldType !== undefined ? { fieldType: dto.fieldType } : {}),
        ...(dto.config !== undefined ? { config: JSON.stringify(dto.config) } : {}),
        ...(dto.defaultValue !== undefined ? { defaultValue: dto.defaultValue } : {}),
        ...(dto.isCalculated !== undefined ? { isCalculated: dto.isCalculated } : {}),
        ...(dto.calcGraph !== undefined ? { calcGraph: dto.calcGraph } : {}),
        ...(dto.formula !== undefined ? { formula: null } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.visible !== undefined ? { visible: dto.visible } : {}),
        ...(dto.timerEnabled !== undefined ? { timerEnabled: dto.timerEnabled } : {}),
        ...(dto.timerTrigger !== undefined
          ? { timerTrigger: effTimerEnabled ? dto.timerTrigger ?? null : null }
          : {}),
        ...(dto.timerValue !== undefined
          ? { timerValue: effTimerEnabled ? dto.timerValue ?? null : null }
          : {}),
      },
    });
  }

  async removeField(fieldId: number) {
    const field = await this.prisma.industryField.findUnique({
      where: { id: fieldId },
      include: { _count: { select: { fieldValues: true } } },
    });
    if (!field) throw new NotFoundException("产业字段不存在");
    if (field._count.fieldValues > 0) {
      throw new BadRequestException(
        `该产业字段已被 ${field._count.fieldValues} 家公司填写了字段值，无法删除。请先在这些公司的「资料」中清除该字段的值后再试。`
      );
    }
    await this.prisma.industryField.delete({ where: { id: fieldId } });
    // 清理兄弟字段对该字段的悬空引用（财年定时器 field: 引用、计算图 value 节点）
    await cleanupFieldReferences(this.prisma, field.industryTypeId, field.fieldKey);
    return { success: true };
  }
}
