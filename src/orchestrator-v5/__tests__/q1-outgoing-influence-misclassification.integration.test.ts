/**
 * ⭐⭐⭐ THE SUBJECT WAS NEVER THE FIRST FAILING LINK — THE PREDICATE WAS.
 * Captured 1 Sep 2026, deployed staging, fresh guest session, real funding brief.
 *
 *   USER  "why do you think investor fit matters most here?"
 *   CEE   "I cannot establish one unique Living Model element and matching
 *          dependency question, so I will not guess its relationships."
 *
 * ⚠ SCOPE OF THAT CAPTURE, STATED EXACTLY. Those WORDS are already gone: #1308
 * reworded both ambiguous branches into plain language, so the string above no
 * longer exists at this tip and the assertions below pin the CURRENT copy. What
 * the capture still evidences, and what this file is about, is the BEHAVIOUR —
 * the turn declines to answer a question the model could answer.
 *
 * PR #1310 was REJECTED for trying to fix this by excluding `status:'ambiguous'`
 * from the handler's evidence gate. Its rejection carried three P1s; the third
 * was that Q1 was never proven through the real executor. This file is that
 * proof, and it OVERTURNS THE PREMISE THE FIX WAS BUILT ON.
 *
 * ⚠⚠ DERIVED AT THE REAL EXECUTOR, WITH PRODUCTION LABEL RESOLUTION AND NO
 * INJECTED PROJECTION. Four shapes, one graph, one handler:
 *
 *   1. Q1 — the exact witnessed shorthand, `kind:'dependencies'`
 *      → `ambiguous`. WHICH IDENTITY DISAGREED: the CURRENT-MESSAGE PROSE one,
 *        and only that one. The typed query, the resolved proposal entity and
 *        the canonical graph all name `fit`; there is no selection to conflict.
 *        `buildSelectedDependenciesEvidence`'s named-reference gate requires
 *        `resolveTypedCanonicalProseEntityRefs` to find the WHOLE canonical
 *        label as a bounded phrase, and "investor fit" is not the phrase
 *        "Fit with target investor thesis and deal size".
 *
 *   2. Q2 — the SAME turn with the FULL canonical label
 *      → `resolved`. Whole-label resolution ALREADY WORKS; it is not the gap.
 *
 * ⭐ 1 and 2 are a DISCRIMINATING PAIR: identical graph, identical
 * `structure_query`, identical resolved proposal entity. The ONLY difference is
 * the user's wording. That is what proves the prose identity is the deciding
 * input, rather than asserting it.
 *
 * ⭐⭐ AND THE RESULT THAT SETTLES THE LANE: binding the subject does NOT answer
 * the question. `kind:'dependencies'` reads INCOMING connectors, and "why does X
 * matter" asks about OUTGOING influence. So a fix that corroborates the shorthand
 * would convert Q1's honest refusal into a truthful answer to a DIFFERENT
 * question — the exact direction inversion #1310's review rejected, reached by a
 * different route. Shapes 2 and 3 pin that: perfectly bound subject, wrong
 * predicate, every time.
 *
 *   4. Q1 with `kind:'general'` — the correct classification for this question
 *      → answered correctly, TODAY, with no code change at all.
 *
 * THE FIRST FAILING LINK IS THEREFORE THE PREDICATE, AND IT IS CHOSEN BY THE
 * FRONTIER MODEL. `structure_query.kind` is never constructed deterministically
 * in production (swept `rg -a` over `src/` excluding tests: 0 real constructions
 * of `kind:'dependencies'`; contrast control `kind:'general'` = 2 real hits at
 * `routing/route-with-tool-use.ts:1405,1475`). The one deterministic correction,
 * `normaliseWholeModelStructureQuery`, is deliberately narrow: it demotes only a
 * whole-model single-factor build question, and the witnessed Q1 matches neither
 * of its two conjuncts.
 *
 * ⚠ WHY WIDENING THAT DEMOTION IS NOT THE FIX EITHER. Demoting to `general` sets
 * `mayUseAuthoredGeneralAnswer` TRUE, which LICENSES authored model prose — the
 * precise seam #1229 closed after fluent prose invented an unlisted
 * option-to-factor dependency. A too-wide demotion predicate therefore re-opens
 * the fabrication defect, confidently. That is the inverse defect and the worse
 * one, and it is the natural-language-predicate class this estate has oscillated
 * on repeatedly. It needs an independent corpus and its own blast radius, not a
 * regex added here.
 *
 * SO THIS FILE SHIPS NO BEHAVIOUR CHANGE. It pins the derivation in executable
 * form so the next lane cannot re-attempt #1310's fix without a RED, and so the
 * real gap — an outgoing-influence question typed as `dependencies` — stays
 * visible in the suite rather than in a comment. A gap recorded in the suite is
 * honest; a gap invisible to it is how this was attempted twice.
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

/** The witnessed canonical factor label, and the shorthand the user actually typed. */
const INVESTOR_LABEL = 'Fit with target investor thesis and deal size';
/** ⭐ The EXACT witnessed wording. Never paraphrase it — it is the evidence. */
const WITNESSED_Q1 = 'why do you think investor fit matters most here?';
const FULL_LABEL_Q1 = `why do you think ${INVESTOR_LABEL} matters most here?`;

