/**
 * Integration test: V5 spec §7 every-failure-path-includes-a-chip.
 *
 * When `explain_results` or `what_would_flip` runs on a turn with no prior
 * `run_analysis` fact, the handler returns a precondition-fail outcome
 * (`noop: true` + `result.precondition_unmet: true`). The chip-generator
 * MUST emit an executable "Run analysis" chip on this path so the user has
 * a one-click recovery action. The explicit precondition rule in
 * `chip-generator.ts` reads the typed handler-fact signal directly, so the
 * chip emits independently of how `priorFacts` is threaded.
 *
 * Test B from the answer-carrying staging verification confirmed this chip
 * was missing at the response-envelope level. These integration tests wire
 * the actual handler + chip-generator together and assert the wire shape
 * the user actually sees.
 */

import { describe, it, expect } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { createExplainResultsHandler } from '../explain-results.js';
import { createWhatWouldFlipHandler } from '../what-would-flip.js';
import type { HandlerInvocation } from '../../registry.js';
import type { EnrichedTurnContext } from '../../../build-turn-context.js';
import { generateChips } from '../../../compose/chip-generator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../../routing/validation-registry.js';
import { EMPTY_DECISION_CONTEXT } from '@talchain/schemas/orchestrator';
import { EMPTY_COACHING_STATE } from '../../../coaching/coaching-state.js';

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const REQUEST_ID = 'req-precondition-fail-chip';
const GOAL_ID = 'goal_node_1';

// Typed builders for HandlerInvocation fixture parts. Each return type
// matches the canonical schema-derived shape, so no `as unknown` cast is
// needed at the call site. EnrichedTurnContext and MessageTurnPayload are
// the wide structural types HandlerInvocation expects; building them with
// proper literal-narrowing here keeps the test free of the broader
// codebase's "fixture cast" pattern.
function buildEnrichedTurnContext(message: string): EnrichedTurnContext {
  return {
    stage: 'analyse',
    entity_registry: { option_ids: [], goal_id: GOAL_ID },
    capabilities: {},
    messages: [{ role: 'user' as const, content: message }],
    session_id: SCENARIO_ID,
    request_id: REQUEST_ID,
    budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
    prior_turns: [],
    prior_facts: [],
    prior_facts_with_turn: [],
    scenarioBriefText: null,
    persistedGraph: null,
    decision_context: EMPTY_DECISION_CONTEXT,
    coaching_state: EMPTY_COACHING_STATE,
  };
}

function buildMessageTurnPayload(message: string): MessageTurnPayload {
  return {
    kind: 'message' as const,
    turn_id: 't_precondition_fail',
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide' as const,
    stage: 'analyse' as const,
    source: 'composer' as const,
  };
}

function makePreAnalysisInvocation(message: string): HandlerInvocation {
  return {
    context: buildEnrichedTurnContext(message),
    payload: buildMessageTurnPayload(message),
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: 'Looking at the analysis you have configured.',
    analysisReady: {
      options: [
        { option_id: 'opt_1', label: 'Option 1', status: 'ready', interventions: { f: 1 } },
        { option_id: 'opt_2', label: 'Option 2', status: 'ready', interventions: { f: 1 } },
      ],
      goal_node_id: GOAL_ID,
      status: 'ready',
    },
  };
}

describe('integration: precondition-fail chip surfaces at envelope level (Test B)', () => {
  it('explain_results precondition-fail → chips contains executable run_analysis with id="chip_action_run_analysis"', async () => {
    const handler = createExplainResultsHandler();
    const invocation = makePreAnalysisInvocation('Why is the leading option winning?');
    const outcome = await handler(invocation);

    // Confirm the handler emitted the precondition-fail signal the chip
    // rule keys on — typed precondition_unmet field, not just fact_type.
    expect(outcome.suppress_orientation).toBe(true);
    const fact = outcome.handler_facts[0];
    expect(fact.fact_type).toBe('explain_results');
    expect(fact.noop).toBe(true);
    if (fact.fact_type === 'explain_results') {
      expect(fact.result.precondition_unmet).toBe(true);
    }

    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: outcome.handler_facts,
      priorFacts: invocation.context.prior_facts,
      analysis: null,
      analysisReady: invocation.analysisReady,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
    });

    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
    expect(chips[0].id).toBe('chip_action_run_analysis');
    expect(chips[0].label).toBe('Run analysis');
  });

  it('what_would_flip precondition-fail → chips contains executable run_analysis with id="chip_action_run_analysis"', async () => {
    const handler = createWhatWouldFlipHandler();
    const invocation = makePreAnalysisInvocation(
      'What would change the outcome?',
    );
    const outcome = await handler(invocation);

    expect(outcome.suppress_orientation).toBe(true);
    const fact = outcome.handler_facts[0];
    expect(fact.fact_type).toBe('what_would_flip');
    expect(fact.noop).toBe(true);
    if (fact.fact_type === 'what_would_flip') {
      expect(fact.result.precondition_unmet).toBe(true);
    }

    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: outcome.handler_facts,
      priorFacts: invocation.context.prior_facts,
      analysis: null,
      analysisReady: invocation.analysisReady,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
    });

    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
    expect(chips[0].id).toBe('chip_action_run_analysis');
  });

  it('explain_results precondition-fail rule fires even when priorFacts is NOT threaded (defence in depth vs facts_absent rule)', async () => {
    // The new explicit precondition rule reads the typed handler-fact
    // signal and is independent of priorFacts threading. The original
    // facts_absent rule depends on priorFacts being passed; if a future
    // call site forgets to thread it, the precondition rule still fires.
    const handler = createExplainResultsHandler();
    const invocation = makePreAnalysisInvocation('Why is the leading option winning?');
    const outcome = await handler(invocation);

    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: outcome.handler_facts,
      // priorFacts deliberately omitted to verify rule independence.
      analysis: null,
      analysisReady: invocation.analysisReady,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
    });

    expect(chips).toHaveLength(1);
    expect(chips[0].action_type).toBe('run_analysis');
  });
});
