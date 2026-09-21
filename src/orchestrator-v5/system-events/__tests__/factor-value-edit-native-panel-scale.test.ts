/**
 * A verified panel belief is MODEL-scale, unlike the native amount-entry
 * branch. Exercise the real verifier and edit handler: a framed amount must
 * preserve the participant's MODEL value and derive its raw amount from the
 * existing frame, without attaching their name to a divided model value.
 *
 * These are constructed server-contract cases, not native browser captures
 * or persistence witnesses. No session store or analysis transport is used.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';
import type {
  CollabParticipant,
  CollabRound,
  CollabStore,
  ElicitationEventRow,
} from '../../../collab/types.js';
import { applyFactorValueEdit } from '../factor-value-edit.js';

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const ROUND_ID = '33333333-3333-4333-8333-333333333333';
const PARTICIPANT_ID = '55555555-5555-4555-8555-555555555555';
const TARGET_ID = 'f-panel-estimate';

function graphFor(observed: Record<string, unknown>, frame?: number) {
  return {
    goal_node_id: 'g-outcome',
    nodes: [
      { id: 'g-outcome', kind: 'goal', label: 'Outcome' },
      {
        id: TARGET_ID,
        kind: 'factor',
        label: 'Panel estimate',
        observed_state: { ...observed, source: 'cee_inference' },
        ...(frame === undefined ? {} : { scale_frame: frame }),
      },
      {
        id: 'f-untouched', kind: 'factor', label: 'Other estimate',
        observed_state: { value: 0.2, source: 'cee_inference' },
      },
    ],
    edges: [{
      from: TARGET_ID, to: 'g-outcome',
      strength: { mean: 0.4, std: 0.1 },
      exists_probability: 0.9, effect_direction: 'positive',
    }],
  };
}

/** Only the three reads consumed by the real verifyAppliedFrom are needed. */
function closedRoundStore(value: number) {
  const round: CollabRound = {
    round_id: ROUND_ID,
    scenario_id: SCENARIO_ID,
    graph_version_ref: 'mv-panel-scale',
    target_manifest: [{
      target: { kind: 'factor', id: TARGET_ID },
      label: 'Panel estimate', description: null, unit: null,
    }],
    context_note: null,
    status: 'closed',
    created_by: 'owner-user',
    created_at: '2026-08-31T10:00:00.000Z',
  };
  const participant: CollabParticipant = {
    participant_id: PARTICIPANT_ID,
    scenario_id: SCENARIO_ID,
    round_id: ROUND_ID,
    display_name: 'Grace',
    supabase_user_id: null,
    token_hash: 'test-panel-scale-token-hash',
    status: 'active',
    pseudonym: null,
    created_at: '2026-08-31T10:01:00.000Z',
  };
  const belief: ElicitationEventRow = {
    event_id: 'evt-panel-scale-belief',
    round_id: ROUND_ID,
    participant_id: PARTICIPANT_ID,
    event_version: 1,
    kind: 'belief_submitted',
    target: { kind: 'factor', id: TARGET_ID },
    belief: { value, expression_raw: null, confidence: null },
    evidence: null,
    provenance: {
      authored_by: PARTICIPANT_ID,
      method: 'elicited_nl',
      elicitation_version: 'cee-belief-elicitation-v1',
    },
    created_at: '2026-08-31T10:05:00.000Z',
  };
  const reads = {
    getRound: vi.fn(async (id: string) => id === ROUND_ID ? round : null),
    getParticipant: vi.fn(async (id: string) => id === PARTICIPANT_ID ? participant : null),
    listAllRoundEvents: vi.fn(async (id: string) => id === ROUND_ID ? [structuredClone(belief)] : []),
  };
  return { store: reads as unknown as CollabStore, reads };
}

async function applyPanelValue(graph: ReturnType<typeof graphFor>, value: number) {
  const { store, reads } = closedRoundStore(value);
  const event: Extract<SystemEventTurnPayload['event'], { kind: 'factor_value_edit' }> = {
    kind: 'factor_value_edit', target_id: TARGET_ID, value,
    applied_from: { round_id: ROUND_ID, participant_id: PARTICIPANT_ID },
  };
  const payload: SystemEventTurnPayload = {
    kind: 'system_event',
    scenario_id: SCENARIO_ID,
    turn_id: '77777777-7777-4777-8777-777777777777',
    stage: 'analyse',
    event,
  };
  const result = await applyFactorValueEdit({
    payload, event, requestId: 'native-panel-scale-contract',
    persistedGraph: graph, priorFacts: [], collabStore: store,
  });
  // The known MODEL carrier must be established by the real verifier.
  expect(reads.getRound).toHaveBeenCalledWith(ROUND_ID);
  expect(reads.getParticipant).toHaveBeenCalledWith(PARTICIPANT_ID);
  expect(reads.listAllRoundEvents).toHaveBeenCalledWith(ROUND_ID);
  return result;
}

