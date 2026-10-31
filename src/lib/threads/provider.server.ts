import { fileDownloadPath } from "../media/disposition";
import {
  buildDirectPresets,
  createFormatCache,
  openDirectUrl,
  qualityFromSize,
  type DirectFormat,
  type DirectItem,
} from "../media/direct.server";
import {
  BROWSER_UA,
  GOOGLEBOT_UA,
  asNumber,
  asRecord,
  asString,
  fetchText,
  inlineThumbnail,
  walkRecords,
} from "../media/http.server";
import { safeFilename } from "../youtube/format";
import type { DownloadLinkResult, InspectResult, OpenStreamResult, VideoInspect } from "../youtube/types";
import { canonicalThreadsUrl, parseThreads } from "./parse";

const cache = createFormatCache(15 * 60 * 1000);

const PAGE_HEADERS: Record<string, string> = {
  "user-agent": GOOGLEBOT_UA,
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

const STREAM_HEADERS: Record<string, string> = {
  "user-agent": BROWSER_UA,
  accept: "*/*",
  referer: "https://www.threads.com/",
  origin: "https://www.threads.com",
};

type Normalized = {
  id: string;
  title: string;
  author: string;
  authorUrl: string | null;
  thumbnail: string;
  durationSec: number | null;
  views: number | null;
  items: DirectItem[];
};

function decodeHtml(value: string): string {
  const amp = String.fromCharCode(38);
  let text = value
    .split(`${amp}amp;`)
    .join(amp)
    .split(`${amp}quot;`)
    .join('"')
    .split(`${amp}lt;`)
    .join("<")
    .split(`${amp}gt;`)
    .join(">");
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  text = text.replace(/&#(\d+);/g, (_, num: string) => String.fromCharCode(Number(num)));
  return text;
}

function isProfileImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("t51.2885-19") ||
    lower.includes("profile_pic") ||
    lower.includes("rsrc.php") ||
    lower.includes("/static/")
  );
}

function largestVersion(list: unknown): { url: string; width: number | null; height: number | null } | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  let best: { url: string; width: number; height: number | null } | null = null;
  for (const item of list) {
    const rec = asRecord(item);
    const url = asString(rec?.url);
    if (!url) continue;
    const width = asNumber(rec?.width) ?? 0;
    const height = asNumber(rec?.height);
    if (!best || width > best.width) best = { url, width, height };
  }
  return best ? { url: best.url, width: best.width || null, height: best.height } : null;
}

function posterFrom(node: Record<string, unknown>): string {
  return largestVersion(asRecord(node.image_versions2)?.candidates)?.url ?? "";
}

function itemFromNode(node: Record<string, unknown>): DirectItem | null {
  const video = largestVersion(node.video_versions);
  const image =
    largestVersion(asRecord(node.image_versions2)?.candidates) ??
    (asString(node.thumbnail_url) || asString(node.display_url)
      ? { url: asString(node.thumbnail_url) ?? asString(node.display_url) ?? "", width: null, height: null }
      : null);
  if (image && isProfileImageUrl(image.url)) {
    if (!video) return null;
  }
  if (!video && !image) return null;
  const width = video?.width ?? asNumber(node.original_width) ?? image?.width;
  const height = video?.height ?? asNumber(node.original_height) ?? image?.height;
  return {
    videoUrl: video?.url,
    imageUrl: video ? null : image?.url,
    width,
    height,
    quality: qualityFromSize(width, height),
    note: video ? "готовое видео" : "оригинал",
    headers: STREAM_HEADERS,
  };
}

function collectItems(node: Record<string, unknown>): DirectItem[] {
  const carousel = Array.isArray(node.carousel_media) ? node.carousel_media : [];
  const items: DirectItem[] = [];
  if (carousel.length > 0) {
    for (const child of carousel) {
      const rec = asRecord(child);
      if (!rec) continue;
      const item = itemFromNode(rec);
      if (item) items.push(item);
    }
    return items;
  }
  const item = itemFromNode(node);
  return item ? [item] : [];
}

function nestedMediaNodes(node: Record<string, unknown>): Record<string, unknown>[] {
  const info = asRecord(node.text_post_app_info);
  const share = asRecord(info?.share_info);
  const out: Record<string, unknown>[] = [];
  for (const key of ["quoted_attachment_post", "quoted_post", "reposted_post"] as const) {
    const rec = asRecord(share?.[key]);
    if (rec) out.push(rec);
  }
  const linked = asRecord(info?.linked_inline_media);
  if (linked) out.push(linked);
  return out;
}

