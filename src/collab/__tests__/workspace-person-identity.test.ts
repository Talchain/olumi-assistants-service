/**
 * COLLAB — WORKSPACE-SCOPED PERSON IDENTITY.
 *
 * ── WHAT THIS SUITE IS ACTUALLY FOR ───────────────────────────────────────
 * The capability is "a contribution durably belongs to a PERSON, across rounds".
 * The danger in building it is the mirror image: an identity change that
 * SILENTLY REATTRIBUTES someone's stated position to somebody else. A suite that
 * only tested the capability would pass on a build that merged two colleagues
 * called Sam into one person — so **every linking test here has an
 * opposite-direction twin that proves the link is NOT made**, and those twins are
 * the load-bearing half.
 *
 * The asymmetry that decides every default: failing to link UNDER-CLAIMS and is
 * recoverable; wrongly linking OVER-CLAIMS, is invisible, and corrupts the
 * reasoning record. Tests are written so the second one cannot pass quietly.
 *
 * ⚠ ASSERTIONS BIND BY IDENTITY. Person ids are distinct string constants,
 * deliberately NOT equal to any participant id, so a reader that confuses the
 * two id spaces fails rather than coincidentally agreeing (estate trap 19).
 */

import { describe, expect, it } from 'vitest';

import { mintParticipantToken } from '../participant-tokens.js';
import { assembleRevealView } from '../packet-read-model.js';
import { ownerPreview } from '../rounds-service.js';
import {
  identityScopeOf,
  isCollabRefusal,
  resolvePersonId,
  type CollabParticipant,
  type CollabRound,
  type CollabStore,
  type ElicitationEventRow,
} from '../types.js';
import { listWorkspacePeople, resolveClaimedPersonId } from '../workspace-people.js';

const SCENARIO = 'scenario-alpha';
const OTHER_SCENARIO = 'scenario-beta';
const ROUND_1 = 'round-0000-0001';
const ROUND_2 = 'round-0000-0002';
const OWNER = 'owner-user-id';

/** Distinct id spaces, on purpose — see the header. */
const GRACE_PERSON = 'person-grace-durable';
const SAM_A_PERSON = 'person-sam-the-first';
const SAM_B_PERSON = 'person-sam-the-second';

function participant(o: Partial<CollabParticipant> & { participant_id: string }): CollabParticipant {
  return {
    scenario_id: SCENARIO,
    round_id: ROUND_1,
    display_name: 'Someone',
    supabase_user_id: null,
    person_id: null,
    token_hash: `hash-${o.participant_id}`,
    status: 'active',
    pseudonym: null,
    created_at: '2026-08-19T10:00:00.000Z',
    ...o,
  };
}

function round(o: Partial<CollabRound> = {}): CollabRound {
  return {
    round_id: ROUND_1,
    scenario_id: SCENARIO,
    graph_version_ref: 'mv-1',
    target_manifest: [
      { target: { kind: 'factor', id: 'churn' }, label: 'Churn risk', description: null, unit: null },
    ],
    context_note: null,
    status: 'open',
    created_by: OWNER,
    created_at: '2026-08-19T09:00:00.000Z',
    ...o,
  };
}

function answer(o: {
  event_id: string;
  round_id: string;
  participant_id: string;
  value: number;
}): ElicitationEventRow {
  return {
    event_id: o.event_id,
    round_id: o.round_id,
    participant_id: o.participant_id,
    event_version: 1,
    kind: 'belief_submitted',
    target: { kind: 'factor', id: 'churn' },
    belief: { value: o.value, expression_raw: null, confidence: null },
    evidence: null,
    provenance: {
      authored_by: o.participant_id,
      method: 'elicited_numeric',
      elicitation_version: 'cee-belief-elicitation-v1',
    },
    created_at: '2026-08-19T11:00:00.000Z',
  };
}

interface StoreArgs {
  participants?: CollabParticipant[];
  rounds?: CollabRound[];
  events?: ElicitationEventRow[];
  scenarioOwner?: string | null;
}

