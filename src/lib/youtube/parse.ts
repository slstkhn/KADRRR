const ID_RE = /^[a-zA-Z0-9_-]{11}$/;

const HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
  "www.youtube.com",
  "www.youtube-nocookie.com",
]);

const EMBEDDED_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:music\.)?(?:m\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/[^\s<>"'`]+/i;

export function isYouTubeId(value: string | null | undefined): boolean {
  return typeof value === "string" && ID_RE.test(value);
}

export function normalizeYouTubeInput(input: string): string {
  return input.replace(/[\u200b-\u200d\ufeff]/g, "").trim();
}

export function parseYouTubeId(input: string): string | null {
  const trimmed = normalizeYouTubeInput(input);
  if (!trimmed) return null;
  if (isYouTubeId(trimmed)) return trimmed;

  const direct = parseFromCandidate(trimmed);
  if (direct) return direct;

  const embedded = trimmed.match(EMBEDDED_URL_RE);
  if (embedded?.[0]) {
    const fromEmbed = parseFromCandidate(embedded[0]);
    if (fromEmbed) return fromEmbed;
  }

  return null;
}

function parseFromCandidate(trimmed: string): string | null {
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  if (!HOSTS.has(host) && !HOSTS.has(url.hostname)) return null;

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return isYouTubeId(id) ? id : null;
  }

  const direct = url.searchParams.get("v");
  if (isYouTubeId(direct)) return direct;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && ["shorts", "embed", "live", "v", "e"].includes(parts[0] ?? "")) {
    const id = parts[1] ?? "";
    if (isYouTubeId(id)) return id;
  }

  if (parts[0] && isYouTubeId(parts[0])) return parts[0];

  return null;
}

export function watchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function thumbnailUrl(id: string, kind: "hq720" | "hqdefault" = "hq720"): string {
  return `https://i.ytimg.com/vi/${id}/${kind}.jpg`;
}
