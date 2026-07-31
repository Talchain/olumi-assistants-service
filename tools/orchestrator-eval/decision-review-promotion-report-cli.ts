/**
 * Generate the committed decision_review PROMOTION REPORT from the frozen
 * live-capture scoring of the CURRENTLY-SERVED prompt. One-shot producer,
 * deterministic, zero network:
 *
 *   pnpm eval:decision-review:promotion-report
 *
 * Reads the capture, hashes the served canonical prompt, and writes
 * reports/promotion/decision_review.json. Re-running it reproduces the committed
 * artifact byte-for-byte (except `generatedAt`, which is pinned to the capture
 * date so the artifact is stable).
 *
 * ── WHY THIS FILE POINTS AT A CAPTURE DIRECTORY, AND WHY THAT MOVES ──────────
 *
 * The capture is the CORPUS the report aggregates, so it must always be the one
 * taken against the bytes the manifest records as served. When a prompt is
 * promoted, BOTH move together: the canonical export and this pointer. A pointer
 * left on the previous prompt's capture would regenerate a report describing a
 * prompt that is no longer served — the promotion-report equivalent of the
 * hardcoded-provenance defect this pipeline already had once
 * (`promotion-report.ts`, fixed 2026-07-31).
 *
 * The previous capture is NOT deleted. `reports/decision-review-v14-baseline-
 * 2026-07-31/` stays in the tree as the before-state of the v14→v15 comparison.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDecisionReviewPromotionReport,
  type LiveCaptureReport,
} from './src/decision-review/promotion-report.js';
import { promptHash16 } from './src/promotion-gate/manifest.js';
import { readServedPromptText } from './src/decision-review/served-contract.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_CAPTURE = join(
  HERE,
  'reports',
  'decision-review-v15-2026-07-31',
  'live-capture-report.json',
);
const OUT_DIR = join(HERE, 'reports', 'promotion');
const OUT = join(OUT_DIR, 'decision_review.json');

const capture = JSON.parse(readFileSync(LIVE_CAPTURE, 'utf-8')) as LiveCaptureReport;
const servedSha16 = promptHash16(readServedPromptText());

// FAIL LOUD on a capture/export mismatch. The gate would catch this later as
// MANIFEST_EXPORT_SKEW, but by then the report is already written and a human is
// reading a green-looking artifact built over the wrong bytes.
if (capture.servedHash !== servedSha16) {
  throw new Error(
    `capture was scored against prompt ${capture.servedHash}, but the canonical export now hashes ` +
      `to ${servedSha16}. Refusing to emit a report that would claim the wrong corpus. Either ` +
      're-run the eval against the current export, or point LIVE_CAPTURE at the matching capture.',
  );
}

const report = buildDecisionReviewPromotionReport(capture, {
  candidateLabel: 'served_v15',
  promptSha16: servedSha16,
  // Provenance is a REQUIRED input, not a literal inside the builder — this CLI
  // states the corpus IT reads, and any other caller states its own.
  evidenceSource:
    'fix-decision-review-v15 lane: n=21 = 7 committed fixtures x 3 independent arms, OFFLINE against ' +
    'fixtures (zero staging traffic), scored by the shipped 19-dimension pack — ' +
    'reports/decision-review-v15-2026-07-31/live-capture-report.json. Raw per-call model text, ' +
    'latency and token counts: PHASE0-EVIDENCE-2026-07-28/fix-decision-review-v15-artifacts/runs-final2/.',
  model: 'gpt-4.1',
  // Pinned to the capture date, not "now": the outputs are frozen, so the report
  // is a frozen observation. (The gate's expiry window is measured against this.)
  generatedAt: '2026-07-31T00:00:00.000Z',
  extraEvidence: {
    baseline_compared:
      'PMS row 14 (b4f15305c2bb32e9) at the same n, same fixtures, same scorer: 7/21 clean outputs, ' +
      '18 failing dimension-observations. This prompt: 21/21 clean, 0 failing.',
    contract_parity:
      'The DERIVED scoring contract is byte-identical across row 14 and row 15 — same 10 banned terms, ' +
      'same 21 internal-vocabulary terms, same em-dash ban, same 4 tone rows ' +
      '(parseServedTerminologyContract / parseToneTable). The measuring instrument did not move.',
    sampling_posture:
      'provider DEFAULT sampling, and that IS production for this model: invoke.ts:505 passes ' +
      'temperature 0 but buildModelParams (adapters/llm/openai.ts:155-198) drops it on the ' +
      'requiresMaxCompletionTokens branch that gpt-4.1 takes.',
    caveat_in_sample:
      'THE 21/21 IS IN-SAMPLE. Nothing was held out: the three prompt iterations were each tuned ' +
      'against these same 7 fixtures, so this measures compliance on the corpus that shaped it. ' +
      'The out-of-sample check is the live witness on real staging turns, recorded separately.',
    caveat_unit_branch:
      'The flip-threshold contract has two branches. The unitless [0,1] -> percentage branch is ' +
      'measured on 3 fixtures x 3 arms; the unit-bearing -> verbatim-with-unit branch is measured on ' +
      'ONE fixture (06, fac_cac, 420/610 GBP) x 3 arms. Before this lane the unit branch was measured ' +
      'by NOTHING. One fixture is coverage, not confidence.',
    live_witness_out_of_sample:
      'THE OUT-OF-SAMPLE CHECK, AND IT IS NOT CLEAN — recorded here rather than beside the report, ' +
      'because a corpus caveat that lives in a separate document is a caveat nobody reads. Three real ' +
      'turns were driven against the DEPLOYED service on the live path ' +
      '(POST /assist/v1/decision-review, cee-staging, PMS-resolved prompt, real model config, ' +
      'SCIENCE_CLAIMS injected and responseFormat json_object — two things the offline harness does ' +
      'NOT do), then scored with this same shipped scorer. Result: 47 measured dimension-rows across ' +
      'the three turns, ONE failure. Clean on every defect this prompt revision targeted — zero ' +
      'readiness echoes, zero em dashes, zero bare probability decimals, and BOTH flip branches ' +
      'correct on the wire ("35%"/"62%" unitless, "420 GBP"/"610 GBP" unit-bearing). The one failure ' +
      'is no_banned_lexicon on 01-clear-winner: pre_mortem said "customer wins" and "win rates" — ' +
      'wins/win rate as ordinary business English, not as the banned "which option wins" sense. Same ' +
      'homonym class E1 already documented for "edge", and the matcher cannot tell the senses apart ' +
      'by construction. NOT a user-harm defect and NOT a regression against v14 (which was never ' +
      'witnessed on this path), but it IS a real scored failure that n=21 offline did not surface, ' +
      'and it means this report should be read as: clean in-sample, one known-class homonym ' +
      'out-of-sample. Rowed for a considered fix (prompt-side hardening vs scorer-side sense ' +
      'disambiguation is a design call, not a one-liner). Captures: ' +
      'PHASE0-EVIDENCE-2026-07-28/fix-decision-review-v15-artifacts/witness/.',
  },
  note:
    'FIRST report to clear the gate on its own evidence rather than a grandfather entry. The v14 ' +
    'grandfather entry is REMOVED in the same commit: the ratchet tightens.',
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(
  `decision_review promotion report -> ${OUT}\n  promptSha16 ${report.promptSha16} · verdict ${report.verdict} · n=${report.sampleSize}\n`,
);
