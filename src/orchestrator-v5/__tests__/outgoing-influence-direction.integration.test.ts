/**
 * ⭐⭐⭐ THE OUTGOING-INFLUENCE PATH, DRIVEN THROUGH THE REAL EXECUTOR.
 *
 * Sibling of `q1-outgoing-influence-misclassification.integration.test.ts`, which
 * PINS the gap: `structure_query.kind: 'dependencies'` answers INCOMING
 * connectors, "why does X matter" asks about OUTGOING influence, and binding the
 * subject buys a truthful answer to a different question. That file must stay
 * GREEN — this one does not relax any of it. It adds the missing carrier beside
 * it rather than widening the one that exists.
 *
 * ⚠⚠ WHAT THIS FILE DOES NOT CLAIM, stated before the assertions so it cannot be
 * read out of them. The frontier model is the only producer of
 * `structure_query.kind` in production, so nothing here is evidence that the
 * witnessed 1 Sep turn now routes to `outgoing_influence`. That is a live
 * ROUTING claim and needs a live witness. These tests prove that WHEN the
 * question is typed as the outgoing one, the product answers the outgoing
 * question — subject and predicate both — and refuses in exactly the cases it
 * refused before.
 *
 * ⚠ AND WHAT IT DELIBERATELY LEAVES BROKEN: the witnessed SHORTHAND ("investor
 * fit" for "Fit with target investor thesis and deal size") still fails the
 * current-message prose-identity gate, on the new kind exactly as on the old
 * one. Corroborating a shorthand is a separate question with its own blast
 * radius; it is asserted here as UNCHANGED so the gap stays visible in the suite
 * rather than in a comment.
 *
 * Fixture shape (deliberately asymmetric): `fit` has ONE incoming neighbour
 * (`traction`) and ONE DIFFERENT outgoing neighbour (`goal`). Every direction
 * claim therefore has a witness that can actually fail — an answer that reads the
 * wrong direction names a label the right answer never contains.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { V5ActionType } from '@talchain/schemas/orchestrator';

import type { ChatWithToolsResult, ToolResponseBlock } from '../../adapters/llm/types.js';
import { setTestSink } from '../../utils/telemetry.js';
import type { HandlerFn, HandlerRegistry } from '../tools/registry.js';
import { createExplainFromStructureHandler } from '../tools/handlers/explain-from-structure.js';

const writes: Array<Record<string, unknown>> = [];
let persistedGraph: unknown = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      writes.push(write);
      if (write.graph !== undefined) persistedGraph = write.graph;
      return { id: `row-${randomUUID()}` };
    },
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

const SCENARIO_ID = 'b2000000-0000-4000-8000-000000000002';

const INVESTOR_LABEL = 'Fit with target investor thesis and deal size';
const GOAL_LABEL = 'Close a Series A on acceptable terms';
const TRACTION_LABEL = 'Demonstrated revenue traction';

/** The exact witnessed wording, and the same question with the full label. */
const WITNESSED_Q1 = 'why do you think investor fit matters most here?';
const FULL_LABEL_Q1 = `why do you think ${INVESTOR_LABEL} matters most here?`;

const NODES = [
  { id: 'goal', kind: 'goal', label: GOAL_LABEL },
  { id: 'fit', kind: 'factor', label: INVESTOR_LABEL, observed_state: { value: 0.5 } },
  { id: 'traction', kind: 'factor', label: TRACTION_LABEL, observed_state: { value: 0.5 } },
  { id: 'runway', kind: 'factor', label: 'Months of runway remaining', observed_state: { value: 0.5 } },
  { id: 'opt_a', kind: 'option', label: 'Raise now at a lower valuation', interventions: { runway: 0.8 } },
  { id: 'opt_b', kind: 'option', label: 'Delay and build traction', is_baseline: true, interventions: { traction: 0.6 } },
];

