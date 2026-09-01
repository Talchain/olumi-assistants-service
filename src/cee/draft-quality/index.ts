/**
 * DRAFT-QUALITY PASS — the decision.
 *
 * ⭐ THE QUESTION THIS ANSWERS (trap 21 — write down the question before you
 * reconcile two authorities):
 *
 *   "This draft SUCCEEDED. Does the model it produced cover the causal
 *    dimensions the brief states — and if not, is one more draw worth it?"
 *
 * The neighbouring authority, `classifyRetryableDraftFailure`
 * (`../unified-pipeline/draft-auto-retry.ts`), answers a DIFFERENT question:
 * "did this draft FAIL in a self-declared-stochastic way?". The two have
 * opposite defaults on purpose — that one fails CLOSED (an invalid model is
 * never shipped), this one fails OPEN (a valid model always ships). They are
 * consulted in sequence by the pipeline wrapper and neither is a fallback for
 * the other. Aligning their defaults would be the wrong fix.
 *
 * ## The five constraints, and where each is enforced
 *
 * 1. REJECT AND REDRAW, NEVER ENRICH — enforced by the verdict TYPE
 *    (`types.ts`), which has no content channel, and by the redraw being a
 *    fresh `draft_graph` call rather than a patch.
 * 2. NEVER A FACTOR-COUNT QUOTA — enforced by `nominatesForReview` being a cost
 *    gate that only nominates, and by the judge being the sole authority.
 *    Pinned by `__tests__/single-factor-control.test.ts`.
 * 3. SEMANTIC, NOT SHAPE — the judge reads the brief; the structure only
 *    decides whether to ask.
 * 4. BOUNDED COST — `isRedraw` makes a second redraw structurally impossible
 *    (`redraw_already_spent`), and the budget gate reuses the pipeline's own
 *    affordability primitive.
 * 5. FAIL OPEN — every arm that is not "nominated AND judged impoverished AND
 *    affordable AND not already a redraw" returns `shouldRedraw: false` with a
 *    CODED reason, and the original draft ships untouched.
 */

import { getDraftLlmRetryBudgetMs, MIN_DRAFT_RETRY_BUDGET_MS } from '../../config/timeouts.js';
import { computeDraftCoverage, nominatesForReview } from './coverage.js';
import { judgeDraftCoverage } from './judge.js';
import type {
  DraftQualityAssessment,
  DraftQualityVerdict,
  NoRedrawReason,
} from './types.js';

export { computeDraftCoverage, nominatesForReview, isMaterallyRicher } from './coverage.js';
export { judgeDraftCoverage, parseJudgeOutput } from './judge.js';
export { buildImpoverishmentDirective } from './directive.js';
export { emitDraftQuality, emitDraftQualityRedraw } from './telemetry.js';
export * from './types.js';

/** Injected so the decision is testable in both directions without a network
 *  call. Production passes `judgeDraftCoverage`. */
export type JudgeFn = (args: {
  graph: unknown;
  brief: string;
  requestId: string;
  elapsedMs: number;
}) => Promise<DraftQualityVerdict | import('./judge.js').JudgeCallResult>;

export interface AssessDraftQualityInput {
  readonly graph: unknown;
  readonly brief: string;
  readonly requestId: string;
  /** Milliseconds spent on this REQUEST so far — the same baseline the retry
   *  wrapper uses (`requestStartMs`), never draft start. */
  readonly elapsedMs: number;
  /** True when the draft under assessment IS the redraw. One redraw, never a
   *  loop — this is what makes a second one structurally impossible rather
   *  than merely unlikely. */
  readonly isRedraw: boolean;
  readonly judge?: JudgeFn;
}

export interface DraftQualityOutcome {
  readonly assessment: DraftQualityAssessment;
  readonly shouldRedraw: boolean;
  /** null exactly when `shouldRedraw` is true. */
  readonly noRedrawReason: NoRedrawReason | null;
  /** The affordability window measured at the decision, for telemetry. null
   *  when the budget was never consulted. */
  readonly retryBudgetMs: number | null;
}

/**
 * ⛔ AN UNRECOGNISED SHAPE IS NOT A VERDICT — IT IS AN ABSENCE OF ONE.
 *
 * This function used to trust `'kind' in raw` and pass whatever it found
 * straight through. A judge returning `{ kind: 'nonsense' }` therefore matched
 * neither `adequate` nor `unavailable` downstream and fell through to the
 * redraw arm: **garbage was readable as "impoverished" and spent a draw.**
 * Caught by the fail-open twin in `__tests__/pipeline-hook.test.ts`, which is
 * the whole argument for writing the twins.
 *
 * The asymmetry is deliberate and is the rule for every parser on this path:
 * an unrecognised answer must be READABLE ONLY AS "I don't know". A verdict
 * that costs money and latency has to be positively asserted.
 */
