// Which speech model to pre-select on this device when the visitor hasn't chosen one.
// The large model is a ~760 MB download and, without WebGPU, slow; on phones, low-memory
// devices, or Data Saver the small (~300 MB) model is the better first experience. The
// visitor can still pick either in the download dialog or Settings — this only sets the
// default (backend/browser/settings.ts applies it when nothing is saved).

export interface DeviceFacts {
  mobile: boolean;
  /** navigator.deviceMemory in GB (Chromium only; null elsewhere). */
  deviceMemoryGb: number | null;
  /** navigator.connection.saveData (Chromium only). */
  saveData: boolean;
  webgpu: boolean;
}

export type SpeechModelSize = "large" | "small";

export interface SpeechModelRecommendation {
  size: SpeechModelSize;
  /** Why the small model was pre-selected, for the download dialog; null for "large". */
  reason: string | null;
}

export function recommendSpeechModel(d: DeviceFacts): SpeechModelRecommendation {
  if (d.mobile) return { size: "small", reason: "We picked the smaller model because you're on a phone." };
  if (d.saveData) return { size: "small", reason: "We picked the smaller model because Data Saver is on." };
  if (d.deviceMemoryGb !== null && d.deviceMemoryGb <= 4) {
    return { size: "small", reason: "We picked the smaller model because this device has limited memory." };
  }
  if (!d.webgpu) {
    return { size: "small", reason: "We picked the smaller model because this browser can't use the GPU for speech." };
  }
  return { size: "large", reason: null };
}

interface NavigatorLike {
  userAgent?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean };
  deviceMemory?: unknown;
  connection?: { saveData?: unknown };
  gpu?: unknown;
}

/** Reads the facts from `navigator` (pure given the input; safe outside a browser). */
export function readDeviceFacts(nav: NavigatorLike | undefined = globalThis.navigator as NavigatorLike | undefined): DeviceFacts {
  if (!nav) return { mobile: false, deviceMemoryGb: null, saveData: false, webgpu: false };
  const ua = nav.userAgent ?? "";
  // iPadOS reports a desktop Safari UA; touch points give it away.
  const iPadOs = /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
  const mobile =
    nav.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || iPadOs;
  const mem = nav.deviceMemory;
  return {
    mobile,
    deviceMemoryGb: typeof mem === "number" && Number.isFinite(mem) ? mem : null,
    saveData: nav.connection?.saveData === true,
    webgpu: Boolean(nav.gpu),
  };
}
