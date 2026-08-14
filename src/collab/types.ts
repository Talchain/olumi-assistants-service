/**
 * COLLAB U-S0 — shared domain types, the typed refusal, and the store port.
 *
 * ROADMAP 2.686 / 2.909 / 2.910. This module is the implementation side of the
 * seam-name contract pinned by `tests/collab-nsuite-pending/contracts.ts`; the
 * shapes here are structurally compatible with that contract BY DESIGN, and a
 * divergence is a conscious rename that must appear in the same diff.
 *
 * ── WHAT THIS FEATURE IS ──────────────────────────────────────────────────
 * A blind elicitation round: the owner mints a round over an immutable graph
 * version, names participants, and each participant answers WITHOUT seeing any
 * sibling's answer, the model's own number, or any aggregate. On close, the
 * reveal shows every position, attributed, side by side. Nothing is averaged;
 * no winner is named; a lone dissenter is still shown.
 *
 * ── THE THREE PROPERTIES THAT ARE THE FEATURE ─────────────────────────────
 * 1. BLINDNESS (INV-A) is a property of the QUERY SHAPE, not of a filter flag.
 *    `assembleOpenPacket` may only reach `listOwnEvents`; it never has the
 *    sibling rows in memory to leak. A fetch-all-and-filter implementation is
 *    a defect even when its output happens to be correct today.
 * 2. ATTRIBUTION (INV-F) is SERVER-STAMPED from the token-resolved participant.
 *    The wire may not carry a provenance claim at all — a payload that offers
 *    one is refused, not ignored. This is the direct pin on the
 *    `append_turn_atomic_v4` defect class, where the RPC takes no acting-user
 *    parameter and stamps the scenario OWNER on every write.
 * 3. APPEND-ONLY (INV-C). A revision APPENDS; the reveal folds latest-per-
 *    participant. The pair (original, revision) IS the "what changed my mind"
 *    record. The single exception is R-2 narrow audited redaction.
 *
 * ⚠ THE PoC IDENTITY POSTURE, STATED HONESTLY: a participant token is a BEARER
 * CAPABILITY. Under the accepted PoC auth posture a forwarded link means a
 * forged answer. BLINDNESS does not depend on the token (it is a property of
 * the response shape, server-side); ATTRIBUTION does. `supabase_user_id` is
 * nullable precisely so a participant binds to a real account later with no
 * migration. This is a PoC mechanism, NOT a permanent architecture ruling, and
 * it must not be cited as precedent outside this slice.
 */

/**
 * The refusal vocabulary (contract F-2). Every one of these is thrown, never
 * returned — a silent empty ack is the failure mode this feature exists to
 * avoid (INV-D, mirroring the fail-loud persist standard in
 * `orchestrator-v5/system-events/dispatch.ts`).
 */
export const COLLAB_REFUSAL_CODES = [
  'collab_token_invalid',
  'collab_token_revoked',
  'collab_round_closed',
  'collab_round_open',
  'collab_owner_only',
  'collab_owner_unsubmitted',
  'collab_guest_scenario',
  'collab_not_a_participant',
  'collab_payload_invalid',
  /* ── 0.40.0: the APPLY path (`factor_value_edit.applied_from`) ───────────
   * Each code is a DIFFERENT question, deliberately not collapsed into one
   * `collab_apply_invalid`: the owner needs to know whether they picked a
   * round that has not closed, a person who never answered this factor, or a
   * number that no longer matches what that person said. F-4's
   * existence-oracle concern does not reach here — these are not token-path
   * refusals; the caller is already authorised to mutate this scenario and is
   * being told why THEIR OWN round cannot be applied. */
  'collab_apply_scenario_mismatch',
  'collab_apply_round_not_applyable',
  'collab_apply_no_stated_value',
  'collab_apply_value_mismatch',
] as const;

export type CollabRefusalCode = (typeof COLLAB_REFUSAL_CODES)[number];

/**
 * The typed refusal. `code` is the stable contract; `message` is for the
 * operator, never for the wire on a token path — see the route modules, which
 * collapse the token-family codes to one answer so the boundary is not an
 * existence oracle (F-4).
 */
export class CollabRefusal extends Error {
  public readonly code: CollabRefusalCode;

  constructor(code: CollabRefusalCode, message: string) {
    super(message);
    this.name = 'CollabRefusal';
    this.code = code;
  }
}

export function isCollabRefusal(err: unknown): err is CollabRefusal {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    (COLLAB_REFUSAL_CODES as readonly string[]).includes((err as { code: string }).code)
  );
}

