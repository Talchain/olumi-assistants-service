/**
 * ROADMAP 2.474 / A3 — THE WIRING THAT MAKES THE SPLIT REAL.
 *
 * The pure seams are proved elsewhere (`structural-edit-batch-split.test.ts`,
 * `structural-edit-split-disclosure.test.ts`). What is proved HERE is the one
 * line that decides whether any of it reaches a user: WHICH operations the
 * dispatcher hands to `handleEditGraph`.
 *
 * ⚠ THE MUTANT THIS EXISTS FOR. Submit `outcome.operations` (the whole batch)
 * instead of `parts[0].operations` and every pure test above stays green while
 * the live behaviour is EXACTLY the witnessed defect: 12 edge operations meet
 * the 8-edge budget inside the pipeline and the composed batch is discarded
 * again. Without this file that mutant survives.
 *
 * It is also where "splitting is not disclosed-partial" becomes checkable at
 * the seam that matters: the assertion is that the remainder appears in NO
 * call to `handleEditGraph` at all — not that it was described nicely.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
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
    // Mockable so ONE test can inject a prior run_analysis fact. Every other
    // test restores the real implementation in `beforeEach`.
    buildTurnContext: vi.fn(),
  };
});

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { getAdapter } from '../../../adapters/llm/router.js';
import { loadPersistedGraphStrict, buildTurnContext } from '../../build-turn-context.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { staleAnalysisBlocksApply } from '../../graph-management/frame-gate.js';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import {
  STRUCTURAL_EDIT_TOO_LARGE_TEXT,
  STRUCTURAL_EDIT_TOO_LARGE_ACTIONS,
} from '../structural-edit-split-disclosure.js';
import {
  FORBIDDEN_USER_FACING_PHRASES,
  SUCCESS_CLAIM_PATTERNS,
} from '../../compose/forbidden-user-facing-phrases.js';

/**
 * ⚠ ROADMAP 2.713 — a CAUSAL link create must carry the belief the apply
 * contract has required since February (`strength.{mean,std}`,
 * `exists_probability`, `effect_direction`). The reconstructed fixtures here
 * carried only `{from,to}`, and separately supplied a `value.id` the deployed
 * advert makes structurally impossible — so they were unfaithful to the wire in
 * both directions and could not see the seam defect. Identity now arrives by
 * server-side synthesis from the authoritative `path`; the belief is stated,
 * because the composer refuses a link the model did not describe rather than
 * inventing one. Neither change alters an envelope count.
 */
const CAUSAL_BELIEF = {
  strength: { mean: 0.4, std: 0.15 },
  exists_probability: 0.8,
  effect_direction: 'positive',
} as const;


const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

/** Four existing nodes, so each new driver can be wired to four of them. */
const GRAPH = {
  nodes: [
    { id: 'dec_plan', kind: 'decision', label: 'Which plan' },
    { id: 'goal_profit', kind: 'goal', label: 'Profit' },
    { id: 'fac_spend', kind: 'factor', label: 'Marketing spend' },
    { id: 'fac_reach', kind: 'factor', label: 'Audience reach' },
  ],
  edges: [{ from: 'dec_plan', to: 'goal_profit' }],
};

const DRIVERS = [
  { id: 'fac_driver_a', label: 'Plan A cost driver' },
  { id: 'fac_driver_b', label: 'Plan B cost driver' },
  { id: 'fac_driver_c', label: 'Shared overhead driver' },
];
const TARGETS = ['goal_profit', 'fac_spend', 'fac_reach', 'dec_plan'];

/** PROBE C: 3 add_node + 12 add_edge, exactly as witnessed. */
const PROBE_C_OPERATIONS = DRIVERS.flatMap((d) => [
  { op: 'add_node', path: d.id, value: { kind: 'factor', label: d.label } },
  ...TARGETS.map((t) => ({ op: 'add_edge', path: `${d.id}::${t}`, value: { from: d.id, to: t, ...CAUSAL_BELIEF } })),
]);

/** PROBE D: six operations, under every cap — the positive control. */
const PROBE_D_OPERATIONS = [
  ...DRIVERS.map((d) => ({
    op: 'add_node',
    path: d.id,
    value: { kind: 'factor', label: d.label },
  })),
  ...DRIVERS.map((d) => ({
    op: 'add_edge',
    path: `${d.id}::goal_profit`,
    value: { from: d.id, to: 'goal_profit', ...CAUSAL_BELIEF },
  })),
];

