import { BadRequestException } from "@nestjs/common";

/**
 * 作用域校验：删除比赛作用域内的数据时，确保目标数据确实归属于当前操作的比赛。
 *
 * 规则：
 * - 仅在「请求方提供了 competitionId」且「数据本身绑定了 competitionId」时校验，两者必须一致。
 * - 数据 competitionId 为 null（全局模板，不归属于任何比赛）时不做限制，可从任意比赛上下文删除。
 * - 这样可防止用户在本比赛上下文中误删（或越权删除）其它比赛的数据（如通过猜测 ID）。
 */
export function assertSameCompetition(
  entityCompetitionId: number | null | undefined,
  requestedCompetitionId?: number,
): void {
  if (
    requestedCompetitionId != null &&
    entityCompetitionId != null &&
    entityCompetitionId !== requestedCompetitionId
  ) {
    throw new BadRequestException("该数据不属于当前比赛，无法删除（可能属于其它比赛）");
  }
}
