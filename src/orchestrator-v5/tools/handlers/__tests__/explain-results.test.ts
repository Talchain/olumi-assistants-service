/**
 * Unit tests for the V5 `explain_results` answer-carrying handler.
 *
 * Covers registration, validator accept/reject, fact persistence,
 * the precondition pass/fail paths (with the critical non-noop filter),
 * and the new answer-carrying contract: happy path consumes
 * `invocation.explanation.answer_text`, fallback path composes a
 * deterministic response from `invocation.analysisProjection`.
 */

import { describe, it, expect } from 'vitest';

import {
  ExplainResultsHandlerFactSchema,
  type HandlerFact,
  type RunAnalysisHandlerFact,
} from '@talchain/schemas/orchestrator';

import { createExplainResultsHandler } from '../explain-results.js';
import type {
  HandlerInvocation,
} from '../../registry.js';
import type { AnalysisProjectionSummary } from '../../../context/projection-summaries.js';
import { validateToolCall } from '../../../routing/validator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../../routing/validation-registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import { createRegistry, resolveHandler } from '../../registry.js';
import type { ScenarioReader } from '../run-analysis.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST_ID = 'req-explain-results';
const GOAL_ID = 'goal_node_1';

const STUB_SCENARIO_READER: ScenarioReader = () =>
  Promise.reject(new Error('not exercised'));
const STUB_PLOT_CLIENT: PLoTClient = {
  run: () => Promise.reject(new Error('not exercised')),
  validatePatch: () => Promise.reject(new Error('not exercised')),
} as unknown as PLoTClient;

function makeRunAnalysisFact(noop = false): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_1',
      summary: 'Analysis complete.',
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
  };
}

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

function makeInvocation(
  overrides?: {
    priorFacts?: readonly HandlerFact[];
    optionCount?: number;
    explanation?: HandlerInvocation['explanation'];
    analysisProjection?: AnalysisProjectionSummary;
    analysisFreshness?: HandlerInvocation['analysisFreshness'];
  },
): HandlerInvocation {
  const optionCount = overrides?.optionCount ?? 2;
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: GOAL_ID },
      capabilities: {},
      messages: [{ role: 'user', content: 'why did opt_1 win?' }],
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
      message: 'why did opt_1 win?',
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

function buildProposal(overrides?: Partial<ProposalAction>): ProposalAction {
  return {
    handler_id: 'explain_results',
    entity: {
      id: 'opt_1',
      kind: 'option',
      label: 'Option 1',
      resolution_status: 'resolved',
      resolution_method: 'label_match',
    },
    parameters: [],
    cited_context_fields: [],
    ...overrides,
  };
}

const VALID_ANSWER_TEXT =
  'Hire Senior Engineer leads at 62 per cent because Engineering Capacity carries the strongest sensitivity in the model, well ahead of the runner-up.';

// V5-LANE-B-STRUCTURAL-01: the standalone "what to validate" beat appended
// on the execute path. With the default ANALYSIS_PROJECTION (no
// fragile_edges, top driver "Engineering Capacity") and VALID_ANSWER_TEXT
// (mentions the driver but carries no validation vocabulary), the dedup
// guard does NOT fire and the driver-variant beat is appended.
const DRIVER_BEAT_TEXT =
  "The evidence that would most improve confidence is firmer support for 'Engineering Capacity', since it carries the most weight in this result.";
const VALID_ANSWER_WITH_BEAT = `${VALID_ANSWER_TEXT}\n\n${DRIVER_BEAT_TEXT}`;

describe('explain_results — registration', () => {
  it('is registered in the default V5 handler registry', () => {
    const registry = createRegistry({
      scenarioReader: STUB_SCENARIO_READER,
      plotClient: STUB_PLOT_CLIENT,
    });
    expect(resolveHandler(registry, 'explain_results')).not.toBeNull();
  });

  it('declares accepted_entity_kinds = [goal, option, node] in the validation registry', () => {
    const decl = HANDLER_VALIDATION_REGISTRY.explain_results;
    expect(decl).toBeDefined();
    expect(decl?.accepted_entity_kinds).toEqual(['goal', 'option', 'node']);
  });
});

