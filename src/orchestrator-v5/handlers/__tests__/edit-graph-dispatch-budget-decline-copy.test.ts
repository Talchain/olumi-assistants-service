/**
 * ROADMAP 2.655 — EVERY DECLINE OF THE STRUCTURAL-EDIT TOOL, AFTER A BUDGET
 * REFUSAL, MEASURED AT THE SEAM A USER READS.
 *
 * ── THE WITNESSED DEFECT (walk 2.634, 2026-08-07) ──────────────────────────
 * The canonical compound edit — "Add three new options ... Connect each to the
 * MRR goal, and add a distinct risk factor for each of the three" — returned
 * the pre-split dead end VERBATIM:
 *
 *   "I tried to make that change, but it would require 6 node operations and 6
 *    edge operations - more than is safe in a single edit (limit: 4 node ops,
 *    8 edge ops). Consider breaking this into smaller steps ..."
 *
 * No first batch, no scope notice, internal caps leaked, and no explanation
 * that only the NODE budget tripped (six edge operations were under the eight
 * the sentence quotes).
 *
 * ── WHY #829's SPLIT DID NOT SAVE THE TURN ────────────────────────────────
 * The splitter runs only inside `tryStructuralEditTool`, which is a SECOND
 * composition: a real `chatWithTools` call plus a grounding validator. When
 * that second composition declines for ANY reason, the function returned
 * `null` — and `null` means "the rulebook's own answer stands". The rulebook's
 * own answer, on this turn, is the leaked-limits dead end. Exactly ONE decline
 * class (`BATCH_CAP_EXCEEDED`) had replacement copy; every other class silently
 * reinstated the defect.
 *
 * ── WHY NO TEST SAW IT ────────────────────────────────────────────────────
 * Every existing fixture for this feature stubs the composer to SUCCEED. The
 * suite therefore measured the split and never the decline (trap 13c/16: the
 * fixtures encoded the author's model of the composer rather than the
 * composer's real failure modes). This file is the missing half: one case per
 * decline class, all of them entered from the walk's real budget refusal.
 *
 * ── WHAT IS ASSERTED, AND WHY IT IS THREE SEPARATE CLAIMS ────────────────
 * The rulebook's answer is NOT hand-typed here. It is built by the PRODUCER
 * (`buildPatchRejectionEnvelope`) from the walk's real counts, so it tracks the
 * real sentence rather than a snapshot of it (trap 13c: derive the expectation
 * from the producer's semantics, never from the test author's reading). Three
 * claims are then made, and they are deliberately NOT collapsed, because a
 * partial fix satisfies some and not others:
 *
 *   1. ANSWER PRECEDENCE — the rulebook's budget answer is not what ships.
 *      This is the 2.655 defect proper, and it is the one that survives even
 *      after the budget copy itself is cleaned up.
 *   2. NO INTERNAL CAP — whatever ships names no cap and no operation count.
 *      Pattern-bound, independent of who produced the sentence.
 *   3. THE RIGHT SENTENCE — the copy that ships is the one for THIS decline
 *      class, looked up by identity in the producer's own table, never matched
 *      by a "looks honest" predicate several sentences would satisfy
 *      (CLAUDE.md trap 19).
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn(),
    loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
    loadMostRecentPendingActions: vi.fn().mockResolvedValue([]),
  };
});

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { getAdapter } from '../../../adapters/llm/router.js';
import { loadPersistedGraphStrict } from '../../build-turn-context.js';
import { buildPatchRejectionEnvelope } from '../../../orchestrator/patch-rejection-helper.js';
import {
  MAX_NODE_OPS,
  MAX_EDGE_OPS,
} from '../../../orchestrator/tools/patch-budget-limits.js';
import { _resetConfigCache } from '../../../config/index.js';
import {
  STRUCTURAL_EDIT_DECLINE_COPY,
  STRUCTURAL_EDIT_DECLINE_CLASSES,
  type StructuralEditDeclineClass,
} from '../structural-edit-decline-copy.js';
import {
  FORBIDDEN_USER_FACING_PHRASES,
  SUCCESS_CLAIM_PATTERNS,
} from '../../compose/forbidden-user-facing-phrases.js';
import type { ConversationContext } from '../../../orchestrator/types.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TURN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STUB_REQUEST = {} as FastifyRequest;

/**
 * ⭐ THE INTERNAL-CAP LEAK PATTERN.
 *
 * Two independent shapes, because the witnessed sentence carries both and a
 * partial de-leak reads clean against either one alone: the parenthesised cap
 * ("limit: 4 node ops") and the counted operation ("6 node operations").
 */
