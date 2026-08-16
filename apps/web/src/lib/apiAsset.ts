import { baseURL } from "../api/client";

/** Turn `/market-nfts/foo.png` into a full URL for `<img src>` (API serves static files). */
export function resolveApiAssetUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const root = baseURL.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${root}${p}`;
}
