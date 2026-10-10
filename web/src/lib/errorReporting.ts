// Privacy-safe error reports (contract: shared/telemetry.ts → POST /client-errors on the Cloud Run
// API, which logs one structured line and stores nothing). Cloud mode only: the cloud runtime
// registers the sender (backend/cloud/index.ts); in every other build nothing is ever sent.
//
// A report carries only: what kind of failure, the stage it happened in, an error name/code, a
// scrubbed one-line message, the build mode/version, and coarse device facts (WebGPU present,
// device memory, mobile). Never transcripts, recipe text, file names, emails, ids or URLs —
// scrubMessage() below removes those, then the shared sanitizeErrorMessage() runs (the API runs it
// again). Reporting never throws, never blocks the UI (fire-and-forget keepalive fetch), sends each
// distinct report once per page session, and at most MAX_REPORTS_PER_SESSION.

import { sanitizeErrorMessage, sanitizeLabel, scrubMessage, type ClientErrorKind, type ClientErrorReport } from "@recipe/shared";

export const MAX_REPORTS_PER_SESSION = 10;

export type ReportMode = ClientErrorReport["mode"];

export interface ErrorReportInput {
  kind: ClientErrorKind;
  stage?: string | null;
  code?: string | null;
  /** An Error, a message, or anything thrown. Only its scrubbed message is used. */
  error?: unknown;
}

export type ErrorReportSender = (report: ClientErrorReport) => Promise<unknown> | void;

// ---------------------------------------------------------------------------
// Building a report (pure)
// ---------------------------------------------------------------------------

// The scrubbing rules live in shared/telemetry.ts so the API re-applies exactly the same ones.
export { scrubMessage };

export function cleanMessage(message: string): string {
  return sanitizeErrorMessage(message); // includes scrubMessage
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const m = (error as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  return error === undefined || error === null ? "" : "Non-error value thrown";
}

/** An error's name or code, if it has a short, code-like one ("AbortError", "quota_exceeded"). */
export function errorCodeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const e = error as { code?: unknown; name?: unknown };
  for (const candidate of [e.code, e.name]) {
    if (typeof candidate === "string" && /^[\w./-]{1,60}$/.test(candidate) && candidate !== "Error") return candidate;
  }
  // Numeric codes last (a DOMException's legacy code, 22, says less than its name).
  if (typeof e.code === "number" && Number.isFinite(e.code)) return String(e.code);
  return null;
}

export interface DeviceFacts {
  userAgent: string;
  webgpu: boolean | null;
  deviceMemoryGb: number | null;
  mobile: boolean;
}

type NavigatorLike = {
  userAgent?: string;
  gpu?: unknown;
  deviceMemory?: unknown;
  userAgentData?: { mobile?: unknown } | null;
};

export function deviceFacts(nav: NavigatorLike | null = typeof navigator === "undefined" ? null : navigator): DeviceFacts {
  if (!nav) return { userAgent: "", webgpu: null, deviceMemoryGb: null, mobile: false };
  const userAgent = typeof nav.userAgent === "string" ? nav.userAgent.slice(0, 300) : "";
  const uaMobile = nav.userAgentData && typeof nav.userAgentData.mobile === "boolean" ? nav.userAgentData.mobile : null;
  return {
    userAgent,
    webgpu: "gpu" in nav ? !!nav.gpu : false,
    deviceMemoryGb: typeof nav.deviceMemory === "number" && Number.isFinite(nav.deviceMemory) ? nav.deviceMemory : null,
    mobile: uaMobile ?? /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent),
  };
}

export function currentMode(): ReportMode {
  const b = import.meta.env.VITE_BACKEND;
  return b === "browser" || b === "hosted" || b === "cloud" ? b : "server";
}

export function appVersion(): string {
  return (typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "dev").slice(0, 40);
}

/** Stage and code come from our own code (status names, error names, route templates), so they
 * get the label sanitizer — the message scrubbing would mangle "POST /admin/queue". */
function cleanField(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const cleaned = sanitizeLabel(value).slice(0, max);
  return cleaned || null;
}

