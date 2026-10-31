export function formatDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function formatViews(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const v = n / 1000;
    const digits = v < 10 ? 1 : 0;
    return `${v.toFixed(digits).replace(".", ",")} тыс.`;
  }
  if (n < 1_000_000_000) {
    const v = n / 1_000_000;
    const digits = v < 10 ? 1 : 0;
    return `${v.toFixed(digits).replace(".", ",")} млн`;
  }
  const v = n / 1_000_000_000;
  return `${v.toFixed(1).replace(".", ",")} млрд`;
}

export function formatBytes(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "размер уточним";
  const units = ["Б", "КБ", "МБ", "ГБ"] as const;
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const digits = value >= 10 || i === 0 ? 0 : 1;
  return `${value.toFixed(digits).replace(".", ",")} ${units[i]}`;
}

export function safeFilename(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "kadr";
}
