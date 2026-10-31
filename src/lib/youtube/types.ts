export type MediaSource =
  | "youtube"
  | "instagram"
  | "x"
  | "threads"
  | "tiktok"
  | "rutube"
  | "vimeo";

export type MediaKind = "muxed" | "video" | "audio" | "image";

export type VideoPreset = {
  id: string;
  itag: number;
  label: string;
  kind: MediaKind;
  ext: string;
  mime: string;
  hasAudio: boolean;
  hasVideo: boolean;
  qualityLabel: string | null;
  sizeBytes: number | null;
  note: string;
};

export type VideoInspect = {
  id: string;
  source: MediaSource;
  url: string;
  title: string;
  author: string;
  authorUrl: string | null;
  thumbnail: string;
  durationSec: number | null;
  views: number | null;
  isLive: boolean;
  downloadable: boolean;
  restriction: string | null;
  presets: VideoPreset[];
};

export type InspectResult =
  | { ok: true; video: VideoInspect }
  | { ok: false; error: string };

export type DownloadLinkResult =
  | { ok: true; url: string; filename: string; mime: string }
  | { ok: false; error: string };

export type OpenStreamResult =
  | { ok: true; response: Response; filename: string; mime: string }
  | { ok: false; error: string };
