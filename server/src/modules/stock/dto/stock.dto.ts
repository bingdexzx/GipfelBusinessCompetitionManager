import {
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  IsInt,
  Min,
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

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  industryPE: number; // 行业 PE

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

// 推进轮次（高级管理）
export class AdvanceRoundDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  stockIds?: number[]; // 不传则推进比赛内全部股票
}