/**
 * In-memory store. Unreached methods THROW rather than returning empty: a port
 * method that quietly answers `[]` turns "this path never asks" into "this path
 * asked and got nothing", and those are different claims.
 */
function makeStore(args: StoreArgs = {}): CollabStore & { calls: string[] } {
  const participants = [...(args.participants ?? [])];
  const rounds = args.rounds ?? [round()];
  const events = args.events ?? [];
  const calls: string[] = [];
  const deny =
    (name: string) =>
    (): never => {
      throw new Error(`store.${name} must not be reached here`);
    };

  return {
    calls,
    getRound: async (id) => {
      calls.push(`getRound:${id}`);
      return rounds.find((r) => r.round_id === id) ?? null;
    },
    getScenarioOwnerUserId: async (id) => {
      calls.push(`getScenarioOwnerUserId:${id}`);
      return args.scenarioOwner === undefined ? OWNER : args.scenarioOwner;
    },
    insertRound: deny('insertRound'),
    appendRoundEvent: deny('appendRoundEvent'),
    insertParticipant: async (row) => {
      calls.push(`insertParticipant:${row.participant_id}`);
      participants.push(row);
    },
    getParticipant: async (id) => participants.find((p) => p.participant_id === id) ?? null,
    findActiveParticipantByTokenHash: deny('findActiveParticipantByTokenHash'),
    findParticipantByTokenHash: deny('findParticipantByTokenHash'),
    listParticipants: async (round_id) => {
      calls.push(`listParticipants:${round_id}`);
      return participants.filter((p) => p.round_id === round_id);
    },
    listScenarioParticipants: async (scenario_id) => {
      calls.push(`listScenarioParticipants:${scenario_id}`);
      return participants.filter((p) => p.scenario_id === scenario_id);
    },
    appendParticipantStatusEvent: async () => {},
    listOwnEvents: async (_r, pid) => events.filter((e) => e.participant_id === pid),
    listAllRoundEvents: async (round_id) => events.filter((e) => e.round_id === round_id),
    appendElicitationEvent: deny('appendElicitationEvent'),
    getModelValuesAtVersion: async () => ({ churn: 0.4 }),
    createModelVersion: deny('createModelVersion'),
    getScenarioCurrentModelVersionPointer: deny('getScenarioCurrentModelVersionPointer'),
    redactParticipantDisplayName: deny('redactParticipantDisplayName'),
    appendRedactionAuditRow: deny('appendRedactionAuditRow'),
    listRedactionAuditRows: deny('listRedactionAuditRows'),
  };
}

const ownerActor = { kind: 'owner' as const, user_id: OWNER };

/* ══════════════════════════════════════════════════════════════════════════
 * 1. THE CAPABILITY — identity survives a round boundary
 * ══════════════════════════════════════════════════════════════════════════ */

