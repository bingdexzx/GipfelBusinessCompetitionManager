/**
 * 删除某产业字段后，清理同产业类型其余字段中对它的悬空引用（T15 删除影响自动化）：
 * - timerValue === "field:<deletedFieldKey>" → 置空（避免财年定时器引用已删字段静默跳过）
 * - calcGraph 中 type:"value" 且 data.fieldKey === deletedFieldKey 的节点 → 移除节点及相关边
 *
 * 直接走 prisma，不依赖 CompanyFieldsService（避免 industry-types ↔ company-fields 循环依赖）。
 */
const TIMER_REF_PREFIX = "field:";

export async function cleanupFieldReferences(
  prisma: any,
  industryTypeId: number,
  deletedFieldKey: string,
) {
  if (!deletedFieldKey) return;
  const siblings = await prisma.industryField.findMany({
    where: { industryTypeId, fieldKey: { not: deletedFieldKey } },
  });
  for (const f of siblings) {
    if (typeof f.timerValue === "string" && f.timerValue === `${TIMER_REF_PREFIX}${deletedFieldKey}`) {
      await prisma.industryField.update({ where: { id: f.id }, data: { timerValue: "" } });
    }

    if (f.calcGraph) {
      try {
        const g = JSON.parse(f.calcGraph);
        const nodes: any[] = Array.isArray(g?.nodes) ? g.nodes : [];
        const removed = new Set(
          nodes
            .filter((n: any) => n?.type === "value" && n?.data?.fieldKey === deletedFieldKey)
            .map((n: any) => n.id),
        );
        if (removed.size > 0) {
          g.nodes = nodes.filter((n: any) => !removed.has(n.id));
          if (Array.isArray(g.edges)) {
            g.edges = g.edges.filter(
              (e: any) => !removed.has(e?.source) && !removed.has(e?.target),
            );
          }
          await prisma.industryField.update({
            where: { id: f.id },
            data: { calcGraph: JSON.stringify(g) },
          });
        }
      } catch {
        // 计算图 JSON 损坏：跳过，不阻断删除
      }
    }
  }
}
