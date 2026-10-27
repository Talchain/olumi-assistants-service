/**
 * The identity of a graph registration — ONE definition, shared by the route that
 * writes it and by every caller that needs to find it again.
 *
 * ⛔ Why this is its own module: the Agent lane has to derive the SAME turn id the
 * route derives, in order to look up a construction it may already have committed
 * (a lost-response retry). A second copy of the derivation in the lane would be a
 * twin that drifts silently — and a drifted twin looks up the wrong key and
 * reports "nothing committed" when a version exists.
 */
import { createHash } from "node:crypto";
import { computeGraphIdentityHash } from "../context/graph-identity-normalise.js";

/**
 * `turn_id` for the registration commit.
 *
 * Prefixed so the turn log says WHY the graph moved without anyone having to
 * join it against another table.
 *
 * ⛔ REPLAY-STABLE WHEN THE CALLER NAMES THE OPERATION. This was
 * `randomUUID()` on every request, and the RPC's idempotency key is
 * `(scenario_id, turn_id)` — so a lost-response retry was a brand-new write to
 * every layer beneath it, the store's replay classifier (`classifyPriorTurn`)
 * could never match a prior row, and a retry could mint a SECOND version
 * instead of recovering the first receipt. Measured signed-in on staging
 * 9c16e8cd: construction wrote `graph_registration:<random>`.
 *
 * With an `operation_id`, the turn id is DERIVED — the same (scenario, operation)
 * always yields the same key, so an exact retry reaches the replay arm and gets
 * the original receipt back. Without one, nothing changes: every request is
 * still distinct, which is the UI import's behaviour today.
 */
export function registrationTurnId(scenarioId: string, operationId?: string): string {
  if (operationId === undefined) return `graph_registration:${globalThis.crypto.randomUUID()}`;
  const h = createHash("sha256").update(`graph_registration:${scenarioId}:${operationId}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = b.toString("hex");
  return `graph_registration:${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/**
 * The request_hash for a registration: a digest of WHAT is being registered.
 *
 * ⛔ It used to be the turn id itself. The store's replay classifier answers
 * "is this the same request replaying?" by comparing `request_hash` against the
 * row already under `(scenario_id, turn_id)` — so with the turn id as the hash,
 * an identical retry and the same operation id reused for a DIFFERENT graph were
 * indistinguishable. Digesting the projected bytes and the brief makes the
 * first a replay and the second a conflict, which is what they are.
 *
 * The value stored is that digest plus the save it carries (`#saved:…`, C8 below); compare requests with
 * `registrationRequestOf`, never this string whole.
 */
export function registrationRequestHash(graphForStore: unknown, brief: string | undefined): string {
  const base = `graph_registration:${createHash("sha256").update(JSON.stringify({ graph: graphForStore, brief: brief ?? null })).digest("hex")}`;
  const identity = computeGraphIdentityHash(graphForStore as never)?.value;
  if (typeof identity !== "string" || !HEX64.test(identity)) return base;
  const run = newestStoredRunId(graphForStore);
  return `${base}${SAVED_TAG}${identity}${run === null ? "" : `:${run}`}`;
}

/**
 * ⭐ C8 (27 Oct, DL + PL): A SAVE'S OWN RECEIPT, CARRIED ON ITS OWN ROW. A guest's write mints no version
 * (`append_turn_atomic_v5`: `v_should_create := v_user_id IS NOT NULL AND …`), so it had no receipt to give, and a lost
 * acknowledgement or a replay could never say what it saved. Its registration row (`v5_conversation_turns`, turn id
 * `registrationTurnId(scenario, operation)`) is written in the SAME transaction as the graph, and its `request_hash` is
 * immutable, so the request hash above carries what that save wrote: `#saved:<identity.v1>[:<newest stored Run>]`, both
 * derived from the written bytes (the identity is the CAS's own incoming hash), so an exact retry writes the same string.
 * No store, no migration, no fake version.
 *
 * `registrationRequestOf` is the request itself, the defined suffix stripped: every replay check compares THAT, exactly, so
 * a row written before this suffix still replays, and a different graph or brief is never a replay. Only a well-formed
 * suffix is stripped; anything else is compared whole, so it can only ever fail to match.
 */
const SAVED_TAG = "#saved:";
const HEX64 = /^[0-9a-f]{64}$/;
/** A stored Run's id as the suffix may carry it: no `#` or `:`, so the suffix parses one way only. */
const RUN_TOKEN = /^[A-Za-z0-9_.-]{1,128}$/;
const SAVED_REQUEST = /^(graph_registration:[0-9a-f]{64})#saved:([0-9a-f]{64})(?::([A-Za-z0-9_.-]{1,128}))?$/;

/** The newest Run stored in these bytes (a model program's `living_model.runs`, oldest first), or null. */
function newestStoredRunId(graph: unknown): string | null {
  const lm = graph !== null && typeof graph === "object" ? (graph as { living_model?: unknown }).living_model : undefined;
  const runs = lm !== null && typeof lm === "object" ? (lm as { runs?: unknown }).runs : undefined;
  const last: unknown = Array.isArray(runs) ? runs[runs.length - 1] : undefined;
  const id = last !== null && typeof last === "object" ? (last as { run_id?: unknown }).run_id : undefined;
  return typeof id === "string" && RUN_TOKEN.test(id) ? id : null;
}

/** The registration request a stored (or computed) request hash names, without its `#saved` carrier. */
export function registrationRequestOf(requestHash: string): string {
  return SAVED_REQUEST.exec(requestHash)?.[1] ?? requestHash;
}

/** A save a registration row carries in its own words, or null (no suffix, or a malformed one: unknown, never guessed). */
export function savedRegistrationOf(requestHash: string): { readonly identity: string; readonly run_id: string | null } | null {
  const m = SAVED_REQUEST.exec(requestHash);
  return m === null ? null : { identity: m[2]!, run_id: m[3] ?? null };
}

/** A save that minted no version, said as its own row stores it: the receipt the UI reads (DGAI #3037), with no version keys. */
export interface UnversionedSaveReceipt {
  readonly kind: "unversioned";
  /** identity.v1 of the bytes the save wrote: the contract's `scenario_revision`. */
  readonly scenario_revision: string;
  readonly run_id: string | null;
  /** The registration row's own turn id (`registrationTurnId`), by which a turn's `#ran` maps a Run to its operation. */
  readonly source_turn_id: string;
}

/**
 * The receipt a registration row carries, or null. ONLY on the positive, immutable atomic marker
 * (`model_version_created === false`: the write committed and the RPC minted no version for it) and a well-formed suffix.
 * Never on `user_id`: `claim_guest_scenario` stamps a guest's rows with the new owner on login, and the save it made does not
 * stop existing then. A row the RPC never marked (null), or one that minted a version, has no unversioned receipt.
 */
export function unversionedSaveOf(
  row: { readonly request_hash?: unknown; readonly model_version_created?: unknown } | null | undefined,
  turnId: string,
): UnversionedSaveReceipt | null {
  if (row == null || row.model_version_created !== false || typeof row.request_hash !== "string") return null;
  const saved = savedRegistrationOf(row.request_hash);
  return saved === null ? null : { kind: "unversioned", scenario_revision: saved.identity, run_id: saved.run_id, source_turn_id: turnId };
}

