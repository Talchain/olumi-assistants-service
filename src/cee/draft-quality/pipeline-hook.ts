/**
 * THE PIPELINE SEAM — where the draft-quality pass attaches to the draft path.
 *
 * Kept OUT of `unified-pipeline/index.ts` deliberately: that file is 1,500
 * lines and already carries the failure-retry wrapper, and putting a second
 * retry authority inline beside the first is how two authorities answering
 * different questions come to look like one inconsistency to reconcile
 * (trap 21). The wrapper calls exactly one function from here, on exactly one
 * arm (a SUCCESSFUL attempt the failure classifier did not claim).
 *
 * ## The fail-open contract, stated as an invariant
 *
 * `applyDraftQualityPass` returns a `UnifiedPipelineResult` that is EITHER
 * `first` (byte-identical, same object) OR a successful second draw. It can
 * never return a failure that `first` did not already carry, and it never
 * throws. A quality pass that can break drafting is worse than the defect it
 * fixes, so every arm below — judge error, timeout, garbage, unreadable graph,
 * failed redraw, unaffordable budget — lands on `return first`.
 *
 * ## Which draw may win, and why that needs a second judge call
 *
 * The redraw used to be selected on STRUCTURAL COVERAGE ALONE. Coverage
 * measures shape, and shape is exactly what a fabrication gets right — so a
 * second draw inventing off-brief factors scored richer on every dimension the
 * selector reads and REPLACED a graph the judge had already reviewed. The
 * enrichment risk did not come back through the verdict type (which has no
 * content channel); it came back through the DRAW, at the SELECTION step.
 *
 * `assessRedrawForSelection` therefore reads the second draw against the brief
 * before it may win, and fails CLOSED: only a positively asserted `adequate`
 * clears it. This does not weaken the fail-open contract below — the user gets
 * a valid model either way; the default is simply the model that was reviewed.
 *
 * ## What is preserved, and where
 *
 * When a redraw is spent, the DISCARDED draw is not thrown away. It is attached
 * to `body.trace.pipeline.draft_quality` as a typed `DraftQualityTraceRecord`,
 * lifted onto `DraftGraphResult.draftQuality` by the projection in
 * `orchestrator/tools/draft-graph.ts`, and put on the V5 trace the route ships
 * by `buildV5DiagnosticTrace`. All three hops read ONE type definition.
 *
 * ⚠ THAT CHAIN IS THE FIX, AND ITS FIRST TWO LINKS WERE MISSING. The record was
 * attached here and then dropped by the return literal of `handleDraftGraph`,
 * so the rejected original never reached the V5 response or the debug export.
 * An inspection route that stops inside the pipeline is not an inspection
 * route, and a test that reads this object is not evidence about the wire —
 * which is why the proof for it lives in
 * `__tests__/product-boundary-inspection.test.ts` and runs the real projection
 * and the real trace builder rather than asserting on the object below.
 *
 * ⚠ SCOPE, STATED HONESTLY: that is per-REQUEST preservation, not Postgres
 * durability. Nothing here writes a second graph to the database, and that is
 * deliberate — `scenarios.graph` is single-slot, `model_versions` is the user's
 * visible version history (a discarded draw would appear there as a restorable
 * version that never existed for them), and `v5_handler_facts` on the draft
 * path is pinned empty by a documented invariant whose payloads feed the next
 * turn's context. Each of those is a contract change needing a ruling, not a
 * side effect of this lane. The commit path is untouched, so no original draft
 * is ever OVERWRITTEN — only one graph is ever written per turn, and the
 * discarded draw is disclosed rather than persisted.
 */

import { log } from '../../utils/telemetry.js';
import type { UnifiedPipelineResult } from '../unified-pipeline/types.js';
import { assessDraftQuality, assessRedrawForSelection, type JudgeFn } from './index.js';
import { isMaterallyRicher } from './coverage.js';
import { buildImpoverishmentDirective } from './directive.js';
import { emitDraftQuality, emitDraftQualityRedraw } from './telemetry.js';
import type {
  DraftAttemptSource,
  DraftCoverageFacts,
  DraftQualityTraceRecord,
  DraftQualityVerdict,
  RedrawOutcome,
} from './types.js';

/**
 * The user-facing disclosure when the pass judged the shipped model
 * impoverished and could not do better.
 *
 * ⭐ WHY IT DISCLOSES RATHER THAN HIDES. The pass is allowed to reject and
 * redraw; it is not allowed to pretend. If the redraw bought nothing, the user
 * is holding a model we have judged thin, and saying so — with the lever that
 * actually helps — beats shipping it silently. The wording names the KIND of
 * thinness and never a domain, per the standing domain-neutral ruling: where
 * the model cannot determine the difference, the difference becomes the USER's
 * question rather than a guess.
 */