describe('factor_value_edit — verified panel scale at native amount admission', () => {
  it('refuses a verified MODEL value when the stored frame contradicts its own pair', async () => {
    // Keep a stored unit so the old bare-unit predicate cannot accidentally
    // supply the refusal: the inconsistency in scale authority must own it.
    const graph = graphFor({ value: 0.5, raw_value: 100000, unit: '£' }, 500000);
    const before = structuredClone(graph);
    const result = await applyPanelValue(graph, 0.85);

    expect.soft(result.kind).toBe('refused');
    expect.soft(graph).toEqual(before);
    expect.soft(result).not.toHaveProperty('mutatedGraph');
    expect.soft(result).not.toHaveProperty('handlerFacts');
    expect.soft(result).not.toHaveProperty('graph');
    expect.soft(result.response.assistant_text).toMatch(/haven't changed anything/i);
    expect.soft(result.response.blocks).toEqual([]);
    expect.soft(JSON.stringify(result.response)).not.toContain('panel_elicited');
    expect.soft(JSON.stringify(result.response)).not.toContain('user_override');
  });

  const valid = [
    {
      name: 'verified model 0.85 preserves 0.85 on frame 200000 with raw amount 170000',
      graph: () => graphFor({ value: 0.5 }, 200000),
      value: 0.85, raw: 170000,
    },
    {
      name: 'verified model endpoint 1 preserves 1 on frame 200000 with raw amount 200000',
      graph: () => graphFor({ value: 0.5 }, 200000),
      value: 1, raw: 200000,
    },
    {
      name: 'unframed probability preserves verified model 0.85',
      graph: () => graphFor({ value: 0.4 }),
      value: 0.85, raw: 0.85,
    },
    {
      name: 'capped amount preserves verified model 0.85 and its authorised raw conversion',
      graph: () => graphFor({ value: 0.4, raw_value: 40000, cap: 100000, unit: '£' }),
      value: 0.85, raw: 85000,
    },
    {
      name: 'capless framed zero needs no guessed rescale and keeps panel authorship',
      graph: () => graphFor({ value: 0.5 }, 200000),
      value: 0, raw: 0,
    },
  ];

  for (const { name, graph: makeGraph, value, raw } of valid) {
    it(name, async () => {
      const graph = makeGraph();
      const before = structuredClone(graph);
      const result = await applyPanelValue(graph, value);
      expect(result.kind).toBe('mutated');
      expect(graph).toEqual(before);
      if (result.kind !== 'mutated') return;

      const matches = result.graph.nodes.filter((node) => node.id === TARGET_ID);
      expect(matches).toHaveLength(1);
      const observed = matches[0]!.observed_state;
      // Keep number and attribution failures independently visible on pristine.
      expect.soft(observed?.value).toBe(value);
      expect.soft(observed?.raw_value).toBe(raw);
      expect.soft(observed?.source).toBe('panel_elicited');
      expect.soft(observed?.source).not.toBe('user_override');
      expect.soft(observed?.elicited_from).toEqual({
        round_id: ROUND_ID, participant_id: PARTICIPANT_ID,
      });
      const beforeTarget = before.nodes.find((node) => node.id === TARGET_ID);
      expect(matches[0]?.scale_frame).toBe(
        beforeTarget && 'scale_frame' in beforeTarget ? beforeTarget.scale_frame : undefined,
      );
      const beforeObserved = before.nodes.find((node) => node.id === TARGET_ID)?.observed_state;
      expect(observed?.cap).toBe((beforeObserved as { cap?: number } | undefined)?.cap);
      expect(result.handlerFacts).toContainEqual(expect.objectContaining({
        fact_type: 'set_factor_value',
        result: expect.objectContaining({
          target_id: TARGET_ID,
          after: expect.objectContaining({
            value, raw_value: raw, source: 'panel_elicited',
            elicited_from: { round_id: ROUND_ID, participant_id: PARTICIPANT_ID },
          }),
        }),
      }));
      expect(result.graph.nodes.find((node) => node.id === 'f-untouched')?.observed_state)
        .toEqual(before.nodes.find((node) => node.id === 'f-untouched')?.observed_state);
    });
  }
});
