/**
 * THE ATTRIBUTED MODEL CHANGE, end to end through the real machinery.
 *
 * ── THE DEFECT THESE TESTS CLOSE ──────────────────────────────────────────
 * Before this slice the only way to act on a colleague's revealed estimate was
 * to retype it, which stamps `observed_state.source = 'user_override'` and
 * renders as **"User edited"**. So the product took Grace's expertise and
 * labelled it as the owner's own work. These tests assert the stamp now tells
 * the truth, and — the load-bearing half — that it tells the truth ONLY when
 * the server could verify it.
 *
 * ── WHY THIS RUNS THE REAL CHAIN AND NOT A MOCK ───────────────────────────
 * `applyFactorValueEdit` is called for real, so the assertions run through the
 * actual validator, the actual `set_factor_value` handler, the actual
 * persistence merge, and the actual post-mutation `GraphV3.safeParse`. That
 * last step is why: the parse is what refuses an unknown `source` literal, and
 * a test that asserted the stamp on the handler's output alone would pass while
 * the user was still being told "I couldn't save that change."
 */

import { describe, expect, it } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

import { applyFactorValueEdit } from '../factor-value-edit.js';
import type {
  CollabParticipant,
  CollabRound,
  CollabStore,
  ElicitationEventRow,
} from '../../../collab/types.js';

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const ROUND_ID = '33333333-3333-4333-8333-333333333333';
const GRACE_ID = '55555555-5555-4555-8555-555555555555';
const ADA_ID = '66666666-6666-4666-8666-666666666666';

/** The acceptance scenario's factor: a probability, uncapped, model-scale. */
const TARGET_ID = 'fac_churn_risk';
const GRACE_VALUE = 0.85;
const ADA_VALUE = 0.2;
const MODEL_VALUE_BEFORE = 0.4;

function buildPersistedGraph(): unknown {
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: TARGET_ID,
        kind: 'factor',
        label: 'Churn risk after a price rise',
        // Uncapped probability: raw and model scales are identical, so the
        // written number is directly comparable to the belief the panel gave.
        observed_state: { value: MODEL_VALUE_BEFORE, source: 'cee_inference' },
      },
      { id: 'o-hold', kind: 'option', label: 'Hold price' },
    ],
    edges: [
      {
        from: TARGET_ID,
        to: 'g-revenue',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'negative',
      },
    ],
  };
}

function payloadFor(event: Record<string, unknown>): SystemEventTurnPayload {
  return {
    kind: 'system_event',
    scenario_id: SCENARIO_ID,
    turn_id: '77777777-7777-4777-8777-777777777777',
    stage: 'analyse',
    event: { kind: 'factor_value_edit', ...event },
  } as unknown as SystemEventTurnPayload;
}

function beliefEvent(participant_id: string, value: number): ElicitationEventRow {
  return {
    event_id: `evt-${participant_id}`,
    round_id: ROUND_ID,
    participant_id,
    event_version: 1,
    kind: 'belief_submitted',
    target: { kind: 'factor', id: TARGET_ID },
    belief: { value, expression_raw: null, confidence: null },
    provenance: {
      authored_by: participant_id,
      method: 'elicited_nl',
      elicitation_version: 'cee-belief-elicitation-v1',
    },
    created_at: '2026-08-13T10:05:00.000Z',
  };
}

/** A closed round on THIS scenario: Ada 0.2, Grace 0.85. */
function closedRoundStore(): CollabStore {
  const round: CollabRound = {
    round_id: ROUND_ID,
    scenario_id: SCENARIO_ID,
    graph_version_ref: 'mv-1',
    target_manifest: [
      {
        target: { kind: 'factor', id: TARGET_ID },
        label: 'Churn risk after a price rise',
        description: null,
        unit: null,
      },
    ],
    context_note: null,
    status: 'closed',
    created_by: 'owner-user',
    created_at: '2026-08-13T10:00:00.000Z',
  };
  const mkParticipant = (id: string, name: string): CollabParticipant => ({
    participant_id: id,
    scenario_id: SCENARIO_ID,
    round_id: ROUND_ID,
    display_name: name,
    supabase_user_id: null,
    token_hash: `hash-${name}`,
    status: 'active',
    pseudonym: null,
    created_at: '2026-08-13T10:01:00.000Z',
  });
  const participants: Record<string, CollabParticipant> = {
    [GRACE_ID]: mkParticipant(GRACE_ID, 'Grace'),
    [ADA_ID]: mkParticipant(ADA_ID, 'Ada'),
  };
  const events = [beliefEvent(ADA_ID, ADA_VALUE), beliefEvent(GRACE_ID, GRACE_VALUE)];

  return {
    getRound: async (id: string) => (id === ROUND_ID ? round : null),
    getParticipant: async (id: string) => participants[id] ?? null,
    listAllRoundEvents: async () => events.map((e) => ({ ...e })),
  } as unknown as CollabStore;
}

/** Read the target node's `observed_state` off a returned, parsed graph. */
function observedStateOf(graph: { nodes: ReadonlyArray<{ id: string; observed_state?: unknown }> }) {
  const node = graph.nodes.find((n) => n.id === TARGET_ID);
  return node?.observed_state as
    | { value?: number; source?: string; elicited_from?: unknown }
    | undefined;
}

