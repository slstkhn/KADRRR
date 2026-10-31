import type { MediaSource } from "@/lib/youtube/types";

export function contentDisposition(filename: string): string {
  const ascii = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .slice(0, 120);
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii || "kadr"}"; filename*=UTF-8''${encoded}`;
}

export function fileDownloadPath(source: MediaSource, id: string, presetId: string): string {
  const query = new URLSearchParams({
    source,
    id,
    preset: presetId,
  });
  return `/api/file?${query.toString()}`;
}
