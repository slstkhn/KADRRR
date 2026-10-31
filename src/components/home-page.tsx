import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Check,
  Clipboard,
  Clock3,
  Copy,
  Download,
  Eraser,
  Eye,
  Film,
  FolderDown,
  Image as ImageIcon,
  LoaderCircle,
  Music,
  Volume2,
  VolumeX,
} from "lucide-react";
import { toast } from "sonner";
import { AccountSlot } from "@/components/account-slot";
import { ChatWidget } from "@/components/chat-widget";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KadrMark } from "@/components/kadr-mark";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  clearHistory,
  loadHistory,
  persistableThumbnail,
  pushHistory,
  type HistoryItem,
} from "@/lib/history";
import {
  clearHistoryItems,
  listHistory as fetchHistory,
  saveHistoryItem,
  syncHistory,
} from "@/lib/history-store";
import { canonicalUrl, detectMedia, openOnLabel, sourceLabel } from "@/lib/media/source";
import { formatBytes, formatDuration, formatViews } from "@/lib/youtube/format";
import { inspectVideo, requestDownloadLink } from "@/lib/youtube/inspect";
import { thumbnailUrl } from "@/lib/youtube/parse";
import {
  loadLastInspect,
  saveLastInspect,
} from "@/lib/youtube/last-session";
import type { MediaSource, VideoInspect, VideoPreset } from "@/lib/youtube/types";

const SAMPLE_YT = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const SAMPLE_VM = "https://vimeo.com/76979871";
const SAMPLE_IG = "https://www.instagram.com/reel/Cuw1zIWAo5i/";
const SAMPLE_IG_STORY =
  "https://www.instagram.com/stories/instagram/3148252749649579618/";
const SAMPLE_X = "https://x.com/elonmusk/status/1349129669258448897";
const SAMPLE_TT = "https://www.tiktok.com/@scout2015/video/6718335390845095173";
const SAMPLE_TH = "https://www.threads.net/@zuck/post/DcwLClnmOrR";
const SAMPLE_RT = "https://rutube.ru/video/d7735d2c10b588f0376eb754483fd943/";

const HANDLE_SOURCES = new Set<MediaSource>(["instagram", "x", "threads", "tiktok"]);

function selectBulkPresets(video: VideoInspect): VideoPreset[] {
  if (
    video.source === "youtube" ||
    video.source === "vimeo" ||
    video.source === "rutube"
  ) {
    const muxed = video.presets.filter((p) => p.kind === "muxed");
    const videos = video.presets.filter((p) => p.kind === "video");
    const audios = video.presets.filter((p) => p.kind === "audio");
    const images = video.presets.filter((p) => p.kind === "image");

    const selected: VideoPreset[] = [];
    const bestVideo = muxed[0] ?? videos[0];
    if (bestVideo) {
      selected.push(bestVideo);
      if (!bestVideo.hasAudio && audios[0]) {
        selected.push(audios[0]);
      }
    } else if (audios[0]) {
      selected.push(audios[0]);
    }
    selected.push(...images);
    return selected;
  }

  return video.presets;
}

function optimisticVideo(id: string, source: MediaSource): VideoInspect {
  return {
    id,
    source,
    url: canonicalUrl(source, id),
    title: "Загружаем карточку…",
    author: "",
    authorUrl: null,
    thumbnail: source === "youtube" ? thumbnailUrl(id) : "",
    durationSec: null,
    views: null,
    isLive: false,
    downloadable: false,
    restriction: null,
    presets: [],
  };
}

function historyHref(item: HistoryItem): string {
  if (item.url) return item.url;
  return canonicalUrl(item.source ?? "youtube", item.id);
}

function asStoredItem(video: VideoInspect) {
  return {
    id: video.id,
    source: video.source,
    url: video.url,
    title: video.title,
    author: video.author,
    thumbnail: persistableThumbnail(video.thumbnail),
    durationSec: video.durationSec,
  };
}

function toSyncItem(item: HistoryItem) {
  const source = (item.source ?? "youtube") as MediaSource;
  return {
    id: item.id,
    source,
    url: item.url ?? canonicalUrl(source, item.id),
    title: item.title.slice(0, 200) || "Публикация",
    author: item.author ?? "",
    thumbnail: persistableThumbnail(item.thumbnail),
    durationSec: item.durationSec,
    savedAt: item.savedAt,
  };
}

async function inspectWithRetry(url: string) {
  const run = () =>
    Promise.race([
      inspectVideo({ data: { url } }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), 28_000);
      }),
    ]);
  try {
    return await run();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return await run();
  }
}

