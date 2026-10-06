import {
  ApiError,
  Job,
  Recipe,
  RecipeVersionMeta,
  RollbackRequest,
  Transcript,
  VersionedRecipe,
} from "@recipe/shared";
import { z } from "zod";

async function parseJson<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      const parsed = ApiError.safeParse(body);
      if (parsed.success) message = parsed.data.error;
    } catch {
      // ignore body parse failures, fall back to status text
    }
    throw new Error(message);
  }
  const body = await res.json();
  return schema.parse(body);
}

export const api = {
  async listJobs(): Promise<Job[]> {
    const res = await fetch("/api/jobs");
    return parseJson(res, z.array(Job));
  },

  async getJob(id: string): Promise<Job> {
    const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
    return parseJson(res, Job);
  },

  async getTranscript(id: string): Promise<Transcript> {
    const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/transcript`);
    return parseJson(res, Transcript);
  },

  async getRecipe(id: string): Promise<VersionedRecipe> {
    const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/recipe`);
    return parseJson(res, VersionedRecipe);
  },

  async putTranscript(id: string, transcript: Transcript): Promise<Transcript> {
    const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/transcript`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(transcript),
    });
    return parseJson(res, Transcript);
  },

  async putRecipe(id: string, recipe: Recipe): Promise<VersionedRecipe> {
    const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/recipe`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(recipe),
    });
    return parseJson(res, VersionedRecipe);
  },

  async listVersions(id: string): Promise<RecipeVersionMeta[]> {
    const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/recipe/versions`);
    return parseJson(res, z.array(RecipeVersionMeta));
  },

  async getVersion(id: string, version: number): Promise<VersionedRecipe> {
    const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/recipe/versions/${version}`);
    return parseJson(res, VersionedRecipe);
  },

  async rollback(id: string, version: number): Promise<VersionedRecipe> {
    const body: RollbackRequest = { version };
    const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/recipe/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseJson(res, VersionedRecipe);
  },

  async reextract(id: string): Promise<Job> {
    const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/reextract`, {
      method: "POST",
    });
    return parseJson(res, Job);
  },

  async retry(id: string): Promise<Job> {
    const res = await fetch(`/api/jobs/${encodeURIComponent(id)}/retry`, {
      method: "POST",
    });
    return parseJson(res, Job);
  },

  async deleteJob(id: string): Promise<void> {
    const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
      let message = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        const parsed = ApiError.safeParse(body);
        if (parsed.success) message = parsed.data.error;
      } catch {
        // ignore
      }
      throw new Error(message);
    }
  },

  audioUrl(id: string): string {
    return `/api/jobs/${encodeURIComponent(id)}/audio`;
  },

  /** Upload with progress via XHR (fetch has no upload progress events). */
  uploadAudio(
    file: File,
    onProgress: (fraction: number) => void,
  ): { promise: Promise<Job>; cancel: () => void } {
    const xhr = new XMLHttpRequest();
    const promise = new Promise<Job>((resolve, reject) => {
      const form = new FormData();
      form.append("audio", file);

      xhr.open("POST", "/api/jobs");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(Job.parse(body));
          } else {
            const parsed = ApiError.safeParse(body);
            reject(new Error(parsed.success ? parsed.data.error : `Upload failed (${xhr.status})`));
          }
        } catch (err) {
          reject(err instanceof Error ? err : new Error("Upload failed"));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.onabort = () => reject(new Error("Upload cancelled"));
      xhr.send(form);
    });
    return { promise, cancel: () => xhr.abort() };
  },
};
