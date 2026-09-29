#!/usr/bin/env node
// Tiny word-error-rate calculator for the Whisper-in-browser spike.
// Usage: node wer.mjs <reference.json> <hypothesis.json>
// Both files are our Transcript shape ({ segments: [{ text, ... }] }).
// Text is lowercased, punctuation stripped, and whitespace-normalized before
// computing WER via standard Levenshtein alignment on word tokens.
import { readFileSync } from "node:fs";

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'’“”()\-–—[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function transcriptWords(path) {
  const data = JSON.parse(readFileSync(path, "utf-8"));
  const full = data.segments.map((s) => s.text).join(" ");
  const norm = normalize(full);
  return norm.length ? norm.split(" ") : [];
}

function wer(ref, hyp) {
  const n = ref.length;
  const m = hyp.length;
  // dp[i][j] = edit distance between ref[0..i) and hyp[0..j)
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (ref[i - 1] === hyp[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  const edits = dp[n][m];
  return { edits, refWords: n, wer: n === 0 ? 0 : edits / n };
}

const [, , refPath, hypPath] = process.argv;
if (!refPath || !hypPath) {
  console.error("Usage: node wer.mjs <reference.json> <hypothesis.json>");
  process.exit(1);
}

const ref = transcriptWords(refPath);
const hyp = transcriptWords(hypPath);
const result = wer(ref, hyp);

console.log(
  JSON.stringify(
    {
      reference: refPath,
      hypothesis: hypPath,
      refWords: result.refWords,
      hypWords: hyp.length,
      edits: result.edits,
      wer: Number((result.wer * 100).toFixed(2)) + "%",
    },
    null,
    2,
  ),
);
