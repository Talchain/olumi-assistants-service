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
  };
});

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { getAdapter } from '../../../adapters/llm/router.js';
import { loadPersistedGraphStrict } from '../../build-turn-context.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

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
  { op: 'add_node', path: d.id, value: { id: d.id, kind: 'factor', label: d.label } },
  ...TARGETS.map((t) => ({ op: 'add_edge', path: `${d.id}::${t}`, value: { from: d.id, to: t } })),
]);

/** PROBE D: six operations, under every cap — the positive control. */
const PROBE_D_OPERATIONS = [
  ...DRIVERS.map((d) => ({
    op: 'add_node',
    path: d.id,
    value: { id: d.id, kind: 'factor', label: d.label },
  })),
  ...DRIVERS.map((d) => ({
    op: 'add_edge',
    path: `${d.id}::goal_profit`,
    value: { from: d.id, to: 'goal_profit' },
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

/** Whatever the pipeline returns for the submitted part; irrelevant to the
 *  assertions, which are about what it was GIVEN. */
function pipelineHeld(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Holding these changes.',
    latencyMs: 20,
    appliedGraph: null,
    wasRejected: false,
    operations: [],
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

beforeEach(() => {
  vi.clearAllMocks();
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
      .mockResolvedValueOnce(pipelineHeld());
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
      .mockResolvedValueOnce(pipelineHeld());
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