describe('explain_results — validator', () => {
  it('accepts an option-kind proposal', () => {
    const result = validateToolCall(buildProposal(), undefined, HANDLER_VALIDATION_REGISTRY);
    expect(result.valid).toBe(true);
  });

  it('accepts a node-kind proposal (factor/decision/outcome/risk/action — V5 routeability fix)', () => {
    // V5 Chip Routeability Contract lane: a factor-centric "why did this
    // factor matter?" post-analysis question resolves to wire-kind 'node'.
    // The handler ignores the entity and explains the whole analysis, so a
    // node target is valid. Previously this dead-ended on ENTITY_KIND_MISMATCH.
    const result = validateToolCall(
      buildProposal({
        entity: {
          id: 'node_dec_1',
          kind: 'node',
          resolution_status: 'resolved',
          resolution_method: 'kind_inference',
        },
      }),
      undefined,
      HANDLER_VALIDATION_REGISTRY,
    );
    expect(result.valid).toBe(true);
  });
});

describe('explain_results — precondition (analysis fact)', () => {
  it('returns the deterministic template when no run_analysis fact exists', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(makeInvocation({ priorFacts: [], optionCount: 2 }));
    expect(outcome.assistant_text).toBe(
      'No analysis has been run on your model yet. ' +
        'Your model has 2 options set up ' +
        'and is ready to analyse. Would you like me to run the analysis?',
    );
    expect(outcome.suppress_orientation).toBe(true);
    const fact = outcome.handler_facts[0];
    expect(fact.fact_type).toBe('explain_results');
    expect(fact.noop).toBe(true);
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.precondition_unmet).toBe(true);
    }
  });

  it('fails precondition when only a noop run_analysis fact is present', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({ priorFacts: [makeRunAnalysisFact(true)], optionCount: 2 }),
    );
    expect(outcome.suppress_orientation).toBe(true);
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.precondition_unmet).toBe(true);
    }
  });
});

describe('explain_results — answer-carrying contract', () => {
  it('happy path: preserves Sonnet answer_text verbatim and appends the validation beat as a final paragraph', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: {
          answer_text: VALID_ANSWER_TEXT,
          answer_text_valid: true,
        },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    expect(outcome.assistant_text).toBe(VALID_ANSWER_WITH_BEAT);
    expect(outcome.assistant_text.startsWith(VALID_ANSWER_TEXT)).toBe(true);
    expect(outcome.suppress_orientation).toBe(true);
    expect(outcome.llm_calls_used).toBe(0);
    expect(outcome.__validation_beat).toEqual({
      mechanism: 'appended',
      beat: {
        variant: 'driver',
        driver_label: 'Engineering Capacity',
        text: DRIVER_BEAT_TEXT,
      },
    });
  });

  it('bare tool_use regression: missing explanation → deterministic fallback with leading option + driver', async () => {
    // Reproduces the v40 staging Test D failure shape: explanation is
    // absent (Sonnet emitted bare tool_use). The handler must NOT return
    // the old 32-char SAFE_FALLBACK stub; it must compose a useful
    // response from the analysis projection.
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: undefined,
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    expect(outcome.assistant_text.length).toBeGreaterThan(80);
    expect(outcome.assistant_text).toContain('Hire Senior Engineer');
    expect(outcome.assistant_text).toContain('Engineering Capacity');
    expect(outcome.assistant_text).not.toBe('Here is what the analysis shows.');
  });

  it('invalid answer_text → deterministic fallback (probability + driver from projection)', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: {
          answer_text: 'too short',
          answer_text_valid: false,
          answer_validation_error: 'too_short',
        },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    expect(outcome.assistant_text).toContain('Hire Senior Engineer');
    // Phase 2 workstream C: probability rendered as percentage (0.62 → "62%").
    expect(outcome.assistant_text).toContain('62%');
    expect(outcome.assistant_text).toContain('Engineering Capacity');
    // Driver sensitivity rendered as bucketed lead-framing prose
    // (formatSensitivityDirection composes adverb + verb against the
    // bandFromMagnitude thresholds). 0.65 magnitude → moderate band
    // [0.3, 0.7), positive sign → "moderately strengthens the lead".
    expect(outcome.assistant_text).toMatch(/strengthens the lead/);
    expect(outcome.assistant_text).not.toMatch(/-?\d+\.\d/);
  });

  it('persists a fact that round-trips through the schema on the happy path', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: {
          answer_text: VALID_ANSWER_TEXT,
          answer_text_valid: true,
        },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    const parsed = ExplainResultsHandlerFactSchema.safeParse(outcome.handler_facts[0]);
    expect(parsed.success).toBe(true);
  });

  it('always sets suppress_orientation: true on explanation turns (handler owns the user-visible string)', async () => {
    const handler = createExplainResultsHandler();
    const valid = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    const fallback = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: undefined,
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    expect(valid.suppress_orientation).toBe(true);
    expect(fallback.suppress_orientation).toBe(true);
  });
});

