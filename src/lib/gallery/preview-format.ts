/**
 * Preview format compatibility ranking, shared by every serializer that
 * orders a ClientPreview array (serialize.ts and moment-search.ts). The
 * order contract it backs: within a width, the most compatible format sorts
 * first, so previews[0] is a URL every browser can decode while
 * previews[length - 1] stays the best large format. Framework-free and
 * importable from server and client alike.
 */
const FORMAT_RANK: Record<string, number> = { avif: 0, webp: 1, jpeg: 2 };

/** Lower is cheaper/more modern; unknown formats sort last. */
export function formatRank(format: string): number {
  return FORMAT_RANK[format] ?? 99;
}
