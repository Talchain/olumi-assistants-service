/**
 * THIN CORE: THE ONE WRITE (20 Oct 2026). A core postimage (the graph regenerated from its living model, with the living
 * model on it) is registered as `thin_core` under its operation's own id and CAS base, then verified INDEPENDENTLY: saved
 * only when THIS registration's own receipt and hashes match a fresh read AND that read holds the complete postimage
 * (`approvedGraphHeld`). A lost response or a concurrent copy is recovered as the operation's own version, never a second
 * write. Matching values never count as proof; an unverifiable save stays UNKNOWN.
 */
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { approvedGraphHeld } from '../../agent-lane/runtime/draft-replacement.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHashSha256 } from '../../context/graph-hash.js';
import type { AtomicCommittedModelVersionReceipt } from '../../session/store.js';
import { isSavedRead, readSaved, type SavedRead } from './context-tool.js';
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
  | { readonly status: 'saved'; readonly receipt: Receipt; readonly after: SavedRead }
  | { readonly status: 'already_saved'; readonly receipt: unknown }
  /** The model moved since the base read, and not by this operation. */
  | { readonly status: 'stale' }
  | { readonly status: 'refused' }
  | { readonly status: 'unknown'; readonly outcome: ToolOutcome };

/** Only verifier-owned enums and hash prefixes enter the diagnostic row. */
const hashPrefix = (value: unknown): string | null => typeof value === 'string' && /^[a-f0-9]{12,64}$/i.test(value) ? value.slice(0, 12) : null;
const unknown = (reason: string, diagnostic: DraftVerification): CoreWrite => ({ status: 'unknown',
  outcome: Object.defineProperty(unavailable(reason, 'unknown'), OUTCOME_TRACE, { value: { draft_verification: diagnostic } }) });

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
  if (reg.status >= 400 && reg.status < 500) return { status: 'refused' };
  if (reg.status !== 200) return unknown('not_confirmed', { check: 'ack_status', status: reg.status });

  // The response is THIS registration's receipt; history availability is not save verification.
  const receipt = reg.json.model_version as Receipt | undefined;
  const ack = typeof reg.json.graph_identity_hash === 'string' ? reg.json.graph_identity_hash
    : (reg.json.graph_identity_hash as { value?: unknown } | undefined)?.value;
  const after = await readSaved(deps, w.scenarioId);
  if (receipt == null) return unknown('not_verified', { check: 'receipt_absent' });
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
  const analysisHash = computeAnalysisAffectingGraphHashSha256(after.graph as never);
  if (receipt.analysis_affecting_hash !== analysisHash) return unknown('not_verified', { check: 'hash_mismatch', field: 'analysis_hash', expected: hashPrefix(analysisHash), actual: hashPrefix(receipt.analysis_affecting_hash) });
  if (!approvedGraphHeld(w.graph, after.graph)) return unknown('not_verified', { check: 'postimage_diff',
    keys: Object.keys(w.graph).filter((key) => !approvedGraphHeld(w.graph, { ...w.graph, [key]: after.graph[key] })).slice(0, 8),
  });
  if (reg.json.replayed === true) return { status: 'already_saved', receipt };
  return { status: 'saved', receipt, after };
}
