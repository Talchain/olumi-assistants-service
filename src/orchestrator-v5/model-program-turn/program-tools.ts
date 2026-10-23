/**
 * THE CORE AGENT'S TOOLS ON A PROGRAM SCENARIO (alpha). The agent keeps its native SDK chat and its tool names; on a scenario
 * whose saved model is a program, each tool works on the canonical model:
 *  · read_canonical_context: the program as the agent reads it (quantities with their status and who gave them, the
 *    questions still open, the stored Run's words);
 *  · propose_change: canonical operations (`edits.ts`). The proposed model is compiled and evaluated now, so the card the
 *    person approves holds the exact model AND the Run it would store; nothing is saved;
 *  · apply_change: on the person's approval of THAT proposal, its model and Run are written as ONE core write on the
 *    proposal's base (CAS); a model that moved since is `superseded`; this operation's own earlier save is never repeated;
 *  · run_analysis: shows the stored Run when it is current; otherwise evaluates a NEW Run and stores it.
 * The canvas's figure edits (`applyCanvasFigure`) are the person's own hand: one figure, saved with its Run, no card.
 */
import { z } from 'zod-v4';
import type { InternalDispatch } from '../agent-lane/runtime/agent-capabilities.js';
import type { AgentToolContext } from '../agent-lane/runtime/agent-tools.js';
import { createProposal, type ProposalOperation, type ProposalStore, type StructuredProposal } from '../agent-lane/proposal.js';
import { findOperationVersion } from '../path-b/tools/core-write.js';
import { isNoModelYet, isSavedRead, readSaved } from '../path-b/tools/context-tool.js';
import { ok, refused, unavailable, type ToolOutcome } from '../path-b/tools/outcome.js';
import { normalise } from '../model-program/compile.js';
import { applyOps, ProgramOp, quotedIn, type ProgramOpT } from './edits.js';
import { isSaved, postimageOf, programOperationId, savePostimage, withNewRun } from './program-save.js';
import { livingModelOf, MODEL_PROGRAM, programReadOf, reopenProgram, savedProgramOf, unreadableWords, type SavedProgram } from './program-store.js';
import { shownRun, type StoredRun } from './run-receipt.js';

type Rec = Record<string, unknown>;
type Ctx = Pick<AgentToolContext, 'scenario_id' | 'authenticated_user_id' | 'turn_id' | 'verified_user_messages' | 'user_turn_text'>;
export interface ProgramToolDeps { readonly dispatch: InternalDispatch; readonly proposals: ProposalStore }

/** Said with the turn's state on a program scenario: how its tools work. The standing instructions stay byte for byte. */
export const PROGRAM_TURN_GUIDANCE = 'This scenario\'s model is a model program: read_canonical_context gives its quantities (with who gave each figure), goals, limits, options, open questions and its stored Run. '
  + 'To change it, call propose_change with ops: set_quantity (one input quantity\'s figure or range: an answer to an open question, or a corrected figure), set_goal_target, add_option or rename_option, each quoting the person\'s exact words, using the ids read_canonical_context gives. '
  + 'The person approves the card; apply_change then saves the model with a new Run. Report a chance only in the Run\'s own words (run.options[].words), never a figure of your own.';

export const ProgramChangeParams = z.object({
  public_label: z.string().describe('What the person is asked to approve, in plain words.'),
  basis: z.string().describe('Why Olumi proposes it.'),
  ops: z.array(ProgramOp).describe('The edits, in order: each one figure, target or option. Use the ids read_canonical_context gives.'),
}).strict();
export type ProgramChangeArgs = z.infer<typeof ProgramChangeParams>;

