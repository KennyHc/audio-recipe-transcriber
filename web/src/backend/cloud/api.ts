// Cloud mode: the HTTP client for the Cloud Run API (contract: shared/cloud.ts). Every request
// carries the Firebase ID token and an App Check token; responses and errors are validated with
// the shared zod schemas. Token getters are injected so this is testable without Firebase.

import {
  APP_CHECK_HEADER,
  CloudError,
  CreateRecipeResponse,
  ImportResponse,
  MeResponse,
  ReextractResponse,
  type CreateRecipeRequest,
  type ImportRequest,
} from "@recipe/shared";
import { CloudApiError, friendlyCloudMessage } from "./errors";

interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export interface ApiClientDeps {
  baseUrl: string;
  /** Resolves the signed-in user's ID token; `forceRefresh` after a reauthentication. */
  getIdToken(forceRefresh?: boolean): Promise<string>;
  getAppCheckToken(): Promise<string>;
  /** The monthly limit, if known, for the quota message. */
  knownLimit?(): number | undefined;
  fetch?: typeof fetch;
}

export interface ApiClient {
  createRecipe(body: CreateRecipeRequest): Promise<CreateRecipeResponse>;
  reextract(id: string): Promise<ReextractResponse>;
  importJobs(body: ImportRequest): Promise<ImportResponse>;
  getMe(): Promise<MeResponse>;
  deleteMe(options?: { forceRefreshToken?: boolean }): Promise<void>;
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  const base = deps.baseUrl.replace(/\/+$/, "");
  const doFetch = deps.fetch ?? ((input, init) => fetch(input, init));

  async function request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    schema: Schema<T> | null,
    body?: unknown,
    forceRefreshToken = false,
  ): Promise<T> {
    const [idToken, appCheckToken] = await Promise.all([deps.getIdToken(forceRefreshToken), deps.getAppCheckToken()]);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${idToken}`,
      [APP_CHECK_HEADER]: appCheckToken,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new CloudApiError("network", friendlyCloudMessage("network"), 0);
    }

    if (!response.ok) {
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        /* not JSON (e.g. a proxy's HTML error page) */
      }
      const parsed = CloudError.safeParse(payload);
      if (parsed.success) {
        const { code, error, retryAfterSeconds } = parsed.data;
        const message = friendlyCloudMessage(code, { serverMessage: error, retryAfterSeconds, limit: deps.knownLimit?.() });
        throw new CloudApiError(code, message, response.status, retryAfterSeconds);
      }
      const fallback = response.status >= 500 ? "internal" : "bad_response";
      throw new CloudApiError(fallback, friendlyCloudMessage(fallback), response.status);
    }

    if (schema === null) return undefined as T;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new CloudApiError("bad_response", friendlyCloudMessage("bad_response"), response.status);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new CloudApiError("bad_response", friendlyCloudMessage("bad_response"), response.status);
    }
    return parsed.data;
  }

  return {
    createRecipe: (body) => request("POST", "/recipes", CreateRecipeResponse, body),
    reextract: (id) => request("POST", `/recipes/${encodeURIComponent(id)}/reextract`, ReextractResponse, {}),
    importJobs: (body) => request("POST", "/import", ImportResponse, body),
    getMe: () => request("GET", "/me", MeResponse),
    deleteMe: (options) => request<void>("DELETE", "/me", null, undefined, options?.forceRefreshToken ?? false),
  };
}
