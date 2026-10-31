import { parseInstagram, canonicalInstagramUrl } from "@/lib/instagram/parse";
import { parseYouTubeId, watchUrl } from "@/lib/youtube/parse";
import { parseX } from "@/lib/x/parse";
import { parseThreads } from "@/lib/threads/parse";
import { parseTikTok, canonicalTikTokUrl } from "@/lib/tiktok/parse";
import { parseRutube } from "@/lib/rutube/parse";
import { parseVimeo, canonicalVimeoUrl } from "@/lib/vimeo/parse";
import type { MediaSource } from "@/lib/youtube/types";

export const MEDIA_SOURCES: MediaSource[] = [
  "youtube",
  "instagram",
  "x",
  "threads",
  "tiktok",
  "rutube",
  "vimeo",
];

const LABELS: Record<MediaSource, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  x: "X",
  threads: "Threads",
  tiktok: "TikTok",
  rutube: "RuTube",
  vimeo: "Vimeo",
};

export function isMediaSource(value: string | null | undefined): value is MediaSource {
  return Boolean(value && (MEDIA_SOURCES as string[]).includes(value));
}

export function sourceLabel(source: MediaSource | string | undefined): string {
  if (source && source in LABELS) return LABELS[source as MediaSource];
  return "YouTube";
}

export function openOnLabel(source: MediaSource): string {
  if (source === "instagram") return "Открыть в Instagram";
  if (source === "x") return "Открыть в X";
  if (source === "threads") return "Открыть в Threads";
  if (source === "tiktok") return "Открыть в TikTok";
  if (source === "rutube") return "Открыть на RuTube";
  if (source === "vimeo") return "Открыть на Vimeo";
  return "Открыть на YouTube";
}

export type DetectedMedia = {
  source: MediaSource;
  id: string;
  url: string;
  kind?: string;
};

export function detectMedia(input: string): DetectedMedia | null {
  const trimmed = input.replace(/[\u200b-\u200d\ufeff]/g, "").trim();
  if (!trimmed) return null;

  const ig = parseInstagram(trimmed);
  if (ig) {
    return {
      source: "instagram",
      id: ig.shortcode ?? ig.storyId ?? "share",
      url: ig.url,
      kind: ig.kind,
    };
  }

  const yt = parseYouTubeId(trimmed);
  if (yt) {
    return { source: "youtube", id: yt, url: watchUrl(yt) };
  }

  const vm = parseVimeo(trimmed);
  if (vm) {
    return { source: "vimeo", id: vm.id, url: vm.url };
  }

  const tt = parseTikTok(trimmed);
  if (tt) return { source: "tiktok", id: tt.id, url: tt.url, kind: tt.kind };

  const x = parseX(trimmed);
  if (x) return { source: "x", id: x.id, url: x.url, kind: x.kind };

  const th = parseThreads(trimmed);
  if (th) return { source: "threads", id: th.id, url: th.url, kind: th.kind };

  const rt = parseRutube(trimmed);
  if (rt) return { source: "rutube", id: rt.id, url: rt.url, kind: rt.kind };

  return null;
}

export function canonicalUrl(source: MediaSource, id: string, fallback?: string): string {
  if (fallback) return fallback;
  if (source === "youtube") return watchUrl(id);
  if (source === "instagram") return canonicalInstagramUrl("p", id);
  if (source === "tiktok") return canonicalTikTokUrl(id);
  if (source === "x") return `https://x.com/i/status/${id}`;
  if (source === "threads") return `https://www.threads.com/t/${id}`;
  if (source === "rutube") return `https://rutube.ru/video/${id}/`;
  if (source === "vimeo") return canonicalVimeoUrl(id);
  return fallback ?? "";
}