/** The words a Run's chances are said in, per option, and beside them (notes, tipping thresholds, each limit): what the agent may report. */
function runWords(run: StoredRun | null): Rec | null {
  if (run === null) return null;
  const v = run.result.canonical_analysis_view as { options?: { option_id: string; cell: { kind: string; face?: string; why?: string } }[];
    goal_chance?: { notes?: string[]; thresholds?: { words: string }[]; limits?: { constraint_id: string; words: string; options: { option_id: string; display: string }[] }[];
      unchecked_limits?: { limit_id: string; words: string }[] } } | null;
  const g = v?.goal_chance;
  return { run_id: run.run_id, options: (v?.options ?? []).map((o) => ({ option_id: o.option_id, shown: o.cell.kind === 'figure', words: o.cell.face ?? o.cell.why ?? null })),
    notes: g?.notes ?? [], thresholds: (g?.thresholds ?? []).map((t) => t.words), limits: g?.limits ?? [], unchecked_limits: g?.unchecked_limits ?? [] };
}

/** The saved program and the read it came from, or the outcome that says why there is none. */
async function savedProgram(deps: ProgramToolDeps, ctx: Ctx) {
  const saved = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(saved)) return isNoModelYet(saved) ? refused('no_model_yet') : saved;
  if (saved.identity === null) return unavailable('read_malformed');
  const read = programReadOf(saved.graph);
  return read.kind === 'program' ? { saved, program: read.program }
    : read.kind === 'unreadable' ? refused('model_program_unreadable', unreadableWords(read.reason)) : refused('not_a_program_scenario');
}

export async function readProgramContext(deps: ProgramToolDeps, ctx: Ctx): Promise<ToolOutcome> {
  const base = await savedProgram(deps, ctx);
  if ('status' in base) return base;
  const m = normalise(base.program.canonical);
  const shown = shownRun(base.program.runs, base.program.canonical, base.program.person_words);
  const compile = (shown?.run.result.compile ?? {}) as Rec;
  return ok({
    model_program: MODEL_PROGRAM, revision: { graph_hash: base.saved.graphHash, graph_identity_hash: base.saved.identity },
    question: m.question, period: m.period,
    quantities: m.quantities.map((q) => ({ id: q.id, label: q.label, unit: q.unit, kind: q.kind, status: q.status, value: q.value, low: q.low, high: q.high,
      author: q.author, ...(q.question ? { question: q.question } : {}), ...(q.quote ? { quote: q.quote } : {}) })),
    goals: m.goals.map((g) => ({ id: g.id, label: g.label, ...(g.measure ? { quantity: g.measure.quantity, cmp: g.measure.cmp, target: g.measure.target } : { measure: null, question: g.question }) })),
    limits: m.limits.map((l) => ({ id: l.id, label: l.label, ...(l.measure ? { quantity: l.measure.quantity, cmp: l.measure.cmp, bound: l.measure.bound } : { measure: null }) })),
    options: m.options.map((o) => ({ id: o.id, label: o.label, status: o.status, sets: o.sets.map((s) => ({ quantity: s.quantity, to: s.to })) })),
    open_questions: Array.isArray(compile['asks']) ? compile['asks'] : [],
    left_out: m.left_out.map((x) => ({ id: x.id, text: x.text, question: x.question })),
    run: shown === undefined ? null : { ...runWords(shown.run), current: shown.current, engine_current: shown.engine_current },
  });
}

/** The card's rows: one per edit, on the record it changes. */
const operationsOf = (ops: readonly ProgramOpT[]): ProposalOperation[] => ops.map((o): ProposalOperation => ({ op: 'living_change',
  path: o.op === 'set_quantity' ? `quantity:${o.quantity_id}` : o.op === 'set_goal_target' ? `goal:${o.goal_id}` : o.op === 'add_option' ? `option:${o.label}` : `option:${o.option_id}`,
  value: { change: o.op === 'add_option' ? 'add' : 'change', after: o } }));