describe('durable identity across rounds', () => {
  it('the same person on two rounds resolves to ONE person id, while keeping two distinct participant ids', async () => {
    const store = makeStore({
      participants: [
        participant({
          participant_id: 'p-r1-grace',
          round_id: ROUND_1,
          display_name: 'Grace',
          person_id: GRACE_PERSON,
        }),
        participant({
          participant_id: 'p-r2-grace',
          round_id: ROUND_2,
          display_name: 'Grace',
          person_id: GRACE_PERSON,
          created_at: '2026-08-20T10:00:00.000Z',
        }),
      ],
    });

    const people = await listWorkspacePeople(store, { scenario_id: SCENARIO, actor: ownerActor });

    expect(people).toHaveLength(1);
    // Bound by IDENTITY, not by "there is one entry with round_count 2".
    const grace = people.find((p) => p.person_id === GRACE_PERSON);
    expect(grace).toBeDefined();
    expect(grace?.round_count).toBe(2);

    // ⚠ AND THE HALF THAT MATTERS: the participant grain is UNCHANGED. Durable
    // identity is additive; it must not collapse the two rows the events point at.
    const rows = await store.listScenarioParticipants(SCENARIO);
    expect(new Set(rows.map((r) => r.participant_id)).size).toBe(2);
  });

  it('the reveal carries the person id WITHOUT displacing participant_id as the attribution grain', async () => {
    const store = makeStore({
      rounds: [round({ status: 'closed' })],
      participants: [
        participant({ participant_id: 'p-r1-grace', display_name: 'Grace', person_id: GRACE_PERSON }),
      ],
      events: [answer({ event_id: 'e1', round_id: ROUND_1, participant_id: 'p-r1-grace', value: 0.85 })],
    });

    const view = await assembleRevealView(store, { round_id: ROUND_1, requested_by: ownerActor });
    const row = view.per_target[0]?.responses.find((r) => r.participant_id === 'p-r1-grace');

    expect(row).toBeDefined();
    expect(row?.person_id).toBe(GRACE_PERSON);
    // The event's own provenance is untouched and still names the participant.
    expect(row?.participant_id).toBe('p-r1-grace');
    expect(row?.value).toBe(0.85);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. ⭐ THE OPPOSITE-DIRECTION TWINS — the link must NOT be made
 * ══════════════════════════════════════════════════════════════════════════ */

describe('identity is never inferred (the inverse failure)', () => {
  it('two DIFFERENT people sharing a display name stay two people — a name is not a person', async () => {
    const store = makeStore({
      participants: [
        participant({
          participant_id: 'p-r1-sam',
          round_id: ROUND_1,
          display_name: 'Sam',
          person_id: SAM_A_PERSON,
        }),
        participant({
          participant_id: 'p-r2-sam',
          round_id: ROUND_2,
          display_name: 'Sam',
          person_id: SAM_B_PERSON,
          created_at: '2026-08-20T10:00:00.000Z',
        }),
      ],
    });

    const people = await listWorkspacePeople(store, { scenario_id: SCENARIO, actor: ownerActor });

    // If this ever reads 1, the product has silently merged two colleagues and
    // is about to attribute one Sam's position to the other.
    expect(people).toHaveLength(2);
    expect(people.map((p) => p.person_id).sort()).toEqual([SAM_A_PERSON, SAM_B_PERSON].sort());
    for (const person of people) expect(person.round_count).toBe(1);
  });

  it('minting with NO person id creates a NEW person, even when the name already exists in the scenario', async () => {
    const store = makeStore({
      participants: [
        participant({ participant_id: 'p-r1-sam', display_name: 'Sam', person_id: SAM_A_PERSON }),
      ],
    });

    const resolved = await resolveClaimedPersonId(store, {
      scenario_id: SCENARIO,
      claimed_person_id: null,
    });
    // null = "mint a fresh identity". A name-matching implementation would
    // return SAM_A_PERSON here and quietly fuse two humans.
    expect(resolved).toBeNull();

    const minted = await mintParticipantToken(store, {
      round_id: ROUND_2,
      scenario_id: SCENARIO,
      display_name: 'Sam',
      person_id: resolved,
      actor: ownerActor,
    });

    expect(minted.participant.person_id).not.toBe(SAM_A_PERSON);
    expect(minted.participant.person_id).toBeTruthy();
    // And not accidentally equal to the participant id either — separate spaces.
    expect(minted.participant.person_id).not.toBe(minted.participant.participant_id);
  });

  it('a person id from ANOTHER scenario is refused, not silently minted as new', async () => {
    const store = makeStore({
      participants: [
        // Lives in a different scenario entirely — a harvested id.
        participant({
          participant_id: 'p-other',
          scenario_id: OTHER_SCENARIO,
          display_name: 'Grace',
          person_id: GRACE_PERSON,
        }),
      ],
    });

    await expect(
      resolveClaimedPersonId(store, {
        scenario_id: SCENARIO,
        claimed_person_id: GRACE_PERSON,
      }),
    ).rejects.toSatisfy(
      (err: unknown) => isCollabRefusal(err) && err.code === 'collab_payload_invalid',
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. MIGRATION SAFETY — existing contributions keep their author
 * ══════════════════════════════════════════════════════════════════════════ */

describe('rows without a person id (pre-migration, or a database where it has not run)', () => {
  it('resolve to their OWN participant id — never null, never a shared sentinel', () => {
    const a = participant({ participant_id: 'p-a', person_id: null });
    const b = participant({ participant_id: 'p-b', person_id: null });

    expect(resolvePersonId(a)).toBe('p-a');
    expect(resolvePersonId(b)).toBe('p-b');
    // ⭐ THE WHOLE POINT: the fallback SPLITS, it never MERGES. A shared
    // fallback value would make every legacy contributor one person.
    expect(resolvePersonId(a)).not.toBe(resolvePersonId(b));
  });

  it('report identity_scope "round", so the degradation is visible rather than silent', () => {
    expect(identityScopeOf(participant({ participant_id: 'p-a', person_id: null }))).toBe('round');
    expect(identityScopeOf(participant({ participant_id: 'p-a', person_id: GRACE_PERSON }))).toBe(
      'workspace',
    );
    // An empty string is not an identity — it is a null wearing a costume.
    expect(identityScopeOf(participant({ participant_id: 'p-a', person_id: '  ' }))).toBe('round');
  });

  it('keep their author in the reveal: a legacy contribution is still attributed to the person who made it', async () => {
    const store = makeStore({
      rounds: [round({ status: 'closed' })],
      participants: [
        participant({ participant_id: 'p-legacy', display_name: 'Ada', person_id: null }),
      ],
      events: [answer({ event_id: 'e1', round_id: ROUND_1, participant_id: 'p-legacy', value: 0.2 })],
    });

    const view = await assembleRevealView(store, { round_id: ROUND_1, requested_by: ownerActor });
    const row = view.per_target[0]?.responses.find((r) => r.participant_id === 'p-legacy');

    expect(row?.display_label).toBe('Ada');
    expect(row?.person_id).toBe('p-legacy');
    expect(row?.value).toBe(0.2);
  });

  it('are excluded from the workspace roster, because there is nothing durable to reuse', async () => {
    const store = makeStore({
      participants: [
        participant({ participant_id: 'p-legacy', display_name: 'Ada', person_id: null }),
        participant({ participant_id: 'p-new', display_name: 'Grace', person_id: GRACE_PERSON }),
      ],
    });

    const people = await listWorkspacePeople(store, { scenario_id: SCENARIO, actor: ownerActor });

    expect(people.map((p) => p.person_id)).toEqual([GRACE_PERSON]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. REDACTION — the person link must not undo R-1
 * ══════════════════════════════════════════════════════════════════════════ */

describe('a redacted participant', () => {
  it('is absent from the workspace roster, so a durable id cannot re-identify them', async () => {
    const store = makeStore({
      participants: [
        // The DB routine nulls person_id alongside supabase_user_id; this row is
        // the post-redaction shape.
        participant({
          participant_id: 'p-erased',
          display_name: 'Participant 9f2a1c04',
          pseudonym: 'Participant 9f2a1c04',
          person_id: null,
        }),
        participant({ participant_id: 'p-grace', display_name: 'Grace', person_id: GRACE_PERSON }),
      ],
    });

    const people = await listWorkspacePeople(store, { scenario_id: SCENARIO, actor: ownerActor });

    expect(people.map((p) => p.person_id)).toEqual([GRACE_PERSON]);
    expect(people.some((p) => p.display_name.includes('Participant 9f2a1c04'))).toBe(false);
  });

  it('is still excluded even if a person id somehow survives on the row — the pseudonym is the test', async () => {
    // Defence in depth: if a future writer forgets the SQL half, the service
    // half must still refuse to offer an erased person for reuse.
    const store = makeStore({
      participants: [
        participant({
          participant_id: 'p-erased',
          display_name: 'Participant 9f2a1c04',
          pseudonym: 'Participant 9f2a1c04',
          person_id: GRACE_PERSON,
        }),
      ],
    });

    const people = await listWorkspacePeople(store, { scenario_id: SCENARIO, actor: ownerActor });
    expect(people).toEqual([]);

    await expect(
      resolveClaimedPersonId(store, { scenario_id: SCENARIO, claimed_person_id: GRACE_PERSON }),
    ).rejects.toSatisfy(
      (err: unknown) => isCollabRefusal(err) && err.code === 'collab_payload_invalid',
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. THE BLINDNESS BOUNDARY — a cross-round read must not reach the panel
 * ══════════════════════════════════════════════════════════════════════════ */

describe('INV-A is not weakened by the new cross-round read', () => {
  it('the owner preview reports person identity without ever asking for other rounds', async () => {
    const store = makeStore({
      participants: [
        participant({ participant_id: 'p-grace', display_name: 'Grace', person_id: GRACE_PERSON }),
        participant({ participant_id: 'p-legacy', display_name: 'Ada', person_id: null }),
      ],
    });

    const preview = await ownerPreview(store, { round_id: ROUND_1, actor: ownerActor });

    const grace = preview.roster.find((r) => r.participant_id === 'p-grace');
    const ada = preview.roster.find((r) => r.participant_id === 'p-legacy');
    expect(grace?.person_id).toBe(GRACE_PERSON);
    expect(grace?.identity_scope).toBe('workspace');
    expect(ada?.person_id).toBe('p-legacy');
    expect(ada?.identity_scope).toBe('round');

    // ⭐ THE QUERY-SHAPE ASSERTION. The preview is round-scoped, so the
    // scenario-wide read must never appear in its call log — a filtered
    // cross-round read would satisfy every value assertion above and still be
    // the defect.
    expect(store.calls.some((c) => c.startsWith('listScenarioParticipants'))).toBe(false);
    expect(store.calls).toContain(`listParticipants:${ROUND_1}`);
  });

  it('the reveal likewise never crosses a round boundary to resolve identity', async () => {
    const store = makeStore({
      rounds: [round({ status: 'closed' })],
      participants: [
        participant({ participant_id: 'p-grace', display_name: 'Grace', person_id: GRACE_PERSON }),
      ],
      events: [answer({ event_id: 'e1', round_id: ROUND_1, participant_id: 'p-grace', value: 0.5 })],
    });

    await assembleRevealView(store, { round_id: ROUND_1, requested_by: ownerActor });

    expect(store.calls.some((c) => c.startsWith('listScenarioParticipants'))).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. THE OWNER CHECK on the new route's service
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the workspace roster is owner-only', () => {
  it('refuses a participant actor', async () => {
    const store = makeStore();
    await expect(
      listWorkspacePeople(store, {
        scenario_id: SCENARIO,
        actor: { kind: 'participant', participant_id: 'p-grace' },
      }),
    ).rejects.toSatisfy(
      (err: unknown) => isCollabRefusal(err) && err.code === 'collab_owner_only',
    );
  });

  it('refuses an owner who does not own the scenario, with the same code as "no such scenario"', async () => {
    const store = makeStore({ scenarioOwner: 'somebody-else' });
    await expect(
      listWorkspacePeople(store, { scenario_id: SCENARIO, actor: ownerActor }),
    ).rejects.toSatisfy(
      (err: unknown) => isCollabRefusal(err) && err.code === 'collab_owner_only',
    );
  });

  it('refuses a guest scenario', async () => {
    const store = makeStore({ scenarioOwner: null });
    await expect(
      listWorkspacePeople(store, { scenario_id: SCENARIO, actor: ownerActor }),
    ).rejects.toSatisfy(
      (err: unknown) => isCollabRefusal(err) && err.code === 'collab_guest_scenario',
    );
  });
});
