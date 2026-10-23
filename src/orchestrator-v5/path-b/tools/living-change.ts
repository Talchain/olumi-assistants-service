/**
 * THIN CORE: CHANGING A CORE SCENARIO (20 Oct 2026). On a scenario whose meaning is its living model:
 *  · `propose_change` carries the COMPLETE proposed living model. Olumi labels its attribution (the kernel), says exactly
 *    what it changes, item by item (`diffLivingModels`), and what the engine graph would withhold, and changes nothing.
 *    A removal is never implied by an omission: every removed item must be named in `remove` (the card shows only its
 *    label, so an unnamed removal would be approved unseen); a removed condition, or a view replaced by its
 *    holder's new one, is kept in history; any other view, and a history entry, is never removed here;
 *  · `apply_change`, on the person's approval of THAT proposal, writes the model and the graph regenerated from it as ONE
 *    core write on the proposal's base (CAS). A model that moved since is `superseded`, never overwritten; this operation's
 *    own earlier save is reported as already saved, never repeated; an unverifiable save stays UNKNOWN.
 */
import { z } from 'zod-v4';
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { createProposal, type ProposalOperation, type ProposalStore, type StructuredProposal } from '../../agent-lane/proposal.js';
import { LivingModel, type LivingModelT } from '../../../schemas/living-model.js';
import { applyKernel, canonicalIds, plain } from '../living-model/kernel.js';
import { withCalendarReadings } from '../living-model/calendar-reading.js';
import { todayInLondon } from '../../goal-target/deadline-date.js';
import { changeGoal, goalIdOf, mapLivingModel, savedGoal } from '../living-model/mapper.js';
import { blockersOf, corePostimage, KEPT_AS_REFUSED, personContentLost, repairOf, REPAIR_CHANGE, REPAIRS, selfCheck, STILL_ASK, type Restructure } from './goal-path.js';
import { diffLivingModels, stable, type LivingChange } from '../living-model/diff.js';
import { livingViewOf } from '../living-model/view.js';
import { isNoModelYet, isSavedRead, readSaved } from './context-tool.js';
import { changeOperationId, findOperationVersion, writeCorePostimage } from './core-write.js';
import { ok, OUTCOME_TRACE, refused, unavailable, withTrace, type ToolOutcome } from './outcome.js';

export const LivingChangeParams = z.object({
  /** What the person is asked to approve, in plain words. */
  public_label: z.string(),
  /** Why Olumi proposes it. */
  basis: z.string(),
  /** The complete living model as it would be after the change: every item, changed or not, with who said it. */
  model: LivingModel,
  /** The ids of the aims, options, factors and links this change removes. Anything else left out is not a removal. */
  remove: z.array(z.string()),
}).strict();
export type LivingChangeArgs = z.infer<typeof LivingChangeParams>;

type Ctx = Pick<AgentToolContext, 'scenario_id' | 'authenticated_user_id' | 'turn_id' | 'verified_user_messages' | 'user_turn_text'>;
interface Deps {
  readonly dispatch: InternalDispatch; readonly proposals: ProposalStore;
  /** The turn's repairs of a change a Run would withhold the goal's chance on (`goal-path.ts`). */
  readonly restructure?: Restructure;
}

/** The card's rows: one operation per changed item, on the item's own id. */
function operationsOf(changes: readonly LivingChange[]): ProposalOperation[] {
  return changes.map((c): ProposalOperation => ({ op: 'living_change', path: `${c.kind}:${c.id}`,
    value: { change: c.change, ...(c.before === undefined ? {} : { before: c.before }), ...(c.after === undefined ? {} : { after: c.after }) } }));
}

/** The saved living model of a core scenario, or the outcome that says why there is none to change. */
async function savedLiving(deps: Deps, ctx: Ctx) {
  const saved = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(saved)) return isNoModelYet(saved) ? refused('no_model_yet') : saved;
  if (saved.identity === null) return unavailable('read_malformed');
  const view = livingViewOf(saved.graph);
  if (view === undefined) return refused('not_a_core_scenario');
  if (!('withheld' in view)) return refused('living_model_invalid');
  return { saved, model: view.living_model as LivingModelT };
}

