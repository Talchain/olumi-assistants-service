/**
 * ⭐ PATH-B: PROPOSE AND APPLY A CHANGE (C5, 19 Oct 2026; DL-3 rulings 1–3 and 7, PL 3b; outbox/C5-PATHB-PROPOSE-APPLY-DESIGN.md).
 *
 * `propose_change` writes nothing. The AI declares each figure and its SOURCE (origin, the user's words, a named third party);
 * the host checks only literal facts on one fresh read: the ids exist, the quote is literally in the user's typed messages,
 * and the carrier can hold the declared origin. It records the declaration in ONE content-hashed proposal (`createProposal`).
 *
 * `apply_change` runs only after the user's press (the SDK's approval interruption, owned by PATH-B):
 *  1. EXACTLY ONCE: this proposal's own committed receipt is looked up first (`/versions` by `authorisationTurnId`), so a
 *     commit whose response was lost, or a restart, reconciles to "already saved", never to `superseded`;
 *  2. the existing approval seam: `proposals.authorise` on the fresh identity, then `executeApproved` (single flight; an
 *     unknown outcome stays blocked);
 *  3. ONE commit through the product's batch door (`commitOptionLevels`: CAS on the base, idempotent on the turn id), with
 *     the declared origins stamped by the writers' own contexts;
 *  4. a save is claimed only on THIS commit's receipt AND the complete approved postimage read back afresh.
 *
 * HOW EACH CARRIER HOLDS A DECLARED ORIGIN (read back by the ONE authority, `provenanceOf`):
 *  · factor value — Olumi's: adopted by the press (`user_assumption` + review → ai, accepted). Any other origin, with the
 *    words literally the user's: an unverified binding (`user_material_unverified` → human, role unverified). A literal match
 *    proves the bytes, never the speaker (PL 3b), so it is never "the user's, verified". The named third party stays in the
 *    hashed operation only: BLOCKED-SCHEMA for canonical state (no carrier holds a name).
 *  · option setting — Olumi's: `cee_hypothesis` (ai; a cell holds no acceptance marker). Any other origin: BLOCKED-SCHEMA —
 *    the level writer stamps only the user's verified figure or Olumi's, so nothing is proposed (`unavailable`).
 * Changes this path does not make yet (the goal's target, a link's strength, add, remove, rename) come back `unavailable`,
 * naming what is not available.
 */
