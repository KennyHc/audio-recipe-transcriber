// Decode an audio Blob/ArrayBuffer with the Web Audio API and resample to
// 16kHz mono Float32Array — the input format transformers.js Whisper expects.
// Adapted from web/src/spike/audio.ts (the throwaway spike this productionises).
const TARGET_SAMPLE_RATE = 16_000;

export class AudioDecodeError extends Error {}

export interface DecodedAudio {
  audio: Float32Array;
  durationS: number;
}

export async function decodeTo16kMono(arrayBuffer: ArrayBuffer): Promise<DecodedAudio> {
  // Decode at native rate first using a throwaway AudioContext.
  const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new AudioDecodeError("This browser does not support the Web Audio API needed to decode audio.");
  }

  const decodeCtx = new AudioContextCtor();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } catch (err) {
    throw new AudioDecodeError(
      `Could not decode this audio file — it may be corrupt or in an unsupported format. (${err instanceof Error ? err.message : String(err)})`,
    );
  } finally {
    await decodeCtx.close().catch(() => undefined);
  }

  if (decoded.duration <= 0 || decoded.length === 0) {
    throw new AudioDecodeError("The decoded audio is empty.");
  }

  const durationS = decoded.duration;
  const targetLength = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);

  let rendered: AudioBuffer;
  try {
    const offlineCtx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
    const source = offlineCtx.createBufferSource();
    source.buffer = decoded;
    // Downmix to mono if the source has multiple channels: OfflineAudioContext
    // with 1 output channel does this automatically when connecting a
    // multi-channel source directly.
    source.connect(offlineCtx.destination);
    source.start(0);
    rendered = await offlineCtx.startRendering();
  } catch (err) {
    throw new AudioDecodeError(
      `Could not resample this audio to 16kHz mono. (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const audio = rendered.getChannelData(0).slice();
  return { audio, durationS };
}
