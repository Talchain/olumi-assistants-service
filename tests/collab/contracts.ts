/**
 * ROADMAP 2.909 — COLLAB U-S0 ADVERSARIAL N-SUITE: the seam-name CONTRACT.
 *
 * ⚠ PRE-DDL, AUTHORED RED-FIRST (tenancy-audit DDL condition 4; ROADMAP 2.909;
 * COLLAB-UNIFIED-BUILD-PLAN-2026-08-07 §2 asset 6 / §3 U-S0 / §4 C4).
 *
 * NOTHING under `src/collab/` or `src/routes/collab.v1.*` exists at the tip this
 * suite was authored against (CEE staging `4b57b8ff`). Every `*.ntest.ts` spec in
 * this directory is EXECUTABLE and fails today with the uniform signature
 *
 *     RED (pre-DDL): seam not implemented: <path>
 *
 * thrown by `importSeam` below. That failure IS the documented RED — it is not
 * noise, not a skip, not a collection accident. The suite goes GREEN only when
 * the U-S0 migration set + routes land with the safety properties intact.
 * The collected meta-test (tests/meta/collab-n-suite-pending.test.ts) asserts
 * this directory's manifest + the pre-DDL RED status in the REQUIRED gate, and
 * goes RED itself the moment any seam lands — that failure is the promotion
 * trigger, telling the build lane to wire this suite into the gate.
 *
 * ── THE SEAM-NAME CONTRACT (chosen by the 2.909 lane, 2026-08-08) ──────────
 * The banked designs (COLLAB-UNIFIED-BUILD-PLAN §3; COLLAB-ELICITATION-DESIGN
 * §§2-4, §10 INV-A..I) name the tables, the invariants, and the route ROLES
 * (owner mint/close/preview; participant packet GET + event POST) but not the
 * module paths, function names, refusal codes, or dependency shape. Those are
 * CHOSEN here, minimally, following the repo's own conventions
 * (src/routes/<area>.v1.<name>.ts, default-export async route registrar).
 * They are the contract the U-S0 build lane implements. A build lane that
 * prefers different names MUST edit this suite in the same PR — consciously,
 * with the rename in the diff — never bypass it.
 *
 * Chosen seams (also asserted absent-today by the meta-test):
 *   src/collab/participant-tokens.ts   → ParticipantTokensSeam
 *   src/collab/rounds-service.ts       → RoundsServiceSeam
 *   src/collab/packet-read-model.ts    → PacketReadModelSeam
 *   src/collab/elicitation-append.ts   → ElicitationAppendSeam
 *   src/collab/redaction.ts            → RedactionSeam
 *   src/routes/collab.v1.rounds.ts     → owner routes (mint/close/preview)
 *   src/routes/collab.v1.packet.ts     → participant routes (packet GET, event
 *                                        POST, reveal GET) — token-authed
 *
 * Chosen cross-cutting contracts (each flagged in README.md):
 *   F-1 dependency injection: every service seam takes a `CollabStore` first
 *       argument (interface below); route modules read the store from the
 *       fastify decoration `app.collabStore` when present (test injection),
 *       falling back to the production store. Bare-Fastify registrable.
 *   F-2 refusals: typed `CollabRefusal` errors carrying a stable `.code` from
 *       CollabRefusalCode below; fail-closed, fail-loud, never a silent ack.
 *   F-3 participant token transport: request header `x-collab-participant-token`.
 *   F-4 route-grain refusal indistinguishability: missing/forged/revoked token,
 *       unknown round, and not-a-participant all answer the same status (401)
 *       and the same code (`collab_token_invalid`) with no detail naming rounds,
 *       scenarios, or participants (the scenario-graph route's oracle rule).
 *   F-5 round-mint versioning (ROADMAP 2.910): mintRound calls
 *       `store.createModelVersion({ provenance: "elicitation_round_mint" })`
 *       and pins `graph_version_ref` to the RETURNED id; it never reads the
 *       nullable everyday-path pointer (`getScenarioCurrentModelVersionPointer`).
 *   F-6 owner-panellist ordering: enforced at CLOSE time (`collab_owner_unsubmitted`)
 *       — see README.md flagged fork 3 for why not reveal-time-only.
 *
 * Wire-vs-fixture honesty (estate trap 16): the fixture store below is the
 * suite's INPUT DOMAIN, not evidence about the deployed wire. The service-grain
 * specs prove the read model / services withhold and refuse EVEN WHEN the store
 * hands them everything; the DB-grain file (n-suite-rls.collab.sql) pins the
 * grants/RLS layer; the route-grain spec pins the HTTP boundary. A live staging
 * witness after deploy is the BUILD lane's deliverable, not this suite's claim.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

/** Repo root, derived from this file's location (tests/collab-nsuite-pending/). */
export const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

