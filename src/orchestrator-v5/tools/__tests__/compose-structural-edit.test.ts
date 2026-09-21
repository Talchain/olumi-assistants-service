/**
 * ROADMAP 2.474 — composer TRANSPORT: exactly one call, reject-don't-repair.
 *
 * The property that matters here is a NEGATIVE one, so it needs a positive
 * control: a test asserting "no second call" is worthless unless the harness
 * can observe a call at all. Every case counts calls on a spy that the
 * happy-path test proves reaches 1.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { composeStructuralEdit } from '../compose-structural-edit.js';
import {
  buildStructuralEditGrounding,
  PROPOSE_STRUCTURAL_EDIT_TOOL_NAME,
} from '../propose-structural-edit.js';
import { buildReadyGraph } from '../../graph-management/__tests__/fixtures.js';
import * as telemetry from '../../../utils/telemetry.js';

const GRAPH = buildReadyGraph();

function grounding() {
  const g = buildStructuralEditGrounding(GRAPH);
  if (g === null) throw new Error('fixture graph must be groundable');
  return g;
}

function toolUseResult(input: unknown) {
  return {
    content: [{ type: 'tool_use' as const, id: 'tu_1', name: PROPOSE_STRUCTURAL_EDIT_TOOL_NAME, input: input as Record<string, unknown> }],
    stop_reason: 'tool_use' as const,
    usage: { input_tokens: 10, output_tokens: 10 },
    model: 'test-model',
    latencyMs: 1,
  };
}

function baseInput(chatWithTools: unknown) {
  return {
    adapter: { name: 'test', chatWithTools } as never,
    grounding: grounding(),
    message: 'give each option its own driver',
    maxPatchOperations: 15,
    requestId: 'req-1',
    scenarioId: 'scn-1',
    // ROADMAP 2.684 — REQUIRED since the deadline was plumbed in. A fixed
    // value here is right: these cases are about the transport contract (one
    // call, reject-don't-repair), not about the budget. The budget's own
    // derivation is pinned in `budget-timeout-invariants.test.ts` and its
    // plumbing in `structural-edit-deadline-plumbing.test.ts`.
    timeoutMs: 60_000,
  };
}

const GROUNDED_PAYLOAD = {
  operations: [
    {
      op: 'update_node',
      path: 'f-spend',
      target_label: 'Marketing spend',
      value: { observed_state: { value: 0.7 } },
    },
  ],
};

const UNGROUNDED_PAYLOAD = {
  operations: [
    { op: 'update_node', path: 'f-invented', target_label: 'Nope', value: { description: 'x' } },
  ],
};

let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
});
afterEach(() => {
  emitSpy.mockRestore();
});

describe('composer transport', () => {
  it('POSITIVE CONTROL — a grounded batch composes, and the call counter can see one call', () => {
    // Without this the "never twice" assertions below could pass on a harness
    // that never called anything.
    const spy = vi.fn().mockResolvedValue(toolUseResult(GROUNDED_PAYLOAD));
    return composeStructuralEdit(baseInput(spy)).then((outcome) => {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(outcome.status).toBe('composed');
      if (outcome.status !== 'composed') throw new Error('unreachable');
      expect(outcome.operations).toEqual([
        { op: 'update_node', path: 'f-spend', value: { observed_state: { value: 0.7 } } },
      ]);
    });
  });

  it('the served tool carries the grounding table and the canonical name', async () => {
    const spy = vi.fn().mockResolvedValue(toolUseResult(GROUNDED_PAYLOAD));
    await composeStructuralEdit(baseInput(spy));
    const args = spy.mock.calls[0]![0] as { tools: { name: string; description: string }[] };
    expect(args.tools).toHaveLength(1);
    expect(args.tools[0]!.name).toBe(PROPOSE_STRUCTURAL_EDIT_TOOL_NAME);
    expect(args.tools[0]!.description).toContain('f-spend | factor | Marketing spend');
  });

  it('REJECT-DON’T-REPAIR — an ungrounded batch rejects after EXACTLY ONE call, with no retry', async () => {
    const spy = vi.fn().mockResolvedValue(toolUseResult(UNGROUNDED_PAYLOAD));
    const outcome = await composeStructuralEdit(baseInput(spy));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') throw new Error('unreachable');
    expect(outcome.code).toBe('UNKNOWN_ENTITY_ID');
  });

  it('the rejection telemetry carries the CODE and never the reason prose (which quotes ids)', async () => {
    const spy = vi.fn().mockResolvedValue(toolUseResult(UNGROUNDED_PAYLOAD));
    await composeStructuralEdit(baseInput(spy));
    const call = (emitSpy.mock.calls as unknown[][]).find(
      (args) => args[0] === telemetry.TelemetryEvents.V5StructuralEditToolComposed,
    );
    expect(call).toBeDefined();
    const payload = call![1] as Record<string, unknown>;
    expect(payload.outcome).toBe('rejected');
    expect(payload.rejection_code).toBe('UNKNOWN_ENTITY_ID');
    expect(JSON.stringify(payload)).not.toContain('f-invented');
  });

  it('a model that declines to call the tool is UNAVAILABLE, not a refusal of the edit', async () => {
    const spy = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'I cannot express that against this model.' }],
      stop_reason: 'end_turn' as const,
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'test-model',
      latencyMs: 1,
    });
    const outcome = await composeStructuralEdit(baseInput(spy));
    expect(outcome).toEqual({ status: 'unavailable', reason: 'no_tool_call' });
  });

  it('a tool_use block with ANOTHER tool’s name is not read as this tool’s batch', async () => {
    // Identity binding on the transport (trap 19): the block is bound by NAME,
    // not by "there was a tool_use block". A model emitting `olumi_action` in
    // the same response must not have its payload validated as a structural
    // edit batch — the shapes are unrelated, and the failure mode is silent.
    const spy = vi.fn().mockResolvedValue({
      content: [
        { type: 'tool_use' as const, id: 'tu_x', name: 'olumi_action', input: GROUNDED_PAYLOAD },
      ],
      stop_reason: 'tool_use' as const,
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'test-model',
      latencyMs: 1,
    });
    const outcome = await composeStructuralEdit(baseInput(spy));
    expect(outcome).toEqual({ status: 'unavailable', reason: 'no_tool_call' });
  });

  it('an adapter with no tool support is UNAVAILABLE and makes no call', async () => {
    const outcome = await composeStructuralEdit({
      ...baseInput(undefined),
      adapter: { name: 'no-tools' } as never,
    });
    expect(outcome).toEqual({ status: 'unavailable', reason: 'no_tool_adapter' });
  });

  it('a thrown adapter error never propagates — the turn declines rather than crashing', async () => {
    const spy = vi.fn().mockRejectedValue(new Error('upstream 529'));
    const outcome = await composeStructuralEdit(baseInput(spy));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ status: 'unavailable', reason: 'call_failed' });
  });
});
