export type TikTokRef = {
  id: string;
  url: string;
  kind: "video" | "photo" | "short";
  username?: string;
};

const HOSTS = new Set([
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
  "www.vm.tiktok.com",
  "www.vt.tiktok.com",
]);

const ID_RE = /^\d{8,24}$/;

export function parseTikTok(input: string): TikTokRef | null {
  const trimmed = input.replace(/[\u200b-\u200d\ufeff]/g, "").trim();
  if (!trimmed) return null;
  if (ID_RE.test(trimmed)) {
    return { id: trimmed, url: canonicalTikTokUrl(trimmed), kind: "video" };
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

  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    const slug = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!slug) return null;
    return { id: slug, url: url.href, kind: "short" };
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "t" && parts[1]) {
    return { id: parts[1], url: url.href, kind: "short" };
  }
  const videoIdx = parts.findIndex((p) => p === "video" || p === "photo");
  if (videoIdx >= 0) {
    const id = (parts[videoIdx + 1] ?? "").split("?")[0];
    if (!ID_RE.test(id)) return null;
    const username = parts[0]?.startsWith("@") ? parts[0].slice(1) : undefined;
    const kind = parts[videoIdx] === "photo" ? "photo" : "video";
    return {
      id,
      url: canonicalTikTokUrl(id, username, kind),
      kind,
      username,
    };
  }
  return null;
}

export function canonicalTikTokUrl(
  id: string,
  username?: string,
  kind: "video" | "photo" = "video",
): string {
  if (username) return `https://www.tiktok.com/@${username}/${kind}/${id}`;
  return `https://www.tiktok.com/@/${kind}/${id}`;
}
