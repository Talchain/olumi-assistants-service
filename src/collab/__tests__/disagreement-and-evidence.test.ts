/**
 * COLLAB — evidence attach, and the disagreement read model.
 *
 * ── THE LOAD-BEARING SUITE IS THE FIRST BLOCK, NOT THE HAPPY PATH ─────────
 * Adding a non-answer kind to the elicitation log splits one question into two
 * under one name: `foldLatestPerParticipant` used to answer "this participant's
 * latest EVENT for this target", which equalled "latest ANSWER" only while
 * every kind was an answer. The `answer fold` block below is what proves the
 * fold now answers the second question, and its mutant is the whole reason to
 * trust the rest of this file: without it, Grace answering 0.85 and then
 * attaching a supporting link would blank her number on the reveal and make
 * `verifyAppliedFrom` refuse a legitimate apply — the product punishing the
 * person who supplied MORE reasoning, silently, under a green suite.
 *
 * ── ASSERTIONS BIND BY IDENTITY ───────────────────────────────────────────
 * Every positional assertion finds its row by `participant_id`/`event_id` and
 * asserts the refusal CODE rather than that something threw. Two fixture people
 * deliberately give DIFFERENT numbers so no assertion can pass on the wrong row
 * (CLAUDE.md trap 19), and the aligned-shape fixture uses a third target rather
 * than reusing values from the split one.
 *
 * ── THE STORE DOUBLE ONLY IMPLEMENTS WHAT MAY BE READ ─────────────────────
 * Same technique as `apply-verification.test.ts`: every other method throws, so
 * a projection that widened its reads goes RED rather than passing quietly on a
 * read it should not be making.
 */

import { describe, expect, it } from 'vitest';

import {
  DISSENT_SURVIVES_APPLY,
  FORBIDDEN_RESOLUTION_WORDS,
  POSITIONS_NOT_COMBINED,
  SANCTIONED_NEGATIONS,
  STANDING_SENTENCES,
  divergenceHeadline,
  interrogationQuestion,
  stripSanctionedNegations,
  type DisagreementFacts,
  type DivergenceShape,
} from '../disagreement-copy.js';
import {
  assembleDisagreementView,
  classifyDivergence,
  summariseDisagreementForPrompt,
} from '../disagreement-read-model.js';
import { appendParticipantEvent, validateEventPayload } from '../elicitation-append.js';
import { assembleOpenPacket, assembleRevealView } from '../packet-read-model.js';
import { verifyAppliedFrom } from '../apply-verification.js';
import {
  ELICITATION_ANSWER_KINDS,
  isAnswerKind,
  isCollabRefusal,
  type CollabParticipant,
  type CollabRound,
  type CollabStore,
  type ElicitationEventRow,
  type ElicitationEvidence,
  type RoundStatus,
} from '../types.js';

/* ────────────────────────────────────────────────────────────────────────────
 * Fixtures. Distinct UUIDs per role, never recycled.
 * ──────────────────────────────────────────────────────────────────────────── */

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const ROUND_ID = '33333333-3333-4333-8333-333333333333';
const GRACE_ID = '55555555-5555-4555-8555-555555555555';
const ADA_ID = '66666666-6666-4666-8666-666666666666';
const RUTH_ID = '77777777-7777-4777-8777-777777777777';
const STRANGER_ID = '88888888-8888-4888-8888-888888888888';

const TARGET_ID = 'fac_churn_risk';
const TARGET_LABEL = 'Churn risk after a price rise';
const ALIGNED_TARGET_ID = 'fac_lead_time';
const ALIGNED_LABEL = 'Supplier lead time in weeks';

const GRACE_VALUE = 0.85;
const ADA_VALUE = 0.2;
const RUTH_VALUE = 0.85; // ties Grace at the HIGH pole — both must be marked.

function round(overrides: Partial<CollabRound> = {}): CollabRound {
  return {
    round_id: ROUND_ID,
    scenario_id: SCENARIO_ID,
    graph_version_ref: 'mv-1',
    target_manifest: [
      { target: { kind: 'factor', id: TARGET_ID }, label: TARGET_LABEL, description: null, unit: null },
      {
        target: { kind: 'factor', id: ALIGNED_TARGET_ID },
        label: ALIGNED_LABEL,
        description: null,
        unit: null,
      },
    ],
    context_note: null,
    status: 'closed',
    created_by: 'owner-user',
    created_at: '2026-08-14T10:00:00.000Z',
    ...overrides,
  };
}

function participant(id: string, display_name: string, o: Partial<CollabParticipant> = {}): CollabParticipant {
  return {
    participant_id: id,
    scenario_id: SCENARIO_ID,
    round_id: ROUND_ID,
    display_name,
    supabase_user_id: null,
    token_hash: `hash-${display_name}`,
    status: 'active',
    pseudonym: null,
    created_at: '2026-08-14T10:01:00.000Z',
    ...o,
  };
}

function answer(args: {
  participant_id: string;
  value: number | null;
  target_id?: string;
  event_version?: number;
  kind?: 'belief_submitted' | 'belief_revised' | 'declined';
  expression_raw?: string | null;
  created_at?: string;
}): ElicitationEventRow {
  const kind = args.kind ?? 'belief_submitted';
  return {
    event_id: `evt-answer-${args.participant_id}-${args.event_version ?? 1}-${args.target_id ?? TARGET_ID}`,
    round_id: ROUND_ID,
    participant_id: args.participant_id,
    event_version: args.event_version ?? 1,
    kind,
    target: { kind: 'factor', id: args.target_id ?? TARGET_ID },
    belief:
      kind === 'declined'
        ? null
        : { value: args.value, expression_raw: args.expression_raw ?? null, confidence: null },
    evidence: null,
    provenance: {
      authored_by: args.participant_id,
      method: 'elicited_nl',
      elicitation_version: 'cee-belief-elicitation-v1',
    },
    created_at: args.created_at ?? '2026-08-14T10:05:00.000Z',
  };
}

