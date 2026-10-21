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
 *  4. an INDEPENDENT readback (`writeCorePostimage`, the one core write): `mutated` only when THIS registration's own receipt
 *     and CAS hashes match a fresh read AND that read holds the complete postimage, living model included.
 * A retry of a construction that already committed reports "already saved", never a second write or "model exists".
 */
import { z } from 'zod-v4';
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { constructionOperationId, findConstructionVersion } from '../../agent-lane/runtime/build-model.js';
import { LivingModel } from '../../../schemas/living-model.js';
import { applyKernel } from '../living-model/kernel.js';
import { mapLivingModel } from '../living-model/mapper.js';
import { hasGaps, structureGaps } from '../living-model/structure.js';
import type { CritiqueT } from '../../agent-lane/core/model-critic.js';
import { isNoModelYet, isSavedRead, readSaved } from './context-tool.js';
import { ok, refused, OUTCOME_TRACE, type ToolOutcome } from './outcome.js';
import { writeCorePostimage } from './core-write.js';
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
  /** One review per turn (`pathBTools` makes it per turn): only the turn's first draft goes to the critic. */
  readonly review?: { done: boolean };
  /**
   * The second model's review of a first draft (`model-critic.ts`; Paul, 21 Oct: a multi-model architecture that checks and
   * enhances the model). Read once, beside the structure check; undefined when unavailable, so a draft never waits on it.
   */
  readonly critique?: (input: string) => Promise<CritiqueT | undefined>;
}

/** What the AI is told when a reviewer read its first draft. Nothing is saved; the drafter decides what to adopt. */
export const REVIEW_FIRST = 'Nothing was saved yet: a second reviewer read your first draft (critique; gaps are structural facts). '
  + 'Revise once, then call build_model_from_brief again with the complete model. Adopt only what helps the person reason; a genuinely '
  + 'new inference of yours is Olumi\'s (source olumi, quote null), while every item the person or another party stated keeps its source, '
  + 'quote and uncertainty unchanged. Every option reaches the goal through what it changes: give its link a direction when you can '
  + 'judge one, else form unknown with sign null so the person can say which way. Connect other items only where there is a real '
  + 'causal relationship; context may stay unconnected. Never invent a chance, a strength or a target figure to complete the model: ask for it instead. In your reply, '
  + 'say which items are Olumi\'s suggestions, and ask the critique\'s question if it is still open.';

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
  const gaps = structureGaps(kernelled.model);
  if (deps.review !== undefined && !deps.review.done) {
    deps.review.done = true;
    const critique = await deps.critique?.(JSON.stringify({ brief: args.brief, draft: kernelled.model, gaps }));
    if (critique !== undefined) return refused('review_first', REVIEW_FIRST, { gaps, critique });
  }
  const graph: Record<string, unknown> = { ...mapped.graph, living_model: kernelled.model };

  const write = await writeCorePostimage(deps, { scenarioId: ctx.scenario_id, graph, briefText: args.brief,
    operationId: constructionOperationId(ctx.scenario_id, args.brief),
    // Create-only: the route refuses `GRAPH_STALE` if a model appeared since the read above (`buildModelFromBrief`'s contract).
    expectedIdentity: null, ownVersion });
  if (write.status === 'unknown') return write.outcome;
  if (write.status === 'stale') return refused('model_exists');
  if (write.status === 'refused') return refused('registration_refused');
  if (write.status === 'already_saved') return ok({ already_saved: true, model_version: write.receipt }, { mutated: false });
  const { receipt, after } = write;
  try { deps.onModelRegistered?.(after.graph); } catch { /* an observer never decides the outcome */ }
  return ok({
    provisional: 'olumi', model_version: receipt, revision: { graph_hash: after.graphHash, graph_identity_hash: after.identity },
    draft: { withheld: mapped.withheld, assumed: mapped.assumed, relabelled: kernelled.relabelled, ...(hasGaps(gaps) ? { gaps } : {}) },
  }, { mutated: true });
}
