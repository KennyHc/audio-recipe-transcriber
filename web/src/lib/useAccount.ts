import { useEffect, useState } from "react";
import { account, type AccountUser } from "@/backend";

/**
 * The signed-in user in cloud mode: undefined while the session is being restored, null when
 * signed out. Always null in other modes (`account` is null there — no accounts).
 */
export function useAccountUser(): AccountUser | null | undefined {
  const [user, setUser] = useState<AccountUser | null | undefined>(() => (account ? account.current() : null));
  useEffect(() => {
    if (!account) return;
    return account.subscribe(setUser);
  }, []);
  return user;
}

/** "Kenny" / "k" — first letter for the avatar fallback. */
export function initialOf(user: Pick<AccountUser, "displayName" | "email">): string {
  const source = user.displayName?.trim() || user.email?.trim() || "?";
  return source.charAt(0).toUpperCase();
}