describe('explain_results — diagnostic fields', () => {
  it('Sonnet valid → answer_source=sonnet, fallback_reason=null, length matches text', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.answer_source).toBe('sonnet');
      expect(fact.result.fallback_reason).toBeNull();
      // answer_text_length measures the user-visible string, which now
      // includes the appended validation beat.
      expect(fact.result.answer_text_length).toBe(outcome.assistant_text.length);
      expect(fact.result.answer_text_length).toBe(VALID_ANSWER_WITH_BEAT.length);
    }
  });

  it('Sonnet invalid (too_short) → answer_source=deterministic_fallback, fallback_reason=too_short', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: {
          answer_text: 'too short',
          answer_text_valid: false,
          answer_validation_error: 'too_short',
        },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.answer_source).toBe('deterministic_fallback');
      expect(fact.result.fallback_reason).toBe('too_short');
      expect(fact.result.answer_text_length).toBe(outcome.assistant_text.length);
    }
  });

  it('Sonnet absent → answer_source=deterministic_fallback, fallback_reason=missing', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: undefined,
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.answer_source).toBe('deterministic_fallback');
      expect(fact.result.fallback_reason).toBe('missing');
    }
  });

  it('mutation_language_detected validator code maps to fallback_reason=mutation_language', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: {
          answer_text: 'irrelevant',
          answer_text_valid: false,
          answer_validation_error: 'mutation_language_detected',
        },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.fallback_reason).toBe('mutation_language');
    }
  });

  it('precondition fail → answer_source=precondition_template, fallback_reason explicitly null', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(makeInvocation({ priorFacts: [], optionCount: 2 }));
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.answer_source).toBe('precondition_template');
      expect(fact.result.fallback_reason).toBeNull();
      expect(fact.result.answer_text_length).toBe(outcome.assistant_text.length);
    }
  });
});

// ---------------------------------------------------------------------------
// P0 V5 golden-path repair — combined success+currentness precondition.
// The handler must distinguish missing vs degraded vs stale so the right
// recovery copy + chip surfaces. Earlier predicate accepted any non-noop
// run_analysis fact regardless of analysis_status, letting failed/partial
// facts produce a confident-looking explanation.
// ---------------------------------------------------------------------------

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

