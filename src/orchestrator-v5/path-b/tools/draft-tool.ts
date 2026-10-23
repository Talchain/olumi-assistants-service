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
import { withCalendarReadings } from '../living-model/calendar-reading.js';
import { todayInLondon } from '../../goal-target/deadline-date.js';
import { mapLivingModel } from '../living-model/mapper.js';
import { hasGaps, structureGaps } from '../living-model/structure.js';
import type { CritiqueT } from '../../agent-lane/core/model-critic.js';
import { isNoModelYet, isSavedRead, readSaved } from './context-tool.js';
import { ok, refused, OUTCOME_TRACE, withTrace, type ToolOutcome } from './outcome.js';
import { writeCorePostimage } from './core-write.js';
import { blockersOf, corePostimage, KEPT_AS_REFUSED, personContentLost, repairOf, REPAIR_DRAFT, REPAIRS, selfCheck, STILL_ASK, type Restructure } from './goal-path.js';
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
   * enhances the model). Read once, beside the save, within what is left of the construction deadline; undefined when unavailable.
   */
  readonly critique?: (input: string, msLeft?: number) => Promise<CritiqueT | undefined>;
  /**
   * When the construction must have ended (`constructionDeadline`: the stream budget less the save and the reply). The review
   * gets only what is left of it, so it never takes the save's time (buddy served BLOCK on #3574: 217 s turn, 170 s stream).
   */
  readonly deadlineAt?: number;
  /** The turn's repairs of a draft a Run would withhold the goal's chance on (`goal-path.ts`). */
  readonly restructure?: Restructure;
}

/**
 * What the AI is told with the saved first draft's review (Track 3, candidate 2: the review used to refuse the first build, and
 * the redraft cost 32–46 s of a first turn whose replies overran the stream at 151–162 s). The draft is saved at once; the
 * reviewer's point reaches the person as Olumi's suggestion in the reply, and the person decides whether to adopt it.
 */
export const REVIEW_AFTER_SAVE = 'Your draft is saved. A second reviewer read it (critique; gaps are structural facts). Do not rebuild or '
  + 'change the model in this turn. In your reply, name the critique\'s most useful point as Olumi\'s suggestion the person can ask you to '
  + 'add. Its question is a candidate for your one question: ask whichever input would most change how the options compare.';

const nodesIn = (graph: Record<string, unknown>): number => (Array.isArray(graph.nodes) ? graph.nodes.length : 0);

type DraftContext = Pick<AgentToolContext, 'scenario_id'> & Partial<Pick<AgentToolContext, 'request_id'>> & TypedWords;
/** The words a draft's kernel checks quotes against: its brief and the person's own messages. */
const draftWords = (ctx: DraftContext, brief: string): string[] =>
  [brief, ...(ctx.verified_user_messages ?? []), ...(ctx.user_turn_text === undefined ? [] : [ctx.user_turn_text])];

export async function buildModel(deps: DraftDeps, ctx: DraftContext, args: BuildModelArgs): Promise<ToolOutcome> {
  // ⭐ THE RETRY NEVER LOSES THE PERSON'S CONTENT (DL, #3672 fix-forward): a second draft that left out or changed an item the
  // person or a party gave is not used; the refused draft is, exactly as base would have saved it.
  // Compared as the kernel reads them (canonical ids, labelled sources), so a retry that differs only there is no loss.
  const r = deps.restructure;
  const first = r?.pending?.tool === BUILD_MODEL_FROM_BRIEF ? r.pending.args : undefined;
  const read = (a: BuildModelArgs) => applyKernel(a.model, draftWords(ctx, a.brief)).model;
  const lost = first === undefined ? [] : personContentLost(read(first), read(args));
  // The refused draft is used as it is: no repair is left for it.
  if (lost.length > 0) r!.repairs = REPAIRS;
  const outcome = await constructUnrecorded(deps, ctx, first !== undefined && lost.length > 0 ? first : args);
  // Only a draft settles a pending draft: another tool's result never discards it (Codex r1 on #3675).
  if (outcome.status === 'ok' && r?.pending?.tool === BUILD_MODEL_FROM_BRIEF) r.pending = undefined;
  const save_outcome = outcome.status === 'ok' ? 'VERIFIED_SAVED'
    : outcome.status === 'unavailable' && outcome.write === 'unknown' ? 'UNKNOWN' : 'VERIFIED_NO_WRITE';
  return Object.defineProperty({ ...outcome, data: { ...outcome.data, save_outcome,
    ...(lost.length > 0 ? { restructure: { kept: 'refused_call', lost, note: KEPT_AS_REFUSED } } : {}) }, ...(save_outcome === 'UNKNOWN' ? {
    detail: 'The construction was dispatched, but its save could not be verified. It may already be saved. Do not say nothing was saved, and do not repeat a write or Run to repair the reply.',
  } : {}) }, OUTCOME_TRACE, { value: outcome[OUTCOME_TRACE] });
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

  const words = draftWords(ctx, args.brief);
  const msLeft = (): number | undefined => (deps.deadlineAt === undefined ? undefined : deps.deadlineAt - Date.now());
  // A calendar deadline's reading is labelled with the day the host read it (`calendar-reading.ts`).
  const read = applyKernel(args.model, words);
  const kernelled = { ...read, model: withCalendarReadings(read.model, undefined, todayInLondon(new Date())) };
  const mapped = mapLivingModel(kernelled.model);
  if (!mapped.graph.nodes.some((n) => n.kind !== 'decision')) return refused('model_empty');
  // ⭐ THE READINESS SELF-CHECK (`goal-path.ts`): a draft a Run would withhold the goal's chance on is said back, before any save
  // or review, while a fix and a repair are left; then it is saved as it is, with its asks.
  const { all: blockers } = blockersOf(kernelled.model, selfCheck(kernelled.model, mapped));
  if (repairOf(deps.restructure, blockers, args.model)) {
    deps.restructure!.repairs += 1;
    deps.restructure!.pending = { tool: BUILD_MODEL_FROM_BRIEF, args };
    return refused('not_run_ready', REPAIR_DRAFT, { blockers });
  }
  const gaps = structureGaps(kernelled.model);
  // The turn's first draft is reviewed BESIDE its save, never before it: the critic never gates or delays the write.
  const reviewing = deps.review !== undefined && !deps.review.done;
  if (deps.review !== undefined) deps.review.done = true;
  const critiqued = reviewing
    ? (deps.critique?.(JSON.stringify({ brief: args.brief, draft: kernelled.model, gaps }), msLeft()) ?? Promise.resolve(undefined)).catch(() => undefined)
    : Promise.resolve(undefined);
  const graph = corePostimage(mapped, kernelled.model);

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
  const critique = await critiqued;
  // The kernel's authorship decisions are the host's, applied to the saved model; the AI is not told them (R7), only the log is.
  return withTrace(ok({
    provisional: 'olumi', model_version: receipt, revision: { graph_hash: after.graphHash, graph_identity_hash: after.identity },
    draft: { withheld: mapped.withheld, assumed: mapped.assumed, ...(hasGaps(gaps) ? { gaps } : {}) },
    run_ready: blockers.length === 0, ...(blockers.length > 0 ? { blockers, note: STILL_ASK } : {}),
    ...(critique !== undefined ? { review: { critique, note: REVIEW_AFTER_SAVE } } : {}),
  }, { mutated: true }), { relabelled: kernelled.relabelled });
}
