import type { MediaSource } from "@/lib/youtube/types";

const KEY = "kadr:history:v1";
const LIMIT = 24;

export type HistoryItem = {
  id: string;
  source?: MediaSource;
  url?: string;
  title: string;
  author: string;
  thumbnail: string;
  durationSec: number | null;
  savedAt: number;
};

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function persistableThumbnail(value: string | undefined): string {
  if (!value) return "";
  if (value.startsWith("data:")) return "";
  if (value.length > 1800) return "";
  return value;
}

export function loadHistory(): HistoryItem[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item?.id === "string" && typeof item?.title === "string");
  } catch {
    return [];
  }
}

export function pushHistory(item: Omit<HistoryItem, "savedAt">): HistoryItem[] {
  const source = item.source ?? "youtube";
  const next: HistoryItem[] = [
    {
      ...item,
      source,
      thumbnail: persistableThumbnail(item.thumbnail),
      savedAt: Date.now(),
    },
    ...loadHistory().filter((row) => {
      const rowSource = row.source ?? "youtube";
      return !(row.id === item.id && rowSource === source);
    }),
  ].slice(0, LIMIT);
  const store = storage();
  if (store) {
    try {
      store.setItem(KEY, JSON.stringify(next));
    } catch {
      /* quota / private mode */
    }
  }
  return next;
}

export function clearHistory(): HistoryItem[] {
  const store = storage();
  if (store) {
    try {
      store.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
  return [];
}
