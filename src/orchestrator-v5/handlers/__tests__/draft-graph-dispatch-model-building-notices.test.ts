/**
 * ⭐⭐ RED-FIRST PIN — THE REFUSALS REACH THE TURN THE USER RENDERS.
 *
 * The record projector's refusals ride the R1 channel to the CEE V3 wire and
 * stop there. `r1-disclosure-carrier.e2e.test.ts` states the gap in its own
 * header: on the V5 turn path the count goes **56 → 0**, and *"the honest
 * sentence is 'reaches the CEE V3 wire' — never 'reaches the user'"*.
 *
 * This file executes the real V5 response composer and asserts the notices
 * arrive on the turn payload, BY KIND AND COUNT (trap 19 — never a presence
 * predicate another object could satisfy), and that the whole envelope still
 * satisfies the strict boundary contract.
 *
 * At pristine every test here REDs on `model_building_notices` being
 * `undefined`: the composer had nothing to read because the tool boundary
 * dropped the field.
 */
import { describe, it, expect, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

// emit() is telemetry-only; silence it so the composer runs side-effect-free.
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

import { draftResultToOlumiResponse } from '../draft-graph-dispatch.js';
import type { DraftGraphResult } from '../../../orchestrator/tools/draft-graph.js';
import { buildModelBuildingNotices } from '../../../cee/draft/records/model-building-notices.js';

const PAYLOAD = {
  kind: 'message' as const,
  scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  stage: 'frame' as const,
  message: 'Should we switch supplier? Cut churn to 8%. Budget is £3/seat/month.',
  turn_class: 'frame' as const,
  source: 'composer' as const,
};

const GRAPH = {
  nodes: [
    { id: 'dec_supplier', kind: 'decision', label: 'Choose supplier strategy' },
    { id: 'opt_switch', kind: 'option', label: 'Switch supplier' },
    { id: 'fac_terms', kind: 'factor', label: 'Current supplier terms' },
    { id: 'goal_cost', kind: 'goal', label: 'Minimise total cost' },
  ],
  edges: [{ from: 'opt_switch', to: 'goal_cost' }],
};

function makeResult(overrides: Partial<Record<string, unknown>> = {}): DraftGraphResult {
  return {
    blocks: [],
    assistantText: 'Drafted a decision graph.',
    latencyMs: 1000,
    strengthenItems: [],
    coachingSummary: null,
    coachingWideningLog: null,
    coachingBiasSignals: null,
    draftWarnings: [],
    graphOutput: GRAPH,
    analysisReady: { status: 'ready', goal_node_id: 'goal_cost', options: [] },
    ...overrides,
  } as unknown as DraftGraphResult;
}

/**
 * The disclosures as the V3 wire ships them — three distinct producer reasons
 * chosen so the assertion below discriminates between kinds rather than merely
 * counting. A single-kind fixture would pass against a composer that emitted
 * one hardcoded group.
 */
const DISCLOSURES = [
  { reason: 'ref_kind_illegal', label: 'Capacity → Attrition', withdrawn: false },
  { reason: 'unconnected_to_goal', label: 'TAM is €400m', withdrawn: true },
  { reason: 'stated_target_value_dropped', label: 'cut churn to 8%', withdrawn: false },
  { reason: 'parallel_intervention_conflict', label: 'Switch supplier → Cost', withdrawn: false },
  { reason: 'self_loop', label: 'Cost → Cost', withdrawn: false },
];

describe('draftResultToOlumiResponse — model_building_notices reach the user', () => {
  it('stamps the notices on the turn, grouped by kind with a faithful total', () => {
    const notices = buildModelBuildingNotices(DISCLOSURES);
    const res = draftResultToOlumiResponse(
      makeResult({ modelBuildingNotices: notices }),
      PAYLOAD,
      true,
      'req-mbn-1',
      PAYLOAD.message,
    );

    const stamped = (res as { model_building_notices?: unknown }).model_building_notices;
    expect(stamped).toBeDefined();

    // BOUND BY IDENTITY: the exact kinds and their exact counts, not a length.
    expect(stamped).toEqual({
      total_count: 5,
      groups: [
        { kind: 'detail_not_connected', count: 1 },
        { kind: 'relationship_not_used', count: 2 },
        { kind: 'conflict_resolved_conservatively', count: 1 },
        { kind: 'target_not_modelled_as_threshold', count: 1 },
      ],
      details_redacted: true,
    });
  });

  it('the whole envelope still satisfies the strict boundary contract', () => {
    const res = draftResultToOlumiResponse(
      makeResult({ modelBuildingNotices: buildModelBuildingNotices(DISCLOSURES) }),
      PAYLOAD,
      true,
      'req-mbn-2',
      PAYLOAD.message,
    );
    const parsed = OlumiResponseSchema.safeParse(res);
    expect(parsed.success).toBe(true);
    // ⚠ ASSERT ON THE PARSE OUTPUT, NOT JUST ITS SUCCESS. `success: true` is
    // satisfied whether the field SURVIVES or is STRIPPED — it passes today
    // only because the schema is `.strict()`. Were that ever relaxed to strip
    // rather than reject, this test would stay green while the user stopped
    // receiving the notices. Bind to the parsed value so the guard fails on the
    // thing it exists to protect.
    if (!parsed.success) throw new Error('unreachable: asserted above');
    expect(parsed.data.model_building_notices).toEqual({
      total_count: 5,
      groups: [
        { kind: 'detail_not_connected', count: 1 },
        { kind: 'relationship_not_used', count: 2 },
        { kind: 'conflict_resolved_conservatively', count: 1 },
        { kind: 'target_not_modelled_as_threshold', count: 1 },
      ],
      details_redacted: true,
    });
  });

  it('carries no notices key when the projector refused nothing', () => {
    // Absence is the ONLY legal representation of "nothing was refused": the
    // contract's `total_count` is positive and `groups` requires >= 1 entry, so
    // a zeroed object would be an INVALID carrier, not a quieter one.
    const res = draftResultToOlumiResponse(
      makeResult({ modelBuildingNotices: buildModelBuildingNotices([]) }),
      PAYLOAD,
      true,
      'req-mbn-3',
      PAYLOAD.message,
    );
    expect((res as { model_building_notices?: unknown }).model_building_notices).toBeUndefined();
    expect(OlumiResponseSchema.safeParse(res).success).toBe(true);
  });

  it('the user is told even when the draft did not persist', () => {
    // A refusal on a turn whose graph did not persist is exactly the case the
    // founder's constraint is about: the product must not refuse AND hide the
    // reason. Pinned so a later persist-gate cannot quietly swallow it.
    const res = draftResultToOlumiResponse(
      makeResult({ modelBuildingNotices: buildModelBuildingNotices(DISCLOSURES) }),
      PAYLOAD,
      false,
      'req-mbn-4',
      PAYLOAD.message,
    );
    const stamped = (res as { model_building_notices?: { total_count?: number } })
      .model_building_notices;
    expect(stamped?.total_count).toBe(5);
  });
});
