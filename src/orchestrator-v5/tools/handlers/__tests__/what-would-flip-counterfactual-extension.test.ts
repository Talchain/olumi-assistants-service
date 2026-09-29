/**
 * Integration tests for the what-if (counterfactual) EXTENSION of the
 * `what_would_flip` handler.
 *
 * The three pins the brief calls out:
 *   1. Positive control — an injected client + a validated 2xx APPENDS a
 *      claim-safe card AFTER the (byte-preserved) base flip answer.
 *   2. Degraded arm — any non-success ISL result APPENDS NOTHING; the base
 *      answer is byte-identical.
 *   3. Single-factor regression — with NO injected client (the latent state on
 *      staging), the base `what_would_flip` answer is byte-identical even when
 *      a probe + mappable graph are present. The extension is purely additive.
 */

import { describe, it, expect, vi } from 'vitest';

import { createWhatWouldFlipHandler } from '../what-would-flip.js';
import type { HandlerInvocation } from '../../registry.js';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import type { AnalysisProjectionSummary } from '../../../context/projection-summaries.js';
import type { FlipSummary } from '../../../compose/flip-proposal.js';
import type { RawRobustnessSignals } from '../../../coaching/robustness-honesty.js';
import type {
  CounterfactualClient,
  CounterfactualResult,
} from '../../../../adapters/isl/counterfactual-client.js';

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GOAL_ID = 'goal_fit';

const VALID_ANSWER =
  'For the runner-up to overtake the leader, the strongest driver would need to move materially given the current margin.';

const PROJECTION: AnalysisProjectionSummary = {
  status: 'complete',
  leading_option: { label: 'Option A', probability: 0.6 },
  runner_up: { label: 'Option B', probability: 0.3 },
  margin_pp: 30,
  robustness_band: 'fragile',
  top_drivers: [{ factor_label: 'Engineering capacity', sensitivity_value: 0.6 }],
  staleness_reason: null,
};

const FRAGILE: RawRobustnessSignals = { level: 'fragile', near_tie_is_tie: false };

const CONCRETE_FLIP: FlipSummary = {
  overall_status: 'concrete',
  margin_supports_flip: true,
  entries: [{ factor_id: 'factor_capacity', factor_label: 'Engineering capacity', flip_value: 18 }],
};

function successFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: { scenario_id: SCENARIO_ID, leading_option_id: 'opt_1', summary: 'done', enrichment: {} },
  };
}