export function buildReport(
  input: ErrorReportInput,
  env: { mode: ReportMode; appVersion: string; device: DeviceFacts },
): ClientErrorReport {
  return {
    kind: input.kind,
    stage: cleanField(input.stage, 40),
    code: cleanField(input.code ?? errorCodeOf(input.error), 60),
    message: cleanMessage(errorMessageOf(input.error)),
    mode: env.mode,
    appVersion: env.appVersion.slice(0, 40),
    device: {
      userAgent: env.device.userAgent.slice(0, 300),
      webgpu: env.device.webgpu,
      deviceMemoryGb: env.device.deviceMemoryGb,
      mobile: env.device.mobile,
    },
  };
}

// ---------------------------------------------------------------------------
// The reporter (dedupe, cap, fire-and-forget)
// ---------------------------------------------------------------------------

export interface ErrorReporter {
  report(input: ErrorReportInput): void;
  setSender(sender: ErrorReportSender | null): void;
  /** Marks an error as already reported, so a wrapper that sees it later skips it. */
  markReported(error: unknown): void;
  wasReported(error: unknown): boolean;
}

export function createErrorReporter(options: {
  enabled: boolean;
  env: () => { mode: ReportMode; appVersion: string; device: DeviceFacts };
  max?: number;
}): ErrorReporter {
  const max = options.max ?? MAX_REPORTS_PER_SESSION;
  const seen = new Set<string>();
  const reported = new WeakSet<object>();
  let sender: ErrorReportSender | null = null;
  let pending: ClientErrorReport[] = []; // reports made before the sender was registered
  let count = 0;

  function send(report: ClientErrorReport) {
    if (!sender) {
      pending.push(report);
      return;
    }
    try {
      const result = sender(report);
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch(() => undefined);
      }
    } catch {
      /* never let reporting break anything */
    }
  }

  return {
    report(input) {
      if (!options.enabled) return;
      try {
        if (input.error !== null && typeof input.error === "object") {
          if (reported.has(input.error)) return;
          reported.add(input.error);
        }
        const report = buildReport(input, options.env());
        const key = [report.kind, report.stage, report.code, report.message].join("|");
        if (seen.has(key) || count >= max) return;
        seen.add(key);
        count++;
        send(report);
      } catch {
        /* never throw */
      }
    },
    setSender(next) {
      sender = next;
      if (!next) return;
      const queued = pending;
      pending = [];
      for (const r of queued) send(r);
    },
    markReported(error) {
      if (error !== null && typeof error === "object") reported.add(error);
    },
    wasReported(error) {
      return error !== null && typeof error === "object" && reported.has(error);
    },
  };
}

/** The app's reporter: enabled only in the cloud build (the only one with an API to send to). */
export const errorReporter: ErrorReporter = createErrorReporter({
  enabled: import.meta.env.VITE_BACKEND === "cloud",
  env: () => ({ mode: currentMode(), appVersion: appVersion(), device: deviceFacts() }),
});

export function reportError(input: ErrorReportInput): void {
  errorReporter.report(input);
}

let globalHandlersInstalled = false;

/** window "error" + "unhandledrejection" → kind "uncaught". Cross-origin "Script error." (no
 * details) and benign ResizeObserver loop notices are skipped. */
export function installGlobalErrorHandlers(target: Window = window, reporter: ErrorReporter = errorReporter): void {
  if (globalHandlersInstalled && reporter === errorReporter) return;
  if (reporter === errorReporter) globalHandlersInstalled = true;
  target.addEventListener("error", (event: ErrorEvent) => {
    const message = event.error instanceof Error ? event.error.message : event.message;
    if (!message || /^script error\.?$/i.test(message) || /ResizeObserver loop/i.test(message)) return;
    reporter.report({ kind: "uncaught", stage: "error", error: event.error ?? message });
  });
  target.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    if (reason instanceof DOMException && reason.name === "AbortError") return;
    reporter.report({ kind: "uncaught", stage: "unhandledrejection", error: reason });
  });
}
