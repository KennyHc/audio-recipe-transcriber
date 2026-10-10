/**
 * POST /client-errors — privacy-safe error reports from the browser (shared/telemetry.ts).
 * Nothing is stored in Firestore except a per-IP daily counter: each report becomes one
 * structured log line (`{"event":"client_error", …}`) in Cloud Logging. The message is
 * sanitized again here (never trust the client to have done it), and the user is identified
 * only as "signed in or not" — no uid, no IP.
 */
import {
  COLLECTIONS,
  type ClientErrorReport,
  MAX_CLIENT_ERRORS_PER_DAY,
  sanitizeErrorMessage,
  sanitizeLabel,
} from "@recipe/shared";
import type { Firestore } from "firebase-admin/firestore";
import { appError } from "./errors";
import type { Logger } from "./log";
import { hashIp } from "./moderation";
import { readDayCount, tryCount } from "./ratelimit";
import { secondsUntilNextUtcMidnight } from "./time";

export interface ClientErrorContext {
  db: Firestore;
  logger: Logger;
  now: Date;
  salt: string;
}

export async function recordClientError(
  ctx: ClientErrorContext,
  ip: string,
  signedIn: boolean,
  report: ClientErrorReport,
): Promise<void> {
  const { db, now } = ctx;
  // "client-error-ip-" (not "report-ip-") so error reports never eat into the report limit.
  const ref = db.collection(COLLECTIONS.system).doc(`client-error-ip-${hashIp(ctx.salt, ip)}`);
  await db.runTransaction(async (tx) => {
    const count = tryCount(readDayCount((await tx.get(ref)).data()), now, MAX_CLIENT_ERRORS_PER_DAY);
    if (!count.ok) throw appError("rate_limited", secondsUntilNextUtcMidnight(now));
    // expiresAt: the Firestore TTL policy on `system` deletes stale counters.
    tx.set(ref, { ...count.state, expiresAt: new Date(now.getTime() + 2 * 24 * 3600 * 1000) });
  });

  ctx.logger.log("WARNING", "client error", {
    event: "client_error",
    kind: report.kind,
    stage: report.stage === null ? null : sanitizeLabel(report.stage),
    code: report.code === null ? null : sanitizeLabel(report.code),
    message: sanitizeErrorMessage(report.message),
    mode: report.mode,
    appVersion: report.appVersion,
    signedIn,
    // Browser family + version and OS only; the full UA string isn't needed to debug.
    browser: summarizeUserAgent(report.device.userAgent),
    webgpu: report.device.webgpu,
    deviceMemoryGb: report.device.deviceMemoryGb,
    mobile: report.device.mobile,
  });
}

const BROWSERS: Array<[string, RegExp]> = [
  ["Edge", /Edg\/(\d+)/],
  ["Firefox", /Firefox\/(\d+)/],
  ["Chrome", /Chrome\/(\d+)/],
  ["Safari", /Version\/(\d+).*Safari/],
];
const SYSTEMS: Array<[string, RegExp]> = [
  ["iOS", /iPhone|iPad|iPod/],
  ["Android", /Android/],
  ["macOS", /Mac OS X|Macintosh/],
  ["Windows", /Windows/],
  ["Linux", /Linux/],
];

/** "Chrome 141 / macOS", "Safari 19 / iOS", … — coarse on purpose. */
export function summarizeUserAgent(ua: string): string {
  let browser = "Other";
  for (const [name, re] of BROWSERS) {
    const m = re.exec(ua);
    if (m) {
      browser = `${name} ${m[1]}`;
      break;
    }
  }
  const os = SYSTEMS.find(([, re]) => re.test(ua))?.[0] ?? "Other";
  return `${browser} / ${os}`;
}