export async function proposeProgramChange(deps: ProgramToolDeps, ctx: Ctx, args: ProgramChangeArgs): Promise<ToolOutcome> {
  if (args.ops.length === 0) return refused('no_change');
  const base = await savedProgram(deps, ctx);
  if ('status' in base) return base;
  // A quote is the person's own words, from this conversation or what they gave before; never Olumi's paraphrase.
  const theirs = [...base.program.person_words, ...(ctx.verified_user_messages ?? []), ...(ctx.user_turn_text ? [ctx.user_turn_text] : [])];
  const unquoted = args.ops.filter((o) => !quotedIn(o.quote, theirs));
  if (unquoted.length > 0) return refused('quote_not_in_their_words', 'Each edit quotes the person\'s exact words; copy them from what they wrote.', { ops: unquoted.map((o) => o.op) });
  const edited = applyOps(base.program.canonical, args.ops);
  if (!edited.ok) return refused('edit_not_applicable', edited.reason);
  const words = [...base.program.person_words, ...args.ops.map((o) => o.quote).filter((q) => !base.program.person_words.some((w) => quotedIn(q, [w])))];
  const next = withNewRun({ ...base.program, canonical: edited.model, person_words: [...new Set(words)] });
  if (next.evaluation.compiled.errors.length > 0) return refused('does_not_compile', next.evaluation.compiled.errors.slice(0, 3).map((e) => e.message).join(' '));
  const p = deps.proposals.put(createProposal({ scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id,
    base_graph_identity_hash: base.saved.graphHash, base_model_identity: base.saved.identity!, operations: operationsOf(args.ops),
    provenance: { authored_by: 'model_proposed', basis: args.basis }, validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: args.public_label, living_model: livingModelOf(next.program) }));
  return ok({ proposal_id: p.proposal_id, public_label: p.public_label, base_revision: base.saved.graphHash, ops: args.ops, would_show: runWords(next.run) });
}

/** A proposal this module prepared: it carries the complete program (model and Run) it would write. */
export const isProgramProposal = (p: StructuredProposal | undefined): p is StructuredProposal & { readonly living_model: Rec } =>
  p !== undefined && savedProgramOf({ living_model: p.living_model }) !== undefined;

export async function applyProgramChange(deps: ProgramToolDeps, ctx: Ctx, proposalId: string): Promise<ToolOutcome> {
  const p = deps.proposals.get(proposalId);
  if (!isProgramProposal(p)) return refused(p === undefined ? 'unknown_proposal' : 'not_a_change_proposal');
  if (p.scenario_id !== ctx.scenario_id || p.user_id !== ctx.authenticated_user_id) return refused('not_authorised');
  const program = savedProgramOf({ living_model: p.living_model })!;
  const operationId = programOperationId(ctx.scenario_id, `proposal:${p.proposal_id}`);
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
  if (p.base_model_identity !== before.identity) return refused('superseded');
  // The approved program, exactly: its model (the display graph is that model's projection) and the Run the card showed.
  const graph = postimageOf(program);
  const commit = async (): Promise<ToolOutcome> => {
    const { write } = await savePostimage(deps.dispatch, { scenarioId: ctx.scenario_id, operationId, expectedIdentity: before.identity, ownVersion }, graph);
    if (write.status === 'unknown') return write.outcome;
    if (write.status === 'stale') return refused('superseded');
    if (write.status === 'refused') return refused('registration_refused');
    if (write.status === 'already_saved') return alreadySaved(write.receipt);
    deps.proposals.markApplied(p.proposal_id, [write.receipt as never]);
    return ok({ saved: true, receipt: write.receipt, revision: { graph_hash: write.after.graphHash, graph_identity_hash: write.after.identity },
      run: runWords(program.runs.at(-1) ?? null) }, { mutated: true, ran: true });
  };
  const reconcile = async (): Promise<ToolOutcome> => {
    const own = await ownVersion().catch(() => null);
    return own !== null ? alreadySaved(own) : unavailable('not_confirmed', 'unknown');
  };
  return deps.proposals.executeApproved(p, ctx.turn_id ?? operationId, commit,
    (o) => (o.status === 'ok' ? 'applied' : o.status === 'unavailable' && o.write === 'unknown' ? 'unknown' : 'none'), reconcile);
}