export async function proposeLivingChange(deps: Deps, ctx: Ctx, args: LivingChangeArgs): Promise<ToolOutcome> {
  // ⭐ THE RETRY NEVER LOSES THE PERSON'S CONTENT (DL, #3672 fix-forward): a second change that left out or changed an item the
  // person or a party gave is not used; the refused change is, exactly as base would have carded it.
  // Compared as the kernel reads them on the saved model (canonical ids, labelled sources): one extra read, on a retry only.
  const r = deps.restructure;
  const first = r?.pending?.tool === 'propose_change' ? r.pending.args : undefined;
  const base = first === undefined ? undefined : await savedLiving(deps, ctx);
  // The saved aim the host asked to be replaced, named in remove by the call right after that refusal, is the replace, never a
  // loss (Codex r1 on #3697: never once another refusal came between, which may have given the aim the person's words).
  const invited = r?.replace !== undefined && r.replace.of === first ? r.replace.id : undefined;
  const replaced = invited !== undefined && args.remove.includes(invited) ? `aims:${invited}` : undefined;
  const lost = first === undefined || base === undefined || 'status' in base ? []
    : personContentLost(kernelFor(base, ctx, first.model).model, kernelFor(base, ctx, args.model).model).filter((l) => l !== replaced);
  // The refused change is used as it is: no repair is left for it.
  if (lost.length > 0) r!.repairs = REPAIRS;
  const outcome = await proposeOnce(deps, ctx, first !== undefined && lost.length > 0 ? first : args);
  // Only a card settles a pending change: another tool's result never discards it (Codex r1 on #3675).
  if (outcome.status === 'ok' && r?.pending?.tool === 'propose_change') { r.pending = undefined; r.replace = undefined; }
  // A spread drops the trace (a symbol key): it is carried over, so the log keeps the kept call's authorship (Codex r1 on #3694).
  return outcome.status === 'ok' && lost.length > 0
    ? withTrace({ ...outcome, data: { ...outcome.data, restructure: { kept: 'refused_call', lost, note: KEPT_AS_REFUSED } } }, outcome[OUTCOME_TRACE] ?? {})
    : outcome;
}

/**
 * The kernel on a change: the person's words (the saved brief and their messages) and the saved model it changes. A calendar
 * deadline's reading: a saved one stands while its words do; a new one gets the host's day (`calendar-reading.ts`), before the
 * kernel judges what changed and again on its canonical ids.
 */
function kernelFor(base: Exclude<Awaited<ReturnType<typeof savedLiving>>, ToolOutcome>, ctx: Ctx, model: LivingModelT) {
  const brief = typeof base.saved.json.brief_text === 'string' ? [base.saved.json.brief_text] : [];
  const today = todayInLondon(new Date());
  // On the kernel's canonical ids, so a reading is matched to the saved aim the kernel judges by (Codex r3 on #3674).
  const read = applyKernel(withCalendarReadings(canonicalIds(model), base.model, today), [...brief, ...(ctx.verified_user_messages ?? []),
    ...(ctx.user_turn_text ? [ctx.user_turn_text] : [])], base.model, brief[0] ?? null);
  return { ...read, model: withCalendarReadings(read.model, base.model, today) };
}

/** Whether an aim's target states a figure (Olumi's suggested measure never carries one). */
const statesFigure = (a: LivingModelT['aims'][number]): boolean => a.target !== null && a.target.source !== 'olumi'
  && (a.target.value !== null || a.target.low !== null || a.target.high !== null);

/** The goal aim a Run would test, when it states no figure while a current aim of the person's or a party's beside it does. */
function besideNoGoal(m: LivingModelT, goal: string | undefined): LivingModelT['aims'][number] | undefined {
  const aim = m.aims.find((a) => a.id === goal);
  return aim !== undefined && !statesFigure(aim) && m.aims.some((a) => a.id !== goal && a.status === 'current'
    && (a.source === 'user' || a.source === 'party') && statesFigure(a)) ? aim : undefined;
}

/** What the AI is told when its change leaves the person's stated goal beside an aim that is no goal (never shown to the person). */
export const REPLACE_AIM = 'No card yet. A Run would test the aim in aim, which states no figure, while the person\'s own goal with a figure '
  + 'sits beside it. If that aim is not a goal they hold (a task, an option or Olumi\'s reading of their words), replace it: name its id '
  + 'in remove and call propose_change once more. If it is their own aim, send the call unchanged; its card is made.';

