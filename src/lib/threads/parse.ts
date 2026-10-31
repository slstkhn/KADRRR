export type ThreadsRef = {
  id: string;
  url: string;
  kind: "post" | "share";
  username?: string;
};

const HOSTS = new Set([
  "threads.net",
  "www.threads.net",
  "threads.com",
  "www.threads.com",
]);

const CODE_RE = /^[A-Za-z0-9_-]{5,15}$/;

export function parseThreads(input: string): ThreadsRef | null {
  const trimmed = input.replace(/[\u200b-\u200d\ufeff]/g, "").trim();
  if (!trimmed) return null;
  if (CODE_RE.test(trimmed)) {
    return { id: trimmed, url: canonicalThreadsUrl(trimmed), kind: "post" };
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
  if (parts[0] === "t" && parts[1] && CODE_RE.test(parts[1])) {
    return { id: parts[1], url: canonicalThreadsUrl(parts[1]), kind: "post" };
  }
  if (parts[0] === "share") {
    const slug = parts[1] ?? "";
    if (!slug) return null;
    return { id: slug, url: url.href, kind: "share" };
  }
  const postIdx = parts.findIndex((p) => p === "post");
  if (postIdx >= 0) {
    const id = parts[postIdx + 1] ?? "";
    if (!CODE_RE.test(id)) return null;
    const username = parts[0]?.startsWith("@") ? parts[0].slice(1) : undefined;
    return {
      id,
      url: canonicalThreadsUrl(id, username),
      kind: "post",
      username,
    };
  }
  return null;
}

export function canonicalThreadsUrl(id: string, username?: string): string {
  if (username) return `https://www.threads.com/@${username}/post/${id}`;
  return `https://www.threads.com/t/${id}`;
}
