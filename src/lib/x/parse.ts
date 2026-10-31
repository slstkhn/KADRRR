export type XRef = {
  id: string;
  url: string;
  kind: "status" | "short";
};

const HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "m.twitter.com",
  "vxtwitter.com",
  "fxtwitter.com",
  "t.co",
]);

const ID_RE = /^\d{5,20}$/;

export function parseX(input: string): XRef | null {
  const trimmed = input.replace(/[\u200b-\u200d\ufeff]/g, "").trim();
  if (!trimmed) return null;
  if (ID_RE.test(trimmed)) {
    return { id: trimmed, url: canonicalXUrl(trimmed), kind: "status" };
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

  if (host === "t.co") {
    const slug = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!slug) return null;
    return { id: slug, url: url.href, kind: "short" };
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const statusIdx = parts.findIndex((p) => p === "status");
  if (statusIdx >= 0) {
    const id = (parts[statusIdx + 1] ?? "").split("?")[0];
    if (!ID_RE.test(id)) return null;
    return { id, url: canonicalXUrl(id), kind: "status" };
  }
  if (parts.length >= 2 && ID_RE.test(parts[1] ?? "")) {
    return { id: parts[1], url: canonicalXUrl(parts[1]), kind: "status" };
  }
  return null;
}

export function canonicalXUrl(id: string): string {
  return `https://x.com/i/status/${id}`;
}
