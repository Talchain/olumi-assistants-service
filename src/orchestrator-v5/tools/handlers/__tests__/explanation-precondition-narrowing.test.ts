/**
 * S8b — NARROW THE EXPLANATION PRECONDITION: caveat the answer, do not delete it.
 *
 * THE DEFECT, JOURNEY-WITNESSED. Two of the founder's own questions were
 * swallowed by this precondition and answered with canned copy, while two
 * others of the same kind were answered richly IN THE SAME STALE STATE. The
 * routing tool schema REQUIRES the model to write the user-facing answer into
 * the electing call (`tool-schema.ts` — "answer_text with the full answer; this
 * is what the user reads"). The call happened, the prose existed, and the
 * handler returned a template and never read `invocation.explanation`.
 * ⭐ THE MODEL ANSWERED AND WE DELETED THE ANSWER UNREAD.
 *
 * ⭐⭐ WHY THIS IS CONVERGENCE, NOT NEW LICENCE — and this is the whole
 * justification for the change. `canonical-analysis-state.ts` already computes
 *   usableForProse = hasFact && !blockedUnusable &&
 *                    (fresh || stale || unknown)
 * under the comment "Prose may reference fresh / stale / (legacy) unknown
 * analysis WITH A CAVEAT", with `usableForChips` fresh-only and `requiresRerun`
 * separate. The handler was DISOBEYING a predicate the canonical state already
 * defines. This change makes two authorities agree; it does not grant new
 * permission, and it needs no policy amendment.
 *
 * ⛔ SCOPE — Q1 IS DELIBERATELY NOT TOUCHED. The sibling swallow at
 * `routing/run-comparison-gate.ts` is a PRE-LLM routing gate whose fail-closed
 * posture is bound to a MERGED policy (`Docs/t4/t4-spine-policy-v1.md` §1b
 * unknown ⇒ hold, §1 authority parity, §5 acknowledge before presenting).
 * Narrowing that is a POLICY AMENDMENT and belongs to the founder, not to this
 * lane. A lane quietly narrowing a gate a ratified policy put there is how an
 * estate ships past a stated limit whose licence has lapsed.
 *
 * ⚠ TWO HARMS, TWO PARAMETERS (CLAUDE.md trap 21 / 22b). A swallowed answerable
 * question and an uncaveated stale figure are OPPOSITE harms and cannot share
 * one window, so they are decided by two functions with two exhaustive
 * switches: `explanationVerdictBlocks` answers "block or answer?", and
 * `caveatForPreconditionVerdict` answers "which claim is licensed?". Every case
 * below is paired with its OPPOSITE-DIRECTION TWIN.
 */

import { describe, it, expect } from 'vitest';

import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { createExplainResultsHandler } from '../explain-results.js';
import { createWhatWouldFlipHandler } from '../what-would-flip.js';
import { STALENESS_PREFIX, UNCONFIRMED_PREFIX } from '../staleness-prefix.js';
import type { HandlerInvocation } from '../../registry.js';
import type { AnalysisProjectionSummary } from '../../../context/projection-summaries.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST_ID = 'req-s8b-narrowing';
const GOAL_ID = 'goal_node_1';

/**
 * ⭐ THE IDENTITY SENTINEL (CLAUDE.md trap 19). Assertions below bind to the
 * model's answer by a string NO OTHER OBJECT IN THE FIXTURE CAN PRODUCE — not
 * by a value predicate like "contains a percentage", which the deterministic
 * fallback and the canned templates would also satisfy. If this sentinel
 * survives into `assistant_text`, `invocation.explanation` was READ.
 */
const MODEL_ANSWER_SENTINEL = 'ZQX-MODEL-AUTHORED-ANSWER-SENTINEL';

const VALID_ANSWER_TEXT =
  `Hire Senior Engineer leads at 62 per cent because Engineering Capacity carries ` +
  `the strongest sensitivity in the model, well ahead of the runner-up. ` +
  `${MODEL_ANSWER_SENTINEL}`;

const ANALYSIS_PROJECTION: AnalysisProjectionSummary = {
  status: 'complete',
  leading_option: { label: 'Hire Senior Engineer', probability: 0.62 },
  runner_up: { label: 'Hire Two Mid-Level', probability: 0.27 },
  margin_pp: 35,
  robustness_band: 'stable',
  top_drivers: [
    { factor_label: 'Engineering Capacity', sensitivity_value: 0.65 },
    { factor_label: 'Hiring Cost', sensitivity_value: -0.42 },
  ],
  staleness_reason: null,
};