import { z } from 'zod-v4';
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import { authorisationTurnId, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { createProposal, type ProposalOperation, type ProposalStore, type ReceiptSummary, type StructuredProposal } from '../../agent-lane/proposal.js';
import { runWithApprovedBindings, type ApprovedAdoption } from '../../agent-lane/approved-adoption-context.js';
import { defaultFrameFor } from '../../agent-lane/admit-model.js';
import { GraphStaleWriteError } from '../../build-turn-context.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { provenanceOf, type Provenance } from '../../../cee/provenance/provenance-of.js';
import { isSavedRead, readSaved, type SavedRead } from './context-tool.js';
import { ok, refused, unavailable, type ToolOutcome } from './outcome.js';
import { inTheUsersWords, type TypedWords } from './user-words.js';

export const PROPOSE_CHANGE = 'propose_change';
export const APPLY_CHANGE = 'apply_change';

const Source = z.object({
  /** Who the figure comes from, as the AI read it: the user, a third party they named, Olumi, or not known. */
  origin: z.enum(['user', 'third_party', 'olumi', 'unknown']),
  /** The words it comes from, copied verbatim from the user's own messages; null for Olumi's estimate. */
  quote: z.string().nullable(),
  /** The third party the user named as its source; otherwise null. */
  named_source: z.string().nullable(),
}).strict();
const id = z.string();
const unit = z.string().nullable();
const Declared = z.object({ value: z.number(), unit, source: Source }).strict();
/**
 * Changes this path cannot make yet (DL-3 ruling, 19 Oct: one dispatch path, no interim wrapper). The AI can still name one,
 * and is told truthfully that it is not available here, never refused as if a rule forbade it.
 */
const NOT_YET = {
  set_goal_target: 'Changing the goal\'s target isn\'t available on this path yet.',
  set_link_strength: 'Changing how strongly one factor affects another isn\'t available on this path yet.',
  add_to_model: 'Adding a factor or an option isn\'t available on this path yet.',
  remove_from_model: 'Removing something from the model isn\'t available on this path yet.',
  rename: 'Renaming isn\'t available on this path yet.',
} as const;
type NotYet = keyof typeof NOT_YET;
const notYet = (op: NotYet) => z.object({ op: z.literal(op), target_id: id }).strict();
export const ChangeOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_factor_value'), factor_id: id, value: z.number(), unit, source: Source }).strict(),
  z.object({ op: z.literal('set_option_setting'), option_id: id, factor_id: id, value: z.number(), unit, source: Source }).strict(),
  notYet('set_goal_target'), notYet('set_link_strength'), notYet('add_to_model'), notYet('remove_from_model'), notYet('rename'),
]);
type FigureOp = Extract<z.infer<typeof ChangeOp>, { source: unknown }>;
const isNotYet = (o: z.infer<typeof ChangeOp>): o is Extract<z.infer<typeof ChangeOp>, { op: NotYet }> => Object.hasOwn(NOT_YET, o.op);
export const ProposeChangeParams = z.object({
  /** What the approval card says, in a few plain words. */
  public_label: z.string(),
  /** Why, in Olumi's words. */
  basis: z.string(),
  ops: z.array(ChangeOp).min(1).max(12),
}).strict();
/** No pattern: the SDK's strict schema drops it, so a malformed id would fail the parse and end the turn. An id the store
 * does not hold is refused as `unknown_proposal` instead. */
export const ApplyChangeParams = z.object({ proposal_id: z.string() }).strict();
export type ProposeChangeArgs = z.infer<typeof ProposeChangeParams>;
export type ApplyChangeArgs = z.infer<typeof ApplyChangeParams>;

export interface ChangeDeps {
  readonly dispatch: InternalDispatch;
  readonly proposals: ProposalStore;
  /** The product's batch door (`commitOptionLevelsInProcess`), as the route already gives the capabilities. */
  readonly commitOptionLevels?: (input: CommitOptionLevelsInput) => Promise<CommitOptionLevelsResult>;
}
type ChangeCtx = Pick<AgentToolContext, 'scenario_id' | 'authenticated_user_id' | 'turn_id'> & TypedWords;

type Rec = Record<string, unknown>;
type Op = { kind: 'value' | 'setting'; option_id?: string; factor_id: string } & z.infer<typeof Declared>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const nodesOf = (g: Rec): Rec[] => (Array.isArray(g.nodes) ? g.nodes.filter(isRec) : []);
const frameOf = (n: Rec): number | null => {
  const os = isRec(n.observed_state) ? n.observed_state : {};
  return typeof os.cap === 'number' && os.cap > 0 ? os.cap : typeof n.scale_frame === 'number' && n.scale_frame > 0 ? n.scale_frame : null;
};
const close = (a: unknown, b: number): boolean => typeof a === 'number' && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const cellOf = (option: Rec | undefined, factorId: string): unknown => (isRec(option?.interventions) ? option.interventions[factorId] : undefined);

/** The operations as stored on the proposal: the declaration, hashed into its id. */
const operationOf = (o: FigureOp): ProposalOperation => ({
  op: o.op === 'set_factor_value' ? 'set_factor_value' : 'set_option_intervention',
  path: o.op === 'set_factor_value' ? o.factor_id : `${o.option_id}::${o.factor_id}`,
  value: { value: o.value, unit: o.unit, source: o.source },
});
function declaredOf(p: StructuredProposal): Op[] | null {
  const out: Op[] = [];
  for (const o of p.operations) {
    const d = Declared.safeParse(o.value);
    if (!d.success || (o.op !== 'set_factor_value' && o.op !== 'set_option_intervention')) return null;
    const [optionId, factorId] = o.op === 'set_option_intervention' ? o.path.split('::') : [undefined, o.path];
    out.push({ kind: o.op === 'set_factor_value' ? 'value' : 'setting', factor_id: factorId ?? '', ...(optionId === undefined ? {} : { option_id: optionId }), ...d.data });
  }
  return out;
}

