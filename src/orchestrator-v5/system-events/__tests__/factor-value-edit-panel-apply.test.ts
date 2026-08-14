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
import { RoundParticipantRefSchema } from '@talchain/schemas/boundary';

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

/**
 * A graph whose target factor is ALREADY stamped with a panel attribution — i.e.
 * the state the model is in after an apply, and the state a page reload loads.
 *
 * ⚠ THIS FIXTURE EXISTS BECAUSE ITS ABSENCE HID A REAL DEFECT. Every fixture in
 * the first version of this file started with NO `elicited_from`, so the
 * assertion `expect(elicited_from).toBeUndefined()` on the ordinary-edit path
 * passed VACUOUSLY: it was reading a field that had never been set, not a field
 * that had been correctly cleared. The corpus excluded the only class that could
 * fail — CLAUDE.md trap 13d: check what your corpus EXCLUDES, not what it covers.
 */
function graphAlreadyStampedByGrace(): unknown {
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: TARGET_ID,
        kind: 'factor',
        label: 'Churn risk after a price rise',
        provenance: 'user_set',
        observed_state: {
          value: GRACE_VALUE,
          source: 'panel_elicited',
          elicited_from: { round_id: ROUND_ID, participant_id: GRACE_ID },
        },
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
    // An ANSWER row carries no evidence. Written out rather than defaulted so a
    // fixture cannot drift into representing a row the DB's CHECK forbids.
    evidence: null,
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

  it('⭐ the attribution reaches the WIRE, not just the persisted graph', async () => {
    // "Visible consequence" is a claim about what the owner SEES on the turn
    // that produced it. The UI applicator spreads `graph_patch.after` into
    // `node.data.observedState`, so a snapshot that stopped at
    // value/raw_value/unit/cap would leave the canvas pill reading "AI
    // estimate" until a reload — the capability would be real and invisible.
    const event = payloadFor({
      target_id: TARGET_ID,
      value: GRACE_VALUE,
      field: 'value',
      applied_from: { round_id: ROUND_ID, participant_id: GRACE_ID },
    }).event as never;

    const result = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: GRACE_VALUE }),
      event,
      requestId: 'req-apply-wire',
      persistedGraph: buildPersistedGraph(),
      priorFacts: [],
      collabStore: closedRoundStore(),
    });

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;

    const fact = result.handlerFacts.find((f) => f.fact_type === 'set_factor_value') as
      | { result: { after: Record<string, unknown> } }
      | undefined;
    expect(fact, 'no set_factor_value fact was emitted').toBeDefined();
    expect(fact?.result.after.source).toBe('panel_elicited');
    expect(fact?.result.after.elicited_from).toEqual({
      round_id: ROUND_ID,
      participant_id: GRACE_ID,
    });
  });

  it('the ORDINARY edit wire payload is byte-unchanged — no source on `after`', async () => {
    // The paired negative. The widening is scoped to a verified apply; an
    // ordinary edit's `after` must not gain a field, because the UI already
    // stamps `user_override` locally and a changed payload would be a
    // behaviour change bought for nothing. Without this, M-style mutation of
    // the conditional into an unconditional stamp would go unnoticed.
    const event = payloadFor({ target_id: TARGET_ID, value: 0.6, field: 'value' }).event as never;
    const result = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: 0.6 }),
      event,
      requestId: 'req-plain-wire',
      persistedGraph: buildPersistedGraph(),
      priorFacts: [],
      collabStore: {} as CollabStore,
    });

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const fact = result.handlerFacts.find((f) => f.fact_type === 'set_factor_value') as
      | { result: { after: Record<string, unknown> } }
      | undefined;
    expect(fact?.result.after.source).toBeUndefined();
    expect(fact?.result.after.elicited_from).toBeUndefined();
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

  it('⭐⭐ APPLY-THEN-EDIT: retyping by hand CLEARS the prior attribution', async () => {
    // THE DEFECT THIS PINS, and it is the mirror of the one the slice exists to
    // end. Apply Grace's 0.85, then retype 0.5 by hand. Before the fix the node
    // kept `elicited_from: { participant_id: <Grace> }` alongside
    // `source: 'user_override'` — the owner's OWN number still carrying Grace's
    // identity, and the contract sanctions consumers keying identity off exactly
    // that field. The original defect mislabelled a colleague's number as the
    // owner's; this one mislabels the owner's number as a colleague's, and only
    // this one invents a quote.
    const applied = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: GRACE_VALUE }),
      event: payloadFor({
        target_id: TARGET_ID,
        value: GRACE_VALUE,
        field: 'value',
        applied_from: { round_id: ROUND_ID, participant_id: GRACE_ID },
      }).event as never,
      requestId: 'req-seq-1',
      persistedGraph: buildPersistedGraph(),
      priorFacts: [],
      collabStore: closedRoundStore(),
    });
    expect(applied.kind).toBe('mutated');
    if (applied.kind !== 'mutated') return;
    // PRECONDITION PINNED IN-TEST: the second edit is only meaningful if the
    // first one really did stamp. Without this the test could pass by starting
    // from an unstamped graph — the exact vacuity that hid the defect.
    expect(observedStateOf(applied.graph)?.elicited_from).toEqual({
      round_id: ROUND_ID,
      participant_id: GRACE_ID,
    });

    // Now the owner retypes a different number by hand. No applied_from.
    const retyped = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: 0.5 }),
      event: payloadFor({ target_id: TARGET_ID, value: 0.5, field: 'value' }).event as never,
      requestId: 'req-seq-2',
      persistedGraph: applied.mutatedGraph,
      priorFacts: [],
      collabStore: {} as CollabStore,
    });

    expect(retyped.kind).toBe('mutated');
    if (retyped.kind !== 'mutated') return;
    const obs = observedStateOf(retyped.graph);
    expect(obs?.value).toBe(0.5);
    expect(obs?.source).toBe('user_override');
    // The whole point: Grace's identity must be GONE, not merely overwritten.
    expect(obs?.elicited_from).toBeUndefined();
    expect('elicited_from' in (obs ?? {})).toBe(false);
  });

  it('⭐ RELOAD: an ordinary edit on an ALREADY-STAMPED persisted graph clears it', async () => {
    // The same defect reached the other way — not within one session, but on a
    // graph loaded from the store that was stamped on some earlier visit. This
    // is the shape a real user hits: apply on Monday, edit on Tuesday.
    const result = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: 0.3 }),
      event: payloadFor({ target_id: TARGET_ID, value: 0.3, field: 'value' }).event as never,
      requestId: 'req-reload-1',
      persistedGraph: graphAlreadyStampedByGrace(),
      priorFacts: [],
      collabStore: {} as CollabStore,
    });

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const obs = observedStateOf(result.graph);
    expect(obs?.value).toBe(0.3);
    expect(obs?.source).toBe('user_override');
    expect(obs?.elicited_from).toBeUndefined();
    expect('elicited_from' in (obs ?? {})).toBe(false);
  });

  it('a RE-APPLY on an already-stamped graph replaces the attribution, not merges it', async () => {
    // Ada's answer applied over Grace's. The stamp must name Ada and ONLY Ada —
    // a merge would leave a node claiming two authors for one number.
    const result = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: ADA_VALUE }),
      event: payloadFor({
        target_id: TARGET_ID,
        value: ADA_VALUE,
        field: 'value',
        applied_from: { round_id: ROUND_ID, participant_id: ADA_ID },
      }).event as never,
      requestId: 'req-reapply-1',
      persistedGraph: graphAlreadyStampedByGrace(),
      priorFacts: [],
      collabStore: closedRoundStore(),
    });

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const obs = observedStateOf(result.graph);
    expect(obs?.value).toBe(ADA_VALUE);
    expect(obs?.source).toBe('panel_elicited');
    expect(obs?.elicited_from).toEqual({ round_id: ROUND_ID, participant_id: ADA_ID });
    expect((obs?.elicited_from as { participant_id: string }).participant_id).not.toBe(GRACE_ID);
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

