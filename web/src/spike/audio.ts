// Decode an audio Blob/ArrayBuffer with the Web Audio API and resample to
// 16kHz mono Float32Array — the input format transformers.js Whisper expects.
// No ffmpeg involved; this is the "can the browser alone do it" spike.
const TARGET_SAMPLE_RATE = 16_000;

export async function decodeTo16kMono(arrayBuffer: ArrayBuffer): Promise<{ audio: Float32Array; durationS: number }> {
  // Decode at native rate first using a throwaway AudioContext.
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await decodeCtx.close();
  }

  const durationS = decoded.duration;
  const targetLength = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  const offlineCtx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;

  // Downmix to mono if the source has multiple channels: OfflineAudioContext
  // with 1 output channel does this automatically when connecting a
  // multi-channel source directly.
  source.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  const audio = rendered.getChannelData(0).slice();
  return { audio, durationS };
}
