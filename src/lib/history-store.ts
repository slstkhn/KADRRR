import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import type { HistoryItem } from "@/lib/history";
import { isMediaSource } from "@/lib/media/source";
import type { MediaSource } from "@/lib/youtube/types";

const LIMIT = 24;

const itemSchema = z.object({
  id: z.string().min(1).max(64),
  source: z
    .enum(["youtube", "instagram", "x", "threads", "tiktok", "rutube", "vimeo"])
    .default("youtube"),
  url: z.string().min(1).max(500),
  title: z.string().min(1).max(200),
  author: z.string().max(120).default(""),
  thumbnail: z.string().max(2000).default(""),
  durationSec: z.number().nullable().optional(),
  savedAt: z.number().optional(),
});

type HistoryRow = {
  id: string;
  source: string;
  url: string;
  title: string;
  author: string;
  thumbnail: string;
  duration_sec: number | null;
  saved_at: string | Date;
};

function persistableThumb(value: string | undefined): string {
  if (!value) return "";
  if (value.startsWith("data:")) return "";
  if (value.length > 1800) return "";
  return value;
}

function asItem(row: HistoryRow): HistoryItem {
  const saved =
    typeof row.saved_at === "string"
      ? Date.parse(row.saved_at)
      : row.saved_at instanceof Date
        ? row.saved_at.getTime()
        : Date.now();
  return {
    id: row.id,
    source: (isMediaSource(row.source) ? row.source : "youtube") as MediaSource,
    url: row.url,
    title: row.title,
    author: row.author ?? "",
    thumbnail: persistableThumb(row.thumbnail),
    durationSec: row.duration_sec ?? null,
    savedAt: Number.isFinite(saved) ? saved : Date.now(),
  };
}

async function readList(userId: string): Promise<HistoryItem[]> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<HistoryRow>`
    select id, source, url, title, author, thumbnail, duration_sec, saved_at
    from history_items
    where user_id = ${userId}
    order by saved_at desc
    limit ${LIMIT}
  `;
  return rows.map(asItem);
}

async function upsertItem(
  userId: string,
  item: z.infer<typeof itemSchema>,
): Promise<void> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const source = item.source ?? "youtube";
  const thumbnail = persistableThumb(item.thumbnail);
  const duration = item.durationSec ?? null;
  const savedAt = new Date(item.savedAt ?? Date.now());
  await sql`
    insert into history_items (
      user_id, source, id, url, title, author, thumbnail, duration_sec, saved_at
    ) values (
      ${userId}, ${source}, ${item.id}, ${item.url}, ${item.title},
      ${item.author ?? ""}, ${thumbnail}, ${duration}, ${savedAt}
    )
    on conflict (user_id, source, id) do update set
      url = excluded.url,
      title = excluded.title,
      author = excluded.author,
      thumbnail = excluded.thumbnail,
      duration_sec = excluded.duration_sec,
      saved_at = excluded.saved_at
  `;
}

export const listHistory = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<HistoryItem[]> => {
    return readList(context.userId);
  });

export const saveHistoryItem = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(itemSchema)
  .handler(async ({ context, data }): Promise<HistoryItem[]> => {
    await upsertItem(context.userId, data);
    return readList(context.userId);
  });

export const syncHistory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.array(itemSchema).max(LIMIT))
  .handler(async ({ context, data }): Promise<HistoryItem[]> => {
    for (const item of data) {
      await upsertItem(context.userId, item);
    }
    return readList(context.userId);
  });

export const clearHistoryItems = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<HistoryItem[]> => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`delete from history_items where user_id = ${context.userId}`;
    return [];
  });
