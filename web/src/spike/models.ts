// Candidate models for the in-browser Whisper spike.
// Repo ids verified to exist on the Hub (huggingface.co/api/models?...) on 2026-09-28:
//   - Xenova/whisper-base          (multilingual)
//   - Xenova/whisper-base.en       (English-only)
//   - Xenova/whisper-small
//   - onnx-community/whisper-large-v3-turbo  (the closest available "large-v3-turbo";
//     openai/whisper-large-v3-turbo itself is not published as a transformers.js ONNX repo
//     under Xenova, so we use the onnx-community port, which is the one the transformers.js
//     docs/examples point to)
//
// dtype options per model were read from each repo's file listing (decoder/encoder
// *_<dtype>.onnx siblings) rather than guessed.
export interface ModelOption {
  id: string;
  label: string;
  /** dtypes available for this repo's onnx files, in the order we recommend trying them. */
  dtypes: string[];
  defaultDtype: string;
  notes?: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "Xenova/whisper-base",
    label: "whisper-base (multilingual)",
    dtypes: ["q8", "fp16", "fp32"],
    defaultDtype: "q8",
  },
  {
    id: "Xenova/whisper-base.en",
    label: "whisper-base.en (English only)",
    dtypes: ["q8", "fp16", "fp32"],
    defaultDtype: "q8",
  },
  {
    id: "Xenova/whisper-small",
    label: "whisper-small (multilingual)",
    dtypes: ["q8", "fp16", "fp32"],
    defaultDtype: "q8",
  },
  {
    id: "onnx-community/whisper-large-v3-turbo",
    label: "whisper-large-v3-turbo",
    dtypes: ["q4", "q4f16", "int8", "uint8", "fp16", "fp32"],
    defaultDtype: "q4",
    notes:
      "~1.6GB total in fp32; use q4/q4f16 to keep the download small (encoder+decoder well under 1.5GB combined).",
  },
];
