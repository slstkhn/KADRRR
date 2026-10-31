import { Innertube, Platform } from "youtubei.js";
import { fileDownloadPath } from "../media/disposition";
import { parseYouTubeId, watchUrl } from "./parse";
import { safeFilename } from "./format";
import { fetchProxiedStream } from "./stream-proxy.server";
import {
  isRemoteUrl,
  kindFromRemoteUrl,
  openRemoteYouTube,
  remoteFallbackPresets,
  remoteKindForPreset,
  type RemoteKind,
} from "./remote.server";
import type {
  DownloadLinkResult,
  InspectResult,
  MediaKind,
  VideoInspect,
  VideoPreset,
} from "./types";

type ClientName =
  | "DEFAULT"
  | "WEB"
  | "VISIONOS"
  | "ANDROID"
  | "MWEB"
  | "TV_SIMPLY"
  | "ANDROID_VR"
  | "IOS";

type StreamFormat = {
  itag: number;
  url?: string;
  mime_type: string;
  quality_label?: string;
  audio_quality?: string;
  content_length?: number;
  bitrate: number;
  height?: number;
  has_audio: boolean;
  has_video: boolean;
  has_text: boolean;
  decipher: (player?: unknown) => Promise<string>;
};

type CachedFormat = {
  url: string;
  mime: string;
  ext: string;
  itag: number;
};

type CacheEntry = {
  expires: number;
  title: string;
  formats: Map<string, CachedFormat>;
};

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 20 * 60 * 1000;
const CLIENTS: ClientName[] = [
  "DEFAULT",
  "VISIONOS",
  "WEB",
  "ANDROID",
  "MWEB",
  "TV_SIMPLY",
  "ANDROID_VR",
  "IOS",
];
const FAST_CLIENTS: ClientName[] = ["DEFAULT", "VISIONOS"];

let evalInstalled = false;
let clientPromise: Promise<Innertube> | null = null;

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

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

function installEval() {
  if (evalInstalled) return;
  evalInstalled = true;
  Platform.shim.eval = async (data) => {
    const result = new Function(data.output)() as Record<string, unknown> | undefined;
    return result ?? {};
  };
}