const GRAPH = {
  nodes: NODES,
  edges: [
    { from: 'fit', to: 'goal', strength: { mean: 0.7, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'traction', to: 'fit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'runway', to: 'goal', strength: { mean: -0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
  ],
  goal_node_id: 'goal',
};

/** `fit` drives nothing: the honest outgoing answer is an empty set. */
const LEAF_GRAPH = { ...GRAPH, edges: GRAPH.edges.filter((edge) => edge.from !== 'fit') };

/**
 * A fluent, plausible authored answer naming a dependency the model does NOT
 * contain — the #1229 fabrication, restored verbatim by the licence mutant.
 */
const INVENTED_PROSE =
  `Investor fit matters most because ${INVESTOR_LABEL} depends on a phased pilot commitment.`;

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

function adapter(answerText: string, structureQuery: unknown) {
  return {
    chatWithTools: vi.fn(async (): Promise<ChatWithToolsResult> => toolResult({
      intent_class: 'execute',
      action: {
        handler_id: 'explain_from_structure',
        entity: {
          id: 'fit', kind: 'node', label: INVESTOR_LABEL,
          resolution_status: 'resolved', resolution_method: 'id_match',
        },
        parameters: [],
        cited_context_fields: ['graph.nodes', 'graph.edges'],
        structure_query: structureQuery,
        explanation: { answer_text: answerText, cited_fields: ['graph.nodes', 'graph.edges'] },
      },
    })),
  };
}

function registry(): HandlerRegistry {
  return new Map<V5ActionType, HandlerFn>([
    ['explain_from_structure' as V5ActionType, createExplainFromStructureHandler()],
  ]);
}

async function drive(
  message: string,
  structureQuery: unknown,
  graph: unknown = GRAPH,
  answerText: string = INVENTED_PROSE,
): Promise<string> {
  persistedGraph = structuredClone(graph);
  const { response } = await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
    routingAdapter: adapter(answerText, structureQuery),
    handlerRegistry: registry(),
    graphState: structuredClone(graph) as never,
  });
  return response.assistant_text;
}

