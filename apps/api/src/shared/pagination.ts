export type Paginated<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export function parseListQuery(
  query: Record<string, unknown>,
  defaults: { page?: number; limit?: number; maxLimit?: number } = {}
): { page: number; limit: number; skip: number } {
  const page = Math.max(1, parseInt(String(query.page ?? defaults.page ?? 1), 10) || 1);
  const maxLimit = defaults.maxLimit ?? 50;
  const limit = Math.min(
    maxLimit,
    Math.max(1, parseInt(String(query.limit ?? defaults.limit ?? 20), 10) || defaults.limit || 20)
  );
  return { page, limit, skip: (page - 1) * limit };
}

export function paginatedSlice<T>(all: T[], page: number, limit: number, total?: number): Paginated<T> {
  const skip = (page - 1) * limit;
  const items = all.slice(skip, skip + limit);
  const t = total ?? all.length;
  return { items, page, limit, total: t, hasMore: skip + items.length < t };
}

export function paginatedFromQuery<T>(
  items: T[],
  total: number,
  page: number,
  limit: number
): Paginated<T> {
  return { items, page, limit, total, hasMore: page * limit < total };
}