function makeRunAnalysisFactWithStatus(status: string | null): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (status !== null) enrichment.analysis_status = status;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_1',
      summary: 'Analysis completed.',
      enrichment,
    },
  };
}

function makeAnalysisReady(optionCount: number): HandlerInvocation['analysisReady'] {
  return {
    options: Array.from({ length: optionCount }, (_, i) => ({
      option_id: `opt_${i + 1}`,
      label: `Option ${i + 1}`,
      status: 'ready',
      interventions: { f: 1 },
    })),
    goal_node_id: GOAL_ID,
    status: 'ready',
  } as unknown as HandlerInvocation['analysisReady'];
}

function makeFreshness(
  freshness: 'fresh' | 'stale' | 'unknown' | 'none',
  reason: string,
): HandlerInvocation['analysisFreshness'] {
  return {
    freshness,
    reason: reason as never,
    selected_fact_index: 0,
    graph_hash_at_run: 'hash-prior',
    current_graph_hash: freshness === 'fresh' ? 'hash-prior' : 'hash-current',
    computed_at: '2026-05-05T00:00:00.000Z',
  };
}

function makeInvocation(overrides?: {
  priorFacts?: readonly HandlerFact[];
  optionCount?: number;
  explanation?: HandlerInvocation['explanation'];
  analysisProjection?: AnalysisProjectionSummary;
  analysisFreshness?: HandlerInvocation['analysisFreshness'];
}): HandlerInvocation {
  const optionCount = overrides?.optionCount ?? 2;
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: GOAL_ID },
      capabilities: {},
      messages: [{ role: 'user', content: 'what changed and why does it matter?' }],
      session_id: SCENARIO_ID,
      request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: overrides?.priorFacts ?? [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      turn_id: 't1',
      scenario_id: SCENARIO_ID,
      message: 'what changed and why does it matter?',
      turn_class: 'decide',
      stage: 'analyse',
    } as unknown as HandlerInvocation['payload'],
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
    analysisReady: makeAnalysisReady(optionCount),
    explanation: overrides?.explanation,
    analysisProjection: overrides?.analysisProjection,
    analysisFreshness: overrides?.analysisFreshness,
  };
}

/** A stale/unconfirmed invocation carrying a VALID model-authored answer. */
function makeAnsweredInvocation(freshness: 'stale' | 'unknown', reason: string) {
  return makeInvocation({
    priorFacts: [makeRunAnalysisFactWithStatus('computed')],
    explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
    analysisProjection: ANALYSIS_PROJECTION,
    analysisFreshness: makeFreshness(freshness, reason),
  });
}

