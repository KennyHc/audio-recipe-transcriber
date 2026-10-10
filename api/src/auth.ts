/**
 * Request authentication: Firebase ID token (who) + App Check token (from our app).
 * The verifiers are narrow interfaces over firebase-admin's Auth / AppCheck, so tests can
 * use the real Auth emulator or a fake.
 */
import { APP_CHECK_HEADER } from "@recipe/shared";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { MiddlewareHandler } from "hono";
import { appError } from "./errors";
import type { UserProfile } from "./users";

export interface AuthAdmin {
  verifyIdToken(idToken: string, checkRevoked?: boolean): Promise<DecodedIdToken>;
  deleteUser(uid: string): Promise<void>;
}

export interface AppCheckVerifier {
  verifyToken(appCheckToken: string): Promise<unknown>;
}

export type AuthVariables = { user: DecodedIdToken; optionalUser: DecodedIdToken | null };

/** Rejects requests without a valid App Check token (401 app_check_failed), unless disabled. */
export function requireAppCheck(verifier: AppCheckVerifier, required: boolean): MiddlewareHandler {
  return async (c, next) => {
    if (required) {
      const token = c.req.header(APP_CHECK_HEADER);
      if (!token) throw appError("app_check_failed");
      try {
        await verifier.verifyToken(token);
      } catch {
        throw appError("app_check_failed");
      }
    }
    await next();
  };
}

export interface RequireUserOptions {
  /** Also reject revoked tokens / disabled users (one extra Auth lookup). */
  checkRevoked?: boolean;
  /** Require a sign-in within this many seconds (sensitive actions like account deletion). */
  maxAuthAgeSeconds?: number;
  now: () => Date;
}

const STALE_SIGN_IN = "For your security, please sign in again to continue.";

/** Verifies `Authorization: Bearer <ID token>` and stores the decoded token as `user`. */
export function requireUser(
  auth: AuthAdmin,
  options: RequireUserOptions,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header("Authorization") ?? "");
    if (!match) throw appError("unauthenticated");

    let decoded: DecodedIdToken;
    try {
      decoded = await auth.verifyIdToken(match[1]!, options.checkRevoked ?? false);
    } catch {
      throw appError("unauthenticated");
    }

    if (options.maxAuthAgeSeconds !== undefined) {
      const ageSeconds = options.now().getTime() / 1000 - decoded.auth_time;
      if (!(ageSeconds <= options.maxAuthAgeSeconds)) throw appError("unauthenticated", null, STALE_SIGN_IN);
    }

    c.set("user", decoded);
    await next();
  };
}

/**
 * For routes that work signed out (reports): no Authorization header → optionalUser null;
 * a header that's present must be valid (401 otherwise), so a broken client is noticed.
 */
export function optionalUser(auth: AuthAdmin): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (header === undefined || header.trim() === "") {
      c.set("optionalUser", null);
      await next();
      return;
    }
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    if (!match) throw appError("unauthenticated");
    try {
      c.set("optionalUser", await auth.verifyIdToken(match[1]!, false));
    } catch {
      throw appError("unauthenticated");
    }
    await next();
  };
}

/** After requireUser: 403 forbidden unless the ID token carries the `admin` custom claim. */
export const requireAdmin: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
  if ((c.get("user") as { admin?: unknown }).admin !== true) throw appError("forbidden");
  await next();
};

export function profileFromToken(token: DecodedIdToken): UserProfile {
  const name: unknown = token.name;
  return {
    email: token.email ?? null,
    displayName: typeof name === "string" ? name : null,
    photoURL: token.picture ?? null,
  };
}