/** The complete seam manifest this suite binds to. */
export const CONTRACT_SEAMS = [
  "src/collab/participant-tokens.ts",
  "src/collab/rounds-service.ts",
  "src/collab/packet-read-model.ts",
  "src/collab/elicitation-append.ts",
  "src/collab/redaction.ts",
  "src/routes/collab.v1.rounds.ts",
  "src/routes/collab.v1.packet.ts",
] as const;
export type SeamPath = (typeof CONTRACT_SEAMS)[number];

/**
 * A module that EXISTS at the authoring tip — the positive control for every
 * absence claim made through `seamExists`/`importSeam` (estate trap 13: an
 * absence assertion whose instrument cannot see a presence proves nothing).
 */
export const POSITIVE_CONTROL_MODULE = "src/cee/belief-elicitation/index.ts";

export function seamExists(seamPath: string): boolean {
  return existsSync(resolve(REPO_ROOT, seamPath));
}

export const RED_SIGNATURE_PREFIX = "RED (pre-DDL): seam not implemented:";

/**
 * Import a future seam, or throw the documented RED signature.
 * Dynamic (non-literal) import keeps the FULL typecheck (tsc --noEmit ratchet)
 * green while the module does not exist; vitest transforms the .ts on import
 * once it does.
 */
export async function importSeam<T>(seamPath: SeamPath): Promise<T> {
  const abs = resolve(REPO_ROOT, seamPath);
  if (!existsSync(abs)) {
    throw new Error(
      `${RED_SIGNATURE_PREFIX} ${seamPath} — this is the 2.909 N-suite's documented RED ` +
        `(nothing exists pre-DDL). It goes GREEN only when the U-S0 build lands this seam ` +
        `with the safety properties intact. Do NOT delete or skip this test; implement the seam ` +
        `(or rename it here, consciously, in the same PR).`
    );
  }
  return (await import(/* @vite-ignore */ pathToFileURL(abs).href)) as T;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Refusal contract (F-2)
 * ──────────────────────────────────────────────────────────────────────────── */

export const COLLAB_REFUSAL_CODES = [
  "collab_token_invalid", //   missing / forged / unknown token (route-grain also covers revoked+unknown-round, F-4)
  "collab_token_revoked", //   service-grain distinction only; route answers collab_token_invalid
  "collab_round_closed", //    any elicitation write after close (INV-G)
  "collab_round_open", //      reveal requested pre-close (INV-G)
  "collab_owner_only", //      close/mint/preview attempted by a non-owner actor
  "collab_owner_unsubmitted", // close attempted by an owner-panellist who neither submitted nor declined (F-6)
  "collab_guest_scenario", //  mint attempted on scenarios.user_id IS NULL (G1; MV001 kinship)
  "collab_not_a_participant", // token valid for a different round/scenario (service grain)
  "collab_payload_invalid", // contract validation failed, incl. client-supplied provenance (INV-D, N-P2)
] as const;
export type CollabRefusalCode = (typeof COLLAB_REFUSAL_CODES)[number];

/** Shape contract for the typed refusal the services throw. */
export interface CollabRefusalShape {
  code: CollabRefusalCode;
  message: string;
}

export function isCollabRefusal(err: unknown): err is CollabRefusalShape {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string" &&
    (COLLAB_REFUSAL_CODES as readonly string[]).includes((err as { code: string }).code)
  );
}