const INTERNAL_CAP_LEAK = /limit:\s*\d|\d+\s+(?:node|edge)\s+op/i;

/** The walk's base model, trimmed to what the request attaches to. */
const GRAPH = {
  nodes: [
    { id: 'dec_mrr', kind: 'decision', label: 'MRR Growth Strategy' },
    { id: 'goal_mrr', kind: 'goal', label: 'Reach £250,000 MRR' },
    { id: 'fac_churn', kind: 'factor', label: 'Customer Churn Rate' },
    { id: 'fac_demand', kind: 'factor', label: 'Market Demand Conditions' },
  ],
  edges: [{ from: 'dec_mrr', to: 'goal_mrr' }],
};

const NEW_OPTIONS = [
  { id: 'opt_acquire', label: 'Acquire a smaller competitor', risk: 'Integration overrun' },
  { id: 'opt_raise', label: 'Raise prices 10%', risk: 'Price-rise churn spike' },
  { id: 'opt_annual', label: 'Launch an annual plan discount', risk: 'Annual discount margin hit' },
];

/**
 * ⭐ THE WALK'S EXACT SHAPE: 6 node operations and 6 edge operations.
 *
 * Three options, each linked to the goal, each with its own risk factor linked
 * back to it. The NODE budget (four) trips; the EDGE budget (eight) does not —
 * which is precisely what the witnessed sentence failed to explain.
 */
const WALK_OPERATIONS = NEW_OPTIONS.flatMap((o) => [
  { op: 'add_node', path: o.id, value: { id: o.id, kind: 'option', label: o.label } },
  { op: 'add_edge', path: `${o.id}::goal_mrr`, value: { from: o.id, to: 'goal_mrr' } },
  {
    op: 'add_node',
    path: `fac_risk_${o.id}`,
    value: { id: `fac_risk_${o.id}`, kind: 'factor', label: o.risk },
  },
  {
    op: 'add_edge',
    path: `fac_risk_${o.id}::${o.id}`,
    value: { from: `fac_risk_${o.id}`, to: o.id },
  },
]);

const WALK_NODE_OPS = WALK_OPERATIONS.filter((o) => o.op.endsWith('_node')).length;
const WALK_EDGE_OPS = WALK_OPERATIONS.filter((o) => o.op.endsWith('_edge')).length;

const STUB_CONTEXT: ConversationContext = {
  messages: [],
  framing: null,
  graph: null,
  analysis_response: null,
  scenario_id: SCENARIO_ID,
};

/**
 * ⭐⭐ THE RULEBOOK'S OWN ANSWER, BUILT BY THE PRODUCER — never hand-typed.
 *
 * These are the arguments `edit-graph.ts` passes on the patch-budget refusal,
 * with the walk's measured counts. If the producer's copy changes, this fixture
 * changes with it, so "the user is not left with the rulebook's answer" keeps
 * meaning what it says.
 *
 * ⚠ NOTE WHAT THIS IS AND IS NOT, AFTER 2.655. The producer's sentence is now
 * itself clean — the counts and caps left it (I2). So this fixture is no longer
 * "the leaked sentence"; it is "whatever the rulebook would have said", and the
 * assertion built on it is about ANSWER PRECEDENCE, not about leakage. The
 * leaked sentence is pinned separately, as a historical corpus, in
 * `tests/unit/orchestrator/patch-rejection-no-internal-caps`. Conflating the
 * two would have left the precedence defect invisible the moment the copy was
 * cleaned up, which is the failure mode 2.655 exists to correct.
 */
