/**
 * Reports/claims (POST /public/:id/report) and the admin queue + actions
 * (GET /admin/queue, POST /admin/public/:id). Contract: shared/public.ts.
 *
 * Logging: report_created / admin_action events carry ids and kinds only — never the
 * reason, contact email, or IP (Cloud Monitoring alerts key on the event names).
 */
import { createHash } from "node:crypto";
import {
  type AdminActionRequest,
  type AdminQueueResponse,
  COLLECTIONS,
  MAX_REPORTS_PER_DAY,
  PUBLIC_COLLECTIONS,
  PublicRecipeDoc,
  ReportDoc,
  type ReportRequest,
} from "@recipe/shared";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { DocumentReference, DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { profileFromToken } from "./auth";
import { appError } from "./errors";
import type { Logger } from "./log";
import { claimedSourceRef, publicRef, userRef } from "./publish";
import { countUserActionOrThrow, readDayCount, tryCount, writeUserFields } from "./ratelimit";
import { secondsUntilNextUtcMidnight } from "./time";
import { RECIPE_ID_PATTERN } from "./validation";

/**
 * The client IP as Cloud Run reports it: the LAST X-Forwarded-For hop. A client can send
 * its own X-Forwarded-For; Google appends the address it actually saw, so earlier hops are
 * client-controlled and only the last one can be trusted (we serve from *.run.app with no
 * load balancer in front, so there's no proxy hop after it). Only ever used hashed.
 */
export function clientIp(forwardedFor: string | undefined | null): string {
  const hops = (forwardedFor ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const last = hops[hops.length - 1];
  return last ? last.slice(0, 100) : "unknown";
}

/** sha256(salt, ip) — the raw IP is never stored or logged. */
export function hashIp(salt: string, ip: string): string {
  return createHash("sha256").update(salt).update("\0").update(ip).digest("hex").slice(0, 40);
}

function ipCounterRef(db: Firestore, ipHash: string): DocumentReference {
  return db.collection(COLLECTIONS.system).doc(`report-ip-${ipHash}`);
}

const CLAIM_NEEDS_CONTACT = "Please add an email address so we can reach you about your claim.";

export interface ReportContext {
  db: Firestore;
  logger: Logger;
  now: Date;
  reportSalt: string;
}

export async function createReport(
  ctx: ReportContext,
  user: DecodedIdToken | null,
  ip: string,
  id: string,
  body: ReportRequest,
): Promise<void> {
  const { db, now } = ctx;
  if (!RECIPE_ID_PATTERN.test(id)) throw appError("not_found");
  if (body.kind === "claim" && !body.contact) throw appError("bad_request", null, CLAIM_NEEDS_CONTACT);

  const ipRef = ipCounterRef(db, hashIp(ctx.reportSalt, ip));
  const uRef = user ? userRef(db, user.uid) : null;
  const reportRef = db.collection(PUBLIC_COLLECTIONS.reports).doc();

  await db.runTransaction(async (tx) => {
    const refs = [publicRef(db, id), ipRef, ...(uRef ? [uRef] : [])];
    const [pSnap, ipSnap, uSnap] = (await tx.getAll(...refs)) as [DocumentSnapshot, DocumentSnapshot, DocumentSnapshot?];
    if (!pSnap.exists) throw appError("not_found");

    const ipCount = tryCount(readDayCount(ipSnap.data()), now, MAX_REPORTS_PER_DAY);
    if (!ipCount.ok) throw appError("rate_limited", secondsUntilNextUtcMidnight(now));
    const userCount = uSnap ? countUserActionOrThrow(uSnap, "reports", MAX_REPORTS_PER_DAY, now) : null;

    // expiresAt lets a Firestore TTL policy on `system` clean up stale per-IP counters.
    tx.set(ipRef, { ...ipCount.state, expiresAt: new Date(now.getTime() + 2 * 24 * 3600 * 1000) });
    if (uRef && uSnap && userCount) {
      writeUserFields(tx, uRef, uSnap, profileFromToken(user!), now, { counter: { name: "reports", state: userCount } });
    }
    const report: ReportDoc = {
      publicRecipeId: id,
      kind: body.kind,
      reason: body.reason,
      contact: body.contact ?? null,
      reporterUid: user?.uid ?? null,
      status: "open",
      createdAt: now.toISOString(),
      resolvedAt: null,
      resolution: null,
    };
    tx.create(reportRef, report);
  });

  ctx.logger.log("WARNING", "report created", { event: "report_created", kind: body.kind, publicRecipeId: id });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export function isAdminToken(token: DecodedIdToken): boolean {
  return (token as { admin?: unknown }).admin === true;
}

/** Max open reports returned; the queue is meant to be worked down, not paged. */
export const ADMIN_QUEUE_LIMIT = 200;

/**
 * Open reports, newest first, each with its public recipe (null if since deleted). Sorted
 * in memory: a single-field equality query needs no composite index.
 */
export async function adminQueue(db: Firestore): Promise<AdminQueueResponse> {
  const snap = await db.collection(PUBLIC_COLLECTIONS.reports).where("status", "==", "open").limit(1000).get();
  const reports = snap.docs
    .flatMap((d) => {
      const parsed = ReportDoc.safeParse(d.data());
      return parsed.success ? [{ ...parsed.data, id: d.id }] : [];
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, ADMIN_QUEUE_LIMIT);

  const ids = [...new Set(reports.map((r) => r.publicRecipeId))].filter((id) => RECIPE_ID_PATTERN.test(id));
  const recipes = new Map<string, AdminQueueResponse["items"][number]["publicRecipe"]>();
  if (ids.length > 0) {
    const snaps = await db.getAll(...ids.map((id) => publicRef(db, id)));
    for (const s of snaps) {
      const parsed = PublicRecipeDoc.safeParse(s.data());
      recipes.set(s.id, parsed.success ? { ...parsed.data, id: s.id } : null);
    }
  }
  return { items: reports.map((report) => ({ report, publicRecipe: recipes.get(report.publicRecipeId) ?? null })) };
}

const RESOLUTION = { hide: "hidden", restore: "restored", dismiss: "dismissed" } as const;

/** hide → status "hidden"; restore → "live"; dismiss → only resolves the report. */
export async function adminAction(
  db: Firestore,
  logger: Logger,
  id: string,
  body: AdminActionRequest,
  now: Date,
): Promise<void> {
  if (!RECIPE_ID_PATTERN.test(id)) throw appError("not_found");
  if (body.reportId !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(body.reportId)) {
    throw appError("not_found", null, "That report wasn't found.");
  }
  if (body.action === "dismiss" && !body.reportId) {
    throw appError("bad_request", null, "Dismiss needs the report to dismiss.");
  }
  const pRef = publicRef(db, id);
  const reportRef = body.reportId ? db.collection(PUBLIC_COLLECTIONS.reports).doc(body.reportId) : null;

  await db.runTransaction(async (tx) => {
    const pSnap = await tx.get(pRef);
    const rSnap = reportRef ? await tx.get(reportRef) : null;
    if (rSnap && (!rSnap.exists || (rSnap.data() as { publicRecipeId?: unknown }).publicRecipeId !== id)) {
      throw appError("not_found", null, "That report wasn't found.");
    }

    if (body.action !== "dismiss") {
      if (!pSnap.exists) throw appError("not_found");
      const restoring = body.action === "restore";
      // Restoring a public video re-claims its source mapping if nobody else holds it.
      const parsed = PublicRecipeDoc.pick({ visibility: true, source: true }).safeParse(pSnap.data());
      const keyRef = restoring && parsed.success ? claimedSourceRef(db, parsed.data) : null;
      const mapping = keyRef ? await tx.get(keyRef) : null;

      tx.update(pRef, { status: restoring ? "live" : "hidden" });
      if (keyRef && mapping && !mapping.exists) tx.set(keyRef, { publicRecipeId: id });
    }

    if (reportRef) {
      tx.update(reportRef, {
        status: "resolved",
        resolvedAt: now.toISOString(),
        resolution: RESOLUTION[body.action],
        // Not part of ReportDoc (shared/public.ts); kept on the doc for the record only.
        resolutionNote: body.note ?? null,
      });
    }
  });

  logger.log("INFO", "admin action", { event: "admin_action", action: body.action, publicRecipeId: id });
}
