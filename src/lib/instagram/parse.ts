const HOSTS = new Set([
  "instagram.com",
  "www.instagram.com",
  "m.instagram.com",
  "www.m.instagram.com",
  "instagr.am",
  "www.instagr.am",
]);

const SHORTCODE_RE = /^[A-Za-z0-9_-]{5,15}$/;
const PK_RE = /^\d{5,25}$/;
const IG_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const EMBEDDED_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:m\.)?(?:instagram\.com|instagr\.am)\/[^\s<>"'`]+/i;

export type InstagramKind = "p" | "reel" | "tv" | "share" | "stories";

export type InstagramRef = {
  kind: InstagramKind;
  shortcode: string | null;
  storyId?: string | null;
  username?: string | null;
  url: string;
};

export function pkToShortcode(rawPk: string | null | undefined): string | null {
  if (!rawPk) return null;
  const cleaned = rawPk.split("_")[0]?.trim() ?? "";
  if (!PK_RE.test(cleaned)) return null;
  try {
    let num = BigInt(cleaned);
    if (num <= 0n) return null;
    let code = "";
    while (num > 0n) {
      const rem = Number(num % 64n);
      code = (IG_ALPHABET[rem] ?? "A") + code;
      num /= 64n;
    }
    return code || null;
  } catch {
    return null;
  }
}

export function shortcodeToPk(code: string | null | undefined): string | null {
  if (!code || !isInstagramShortcode(code)) return null;
  try {
    let num = 0n;
    for (const ch of code) {
      const idx = IG_ALPHABET.indexOf(ch);
      if (idx === -1) return null;
      num = num * 64n + BigInt(idx);
    }
    return num > 0n ? num.toString() : null;
  } catch {
    return null;
  }
}

export function isInstagramShortcode(value: string | null | undefined): boolean {
  return typeof value === "string" && SHORTCODE_RE.test(value) && !PK_RE.test(value);
}

export function normalizeInstagramInput(input: string): string {
  return input.replace(/[\u200b-\u200d\ufeff]/g, "").trim();
}

export function parseInstagram(input: string): InstagramRef | null {
  const trimmed = normalizeInstagramInput(input);
  if (!trimmed) return null;

  const direct = parseFromCandidate(trimmed);
  if (direct) return direct;

  const embedded = trimmed.match(EMBEDDED_URL_RE);
  if (embedded?.[0]) {
    const fromEmbed = parseFromCandidate(embedded[0]);
    if (fromEmbed) return fromEmbed;
  }

  return null;
}

function parseFromCandidate(trimmed: string): InstagramRef | null {
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  if (!HOSTS.has(host) && !HOSTS.has(url.hostname)) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  const first = parts[0] ?? "";
  const queryStoryMediaId = url.searchParams.get("story_media_id");

  // Story highlight shortlink: instagram.com/s/{base64}?story_media_id={pk}_{uid}
  if (first === "s") {
    const storyPk = queryStoryMediaId?.split("_")[0] ?? null;
    const converted = pkToShortcode(storyPk);
    return {
      kind: "stories",
      shortcode: converted,
      storyId: storyPk ?? parts[1] ?? null,
      username: null,
      url: url.href,
    };
  }

  if (first === "stories") {
    // e.g. /stories/{username}/{story_pk_or_shortcode}/ or /stories/highlights/{highlight_id}/
    const isHighlight = parts[1] === "highlights";
    const username = !isHighlight ? (parts[1] ?? null) : null;
    const rawThird = parts[2] ?? queryStoryMediaId?.split("_")[0] ?? null;
    const fromPk = pkToShortcode(rawThird) ?? pkToShortcode(queryStoryMediaId);
    const shortcode =
      fromPk ?? (isInstagramShortcode(rawThird) ? rawThird : null);
    const storyId =
      rawThird ??
      (shortcode ? shortcodeToPk(shortcode) : null) ??
      parts[1] ??
      null;

    return {
      kind: "stories",
      shortcode,
      storyId,
      username,
      url: `https://www.instagram.com/${parts.join("/")}/`,
    };
  }

  if (first === "share") {
    return {
      kind: "share",
      shortcode: null,
      url: `https://www.instagram.com/${parts.join("/")}/`,
    };
  }

  if (first === "p" || first === "reel" || first === "reels" || first === "tv") {
    const code = parts[1] ?? "";
    const resolvedCode = pkToShortcode(code) ?? (isInstagramShortcode(code) ? code : null);
    if (!resolvedCode) return null;
    const kind: InstagramKind = first === "tv" ? "tv" : first === "p" ? "p" : "reel";
    return { kind, shortcode: resolvedCode, url: canonicalInstagramUrl(kind, resolvedCode) };
  }

  if (
    parts.length >= 3 &&
    (parts[1] === "p" || parts[1] === "reel" || parts[1] === "reels" || parts[1] === "tv")
  ) {
    const code = parts[2] ?? "";
    const resolvedCode = pkToShortcode(code) ?? (isInstagramShortcode(code) ? code : null);
    if (!resolvedCode) return null;
    const kind: InstagramKind =
      parts[1] === "tv" ? "tv" : parts[1] === "p" ? "p" : "reel";
    return {
      kind,
      shortcode: resolvedCode,
      username: parts[0] ?? null,
      url: canonicalInstagramUrl(kind, resolvedCode),
    };
  }

  return null;
}

export function canonicalInstagramUrl(
  kind: InstagramKind,
  shortcode: string,
  username?: string | null,
  storyId?: string | null,
): string {
  if (kind === "stories") {
    const userPart = username || "instagram";
    const idPart = storyId || shortcodeToPk(shortcode) || shortcode;
    return `https://www.instagram.com/stories/${encodeURIComponent(userPart)}/${encodeURIComponent(idPart)}/`;
  }
  const path = kind === "tv" ? "tv" : kind === "p" ? "p" : "reel";
  return `https://www.instagram.com/${path}/${shortcode}/`;
}

export function instagramProfileUrl(username: string): string {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}