async function getClient(fresh = false): Promise<Innertube> {
  installEval();
  if (fresh) clientPromise = null;
  if (!clientPromise) {
    clientPromise = withTimeout(
      Innertube.create({ enable_safety_mode: false }),
      18_000,
      "Innertube timeout",
    ).catch((err: unknown) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

void getClient().catch(() => {
  /* warm the player on boot so the first inspect is faster */
});

function pickThumbnail(
  id: string,
  thumbs: Array<{ url: string; width: number }> | undefined,
): string {
  if (thumbs && thumbs.length > 0) {
    const sorted = [...thumbs].sort((a, b) => b.width - a.width);
    const url = sorted[0]?.url;
    if (url) return url;
  }
  return `https://i.ytimg.com/vi/${id}/hq720.jpg`;
}

function mimeExt(mime: string, kind: MediaKind): string {
  if (kind === "audio") {
    if (mime.includes("webm") || mime.includes("opus")) return "webm";
    return "m4a";
  }
  if (mime.includes("webm")) return "webm";
  return "mp4";
}

function qualityRank(label: string | undefined): number {
  if (!label) return 0;
  const n = Number.parseInt(label, 10);
  return Number.isFinite(n) ? n : 0;
}

async function resolveUrl(
  format: StreamFormat,
  player: unknown,
): Promise<string | null> {
  try {
    const url = await format.decipher(player);
    if (url && url.startsWith("http")) return url;
  } catch {
    /* fall through */
  }
  return format.url && format.url.startsWith("http") ? format.url : null;
}

function looksLikeBotWall(status?: string, reason?: string): boolean {
  const blob = `${status ?? ""} ${reason ?? ""}`.toLowerCase();
  return /bot|sign in to confirm|login_required|protect our community/.test(blob);
}

function restrictionMessage(status?: string, reason?: string): string | null {
  if (!status || status === "OK") return null;
  const blob = `${status} ${reason ?? ""}`.toLowerCase();
  if (looksLikeBotWall(status, reason) || status === "LOGIN_REQUIRED") {
    if (/inappropriate|age|возраст|18\+|взрослы/.test(blob)) {
      return "Ролик с ограничением по возрасту. Нажмите «Найти ещё раз» — иногда YouTube всё же отдаёт файл.";
    }
    return "YouTube временно скрыл файлы (проверка). Нажмите «Найти ещё раз».";
  }
  if (status === "UNPLAYABLE") {
    return "Ролик недоступен для скачивания.";
  }
  return "YouTube не отдаёт этот ролик.";
}

function selectFormats(all: StreamFormat[]): StreamFormat[] {
  const selected: StreamFormat[] = [];
  const used = new Set<number>();

  const take = (format: StreamFormat | undefined) => {
    if (!format || used.has(format.itag)) return;
    used.add(format.itag);
    selected.push(format);
  };

  const muxed = all
    .filter((f) => f.has_audio && f.has_video)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  for (const format of muxed.slice(0, 3)) take(format);

  const videos = all.filter((f) => f.has_video && !f.has_audio);
  const byQuality = new Map<string, StreamFormat[]>();
  for (const format of videos) {
    const q = format.quality_label ?? `${format.height ?? 0}p`;
    const list = byQuality.get(q) ?? [];
    list.push(format);
    byQuality.set(q, list);
  }

  const qualities = [...byQuality.keys()].sort((a, b) => qualityRank(b) - qualityRank(a));
  for (const q of qualities) {
    const group = byQuality.get(q) ?? [];
    take(
      group.find((f) => f.mime_type.includes("avc1") || f.mime_type.includes("mp4")) ??
        group[0],
    );
  }

  const audios = all
    .filter((f) => f.has_audio && !f.has_video && !f.has_text)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  take(audios.find((f) => f.mime_type.includes("mp4")) ?? audios[0]);

  return selected;
}

function buildPresets(formats: StreamFormat[]): VideoPreset[] {
  const presets: VideoPreset[] = [];
  const used = new Set<string>();

  const muxed = formats
    .filter((f) => f.has_audio && f.has_video)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  for (const f of muxed) {
    const q = f.quality_label ?? "360p";
    const id = `muxed-${f.itag}`;
    if (used.has(id)) continue;
    used.add(id);
    presets.push({
      id,
      itag: f.itag,
      label: `${q} со звуком`,
      kind: "muxed",
      ext: mimeExt(f.mime_type, "muxed"),
      mime: f.mime_type,
      hasAudio: true,
      hasVideo: true,
      qualityLabel: f.quality_label ?? q,
      sizeBytes: asNumber(f.content_length),
      note: "готовый файл, видео и звук",
    });
  }

  const videos = formats.filter((f) => f.has_video && !f.has_audio);
  const byQuality = new Map<string, StreamFormat[]>();
  for (const f of videos) {
    const q = f.quality_label ?? `${f.height ?? 0}p`;
    const list = byQuality.get(q) ?? [];
    list.push(f);
    byQuality.set(q, list);
  }

  const qualities = [...byQuality.keys()].sort(
    (a, b) => qualityRank(b) - qualityRank(a),
  );

  for (const q of qualities) {
    const group = byQuality.get(q) ?? [];
    const preferred =
      group.find((f) => f.mime_type.includes("avc1") || f.mime_type.includes("mp4")) ??
      group[0];
    if (!preferred) continue;
    const id = `video-${preferred.itag}`;
    if (used.has(id)) continue;
    used.add(id);
    presets.push({
      id,
      itag: preferred.itag,
      label: `${q} видео`,
      kind: "video",
      ext: mimeExt(preferred.mime_type, "video"),
      mime: preferred.mime_type,
      hasAudio: false,
      hasVideo: true,
      qualityLabel: q,
      sizeBytes: asNumber(preferred.content_length),
      note: "только картинка, без звука",
    });
  }

  const audios = formats
    .filter((f) => f.has_audio && !f.has_video && !f.has_text)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  const audio = audios.find((f) => f.mime_type.includes("mp4")) ?? audios[0];
  if (audio) {
    const id = `audio-${audio.itag}`;
    if (!used.has(id)) {
      used.add(id);
      presets.push({
        id,
        itag: audio.itag,
        label: "Только звук",
        kind: "audio",
        ext: mimeExt(audio.mime_type, "audio"),
        mime: audio.mime_type,
        hasAudio: true,
        hasVideo: false,
        qualityLabel: audio.audio_quality ?? "medium",
        sizeBytes: asNumber(audio.content_length),
        note: audio.mime_type.includes("mp4") ? "AAC / M4A" : "Opus / WebM",
      });
    }
  }

  return presets;
}

async function oembedFallback(id: string): Promise<{
  title: string;
  author: string;
  authorUrl: string | null;
  thumbnail: string;
} | null> {
  try {
    const res = await withTimeout(
      fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(id))}&format=json`,
      ),
      5000,
      "oembed timeout",
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      author_url?: string;
      thumbnail_url?: string;
    };
    return {
      title: data.title ?? "Ролик YouTube",
      author: data.author_name ?? "",
      authorUrl: data.author_url ?? null,
      thumbnail: data.thumbnail_url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  } catch {
    return null;
  }
}

type ProbeState = {
  bestFormats: StreamFormat[];
  title: string;
  author: string;
  authorUrl: string | null;
  durationSec: number | null;
  views: number | null;
  isLive: boolean;
  thumbs: Array<{ url: string; width: number }> | undefined;
  restriction: string | null;
};

function emptyProbe(): ProbeState {
  return {
    bestFormats: [],
    title: "",
    author: "",
    authorUrl: null,
    durationSec: null,
    views: null,
    isLive: false,
    thumbs: undefined,
    restriction: null,
  };
}

async function probeOne(
  yt: Innertube,
  id: string,
  client: ClientName,
): Promise<{
  info: Awaited<ReturnType<Innertube["getBasicInfo"]>>;
  resolved: StreamFormat[];
} | null> {
  try {
    const info = await withTimeout(
      client === "DEFAULT"
        ? yt.getBasicInfo(id)
        : yt.getBasicInfo(id, { client: client as Exclude<ClientName, "DEFAULT"> }),
      8_000,
      `${client} timeout`,
    );
    const all = [
      ...(info.streaming_data?.formats ?? []),
      ...(info.streaming_data?.adaptive_formats ?? []),
    ] as StreamFormat[];
    const picked = selectFormats(all);
    const toResolve = picked.length > 0 ? picked : all.slice(0, 8);
    const resolved: StreamFormat[] = [];
    for (const format of toResolve) {
      const url = await resolveUrl(format, yt.session.player);
      if (!url) continue;
      format.url = url;
      resolved.push(format);
    }
    return { info, resolved };
  } catch {
    return null;
  }
}

async function probeClients(
  yt: Innertube,
  id: string,
  clients: ClientName[],
  state: ProbeState,
): Promise<void> {
  for (const client of clients) {
    if (state.bestFormats.some((format) => format.has_audio && format.has_video)) {
      return;
    }
    const probed = await probeOne(yt, id, client);
    if (!probed) continue;
    const { info, resolved } = probed;
    const status = info.playability_status?.status;
    const reason = info.playability_status?.reason;
    if (status === "OK") {
      state.restriction = null;
    } else if (!state.restriction) {
      state.restriction = restrictionMessage(status, reason);
    }

    const basic = info.basic_info;
    state.title = basic.title || state.title;
    state.author = basic.author || basic.channel?.name || state.author;
    state.authorUrl = basic.channel?.url ?? state.authorUrl;
    state.durationSec = asNumber(basic.duration) ?? state.durationSec;
    state.views = asNumber(basic.view_count) ?? state.views;
    state.isLive = Boolean(basic.is_live || basic.is_live_content);
    state.thumbs = basic.thumbnail ?? state.thumbs;

    if (resolved.length > state.bestFormats.length) {
      state.bestFormats = resolved;
    }
  }
}

async function loadCachedFormat(
  videoId: string,
  presetId: string,
): Promise<{ title: string; format: CachedFormat } | null> {
  let entry = cache.get(videoId);
  if (!entry || entry.expires < Date.now() || !entry.formats.has(presetId)) {
    const refreshed = await inspect(watchUrl(videoId));
    if (!refreshed.ok) return null;
    entry = cache.get(videoId);
  }
  const format = entry?.formats.get(presetId);
  if (!entry || !format) return null;
  return { title: entry.title, format };
}

function cachePresets(
  formats: Map<string, CachedFormat>,
  presets: VideoPreset[],
  resolved: StreamFormat[],
) {
  for (const preset of presets) {
    const match = resolved.find((f) => f.itag === preset.itag && f.url);
    if (match?.url) {
      formats.set(preset.id, {
        url: match.url,
        mime: preset.mime,
        ext: preset.ext,
        itag: preset.itag,
      });
      continue;
    }
    const kind = remoteKindForPreset(preset.id, preset.qualityLabel, preset.kind);
    formats.set(preset.id, {
      url: `remote:${kind}`,
      mime: preset.mime,
      ext: preset.ext,
      itag: preset.itag,
    });
  }
}

export async function inspect(rawUrl: string): Promise<InspectResult> {
  const id = parseYouTubeId(rawUrl);
  if (!id) {
    return {
      ok: false,
      error: "Не похоже на ссылку YouTube. Вставьте watch, Shorts или youtu.be.",
    };
  }

  try {
    const state = emptyProbe();
    let yt = await getClient();
    await probeClients(yt, id, FAST_CLIENTS, state);

    if (
      !state.bestFormats.some((format) => format.has_audio && format.has_video) &&
      !state.title
    ) {
      const extra = CLIENTS.filter((client) => !FAST_CLIENTS.includes(client));
      await probeClients(yt, id, extra, state);
    }

    if (state.bestFormats.length === 0 && !state.title) {
      yt = await getClient(true);
      await probeClients(yt, id, FAST_CLIENTS, state);
    }

    if (!state.title) {
      const oem = await oembedFallback(id);
      if (oem) {
        state.title = oem.title;
        state.author = oem.author;
        state.authorUrl = oem.authorUrl;
        state.thumbs = [{ url: oem.thumbnail, width: 480 }];
      }
    }

    if (!state.title) {
      return { ok: false, error: "Ролик не найден или скрыт." };
    }

    if (state.isLive) {
      state.restriction =
        state.restriction ?? "Прямой эфир скачать нельзя — дождитесь записи.";
    }

    const thumbnail = pickThumbnail(id, state.thumbs);
    const innertubePresets = state.isLive ? [] : buildPresets(state.bestFormats);
    const hasMuxed = innertubePresets.some((preset) => preset.kind === "muxed");
    const basePresets = hasMuxed
      ? innertubePresets
      : state.isLive
        ? []
        : remoteFallbackPresets();

    const presets: VideoPreset[] = [...basePresets];
    if (presets.length > 0 && thumbnail) {
      presets.push({
        id: "cover",
        itag: 999,
        label: "Обложка",
        kind: "image",
        ext: "jpg",
        mime: "image/jpeg",
        hasAudio: false,
        hasVideo: false,
        qualityLabel: "HD",
        sizeBytes: null,
        note: "кадр-обложка ролика",
      });
    }
    const downloadable = presets.length > 0;

    const formats = new Map<string, CachedFormat>();
    cachePresets(formats, basePresets, state.bestFormats);
    if (presets.some((p) => p.id === "cover") && thumbnail) {
      formats.set("cover", {
        url: thumbnail,
        mime: "image/jpeg",
        ext: "jpg",
        itag: 999,
      });
    }

    cache.set(id, {
      expires: Date.now() + CACHE_TTL_MS,
      title: state.title,
      formats,
    });

    const video: VideoInspect = {
      id,
      source: "youtube",
      url: watchUrl(id),
      title: state.title,
      author: state.author,
      authorUrl: state.authorUrl,
      thumbnail,
      durationSec: state.durationSec,
      views: state.views,
      isLive: state.isLive,
      downloadable,
      restriction: downloadable
        ? null
        : (state.restriction ??
          (state.isLive
            ? "Прямой эфир скачать нельзя — дождитесь записи."
            : "Не удалось получить файлы этого ролика. Нажмите «Найти ещё раз».")),
      presets,
    };

    return { ok: true, video };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Неизвестная ошибка";
    if (/unavailable|not found|private/i.test(message)) {
      return { ok: false, error: "Ролик недоступен, удалён или скрыт." };
    }
    return {
      ok: false,
      error: "YouTube не ответил. Проверьте ссылку и попробуйте ещё раз.",
    };
  }
}

export async function getDownloadLink(
  videoId: string,
  presetId: string,
): Promise<DownloadLinkResult> {
  if (!parseYouTubeId(videoId)) {
    return { ok: false, error: "Некорректный идентификатор ролика." };
  }

  const loaded = await loadCachedFormat(videoId, presetId);
  if (!loaded) {
    return {
      ok: false,
      error: "Этот вариант больше недоступен. Обновите карточку ролика.",
    };
  }

  const suffix = presetId === "cover" ? "-cover" : "";
  const filename = `${safeFilename(loaded.title)}${suffix}.${loaded.format.ext}`;
  return {
    ok: true,
    url: fileDownloadPath("youtube", videoId, presetId),
    filename,
    mime: loaded.format.mime,
  };
}

async function openCachedStream(
  videoId: string,
  format: CachedFormat,
  kind: RemoteKind,
): Promise<Response | null> {
  if (format.url.startsWith("http")) {
    const proxied = await fetchProxiedStream(format.url);
    if (proxied) return proxied;
  }
  return openRemoteYouTube(videoId, kind);
}

export async function openYouTubeStream(
  videoId: string,
  presetId: string,
): Promise<
  | { ok: true; response: Response; filename: string; mime: string }
  | { ok: false; error: string }
> {
  if (!parseYouTubeId(videoId)) {
    return { ok: false, error: "Некорректный идентификатор ролика." };
  }
  const loaded = await loadCachedFormat(videoId, presetId);
  if (!loaded) {
    return {
      ok: false,
      error: "Этот вариант больше недоступен. Обновите карточку ролика.",
    };
  }
  if (presetId === "cover" && loaded.format.url.startsWith("http")) {
    try {
      const res = await fetch(loaded.format.url, { redirect: "follow" });
      if (res.ok && res.body) {
        return {
          ok: true,
          response: res,
          filename: `${safeFilename(loaded.title)}-cover.${loaded.format.ext}`,
          mime: loaded.format.mime,
        };
      }
    } catch {
      /* fall through */
    }
    return { ok: false, error: "Не удалось получить обложку ролика." };
  }
  const kind: RemoteKind = isRemoteUrl(loaded.format.url)
    ? kindFromRemoteUrl(loaded.format.url)
    : remoteKindForPreset(presetId, null, loaded.format.ext === "mp3" || loaded.format.ext === "m4a" ? "audio" : "muxed");
  const response = await openCachedStream(videoId, loaded.format, kind);
  if (!response) {
    return { ok: false, error: "Не удалось получить файл. Попробуйте ещё раз." };
  }
  const ext = kind === "mp3" && !loaded.format.url.startsWith("http") ? "mp3" : loaded.format.ext;
  const mime =
    kind === "mp3" && !loaded.format.url.startsWith("http")
      ? "audio/mpeg"
      : loaded.format.mime;
  return {
    ok: true,
    response,
    filename: `${safeFilename(loaded.title)}.${ext}`,
    mime,
  };
}