function mappableGraph() {
  return {
    nodes: [
      { id: 'goal_fit', kind: 'goal', label: 'Goal fit', observed_state: { value: 0 } },
      {
        id: 'factor_capacity',
        kind: 'factor',
        label: 'Engineering capacity',
        observed_state: { value: 10, cap: 20, unit: 'engineers' },
      },
      { id: 'factor_cost', kind: 'factor', label: 'Hiring cost', observed_state: { value: 5 } },
    ],
    edges: [
      { from: 'factor_capacity', to: 'goal_fit', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'factor_cost', to: 'goal_fit', strength: { mean: -0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
    ],
  };
}

function okResult(): CounterfactualResult {
  return {
    ok: true,
    response: {
      scenario: { intervention: { factor_capacity: 20 }, outcome: 'goal_fit' },
      prediction: {
        point_estimate: 12,
        confidence_interval: { lower: 12, upper: 12 },
        sensitivity_range: { optimistic: 14, pessimistic: 10, explanation: 'x' },
      },
      uncertainty: { overall: 'low', sources: [] },
      robustness: { score: 'robust', critical_assumptions: [] },
      explanation: { summary: 's', reasoning: 'r', technical_basis: 't', assumptions: [] },
    } as never,
  };
}

function fakeClient(result: CounterfactualResult): CounterfactualClient {
  return { getCounterfactual: vi.fn(async () => result) };
}

function makeInvocation(withLensSignals: boolean): HandlerInvocation {
  return {
    context: {
      stage: 'decide',
      entity_registry: { option_ids: [], goal_id: GOAL_ID },
      capabilities: {},
      messages: [{ role: 'user', content: 'what would change the outcome?' }],
      session_id: SCENARIO_ID,
      request_id: 'req-wwf-cf',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [successFact()] as readonly HandlerFact[],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      turn_id: 't1',
      scenario_id: SCENARIO_ID,
      message: 'what would change the outcome?',
      turn_class: 'decide',
      stage: 'decide',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-wwf-cf',
    signal: new AbortController().signal,
    orientationText: '',
    analysisReady: { options: [], goal_node_id: GOAL_ID, status: 'ready' } as HandlerInvocation['analysisReady'],
    explanation: { answer_text: VALID_ANSWER, answer_text_valid: true },
    analysisProjection: PROJECTION,
    analysisFreshness: { freshness: 'fresh', reason: 'graph_hash_match' } as unknown as HandlerInvocation['analysisFreshness'],
    graphForTurn: withLensSignals ? mappableGraph() : undefined,
    flipSummary: withLensSignals ? CONCRETE_FLIP : undefined,
    rawRobustness: withLensSignals ? FRAGILE : undefined,
  };
}

describe('what_would_flip — counterfactual extension', () => {
  it('positive control: appends the claim-safe card after the base answer on a validated 2xx', async () => {
    const handler = createWhatWouldFlipHandler({ counterfactualClient: fakeClient(okResult()) });
    const outcome = await handler(makeInvocation(true));

    // Base answer preserved verbatim as the prefix.
    expect(outcome.assistant_text.startsWith(VALID_ANSWER)).toBe(true);
    // The card is appended.
    expect(outcome.assistant_text).toContain('One further what-if worth exploring');
    expect(outcome.assistant_text).toContain('20 engineers');
    expect(outcome.assistant_text.length).toBeGreaterThan(VALID_ANSWER.length);
    // The fact's length reflects the full assistant_text.
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'what_would_flip') {
      expect(fact.result.answer_text_length).toBe(outcome.assistant_text.length);
      expect(fact.result.answer_source).toBe('sonnet');
    }
    expect(outcome.suppress_orientation).toBe(true);
  });

  it('degraded arm: a non-2xx ISL result appends nothing (base byte-preserved)', async () => {
    const handler = createWhatWouldFlipHandler({
      counterfactualClient: fakeClient({ ok: false, reason: 'non_2xx', status: 500 }),
    });
    const outcome = await handler(makeInvocation(true));
    expect(outcome.assistant_text).toBe(VALID_ANSWER);
  });

  it('single-factor regression: no injected client (latent) → base answer byte-identical', async () => {
    // Even WITH a probe + mappable graph present, the latent lens never fires.
    const handler = createWhatWouldFlipHandler();
    const outcome = await handler(makeInvocation(true));
    expect(outcome.assistant_text).toBe(VALID_ANSWER);
    const fact = outcome.handler_facts[0];
    if (fact.fact_type === 'what_would_flip') {
      expect(fact.result.answer_text_length).toBe(VALID_ANSWER.length);
    }
  });
});

/**
 * F4 — the card's ADJACENCY to a negative targeted answer.
 *
 * `selectCounterfactualProbe` picks its probe from the GENERIC flip set, with no
 * knowledge of the option the user named. Appended straight after "nothing
 * tested would put this in favour of X", it can therefore propose a factor whose
 * tipping point favours a DIFFERENT option — read, reasonably, as "try this to
 * make X win". The card is claim-safe in isolation; it is the adjacency that
 * misleads, so the adjacency is what is removed.
 *
 * Latent on staging today (the client is null), which is exactly why it is
 * pinned here rather than left to a live walk to find.
 */
describe('what_would_flip — the card is not appended to a NEGATIVE targeted answer', () => {
  const TARGET = { id: 'opt_offshore', label: 'Engage Offshore Partner' };

  function targetedInvocation(over: {
    flipSummary?: FlipSummary;
    mayNameLeadingOption?: boolean;
  }): HandlerInvocation {
    return {
      ...makeInvocation(true),
      ...(over.flipSummary ? { flipSummary: over.flipSummary } : {}),
      flipTargetOption: TARGET,
      analysisLeadingOptionId: 'opt_1',
      mayNameLeadingOption: over.mayNameLeadingOption ?? true,
    } as unknown as HandlerInvocation;
  }

  it('a targeted REFUSAL suppresses the card', async () => {
    // CONCRETE_FLIP carries no alternative_winner_id, so nothing flips to TARGET.
    const handler = createWhatWouldFlipHandler({ counterfactualClient: fakeClient(okResult()) });
    const outcome = await handler(targetedInvocation({}));
    expect(outcome.assistant_text).not.toContain('One further what-if worth exploring');
    expect(outcome.assistant_text).toContain('in favour of Engage Offshore Partner');
  });

  it('a POSITION-UNSTATED answer suppresses it too', async () => {
    const handler = createWhatWouldFlipHandler({ counterfactualClient: fakeClient(okResult()) });
    const outcome = await handler(targetedInvocation({ mayNameLeadingOption: false }));
    expect(outcome.assistant_text).not.toContain('One further what-if worth exploring');
  });

  it('POSITIVE CONTROL — an ADDRESSED targeted answer still gets the card', async () => {
    // Suppression must be scoped to the contradictory adjacency, not to every
    // targeted turn: here the suggestion and the answer point the same way.
    const flipsToTarget: FlipSummary = {
      overall_status: 'concrete',
      margin_supports_flip: true,
      entries: [
        {
          factor_id: 'factor_capacity',
          factor_label: 'Engineering capacity',
          flip_value: 18,
          alternative_winner_id: 'opt_offshore',
          alternative_winner_label: 'Engage Offshore Partner',
        },
      ],
    };
    const handler = createWhatWouldFlipHandler({ counterfactualClient: fakeClient(okResult()) });
    const outcome = await handler(targetedInvocation({ flipSummary: flipsToTarget }));
    expect(outcome.assistant_text).toContain('Engage Offshore Partner would lead instead');
    expect(outcome.assistant_text).toContain('One further what-if worth exploring');
  });
});
