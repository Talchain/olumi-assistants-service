/**
 * THE CORE AGENT'S TOOLS ON A PROGRAM SCENARIO (alpha). The agent keeps its native SDK chat and its tool names; on a scenario
 * whose saved model is a program, each tool works on the canonical model:
 *  · read_canonical_context: the program as the agent reads it (quantities with their status and who gave them, the
 *    questions still open, the stored Run's words);
 *  · propose_change: an ANSWER to a listed question is set on the item it answers, exactly (`answered`, the same builder as
 *    the canvas edit; no AI call); a structural change, in words with the ids to remove, has Olumi's drafter write the
 *    WHOLE updated model (`proposePostimage`). The one validator checks either exactly (`validatePostimage`), and it is compiled
 *    and evaluated now, so the card the person approves holds the exact model, EVERY change on it, and the Run it would
 *    store; nothing is saved;
 *  · apply_change: on the person's approval of THAT proposal, its model and Run are written as ONE core write on the
 *    proposal's base (CAS); a model that moved since is `superseded`; this operation's own earlier save is never repeated;
 *  · run_analysis: shows the stored Run when it is current; otherwise evaluates a NEW Run and stores it.
 * The canvas's figure edits (`applyCanvasFigure`) are the person's own hand: one figure, built exactly from its target and
 * value (no AI call), through the SAME validator, saved with its Run; the typed edit is its own approval, so no card.
 */
import { z } from 'zod-v4';
import type { InternalDispatch } from '../agent-lane/runtime/agent-capabilities.js';
import type { AgentToolContext } from '../agent-lane/runtime/agent-tools.js';
import { createProposal, type ProposalChange, type ProposalOperation, type ProposalStore, type StructuredProposal } from '../agent-lane/proposal.js';
import { findOperationVersion } from '../path-b/tools/core-write.js';
import { isNoModelYet, isSavedRead, readSaved } from '../path-b/tools/context-tool.js';
import { ok, refused, unavailable, type ToolOutcome } from '../path-b/tools/outcome.js';
import { CanonicalQuantity, type CanonicalModelT, type CanonicalQuantityT } from '../model-program/canonical.js';
import { ledgeredResponsesCall, proposePostimage } from './draft.js';
import { validatePostimage } from './postimage.js';
import { isSaved, postimageOf, programOperationId, savePostimage, withNewRun } from './program-save.js';
import { livingModelOf, MODEL_PROGRAM, programReadOf, reopenProgram, savedProgramOf, unreadableWords, type SavedProgram } from './program-store.js';
import { shownRun, type StoredRun } from './run-receipt.js';

type Rec = Record<string, unknown>;
type Ctx = Pick<AgentToolContext, 'scenario_id' | 'authenticated_user_id' | 'turn_id' | 'verified_user_messages' | 'user_turn_text'>;
export interface ProgramToolDeps { readonly dispatch: InternalDispatch; readonly proposals: ProposalStore }

/** Said with the turn's state on a program scenario: how its tools work. The standing instructions stay byte for byte. */
export const PROGRAM_TURN_GUIDANCE = 'This scenario\'s model is a model program: read_canonical_context gives its quantities (with who gave each figure), goals, limits, options, open questions and its stored Run. '
  + 'Only when the person asks to change the model (an answer, a correction, a new item or a removal), call propose_change ONCE: an answer to a listed question goes in answers, on that item\'s id; '
  + 'any other change goes in request, with their exact words for every figure of theirs, and in remove the ids (from read_canonical_context) of anything they asked to remove. Answers in the order of your questions answer them in that order, and "I don\'t know" is an answer: put each on the item of the question it answers, and never ask one again in the same words. '
  + 'Olumi\'s drafter writes a change in request, and the card shows every change. Explanations and questions need no proposal. '
  + 'A turn shows one card; the person approves it, and apply_change then saves the model with a new Run.';

/**
 * AN ANSWER to a listed question (DL 24 Oct): the figure it answers, declared by the AI with the canonical model's own fields,
 * and its status, from which the host sets whose it is: known, their figure in their exact words; estimated, Olumi's
 * estimate with its range; unknown, their "I don't know", quoted, the basis saying what would size it (never asked again).
 */
const Answer = CanonicalQuantity.pick({ id: true, value: true, low: true, high: true, range_kind: true, party: true, quote: true, basis: true })
  .extend({ status: z.enum(['known', 'estimated', 'unknown']) }).strict();
