/**
 * ⭐⭐⭐ THE REFUSAL IS RIGHT. ITS DIAGNOSIS IS FALSE.
 * Captured 1 Sep 2026, deployed CEE `d545535`, reproducible 2/2 byte-identical:
 *
 *   USER  "Why does this decision matter?"   → `structure_query.kind:'outgoing_influence'`
 *   CEE   "I could not tell which part of your model you are asking about,
 *          so I will not guess at what it affects."
 *
 *   USER  "Why does the goal matter?"        → `structure_query.kind:'dependencies'`
 *   CEE   "I could not tell which part of your model you are asking about,
 *          so I will not guess at what connects to it."
 *
 * The user was perfectly clear. They asked about the whole thing. The product
 * replied that it could not understand them. **A false diagnosis inside a
 * refusal is worse than the refusal**, and it is the one part of this turn that
 * is fixable here without re-opening a fabrication seam.
 *
 * ⚠⚠ IS THE WHOLE MODEL A RESOLVABLE SUBJECT? DERIVED AT THE BYTES — NO, NOT IN
 * THIS CARRIER. `buildSelectedElementEdgeEvidence` takes its subject from
 * `structure_query.element_id` and nothing else (`routing/structural-pair-evidence.ts`);
 * both `DependenciesQuerySchema` and `OutgoingInfluenceQuerySchema` declare
 * `element_id: z.string().min(1)` under `.strict()` (`routing/types.ts`). The only
 * element-free arm of the union is `kind:'general'`, which reaches a DIFFERENT
 * composer. So a whole-model referent is UNREPRESENTABLE in the carrier the
 * router selected — the resolver is structurally node-scoped, and no amount of
 * subject resolution can bind "this decision" to a node that is not in the graph.
 *
 * ⭐ AND THE CONTRAST CONTROL THAT PROVES IT IS THE WORDING, NOT THE GRAPH: the
 * SAME turn, SAME graph, SAME `structure_query`, SAME resolved proposal entity,
 * with the FULL canonical label substituted for the whole-model phrase, RESOLVES
 * and answers. Pinned below in both directions. Resolution is not broken and is
 * NOT loosened by this change.
 *
 * ⚠ WHAT THIS CHANGE DELIBERATELY DOES NOT DO, because each is a known worse
 * defect already paid for in this repo:
 *   - It does not touch the VERDICT. Letting `ambiguous` fall through to the
 *     projection is #1310, rejected: it answers a different question confidently.
 *   - It does not widen `normaliseWholeModelStructureQuery`. Demoting to
 *     `general` sets `mayUseAuthoredGeneralAnswer` TRUE and re-opens #1229, where
 *     fluent prose invented an unlisted option-to-factor dependency.
 *   - It does not promise a whole-model answer. Swept for a deterministic
 *     element-free route: the only two `kind:'general'` constructions in
 *     `route-with-tool-use.ts` are the PILL-forced default (:1405) and the narrow
 *     single-factor demotion (:1475). Neither catches this question, so telling
 *     the user to "ask about the model as a whole" would advertise an action that
 *     may terminate in the same refusal. Rowed instead.
 *   - It does not touch the `subject_selection:'single_resolved'` branch, which
 *     is a different reachability class (the user HAS one element selected). Its
 *     copy is pinned UNCHANGED below, and is this file's different-subject control.
 *
 * SO THE FIX IS THE WORDS ONLY, exactly the shape #1308 shipped on the sibling
 * branch: state the SCOPE the answer has ("one part at a time") instead of
 * asserting a comprehension failure, and give the remedy that is DERIVED to work
 * — the EXACT label (proven by the contrast control below) or a canvas selection
 * (proven by `routing/__tests__/outgoing-influence-evidence.test.ts`, whose
 * selection fixture resolves without the prose gate). The old "name it" told the
 * user to do the thing they believed they had just done.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { V5ActionType } from '@talchain/schemas/orchestrator';

import type { ChatWithToolsResult, ToolResponseBlock } from '../../adapters/llm/types.js';
import { setTestSink } from '../../utils/telemetry.js';
import type { HandlerFn, HandlerRegistry } from '../tools/registry.js';
import { createExplainFromStructureHandler } from '../tools/handlers/explain-from-structure.js';
import {
  composeSelectedDependenciesEvidenceAnswer,
  composeSelectedOutgoingInfluenceEvidenceAnswer,
} from '../tools/handlers/explanation-fallback.js';

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

const GOAL_LABEL = 'Close a Series A on acceptable terms';
const FIT_LABEL = 'Fit with target investor thesis and deal size';
const TRACTION_LABEL = 'Demonstrated revenue traction';
const RUNWAY_LABEL = 'Months of runway remaining';

/**
 * ⭐ THE EXACT WITNESSED WORDINGS. Never paraphrase — they are the evidence, and
 * their defining property is that neither names any element in the graph.
 */
const WITNESSED_DECISION_Q = 'Why does this decision matter?';
const WITNESSED_GOAL_Q = 'Why does the goal matter?';

