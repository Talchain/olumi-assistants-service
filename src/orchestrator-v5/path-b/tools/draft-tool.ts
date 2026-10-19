/**
 * ⭐ PATH-B: THE DRAFT ADAPTER (C5, 19 Oct 2026). Olumi's PROVISIONAL first model from the user's brief.
 *  1. literal check only: the brief is in the user's own typed words (`inTheUsersWords`);
 *  2. ⚠ NAMED BRIDGE (DL-3 ruling 6, first candidate only): the existing construction (`buildModelFromBrief`, which drafts and
 *     registers create-only). Step 8's pure `candidateToGraph` replaces it in candidate 2;
 *  3. an INDEPENDENT readback (build-model.ts:3098–3143 registers without one): `mutated` only when THIS construction's own
 *     version (`findConstructionVersion`, by its operation id) is on record AND a fresh read holds a model.
 * A retry of a construction that already committed reports "already saved", never a second write or "model exists".
 */
import { z } from 'zod/v4';
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { buildModelFromBrief, findConstructionVersion, type CallStructuredModel } from '../../agent-lane/runtime/build-model.js';
import { isSavedRead, readSaved } from './context-tool.js';
import { ok, refused, unavailable, type ToolOutcome } from './outcome.js';
import { inTheUsersWords, type TypedWords } from './user-words.js';

export const BUILD_MODEL_FROM_BRIEF = 'build_model_from_brief';
export const BuildModelParams = z.object({
  /** The user's brief, copied verbatim from their own messages. */
  brief: z.string().min(1).max(20_000),
}).strict();
export type BuildModelArgs = z.infer<typeof BuildModelParams>;

export interface DraftDeps {
  readonly dispatch: InternalDispatch;
  readonly callStructured?: CallStructuredModel;
  /** The route's GRAPH_READY observer: told once, with the graph as read back. */
  readonly onModelRegistered?: (graph: Record<string, unknown>) => void;
}

const nodesIn = (graph: Record<string, unknown>): number => (Array.isArray(graph.nodes) ? graph.nodes.length : 0);

export async function buildModel(deps: DraftDeps, ctx: Pick<AgentToolContext, 'scenario_id'> & TypedWords, args: BuildModelArgs): Promise<ToolOutcome> {
  if (!inTheUsersWords(args.brief, ctx)) return refused('brief_not_users_words');
  if (deps.callStructured === undefined) return unavailable('drafter_unavailable');
  const before = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(before)) return before;
  const ownVersion = () => findConstructionVersion(deps.dispatch, ctx.scenario_id, args.brief).catch(() => null);
  if (nodesIn(before.graph) > 0) {
    const prior = await ownVersion();
    return prior === null ? refused('model_exists') : ok({ already_saved: true, model_version: prior }, { mutated: false });
  }

  let res: Awaited<ReturnType<typeof buildModelFromBrief>>;
  try {
    res = await buildModelFromBrief(ctx.scenario_id, args.brief, deps.dispatch, deps.callStructured);
  } catch {
    return unavailable('not_confirmed', 'unknown');
  }
  if (res.ok !== true) {
    if (res.mutated === true || (res.refusal === 'registration_refused' && typeof res.http === 'number' && res.http >= 500)) {
      return unavailable('not_confirmed', 'unknown');
    }
    if (res.refusal === 'model_already_exists') return refused('model_exists');
    if (res.refusal === 'no_structured_output') return unavailable('no_structured_output');
    return refused(typeof res.refusal === 'string' && /^[a-z][a-z0-9_]*$/.test(res.refusal) ? res.refusal : 'construction_refused');
  }

  const [receipt, after] = await Promise.all([ownVersion(), readSaved(deps, ctx.scenario_id)]);
  if (receipt === null || !isSavedRead(after) || nodesIn(after.graph) === 0) return unavailable('not_verified', 'unknown');
  if (res.replayed === true) return ok({ already_saved: true, model_version: receipt }, { mutated: false });
  try { deps.onModelRegistered?.(after.graph); } catch { /* an observer never decides the outcome */ }
  return ok({ provisional: 'olumi', model_version: receipt, revision: { graph_hash: after.graphHash, graph_identity_hash: after.identity } },
    { mutated: true });
}
