/**
 * THIN CORE: THE ONE WRITE (20 Oct 2026). A core postimage (the graph regenerated from its living model, with the living
 * model on it) is registered as `thin_core` under its operation's own id and CAS base, then verified INDEPENDENTLY: saved
 * only when THIS registration's own receipt and hashes match a fresh read AND that read holds the complete postimage
 * (`approvedGraphHeld`). A guest's write mints no version, so its proof is the acknowledgement plus that read alone, and its
 * receipt is the one its own registration row carries (C8, `unversioned_save`; found again by `findOperationSave`). A lost
 * response or a concurrent copy is recovered as the operation's own version, never a second write. Matching values never
 * count as proof; an unverifiable save stays UNKNOWN.
 */
import { createHash } from 'node:crypto';
import type { InternalDispatch } from '../../core-route/internal-dispatch.js';
import { registrationTurnId, unversionedSaveOf, type UnversionedSaveReceipt } from '../../graph-registration/registration-identity.js';
import { unversionedReceiptOf } from '../../agent-lane/turn-receipts.js';
import { computeGraphIdentityHash } from '../../context/graph-identity-normalise.js';
import type { AtomicCommittedModelVersionReceipt } from '../../session/store.js';
import { approvedGraphHeld, isSavedRead, readSaved, type SavedRead } from '../../model-program-turn/saved-read.js';
import { unavailable, OUTCOME_TRACE, type DraftVerification, type ToolOutcome } from './outcome.js';

type Rec = Record<string, unknown>;
type Receipt = Partial<AtomicCommittedModelVersionReceipt>;

export interface CoreWriteRequest {
  readonly scenarioId: string;
  /** The complete postimage: the mapped graph plus its `living_model`. */
  readonly graph: Rec;
  readonly operationId: string;
  /** The identity the write is based on; `null` is create-only. */
  readonly expectedIdentity: string | null;
  readonly briefText?: string;
  /** This operation's own committed version, if it already landed (a lost response or a concurrent copy). */
  readonly ownVersion: () => Promise<unknown | null>;
}

export type CoreWrite =
  /** `receipt`: the version's, or (a write that minted none) its row's own unversioned receipt, or its bare acknowledgement. */
  | { readonly status: 'saved'; readonly receipt: Receipt | UnversionedSaveReceipt; readonly after: SavedRead }
  | { readonly status: 'already_saved'; readonly receipt: unknown }
  /** The model moved since the base read, and not by this operation. */
  | { readonly status: 'stale' }
  /** Refused before anything was written; `code` is the register's own reason (`details.code`), when it gave one. */
  | { readonly status: 'refused'; readonly code: string | null }
  | { readonly status: 'unknown'; readonly outcome: ToolOutcome };

/** Only verifier-owned enums and hash prefixes enter the diagnostic row. */
const hashPrefix = (value: unknown): string | null => typeof value === 'string' && /^[a-f0-9]{12,64}$/i.test(value) ? value.slice(0, 12) : null;
const unknown = (reason: string, diagnostic: DraftVerification): CoreWrite => ({ status: 'unknown',
  outcome: Object.defineProperty(unavailable(reason, 'unknown'), OUTCOME_TRACE, { value: { draft_verification: diagnostic } }) });
/** The same unknown outcome, for a caller that settles a write against its own read (`savePostimage`). */
export const unknownWrite = unknown;

