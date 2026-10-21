/**
 * THIN CORE: CHANGING A CORE SCENARIO (20 Oct 2026). On a scenario whose meaning is its living model:
 *  · `propose_change` carries the COMPLETE proposed living model. Olumi labels its attribution (the kernel), says exactly
 *    what it changes, item by item (`diffLivingModels`), and what the engine graph would withhold, and changes nothing.
 *    A removal is never implied by an omission: every removed item must be named in `remove` (the card shows only its
 *    label, so an unnamed removal would be approved unseen); a removed condition is kept in history, and a view or
 *    history entry is never removed here;
 *  · `apply_change`, on the person's approval of THAT proposal, writes the model and the graph regenerated from it as ONE
 *    core write on the proposal's base (CAS). A model that moved since is `superseded`, never overwritten; this operation's
 *    own earlier save is reported as already saved, never repeated; an unverifiable save stays UNKNOWN.
 */
import { z } from 'zod-v4';
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { createProposal, type ProposalOperation, type ProposalStore, type StructuredProposal } from '../../agent-lane/proposal.js';
import { LivingModel, type LivingModelT } from '../../../schemas/living-model.js';
import { applyKernel } from '../living-model/kernel.js';
import { mapLivingModel, savedGoal } from '../living-model/mapper.js';
import { diffLivingModels, type LivingChange } from '../living-model/diff.js';
import { livingViewOf } from '../living-model/view.js';
import { isNoModelYet, isSavedRead, readSaved } from './context-tool.js';
import { changeOperationId, findOperationVersion, writeCorePostimage } from './core-write.js';
import { ok, refused, unavailable, type ToolOutcome } from './outcome.js';

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
interface Deps { readonly dispatch: InternalDispatch; readonly proposals: ProposalStore }
type Rec = Record<string, unknown>;

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
  const base = await savedLiving(deps, ctx);
  if ('status' in base) return base;
  const brief = typeof base.saved.json.brief_text === 'string' ? [base.saved.json.brief_text] : [];
  const kernelled = applyKernel(args.model, [...brief, ...(ctx.verified_user_messages ?? []), ...(ctx.user_turn_text ? [ctx.user_turn_text] : [])], base.model);
  // A condition is corrected or resolved by replacing it ("only after supplier approval" → "supplier approval obtained"; Codex
  // r6 on #3522): its removal is a row on the card the person approves, and the condition itself goes to history with the
  // person's words this turn, so a correction never loses what it replaced.
  const goneConditions = diffLivingModels(base.model, kernelled.model).filter((c) => c.kind === 'condition' && c.change === 'remove'
    && !kernelled.model.history.some((h) => h.old === JSON.stringify(c.before)));
  const next: LivingModelT = goneConditions.length === 0 ? kernelled.model : { ...kernelled.model, history: [...kernelled.model.history,
    ...goneConditions.map((c) => ({ id: 'condition', change: 'superseded' as const, old: JSON.stringify(c.before), quote: ctx.user_turn_text || null }))] };
  const changes = diffLivingModels(base.model, next);
  if (changes.length === 0) return refused('no_change');
  const removed = changes.filter((c) => c.change === 'remove' && c.kind !== 'condition');
  const dropped = removed.filter((c) => c.kind === 'view' || c.kind === 'history');
  if (dropped.length > 0) return refused('cannot_remove_here', undefined, { kinds: [...new Set(dropped.map((c) => c.kind))] });
  const unnamed = removed.filter((c) => !args.remove.includes(c.id)).map((c) => c.id);
  if (unnamed.length > 0) return refused('removal_not_named', undefined, { left_out: unnamed });
  const kept = args.remove.filter((id) => !removed.some((c) => c.id === id));
  if (kept.length > 0) return refused('removal_not_applied', undefined, { still_present: kept });
  const mapped = mapLivingModel(next, savedGoal(base.saved.graph));
  if (!mapped.graph.nodes.some((n) => n.kind !== 'decision')) return refused('model_empty');
  const p = deps.proposals.put(createProposal({ scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id,
    base_graph_identity_hash: base.saved.graphHash, base_model_identity: base.saved.identity!, operations: operationsOf(changes),
    provenance: { authored_by: 'model_proposed', basis: args.basis }, validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: args.public_label, living_model: next }));
  return ok({ proposal_id: p.proposal_id, public_label: p.public_label, base_revision: base.saved.graphHash,
    changes, withheld: mapped.withheld, assumed: mapped.assumed, relabelled: kernelled.relabelled });
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
  const mapped = mapLivingModel(p.living_model, savedGoal(before.graph));
  const graph: Rec = { ...mapped.graph, living_model: p.living_model };
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
