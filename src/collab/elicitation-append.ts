/**
 * COLLAB U-S0 — elicitation append (seam pinned by contracts.ts:81).
 *
 * THE ATTRIBUTION BOUNDARY. This is the only way a participant's contribution
 * enters the record, and the only place `authored_by` is set.
 *
 * ── THE DEFECT CLASS THIS EXISTS TO NOT REPRODUCE ─────────────────────────
 * `append_turn_atomic_v4` — the canonical durable writer — takes NO acting-user
 * parameter. It stamps the SCENARIO OWNER's `user_id` on every turn and every
 * fact it persists. On that path, two people contributing to one scenario both
 * come out as the owner: the product would show a panel of one. Multi-party
 * attribution is therefore not a feature bolted onto that writer, it is a
 * property this path has to establish for itself — which is why elicitation
 * events live in their own tables with their own writer, and why the N-suite
 * asserts `authored_by !== <owner id>` by identity rather than by a predicate
 * some other party could satisfy.
 *
 * ── THE WIRE MAY NOT CLAIM AN IDENTITY ────────────────────────────────────
 * `authored_by` is stamped SERVER-SIDE from the token-resolved participant. A
 * payload that offers `provenance` or `authored_by` is REFUSED, not stripped.
 * Refusing surfaces a client bug on the first request; silently ignoring it
 * hides the bug and leaves a client that believes it controls attribution. This
 * mirrors the established rule on the judgement-fact path, where the wire
 * deliberately carries no provenance field at all.
 *
 * ── FAIL LOUD, NEVER A SILENT ACK (INV-D) ─────────────────────────────────
 * Validation happens BEFORE any write, and a persist failure propagates. A
 * participant who is told "recorded" must be recorded. The failure mode this
 * forbids — a cheerful 200 over a write that did not land — is the exact shape
 * of the estate's false-success defects.
 */

import {
  ELICITATION_VERSION,
  refuse,
  type CollabStore,
  type ElicitationEventKind,
  type ElicitationEventRow,
  type CollabParticipant,
  type NewElicitationEventPayload,
} from './types.js';

/**
 * The kinds this slice accepts.
 *
 * ⚠ `clarification_requested` is declared on the contract type but is
 * DELIBERATELY NOT ACCEPTED here: nothing in "two people contribute privately
 * and reveal" reaches it, and an accepted-but-unsurfaced event kind is a row
 * nobody ever sees — the shape of a capability that is built and dark. It is
 * refused loudly so the absence is visible rather than silent. `declined` stays:
 * it is a real answer ("I will not give a number"), and it is what lets an
 * owner-panellist close the round without anchoring on the others.
 */
const EVENT_KINDS: readonly ElicitationEventKind[] = [
  'belief_submitted',
  'belief_revised',
  'declined',
];

/** Top-level keys a client payload may carry. STRICT — see below. */
const PAYLOAD_KEYS = ['kind', 'target', 'belief'] as const;
const TARGET_KEYS = ['kind', 'id'] as const;
const BELIEF_KEYS = ['value', 'expression_raw', 'confidence'] as const;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Reject any key outside the allowlist.
 *
 * ⚠ This single rule closes THREE holes at once, which is why it is an
 * allowlist and not three checks:
 *   1. Smuggled provenance / authored_by (INV-F).
 *   2. Graph-mutation-shaped payloads — `graph`, `operations`, `nodes`,
 *      `edges` (INV-B). A participant has NO path to the canonical model, and
 *      the way to guarantee that is for this endpoint to not know what those
 *      words mean rather than to enumerate them.
 *   3. `elicited_range` on the belief, which is Neil-gated and undeclared in the
 *      published schema; populating it would fail to parse downstream.
 * A denylist would have to be updated every time any of those three vocabularies
 * grew. This does not.
 */
function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  what: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      refuse(
        'collab_payload_invalid',
        `${what} carries an unexpected field '${key}'. This endpoint records a belief and nothing else.`,
      );
    }
  }
}

/**
 * Validate a client payload into the typed shape. Throws `collab_payload_invalid`
 * — never returns a partial or repaired value. There is deliberately no repair
 * path: a payload we had to guess at is a payload whose author we cannot honestly
 * attribute.
 */