const SAMPLES: { label: string; url: string }[] = [
  { label: "YouTube", url: SAMPLE_YT },
  { label: "Vimeo", url: SAMPLE_VM },
  { label: "Instagram", url: SAMPLE_IG },
  { label: "IG История", url: SAMPLE_IG_STORY },
  { label: "X", url: SAMPLE_X },
  { label: "TikTok", url: SAMPLE_TT },
  { label: "Threads", url: SAMPLE_TH },
  { label: "RuTube", url: SAMPLE_RT },
];

const HERO_WORDS = ["видео", "аудио", "фото", "историю"] as const;

export function HomePage() {
  const { user, isPending } = useCurrentUserState();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [video, setVideo] = useState<VideoInspect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [pendingPreset, setPendingPreset] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [heroPlayed, setHeroPlayed] = useState(false);
  const [wordIndex, setWordIndex] = useState(0);
  const requestSeq = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setWordIndex((prev) => (prev + 1) % HERO_WORDS.length);
    }, 2200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const cached = loadLastInspect();
    if (cached) {
      setUrl(cached.url);
      setVideo(cached.video);
      setStatus("ready");
      setHeroPlayed(true);
    }
  }, []);

  useEffect(() => {
    if (isPending) return;
    let cancelled = false;

    async function load() {
      const local = loadHistory();
      if (!user) {
        if (!cancelled) setHistory(local);
        return;
      }
      try {
        const payload = local.map(toSyncItem);
        const next =
          payload.length > 0
            ? await syncHistory({ data: payload })
            : await fetchHistory();
        if (!cancelled) setHistory(next);
      } catch {
        if (!cancelled) setHistory(local);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user, isPending]);

  async function inspect(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      setError("Вставьте ссылку на ролик.");
      setStatus("error");
      return;
    }
    const detected = detectMedia(trimmed);
    if (!detected) {
      setError(
        "Не похоже на ссылку YouTube, Vimeo, Instagram, X, Threads, TikTok или RuTube. Подойдёт watch, Shorts, история, Reel, пост, ролик или видео.",
      );
      setStatus("error");
      return;
    }

    const source = detected.source;
    const canonical = detected.url;
    const id = detected.id || "media";
    const seq = ++requestSeq.current;
    setUrl(canonical);
    setError(null);
    setStatus("loading");
    setVideo((prev) =>
      prev?.id === id && prev.source === source && prev.presets.length > 0
        ? prev
        : optimisticVideo(id, source),
    );

    try {
      const result = await inspectWithRetry(canonical);
      if (seq !== requestSeq.current) return;
      if (!result.ok) {
        setError(result.error);
        setStatus("error");
        setVideo((prev) => (prev?.presets.length ? prev : null));
        return;
      }
      setVideo(result.video);
      setUrl(result.video.url);
      setStatus("ready");
      if (result.video.presets.length > 0) {
        saveLastInspect({ url: result.video.url, video: result.video });
      }
      const stored = asStoredItem(result.video);
      const local = pushHistory(stored);
      setHistory(local);
      if (user) {
        try {
          const remote = await saveHistoryItem({ data: stored });
          if (seq === requestSeq.current) setHistory(remote);
        } catch {
          /* keep local copy */
        }
      }
    } catch {
      if (seq !== requestSeq.current) return;
      setError("Не получилось связаться с сервером. Попробуйте ещё раз.");
      setStatus("error");
      setVideo((prev) => (prev?.presets.length ? prev : null));
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast("Буфер пуст");
        return;
      }
      setUrl(text.trim());
      await inspect(text);
    } catch {
      toast("Нет доступа к буферу — вставьте ссылку вручную");
    }
  }

  async function triggerSinglePresetDownload(
    targetVideo: VideoInspect,
    preset: VideoPreset,
    silent = false,
  ): Promise<boolean> {
    const result = await requestDownloadLink({
      data: {
        source: targetVideo.source,
        videoId: targetVideo.id,
        presetId: preset.id,
      },
    });
    if (!result.ok) {
      if (!silent) toast.error(result.error);
      return false;
    }
    const a = document.createElement("a");
    a.href = result.url;
    a.download = result.filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (!silent) {
      toast.success("Файл уходит в загрузки.");
    }
    return true;
  }

  async function startDownload(preset: VideoPreset) {
    if (!video || bulkProgress) return;
    setPendingPreset(preset.id);
    try {
      await triggerSinglePresetDownload(video, preset, false);
    } catch {
      toast.error("Не удалось получить ссылку на файл.");
    } finally {
      setPendingPreset(null);
    }
  }

  async function startDownloadAll() {
    if (!video || bulkProgress || pendingPreset) return;
    const targets = selectBulkPresets(video);
    if (targets.length === 0) return;

    if (targets.length === 1) {
      await startDownload(targets[0]);
      return;
    }

    setBulkProgress({ current: 1, total: targets.length });
    let completed = 0;

    try {
      for (let i = 0; i < targets.length; i++) {
        const preset = targets[i];
        setBulkProgress({ current: i + 1, total: targets.length });
        setPendingPreset(preset.id);
        const ok = await triggerSinglePresetDownload(video, preset, true);
        if (ok) completed += 1;
        if (i < targets.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 450));
        }
      }
      if (completed > 0) {
        toast.success(`Отправлено в загрузки: ${completed} из ${targets.length}`);
      } else {
        toast.error("Не удалось скачать файлы.");
      }
    } catch {
      toast.error("Произошла ошибка при пакетном скачивании.");
    } finally {
      setPendingPreset(null);
      setBulkProgress(null);
    }
  }

  async function wipeHistory() {
    setHistory(clearHistory());
    if (!user) return;
    try {
      setHistory(await clearHistoryItems());
    } catch {
      toast.error("Не получилось очистить историю в аккаунте.");
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    void inspect(url);
  }

  const muxed = video?.presets.filter((p) => p.kind === "muxed") ?? [];
  const videos = video?.presets.filter((p) => p.kind === "video") ?? [];
  const audios = video?.presets.filter((p) => p.kind === "audio") ?? [];
  const images = video?.presets.filter((p) => p.kind === "image") ?? [];
  const loading = status === "loading";
  const loadingSource = video?.source ?? detectMedia(url)?.source ?? "youtube";

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <div aria-hidden="true" className="hero-wash pointer-events-none absolute inset-x-0 top-0 h-72" />
      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-5 pt-6 pb-2 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <KadrMark className="size-9 shrink-0" />
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold tracking-display text-foreground">
              KADR
            </p>
            <p className="truncate text-xs text-muted-foreground">
              видео с твоих любимых сайтов
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <AccountSlot />
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-5xl px-5 pb-24 sm:px-8">
        <section
          className={`mx-auto max-w-2xl pt-10 text-center sm:pt-16 ${heroPlayed ? "" : "hero-stagger"}`}
        >
          <h1 className="font-display text-4xl leading-tight font-semibold tracking-display text-foreground sm:text-6xl">
            Сохрани{" "}
            <span
              key={HERO_WORDS[wordIndex]}
              className="inline-block rounded-xl border border-border bg-surface-2 px-3 py-0.5 italic text-foreground shadow-[var(--shadow-border)] animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
              {HERO_WORDS[wordIndex]}
            </span>{" "}
            себе
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-muted-foreground">
            KADR помогает сохранять что угодно с твоих любимых сайтов: видео,
            истории, аудио, фото или гифки. просто вставь ссылку и вперёд!
          </p>
        </section>

        <form
          className="mx-auto mt-10 max-w-2xl"
          method="dialog"
          action="#"
          noValidate
          onSubmit={onSubmit}
        >
          <div className="rounded-2xl border border-border bg-surface p-2 shadow-[var(--shadow-border)]">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-1.5">
              <div className="flex min-w-0 flex-1 items-stretch">
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="youtube, vimeo, instagram (пост, reel, история), x.com, tiktok, threads, rutube…"
                  inputMode="url"
                  enterKeyHint="search"
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Ссылка на ролик"
                  className="h-12 min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => void pasteFromClipboard()}
                  aria-label="Вставить из буфера"
                >
                  <Clipboard />
                </Button>
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="h-12 w-full shrink-0 sm:w-auto sm:px-5"
              >
                {loading ? (
                  <>
                    <LoaderCircle className="animate-spin" />
                    Ищем
                  </>
                ) : (
                  "Найти"
                )}
              </Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            {SAMPLES.map((sample) => (
              <button
                key={sample.label}
                type="button"
                className="h-11 rounded-full px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors duration-[var(--motion-quick)] hover:text-foreground"
                onClick={() => {
                  setUrl(sample.url);
                  void inspect(sample.url);
                }}
              >
                {sample.label}
              </button>
            ))}
          </div>
        </form>

        {loading ? (
          <p className="mx-auto mt-4 max-w-xl text-center text-sm text-muted-foreground">
            Достаём карточку с {sourceLabel(loadingSource)}…
          </p>
        ) : null}

        {status === "error" && error ? (
          <p
            role="alert"
            className="mx-auto mt-6 max-w-xl text-center text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        {video ? (
          <ResultCard
            video={video}
            muxed={muxed}
            videos={videos}
            audios={audios}
            images={images}
            pendingPreset={pendingPreset}
            bulkProgress={bulkProgress}
            loading={loading}
            onDownload={startDownload}
            onDownloadAll={() => void startDownloadAll()}
            onRetry={() => void inspect(video.url)}
          />
        ) : null}

        <section className="mt-16">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold tracking-display">
                История
              </h2>
              <p className="text-sm text-muted-foreground">
                {user
                  ? "Сохраняется в аккаунте"
                  : "Войдите, чтобы история не пропала с другого устройства"}
              </p>
            </div>
            {history.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void wipeHistory()}
              >
                <Eraser />
                Очистить
              </Button>
            ) : null}
          </div>
          {history.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {user ? (
                "Здесь появятся ролики, которые вы уже разбирали."
              ) : (
                <>
                  Разберите ссылку — она останется здесь. Чтобы не потерять список,{" "}
                  <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
                    войдите
                  </Link>
                  .
                </>
              )}
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {history.map((item) => (
                <li key={`${item.source ?? "youtube"}:${item.id}`}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-2 text-left shadow-[var(--shadow-border)] transition-[box-shadow] duration-[var(--motion-quick)] hover:shadow-[var(--shadow-border-hover)]"
                    onClick={() => {
                      const next = historyHref(item);
                      setUrl(next);
                      void inspect(next);
                    }}
                  >
                    {item.thumbnail ? (
                      <img
                        src={item.thumbnail}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="size-14 shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-foreground/10"
                      />
                    ) : (
                      <span className="bg-surface-2 size-14 shrink-0 rounded-md" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-sm font-medium text-foreground">
                        {item.title}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate">
                          {sourceLabel(item.source)}
                          {item.author ? ` · ${item.author}` : ""}
                        </span>
                        <span className="tabular-nums">
                          {formatDuration(item.durationSec)}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-16 border-t border-border pt-6 text-sm leading-relaxed text-muted-foreground">
          <p>
            Скачивайте только ролики, на которые у вас есть права: свои публикации,
            материалы с открытой лицензией или с разрешения автора. KADR не связан с
            YouTube, Vimeo, Instagram, X, Threads, TikTok и RuTube и не обходит защиту авторских прав.
          </p>
        </footer>
      </main>

      <ChatWidget video={video} />
    </div>
  );
}

function ResultCard({
  video,
  muxed,
  videos,
  audios,
  images,
  pendingPreset,
  bulkProgress,
  loading,
  onDownload,
  onDownloadAll,
  onRetry,
}: {
  video: VideoInspect;
  muxed: VideoPreset[];
  videos: VideoPreset[];
  audios: VideoPreset[];
  images: VideoPreset[];
  pendingPreset: string | null;
  bulkProgress: { current: number; total: number } | null;
  loading: boolean;
  onDownload: (preset: VideoPreset) => void;
  onDownloadAll: () => void;
  onRetry: () => void;
}) {
  const groups = useMemo(() => {
    if (
      video.source !== "youtube" &&
      video.source !== "vimeo" &&
      video.source !== "rutube"
    ) {
      return [
        {
          title: video.presets.length > 1 ? "Файлы публикации" : "Файл",
          items: video.presets,
          icon: video.presets.every((p) => p.kind === "image") ? ImageIcon : Film,
        },
      ].filter((group) => group.items.length > 0);
    }
    return [
      { title: "Видео со звуком", items: muxed, icon: Volume2 },
      { title: "Только видео", items: videos, icon: VolumeX },
      { title: "Звук", items: audios, icon: Music },
      { title: "Фото и обложка", items: images, icon: ImageIcon },
    ].filter((group) => group.items.length > 0);
  }, [video, muxed, videos, audios, images]);

  const bulkPresets = useMemo(() => selectBulkPresets(video), [video]);

  const bulkSummary = useMemo(() => {
    const labels = bulkPresets.map((p) => {
      if (p.kind === "image") return "обложка";
      if (p.kind === "audio") return "звук";
      return `видео ${p.qualityLabel}`;
    });
    return labels.join(" + ");
  }, [bulkPresets]);

  const openLabel = openOnLabel(video.source);
  const author =
    video.author && HANDLE_SOURCES.has(video.source)
      ? `@${video.author.replace(/^@/, "")}`
      : video.author;
  const [copied, setCopied] = useState(false);

  async function copyResultUrl() {
    try {
      await navigator.clipboard.writeText(video.url);
      setCopied(true);
      toast.success("Ссылка скопирована в буфер обмена.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = video.url;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
        setCopied(true);
        toast.success("Ссылка скопирована в буфер обмена.");
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast.error("Не удалось скопировать ссылку.");
      }
    }
  }

  return (
    <article className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-border)]">
      <div className="grid sm:grid-cols-[240px_1fr]">
        <div className="relative">
          <div className="sprocket absolute inset-y-3 left-0 w-2.5 rounded-full" />
          {video.thumbnail ? (
            <img
              src={video.thumbnail}
              alt=""
              referrerPolicy="no-referrer"
              className="aspect-video h-full w-full object-cover sm:aspect-auto"
              onError={(event) => {
                const img = event.currentTarget;
                if (video.source !== "youtube") {
                  img.style.display = "none";
                  return;
                }
                const fallback = thumbnailUrl(video.id, "hqdefault");
                if (img.src !== fallback) img.src = fallback;
              }}
            />
          ) : (
            <div className="bg-surface-2 aspect-video h-full w-full sm:aspect-auto sm:min-h-40" />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-4 p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                <Film className="mr-1 size-3" />
                {sourceLabel(video.source)}
              </Badge>
              <Badge variant="outline">{video.id}</Badge>
              {video.isLive ? <Badge>эфир</Badge> : null}
            </div>
            <h2 className="mt-3 font-display text-xl leading-snug font-semibold tracking-display text-foreground">
              {video.title}
            </h2>
            {author ? (
              <p className="mt-1 text-sm text-muted-foreground">{author}</p>
            ) : loading ? (
              <Skeleton className="mt-2 h-4 w-32" />
            ) : null}
            <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Clock3 className="size-3.5" />
                <span className="tabular-nums">{formatDuration(video.durationSec)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Eye className="size-3.5" />
                <span className="tabular-nums">{formatViews(video.views)}</span>
              </div>
            </dl>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={video.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {openLabel}
              <ArrowUpRight className="size-3.5" />
            </a>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11"
              onClick={() => void copyResultUrl()}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              Скопировать ссылку на результат
            </Button>
          </div>
        </div>
      </div>

      <div className="border-t border-border p-5">
        {loading && video.presets.length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-2/3 rounded-xl" />
          </div>
        ) : !video.downloadable ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {video.restriction ?? "Для этой публикации файлы недоступны."}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 shrink-0"
              disabled={loading}
              onClick={onRetry}
            >
              Найти ещё раз
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {bulkPresets.length > 1 ? (
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Полный комплект ({bulkPresets.length} файла)
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {bulkSummary}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="h-10 shrink-0"
                  disabled={pendingPreset !== null || bulkProgress !== null || loading}
                  onClick={onDownloadAll}
                >
                  {bulkProgress ? (
                    <>
                      <LoaderCircle className="animate-spin" />
                      Скачиваем {bulkProgress.current} из {bulkProgress.total}…
                    </>
                  ) : (
                    <>
                      <FolderDown />
                      Скачать всё сразу
                    </>
                  )}
                </Button>
              </div>
            ) : null}

            {groups.map((group) => (
              <div key={group.title}>
                <p className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  <group.icon className="size-3.5" />
                  {group.title}
                </p>
                <ul className="space-y-2">
                  {group.items.map((preset) => (
                    <li key={preset.id}>
                      <PresetRow
                        preset={preset}
                        busy={pendingPreset === preset.id}
                        disabled={
                          pendingPreset !== null || bulkProgress !== null || loading
                        }
                        onDownload={() => onDownload(preset)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {(video.source === "youtube" || video.source === "vimeo") &&
            videos.length > 0 &&
            muxed.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Потоки высокого разрешения отдаются раздельно. Скачайте видео и
                аудиодорожку отдельно или нажмите «Скачать всё сразу».
              </p>
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
}

function PresetRow({
  preset,
  busy,
  disabled,
  onDownload,
}: {
  preset: VideoPreset;
  busy: boolean;
  disabled: boolean;
  onDownload: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{preset.label}</p>
        <p className="truncate text-xs text-muted-foreground">
          {preset.ext.toUpperCase()} · {formatBytes(preset.sizeBytes)} · {preset.note}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        className="shrink-0"
        disabled={disabled}
        onClick={onDownload}
      >
        {busy ? <LoaderCircle className="animate-spin" /> : <Download />}
        {busy ? "Секунда" : "Скачать"}
      </Button>
    </div>
  );
}
