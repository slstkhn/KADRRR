import { createFileRoute } from "@tanstack/react-router";
import { contentDisposition } from "@/lib/media/disposition";
import { isMediaSource } from "@/lib/media/source";
import type { MediaSource, OpenStreamResult } from "@/lib/youtube/types";

async function openStream(source: MediaSource, id: string, preset: string): Promise<OpenStreamResult> {
  switch (source) {
    case "instagram":
      return (await import("@/lib/instagram/provider.server")).openInstagramStream(id, preset);
    case "x":
      return (await import("@/lib/x/provider.server")).openXStream(id, preset);
    case "threads":
      return (await import("@/lib/threads/provider.server")).openThreadsStream(id, preset);
    case "tiktok":
      return (await import("@/lib/tiktok/provider.server")).openTikTokStream(id, preset);
    case "rutube":
      return (await import("@/lib/rutube/provider.server")).openRutubeStream(id, preset);
    case "vimeo":
      return (await import("@/lib/vimeo/provider.server")).openVimeoStream(id, preset);
    default:
      return (await import("@/lib/youtube/provider.server")).openYouTubeStream(id, preset);
  }
}

export const Route = createFileRoute("/api/file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const source = url.searchParams.get("source");
        const id = url.searchParams.get("id");
        const preset = url.searchParams.get("preset");
        if (!isMediaSource(source) || !id || !preset) {
          return new Response("Некорректный запрос", { status: 400 });
        }

        const opened = await openStream(source, id, preset);

        if (!opened.ok) {
          return new Response(opened.error, {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }

        const headers = new Headers();
        headers.set("content-type", opened.mime.split(";")[0]?.trim() || "application/octet-stream");
        headers.set("content-disposition", contentDisposition(opened.filename));
        headers.set("cache-control", "no-store");
        headers.set("x-content-type-options", "nosniff");
        const length = opened.response.headers.get("content-length");
        if (length) headers.set("content-length", length);

        return new Response(opened.response.body, {
          status: 200,
          headers,
        });
      },
    },
  },
});