export function refuse(code: CollabRefusalCode, message: string): never {
  throw new CollabRefusal(code, message);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Domain rows
 * ────────────────────────────────────────────────────────────────────────── */

export type RoundStatus = 'draft' | 'open' | 'closed' | 'adjudicating' | 'recorded';
export type ParticipantStatus = 'invited' | 'active' | 'revoked';

export type ElicitationEventKind =
  | 'belief_submitted'
  | 'belief_revised'
  | 'declined'
  | 'clarification_requested';

export type ElicitationTargetKind = 'factor' | 'edge';

export interface ElicitationTarget {
  kind: ElicitationTargetKind;
  id: string;
}

/**
 * A packet target. NOTE THE ABSENCE, IT IS THE POINT: there is no `value`,
 * `prior`, `model_value` or `analysis` member on this type. Blindness item 2
 * (the model's own number is an anchor) is absence BY CONSTRUCTION — a future
 * field cannot leak it without a conscious edit here AND in the N-suite's
 * strict key assertion.
 */
export interface PacketTarget {
  target: ElicitationTarget;
  label: string;
  description: string | null;
  unit: string | null;
}

export interface CollabRound {
  round_id: string;
  scenario_id: string;
  graph_version_ref: string;
  target_manifest: PacketTarget[];
  context_note: string | null;
  /** Materialised read optimisation. `round_events` are the truth. */
  status: RoundStatus;
  created_by: string;
  created_at: string;
}

export interface CollabParticipant {
  participant_id: string;
  scenario_id: string;
  round_id: string;
  /** Owner-entered PII — the R-1/R-2 erasure surface. */
  display_name: string;
  /** Nullable BY DESIGN: binds to a real account later with no migration. */
  supabase_user_id: string | null;
  /** NEVER the raw token. */
  token_hash: string;
  status: ParticipantStatus;
  /** Set by redaction only. Null until redacted. */
  pseudonym: string | null;
  created_at: string;
}

export interface ElicitationBelief {
  value: number | null;
  expression_raw: string | null;
  confidence: number | null;
  // `elicited_range` is RESERVED-UNPOPULATED pre-Neil and deliberately NOT
  // declared: the published schema is `.strict()`, so populating it would fail
  // to parse. Do not add it here either.
}

export interface ElicitationProvenance {
  /** participant_id | 'owner' | 'assistant'. SERVER-stamped (INV-F). */
  authored_by: string;
  method: 'elicited_nl' | 'elicited_numeric' | 'derived';
  /** Names the phrase→number mapping that produced the value. */
  elicitation_version: string;
}

export interface ElicitationEventRow {
  event_id: string;
  round_id: string;
  participant_id: string;
  event_version: number;
  kind: ElicitationEventKind;
  target: ElicitationTarget;
  belief: ElicitationBelief | null;
  provenance: ElicitationProvenance;
  created_at: string;
}

/**
 * The CLIENT payload. It deliberately carries NO provenance member, and the
 * append seam refuses a payload that smuggles one rather than dropping it
 * silently — the wire never gets to claim an identity the server can stamp
 * itself (the `dispatch.ts:231,:244` rule, inherited).
 */
export interface NewElicitationEventPayload {
  kind: ElicitationEventKind;
  target: ElicitationTarget;
  belief: ElicitationBelief | null;
}

export interface RoundEventRow {
  round_id: string;
  transition: RoundStatus;
  actor: string;
  created_at: string;
}

export interface RedactionAuditRow {
  participant_id: string;
  requested_by: string;
  created_at: string;
  // NO member carries the redacted display_name: an audit log that preserves
  // the PII the routine exists to detach is not an audit log.
}

export type CollabActor =
  | { kind: 'owner'; user_id: string }
  | { kind: 'participant'; participant_id: string }
  | { kind: 'service' };

/* ──────────────────────────────────────────────────────────────────────────
 * Response shapes — INV-A lives here
 * ────────────────────────────────────────────────────────────────────────── */

export interface OpenPacket {
  round_id: string;
  status: 'open';
  context_note: string | null;
  graph_version_ref: string;
  targets: PacketTarget[];
  self: {
    participant_id: string;
    display_name: string;
    /** OWN progress only — a sibling's completion count is itself a signal. */
    completed_target_ids: string[];
  };
}

/**
 * The blindness boundary, as a CLOSED key set. The N-suite asserts strict
 * equality against this, so ANY new packet field — however innocent — goes RED
 * until it is added here consciously. That is the point: the packet never grows
 * a sibling channel silently.
 */
export const OPEN_PACKET_ALLOWED_KEYS = [
  'round_id',
  'status',
  'context_note',
  'graph_version_ref',
  'targets',
  'self',
] as const;

/**
 * Owner pre-close preview. The roster is visible (the owner entered it); belief
 * CONTENT is not. The owner is a panellist too and is not exempt from anchoring
 * — that is a scientific property of the method, not a permission decision.
 */
export interface OpenPacketLikePreview {
  round_id: string;
  status: RoundStatus;
  targets: PacketTarget[];
  roster: Array<{
    participant_id: string;
    display_name: string;
    status: ParticipantStatus;
  }>;
}

export interface RevealPerTargetRow {
  participant_id: string;
  /** display_name, or the pseudonym after redaction. */
  display_label: string;
  value: number | null;
  expression_raw: string | null;
  confidence: number | null;
  kind: ElicitationEventKind;
}

/**
 * Post-close reveal. This is the POSITIVE-CONTROL shape: it CAN carry sibling
 * answers, model values and counts, which is exactly what makes the open-packet
 * absence assertions non-vacuous.
 *
 * ⚠ NOTE WHAT IS STILL ABSENT: there is no `mean`, `median`, `combined`,
 * `recommended`, `winner`, or `consensus` member, at any nesting level. The
 * published `.strict()` schemas refuse one at parse time and this type refuses
 * one at compile time. Disagreement is shown, never averaged away.
 */
export interface RevealView {
  round_id: string;
  status: Exclude<RoundStatus, 'draft' | 'open'>;
  graph_version_ref: string;
  per_target: Array<{
    target: ElicitationTarget;
    /**
     * The owner-authored label from the round's target manifest — the words the
     * panel was actually asked about.
     *
     * ⚠ NOT cosmetic. A reveal heading that reads `factor-churn-risk` obscures
     * WHERE two people disagree, which is the one thing this view exists to
     * make obvious. It carries no new information: participants already saw
     * this exact string in their packet.
     */
    label: string;
    model_value_at_version: number | null;
    /** Latest-per-participant fold. Counting unit = distinct participants. */
    responses: RevealPerTargetRow[];
  }>;
}

/* ──────────────────────────────────────────────────────────────────────────
 * The store port (contract F-1)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Dependency-injected persistence. Services take this as their first argument
 * so the safety properties can be proven EVEN WHEN the store hands them
 * everything — the read model withholds because of its query shape, not because
 * the store happened not to have the data.
 *
 * ⚠ There is deliberately NO `updateElicitationEvent` / `deleteElicitationEvent`
 * on this port (INV-C). Append-only is enforced at three grains: this interface
 * (compile time), the services (runtime), and the table grants (DB).
 */
export interface CollabStore {
  getRound(round_id: string): Promise<CollabRound | null>;
  /** null = guest scenario (scenarios.user_id IS NULL). */
  getScenarioOwnerUserId(scenario_id: string): Promise<string | null>;

  insertRound(row: CollabRound): Promise<void>;
  appendRoundEvent(row: RoundEventRow): Promise<void>;

  insertParticipant(row: CollabParticipant): Promise<void>;
  getParticipant(participant_id: string): Promise<CollabParticipant | null>;
  findActiveParticipantByTokenHash(
    round_id: string,
    token_hash: string,
  ): Promise<CollabParticipant | null>;
  /** Any-status lookup, so the SERVICE grain can distinguish revoked. */
  findParticipantByTokenHash(
    round_id: string,
    token_hash: string,
  ): Promise<CollabParticipant | null>;
  listParticipants(round_id: string): Promise<CollabParticipant[]>;
  appendParticipantStatusEvent(args: {
    participant_id: string;
    status: ParticipantStatus;
    actor: string;
  }): Promise<void>;

  /** The ONLY event read reachable while a round is open (INV-A query shape). */
  listOwnEvents(round_id: string, participant_id: string): Promise<ElicitationEventRow[]>;
  /** Reveal-time read. MUST NOT be called while assembling an open packet. */
  listAllRoundEvents(round_id: string): Promise<ElicitationEventRow[]>;
  appendElicitationEvent(row: ElicitationEventRow): Promise<void>;

  /** Reveal/adjudication-time read. MUST NOT be called for an open packet. */
  getModelValuesAtVersion(
    graph_version_ref: string,
    targetIds: string[],
  ): Promise<Record<string, number | null>>;

  /** ROADMAP 2.910 — the EXPLICIT version mint at round creation. */
  createModelVersion(args: {
    scenario_id: string;
    provenance: 'elicitation_round_mint';
  }): Promise<{ model_version_id: string }>;
  /**
   * The nullable everyday-path head pointer. FORBIDDEN on the mint path: it is
   * frozen in practice (nothing on the everyday path mints), so a round pinned
   * to it would pin nothing. It exists on the port only so the N-suite can prove
   * the mint never reads it.
   */
  getScenarioCurrentModelVersionPointer(scenario_id: string): Promise<string | null>;

  /** R-2: the ONLY sanctioned mutation of persisted participant identity. */
  redactParticipantDisplayName(participant_id: string, pseudonym: string): Promise<void>;
  appendRedactionAuditRow(row: RedactionAuditRow): Promise<void>;
  listRedactionAuditRows(participant_id: string): Promise<RedactionAuditRow[]>;
}

/**
 * Names the phrase→number mapping that produced a stored value, so a later
 * reader can tell WHICH mapping turned "pretty likely" into 0.70. Bump this
 * when `src/cee/belief-elicitation`'s term maps change meaning.
 */
export const ELICITATION_VERSION = 'cee-belief-elicitation-v1';