const GOAL_LABEL = 'Close a Series A on acceptable terms';
const TRACTION_LABEL = 'Demonstrated revenue traction';

const NODES = [
  { id: 'goal', kind: 'goal', label: GOAL_LABEL },
  { id: 'fit', kind: 'factor', label: INVESTOR_LABEL, observed_state: { value: 0.5 } },
  { id: 'traction', kind: 'factor', label: TRACTION_LABEL, observed_state: { value: 0.5 } },
  { id: 'runway', kind: 'factor', label: 'Months of runway remaining', observed_state: { value: 0.5 } },
  { id: 'opt_a', kind: 'option', label: 'Raise now at a lower valuation', interventions: { runway: 0.8 } },
  { id: 'opt_b', kind: 'option', label: 'Delay and build traction', is_baseline: true, interventions: { traction: 0.6 } },
];

/** `fit` carries one incoming connector and one outgoing connector to the goal. */
const GRAPH = {
  nodes: NODES,
  edges: [
    { from: 'fit', to: 'goal', strength: { mean: 0.7, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'traction', to: 'fit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'runway', to: 'goal', strength: { mean: -0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
  ],
  goal_node_id: 'goal',
};

/** The witnessed shape: `fit` is a ROOT factor — outgoing influence only. */
const ROOT_GRAPH = {
  ...GRAPH,
  edges: GRAPH.edges.filter((edge) => edge.to !== 'fit'),
};

/**
 * A fluent, plausible authored answer that names a dependency the model does NOT
 * contain. It exists so the `useSonnetAnswer` guard's mutant has something
 * unmistakably invented to restore.
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

/**
 * The frontier model is the ONLY producer of `structure_query.kind`, so the
 * adapter supplies exactly what the witnessed turn supplied and nothing else is
 * stubbed: the evidence builder, the label resolution and the handler are all
 * production code on every assertion below.
 */
function adapter(answerText: string, structureQuery: unknown) {
  return {
    chatWithTools: vi.fn(async (): Promise<ChatWithToolsResult> => toolResult({
      intent_class: 'execute',
      action: {
        handler_id: 'explain_from_structure',
        entity: {
          id: 'fit',
          kind: 'node',
          label: INVESTOR_LABEL,
          resolution_status: 'resolved',
          resolution_method: 'id_match',
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

describe('the witnessed Q1 is a misclassified predicate, not an unbound subject', () => {
  it('refuses the witnessed shorthand because the CURRENT-MESSAGE PROSE identity is the one that disagrees', async () => {
    const text = await drive(WITNESSED_Q1, { kind: 'dependencies', element_id: 'fit' });

    // The verdict is preserved: no relationship is claimed for any element.
    expect(text).toContain('I could not tell which part of your model you are asking about');
    expect(text).toContain('so I will not guess at what connects to it');

    // Subject safety: the refusal must not name ANY canonical element, because
    // the whole point of the verdict is that identity was not established.
    expect(text).not.toContain(INVESTOR_LABEL);
    expect(text).not.toContain(TRACTION_LABEL);
    expect(text).not.toContain(GOAL_LABEL);

    // Fabrication safety: the authored prose invented a dependency; none of it escapes.
    expect(text).not.toContain('phased pilot');

    // No schema vocabulary reaches the user (the 1 Sep copy defect, fixed in #1308).
    expect(text).not.toMatch(/dependency question|Living Model element/i);
  });

  /**
   * ⭐ THE TWO DISCRIMINATORS. There are exactly two ways to wrongly replace this
   * refusal, and each gets its OWN test asserting its OWN signature, so the two
   * failure modes can never be read as one another. Discarding the verdict
   * (#1310) REDs the first and leaves the second green; corroborating the
   * shorthand REDs the second and leaves the first green.
   */
  it('DISCRIMINATOR A — the refusal is not replaced by a generic structural projection', async () => {
    const text = await drive(WITNESSED_Q1, { kind: 'dependencies', element_id: 'fit' });

    // The projection describes whatever it can see, for any subject. It is
    // fluent, it is true of the graph, and it does not answer what was asked.
    expect(text).not.toMatch(/strongest visible direct influence/i);
    expect(text).not.toMatch(/The model contains \d+ factors?/i);
  });

  it('DISCRIMINATOR B — the refusal is not replaced by a typed INCOMING dependency answer', async () => {
    const text = await drive(WITNESSED_Q1, { kind: 'dependencies', element_id: 'fit' });

    // Corroborating the shorthand would bind the subject perfectly and still
    // answer the wrong predicate. That is the direction inversion the review
    // rejected, arrived at from the other side.
    expect(text).not.toContain('direct incoming dependencies');
    expect(text).not.toContain('directed connector from');
  });

  it('resolves the SAME turn when only the wording changes to the full canonical label — the discriminating pair', async () => {
    // Identical graph, identical structure_query, identical resolved proposal
    // entity. The ONLY difference from the test above is the message text, so a
    // different verdict can only be the prose identity's doing.
    const text = await drive(FULL_LABEL_Q1, { kind: 'dependencies', element_id: 'fit' });

    // Whole-label resolution already works: the subject binds, by identity.
    expect(text).toContain(INVESTOR_LABEL);
    // ...and it binds to the RIGHT element's real incoming connector.
    expect(text).toContain(TRACTION_LABEL);
    expect(text).not.toContain('I could not tell which part of your model');
    expect(text).not.toContain('phased pilot');
  });

  it('answers the WRONG PREDICATE once the subject is bound — incoming, for a question about influence', async () => {
    const text = await drive(FULL_LABEL_Q1, { kind: 'dependencies', element_id: 'fit' });

    // ⭐ The load-bearing assertion of this file. The user asked why the element
    // MATTERS (outgoing influence). A bound subject buys an INCOMING answer.
    expect(text).toContain('direct incoming dependencies');
    expect(text).toContain(`from ${TRACTION_LABEL} to ${INVESTOR_LABEL}`);

    // DIRECTION-INVERSION GUARD: the element's outgoing connector to the goal is
    // real, and must NOT be substituted into an incoming-dependency answer.
    expect(text).not.toContain(GOAL_LABEL);
  });

  it('states the incoming scope in plain language when the witnessed root factor has no incoming connector', async () => {
    const text = await drive(FULL_LABEL_Q1, { kind: 'dependencies', element_id: 'fit' }, ROOT_GRAPH);

    // Subject bound by identity; predicate declared explicitly and truthfully.
    expect(text).toContain(`no direct incoming dependency for ${INVESTOR_LABEL}`);

    // DIRECTION-INVERSION GUARD, the case the rejection named: `fit` DOES drive
    // the goal, and that outgoing fact must not be offered as the answer to an
    // incoming question. Naming what it drives belongs to a separate
    // outgoing-influence evidence path, not to `dependencies`.
    expect(text).not.toContain(GOAL_LABEL);
    expect(text).not.toContain('phased pilot');
  });

  it('already answers the witnessed question correctly under the CORRECT classification, with no code change', async () => {
    const grounded =
      `Investor fit matters most because the model links ${INVESTOR_LABEL} straight to ${GOAL_LABEL}.`;
    const text = await drive(WITNESSED_Q1, { kind: 'general' }, GRAPH, grounded);

    // Subject bound AND the asked predicate answered — on the unchanged tip.
    expect(text).toContain(INVESTOR_LABEL);
    expect(text).toContain(GOAL_LABEL);
    expect(text).not.toContain('I could not tell which part of your model');
  });

  it('keeps authored prose off the ambiguous turn — the guard whose mutant restores an invented dependency', async () => {
    const text = await drive(WITNESSED_Q1, { kind: 'dependencies', element_id: 'fit' });

    // `useSonnetAnswer` excludes every turn carrying selected-dependencies
    // evidence, ambiguous included. Removing that conjunct restores the invented
    // "phased pilot" dependency verbatim (mutant M3).
    expect(text).not.toContain('phased pilot');
    expect(text).not.toContain(INVENTED_PROSE);
  });
});
