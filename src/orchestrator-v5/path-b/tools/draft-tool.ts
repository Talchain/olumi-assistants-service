/**
 * ⭐ THIN CORE: THE DRAFT ADAPTER (20 Oct 2026). Olumi's PROVISIONAL first model, written by the AI itself.
 *  1. literal check only: the brief is in the user's own typed words (`inTheUsersWords`);
 *  2. the AI supplies its COMPLETE living model as strict tool arguments (`LivingModel`; the 18 Oct bake-off design). There is
 *     no second drafter call and no host reading of the brief: the ONE kernel labels attribution (a quote not found in the
 *     person's words is `unverified`, never Olumi's), and the pure mapper compiles the engine graph (`mapLivingModel`), saying
 *     each level, setting or link it cannot yet convert (`withheld`) instead of guessing;
 *  3. CREATE-ONLY registration of `{...graph, living_model}` as a core postimage (`thin_core`: identity/format projection only)
 *     under the construction's own operation id (`constructionOperationId`), so a lost response or a concurrent copy is
 *     recovered as this construction's own version, never a second one;
 *  4. an INDEPENDENT readback: `mutated` only when THIS registration's own receipt and CAS hashes match a fresh read AND
 *     that read holds the complete postimage, living model included (`approvedGraphHeld`), not merely an existing model.
 * A retry of a construction that already committed reports "already saved", never a second write or "model exists".
 */
import { z } from 'zod-v4';
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { constructionOperationId, findConstructionVersion } from '../../agent-lane/runtime/build-model.js';
import { approvedGraphHeld } from '../../agent-lane/runtime/draft-replacement.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHashSha256 } from '../../context/graph-hash.js';
import type { AtomicCommittedModelVersionReceipt } from '../../session/store.js';
import { LivingModel } from '../../../schemas/living-model.js';
import { applyKernel } from '../living-model/kernel.js';
import { mapLivingModel } from '../living-model/mapper.js';
import { isNoModelYet, isSavedRead, readSaved } from './context-tool.js';
import { ok, refused, unavailable, OUTCOME_TRACE, type DraftVerification, type ToolOutcome } from './outcome.js';
import { inTheUsersWords, type TypedWords } from './user-words.js';

export const BUILD_MODEL_FROM_BRIEF = 'build_model_from_brief';
export const BuildModelParams = z.object({
  /** The user's brief, copied verbatim from their own messages. */
  brief: z.string(),
  /** The complete living model of the brief: every aim, option, factor, link, condition and view, with who said it. */
  model: LivingModel,
}).strict();
export type BuildModelArgs = z.infer<typeof BuildModelParams>;

export interface DraftDeps {
  readonly dispatch: InternalDispatch;
  /** The route's GRAPH_READY observer: told once, with the graph as read back. */
  readonly onModelRegistered?: (graph: Record<string, unknown>) => void;
}

const nodesIn = (graph: Record<string, unknown>): number => (Array.isArray(graph.nodes) ? graph.nodes.length : 0);

type DraftContext = Pick<AgentToolContext, 'scenario_id'> & Partial<Pick<AgentToolContext, 'request_id'>> & TypedWords;

export async function buildModel(deps: DraftDeps, ctx: DraftContext, args: BuildModelArgs): Promise<ToolOutcome> {
  const outcome = await construct(deps, ctx, args);
  const save_outcome = outcome.status === 'ok' ? 'VERIFIED_SAVED'
    : outcome.status === 'unavailable' && outcome.write === 'unknown' ? 'UNKNOWN' : 'VERIFIED_NO_WRITE';
  return Object.defineProperty({ ...outcome, data: { ...outcome.data, save_outcome }, ...(save_outcome === 'UNKNOWN' ? {
    detail: 'The construction was dispatched, but its save could not be verified. It may already be saved. Do not say nothing was saved, and do not repeat a write or Run to repair the reply.',
  } : {}) }, OUTCOME_TRACE, { value: outcome[OUTCOME_TRACE] });
}

/** Only verifier-owned enums and hash prefixes enter the existing diagnostic row. */
const hashPrefix = (value: unknown): string | null => typeof value === 'string' && /^[a-f0-9]{12,64}$/i.test(value) ? value.slice(0, 12) : null;
const unknownSave = (reason: string, diagnostic: DraftVerification): ToolOutcome => Object.defineProperty(
  unavailable(reason, 'unknown'), OUTCOME_TRACE, { value: { draft_verification: diagnostic } },
);

async function construct(deps: DraftDeps, ctx: DraftContext, args: BuildModelArgs): Promise<ToolOutcome> {
  return constructUnrecorded(deps, ctx, args);
}

