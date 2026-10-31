import { safeFilename } from "../youtube/format";
import { fileDownloadPath } from "../media/disposition";
import type {
  DownloadLinkResult,
  InspectResult,
  VideoInspect,
  VideoPreset,
} from "../youtube/types";
import {
  canonicalInstagramUrl,
  instagramProfileUrl,
  parseInstagram,
  type InstagramKind,
  type InstagramRef,
} from "./parse";

type CachedFormat = {
  url: string;
  mime: string;
  ext: string;
};

type CacheEntry = {
  expires: number;
  title: string;
  formats: Map<string, CachedFormat>;
};

type MediaItem = {
  id: string;
  isVideo: boolean;
  videoUrl: string | null;
  imageUrl: string | null;
  width: number | null;
  height: number | null;
};

type NormalizedMedia = {
  shortcode: string;
  kind: InstagramKind;
  title: string;
  author: string;
  authorUrl: string | null;
  thumbnail: string;
  durationSec: number | null;
  views: number | null;
  items: MediaItem[];
};

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const DOC_IDS = ["27128499623469141", "10015901848480474"] as const;

function isBrandImageUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  if (url.startsWith("data:")) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase();
    if (host === "static.cdninstagram.com") return true;
    if (path.includes("rsrc.php")) return true;
    if (path.includes("/static/") || path.startsWith("/static")) return true;
    if (path.includes("favicon") || path.includes("glyph")) return true;
    if (host === "instagram.com" && path.includes("/accounts/login")) return true;
  } catch {
    return true;
  }
  return false;
}

function mediaPosterUrl(shortcode: string): string {
  return `https://www.instagram.com/p/${shortcode}/media/?size=l`;
}

function isBrandImageBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 24) return true;
  const png =
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!png) return false;
  const width =
    ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
  const height =
    ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
  if (width === height && width >= 64 && width <= 1024 && bytes.length <= 80_000) {
    return true;
  }
  return bytes.length <= 24_000;
}

function decodeHtml(value: string): string {
  const amp = String.fromCharCode(38);
  return value
    .split(`${amp}amp;`)
    .join(amp)
    .split(`${amp}quot;`)
    .join('"')
    .split(`${amp}#39;`)
    .join("'")
    .split(`${amp}#x27;`)
    .join("'")
    .split(`${amp}#X27;`)
    .join("'")
    .split(`${amp}lt;`)
    .join("<")
    .split(`${amp}gt;`)
    .join(">");
}

type IgSession = {
  csrf: string;
  cookie: string;
  lsd: string;
  expires: number;
};

let sessionPromise: Promise<IgSession> | null = null;

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function browserHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "user-agent": UA,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    ...extra,
  };
}

async function getSession(): Promise<IgSession> {
  if (sessionPromise) {
    const current = await sessionPromise.catch(() => null);
    if (current && current.expires > Date.now()) return current;
    sessionPromise = null;
  }

  sessionPromise = (async () => {
    const res = await withTimeout(
      fetch("https://www.instagram.com/", {
        headers: browserHeaders({
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
        }),
        redirect: "follow",
      }),
      8_000,
      "instagram session timeout",
    );
    const html = await res.text();
    const cookies =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : [res.headers.get("set-cookie") ?? ""];
    const cookieHeader = cookies
      .filter(Boolean)
      .map((c) => c.split(";")[0])
      .join("; ");
    const csrf =
      cookieHeader.match(/csrftoken=([^;]+)/)?.[1] ??
      html.match(/"csrf_token":"([^"]+)"/)?.[1] ??
      "";
    const lsd =
      html.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/)?.[1] ??
      html.match(/"LSD",\[\],\{"token":"([^"]+)"/)?.[1] ??
      "";
    return {
      csrf,
      cookie: cookieHeader,
      lsd,
      expires: Date.now() + 8 * 60 * 1000,
    };
  })().catch((err: unknown) => {
    sessionPromise = null;
    throw err;
  });

  return sessionPromise;
}

