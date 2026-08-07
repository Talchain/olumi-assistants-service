/**
 * ROADMAP 2.713 (I4) — WHAT THE CAP COUNTS IS WHAT THE CAP DISCLOSES.
 *
 * `BATCH_CAP_EXCEEDED` is emitted by TWO guards that mean opposite things:
 *
 *   RUNAWAY          the model's raw emission is longer than the pipeline cap,
 *                    judged before anything is validated or partitioned;
 *   UNPARTITIONABLE  a batch that is entirely legitimate and merely large,
 *                    which no split can make cap-legal.
 *
 * The user-facing copy for the two already differs. The TELEMETRY did not: the
 * reject branch read every count off the validation outcome, which by
 * reject-don't-repair design carries no operations, so `operations_count`,
 * `envelope_count` and `part_count` were all hardcoded 0 on exactly the branch
 * a diagnosis needs them. A live cap reject was therefore indistinguishable
 * from outside — the ambiguity that blocked one.
 *
 * These tests bind to the DISTINCTION, not to the presence of a field: the
 * decisive assertion is that two rejections which look identical today
 * (`BATCH_CAP_EXCEEDED`, all counts 0) carry different, correct
 * `raw_operations_count` and `rejection_detail`. A test that merely asserted
 * "the field exists" would pass on a constant.
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
const MAX_PATCH_OPERATIONS = 15;

function grounding() {
  const g = buildStructuralEditGrounding(GRAPH);
  if (g === null) throw new Error('fixture graph must be groundable');
  return g;
}

function toolUseResult(input: unknown) {
  return {
    content: [
      {
        type: 'tool_use' as const,
        id: 'tu_1',
        name: PROPOSE_STRUCTURAL_EDIT_TOOL_NAME,
        input: input as Record<string, unknown>,
      },
    ],
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
    message: 'restructure the model',
    maxPatchOperations: MAX_PATCH_OPERATIONS,
    requestId: 'req-1',
    scenarioId: 'scn-1',
    timeoutMs: 60_000,
  };
}

let emitSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit').mockImplementation(() => {});
});
afterEach(() => {
  emitSpy.mockRestore();
});

/** The one `composed` event for this turn. */
function composedEvent(): Record<string, unknown> {
  const call = (emitSpy.mock.calls as unknown[][]).find(
    (args) => args[0] === telemetry.TelemetryEvents.V5StructuralEditToolComposed,
  );
  expect(call, 'the composer must emit exactly one composed event').toBeDefined();
  return call![1] as Record<string, unknown>;
}

async function compose(payload: unknown) {
  const spy = vi.fn().mockResolvedValue(toolUseResult(payload));
  const outcome = await composeStructuralEdit(baseInput(spy));
  return { outcome, event: composedEvent() };
}

/** A grounded, cap-legal update of a NAMED persisted node. */
function updateOfSpend(fields: Record<string, unknown>) {
  return { op: 'update_node', path: 'f-spend', target_label: 'Marketing spend', value: fields };
}

/** RUNAWAY: one op past the pipeline cap, rejected before any validation. */
const RUNAWAY_PAYLOAD = {
  operations: Array.from({ length: MAX_PATCH_OPERATIONS + 1 }, () =>
    updateOfSpend({ description: 'a' }),
  ),
};

/** UNPARTITIONABLE: a single op whose fan-out alone exceeds one proposal. */
const OVERSIZE_OP_PAYLOAD = {
  operations: [
    updateOfSpend({
      label: 'Marketing spend',
      description: 'a',
      category: 'controllable',
      observed_state: { value: 0.1 },
      kind: 'factor',
      from: 'x',
      to: 'y',
      exists_probability: 0.5,
      effect_direction: 'positive',
      strength: { mean: 0.1, std: 0.1 },
    }),
  ],
};

describe('I4 — the composed event discloses the RAW emission on both branches', () => {
  it('an ACCEPTED batch reports the raw count it actually received', async () => {
    const { outcome, event } = await compose({
      operations: [updateOfSpend({ description: 'a' }), updateOfSpend({ description: 'b' })],
    });
    expect(outcome.status).toBe('composed');
    expect(event.raw_operations_count).toBe(2);
    expect(event.rejection_detail).toBeNull();
  });

  it('a RUNAWAY reject reports a raw count ABOVE the cap — the number the guard compared', async () => {
    const { outcome, event } = await compose(RUNAWAY_PAYLOAD);
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') return;
    expect(outcome.code).toBe('BATCH_CAP_EXCEEDED');
    expect(event.raw_operations_count).toBe(MAX_PATCH_OPERATIONS + 1);
    expect(Number(event.raw_operations_count)).toBeGreaterThan(MAX_PATCH_OPERATIONS);
    expect(event.rejection_detail).toBe('runaway');
  });

  it('an UNPARTITIONABLE reject reports a raw count AT OR UNDER the cap — the other guard', async () => {
    const { outcome, event } = await compose(OVERSIZE_OP_PAYLOAD);
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') return;
    expect(outcome.code).toBe('BATCH_CAP_EXCEEDED');
    expect(Number(event.raw_operations_count)).toBeLessThanOrEqual(MAX_PATCH_OPERATIONS);
    expect(event.rejection_detail).toBe('operation_exceeds_part');
  });

  it('THE DECISIVE PROPERTY — the two cap rejects are now distinguishable from telemetry alone', async () => {
    const runaway = await compose(RUNAWAY_PAYLOAD);
    emitSpy.mockClear();
    const unpartitionable = await compose(OVERSIZE_OP_PAYLOAD);

    // Identical on every field that existed before this row…
    for (const field of ['outcome', 'rejection_code', 'operations_count', 'envelope_count', 'part_count']) {
      expect(runaway.event[field]).toEqual(unpartitionable.event[field]);
    }
    expect(runaway.event.rejection_code).toBe('BATCH_CAP_EXCEEDED');
    // …and different on both fields this row added. Either one alone separates
    // them; asserting both keeps the count honest as well as the code.
    expect(runaway.event.rejection_detail).not.toEqual(unpartitionable.event.rejection_detail);
    expect(runaway.event.raw_operations_count).not.toEqual(
      unpartitionable.event.raw_operations_count,
    );
  });

  it('`rejection_detail` is null on a NON-cap rejection — it names a guard, not every refusal', async () => {
    const { outcome, event } = await compose({
      operations: [
        { op: 'update_node', path: 'f-invented', target_label: 'Nope', value: { description: 'x' } },
      ],
    });
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') return;
    expect(outcome.code).toBe('UNKNOWN_ENTITY_ID');
    expect(event.rejection_detail).toBeNull();
    expect(event.raw_operations_count).toBe(1);
  });

  it('a payload with no `operations` array reports a null raw count, not a fabricated zero', async () => {
    const { outcome, event } = await compose({ nonsense: true });
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') return;
    expect(outcome.code).toBe('SCHEMA_INVALID');
    expect(event.raw_operations_count).toBeNull();
  });

  it('the added fields are STRUCTURAL — no id from the batch reaches the event', async () => {
    // The emit's standing contract: a code and counts, never the reason prose.
    const { event } = await compose({
      operations: [
        { op: 'update_node', path: 'f-invented-secret', target_label: 'Nope', value: { description: 'x' } },
      ],
    });
    expect(JSON.stringify(event)).not.toContain('f-invented-secret');
  });
});
