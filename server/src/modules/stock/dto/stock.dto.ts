import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  IsInt,
  Min,
  Max,
  IsArray,
} from "class-validator";
import { Transform, Type } from "class-transformer";

// 创建股票时填入的「基础信息」（对应 Excel「基础信息」表前 8 列）。
// 初始价 initPrice 由公式自动算：ROUND(initNetProfit*10000/totalShares/industryPE, 2)。
export class CreateStockDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalShares: number; // 总股本（万股）

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  initNetProfit: number; // 初始净利润（万）

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  industryPE?: number; // 行业 PB（可选）：联动模式由字段填充，随机模式由随机源生成；手动传入则作为随机源初始种子

  @Type(() => Number)
  @IsNumber()
  currentCarbon: number; // 当前碳排

  @Type(() => Number)
  @IsNumber()
  industryAvgCarbon: number; // 行业碳排均值

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  happiness: number; // 当前幸福度

  @IsOptional()
  @Transform(({ value }) => (value === "" || value === null ? undefined : value))
  @Type(() => Number)
  @IsInt()
  companyId?: number; // 关联商赛公司（可选）

  // 行业 PB 联动：pbCompanyId 与 pbFieldId 须同时提供（联动模式），或同时留空（随机模式）。
  @IsOptional()
  @Transform(({ value }) => (value === "" || value === null ? undefined : value))
  @Type(() => Number)
  @IsInt()
  pbCompanyId?: number;

  @IsOptional()
  @Transform(({ value }) => (value === "" || value === null ? undefined : value))
  @Type(() => Number)
  @IsInt()
  pbFieldId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(20)
  pbRandom?: number; // 随机源初始值（仅随机模式，留空则创建时自动生成 0~20）

  // 绑定区域总览卡片（实时引用）：JSON {region, cardId}，未绑定留空
  @IsOptional()
  @IsString()
  carbonFieldRef?: string;

  @IsOptional()
  @IsString()
  happinessFieldRef?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  competitionId?: number; // 由 CompetitionScopeGuard 注入为操作人真实归属比赛
}

export class UpdateStockDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalShares?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  initNetProfit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  industryPE?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  currentCarbon?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  industryAvgCarbon?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  happiness?: number;

  @IsOptional()
  @Transform(({ value }) => (value === "" || value === null ? undefined : value))
  @Type(() => Number)
  @IsInt()
  companyId?: number | null;

  // 行业 PB 联动：pbCompanyId 与 pbFieldId 须同时提供或同时留空；清空二者即切回随机模式。
  // null 表示「清空绑定、切回随机」，不能像创建时那样把 null 转 undefined（否则清空被当成"未传"而沿用旧绑定值）。
  @IsOptional()
  @Transform(({ value }) => (value === "" ? undefined : value))
  @Type(() => Number)
  @IsInt()
  pbCompanyId?: number | null;

  @IsOptional()
  @Transform(({ value }) => (value === "" ? undefined : value))
  @Type(() => Number)
  @IsInt()
  pbFieldId?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(20)
  pbRandom?: number; // 随机源当前值（仅随机模式）

  // 绑定区域总览卡片（实时引用）：JSON {region, cardId}，未绑定留空
  @IsOptional()
  @IsString()
  carbonFieldRef?: string;

  @IsOptional()
  @IsString()
  happinessFieldRef?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  competitionId?: number; // 由 CompetitionScopeGuard 注入为操作人真实归属比赛
}

// 资金账户
export class CreateFundsAccountDto {
  @IsString()
  name: string;

  @IsIn(["COMPANY", "USER"])
  ownerType: "COMPANY" | "USER";

  @IsOptional()
  @Transform(({ value }) => (value === "" || value === null ? undefined : value))
  @Type(() => Number)
  @IsInt()
  companyId?: number; // ownerType=COMPANY 时必填

  @IsOptional()
  @Transform(({ value }) => (value === "" || value === null ? undefined : value))
  @Type(() => Number)
  @IsInt()
  userId?: number; // ownerType=USER 时必填（不传则默认当前用户）

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cashBalance?: number; // 初始现金（元），默认 1,000,000

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  competitionId?: number;
}

export class UpdateFundsAccountDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cashBalance?: number;

  @IsOptional()
  @Transform(({ value }) => (value === "" || value === null ? undefined : value))
  @Type(() => Number)
  @IsInt()
  companyId?: number | null;

  @IsOptional()
  @Transform(({ value }) => (value === "" || value === null ? undefined : value))
  @Type(() => Number)
  @IsInt()
  userId?: number | null;
}

// 下单
export class CreateOrderDto {
  @Type(() => Number)
  @IsInt()
  stockId: number;

  @Type(() => Number)
  @IsInt()
  fundsAccountId: number;

  @IsIn(["BUY", "SELL"])
  side: "BUY" | "SELL";

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  price: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  quantity: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  competitionId?: number;
}

// 做市商配置
export class MarketMakerConfigDto {
  @IsOptional()
  enabled?: boolean; // 是否启用做市商，默认 true

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(20)
  spreadPct?: number; // 点差百分比（如 2 表示 2%），默认 2

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  levels?: number; // 挂单档数（买卖各 N 档），默认 3

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(100000)
  baseQuantity?: number; // 每档基础数量（股），默认 1000
}

// 推进轮次（高级管理）
export class AdvanceRoundDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  stockIds?: number[]; // 不传则推进比赛内全部股票

  @IsOptional()
  @Type(() => MarketMakerConfigDto)
  marketMaker?: MarketMakerConfigDto; // 做市商配置
}