function adapterComposing(operations: unknown[]) {
  return {
    name: 'stub',
    chatWithTools: vi.fn().mockResolvedValue({
      content: [
        { type: 'tool_use', name: 'propose_structural_edit', input: { operations } },
      ],
    }),
  };
}

/** The rulebook did NOT claim the turn — the measured dead-end shape. */
function rulebookDeadEnd(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'I could not work out which part of the model to change.',
    latencyMs: 10,
    appliedGraph: null,
    wasRejected: false,
  };
}

/**
 * The pipeline's result for the submitted part.
 *
 * ⚠ This must be a SUCCESSFUL APPLIED MUTATION shape (`!wasRejected` +
 * `appliedGraph` + non-empty `operations`), because that is the guard on the
 * Graph Management referee gate. With the earlier `appliedGraph: null` fixture
 * the gate never ran, `gmDecision` stayed null, and no test in this file could
 * see the hold, the disclosure, or the chip — which is exactly how the
 * user-visible half of this feature went unpinned.
 */
function pipelineApplied(operations: readonly { op: string; path: string; value?: unknown }[]): EditGraphResult {
  const created = operations.filter((o) => o.op === 'add_node');
  const linked = operations.filter((o) => o.op === 'add_edge');
  return {
    blocks: [],
    assistantText: 'Holding these changes.',
    latencyMs: 20,
    appliedGraph: {
      nodes: [
        ...GRAPH.nodes,
        ...created.map((o) => ({ id: o.path, kind: 'factor', label: `Driver ${o.path}` })),
      ],
      edges: [
        ...GRAPH.edges,
        ...linked.map((o) => ({ ...(o.value as { from: string; to: string }) })),
      ],
    } as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: operations as EditGraphResult['operations'],
  };
}

/** A successful prior analysis, taken against a NAMED graph hash. */
function runAnalysisFact(graphHashAtRun: string): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      graph_hash_at_run: graphHashAtRun,
      enrichment: {},
    },
  };
}

function opKeys(ops: readonly { op: string; path: string }[]): string[] {
  return ops.map((o) => `${o.op}:${o.path}`);
}

/** Every call to handleEditGraph that carried a pre-composed batch. */
function preComposedCalls(): { op: string; path: string }[][] {
  const mock = handleEditGraph as MockedFunction<typeof handleEditGraph>;
  return mock.mock.calls
    .map((c) => c[5]?.preComposedOperations)
    .filter((o): o is NonNullable<typeof o> => o !== undefined)
    .map((o) => [...o] as { op: string; path: string }[]);
}

async function runTurn() {
  return dispatchEditGraph({
    payload: {
      kind: 'message' as const,
      scenario_id: SCENARIO_ID,
      turn_id: TURN_ID,
      stage: 'analyse' as const,
      message: 'give each option its own driver',
      turn_class: 'frame' as const,
      source: 'composer' as const,
    },
    requestId: 'req-2474-split',
    request: STUB_REQUEST,
    graphState: GRAPH as unknown as GraphStateIngress,
    analysisState: null,
  });
}

let realBuildTurnContext: typeof buildTurnContext;

beforeEach(async () => {
  vi.clearAllMocks();
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  realBuildTurnContext = actual.buildTurnContext;
  (buildTurnContext as MockedFunction<typeof buildTurnContext>)
    .mockImplementation(realBuildTurnContext);
  (loadPersistedGraphStrict as MockedFunction<typeof loadPersistedGraphStrict>)
    .mockResolvedValue(GRAPH as never);
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue({
    response: {},
    performed: true,
    persisted_row_id: 'row-1',
    graphPersisted: false,
  } as Awaited<ReturnType<typeof commitDirectAnswer>>);
});

