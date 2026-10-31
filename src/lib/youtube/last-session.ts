import type { VideoInspect } from "./types";

const KEY = "kadr:last:v2";

export type LastInspect = {
  url: string;
  video: VideoInspect;
};

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadLastInspect(): LastInspect | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastInspect;
    if (!parsed?.video?.id || typeof parsed.url !== "string") return null;
    if (!Array.isArray(parsed.video.presets) || parsed.video.presets.length === 0) return null;
    if (!parsed.video.source) parsed.video.source = "youtube";
    return parsed;
  } catch {
    return null;
  }
}

export function saveLastInspect(state: LastInspect) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}
