import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { ThemeProvider, useTheme } from "@/components/theme-toggle";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";

const APP_NAME = "KADR";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "KADR — сохрани ролик YouTube, Vimeo, Instagram (Reels, посты, истории), X, TikTok, Threads или RuTube: видео, фото и звук без водяных знаков.",
      },
      { property: "og:title", content: APP_NAME },
      {
        property: "og:description",
        content:
          "KADR — сохрани ролик YouTube, Vimeo, Instagram (Reels, посты, истории), X, TikTok, Threads или RuTube: видео, фото и звук без водяных знаков.",
      },
      { name: "theme-color", content: "#09090b" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Syne:wght@500;600;700;800&display=swap",
      },
    ],
  }),
  component: RootDocument,
});

function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="bottom-center"
      toastOptions={{
        className: "font-sans",
      }}
    />
  );
}

function RootDocument() {
  return (
    <html lang="ru" className="dark antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground">
        <ThemeProvider>
          <PreviewHostBridge />
          <AuthProvider>
            <Outlet />
          </AuthProvider>
          <ThemedToaster />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
