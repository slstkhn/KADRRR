import { createServerFn } from "@tanstack/react-start";

export type ChatTurn = {
  role: "user" | "model";
  text: string;
};

export type ChatVideoContext = {
  title: string;
  source: string;
  author: string;
  url: string;
  durationSec: number | null;
  presets: Array<{
    label: string;
    kind: string;
    ext: string;
    note: string;
  }>;
} | null;

export type SendChatPayload = {
  message: string;
  history: ChatTurn[];
  mode?: "general" | "fast";
  videoContext?: ChatVideoContext;
};

export type SendChatResponse =
  | { ok: true; reply: string; modelUsed: string }
  | { ok: false; error: string };

export const sendChatMessage = createServerFn({ method: "POST" })
  .validator((data: SendChatPayload) => data)
  .handler(async ({ data }): Promise<SendChatResponse> => {
    const { runChatTurn } = await import("./chat.server");
    return runChatTurn(data);
  });
