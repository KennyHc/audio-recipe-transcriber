import { ReportRequest } from "@recipe/shared";

export type ReportKind = "report" | "claim";

/** Builds and validates the POST /public/:id/report body (contact is required for claims). */
export function buildReportRequest(
  kind: ReportKind,
  reason: string,
  contact: string,
): { ok: true; body: ReportRequest } | { ok: false; error: string } {
  const r = reason.trim();
  const c = contact.trim();
  if (!r) return { ok: false, error: kind === "claim" ? "Tell us what you'd like us to do." : "Tell us what's wrong." };
  if (kind === "claim" && !c) return { ok: false, error: "Add an email so we can reach you." };
  const parsed = ReportRequest.safeParse({ kind, reason: r.slice(0, 2000), contact: c ? c : null });
  if (!parsed.success) return { ok: false, error: c ? "That email doesn't look right." : "Please check the form." };
  return { ok: true, body: parsed.data };
}
