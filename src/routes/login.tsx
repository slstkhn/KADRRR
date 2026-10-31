import { createFileRoute, Link } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { KadrMark } from "@/components/kadr-mark";
import { ThemeToggle } from "@/components/theme-toggle";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="relative min-h-dvh overflow-x-hidden">
      <div aria-hidden="true" className="hero-wash pointer-events-none absolute inset-x-0 top-0 h-72" />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-12">
        <div className="mb-10 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-3">
            <KadrMark className="size-9" />
            <div>
              <p className="font-display text-lg font-semibold tracking-display text-foreground">
                KADR
              </p>
              <p className="text-xs text-muted-foreground">видео с твоих любимых сайтов</p>
            </div>
          </Link>
          <ThemeToggle />
        </div>

        <h1 className="font-display text-3xl font-semibold tracking-display text-foreground">
          Войти
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          История сохранится в аккаунте — откроешь с телефона или компьютера.
        </p>

        {authEnabled ? (
          <div className="mt-8 space-y-3">
            {GROK_PROVIDERS.map((provider) => (
              <Button
                key={provider.providerId}
                type="button"
                variant="outline"
                className="h-12 w-full"
                onClick={() => void signIn(provider.providerId, { callbackURL: "/" })}
              >
                Продолжить через {provider.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="mt-8 text-sm text-muted-foreground">Вход сейчас недоступен.</p>
        )}

        <Link
          to="/"
          className="mt-8 inline-flex h-11 items-center text-sm text-muted-foreground transition-colors duration-[var(--motion-quick)] hover:text-foreground"
        >
          Назад на главную
        </Link>
      </div>
    </main>
  );
}