function evidenceRow(args: {
  participant_id: string;
  event_id?: string;
  target_kind?: 'factor' | 'edge';
  target_id?: string;
  event_version?: number;
  created_at?: string;
  evidence?: Partial<ElicitationEvidence>;
}): ElicitationEventRow {
  return {
    event_id: args.event_id ?? `evt-evidence-${args.participant_id}`,
    round_id: ROUND_ID,
    participant_id: args.participant_id,
    event_version: args.event_version ?? 1,
    kind: 'evidence_attached',
    target: { kind: args.target_kind ?? 'factor', id: args.target_id ?? TARGET_ID },
    belief: null,
    evidence: {
      kind: 'note',
      body: 'Q3 cohort held at 12% after the last rise.',
      url: null,
      stance: 'supports',
      about_participant_id: null,
      ...args.evidence,
    },
    provenance: {
      authored_by: args.participant_id,
      method: 'elicited_nl',
      elicitation_version: 'cee-belief-elicitation-v1',
    },
    // LATER than every answer above: this is what makes the fold tests bite.
    created_at: args.created_at ?? '2026-08-14T11:00:00.000Z',
  };
}

function makeStore(args: {
  round?: CollabRound;
  participants?: readonly CollabParticipant[];
  events?: readonly ElicitationEventRow[];
  modelValues?: Record<string, number | null>;
}): CollabStore {
  const roster = args.participants ?? [
    participant(GRACE_ID, 'Grace'),
    participant(ADA_ID, 'Ada'),
    participant(RUTH_ID, 'Ruth'),
  ];
  const events = args.events ?? [];
  const deny = (name: string) => (): never => {
    throw new Error(`store.${name} must not be reached here`);
  };
  return {
    getRound: async (id) => (id === ROUND_ID ? (args.round ?? round()) : null),
    getParticipant: async (id) => roster.find((p) => p.participant_id === id) ?? null,
    listParticipants: async () => [...roster],
    listAllRoundEvents: async () => [...events],
    listOwnEvents: async (_r, pid) => events.filter((e) => e.participant_id === pid),
    getModelValuesAtVersion: async () => args.modelValues ?? { [TARGET_ID]: 0.5 },
    appendElicitationEvent: async () => undefined,
    getScenarioOwnerUserId: deny('getScenarioOwnerUserId'),
    insertRound: deny('insertRound'),
    appendRoundEvent: deny('appendRoundEvent'),
    insertParticipant: deny('insertParticipant'),
    findActiveParticipantByTokenHash: deny('findActiveParticipantByTokenHash'),
    findParticipantByTokenHash: deny('findParticipantByTokenHash'),
    appendParticipantStatusEvent: deny('appendParticipantStatusEvent'),
    createModelVersion: deny('createModelVersion'),
    getScenarioCurrentModelVersionPointer: deny('getScenarioCurrentModelVersionPointer'),
    redactParticipantDisplayName: deny('redactParticipantDisplayName'),
    appendRedactionAuditRow: deny('appendRedactionAuditRow'),
    listRedactionAuditRows: deny('listRedactionAuditRows'),
  } as CollabStore;
}

async function refusalCodeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (isCollabRefusal(err)) return err.code;
    return `not-a-refusal: ${String(err)}`;
  }
  return 'no-refusal-thrown';
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. THE ANSWER FOLD. The defect adding evidence would otherwise have shipped.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the answer fold survives a newer evidence row', () => {
  /**
   * Grace answers, THEN attaches evidence. Her evidence row is her newest row
   * for this target, and it carries a higher `event_version` than her answer
   * too — so an unscoped fold loses on BOTH ordering keys, not just on
   * recency. That double is deliberate: a fix that only re-ordered by
   * `created_at` would pass a recency-only fixture and still be wrong.
   */
  const eventsGraceThenEvidence = [
    answer({ participant_id: GRACE_ID, value: GRACE_VALUE, expression_raw: 'high, we lost 8% last time' }),
    answer({ participant_id: ADA_ID, value: ADA_VALUE, expression_raw: 'low, the contracts are annual' }),
    evidenceRow({ participant_id: GRACE_ID, event_version: 2 }),
  ];

  it('the reveal still shows the number the person actually gave', async () => {
    const view = await assembleRevealView(makeStore({ events: eventsGraceThenEvidence }), {
      round_id: ROUND_ID,
      requested_by: { kind: 'owner', user_id: 'owner-user' },
    });
    const target = view.per_target.find((t) => t.target.id === TARGET_ID);
    // BOUND BY IDENTITY: Grace's row, found by participant_id. A value predicate
    // would match Ruth in other fixtures in this file.
    const grace = target?.responses.find((r) => r.participant_id === GRACE_ID);
    expect(grace?.value).toBe(GRACE_VALUE);
    expect(grace?.kind).toBe('belief_submitted');
    expect(grace?.expression_raw).toBe('high, we lost 8% last time');
  });

  it('an evidence row never appears as a response on the reveal', async () => {
    const view = await assembleRevealView(makeStore({ events: eventsGraceThenEvidence }), {
      round_id: ROUND_ID,
      requested_by: { kind: 'owner', user_id: 'owner-user' },
    });
    const target = view.per_target.find((t) => t.target.id === TARGET_ID);
    // ONE row per participant, and neither of them is an evidence row.
    expect(target?.responses).toHaveLength(2);
    expect(target?.responses.map((r) => r.kind)).not.toContain('evidence_attached');
  });

  it('a legitimate apply is NOT refused because the person also attached evidence', async () => {
    // The user-visible half of the same defect: this is the owner clicking
    // "Use Grace's 0.85" after Grace supported it with a link.
    const verified = await verifyAppliedFrom(makeStore({ events: eventsGraceThenEvidence }), {
      scenario_id: SCENARIO_ID,
      target_id: TARGET_ID,
      claim: { round_id: ROUND_ID, participant_id: GRACE_ID },
      claimed_value: GRACE_VALUE,
    });
    expect(verified.value).toBe(GRACE_VALUE);
    expect(verified.participant_id).toBe(GRACE_ID);
  });

  it('a genuine revision still wins over the earlier answer', async () => {
    // ⭐ THE OTHER HALF OF THE DISCRIMINATING PAIR. The test above proves the
    // fold IGNORES non-answers; this proves it did not become inert and start
    // ignoring everything. A filter that dropped all later rows would pass the
    // first three tests and fail this one.
    const view = await assembleRevealView(
      makeStore({
        events: [
          answer({ participant_id: GRACE_ID, value: GRACE_VALUE, event_version: 1 }),
          evidenceRow({ participant_id: GRACE_ID, event_version: 1 }),
          answer({
            participant_id: GRACE_ID,
            value: 0.4,
            event_version: 2,
            kind: 'belief_revised',
            created_at: '2026-08-14T12:00:00.000Z',
          }),
        ],
      }),
      { round_id: ROUND_ID, requested_by: { kind: 'owner', user_id: 'owner-user' } },
    );
    const grace = view.per_target
      .find((t) => t.target.id === TARGET_ID)
      ?.responses.find((r) => r.participant_id === GRACE_ID);
    expect(grace?.value).toBe(0.4);
    expect(grace?.kind).toBe('belief_revised');
  });
});

