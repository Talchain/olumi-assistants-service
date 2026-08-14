/**
 * INV-F at the apply seam — `verifyAppliedFrom`, the five server-side bindings.
 *
 * ── WHAT THESE TESTS ARE FOR ──────────────────────────────────────────────
 * `applied_from` is a claim a CLIENT makes about whose expertise a value came
 * from. If the server stamps it without checking, the product reproduces the
 * `append_turn_atomic_v4` defect class — attribution decided by the caller —
 * inside the one feature built to prove attribution is unforgeable. So the
 * load-bearing test in this file is not the happy path: it is the FORGERY
 * control. Without it, every positive assertion here would pass just as well
 * on a server that stamped whatever it was told.
 *
 * ── THE STORE DOUBLE ONLY IMPLEMENTS WHAT THE VERIFIER MAY READ ───────────
 * Every other `CollabStore` method throws. That is deliberate and it makes a
 * QUERY-SHAPE assertion, the same technique the blindness suite uses on the
 * open packet: if `verifyAppliedFrom` ever reaches for the roster, a token
 * hash, or a model version, these tests go RED rather than quietly passing on
 * a widened read. A verifier that fetched everything and checked a subset
 * would behave identically today and be a defect tomorrow.
 *
 * ── INVARIANTS ARE WRITTEN AGAINST THE SPEC, NOT THE SYMPTOM ──────────────
 * Each `it` names the BINDING it pins (a)–(e), and asserts the refusal CODE,
 * not merely that something threw. A test asserting "it throws" would pass
 * when the verifier refused for the wrong reason, which is how a binding
 * silently stops being checked while its test stays green.
 */

import { describe, expect, it } from 'vitest';

import { verifyAppliedFrom } from '../apply-verification.js';
import {
  isCollabRefusal,
  type CollabParticipant,
  type CollabRound,
  type CollabStore,
  type ElicitationEventRow,
  type RoundStatus,
} from '../types.js';

/* ────────────────────────────────────────────────────────────────────────────
 * Fixture identities. Real UUIDs, distinct by construction, and NEVER reused
 * across roles — a fixture that recycles an id can make an identity-bound
 * assertion pass for the wrong reason (CLAUDE.md trap 19).
 * ──────────────────────────────────────────────────────────────────────────── */

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SCENARIO_ID = '22222222-2222-4222-8222-222222222222';
const ROUND_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ROUND_ID = '44444444-4444-4444-8444-444444444444';
const GRACE_ID = '55555555-5555-4555-8555-555555555555';
const ADA_ID = '66666666-6666-4666-8666-666666666666';

const TARGET_ID = 'fac_churn_risk';
const OTHER_TARGET_ID = 'fac_price_elasticity';

const GRACE_VALUE = 0.85;
const ADA_VALUE = 0.2;

function round(overrides: Partial<CollabRound> = {}): CollabRound {
  return {
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
    ...overrides,
  };
}

function participant(overrides: Partial<CollabParticipant> = {}): CollabParticipant {
  return {
    participant_id: GRACE_ID,
    scenario_id: SCENARIO_ID,
    round_id: ROUND_ID,
    display_name: 'Grace',
    supabase_user_id: null,
    token_hash: 'hash-grace',
    status: 'active',
    pseudonym: null,
    created_at: '2026-08-13T10:01:00.000Z',
    ...overrides,
  };
}

function beliefEvent(args: {
  participant_id: string;
  target_id?: string;
  value: number | null;
  event_version?: number;
  kind?: ElicitationEventRow['kind'];
  expression_raw?: string | null;
}): ElicitationEventRow {
  const kind = args.kind ?? 'belief_submitted';
  return {
    event_id: `evt-${args.participant_id}-${args.event_version ?? 1}-${args.target_id ?? TARGET_ID}`,
    round_id: ROUND_ID,
    participant_id: args.participant_id,
    event_version: args.event_version ?? 1,
    kind,
    target: { kind: 'factor', id: args.target_id ?? TARGET_ID },
    belief:
      kind === 'declined'
        ? null
        : {
            value: args.value,
            expression_raw: args.expression_raw ?? null,
            confidence: null,
          },
    provenance: {
      authored_by: args.participant_id,
      method: 'elicited_nl',
      elicitation_version: 'cee-belief-elicitation-v1',
    },
    created_at: '2026-08-13T10:05:00.000Z',
  };
}