/* ══════════════════════════════════════════════════════════════════════════
 * 0.41.0 — THE CITATION REACHES THE GRAPH (insertion point C, the WRITE half).
 *
 * ⚠ WHY THIS SUITE EXISTS AT ALL, given binding (f) is already pinned next
 * door. `verifyAppliedFrom` proves a citation is TRUE; it writes nothing. A
 * verifier that returns a verified id which no writer stamps is the symptom
 * half of the fix — the model would still not record what moved it, and every
 * (f) test would stay green (CLAUDE.md trap 23: a fix validated against the
 * symptom's metric can kill the symptom and leave the defect alive). These
 * tests are the OUTCOME metric: what a later reader of the graph can ask.
 *
 * ⚠⚠ AND THE FIXTURE CONVENTION DELIBERATELY DIVERGES FROM THE (f) SUITE.
 * Binding (f)'s event ids are readable strings (`evt-ada-evidence-…`), which is
 * right for a pure verifier that parses nothing. But the value stamped here
 * lands in `observed_state.elicited_from.evidence_event_id`, and the shared
 * contract types that member as `Uuid.optional()` — DERIVED BY EXECUTION, not
 * from the `.d.ts`, which renders it as a bare `z.ZodString` and hides the
 * refinement. CEE's own `ObservedStateV3` is `.passthrough()` and would happily
 * persist a non-UUID, so a fixture inheriting the (f) convention would pass
 * here and be refused at the first consumer that parses strictly. The ids below
 * are UUIDs because the producer's are (`elicitation-append.ts:409`,
 * `crypto.randomUUID()` — the sole collab mint site), and the contract-parse
 * test at the end of this suite is what keeps that true.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Ada's evidence row. A UUID, because the real mint site produces one. */
