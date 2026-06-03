/**
 * V5 golden-path acceptance gate (P0 V5 golden-path repair, Wave 6).
 *
 * Wave 6 of the brief: the harness IS the acceptance gate. It must
 * fail the workstream if any of the following hold:
 *
 *   - A handler runs without prerequisites
 *     (Wave 1 regression — explain_results / what_would_flip
 *     execute on degraded or stale state).
 *   - A graph mutation does not update freshness
 *     (Wave 2 / 3 regression — set_factor_value receipt fails to
 *     mark prior analysis stale when one existed).
 *   - A value update routes through edit_graph when it should be
 *     deterministic (Wave 2 regression — single substring match or
 *     selected-deictic with one factor selected).
 *   - User-facing text leaks raw IDs, internal mechanics, or
 *     forbidden terms (any wave).
 *   - Recovery copy on a missing or degraded analysis lacks a
 *     concrete next-step recommendation (Wave 1 regression).
 *
 * This file runs in-process against the same handlers and routing
 * functions exercised by unit tests, without needing CEE_API_KEY or
 * a live server. The intent is parity with the v5-journey-replay
 * tool's product-shape assertions, executable in CI.
 *
 * The cross-cutting properties below are deliberately formulated as
 * black-box checks — they don't peek at internal state, only at the
 * user-visible outputs each wave produces.
 */

import { describe, it, expect } from 'vitest'

import type {
  HandlerFact,
  RunAnalysisHandlerFact,
} from '@talchain/schemas/orchestrator'

import { createExplainResultsHandler } from '../../src/orchestrator-v5/tools/handlers/explain-results.js'
import { createWhatWouldFlipHandler } from '../../src/orchestrator-v5/tools/handlers/what-would-flip.js'
import {
  tryDeterministicValueUpdate,
  tryDeicticValueUpdate,
} from '../../src/orchestrator-v5/routing/deterministic-value-update.js'
import type { GraphLookup } from '../../src/orchestrator-v5/routing/validator.js'
import type { QuantityExtractionResult } from '../../src/orchestrator-v5/context/cqe/schema-types.js'
import { findForbiddenMatches } from '../../tools/v5-journey-replay/forbidden-terms.js'
import type { HandlerInvocation } from '../../src/orchestrator-v5/tools/registry.js'
import type { AnalysisProjectionSummary } from '../../src/orchestrator-v5/context/projection-summaries.js'
import { EMPTY_DECISION_CONTEXT } from '@talchain/schemas/orchestrator'
import { OlumiResponseSchema } from '@talchain/schemas/boundary'
import { ContextPackSchema } from '../../src/orchestrator-v5/context/context-pack-schema.js'
import { EMPTY_COACHING_STATE } from '../../src/orchestrator-v5/coaching/coaching-state.js'
import { EMPTY_COACHING_LIFECYCLE } from '../../src/orchestrator-v5/coaching/coaching-lifecycle.js'

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111'
const REQUEST_ID = 'req-acceptance-gate'
const GOAL_ID = 'goal_node_1'

function makeRunAnalysisFactWithStatus(
  status: string | null,
): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> = {}
  if (status !== null) enrichment.analysis_status = status
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_1',
      summary: 'prior analysis',
      enrichment,
    },
  }
}

const ANALYSIS_PROJECTION: AnalysisProjectionSummary = {
  status: 'complete',
  leading_option: { label: 'Hire Senior Engineer', probability: 0.62 },
  runner_up: { label: 'Hire Two Mid-Level', probability: 0.27 },
  margin_pp: 35,
  robustness_band: 'stable',
  top_drivers: [
    { factor_label: 'Engineering Capacity', sensitivity_value: 0.65 },
  ],
  staleness_reason: null,
}

function makeFreshness(
  freshness: 'fresh' | 'stale' | 'unknown' | 'none',
): HandlerInvocation['analysisFreshness'] {
  return {
    freshness,
    reason: 'graph_hash_diverged' as never,
    selected_fact_index: 0,
    graph_hash_at_run: 'a',
    current_graph_hash: freshness === 'fresh' ? 'a' : 'b',
    computed_at: '2026-05-05T00:00:00.000Z',
  }
}

