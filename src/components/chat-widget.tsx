import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Bot,
  LoaderCircle,
  MessageSquare,
  Send,
  Sparkles,
  Trash2,
  User,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  sendChatMessage,
  type ChatTurn,
  type ChatVideoContext,
} from "@/lib/chat/chat";
import { sourceLabel } from "@/lib/media/source";
import type { VideoInspect } from "@/lib/youtube/types";

const QUICK_PROMPTS = [
  "Какой формат лучше выбрать для телефона?",
  "Как скачать видео и обложку одним кликом?",
  "Как сохранить историю из Instagram по ссылке?",
  "Почему видео 1080p иногда идёт без звука?",
] as const;

export function ChatWidget({ video }: { video: VideoInspect | null }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"general" | "fast">("general");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatTurn[]>([
    {
      role: "model",
      text: "Привет! Я медиа-помощник. Подскажу, какой формат выбрать, как скачать всё сразу (видео + обложку) или как сохранить историю из Instagram и ролик с Vimeo.",
    },
  ]);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, pending, open]);

  const videoContext: ChatVideoContext = video
    ? {
        title: video.title,
        source: sourceLabel(video.source),
        author: video.author,
        url: video.url,
        durationSec: video.durationSec,
        presets: video.presets.map((p) => ({
          label: p.label,
          kind: p.kind,
          ext: p.ext,
          note: p.note,
        })),
      }
    : null;

  async function handleSend(textToSend: string) {
    const trimmed = textToSend.trim();
    if (!trimmed || pending) return;

    const historySnapshot = messages;
    const nextUserTurn: ChatTurn = { role: "user", text: trimmed };

    setMessages((prev) => [...prev, nextUserTurn]);
    setInput("");
    setError(null);
    setPending(true);

    try {
      const res = await sendChatMessage({
        data: {
          message: trimmed,
          history: historySnapshot,
          mode,
          videoContext,
        },
      });

      if (!res.ok) {
        setError(res.error);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "model", text: res.reply },
      ]);
    } catch {
      setError("Не удалось связаться с чат-ботом. Попробуйте ещё раз.");
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleSend(input);
  }

  function resetConversation() {
    setError(null);
    setMessages([
      {
        role: "model",
        text: "История диалога очищена. Спрашивайте о скачивании видео, обложек, аудио или историй!",
      },
    ]);
  }

  return (
    <>
      <div className="fixed right-4 bottom-4 z-40 sm:right-6 sm:bottom-6">
        {!open ? (
          <Button
            type="button"
            onClick={() => setOpen(true)}
            className="h-12 gap-2 rounded-full px-5 shadow-lg"
            aria-label="Открыть чат-помощник"
          >
            <MessageSquare className="size-4" />
            <span>Чат-помощник</span>
          </Button>
        ) : null}
      </div>

      {open ? (
        <aside
          aria-label="Чат-помощник"
          className="fixed inset-x-3 bottom-3 z-50 flex max-h-[min(600px,calc(100dvh-24px))] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[400px]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-foreground">
                <Bot className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-semibold text-foreground">
                  Медиа-помощник
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {video && video.presets.length > 0
                    ? `Видит карточку: ${sourceLabel(video.source)}`
                    : "Помощь по форматам и ссылкам"}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setMode((prev) => (prev === "general" ? "fast" : "general"))
                }
                title={
                  mode === "general"
                    ? "Режим: Умный (Gemini 3.8 Flash). Нажмите для быстрого режима"
                    : "Режим: Быстрый (Gemini 3.1 Flash Lite). Нажмите для умного режима"
                }
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {mode === "general" ? (
                  <>
                    <Sparkles className="size-3.5" />
                    <span>Точный</span>
                  </>
                ) : (
                  <>
                    <Zap className="size-3.5" />
                    <span>Быстрый</span>
                  </>
                )}
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={resetConversation}
                aria-label="Очистить диалог"
                title="Очистить диалог"
              >
                <Trash2 className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setOpen(false)}
                aria-label="Закрыть чат"
                title="Закрыть чат"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto p-4"
          >
            {messages.map((msg, index) => {
              const isUser = msg.role === "user";
              return (
                <div
                  key={`${msg.role}-${index}`}
                  className={`flex items-start gap-2.5 ${
                    isUser ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-border text-xs ${
                      isUser
                        ? "bg-primary text-primary-foreground"
                        : "bg-surface-2 text-foreground"
                    }`}
                  >
                    {isUser ? (
                      <User className="size-3.5" />
                    ) : (
                      <Bot className="size-3.5" />
                    )}
                  </span>
                  <div
                    className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      isUser
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-surface-2 text-foreground"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              );
            })}

            {pending ? (
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-foreground">
                  <Bot className="size-3.5" />
                </span>
                <div className="inline-flex items-center gap-2 rounded-2xl border border-border bg-surface-2 px-3.5 py-2.5 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  <span>Печатает ответ…</span>
                </div>
              </div>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </p>
            ) : null}

            {messages.length <= 2 && !pending ? (
              <div className="pt-2">
                <p className="mb-2 text-xs text-muted-foreground">
                  Быстрые вопросы:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void handleSend(prompt)}
                      className="rounded-xl border border-border bg-surface-2 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <form
            onSubmit={onSubmit}
            className="flex items-center gap-2 border-t border-border bg-surface p-3"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Спросите про скачивание или форматы…"
              disabled={pending}
              className="h-10 flex-1"
              aria-label="Сообщение для чат-помощника"
            />
            <Button
              type="submit"
              size="icon"
              disabled={pending || !input.trim()}
              className="size-10 shrink-0"
              aria-label="Отправить сообщение"
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </form>
        </aside>
      ) : null}
    </>
  );
}
