export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export const GOOGLEBOT_UA =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
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

export function cookieHeader(res: Response): string {
  const cookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  return cookies
    .filter(Boolean)
    .map((c) => c.split(";")[0])
    .join("; ");
}

export async function fetchText(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 12_000,
): Promise<{ res: Response; text: string }> {
  const res = await withTimeout(
    fetch(url, { headers, redirect: "follow" }),
    timeoutMs,
    "timeout",
  );
  const text = await res.text();
  return { res, text };
}

export function extFromUrl(url: string, fallback: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".mp4") || path.includes(".mp4")) return "mp4";
    if (path.endsWith(".webm")) return "webm";
    if (path.endsWith(".m4a")) return "m4a";
    if (path.endsWith(".ts")) return "ts";
    if (path.endsWith(".webp")) return "webp";
    if (path.endsWith(".png")) return "png";
    if (path.endsWith(".gif")) return "gif";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "jpg";
  } catch {
    /* ignore */
  }
  return fallback;
}

export function mimeFromExt(ext: string, video: boolean): string {
  if (ext === "mp4") return video ? "video/mp4" : "image/jpeg";
  if (ext === "webm") return "video/webm";
  if (ext === "ts") return "video/mp2t";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return video ? "video/mp4" : "application/octet-stream";
}

export function looksLikeMedia(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const a = bytes[0];
  const b = bytes[1];
  const c = bytes[2];
  const d = bytes[3];
  if (a === 0x47) return true;
  if (a === 0x1a && b === 0x45 && c === 0xdf && d === 0xa3) return true;
  if (a === 0xff && b === 0xd8) return true;
  if (a === 0x89 && b === 0x50 && c === 0x4e && d === 0x47) return true;
  if (a === 0x47 && b === 0x49 && c === 0x46) return true;
  if (a === 0x49 && b === 0x44 && c === 0x33) return true;
  if (a === 0xff && (b & 0xe0) === 0xe0) return true;
  const tag = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  return tag === "ftyp";
}

export function isHtmlContentType(value: string | null | undefined): boolean {
  const type = (value ?? "").toLowerCase();
  return type.includes("text/html") || type.includes("application/xhtml");
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function asNumber(value: unknown): number | null {
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

export function walkRecords(
  node: unknown,
  visit: (rec: Record<string, unknown>) => void,
  depth = 0,
): void {
  if (!node || typeof node !== "object" || depth > 32) return;
  if (Array.isArray(node)) {
    for (const item of node) walkRecords(item, visit, depth + 1);
    return;
  }
  const rec = node as Record<string, unknown>;
  visit(rec);
  for (const value of Object.values(rec)) walkRecords(value, visit, depth + 1);
}

export async function inlineThumbnail(
  url: string,
  headers: Record<string, string>,
  maxBytes = 400_000,
): Promise<string> {
  if (!url || url.startsWith("data:")) return url;
  try {
    const res = await withTimeout(
      fetch(url, { headers, redirect: "follow" }),
      5_000,
      "thumb timeout",
    );
    if (!res.ok) return url;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 32 || bytes.length > maxBytes) return url;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return url;
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return url;
  }
}
