/**
 * ⭐⭐ THE GRAMMAR REDRAW — one extra draw when the drafter broke its own
 * ALLOWED EDGE PATTERNS rule, and never for any other reason.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A THIRD AUTHORITY AND NOT A CLAUSE IN EITHER EXISTING ONE.
 *
 * The draft path already funds two redraws, and each answers its own question
 * with its own default (the trap-21 discipline this estate keeps):
 *
 *   · `classifyRetryableDraftFailure` — "did this draft FAIL in a
 *     self-declared-stochastic way?" Fails CLOSED. Never ships an invalid model.
 *   · `applyDraftQualityPass` — "did this draft SUCCEED and still not cover the
 *     brief?" Fails OPEN. Selects on COVERAGE.
 *   · this one — "did this draft SUCCEED and break the grammar its own prompt
 *     states?" Fails OPEN. Selects on LEGALITY.
 *
 * ⛔ IT CANNOT BE FOLDED INTO THE QUALITY PASS, and the reason is directional.
 * That pass ships the second draw only when `isMaterallyRicher` — coverage,
 * which REWARDS MORE NODES. A draw that fixes this defect is typically the
 * same size or smaller, so the richer-selector would reject exactly the draw
 * this exists to keep. Two selectors pulling opposite ways under one predicate
 * is how one lane closes a harm its neighbour reopens.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE GUARANTEES, and each is a test in `__tests__/grammar-redraw.test.ts`.
 *
 *   · A CLEAN DRAW IS UNTOUCHED — the same object, no redraw, no budget read,
 *     no telemetry branch. Roughly half of live traffic already drafts clean
 *     and must not pay a millisecond for this.
 *   · IT NEVER TURNS A SUCCESS INTO A FAILURE. If the second draw fails, or is
 *     unreadable, or is not cleaner, the user gets `first` byte-identical.
 *   · IT NEVER THROWS. Every arm is wrapped; a defect introduced here later
 *     still cannot break drafting.
 *   · EXACTLY ONE EXTRA DRAW. There is no loop, and `attemptSource !== 'first'`
 *     is structurally incapable of funding one.
 *   · IT SPENDS NOTHING IT CANNOT AFFORD. The budget question is asked with
 *     the SAME primitives the failure retry uses — `getDraftLlmRetryBudgetMs`
 *     against `MIN_DRAFT_RETRY_BUDGET_MS` — never a second encoding of "is
 *     there time?".
 *   · IT MUTATES NO GRAPH. It chooses between two draws the drafter produced.
 *     No edge is dropped, added or re-pointed anywhere in this file.
 */

import {
  getDraftLlmRetryBudgetMs,
  MIN_DRAFT_RETRY_BUDGET_MS,
} from '../../config/timeouts.js';
import { log } from '../../utils/telemetry.js';
import type { UnifiedPipelineResult } from '../unified-pipeline/types.js';
import {
  buildEdgeGrammarDirective,
  readEdgeGrammarFacts,
  secondDrawIsCleaner,
  violatesEdgeGrammar,
  type EdgeGrammarFacts,
} from './edge-grammar.js';
import type { DraftAttemptSource } from './types.js';

/** Why no second draw was spent. Each value is a DIFFERENT diagnosis, and
 *  collapsing any two of them would hide which population a request is in. */
export type GrammarRedrawSkipReason =
  | 'draft_failed'
  | 'graph_unreadable'
  | 'grammar_clean'
  | 'redraw_already_spent'
  | 'no_redraw_available'
  | 'budget_unaffordable';

export type GrammarRedrawDecision =
  | { readonly redraw: true; readonly facts: EdgeGrammarFacts; readonly retryBudgetMs: number }
  | { readonly redraw: false; readonly reason: GrammarRedrawSkipReason; readonly facts: EdgeGrammarFacts | null };

/**
 * ⭐ WHY THIS RETURNS `drawSpent` AND NOT JUST THE RESULT.
 *
 * The caller chains this into `applyDraftQualityPass`, which can fund a draw of
 * its own. "Did the second draw WIN?" and "did we SPEND a draw?" are different
 * questions, and a caller that infers the second from the first (by comparing
 * object identity) gets it wrong in exactly the expensive case: a redraw that
 * was spent and LOST looks identical to no redraw at all, so the quality pass
 * would then fund a THIRD full draw on the user's clock.
 */
export interface GrammarRedrawResult {
  readonly result: UnifiedPipelineResult;
  /** True iff the drafter was actually called again, whichever draw shipped. */
  readonly drawSpent: boolean;
}

export interface GrammarRedrawInput {
  readonly first: UnifiedPipelineResult;
  readonly requestId: string;
  readonly elapsedMs: number;
  readonly attemptSource?: DraftAttemptSource;
  readonly redraw?: (directive: string) => Promise<UnifiedPipelineResult>;
}

function graphFrom(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const rec = body as Record<string, unknown>;
  return rec.graph ?? rec;
}

