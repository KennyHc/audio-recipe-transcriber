import { useState } from "react";
import { LogOut, Settings as SettingsIcon, ShieldCheck } from "lucide-react";
import type { MeResponse } from "@recipe/shared";
import { account, type AccountUser } from "@/backend";
import { initialOf } from "@/lib/useAccount";
import { adminHref, navigate, settingsHref } from "@/lib/router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function usageLine(me: MeResponse): string {
  return `${me.usage.used} of ${me.usage.limit} recipes this month`;
}

export function Avatar({ user, size = 32 }: { user: AccountUser; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (user.photoURL && !broken) {
    return (
      <img
        src={user.photoURL}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex items-center justify-center rounded-full bg-[hsl(var(--accent-tint-strong))] text-[13px] font-semibold text-[hsl(var(--accent-text))]"
      style={{ width: size, height: size }}
    >
      {initialOf(user)}
    </span>
  );
}

/** Top-right account menu (cloud mode, signed in): who, this month's usage, Settings, Sign out. */
export function AccountMenu({ user }: { user: AccountUser }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [usageError, setUsageError] = useState(false);

  function loadUsage() {
    if (!account) return;
    setUsageError(false);
    account
      .getMe()
      .then(setMe)
      .catch(() => setUsageError(true));
  }

  return (
    <DropdownMenu onOpenChange={(open) => open && loadUsage()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full transition-shadow hover:shadow-[0_0_0_3px_hsl(var(--accent-tint-strong))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        >
          <Avatar user={user} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="space-y-0.5 px-2.5 py-2">
          {user.displayName && <p className="truncate text-sm font-medium text-[hsl(var(--ink))]">{user.displayName}</p>}
          {me?.handle && <p className="truncate text-sm text-[hsl(var(--ink-muted))]">@{me.handle}</p>}
          <p className="truncate text-sm text-[hsl(var(--ink-muted))]">{user.email ?? "Signed in"}</p>
          <p className="pt-1 text-xs tabular-nums text-[hsl(var(--ink-faint))]">
            {me ? usageLine(me) : usageError ? "Usage unavailable right now" : "Checking usage…"}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate(settingsHref())}>
          <SettingsIcon className="h-3.5 w-3.5" /> Settings
        </DropdownMenuItem>
        {me?.isAdmin && (
          <DropdownMenuItem onSelect={() => navigate(adminHref())}>
            <ShieldCheck className="h-3.5 w-3.5" /> Moderation
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() => {
            void account?.signOut().then(() => navigate("#/"));
          }}
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
