/** Real TurnExecutor wiring for the B2 bounded non-mutation re-election. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { HandlerFact, V5ActionType } from '@talchain/schemas/orchestrator';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import { setTestSink } from '../../utils/telemetry.js';
import type { HandlerFn, HandlerRegistry } from '../tools/registry.js';
import { createExplainFromStructureHandler } from '../tools/handlers/explain-from-structure.js';

const writes: Array<Record<string, unknown>> = [];
let persistedGraph: unknown = null;
let priorFacts: readonly HandlerFact[] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      writes.push(write);
      if (write.graph !== undefined) persistedGraph = write.graph;
      return { id: `row-${randomUUID()}` };
    },
    readRecent: async () =>
      priorFacts.length === 0
        ? []
        : [
            {
              id: 'b2000000-0000-4000-8000-000000000099',
              scenario_id: SCENARIO_ID,
              user_id: null,
              turn_id: 'b2000000-0000-4000-8000-000000000098',
              turn_class: 'handler',
              handler_id: 'run_analysis',
              request_hash: 'sha256:prior-analysis-attempt',
              response_emitted: true,
              llm_calls_used: 0,
              duration_ms: 10,
              created_at: '2026-08-23T19:40:14.000Z',
            },
          ],
    readFactsFor: async () => priorFacts,
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

const SCENARIO_ID = 'b2000000-0000-4000-8000-000000000002';
const CRM_UNCERTAINTY =
  "I don't know what value to use. We have no reliable adoption data yet. What is the safest way to proceed?";
const CRM_NO_CHANGE =
  'I do not know the Sales Rep Adoption Rate or CRM Feature Fit for B2B Sales. Is it safe to run analysis anyway? Answer directly first and do not change the model.';
const PRODUCT_CHALLENGE =
  'Challenge the 53% result directly: what is the strongest reason it could be misleading? Refer specifically to Team Capacity Consumed and unknown willingness to pay, and explain the causal path. Do not change the model.';
const BURN_CONTROL_PROMPT =
  'Answer directly first: which single missing fact should we gather next, and why? Refer specifically to Q1 Renewal Rate and explain the causal path. Do not change the model.';
const GEO_CONTROL_PROMPT =
  'Answer directly: does an 86% result justify acting despite unknown Local Pipeline Conversion Rate? Name the strongest challenge and state which first-year budget or hub-cost figures were excluded from the numerical model. Do not change the model.';

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Reach 1,500 paid teams' },
    { id: 'adoption', kind: 'factor', label: 'Sales Rep Adoption Rate', observed_state: { value: 0.5 } },
    { id: 'capacity', kind: 'factor', label: 'Team Capacity Consumed', observed_state: { value: 0.5 } },
    { id: 'opt_new', kind: 'option', label: 'Replace CRM', interventions: { adoption: 0.8 } },
    { id: 'opt_keep', kind: 'option', label: 'Keep CRM', is_baseline: true, interventions: { adoption: 0 } },
  ],
  edges: [
    { from: 'adoption', to: 'goal', strength: { mean: 0.8, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'capacity', to: 'goal', strength: { mean: -0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
    { from: 'opt_new', to: 'adoption', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_keep', to: 'adoption', strength: { mean: 0.01, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
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
    turn_class: 'decide',
    stage: 'analyse',
  };
}

function toolResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: `tu-${randomUUID()}`,
      name: OLUMI_ACTION_TOOL_NAME,
      input: input as Record<string, unknown>,
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-5',
    latencyMs: 10,
  };
}

const MUTATING_ELECTION = {
  intent_class: 'execute',
  action: {
    handler_id: 'set_factor_value',
    entity: {
      id: 'capacity',
      kind: 'node',
      label: 'Team Capacity Consumed',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [{ name: 'value', value: { value: 0.53 }, source: 'inferred' }],
    cited_context_fields: ['graph.nodes'],
  },
};

function mutatingThenAnsweringAdapter(answer: string) {
  const chatWithTools = vi.fn(
    async (args: ChatWithToolsArgs): Promise<ChatWithToolsResult> => {
      const forced = (args.tool_choice as { type?: string } | undefined)?.type === 'tool';
      if (!forced) return toolResult(MUTATING_ELECTION);
      return toolResult({
        intent_class: 'execute',
        action: {
          handler_id: 'explain_from_structure',
          entity: {
            id: 'goal',
            kind: 'goal',
            label: 'Reach 1,500 paid teams',
            resolution_status: 'resolved',
            resolution_method: 'id_match',
          },
          parameters: [],
          cited_context_fields: ['graph.nodes', 'graph.edges'],
          structure_query: { kind: 'general' },
          explanation: { answer_text: answer, cited_fields: ['graph.nodes', 'graph.edges'] },
        },
      });
    },
  );
  return { chatWithTools };
}

function runThenAnsweringAdapter(answer: string) {
  const chatWithTools = vi.fn(
    async (args: ChatWithToolsArgs): Promise<ChatWithToolsResult> => {
      const forced = (args.tool_choice as { type?: string } | undefined)?.type === 'tool';
      if (!forced) {
        return toolResult({
          intent_class: 'execute',
          action: {
            handler_id: 'run_analysis',
            entity: {
              id: 'goal',
              kind: 'goal',
              label: 'Reach 1,500 paid teams',
              resolution_status: 'resolved',
              resolution_method: 'id_match',
            },
            parameters: [],
            cited_context_fields: ['graph.nodes'],
          },
        });
      }
      return toolResult({
        intent_class: 'execute',
        action: {
          handler_id: 'explain_from_structure',
          entity: {
            id: 'goal',
            kind: 'goal',
            label: 'Reach 1,500 paid teams',
            resolution_status: 'resolved',
            resolution_method: 'id_match',
          },
          parameters: [],
          cited_context_fields: ['graph.nodes', 'graph.edges'],
          structure_query: { kind: 'general' },
          explanation: { answer_text: answer, cited_fields: ['graph.nodes', 'graph.edges'] },
        },
      });
    },
  );
  return { chatWithTools };
}

function answeringAdapter(
  answer: string,
  structureQuery?:
    | { kind: 'general' }
    | { kind: 'dependencies'; element_id: string }
    | { kind: 'direct_relationship'; element_ids: [string, string] }
    | { kind: 'reachability'; source_element_id: string; target_element_id: string },
  entity: { readonly id: string; readonly label: string; readonly kind?: 'node' | 'goal' } = {
    id: 'goal',
    label: 'Reach 1,500 paid teams',
  },
) {
  return {
    chatWithTools: vi.fn(async (): Promise<ChatWithToolsResult> => toolResult({
      intent_class: 'execute',
      action: {
        handler_id: 'explain_from_structure',
        entity: {
          id: entity.id,
          kind: entity.kind ?? 'goal',
          label: entity.label,
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
        parameters: [],
        cited_context_fields: ['graph.nodes', 'graph.edges'],
        structure_query: structureQuery ?? { kind: 'general' as const },
        explanation: { answer_text: answer, cited_fields: ['graph.nodes', 'graph.edges'] },
      },
    })),
  };
}

function registry() {
  const mutationSpy = vi.fn(async () => ({
    assistant_text: 'MUTATION-HANDLER-RAN',
    handler_facts: [],
    llm_calls_used: 0,
  }));
  const explanationSpy = vi.fn(async (invocation: { explanation?: { answer_text: string } }) => ({
    assistant_text: invocation.explanation?.answer_text ?? 'NO-ANSWER',
    handler_facts: [],
    llm_calls_used: 0,
    suppress_orientation: true,
  }));
  const runAnalysisSpy = vi.fn(async () => ({
    assistant_text: 'ANALYSIS-HANDLER-RAN',
    handler_facts: [],
    llm_calls_used: 0,
  }));
  const handlers: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
    ['set_factor_value' as V5ActionType, mutationSpy as unknown as HandlerFn],
    ['explain_from_structure' as V5ActionType, explanationSpy as unknown as HandlerFn],
    ['run_analysis' as V5ActionType, runAnalysisSpy as unknown as HandlerFn],
  ]);
  return { handlers, mutationSpy, explanationSpy, runAnalysisSpy };
}

beforeEach(() => {
  writes.length = 0;
  persistedGraph = structuredClone(GRAPH);
  priorFacts = [];
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('B2 real executor convergence', () => {
  it.each([
    [CRM_UNCERTAINTY, 'No — use the current missing input first because the model cannot attest reliable adoption evidence yet.', 2],
    [CRM_NO_CHANGE, 'No — treat the result as exploratory because Sales Rep Adoption Rate is not backed by reliable evidence yet.', 2],
    [PRODUCT_CHALLENGE, 'The strongest challenge is Team Capacity Consumed because the model links it directly to the paid-team goal.', 2],
  ])('re-elects one bounded explanation and never runs the mutator for %s', async (message, answer, expectedCalls) => {
    const adapter = mutatingThenAnsweringAdapter(answer);
    const { handlers, mutationSpy, explanationSpy } = registry();

    const { response } = await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
      routingAdapter: adapter,
      handlerRegistry: handlers,
      graphState: structuredClone(GRAPH),
    });

    expect(adapter.chatWithTools, response.assistant_text).toHaveBeenCalledTimes(expectedCalls);
    expect(mutationSpy).not.toHaveBeenCalled();
    expect(explanationSpy, response.assistant_text).toHaveBeenCalledTimes(1);
    expect(response.assistant_text).toContain(answer.split(' because ')[0]!);
    expect(response.suggested_actions ?? []).toEqual([]);
    expect(writes.filter((write) => write.graph !== undefined)).toHaveLength(0);
  });

  it('replaces a second unsafe mutation offer with a source-bound causal recovery', async () => {
    const unsafeAnswer =
      'Nothing has been changed, but setting "Team Capacity Consumed" to 53% looks like it would help. Say the word and I will make it.';
    const adapter = mutatingThenAnsweringAdapter(unsafeAnswer);
    const { handlers, mutationSpy, explanationSpy } = registry();

    const { response } = await runTurnExecutor(
      payload(PRODUCT_CHALLENGE),
      `req-${randomUUID()}`,
      {
        routingAdapter: adapter,
        handlerRegistry: handlers,
        graphState: structuredClone(GRAPH),
      },
    );

    // One unsafe mutation election, then exactly one forced answer-only
    // re-election. The deterministic value-update route must stand down on
    // the explicit no-change clause rather than manufacturing clarify chips.
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
    expect(mutationSpy).not.toHaveBeenCalled();
    expect(explanationSpy).toHaveBeenCalledTimes(1);
    expect(response.assistant_text).toContain('Team Capacity Consumed');
    expect(response.assistant_text).toContain('Reach 1,500 paid teams');
    expect(response.assistant_text).not.toContain('53%');
    expect(response.assistant_text).not.toMatch(/say the word|setting .* would help/i);
    expect(response.suggested_actions ?? []).toEqual([]);
    expect(writes.filter((write) => write.graph !== undefined)).toHaveLength(0);
  });

  it('does not persist a hidden proposal from bounded read-only answer prose', async () => {
    const capturableAnswer =
      'Competitor response is worth monitoring as an unresolved risk. Would you like me to add competitor response as a risk?';
    const adapter = answeringAdapter(capturableAnswer);
    const { handlers, mutationSpy, explanationSpy } = registry();

    const { response } = await runTurnExecutor(
      payload(PRODUCT_CHALLENGE),
      `req-${randomUUID()}`,
      {
        routingAdapter: adapter,
        handlerRegistry: handlers,
        graphState: structuredClone(GRAPH),
      },
    );

    expect(response.assistant_text).toBe(capturableAnswer);
    expect(mutationSpy).not.toHaveBeenCalled();
    expect(explanationSpy).toHaveBeenCalledTimes(1);
    expect(response.suggested_actions ?? []).toEqual([]);
    expect(writes.filter((write) => write.graph !== undefined)).toHaveLength(0);
    expect(
      writes.flatMap((write) =>
        Array.isArray(write.pending_actions)
          ? (write.pending_actions as Array<{ action?: { kind?: unknown } }>).map(
              (pending) => pending.action?.kind,
            )
          : [],
      ),
    ).not.toContain('proposed_concept');
  });

  it('answers a safety question before run_analysis and does not execute the run', async () => {
    const answer =
      'It is safe only as an exploratory run because the current facts do not attest adoption evidence quality.';
    const adapter = runThenAnsweringAdapter(answer);
    const { handlers, mutationSpy, explanationSpy, runAnalysisSpy } = registry();

    const { response } = await runTurnExecutor(
      payload(CRM_UNCERTAINTY),
      `req-${randomUUID()}`,
      {
        routingAdapter: adapter,
        handlerRegistry: handlers,
        graphState: structuredClone(GRAPH),
      },
    );

    // One ordinary run election plus the single forced answer-only re-election.
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
    expect(mutationSpy).not.toHaveBeenCalled();
    expect(runAnalysisSpy).not.toHaveBeenCalled();
    expect(explanationSpy, response.assistant_text).toHaveBeenCalledTimes(1);
    expect(response.assistant_text).toContain('because');
    expect(response.suggested_actions ?? []).toEqual([]);
  });

  it.each([
    [
      BURN_CONTROL_PROMPT,
      'The Q1 Renewal Rate is the single most useful fact to gather next because it links renewal to churn loss and then to the burn target.',
      'Q1 Renewal Rate',
    ],
    [
      GEO_CONTROL_PROMPT,
      'No, not on its own. Local Pipeline Conversion Rate feeds New ARR Generated, so an unverified conversion assumption could flip the result; the current model excludes the first-year budget and hub-cost figures.',
      'Local Pipeline Conversion Rate',
    ],
  ])('preserves an already-correct source-bound control for %s', async (message, answer, evidenceLabel) => {
    const adapter = answeringAdapter(answer);
    const { handlers, mutationSpy, explanationSpy } = registry();

    const { response } = await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
      routingAdapter: adapter,
      handlerRegistry: handlers,
      graphState: structuredClone(GRAPH),
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(mutationSpy).not.toHaveBeenCalled();
    expect(explanationSpy).toHaveBeenCalledTimes(1);
    expect(response.assistant_text).toContain(evidenceLabel);
    expect(response.suggested_actions ?? []).toEqual([]);
    expect(writes.filter((write) => write.graph !== undefined)).toHaveLength(0);
  });

  it.each([
    [
      CRM_NO_CHANGE,
      'Running now is safe, and the working numbers are enough to produce a worthwhile result.',
      /^No\b/,
    ],
    [
      BURN_CONTROL_PROMPT,
      'The Q1 Renewal Rate is worth checking next. Running the analysis would show how these relationships translate into option-level probabilities.',
      /Q1 Renewal Rate/,
    ],
  ])('carries a refused run forward into the next answer-only turn: %s', async (message, unsafeAnswer, expectedGrounding) => {
    priorFacts = [
      {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: null,
          summary: 'Analysis attempt was refused before computation.',
          enrichment: {
            analysis_status: 'refused',
            refusal_reason_code: 'mixed_scale_unresolved',
          },
          computed_at: '2026-08-23T19:40:14.000Z',
        },
      },
    ];
    const adapter = answeringAdapter(unsafeAnswer);
    const { handlers, mutationSpy } = registry();

    const { response } = await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
      routingAdapter: adapter,
      handlerRegistry: handlers,
      graphState: structuredClone(GRAPH),
    });

    expect(response.assistant_text).toMatch(expectedGrounding);
    expect(response.assistant_text).toMatch(/latest analysis attempt|latest run attempt/i);
    expect(response.assistant_text).not.toMatch(/running now is safe|would show .*probabilit|enough to produce/i);
    expect(response.suggested_actions ?? []).toEqual([]);
    expect(mutationSpy).not.toHaveBeenCalled();
    expect(writes.filter((write) => write.graph !== undefined)).toHaveLength(0);
  });

  it('a newer successful run supersedes an older refusal and leaves the ready positive control unchanged', async () => {
    priorFacts = [
      {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_new',
          summary: 'Replace CRM leads in the latest analysis.',
          enrichment: { analysis_status: 'completed' },
          computed_at: '2026-08-23T20:00:00.000Z',
        },
      },
      {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: null,
          summary: 'Analysis attempt was refused before computation.',
          enrichment: { analysis_status: 'refused' },
          computed_at: '2026-08-23T19:40:14.000Z',
        },
      },
    ];
    const answer =
      'No, not on its own. Local Pipeline Conversion Rate could reverse the result; the current model excludes first-year budget and hub-cost figures.';
    const adapter = answeringAdapter(answer);
    const { handlers, mutationSpy } = registry();

    const { response } = await runTurnExecutor(payload(GEO_CONTROL_PROMPT), `req-${randomUUID()}`, {
      routingAdapter: adapter,
      handlerRegistry: handlers,
      graphState: structuredClone(GRAPH),
    });

    expect(response.assistant_text).toContain('Local Pipeline Conversion Rate');
    expect(response.assistant_text).not.toMatch(/latest analysis attempt|latest run attempt/i);
    expect(response.suggested_actions ?? []).toEqual([]);
    expect(mutationSpy).not.toHaveBeenCalled();
  });

  it('uses canonical identity-pair evidence instead of a valid but directionally wrong Sonnet answer', async () => {
    const wrongAnswer =
      'Reach 1,500 paid teams directly influences Sales Rep Adoption Rate, so the saved relationship runs from the goal back to the adoption factor.';
    const adapter = answeringAdapter(wrongAnswer, {
      kind: 'direct_relationship',
      element_ids: ['goal', 'adoption'],
    });
    const handlers: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
      ['explain_from_structure' as V5ActionType, createExplainFromStructureHandler()],
    ]);
    const message =
      'Using only the saved Living Model, describe the relationship between Reach 1,500 paid teams and Sales Rep Adoption Rate. State which influences which.';

    const { response } = await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
      routingAdapter: adapter,
      handlerRegistry: handlers,
      graphState: structuredClone(GRAPH),
    });

    expect(response.assistant_text).toContain(
      'from Sales Rep Adoption Rate to Reach 1,500 paid teams, not the reverse',
    );
    expect(response.assistant_text).not.toContain(
      'from the goal back to the adoption factor',
    );
    expect(writes.filter((write) => write.graph !== undefined)).toHaveLength(0);
  });

  it('uses typed selected canonical dependencies instead of valid prose that invents an edge', async () => {
    const wrongAnswer =
      'Replace CRM has a direct connector into Reach 1,500 paid teams, so the selected goal depends directly on choosing that option.';
    const contradictoryRequestGraph = structuredClone(GRAPH);
    contradictoryRequestGraph.edges = [
      { from: 'opt_new', to: 'goal', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ];
    const adapter = answeringAdapter(wrongAnswer, {
      kind: 'dependencies',
      element_id: 'goal',
    });
    const handlers: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
      ['explain_from_structure' as V5ActionType, createExplainFromStructureHandler()],
    ]);

    const { response, groundedSelection } = await runTurnExecutor(
      payload('What does this depend on?'),
      `req-${randomUUID()}`,
      {
        routingAdapter: adapter,
        handlerRegistry: handlers,
        graphState: contradictoryRequestGraph,
        selectedElements: { node_ids: ['goal'], edge_ids: [] },
      },
    );

    expect(groundedSelection).toEqual({ element_ids: ['goal'], unresolved: 'none' });
    expect(response.assistant_text).toContain(
      'from Sales Rep Adoption Rate to Reach 1,500 paid teams',
    );
    expect(response.assistant_text).toContain(
      'from Team Capacity Consumed to Reach 1,500 paid teams',
    );
    expect(response.assistant_text).not.toContain(
      'Replace CRM has a direct connector into Reach 1,500 paid teams',
    );
    expect(response.assistant_text).not.toContain('from Replace CRM to Reach 1,500 paid teams');
    expect(writes.filter((write) => write.graph !== undefined)).toHaveLength(0);
  });

  it.each([
    ['multiple nodes', { node_ids: ['goal', 'adoption'], edge_ids: [] }],
    ['mixed node and edge', { node_ids: ['goal'], edge_ids: ['adoption→goal'] }],
  ])('fails weak on %s rather than restoring malicious dependency prose', async (_name, selectedElements) => {
    const wrongAnswer =
      'Replace CRM definitely feeds the selected goal directly and is its only dependency.';
    const adapter = answeringAdapter(wrongAnswer, {
      kind: 'dependencies',
      element_id: 'goal',
    });
    const handlers: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
      ['explain_from_structure' as V5ActionType, createExplainFromStructureHandler()],
    ]);

    const { response } = await runTurnExecutor(
      payload('What does this depend on?'),
      `req-${randomUUID()}`,
      {
        routingAdapter: adapter,
        handlerRegistry: handlers,
        graphState: structuredClone(GRAPH),
        selectedElements,
      },
    );

    expect(response.assistant_text).not.toBe(wrongAnswer);
    expect(response.assistant_text).not.toContain('only dependency');
    expect(writes.filter((write) => write.graph !== undefined)).toHaveLength(0);
  });

  it('does not promote a provisional request graph into selected dependency truth', async () => {
    persistedGraph = null;
    const wrongAnswer =
      'Replace CRM definitely feeds the selected goal directly in the saved Living Model.';
    const adapter = answeringAdapter(wrongAnswer, {
      kind: 'dependencies',
      element_id: 'goal',
    });
    const handlers: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
      ['explain_from_structure' as V5ActionType, createExplainFromStructureHandler()],
    ]);

    const { response } = await runTurnExecutor(
      payload('What does this depend on?'),
      `req-${randomUUID()}`,
      {
        routingAdapter: adapter,
        handlerRegistry: handlers,
        graphState: structuredClone(GRAPH),
        selectedElements: { node_ids: ['goal'], edge_ids: [] },
      },
    );

    expect(response.assistant_text).not.toBe(wrongAnswer);
    expect(response.assistant_text).not.toContain('in the saved Living Model');
    // The pre-existing validated first-touch path may persist the provisional
    // graph once. The dependency answer must not cause a second graph write or
    // treat those request bytes as already-saved reasoning truth.
    expect(writes.filter((write) => write.graph !== undefined)).toHaveLength(1);
  });

  it('does not narrate a structural option-to-factor connector as a causal dependency', async () => {
    const wrongAnswer =
      'Replace CRM is a strong positive causal dependency of Sales Rep Adoption Rate.';
    const adapter = answeringAdapter(
      wrongAnswer,
      { kind: 'dependencies', element_id: 'adoption' },
      { id: 'adoption', label: 'Sales Rep Adoption Rate', kind: 'node' },
    );
    const handlers: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
      ['explain_from_structure' as V5ActionType, createExplainFromStructureHandler()],
    ]);

    const { response } = await runTurnExecutor(
      payload('What does this depend on?'),
      `req-${randomUUID()}`,
      {
        routingAdapter: adapter,
        handlerRegistry: handlers,
        graphState: structuredClone(GRAPH),
        selectedElements: { node_ids: ['adoption'], edge_ids: [] },
      },
    );

    expect(response.assistant_text).toContain('structural connector');
    expect(response.assistant_text).toContain('cannot safely treat');
    expect(response.assistant_text).not.toContain('strong positive');
    expect(response.assistant_text).not.toBe(wrongAnswer);
    expect(writes.filter((write) => write.graph !== undefined)).toHaveLength(0);
  });

  it('leaves a selected open-ended general explanation byte-exact', async () => {
    const authored =
      'This goal matters because it states the outcome the team is trying to improve, while the surrounding model records the factors and options the team is still examining.';
    const adapter = answeringAdapter(authored, { kind: 'general' });
    const handlers: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
      ['explain_from_structure' as V5ActionType, createExplainFromStructureHandler()],
    ]);

    const { response } = await runTurnExecutor(
      payload('Why does this one matter?'),
      `req-${randomUUID()}`,
      {
        routingAdapter: adapter,
        handlerRegistry: handlers,
        graphState: structuredClone(GRAPH),
        selectedElements: { node_ids: ['goal'], edge_ids: [] },
      },
    );

    expect(response.assistant_text).toBe(authored);
    expect(writes.filter((write) => write.graph !== undefined)).toHaveLength(0);
  });

  it('uses typed canonical ids to resolve unique exact generic labels without trusting wrong Sonnet direction', async () => {
    const genericGraph = structuredClone(GRAPH);
    genericGraph.nodes = genericGraph.nodes.map((node) =>
      node.id === 'adoption'
        ? { ...node, label: 'Cost' }
        : node.id === 'goal'
          ? { ...node, label: 'Risk' }
          : node,
    );
    persistedGraph = structuredClone(genericGraph);
    const adapter = answeringAdapter(
      'Risk directly drives Cost, so the saved relationship runs from Risk to Cost.',
      { kind: 'direct_relationship', element_ids: ['adoption', 'goal'] },
    );
    const handlers: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
      ['explain_from_structure' as V5ActionType, createExplainFromStructureHandler()],
    ]);

    const { response } = await runTurnExecutor(
      payload('Using only the saved Living Model, how does Cost affect Risk?'),
      `req-${randomUUID()}`,
      {
        routingAdapter: adapter,
        handlerRegistry: handlers,
        graphState: structuredClone(genericGraph),
      },
    );

    expect(response.assistant_text).toContain('from Cost to Risk, not the reverse');
    expect(response.assistant_text).not.toContain('from Risk to Cost');
    expect(writes.filter((write) => write.graph !== undefined)).toHaveLength(0);
  });

  it('does not compose a path between two factors when the canonical model lists no direct connector', async () => {
    const wrongAnswer =
      'Sales Rep Adoption Rate reaches Team Capacity Consumed through the shared paid-team goal, so the model establishes an indirect path between them.';
    const adapter = answeringAdapter(wrongAnswer, {
      kind: 'direct_relationship',
      element_ids: ['adoption', 'capacity'],
    });
    const handlers: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
      ['explain_from_structure' as V5ActionType, createExplainFromStructureHandler()],
    ]);
    const message =
      'Is there a direct connector between Sales Rep Adoption Rate and Team Capacity Consumed, or only a path through another model element?';

    const { response } = await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
      routingAdapter: adapter,
      handlerRegistry: handlers,
      graphState: structuredClone(GRAPH),
    });

    expect(response.assistant_text).toContain('lists no direct connector');
    expect(response.assistant_text).toContain(
      'does not decide the separate reachability question',
    );
    expect(response.assistant_text).not.toContain('shared paid-team goal');
    expect(writes.filter((write) => write.graph !== undefined)).toHaveLength(0);
  });

  it('uses the separate canonical reachability carrier without claiming a direct connector', async () => {
    const wrongAnswer =
      'Replace CRM cannot reach Reach 1,500 paid teams because there is no direct connector between them.';
    const adapter = answeringAdapter(wrongAnswer, {
      kind: 'reachability',
      source_element_id: 'opt_new',
      target_element_id: 'goal',
    });
    const handlers: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
      ['explain_from_structure' as V5ActionType, createExplainFromStructureHandler()],
    ]);
    const message =
      'Can Replace CRM reach Reach 1,500 paid teams through the saved directed model?';

    const { response } = await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
      routingAdapter: adapter,
      handlerRegistry: handlers,
      graphState: structuredClone(GRAPH),
    });

    expect(response.assistant_text).toContain(
      'Replace CRM can reach Reach 1,500 paid teams',
    );
    expect(response.assistant_text).toContain('does not state');
    expect(response.assistant_text).not.toContain('cannot reach');
    expect(writes.filter((write) => write.graph !== undefined)).toHaveLength(0);
  });

  it.each([
    [
      'Compare Sales Rep Adoption Rate and Team Capacity Consumed as strategic priorities.',
      'Sales Rep Adoption Rate and Team Capacity Consumed deserve different priority judgements; this answer compares their roles without asserting a direct connector.',
    ],
    [
      'What assumptions support Sales Rep Adoption Rate and Team Capacity Consumed?',
      'The assumptions supporting Sales Rep Adoption Rate and Team Capacity Consumed should be reviewed separately; naming both does not establish a relationship between them.',
    ],
    [
      'Summarise the evidence for Sales Rep Adoption Rate and Team Capacity Consumed.',
      'The available evidence for Sales Rep Adoption Rate and Team Capacity Consumed needs separate treatment; their joint mention is not evidence of a connector.',
    ],
    [
      'Which is more uncertain: Sales Rep Adoption Rate or Team Capacity Consumed?',
      'The current question compares uncertainty around Sales Rep Adoption Rate and Team Capacity Consumed; it does not ask for or establish a direct relationship.',
    ],
  ])('does not turn two named elements into relationship intent: %s', async (message, answer) => {
    const adapter = answeringAdapter(answer);
    const handlers: HandlerRegistry = new Map<V5ActionType, HandlerFn>([
      ['explain_from_structure' as V5ActionType, createExplainFromStructureHandler()],
    ]);

    const { response } = await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
      routingAdapter: adapter,
      handlerRegistry: handlers,
      graphState: structuredClone(GRAPH),
    });

    expect(response.assistant_text).toBe(answer);
    expect(writes.filter((write) => write.graph !== undefined)).toHaveLength(0);
  });
});