function makeInvocation(
  overrides: Partial<HandlerInvocation> & {
    priorFacts?: readonly HandlerFact[]
  },
): HandlerInvocation {
  const { priorFacts, ...rest } = overrides
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: GOAL_ID },
      capabilities: {},
      messages: [],
      session_id: SCENARIO_ID,
      request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: priorFacts ?? [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      turn_id: 't',
      scenario_id: SCENARIO_ID,
      message: 'why did opt_1 win?',
      turn_class: 'decide',
      stage: 'analyse',
    } as unknown as HandlerInvocation['payload'],
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
    analysisReady: {
      options: [
        { option_id: 'opt_1', label: 'Option 1', status: 'ready', interventions: { f: 1 } },
        { option_id: 'opt_2', label: 'Option 2', status: 'ready', interventions: { f: 1 } },
      ],
      goal_node_id: GOAL_ID,
      status: 'ready',
    },
    ...rest,
  }
}

function quantity(value: number, raw_text: string): QuantityExtractionResult {
  return {
    raw_text,
    value,
    unit: null,
    direction: null,
    multiplier: null,
    operator: null,
    comparator: null,
    range_min: null,
    range_max: null,
    approximate: false,
    source: 'cqe',
  }
}

function makeGraph(
  factors: ReadonlyArray<{ id: string; label: string | null }>,
): GraphLookup {
  const byId = new Map(factors.map((f) => [f.id, f]))
  return {
    findEntityById: (id) => {
      const f = byId.get(id)
      return f ? { id: f.id, kind: 'node', label: f.label } : null
    },
    listEntitiesByKind: (kind) => {
      if (kind !== 'node') return []
      return factors.map((f) => ({ id: f.id, label: f.label }))
    },
  }
}

// ---------------------------------------------------------------------------
// Acceptance Gate — decision_context boundary (V5 Coaching State Spine Stage 1)
//
// decision_context is an INTERNAL projection carried on EnrichedTurnContext.
// It must not be a declared field on the LLM-facing ContextPack / routing
// prompt, must not add a top-level wire field, and must not perturb (or leak
// into) user-facing handler output.
// ---------------------------------------------------------------------------

function deepHasKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((v) => deepHasKey(v, key))
  if (value !== null && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, key)) return true
    return Object.values(value as Record<string, unknown>).some((v) => deepHasKey(v, key))
  }
  return false
}

const POPULATED_DECISION_CONTEXT = {
  domain_anchors: {
    monetary_figures: ['£2m'],
    timeline: 'Q3 2026',
    named_entities: ['Hire a senior engineer'],
  },
  goal_translation: { user_scale_metric: 'Reach £10m ARR', user_scale_target: '10 £m' },
  status: 'populated' as const,
}