beforeEach(() => {
  writes.length = 0;
  persistedGraph = structuredClone(GRAPH);
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('a typed outgoing-influence question is answered in its OWN direction', () => {
  /**
   * ⭐⭐ THE LOAD-BEARING POSITIVE CONTROL, AND WHY IT IS SHAPED LIKE THIS.
   * It asserts the answer names the REQUESTED SUBJECT *and* answers the
   * REQUESTED PREDICATE, as ONE bound phrase. A control that checked "the
   * subject label appears" or "the answer is long" passes on a fluent answer to
   * the wrong question — measured: #1310's mutant M1 emitted *"Fit with target
   * investor thesis and deal size has the strongest visible direct influence…"*,
   * which satisfies both of those weaker forms. Two reviewers approved on them.
   */
  it('answers what the element DRIVES, naming the subject and the driven element together', async () => {
    const text = await drive(FULL_LABEL_Q1, { kind: 'outgoing_influence', element_id: 'fit' });

    expect(text).toContain(`from ${INVESTOR_LABEL} to ${GOAL_LABEL}`);
    expect(text).toContain('complete direct outgoing influences');

    // DIRECTION-INVERSION GUARD: `fit`'s incoming neighbour is real, and naming
    // it would be the truthful-answer-to-a-different-question defect.
    expect(text).not.toContain(TRACTION_LABEL);
    expect(text).not.toMatch(/incoming/i);

    // The authored prose invented a dependency; none of it escapes.
    expect(text).not.toContain('phased pilot');
  });

  /**
   * ⭐ THE OPPOSITE-DIRECTION TWIN, on the identical turn. It fails on a
   * DIFFERENT assertion from the test above — this one goes red when an outgoing
   * fact is substituted into the incoming answer, that one when an incoming fact
   * is substituted into the outgoing answer. Neither can stand in for the other.
   */
  it('TWIN — the same turn typed as `dependencies` still answers INCOMING only', async () => {
    const text = await drive(FULL_LABEL_Q1, { kind: 'dependencies', element_id: 'fit' });

    expect(text).toContain(`from ${TRACTION_LABEL} to ${INVESTOR_LABEL}`);
    expect(text).toContain('complete direct incoming dependencies');
    expect(text).not.toContain(GOAL_LABEL);
    expect(text).not.toMatch(/outgoing/i);
  });

  it('states an empty outgoing set truthfully rather than borrowing the incoming one', async () => {
    const text = await drive(FULL_LABEL_Q1, { kind: 'outgoing_influence', element_id: 'fit' }, LEAF_GRAPH);

    expect(text).toContain(`no direct outgoing influence from ${INVESTOR_LABEL}`);
    // The incoming connector still exists on this graph and must not be offered.
    expect(text).not.toContain(TRACTION_LABEL);
    expect(text).not.toContain('phased pilot');
  });
});

describe('the safety verdicts and the authored-prose licence are unchanged', () => {
  /**
   * ⚠ PR #1310 WAS REJECTED FOR WEAKENING THIS. The `ambiguous` verdict still
   * outranks authored prose, on the new kind exactly as on the old one, and the
   * refusal still names no canonical element.
   */
  it('still refuses the witnessed SHORTHAND — the subject-binding gap is not silently closed here', async () => {
    const text = await drive(WITNESSED_Q1, { kind: 'outgoing_influence', element_id: 'fit' });

    expect(text).toContain('I could not tell which part of your model you are asking about');
    expect(text).toContain('so I will not guess at what it affects');
    for (const label of [INVESTOR_LABEL, TRACTION_LABEL, GOAL_LABEL]) {
      expect(text, 'a refusal must name no canonical element').not.toContain(label);
    }
    expect(text).not.toContain('phased pilot');
    expect(text).not.toMatch(/dependency question|Living Model element/i);
  });

  /**
   * ⚠⚠ THE SEAM THE REVIEW NAMED. Demoting a query to `general` sets
   * `mayUseAuthoredGeneralAnswer` TRUE and re-opens #1229. A NEW TYPED KIND does
   * the opposite: it is not `general`, so the licence stays shut. Pinned on both
   * a resolved and an ambiguous outgoing turn, because the resolved case is where
   * a future "the evidence is fine, let the model phrase it" change would land.
   */
  it('never licenses authored prose on the new kind, resolved or ambiguous', async () => {
    for (const [name, message, graph] of [
      ['resolved', FULL_LABEL_Q1, GRAPH],
      ['ambiguous', WITNESSED_Q1, GRAPH],
      ['empty outgoing set', FULL_LABEL_Q1, LEAF_GRAPH],
    ] as const) {
      const text = await drive(message, { kind: 'outgoing_influence', element_id: 'fit' }, graph);
      expect(text, `${name}: invented dependency must not escape`).not.toContain('phased pilot');
      expect(text, `${name}: authored prose must not be used verbatim`).not.toContain(INVENTED_PROSE);
    }
    // CONTRAST CONTROL in the same run: a genuinely `general` query DOES use the
    // authored answer, so the four refusals above are the licence being shut and
    // not a handler that ignores authored text everywhere.
    const generalText = await drive(
      WITNESSED_Q1, { kind: 'general' }, GRAPH,
      `Investor fit matters because the model links ${INVESTOR_LABEL} straight to ${GOAL_LABEL}.`,
    );
    expect(generalText).toContain(INVESTOR_LABEL);
    expect(generalText).toContain(GOAL_LABEL);
  });

  /**
   * The two carriers are keyed to different kinds, so they can never both be
   * populated on one turn. Asserted by OUTCOME rather than by reading the
   * executor: each kind produces its own predicate's signature phrase and NOT the
   * other's, which is only possible if exactly one carrier fired.
   */
  it('never renders both predicates on one turn', async () => {
    const out = await drive(FULL_LABEL_Q1, { kind: 'outgoing_influence', element_id: 'fit' });
    const inc = await drive(FULL_LABEL_Q1, { kind: 'dependencies', element_id: 'fit' });
    expect(out).toContain('complete direct outgoing influences');
    expect(out).not.toContain('complete direct incoming dependencies');
    expect(inc).toContain('complete direct incoming dependencies');
    expect(inc).not.toContain('complete direct outgoing influences');
    expect(out).not.toBe(inc);
  });
});