const ADA_EVIDENCE_ID = '88888888-8888-4888-8888-888888888888';

function evidenceEvent(args: {
  participant_id: string;
  event_id?: string;
  target_id?: string;
}): ElicitationEventRow {
  return {
    event_id: args.event_id ?? ADA_EVIDENCE_ID,
    round_id: ROUND_ID,
    participant_id: args.participant_id,
    event_version: 1,
    kind: 'evidence_attached',
    target: { kind: 'factor', id: args.target_id ?? TARGET_ID },
    belief: null,
    evidence: {
      kind: 'note',
      body: 'Renewals held at 12% after the last rise.',
      url: null,
      stance: 'challenges',
      about_participant_id: null,
    },
    provenance: {
      authored_by: args.participant_id,
      method: 'elicited_nl',
      elicitation_version: 'cee-belief-elicitation-v1',
    },
    created_at: '2026-08-13T10:06:00.000Z',
  };
}

/** The closed round, plus one piece of evidence ADA attached. */
function closedRoundStoreWithAdaEvidence(extra: ElicitationEventRow[] = []): CollabStore {
  const base = closedRoundStore();
  const events = [
    beliefEvent(ADA_ID, ADA_VALUE),
    beliefEvent(GRACE_ID, GRACE_VALUE),
    evidenceEvent({ participant_id: ADA_ID }),
    ...extra,
  ];
  return {
    ...base,
    listAllRoundEvents: async () => events.map((e) => ({ ...e })),
  } as unknown as CollabStore;
}

function citedApplyEvent(evidence_event_id: string) {
  return payloadFor({
    target_id: TARGET_ID,
    value: GRACE_VALUE,
    field: 'value',
    applied_from: {
      round_id: ROUND_ID,
      participant_id: GRACE_ID,
      evidence_event_id,
    },
  }).event as never;
}