type AnswerT = z.infer<typeof Answer>;
export const ProgramChangeParams = z.object({
  public_label: z.string().describe('What the person is asked to approve, in plain words.'),
  basis: z.string().describe('Why Olumi proposes it.'),
  request: z.string().describe('The change the person asked for, in plain words, with their exact words for every figure of theirs.'),
  remove: z.array(z.string()).describe('The ids of the items the person asked to remove, from read_canonical_context; [] for none.'),
  answers: z.array(Answer).max(12).default([]).describe('Their answers to the listed questions, each on the figure it answers (its id from read_canonical_context); [] for none. Answers and a structural change go on separate cards.'),
}).strict();
export type ProgramChangeArgs = z.input<typeof ProgramChangeParams>;

/**
 * What the agent may report of a Run: each option's own sentence, and the Run's `goal_chance` block UNCHANGED (its notes,
 * thresholds, each limit, the unchecked limits, and with several goals each goal's own chance and the joint).
 */
function runWords(run: StoredRun | null): Rec | null {
  if (run === null) return null;
  const v = run.result.canonical_analysis_view as { options?: { option_id: string; cell: { kind: string; face?: string; why?: string } }[]; goal_chance?: unknown } | null;
  return { run_id: run.run_id, options: (v?.options ?? []).map((o) => ({ option_id: o.option_id, shown: o.cell.kind === 'figure', words: o.cell.face ?? o.cell.why ?? null })),
    ...(v?.goal_chance !== undefined ? { goal_chance: v.goal_chance } : {}) };
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

/** A record with the keys that are not given (null) left out, all the way down; nothing else changes. */
const compactRecords = (v: unknown): unknown => (Array.isArray(v) ? v.map(compactRecords)
  : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, compactRecords(x)])) : v);

export async function readProgramContext(deps: ProgramToolDeps, ctx: Ctx): Promise<ToolOutcome> {
  const base = await savedProgram(deps, ctx);
  if ('status' in base) return base;
  const shown = shownRun(base.program.runs, base.program.canonical, base.program.person_words);
  const compile = (shown?.run.result.compile ?? {}) as Rec;
  const { history, ...authored } = base.program.canonical;
  return ok({
    model_program: MODEL_PROGRAM, revision: { graph_hash: base.saved.graphHash, graph_identity_hash: base.saved.identity },
    // The model AS AUTHORED, every record whole (its author, words, basis, ranges, timing, windows, relations, risks and the
    // qualitative records), compact only by leaving out what is not given (null). Never a summary of it.
    model: compactRecords(authored), earlier_versions: history.length,
    // What the stored Run waits on, typed (A4): the AI asks in its own words. A Run stored before blockers keeps its own lists.
    ...(Array.isArray(compile['blockers']) ? { blockers: compile['blockers'] }
      : { open_questions: Array.isArray(compile['asks']) ? compile['asks'] : [], coaching: Array.isArray(compile['coaching']) ? compile['coaching'] : [] }),
    run: shown === undefined ? null : { ...runWords(shown.run), current: shown.current, engine_current: shown.engine_current },
  });
}

/**
 * The program card each turn has already prepared. A turn shows ONE card: with two unapproved proposals the route offers none
 * (approval-chips.ts: approving one would make the other stale), so the person could save nothing (batch 2 mrr-r3).
 */
const preparedThisTurn = new Map<string, string>();

const PREPARING = '';

export async function proposeProgramChange(deps: ProgramToolDeps, ctx: Ctx, args: ProgramChangeArgs): Promise<ToolOutcome> {
  if (args.request.trim() === '' && args.remove.length === 0 && (args.answers ?? []).length === 0) return refused('no_change');
  const turnKey = ctx.turn_id === undefined ? undefined : `${ctx.scenario_id}:${ctx.turn_id}`;
  if (turnKey === undefined) return prepare(deps, ctx, args);
  // Claimed before the first await: the SDK runs a turn's tool calls together, so two proposals race.
  const earlier = preparedThisTurn.get(turnKey);
  if (earlier === PREPARING || (earlier !== undefined && deps.proposals.get(earlier) !== undefined && !deps.proposals.isApplied(earlier))) {
    return refused('one_card_per_turn', 'This turn already prepared a card. Ask the person to approve it; propose these edits after that, all in one propose_change.');
  }
  preparedThisTurn.set(turnKey, PREPARING);
  if (preparedThisTurn.size > 1000) preparedThisTurn.delete(preparedThisTurn.keys().next().value!);
  const outcome = await prepare(deps, ctx, args).catch((err: unknown) => { preparedThisTurn.delete(turnKey); throw err; });
  const id = outcome.status === 'ok' ? (outcome.data as { proposal_id?: unknown } | undefined)?.proposal_id : undefined;
  if (typeof id === 'string') preparedThisTurn.set(turnKey, id); else preparedThisTurn.delete(turnKey);
  return outcome;
}

