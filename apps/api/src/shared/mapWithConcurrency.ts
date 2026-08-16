/** Bounded parallel map (worker pool). Use for many independent RPC / HTTP calls. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  };
  const n = Math.max(1, Math.min(Math.max(1, limit), items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