async function proposeOnce(deps: Deps, ctx: Ctx, args: LivingChangeArgs): Promise<ToolOutcome> {
  const base = await savedLiving(deps, ctx);
  if ('status' in base) return base;
  const kernelled = kernelFor(base, ctx, args.model);
  // A condition is corrected or resolved by replacing it ("only after supplier approval" → "supplier approval obtained"; Codex
  // r6 on #3522): its removal is a row on the card the person approves, and the host keeps it in history. The quote is the
  // person's own words for the change: a replacement THEY stated (kernel-verified) on the same items, else null. Never this
  // turn's other words, and never a history entry the AI wrote for it (Codex r1 on #3576).
  const proposed = diffLivingModels(base.model, kernelled.model);
  const of = (kind: 'condition' | 'view', change: 'add' | 'remove') => proposed.filter((c) => c.kind === kind && c.change === change)
    .map((c) => (change === 'add' ? c.after : c.before));
  const gone = of('condition', 'remove') as LivingModelT['conditions'];
  const added = of('condition', 'add') as LivingModelT['conditions'];
  const wordsFor = (c: LivingModelT['conditions'][number]): string | null => added.find((a) => (a.source === 'user' || a.source === 'party')
    && a.quote !== null && a.applies_to.some((id) => c.applies_to.includes(id)))?.quote ?? null;
  // A view is corrected by its holder's new view ("Sam thinks Push is too risky" → "Sam now supports Push"; Codex r7 on #3522),
  // kept in history the same way. Only ONE gone view and ONE new view of that holder pair: a holder names a person, not a view,
  // so two of Sam's views and one new one is ambiguous and refused (Codex r1 on #3579). The quote is the new view's only where
  // THIS turn's words hold it: a correction is said now, never in the brief. A view dropped with no replacement is still
  // refused: dissent is never removed here.
  const newViews = of('view', 'add') as LivingModelT['views'];
  const oldViews = of('view', 'remove') as LivingModelT['views'];
  const holders = (vs: LivingModelT['views'], v: LivingModelT['views'][number]) => vs.filter((n) => plain(n.holder) === plain(v.holder));
  const successor = (v: LivingModelT['views'][number]) => (holders(oldViews, v).length === 1 && holders(newViews, v).length === 1 ? holders(newViews, v)[0] : undefined);
  const goneViews = oldViews.filter((v) => successor(v) !== undefined);
  const turn = plain(ctx.user_turn_text ?? '');
  const said = (q: string | null): string | null => (q !== null && plain(q).length > 0 && turn.includes(plain(q)) ? q : null);
  const olds = new Set([...gone, ...goneViews].map(stable));
  const recordsGone = (old: string): boolean => { try { return olds.has(stable(JSON.parse(old))); } catch { return false; } };
  const saved = new Set(base.model.history.map(stable));
  const next: LivingModelT = olds.size === 0 ? kernelled.model : { ...kernelled.model, history: [
    ...kernelled.model.history.filter((h) => saved.has(stable(h)) || !recordsGone(h.old)),
    ...gone.map((c) => ({ id: 'condition', change: 'superseded' as const, old: JSON.stringify(c), quote: wordsFor(c) })),
    ...goneViews.map((v) => ({ id: 'view', change: 'superseded' as const, old: JSON.stringify(v), quote: said(successor(v)!.quote) }))] };
  const changes = diffLivingModels(base.model, next);
  if (changes.length === 0) return refused('no_change');
  const superseded = new Set(goneViews.map(stable));
  const removed = changes.filter((c) => c.change === 'remove' && c.kind !== 'condition' && !(c.kind === 'view' && superseded.has(stable(c.before))));
  const dropped = removed.filter((c) => c.kind === 'view' || c.kind === 'history');
  if (dropped.length > 0) return refused('cannot_remove_here', undefined, { kinds: [...new Set(dropped.map((c) => c.kind))] });
  const unnamed = removed.filter((c) => !args.remove.includes(c.id)).map((c) => c.id);
  if (unnamed.length > 0) return refused('removal_not_named', undefined, { left_out: unnamed });
  const kept = args.remove.filter((id) => !removed.some((c) => c.id === id));
  if (kept.length > 0) return refused('removal_not_applied', undefined, { still_present: kept });
  const goal = changeGoal(base.saved.graph, next);
  const mapped = mapLivingModel(next, goal);
  if (!mapped.graph.nodes.some((n) => n.kind !== 'decision')) return refused('model_empty');
  const baseMapped = mapLivingModel(base.model, savedGoal(base.saved.graph));
  // ⭐ STATED GOALS REPLACE AN AIM THAT IS NO GOAL (DL 93d79c3e 01:56Z; marketing set b r1 on 05745055: the person's two goals were
  // added beside the drafted "plan the campaign…", which states no figure and stayed the goal, so a Run withheld their chance).
  // Whether that aim is a task or their own is the AI's to judge from their words, so the host asks once, for what this change
  // brings; sent unchanged, the card is made and nothing is dropped. Only the saved aim, kept as saved: one the change itself
  // adds or rewords has no removal to name (Codex r1 on #3697).
  const beside = besideNoGoal(next, goalIdOf(mapped.graph));
  const r = deps.restructure;
  if (beside !== undefined && base.model.aims.some((a) => stable(a) === stable(beside))
    && besideNoGoal(base.model, goalIdOf(baseMapped.graph)) === undefined && r !== undefined && r.repairs < REPAIRS
    && !(r.pending !== undefined && stable(r.pending.args.model) === stable(args.model))) {
    r.repairs += 1;
    r.pending = { tool: 'propose_change', args };
    r.replace = { id: beside.id, of: args };
    return refused('goal_beside_no_goal', REPLACE_AIM, { aim: { id: beside.id, text: beside.text } });
  }
  // ⭐ THE READINESS SELF-CHECK (`goal-path.ts`): a change that ADDS a blocker to what a Run would get is said back, before its card,
  // while a fix and a repair are left; what the saved model already held is not this change's to answer for.
  const { all: blockers, added: introduced } = blockersOf(next, selfCheck(next, mapped), selfCheck(base.model, baseMapped));
  if (repairOf(deps.restructure, introduced, args.model)) {
    deps.restructure!.repairs += 1;
    deps.restructure!.pending = { tool: 'propose_change', args };
    return refused('not_run_ready', REPAIR_CHANGE, { blockers: introduced });
  }
  const p = deps.proposals.put(createProposal({ scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id,
    base_graph_identity_hash: base.saved.graphHash, base_model_identity: base.saved.identity!, operations: operationsOf(changes),
    provenance: { authored_by: 'model_proposed', basis: args.basis }, validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: args.public_label, living_model: next }));
  // The kernel's authorship decisions are the host's, applied to the card's model; the AI is not told them (R7), only the log is.
  return withTrace(ok({ proposal_id: p.proposal_id, public_label: p.public_label, base_revision: base.saved.graphHash,
    changes, withheld: mapped.withheld, assumed: mapped.assumed,
    run_ready: blockers.length === 0, ...(blockers.length > 0 ? { blockers, note: STILL_ASK } : {}) }), { relabelled: kernelled.relabelled });
}

