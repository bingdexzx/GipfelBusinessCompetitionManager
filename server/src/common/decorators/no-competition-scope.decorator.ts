import { SetMetadata } from "@nestjs/common";

/**
 * 标记「不受 CompetitionScopeGuard 比赛归属收敛约束」的接口。
 *
 * 适用场景：全局共享模板（ContractType / IndustryType）或本身就是比赛实体的
 * CompetitionController——它们不按 `competitionId` 过滤私有数据，且需要被任意
 * 已登录角色读取 / 用于选比赛流程，故豁免作用域检查。
 */
export const NO_COMPETITION_SCOPE_KEY = "noCompetitionScope";

export function NoCompetitionScope(): MethodDecorator & ClassDecorator {
  return SetMetadata(NO_COMPETITION_SCOPE_KEY, true);
}