async function prepare(deps: ProgramToolDeps, ctx: Ctx, args: ProgramChangeArgs): Promise<ToolOutcome> {
  const base = await savedProgram(deps, ctx);
  if ('status' in base) return base;
  const program = base.program;
  // A quote is the person's own words, from this conversation or what they gave before; never Olumi's paraphrase.
  const turnWords = [...(ctx.verified_user_messages ?? []), ...(ctx.user_turn_text ? [ctx.user_turn_text] : [])].filter((w) => !program.person_words.includes(w));
  const fresh = [...new Set(turnWords)];
  const words = [...program.person_words, ...fresh];
  // What the AI declares: answers, set on their items exactly (no redraft); else a structural change, which Olumi's drafter writes.
  const answers = args.answers ?? [];
  if (answers.length > 0 && (args.request.trim() !== '' || args.remove.length > 0)) {
    return refused('one_kind_per_card', 'Answers and a structural change go on separate cards: propose the answers now and the change after.');
  }
  const draft = answers.length > 0 ? answered(program.canonical, answers) : await proposePostimage(program.canonical, words, args.request, args.remove, ledgeredResponsesCall());
  if (typeof draft === 'string') return refused('not_an_answer', draft);
  if (draft.model === null) return refused('no_model_back', 'Olumi could not write the updated model just now; nothing changed.');
  const v = validatePostimage(program.canonical, draft.model, { removals: args.remove, words, fresh, approver: ctx.authenticated_user_id });
  if (!v.ok) return refused(v.code, v.reason, { ids: v.ids });
  // The person's words this turn are kept with the model: what it was changed from, in their words.
  const next = withNewRun({ ...program, canonical: v.model, person_words: words });
  if (next.evaluation.compiled.errors.length > 0) return refused('does_not_compile', next.evaluation.compiled.errors.slice(0, 3).map((e) => e.message).join(' '));
  const p = holdProgramCard(deps.proposals, { scenarioId: ctx.scenario_id, userId: ctx.authenticated_user_id, graphHash: base.saved.graphHash, identity: base.saved.identity! },
    { label: args.public_label, basis: args.basis, program: next.program, changes: v.changes });
  return ok({ proposal_id: p.proposal_id, public_label: p.public_label, base_revision: base.saved.graphHash, changes: v.changes, would_show: runWords(next.run) });
}

/**
 * THE S2 BUILDER (no AI call): one figure set on its item, every other record as saved. A goal's target it shares with
 * another goal or a limit is split off first (`splitFor`, that goal's id), so the other keeps its figure.
 */
export function figurePostimage(canonical: CanonicalModelT, filled: CanonicalQuantityT, splitFor?: string): CanonicalModelT {
  return splitFor === undefined ? { ...canonical, quantities: canonical.quantities.map((x) => (x.id === filled.id ? filled : x)) }
    : { ...canonical, quantities: [...canonical.quantities, filled], goals: canonical.goals.map((g) => (g.id === splitFor ? { ...g, measure: { ...g.measure!, target: filled.id } } : g)) };
}
/**
 * Answers on their items through the S2 builder: only an existing item (an answer never creates one; PB 24 Oct, 13 misbinds),
 * its status as declared and whose it is from that (an "I don't know" is always theirs), the question cleared.
 */
function answered(canonical: CanonicalModelT, answers: readonly AnswerT[]): { readonly model: CanonicalModelT } | string {
  let model = canonical;
  for (const a of answers) {
    const q = model.quantities.find((x) => x.id === a.id);
    if (q === undefined) return `${a.id} is not a figure in this model; a new item is a structural change.`;
    if (q.status === 'derived') return `"${q.label}" is worked out by its relation; answer one of its inputs.`;
    const theirs = a.status !== 'estimated', none = a.status === 'unknown';
    model = figurePostimage(model, { ...q, status: a.status, author: theirs ? 'person' : 'olumi', value: none ? null : a.value, low: none ? null : a.low,
      high: none ? null : a.high, range_kind: none ? null : a.range_kind, party: theirs ? a.party : null, quote: theirs ? a.quote : null, basis: a.basis, question: null });
  }
  return { model };
}