describe('⭐ A3 — an over-cap request submits ONE part and never the whole batch', () => {
  beforeEach(() => {
    (getAdapter as MockedFunction<typeof getAdapter>)
      .mockReturnValue(adapterComposing(PROBE_C_OPERATIONS) as never);
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValueOnce(rulebookDeadEnd())
      .mockImplementationOnce(async (_c, _m, _a, _r, _t, opts) =>
        pipelineApplied((opts?.preComposedOperations ?? []) as never),
      );
  });

  it('the pipeline is handed a batch SMALLER than the one the model composed', async () => {
    await runTurn();
    const submitted = preComposedCalls();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.length).toBeGreaterThan(0);
    expect(submitted[0]!.length).toBeLessThan(PROBE_C_OPERATIONS.length);
  });

  it('the submitted batch is within the EDGE BUDGET that killed probe C live', async () => {
    await runTurn();
    const edgeOps = preComposedCalls()[0]!.filter((o) => o.op.endsWith('_edge'));
    // The witnessed rejection was 12 edge operations against a limit of 8.
    expect(edgeOps.length).toBeLessThanOrEqual(8);
  });

  it('the submitted batch is exactly ONE driver and its links — bound by id', async () => {
    await runTurn();
    const keys = opKeys(preComposedCalls()[0]!);
    expect(keys).toEqual([
      'add_node:fac_driver_a',
      ...TARGETS.map((t) => `add_edge:fac_driver_a::${t}`),
    ]);
  });

  it('⭐ NOT ONE operation of the remainder reaches the pipeline (not disclosed-partial)', async () => {
    await runTurn();
    const submittedKeys = new Set(preComposedCalls().flatMap((ops) => opKeys(ops)));
    const remainder = PROBE_C_OPERATIONS.filter(
      (o) => !submittedKeys.has(`${o.op}:${o.path}`),
    );
    expect(remainder.length).toBeGreaterThan(0);
    // Bound by identity: drivers B and C, and every one of their links, were
    // never handed to the applier at all.
    for (const op of remainder) {
      expect(op.path.startsWith('fac_driver_a')).toBe(false);
    }
    expect(submittedKeys.size).toBe(1 + TARGETS.length);
  });
});

describe('⭐ POSITIVE CONTROL (trap 13) — a normal request submits the WHOLE batch, unchanged', () => {
  beforeEach(() => {
    (getAdapter as MockedFunction<typeof getAdapter>)
      .mockReturnValue(adapterComposing(PROBE_D_OPERATIONS) as never);
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValueOnce(rulebookDeadEnd())
      .mockImplementationOnce(async (_c, _m, _a, _r, _t, opts) =>
        pipelineApplied((opts?.preComposedOperations ?? []) as never),
      );
  });

  it('probe D`s six operations are submitted in full, in the order the model composed them', async () => {
    await runTurn();
    const submitted = preComposedCalls();
    expect(submitted).toHaveLength(1);
    // Order matters here: this is the assertion that caught the splitter
    // reordering the ordinary path, which the live witness had already proved
    // sound and which nothing asked to change.
    expect(opKeys(submitted[0]!)).toEqual(
      opKeys(PROBE_D_OPERATIONS as { op: string; path: string }[]),
    );
  });
});

/**
 * ⭐⭐ THE CLAIM/SUPPRESS PATH — the limb an external review found.
 *
 * "The tool can request splitting, but the failed operation can CLAIM THE TURN
 * and SUPPRESS FALLBACK." Derived at the bytes and it is real, though not where
 * the entry gate is: `rulebookClaimedTurn` correctly returns false for a
 * rejection, so the tool DOES get the same turn. The suppression is one step
 * later — on a cap rejection the tool returned `null`, which means "the
 * rulebook's own answer stands", and the rulebook's answer is the copy that
 * could not explain itself ("limit: 4 node ops, 8 edge ops"). The failed
 * rulebook operation supplied the final text and the tool's honest reason never
 * reached the user.
 *
 * Splitting removes the dominant instance. This pins the residue: when a
 * request genuinely cannot be split, the turn is answered ACTIONABLY and the
 * rulebook's dead-end copy is NOT what ships.
 */
