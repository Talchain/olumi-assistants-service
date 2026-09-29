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
  isAnswerKind,
  refuse,
  type CollabStore,
  type ElicitationEventKind,
  type ElicitationEventRow,
  type ElicitationEvidence,
  type CollabParticipant,
  type EvidenceKind,
  type EvidenceStance,
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
 *
 * `evidence_attached` is accepted and IS surfaced — on the disagreement view,
 * beside the positions it speaks to. It was added with its consumer, not ahead
 * of one.
 */
const EVENT_KINDS: readonly ElicitationEventKind[] = [
  'belief_submitted',
  'belief_revised',
  'declined',
  'evidence_attached',
];

/** Top-level keys a client payload may carry. STRICT — see below. */
const PAYLOAD_KEYS = ['kind', 'target', 'belief', 'evidence'] as const;
const TARGET_KEYS = ['kind', 'id'] as const;
const BELIEF_KEYS = ['value', 'expression_raw', 'confidence'] as const;
const EVIDENCE_KEYS = ['kind', 'body', 'url', 'stance', 'about_participant_id'] as const;

const EVIDENCE_KINDS: readonly EvidenceKind[] = ['note', 'link'];
const EVIDENCE_STANCES: readonly EvidenceStance[] = ['supports', 'challenges', 'qualifies'];

/**
 * A hard ceiling on a participant's own words, REFUSED rather than truncated.
 *
 * ⚠ Truncating would be the worse failure by far: it stores something the
 * person did not write, under their name, and the reveal would then present a
 * sentence they never finished as their reasoning. Refusing is visible; a
 * silent trim is a falsified record (CLAUDE.md 14b, one grain down).
 */
const EVIDENCE_BODY_MAX = 4000;

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
  const rawEvidence = payload.evidence;
  const wantsBelief = kind === 'belief_submitted' || kind === 'belief_revised';
  const wantsEvidence = kind === 'evidence_attached';

  // ── EVIDENCE ─────────────────────────────────────────────────────────────
  // A separate branch rather than a widened belief branch. The two carry
  // different things and mean different things, and the one place they must
  // never blur is the append seam that decides which column a row lands in.
  if (wantsEvidence) {
    if (rawBelief !== null && rawBelief !== undefined) {
      // Evidence is ABOUT a position; it is not itself a position. Accepting a
      // belief here would let one row be both, and the answer fold would then
      // have to guess which question it was answering.
      refuse(
        'collab_payload_invalid',
        'Evidence supports or challenges a position; it does not carry one. Submit the belief separately.',
      );
    }
    return {
      kind: kind as ElicitationEventKind,
      target: { kind: target.kind, id: target.id },
      belief: null,
      evidence: validateEvidence(rawEvidence),
    };
  }

  // Every non-evidence kind must NOT carry evidence — the mirror of the check
  // above, written out rather than assumed, so neither direction can smuggle.
  if (rawEvidence !== null && rawEvidence !== undefined) {
    refuse('collab_payload_invalid', 'Only an evidence_attached event carries evidence.');
  }

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
      evidence: null,
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
    evidence: null,
  };
}

/**
 * Validate an evidence payload. Throws `collab_payload_invalid` — never repairs.
 *
 * ⚠ THE URL CHECK IS A SECURITY CONTROL, NOT A TIDINESS ONE. The disagreement
 * view renders `url` as a link a colleague will click. A stored
 * `javascript:` — or `data:`, or `vbscript:` — scheme is a stored-XSS payload
 * carrying a teammate's name on it, and the participant path is the least
 * authenticated surface in the product (a bearer link). So the scheme is an
 * ALLOWLIST of exactly http and https, checked with the URL parser rather than
 * with a string prefix: `java\nscript:` and `JavaScript:` both defeat a naive
 * `startsWith`, and the parser normalises the scheme for us.
 */