export function validateEventPayload(payload: unknown): NewElicitationEventPayload {
  if (!isPlainObject(payload)) {
    refuse('collab_payload_invalid', 'Expected a belief payload object.');
  }
  assertExactKeys(payload, PAYLOAD_KEYS, 'The payload');

  const kind = payload.kind;
  if (typeof kind !== 'string' || !EVENT_KINDS.includes(kind as ElicitationEventKind)) {
    refuse('collab_payload_invalid', 'Unknown event kind.');
  }

  const target = payload.target;
  if (!isPlainObject(target)) {
    refuse('collab_payload_invalid', 'A belief must name the thing it is about.');
  }
  assertExactKeys(target, TARGET_KEYS, 'The target');
  if (target.kind !== 'factor' && target.kind !== 'edge') {
    refuse('collab_payload_invalid', 'A target is a factor or an edge.');
  }
  if (typeof target.id !== 'string' || target.id.trim() === '') {
    refuse('collab_payload_invalid', 'A target needs an id.');
  }

  const rawBelief = payload.belief;
  const wantsBelief = kind === 'belief_submitted' || kind === 'belief_revised';

  if (!wantsBelief) {
    // A decline carries no belief, and must not smuggle one in — that would be
    // a position recorded as an abstention.
    if (rawBelief !== null && rawBelief !== undefined) {
      refuse('collab_payload_invalid', 'A decline or question carries no belief.');
    }
    return {
      kind: kind as ElicitationEventKind,
      target: { kind: target.kind, id: target.id },
      belief: null,
    };
  }

  if (!isPlainObject(rawBelief)) {
    // INV-D, exactly: a belief_submitted with nothing in it is refused loudly
    // rather than acknowledged as an empty contribution.
    refuse('collab_payload_invalid', 'A submitted belief needs a value.');
  }
  assertExactKeys(rawBelief, BELIEF_KEYS, 'The belief');

  const value = rawBelief.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    refuse('collab_payload_invalid', 'A submitted belief needs a finite numeric value.');
  }

  const expressionRaw = rawBelief.expression_raw;
  if (expressionRaw !== null && expressionRaw !== undefined && typeof expressionRaw !== 'string') {
    refuse('collab_payload_invalid', 'expression_raw must be the words the person typed.');
  }

  const confidence = rawBelief.confidence;
  if (
    confidence !== null &&
    confidence !== undefined &&
    (typeof confidence !== 'number' || !Number.isFinite(confidence))
  ) {
    refuse('collab_payload_invalid', 'confidence must be a number.');
  }

  return {
    kind: kind as ElicitationEventKind,
    target: { kind: target.kind, id: target.id },
    belief: {
      value,
      // VERBATIM. The person's own words are the thing that makes a reveal a
      // record of reasoning rather than a row of numbers — never normalised,
      // never re-derived from the number.
      expression_raw: typeof expressionRaw === 'string' ? expressionRaw : null,
      confidence: typeof confidence === 'number' ? confidence : null,
    },
  };
}

/**
 * Append one participant event.
 *
 * Refusal ordering is deliberate and each step is a different question:
 *   1. Is this participant still allowed to write?  (re-read from the store —
 *      the caller's object could be stale, and revocation must bite instantly)
 *   2. Is the round still taking answers?           (INV-G)
 *   3. Is the payload something we can honestly attribute?
 * Nothing is written until all three pass.
 */
export async function appendParticipantEvent(
  store: CollabStore,
  args: {
    round_id: string;
    /** Resolved by verifyParticipantToken — never trusted from the wire. */
    participant: CollabParticipant;
    payload: NewElicitationEventPayload;
  },
): Promise<ElicitationEventRow> {
  const participantId = args.participant?.participant_id;
  if (typeof participantId !== 'string' || participantId === '') {
    refuse('collab_token_invalid', 'No resolved participant.');
  }

  // 1. Re-check status AT THE STORE. A participant object resolved earlier in
  // the request could predate a revocation; the write must see the current row.
  const current = await store.getParticipant(participantId);
  const status = current?.status ?? args.participant.status;
  if (current === null) {
    refuse('collab_token_invalid', 'No such participant.');
  }
  if (status === 'revoked') {
    refuse('collab_token_revoked', 'That participant link has been revoked.');
  }
  if (current.round_id !== args.round_id) {
    refuse('collab_not_a_participant', 'Not a participant on that round.');
  }

  // 2. INV-G. A late belief would silently change what the reveal says the
  // panel thought at close — so it is refused, not queued and not dropped.
  const round = await store.getRound(args.round_id);
  if (round === null) {
    refuse('collab_token_invalid', 'No round for that token.');
  }
  if (round.status !== 'open') {
    refuse(
      'collab_round_closed',
      'This round has closed. Your earlier answers are recorded; nothing new can be added.',
    );
  }

  // 3. Validate BEFORE the write.
  const payload = validateEventPayload(args.payload);

  // Monotonic per (participant, target) — the fold's ordering key, so the
  // reveal is deterministic rather than dependent on wall-clock ties.
  const ownEvents = await store.listOwnEvents(args.round_id, participantId);
  const priorForTarget = ownEvents.filter((e) => e.target.id === payload.target.id).length;

  const row: ElicitationEventRow = {
    event_id: crypto.randomUUID(),
    round_id: args.round_id,
    participant_id: participantId,
    event_version: priorForTarget + 1,
    kind: payload.kind,
    target: payload.target,
    belief: payload.belief,
    provenance: {
      // ⭐ SERVER-STAMPED, from the token-resolved participant. Never from the
      // payload, never from a header, never the scenario owner.
      authored_by: participantId,
      method:
        payload.belief?.expression_raw !== null && payload.belief?.expression_raw !== undefined
          ? 'elicited_nl'
          : 'elicited_numeric',
      // Names the phrase→number mapping, so a later reader can tell WHICH
      // mapping turned "pretty likely" into 0.70.
      elicitation_version: ELICITATION_VERSION,
    },
    created_at: new Date().toISOString(),
  };

  // Fail loud: a store error propagates. There is no catch that would let this
  // return a row the participant believes was recorded when it was not.
  await store.appendElicitationEvent(row);

  return row;
}
