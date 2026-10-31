import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { detectMedia, isMediaSource } from "../media/source";
import type { DownloadLinkResult, InspectResult, MediaSource } from "./types";

const SOURCE_ENUM = z.enum([
  "youtube",
  "instagram",
  "x",
  "threads",
  "tiktok",
  "rutube",
  "vimeo",
]);

export const inspectVideo = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string().min(1) }))
  .handler(async ({ data }): Promise<InspectResult> => {
    const detected = detectMedia(data.url);
    if (!detected) {
      return {
        ok: false,
        error:
          "Не похоже на ссылку YouTube, Instagram, X, Threads, TikTok, RuTube или Vimeo. Подойдёт watch, Shorts, история, Reel, пост, ролик или видео.",
      };
    }
    switch (detected.source) {
      case "instagram": {
        const { inspect } = await import("../instagram/provider.server");
        return inspect(data.url);
      }
      case "youtube": {
        const { inspect } = await import("./provider.server");
        return inspect(data.url);
      }
      case "x": {
        const { inspect } = await import("../x/provider.server");
        return inspect(data.url);
      }
      case "threads": {
        const { inspect } = await import("../threads/provider.server");
        return inspect(data.url);
      }
      case "tiktok": {
        const { inspect } = await import("../tiktok/provider.server");
        return inspect(data.url);
      }
      case "rutube": {
        const { inspect } = await import("../rutube/provider.server");
        return inspect(data.url);
      }
      case "vimeo": {
        const { inspect } = await import("../vimeo/provider.server");
        return inspect(data.url);
      }
    }
  });

export const requestDownloadLink = createServerFn({ method: "POST" })
  .validator(
    z.object({
      source: SOURCE_ENUM.optional(),
      videoId: z.string().min(3),
      presetId: z.string().min(1),
    }),
  )
  .handler(async ({ data }): Promise<DownloadLinkResult> => {
    const source: MediaSource = isMediaSource(data.source) ? data.source : "youtube";
    switch (source) {
      case "instagram": {
        const { getDownloadLink } = await import("../instagram/provider.server");
        return getDownloadLink(data.videoId, data.presetId);
      }
      case "x": {
        const { getDownloadLink } = await import("../x/provider.server");
        return getDownloadLink(data.videoId, data.presetId);
      }
      case "threads": {
        const { getDownloadLink } = await import("../threads/provider.server");
        return getDownloadLink(data.videoId, data.presetId);
      }
      case "tiktok": {
        const { getDownloadLink } = await import("../tiktok/provider.server");
        return getDownloadLink(data.videoId, data.presetId);
      }
      case "rutube": {
        const { getDownloadLink } = await import("../rutube/provider.server");
        return getDownloadLink(data.videoId, data.presetId);
      }
      case "vimeo": {
        const { getDownloadLink } = await import("../vimeo/provider.server");
        return getDownloadLink(data.videoId, data.presetId);
      }
      default: {
        const { getDownloadLink } = await import("./provider.server");
        return getDownloadLink(data.videoId, data.presetId);
      }
    }
  });
