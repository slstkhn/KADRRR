const STREAM_PROXIES = [
  "https://proxy.piped.private.coffee",
  "https://pipedproxy.kavin.rocks",
];

const STREAM_HEADERS: Record<string, string> = {
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
  origin: "https://www.youtube.com",
  referer: "https://www.youtube.com/",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

let cachedProxy: string | null = null;
let cachedProxyAt = 0;
let proxiesDisabledUntil = 0;
const PROXY_TTL_MS = 8 * 60 * 1000;
const PROXY_COOLDOWN_MS = 10 * 60 * 1000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function looksLikeMedia(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const a = bytes[0];
  const b = bytes[1];
  const c = bytes[2];
  const d = bytes[3];
  if (a === 0x1a && b === 0x45 && c === 0xdf && d === 0xa3) return true;
  if (a === 0xff && b === 0xd8) return true;
  if (a === 0x89 && b === 0x50 && c === 0x4e && d === 0x47) return true;
  if (a === 0x47 && b === 0x49 && c === 0x46) return true;
  if (a === 0x49 && b === 0x44 && c === 0x33) return true;
  if (a === 0xff && (b & 0xe0) === 0xe0) return true;
  const tag = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  return tag === "ftyp";
}

export function viaStreamProxy(rawUrl: string, proxyOrigin: string): string {
  const source = new URL(rawUrl);
  const proxied = new URL(proxyOrigin);
  proxied.pathname = source.pathname || "/videoplayback";
  proxied.search = source.search;
  proxied.searchParams.set("host", source.hostname);
  return proxied.href;
}

function proxyList(): string[] {
  const fresh = cachedProxy && Date.now() - cachedProxyAt < PROXY_TTL_MS ? cachedProxy : null;
  if (!fresh) return STREAM_PROXIES;
  return [fresh, ...STREAM_PROXIES.filter((item) => item !== fresh)];
}

function usableBody(res: Response): boolean {
  if (!(res.ok || res.status === 206) || !res.body) return false;
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("text/html") || type.includes("text/plain")) return false;
  return true;
}

async function fetchWithHeaderTimeout(
  url: string,
  headers: Record<string, string>,
  ms: number,
): Promise<Response> {
  const ac = new AbortController();
  let settled = false;
  const timer = setTimeout(() => {
    if (!settled) ac.abort();
  }, ms);
  try {
    const res = await fetch(url, {
      headers,
      redirect: "follow",
      signal: ac.signal,
    });
    settled = true;
    return res;
  } finally {
    settled = true;
    clearTimeout(timer);
  }
}

async function probe(url: string): Promise<boolean> {
  try {
    const res = await withTimeout(
      fetch(url, {
        headers: { ...STREAM_HEADERS, range: "bytes=0-1023" },
        redirect: "follow",
        signal: AbortSignal.timeout(7_000),
      }),
      7_000,
      "probe timeout",
    );
    if (!(res.ok || res.status === 206)) return false;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return looksLikeMedia(bytes);
  } catch {
    return false;
  }
}

export async function pickProxiedUrl(rawUrl: string): Promise<string | null> {
  if (!rawUrl.startsWith("http")) return null;
  for (const origin of proxyList()) {
    const url = viaStreamProxy(rawUrl, origin);
    if (await probe(url)) {
      cachedProxy = origin;
      cachedProxyAt = Date.now();
      return url;
    }
  }
  cachedProxy = null;
  return null;
}

async function fetchDirectStream(rawUrl: string): Promise<Response | null> {
  try {
    const res = await fetchWithHeaderTimeout(rawUrl, STREAM_HEADERS, 5_000);
    if (!usableBody(res)) return null;
    return res;
  } catch {
    return null;
  }
}

export async function fetchProxiedStream(rawUrl: string): Promise<Response | null> {
  if (!rawUrl.startsWith("http")) return null;
  if (Date.now() >= proxiesDisabledUntil) {
    const ordered = proxyList();
    let anyOk = false;
    for (const origin of ordered) {
      const url = viaStreamProxy(rawUrl, origin);
      try {
        const res = await fetchWithHeaderTimeout(url, STREAM_HEADERS, 4_000);
        if (!usableBody(res)) continue;
        cachedProxy = origin;
        cachedProxyAt = Date.now();
        anyOk = true;
        return res;
      } catch {
        /* next proxy */
      }
    }
    if (!anyOk) {
      cachedProxy = null;
      proxiesDisabledUntil = Date.now() + PROXY_COOLDOWN_MS;
    }
  }
  return fetchDirectStream(rawUrl);
}

