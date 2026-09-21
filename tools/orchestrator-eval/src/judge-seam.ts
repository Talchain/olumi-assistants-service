/**
 * orchestrator-eval — live-model / paid-judge seam (documentation + types).
 *
 * The DEFAULT path is fully deterministic and OFFLINE: candidate responses are
 * RECORDED in the fixture, and scoring is the deterministic scorer + imported
 * production guards. No paid LLM call happens on `eval:orchestrator`. This file
 * types the two seams a real A/B run plugs into, so the follow-up (real fixture
 * set + live A/B) does not have to reverse-engineer them.
 *
 * ── SEAM 1: live candidate — WIRED (see candidate-run.ts) ───────────────────
 * Implemented by `src/candidate-run.ts` + `candidate-cli.ts`
 * (`pnpm eval:orchestrator:candidates`): a candidate PROMPT (file path or
 * pms:<version> ref) produces responses at run time — request shaped per this
 * seam's original note (prompt + <TURN_CONTEXT>, reusing
 * tools/graph-evaluator/src/providers/* for the model call) — and the produced
 * text is scored by the SAME deterministic scorer, so two candidates rank on
 * identical scenarios. OFF by default: live production requires the
 * fail-closed double opt-in (ORCHESTRATOR_EVAL_LIVE_CANDIDATES=1 AND --live)
 * plus an explicit --model, and is hard-capped in turns per run
 * (src/live-gate.ts). The default path is offline mock playback and makes
 * zero network calls — proven by a fetch-counter test with a positive
 * control (__tests__/candidate-eval.test.ts).
 *
 * ── SEAM 2: paid judge ──────────────────────────────────────────────────────
 * The deterministic scorer is the floor. A paid LLM judge can add subjective
 * quality signal on top. Reuse tools/graph-evaluator/src/orchestrator-judge.ts.
 * It is OFF by default; the deterministic verdict always stands on its own so
 * the gate never depends on — or is blocked by — a paid call.
 */

/** Request handed to a paid judge (the assembled context + the candidate prose). */
export interface PaidJudgeRequest {
  readonly assembledContext: unknown;
  readonly candidateText: string;
}

/** A paid judge's verdict — advisory, layered ON TOP of the deterministic gate. */
export interface PaidJudgeVerdict {
  readonly pass: boolean;
  readonly rationale: string;
}

export type PaidJudge = (req: PaidJudgeRequest) => Promise<PaidJudgeVerdict>;

/**
 * Default: no paid judge wired. The deterministic scorer is the only gate in
 * the default path. A live A/B run injects a real `PaidJudge` here.
 */
export const NO_PAID_JUDGE: PaidJudge | null = null;