describe('S8b — a stale/unconfirmed explanation is CAVEATED, not swallowed', () => {
  it('explain_results / stale: answers, leads with STALENESS_PREFIX, and KEEPS the model answer', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(makeAnsweredInvocation('stale', 'graph_hash_diverged'));

    // The caveat still leads — unchanged from the blocking behaviour, and the
    // brief's required wording verbatim.
    expect(outcome.assistant_text.startsWith(STALENESS_PREFIX)).toBe(true);
    // ⭐ THE HALF THAT FLIPS: the model's answer is no longer deleted.
    // Bound by the identity sentinel, not by a value predicate.
    expect(outcome.assistant_text).toContain(MODEL_ANSWER_SENTINEL);
    expect(outcome.suppress_orientation).toBe(true);

    const fact = outcome.handler_facts[0];
    if (fact.fact_type !== 'explain_results') throw new Error('wrong fact type');
    expect(fact.result.precondition_unmet).toBe(false);
    // Proves `invocation.explanation` was READ, not merely that some text exists.
    expect(fact.result.answer_source).toBe('sonnet');
    // ⭐ DERIVED, NOT HAND-SET: the flag and the text come from one call.
    expect(fact.result.staleness_prefixed).toBe(true);
  });

  it('explain_results / unconfirmed: leads with UNCONFIRMED_PREFIX, never the stale claim', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(makeAnsweredInvocation('unknown', 'legacy_fact_missing_hash'));

    expect(outcome.assistant_text.startsWith(UNCONFIRMED_PREFIX)).toBe(true);
    // Authority parity: we must NOT assert the model changed when we cannot
    // confirm it. The stronger claim must be absent, not merely non-leading.
    expect(outcome.assistant_text).not.toContain(STALENESS_PREFIX);
    expect(outcome.assistant_text).toContain(MODEL_ANSWER_SENTINEL);

    const fact = outcome.handler_facts[0];
    if (fact.fact_type !== 'explain_results') throw new Error('wrong fact type');
    expect(fact.result.staleness_prefixed).toBe(true);
  });

  it('what_would_flip / stale: the SAME narrowing applies (one shared funnel, not two)', async () => {
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(makeAnsweredInvocation('stale', 'graph_hash_diverged'));

    expect(outcome.assistant_text.startsWith(STALENESS_PREFIX)).toBe(true);
    expect(outcome.assistant_text).toContain(MODEL_ANSWER_SENTINEL);

    const fact = outcome.handler_facts[0];
    if (fact.fact_type !== 'what_would_flip') throw new Error('wrong fact type');
    expect(fact.result.precondition_unmet).toBe(false);
    expect(fact.result.staleness_prefixed).toBe(true);
  });

  /* ================= OPPOSITE-DIRECTION TWINS ==================
   * Every case above says "answer". These say "still block". Without them the
   * suite would applaud a fix that simply stopped blocking everything — which
   * is the mirror harm (an uncaveated stale figure, or worse, a fabricated
   * analysis that never ran).
   * ============================================================ */

  it('TWIN — missing: no successful fact → STILL BLOCKED (nothing exists to caveat)', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [],
        explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    expect(outcome.assistant_text).toMatch(/No analysis has been run on your model yet/);
    // The model's answer must NOT leak: caveating it would not make it true.
    expect(outcome.assistant_text).not.toContain(MODEL_ANSWER_SENTINEL);
    expect(outcome.assistant_text).not.toContain(STALENESS_PREFIX);

    const fact = outcome.handler_facts[0];
    if (fact.fact_type !== 'explain_results') throw new Error('wrong fact type');
    expect(fact.result.precondition_unmet).toBe(true);
    expect(fact.result.answer_source).toBe('precondition_template');
  });

  it('TWIN — degraded: non-success fact → STILL BLOCKED (no usable result to caveat)', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFactWithStatus('blocked')],
        explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    expect(outcome.assistant_text).toMatch(/didn't produce a usable result/);
    expect(outcome.assistant_text).not.toContain(MODEL_ANSWER_SENTINEL);

    const fact = outcome.handler_facts[0];
    if (fact.fact_type !== 'explain_results') throw new Error('wrong fact type');
    expect(fact.result.precondition_unmet).toBe(true);
  });

  it('TWIN — execute (fresh): answers with NO caveat (never invents a doubt)', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFactWithStatus('computed')],
        explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
        analysisProjection: ANALYSIS_PROJECTION,
        analysisFreshness: makeFreshness('fresh', 'graph_hash_match'),
      }),
    );
    expect(outcome.assistant_text).toContain(MODEL_ANSWER_SENTINEL);
    expect(outcome.assistant_text).not.toContain(STALENESS_PREFIX);
    expect(outcome.assistant_text).not.toContain(UNCONFIRMED_PREFIX);

    const fact = outcome.handler_facts[0];
    if (fact.fact_type !== 'explain_results') throw new Error('wrong fact type');
    expect(fact.result.staleness_prefixed).toBe(false);
  });

  it('TWIN — degraded-by-null-projection (fresh fact, nothing to summarise) → STILL BLOCKED', async () => {
    // Invariant guard: a successful CURRENT fact that cannot be summarised must
    // degrade honestly rather than answer. This is a block for a reason that has
    // nothing to do with currency — proving the two parameters stay separate.
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFactWithStatus('completed')],
        explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
        analysisProjection: undefined,
        analysisFreshness: makeFreshness('fresh', 'graph_hash_match'),
      }),
    );
    expect(outcome.assistant_text).toMatch(/didn't produce a usable result/);
    expect(outcome.assistant_text).not.toMatch(/No analysis has been run/);
  });
});
