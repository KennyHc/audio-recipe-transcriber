// Cloud mode: the HTTP client for the Cloud Run API (contract: shared/cloud.ts). Every request
// carries the Firebase ID token and an App Check token; responses and errors are validated with
// the shared zod schemas. Token getters are injected so this is testable without Firebase.

import {
  APP_CHECK_HEADER,
  AdminQueueResponse,
  CloudError,
  CopyResponse,
  CreateRecipeResponse,
  EngagementResponse,
  ImportResponse,
  MeResponse,
  PublishResponse,
  PublishSuggestionsResponse,
  ReextractResponse,
  SourcePreview,
  type AdminActionRequest,
  type CreateRecipeRequest,
  type ImportRequest,
  type PublishRequest,
  type PublishSuggestionsRequest,
  type ReportRequest,
} from "@recipe/shared";
import { CloudApiError, friendlyCloudMessage } from "./errors";

interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export interface ApiClientDeps {
  baseUrl: string;
  /** Resolves the signed-in user's ID token; `forceRefresh` after a reauthentication. Throws
   * (or resolves null) when signed out. */
  getIdToken(forceRefresh?: boolean): Promise<string | null>;
  /** Signed out? (For the routes that also work without an account, e.g. reports.) */
  isSignedIn?(): boolean;
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

  // Phase 2 (shared/public.ts)
  previewSource(url: string): Promise<SourcePreview>;
  publish(id: string, body: PublishRequest): Promise<PublishResponse>;
  /** Publish-dialog hints (suggested tags, wrong-link warning). Fails soft on the server. */
  publishSuggestions(id: string, body: PublishSuggestionsRequest): Promise<PublishSuggestionsResponse>;
  unpublish(id: string): Promise<void>;
  setLike(publicId: string, liked: boolean): Promise<EngagementResponse>;
  setSave(publicId: string, saved: boolean): Promise<EngagementResponse>;
  copyPublic(publicId: string): Promise<CopyResponse>;
  /** Works signed out (App Check only); sends the ID token when there is one. */
  report(publicId: string, body: ReportRequest): Promise<void>;
  adminQueue(): Promise<AdminQueueResponse>;
  adminAction(publicId: string, body: AdminActionRequest): Promise<void>;
}

type Method = "GET" | "POST" | "DELETE";

interface RequestOptions {
  forceRefreshToken?: boolean;
  /** "optional": send the ID token only when signed in (public routes). */
  auth?: "required" | "optional";
}

const enc = encodeURIComponent;

export function createApiClient(deps: ApiClientDeps): ApiClient {
  const base = deps.baseUrl.replace(/\/+$/, "");
  const doFetch = deps.fetch ?? ((input, init) => fetch(input, init));

  async function idTokenFor(options: RequestOptions): Promise<string | null> {
    if (options.auth === "optional" && deps.isSignedIn && !deps.isSignedIn()) return null;
    const token = await deps.getIdToken(options.forceRefreshToken ?? false);
    if (!token && options.auth !== "optional") throw new Error("Sign in to continue.");
    return token || null;
  }

  async function request<T>(
    method: Method,
    path: string,
    schema: Schema<T> | null,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const [idToken, appCheckToken] = await Promise.all([idTokenFor(options), deps.getAppCheckToken()]);
    const headers: Record<string, string> = { [APP_CHECK_HEADER]: appCheckToken };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
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
        const { code, error, retryAfterSeconds, existingPublicId } = parsed.data;
        const message = friendlyCloudMessage(code, { serverMessage: error, retryAfterSeconds, limit: deps.knownLimit?.() });
        throw new CloudApiError(code, message, response.status, retryAfterSeconds, existingPublicId ?? null);
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
    reextract: (id) => request("POST", `/recipes/${enc(id)}/reextract`, ReextractResponse, {}),
    importJobs: (body) => request("POST", "/import", ImportResponse, body),
    getMe: () => request("GET", "/me", MeResponse),
    deleteMe: (options) =>
      request<void>("DELETE", "/me", null, undefined, { forceRefreshToken: options?.forceRefreshToken ?? false }),

    previewSource: (url) => request("GET", `/sources/preview?url=${encodeURIComponent(url)}`, SourcePreview),
    publish: (id, body) => request("POST", `/recipes/${enc(id)}/publish`, PublishResponse, body),
    publishSuggestions: (id, body) =>
      request("POST", `/recipes/${enc(id)}/publish/suggestions`, PublishSuggestionsResponse, body),
    unpublish: (id) => request<void>("DELETE", `/recipes/${enc(id)}/publish`, null),
    setLike: (publicId, liked) => request(liked ? "POST" : "DELETE", `/public/${enc(publicId)}/like`, EngagementResponse, liked ? {} : undefined),
    setSave: (publicId, saved) => request(saved ? "POST" : "DELETE", `/public/${enc(publicId)}/save`, EngagementResponse, saved ? {} : undefined),
    copyPublic: (publicId) => request("POST", `/public/${enc(publicId)}/copy`, CopyResponse, {}),
    report: (publicId, body) => request<void>("POST", `/public/${enc(publicId)}/report`, null, body, { auth: "optional" }),
    adminQueue: () => request("GET", "/admin/queue", AdminQueueResponse),
    adminAction: (publicId, body) => request<void>("POST", `/admin/public/${enc(publicId)}`, null, body),
  };
}
