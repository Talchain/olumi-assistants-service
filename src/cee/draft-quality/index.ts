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

/**
 * Total over the kinds a JUDGE may legally return; anything else becomes
 * `unavailable`.
 *
 * ⛔ `not_assessed` IS DELIBERATELY ABSENT FROM THIS LIST. It is not a verdict
 * the judge may claim — it is the record of the judge never having been asked,
 * and only the code that did not ask may write it. Accepting it here would open
 * exactly the hole the state closes: a model able to mark itself unassessed
 * could leave the judged population at will, and the impoverished rate would go
 * back to being uninterpretable. Pinned by the forgery case in
 * `__tests__/metric-honesty.test.ts`.
 */
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

  // ⭐ THE THREE UNJUDGED ARMS. Each returns `not_assessed` with the reason that
  // matches its own gate — NEVER `adequate`, which is a claim about the brief
  // that nothing here has read. See the `not_assessed` note in `types.ts` for
  // what the old spelling cost the metric.
  if (!nominated) {
    // The coverage facts are still produced and still emitted. An un-nominated
    // draft is measured — that is what makes the continuous quality metric
    // continuous, and what makes the pre-filter's recall estimable later.
    return noRedraw('not_nominated', { kind: 'not_assessed', reason: 'not_nominated' });
  }

  // ⭐ ORDER MATTERS, AND THIS IS THE CHEAP ONE FIRST. Spending a judge call to
  // discover we cannot act on the answer is pure cost. The two gates below are
  // both "we will not redraw" — checked before the money is spent.
  if (input.isRedraw) {
    return noRedraw('redraw_already_spent', {
      kind: 'not_assessed',
      reason: 'redraw_already_spent',
    });
  }
  const retryBudgetMs = getDraftLlmRetryBudgetMs(input.elapsedMs);
  if (retryBudgetMs < MIN_DRAFT_RETRY_BUDGET_MS) {
    return noRedraw(
      'budget_unaffordable',
      { kind: 'not_assessed', reason: 'budget_unaffordable' },
      0,
      null,
      null,
      retryBudgetMs,
    );
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

/**
 * ⭐⭐ THE SELECTION QUESTION — a THIRD authority, deliberately not folded into
 * the two above (trap 21: write down the question each one answers before you
 * reconcile them).
 *
 *   `classifyRetryableDraftFailure` — "did this draft FAIL?"            fails CLOSED
 *   `assessDraftQuality`            — "is one more draw worth buying?"  fails OPEN
 *   `assessRedrawForSelection`      — "may this draw REPLACE a graph
 *                                      that has already been reviewed?" fails CLOSED
 *
 * ## Why the third one exists
 *
 * The redraw was selected on STRUCTURAL COVERAGE ONLY. The judge reads draw
 * ONE; nothing read draw TWO. So a second draw that invents off-brief factors
 * scores richer on every dimension the selector consults — waist, private
 * factors, depth — and replaces the first, semantically reviewed graph. That is
 * the enrichment risk returning through the SELECTION step: the content does
 * not arrive through the verdict type (which has no channel), it arrives
 * through the DRAW, and the old rule let it in.
 *
 * ## Why a judge call and not a cheap grounding check
 *
 * A deterministic check would have to decide whether node labels are "about"
 * the brief — a predicate over natural language. This estate has measured what
 * that costs: four consecutive rounds on one such predicate, each fixing one
 * direction and reopening the other, settling on arbitrary length constants
 * with hard cliffs (trap 22f). Off-brief-ness is semantic by definition, so a
 * token-overlap heuristic is exactly the shape that oscillates, and the exit
 * doctrine says to stop guessing and ask.
 *
 * ## The asymmetry, which is the whole rule
 *
 * `normaliseJudgeResult` already holds that *a verdict that costs money must be
 * positively asserted*. Its selection twin: **a draw that replaces a reviewed
 * graph must be positively cleared.** Unavailable, timed out, unparseable, out
 * of headroom, unreadable — every one keeps the first draw. Note this does NOT
 * weaken the pass's fail-open contract: the user receives a valid model either
 * way; the only question here is WHICH of two valid models ships, and the
 * default is the one that was read against the brief.
 *
 * ## Cost, bounded
 *
 * No nomination gate — nomination is a cost pre-filter for the REJECT decision,
 * and this question needs a positive answer whatever the structure says. The
 * judge's own headroom gate bounds it (`insufficient_headroom`, no call made,
 * first draw kept), and this arm is reached only when a redraw was already
 * spent, which is already the rare and expensive path.
 */
export interface RedrawSelectionInput {
  readonly graph: unknown;
  readonly brief: string;
  readonly requestId: string;
  readonly elapsedMs: number;
  readonly judge?: JudgeFn;
}

export interface RedrawSelectionAssessment {
  /** Derived from the SECOND draw's own graph — never copied from the first. */
  readonly assessment: DraftQualityAssessment;
  /** True only on a positively asserted `adequate`. */
  readonly cleared: boolean;
}

export async function assessRedrawForSelection(
  input: RedrawSelectionInput,
): Promise<RedrawSelectionAssessment> {
  const coverage = computeDraftCoverage(input.graph);
  // ⭐ DERIVED FROM THIS DRAW. The old code copied the first draw's nomination
  // onto the second draw's telemetry row, so the one field reporting what the
  // redraw changed structurally reported its input instead.
  const nominated = nominatesForReview(coverage);

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
    judged = {
      verdict: { kind: 'unavailable', reason: 'llm_error' } as DraftQualityVerdict,
      latencyMs: 0,
      tokens: null,
      model: null,
    };
  }

  return {
    assessment: {
      coverage,
      nominated,
      verdict: judged.verdict,
      judgeLatencyMs: judged.latencyMs,
      judgeTokens: judged.tokens,
      judgeModel: judged.model,
    },
    cleared: judged.verdict.kind === 'adequate',
  };
}