function rulebookBudgetAnswerText(): string {
  return (
    buildPatchRejectionEnvelope(
      {
        reason: 'budget_exceeded',
        detail: 'Patch operation budget exceeded.',
        breached_dimensions: ['node'],
        node_ops: WALK_NODE_OPS,
        edge_ops: WALK_EDGE_OPS,
        max_node_ops: MAX_NODE_OPS,
        max_edge_ops: MAX_EDGE_OPS,
        suggested_actions: [
          {
            role: 'facilitator',
            label: 'Break into smaller steps',
            prompt: "Let's make this change in smaller steps.",
          },
        ],
      },
      TURN_ID,
      STUB_CONTEXT,
    ).assistant_text ?? ''
  );
}

/**
 * The rulebook result for the walk's turn: a REFUSAL stamped with the
 * producer's own `failure_code`, exactly as `handleEditGraph` returns it from
 * the patch-budget branch.
 */
function rulebookBudgetRejected(): EditGraphResult {
  return {
    blocks: [],
    assistantText: rulebookBudgetAnswerText(),
    latencyMs: 12,
    appliedGraph: null,
    wasRejected: true,
    suggestedActions: [
      {
        role: 'facilitator',
        label: 'Break into smaller steps',
        prompt: "Let's make this change in smaller steps.",
      },
      {
        role: 'challenger',
        label: 'Rebuild from updated brief',
        prompt: 'Would you like to rebuild the model from an updated brief instead?',
      },
    ],
    // Verified at the bytes (`edit-graph.ts`, patch-budget branch): the
    // handler stamps `failure_code: 'budget_exceeded'` on this return. Written
    // as a LITERAL rather than imported, so renaming the production constant
    // turns these tests RED instead of silently carrying them along.
    diagnostics: {
      failure_code: 'budget_exceeded',
      validation_outcome: 'budget_exceeded',
      branch_taken: 'rejection',
      branch_reason: 'patch_budget_exceeded',
      failure_branch: 'patch_budget',
    } as unknown as EditGraphResult['diagnostics'],
  };
}

function adapterComposing(operations: unknown[]) {
  return {
    name: 'stub',
    chatWithTools: vi.fn().mockResolvedValue({
      content: [{ type: 'tool_use', name: 'propose_structural_edit', input: { operations } }],
    }),
  };
}

function pipelineApplied(
  operations: readonly { op: string; path: string; value?: unknown }[],
): EditGraphResult {
  const created = operations.filter((o) => o.op === 'add_node');
  const linked = operations.filter((o) => o.op === 'add_edge');
  return {
    blocks: [],
    assistantText: 'Holding these changes.',
    latencyMs: 20,
    appliedGraph: {
      nodes: [
        ...GRAPH.nodes,
        ...created.map((o) => ({ id: o.path, kind: 'factor', label: `New ${o.path}` })),
      ],
      edges: [...GRAPH.edges, ...linked.map((o) => ({ ...(o.value as { from: string; to: string }) }))],
    } as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: operations as EditGraphResult['operations'],
  };
}

function preComposedCalls(): { op: string; path: string }[][] {
  const mock = handleEditGraph as MockedFunction<typeof handleEditGraph>;
  return mock.mock.calls
    .map((c) => c[5]?.preComposedOperations)
    .filter((o): o is NonNullable<typeof o> => o !== undefined)
    .map((o) => [...o] as { op: string; path: string }[]);
}

async function runWalkTurn() {
  return dispatchEditGraph({
    payload: {
      kind: 'message' as const,
      scenario_id: SCENARIO_ID,
      turn_id: TURN_ID,
      stage: 'analyse' as const,
      message:
        "Add three new options: 'Acquire a smaller competitor', 'Raise prices 10%', and 'Launch an annual plan discount'. Connect each to the MRR goal, and add a distinct risk factor for each of the three.",
      turn_class: 'frame' as const,
      source: 'composer' as const,
    },
    requestId: 'req-2655-walk',
    request: STUB_REQUEST,
    graphState: GRAPH as unknown as GraphStateIngress,
    analysisState: null,
  });
}

