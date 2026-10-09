// Cloud mode: small per-browser preferences for the account UI, in localStorage (wrapped in
// try/catch — storage can be unavailable). No Firebase here, so the UI can use it in any build.

export const SIGNIN_EMAIL_KEY = "recipe-transcriber:signin-email";
export const REAUTH_FOR_DELETE_KEY = "recipe-transcriber:reauth-for-delete";
const MOVE_DISMISSED_PREFIX = "recipe-transcriber:move-dismissed:";

export function isMovePromptDismissed(uid: string): boolean {
  try {
    return localStorage.getItem(MOVE_DISMISSED_PREFIX + uid) !== null;
  } catch {
    return false;
  }
}

export function dismissMovePrompt(uid: string): void {
  try {
    localStorage.setItem(MOVE_DISMISSED_PREFIX + uid, "1");
  } catch {
    /* storage unavailable — the prompt shows again next visit */
  }
}

/** Forgets every account-related preference in this browser (after deleting the account). */
export function clearCloudLocalPrefs(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(MOVE_DISMISSED_PREFIX) || key === SIGNIN_EMAIL_KEY || key === REAUTH_FOR_DELETE_KEY)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore */
  }
}

const ACCOUNT_DELETED_KEY = "recipe-transcriber:account-deleted";

/** Session flag so the signed-out landing can confirm the deletion once. */
export function noteAccountDeleted(): void {
  try {
    sessionStorage.setItem(ACCOUNT_DELETED_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function consumeAccountDeleted(): boolean {
  try {
    const was = sessionStorage.getItem(ACCOUNT_DELETED_KEY) !== null;
    sessionStorage.removeItem(ACCOUNT_DELETED_KEY);
    return was;
  } catch {
    return false;
  }
}