/** Assert a promise refuses with the given code; returns the refusal. */
export async function expectRefusal(
  p: Promise<unknown>,
  code: CollabRefusalCode
): Promise<CollabRefusalShape> {
  let out: unknown;
  try {
    out = await p;
  } catch (err) {
    if (isCollabRefusal(err) && err.code === code) return err;
    throw new Error(
      `expected CollabRefusal code=${code}, got thrown: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  throw new Error(
    `expected CollabRefusal code=${code}, but the call RESOLVED with: ${JSON.stringify(out)?.slice(0, 300)}`
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Domain row types (the U-S0 tables, per COLLAB-UNIFIED-BUILD-PLAN §3)
 * ──────────────────────────────────────────────────────────────────────────── */

export type RoundStatus = "draft" | "open" | "closed" | "adjudicating" | "recorded";
export type ParticipantStatus = "invited" | "active" | "revoked";

export interface CollabRound {
  round_id: string;
  scenario_id: string;
  graph_version_ref: string;
  target_manifest: PacketTarget[];
  context_note: string | null;
  status: RoundStatus; // materialised read optimisation; round_events are the truth
  created_by: string;
  created_at: string;
}

export interface CollabParticipant {
  participant_id: string;
  scenario_id: string;
  round_id: string;
  display_name: string; // owner-entered PII (R-1/R-2 surface)
  supabase_user_id: string | null;
  token_hash: string; // NEVER the raw token
  status: ParticipantStatus;
  /** Set by redaction only (R-1 pseudonymise). Null until redacted. */
  pseudonym: string | null;
  created_at: string;
}

export interface PacketTarget {
  target: { kind: "factor" | "edge"; id: string };
  label: string;
  description: string | null;
  unit: string | null;
  // NO value / prior / analysis field exists on this type — blindness item 2
  // (the model's own number is an anchor) is absence BY CONSTRUCTION.
}

export type ElicitationEventKind =
  | "belief_submitted"
  | "belief_revised"
  | "declined"
  | "clarification_requested";

export interface ElicitationEventRow {
  event_id: string;
  round_id: string;
  participant_id: string;
  event_version: number;
  kind: ElicitationEventKind;
  target: { kind: "factor" | "edge"; id: string };
  belief: {
    value: number | null;
    expression_raw: string | null;
    confidence: number | null;
    // elicited_range RESERVED-UNPOPULATED pre-Neil (G2 §4.1) — deliberately no member here.
  } | null;
  provenance: {
    authored_by: string; // participant_id | "owner" | "assistant" — SERVER-stamped (INV-F)
    method: "elicited_nl" | "elicited_numeric" | "derived";
    elicitation_version: string;
  };
  created_at: string;
}

/** Client-side event payload — deliberately carries NO provenance member (N-P2). */
export interface NewElicitationEventPayload {
  kind: ElicitationEventKind;
  target: { kind: "factor" | "edge"; id: string };
  belief: { value: number | null; expression_raw: string | null; confidence: number | null } | null;
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
  // NO member carries the redacted display_name (README flagged fork 4).
}

export type CollabActor =
  | { kind: "owner"; user_id: string }
  | { kind: "participant"; participant_id: string }
  | { kind: "service" };

/* ────────────────────────────────────────────────────────────────────────────
 * Response-shape contracts (INV-A lives here: absence by construction)
 * ──────────────────────────────────────────────────────────────────────────── */

/** The blind open-round packet. Key set is CLOSED — the meta allowlist test
 * asserts strict equality, so the shape cannot silently grow a sibling channel. */
export interface OpenPacket {
  round_id: string;
  status: "open";
  context_note: string | null;
  graph_version_ref: string;
  targets: PacketTarget[];
  self: {
    participant_id: string;
    display_name: string;
    completed_target_ids: string[]; // OWN progress only (blindness item 3)
  };
}
export const OPEN_PACKET_ALLOWED_KEYS = [
  "round_id",
  "status",
  "context_note",
  "graph_version_ref",
  "targets",
  "self",
] as const;

export interface RevealPerTargetRow {
  participant_id: string;
  display_label: string; // display_name, or pseudonym after redaction
  value: number | null;
  expression_raw: string | null;
  confidence: number | null;
  kind: ElicitationEventKind;
}

/** Post-close reveal view — the POSITIVE-CONTROL shape: it CAN carry sibling
 * answers, model values and counts, which is what makes the open-packet
 * absence assertions non-vacuous (trap 13). */
export interface RevealView {
  round_id: string;
  status: Exclude<RoundStatus, "draft" | "open">;
  graph_version_ref: string;
  per_target: Array<{
    target: { kind: "factor" | "edge"; id: string };
    model_value_at_version: number | null;
    responses: RevealPerTargetRow[]; // latest-per-participant fold (INV-C read model)
  }>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Seam export contracts
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ParticipantTokensSeam {
  mintParticipantToken(
    store: CollabStore,
    args: {
      round_id: string;
      scenario_id: string;
      display_name: string;
      supabase_user_id?: string | null;
      actor: CollabActor;
    }
  ): Promise<{ participant: CollabParticipant; token: string }>;
  verifyParticipantToken(
    store: CollabStore,
    args: { round_id: string; token: string }
  ): Promise<CollabParticipant>;
  revokeParticipant(
    store: CollabStore,
    args: { participant_id: string; actor: CollabActor }
  ): Promise<void>;
}

export interface RoundsServiceSeam {
  mintRound(
    store: CollabStore,
    args: {
      scenario_id: string;
      actor: CollabActor;
      target_manifest: PacketTarget[];
      context_note: string | null;
    }
  ): Promise<CollabRound>;
  closeRound(store: CollabStore, args: { round_id: string; actor: CollabActor }): Promise<void>;
  ownerPreview(
    store: CollabStore,
    args: { round_id: string; actor: CollabActor }
  ): Promise<OpenPacketLikePreview>;
}

/** Owner pre-close preview: roster visible (the owner entered it), beliefs NOT
 * (G2 §2.3: the owner is a panellist too and is not exempt from anchoring). */
export interface OpenPacketLikePreview {
  round_id: string;
  status: RoundStatus;
  targets: PacketTarget[];
  roster: Array<{ participant_id: string; display_name: string; status: ParticipantStatus }>;
  // NO beliefs / responses / aggregate member pre-close.
}

export interface PacketReadModelSeam {
  assembleOpenPacket(
    store: CollabStore,
    args: { round_id: string; participant_id: string }
  ): Promise<OpenPacket>;
  assembleRevealView(
    store: CollabStore,
    args: { round_id: string; requested_by: CollabActor }
  ): Promise<RevealView>;
}

export interface ElicitationAppendSeam {
  appendParticipantEvent(
    store: CollabStore,
    args: {
      round_id: string;
      /** resolved by verifyParticipantToken — never trusted from the wire */
      participant: CollabParticipant;
      payload: NewElicitationEventPayload;
    }
  ): Promise<ElicitationEventRow>;
}

export interface RedactionSeam {
  redactParticipantIdentity(
    store: CollabStore,
    args: { participant_id: string; requested_by: CollabActor }
  ): Promise<{ pseudonym: string; already_redacted: boolean }>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The CollabStore dependency contract (F-1)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface CollabStore {
  getRound(round_id: string): Promise<CollabRound | null>;
  /** null = guest scenario (user_id IS NULL). */
  getScenarioOwnerUserId(scenario_id: string): Promise<string | null>;

  insertRound(row: CollabRound): Promise<void>;
  appendRoundEvent(row: RoundEventRow): Promise<void>;

  insertParticipant(row: CollabParticipant): Promise<void>;
  getParticipant(participant_id: string): Promise<CollabParticipant | null>;
  findActiveParticipantByTokenHash(
    round_id: string,
    token_hash: string
  ): Promise<CollabParticipant | null>;
  /** Any-status lookup, for distinguishing revoked (service grain). */
  findParticipantByTokenHash(round_id: string, token_hash: string): Promise<CollabParticipant | null>;
  listParticipants(round_id: string): Promise<CollabParticipant[]>;
  appendParticipantStatusEvent(args: {
    participant_id: string;
    status: ParticipantStatus;
    actor: string;
  }): Promise<void>;

  /** The ONLY event read reachable during an open round (INV-A query shape). */
  listOwnEvents(round_id: string, participant_id: string): Promise<ElicitationEventRow[]>;
  /** Reveal-time read — MUST NOT be called while assembling an open packet. */
  listAllRoundEvents(round_id: string): Promise<ElicitationEventRow[]>;
  appendElicitationEvent(row: ElicitationEventRow): Promise<void>;
  // NO updateElicitationEvent / deleteElicitationEvent exists on this contract
  // (INV-C). DB-grain enforcement is n-suite-rls.collab.sql's job.

  /** Reveal/adjudication-time read — MUST NOT be called for an open packet. */
  getModelValuesAtVersion(
    graph_version_ref: string,
    targetIds: string[]
  ): Promise<Record<string, number | null>>;

  /** ROADMAP 2.910 — the EXPLICIT version mint at round creation. */
  createModelVersion(args: {
    scenario_id: string;
    provenance: "elicitation_round_mint";
  }): Promise<{ model_version_id: string }>;
  /** ARCH-REVIEW-2 G7 nullable everyday-path pointer — FORBIDDEN on the mint path. */
  getScenarioCurrentModelVersionPointer(scenario_id: string): Promise<string | null>;

  /** R-2 narrow redaction (the ONLY mutation of persisted participant identity). */
  redactParticipantDisplayName(participant_id: string, pseudonym: string): Promise<void>;
  appendRedactionAuditRow(row: RedactionAuditRow): Promise<void>;
  listRedactionAuditRows(participant_id: string): Promise<RedactionAuditRow[]>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Sentinels (blindness scans bind to these by content + identity)
 * ──────────────────────────────────────────────────────────────────────────── */

export const SENTINELS = {
  /** Sibling participant B's confirmed belief value. */
  B_VALUE: 0.6180339887,
  B_VALUE_STR: "0.6180339887",
  B_EXPRESSION: "COLLAB-NSUITE-SENTINEL-sibling-expression-phi",
  B_DISPLAY_NAME: "Beatrix-Zenobia-COLLAB-SENTINEL",
  B_PARTICIPANT_ID: "b-sentinel-participant-0000-0000",
  B_SUPABASE_USER_ID: "b-sentinel-supabase-user-0000",
  /** The model's current value for the elicited target (anchor — must be hidden). */
  MODEL_VALUE: 0.2718281828,
  MODEL_VALUE_STR: "0.2718281828",
  /** The scenario OWNER's user id — the dim-1 mis-attribution sentinel. */
  OWNER_USER_ID: "owner-sentinel-user-id-0000-0000",
  A_DISPLAY_NAME: "Alfred-Quillworth-COLLAB-SENTINEL",
  A_PARTICIPANT_ID: "a-sentinel-participant-0000-0000",
} as const;

/* ────────────────────────────────────────────────────────────────────────────
 * Fixture store (in-memory, call-recording)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface FixtureState {
  rounds: Map<string, CollabRound>;
  participants: Map<string, CollabParticipant>;
  events: ElicitationEventRow[];
  roundEvents: RoundEventRow[];
  modelValues: Map<string, Record<string, number | null>>; // graph_version_ref → target id → value
  redactionAudit: RedactionAuditRow[];
  scenarioOwners: Map<string, string | null>;
  scenarioCurrentPointers: Map<string, string | null>;
  mintedVersionCounter: number;
}

export interface FixtureCollabStore extends CollabStore {
  calls: string[];
  state: FixtureState;
}

export function createFixtureStore(seed?: {
  rounds?: CollabRound[];
  participants?: CollabParticipant[];
  events?: ElicitationEventRow[];
  modelValues?: Record<string, Record<string, number | null>>;
  scenarioOwners?: Record<string, string | null>;
  scenarioCurrentPointers?: Record<string, string | null>;
}): FixtureCollabStore {
  const state: FixtureState = {
    rounds: new Map((seed?.rounds ?? []).map((r) => [r.round_id, r])),
    participants: new Map((seed?.participants ?? []).map((p) => [p.participant_id, p])),
    events: [...(seed?.events ?? [])],
    roundEvents: [],
    modelValues: new Map(Object.entries(seed?.modelValues ?? {})),
    redactionAudit: [],
    scenarioOwners: new Map(Object.entries(seed?.scenarioOwners ?? {})),
    scenarioCurrentPointers: new Map(Object.entries(seed?.scenarioCurrentPointers ?? {})),
    mintedVersionCounter: 0,
  };
  const calls: string[] = [];
  const store: FixtureCollabStore = {
    calls,
    state,
    async getRound(round_id) {
      calls.push(`getRound:${round_id}`);
      return state.rounds.get(round_id) ?? null;
    },
    async getScenarioOwnerUserId(scenario_id) {
      calls.push(`getScenarioOwnerUserId:${scenario_id}`);
      return state.scenarioOwners.get(scenario_id) ?? null;
    },
    async insertRound(row) {
      calls.push(`insertRound:${row.round_id}`);
      state.rounds.set(row.round_id, row);
    },
    async appendRoundEvent(row) {
      calls.push(`appendRoundEvent:${row.round_id}:${row.transition}`);
      state.roundEvents.push(row);
      const round = state.rounds.get(row.round_id);
      if (round) state.rounds.set(row.round_id, { ...round, status: row.transition });
    },
    async insertParticipant(row) {
      calls.push(`insertParticipant:${row.participant_id}`);
      state.participants.set(row.participant_id, row);
    },
    async getParticipant(participant_id) {
      calls.push(`getParticipant:${participant_id}`);
      return state.participants.get(participant_id) ?? null;
    },
    async findActiveParticipantByTokenHash(round_id, token_hash) {
      calls.push(`findActiveParticipantByTokenHash:${round_id}`);
      for (const p of state.participants.values()) {
        if (p.round_id === round_id && p.token_hash === token_hash && p.status === "active") return p;
      }
      return null;
    },
    async findParticipantByTokenHash(round_id, token_hash) {
      calls.push(`findParticipantByTokenHash:${round_id}`);
      for (const p of state.participants.values()) {
        if (p.round_id === round_id && p.token_hash === token_hash) return p;
      }
      return null;
    },
    async listParticipants(round_id) {
      calls.push(`listParticipants:${round_id}`);
      return [...state.participants.values()].filter((p) => p.round_id === round_id);
    },
    async appendParticipantStatusEvent(args) {
      calls.push(`appendParticipantStatusEvent:${args.participant_id}:${args.status}`);
      const p = state.participants.get(args.participant_id);
      if (p) state.participants.set(args.participant_id, { ...p, status: args.status });
    },
    async listOwnEvents(round_id, participant_id) {
      calls.push(`listOwnEvents:${round_id}:${participant_id}`);
      return state.events.filter((e) => e.round_id === round_id && e.participant_id === participant_id);
    },
    async listAllRoundEvents(round_id) {
      calls.push(`listAllRoundEvents:${round_id}`);
      return state.events.filter((e) => e.round_id === round_id);
    },
    async appendElicitationEvent(row) {
      calls.push(`appendElicitationEvent:${row.round_id}:${row.participant_id}:${row.kind}`);
      state.events.push(row);
    },
    async getModelValuesAtVersion(graph_version_ref, targetIds) {
      calls.push(`getModelValuesAtVersion:${graph_version_ref}`);
      const all = state.modelValues.get(graph_version_ref) ?? {};
      const out: Record<string, number | null> = {};
      for (const id of targetIds) out[id] = all[id] ?? null;
      return out;
    },
    async createModelVersion(args) {
      calls.push(`createModelVersion:${args.scenario_id}:${args.provenance}`);
      const owner = state.scenarioOwners.get(args.scenario_id) ?? null;
      if (owner === null) {
        // MV001 kinship: the live create_model_version RPC refuses guests.
        const err = new Error("MV001: guest scenarios cannot mint model versions");
        (err as unknown as { code: string }).code = "MV001";
        throw err;
      }
      state.mintedVersionCounter += 1;
      return { model_version_id: `mv-fixture-${state.mintedVersionCounter}` };
    },
    async getScenarioCurrentModelVersionPointer(scenario_id) {
      calls.push(`getScenarioCurrentModelVersionPointer:${scenario_id}`);
      return state.scenarioCurrentPointers.get(scenario_id) ?? null;
    },
    async redactParticipantDisplayName(participant_id, pseudonym) {
      calls.push(`redactParticipantDisplayName:${participant_id}`);
      const p = state.participants.get(participant_id);
      if (p) {
        state.participants.set(participant_id, { ...p, display_name: pseudonym, pseudonym });
      }
    },
    async appendRedactionAuditRow(row) {
      calls.push(`appendRedactionAuditRow:${row.participant_id}`);
      state.redactionAudit.push(row);
    },
    async listRedactionAuditRows(participant_id) {
      calls.push(`listRedactionAuditRows:${participant_id}`);
      return state.redactionAudit.filter((r) => r.participant_id === participant_id);
    },
  };
  return store;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Shared fixture builders
 * ──────────────────────────────────────────────────────────────────────────── */

export const FIXTURE_SCENARIO_ID = "scenario-fixture-0000-0000";
export const FIXTURE_ROUND_ID = "round-fixture-0000-0000";
export const FIXTURE_GRAPH_VERSION_REF = "mv-fixture-pinned-at-mint";
export const FIXTURE_TARGET_ID = "factor-churn-risk";

export function fixtureTarget(): PacketTarget {
  return {
    target: { kind: "factor", id: FIXTURE_TARGET_ID },
    label: "Churn risk",
    description: "Probability that the anchor customer churns within 12 months",
    unit: "probability",
  };
}

export function fixtureRound(overrides?: Partial<CollabRound>): CollabRound {
  return {
    round_id: FIXTURE_ROUND_ID,
    scenario_id: FIXTURE_SCENARIO_ID,
    graph_version_ref: FIXTURE_GRAPH_VERSION_REF,
    target_manifest: [fixtureTarget()],
    context_note: "Panel context: renewal negotiation opens next quarter.",
    status: "open",
    created_by: SENTINELS.OWNER_USER_ID,
    created_at: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

export function fixtureParticipantA(overrides?: Partial<CollabParticipant>): CollabParticipant {
  return {
    participant_id: SENTINELS.A_PARTICIPANT_ID,
    scenario_id: FIXTURE_SCENARIO_ID,
    round_id: FIXTURE_ROUND_ID,
    display_name: SENTINELS.A_DISPLAY_NAME,
    supabase_user_id: null,
    token_hash: "hash-of-a-token-fixture",
    status: "active",
    pseudonym: null,
    created_at: "2026-08-08T00:00:01.000Z",
    ...overrides,
  };
}

export function fixtureParticipantB(overrides?: Partial<CollabParticipant>): CollabParticipant {
  return {
    participant_id: SENTINELS.B_PARTICIPANT_ID,
    scenario_id: FIXTURE_SCENARIO_ID,
    round_id: FIXTURE_ROUND_ID,
    display_name: SENTINELS.B_DISPLAY_NAME,
    supabase_user_id: SENTINELS.B_SUPABASE_USER_ID,
    token_hash: "hash-of-b-token-fixture",
    status: "active",
    pseudonym: null,
    created_at: "2026-08-08T00:00:02.000Z",
    ...overrides,
  };
}

export function fixtureEventB(overrides?: Partial<ElicitationEventRow>): ElicitationEventRow {
  return {
    event_id: "event-b-1",
    round_id: FIXTURE_ROUND_ID,
    participant_id: SENTINELS.B_PARTICIPANT_ID,
    event_version: 1,
    kind: "belief_submitted",
    target: { kind: "factor", id: FIXTURE_TARGET_ID },
    belief: { value: SENTINELS.B_VALUE, expression_raw: SENTINELS.B_EXPRESSION, confidence: 0.8 },
    provenance: {
      authored_by: SENTINELS.B_PARTICIPANT_ID,
      method: "elicited_nl",
      elicitation_version: "fixture-v1",
    },
    created_at: "2026-08-08T00:01:00.000Z",
  ...overrides,
  };
}

/** Standard two-participant open-round store: A (no events), B (one belief),
 * model value present at the pinned version, owned scenario. */
export function seededOpenRoundStore(): FixtureCollabStore {
  return createFixtureStore({
    rounds: [fixtureRound()],
    participants: [fixtureParticipantA(), fixtureParticipantB()],
    events: [fixtureEventB()],
    modelValues: { [FIXTURE_GRAPH_VERSION_REF]: { [FIXTURE_TARGET_ID]: SENTINELS.MODEL_VALUE } },
    scenarioOwners: { [FIXTURE_SCENARIO_ID]: SENTINELS.OWNER_USER_ID },
  });
}

/** Deep-scan a value's JSON serialisation for sentinel content. */
export function jsonContains(value: unknown, needle: string): boolean {
  return JSON.stringify(value)?.includes(needle) ?? false;
}