/** A proposal this module prepared: it carries the complete living model it would write. */
export const isLivingProposal = (p: StructuredProposal | undefined): p is StructuredProposal & { readonly living_model: LivingModelT } =>
  p !== undefined && p.living_model !== undefined;

export async function applyLivingChange(deps: Deps, ctx: Ctx, proposalId: string): Promise<ToolOutcome> {
  const p = deps.proposals.get(proposalId);
  if (!isLivingProposal(p)) return refused(p === undefined ? 'unknown_proposal' : 'not_a_change_proposal');
  if (p.scenario_id !== ctx.scenario_id || p.user_id !== ctx.authenticated_user_id) return refused('not_authorised');
  const operationId = changeOperationId(ctx.scenario_id, p.proposal_id);
  const ownVersion = () => findOperationVersion(deps.dispatch, ctx.scenario_id, operationId);
  const alreadySaved = (receipt: unknown): ToolOutcome => {
    if (receipt !== null && typeof receipt === 'object') deps.proposals.markApplied(p.proposal_id, [receipt as never]);
    return ok({ already_saved: true, receipt }, { mutated: false });
  };
  const prior = await ownVersion().catch(() => null);
  if (prior !== null) return alreadySaved(prior);
  const before = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(before)) return before;
  const decision = deps.proposals.authorise({ proposal_id: p.proposal_id, scenario_id: ctx.scenario_id,
    authenticated_user_id: ctx.authenticated_user_id, current_graph_identity_hash: before.graphHash, typed_approval_of: p.proposal_id });
  if (decision.status === 'already_applied') return alreadySaved(decision.receipts[0] ?? null);
  if (decision.status !== 'execute') return refused(decision.status);
  // The model's FULL identity when it was prepared: any change since, wording included, supersedes the proposal.
  if (p.base_model_identity !== before.identity) return refused('superseded');
  const mapped = mapLivingModel(p.living_model, changeGoal(before.graph, p.living_model));
  const graph = corePostimage(mapped, p.living_model);
  const commit = async (): Promise<ToolOutcome> => {
    const w = await writeCorePostimage(deps, { scenarioId: ctx.scenario_id, graph, operationId, expectedIdentity: before.identity, ownVersion });
    if (w.status === 'unknown') return w.outcome;
    if (w.status === 'stale') return refused('superseded');
    if (w.status === 'refused') return refused('registration_refused');
    if (w.status === 'already_saved') return alreadySaved(w.receipt);
    deps.proposals.markApplied(p.proposal_id, [w.receipt as never]);
    return ok({ saved: true, receipt: w.receipt, revision: { graph_hash: w.after.graphHash, graph_identity_hash: w.after.identity },
      withheld: mapped.withheld, assumed: mapped.assumed }, { mutated: true });
  };
  const reconcile = async (): Promise<ToolOutcome> => {
    const own = await ownVersion().catch(() => null);
    return own !== null ? alreadySaved(own) : unavailable('not_confirmed', 'unknown');
  };
  return deps.proposals.executeApproved(p, ctx.turn_id ?? operationId, commit,
    (o) => (o.status === 'ok' ? 'applied' : o.status === 'unavailable' && o.write === 'unknown' ? 'unknown' : 'none'), reconcile);
}