/** Reads the verifier is ALLOWED to make. Everything else throws — see header. */
function makeStore(args: {
  rounds?: Record<string, CollabRound>;
  participants?: Record<string, CollabParticipant>;
  events?: readonly ElicitationEventRow[];
}): CollabStore {
  const forbidden = (name: string) => () => {
    throw new Error(
      `verifyAppliedFrom read \`${name}\`, which is outside the reads this seam may make. ` +
        `If that is intentional, widen this double CONSCIOUSLY and say why the new read is safe.`,
    );
  };

  return {
    getRound: async (id: string) => args.rounds?.[id] ?? null,
    getParticipant: async (id: string) => args.participants?.[id] ?? null,
    listAllRoundEvents: async (roundId: string) =>
      (args.events ?? []).filter((e) => e.round_id === roundId).map((e) => ({ ...e })),

    getScenarioOwnerUserId: forbidden('getScenarioOwnerUserId'),
    insertRound: forbidden('insertRound'),
    appendRoundEvent: forbidden('appendRoundEvent'),
    insertParticipant: forbidden('insertParticipant'),
    findActiveParticipantByTokenHash: forbidden('findActiveParticipantByTokenHash'),
    findParticipantByTokenHash: forbidden('findParticipantByTokenHash'),
    listParticipants: forbidden('listParticipants'),
    appendParticipantStatusEvent: forbidden('appendParticipantStatusEvent'),
    listOwnEvents: forbidden('listOwnEvents'),
    appendElicitationEvent: forbidden('appendElicitationEvent'),
    getModelValuesAtVersion: forbidden('getModelValuesAtVersion'),
    createModelVersion: forbidden('createModelVersion'),
    getScenarioCurrentModelVersionPointer: forbidden('getScenarioCurrentModelVersionPointer'),
    redactParticipantDisplayName: forbidden('redactParticipantDisplayName'),
    appendRedactionAuditRow: forbidden('appendRedactionAuditRow'),
    listRedactionAuditRows: forbidden('listRedactionAuditRows'),
  } as unknown as CollabStore;
}

/** The canonical healthy fixture: a closed round, Ada 0.2 and Grace 0.85. */
function healthyStore(overrides: { status?: RoundStatus } = {}): CollabStore {
  return makeStore({
    rounds: { [ROUND_ID]: round(overrides.status ? { status: overrides.status } : {}) },
    participants: {
      [GRACE_ID]: participant(),
      [ADA_ID]: participant({
        participant_id: ADA_ID,
        display_name: 'Ada',
        token_hash: 'hash-ada',
      }),
    },
    events: [
      beliefEvent({ participant_id: ADA_ID, value: ADA_VALUE }),
      beliefEvent({ participant_id: GRACE_ID, value: GRACE_VALUE }),
    ],
  });
}

/** Assert a refusal by CODE. `expect(...).rejects.toThrow()` would pass on any error. */
async function expectRefusal(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, 'expected a refusal, but the call resolved').toBeDefined();
  expect(isCollabRefusal(caught), `expected a typed CollabRefusal, got: ${String(caught)}`).toBe(
    true,
  );
  expect((caught as { code: string }).code).toBe(code);
}