function normaliseJudgeResult(
  raw: DraftQualityVerdict | import('./judge.js').JudgeCallResult,
): { verdict: DraftQualityVerdict; latencyMs: number; tokens: { in: number; out: number } | null; model: string | null } {
  if (raw !== null && typeof raw === 'object' && 'kind' in raw) {
    return { verdict: coerceVerdict(raw as DraftQualityVerdict), latencyMs: 0, tokens: null, model: null };
  }
  if (raw !== null && typeof raw === 'object' && 'verdict' in raw) {
    const r = raw as import('./judge.js').JudgeCallResult;
    return {
      verdict: coerceVerdict(r.verdict),
      latencyMs: typeof r.latencyMs === 'number' ? r.latencyMs : 0,
      tokens: r.tokens ?? null,
      model: r.model ?? null,
    };
  }
  return { verdict: { kind: 'unavailable', reason: 'parse_failed' }, latencyMs: 0, tokens: null, model: null };
}

/** Total over the three legal kinds; anything else becomes `unavailable`. */
function coerceVerdict(v: DraftQualityVerdict | undefined): DraftQualityVerdict {
  if (v === null || typeof v !== 'object') return { kind: 'unavailable', reason: 'parse_failed' };
  if (v.kind === 'adequate') return v;
  if (v.kind === 'unavailable') return v;
  if (v.kind === 'impoverished' && Array.isArray(v.grounds) && v.grounds.length > 0) return v;
  return { kind: 'unavailable', reason: 'parse_failed' };
}

/**
 * Assess ONE drafted model and decide whether one more draw is warranted.
 *
 * Never throws — a defect inside this pass must not be able to break drafting.
 * Any thrown error inside the judge is already caught there; anything that
 * escapes here is caught and degrades to `judge_unavailable`.
 */
export async function assessDraftQuality(
  input: AssessDraftQualityInput,
): Promise<DraftQualityOutcome> {
  const coverage = computeDraftCoverage(input.graph);
  const nominated = nominatesForReview(coverage);

  const noRedraw = (
    reason: NoRedrawReason,
    verdict: DraftQualityVerdict,
    judgeLatencyMs = 0,
    judgeTokens: { in: number; out: number } | null = null,
    judgeModel: string | null = null,
    retryBudgetMs: number | null = null,
  ): DraftQualityOutcome => ({
    assessment: { coverage, nominated, verdict, judgeLatencyMs, judgeTokens, judgeModel },
    shouldRedraw: false,
    noRedrawReason: reason,
    retryBudgetMs,
  });

  if (!nominated) {
    // The coverage facts are still produced and still emitted. An un-nominated
    // draft is measured — that is what makes the continuous quality metric
    // continuous, and what makes the pre-filter's recall estimable later.
    return noRedraw('not_nominated', { kind: 'adequate' });
  }

  // ⭐ ORDER MATTERS, AND THIS IS THE CHEAP ONE FIRST. Spending a judge call to
  // discover we cannot act on the answer is pure cost. The two gates below are
  // both "we will not redraw" — checked before the money is spent.
  if (input.isRedraw) {
    return noRedraw('redraw_already_spent', { kind: 'adequate' });
  }
  const retryBudgetMs = getDraftLlmRetryBudgetMs(input.elapsedMs);
  if (retryBudgetMs < MIN_DRAFT_RETRY_BUDGET_MS) {
    return noRedraw('budget_unaffordable', { kind: 'adequate' }, 0, null, null, retryBudgetMs);
  }

  let judged;
  try {
    const judge = input.judge ?? judgeDraftCoverage;
    judged = normaliseJudgeResult(
      await judge({
        graph: input.graph,
        brief: input.brief,
        requestId: input.requestId,
        elapsedMs: input.elapsedMs,
      }),
    );
  } catch {
    // Defence in depth: `judgeDraftCoverage` already never throws, and an
    // injected judge might. A defect in the quality pass must never be able to
    // break drafting.
    return noRedraw('judge_unavailable', { kind: 'unavailable', reason: 'llm_error' });
  }

  const assessment: DraftQualityAssessment = {
    coverage,
    nominated,
    verdict: judged.verdict,
    judgeLatencyMs: judged.latencyMs,
    judgeTokens: judged.tokens,
    judgeModel: judged.model,
  };

  // ⭐ NOTE THE DIRECTION OF THE TEST. The ONLY arm that may spend a redraw is a
  // POSITIVELY ASSERTED `impoverished`. Everything else — adequate, unavailable,
  // and any shape `coerceVerdict` did not recognise — lands on a no-redraw arm
  // with a coded reason. Written as `if (impoverished) redraw` rather than
  // `if (!adequate) redraw` on purpose: the second form makes every future
  // unmodelled state cost a draw.
  if (judged.verdict.kind === 'impoverished') {
    return { assessment, shouldRedraw: true, noRedrawReason: null, retryBudgetMs };
  }
  if (judged.verdict.kind === 'adequate') {
    return { assessment, shouldRedraw: false, noRedrawReason: 'judged_adequate', retryBudgetMs };
  }
  return { assessment, shouldRedraw: false, noRedrawReason: 'judge_unavailable', retryBudgetMs };
}