export const IMPOVERISHED_DISCLOSURE_ID = 'draft_quality_thin_model';
export const IMPOVERISHED_DISCLOSURE_EXPLANATION =
  'This model routes every option through the same single consideration, so the options can only ' +
  'differ by one number. A second draft was tried automatically and did not come out richer.';
export const IMPOVERISHED_DISCLOSURE_FIX_HINT =
  'Naming what separates your options — whichever dimensions the decision actually turns on — is ' +
  'the quickest way to get a fuller model.';

export interface DraftQualityPassInput {
  readonly first: UnifiedPipelineResult;
  readonly brief: string | null;
  readonly requestId: string;
  readonly scenarioId?: string | null;
  readonly turnId?: string | null;
  /** Milliseconds spent on the REQUEST when `first` returned. */
  readonly elapsedMs: number;
  /** Baseline for total-elapsed reporting. */
  readonly retryBaselineMs: number;
  /**
   * ⭐ WHICH DRAW THIS IS, and therefore whether a redraw is even possible.
   *
   * `'first'` (the default) is the only value on which this pass may spend a
   * draw. `'enforcement_retry'` is the arm the metric used to be BLIND to: the
   * failure classifier's automatic retry returned its successful second attempt
   * straight to the caller, so an entire population of shipped drafts — the
   * ones that had already gone wrong once — emitted nothing at all. It is now
   * ASSESSED AND EMITTED but can never fund another draw, which is exactly the
   * `redraw_already_spent` state, reported under its own `attempt_source` so
   * the two attempt-2 populations stay separable.
   */
  readonly attemptSource?: DraftAttemptSource;
  /**
   * Runs ONE more full pipeline attempt with the given corrective directive.
   * Optional: an observe-only arm (`attemptSource !== 'first'`) has no further
   * draw to offer and passes none, so the absence is structural rather than a
   * stub that must be trusted never to fire.
   */
  readonly redraw?: (directive: string | null) => Promise<UnifiedPipelineResult>;
  /** Test seam. Production leaves this unset and the real judge is used. */
  readonly judge?: JudgeFn;
}

/** Read the drafted graph out of a successful pipeline body, mirroring
 *  `draft-graph.ts`'s own `body.graph ?? body` tolerance. */
function graphFrom(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const rec = body as Record<string, unknown>;
  return rec.graph ?? rec;
}

/**
 * Assess a SUCCESSFUL draft and, if it does not cover the brief, spend exactly
 * one more draw.
 *
 * Never throws. Returns `first` unchanged on every arm except a successful
 * redraw that is materially richer.
 */
export async function applyDraftQualityPass(
  input: DraftQualityPassInput,
): Promise<UnifiedPipelineResult> {
  try {
    return await runPass(input);
  } catch (err) {
    // Defence in depth. Every component below already fails open on its own;
    // this catch exists so that a defect introduced later in THIS file still
    // cannot break drafting. The draft the user would have got is returned
    // untouched, and the failure is loud in the logs rather than silent.
    log.warn(
      {
        request_id: input.requestId,
        err: err instanceof Error ? err.message : String(err),
      },
      'draft-quality pass threw — returning the original draft unchanged (fail open)',
    );
    return input.first;
  }
}