describe('verifyAppliedFrom — the five server-side bindings', () => {
  it('HAPPY PATH: returns the SERVER-recorded value, bound to the named participant by identity', async () => {
    const verified = await verifyAppliedFrom(healthyStore(), {
      scenario_id: SCENARIO_ID,
      target_id: TARGET_ID,
      claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
      claimed_value: GRACE_VALUE,
    });

    expect(verified.value).toBe(GRACE_VALUE);
    expect(verified.participant_id).toBe(GRACE_ID);
    expect(verified.round_id).toBe(ROUND_ID);

    // Bound by identity, not by value: assert the returned participant is NOT
    // Ada. Without this, a verifier that returned the first matching row would
    // satisfy every assertion above whenever the two happened to agree.
    expect(verified.participant_id).not.toBe(ADA_ID);
  });

  it('(a) refuses a round belonging to a DIFFERENT scenario, and stamps nothing', async () => {
    const store = makeStore({
      rounds: { [ROUND_ID]: round({ scenario_id: OTHER_SCENARIO_ID }) },
      participants: { [GRACE_ID]: participant() },
      events: [beliefEvent({ participant_id: GRACE_ID, value: GRACE_VALUE })],
    });

    await expectRefusal(
      verifyAppliedFrom(store, {
        scenario_id: SCENARIO_ID,
        target_id: TARGET_ID,
        claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
        claimed_value: GRACE_VALUE,
      }),
      'collab_apply_scenario_mismatch',
    );
  });

  it('(a) refuses an unknown round with the SAME code — the refusal is not an existence oracle', async () => {
    // Deliberate: "no such round" and "not this scenario's round" must be
    // indistinguishable, or the refusal can be used to probe which round ids
    // exist. Pinned so a later "helpful" split is a conscious change.
    await expectRefusal(
      verifyAppliedFrom(makeStore({}), {
        scenario_id: SCENARIO_ID,
        target_id: TARGET_ID,
        claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
        claimed_value: GRACE_VALUE,
      }),
      'collab_apply_scenario_mismatch',
    );
  });

  it('(b) refuses a participant who belongs to a DIFFERENT round', async () => {
    const store = makeStore({
      rounds: { [ROUND_ID]: round() },
      participants: { [GRACE_ID]: participant({ round_id: OTHER_ROUND_ID }) },
      events: [beliefEvent({ participant_id: GRACE_ID, value: GRACE_VALUE })],
    });

    await expectRefusal(
      verifyAppliedFrom(store, {
        scenario_id: SCENARIO_ID,
        target_id: TARGET_ID,
        claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
        claimed_value: GRACE_VALUE,
      }),
      'collab_not_a_participant',
    );
  });

  it('(b) refuses a participant id that does not exist at all', async () => {
    const store = makeStore({
      rounds: { [ROUND_ID]: round() },
      participants: {},
      events: [],
    });

    await expectRefusal(
      verifyAppliedFrom(store, {
        scenario_id: SCENARIO_ID,
        target_id: TARGET_ID,
        claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
        claimed_value: GRACE_VALUE,
      }),
      'collab_not_a_participant',
    );
  });

  it('(c) refuses when the participant answered a DIFFERENT factor — target binding is by id', async () => {
    // Grace answered, and answered with exactly the claimed number — but about
    // another factor. A verifier that matched on participant + value alone
    // would accept this and stamp a real person's estimate onto a factor they
    // never spoke about. This is the target half of trap 19.
    const store = makeStore({
      rounds: { [ROUND_ID]: round() },
      participants: { [GRACE_ID]: participant() },
      events: [
        beliefEvent({
          participant_id: GRACE_ID,
          target_id: OTHER_TARGET_ID,
          value: GRACE_VALUE,
        }),
      ],
    });

    await expectRefusal(
      verifyAppliedFrom(store, {
        scenario_id: SCENARIO_ID,
        target_id: TARGET_ID,
        claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
        claimed_value: GRACE_VALUE,
      }),
      'collab_apply_no_stated_value',
    );
  });

  it('(d) refuses while the round is still OPEN — nobody applies what nobody may see', async () => {
    await expectRefusal(
      verifyAppliedFrom(healthyStore({ status: 'open' }), {
        scenario_id: SCENARIO_ID,
        target_id: TARGET_ID,
        claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
        claimed_value: GRACE_VALUE,
      }),
      'collab_apply_round_not_applyable',
    );
  });

  it('(d) refuses a DRAFT round', async () => {
    await expectRefusal(
      verifyAppliedFrom(healthyStore({ status: 'draft' }), {
        scenario_id: SCENARIO_ID,
        target_id: TARGET_ID,
        claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
        claimed_value: GRACE_VALUE,
      }),
      'collab_apply_round_not_applyable',
    );
  });

  it('(d) ADMITS every status the reveal admits — derived from the reveal gate, not restated', async () => {
    // `assembleRevealView` refuses only 'draft' and 'open'. Applying is
    // downstream of revealing, so the applyable set must equal the revealable
    // set: if these diverged, the product would render a row and its button and
    // then refuse the click. Both post-closed statuses are pre-minted with no
    // writer today ('recorded' is Paul-deferred), so this test is what keeps
    // the two gates aligned if that transition later lands.
    for (const status of ['closed', 'adjudicating', 'recorded'] as const) {
      const verified = await verifyAppliedFrom(healthyStore({ status }), {
        scenario_id: SCENARIO_ID,
        target_id: TARGET_ID,
        claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
        claimed_value: GRACE_VALUE,
      });
      expect(verified.value, `status ${status} should be applyable`).toBe(GRACE_VALUE);
    }
  });

  it('(e) ⭐ INV-F FORGERY CONTROL: refuses a claim whose value nobody stated', async () => {
    // THE test in this file. A forged claim names a real participant on a real
    // closed round for a real target — and a value they never gave. Every other
    // assertion here would pass on a server that stamped whatever it was told;
    // only this one can tell the difference.
    await expectRefusal(
      verifyAppliedFrom(healthyStore(), {
        scenario_id: SCENARIO_ID,
        target_id: TARGET_ID,
        claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
        claimed_value: 0.99,
      }),
      'collab_apply_value_mismatch',
    );
  });

  it("(e) ⭐ refuses attributing ADA's number to GRACE — the attribution-swap forgery", async () => {
    // The subtlest forgery, and the one a value-based lookup would wave
    // through: both numbers are genuine and both people are on the round; only
    // the PAIRING is false. If this passed, the canvas would say "Grace's 0.2".
    await expectRefusal(
      verifyAppliedFrom(healthyStore(), {
        scenario_id: SCENARIO_ID,
        target_id: TARGET_ID,
        claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
        claimed_value: ADA_VALUE,
      }),
      'collab_apply_value_mismatch',
    );
  });

  it('(e) refuses a SUPERSEDED value — the fold is latest-per-participant', async () => {
    // Grace submitted 0.5 and revised to 0.85. Applying the revision succeeds;
    // applying the superseded original is refused. This binds the verifier to
    // the SAME fold the reveal uses (`foldLatestPerParticipant`, imported, not
    // reimplemented) — if the two ever disagreed, the owner would click a
    // number the screen showed and be refused.
    const store = makeStore({
      rounds: { [ROUND_ID]: round() },
      participants: { [GRACE_ID]: participant() },
      events: [
        beliefEvent({ participant_id: GRACE_ID, value: 0.5, event_version: 1 }),
        beliefEvent({
          participant_id: GRACE_ID,
          value: GRACE_VALUE,
          event_version: 2,
          kind: 'belief_revised',
        }),
      ],
    });

    const verified = await verifyAppliedFrom(store, {
      scenario_id: SCENARIO_ID,
      target_id: TARGET_ID,
      claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
      claimed_value: GRACE_VALUE,
    });
    expect(verified.value).toBe(GRACE_VALUE);

    await expectRefusal(
      verifyAppliedFrom(store, {
        scenario_id: SCENARIO_ID,
        target_id: TARGET_ID,
        claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
        claimed_value: 0.5,
      }),
      'collab_apply_value_mismatch',
    );
  });

  it('(c/e) refuses a participant who DECLINED — a declination is not a number', async () => {
    const store = makeStore({
      rounds: { [ROUND_ID]: round() },
      participants: { [GRACE_ID]: participant() },
      events: [beliefEvent({ participant_id: GRACE_ID, value: null, kind: 'declined' })],
    });

    await expectRefusal(
      verifyAppliedFrom(store, {
        scenario_id: SCENARIO_ID,
        target_id: TARGET_ID,
        claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
        claimed_value: GRACE_VALUE,
      }),
      'collab_apply_no_stated_value',
    );
  });

  it('(c/e) refuses a belief carrying words but NO number', async () => {
    // Distinct from a declination and from "never asked", and all three are
    // honestly one refusal to the owner — who can see which on the reveal.
    const store = makeStore({
      rounds: { [ROUND_ID]: round() },
      participants: { [GRACE_ID]: participant() },
      events: [
        beliefEvent({
          participant_id: GRACE_ID,
          value: null,
          expression_raw: 'I really could not say',
        }),
      ],
    });

    await expectRefusal(
      verifyAppliedFrom(store, {
        scenario_id: SCENARIO_ID,
        target_id: TARGET_ID,
        claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
        claimed_value: GRACE_VALUE,
      }),
      'collab_apply_no_stated_value',
    );
  });

  it('preserves EVERY dissenting response — verification is a pure read, it mutates nothing', async () => {
    // Paul's ruling 3: no averages, no consensus, no winner, and the minority
    // view is structurally un-erasable. The store double's write methods all
    // throw, so a verifier that tried to record, fold away or mark-as-resolved
    // any response would fail here rather than quietly shrinking the reveal.
    const events = [
      beliefEvent({ participant_id: ADA_ID, value: ADA_VALUE }),
      beliefEvent({ participant_id: GRACE_ID, value: GRACE_VALUE }),
    ];
    const store = makeStore({
      rounds: { [ROUND_ID]: round() },
      participants: { [GRACE_ID]: participant(), [ADA_ID]: participant({ participant_id: ADA_ID }) },
      events,
    });

    await verifyAppliedFrom(store, {
      scenario_id: SCENARIO_ID,
      target_id: TARGET_ID,
      claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
      claimed_value: GRACE_VALUE,
    });

    const after = await store.listAllRoundEvents(ROUND_ID);
    expect(after).toHaveLength(2);
    // Ada's dissent survives applying Grace's number, verbatim and attributed.
    const ada = after.find((e) => e.participant_id === ADA_ID);
    expect(ada?.belief?.value).toBe(ADA_VALUE);
    // And no aggregate was invented anywhere: the midpoint must appear nowhere.
    const midpoint = (ADA_VALUE + GRACE_VALUE) / 2;
    expect(after.some((e) => e.belief?.value === midpoint)).toBe(false);
  });
});