describe('factor_value_edit — the verified panel apply', () => {
  it('⭐ stamps panel_elicited + elicited_from and writes the value, through the REAL parse', async () => {
    const result = await applyFactorValueEdit({
      payload: payloadFor({
        target_id: TARGET_ID,
        value: GRACE_VALUE,
        field: 'value',
        applied_from: { round_id: ROUND_ID, participant_id: GRACE_ID },
      }),
      event: payloadFor({
        target_id: TARGET_ID,
        value: GRACE_VALUE,
        field: 'value',
        applied_from: { round_id: ROUND_ID, participant_id: GRACE_ID },
      }).event as never,
      requestId: 'req-apply-1',
      persistedGraph: buildPersistedGraph(),
      priorFacts: [],
      collabStore: closedRoundStore(),
    });

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;

    const observed = observedStateOf(result.graph);
    expect(observed?.value).toBe(GRACE_VALUE);

    // The attribution, and the reason this slice exists: NOT 'user_override'.
    expect(observed?.source).toBe('panel_elicited');
    expect(observed?.source).not.toBe('user_override');

    // Ids only — a display name here would sit beyond the R-2 redaction
    // routine's reach. Asserted as an exact object so an added `display_name`
    // REDs rather than riding along unnoticed.
    expect(observed?.elicited_from).toEqual({
      round_id: ROUND_ID,
      participant_id: GRACE_ID,
    });

    // Bound by identity: the stamp names Grace, not the other panellist who
    // also answered this factor.
    expect((observed?.elicited_from as { participant_id: string }).participant_id).not.toBe(ADA_ID);

    // The value actually moved — otherwise "visible consequence" is vacuous.
    expect(observed?.value).not.toBe(MODEL_VALUE_BEFORE);
  });

  it('⭐ writes the SERVER’s number and DROPS the client’s user-unit fields', async () => {
    // The discriminating test for the substitution. The client sends a matching
    // `value` but also an inconsistent `raw_value`/`unit`. If those were merged
    // rather than dropped, `resolveUserUnitInput`'s cross-check would refuse the
    // edit as `scale_inconsistent`. A clean mutation at exactly the server's
    // number is therefore only reachable if the client's fields were discarded.
    const event = payloadFor({
      target_id: TARGET_ID,
      value: GRACE_VALUE,
      field: 'value',
      raw_value: 999999,
      unit: 'widgets',
      applied_from: { round_id: ROUND_ID, participant_id: GRACE_ID },
    }).event as never;

    const result = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: GRACE_VALUE }),
      event,
      requestId: 'req-apply-2',
      persistedGraph: buildPersistedGraph(),
      priorFacts: [],
      collabStore: closedRoundStore(),
    });

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    expect(observedStateOf(result.graph)?.value).toBe(GRACE_VALUE);
    expect(observedStateOf(result.graph)?.source).toBe('panel_elicited');
  });

  it('⭐ INV-F: a FORGED claim is refused and writes NOTHING', async () => {
    // The positive control for every assertion above. Without it, all of them
    // would pass on a server that stamped whatever the client claimed — which
    // is precisely the defect class this feature exists to pin.
    const event = payloadFor({
      target_id: TARGET_ID,
      value: 0.99,
      field: 'value',
      applied_from: { round_id: ROUND_ID, participant_id: GRACE_ID },
    }).event as never;

    const result = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: 0.99 }),
      event,
      requestId: 'req-apply-3',
      persistedGraph: buildPersistedGraph(),
      priorFacts: [],
      collabStore: closedRoundStore(),
    });

    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toBe('collab_apply_value_mismatch');
    // "No graph is written" is the claim; assert the SHAPE that carries a write
    // is absent, not merely that the reason string looks right.
    expect('mutatedGraph' in result).toBe(false);
    // And the refusal is honest to the user, never a silent no-op.
    expect(result.response.assistant_text).toContain("haven't changed anything");
  });

  it("refuses attributing Ada's number to Grace — the attribution-swap forgery", async () => {
    const event = payloadFor({
      target_id: TARGET_ID,
      value: ADA_VALUE,
      field: 'value',
      applied_from: { round_id: ROUND_ID, participant_id: GRACE_ID },
    }).event as never;

    const result = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: ADA_VALUE }),
      event,
      requestId: 'req-apply-4',
      persistedGraph: buildPersistedGraph(),
      priorFacts: [],
      collabStore: closedRoundStore(),
    });

    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toBe('collab_apply_value_mismatch');
  });

  it('INERTNESS: an edit with NO applied_from still stamps user_override, unchanged', async () => {
    // The regression guard on the shared seam. `set_factor_value` is used by the
    // natural-language lane too; this slice must be byte-inert for it. A store
    // that throws on EVERY method proves the ordinary path never consults the
    // collab store at all.
    const explodingStore = new Proxy(
      {},
      {
        get: (_t, prop) => () => {
          throw new Error(`ordinary edit must not touch the collab store (read: ${String(prop)})`);
        },
      },
    ) as CollabStore;

    const event = payloadFor({
      target_id: TARGET_ID,
      value: 0.6,
      field: 'value',
    }).event as never;

    const result = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: 0.6 }),
      event,
      requestId: 'req-plain-1',
      persistedGraph: buildPersistedGraph(),
      priorFacts: [],
      collabStore: explodingStore,
    });

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const observed = observedStateOf(result.graph);
    expect(observed?.value).toBe(0.6);
    expect(observed?.source).toBe('user_override');
    // Absence is DISTINCT and means "an ordinary edit", never "attribution lost".
    expect(observed?.elicited_from).toBeUndefined();
  });
});