async function resolveShare(url: string): Promise<InstagramRef | null> {
  try {
    const res = await withTimeout(
      fetch(url, {
        headers: browserHeaders({
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
        }),
        redirect: "manual",
      }),
      8_000,
      "share redirect timeout",
    );
    const location = res.headers.get("location");
    if (location) {
      const next = new URL(location, url).href;
      const parsed = parseInstagram(next);
      if (parsed?.shortcode) return parsed;
      if (parsed?.kind === "share" && parsed.url !== url) {
        return resolveShare(parsed.url);
      }
    }
    const html = await res.text();
    const canonical =
      html.match(/rel="canonical"\s+href="([^"]+)"/i)?.[1] ??
      html.match(/property="og:url"\s+content="([^"]+)"/i)?.[1];
    if (canonical) {
      const parsed = parseInstagram(canonical);
      if (parsed?.shortcode) return parsed;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function parseContextJSON(escaped: string): unknown {
  try {
    const once = JSON.parse(`"${escaped}"`) as unknown;
    if (typeof once === "string") {
      try {
        return JSON.parse(once) as unknown;
      } catch {
        return once;
      }
    }
    return once;
  } catch {
    return null;
  }
}

function collectNodes(node: unknown, acc: Record<string, unknown>[] = [], depth = 0): Record<string, unknown>[] {
  if (!node || typeof node !== "object" || depth > 14) return acc;
  if (Array.isArray(node)) {
    for (const item of node) collectNodes(item, acc, depth + 1);
    return acc;
  }
  const rec = node as Record<string, unknown>;
  if (rec.shortcode_media && typeof rec.shortcode_media === "object") {
    acc.push(rec.shortcode_media as Record<string, unknown>);
  }
  const hasCode = typeof rec.shortcode === "string" || typeof rec.code === "string";
  const hasMedia =
    typeof rec.video_url === "string" ||
    typeof rec.display_url === "string" ||
    Array.isArray(rec.video_versions) ||
    (rec.image_versions2 && typeof rec.image_versions2 === "object") ||
    Array.isArray(rec.carousel_media);
  if (hasCode && hasMedia) acc.push(rec);
  if (rec.xdt_api__v1__media__shortcode__web_info && typeof rec.xdt_api__v1__media__shortcode__web_info === "object") {
    acc.push(rec.xdt_api__v1__media__shortcode__web_info as Record<string, unknown>);
  }
  const reelsMedia =
    rec.reels_media ??
    asRecord(rec.xdt_api__v1__feed__reels_media)?.reels_media;
  if (Array.isArray(reelsMedia) && reelsMedia[0] && typeof reelsMedia[0] === "object") {
    acc.push(reelsMedia[0] as Record<string, unknown>);
  }
  for (const value of Object.values(rec)) collectNodes(value, acc, depth + 1);
  return acc;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function captionFrom(node: Record<string, unknown>): string {
  const edges = asRecord(node.edge_media_to_caption)?.edges;
  if (Array.isArray(edges) && edges[0]) {
    const text = asString(asRecord(asRecord(edges[0])?.node)?.text);
    if (text) return text;
  }
  const caption = node.caption;
  if (typeof caption === "string") return caption;
  const nested = asString(asRecord(caption)?.text);
  return nested ?? "";
}

function ownerFrom(node: Record<string, unknown>): string {
  const owner = asRecord(node.owner) ?? asRecord(node.user);
  return asString(owner?.username) ?? asString(owner?.id) ?? "";
}

function largestCandidate(list: unknown): { url: string; width: number | null; height: number | null } | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  let best: { url: string; width: number; height: number | null } | null = null;
  for (const item of list) {
    const rec = asRecord(item);
    const url = asString(rec?.url) ?? asString(rec?.src);
    if (!url) continue;
    const width = asNumber(rec?.width) ?? asNumber(rec?.config_width) ?? 0;
    const height = asNumber(rec?.height) ?? asNumber(rec?.config_height);
    if (!best || width > best.width) best = { url, width, height };
  }
  return best ? { url: best.url, width: best.width || null, height: best.height } : null;
}

function itemFromNode(node: Record<string, unknown>, fallbackId: string): MediaItem | null {
  const versions = asRecord(node.image_versions2)?.candidates;
  const resources = node.display_resources;
  const rawImage =
    asString(node.display_url) ??
    asString(node.thumbnail_src) ??
    largestCandidate(versions)?.url ??
    largestCandidate(resources)?.url;
  const image = rawImage && !isBrandImageUrl(rawImage) ? rawImage : null;
  const video =
    asString(node.video_url) ??
    largestCandidate(node.video_versions)?.url;
  if (!video && !image) return null;
  const dims = asRecord(node.dimensions);
  const width =
    asNumber(dims?.width) ??
    largestCandidate(node.video_versions)?.width ??
    largestCandidate(versions)?.width;
  const height =
    asNumber(dims?.height) ??
    largestCandidate(node.video_versions)?.height ??
    largestCandidate(versions)?.height;
  const isVideo = Boolean(video) || node.is_video === true || asNumber(node.media_type) === 2;
  return {
    id: asString(node.id) ?? asString(node.pk) ?? asString(node.shortcode) ?? fallbackId,
    isVideo,
    videoUrl: video ?? null,
    imageUrl: image ?? null,
    width: width ?? null,
    height: height ?? null,
  };
}

function childrenFrom(node: Record<string, unknown>): Record<string, unknown>[] {
  const sidecar = asRecord(node.edge_sidecar_to_children)?.edges;
  if (Array.isArray(sidecar)) {
    return sidecar
      .map((edge) => asRecord(asRecord(edge)?.node))
      .filter((item): item is Record<string, unknown> => Boolean(item));
  }
  if (Array.isArray(node.carousel_media)) {
    return node.carousel_media
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
  }
  const webInfo = asRecord(node.xdt_api__v1__media__shortcode__web_info) ?? node;
  if (Array.isArray(webInfo.items) && webInfo.items[0]) {
    return childrenFrom(asRecord(webInfo.items[0]) ?? {});
  }
  return [];
}

function normalizeNode(node: Record<string, unknown>, fallback: InstagramRef): NormalizedMedia | null {
  const webInfo = asRecord(node.xdt_api__v1__media__shortcode__web_info);
  const root = webInfo && Array.isArray(webInfo.items) ? asRecord(webInfo.items[0]) ?? node : node;
  const shortcode =
    asString(root.shortcode) ?? asString(root.code) ?? fallback.shortcode ?? "";
  if (!shortcode) return null;

  const kids = childrenFrom(root);
  const items: MediaItem[] = [];
  if (kids.length > 0) {
    kids.forEach((child, index) => {
      const item = itemFromNode(child, `${shortcode}-${index + 1}`);
      if (item) items.push(item);
    });
  } else {
    const item = itemFromNode(root, shortcode);
    if (item) items.push(item);
  }
  if (items.length === 0) return null;

  const author = ownerFrom(root) || fallback.username || "";
  const caption = captionFrom(root).trim();
  const firstLine = caption.split("\n").map((line) => line.trim()).find(Boolean);
  const defaultTitle =
    fallback.kind === "stories"
      ? author
        ? `История @${author}`
        : "История Instagram"
      : author
        ? `Публикация @${author}`
        : "Публикация Instagram";
  const title = (firstLine || defaultTitle).slice(0, 140);
  const thumbnail = pickThumbnail(root, items);
  const duration = asNumber(root.video_duration);
  const views =
    asNumber(root.video_view_count) ??
    asNumber(root.video_play_count) ??
    asNumber(root.view_count) ??
    asNumber(root.play_count);

  let kind: InstagramKind = fallback.kind === "share" ? "p" : fallback.kind;
  const product = asString(root.product_type);
  if (fallback.kind !== "stories") {
    if (product === "clips") kind = "reel";
    else if (product === "igtv") kind = "tv";
    else if (product === "story") kind = "stories";
    else if (!items[0]?.isVideo) kind = "p";
  }

  return {
    shortcode,
    kind,
    title,
    author,
    authorUrl: author ? instagramProfileUrl(author) : null,
    thumbnail,
    durationSec: duration != null ? Math.round(duration) : items[0]?.isVideo ? null : null,
    views,
    items,
  };
}

function extractFromHtml(html: string, ref: InstagramRef): NormalizedMedia | null {
  const contexts: unknown[] = [];
  const re = /"contextJSON":"((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const parsed = parseContextJSON(match[1] ?? "");
    if (parsed) contexts.push(parsed);
  }

  const extra = html.match(/window\.__additionalDataLoaded\([^,]+,\s*(\{[\s\S]+?\})\);/);
  if (extra?.[1]) {
    try {
      contexts.push(JSON.parse(extra[1]) as unknown);
    } catch {
      /* ignore */
    }
  }

  const matches: NormalizedMedia[] = [];
  for (const ctx of contexts) {
    const nodes = collectNodes(ctx);
    for (const node of nodes) {
      const media = normalizeNode(node, ref);
      if (!media) continue;
      if (ref.shortcode && media.shortcode === ref.shortcode) return media;
      matches.push(media);
    }
  }
  if (matches[0]) return matches[0];

  const ogVideo = html.match(/property="og:video"\s+content="([^"]+)"/i)?.[1];
  const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1];
  const ogTitle = html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1];
  const videoTag = html.match(/<video[^>]+src="([^"]+)"/i)?.[1];
  const imgTag = html.match(/<img[^>]+class="[^"]*EmbeddedMediaImage[^"]*"[^>]+src="([^"]+)"/i)?.[1]
    ?? html.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*EmbeddedMediaImage[^"]*"/i)?.[1];
  const videoRaw = ogVideo || videoTag || null;
  const imageRaw = ogImage || imgTag || null;
  const video = videoRaw ? decodeHtml(videoRaw) : null;
  const image = imageRaw && !isBrandImageUrl(decodeHtml(imageRaw)) ? decodeHtml(imageRaw) : null;
  if (!video && !image) return null;
  if (!ref.shortcode) return null;

  const author = ogTitle?.match(/@([A-Za-z0-9._]+)/)?.[1] ?? ref.username ?? "";
  const fallbackCode = ref.shortcode ?? ref.storyId ?? "story";
  return {
    shortcode: fallbackCode,
    kind: ref.kind === "share" ? "p" : ref.kind,
    title:
      ref.kind === "stories"
        ? author
          ? `История @${author}`
          : "История Instagram"
        : author
          ? `Публикация @${author}`
          : "Публикация Instagram",
    author,
    authorUrl: author ? instagramProfileUrl(author) : null,
    thumbnail: image ?? "",
    durationSec: null,
    views: null,
    items: [
      {
        id: fallbackCode,
        isVideo: Boolean(video),
        videoUrl: video,
        imageUrl: image,
        width: null,
        height: null,
      },
    ],
  };
}