describe('⭐⭐ a cap refusal is ACTIONABLE and does not fall back to the rulebook`s dead end', () => {
  /** Over the pipeline operation cap (15) — the one guard that still refuses. */
  const UNSPLITTABLE = Array.from({ length: 16 }, (_, i) => ({
    op: 'add_node',
    path: `fac_x${i}`,
    value: { kind: 'factor', label: `X${i}` },
  }));

  const RULEBOOK_DEAD_END_COPY =
    'I tried to make that change, but it would require 3 node operations and 12 edge operations';

  beforeEach(() => {
    (getAdapter as MockedFunction<typeof getAdapter>)
      .mockReturnValue(adapterComposing(UNSPLITTABLE) as never);
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValueOnce({
      blocks: [],
      assistantText: RULEBOOK_DEAD_END_COPY,
      latencyMs: 10,
      appliedGraph: null,
      wasRejected: true,
    });
  });

  it('nothing is submitted to the applier — the refusal is a refusal', async () => {
    await runTurn();
    expect(preComposedCalls()).toHaveLength(0);
  });

  it('the rulebook`s limit-naming copy is NOT what the user is left with', async () => {
    const result = await runTurn();
    expect(result.response.assistant_text).not.toContain(RULEBOOK_DEAD_END_COPY);
    expect(result.response.assistant_text).not.toContain('node operations');
  });

  it('the user is told what happened and given a smaller ask that will work', async () => {
    const result = await runTurn();
    const text = result.response.assistant_text ?? '';
    expect(text).toContain('bigger change than I can put to you in one go');
    expect(text).toContain('single option');
    const labels = (result.response.suggested_actions ?? []).map((a) => a.label);
    expect(labels).toContain('Do one option at a time');
  });
});