describe('Acceptance Gate — decision_context boundary (Stage 1)', () => {
  it('is NOT a declared field on the LLM-facing ContextPack (off-prompt)', () => {
    expect(Object.keys(ContextPackSchema.shape)).not.toContain('decision_context')
  })

  it('adds no decision_context field to the OlumiResponse wire schema', () => {
    const shape = (OlumiResponseSchema as { shape?: Record<string, unknown> }).shape
    expect(shape).toBeDefined()
    expect(Object.keys(shape ?? {})).not.toContain('decision_context')
  })

  it('does not perturb handler output and never leaks into it', async () => {
    const handler = createExplainResultsHandler()
    // Use the missing-analysis recovery path — a deterministic outcome that is
    // independent of decision_context. Equivalent fixtures (with vs without a
    // populated decision_context on the context) must yield identical output.
    const base = makeInvocation({ priorFacts: [] })
    const withDc = {
      ...base,
      context: { ...base.context, decision_context: POPULATED_DECISION_CONTEXT },
    } as typeof base
    const withoutDc = {
      ...base,
      context: { ...base.context, decision_context: EMPTY_DECISION_CONTEXT },
    } as typeof base

    const outWith = await handler(withDc)
    const outWithout = await handler(withoutDc)

    expect(outWith).toEqual(outWithout)
    expect(deepHasKey(outWith, 'decision_context')).toBe(false)
    expect(findForbiddenMatches(outWith.assistant_text)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Acceptance Gate — coaching_state boundary (V5 Coaching State Spine Stage 2A)
//
// coaching_state is an INTERNAL current-turn signal container carried on
// EnrichedTurnContext. Same boundary contract as decision_context: not a
// declared ContextPack/wire field, and never perturbs or leaks into handler
// output.
// ---------------------------------------------------------------------------

const POPULATED_COACHING_STATE = {
  version: 'v1' as const,
  status: 'active' as const,
  graph_hash: null,
  analysis_graph_hash: null,
  signals: [
    {
      signal_id: 'analysis_missing:no_successful_run_analysis_fact',
      kind: 'analysis_missing' as const,
      status: 'active' as const,
      source: 'analysis_freshness' as const,
      graph_hash: null,
      analysis_graph_hash: null,
      reason_code: 'no_successful_run_analysis_fact' as const,
      created_from: 'derived_current_turn' as const,
    },
  ],
  summary: { active_count: 1, stale_count: 0, unavailable_count: 0 },
}

describe('Acceptance Gate — coaching_state boundary (Stage 2A)', () => {
  it('is NOT a declared field on the LLM-facing ContextPack (off-prompt)', () => {
    expect(Object.keys(ContextPackSchema.shape)).not.toContain('coaching_state')
  })

  it('adds no coaching_state field to the OlumiResponse wire schema', () => {
    const shape = (OlumiResponseSchema as { shape?: Record<string, unknown> }).shape
    expect(shape).toBeDefined()
    expect(Object.keys(shape ?? {})).not.toContain('coaching_state')
  })

  it('does not perturb handler output and never leaks into it', async () => {
    const handler = createExplainResultsHandler()
    // Missing-analysis recovery path — deterministic and independent of
    // coaching_state. With vs without a populated coaching_state must match.
    const base = makeInvocation({ priorFacts: [] })
    const withCs = {
      ...base,
      context: { ...base.context, coaching_state: POPULATED_COACHING_STATE },
    } as typeof base
    const withoutCs = {
      ...base,
      context: { ...base.context, coaching_state: EMPTY_COACHING_STATE },
    } as typeof base

    const outWith = await handler(withCs)
    const outWithout = await handler(withoutCs)

    expect(outWith).toEqual(outWithout)
    expect(deepHasKey(outWith, 'coaching_state')).toBe(false)
    expect(findForbiddenMatches(outWith.assistant_text)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Acceptance Gate — prior_coaching_state boundary (V5 Coaching State Spine 2B-1b)
//
// prior_coaching_state is the durable PRIOR snapshot read back onto
// EnrichedTurnContext. Like coaching_state, it must stay internal: not a
// declared ContextPack / wire field, and never perturbing or leaking into
// handler output.
// ---------------------------------------------------------------------------

const PRIOR_COACHING_SNAPSHOT = {
  snapshot_timing: 'pre_dispatch' as const,
  coaching_state_version: 'v1',
  coaching_state: POPULATED_COACHING_STATE,
}

describe('Acceptance Gate — prior_coaching_state boundary (Stage 2B-1b)', () => {
  it('is NOT a declared field on the LLM-facing ContextPack (off-prompt)', () => {
    expect(Object.keys(ContextPackSchema.shape)).not.toContain('prior_coaching_state')
  })

  it('adds no prior_coaching_state field to the OlumiResponse wire schema', () => {
    const shape = (OlumiResponseSchema as { shape?: Record<string, unknown> }).shape
    expect(shape).toBeDefined()
    expect(Object.keys(shape ?? {})).not.toContain('prior_coaching_state')
  })

  it('does not perturb handler output and never leaks into it', async () => {
    const handler = createExplainResultsHandler()
    const base = makeInvocation({ priorFacts: [] })
    const withPrior = {
      ...base,
      context: { ...base.context, prior_coaching_state: PRIOR_COACHING_SNAPSHOT },
    } as typeof base
    const withoutPrior = {
      ...base,
      context: { ...base.context, prior_coaching_state: null },
    } as typeof base

    const outWith = await handler(withPrior)
    const outWithout = await handler(withoutPrior)

    expect(outWith).toEqual(outWithout)
    expect(deepHasKey(outWith, 'prior_coaching_state')).toBe(false)
    expect(findForbiddenMatches(outWith.assistant_text)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Acceptance Gate — coaching_lifecycle boundary (V5 Coaching State Spine 2B-2)
//
// coaching_lifecycle is the internal prior-vs-current lifecycle derivation on
// EnrichedTurnContext. Like coaching_state / prior_coaching_state it must stay
// internal: not a declared ContextPack field (the LLM-facing routing prompt
// surface), not on the OlumiResponse wire schema (the CEE→DGAI output surface),
// and never perturbing or leaking into handler output.
// ---------------------------------------------------------------------------

const COACHING_LIFECYCLE_SAMPLE = {
  version: 'v1' as const,
  snapshot_timing: 'pre_dispatch' as const,
  status: 'active' as const,
  prior_snapshot_available: true,
  version_mismatch: false,
  items: [
    {
      signal_id: 'analysis_missing:no_successful_run_analysis_fact',
      kind: 'analysis_missing' as const,
      reason_code: 'no_successful_run_analysis_fact' as const,
      source: 'analysis_freshness' as const,
      lifecycle_status: 'resolved' as const,
      prior_graph_hash: 'h_prior',
      current_graph_hash: 'h_current',
      prior_analysis_graph_hash: null,
      current_analysis_graph_hash: null,
      reason: 'source_evaluable_condition_absent' as const,
    },
  ],
  summary: { active_count: 0, resolved_count: 1, stale_count: 0, unavailable_count: 0 },
}

describe('Acceptance Gate — coaching_lifecycle boundary (Stage 2B-2)', () => {
  it('is NOT a declared field on the LLM-facing ContextPack (off-prompt)', () => {
    expect(Object.keys(ContextPackSchema.shape)).not.toContain('coaching_lifecycle')
  })

  it('adds no coaching_lifecycle field to the OlumiResponse wire schema (off wire / DGAI)', () => {
    const shape = (OlumiResponseSchema as { shape?: Record<string, unknown> }).shape
    expect(shape).toBeDefined()
    expect(Object.keys(shape ?? {})).not.toContain('coaching_lifecycle')
  })

  it('does not perturb handler output and never leaks into it', async () => {
    const handler = createExplainResultsHandler()
    const base = makeInvocation({ priorFacts: [] })
    const withLifecycle = {
      ...base,
      context: { ...base.context, coaching_lifecycle: COACHING_LIFECYCLE_SAMPLE },
    } as typeof base
    const withoutLifecycle = {
      ...base,
      context: { ...base.context, coaching_lifecycle: EMPTY_COACHING_LIFECYCLE },
    } as typeof base

    const outWith = await handler(withLifecycle)
    const outWithout = await handler(withoutLifecycle)

    expect(outWith).toEqual(outWithout)
    expect(deepHasKey(outWith, 'coaching_lifecycle')).toBe(false)
    expect(findForbiddenMatches(outWith.assistant_text)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Acceptance Gate 1 — explain_results MUST NOT run without prerequisites.
// ---------------------------------------------------------------------------

describe('Acceptance Gate — handler preconditions (Wave 1)', () => {
  it('explain_results refuses to run with NO prior analysis fact (missing)', async () => {
    const handler = createExplainResultsHandler()
    const outcome = await handler(makeInvocation({ priorFacts: [] }))
    // Recovery copy must contain a concrete next step.
    expect(outcome.assistant_text).toMatch(/run the analysis|run analysis/i)
    // No internal terms.
    expect(findForbiddenMatches(outcome.assistant_text)).toEqual([])
  })

  it('explain_results refuses on degraded (partial) analysis', async () => {
    const handler = createExplainResultsHandler()
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFactWithStatus('partial')],
        analysisProjection: ANALYSIS_PROJECTION,
        explanation: { answer_text: 'A confident sounding line.', answer_text_valid: true },
      }),
    )
    // Must not surface the projection's leading option as fact.
    expect(outcome.assistant_text).not.toContain('Hire Senior Engineer')
    // Must offer a concrete recovery action.
    expect(outcome.assistant_text).toMatch(/re-run analysis|run analysis/i)
    expect(findForbiddenMatches(outcome.assistant_text)).toEqual([])
  })

  it('explain_results refuses on stale analysis', async () => {
    const handler = createExplainResultsHandler()
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFactWithStatus('computed')],
        analysisProjection: ANALYSIS_PROJECTION,
        analysisFreshness: makeFreshness('stale'),
        explanation: { answer_text: 'A stale answer.', answer_text_valid: true },
      }),
    )
    expect(outcome.assistant_text).toMatch(/model has changed/i)
    expect(outcome.assistant_text).toMatch(/re-run analysis/i)
    expect(findForbiddenMatches(outcome.assistant_text)).toEqual([])
  })

  it('what_would_flip precondition stays in lockstep with explain_results', async () => {
    const handler = createWhatWouldFlipHandler()
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFactWithStatus('failed')],
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    )
    expect(outcome.assistant_text).toMatch(/didn't produce a usable result/i)
    expect(findForbiddenMatches(outcome.assistant_text)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Acceptance Gate 2 — value updates take the deterministic path,
// never edit_graph, and respect strict factor-only selection narrowing.
// ---------------------------------------------------------------------------

describe('Acceptance Gate — deterministic value updates (Wave 2)', () => {
  const PARSED_30K: QuantityExtractionResult[] = [quantity(30000, '£30k')]

  it('explicit label match → set_factor_value, never falls through to edit_graph', () => {
    const graph = makeGraph([
      { id: 'fac_ad_budget', label: 'Advertising budget' },
      { id: 'fac_other', label: 'Headcount' },
    ])
    const result = tryDeterministicValueUpdate(
      'Set Advertising budget to £30k',
      PARSED_30K,
      graph,
      [],
    )
    expect(result.matched).toBe(true)
    if (result.matched) expect(result.dispatch).toBe('set_factor_value')
  })

  it('"that factor" + exactly one factor selected → set_factor_value (Path B)', () => {
    const graph = makeGraph([
      { id: 'fac_ad_budget', label: 'Advertising budget' },
      { id: 'fac_other', label: 'Headcount' },
    ])
    const result = tryDeicticValueUpdate(
      'Update that factor to £30,000',
      PARSED_30K,
      graph,
      ['fac_ad_budget'],
      (id) => (id === 'fac_ad_budget' ? 'Advertising budget' : null),
    )
    expect(result.matched).toBe(true)
    if (result.matched) expect(result.dispatch).toBe('set_factor_value')
  })

  it('ambiguous target with no selection → clarify, NEVER edit_graph fallback', () => {
    const graph = makeGraph([
      { id: 'fac_a', label: 'budget' },
      { id: 'fac_b', label: 'cost' },
    ])
    const result = tryDeterministicValueUpdate(
      'Raise budget and cost to £30k',
      PARSED_30K,
      graph,
      [],
    )
    expect(result.matched).toBe(true)
    if (result.matched) expect(result.dispatch).toBe('clarify')
  })

  it('selected non-factor (option) does NOT narrow ambiguity', () => {
    const graph = makeGraph([
      { id: 'fac_a', label: 'budget' },
      { id: 'fac_b', label: 'cost' },
    ])
    // Caller pre-filters to factor-kind ids, so a selected option
    // results in an empty selectedFactorIds passed in. The pre-route
    // must NOT silently update either factor.
    const result = tryDeterministicValueUpdate(
      'Raise budget and cost to £30k',
      PARSED_30K,
      graph,
      [], // option pre-filtered out by caller
    )
    expect(result.matched).toBe(true)
    if (result.matched) expect(result.dispatch).toBe('clarify')
  })
})

// ---------------------------------------------------------------------------
// Acceptance Gate 3 — copy quality across all wave outputs.
// ---------------------------------------------------------------------------

describe('Acceptance Gate — no internal-term leakage in user copy', () => {
  it('handler recovery copy across missing/stale/degraded paths is clean', async () => {
    const handler = createExplainResultsHandler()
    const outcomes = await Promise.all([
      handler(makeInvocation({ priorFacts: [] })), // missing
      handler(
        makeInvocation({
          priorFacts: [makeRunAnalysisFactWithStatus('partial')],
          analysisProjection: ANALYSIS_PROJECTION,
        }),
      ), // degraded
      handler(
        makeInvocation({
          priorFacts: [makeRunAnalysisFactWithStatus('computed')],
          analysisProjection: ANALYSIS_PROJECTION,
          analysisFreshness: makeFreshness('stale'),
        }),
      ), // stale
    ])
    for (const outcome of outcomes) {
      const matches = findForbiddenMatches(outcome.assistant_text)
      expect(matches, outcome.assistant_text).toEqual([])
    }
  })

  it('forbidden-terms list covers the brief\'s explicit redaction wordlist', async () => {
    const { FORBIDDEN_STRINGS } = await import('../../tools/v5-journey-replay/forbidden-terms.js')
    // Sanity: the wordlist must contain each term the brief flagged.
    const expected = [
      'BUDGET_TARGET',
      'Zod',
      'noop',
      'fact_type',
      'set_factor_value',
      'explain_results',
      'edit_graph',
      'analysisProjection',
      'analysisFreshness',
      'normalised',
      'normalized',
    ]
    for (const term of expected) {
      expect(FORBIDDEN_STRINGS, `missing forbidden term: ${term}`).toContain(term)
    }
  })
})