async function fetchStoryHtml(url: string): Promise<string | null> {
  try {
    const session = await getSession().catch(() => null);
    const res = await withTimeout(
      fetch(url, {
        headers: browserHeaders({
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
          ...(session?.cookie ? { cookie: session.cookie } : {}),
        }),
        redirect: "follow",
      }),
      12_000,
      "story page timeout",
    );
    if (!res.ok) return null;
    const html = await res.text();
    return html.length > 1_000 ? html : null;
  } catch {
    return null;
  }
}

async function fetchEmbed(shortcode: string): Promise<string | null> {
  const urls = [
    `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/reel/${shortcode}/embed/captioned/`,
    `https://www.instagram.com/p/${shortcode}/embed/`,
  ];
  for (const url of urls) {
    try {
      const res = await withTimeout(
        fetch(url, {
          headers: browserHeaders({
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "none",
          }),
          redirect: "follow",
        }),
        12_000,
        "embed timeout",
      );
      if (!res.ok) continue;
      const html = await res.text();
      if (html.length > 2_000) return html;
    } catch {
      /* next */
    }
  }
  return null;
}

async function fetchGraphql(shortcode: string): Promise<NormalizedMedia | null> {
  try {
    const session = await getSession();
    const variables = JSON.stringify({
      shortcode,
      __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
    });
    const endpoints = [
      "https://www.instagram.com/graphql/query",
      "https://www.instagram.com/api/graphql",
    ];
    for (const endpoint of endpoints) {
      for (const docId of DOC_IDS) {
        try {
          const body = new URLSearchParams({
            variables,
            doc_id: docId,
            server_timestamps: "true",
          });
          if (session.lsd) body.set("lsd", session.lsd);
          const res = await withTimeout(
            fetch(endpoint, {
              method: "POST",
              headers: {
                "user-agent": UA,
                accept: "*/*",
                "content-type": "application/x-www-form-urlencoded",
                origin: "https://www.instagram.com",
                referer: `https://www.instagram.com/p/${shortcode}/`,
                "x-csrftoken": session.csrf,
                "x-ig-app-id": "936619743392459",
                "x-asbd-id": "129477",
                "x-fb-friendly-name": "PolarisPostRootQuery",
                ...(session.lsd ? { "x-fb-lsd": session.lsd } : {}),
                ...(session.cookie ? { cookie: session.cookie } : {}),
                "sec-fetch-site": "same-origin",
                "sec-fetch-mode": "cors",
                "sec-fetch-dest": "empty",
              },
              body,
            }),
            10_000,
            "graphql timeout",
          );
          const text = await res.text();
          if (!text.trim().startsWith("{")) continue;
          const json = JSON.parse(text) as unknown;
          const nodes = collectNodes(json);
          let fallback: NormalizedMedia | null = null;
          for (const node of nodes) {
            const media = normalizeNode(node, {
              kind: "p",
              shortcode,
              url: canonicalInstagramUrl("p", shortcode),
            });
            if (!media) continue;
            if (media.shortcode === shortcode) return media;
            fallback ??= media;
          }
          if (fallback) return fallback;
        } catch {
          /* next combo */
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function pickClosestUrl(list: unknown, target = 480): string | null {
  if (!Array.isArray(list)) return null;
  let best: { url: string; score: number } | null = null;
  for (const item of list) {
    const rec = asRecord(item);
    const url = asString(rec?.src) ?? asString(rec?.url);
    if (!url) continue;
    const width = asNumber(rec?.config_width) ?? asNumber(rec?.width) ?? target;
    const score = Math.abs(width - target);
    if (!best || score < best.score) best = { url, score };
  }
  return best?.url ?? null;
}

function pickThumbnail(node: Record<string, unknown>, items: MediaItem[]): string {
  const candidates = [
    pickClosestUrl(node.display_resources),
    pickClosestUrl(asRecord(node.image_versions2)?.candidates),
    asString(node.thumbnail_src),
    items.find((item) => item.imageUrl && !isBrandImageUrl(item.imageUrl))?.imageUrl,
  ];
  return candidates.find((url) => url && !isBrandImageUrl(url)) ?? "";
}

async function inlineThumbnail(url: string): Promise<string> {
  if (!url || url.startsWith("data:")) return url;
  try {
    const res = await withTimeout(
      fetch(url, {
        headers: {
          "user-agent": UA,
          referer: "https://www.instagram.com/",
          accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
        redirect: "follow",
      }),
      5_000,
      "thumb timeout",
    );
    if (!res.ok) return url;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 32 || bytes.length > 500_000) return url;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return url;
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return url;
  }
}

function qualityLabel(item: MediaItem): string {
  if (item.height && item.height >= 100) return `${item.height}p`;
  if (item.width && item.width >= 100) return `${item.width}px`;
  return item.isVideo ? "HD" : "фото";
}

function extFromUrl(url: string, fallback: "mp4" | "jpg"): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".mp4") || path.includes(".mp4")) return "mp4";
    if (path.endsWith(".webp")) return "webp";
    if (path.endsWith(".png")) return "png";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "jpg";
  } catch {
    /* ignore */
  }
  return fallback;
}

function buildPresets(media: NormalizedMedia): { presets: VideoPreset[]; formats: Map<string, CachedFormat> } {
  const presets: VideoPreset[] = [];
  const formats = new Map<string, CachedFormat>();
  const many = media.items.length > 1;

  media.items.forEach((item, index) => {
    const n = index + 1;
    const slide = many ? `Слайд ${n} · ` : "";
    if (item.videoUrl) {
      const id = `ig-${media.shortcode}-v${n}`;
      const ext = extFromUrl(item.videoUrl, "mp4");
      const q = qualityLabel(item);
      presets.push({
        id,
        itag: n,
        label: `${slide}${q} со звуком`,
        kind: "muxed",
        ext,
        mime: ext === "mp4" ? "video/mp4" : `video/${ext}`,
        hasAudio: true,
        hasVideo: true,
        qualityLabel: q,
        sizeBytes: null,
        note: many ? "видео из карусели" : "готовый ролик, без водяного знака",
      });
      formats.set(id, { url: item.videoUrl, mime: ext === "mp4" ? "video/mp4" : `video/${ext}`, ext });
    }
    const coverUrl =
      item.imageUrl && !isBrandImageUrl(item.imageUrl)
        ? item.imageUrl
        : item.videoUrl && !many
          ? mediaPosterUrl(media.shortcode)
          : null;
    if (coverUrl) {
      const id = `ig-${media.shortcode}-i${n}`;
      const ext = extFromUrl(coverUrl, "jpg");
      const label = item.videoUrl
        ? `${slide}обложка`
        : `${slide}${qualityLabel(item)}`;
      presets.push({
        id,
        itag: n + 100,
        label,
        kind: "image",
        ext,
        mime: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg",
        hasAudio: false,
        hasVideo: false,
        qualityLabel: qualityLabel(item),
        sizeBytes: null,
        note: item.videoUrl ? "кадр-обложка" : many ? "фото из карусели" : "оригинал без водяного знака",
      });
      formats.set(id, {
        url: coverUrl,
        mime: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg",
        ext,
      });
    }
  });

  return { presets, formats };
}

function toInspect(media: NormalizedMedia, ref?: InstagramRef): VideoInspect {
  const { presets, formats } = buildPresets(media);
  cache.set(media.shortcode, {
    expires: Date.now() + CACHE_TTL_MS,
    title: media.title,
    formats,
  });
  return {
    id: media.shortcode,
    source: "instagram",
    url: canonicalInstagramUrl(
      media.kind,
      media.shortcode,
      media.author || ref?.username,
      ref?.storyId,
    ),
    title: media.title,
    author: media.author,
    authorUrl: media.authorUrl,
    thumbnail: media.thumbnail,
    durationSec: media.durationSec,
    views: media.views,
    isLive: false,
    downloadable: presets.length > 0,
    restriction: presets.length > 0 ? null : "Instagram не отдал файлы этой публикации.",
    presets,
  };
}

export async function inspect(rawUrl: string): Promise<InspectResult> {
  let ref = parseInstagram(rawUrl);
  if (!ref) {
    return {
      ok: false,
      error: "Не похоже на ссылку Instagram. Подойдёт история, Reel, пост, карусель или share-ссылка.",
    };
  }

  if (!ref.shortcode && (ref.kind === "share" || ref.kind === "stories")) {
    const resolved = await resolveShare(ref.url);
    if (resolved?.shortcode) {
      ref = {
        ...resolved,
        kind: ref.kind === "stories" ? "stories" : resolved.kind,
        username: ref.username ?? resolved.username,
        storyId: ref.storyId ?? resolved.storyId,
      };
    } else if (ref.kind === "share") {
      return {
        ok: false,
        error: "Не удалось раскрыть share-ссылку Instagram. Откройте публикацию и скопируйте обычную ссылку.",
      };
    }
  }

  if (!ref.shortcode && ref.kind === "stories") {
    try {
      const storyHtml = await fetchStoryHtml(ref.url);
      const fromStory = storyHtml ? extractFromHtml(storyHtml, ref) : null;
      if (fromStory && fromStory.items.length > 0) {
        return { ok: true, video: toInspect(fromStory, ref) };
      }
    } catch {
      /* fall through */
    }
    return {
      ok: false,
      error:
        "Укажите прямую ссылку на конкретную историю (вида instagram.com/stories/имя/ID_истории).",
    };
  }

  if (!ref.shortcode) {
    return { ok: false, error: "В ссылке Instagram нет кода публикации или истории." };
  }

  const shortcode = ref.shortcode;

  try {
    const html = await fetchEmbed(shortcode);
    let media = html ? extractFromHtml(html, ref) : null;
    const needsVideo = media?.items.some((item) => item.isVideo && !item.videoUrl);
    const needsPoster = media?.items.some(
      (item) => item.isVideo && isBrandImageUrl(item.imageUrl),
    );
    if (!media || needsVideo || needsPoster || media.items.length === 0) {
      const gql = await fetchGraphql(shortcode);
      if (gql) {
        media = {
          ...gql,
          kind: ref.kind === "stories" ? "stories" : gql.kind,
          title:
            ref.kind === "stories" && gql.title.startsWith("Публикация ")
              ? gql.title.replace(/^Публикация /, "История ")
              : gql.title,
        };
      }
    }
    if (!media && ref.kind === "stories") {
      const storyHtml = await fetchStoryHtml(ref.url);
      if (storyHtml) {
        media = extractFromHtml(storyHtml, ref);
      }
    }
    if (!media) {
      return {
        ok: false,
        error:
          "Публикация или история скрыта, удалена или истекла (24 часа). Откройте актуальную ссылку на публичную историю, Reel или пост.",
      };
    }
    if (isBrandImageUrl(media.thumbnail) && media.items.some((item) => item.videoUrl)) {
      media.thumbnail = mediaPosterUrl(shortcode);
    }
    if (media.thumbnail && !isBrandImageUrl(media.thumbnail)) {
      const inlined = await inlineThumbnail(media.thumbnail);
      media.thumbnail = inlined.startsWith("data:") ? inlined : "";
    } else {
      media.thumbnail = "";
    }
    return { ok: true, video: toInspect(media, ref) };
  } catch {
    return {
      ok: false,
      error: "Instagram не ответил. Проверьте ссылку и попробуйте ещё раз.",
    };
  }
}

export async function getDownloadLink(
  shortcode: string,
  presetId: string,
): Promise<DownloadLinkResult> {
  const loaded = await loadCachedFormat(shortcode, presetId);
  if (!loaded) {
    return {
      ok: false,
      error: "Этот вариант больше недоступен. Обновите карточку публикации.",
    };
  }

  const filename = `${safeFilename(loaded.title)}.${loaded.format.ext}`;
  return {
    ok: true,
    url: fileDownloadPath("instagram", shortcode, presetId),
    filename,
    mime: loaded.format.mime,
  };
}

const IG_STREAM_HEADERS: Record<string, string> = {
  "user-agent": UA,
  accept: "*/*",
  referer: "https://www.instagram.com/",
};

async function loadCachedFormat(
  shortcode: string,
  presetId: string,
): Promise<{ title: string; format: CachedFormat } | null> {
  if (!shortcode) return null;
  let entry = cache.get(shortcode);
  if (!entry || entry.expires < Date.now() || !entry.formats.has(presetId)) {
    const refreshed = await inspect(canonicalInstagramUrl("p", shortcode));
    if (!refreshed.ok) return null;
    entry = cache.get(shortcode);
  }
  const format = entry?.formats.get(presetId);
  if (!entry || !format) return null;
  return { title: entry.title, format };
}

export async function openInstagramStream(
  shortcode: string,
  presetId: string,
): Promise<
  | { ok: true; response: Response; filename: string; mime: string }
  | { ok: false; error: string }
> {
  const loaded = await loadCachedFormat(shortcode, presetId);
  if (!loaded) {
    return {
      ok: false,
      error: "Этот вариант больше недоступен. Обновите карточку публикации.",
    };
  }
  const isImage = loaded.format.mime.startsWith("image/");
  try {
    const response = await withTimeout(
      fetch(loaded.format.url, {
        headers: IG_STREAM_HEADERS,
        redirect: "follow",
      }),
      25_000,
      "instagram file timeout",
    );
    if (!response.ok || !response.body) {
      if (isImage) {
        const poster = await fetchPoster(shortcode, loaded.title);
        if (poster) return poster;
      }
      return { ok: false, error: "Не удалось получить файл. Попробуйте ещё раз." };
    }
    if (!isImage) {
      return {
        ok: true,
        response,
        filename: `${safeFilename(loaded.title)}.${loaded.format.ext}`,
        mime: loaded.format.mime,
      };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!isBrandImageBytes(bytes) && !isBrandImageUrl(loaded.format.url)) {
      return {
        ok: true,
        response: new Response(bytes),
        filename: `${safeFilename(loaded.title)}.${loaded.format.ext}`,
        mime: loaded.format.mime,
      };
    }
    const poster = await fetchPoster(shortcode, loaded.title);
    if (poster) return poster;
    if (isBrandImageBytes(bytes)) {
      return { ok: false, error: "Instagram отдал заглушку вместо обложки. Обновите карточку и попробуйте ещё раз." };
    }
    return {
      ok: true,
      response: new Response(bytes),
      filename: `${safeFilename(loaded.title)}.${loaded.format.ext}`,
      mime: loaded.format.mime,
    };
  } catch {
    if (isImage) {
      const poster = await fetchPoster(shortcode, loaded.title).catch(() => null);
      if (poster) return poster;
    }
    return { ok: false, error: "Не удалось получить файл. Попробуйте ещё раз." };
  }
}

async function fetchPoster(
  shortcode: string,
  title: string,
): Promise<{ ok: true; response: Response; filename: string; mime: string } | null> {
  try {
    const response = await withTimeout(
      fetch(mediaPosterUrl(shortcode), {
        headers: IG_STREAM_HEADERS,
        redirect: "follow",
      }),
      12_000,
      "poster timeout",
    );
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 32 || isBrandImageBytes(bytes)) return null;
    const type = response.headers.get("content-type") ?? "image/jpeg";
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    return {
      ok: true,
      response: new Response(bytes),
      filename: `${safeFilename(title)}.${ext}`,
      mime: type.startsWith("image/") ? type : "image/jpeg",
    };
  } catch {
    return null;
  }
}