async function runPass(input: DraftQualityPassInput): Promise<UnifiedPipelineResult> {
  const { first } = input;
  // Only successful draws are in scope. A failure is the OTHER authority's
  // question (`classifyRetryableDraftFailure`) and it fails CLOSED; this one
  // must not touch it.
  if (first.statusCode !== 200) return first;

  const firstGraph = graphFrom(first.body);
  const brief = typeof input.brief === 'string' ? input.brief : '';
  const attemptSource: DraftAttemptSource = input.attemptSource ?? 'first';

  const outcome = await assessDraftQuality({
    graph: firstGraph,
    brief,
    requestId: input.requestId,
    elapsedMs: input.elapsedMs,
    // Any attempt-2 arm is structurally incapable of funding a further draw.
    isRedraw: attemptSource !== 'first',
    ...(input.judge ? { judge: input.judge } : {}),
  });

  // ⭐ EMITTED UNCONDITIONALLY, BEFORE ANY BRANCH. This is the continuous
  // draft-quality metric and the reason the pass is allowed to exist: a repair
  // pass whose fail-open is silent converts a measurable problem into an
  // unmeasurable one. Every arm below has already been recorded by this point.
  emitDraftQuality({
    requestId: input.requestId,
    scenarioId: input.scenarioId ?? null,
    turnId: input.turnId ?? null,
    assessment: outcome.assessment,
    noRedrawReason: outcome.noRedrawReason,
    retryBudgetMs: outcome.retryBudgetMs,
    attemptSource,
    elapsedMs: input.elapsedMs,
  });

  if (!outcome.shouldRedraw || !input.redraw) return first;

  const verdict = outcome.assessment.verdict;
  /* c8 ignore next */
  const grounds = verdict.kind === 'impoverished' ? verdict.grounds : [];
  const firstCoverage = outcome.assessment.coverage;
  const directive = buildImpoverishmentDirective(grounds, firstCoverage);

  log.info(
    {
      request_id: input.requestId,
      grounds: [...grounds],
      causal_waist: firstCoverage?.causal_waist,
      option_count: firstCoverage?.option_count,
      retry_budget_ms: outcome.retryBudgetMs,
    },
    'Draft judged not to cover the brief — funding ONE redraw with a system-authored corrective directive',
  );

  const second = await input.redraw(directive);

  // ⭐ A REDRAW MUST NEVER TURN A SUCCESSFUL DRAFT INTO A FAILURE. The first
  // draw is a shippable model; the second is a gamble taken on the user's
  // behalf. If the gamble fails, the user gets what they would have had.
  if (second.statusCode !== 200) {
    emitDraftQualityRedraw({
      requestId: input.requestId,
      scenarioId: input.scenarioId ?? null,
      turnId: input.turnId ?? null,
      firstCoverage,
      secondCoverage: null,
      shipped: 'first',
      improved: false,
      secondOutcome: 'draft_failed',
      totalElapsedMs: Date.now() - input.retryBaselineMs,
    });
    return discloseThinModel(
      attachDiscardedDraw(first, null, {
        firstCoverage,
        secondCoverage: null,
        secondVerdict: null,
        secondOutcome: 'draft_failed',
        shipSecond: false,
      }),
    );
  }

  const secondGraph = graphFrom(second.body);

  // ⭐⭐ THE SECOND DRAW IS READ AGAINST THE BRIEF BEFORE IT MAY WIN.
  //
  // The selector below is structural (waist → private factors → depth) and
  // cannot see semantics, so on its own it REWARDS a fabricating drafter: a
  // draw that invents off-brief factors scores richer on all three and replaces
  // a graph the judge has already reviewed. Coverage alone is a measure of
  // shape, and shape is exactly what a fabrication gets right.
  //
  // `assessRedrawForSelection` answers a different question from the one above
  // it (see its header) and fails CLOSED: only a positively asserted `adequate`
  // clears the draw. It also derives this draw's OWN coverage and nomination,
  // rather than copying the first draw's.
  const secondSelection = await assessRedrawForSelection({
    graph: secondGraph,
    brief,
    requestId: input.requestId,
    elapsedMs: Date.now() - input.retryBaselineMs,
    ...(input.judge ? { judge: input.judge } : {}),
  });
  const secondCoverage = secondSelection.assessment.coverage;
  const richer = isMaterallyRicher(firstCoverage, secondCoverage);
  const shipSecond = richer && secondSelection.cleared;

  // ⚠ `richer_but_not_cleared` is NOT folded into `not_richer`. "The drafter
  // could not do better" and "the drafter produced something richer we would
  // not vouch for" are opposite diagnoses, and a metric that spells them the
  // same cannot tell a plateauing drafter from a fabricating one.
  const secondOutcome: RedrawOutcome = shipSecond
    ? 'richer'
    : richer
      ? 'richer_but_not_cleared'
      : 'not_richer';

  emitDraftQuality({
    requestId: input.requestId,
    scenarioId: input.scenarioId ?? null,
    turnId: input.turnId ?? null,
    // Its OWN coverage, its OWN nomination, its OWN verdict — all three used to
    // be the first draw's or a hardcoded placeholder.
    assessment: secondSelection.assessment,
    noRedrawReason: 'redraw_already_spent',
    retryBudgetMs: null,
    attemptSource: 'quality_redraw',
    elapsedMs: Date.now() - input.retryBaselineMs,
  });

  emitDraftQualityRedraw({
    requestId: input.requestId,
    scenarioId: input.scenarioId ?? null,
    turnId: input.turnId ?? null,
    firstCoverage,
    secondCoverage,
    shipped: shipSecond ? 'second' : 'first',
    improved: shipSecond,
    secondOutcome,
    totalElapsedMs: Date.now() - input.retryBaselineMs,
  });

  // Ship the better of the two, where "better" now means richer AND cleared. A
  // tie keeps the FIRST draw — a redraw that buys nothing must not silently
  // replace the draft the user would have got, because that is spend with no
  // witness of benefit — and so does an uncleared draw, for the stronger reason
  // that it is spend with no witness of TRUTH.
  const shipped = shipSecond ? second : first;
  const discarded = shipSecond ? first : second;
  const withTrace = attachDiscardedDraw(shipped, discarded, {
    firstCoverage,
    secondCoverage,
    secondVerdict: secondSelection.assessment.verdict,
    secondOutcome,
    shipSecond,
  });
  return shipSecond ? withTrace : discloseThinModel(withTrace);
}

