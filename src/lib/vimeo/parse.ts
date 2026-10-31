const HOSTS = new Set([
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
]);

const ID_RE = /^\d{4,15}$/;
const HASH_RE = /^[A-Za-z0-9]{4,24}$/;
const COMPOSITE_RE = /^(\d{4,15})(?::([A-Za-z0-9]{4,24}))?$/;

const EMBEDDED_URL_RE =
  /(?:https?:\/\/)?(?:www\.|player\.)?vimeo\.com\/[^\s<>"'`]+/i;

export type VimeoRef = {
  id: string;
  videoId: string;
  hash: string | null;
  url: string;
};

export function splitVimeoCompositeId(composite: string): {
  videoId: string;
  hash: string | null;
} | null {
  const match = composite.trim().match(COMPOSITE_RE);
  if (!match?.[1]) return null;
  return {
    videoId: match[1],
    hash: match[2] ?? null,
  };
}

export function canonicalVimeoUrl(idOrComposite: string, hash?: string | null): string {
  const split = splitVimeoCompositeId(idOrComposite);
  const videoId = split?.videoId ?? idOrComposite;
  const resolvedHash = hash ?? split?.hash ?? null;
  return resolvedHash
    ? `https://vimeo.com/${videoId}/${resolvedHash}`
    : `https://vimeo.com/${videoId}`;
}

export function parseVimeo(input: string): VimeoRef | null {
  const trimmed = input.replace(/[\u200b-\u200d\ufeff]/g, "").trim();
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

function parseFromCandidate(trimmed: string): VimeoRef | null {
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  const queryHash = url.searchParams.get("h");
  const validQueryHash = queryHash && HASH_RE.test(queryHash) ? queryHash : null;

  // player.vimeo.com/video/{id}
  if (host === "player.vimeo.com") {
    const videoIdx = parts.indexOf("video");
    const candidate = videoIdx >= 0 ? parts[videoIdx + 1] : parts[0];
    if (!candidate || !ID_RE.test(candidate)) return null;
    const pathHash =
      videoIdx >= 0 && parts[videoIdx + 2] && HASH_RE.test(parts[videoIdx + 2]!)
        ? parts[videoIdx + 2]!
        : null;
    const hash = validQueryHash ?? pathHash;
    const id = hash ? `${candidate}:${hash}` : candidate;
    return {
      id,
      videoId: candidate,
      hash,
      url: canonicalVimeoUrl(candidate, hash),
    };
  }

  // vimeo.com/{id} or vimeo.com/{id}/{hash}
  if (ID_RE.test(parts[0]!)) {
    const videoId = parts[0]!;
    const pathHash = parts[1] && HASH_RE.test(parts[1]) ? parts[1] : null;
    const hash = validQueryHash ?? pathHash;
    const id = hash ? `${videoId}:${hash}` : videoId;
    return {
      id,
      videoId,
      hash,
      url: canonicalVimeoUrl(videoId, hash),
    };
  }

  // vimeo.com/channels/{name}/{id}, vimeo.com/groups/{name}/videos/{id}, vimeo.com/manage/videos/{id}, vimeo.com/showcase/{id}/video/{id}
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const seg = parts[i]!;
    if (ID_RE.test(seg)) {
      const nextSeg = parts[i + 1];
      const pathHash = nextSeg && HASH_RE.test(nextSeg) ? nextSeg : null;
      const hash = validQueryHash ?? pathHash;
      const id = hash ? `${seg}:${hash}` : seg;
      return {
        id,
        videoId: seg,
        hash,
        url: canonicalVimeoUrl(seg, hash),
      };
    }
  }

  return null;
}
