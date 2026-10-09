/**
 * One-line JSON logs: Cloud Run forwards stdout/stderr to Cloud Logging, which parses a JSON
 * line into a structured entry (`severity` and `message` are recognised fields).
 *
 * Callers must only pass metadata: ids, counts, durations, codes. Never transcripts, recipe
 * bodies, tokens, or the API key — see errors.ts sanitizedErrorLog for error text.
 */

export type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR";
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  log(severity: Severity, message: string, fields?: LogFields): void;
}

export const jsonLogger: Logger = {
  log(severity, message, fields = {}) {
    const line = JSON.stringify({ severity, message, time: new Date().toISOString(), ...fields });
    if (severity === "ERROR" || severity === "WARNING") console.error(line);
    else console.log(line);
  },
};

export const silentLogger: Logger = { log() {} };