describe('factor_value_edit — 0.41.0, the CITED evidence reaches the graph', () => {
  it('⭐⭐ stamps the citation onto the persisted graph — GRACE’s number, because ADA challenged it', async () => {
    // THE ACCEPTANCE'S HEART, at the write half. The two identities differ on
    // purpose: a fixture where the evidence author and the applied participant
    // coincide would pass even under an author-equality constraint, and would
    // therefore prove nothing about the case the hop exists to deliver.
    const result = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: GRACE_VALUE }),
      event: citedApplyEvent(ADA_EVIDENCE_ID),
      requestId: 'req-cite-1',
      persistedGraph: buildPersistedGraph(),
      priorFacts: [],
      collabStore: closedRoundStoreWithAdaEvidence(),
    });

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;

    const observed = observedStateOf(result.graph);
    // Asserted as an EXACT object: a stamp that quietly gained a display name,
    // an author id, or the evidence body would RED here rather than ride along.
    // Ids only — a body or a name inside `scenarios.graph` sits beyond the reach
    // of the R-2 redaction routine.
    expect(observed?.elicited_from).toEqual({
      round_id: ROUND_ID,
      participant_id: GRACE_ID,
      evidence_event_id: ADA_EVIDENCE_ID,
    });
    // The citation names WHY, never WHOSE the number is.
    expect(observed?.source).toBe('panel_elicited');
    expect(observed?.value).toBe(GRACE_VALUE);
    expect(observed?.value).not.toBe(MODEL_VALUE_BEFORE);
    // The fixture is genuinely two people, and the stamp keeps them apart.
    expect(ADA_ID).not.toBe(GRACE_ID);
    expect((observed?.elicited_from as { participant_id: string }).participant_id).toBe(GRACE_ID);
  });

  it('⭐ the citation reaches the WIRE on the same turn, not only the persisted graph', async () => {
    // Same reasoning as the attribution's own wire test: the owner must see the
    // consequence on the turn that produced it. A citation visible only after a
    // reload makes "attributed change" a claim the product cannot honour when
    // it matters.
    const result = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: GRACE_VALUE }),
      event: citedApplyEvent(ADA_EVIDENCE_ID),
      requestId: 'req-cite-wire',
      persistedGraph: buildPersistedGraph(),
      priorFacts: [],
      collabStore: closedRoundStoreWithAdaEvidence(),
    });

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const fact = result.handlerFacts.find((f) => f.fact_type === 'set_factor_value') as
      | { result: { after: Record<string, unknown> } }
      | undefined;
    expect(fact, 'no set_factor_value fact was emitted').toBeDefined();
    expect(fact?.result.after.elicited_from).toEqual({
      round_id: ROUND_ID,
      participant_id: GRACE_ID,
      evidence_event_id: ADA_EVIDENCE_ID,
    });
  });

  it('an UNCITED apply stamps NO citation — the key is ABSENT, not present-and-undefined', async () => {
    // The paired negative, and the compatibility story in one assertion. Every
    // apply written before 0.41.0 and every ordinary one after it is uncited;
    // absence must read as "cited nothing", never as "the citation was lost".
    // `in` rather than `toBeUndefined` because a present-but-undefined key
    // survives structuredClone and object spreads while reading as PRESENT to
    // `Object.keys` — which is what a consumer enumerating provenance sees.
    const result = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: GRACE_VALUE }),
      event: payloadFor({
        target_id: TARGET_ID,
        value: GRACE_VALUE,
        field: 'value',
        applied_from: { round_id: ROUND_ID, participant_id: GRACE_ID },
      }).event as never,
      requestId: 'req-uncited-1',
      persistedGraph: buildPersistedGraph(),
      priorFacts: [],
      collabStore: closedRoundStoreWithAdaEvidence(),
    });

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const elicited = observedStateOf(result.graph)?.elicited_from as Record<string, unknown>;
    // PRECONDITION PINNED IN-TEST: the apply really did stamp an attribution,
    // so "no citation" is a fact about the citation and not about a write that
    // never happened. Without this the assertion below passes vacuously on a
    // refused edit.
    expect(elicited).toEqual({ round_id: ROUND_ID, participant_id: GRACE_ID });
    expect('evidence_event_id' in elicited).toBe(false);
  });

  it('⭐⭐ APPLY-CITING-THEN-EDIT: retyping by hand clears the CITATION with the identity', async () => {
    // The clear-on-ordinary-edit pin, extended to the new member. The mirror
    // untruth is worse here than for the identity alone: a retyped number still
    // carrying `evidence_event_id` claims the owner's own figure was motivated
    // by a colleague's specific piece of evidence — an invented causal story
    // about reasoning, not merely a mislabelled author.
    const applied = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: GRACE_VALUE }),
      event: citedApplyEvent(ADA_EVIDENCE_ID),
      requestId: 'req-cite-seq-1',
      persistedGraph: buildPersistedGraph(),
      priorFacts: [],
      collabStore: closedRoundStoreWithAdaEvidence(),
    });
    expect(applied.kind).toBe('mutated');
    if (applied.kind !== 'mutated') return;
    // PRECONDITION PINNED IN-TEST: the second edit is only meaningful if the
    // first really stamped a CITATION. The corpus that hid the original defect
    // excluded exactly this class — a fixture that was never stamped.
    expect(observedStateOf(applied.graph)?.elicited_from).toEqual({
      round_id: ROUND_ID,
      participant_id: GRACE_ID,
      evidence_event_id: ADA_EVIDENCE_ID,
    });

    const retyped = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: 0.5 }),
      event: payloadFor({ target_id: TARGET_ID, value: 0.5, field: 'value' }).event as never,
      requestId: 'req-cite-seq-2',
      persistedGraph: applied.mutatedGraph,
      priorFacts: [],
      collabStore: {} as CollabStore,
    });

    expect(retyped.kind).toBe('mutated');
    if (retyped.kind !== 'mutated') return;
    const obs = retyped.kind === 'mutated' ? observedStateOf(retyped.graph) : undefined;
    expect(obs?.value).toBe(0.5);
    expect(obs?.source).toBe('user_override');
    // The whole stamp goes, citation included — not the identity alone.
    expect('elicited_from' in (obs ?? {})).toBe(false);
    expect(JSON.stringify(obs)).not.toContain(ADA_EVIDENCE_ID);
  });

  it('⭐ REFUSES an apply citing evidence that is not on this round, and writes NOTHING', async () => {
    // Binding (f) reaching the real chain. Without this the verifier's refusal
    // is proven only in isolation, and a write half that ignored the thrown
    // refusal — or caught it and wrote anyway — would leave every (f) test
    // green while the graph took an unverified citation.
    const result = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: GRACE_VALUE }),
      event: citedApplyEvent('99999999-9999-4999-8999-999999999999'),
      requestId: 'req-cite-refuse',
      persistedGraph: buildPersistedGraph(),
      priorFacts: [],
      collabStore: closedRoundStoreWithAdaEvidence(),
    });

    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toBe('collab_apply_evidence_not_found');
    // "Writes nothing" asserted as the SHAPE that carries a write being absent,
    // never as the reason string merely looking right.
    expect('mutatedGraph' in result).toBe(false);
    expect(result.response.assistant_text).toContain("haven't changed anything");
  });

  it('⭐⭐ the stamped `elicited_from` satisfies the SHARED CONTRACT’s strict parse', async () => {
    // THE CROSS-REPO BINDING. CEE's own `ObservedStateV3` is `.passthrough()`
    // and does not declare `elicited_from` at all, so CEE cannot detect its own
    // malformed stamp: a non-UUID event id would persist here and be refused at
    // the first consumer that parses strictly — a silent poisoning discovered
    // in another repo, days later. This asserts the stamp against the schema the
    // CONSUMER actually enforces, so the producer is bound to the wire predicate
    // rather than to CEE's tolerance of it.
    const result = await applyFactorValueEdit({
      payload: payloadFor({ target_id: TARGET_ID, value: GRACE_VALUE }),
      event: citedApplyEvent(ADA_EVIDENCE_ID),
      requestId: 'req-cite-contract',
      persistedGraph: buildPersistedGraph(),
      priorFacts: [],
      collabStore: closedRoundStoreWithAdaEvidence(),
    });
    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;

    const elicited = observedStateOf(result.graph)?.elicited_from;
    const parsed = RoundParticipantRefSchema.safeParse(elicited);
    expect(
      parsed.success,
      `the stamp does not satisfy the published contract: ${
        parsed.success ? '' : JSON.stringify(parsed.error.issues)
      }`,
    ).toBe(true);
    if (parsed.success) expect(parsed.data.evidence_event_id).toBe(ADA_EVIDENCE_ID);

    // NEGATIVE CONTROL, in the same test: the parse must be capable of REFUSING.
    // Without it a schema that had silently become permissive would make the
    // assertion above pass while proving nothing (CLAUDE.md trap 13 — an
    // absence/validity probe needs a demonstrated presence of discrimination).
    expect(
      RoundParticipantRefSchema.safeParse({
        ...(elicited as Record<string, unknown>),
        fabricated_member_xyz: 'nope',
      }).success,
      'the contract parse accepted a fabricated member — it is not discriminating',
    ).toBe(false);
  });
});