function validateEvidence(raw: unknown): ElicitationEvidence {
  if (!isPlainObject(raw)) {
    refuse('collab_payload_invalid', 'An evidence event needs an evidence object.');
  }
  assertExactKeys(raw, EVIDENCE_KEYS, 'The evidence');

  const kind = raw.kind;
  if (typeof kind !== 'string' || !EVIDENCE_KINDS.includes(kind as EvidenceKind)) {
    refuse('collab_payload_invalid', 'Evidence is a note or a link.');
  }

  const stance = raw.stance;
  if (typeof stance !== 'string' || !EVIDENCE_STANCES.includes(stance as EvidenceStance)) {
    refuse(
      'collab_payload_invalid',
      'Evidence must say what it does: supports, challenges, or qualifies.',
    );
  }

  const body = raw.body;
  if (typeof body !== 'string' || body.trim() === '') {
    // INV-D at this grain: an empty evidence row is a contribution the person
    // believes they made and nobody can read.
    refuse('collab_payload_invalid', 'Evidence needs the words that say what it is.');
  }
  if (body.length > EVIDENCE_BODY_MAX) {
    refuse(
      'collab_payload_invalid',
      `Evidence is longer than ${EVIDENCE_BODY_MAX} characters. Shorten it rather than having it cut.`,
    );
  }

  const rawUrl = raw.url;
  let url: string | null = null;
  if (kind === 'link') {
    if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
      refuse('collab_payload_invalid', 'A link needs a URL.');
    }
    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      refuse('collab_payload_invalid', 'That does not look like a web address.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      refuse('collab_payload_invalid', 'A link must be an http or https web address.');
    }
    // Store the PARSED form: the scheme is normalised and the value that
    // reaches the renderer is the one the check actually approved, rather than
    // a raw string that a second parser might read differently.
    url = parsed.toString();
  } else if (rawUrl !== null && rawUrl !== undefined && rawUrl !== '') {
    // A note with a URL would render as a note and be stored as a link — the
    // kind and the payload must agree, or the two readers disagree later.
    refuse('collab_payload_invalid', 'A note carries no URL. Attach it as a link instead.');
  }

  const about = raw.about_participant_id;
  if (about !== null && about !== undefined && (typeof about !== 'string' || about.trim() === '')) {
    refuse('collab_payload_invalid', 'about_participant_id must be a participant id.');
  }

  return {
    kind: kind as EvidenceKind,
    // VERBATIM, same rule as `expression_raw`. Trimmed of surrounding
    // whitespace only — that is not the person's reasoning.
    body: body.trim(),
    url,
    stance: stance as EvidenceStance,
    about_participant_id: typeof about === 'string' ? about.trim() : null,
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

  // 3b. An AIMED evidence claim must name someone who is actually on this
  // round. Checked against the STORE, by identity — never accepted from the
  // wire, and never resolved by display name (two people can share one).
  //
  // ⚠ THE REFUSAL IS DELIBERATELY THE SAME ONE A NON-PARTICIPANT GETS. This
  // endpoint is reachable with a bearer link, so a distinct "no such
  // participant" answer here would let a link-holder enumerate the ids of
  // people on rounds they cannot otherwise see — the existence-oracle concern
  // that F-4 raises about the token path, arriving through a side door.
  if (payload.evidence !== null && payload.evidence.about_participant_id !== null) {
    const about = await store.getParticipant(payload.evidence.about_participant_id);
    if (about === null || about.round_id !== args.round_id) {
      refuse('collab_not_a_participant', 'That person is not on this round.');
    }
  }

  // Monotonic per (participant, target) — the fold's ordering key, so the
  // reveal is deterministic rather than dependent on wall-clock ties.
  //
  // ⭐ SCOPED TO THE EVENT FAMILY (answer vs evidence). Counting every row for
  // the target would let evidence inflate the ANSWER sequence: attach two links
  // and your next revision is version 4 rather than 2. The fold filters to
  // answers, so its ordering key must be counted over answers too, or the two
  // halves of one mechanism disagree. Behaviour on a round with no evidence is
  // byte-identical to before this line changed.
  const ownEvents = await store.listOwnEvents(args.round_id, participantId);
  const sameFamily = ownEvents.filter(
    (e) =>
      e.target.kind === payload.target.kind &&
      e.target.id === payload.target.id &&
      isAnswerKind(e.kind) === isAnswerKind(payload.kind),
  );

  const row: ElicitationEventRow = {
    event_id: crypto.randomUUID(),
    round_id: args.round_id,
    participant_id: participantId,
    event_version: sameFamily.length + 1,
    kind: payload.kind,
    target: payload.target,
    belief: payload.belief,
    evidence: payload.evidence,
    provenance: {
      // ⭐ SERVER-STAMPED, from the token-resolved participant. Never from the
      // payload, never from a header, never the scenario owner.
      authored_by: participantId,
      method:
        // Evidence is words by definition, so it is always the natural-language
        // method — stated explicitly rather than falling out of a null belief,
        // because "has no belief" and "is written in words" are two different
        // facts and only one of them is true of a decline.
        payload.evidence !== null ||
        (payload.belief?.expression_raw !== null && payload.belief?.expression_raw !== undefined)
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
