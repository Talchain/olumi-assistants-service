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
  'decision-review-v17-2026-10-05',
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
  candidateLabel: 'served_v17',
  promptSha16: servedSha16,
  // Provenance is a REQUIRED input, not a literal inside the builder — this CLI
  // states the corpus IT reads, and any other caller states its own.
  evidenceSource:
    'decision-review-v17 lane (WORDING P3), 2026-10-05: n=21 = 7 committed fixtures x 3 independent arms, ' +
    'OFFLINE against fixtures (zero staging traffic), claude-sonnet-5 with thinking DISABLED and ' +
    'provider-default sampling, scored by the shipped pack — ' +
    'reports/decision-review-v17-2026-10-05/live-capture-report.json. Raw per-call model text, ' +
    'latency and token counts: reports/decision-review-v17-2026-10-05/raw-arms/.',
  model: 'claude-sonnet-5',
  // Pinned to the capture date, not "now": the outputs are frozen, so the report
  // is a frozen observation. (The gate's expiry window is measured against this.)
  generatedAt: '2026-10-05T00:00:00.000Z',
  extraEvidence: {
    what_changed:
      'The narrative leads with WHY, not WHO (Science d5 #87 6002255059; DL 6002275151 / 6003223464): ' +
      'sentence 1 = what the result rests on (the primary risk), sentence 2 = what would change it, ' +
      'sentence 3 = the option\'s own share "In this model, X% of runs supported [label]" ONLY when neither ' +
      'recommendation_suppressed nor constraint_infeasible is set; a barred option gets no share sentence. ' +
      '"produced the best outcome", "points to" and "favours" leave the prompt; runs SUPPORT an option. ' +
      'Banned list tightened only (+ "produced the best outcome", "came out best").',
    outcome_metrics:
      'The shipped pack cannot see sentence order, so reports/decision-review-v17-2026-10-05/outcome-metrics.py ' +
      'measures the change itself on the raw arms. v16 (817014c1) -> v17 (this): reason-first 0/21 -> 21/21; ' +
      'share sentence present exactly when it may be stated 3/21 -> 21/21; no best/winner/points-to/favour ' +
      'phrasing 0/21 -> 19/21; narrative <= 280 chars 19/21 -> 20/21; primary risk in sentence 1 14/21 -> 21/21.',
    residuals:
      'Not tuned away (in-sample): 2/21 "favour" phrasing in decision_quality_prompts.applies_because ' +
      '(r2/04 "in its favour", r3/04 "currently favours one option by a comfortable share"), and 1/21 ' +
      'barred-option narrative at 308 chars (r2/05). See the report README.',
    sampling_posture:
      'claude-sonnet-5, max_tokens 8192, thinking explicitly DISABLED, provider-default sampling, ' +
      'system = the canonical export verbatim. All 21 completions non-empty with stop_reason ' +
      'end_turn; an empty completion is a hard error in the harness, never a skipped sample.',
    iterations:
      'Two earlier full runs are NOT evidence: v17 (untightened) 13/21 within the 280 cap; v17c 20/21 ' +
      'on the shipped pack ("readiness" leaked into a pre-mortem field). 67 LLM calls in total, each run ' +
      'preceded by a BUDGET line on #87 (6003832585, 6003956130, 6004062984).',
    caveat_in_sample:
      'THE 21/21 IS IN-SAMPLE. The tightening was iterated against fixtures 02 and 05 of these same 7. ' +
      'There is NO live staging witness until the PMS v17 row is written and staging serves it.',
    revert_anchor_closes:
      'PROMOTING THIS CLOSES THE v16 REVERT ANCHOR, as v16 closed v15\'s: v16 then reads BLOCK / ' +
      'HASH_MISMATCH against the gate. The revert is `git revert` of this commit plus re-pointing PMS.',
  },
  note:
    'v17 promotion evidence (WORDING P3). Read outcome_metrics and residuals: the shipped pack measures ' +
    'the contract, the outcome metrics measure the change.',
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(
  `decision_review promotion report -> ${OUT}\n  promptSha16 ${report.promptSha16} · verdict ${report.verdict} · n=${report.sampleSize}\n`,
);
