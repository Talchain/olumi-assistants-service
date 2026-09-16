/**
 * ⭐⭐ THE ADVISE-ON-MODELLING DESTINATION, WITNESSED AT THE ROUTE.
 *
 * A unit test on the handler proves the composer can be reached. It cannot
 * prove the turn-executor ever SETS the classification on the invocation —
 * reachability inside one module is not reachability in the system
 * (CLAUDE.md trap 16, inverse form). This drives `runTurnExecutor` with
 * production routing, the production evidence builders, the production
 * side-band validator and the production handler; only the LLM adapter and
 * the session store are stubbed.
 *
 * THE CAPTURED TURN (staging `1b50150`, request
 * c55a2800-cae3-420f-b071-79cfed67aadd, 16 Sep 2026 11:14 UTC):
 *   user   "How do you recommend we add the author event's effort level to
 *           the decision?"
 *   telem  v5.explanation.answer_verdict → answer_text_valid=false,
 *          answer_validation_error="mutation_language_detected",
 *          answer_text_length=974, evidence_used_count=3
 *   served the whole-model structural recap, 643 characters — an answer to a
 *          question the user did not ask, and the SAME BYTES for every message
 *          that resolves no named factor.
 *
 * The authored answer below reproduces the REJECTION, not the rejected text:
 * the served 974 characters were never logged (the validator deliberately logs
 * no user-facing prose), so this fixture asserts the mechanism, not the words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { V5ActionType } from '@talchain/schemas/orchestrator';

import type { ChatWithToolsResult, ToolResponseBlock } from '../../adapters/llm/types.js';
import { setTestSink } from '../../utils/telemetry.js';
import type { HandlerFn, HandlerRegistry } from '../tools/registry.js';
import { createExplainFromStructureHandler } from '../tools/handlers/explain-from-structure.js';
import { containsMutationLanguage } from '../routing/mutation-language.js';

let persistedGraph: unknown = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'c5500000-0000-4000-8000-000000000003';

const GOAL_LABEL = 'We want monthly revenue to reach £18,000 in six months';
const HOURS_LABEL = 'Friday Extended Hours';
const FOOTFALL_LABEL = 'Weekend footfall';
const STAFF_LABEL = 'Staffing cost';

/** The captured message, verbatim from the attempt payload. */
const CAPTURED_ADVISE_QUESTION =
  "How do you recommend we add the author event's effort level to the decision?";
/** The discriminator: a genuine structure question over the same model. */
const STRUCTURE_QUESTION = 'What most influences my decision?';
/** Advice AND a concrete command — an instruction, and it must stay one. */
const MIXED_COMMAND_QUESTION =
  'How do you recommend we manage morale? Add a new factor for team mood.';

/**
 * Reproduces the MEASURED rejection: a plausible coaching answer whose
 * suggestion framing trips `containsMutationLanguage`, which is what discarded
 * the served 974 characters. Asserted to actually trip it, so this fixture
 * cannot silently stop reproducing the rejection (CLAUDE.md trap 13b — a
 * discriminator must pin its own precondition in-test).
 */
const REJECTED_AUTHORED_ANSWER =
  "I'd suggest adding a factor for the author event's effort, then connecting it to " +
  'your Friday takings so the model can show what that effort is buying you.';

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: GOAL_LABEL },
    { id: 'hours', kind: 'factor', label: HOURS_LABEL, observed_state: { value: 0.5 } },
    { id: 'footfall', kind: 'factor', label: FOOTFALL_LABEL, observed_state: { value: 0.5 } },
    { id: 'staff', kind: 'factor', label: STAFF_LABEL, observed_state: { value: 0.5 } },
    { id: 'opt_a', kind: 'option', label: 'Extend Friday opening', interventions: { hours: 0.8 } },
    { id: 'opt_b', kind: 'option', label: 'Keep current schedule', is_baseline: true, interventions: { hours: 0.2 } },
  ],
  edges: [
    { from: 'hours', to: 'goal', strength: { mean: 0.9, std: 0.05 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'footfall', to: 'goal', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'staff', to: 'goal', strength: { mean: -0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
  ],
  goal_node_id: 'goal',
};

function payload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: randomUUID(),
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'review',
    stage: 'frame',
  };
}

function toolResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    { type: 'tool_use', id: `tu-${randomUUID()}`, name: OLUMI_ACTION_TOOL_NAME, input: input as Record<string, unknown> },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-5',
    latencyMs: 10,
  };
}

/** The election the captured turn made: execute → explain_from_structure, general. */
function adapter(answerText: string) {
  return {
    chatWithTools: vi.fn(async (): Promise<ChatWithToolsResult> =>
      toolResult({
        intent_class: 'execute',
        action: {
          handler_id: 'explain_from_structure',
          entity: {
            id: 'goal',
            kind: 'goal',
            label: GOAL_LABEL,
            resolution_status: 'resolved',
            resolution_method: 'id_match',
          },
          parameters: [],
          cited_context_fields: ['graph.nodes', 'graph.edges'],
          structure_query: { kind: 'general' },
          explanation: {
            answer_text: answerText,
            cited_fields: ['graph.nodes', 'graph.edges'],
          },
        },
      }),
    ),
  };
}

function registry(): HandlerRegistry {
  return new Map<V5ActionType, HandlerFn>([
    ['explain_from_structure' as V5ActionType, createExplainFromStructureHandler()],
  ]);
}

async function drive(
  message: string,
  answerText: string = REJECTED_AUTHORED_ANSWER,
): Promise<string> {
  persistedGraph = structuredClone(GRAPH);
  const { response } = await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
    routingAdapter: adapter(answerText),
    handlerRegistry: registry(),
    graphState: structuredClone(GRAPH) as never,
  });
  return response.assistant_text;
}

const ADVICE_NEXT_STEP = /Tell me what you expect it to affect/i;
const RECAP_OPENING = /is shaped by several causal mechanisms/i;

beforeEach(() => {
  persistedGraph = structuredClone(GRAPH);
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('advise-on-modelling reaches its destination at the route', () => {
  it('PRECONDITION: the authored answer really is rejected for mutation language', () => {
    expect(containsMutationLanguage(REJECTED_AUTHORED_ANSWER)).toBe(true);
  });

  /**
   * ⭐ RED-FIRST SIGNATURE at pristine: the served text opened
   * "Your decision around We want monthly revenue … is shaped by several
   * causal mechanisms", so `not.toMatch(RECAP_OPENING)` failed with the recap
   * in the diff and `toMatch(ADVICE_NEXT_STEP)` failed for want of any next step.
   */
  it('the CAPTURED question is answered, not recapped', async () => {
    const text = await drive(CAPTURED_ADVISE_QUESTION);
    expect(text).not.toMatch(RECAP_OPENING);
    expect(text).toMatch(ADVICE_NEXT_STEP);
    // It says what the model holds without asserting anything about strength,
    // direction or ranking.
    expect(text).not.toMatch(/strongest visible direct influence/i);
    expect(text).not.toMatch(/very strong link/i);
  });

  /**
   * ⭐⭐ THE DISCRIMINATOR, at the route, on the SAME graph and the SAME
   * election. Only the message differs, so a regression that widened the class
   * would show up here and nowhere else.
   */
  it('DISCRIMINATOR: a genuine structure question still gets the structural answer', async () => {
    const text = await drive(STRUCTURE_QUESTION);
    expect(text).toMatch(RECAP_OPENING);
    expect(text).not.toMatch(ADVICE_NEXT_STEP);
  });

  it('a message that also issues a command keeps its existing behaviour', async () => {
    const text = await drive(MIXED_COMMAND_QUESTION);
    expect(text).not.toMatch(ADVICE_NEXT_STEP);
  });

  it('an authored answer that survives validation is still served verbatim', async () => {
    const clean =
      'Effort is a judgement you own here. Start from what it changes about your Friday takings, ' +
      'and say what you expect to shift so the model can carry it.';
    expect(containsMutationLanguage(clean)).toBe(false);
    const text = await drive(CAPTURED_ADVISE_QUESTION, clean);
    expect(text).toContain('Effort is a judgement you own here.');
    expect(text).not.toMatch(ADVICE_NEXT_STEP);
  });
});