describe('the honest refusal copy is swept by the estate`s own guards', () => {
  const surfaces = [
    STRUCTURAL_EDIT_TOO_LARGE_TEXT,
    ...STRUCTURAL_EDIT_TOO_LARGE_ACTIONS.flatMap((a) => [a.label, a.prompt]),
  ];

  it('no denial-of-change phrase, no success claim, no em dash', () => {
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

  it('names no cap, no operation token and no internal id', () => {
    for (const text of surfaces) {
      for (const token of ['add_node', 'add_edge', 'envelope', 'PROPOSAL_CAP', 'batch']) {
        expect(text.toLowerCase()).not.toContain(token.toLowerCase());
      }
    }
  });
});

/**
 * ⭐⭐ THE USER-VISIBLE HALF, PINNED AT DISPATCH LEVEL.
 *
 * ⚠ WHY THIS BLOCK EXISTS. A reviewer DELETED the entire
 * `if (structuralEditSplit !== null) {…}` emission block from
 * `edit-graph-dispatch.ts` and every spec for this feature stayed GREEN — the
 * only non-test consumer of the disclosure builder was that one call site, and
 * every test hit was the pure builder's own spec. The notice and the chip, the
 * half a user actually reads, were unpinned.
 *
 * The acceptance criterion for these tests is therefore stated as a mutant:
 * DELETE THE EMISSION BLOCK AND THESE MUST GO RED.
 */
describe('⭐⭐ the split disclosure REACHES THE RESPONSE (delete the emission block and this REDs)', () => {
  beforeEach(() => {
    (getAdapter as MockedFunction<typeof getAdapter>)
      .mockReturnValue(adapterComposing(PROBE_C_OPERATIONS) as never);
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValueOnce(rulebookDeadEnd())
      .mockImplementationOnce(async (_c, _m, _a, _r, _t, opts) =>
        pipelineApplied((opts?.preComposedOperations ?? []) as never),
      );
  });

  it('the turn actually holds a proposal — the precondition, measured not assumed', async () => {
    const result = await runTurn();
    const ids = (result.response.suggested_actions ?? []).map((a) => a.id);
    // A gate-minted confirm chip exists, so there IS a step 1 to follow.
    expect(ids.some((id) => id.startsWith('gmh_'))).toBe(true);
  });

  it('the assistant text carries the scope notice, naming the remaining drivers', async () => {
    const text = (await runTurn()).response.assistant_text ?? '';
    expect(text).toContain('larger change than I can work through in one go');
    expect(text).toContain('3 steps');
    expect(text).toContain('were not looked at on this turn');
    expect(text).toContain('Plan B cost driver');
    expect(text).toContain('Shared overhead driver');
  });

  it('and a next-step chip is offered alongside the confirm chip', async () => {
    const actions = (await runTurn()).response.suggested_actions ?? [];
    const next = actions.find((a) => a.id === 'structural_edit_next_step');
    expect(next).toBeDefined();
    expect(next!.label).toBe('Propose the next step');
    // The confirm chip is NOT displaced by it.
    expect(actions.some((a) => a.id.startsWith('gmh_'))).toBe(true);
  });
});

/**
 * ⭐⭐ ROADMAP 2.620 — SCOPE SURVIVES REFUSAL; CONTINUATION DOES NOT.
 *
 * This describe has now caught the SAME seam failing in BOTH directions, and
 * both failures are pinned here because either one alone reads as correct.
 *
 *   Direction 1 (the original defect) — nothing was gated. With part 1
 *   rejected the user received "I couldn't take that change forward, so the
 *   model is unchanged" immediately followed by "this is the first [of 3
 *   steps]", plus a chip for step 2 of a sequence with no step 1. Two
 *   contradictory sentences on one turn.
 *
 *   Direction 2 (the fix's own defect, ROADMAP 2.620) — EVERYTHING was gated,
 *   on one condition. The turn became coherent and SILENT: the user read the
 *   refusal and was never told that 8 of their 12 operations had not been
 *   submitted at all. A test in this very file PINNED that silence as
 *   intended (`expect(text).not.toContain('Still to come')`).
 *
 * Direction 2 is the worse of the two — silent truncation at the only place
 * the user can see it, against this feature's own doctrine ("disclosure, NEVER
 * silent truncation") and against the sibling unmapped-part notice at this
 * exact seam, which is deliberately NOT gated on `wasRejected` for the same
 * reason. The two assertions below are therefore a PAIR: neither is safe to
 * keep without the other.
 */
describe('⭐⭐ a REFUSED part 1 — the user is still told what was never submitted', () => {
  beforeEach(() => {
    (getAdapter as MockedFunction<typeof getAdapter>)
      .mockReturnValue(adapterComposing(PROBE_C_OPERATIONS) as never);
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValueOnce(rulebookDeadEnd())
      .mockResolvedValueOnce({
        blocks: [],
        assistantText: "I couldn't take that change forward, so the model is unchanged.",
        latencyMs: 20,
        appliedGraph: null,
        wasRejected: true,
      });
  });

  it('⭐⭐ SCOPE SURVIVES: the refusal stands AND the unsubmitted work is named', async () => {
    const result = await runTurn();
    const text = result.response.assistant_text ?? '';
    // The refusal is not overwritten.
    expect(text).toContain("couldn't take that change forward");
    // And the scope is disclosed anyway — by IDENTITY of the operations that
    // never reached the gate, not merely by the sentence being present.
    expect(text).toContain('Still to come');
    expect(text).toContain('Plan B cost driver');
    expect(text).toContain('Shared overhead driver');
    expect(text).toContain('were not looked at on this turn');
  });

  it('⭐ and the scope notice claims NOTHING about a proposal that never happened', async () => {
    // The other half of the pair. Without this, "scope survives" could be
    // satisfied by restoring the original contradictory sentence.
    const text = (await runTurn()).response.assistant_text ?? '';
    expect(text).not.toContain('this is the first');
    expect(text).not.toContain('Confirm this step first');
    expect(text).not.toContain('already analysed this model');
  });

  it('⭐ CONTINUATION IS WITHHELD: no step-2 chip for a sequence that has no step 1', async () => {
    const ids = ((await runTurn()).response.suggested_actions ?? []).map((a) => a.id);
    expect(ids).not.toContain('structural_edit_next_step');
    expect(ids).not.toContain('chip_action_rerun_analysis');
  });
});

/**
 * ⭐ THE POSITIVE CONTROL FOR THE PAIR ABOVE (trap 13b).
 *
 * "Scope survives refusal" and "continuation is withheld" are both satisfiable
 * by a seam that emits the scope notice and NEVER emits a continuation. This
 * asserts the continuation does arrive on the outcome that licenses it, on the
 * same fixture family, so neither assertion above can pass vacuously.
 *
 * (The held case's full copy and chip are asserted in the first describe of
 * this file; what is added here is the CONTRAST with the refusal above.)
 */
describe('⭐ CONTROL — the same split on a HELD turn does offer the continuation', () => {
  beforeEach(() => {
    (getAdapter as MockedFunction<typeof getAdapter>)
      .mockReturnValue(adapterComposing(PROBE_C_OPERATIONS) as never);
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValueOnce(rulebookDeadEnd())
      .mockImplementationOnce(async (_c, _m, _a, _r, _t, opts) =>
        pipelineApplied((opts?.preComposedOperations ?? []) as never),
      );
  });

  it('scope AND continuation, where the refused turn gets scope only', async () => {
    const result = await runTurn();
    const text = result.response.assistant_text ?? '';
    const ids = (result.response.suggested_actions ?? []).map((a) => a.id);
    expect(text).toContain('Still to come');
    expect(ids).toContain('structural_edit_next_step');
  });
});

/**
 * ⭐⭐ FINDING 1 — AUTO-RETIRED BY RULING A4 (Paul, 2026-08-05), WHICH IS
 * EXACTLY WHAT #829's DERIVATION WAS BUILT FOR.
 *
 * The finding was real and the fix was right: on an already-analysed scenario,
 * applying part 1 moved the graph hash, freshness flipped to `stale`, and a
 * STRUCTURAL candidate did not trust `stale` — so the next part was blocked
 * and the honest copy said "confirm, re-run, then the rest".
 *
 * A4 removed the block itself. `rerunRequiredBeforeNextStep` is DERIVED from
 * the frame gate (`staleAnalysisBlocksApply`), never restated, so the moment
 * the ruling moved the trust set this copy retired on its own — no stale
 * sentence left behind, no lane needed to remember. The pins below therefore
 * flip from "the re-run chip is offered" to "the next step is offered", and
 * the assertion that MATTERS now is that the promise is DELIVERABLE: the next
 * step really can be proposed immediately, because the gate no longer refuses
 * it.
 *
 * ⚠ SCOPE, unchanged: the fact is INJECTED, so this pins the CONSUMER. It does
 * not prove the loader delivers that fact on a post-apply turn.
 */
describe('⭐⭐ an already-analysed scenario can continue straight to the next step (A4)', () => {
  beforeEach(async () => {
    (getAdapter as MockedFunction<typeof getAdapter>)
      .mockReturnValue(adapterComposing(PROBE_C_OPERATIONS) as never);
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValueOnce(rulebookDeadEnd())
      .mockImplementationOnce(async (_c, _m, _a, _r, _t, opts) =>
        pipelineApplied((opts?.preComposedOperations ?? []) as never),
      );
    // The fact's hash MATCHES the current graph, so freshness is `fresh` and
    // part 1 still holds — the honest shape of "analysed, not yet edited".
    const hash = computeAnalysisAffectingGraphHash(GRAPH as never)!;
    (buildTurnContext as MockedFunction<typeof buildTurnContext>).mockImplementation(
      async (...args) => {
        const ctx = await realBuildTurnContext(...(args as Parameters<typeof buildTurnContext>));
        return { ...ctx, prior_facts: [runAnalysisFact(hash)] };
      },
    );
  });

  it('part 1 still holds — the prior analysis does not block the FIRST step', async () => {
    const ids = ((await runTurn()).response.suggested_actions ?? []).map((a) => a.id);
    expect(ids.some((id) => id.startsWith('gmh_'))).toBe(true);
  });

  it('A4: the copy no longer interposes a re-run, and still names every remaining operation', async () => {
    const text = (await runTurn()).response.assistant_text ?? '';
    expect(text).not.toContain('already analysed this model');
    expect(text).not.toContain('Re-run the analysis after confirming');
    expect(text).toContain('Plan B cost driver');
  });

  it('⭐ A4: the chip offered is the NEXT STEP, and it is now a promise the gate will keep', async () => {
    const actions = (await runTurn()).response.suggested_actions ?? [];
    const next = actions.find((a) => a.id === 'structural_edit_next_step');
    expect(next).toBeDefined();
    expect(next!.label).toBe('Propose the next step');
    // The remainder is still carried behind the short label.
    expect((next as { detail?: string }).detail).toContain('Shared overhead driver');
    // The re-run chip is gone from the SPLIT disclosure (it is unchanged on
    // the applied receipt, which is where a real staleness cue belongs).
    expect(actions.map((a) => a.id)).not.toContain('chip_action_rerun_analysis');
  });

  /**
   * ⭐ THE DELIVERABILITY PROOF — the assertion the old pin could not make.
   *
   * The re-run copy existed because the next step genuinely could not be
   * proposed. Offering "Propose the next step" is only honest if the gate
   * would now hold that step rather than refuse it. Asked of the gate itself,
   * for the same class and the same post-apply frame state.
   */
  it('⭐ the promise is DELIVERABLE: a stale frame no longer blocks a structural apply', () => {
    expect(staleAnalysisBlocksApply()).toBe(false);
  });
});

/**
 * ⚠⚠ THE KNOWN RESIDUAL — NOW WITHOUT A VISIBLE CONSEQUENCE ON THIS COPY, AND
 * SAID THAT WAY RATHER THAN DELETED.
 *
 * The residual is unchanged and still real: `priorAnalysisExistsForSplit` reads
 * `turnContext.prior_facts`, a WINDOW over the 20 most recent turn rows, so an
 * analysis older than the window is invisible. Its live witness is recorded on
 * `TurnContext.newest_analysis_fact` in `build-turn-context.ts` (scenario
 * `f63ccb45-…`: `false` at rank 20, `true` at rank 21, zero store change).
 *
 * ⭐ WHAT RULING A4 CHANGED: the residual fed a conjunction
 * (`priorAnalysisExistsForSplit && staleAnalysisBlocksApply()`) whose SECOND
 * term is now always false, so the window's blindness can no longer change what
 * the user is told. The old discriminator pair below therefore stops
 * discriminating — and that is stated here, in the test names, rather than
 * being left as a pair that silently agrees with itself (trap 13b's third face:
 * a guard whose discriminating power quietly disappeared).
 */
describe('⚠ KNOWN RESIDUAL — the 20-turn window is still blind, and now has no effect on this copy', () => {
  beforeEach(() => {
    (getAdapter as MockedFunction<typeof getAdapter>)
      .mockReturnValue(adapterComposing(PROBE_C_OPERATIONS) as never);
    (handleEditGraph as MockedFunction<typeof handleEditGraph>)
      .mockResolvedValueOnce(rulebookDeadEnd())
      .mockImplementationOnce(async (_c, _m, _a, _r, _t, opts) =>
        pipelineApplied((opts?.preComposedOperations ?? []) as never),
      );
    // An analysed scenario whose analysis fact has aged out of the window:
    // `prior_facts` empty, exactly as the loader would return it.
    (buildTurnContext as MockedFunction<typeof buildTurnContext>).mockImplementation(
      async (...args) => {
        const ctx = await realBuildTurnContext(...(args as Parameters<typeof buildTurnContext>));
        return { ...ctx, prior_facts: [] };
      },
    );
  });

  it('the fact is invisible to the window → the next-step copy is used', async () => {
    const result = await runTurn();
    const ids = (result.response.suggested_actions ?? []).map((a) => a.id);
    expect(ids).toContain('structural_edit_next_step');
    expect(result.response.assistant_text ?? '').not.toContain('already analysed this model');
  });

  it('⭐ A4: the SAME turn with the fact INSIDE the window is told the SAME thing — the window no longer matters here', async () => {
    // The old version of this test was the discriminator that proved the
    // residual was the WINDOW and not a broken derivation. After A4 the two
    // sides are identical BY DESIGN, and pretending otherwise would be a guard
    // agreeing with itself. What is asserted instead: the outcomes MATCH, so a
    // future change that re-introduces a window-dependent divergence here goes
    // RED rather than passing quietly.
    const withoutFact = ((await runTurn()).response.suggested_actions ?? []).map((a) => a.id);
    const hash = computeAnalysisAffectingGraphHash(GRAPH as never)!;
    (buildTurnContext as MockedFunction<typeof buildTurnContext>).mockImplementation(
      async (...args) => {
        const ctx = await realBuildTurnContext(...(args as Parameters<typeof buildTurnContext>));
        return { ...ctx, prior_facts: [runAnalysisFact(hash)] };
      },
    );
    const withFact = ((await runTurn()).response.suggested_actions ?? []).map((a) => a.id);
    expect(withFact).toEqual(withoutFact);
    expect(withFact).toContain('structural_edit_next_step');
    expect(withFact).not.toContain('chip_action_rerun_analysis');
  });
});
