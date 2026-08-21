const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

export function parsePagination(query: { page?: string; pageSize?: string }) {
  const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.pageSize || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  return { page, pageSize };
}