/**
 * ⭐ THE WHOLE DECISION, PURE AND SEPARATELY TESTABLE.
 *
 * Kept out of the async pass so every arm can be asserted without mocking a
 * pipeline. The order of the guards is the order of cost: shape first, then
 * the free predicate, then the capability checks, and only last the budget —
 * so a clean draw never reaches a clock read at all.
 */
export function decideGrammarRedraw(
  input: Pick<GrammarRedrawInput, 'first' | 'elapsedMs' | 'attemptSource' | 'redraw'>,
): GrammarRedrawDecision {
  if (input.first.statusCode !== 200) return { redraw: false, reason: 'draft_failed', facts: null };

  const facts = readEdgeGrammarFacts(graphFrom(input.first.body));
  if (!facts.readable) return { redraw: false, reason: 'graph_unreadable', facts };
  if (!violatesEdgeGrammar(facts)) return { redraw: false, reason: 'grammar_clean', facts };

  if ((input.attemptSource ?? 'first') !== 'first') {
    return { redraw: false, reason: 'redraw_already_spent', facts };
  }
  if (!input.redraw) return { redraw: false, reason: 'no_redraw_available', facts };

  const retryBudgetMs = getDraftLlmRetryBudgetMs(input.elapsedMs);
  if (retryBudgetMs < MIN_DRAFT_RETRY_BUDGET_MS) {
    return { redraw: false, reason: 'budget_unaffordable', facts };
  }
  return { redraw: true, facts, retryBudgetMs };
}

/**
 * Spend at most one extra draw to satisfy the drafter's own edge grammar.
 *
 * Returns `first` unchanged on every arm except a second draw that is
 * measurably cleaner. Never throws.
 */
export async function applyGrammarRedraw(
  input: GrammarRedrawInput,
): Promise<GrammarRedrawResult> {
  try {
    return await runGrammarRedraw(input);
  } catch (err) {
    // Defence in depth, matching `applyDraftQualityPass`: a defect added here
    // later must not be able to break a draft that is otherwise shippable.
    log.warn(
      { request_id: input.requestId, err: err instanceof Error ? err.message : String(err) },
      'grammar redraw threw — returning the original draft unchanged (fail open)',
    );
    // ⚠ `drawSpent: true` is the HONEST answer on the throw arm: the drafter
    // may well have been called before the throw, and claiming otherwise would
    // license the next pass to spend another full draw on a request that has
    // already paid for one.
    return { result: input.first, drawSpent: true };
  }
}

async function runGrammarRedraw(input: GrammarRedrawInput): Promise<GrammarRedrawResult> {
  const decision = decideGrammarRedraw(input);

  // ⭐ EMITTED ON EVERY ARM INCLUDING THE CLEAN ONE, and that is the point: the
  // violation rate is the OUTCOME metric this change is judged on. A pass whose
  // no-op arm is silent converts a measurable problem into an unmeasurable one,
  // and there would be no way to tell a fixed drafter from a broken detector.
  log.info(
    {
      event: 'cee.draft.edge_grammar',
      request_id: input.requestId,
      readable: decision.facts?.readable ?? false,
      violation_count: decision.facts?.violations.length ?? null,
      options_affected: decision.facts?.optionsAffected ?? null,
      attempt_source: input.attemptSource ?? 'first',
      redraw: decision.redraw,
      skip_reason: decision.redraw ? null : decision.reason,
      elapsed_ms: input.elapsedMs,
    },
    'Draft measured against the ALLOWED EDGE PATTERNS rule',
  );

  if (!decision.redraw) return { result: input.first, drawSpent: false };
  /* c8 ignore next */
  if (!input.redraw) return { result: input.first, drawSpent: false };

  const second = await input.redraw(buildEdgeGrammarDirective(decision.facts));

  // ⛔ A REDRAW MUST NEVER TURN A SUCCESSFUL DRAFT INTO A FAILURE. The first
  // draw is a shippable model; the second is a gamble taken on the user's
  // behalf. If it fails, they get what they would have had.
  if (second.statusCode !== 200) {
    log.info(
      { event: 'cee.draft.edge_grammar_redraw', request_id: input.requestId, shipped: 'first', second_outcome: 'draft_failed' },
      'Grammar redraw failed — shipping the original draft',
    );
    return { result: input.first, drawSpent: true };
  }

  const secondFacts = readEdgeGrammarFacts(graphFrom(second.body));
  const shipSecond = secondDrawIsCleaner(decision.facts, secondFacts);

  log.info(
    {
      event: 'cee.draft.edge_grammar_redraw',
      request_id: input.requestId,
      first_violations: decision.facts.violations.length,
      second_violations: secondFacts.readable ? secondFacts.violations.length : null,
      second_readable: secondFacts.readable,
      shipped: shipSecond ? 'second' : 'first',
      // `second_outcome` separates "the drafter could not do better" from "the
      // second draw could not be read" — opposite diagnoses that a single
      // `shipped: first` would spell the same.
      second_outcome: !secondFacts.readable ? 'unreadable' : shipSecond ? 'cleaner' : 'not_cleaner',
    },
    'Grammar redraw complete',
  );

  return { result: shipSecond ? second : input.first, drawSpent: true };
}