/** A program card, held for the person's approval on its base revision: the complete program (model and Run) it would write, and every change. */
export function holdProgramCard(proposals: ProposalStore, at: { readonly scenarioId: string; readonly userId: string | null; readonly graphHash: string; readonly identity: string },
  card: { readonly label: string; readonly basis: string; readonly program: SavedProgram; readonly changes: readonly ProposalChange[]; readonly reading?: true }): StructuredProposal {
  return proposals.put(createProposal({ scenario_id: at.scenarioId, user_id: at.userId, base_graph_identity_hash: at.graphHash, base_model_identity: at.identity,
    operations: card.changes.map((c): ProposalOperation => ({ op: 'living_change', path: `${c.kind}:${c.id}`, value: { change: c.action } })),
    provenance: { authored_by: 'model_proposed', basis: card.basis }, validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: card.label, living_model: livingModelOf(card.program), changes: card.changes, ...(card.reading === true ? { reading: true as const } : {}) }));
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
  readonly low?: number | null; readonly high?: number | null; readonly operation_key: string }): Promise<{ readonly status: 'saved' | 'refused' | 'unknown'; readonly reason?: string; readonly receipt?: unknown;
  readonly changes?: readonly ProposalChange[] }> {
  const saved = await readSaved(deps, scenarioId);
  if (!isSavedRead(saved)) return { status: 'refused', reason: 'Your model could not be read just now.' };
  const read = programReadOf(saved.graph);
  if (read.kind !== 'program') return { status: 'refused', reason: read.kind === 'unreadable' ? unreadableWords(read.reason) : 'This scenario is not a model program.' };
  const program: SavedProgram = read.program;
  const goal = 'goal_id' in edit.target ? program.canonical.goals.find((g) => g.id === (edit.target as { goal_id: string }).goal_id) : undefined;
  const qid = 'quantity_id' in edit.target ? edit.target.quantity_id : goal?.measure?.target;
  const q = program.canonical.quantities.find((x) => x.id === qid);
  if (q === undefined) return { status: 'refused', reason: 'goal_id' in edit.target ? 'That goal has no target to set yet; say it in the chat.' : 'That is not a figure in this model.' };
  // A figure typed on the person's OWN range (DL 23 Oct): inside it, it is their new most likely figure (the draw's centre)
  // and the range and its reading stay; outside it, nothing is saved, and the refusal says the range must change with it.
  const onRange = edit.low == null && edit.high == null && edit.value !== null && q.author === 'person' && q.low !== null && q.high !== null && q.low < q.high;
  if (onRange) {
    const n = (x: number) => x.toLocaleString('en-GB');
    const where = edit.value! < q.low! || edit.value! > q.high! ? 'outside' : edit.value === q.low || edit.value === q.high ? 'at the end of, not inside,' : null;
    if (where !== null) return { status: 'refused', reason: `${n(edit.value!)} is ${where} your range of ${n(q.low!)}–${n(q.high!)}, so nothing was saved: change the range with it.` };
  }
  const shownAs = onRange ? `${edit.value} ${q.unit}, within ${q.low} to ${q.high}`
    : edit.low != null && edit.high != null ? `${edit.low} to ${edit.high} ${q.unit}` : `${edit.value} ${q.unit}`;
  // What the person typed is their words for this figure, so the compiler finds them as theirs.
  const words = `${goal !== undefined ? `${goal.label} target` : q.label}: ${shownAs}`;
  // The exact postimage: this ONE figure as theirs, in the words they typed (a goal's target shared with another goal or a
  // limit first gets its own quantity, so the other keeps its figure). No AI call; the same validator as every change.
  if (q.status === 'derived') return { status: 'refused', reason: `"${q.label}" is worked out by its relation; change one of its inputs.` };
  const [low, high] = onRange ? [q.low, q.high] : [edit.low ?? null, edit.high ?? null];
  if (edit.value === null && (low === null || high === null)) return { status: 'refused', reason: 'A figure needs a value, or both ends of a range.' };
  if (low !== null && high !== null && low > high) return { status: 'refused', reason: `The low end ${low} is above the high end ${high}.` };
  const shared = goal !== undefined && (program.canonical.goals.some((x) => x.id !== goal.id && x.measure?.target === q.id) || program.canonical.limits.some((l) => l.measure?.bound === q.id));
  const id = shared ? `${goal!.id}_target` : q.id;
  const filled: CanonicalQuantityT = { ...q, id, value: edit.value, low, high, range_kind: onRange ? q.range_kind : null, status: 'known', author: 'person', party: null,
    quote: words, question: null, basis: null, approval: 'approved' };
  const canonical = figurePostimage(program.canonical, filled, shared ? goal!.id : undefined);
  const v = validatePostimage(program.canonical, canonical, { removals: [], words: [...program.person_words, words], fresh: [words] });
  if (!v.ok) return { status: 'refused', reason: v.reason };
  const next = withNewRun({ ...program, canonical: v.model, person_words: [...program.person_words, words] });
  if (next.evaluation.compiled.errors.length > 0) return { status: 'refused', reason: `That figure does not fit the model: ${next.evaluation.compiled.errors[0]!.message}` };
  const { write } = await savePostimage(deps.dispatch, { scenarioId, operationId: programOperationId(scenarioId, `card:${edit.operation_key}`), expectedIdentity: saved.identity },
    next.graph);
  return isSaved(write) ? { status: 'saved', receipt: 'receipt' in write ? write.receipt : undefined, changes: v.changes }
    : { status: write.status === 'unknown' ? 'unknown' : 'refused', reason: write.status === 'stale' ? 'Your model changed meanwhile; reload to see it.' : 'That change could not be saved.' };
}