type Plan = Pick<CommitOptionLevelsInput, 'links' | 'levels' | 'values' | 'frames'> & { bindings: ApprovedAdoption[] };
type Stop = { refusal: string; op: number };
/** The declared ops as the door's one input, on the read graph. Conversion (ranges, units) stays the writers'. */
function planOf(scenarioId: string, proposalId: string, ops: readonly Op[], graph: Rec): Plan | Stop {
  const byId = new Map(nodesOf(graph).map((n) => [n.id, n]));
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const plan: Plan & { values: NonNullable<Plan['values']>[number][]; frames: NonNullable<Plan['frames']>[number][];
    levels: Plan['levels'][number][]; links: Plan['links'][number][] } = { links: [], levels: [], values: [], frames: [], bindings: [] };
  for (const [i, o] of ops.entries()) {
    const factor = byId.get(o.factor_id);
    if (factor?.kind !== 'factor') return { refusal: 'not_a_factor', op: i };
    const olumi = o.source.origin === 'olumi';
    if (o.kind === 'value') {
      plan.values.push({ factor_id: o.factor_id, value: o.value, ...(o.unit === null ? {} : { unit: o.unit }), author: olumi ? 'model_proposed' : 'user_specified' });
      if (!olumi) plan.bindings.push({ scenarioId, proposalId, targetId: o.factor_id, rawValue: o.value, unverifiedBinding: { source: o.source.quote ?? '', quote: o.source.quote ?? '' } });
      if (frameOf(factor) === null && Math.abs(o.value) > 1) plan.frames.push({ factor_id: o.factor_id, cap: defaultFrameFor(o.value) });
      continue;
    }
    if (byId.get(o.option_id)?.kind !== 'option') return { refusal: 'not_an_option', op: i };
    if (!olumi) return { refusal: 'blocked_schema', op: i };
    const frame = frameOf(factor) ?? plan.frames.find((f) => f.factor_id === o.factor_id)?.cap ?? null;
    if (frame === null && Math.abs(o.value) > 1) return { refusal: 'factor_has_no_range', op: i };
    plan.levels.push(frame === null ? { option_id: o.option_id!, factor_id: o.factor_id, value: o.value, author: 'model_proposed' }
      : { option_id: o.option_id!, factor_id: o.factor_id, value: o.value / frame, raw_value: o.value, cap: frame, ...(o.unit === null ? {} : { unit: o.unit }), author: 'model_proposed' });
    if (!edges.some((e) => e.from === o.option_id && e.to === o.factor_id)) plan.links.push({ option_id: o.option_id!, factor_id: o.factor_id });
  }
  return plan;
}

/** Each op as the model now holds it, with the source the ONE authority reads; `holds` when every op is there as approved. */
function readbackOf(read: SavedRead, ops: readonly Op[]): { holds: boolean; written: Rec[] } {
  const byId = new Map(nodesOf(read.graph).map((n) => [n.id, n]));
  const written = ops.map((o) => {
    const factor = byId.get(o.factor_id);
    const carrier = o.kind === 'value' ? factor?.observed_state : cellOf(byId.get(o.option_id), o.factor_id);
    const figure = typeof carrier === 'number' ? carrier : isRec(carrier) ? (typeof carrier.raw_value === 'number' ? carrier.raw_value : carrier.value) : undefined;
    const source: Provenance = o.kind === 'value' ? provenanceOf({ value: carrier }) : provenanceOf({ setting: carrier, target: factor });
    const storedUnit = isRec(carrier) && typeof carrier.unit === 'string' ? carrier.unit : null;
    const asDeclared = o.source.origin === 'olumi' ? source.origin === 'ai' && (o.kind === 'setting' || source.accepted)
      : source.origin === 'human' && source.role === 'unverified';
    const holds = close(figure, o.value) && asDeclared && (o.unit === null || storedUnit?.trim().toLowerCase() === o.unit.trim().toLowerCase());
    return { holds, row: { op: o.kind === 'value' ? 'set_factor_value' : 'set_option_setting', ...(o.option_id === undefined ? {} : { option_id: o.option_id }),
      factor_id: o.factor_id, figure: figure ?? null, unit: storedUnit, source } };
  });
  return { holds: written.every((w) => w.holds), written: written.map((w) => w.row) };
}

