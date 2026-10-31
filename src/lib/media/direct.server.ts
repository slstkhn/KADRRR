import { safeFilename } from "@/lib/youtube/format";
import type { OpenStreamResult, VideoPreset } from "@/lib/youtube/types";
import { extFromUrl, isHtmlContentType, mimeFromExt, withTimeout } from "./http.server";

export type DirectFormat = {
  url: string;
  mime: string;
  ext: string;
  headers?: Record<string, string>;
};

export type DirectCacheEntry = {
  expires: number;
  title: string;
  formats: Map<string, DirectFormat>;
};

export type DirectItem = {
  videoUrl?: string | null;
  imageUrl?: string | null;
  width?: number | null;
  height?: number | null;
  quality?: string | null;
  note?: string;
  ext?: string;
  mime?: string;
  headers?: Record<string, string>;
};

export function createFormatCache(ttlMs: number) {
  const cache = new Map<string, DirectCacheEntry>();
  return {
    get(id: string) {
      const entry = cache.get(id);
      if (!entry || entry.expires < Date.now()) return null;
      return entry;
    },
    set(id: string, title: string, formats: Map<string, DirectFormat>) {
      cache.set(id, { expires: Date.now() + ttlMs, title, formats });
    },
    raw: cache,
  };
}

export function qualityFromSize(width?: number | null, height?: number | null): string {
  if (height && height >= 100) return `${height}p`;
  if (width && width >= 100) return `${width}px`;
  return "HD";
}

export function buildDirectPresets(
  prefix: string,
  items: DirectItem[],
  extraNote?: string,
  numbered = items.length > 1,
): { presets: VideoPreset[]; formats: Map<string, DirectFormat> } {
  const presets: VideoPreset[] = [];
  const formats = new Map<string, DirectFormat>();
  const many = numbered && items.length > 1;

  items.forEach((item, index) => {
    const n = index + 1;
    const slide = many ? `Слайд ${n} · ` : "";
    const q = item.quality || qualityFromSize(item.width, item.height);
    if (item.videoUrl) {
      const id = `${prefix}-v${n}`;
      const ext = item.ext ?? extFromUrl(item.videoUrl, "mp4");
      const mime = item.mime ?? mimeFromExt(ext, true);
      presets.push({
        id,
        itag: n,
        label: `${slide}${q} со звуком`,
        kind: "muxed",
        ext,
        mime,
        hasAudio: true,
        hasVideo: true,
        qualityLabel: q,
        sizeBytes: null,
        note: item.note ?? extraNote ?? (many ? "видео из публикации" : "готовый файл"),
      });
      formats.set(id, {
        url: item.videoUrl,
        mime,
        ext,
        headers: item.headers,
      });
    }
    if (item.imageUrl) {
      const isCover = Boolean(item.videoUrl);
      const id = isCover ? `${prefix}-cover-${n}` : `${prefix}-i${n}`;
      const ext = extFromUrl(item.imageUrl, "jpg");
      const mime = mimeFromExt(ext, false);
      presets.push({
        id,
        itag: n + 100,
        label: isCover ? `${slide}Обложка` : `${slide}${q}`,
        kind: "image",
        ext,
        mime,
        hasAudio: false,
        hasVideo: false,
        qualityLabel: q,
        sizeBytes: null,
        note: isCover
          ? "кадр-обложка"
          : (item.note ?? (many ? "фото из публикации" : "оригинал")),
      });
      formats.set(id, {
        url: item.imageUrl,
        mime,
        ext,
        headers: item.headers,
      });
    }
  });

  return { presets, formats };
}

export async function openDirectUrl(
  format: DirectFormat,
  title: string,
): Promise<OpenStreamResult> {
  try {
    const response = await withTimeout(
      fetch(format.url, {
        headers: {
          accept: "*/*",
          ...(format.headers ?? {}),
        },
        redirect: "follow",
      }),
      25_000,
      "file timeout",
    );
    if (!response.ok || !response.body) {
      return { ok: false, error: "Не удалось получить файл. Попробуйте ещё раз." };
    }
    if (isHtmlContentType(response.headers.get("content-type"))) {
      return { ok: false, error: "Не удалось получить файл. Попробуйте ещё раз." };
    }
    return {
      ok: true,
      response,
      filename: `${safeFilename(title)}.${format.ext}`,
      mime: format.mime,
    };
  } catch {
    return { ok: false, error: "Не удалось получить файл. Попробуйте ещё раз." };
  }
}
