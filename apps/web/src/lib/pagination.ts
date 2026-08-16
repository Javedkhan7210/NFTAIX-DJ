export type Paginated<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export function emptyPaginated<T>(limit = 20): Paginated<T> {
  return { items: [], page: 1, limit, total: 0, hasMore: false };
}

export function mergePaginated<T>(prev: Paginated<T>, next: Paginated<T>): Paginated<T> {
  return {
    items: [...prev.items, ...next.items],
    page: next.page,
    limit: next.limit,
    total: next.total,
    hasMore: next.hasMore
  };
}

/** Accept legacy bare arrays or `{ items, hasMore, ... }` from the API. */
export function coercePaginated<T>(data: unknown, fallbackLimit = 20): Paginated<T> {
  if (Array.isArray(data)) {
    return {
      items: data as T[],
      page: 1,
      limit: data.length > 0 ? data.length : fallbackLimit,
      total: data.length,
      hasMore: false
    };
  }
  if (data && typeof data === "object") {
    const p = data as Partial<Paginated<T>>;
    if (Array.isArray(p.items)) {
      return {
        items: p.items,
        page: p.page ?? 1,
        limit: p.limit ?? fallbackLimit,
        total: p.total ?? p.items.length,
        hasMore: Boolean(p.hasMore)
      };
    }
  }
  return emptyPaginated(fallbackLimit);
}