/** THIS proposal's own committed version, by the turn id its write carries; 'unreadable' when the history cannot be read. */
async function ownReceipt(dispatch: InternalDispatch, scenarioId: string, turnId: string): Promise<ReceiptSummary | null | 'unreadable'> {
  let cursor: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    let r: Awaited<ReturnType<InternalDispatch>>;
    try { r = await dispatch(`/assist/v1/scenarios/${scenarioId}/versions`, { limit: 200, ...(cursor === undefined ? {} : { cursor }) }); } catch { return 'unreadable'; }
    if (r.status !== 200) return 'unreadable';
    const hit = (Array.isArray(r.json.versions) ? r.json.versions.filter(isRec) : [])
      .find((v) => isRec(v.creation) && v.creation.source_turn_id === turnId);
    if (hit !== undefined && isRec(hit.creation)) {
      return { version: Number(hit.sequence), version_id: String(hit.version_id), mutation_id: String(hit.creation.mutation_id), source_turn_id: turnId };
    }
    cursor = typeof r.json.next_cursor === 'string' ? r.json.next_cursor : undefined;
    if (cursor === undefined) return null;
  }
  return null;
}

/** BLOCKED-SCHEMA: the level writer stamps only the user's verified figure or Olumi's, so a declared source cannot be kept. */
const BLOCKED_SETTING = (i: number): string => `Change ${i + 1}: an option's setting can be saved only as Olumi's own estimate on this path yet; `
  + 'the source you declared cannot be recorded with it, so nothing was proposed or saved.';

const codeOf = (reason: string): string => {
  const c = reason.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return /^[a-z]/.test(c) ? c : 'change_refused';
};

export async function proposeChange(deps: Pick<ChangeDeps, 'dispatch' | 'proposals'>, ctx: ChangeCtx, args: ProposeChangeArgs): Promise<ToolOutcome> {
  const later = args.ops.find(isNotYet);
  if (later !== undefined) return unavailable(`${later.op}_not_available`, 'none', `${NOT_YET[later.op]} Nothing was proposed or saved.`);
  const ops = args.ops.filter((o): o is FigureOp => !isNotYet(o));
  if (args.public_label.trim() === '') return refused('label_empty');
  for (const [i, o] of ops.entries()) {
    if (o.op === 'set_option_setting' && o.source.origin !== 'olumi') return unavailable('blocked_schema', 'none', BLOCKED_SETTING(i));
    if (o.source.origin !== 'olumi' && (o.source.quote === null || !inTheUsersWords(o.source.quote, ctx))) return refused('quote_not_in_users_words', undefined, { op: i });
  }
  const read = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(read)) return read;
  if (read.identity === null) return unavailable('read_malformed');
  const content = { scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id, base_graph_identity_hash: read.identity,
    operations: ops.map(operationOf), provenance: { authored_by: 'model_proposed' as const, basis: args.basis },
    validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: args.public_label };
  const p = createProposal(content);
  const plan = planOf(ctx.scenario_id, p.proposal_id, declaredOf(p) ?? [], read.graph);
  if ('refusal' in plan) return plan.refusal === 'blocked_schema' ? unavailable('blocked_schema', 'none', BLOCKED_SETTING(plan.op)) : refused(plan.refusal, undefined, { op: plan.op });
  deps.proposals.put(p);
  return ok({ proposal_id: p.proposal_id, public_label: p.public_label, base_revision: read.identity });
}