/** The known-and-deliberately-unfixed shorthand case, kept as the opposite-direction twin. */
const SHORTHAND_Q = 'why do you think investor fit matters most here?';

/** The authored prose invents a dependency the graph does not contain. */
const INVENTED_PROSE =
  `Investor fit matters most because ${FIT_LABEL} depends on a phased pilot commitment.`;

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: GOAL_LABEL },
    { id: 'fit', kind: 'factor', label: FIT_LABEL, observed_state: { value: 0.5 } },
    { id: 'traction', kind: 'factor', label: TRACTION_LABEL, observed_state: { value: 0.5 } },
    { id: 'runway', kind: 'factor', label: RUNWAY_LABEL, observed_state: { value: 0.5 } },
    { id: 'opt_a', kind: 'option', label: 'Raise now at a lower valuation', interventions: { runway: 0.8 } },
    { id: 'opt_b', kind: 'option', label: 'Delay and build traction', is_baseline: true, interventions: { traction: 0.6 } },
  ],
  edges: [
    { from: 'fit', to: 'goal', strength: { mean: 0.7, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'traction', to: 'fit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'runway', to: 'goal', strength: { mean: -0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
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

/**
 * The frontier model is the ONLY producer of `structure_query.kind`, so the
 * adapter supplies exactly what a witnessed turn supplied. The evidence builder,
 * the label resolution and the handler are all production code below.
 */
function adapter(
  answerText: string,
  structureQuery: unknown,
  entity: { id: string; kind: string; label: string },
) {
  return {
    chatWithTools: vi.fn(async (): Promise<ChatWithToolsResult> => toolResult({
      intent_class: 'execute',
      action: {
        handler_id: 'explain_from_structure',
        entity: {
          id: entity.id,
          kind: entity.kind,
          label: entity.label,
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

const GOAL_ENTITY = { id: 'goal', kind: 'goal', label: GOAL_LABEL };
const FIT_ENTITY = { id: 'fit', kind: 'node', label: FIT_LABEL };

async function drive(
  message: string,
  structureQuery: unknown,
  entity: { id: string; kind: string; label: string } = GOAL_ENTITY,
  answerText: string = INVENTED_PROSE,
): Promise<string> {
  persistedGraph = structuredClone(GRAPH);
  const { response } = await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
    routingAdapter: adapter(answerText, structureQuery, entity),
    handlerRegistry: registry(),
    graphState: structuredClone(GRAPH) as never,
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

describe('a whole-model question is refused for scope, and the refusal must say so', () => {
  /**
   * ⭐ RED-FIRST SIGNATURE 1 at pristine: the served text contains
   * "I could not tell which part of your model you are asking about", so the
   * `not.toMatch` below fails with that string in the diff.
   */
  it('stops claiming it could not understand a whole-model OUTGOING question', async () => {
    const text = await drive(WITNESSED_DECISION_Q, {
      kind: 'outgoing_influence',
      element_id: 'goal',
    });

    // THE DEFECT: the user was clear; the product blamed its own comprehension.
    expect(text).not.toMatch(/could not tell which part of your model/i);
    expect(text).not.toMatch(/could not (?:tell|understand|work out) what you (?:meant|were asking)/i);

    // THE TRUTH IT MUST STATE INSTEAD — scope, not comprehension.
    expect(text).toContain('did not pin down a single part of your model');
    expect(text).toContain('one part at a time');

    // The remedy must be the one that is DERIVED to work: the EXACT label.
    expect(text).toContain('exactly as it appears in your model');
    expect(text).toContain('select it on the canvas');
  });

  /**
   * ⭐ RED-FIRST SIGNATURE 2 at pristine: identical mechanism under the other
   * kind. Both witnessed turns are pinned, because the deployed capture showed
   * the class refusing under BOTH.
   */
  it('stops claiming it could not understand a whole-model INCOMING question', async () => {
    const text = await drive(WITNESSED_GOAL_Q, { kind: 'dependencies', element_id: 'goal' });

    expect(text).not.toMatch(/could not tell which part of your model/i);
    expect(text).toContain('did not pin down a single part of your model');
    expect(text).toContain('one part at a time');
    expect(text).toContain('exactly as it appears in your model');
  });

  /**
   * ⭐⭐ THE VERDICT IS UNTOUCHED, AND THIS IS THE HALF THAT MATTERS MOST. Every
   * way of "fixing" this class by answering anyway is pinned as forbidden here,
   * under BOTH kinds, so a later lane cannot reach #1310's rejected fix or
   * #1229's fabrication seam from either direction.
   */
  it.each([
    ['outgoing_influence', WITNESSED_DECISION_Q, 'what it affects'],
    ['dependencies', WITNESSED_GOAL_Q, 'what connects to it'],
  ] as const)(
    'still refuses under kind=%s — no element named, no projection, no invented prose',
    async (kind, message, directionClause) => {
      const text = await drive(message, { kind, element_id: 'goal' });

      // The refusal itself survives, with its direction clause intact.
      expect(text).toContain(`I will not guess at ${directionClause}`);

      // Subject safety: identity was never established, so NO element may be named.
      expect(text).not.toContain(GOAL_LABEL);
      expect(text).not.toContain(FIT_LABEL);
      expect(text).not.toContain(TRACTION_LABEL);
      expect(text).not.toContain(RUNWAY_LABEL);

      // Fabrication safety: the authored prose invented a dependency (#1229).
      expect(text).not.toContain('phased pilot');
      expect(text).not.toContain(INVENTED_PROSE);

      // Verdict safety: the generic projection must not replace the refusal (#1310).
      expect(text).not.toMatch(/strongest visible direct influence/i);
      expect(text).not.toMatch(/The model contains \d+ factors?/i);
    },
  );

  /**
   * ⭐⭐ THE CONTRAST CONTROL, AND THE PROOF THAT SUBJECT RESOLUTION IS NOT
   * LOOSENED. Same graph, same `structure_query`, same resolved proposal entity;
   * only the wording changes to the full canonical label. It RESOLVES — so the
   * refusals above are the question's scope, not a broken resolver, and this
   * test REDs the moment anyone widens or narrows the identity gate.
   */
  it('OPPOSITE DIRECTION — the full canonical label still resolves and answers (outgoing)', async () => {
    const text = await drive(`Why does ${GOAL_LABEL} matter?`, {
      kind: 'outgoing_influence',
      element_id: 'goal',
    });

    expect(text).toContain(`no direct outgoing influence from ${GOAL_LABEL}`);
    expect(text).not.toContain('did not pin down a single part of your model');
    expect(text).not.toContain('phased pilot');
  });

  it('OPPOSITE DIRECTION — the full canonical label still resolves and answers (incoming)', async () => {
    const text = await drive(`Why does ${GOAL_LABEL} matter?`, {
      kind: 'dependencies',
      element_id: 'goal',
    });

    // Binds to the right element's REAL incoming connectors, by identity.
    expect(text).toContain(`from ${FIT_LABEL} to ${GOAL_LABEL}`);
    expect(text).toContain(`from ${RUNWAY_LABEL} to ${GOAL_LABEL}`);
    expect(text).not.toContain('did not pin down a single part of your model');
    expect(text).not.toContain('phased pilot');
  });

  /**
   * ⭐ THE OPPOSITE-DIRECTION TWIN THE BRIEF REQUIRES: the known shorthand case
   * must STILL REFUSE. This change is copy-only, so a shorthand that could not be
   * bound before must not become bindable now. If a later lane widens the prose
   * gate to make the whole-model class "pass", this REDs.
   */
  it('OPPOSITE DIRECTION — the known shorthand still refuses, and still names no element', async () => {
    const text = await drive(SHORTHAND_Q, { kind: 'dependencies', element_id: 'fit' }, FIT_ENTITY);

    expect(text).toContain('did not pin down a single part of your model');
    expect(text).toContain('I will not guess at what connects to it');
    expect(text).not.toContain(FIT_LABEL);
    expect(text).not.toContain(TRACTION_LABEL);
    expect(text).not.toContain('phased pilot');
  });
});

describe('the composer copy binds to its own branch and its own direction', () => {
  /**
   * ⭐ THE DIFFERENT-SUBJECT CONTROL. `subject_selection:'single_resolved'` is a
   * DIFFERENT reachability class — the user HAS exactly one element selected, so
   * "name it or select it" would state a condition that is already true. It is
   * deliberately OUT OF SCOPE here, and pinned UNCHANGED so a bulk edit of the
   * neighbouring branch cannot silently take it too.
   */
  it('leaves the single-resolved branch exactly as it was (both directions)', () => {
    expect(
      composeSelectedDependenciesEvidenceAnswer({
        status: 'ambiguous',
        subject_selection: 'single_resolved',
      }),
    ).toBe(
      'I could not match your question to a single part of your saved model, so I will not guess at what connects to it. ' +
      'Check that the one you mean appears only once in the model, and ask again.',
    );

    expect(
      composeSelectedOutgoingInfluenceEvidenceAnswer({
        status: 'ambiguous',
        subject_selection: 'single_resolved',
      }),
    ).toBe(
      'I could not match your question to a single part of your saved model, so I will not guess at what it affects. ' +
      'Check that the one you mean appears only once in the model, and ask again.',
    );
  });

  /**
   * ⭐⭐ THE DIRECTION WORDS MUST NOT CROSS. The two composers render opposite
   * predicates from structurally identical payloads; the file's standing
   * invariant is that neither string contains the other's direction word. A
   * shared-copy refactor of the branch changed above would break exactly this.
   */
  it('keeps each ambiguous refusal free of the other direction word', () => {
    const incoming = composeSelectedDependenciesEvidenceAnswer({ status: 'ambiguous' });
    const outgoing = composeSelectedOutgoingInfluenceEvidenceAnswer({ status: 'ambiguous' });

    expect(incoming).toContain('connects to it');
    expect(incoming).not.toContain('affects');

    expect(outgoing).toContain('affects');
    expect(outgoing).not.toContain('connects to it');
  });
});
