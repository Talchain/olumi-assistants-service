/**
 * orchestrator-eval — the TASK ADAPTER seam.
 *
 * SEAM-1 (`candidate-run.ts`) used to hard-code three routing-shaped steps:
 *
 *   1. build the request           — `<TURN_CONTEXT>` from a ContextPackAnalysis;
 *   2. extract the scored surface  — the v30.3 envelope's `text` field;
 *   3. score it                    — the six routing prose dimensions.
 *
 * Those three steps are the ONLY task-specific parts of the pipeline. Every
 * other guarantee the chassis ships — the fail-closed double-opt-in live gate,
 * the pre-call turn cap, the `mock:` zero-network playback, fail-closed
 * extraction, the ranking-key invariants — is task-agnostic and must be
 * inherited unchanged by every task, not reimplemented per task. So the three
 * steps become an ADAPTER and the pipeline becomes generic over the fixture
 * type.
 *
 * WHY AN INTERFACE RATHER THAN A SECOND CLI: a forked pipeline is how the
 * graph-evaluator ended up with a prompt-assembly twin of production. One
 * pipeline with a swappable adapter means a new task cannot accidentally opt
 * out of the cost cap or the extraction contract — it has no code path in
 * which to do so.
 *
 * SCORING CONTRACT FOR AN ADAPTER (binding on every implementation):
 *   - `scoreRaw` must return a `ScoreResult` whose `pass` is the AND of every
 *     dimension, and must include an ANTI-VACUITY dimension that FAILS on an
 *     empty/degenerate output. Absence checks are vacuously satisfied by
 *     emptiness; without a floor, a task's pack would rank an empty answer as
 *     its cleanest candidate. `substance_present` is that floor for both
 *     shipped adapters.
 *   - extraction failure must be scored, never skipped (see
 *     `applyExtractionContract` in candidate-run.ts, which every adapter's
 *     `scoreRaw` is expected to apply).
 */

import type { EvalTaskKey } from './tasks.js';
import type { ScoreResult } from './types.js';

/** How the scored surface was obtained from the raw model output. */
export type ExtractionMode =
  | 'json_text' // envelope parsed; the contract path
  | 'raw_unparsed' // parse failed; RAW output scored and flagged
  | 'model_error'; // the model call itself failed; nothing scored

export interface ScoredOutput {
  readonly extraction: ExtractionMode;
  readonly score: ScoreResult;
}

/**
 * Everything task-specific about running one candidate prompt against one
 * fixture. Generic in the fixture type so a task's fixtures stay strongly
 * typed all the way through the pipeline.
 */
export interface EvalTaskAdapter<F> {
  readonly task: EvalTaskKey;

  /** Stable id for reporting. */
  fixtureId(fixture: F): string;

  /** Load the task's checked-in fixture pack (optionally from an override dir). */
  loadFixtures(dir?: string): F[];

  /**
   * Build the (system, user) request for one fixture from a candidate prompt.
   *
   * MUST ground on the PRODUCTION assembly function for the task where one
   * exists — imported, never copied. A copy drifts from the runtime the moment
   * either side changes, which is precisely the defect this tool exists to
   * avoid measuring around.
   */
  buildRequest(fixture: F, promptText: string): { system: string; user: string };

  /**
   * Play back a RECORDED candidate as if it were raw model output, for
   * `mock:<label>` refs. Returns null when the fixture has no candidate with
   * that label (the caller turns that into a loud `model_error`).
   *
   * The playback is wrapped in the task's own wire envelope so the extraction
   * path is exercised offline too — a mock run proves the plumbing, not just
   * the scorer.
   */
  mockRaw(fixture: F, mockLabel: string): string | null;

  /**
   * Extract the scored surface from raw model output and score it, with the
   * extraction contract already applied (a flagged turn is a FAILED turn).
   */
  scoreRaw(fixture: F, raw: string, candidateLabel: string): ScoredOutput;
}
