export type RutubeRef = {
  id: string;
  url: string;
  kind: "video" | "shorts" | "embed";
};

const HOSTS = new Set(["rutube.ru", "www.rutube.ru", "m.rutube.ru"]);
const HEX_RE = /^[a-f0-9]{32}$/i;
const NUM_RE = /^\d{5,12}$/;

export function parseRutube(input: string): RutubeRef | null {
  const trimmed = input.replace(/[\u200b-\u200d\ufeff]/g, "").trim();
  if (!trimmed) return null;
  if (HEX_RE.test(trimmed) || NUM_RE.test(trimmed)) {
    return { id: trimmed, url: canonicalRutubeUrl(trimmed), kind: "video" };
  }
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
  if (parts[0] === "video" || parts[0] === "shorts") {
    const id = parts[1] === "private" ? parts[2] : parts[1];
    if (!id || (!HEX_RE.test(id) && !NUM_RE.test(id))) return null;
    const kind = parts[0] === "shorts" ? "shorts" : "video";
    return { id, url: canonicalRutubeUrl(id, kind), kind };
  }
  if (parts[0] === "play" && parts[1] === "embed" && parts[2]) {
    return { id: parts[2], url: canonicalRutubeUrl(parts[2], "embed"), kind: "embed" };
  }
  return null;
}

export function canonicalRutubeUrl(id: string, kind: "video" | "shorts" | "embed" = "video"): string {
  if (kind === "shorts") return `https://rutube.ru/shorts/${id}/`;
  if (kind === "embed") return `https://rutube.ru/play/embed/${id}`;
  return `https://rutube.ru/video/${id}/`;
}
