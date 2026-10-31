import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AccountSlot() {
  const { user, isPending } = useCurrentUserState();
  const [signingOut, setSigningOut] = useState(false);

  if (isPending) {
    return (
      <div
        className="bg-surface-2 size-11 shrink-0 animate-pulse rounded-full"
        aria-hidden="true"
      />
    );
  }

  if (!user) {
    return (
      <Link
        to="/login"
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-11 px-4")}
      >
        Войти
      </Link>
    );
  }

  const label = user.displayName ?? user.primaryEmail ?? "Аккаунт";

  return (
    <div className="flex min-w-0 items-center gap-2">
      {user.profileImageUrl ? (
        <img
          src={user.profileImageUrl}
          alt=""
          className="size-8 shrink-0 rounded-full object-cover outline outline-1 -outline-offset-1 outline-foreground/10"
        />
      ) : (
        <span className="bg-surface-2 text-foreground grid size-8 shrink-0 place-items-center rounded-full text-xs font-medium">
          {label.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="hidden max-w-28 truncate text-sm text-foreground sm:inline">
        {label}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-11 shrink-0"
        disabled={signingOut}
        onClick={() => {
          setSigningOut(true);
          void signOut().catch(() => setSigningOut(false));
        }}
      >
        {signingOut ? "Выходим" : "Выйти"}
      </Button>
    </div>
  );
}
