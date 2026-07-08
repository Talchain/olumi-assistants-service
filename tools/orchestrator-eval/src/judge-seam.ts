/**
 * orchestrator-eval — live-model / paid-judge seam (documentation + types).
 *
 * The DEFAULT path is fully deterministic and OFFLINE: candidate responses are
 * RECORDED in the fixture, and scoring is the deterministic scorer + imported
 * production guards. No paid LLM call happens on `eval:orchestrator`. This file
 * types the two seams a real A/B run plugs into, so the follow-up (real fixture
 * set + live A/B) does not have to reverse-engineer them.
 *
 * ── SEAM 1: live candidate ──────────────────────────────────────────────────
 * To score a NEW candidate PROMPT against a live model, produce the candidate
 * response at run time instead of reading `fixture.candidates[*].text`. Reuse:
 *   - tools/graph-evaluator/src/providers/*   (openai / anthropic model calls)
 *   - tools/graph-evaluator/src/adapters/orchestrator.ts  (buildRequest: wraps
 *     the prompt with TURN_CONTEXT + ELIGIBLE_ACTIONS)
 * The produced response is scored by the SAME deterministic scorer — the gate
 * itself does not change, only the source of the text (`source: 'live'`).
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