describe('explain_results — P0 combined precondition (missing / degraded / stale)', () => {
  it('missing: no run_analysis fact → absent template (existing behaviour preserved)', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(makeInvocation({ priorFacts: [], optionCount: 2 }));
    expect(outcome.assistant_text).toMatch(/No analysis has been run on your model yet/);
    expect(outcome.suppress_orientation).toBe(true);
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.precondition_unmet).toBe(true);
      expect(fact.result.answer_source).toBe('precondition_template');
    }
  });

  it('degraded: latest fact has status="partial" → degraded template, never a confident explanation', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFactWithStatus('partial')],
        explanation: {
          // Sonnet produced a "valid" answer that we MUST NOT use because
          // the underlying analysis is degraded.
          answer_text: VALID_ANSWER_TEXT,
          answer_text_valid: true,
        },
        analysisProjection: ANALYSIS_PROJECTION,
      }),
    );
    expect(outcome.assistant_text).toMatch(/didn't produce a usable result/);
    expect(outcome.assistant_text).not.toContain('Hire Senior Engineer');
    expect(outcome.suppress_orientation).toBe(true);
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.precondition_unmet).toBe(true);
    }
  });

  it('degraded: status="failed" → degraded template', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFactWithStatus('failed')],
      }),
    );
    expect(outcome.assistant_text).toMatch(/didn't produce a usable result/);
  });

  it('degraded: status="blocked" → degraded template', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFactWithStatus('blocked')],
      }),
    );
    expect(outcome.assistant_text).toMatch(/didn't produce a usable result/);
  });

  it('stale: successful fact + freshness=stale → stale template, never the projection answer', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFactWithStatus('computed')],
        explanation: {
          answer_text: VALID_ANSWER_TEXT,
          answer_text_valid: true,
        },
        analysisProjection: ANALYSIS_PROJECTION,
        analysisFreshness: makeFreshness('stale', 'graph_hash_diverged'),
      }),
    );
    // V5 stale-aware explain recovery: the leading sentence must match
    // the brief's required wording verbatim. Pinned here so future
    // copy-polish cannot drift the runtime out of brief compliance
    // without flipping this assertion (which the replay harness
    // mirrors).
    expect(outcome.assistant_text).toMatch(
      /^These results may be out of date because the model has changed since the last analysis\./,
    );
    expect(outcome.assistant_text).not.toContain('Hire Senior Engineer');
    expect(outcome.suppress_orientation).toBe(true);
  });

  it('defensive: successful (fresh) fact + null projection → degraded template, never "no analysis"', async () => {
    // Invariant: 'missing' ⟺ no successful fact. A successful (fresh) fact that
    // cannot be summarised (null projection) must degrade honestly — it must
    // NOT deny that analysis has run (Tier 0).
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

  it('legacy: status=null + unknown freshness → unconfirmed template (Tier 0: never executes as fresh)', async () => {
    // Tier 0 doctrine: 'unknown' is treated as stale for user-facing freshness.
    // A legacy fact whose currency cannot be confirmed must NOT be explained as
    // if current; it returns the "can't confirm it still matches" copy instead.
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFactWithStatus(null)],
        explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
        analysisProjection: ANALYSIS_PROJECTION,
        analysisFreshness: {
          freshness: 'unknown',
          reason: 'legacy_fact_missing_hash' as never,
          selected_fact_index: 0,
          graph_hash_at_run: null,
          current_graph_hash: 'hash-current',
          computed_at: null,
        },
      }),
    );
    expect(outcome.assistant_text).toMatch(/can'?t confirm it still matches the current model/i);
    expect(outcome.assistant_text).not.toBe(VALID_ANSWER_WITH_BEAT);
    expect(outcome.assistant_text).not.toMatch(/the model has changed/i);
  });

  it('fresh: successful fact + freshness=fresh → executes normally', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFactWithStatus('computed')],
        explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
        analysisProjection: ANALYSIS_PROJECTION,
        analysisFreshness: makeFreshness('fresh', 'graph_hash_match'),
      }),
    );
    expect(outcome.assistant_text).toBe(VALID_ANSWER_WITH_BEAT);
  });

  it('redaction (validation beat): appended link/driver beats contain no internal terms or raw IDs', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeInvocation({
        priorFacts: [makeRunAnalysisFact(false)],
        explanation: { answer_text: VALID_ANSWER_TEXT, answer_text_valid: true },
        analysisProjection: {
          ...ANALYSIS_PROJECTION,
          fragile_edges: [
            { from_label: 'Local Senior Hire Programme', to_label: 'Q3 Roadmap Delivery Capacity' },
          ],
        },
      }),
    );
    const appended = outcome.assistant_text.slice(VALID_ANSWER_TEXT.length);
    for (const pat of [/\bfragile_edges\b/i, /\bopt_/i, /\bfac_/i, /\bnode_/i, /-?\d+\.\d/, /\brecommend/i]) {
      expect(appended, appended).not.toMatch(pat);
    }
  });

  it('redaction: missing/degraded/stale recovery copy contains no internal terms', async () => {
    const handler = createExplainResultsHandler();
    const forbidden = [
      /\bnoop\b/i,
      /\bfact_type\b/i,
      /\bzod\b/i,
      /\bgraph_hash/i,
      /\banalysis_status\b/i,
      /\bpartial\b/i,
      /\bfailed\b/i,
      /\bblocked\b/i,
      /\bopt_/i,
      /\bfac_/i,
    ];
    const outcomes = await Promise.all([
      handler(makeInvocation({ priorFacts: [] })),
      handler(makeInvocation({ priorFacts: [makeRunAnalysisFactWithStatus('partial')] })),
      handler(
        makeInvocation({
          priorFacts: [makeRunAnalysisFactWithStatus('computed')],
          analysisProjection: ANALYSIS_PROJECTION,
          analysisFreshness: makeFreshness('stale', 'graph_hash_diverged'),
        }),
      ),
    ]);
    for (const outcome of outcomes) {
      for (const pat of forbidden) {
        expect(outcome.assistant_text, outcome.assistant_text).not.toMatch(pat);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// V5-LANE-B-STRUCTURAL-01 — the "what to validate" beat on the execute path.
// Sonnet-valid append (link first, driver fallback), dedup skip, omit on no
// signal, fallback parity, and schema round-trip with the beat present.
// ---------------------------------------------------------------------------

const FRAGILE_PROJECTION: AnalysisProjectionSummary = {
  ...ANALYSIS_PROJECTION,
  fragile_edges: [
    {
      from_label: 'Local Senior Hire Programme',
      to_label: 'Q3 Roadmap Delivery Capacity',
    },
  ],
};

const LINK_BEAT_TEXT =
  "One useful confidence check is real-world support for the link from 'Local Senior Hire Programme' to 'Q3 Roadmap Delivery Capacity' rather than the current model estimate, since the robustness check flagged it as fragile.";

describe('explain_results — validation beat (V5-LANE-B-STRUCTURAL-01)', () => {
  function makeExecuteInvocation(overrides?: {
    explanation?: HandlerInvocation['explanation'];
    analysisProjection?: AnalysisProjectionSummary;
  }): HandlerInvocation {
    return makeInvocation({
      priorFacts: [makeRunAnalysisFact(false)],
      explanation: overrides?.explanation ?? {
        answer_text: VALID_ANSWER_TEXT,
        answer_text_valid: true,
      },
      analysisProjection: overrides?.analysisProjection ?? ANALYSIS_PROJECTION,
    });
  }

  it('Sonnet-valid + renderable fragile link → link beat appended, names both endpoints', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeExecuteInvocation({ analysisProjection: FRAGILE_PROJECTION }),
    );
    expect(outcome.assistant_text).toBe(`${VALID_ANSWER_TEXT}\n\n${LINK_BEAT_TEXT}`);
    expect(outcome.__validation_beat).toEqual({
      mechanism: 'appended',
      beat: {
        variant: 'link',
        from_label: 'Local Senior Hire Programme',
        to_label: 'Q3 Roadmap Delivery Capacity',
        text: LINK_BEAT_TEXT,
      },
    });
  });

  it('LABELS-ONLY FALLBACK — keeps producer head and emits no ranking superlative', async () => {
    const labelsOnly: AnalysisProjectionSummary = {
      ...ANALYSIS_PROJECTION,
      fragile_edges: [
        { from_label: 'Producer head', to_label: 'Head outcome' },
        { from_label: 'Producer second', to_label: 'Second outcome' },
      ],
    };
    const handler = createExplainResultsHandler();
    const outcome = await handler(makeExecuteInvocation({ analysisProjection: labelsOnly }));

    expect(outcome.__validation_beat).toMatchObject({
      mechanism: 'appended',
      beat: {
        variant: 'link',
        from_label: 'Producer head',
        to_label: 'Head outcome',
      },
    });
    const validationBeat = outcome.__validation_beat;
    if (validationBeat?.mechanism !== 'appended') {
      throw new Error('expected an appended validation beat');
    }
    expect(validationBeat.beat.text).not.toMatch(
      /\b(?:most|top|highest)\b|most likely to change|leans on most/i,
    );
    expect(outcome.assistant_text).not.toContain('Producer second');
  });

  it('HEAD-ONLY MUTANT — a metric-bearing unsorted projection selects its finite maximum', async () => {
    const unsorted = {
      ...ANALYSIS_PROJECTION,
      fragile_edges: [
        {
          from_label: 'Head relationship',
          to_label: 'Head outcome',
          switch_probability: 0.12,
        },
        {
          from_label: 'Maximum relationship',
          to_label: 'Maximum outcome',
          switch_probability: 0.83,
        },
      ],
    } as unknown as AnalysisProjectionSummary;
    const handler = createExplainResultsHandler();
    const outcome = await handler(makeExecuteInvocation({ analysisProjection: unsorted }));

    expect(outcome.__validation_beat).toMatchObject({
      mechanism: 'appended',
      beat: {
        variant: 'link',
        from_label: 'Maximum relationship',
        to_label: 'Maximum outcome',
      },
    });
    expect(outcome.assistant_text).not.toContain('Head relationship');
  });

  it('dedup: both endpoint labels WITHOUT validation vocabulary → still appends (labels alone are not enough)', async () => {
    const handler = createExplainResultsHandler();
    const answer =
      'Local Senior Hire Programme feeds Q3 Roadmap Delivery Capacity, which is why the leading option stays ahead in this model.';
    const outcome = await handler(
      makeExecuteInvocation({
        explanation: { answer_text: answer, answer_text_valid: true },
        analysisProjection: FRAGILE_PROJECTION,
      }),
    );
    expect(outcome.assistant_text).toBe(`${answer}\n\n${LINK_BEAT_TEXT}`);
    expect(outcome.__validation_beat?.mechanism).toBe('appended');
  });

  it('dedup: both endpoint labels AND validation vocabulary → link skipped; distinct driver beat appended instead', async () => {
    const handler = createExplainResultsHandler();
    const answer =
      'The result hinges on whether Local Senior Hire Programme really lifts Q3 Roadmap Delivery Capacity, so it is worth validating that relationship with real hiring data before relying on it.';
    const outcome = await handler(
      makeExecuteInvocation({
        explanation: { answer_text: answer, answer_text_valid: true },
        analysisProjection: FRAGILE_PROJECTION,
      }),
    );
    // The driver ('Engineering Capacity') differs from both endpoints and is
    // absent from the answer, so the driver rung adds a distinct priority.
    expect(outcome.assistant_text).toBe(`${answer}\n\n${DRIVER_BEAT_TEXT}`);
    expect(outcome.__validation_beat).toEqual({
      mechanism: 'appended',
      beat: {
        variant: 'driver',
        driver_label: 'Engineering Capacity',
        text: DRIVER_BEAT_TEXT,
      },
    });
  });

  it('dedup: link covered AND driver already in the answer → dedup_skipped, narrative untouched', async () => {
    const handler = createExplainResultsHandler();
    const answer =
      'The result hinges on Engineering Capacity and on whether Local Senior Hire Programme lifts Q3 Roadmap Delivery Capacity; checking that link against real evidence is the next step.';
    const outcome = await handler(
      makeExecuteInvocation({
        explanation: { answer_text: answer, answer_text_valid: true },
        analysisProjection: FRAGILE_PROJECTION,
      }),
    );
    expect(outcome.assistant_text).toBe(answer);
    expect(outcome.__validation_beat).toEqual({
      mechanism: 'dedup_skipped',
      variant: 'link',
      from_label: 'Local Senior Hire Programme',
      to_label: 'Q3 Roadmap Delivery Capacity',
    });
  });

  it('omit: no fragile link and no driver → narrative untouched, mechanism omitted', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeExecuteInvocation({
        analysisProjection: {
          ...ANALYSIS_PROJECTION,
          top_drivers: [],
          fragile_edges: [],
        },
      }),
    );
    expect(outcome.assistant_text).toBe(VALID_ANSWER_TEXT);
    expect(outcome.__validation_beat).toEqual({
      mechanism: 'omitted',
      reason: 'no_renderable_signal',
    });
  });

  it('ID guard: slug-shaped driver label is never named — beat omitted', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeExecuteInvocation({
        analysisProjection: {
          ...ANALYSIS_PROJECTION,
          top_drivers: [{ factor_label: 'fac_engineering_capacity_1', sensitivity_value: 0.65 }],
          fragile_edges: [],
        },
      }),
    );
    expect(outcome.assistant_text).toBe(VALID_ANSWER_TEXT);
    expect(outcome.__validation_beat?.mechanism).toBe('omitted');
  });

  it('fallback parity: invalid answer_text → fallback narrative carries the same beat before the closing nudge', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeExecuteInvocation({
        explanation: {
          answer_text: 'too short',
          answer_text_valid: false,
          answer_validation_error: 'too_short',
        },
        analysisProjection: FRAGILE_PROJECTION,
      }),
    );
    expect(outcome.assistant_text).toContain(LINK_BEAT_TEXT);
    const beatIndex = outcome.assistant_text.indexOf(LINK_BEAT_TEXT);
    const nudgeIndex = outcome.assistant_text.indexOf(
      'Would you like to explore what would change this result?',
    );
    expect(beatIndex).toBeGreaterThan(-1);
    expect(nudgeIndex).toBeGreaterThan(beatIndex);
    expect(outcome.__validation_beat?.mechanism).toBe('appended');
  });

  it('schema: fact round-trips through the strict schema with the beat appended (no new fact field)', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(
      makeExecuteInvocation({ analysisProjection: FRAGILE_PROJECTION }),
    );
    const parsed = ExplainResultsHandlerFactSchema.safeParse(outcome.handler_facts[0]);
    expect(parsed.success).toBe(true);
  });

  it('precondition paths carry no validation-beat record (execute-only mechanism)', async () => {
    const handler = createExplainResultsHandler();
    const outcome = await handler(makeInvocation({ priorFacts: [], optionCount: 2 }));
    expect(outcome.__validation_beat).toBeUndefined();
  });
});