/**
 * Attach the DISCARDED draw and both coverage records to the pipeline trace.
 *
 * `body.trace.pipeline` is the object the UI's Debug export already captures
 * (`exportBundle.ts` reads the CEE trace verbatim), so extending it here is the
 * cheap inspection route — no new URL flag, no new endpoint, no new plumbing.
 * A `?rawCee=1`-style flag already exists but reaches only the legacy
 * `/assist/v1/draft-graph` route, not the V5 turn the product actually uses,
 * so extending the export is both cheaper and the one that works.
 *
 * ⚠ This carries a full graph, i.e. user-derived labels. That is why it rides
 * the TRACE (a debug surface, gated behind the diagnostic-trace flag before it
 * reaches the wire) and not telemetry, which is codes-and-counts only.
 */
function attachDiscardedDraw(
  shipped: UnifiedPipelineResult,
  /** null when the redraw produced no shippable graph at all. */
  discarded: UnifiedPipelineResult | null,
  facts: {
    firstCoverage: DraftCoverageFacts | null;
    secondCoverage: DraftCoverageFacts | null;
    secondVerdict: DraftQualityVerdict | null;
    secondOutcome: RedrawOutcome;
    shipSecond: boolean;
  },
): UnifiedPipelineResult {
  const body = shipped.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return shipped;
  const rec = body as Record<string, unknown>;
  const trace =
    rec.trace && typeof rec.trace === 'object' && !Array.isArray(rec.trace)
      ? (rec.trace as Record<string, unknown>)
      : {};
  const pipeline =
    trace.pipeline && typeof trace.pipeline === 'object' && !Array.isArray(trace.pipeline)
      ? (trace.pipeline as Record<string, unknown>)
      : {};

  // Typed off the ONE shared definition in `types.ts`, which is also what the
  // projection and the V5 trace read — so producer and consumer cannot drift
  // into disagreeing about the shape.
  const record: DraftQualityTraceRecord = {
    redraw_spent: true,
    shipped: facts.shipSecond ? 'second' : 'first',
    improved: facts.shipSecond,
    second_outcome: facts.secondOutcome,
    first_coverage: facts.firstCoverage,
    second_coverage: facts.secondCoverage,
    second_verdict: facts.secondVerdict,
    /** ⭐ THE DISCARDED DRAW, kept whole. The point of this key is that a bad
     *  draft never disappears silently — if the drafter degrades, the evidence
     *  reaches the debug export rather than being absorbed by the redraw. */
    discarded_graph: discarded === null ? null : graphFrom(discarded.body),
  };

  return {
    ...shipped,
    body: {
      ...rec,
      trace: {
        ...trace,
        pipeline: {
          ...pipeline,
          draft_quality: record,
        },
      },
    },
  };
}

/**
 * Append the honest disclosure to `draft_warnings`.
 *
 * Idempotent by id, and additive: existing warnings are preserved. A non-array
 * `draft_warnings` (a shape this function did not expect) is left alone rather
 * than overwritten — a disclosure is not worth corrupting a payload for.
 */
function discloseThinModel(result: UnifiedPipelineResult): UnifiedPipelineResult {
  const body = result.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return result;
  const rec = body as Record<string, unknown>;
  const existing = rec.draft_warnings;
  if (existing !== undefined && !Array.isArray(existing)) return result;
  const warnings = Array.isArray(existing) ? [...existing] : [];
  const alreadyPresent = warnings.some(
    (w) =>
      w !== null &&
      typeof w === 'object' &&
      (w as Record<string, unknown>).id === IMPOVERISHED_DISCLOSURE_ID,
  );
  if (alreadyPresent) return result;
  warnings.push({
    id: IMPOVERISHED_DISCLOSURE_ID,
    severity: 'medium',
    explanation: IMPOVERISHED_DISCLOSURE_EXPLANATION,
    fix_hint: IMPOVERISHED_DISCLOSURE_FIX_HINT,
  });
  return { ...result, body: { ...rec, draft_warnings: warnings } };
}
