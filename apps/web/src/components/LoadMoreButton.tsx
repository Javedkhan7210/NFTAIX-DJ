type LoadMoreButtonProps = {
  hasMore: boolean;
  loading?: boolean;
  onLoadMore: () => void;
};

export function LoadMoreButton({ hasMore, loading, onLoadMore }: LoadMoreButtonProps) {
  if (!hasMore) return null;
  return (
    <button
      type="button"
      onClick={onLoadMore}
      disabled={loading}
      className="btn-neon-ghost w-full py-3 text-sm font-semibold disabled:opacity-50"
    >
      {loading ? "Loading…" : "Load more"}
    </button>
  );
}