export async function writeCorePostimage(deps: { readonly dispatch: InternalDispatch }, w: CoreWriteRequest): Promise<CoreWrite> {
  let reg: Awaited<ReturnType<InternalDispatch>>;
  try {
    reg = await deps.dispatch(`/assist/v1/scenarios/${w.scenarioId}/graph/register`, {
      graph: w.graph, thin_core: true, operation_id: w.operationId, expected_graph_identity_hash: w.expectedIdentity,
      ...(w.briefText === undefined ? {} : { brief_text: w.briefText }),
    });
  } catch {
    return unknown('not_confirmed', { check: 'ack_status', status: null });
  }
  const code = (reg.json.details as { code?: unknown } | undefined)?.code;
  if (reg.status === 409 && (code === 'GRAPH_STALE' || code === 'OPERATION_ID_REUSED')) {
    const prior = await w.ownVersion().catch(() => null);
    if (prior !== null) return { status: 'already_saved', receipt: prior };
    if (code === 'GRAPH_STALE') return { status: 'stale' };
    return unknown('not_confirmed', { check: 'ack_status', status: reg.status });
  }
  if (reg.status >= 400 && reg.status < 500) return { status: 'refused', code: typeof code === 'string' ? code : null };
  if (reg.status !== 200) return unknown('not_confirmed', { check: 'ack_status', status: reg.status });

  // The response is THIS registration's receipt; history availability is not save verification.
  const receipt = reg.json.model_version as Receipt | undefined;
  const ack = typeof reg.json.graph_identity_hash === 'string' ? reg.json.graph_identity_hash
    : (reg.json.graph_identity_hash as { value?: unknown } | undefined)?.value;
  const after = await readSaved(deps, w.scenarioId);
  // A guest's write mints no version (`append_turn_atomic_v5`: `v_should_create := v_user_id IS NOT NULL AND …`), so it has no
  // receipt to give. Its proof is the one the construction registration already uses (`agent-capabilities.ts`): THIS
  // registration's acknowledgement, which a fresh read must equal, holding the complete postimage (below).
  if (receipt == null) return acknowledged(w, reg.json, ack, after);
  if (typeof receipt.version_id !== 'string' || receipt.version_id === '') return unknown('not_verified', { check: 'receipt_invalid', field: 'version_id' });
  if (!Number.isSafeInteger(receipt.version_number) || Number(receipt.version_number) < 1) return unknown('not_verified', { check: 'revision_mismatch', field: 'version_number' });
  if (typeof receipt.mutation_id !== 'string' || receipt.mutation_id === '') return unknown('not_verified', { check: 'receipt_invalid', field: 'mutation_id' });
  if (!isSavedRead(after)) return unknown('not_verified', { check: 'readback_unavailable', code: after.status === 'ok' ? 'read_malformed' : after.reason });
  if (typeof ack !== 'string') return unknown('not_verified', { check: 'ack_status', status: reg.status });
  if (ack !== after.identity) return unknown('not_verified', { check: 'hash_mismatch', field: 'ack_identity', expected: hashPrefix(ack), actual: hashPrefix(after.identity) });
  if (receipt.graph_identity_hash !== ack) return unknown('not_verified', { check: 'hash_mismatch', field: 'receipt_identity', expected: hashPrefix(ack), actual: hashPrefix(receipt.graph_identity_hash) });
  const identity = computeGraphIdentityHash(after.graph as never)?.value;
  if (identity !== ack) return unknown('not_verified', { check: 'hash_mismatch', field: 'read_identity', expected: hashPrefix(ack), actual: hashPrefix(identity) });
  if (reg.json.graph_hash !== after.graphHash) return unknown('not_verified', { check: 'revision_mismatch', field: 'graph_hash', expected: hashPrefix(reg.json.graph_hash), actual: hashPrefix(after.graphHash) });
  // The legacy analysis-affecting hash is not compared (W5, 27 Oct): it is a projection of the same graph the identity hash
  // above already binds to the acknowledgement, the receipt and the read-back, so it adds no proof, and computing it loaded
  // the old readiness code onto the alpha path.
  if (!approvedGraphHeld(w.graph, after.graph)) return unknown('not_verified', { check: 'postimage_diff',
    keys: Object.keys(w.graph).filter((key) => !approvedGraphHeld(w.graph, { ...w.graph, [key]: after.graph[key] })).slice(0, 8),
  });
  if (reg.json.replayed === true) return { status: 'already_saved', receipt };
  return { status: 'saved', receipt, after };
}

/** A write that minted no version: saved only when the acknowledgement, a fresh read and the complete postimage agree. */
function acknowledged(w: CoreWriteRequest, json: Rec, ack: unknown, after: Awaited<ReturnType<typeof readSaved>>): CoreWrite {
  if (typeof ack !== 'string') return unknown('not_verified', { check: 'receipt_absent' });
  if (!isSavedRead(after)) return unknown('not_verified', { check: 'readback_unavailable', code: after.status === 'ok' ? 'read_malformed' : after.reason });
  if (ack !== after.identity) return unknown('not_verified', { check: 'hash_mismatch', field: 'ack_identity', expected: hashPrefix(ack), actual: hashPrefix(after.identity) });
  const identity = computeGraphIdentityHash(after.graph as never)?.value;
  if (identity !== ack) return unknown('not_verified', { check: 'hash_mismatch', field: 'read_identity', expected: hashPrefix(ack), actual: hashPrefix(identity) });
  if (json.graph_hash !== after.graphHash) return unknown('not_verified', { check: 'revision_mismatch', field: 'graph_hash', expected: hashPrefix(json.graph_hash), actual: hashPrefix(after.graphHash) });
  if (!approvedGraphHeld(w.graph, after.graph)) return unknown('not_verified', { check: 'postimage_diff',
    keys: Object.keys(w.graph).filter((key) => !approvedGraphHeld(w.graph, { ...w.graph, [key]: after.graph[key] })).slice(0, 8) });
  // C8: its own receipt, as its registration row stores it (the register reads it back), when it is THIS operation's row and
  // names exactly the bytes acknowledged; otherwise (a row with no carrier) the acknowledgement alone, as before: never a
  // receipt built here.
  const carrier = unversionedReceiptOf(json.unversioned_save);
  const receipt: Receipt | UnversionedSaveReceipt = carrier !== null && carrier.scenario_revision === ack
    && carrier.source_turn_id === registrationTurnId(w.scenarioId, w.operationId) ? carrier : { graph_identity_hash: ack };
  return json.replayed === true ? { status: 'already_saved', receipt } : { status: 'saved', receipt, after };
}