/** A Run on request: the stored Run when it is current for this model and engine; otherwise a NEW Run, stored. */
export async function runProgram(deps: ProgramToolDeps, ctx: Ctx): Promise<ToolOutcome> {
  const base = await savedProgram(deps, ctx);
  if ('status' in base) return base;
  const shown = reopenProgram(base.saved.graph);
  if (shown?.run && shown.current && shown.engine_current) return ok({ run: runWords(shown.run), stored: true }, { ran: false });
  const next = withNewRun(base.program);
  const operationId = programOperationId(ctx.scenario_id, `run:${next.run.receipt.revision_digest}:${base.program.runs.length}`);
  const { write } = await savePostimage(deps.dispatch, { scenarioId: ctx.scenario_id, operationId, expectedIdentity: base.saved.identity }, next.graph);
  if (!isSaved(write)) return write.status === 'unknown' ? write.outcome : refused(write.status === 'stale' ? 'superseded' : 'registration_refused');
  return ok({ run: runWords(next.run), stored: false }, { mutated: true, ran: true });
}

/**
 * The canvas's own figure edits on a program scenario: the person's own hand on ONE figure, by the id it is drawn under
 * (a card's id is its quantity id; a link carries its coefficient's id; a goal's target edit names the goal). Saved at
 * once with a new Run, as the core canvas edit saves; the words the person typed are kept as theirs.
 */
export type CanvasFigure = { readonly quantity_id: string } | { readonly goal_id: string };
export async function applyCanvasFigure(deps: Pick<ProgramToolDeps, 'dispatch'>, scenarioId: string, edit: { readonly target: CanvasFigure; readonly value: number | null;
  readonly low?: number | null; readonly high?: number | null; readonly operation_key: string }): Promise<{ readonly status: 'saved' | 'refused' | 'unknown'; readonly reason?: string; readonly receipt?: unknown }> {
  const saved = await readSaved(deps, scenarioId);
  if (!isSavedRead(saved)) return { status: 'refused', reason: 'Your model could not be read just now.' };
  const read = programReadOf(saved.graph);
  if (read.kind !== 'program') return { status: 'refused', reason: read.kind === 'unreadable' ? unreadableWords(read.reason) : 'This scenario is not a model program.' };
  const program: SavedProgram = read.program;
  const goal = 'goal_id' in edit.target ? program.canonical.goals.find((g) => g.id === (edit.target as { goal_id: string }).goal_id) : undefined;
  const qid = 'quantity_id' in edit.target ? edit.target.quantity_id : goal?.measure?.target;
  const q = program.canonical.quantities.find((x) => x.id === qid);
  if (q === undefined) return { status: 'refused', reason: 'goal_id' in edit.target ? 'That goal has no target to set yet; say it in the chat.' : 'That is not a figure in this model.' };
  const shownAs = edit.low != null && edit.high != null ? `${edit.low} to ${edit.high} ${q.unit}` : `${edit.value} ${q.unit}`;
  // What the person typed is their words for this figure, so the compiler finds them as theirs.
  const words = `${goal !== undefined ? `${goal.label} target` : q.label}: ${shownAs}`;
  const figure = { value: edit.value, low: edit.low ?? null, high: edit.high ?? null, range_kind: null, quote: words };
  const edited = applyOps(program.canonical, [goal !== undefined ? { op: 'set_goal_target', goal_id: goal.id, ...figure } : { op: 'set_quantity', quantity_id: q.id, ...figure }]);
  if (!edited.ok) return { status: 'refused', reason: edited.reason };
  const next = withNewRun({ ...program, canonical: edited.model, person_words: [...program.person_words, words] });
  if (next.evaluation.compiled.errors.length > 0) return { status: 'refused', reason: `That figure does not fit the model: ${next.evaluation.compiled.errors[0]!.message}` };
  const { write } = await savePostimage(deps.dispatch, { scenarioId, operationId: programOperationId(scenarioId, `card:${edit.operation_key}`), expectedIdentity: saved.identity },
    next.graph);
  return isSaved(write) ? { status: 'saved', receipt: 'receipt' in write ? write.receipt : undefined }
    : { status: write.status === 'unknown' ? 'unknown' : 'refused', reason: write.status === 'stale' ? 'Your model changed meanwhile; reload to see it.' : 'That change could not be saved.' };
}
