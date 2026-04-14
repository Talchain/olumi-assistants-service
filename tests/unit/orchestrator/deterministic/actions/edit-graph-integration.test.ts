/**
 * V4 edit_graph integration test — proves:
 *   1. edit_graph is registered in ACTION_CATALOGUE
 *   2. edit_graph is eligible in ideate stage for a graph with options
 *   3. The action dispatch returns an ActionResult whose operations lift
 *      correctly from a graph_patch block produced by the V2 handler
 *
 * V2 handleEditGraph is mocked to return a synthetic GraphPatchBlock with
 * one add_edge operation between two existing nodes — the simplest possible
 * structural edit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

vi.mock("../../../../../src/orchestrator/tools/edit-graph.js", () => ({
  handleEditGraph: vi.fn(),
}));

vi.mock("../../../../../src/orchestrator/plot-client.js", () => ({
  createPLoTClient: vi.fn(() => null),
}));

vi.mock("../../../../../src/adapters/llm/router.js", () => ({
  getAdapter: vi.fn(() => ({
    name: 'anthropic',
    model: 'claude-test',
    chat: vi.fn(),
  })),
}));

vi.mock("../../../../../src/orchestrator/guidance/post-draft.js", () => ({
  generatePostDraftGuidance: vi.fn(() => []),
}));

import { ACTION_CATALOGUE } from "../../../../../src/orchestrator/deterministic/actions/registry.js";
import { editGraphAction } from "../../../../../src/orchestrator/deterministic/actions/edit-graph.js";
import { computeTurnContext } from "../../../../../src/orchestrator/deterministic/turn-context.js";
import { handleEditGraph } from "../../../../../src/orchestrator/tools/edit-graph.js";
import type { DeterministicTurnContext } from "../../../../../src/orchestrator/deterministic/types.js";
import type { OrchestratorTurnRequest, GraphPatchBlockData, TypedConversationBlock } from "../../../../../src/orchestrator/types.js";
import type { GraphV3T } from "../../../../../src/schemas/cee-v3.js";

const handleEditGraphMock = vi.mocked(handleEditGraph);

beforeEach(() => {
  handleEditGraphMock.mockReset();
});

function makeGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_g', kind: 'goal', label: 'Goal' },
      { id: 'opt_a', kind: 'option', label: 'A' },
      { id: 'fac_x', kind: 'factor', label: 'X', category: 'external' },
    ],
    edges: [
      { from: 'opt_a', to: 'goal_g', strength: { mean: 0.5, std: 0.1 } },
    ],
  } as unknown as GraphV3T;
}

function makeContext(): DeterministicTurnContext {
  const graph = makeGraph();
  const turnRequest: OrchestratorTurnRequest = {
    turn_id: 'tu-test',
    scenario_id: 'sc-test',
    message: 'connect fac_x to opt_a',
    context: {
      graph,
      analysis_response: null,
      framing: { stage: 'ideate' },
      messages: [{ role: 'user', content: 'connect fac_x to opt_a' }],
      scenario_id: 'sc-test',
    },
  } as unknown as OrchestratorTurnRequest;
  const ctx = computeTurnContext(turnRequest);
  ctx.turn_id = 'tu-test';
  return ctx;
}

describe("edit_graph V4 integration", () => {
  it("is registered in ACTION_CATALOGUE", () => {
    expect(ACTION_CATALOGUE.has('edit_graph' as never)).toBe(true);
    expect(ACTION_CATALOGUE.get('edit_graph' as never)).toBe(editGraphAction);
  });

  it("is eligible in ideate when a usable graph + option exist", () => {
    const ctx = makeContext();
    expect(ctx.stage).toBe('ideate');
    expect(ctx.eligible_actions).toContain('edit_graph');
  });

  it("messages field is threaded through computeTurnContext", () => {
    const ctx = makeContext();
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0]?.content).toBe('connect fac_x to opt_a');
  });

  it("returns ActionResult with operations lifted from graph_patch block", async () => {
    const graph = makeGraph();
    const patchData: GraphPatchBlockData = {
      patch_type: 'edit',
      status: 'proposed',
      operations: [
        {
          op: 'add_edge',
          path: 'fac_x->opt_a',
          value: { from: 'fac_x', to: 'opt_a', strength: { mean: 0.5, std: 0.1 } },
        },
      ],
      applied_graph_hash: 'abc123',
      auto_apply: false,
    };
    const block: TypedConversationBlock = {
      block_id: 'blk-test',
      turn_id: 'tu-test',
      block_type: 'graph_patch',
      data: patchData,
    } as unknown as TypedConversationBlock;

    handleEditGraphMock.mockResolvedValue({
      blocks: [block],
      assistantText: 'Connected X to A.',
      latencyMs: 10,
      appliedGraph: {
        ...graph,
        edges: [
          ...(graph.edges ?? []),
          { from: 'fac_x', to: 'opt_a', strength: { mean: 0.5, std: 0.1 } },
        ],
      } as GraphV3T,
      wasRejected: false,
    });

    const ctx = makeContext();
    const result = await editGraphAction.execute(
      { edit_description: 'connect fac_x to opt_a' },
      ctx,
    );

    expect(result.failure).toBeUndefined();
    expect(result.operations).toBeDefined();
    expect(result.operations).toHaveLength(1);
    expect(result.operations![0].op).toBe('add_edge');
    expect(result.applied_graph_hash).toBe('abc123');
    // Adapter MUST strip V2 graph_patch blocks so envelope assembly emits
    // exactly one (hardened) graph_patch. Leaking the V2 block would cause
    // double-emit + dedup retaining pre-hardening operations.
    expect(result.blocks.find((b) => b.block_type === 'graph_patch')).toBeUndefined();
    expect(result.assistantText).toBe('Connected X to A.');
  });

  it("emits EDIT_GRAPH_REJECTED failure when V2 handler rejects", async () => {
    handleEditGraphMock.mockResolvedValue({
      blocks: [],
      assistantText: 'Cannot create cycles.',
      latencyMs: 5,
      appliedGraph: null,
      wasRejected: true,
    });

    const ctx = makeContext();
    const result = await editGraphAction.execute(
      { edit_description: 'create a cycle' },
      ctx,
    );

    expect(result.failure).toBeDefined();
    expect(result.failure?.code).toBe('EDIT_GRAPH_REJECTED');
    expect(result.operations).toBeUndefined();
  });

  it("strips add_edge ops referencing unknown endpoints", async () => {
    const graph = makeGraph();
    const patchData: GraphPatchBlockData = {
      patch_type: 'edit',
      status: 'proposed',
      operations: [
        {
          op: 'add_edge',
          path: 'fac_ghost->opt_a',
          value: { from: 'fac_ghost', to: 'opt_a' },
        },
      ],
      applied_graph_hash: 'hash',
      auto_apply: false,
    };
    const block: TypedConversationBlock = {
      block_id: 'blk',
      turn_id: 'tu-test',
      block_type: 'graph_patch',
      data: patchData,
    } as unknown as TypedConversationBlock;

    handleEditGraphMock.mockResolvedValue({
      blocks: [block],
      assistantText: 'Added an edge.',
      latencyMs: 1,
      appliedGraph: graph,
      wasRejected: false,
    });

    const ctx = makeContext();
    const result = await editGraphAction.execute(
      { edit_description: 'connect ghost to A' },
      ctx,
    );

    expect(result.failure).toBeDefined();
    expect(result.failure?.code).toBe('EDIT_GRAPH_INVALID_EDGE');
  });

  it("returns unsupported fallback on empty edit_description", async () => {
    const ctx = makeContext();
    const result = await editGraphAction.execute({ edit_description: '' }, ctx);
    expect(result.assistantText).toMatch(/wasn'?t able/);
    expect(handleEditGraphMock).not.toHaveBeenCalled();
  });

  it("pipeline emits EXACTLY ONE graph_patch block containing the hardened operations", async () => {
    const { assembleV4Envelope } = await import(
      "../../../../../src/orchestrator/deterministic/pipeline-v4.js"
    );

    const graph = makeGraph();
    // V2 returns TWO operations: one valid structural op + one with an
    // unknown endpoint. The adapter must strip the bad op and re-emit the
    // patch; the envelope must NOT leak the V2 block alongside.
    const v2Ops = [
      {
        op: 'add_edge',
        path: 'fac_x->opt_a',
        value: { from: 'fac_x', to: 'opt_a', strength: { mean: 0.5, std: 0.1 } },
      },
      {
        op: 'add_edge',
        path: 'fac_ghost->opt_a',
        value: { from: 'fac_ghost', to: 'opt_a' },
      },
    ];
    const v2Block = {
      block_id: 'blk-v2',
      turn_id: 'tu-test',
      block_type: 'graph_patch',
      data: {
        patch_type: 'edit',
        status: 'proposed',
        operations: v2Ops,
        applied_graph_hash: 'hash-v2',
        auto_apply: false,
      },
    } as unknown as TypedConversationBlock;

    handleEditGraphMock.mockResolvedValue({
      blocks: [v2Block],
      assistantText: 'Connected X to A.',
      latencyMs: 1,
      appliedGraph: graph,
      wasRejected: false,
    });

    const ctx = makeContext();
    const actionResult = await editGraphAction.execute(
      { edit_description: 'connect fac_x to opt_a' },
      ctx,
    );

    // Adapter must not pass the V2 graph_patch block back.
    expect(actionResult.blocks.find((b) => b.block_type === 'graph_patch')).toBeUndefined();
    // Adapter keeps only the valid op for the envelope re-emit.
    expect(actionResult.operations).toHaveLength(1);
    expect((actionResult.operations![0].value as { from: string }).from).toBe('fac_x');

    const envelope = assembleV4Envelope({
      turnContext: ctx,
      turnId: 'tu-test',
      requestId: 'req-test',
      executionClass: 'standard_turn',
      assistantText: actionResult.assistantText ?? '',
      actionResult,
      routing: 'deterministic',
      executedAction: 'edit_graph' as never,
      contextFallbackUsed: false,
      availableTools: [],
    });

    const patchBlocks = (envelope.blocks ?? []).filter((b) => b.block_type === 'graph_patch');
    expect(patchBlocks).toHaveLength(1);
    const emittedOps = (patchBlocks[0].data as { operations: unknown[] }).operations;
    // Emitted ops match the hardened set (one op, not two).
    expect(emittedOps).toHaveLength(1);
    expect((emittedOps[0] as { value: { from: string } }).value.from).toBe('fac_x');
  });
});