/** A stable UUID-shaped operation id for one prepared change: a retry of the same approval is the same operation. */
export function changeOperationId(scenarioId: string, proposalId: string): string {
  const b = Buffer.from(createHash('sha256').update(`living_change:${scenarioId}:${proposalId}`).digest().subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** The version this operation committed, if any: found by its own registration turn id in the newest-first history. */
export async function findOperationVersion(dispatch: InternalDispatch, scenarioId: string, operationId: string): Promise<Rec | null> {
  const found = await operationVersionLookup(dispatch, scenarioId, operationId);
  return found === 'none' || found === 'unread' ? null : found;
}

/** The history's answer for one operation: its version, `none` (every page read, no version of it), or `unread`. */
async function operationVersionLookup(dispatch: InternalDispatch, scenarioId: string, operationId: string): Promise<Rec | 'none' | 'unread'> {
  const turnId = registrationTurnId(scenarioId, operationId);
  let cursor: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const r = await dispatch(`/assist/v1/scenarios/${scenarioId}/versions`, { limit: 200, ...(cursor === undefined ? {} : { cursor }) });
    if (r.status !== 200) return 'unread';
    const versions = Array.isArray(r.json.versions) ? (r.json.versions as Rec[]) : [];
    const hit = versions.find((v) => (v.creation as { source_turn_id?: unknown } | undefined)?.source_turn_id === turnId);
    if (hit !== undefined) {
      const creation = hit.creation as { kind?: unknown; mutation_id?: unknown; source_turn_id?: unknown };
      return { version_id: String(hit.version_id), version_number: Number(hit.sequence),
        mutation_id: typeof creation.mutation_id === 'string' ? creation.mutation_id : null, source_turn_id: String(creation.source_turn_id) };
    }
    cursor = typeof r.json.next_cursor === 'string' ? r.json.next_cursor : undefined;
    if (cursor === undefined) return 'none';
  }
  return 'unread';
}

/** The store's read of one committed row (`SessionStore.readCommittedTurn`): its request hash and atomic version marker. */
export type RegistrationRowRead = (scenarioId: string, turnId: string) =>
  Promise<{ readonly request_hash: string; readonly model_version_created?: boolean | null } | null>;

/**
 * ⭐ C8: the save this operation committed WITHOUT a version (a guest's), as its own registration row carries it
 * (`unversionedSaveOf`: the RPC's `model_version_created === false` marker and the row's `#saved` suffix). The stored carrier,
 * never a receipt built from today's graph or a resend: a row with no carrier (written before it) stays unknown.
 */
export async function readUnversionedSave(read: RegistrationRowRead, scenarioId: string, operationId: string): Promise<UnversionedSaveReceipt | null> {
  const turnId = registrationTurnId(scenarioId, operationId);
  return unversionedSaveOf(await read(scenarioId, turnId), turnId);
}

/**
 * The save this operation committed: its version (exactly as `findOperationVersion` finds it, so a signed-in save is said as
 * before), else its unversioned save. The row is read only once the caller's own history read has answered, in full, that
 * there is no version of it: the authenticated read's authority stands, and an unreadable history stays unknown.
 */
export async function findOperationSave(dispatch: InternalDispatch, read: RegistrationRowRead | undefined, scenarioId: string,
  operationId: string): Promise<Rec | UnversionedSaveReceipt | null> {
  const found = await operationVersionLookup(dispatch, scenarioId, operationId);
  if (found === 'unread') return null;
  if (found !== 'none') return found;
  return read === undefined ? null : readUnversionedSave(read, scenarioId, operationId);
}