async function constructUnrecorded(deps: DraftDeps, ctx: DraftContext, args: BuildModelArgs): Promise<ToolOutcome> {
  if (!inTheUsersWords(args.brief, ctx)) return refused('brief_not_users_words');
  const before = await readSaved(deps, ctx.scenario_id);
  // A new scenario has no model yet (`graph: null`, `graph_present: false`): that is where a first draft starts.
  if (!isSavedRead(before) && !isNoModelYet(before)) return before;
  const ownVersion = () => findConstructionVersion(deps.dispatch, ctx.scenario_id, args.brief).catch(() => null);
  if (isSavedRead(before) && nodesIn(before.graph) > 0) {
    const prior = await ownVersion();
    return prior === null ? refused('model_exists') : ok({ already_saved: true, model_version: prior }, { mutated: false });
  }

  const kernelled = applyKernel(args.model, [args.brief, ...(ctx.verified_user_messages ?? []), ...(ctx.user_turn_text === undefined ? [] : [ctx.user_turn_text])]);
  const mapped = mapLivingModel(kernelled.model);
  if (!mapped.graph.nodes.some((n) => n.kind !== 'decision')) return refused('model_empty');
  const graph: Record<string, unknown> = { ...mapped.graph, living_model: kernelled.model };

  let reg: Awaited<ReturnType<InternalDispatch>>;
  try {
    reg = await deps.dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
      graph,
      thin_core: true,
      brief_text: args.brief,
      operation_id: constructionOperationId(ctx.scenario_id, args.brief),
      // Create-only: the route refuses `GRAPH_STALE` if a model appeared since the read above (`buildModelFromBrief`'s contract).
      expected_graph_identity_hash: null,
    });
  } catch {
    return unknownSave('not_confirmed', { check: 'ack_status', status: null });
  }
  const code = (reg.json.details as { code?: unknown } | undefined)?.code;
  if (reg.status === 409 && (code === 'GRAPH_STALE' || code === 'OPERATION_ID_REUSED')) {
    // This construction already committed (a lost response, or a concurrent copy won): its own version, or not ours.
    const prior = await ownVersion();
    if (prior !== null) return ok({ already_saved: true, model_version: prior }, { mutated: false });
    if (code === 'GRAPH_STALE') return refused('model_exists');
    return unknownSave('not_confirmed', { check: 'ack_status', status: reg.status });
  }
  if (reg.status >= 400 && reg.status < 500) return refused('registration_refused');
  if (reg.status !== 200) return unknownSave('not_confirmed', { check: 'ack_status', status: reg.status });

  // The response is THIS create-only registration's receipt; history availability is not save verification.
  const receipt = reg.json.model_version as Partial<AtomicCommittedModelVersionReceipt> | undefined;
  const ack = typeof reg.json.graph_identity_hash === 'string' ? reg.json.graph_identity_hash
    : (reg.json.graph_identity_hash as { value?: unknown } | undefined)?.value;
  const after = await readSaved(deps, ctx.scenario_id);
  if (receipt == null) return unknownSave('not_verified', { check: 'receipt_absent' });
  if (typeof receipt.version_id !== 'string' || receipt.version_id === '') return unknownSave('not_verified', { check: 'receipt_invalid', field: 'version_id' });
  if (!Number.isSafeInteger(receipt.version_number) || Number(receipt.version_number) < 1) return unknownSave('not_verified', { check: 'revision_mismatch', field: 'version_number' });
  if (typeof receipt.mutation_id !== 'string' || receipt.mutation_id === '') return unknownSave('not_verified', { check: 'receipt_invalid', field: 'mutation_id' });
  if (!isSavedRead(after)) return unknownSave('not_verified', { check: 'readback_unavailable', code: after.status === 'ok' ? 'read_malformed' : after.reason });
  if (typeof ack !== 'string') return unknownSave('not_verified', { check: 'ack_status', status: reg.status });
  if (ack !== after.identity) return unknownSave('not_verified', { check: 'hash_mismatch', field: 'ack_identity', expected: hashPrefix(ack), actual: hashPrefix(after.identity) });
  if (receipt.graph_identity_hash !== ack) return unknownSave('not_verified', { check: 'hash_mismatch', field: 'receipt_identity', expected: hashPrefix(ack), actual: hashPrefix(receipt.graph_identity_hash) });
  const identity = computeGraphIdentityHash(after.graph as never)?.value;
  if (identity !== ack) return unknownSave('not_verified', { check: 'hash_mismatch', field: 'read_identity', expected: hashPrefix(ack), actual: hashPrefix(identity) });
  if (reg.json.graph_hash !== after.graphHash) return unknownSave('not_verified', { check: 'revision_mismatch', field: 'graph_hash', expected: hashPrefix(reg.json.graph_hash), actual: hashPrefix(after.graphHash) });
  const analysisHash = computeAnalysisAffectingGraphHashSha256(after.graph as never);
  if (receipt.analysis_affecting_hash !== analysisHash) return unknownSave('not_verified', { check: 'hash_mismatch', field: 'analysis_hash', expected: hashPrefix(analysisHash), actual: hashPrefix(receipt.analysis_affecting_hash) });
  if (!approvedGraphHeld(graph, after.graph)) return unknownSave('not_verified', { check: 'postimage_diff',
    keys: Object.keys(graph).filter((key) => !approvedGraphHeld(graph, { ...graph, [key]: after.graph[key] })).slice(0, 8),
  });
  if (reg.json.replayed === true) return ok({ already_saved: true, model_version: receipt }, { mutated: false });
  try { deps.onModelRegistered?.(after.graph); } catch { /* an observer never decides the outcome */ }
  return ok({
    provisional: 'olumi', model_version: receipt, revision: { graph_hash: after.graphHash, graph_identity_hash: after.identity },
    draft: { withheld: mapped.withheld, relabelled: kernelled.relabelled },
  }, { mutated: true });
}