describe('attaching evidence is not answering', () => {
  it('does not mark the target complete on the blind packet', async () => {
    const store = makeStore({
      round: round({ status: 'open' }),
      events: [evidenceRow({ participant_id: GRACE_ID })],
    });
    const packet = await assembleOpenPacket(store, {
      round_id: ROUND_ID,
      participant_id: GRACE_ID,
    });
    // She has contributed reasoning but has NOT given a number. A packet that
    // marked this done would let someone leave a round believing they had
    // answered.
    expect(packet.self.completed_target_ids).toEqual([]);
  });

  it('an actual answer still marks it complete', async () => {
    // The discriminating twin: proves the assertion above is about the KIND,
    // not about a completed-set that stopped working.
    const store = makeStore({
      round: round({ status: 'open' }),
      events: [answer({ participant_id: GRACE_ID, value: GRACE_VALUE })],
    });
    const packet = await assembleOpenPacket(store, {
      round_id: ROUND_ID,
      participant_id: GRACE_ID,
    });
    expect(packet.self.completed_target_ids).toEqual([TARGET_ID]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. THE APPEND SEAM.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('evidence validation', () => {
  const good = {
    kind: 'evidence_attached',
    target: { kind: 'factor', id: TARGET_ID },
    evidence: {
      kind: 'note',
      body: 'Churn held at 12% through the last rise.',
      url: null,
      stance: 'challenges',
      about_participant_id: null,
    },
  };

  it('accepts a well-formed note and keeps the words verbatim', () => {
    const out = validateEventPayload(good);
    expect(out.kind).toBe('evidence_attached');
    expect(out.belief).toBeNull();
    expect(out.evidence?.body).toBe('Churn held at 12% through the last rise.');
    expect(out.evidence?.stance).toBe('challenges');
  });

  it.each([
    ['javascript:alert(1)', 'a script scheme'],
    ['data:text/html,<script>alert(1)</script>', 'a data scheme'],
    ['vbscript:msgbox(1)', 'a vbscript scheme'],
    ['file:///etc/passwd', 'a file scheme'],
  ])('refuses %s (%s) as a link URL', (url) => {
    // ⚠ THE SECURITY CONTROL. This value is rendered as a clickable link on a
    // surface reachable with a bearer token; a stored script scheme is XSS
    // wearing a colleague's name.
    const code = (() => {
      try {
        validateEventPayload({ ...good, evidence: { ...good.evidence, kind: 'link', url } });
        return 'no-refusal-thrown';
      } catch (err) {
        return isCollabRefusal(err) ? err.code : 'not-a-refusal';
      }
    })();
    expect(code).toBe('collab_payload_invalid');
  });

  it('accepts an https link and stores the parsed form', () => {
    // The contrast control for the block above: proves those refusals are about
    // the SCHEME and not a link path that refuses everything.
    const out = validateEventPayload({
      ...good,
      evidence: { ...good.evidence, kind: 'link', url: 'https://example.com/churn-report' },
    });
    expect(out.evidence?.url).toBe('https://example.com/churn-report');
  });

  it('refuses an over-long body rather than truncating it', () => {
    const body = 'x'.repeat(4001);
    let thrown: unknown;
    try {
      validateEventPayload({ ...good, evidence: { ...good.evidence, body } });
    } catch (err) {
      thrown = err;
    }
    expect(isCollabRefusal(thrown)).toBe(true);
    // The point of the assertion is that nothing was STORED short: a truncating
    // implementation would return successfully with a 4000-char body.
    expect((thrown as { code?: string })?.code).toBe('collab_payload_invalid');
  });

  it('refuses a row that is both a belief and evidence', () => {
    expect(() =>
      validateEventPayload({
        ...good,
        belief: { value: 0.5, expression_raw: null, confidence: null },
      }),
    ).toThrow();
  });

  it('refuses evidence on a belief event', () => {
    expect(() =>
      validateEventPayload({
        kind: 'belief_submitted',
        target: { kind: 'factor', id: TARGET_ID },
        belief: { value: 0.5, expression_raw: null, confidence: null },
        evidence: good.evidence,
      }),
    ).toThrow();
  });

  it('refuses a note carrying a URL', () => {
    expect(() =>
      validateEventPayload({
        ...good,
        evidence: { ...good.evidence, kind: 'note', url: 'https://example.com' },
      }),
    ).toThrow();
  });

  it('refuses smuggled attribution on the evidence object', () => {
    // INV-F, at the new seam. The strict key allowlist is what refuses this.
    expect(() =>
      validateEventPayload({
        ...good,
        evidence: { ...good.evidence, authored_by: ADA_ID } as never,
      }),
    ).toThrow();
  });

  it('refuses an unknown stance', () => {
    expect(() =>
      validateEventPayload({ ...good, evidence: { ...good.evidence, stance: 'agrees' } }),
    ).toThrow();
  });
});

describe('appending evidence', () => {
  const openStore = (events: ElicitationEventRow[] = []) =>
    makeStore({ round: round({ status: 'open' }), events });

  it('stamps authored_by server-side from the resolved participant', async () => {
    const row = await appendParticipantEvent(openStore(), {
      round_id: ROUND_ID,
      participant: participant(GRACE_ID, 'Grace'),
      payload: {
        kind: 'evidence_attached',
        target: { kind: 'factor', id: TARGET_ID },
        belief: null,
        evidence: {
          kind: 'note',
          body: 'The Q3 cohort held.',
          url: null,
          stance: 'supports',
          about_participant_id: null,
        },
      },
    });
    // Bound by identity to GRACE, and asserted NOT to be the scenario owner —
    // the `append_turn_atomic_v4` defect class this feature exists to pin.
    expect(row.provenance.authored_by).toBe(GRACE_ID);
    expect(row.provenance.authored_by).not.toBe('owner-user');
    expect(row.evidence?.body).toBe('The Q3 cohort held.');
  });

  it('refuses an aimed claim naming someone who is not on this round', async () => {
    const code = await refusalCodeOf(() =>
      appendParticipantEvent(openStore(), {
        round_id: ROUND_ID,
        participant: participant(GRACE_ID, 'Grace'),
        payload: {
          kind: 'evidence_attached',
          target: { kind: 'factor', id: TARGET_ID },
          belief: null,
          evidence: {
            kind: 'note',
            body: 'aimed at a stranger',
            url: null,
            stance: 'challenges',
            about_participant_id: STRANGER_ID,
          },
        },
      }),
    );
    expect(code).toBe('collab_not_a_participant');
  });

  it('accepts an aimed claim naming a real participant on this round', async () => {
    // Contrast control for the refusal above.
    const row = await appendParticipantEvent(openStore(), {
      round_id: ROUND_ID,
      participant: participant(GRACE_ID, 'Grace'),
      payload: {
        kind: 'evidence_attached',
        target: { kind: 'factor', id: TARGET_ID },
        belief: null,
        evidence: {
          kind: 'note',
          body: 'Ada is reading annual contracts as renewal certainty.',
          url: null,
          stance: 'challenges',
          about_participant_id: ADA_ID,
        },
      },
    });
    expect(row.evidence?.about_participant_id).toBe(ADA_ID);
  });

  it('evidence does not inflate the answer version sequence', async () => {
    // ⭐ The fold orders answers by `event_version`. If evidence counted towards
    // it, a revision after two attachments would be version 4 — still monotonic,
    // so nothing breaks visibly, but the two halves of one mechanism would be
    // counting different populations. This pins them to the same one.
    const row = await appendParticipantEvent(
      openStore([
        answer({ participant_id: GRACE_ID, value: GRACE_VALUE, event_version: 1 }),
        evidenceRow({ participant_id: GRACE_ID, event_version: 1 }),
        evidenceRow({ participant_id: GRACE_ID, event_id: 'evt-evidence-2', event_version: 2 }),
      ]),
      {
        round_id: ROUND_ID,
        participant: participant(GRACE_ID, 'Grace'),
        payload: {
          kind: 'belief_revised',
          target: { kind: 'factor', id: TARGET_ID },
          belief: { value: 0.4, expression_raw: 'changed my mind', confidence: null },
          evidence: null,
        },
      },
    );
    expect(row.event_version).toBe(2);
  });

  it('refuses evidence once the round has closed', async () => {
    const code = await refusalCodeOf(() =>
      appendParticipantEvent(makeStore({ round: round({ status: 'closed' }) }), {
        round_id: ROUND_ID,
        participant: participant(GRACE_ID, 'Grace'),
        payload: {
          kind: 'evidence_attached',
          target: { kind: 'factor', id: TARGET_ID },
          belief: null,
          evidence: {
            kind: 'note',
            body: 'late',
            url: null,
            stance: 'supports',
            about_participant_id: null,
          },
        },
      }),
    );
    expect(code).toBe('collab_round_closed');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. THE DISAGREEMENT VIEW.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('classifyDivergence', () => {
  it.each([
    [[], 'no_answers'],
    [[0.5], 'single_view'],
    [[0.5, 0.5], 'aligned'],
    [[0.5, 0.5, 0.5], 'aligned'],
    [[0.2, 0.85], 'split'],
    [[0.85, 0.85, 0.2], 'split'],
  ] as Array<[number[], DivergenceShape]>)('classifies %j as %s', (values, expected) => {
    expect(classifyDivergence(values)).toBe(expected);
  });
});

describe('assembleDisagreementView', () => {
  const splitEvents = [
    answer({ participant_id: GRACE_ID, value: GRACE_VALUE, expression_raw: 'we lost 8% last time' }),
    answer({ participant_id: ADA_ID, value: ADA_VALUE, expression_raw: 'the contracts are annual' }),
    answer({ participant_id: RUTH_ID, value: RUTH_VALUE }),
    answer({ participant_id: GRACE_ID, value: 3, target_id: ALIGNED_TARGET_ID }),
    answer({ participant_id: ADA_ID, value: 3, target_id: ALIGNED_TARGET_ID }),
    evidenceRow({
      participant_id: ADA_ID,
      evidence: {
        kind: 'link',
        body: 'Renewal data for the last three rises.',
        url: 'https://example.com/renewals',
        stance: 'challenges',
        about_participant_id: GRACE_ID,
      },
    }),
  ];

  const view = () =>
    assembleDisagreementView(makeStore({ events: splitEvents }), {
      round_id: ROUND_ID,
      requested_by: { kind: 'owner', user_id: 'owner-user' },
    });

  it('names the shape of each target independently', async () => {
    const v = await view();
    expect(v.per_target.find((t) => t.target.id === TARGET_ID)?.shape).toBe('split');
    expect(v.per_target.find((t) => t.target.id === ALIGNED_TARGET_ID)?.shape).toBe('aligned');
  });

  it('reports the range endpoints and marks EVERY participant at an end', async () => {
    const t = (await view()).per_target.find((x) => x.target.id === TARGET_ID);
    expect(t?.spread).toEqual({ low: ADA_VALUE, high: GRACE_VALUE, width: GRACE_VALUE - ADA_VALUE });
    const poleOf = (pid: string) => t?.positions.find((p) => p.participant_id === pid)?.pole;
    // ⭐ Grace and Ruth TIE at the high end. A "first row holding the max"
    // implementation would mark one and silently leave the other unmarked —
    // naming one of two identical colleagues as the outlier.
    expect(poleOf(GRACE_ID)).toBe('high');
    expect(poleOf(RUTH_ID)).toBe('high');
    expect(poleOf(ADA_ID)).toBe('low');
  });

  it('counts only positions that stated a basis', async () => {
    const t = (await view()).per_target.find((x) => x.target.id === TARGET_ID);
    // Grace and Ada gave words; Ruth gave a bare number.
    expect(t?.positions_with_stated_basis).toBe(2);
    expect(t?.answering_participants).toBe(3);
    expect(t?.distinct_values).toBe(2);
  });

  it('carries each position with the words the person used, verbatim', async () => {
    const t = (await view()).per_target.find((x) => x.target.id === TARGET_ID);
    expect(t?.positions.find((p) => p.participant_id === ADA_ID)?.stated_basis).toBe(
      'the contracts are annual',
    );
    expect(t?.positions.find((p) => p.participant_id === RUTH_ID)?.stated_basis).toBeNull();
  });

  it('attributes evidence by the SERVER stamp and resolves who it is aimed at', async () => {
    const t = (await view()).per_target.find((x) => x.target.id === TARGET_ID);
    expect(t?.evidence).toHaveLength(1);
    const e = t?.evidence[0];
    expect(e?.authored_by).toBe(ADA_ID);
    expect(e?.author_label).toBe('Ada');
    expect(e?.about_participant_id).toBe(GRACE_ID);
    expect(e?.about_label).toBe('Grace');
    expect(e?.stance).toBe('challenges');
    expect(e?.url).toBe('https://example.com/renewals');
  });

  it('reads the SERVER stamp, not the row’s participant column', async () => {
    /**
     * ⭐ THIS TEST EXISTS BECAUSE OF AN EQUIVALENT-MUTANT RISK, AND IT REMOVES
     * IT. The append seam sets `provenance.authored_by === participant_id`, so
     * in every other fixture in this file the two are equal and a projection
     * reading either one passes identically — the mutant `authored_by →
     * participant_id` would have SURVIVED, and a survivor is a claim that must
     * be demonstrated, not assumed equivalent (CLAUDE.md 13c).
     *
     * `authored_by` is the field the contract makes unforgeable. Pulling the
     * two apart in a fixture is the only way to prove this surface is bound to
     * the guarantee rather than merely agreeing with it today.
     */
    const forged = evidenceRow({ participant_id: ADA_ID });
    const rowUnderTest: ElicitationEventRow = {
      ...forged,
      provenance: { ...forged.provenance, authored_by: RUTH_ID },
    };
    const v = await assembleDisagreementView(makeStore({ events: [rowUnderTest] }), {
      round_id: ROUND_ID,
      requested_by: { kind: 'owner', user_id: 'owner-user' },
    });
    const e = v.per_target.find((t) => t.target.id === TARGET_ID)?.evidence[0];
    expect(e?.authored_by).toBe(RUTH_ID);
    expect(e?.author_label).toBe('Ruth');
    // And explicitly NOT the other column, so the assertion cannot pass on a
    // projection that happened to pick the right value for the wrong reason.
    expect(e?.authored_by).not.toBe(ADA_ID);
  });

  it('does not attach one target’s evidence to another target', async () => {
    const t = (await view()).per_target.find((x) => x.target.id === ALIGNED_TARGET_ID);
    expect(t?.evidence).toEqual([]);
  });

  it('⭐ associates evidence by KIND + id — same-id edge evidence does not become the factor’s reason', async () => {
    const factorEvidence = evidenceRow({
      participant_id: ADA_ID,
      event_id: 'evt-factor-evidence-same-id-control',
    });
    const edgeForgery = evidenceRow({
      participant_id: RUTH_ID,
      event_id: 'evt-edge-evidence-same-id-forgery',
      target_kind: 'edge',
      target_id: TARGET_ID,
    });
    const v = await assembleDisagreementView(
      makeStore({ events: [factorEvidence, edgeForgery] }),
      { round_id: ROUND_ID, requested_by: { kind: 'owner', user_id: 'owner-user' } },
    );
    const evidence = v.per_target.find((t) => t.target.id === TARGET_ID)?.evidence;

    // Positive control and forgery control in one population: an inert filter
    // that removed both kinds cannot satisfy this exact identity assertion.
    expect(evidence?.map((e) => e.event_id)).toEqual([factorEvidence.event_id]);
    expect(evidence?.some((e) => e.event_id === edgeForgery.event_id)).toBe(false);
  });

  it('resolves a redacted author to the pseudonym, like the reveal', async () => {
    const v = await assembleDisagreementView(
      makeStore({
        events: splitEvents,
        participants: [
          participant(GRACE_ID, 'Grace'),
          participant(ADA_ID, 'Ada', { pseudonym: 'Participant 2' }),
          participant(RUTH_ID, 'Ruth'),
        ],
      }),
      { round_id: ROUND_ID, requested_by: { kind: 'owner', user_id: 'owner-user' } },
    );
    const e = v.per_target.find((t) => t.target.id === TARGET_ID)?.evidence[0];
    // R-1: the name detaches, the contribution stays — on evidence too, not
    // only on positions.
    expect(e?.author_label).toBe('Participant 2');
    expect(e?.body).toBe('Renewal data for the last three rises.');
  });

  it('refuses while the round is still open', async () => {
    const code = await refusalCodeOf(() =>
      assembleDisagreementView(makeStore({ round: round({ status: 'open' }), events: splitEvents }), {
        round_id: ROUND_ID,
        requested_by: { kind: 'owner', user_id: 'owner-user' },
      }),
    );
    // The gate is INHERITED from the reveal. If this ever returns a view, this
    // endpoint has become an early peek at a blind round.
    expect(code).toBe('collab_round_open');
  });

  it.each(['closed', 'adjudicating', 'recorded'] as RoundStatus[])(
    'admits a %s round, exactly as the reveal does',
    async (status) => {
      const v = await assembleDisagreementView(
        makeStore({ round: round({ status }), events: splitEvents }),
        { round_id: ROUND_ID, requested_by: { kind: 'owner', user_id: 'owner-user' } },
      );
      expect(v.per_target.length).toBeGreaterThan(0);
    },
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. THE COPY. Pinned, and proven incapable of resolving a disagreement.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the interrogation copy never resolves the disagreement', () => {
  /**
   * ⭐ EVERY STRING THE MODULE CAN EMIT, not a sample. The fact grid below is
   * the cartesian product over the members that steer the copy, so a branch
   * added later without a matching guard shows up here as an unchecked string
   * rather than passing silently.
   */
  const shapes: DivergenceShape[] = ['no_answers', 'single_view', 'aligned', 'split'];
  const factGrid: DisagreementFacts[] = [];
  for (const withStatedBasis of [0, 1, 3]) {
    for (const declined of [0, 2]) {
      for (const hasChallenge of [false, true]) {
        for (const evidenceCount of [0, 2]) {
          factGrid.push({
            label: TARGET_LABEL,
            answering: 3,
            distinctValues: 2,
            withStatedBasis,
            declined,
            evidenceCount,
            hasChallenge,
          });
        }
      }
    }
  }

  const everyString = (): string[] => {
    // ⭐ DERIVED FROM THE MODULE, not re-listed here. This was
    // `[DISSENT_SURVIVES_APPLY]`, so a standing sentence added beside it was
    // checked by nothing while this suite stayed green — the mirror defect,
    // inside the guard (CLAUDE.md trap 12). `STANDING_SENTENCES` is the one
    // place a new constant is registered, and it is the module's own list.
    const out: string[] = [...STANDING_SENTENCES];
    for (const shape of shapes) {
      for (const facts of factGrid) {
        out.push(divergenceHeadline(shape, facts));
        const q = interrogationQuestion(shape, facts);
        if (q !== null) out.push(q);
      }
    }
    return out;
  };

  it('emits a non-trivial number of distinct strings (the probe can see something)', () => {
    // Positive control. Without it, a `everyString()` that returned [] would
    // make every absence assertion below pass by testing nothing (trap 13).
    const distinct = new Set(everyString());
    expect(distinct.size).toBeGreaterThan(6);
  });

  it.each(FORBIDDEN_RESOLUTION_WORDS)('never says "%s" as a claim', (word) => {
    const offenders = everyString().filter((s) => stripSanctionedNegations(s).includes(word));
    expect(offenders).toEqual([]);
  });

  it.each(SANCTIONED_NEGATIONS)('the sanctioned negation "%s" is still actually used', (phrase) => {
    // ⭐ THIS IS WHAT STOPS THE CARVE-OUT ROTTING. A sanctioned phrase that no
    // copy emits any more is a hole with nothing in it — it would silently
    // permit the next sentence that happened to contain the same substring for
    // an entirely different reason. The set must be EXACT, not merely
    // sufficient, so it REDs when it shrinks as well as when it grows.
    expect(everyString().some((s) => s.toLowerCase().includes(phrase))).toBe(true);
  });

  it('the strip is narrow enough to still catch a real resolution claim', () => {
    // ⭐ THE DISCRIMINATING TWIN. Without this, a `stripSanctionedNegations`
    // that removed everything would make every assertion above pass by testing
    // nothing — the exact vacuity the strip was introduced to avoid.
    const wouldBeBad = 'The combined view is the recommended one.';
    const survived = FORBIDDEN_RESOLUTION_WORDS.filter((w) =>
      stripSanctionedNegations(wouldBeBad).includes(w),
    );
    expect(survived).toContain('combined');
    expect(survived).toContain('recommended');
  });

  it('never emits a number the product invented', () => {
    // Every numeral in the copy must have come from the facts. The grid uses
    // answering=3 and distinctValues=2, so those are the only digits allowed.
    const allowed = new Set(['3', '2']);
    for (const s of everyString()) {
      for (const digit of s.match(/\d/g) ?? []) {
        expect(allowed.has(digit)).toBe(true);
      }
    }
  });

  it('interrogates AGREEMENT as well as disagreement', () => {
    // The scientific point: independent convergence and a shared briefing look
    // identical in the numbers, so an aligned panel gets a question too.
    const q = interrogationQuestion('aligned', factGrid[0]);
    expect(q).not.toBeNull();
    expect(q?.toLowerCase()).toContain('independently');
  });

  it('says nothing at all when there is nothing to interrogate', () => {
    expect(interrogationQuestion('no_answers', factGrid[0])).toBeNull();
  });

  it('asks a different question when someone has challenged a position', () => {
    const withChallenge = { ...factGrid[0], hasChallenge: true, withStatedBasis: 3 };
    const without = { ...factGrid[0], hasChallenge: false, withStatedBasis: 3 };
    expect(interrogationQuestion('split', withChallenge)).not.toBe(
      interrogationQuestion('split', without),
    );
  });
});

describe('summariseDisagreementForPrompt', () => {
  const build = async () =>
    summariseDisagreementForPrompt(
      await assembleDisagreementView(
        makeStore({
          events: [
            answer({ participant_id: GRACE_ID, value: GRACE_VALUE, expression_raw: 'we lost 8% last time' }),
            answer({ participant_id: ADA_ID, value: ADA_VALUE, expression_raw: 'the contracts are annual' }),
            evidenceRow({
              participant_id: ADA_ID,
              evidence: {
                kind: 'link',
                body: 'Renewal data for the last three rises.',
                url: 'https://example.com/renewals',
                stance: 'challenges',
                about_participant_id: GRACE_ID,
              },
            }),
          ],
        }),
        { round_id: ROUND_ID, requested_by: { kind: 'owner', user_id: 'owner-user' } },
      ),
    );

  it('carries every position attributed, with the words each person used', async () => {
    const text = await build();
    expect(text).toContain('Grace: 0.85');
    expect(text).toContain('we lost 8% last time');
    expect(text).toContain('Ada: 0.2');
    expect(text).toContain('the contracts are annual');
  });

  it('carries evidence with its author, its stance and who it is about', async () => {
    const text = await build();
    expect(text).toContain("Evidence from Ada, challenges Grace's position");
    expect(text).toContain('https://example.com/renewals');
  });

  it('hands the model facts, never an instruction to adjudicate', async () => {
    // ⭐ THE LOAD-BEARING ASSERTION OF THIS BLOCK. The failure mode is not a
    // wrong number, it is a summary that quietly tells the model to decide who
    // is right — after which the product resolves a disagreement its users have
    // not resolved, under a name that reads like analysis.
    // Stripped the same way the copy guard strips: the summary quotes the
    // headline, so it inherits the "are not combined" denial verbatim.
    const lower = stripSanctionedNegations(await build());
    for (const banned of [
      'which is better',
      'more credible',
      'weigh',
      'recommend',
      'decide who',
      'most likely correct',
      'resolve',
      ...FORBIDDEN_RESOLUTION_WORDS,
    ]) {
      expect(lower).not.toContain(banned);
    }
  });

  it('is deterministic', async () => {
    expect(await build()).toBe(await build());
  });

  it('omits targets nobody answered', async () => {
    const text = await build();
    expect(text).not.toContain(ALIGNED_LABEL);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. OWNERSHIP. Until this suite existed, any signed-in user who held a
 *    round_id could read that round's beliefs.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the reveal projection is bound to the round OWNER', () => {
  const OWNER = 'owner-user';
  const STRANGER = 'some-other-signed-in-user';

  const storeWithAnswers = (o: Partial<CollabRound> = {}): CollabStore =>
    makeStore({
      round: round(o),
      events: [
        answer({ participant_id: GRACE_ID, value: GRACE_VALUE, expression_raw: 'Cohort held.' }),
        answer({ participant_id: ADA_ID, value: ADA_VALUE, expression_raw: 'Churn bites.' }),
      ],
    });

  /**
   * ⭐ THE DISCRIMINATING PAIR. Either half alone proves nothing: a projection
   * that refused EVERYONE would satisfy the refusal test, and the pristine
   * (defective) code satisfies the admission test. Only both together bind the
   * behaviour to the identity of the caller rather than to "something threw".
   */
  it('REFUSES a signed-in stranger who is not the round owner', async () => {
    const code = await refusalCodeOf(() =>
      assembleRevealView(storeWithAnswers(), {
        round_id: ROUND_ID,
        requested_by: { kind: 'owner', user_id: STRANGER },
      }),
    );
    expect(code).toBe('collab_owner_only');
  });

  it('ADMITS the round owner (the other half of the pair)', async () => {
    const view = await assembleRevealView(storeWithAnswers(), {
      round_id: ROUND_ID,
      requested_by: { kind: 'owner', user_id: OWNER },
    });
    // Bound by IDENTITY, not by "it returned something": the row is found by
    // participant_id and its value asserted, so this cannot pass on Ada's row.
    const grace = view.per_target
      .find((t) => t.target.id === TARGET_ID)
      ?.responses.find((r) => r.participant_id === GRACE_ID);
    expect(grace?.value).toBe(GRACE_VALUE);
  });

  it('REFUSES the stranger on the DISAGREEMENT view too (one inherited gate)', async () => {
    const code = await refusalCodeOf(() =>
      assembleDisagreementView(storeWithAnswers(), {
        round_id: ROUND_ID,
        requested_by: { kind: 'owner', user_id: STRANGER },
      }),
    );
    expect(code).toBe('collab_owner_only');
  });

  it('ADMITS the owner on the disagreement view, with the stated basis verbatim', async () => {
    const view = await assembleDisagreementView(storeWithAnswers(), {
      round_id: ROUND_ID,
      requested_by: { kind: 'owner', user_id: OWNER },
    });
    const grace = view.per_target
      .find((t) => t.target.id === TARGET_ID)
      ?.positions.find((p) => p.participant_id === GRACE_ID);
    expect(grace?.stated_basis).toBe('Cohort held.');
  });

  /**
   * ⚠ ORDERING IS THE ASSERTION HERE, not the refusal. If the ownership check
   * ran AFTER the status gate, a stranger probing an OPEN round would be told
   * `collab_round_open` — learning that the round exists and what state it is
   * in. The refusal must be identical whatever the round's status.
   */
  it('refuses the stranger BEFORE disclosing the round status', async () => {
    const code = await refusalCodeOf(() =>
      assembleRevealView(storeWithAnswers({ status: 'open' }), {
        round_id: ROUND_ID,
        requested_by: { kind: 'owner', user_id: STRANGER },
      }),
    );
    expect(code).toBe('collab_owner_only');
    expect(code).not.toBe('collab_round_open');
  });

  it('answers a MISSING round exactly as it answers someone else’s (no existence oracle)', async () => {
    const missing = await refusalCodeOf(() =>
      assembleRevealView(storeWithAnswers(), {
        round_id: '99999999-9999-4999-8999-999999999999',
        requested_by: { kind: 'owner', user_id: OWNER },
      }),
    );
    const notMine = await refusalCodeOf(() =>
      assembleRevealView(storeWithAnswers(), {
        round_id: ROUND_ID,
        requested_by: { kind: 'owner', user_id: STRANGER },
      }),
    );
    expect(missing).toBe(notMine);
    expect(missing).toBe('collab_owner_only');
  });

  it('leaves the PARTICIPANT path untouched', async () => {
    const view = await assembleRevealView(storeWithAnswers(), {
      round_id: ROUND_ID,
      requested_by: { kind: 'participant', participant_id: GRACE_ID },
    });
    expect(view.round_id).toBe(ROUND_ID);
  });

  it('still refuses a participant who is not on the round', async () => {
    const code = await refusalCodeOf(() =>
      assembleRevealView(storeWithAnswers(), {
        round_id: ROUND_ID,
        requested_by: { kind: 'participant', participant_id: STRANGER_ID },
      }),
    );
    expect(code).toBe('collab_not_a_participant');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. THE ANSWER FAMILY IS TOTAL, AND THE STANDING COPY HAS ONE AUTHOR.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the answer-family classification is exhaustive', () => {
  /**
   * The STRUCTURAL guarantee is the `Record<ElicitationEventKind, boolean>` in
   * `types.ts`: a kind added to the union is a missing property and `tsc` REDs
   * at the declaration. That cannot be asserted at runtime (the union is not
   * enumerable), so what this suite pins is the CLASSIFICATION itself — every
   * kind named, so a silent re-classification cannot pass.
   */
  it.each([
    ['belief_submitted', true],
    ['belief_revised', true],
    ['declined', true],
    ['clarification_requested', false],
    ['evidence_attached', false],
  ] as const)('classifies %s as answer=%s', (kind, expected) => {
    expect(isAnswerKind(kind)).toBe(expected);
  });

  it('derives the exported list from that one table', () => {
    expect([...ELICITATION_ANSWER_KINDS].sort()).toEqual(
      ['belief_revised', 'belief_submitted', 'declined'].sort(),
    );
  });
});

describe('the standing disagreement copy has exactly one author', () => {
  it('publishes both standing sentences through the guarded set', () => {
    // EXACT, so a constant added without registering it REDs here rather than
    // slipping past the forbidden-word guard unchecked.
    expect([...STANDING_SENTENCES].sort()).toEqual(
      [DISSENT_SURVIVES_APPLY, POSITIONS_NOT_COMBINED].sort(),
    );
  });

  /**
   * ⚠ TRAP 21, PINNED. These two sentences answer different questions — one is
   * a promise about APPLYING, the other a claim about the DISPLAY. A future
   * tidy-up that collapsed them into one would put an apply promise on a
   * participant's screen, where there is no apply affordance at all.
   */
  it('keeps the apply promise and the display claim distinct', () => {
    expect(POSITIONS_NOT_COMBINED).not.toBe(DISSENT_SURVIVES_APPLY);
    expect(DISSENT_SURVIVES_APPLY).toContain('Applying');
    expect(POSITIONS_NOT_COMBINED).not.toContain('Applying');
  });

  it('serves the display claim on the view, so no client composes its own', async () => {
    const view = await assembleDisagreementView(
      makeStore({ events: [answer({ participant_id: GRACE_ID, value: GRACE_VALUE })] }),
      { round_id: ROUND_ID, requested_by: { kind: 'owner', user_id: 'owner-user' } },
    );
    expect(view.standing_note).toBe(POSITIONS_NOT_COMBINED);
  });
});