function captionFrom(node: Record<string, unknown>): string {
  const caption = node.caption;
  if (typeof caption === "string") return caption;
  const nested = asString(asRecord(caption)?.text);
  if (nested) return nested;
  const text = asString(node.text);
  if (text) return text;
  const fragments = asRecord(asRecord(node.text_post_app_info)?.text_with_entities)?.text;
  return asString(fragments) ?? "";
}

function authorFrom(node: Record<string, unknown>): string {
  const user = asRecord(node.user) ?? asRecord(node.owner);
  return asString(user?.username) ?? asString(user?.name) ?? "";
}

function normalizeNode(node: Record<string, unknown>, fallbackId: string): Normalized | null {
  const id = asString(node.code) ?? asString(node.shortcode) ?? fallbackId;
  if (!id) return null;

  let items = collectItems(node);
  let mediaNode = node;
  if (!items.some((item) => item.videoUrl)) {
    for (const nested of nestedMediaNodes(node)) {
      const extra = collectItems(nested);
      if (extra.some((item) => item.videoUrl)) {
        items = extra;
        mediaNode = nested;
        break;
      }
      if (items.length === 0 && extra.length > 0) {
        items = extra;
        mediaNode = nested;
      }
    }
  }
  if (items.length === 0) return null;

  const author = authorFrom(node);
  const caption = captionFrom(node).replace(/\s+/g, " ").trim();
  const thumb = posterFrom(mediaNode) || posterFrom(node) || items.find((item) => item.imageUrl)?.imageUrl || "";
  return {
    id,
    title: (caption || (author ? `Публикация @${author}` : "Публикация Threads")).slice(0, 140),
    author,
    authorUrl: author ? `https://www.threads.com/@${author}` : null,
    thumbnail: thumb,
    durationSec: asNumber(mediaNode.video_duration) != null ? Math.round(asNumber(mediaNode.video_duration) ?? 0) : null,
    views: asNumber(node.play_count) ?? asNumber(node.view_count) ?? asNumber(node.ig_play_count),
    items,
  };
}

function parseJsonScripts(html: string): unknown[] {
  const blobs: unknown[] = [];
  const re = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const raw = match[1]?.trim() ?? "";
    if (!raw.startsWith("{") && !raw.startsWith("[")) continue;
    try {
      blobs.push(JSON.parse(raw) as unknown);
    } catch {
      /* ignore */
    }
  }
  return blobs;
}

function extract(html: string, shortcode: string): Normalized | null {
  const blobs = parseJsonScripts(html);
  const matches: Normalized[] = [];
  for (const blob of blobs) {
    walkRecords(blob, (rec) => {
      const code = asString(rec.code) ?? asString(rec.shortcode);
      if (shortcode && code !== shortcode) return;
      const media = normalizeNode(rec, shortcode);
      if (!media) return;
      if (media.items.some((item) => item.videoUrl)) matches.unshift(media);
      else matches.push(media);
    });
  }
  if (matches[0]) return matches[0];

  const ogVideoRaw = html.match(/property="og:video(?::url)?"\s+content="([^"]+)"/i)?.[1];
  const ogImageRaw = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1];
  const ogTitleRaw = html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1];
  const ogVideo = ogVideoRaw ? decodeHtml(ogVideoRaw) : "";
  const ogImage = ogImageRaw ? decodeHtml(ogImageRaw) : "";
  const ogTitle = ogTitleRaw ? decodeHtml(ogTitleRaw) : "";
  const usableImage = ogImage && !isProfileImageUrl(ogImage) ? ogImage : "";
  if (!ogVideo && !usableImage) return null;
  const author = ogTitle.match(/@([A-Za-z0-9._]+)/)?.[1] ?? "";
  return {
    id: shortcode,
    title: author ? `Публикация @${author}` : "Публикация Threads",
    author,
    authorUrl: author ? `https://www.threads.com/@${author}` : null,
    thumbnail: usableImage || ogImage,
    durationSec: null,
    views: null,
    items: [
      {
        videoUrl: ogVideo || null,
        imageUrl: ogVideo ? null : usableImage,
        note: ogVideo ? "готовое видео" : "оригинал",
        headers: STREAM_HEADERS,
      },
    ],
  };
}