/** The rulebook always refuses on budget in this file; only the tool varies. */
function rulebookRefusesOnBudget(): void {
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValueOnce(
    rulebookBudgetRejected(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  _resetConfigCache();
  // ⚠ `clearAllMocks` clears CALLS, not the `mockResolvedValueOnce` QUEUE. A
  // test that queues two one-shot results and consumes one leaves the other
  // behind, and the NEXT test silently runs on a fixture it never asked for.
  // (Measured: the non-budget control below received the budget dead end from
  // a previous case's leftover queue and failed for entirely the wrong
  // reason.) Reset the three mocks this file queues onto, explicitly, and
  // never the two whose implementations come from the module factory.
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockReset();
  (getAdapter as MockedFunction<typeof getAdapter>).mockReset();
  (loadPersistedGraphStrict as MockedFunction<typeof loadPersistedGraphStrict>).mockReset();
  (loadPersistedGraphStrict as MockedFunction<typeof loadPersistedGraphStrict>).mockResolvedValue(
    GRAPH as never,
  );
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue({
    response: {},
    performed: true,
    persisted_row_id: 'row-1',
    graphPersisted: false,
  } as Awaited<ReturnType<typeof commitDirectAnswer>>);
  (getAdapter as MockedFunction<typeof getAdapter>).mockReturnValue(
    adapterComposing(WALK_OPERATIONS) as never,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

/**
 * ⭐ THE PREMISE, MEASURED RATHER THAN ASSUMED (trap 13 / trap 16).
 *
 * Every decline case below is only meaningful if the walk's shape really is
 * splittable when the composer succeeds. If it were not, the decline tests
 * would be measuring an unsplittable request and would pass for the wrong
 * reason. This is the positive control for the whole file.
 */
describe('⭐ CONTROL — the walk`s own shape DOES split when the composer succeeds', () => {
  beforeEach(() => {
    rulebookRefusesOnBudget();
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockImplementationOnce(
      async (_c, _m, _a, _r, _t, opts) => pipelineApplied((opts?.preComposedOperations ?? []) as never),
    );
  });

  it('the fixture is the walk`s measured shape: over the node budget, under the edge budget', () => {
    expect(WALK_NODE_OPS).toBeGreaterThan(MAX_NODE_OPS);
    expect(WALK_EDGE_OPS).toBeLessThanOrEqual(MAX_EDGE_OPS);
  });

  it('a first part reaches the applier, and it is smaller than the whole request', async () => {
    await runWalkTurn();
    const submitted = preComposedCalls();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.length).toBeGreaterThan(0);
    expect(submitted[0]!.length).toBeLessThan(WALK_OPERATIONS.length);
    expect(submitted[0]!.filter((o) => o.op.endsWith('_node')).length).toBeLessThanOrEqual(
      MAX_NODE_OPS,
    );
  });

  it('⭐ the user is told what was NOT looked at, by the identity of the remaining work', async () => {
    const text = (await runWalkTurn()).response.assistant_text ?? '';
    expect(text).toContain('were not looked at on this turn');
    // Bound by identity: the last option's own label, which cannot be in the
    // submitted first part.
    expect(text).toContain('Launch an annual plan discount');
  });

  it('⭐ and the rulebook`s dead end is gone from the turn entirely', async () => {
    const text = (await runWalkTurn()).response.assistant_text ?? '';
    expect(text).not.toContain(rulebookBudgetAnswerText());
    expect(text).not.toMatch(INTERNAL_CAP_LEAK);
  });
});

/**
 * ⭐⭐ THE DEFECT ITSELF — one case per decline class.
 *
 * Each case drives `tryStructuralEditTool` into exactly ONE of its exits, from
 * the same budget-refused rulebook turn. At the tip that shipped the walk,
 * every case except the cap refusal returned `null` and the user was left
 * holding the leaked-limits sentence.
 */
interface DeclineCase {
  readonly name: string;
  /** Which exit of the tool this drives, named for the report. */
  readonly exit: string;
  /**
   * ⭐ THE IDENTITY BINDING. The assertion is not "some honest-looking copy
   * shipped" — a value predicate several sentences would satisfy (CLAUDE.md
   * trap 19). It is "the copy for THIS decline class shipped", looked up in the
   * producer's own table.
   */
  readonly expected: StructuralEditDeclineClass;
  readonly setup: () => void;
}

const DECLINE_CASES: readonly DeclineCase[] = [
  {
    name: 'the graph-management mode is not live, so the tool never runs',
    exit: 'pre-gate: hold_spine_inactive',
    expected: 'capability_unavailable',
    setup: () => {
      vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'shadow');
      _resetConfigCache();
    },
  },
  {
    name: 'the strict persisted read throws, so the tool cannot ground itself',
    exit: 'grounding_read_failed',
    expected: 'model_unreadable',
    setup: () => {
      (loadPersistedGraphStrict as MockedFunction<typeof loadPersistedGraphStrict>).mockRejectedValue(
        new Error('supabase unavailable'),
      );
    },
  },
  {
    name: 'the persisted read returns something no grounding table can be built from',
    exit: 'grounding unbuildable',
    expected: 'model_unreadable',
    setup: () => {
      (loadPersistedGraphStrict as MockedFunction<typeof loadPersistedGraphStrict>).mockResolvedValue(
        null as never,
      );
    },
  },
  {
    name: 'the persisted graph and the edit-context graph disagree',
    exit: 'base_divergence',
    expected: 'model_unreadable',
    setup: () => {
      (loadPersistedGraphStrict as MockedFunction<typeof loadPersistedGraphStrict>).mockResolvedValue(
        {
          nodes: [{ id: 'dec_other', kind: 'decision', label: 'A different model' }],
          edges: [],
        } as never,
      );
    },
  },
  {
    name: 'the adapter cannot make tool calls at all',
    exit: 'unavailable: no_tool_adapter',
    expected: 'compose_unavailable',
    setup: () => {
      (getAdapter as MockedFunction<typeof getAdapter>).mockReturnValue({ name: 'stub' } as never);
    },
  },
  {
    name: 'the composer call fails',
    exit: 'unavailable: call_failed',
    expected: 'compose_unavailable',
    setup: () => {
      (getAdapter as MockedFunction<typeof getAdapter>).mockReturnValue({
        name: 'stub',
        chatWithTools: vi.fn().mockRejectedValue(new Error('upstream timeout')),
      } as never);
    },
  },
  {
    name: 'the model answers in prose and never calls the tool',
    exit: 'unavailable: no_tool_call',
    expected: 'not_expressible',
    setup: () => {
      (getAdapter as MockedFunction<typeof getAdapter>).mockReturnValue({
        name: 'stub',
        chatWithTools: vi
          .fn()
          .mockResolvedValue({ content: [{ type: 'text', text: 'I am not sure what to change.' }] }),
      } as never);
    },
  },
  {
    name: 'the composed batch names a node that is not in the model',
    exit: 'rejected: UNKNOWN_ENTITY_ID',
    expected: 'compose_invalid',
    setup: () => {
      (getAdapter as MockedFunction<typeof getAdapter>).mockReturnValue(
        adapterComposing([
          {
            op: 'add_edge',
            path: 'opt_ghost::goal_mrr',
            value: { from: 'opt_ghost', to: 'goal_mrr' },
          },
        ]) as never,
      );
    },
  },
  {
    name: 'the composed batch is malformed',
    exit: 'rejected: SCHEMA_INVALID',
    expected: 'compose_invalid',
    setup: () => {
      (getAdapter as MockedFunction<typeof getAdapter>).mockReturnValue(
        adapterComposing([{ op: 'not_an_operation', path: 'nowhere' }]) as never,
      );
    },
  },
  {
    name: 'the request is genuinely too large to split',
    exit: 'rejected: BATCH_CAP_EXCEEDED',
    expected: 'too_large_to_split',
    setup: () => {
      (getAdapter as MockedFunction<typeof getAdapter>).mockReturnValue(
        adapterComposing(
          Array.from({ length: 16 }, (_, i) => ({
            op: 'add_node',
            path: `fac_x${i}`,
            value: { id: `fac_x${i}`, kind: 'factor', label: `X${i}` },
          })),
        ) as never,
      );
    },
  },
];

describe('⭐⭐ 2.655 — NO decline of the structural-edit tool resurrects the dead end', () => {
  for (const c of DECLINE_CASES) {
    describe(`${c.exit} — ${c.name}`, () => {
      beforeEach(() => {
        rulebookRefusesOnBudget();
        c.setup();
      });

      it('⭐ the rulebook`s limit-naming answer is NOT what the user is left with', async () => {
        const text = (await runWalkTurn()).response.assistant_text ?? '';
        expect(text).not.toContain(rulebookBudgetAnswerText());
      });

      it('⭐ no internal cap and no operation count reaches the user', async () => {
        const text = (await runWalkTurn()).response.assistant_text ?? '';
        expect(text, `leaked an internal cap: ${text}`).not.toMatch(INTERNAL_CAP_LEAK);
      });

      it('⭐ the user is given a first step they can actually take', async () => {
        const result = await runWalkTurn();
        const text = result.response.assistant_text ?? '';
        expect(text.length).toBeGreaterThan(0);
        // An actionable next step, not "work out the decomposition yourself".
        expect(text).toMatch(/ask me for one part|one part of it|a single option/i);
        // The 2.474-era chip copy that pushed the decomposition back onto the
        // user. Pinned by its exact historical wording so a revert is loud.
        expect(text).not.toContain('Consider breaking this into smaller steps');
      });

      it('⭐⭐ the copy that ships is THIS decline class`s, bound by identity', async () => {
        const result = await runWalkTurn();
        const expected = STRUCTURAL_EDIT_DECLINE_COPY[c.expected];
        expect(result.response.assistant_text ?? '').toContain(expected.text);
        // The chips travel with the sentence, not separately.
        const labels = (result.response.suggested_actions ?? []).map((a) => a.label);
        for (const action of expected.actions) {
          expect(labels).toContain(action.label);
        }
      });

      it('nothing is applied — a decline is still a decline', async () => {
        await runWalkTurn();
        // Bound to the APPLIER, not to a response field: the claim is that no
        // batch reached `handleEditGraph`, which is what "nothing was applied"
        // actually means at this seam.
        expect(preComposedCalls()).toHaveLength(0);
      });
    });
  }
});

/**
 * ⭐ THE DISCRIMINATING CONTROL (trap 13b).
 *
 * "Never the rulebook's answer" must not become "never the rulebook's answer,
 * on any turn". When the rulebook produces a legitimate answer of its own — a
 * clarifying question, not a budget refusal — a declining tool must still leave
 * that answer standing. Without this, replacing every declined turn's copy
 * would pass the whole block above while silently erasing good coaching.
 */
describe('⭐ CONTROL — a NON-budget rulebook answer survives the same decline', () => {
  const CLARIFY_COPY = 'Which of the three options should I start with?';

  beforeEach(() => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValueOnce({
      blocks: [],
      assistantText: CLARIFY_COPY,
      latencyMs: 10,
      appliedGraph: null,
      wasRejected: false,
    });
    (getAdapter as MockedFunction<typeof getAdapter>).mockReturnValue({
      name: 'stub',
      chatWithTools: vi.fn().mockRejectedValue(new Error('upstream timeout')),
    } as never);
  });

  it('the rulebook`s own clarifying question is NOT overwritten by decline copy', async () => {
    const text = (await runWalkTurn()).response.assistant_text ?? '';
    expect(text).toContain(CLARIFY_COPY);
  });
});

/**
 * ⭐⭐ COMPLETENESS — the union assertion (CLAUDE.md trap 12d).
 *
 * The per-class block above proves the exits it drives agree with the copy
 * table. It is structurally incapable of noticing a class NOBODY drives: a
 * derived guard proves agreement and can never prove coverage. This closes that
 * half by asserting the two sets are equal in BOTH directions — a new decline
 * class without a case here, or a case naming a class that no longer exists,
 * both go red.
 */
describe('⭐⭐ every decline class this estate can produce is exercised above', () => {
  it('the cases cover every class in the copy table, and name no class outside it', () => {
    const exercised = new Set(DECLINE_CASES.map((c) => c.expected));
    const declared = new Set(STRUCTURAL_EDIT_DECLINE_CLASSES);
    expect([...declared].filter((k) => !exercised.has(k))).toEqual([]);
    expect([...exercised].filter((k) => !declared.has(k))).toEqual([]);
  });
});

/**
 * ⭐⭐ THE DISCRIMINATING PAIR — the copy binds to the DECLINE CLASS, not to
 * "a decline happened" (CLAUDE.md trap 19's proof obligation).
 *
 * Every assertion above would still pass if one honest sentence were returned
 * for every exit. That would be a real improvement over the dead end and STILL
 * wrong: "I could not read your model" and "I could not work that change out"
 * prescribe different next actions, and telling a user to retry when retrying
 * cannot help is the class of defect this row is about.
 *
 * So the pair: two exits that must produce DIFFERENT sentences, and a third
 * that must produce the SAME one as its sibling. Neither half alone shows the
 * binding — the first could pass on noise, the second on collapse.
 */
describe('⭐⭐ different decline classes say different things, same class says the same thing', () => {
  async function textFor(setup: () => void): Promise<string> {
    rulebookRefusesOnBudget();
    setup();
    return (await runWalkTurn()).response.assistant_text ?? '';
  }

  const caseFor = (exit: string): DeclineCase => {
    const found = DECLINE_CASES.find((c) => c.exit === exit);
    if (found === undefined) throw new Error(`no decline case for exit ${exit}`);
    return found;
  };

  it('⭐ DIFFERENT: an unreadable model and a failed composition do not share a sentence', async () => {
    const unreadable = await textFor(caseFor('grounding_read_failed').setup);
    vi.clearAllMocks();
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockReset();
    (loadPersistedGraphStrict as MockedFunction<typeof loadPersistedGraphStrict>).mockReset();
    (loadPersistedGraphStrict as MockedFunction<typeof loadPersistedGraphStrict>).mockResolvedValue(
      GRAPH as never,
    );
    const composeFailed = await textFor(caseFor('unavailable: call_failed').setup);
    expect(unreadable.length).toBeGreaterThan(0);
    expect(composeFailed.length).toBeGreaterThan(0);
    expect(unreadable).not.toBe(composeFailed);
    expect(unreadable).toContain('could not read your current model');
    expect(composeFailed).toContain('could not work that change out');
  });

  it('⭐ SAME: two exits of the same class share their sentence exactly', async () => {
    const readThrew = await textFor(caseFor('grounding_read_failed').setup);
    vi.clearAllMocks();
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockReset();
    (loadPersistedGraphStrict as MockedFunction<typeof loadPersistedGraphStrict>).mockReset();
    const diverged = await textFor(caseFor('base_divergence').setup);
    expect(readThrew).toBe(diverged);
  });
});

/**
 * ⭐ THE DECLINE COPY IS SWEPT BY THE ESTATE'S OWN GUARDS.
 *
 * Derived over the whole table, so a seventh class is swept the day it is
 * added rather than the day someone remembers.
 */
describe('the decline copy passes the estate`s user-facing copy guards', () => {
  const surfaces = STRUCTURAL_EDIT_DECLINE_CLASSES.flatMap((k) => [
    STRUCTURAL_EDIT_DECLINE_COPY[k].text,
    ...STRUCTURAL_EDIT_DECLINE_COPY[k].actions.flatMap((a) => [a.label, a.prompt]),
  ]);

  it('no denial-of-change phrase, no success claim, no em dash', () => {
    expect(surfaces.length).toBeGreaterThan(0);
    for (const text of surfaces) {
      for (const re of FORBIDDEN_USER_FACING_PHRASES) {
        expect(re.test(text), `${re} matched: ${text}`).toBe(false);
      }
      for (const re of SUCCESS_CLAIM_PATTERNS) {
        expect(re.test(text), `${re} matched: ${text}`).toBe(false);
      }
      expect(text).not.toContain('—');
    }
  });

  it('names no cap, no count, no operation token and no internal id', () => {
    for (const text of surfaces) {
      expect(text).not.toMatch(INTERNAL_CAP_LEAK);
      for (const token of ['add_node', 'add_edge', 'envelope', 'PROPOSAL_CAP', 'batch']) {
        expect(text.toLowerCase()).not.toContain(token.toLowerCase());
      }
    }
  });

  it('every class names a first step the user can take', () => {
    for (const k of STRUCTURAL_EDIT_DECLINE_CLASSES) {
      const answer = STRUCTURAL_EDIT_DECLINE_COPY[k];
      expect(answer.text, k).toMatch(/ask me for one part|Ask me for one part/i);
      expect(answer.actions.length, k).toBeGreaterThan(0);
    }
  });
});
