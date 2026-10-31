import { BROWSER_UA, withTimeout } from "../media/http.server";
import { watchUrl } from "./parse";
import type { VideoPreset } from "./types";

export type RemoteKind = "360" | "720" | "mp3";

const START_URL = "https://loader.to/ajax/download.php";
const CACHE_TTL_MS = 8 * 60 * 1000;
const POLL_MS = 1_400;
const POLL_BUDGET_MS = 40_000;

const cache = new Map<string, { expires: number; url: string }>();

const HEADERS: Record<string, string> = {
  accept: "application/json,text/plain,*/*",
  "accept-language": "ru,en;q=0.8",
  "user-agent": BROWSER_UA,
  referer: "https://loader.to/",
};

export function remoteFallbackPresets(): VideoPreset[] {
  return [
    {
      id: "remote-720",
      itag: 22,
      label: "720p со звуком",
      kind: "muxed",
      ext: "mp4",
      mime: "video/mp4",
      hasAudio: true,
      hasVideo: true,
      qualityLabel: "720p",
      sizeBytes: null,
      note: "готовый файл, видео и звук",
    },
    {
      id: "remote-360",
      itag: 18,
      label: "360p со звуком",
      kind: "muxed",
      ext: "mp4",
      mime: "video/mp4",
      hasAudio: true,
      hasVideo: true,
      qualityLabel: "360p",
      sizeBytes: null,
      note: "готовый файл, видео и звук",
    },
    {
      id: "remote-mp3",
      itag: 140,
      label: "Только звук",
      kind: "audio",
      ext: "mp3",
      mime: "audio/mpeg",
      hasAudio: true,
      hasVideo: false,
      qualityLabel: "mp3",
      sizeBytes: null,
      note: "MP3",
    },
  ];
}

export function remoteKindForPreset(
  presetId: string,
  qualityLabel?: string | null,
  kind?: string,
): RemoteKind {
  const blob = `${presetId} ${qualityLabel ?? ""} ${kind ?? ""}`.toLowerCase();
  if (blob.includes("mp3") || blob.includes("audio") || kind === "audio") {
    return "mp3";
  }
  const q = Number.parseInt(qualityLabel ?? "", 10);
  if ((Number.isFinite(q) && q >= 720) || /720|1080|2160|4k/.test(blob)) {
    return "720";
  }
  return "360";
}

export function isRemoteUrl(url: string): boolean {
  return url.startsWith("remote:");
}

export function kindFromRemoteUrl(url: string): RemoteKind {
  const raw = url.slice("remote:".length);
  if (raw === "720" || raw === "mp3") return raw;
  return "360";
}

function cacheKey(videoId: string, kind: RemoteKind): string {
  return `${videoId}:${kind}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asHttpUrl(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("http") ? value : null;
}

async function readJson(url: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  try {
    const res = await withTimeout(
      fetch(url, { headers: HEADERS, redirect: "follow" }),
      timeoutMs,
      "remote timeout",
    );
    if (!res.ok) return null;
    return asRecord(await res.json());
  } catch {
    return null;
  }
}

async function resolveRemoteUrl(videoId: string, kind: RemoteKind): Promise<string | null> {
  const key = cacheKey(videoId, kind);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.url;

  const start = new URL(START_URL);
  start.searchParams.set("format", kind);
  start.searchParams.set("url", watchUrl(videoId));

  const started = await readJson(start.href, 12_000);
  if (!started) return null;
  const ready = asHttpUrl(started.download_url) ?? asHttpUrl(started.url);
  if (ready) {
    cache.set(key, { expires: Date.now() + CACHE_TTL_MS, url: ready });
    return ready;
  }

  const progressUrl = asHttpUrl(started.progress_url);
  if (!progressUrl) return null;

  const deadline = Date.now() + POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const progress = await readJson(progressUrl, 12_000);
    if (!progress) continue;
    const text = String(progress.text ?? progress.message ?? "");
    if (/error|fail|invalid|not found/i.test(text) && !asHttpUrl(progress.download_url)) {
      return null;
    }
    const url = asHttpUrl(progress.download_url);
    if (url) {
      cache.set(key, { expires: Date.now() + CACHE_TTL_MS, url });
      return url;
    }
  }
  return null;
}

export async function openRemoteYouTube(
  videoId: string,
  kind: RemoteKind,
): Promise<Response | null> {
  const fileUrl = await resolveRemoteUrl(videoId, kind);
  if (!fileUrl) return null;
  try {
    const res = await withTimeout(
      fetch(fileUrl, {
        headers: {
          accept: "*/*",
          "user-agent": BROWSER_UA,
          referer: "https://loader.to/",
        },
        redirect: "follow",
      }),
      25_000,
      "remote file timeout",
    );
    if (!res.ok || !res.body) return null;
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (type.includes("text/html") || type.includes("text/plain")) return null;
    return res;
  } catch {
    return null;
  }
}
