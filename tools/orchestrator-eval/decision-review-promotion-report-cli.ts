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
  'decision-review-v16-2026-09-10',
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
  candidateLabel: 'served_v16',
  promptSha16: servedSha16,
  // Provenance is a REQUIRED input, not a literal inside the builder — this CLI
  // states the corpus IT reads, and any other caller states its own.
  evidenceSource:
    'decision-review-v16 lane, 2026-09-10: n=21 = 7 committed fixtures x 3 independent arms, ' +
    'OFFLINE against fixtures (zero staging traffic), claude-sonnet-5 with thinking DISABLED and ' +
    'provider-default sampling, scored by the shipped 20-dimension pack — ' +
    'reports/decision-review-v16-2026-09-10/live-capture-report.json. Raw per-call model text, ' +
    'latency and token counts: reports/decision-review-v16-2026-09-10/raw-arms/.',
  model: 'claude-sonnet-5',
  // Pinned to the capture date, not "now": the outputs are frozen, so the report
  // is a frozen observation. (The gate's expiry window is measured against this.)
  generatedAt: '2026-09-10T00:00:00.000Z',
  extraEvidence: {
    baseline_compared:
      'LIKE-FOR-LIKE, same 7 fixtures, same model, same day, same scorer. v15 arms vs the v15 ' +
      'contract: 17/21 parsed, 16/17 clean (1 no_internal_term_leak). v15 arms vs the v16 contract: ' +
      '17/21 parsed, 3/17 clean. This prompt: 21/21 parsed, 21/21 clean. The 4 unparsed v15 arms are ' +
      "the eval pack's own extractor (run.ts extractDecisionReviewOutput); the RUNTIME extractor " +
      '(extractJsonFromResponse) recovers all 21, so this is NOT a claim that v15 fails to parse in ' +
      'production.',
    baseline_caveat_the_incumbent_also_blocks:
      'THE COMMITTED v15 PASS REPORT IS gpt-4.1, JULY. Re-measured on 2026-09-10 against the model ' +
      'that actually serves this task (CEE_MODEL_DECISION_REVIEW=claude-sonnet-5, derived from the ' +
      'Render dashboard, not from YAML), the SERVED v15 prompt ALSO scores BLOCK. So the question ' +
      'this report answers is not "is v16 good enough where v15 was" — no prompt in this lineage had ' +
      'a passing measurement on the current model until this one.',
    contract_parity:
      'THE MEASURING INSTRUMENT DID MOVE, and it moved in the tightening direction only. Banned ' +
      'lexicon 10 -> 34 terms; internal vocabulary unchanged at 21; em-dash ban unchanged; 4 tone ' +
      'rows unchanged. The v15 FLOOR IS FULLY PRESERVED, derived rather than asserted: every v15 ' +
      'banned term, every v15 internal-vocabulary term and every v15 tone-row forbidden phrasing is ' +
      'present in this prompt (parseServedTerminologyContract / parseToneTable, run against both). ' +
      'That floor check is what caught the one guard the first draft of this rewrite dropped ' +
      '("clear lead" at the close_call tone row), and it is why the check now covers the TONE TABLE ' +
      'and not only the lexicon.',
    sampling_posture:
      'claude-sonnet-5, max_tokens 8192, thinking explicitly DISABLED, provider-default sampling, ' +
      'system = the canonical export verbatim. All 21 completions non-empty with stop_reason ' +
      'end_turn; an empty completion is a hard error in the harness, never a skipped sample.',
    caveat_in_sample:
      'THE 21/21 IS IN-SAMPLE. Nothing was held out: this prompt was iterated against these same 7 ' +
      'fixtures, so this measures compliance on the corpus that shaped it. There is NO out-of-sample ' +
      'live witness for v16 — the v15 report carried one; this one does not, and that gap is not ' +
      'filled by anything in this commit.',
    caveat_the_gate_cannot_certify_the_goal:
      "THE MOST IMPORTANT LIMITATION, AND IT BOUNDS THE 21/21. This revision exists to remove RACE " +
      'FRAMING, and the scorer CANNOT measure most of it. The banned lexicon is derived from ' +
      'DOUBLE-QUOTED tokens in the prompt, so the 34 quoted phrases are enforced — but FORM 1 ' +
      'deliberately leaves the bare words lead / leads / leading / ahead / behind / margin UNQUOTED ' +
      '(they can occur inside a factor label that must be copied verbatim), and FORMS 2, 3 and 4 ' +
      '(ordinals and idioms, comparison-as-a-quantity, position-as-subject) carry no quotable token ' +
      'at all. Measured on these same 21 arms: ZERO contain a quoted banned race phrase (the pack ' +
      'agrees, 0 failures), while FIVE contain a genuine unquoted breach — "close the gap on these ' +
      'numbers" (r1/05, r3/06), "stays ahead across a fair range" (r1/06), "to lead here" (r2/03), ' +
      '"to lead the comparison" (r2/06). Adjudicated by sense: the other hits on those words are ' +
      'ordinary English or factor labels ("Operating Margin", "ahead of launch", "engineering ' +
      'leads", an evidence "gap"), which is exactly why a word list cannot settle this and why ' +
      'quoting the bare words would fire on labels the prompt orders copied verbatim. SO: 21/21 ' +
      'clean means clean against the QUOTED subset. It is NOT evidence that race framing is gone. ' +
      'v16 measurably reduces it against v15 (14 of 17 v15 arms breach the QUOTED list alone); the ' +
      'residual is unmeasured by construction. Rowed rather than patched: adding terms per ' +
      'construction is the oscillation this estate has already paid for four times on one predicate.',
    caveat_unit_branch:
      'The flip-threshold contract has two branches. The unitless [0,1] -> percentage branch and the ' +
      'unit-bearing -> verbatim-with-unit branch (06, fac_cac, 420/610 GBP) are both exercised, the ' +
      'latter on ONE fixture x 3 arms. One fixture is coverage, not confidence.',
    revert_anchor_closes:
      'PROMOTING THIS CLOSES THE REVERT ANCHOR. Replacing the committed promotion report means the ' +
      'v15 prompt then reads BLOCK / HASH_MISMATCH against the gate, so staging CANNOT be re-pinned ' +
      'to version 15 from the admin API. The only revert is `git revert` of this commit plus a ' +
      'redeploy. This is a deliberate, stated cost of the promotion, not an oversight.',
  },
  note:
    'v16 promotion evidence. Read the caveat_the_gate_cannot_certify_the_goal entry before ' +
    'treating the clean score as proof that race framing is gone: it is not, and the report says ' +
    'so by name.',
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(
  `decision_review promotion report -> ${OUT}\n  promptSha16 ${report.promptSha16} · verdict ${report.verdict} · n=${report.sampleSize}\n`,
);