export async function applyChange(deps: ChangeDeps, ctx: ChangeCtx, args: ApplyChangeArgs): Promise<ToolOutcome> {
  const p = deps.proposals.get(args.proposal_id);
  if (p === undefined) return refused('unknown_proposal');
  if (p.scenario_id !== ctx.scenario_id || p.user_id !== ctx.authenticated_user_id) return refused('not_authorised');
  const ops = declaredOf(p);
  if (ops === null) return refused('not_a_change_proposal');
  if (deps.commitOptionLevels === undefined) return unavailable('writer_unavailable');
  const turnId = authorisationTurnId(p.proposal_id);
  const prior = await ownReceipt(deps.dispatch, ctx.scenario_id, turnId);
  if (prior === 'unreadable') return unavailable('read_failed');
  const before = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(before)) return before;
  const alreadySaved = (receipt: ReceiptSummary | null): ToolOutcome => {
    if (receipt !== null) deps.proposals.markApplied(p.proposal_id, [receipt]);
    return ok({ already_saved: true, receipt, holds_now: readbackOf(before, ops).holds });
  };
  if (prior !== null) return alreadySaved(prior);
  if (before.identity === null) return unavailable('read_malformed');
  const decision = deps.proposals.authorise({ proposal_id: p.proposal_id, scenario_id: ctx.scenario_id,
    authenticated_user_id: ctx.authenticated_user_id, current_graph_identity_hash: before.identity, typed_approval_of: p.proposal_id });
  if (decision.status === 'already_applied') return alreadySaved(decision.receipts[0] ?? null);
  if (decision.status !== 'execute') return refused(decision.status);
  const plan = planOf(ctx.scenario_id, p.proposal_id, ops, before.graph);
  if ('refusal' in plan) return refused(plan.refusal, undefined, { op: plan.op });
  const input: CommitOptionLevelsInput = { scenario_id: ctx.scenario_id, base_graph_hash: before.graphHash, turn_id: turnId,
    links: plan.links, levels: plan.levels, ...(plan.values!.length > 0 ? { values: plan.values } : {}), ...(plan.frames!.length > 0 ? { frames: plan.frames } : {}) };

  const commit = async (): Promise<ToolOutcome> => {
    let res: CommitOptionLevelsResult;
    try {
      res = await runWithApprovedBindings(plan.bindings, () => deps.commitOptionLevels!(input));
    } catch (err) {
      return err instanceof GraphStaleWriteError ? refused('superseded') : unavailable('not_confirmed', 'unknown');
    }
    if (res.status === 'stale') return refused('superseded');
    if (res.status === 'unconfirmed') return unavailable('not_confirmed', 'unknown');
    if (res.status === 'refused') {
      return refused(codeOf(res.reason), undefined, { ...(res.value ?? res.frame ?? res.pair ?? {}) });
    }
    if (res.already_applied) {
      deps.proposals.markApplied(p.proposal_id, []);
      return ok({ unchanged: true });
    }
    const after = await readSaved(deps, ctx.scenario_id);
    const back = isSavedRead(after) ? readbackOf(after, ops) : null;
    if (res.receipt === null || res.receipt.source_turn_id !== turnId || back === null || !back.holds || !isSavedRead(after)) {
      return unavailable('not_verified', 'unknown');
    }
    const receipt: ReceiptSummary = { ...res.receipt, source_turn_id: turnId };
    deps.proposals.markApplied(p.proposal_id, [receipt]);
    return ok({ saved: true, receipt, revision: { graph_hash: after.graphHash, graph_identity_hash: after.identity }, written: back.written },
      { mutated: true });
  };
  const reconcile = async (): Promise<ToolOutcome> => {
    const own = await ownReceipt(deps.dispatch, ctx.scenario_id, turnId);
    return own !== null && own !== 'unreadable' ? alreadySaved(own) : unavailable('not_confirmed', 'unknown');
  };
  return deps.proposals.executeApproved(p, ctx.turn_id ?? turnId, commit,
    (o) => (o.status === 'ok' ? 'applied' : o.status === 'unavailable' && o.write === 'unknown' ? 'unknown' : 'none'), reconcile);
}