async function resolveShare(url: string): Promise<string> {
  try {
    const { res, text } = await fetchText(url, PAGE_HEADERS, 8_000);
    const parsed = parseThreads(res.url || url);
    if (parsed?.kind === "post") return parsed.id;
    const canonical =
      text.match(/rel="canonical"\s+href="([^"]+)"/i)?.[1] ??
      text.match(/property="og:url"\s+content="([^"]+)"/i)?.[1];
    if (canonical) {
      const next = parseThreads(decodeHtml(canonical));
      if (next?.kind === "post") return next.id;
    }
  } catch {
    /* fall through */
  }
  return "";
}

function toInspect(media: Normalized): VideoInspect {
  const { presets, formats } = buildDirectPresets("th", media.items);
  cache.set(media.id, media.title, formats);
  return {
    id: media.id,
    source: "threads",
    url: canonicalThreadsUrl(media.id, media.author || undefined),
    title: media.title,
    author: media.author,
    authorUrl: media.authorUrl,
    thumbnail: media.thumbnail,
    durationSec: media.durationSec,
    views: media.views,
    isLive: false,
    downloadable: presets.length > 0,
    restriction: presets.length > 0 ? null : "В этом посте нет видео или фото.",
    presets,
  };
}

export async function inspect(rawUrl: string): Promise<InspectResult> {
  let ref = parseThreads(rawUrl);
  if (!ref) {
    return { ok: false, error: "Не похоже на ссылку Threads. Подойдёт пост threads.net или threads.com." };
  }

  if (ref.kind === "share") {
    const id = await resolveShare(ref.url);
    if (!id) {
      return {
        ok: false,
        error: "Не удалось раскрыть share-ссылку Threads. Откройте публикацию и скопируйте обычную ссылку.",
      };
    }
    ref = { id, url: canonicalThreadsUrl(id), kind: "post" };
  }

  const urls = [
    ref.username ? canonicalThreadsUrl(ref.id, ref.username) : "",
    ref.username ? `https://www.threads.net/@${ref.username}/post/${ref.id}` : "",
    canonicalThreadsUrl(ref.id),
    `https://www.threads.net/t/${ref.id}`,
  ].filter(Boolean);

  try {
    let media: Normalized | null = null;
    for (const url of urls) {
      try {
        const { res, text } = await fetchText(url, PAGE_HEADERS, 12_000);
        if (!res.ok || text.length < 1000) continue;
        media = extract(text, ref.id);
        if (media) break;
      } catch {
        /* next */
      }
    }
    if (!media) {
      return {
        ok: false,
        error: "Публикация скрыта, удалена или Threads не отдаёт её без входа.",
      };
    }
    if (media.thumbnail && !media.thumbnail.startsWith("data:")) {
      const inlined = await inlineThumbnail(media.thumbnail, STREAM_HEADERS);
      media.thumbnail = inlined.startsWith("data:") ? inlined : media.thumbnail;
    }
    return { ok: true, video: toInspect(media) };
  } catch {
    return { ok: false, error: "Threads не ответил. Проверьте ссылку и попробуйте ещё раз." };
  }
}

async function loadCachedFormat(
  id: string,
  presetId: string,
): Promise<{ title: string; format: DirectFormat } | null> {
  let entry = cache.get(id);
  if (!entry || !entry.formats.has(presetId)) {
    const refreshed = await inspect(canonicalThreadsUrl(id));
    if (!refreshed.ok) return null;
    entry = cache.get(id);
  }
  const format = entry?.formats.get(presetId);
  if (!entry || !format) return null;
  return { title: entry.title, format };
}

export async function getDownloadLink(id: string, presetId: string): Promise<DownloadLinkResult> {
  const loaded = await loadCachedFormat(id, presetId);
  if (!loaded) {
    return { ok: false, error: "Этот вариант больше недоступен. Обновите карточку публикации." };
  }
  return {
    ok: true,
    url: fileDownloadPath("threads", id, presetId),
    filename: `${safeFilename(loaded.title)}.${loaded.format.ext}`,
    mime: loaded.format.mime,
  };
}

export async function openThreadsStream(id: string, presetId: string): Promise<OpenStreamResult> {
  const loaded = await loadCachedFormat(id, presetId);
  if (!loaded) {
    return { ok: false, error: "Этот вариант больше недоступен. Обновите карточку публикации." };
  }
  return openDirectUrl(loaded.format, loaded.title);
}
