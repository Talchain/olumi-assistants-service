/**
 * THE CORE AGENT'S TOOLS ON A PROGRAM SCENARIO (alpha). The agent keeps its native SDK chat and its tool names; on a scenario
 * whose saved model is a program, each tool works on the canonical model:
 *  · read_canonical_context: the program as the agent reads it (quantities with their status and who gave them, the
 *    questions still open, the stored Run's words, the cards held for approval);
 *  · propose_change: an ANSWER to a listed question is set on the item it answers, exactly as the AI declared it (`answered`,
 *    the same builder as the canvas edit; no AI call); a structural change or an answer in words, in request with the ids to
 *    remove, has Olumi's drafter return only the records it changes or adds, merged by id onto the saved model
 *    (`proposePostimage`), and the drafter's records pass as it wrote them, the answers set again on them. The one validator checks either exactly (`validatePostimage`), and it is compiled
 *    and evaluated now, so the card the person approves holds the exact model, EVERY change on it, and the Run it would
 *    store; nothing is saved;
 *  · apply_change: on the person's approval of THAT proposal, its model and Run (today's engine's, when the card's is from
 *    before an update) are written as ONE core write on the proposal's base (CAS); a model that moved since is `superseded`;
 *    this operation's own earlier save is never repeated;
 *  · run_analysis: shows the stored Run when it is current; otherwise evaluates a NEW Run and stores it.
 * The canvas's figure edits (`applyCanvasFigure`) are the person's own hand: one figure, built exactly from its target and
 * value (no AI call), through the SAME validator, saved with its Run; the typed edit is its own approval, so no card, and
 * the editing person both said that figure (its author_id) and approved it (its approved_by), on it and its history entry,
 * as on an approved card (C6).
 */
import { z } from 'zod-v4';
import type { InternalDispatch } from '../core-route/internal-dispatch.js';
import type { AgentToolContext } from '../agent-lane/runtime/agent-tools.js';
import { createProposal, type ProposalChange, type ProposalOperation, type ProposalStore, type StructuredProposal } from '../agent-lane/proposal.js';
import { findOperationSave, type RegistrationRowRead } from '../path-b/tools/core-write.js';
import { isNoModelYet, isSavedRead, readSaved } from './saved-read.js';
import { ok, refused, unavailable, type ToolOutcome } from '../path-b/tools/outcome.js';
import { APPROXIMATE_FIGURE, CanonicalQuantity, type CanonicalModelT, type CanonicalQuantityT } from '../model-program/canonical.js';
import { compile } from '../model-program/compile.js';
import { parseUnit, TIME_DIMS } from '../model-program/units.js';
import { ledgeredResponsesCall, proposePostimage } from './draft.js';
import { keepTheirFigures, theirFiguresIn, validatePostimage } from './postimage.js';
import { isSaved, postimageOf, programOperationId, savePostimage, withNewRun } from './program-save.js';
import { livingModelOf, MODEL_PROGRAM, programReadOf, reopenProgram, savedProgramOf, sourceTextOf, unreadableWords, type SavedProgram } from './program-store.js';
import { shownRun, shownView, type StoredRun } from './run-receipt.js';
import { programCardApplies, programDigestOf, runApplyingHeldCard, runsExtend } from './program-card.js';
import { log } from '../../utils/telemetry.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';

type Rec = Record<string, unknown>;
type Ctx = Pick<AgentToolContext, 'scenario_id' | 'authenticated_user_id' | 'turn_id' | 'verified_user_messages' | 'user_turn_text'>;
/** `readTurn`: the store's read of a committed row, so a save that minted no version (a guest's) is found from its own row (C8). */
export interface ProgramToolDeps { readonly dispatch: InternalDispatch; readonly proposals: ProposalStore; readonly readTurn?: RegistrationRowRead }

/** The tools a reply the AI writes after the host's own work (a first draft, a Run press) may not call: it explains only. */
export const HOST_REPLY_WITHHELD_TOOLS: readonly string[] = ['build_model_from_brief', 'propose_change', 'apply_change', 'run_analysis'];

/** What a program turn the agent replies on began with: the host's first draft, a Run press, or any other turn. */
export type ProgramTurnTrigger = 'first_model' | 'run_press' | 'continuation';
export const PROGRAM_TURN_FACTS_PREFIX = 'THIS TURN: ';
/**
 * THIS TURN'S FACTS (prompts-v2, INTEGRATION §5, 29 Oct): sent after the state block in place of the turn guidance, which said
 * what to do (the program instructions and each tool's description now say it, once). Facts only, never an instruction:
 *  · trigger: first_model, the host has drafted the first model from the brief and saved and run it (T1: the reply is the AI's,
 *    from the state block read after that save); run_press, the person pressed Run, and the state block's Run is the one just
 *    shown to them; continuation, every other turn;
 *  · reading_card: whether a card asks them to confirm or change Olumi's reading of their brief (W8 run 3: a refused reading
 *    holds none). On a first draft the caller says, from the turn's own tool calls; otherwise it is the state block's;
 *  · held_proposals: the cards the state block holds awaiting approval, by id; null when the state could not be read;
 *  · requested_challenge: present only on a Challenge press on one card, whose selection note follows.
 */
export function programTurnFacts(trigger: ProgramTurnTrigger, state: unknown, given: { readonly readingCard?: boolean; readonly challenge?: boolean } = {}): string {
  const held = state !== null && typeof state === 'object' && Array.isArray((state as Rec)['awaiting_approval']) ? (state as Rec)['awaiting_approval'] as Rec[] : null;
  return `${PROGRAM_TURN_FACTS_PREFIX}${JSON.stringify({ trigger,
    reading_card: given.readingCard ?? (held ?? []).some((p) => p['reading'] === true),
    held_proposals: held === null ? null : held.map((p) => p['proposal_id']),
    ...(given.challenge === true ? { requested_challenge: true } : {}) })}`;
}

/**
 * AN ANSWER to a listed question (DL 24 Oct): the figure it answers, declared by the AI with the canonical model's own fields,
 * its status and whose it is, as the AI declares them (the host never assigns them; strip, Paul 26 Oct): known, their
 * figure in their exact words; unknown, their "I don't know", quoted, the basis saying what would size it (never asked again);
 * estimated, Olumi's estimate with its range and basis, never their words. prompts-v2 (29 Oct, `tool-descriptions.txt`): each
 * field's words are an answer's own; its fields and their types are the canonical quantity's, unchanged. The approximate-figure
 * basis is quoted exactly, since the compiler knows it by its exact words (`isApproximate`).
 */
const Q = CanonicalQuantity.shape;
const ENDPOINT = "Both supplied or estimated range endpoints, otherwise null. Do not manufacture endpoints for an approximate point.";
const Answer = CanonicalQuantity.pick({ id: true, value: true, low: true, high: true, range_kind: true, party: true, quote: true, basis: true })
  .extend({
    id: Q.id.describe("The existing quantity id whose listed question is answered."),
    value: Q.value.describe("The supplied point or an Olumi estimate's most likely point inside its range; null if absent or unknown."),
    low: Q.low.describe(ENDPOINT),
    high: Q.high.describe(ENDPOINT),
    range_kind: Q.range_kind.describe("bounds for explicitly firm ends; plausible for explicitly rough ends or an Olumi estimate; null for a point. For unresolved human range meaning, use request with the original endpoints and words rather than guess."),
    party: Q.party.describe("The reported speaker exactly as supplied; null otherwise."),
    quote: Q.quote.describe("An unbroken verbatim span from the person's actual answer; null for Olumi's estimate. Never quote an Olumi request or explanation as theirs."),
    basis: Q.basis.describe(`For a reading such as an unambiguous “all”, say how their words were read. For an approximate point use the canonical approximate-figure basis, exactly: "${APPROXIMATE_FIGURE}". `
      + "For Olumi's estimate give its reference class and context; for unknown say what evidence could size it. Otherwise null. If their inability needs an estimate as well, use request to retain the uncertainty separately and let the drafter propose the estimate."),
    status: z.enum(['known', 'estimated', 'unknown']).describe("known for a supplied figure; estimated for a responsible Olumi estimate; unknown for an explicit inability to give a figure. Unknown is never zero."),
    author: z.enum(['person', 'olumi']).describe("person for their supplied figure or uncertainty; olumi for Olumi's estimate."),
  }).strict();
type AnswerT = z.infer<typeof Answer>;
export const ProgramChangeParams = z.object({
  public_label: z.string().describe("One short, plain description of the change the person would approve."),
  basis: z.string().describe("Why this change follows their request and helps their reasoning."),
  request: z.string().describe("Olumi's instruction for the structural change, naming affected ids and preserving the exact verified human wording for supplied figures. Empty when answers alone express the complete change. This instruction is never itself a human quote."),
  // A simplify's removals (29 Oct, Box 3 European simplify: the agent listed Olumi's pilot option, its prerequisite and the
  // person's figures as removals the person "asked" for, while the update prompt folds Olumi's own unused items). The list is
  // the change's PROPOSED removals, reviewed on its card (the PL's 00:57 contract; prompts-v2's words since 29 Oct); their
  // figures are also refused at the host (postimage.ts theirFiguresIn).
  remove: z.array(z.string()).describe("Existing ids proposed for removal. Keep every person-authored quantity with a figure under its id; correct it or mark it not_applicable only on the person's explicit word. For generic simplification, remove only redundant Olumi scaffolding or non-protected records whose full consequential meaning is re-expressed in fewer records. Preserve supplied figures, useful options, measures, causal routes, supported calculations, conditions, risks, dissent, uncertainty and attribution. A requested size does not authorize loss. [] for none."),
  answers: z.array(Answer).default([]).describe("Exact answers to listed questions on existing quantity ids; [] for none. An ambiguous destination needs clarification. A direct answer cannot change a quantity's unit; it replaces the figure and any date or span it was counted from. A new date or span goes in request."),
}).strict();
export type ProgramChangeArgs = z.input<typeof ProgramChangeParams>;

type ViewDriverEnd = { readonly value?: unknown; readonly display?: unknown };
type ViewOption = { option_id: string; cell: { kind: string; face?: string; why?: string; display?: string; detail?: { precision_95?: readonly number[] } };
  main_driver?: { kind?: string; driver?: { quantity?: unknown; low?: ViewDriverEnd; middle?: ViewDriverEnd; high?: ViewDriverEnd } } };
const pct = (x: number): number => Math.round(x * 1000) / 10;
const driverEnd = (e: ViewDriverEnd | undefined) => (e === undefined ? null : { value: e.value ?? null, chance: e.display ?? null });

/**
 * What the agent may report of a Run (T1, Paul 26 Oct: the AI speaks, from the engine's facts): each option's chance as the
 * Run shows it (`chance`, its simulation `precision_95` in %), or why none is shown; the input its chance is most sensitive
 * to, with the chance at that input's low, middle and high values (`driver`); the option's full sentence (`words`), which
 * says what the chance rests on; the Run's `goal_chance` block UNCHANGED; and which option is most likely to achieve the goal,
 * or why none is named (`leader`, W6). A Run shown as not current (`current` false) is read as the reopen shows it, so it
 * names no leader (W6 review B3).
 */
function runWords(run: StoredRun | null, shown: { readonly current: boolean; readonly updated: boolean } = { current: true, updated: false }): Rec | null {
  if (run === null) return null;
  const v = (shown.current ? run.result.canonical_analysis_view : shownView(run, false, shown.updated)) as { options?: ViewOption[];
    goal_chance?: unknown; leader?: { licence?: unknown; words?: unknown; goal_chance_leader?: unknown } } | null;
  const leader = v?.leader;
  return { run_id: run.run_id, options: (v?.options ?? []).map((o) => {
    const figure = o.cell.kind === 'figure';
    const p = o.cell.detail?.precision_95;
    const d = o.main_driver?.kind === 'available' ? o.main_driver.driver : undefined;
    return { option_id: o.option_id, shown: figure, words: o.cell.face ?? o.cell.why ?? null,
      ...(figure ? { chance: o.cell.display ?? null, ...(p?.length === 2 ? { precision_95: [pct(p[0]!), pct(p[1]!)] } : {}) } : {}),
      ...(d !== undefined ? { driver: { quantity: d.quantity ?? null, low: driverEnd(d.low), middle: driverEnd(d.middle), high: driverEnd(d.high) } } : {}) };
  }),
    ...(v?.goal_chance !== undefined ? { goal_chance: v.goal_chance } : {}),
    ...(typeof leader?.words === 'string' && leader.words.trim() !== ''
      ? { leader: { licence: leader.licence, option_id: leader.goal_chance_leader ?? null, words: leader.words } } : {}) };
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
    run: shown === undefined ? null : { ...runWords(shown.run, { current: shown.current && shown.engine_current, updated: shown.updated }), current: shown.current, engine_current: shown.engine_current },
    // The program cards held for this person's approval that still apply to this saved model, newest first, as each card shows
    // them (C12, alpha spec §3): every continuation reads the held proposal it would apply, by the rule the route offers cards
    // by (`program-card-turn.ts` holdsOn). A reading card says so: confirming it adds nothing the model does not hold.
    awaiting_approval: deps.proposals.outstanding(ctx.scenario_id, ctx.authenticated_user_id).map((o) => deps.proposals.get(o.proposal_id)).filter(isProgramProposal)
      .filter((p) => programCardApplies(p, base.saved.graph) ?? p.base_graph_identity_hash === base.saved.graphHash)
      .map((p) => ({ proposal_id: p.proposal_id, public_label: p.public_label, changes: p.changes ?? [], base_revision: p.base_graph_identity_hash, ...(p.reading === true ? { reading: true } : {}) })),
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
  const words = [...program.person_words, ...new Set(turnWords)];
  // Their words THIS turn: what they typed, and nothing else (Codex r1–r2 #3727). A Challenge or chip turn has none.
  const fresh = ctx.user_turn_text?.trim() ? [ctx.user_turn_text] : [];
  // What the AI declares, exactly as it declares it (strip, Paul 26 Oct: authorship is the AI's alone): answers, set on their
  // items (no redraft), and any change in request, an answer in words included, which Olumi's drafter writes on the model
  // holding those answers: ONE card (DoD 24 Oct: refusing the pair dropped their goals).
  const answers = args.answers ?? [];
  const set = answered(program.canonical, answers);
  if (typeof set === 'string') return refused('not_an_answer', set);
  // The drafter counts a date in the change from the model's own period 0, the first draft's day (words#5), never a second one.
  // A figure they gave is never removed (postimage.ts theirFiguresIn): refused before a drafting call is spent on it.
  const theirs = theirFiguresIn(set.model, args.remove);
  if (theirs.length > 0) return refused('figure_removed', keepTheirFigures(set.model, theirs), { ids: theirs });
  const drafted = args.request.trim() !== '' || args.remove.length > 0 ? await proposePostimage(set.model, words, args.request, args.remove, ledgeredResponsesCall(), program.drafted_on) : set;
  // Why an update took more than one drafting call: each attempt's time and the compiler's error codes (never the person's words).
  if ('attempts' in drafted) log.info({ event: 'model_program.update_draft', scenario_id: ctx.scenario_id, attempts: drafted.attempts.map((a) => ({ ms: a.ms,
    codes: a.errors?.map((e) => e.code) ?? null, ...(a.failed !== undefined ? { failed: a.failed } : {}),
    // A call that threw: its typed fields only (status, type, code, request id), never its message (W9: the cause was lost).
    ...(a.provider_error !== undefined ? { provider_error: a.provider_error } : {}) })) }, 'model-program: update drafted');
  if (drafted.model === null) return refused('no_model_back', 'Olumi could not write the updated model just now; nothing changed.');
  // Mixed turns keep the exact answers after the structural merge (C4, alpha spec §3): a record the drafter returns replaces
  // the one it was given by id, so each answer is set again, with the same builder, on its item where the change kept it (one
  // it left out is the validator's removal check to refuse). No other record is re-stamped (strip, Paul 26 Oct).
  const merged = drafted.model;
  const final = answered(merged, answers.filter((a) => merged.quantities.some((x) => x.id === a.id)));
  if (typeof final === 'string') return refused('not_an_answer', final);
  const v = validatePostimage(program.canonical, final.model, { removals: args.remove, words, fresh, approver: ctx.authenticated_user_id });
  if (!v.ok) return refused(v.code, v.reason, { ids: v.ids, ...(v.check ? { check: v.check } : {}) });
  // The compiler's errors first (the same compile the Run makes), before anything is projected: the display drew a range
  // with one end as a TypeError, which reached the person as a 502 (DoD-I qualitative-r5). Every sentence goes back, as the
  // first draft's repair sends them.
  const errors = compile(v.model, { sourceText: sourceTextOf(words) }).errors;
  if (errors.length > 0) return refused('does_not_compile', errors.map((e) => e.message).join(' '));
  // The person's words this turn are kept with the model: what it was changed from, in their words.
  const next = withNewRun({ ...program, canonical: v.model, person_words: words });
  const p = holdProgramCard(deps.proposals, { scenarioId: ctx.scenario_id, userId: ctx.authenticated_user_id, graphHash: base.saved.graphHash, identity: base.saved.identity!, base: program },
    { label: args.public_label, basis: args.basis, program: next.program, changes: v.changes });
  return ok({ proposal_id: p.proposal_id, public_label: p.public_label, base_revision: base.saved.graphHash, changes: v.changes, would_show: runWords(next.run) });
}

/**
 * THE S2 BUILDER (no AI call): one figure set on its item, every other record as saved. A goal's target it shares with
 * another goal or a limit is split off first (`splitFor`, that goal's id), so the other keeps its figure.
 */
export function figurePostimage(canonical: CanonicalModelT, given: CanonicalQuantityT, splitFor?: string): CanonicalModelT {
  // A figure set here is theirs (an answer or the canvas): the stated time it replaces is cleared, so it is never counted again
  // over their figure (TIME-AND-DECIDE-BY v2).
  const filled = { ...given, stated_time: null };
  return splitFor === undefined ? { ...canonical, quantities: canonical.quantities.map((x) => (x.id === filled.id ? filled : x)) }
    : { ...canonical, quantities: [...canonical.quantities, filled], goals: canonical.goals.map((g) => (g.id === splitFor ? { ...g, measure: { ...g.measure!, target: filled.id } } : g)) };
}
/**
 * Answers on their items through the S2 builder: only an existing figure (an answer never creates one, and one on no figure
 * would be silently dropped; PB 24 Oct, 13 misbinds), its status and whose it is as declared, the question cleared.
 */
function answered(canonical: CanonicalModelT, answers: readonly AnswerT[]): { readonly model: CanonicalModelT } | string {
  let model = canonical;
  for (const a of answers) {
    const q = model.quantities.find((x) => x.id === a.id);
    if (q === undefined) return `${a.id} is not a figure in this model; a new item is a structural change.`;
    const none = a.status === 'unknown';
    model = figurePostimage(model, { ...q, status: a.status, author: a.author, value: none ? null : a.value, low: none ? null : a.low,
      high: none ? null : a.high, range_kind: none ? null : a.range_kind, party: a.party, quote: a.quote, basis: a.basis, question: null });
  }
  return { model };
}

/**
 * A program card, held for the person's approval on its base revision: the complete program (model and Run) it would write, and
 * every change. `base`, the saved program it was made on, records that revision's digest (`program-card.ts`): the card applies
 * while the saved program's is the same. A card held without it keeps the rule it was made under.
 */
export function holdProgramCard(proposals: ProposalStore, at: { readonly scenarioId: string; readonly userId: string | null; readonly graphHash: string; readonly identity: string;
  readonly base?: SavedProgram },
  card: { readonly label: string; readonly basis: string; readonly program: SavedProgram; readonly changes: readonly ProposalChange[]; readonly reading?: true }): StructuredProposal {
  return proposals.put(createProposal({ scenario_id: at.scenarioId, user_id: at.userId, base_graph_identity_hash: at.graphHash, base_model_identity: at.identity,
    operations: card.changes.map((c): ProposalOperation => ({ op: 'living_change', path: `${c.kind}:${c.id}`, value: { change: c.action } })),
    provenance: { authored_by: 'model_proposed', basis: card.basis }, validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: card.label, living_model: livingModelOf(card.program), changes: card.changes, ...(card.reading === true ? { reading: true as const } : {}),
    ...(at.base !== undefined ? { base_revision_digest: programDigestOf(at.base) } : {}) }));
}

/** A proposal this module prepared: it carries the complete program (model and Run) it would write. */
export const isProgramProposal = (p: StructuredProposal | undefined): p is StructuredProposal & { readonly living_model: Rec } =>
  p !== undefined && savedProgramOf({ living_model: p.living_model }) !== undefined;

export const SAVE_REFUSED_AFTER_APPROVAL = 'The person’s approval of this card was received; the save itself was refused by the model store’s check, so nothing '
  + 'was written and the saved model is unchanged. Pressing the card again would be refused the same way.';
/** A save refused because the person stopped this turn (the fence's TURN_STOPPED): the card stays held, so a new press applies it. */
export const SAVE_STOPPED_AFTER_APPROVAL = 'The person’s approval of this card was received, but they stopped this turn before it saved, so '
  + 'nothing was written and the saved model is unchanged. The card is still held and can be pressed again.';
export async function applyProgramChange(deps: ProgramToolDeps, ctx: Ctx, proposalId: string): Promise<ToolOutcome> {
  const p = deps.proposals.get(proposalId);
  if (!isProgramProposal(p)) return refused(p === undefined ? 'unknown_proposal' : 'not_a_change_proposal');
  if (p.scenario_id !== ctx.scenario_id || p.user_id !== ctx.authenticated_user_id) return refused('not_authorised');
  const program = savedProgramOf({ living_model: p.living_model })!;
  const operationId = programOperationId(ctx.scenario_id, `proposal:${p.proposal_id}`);
  const ownVersion = () => findOperationSave(deps.dispatch, deps.readTurn, ctx.scenario_id, operationId);
  const alreadySaved = (receipt: unknown): ToolOutcome => {
    if (receipt !== null && typeof receipt === 'object') deps.proposals.markApplied(p.proposal_id, [receipt as never]);
    return ok({ already_saved: true, receipt }, { mutated: false });
  };
  const prior = await ownVersion().catch(() => null);
  if (prior !== null) return alreadySaved(prior);
  const before = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(before)) return before;
  // A figure they gave is never removed (postimage.ts theirFiguresIn), on this seam too (PL 00:06): a card held before the check
  // (a card outlives a deploy) that drops one is refused at the press, never saved, and its approved payload is never changed.
  const savedNow = savedProgramOf(before.graph)?.canonical;
  const dropped = savedNow === undefined ? [] : theirFiguresIn(savedNow, savedNow.quantities.filter((q) => !program.canonical.quantities.some((x) => x.id === q.id)).map((q) => q.id));
  if (dropped.length > 0) return refused('figure_removed', keepTheirFigures(savedNow!, dropped), { ids: dropped });
  // A card that carries its base revision holds while the saved program's is the same (`program-card.ts`); one held before it
  // was recorded keeps its full-identity rule.
  const holds = programCardApplies(p, before.graph);
  const decision = deps.proposals.authorise({ proposal_id: p.proposal_id, scenario_id: ctx.scenario_id,
    authenticated_user_id: ctx.authenticated_user_id, current_graph_identity_hash: before.graphHash, typed_approval_of: p.proposal_id,
    ...(holds === true ? { scoped_precondition_holds: () => true } : {}) });
  if (decision.status === 'already_applied') return alreadySaved(decision.receipts[0] ?? null);
  if (decision.status !== 'execute') return refused(decision.status);
  if (holds === undefined ? p.base_model_identity !== before.identity : !holds) return refused('superseded');
  // The approved program, exactly: its model (the display graph is that model's projection) and the Run the card showed, while
  // that Run is still this model's on today's engine. A card outlives a deploy (it is held for a day and restored on restart),
  // so the Run it showed may be from before an update, one a reopen says is "from before an update" (seam#3): its model is
  // saved exactly, with the Run today's engine computes for it in that Run's place (as run_analysis would), never the card's.
  // Computed once, before the write, so a retry of this operation sends these bytes or finds its own save; never a second Run.
  // A Run stored since the card was made, on the same revision (a Run press after an engine update), stays: the card's model is
  // saved on the Runs saved now, with the Run today's engine computes for it.
  const now = holds === true ? savedProgramOf(before.graph) : undefined;
  const shown = shownRun(program.runs, program.canonical, program.person_words);
  const { program: saved, graph } = now !== undefined && !runsExtend(program.runs, now.runs, (a, b) => stableStringify(a) === stableStringify(b))
    ? withNewRun({ ...now, canonical: program.canonical, person_words: program.person_words })
    : shown === undefined || (shown.current && shown.engine_current) ? { program, graph: postimageOf(program) }
    : withNewRun({ ...program, runs: program.runs.slice(0, -1) });
  const commit = async (): Promise<ToolOutcome> => {
    // Its own write is never a change to review on its own card (`runApplyingHeldCard`): an interrupted press stays bound on retry.
    const { write } = await runApplyingHeldCard(ctx.scenario_id, p.proposal_id,
      () => savePostimage(deps.dispatch, { scenarioId: ctx.scenario_id, operationId, expectedIdentity: before.identity, ownVersion }, graph));
    if (write.status === 'unknown') return write.outcome;
    if (write.status === 'stale') return refused('superseded');
    // Authorised, then refused: said so, with the store's code (Paul 25 Oct: told only the code, it blamed his "typed yes").
    if (write.status === 'refused') return refused('registration_refused', write.code === 'TURN_STOPPED' ? SAVE_STOPPED_AFTER_APPROVAL : SAVE_REFUSED_AFTER_APPROVAL,
      { code: write.code, written: false });
    if (write.status === 'already_saved') return alreadySaved(write.receipt);
    deps.proposals.markApplied(p.proposal_id, [write.receipt as never]);
    return ok({ saved: true, receipt: write.receipt, revision: { graph_hash: write.after.graphHash, graph_identity_hash: write.after.identity },
      run: runWords(saved.runs.at(-1) ?? null) }, { mutated: true, ran: true });
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
  const { write } = await savePostimage(deps.dispatch, { scenarioId: ctx.scenario_id, operationId, expectedIdentity: base.saved.identity,
    ...(deps.readTurn !== undefined ? { readTurn: deps.readTurn } : {}) }, next.graph);
  if (!isSaved(write)) return write.status === 'unknown' ? write.outcome : refused(write.status === 'stale' ? 'superseded' : 'registration_refused');
  // Its own receipt, as every writer reports one: a turn that fails after this Run still says what it saved (C7).
  return ok({ run: runWords(next.run), stored: false, receipt: 'receipt' in write ? write.receipt : null }, { mutated: true, ran: true });
}

/**
 * The canvas's own figure edits on a program scenario: the person's own hand on ONE figure, by the id it is drawn under
 * (a card's id is its quantity id; a link carries its coefficient's id; a goal's target edit names the goal). Saved at
 * once with a new Run, as the core canvas edit saves; the figure as entered (a number, or "low to high": never the literal
 * keystrokes, which this edit does not receive) is kept as their words, and its history entry records it as entered (D074). `approver`: who typed
 * it (the caller's user id; null for a guest, never guessed): the edited figure's author_id and approved_by, and its history
 * entry's, exactly as `validatePostimage` records an approved card's (C6). A record the edit does not change is as saved,
 * its approval, approved_by and author_id included.
 */
export type CanvasFigure = { readonly quantity_id: string } | { readonly goal_id: string };
/**
 * A panel answer is a chance between 0 and 1 (`elicitation-append.ts`, stored as given). In a quantity's own unit: unitless
 * or a rate per period exactly as it is; a % (or a % per period) times 100, by moving the decimal point of its shortest
 * decimal form, so 0.6 is 60, never 59.99…; any other unit is no chance (null), refused, never guessed.
 */
function chanceIn(unit: string | null | undefined): ((p: number) => number) | null {
  const u = parseUnit(unit ?? '1');
  const dims = u.ok ? Object.entries(u.unit.dims) : [];
  if (!u.ok || dims.length > 1 || !dims.every(([d, e]) => TIME_DIMS.has(d) && e === -1)) return null;
  return u.unit.scale === 1 ? (p) => p : u.unit.scale === 0.01 ? (p) => { const [d, e = '0'] = String(p).split('e'); return Number(`${d}e${Number(e) + 2}`); } : null;
}
export async function applyCanvasFigure(deps: Pick<ProgramToolDeps, 'dispatch' | 'readTurn'>, scenarioId: string, edit: { readonly target: CanvasFigure; readonly value: number | null;
  readonly low?: number | null; readonly high?: number | null; readonly operation_key: string; readonly approver: string | null;
  /** A panel participant, checked against the panel record, whose answer the owner applies: the figure's author_id; `approver` stays its approved_by. */
  readonly author?: string;
  /** That participant's name, as the panel store holds it: the figure's `party` (whose statement the owner applied). */
  readonly party?: string;
  /** That participant's verified answer, a chance between 0 and 1: converted HERE, into the unit of the quantity THIS read
   *  holds (the read the save is pinned to), so a unit changed since the caller's read never gets a figure meant for the old
   *  one. When given, `value` is not used. */
  readonly chance?: number }): Promise<{ readonly status: 'saved' | 'refused' | 'unknown'; readonly reason?: string; readonly receipt?: unknown;
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
  const convert = edit.chance === undefined ? undefined : chanceIn(q.unit);
  if (convert === null) return { status: 'refused', reason: `A panel answer is a chance between 0 and 1; ‘${q.label}’ is not one. Nothing was changed.` };
  const value = convert === undefined ? edit.value : convert(edit.chance!);
  // A figure typed on the person's OWN range (DL 23 Oct): inside it, it is their new most likely figure (the draw's centre)
  // and the range and its reading stay; outside it, nothing is saved, and the refusal says the range must change with it.
  const onRange = edit.low == null && edit.high == null && value !== null && q.author === 'person' && q.low !== null && q.high !== null && q.low < q.high;
  if (onRange) {
    const n = (x: number) => x.toLocaleString('en-GB');
    const where = value! < q.low! || value! > q.high! ? 'outside' : value === q.low || value === q.high ? 'at the end of, not inside,' : null;
    if (where !== null) return { status: 'refused', reason: `${n(value!)} is ${where} your range of ${n(q.low!)}–${n(q.high!)}, so nothing was saved: change the range with it.` };
  }
  // D074 (C6, "Source quote, contributor and approval actor stay distinct"): their words for this figure are the figure as
  // entered, and nothing the host adds around it (staging: "base sales: 320 loaf/week" was shown "in your words", a label
  // and a unit they never typed). This edit receives NUMBERS, never the literal text typed (the route reads the canvas's
  // `value`/`raw_value` as a number), so the words are the number as JavaScript writes it ("320", "0.8"), or both ends of a
  // range ("80 to 100"): the figure as entered, never claimed to be their keystrokes. That it was set later, not from the
  // brief, is this edit's own history entry (`entered`, validatePostimage), which `project.ts` reads; never these words.
  const words = !onRange && edit.low != null && edit.high != null ? `${edit.low} to ${edit.high}` : `${value}`;
  // The exact postimage: this ONE figure as theirs, in the figure as entered (a goal's target shared with another goal or a
  // limit first gets its own quantity, so the other keeps its figure). No AI call; the same validator as every change.
  if (q.status === 'derived') return { status: 'refused', reason: `"${q.label}" is worked out by its relation; change one of its inputs.` };
  const [low, high] = onRange ? [q.low, q.high] : [edit.low ?? null, edit.high ?? null];
  if (value === null && (low === null || high === null)) return { status: 'refused', reason: 'A figure needs a value, or both ends of a range.' };
  if (low !== null && high !== null && low > high) return { status: 'refused', reason: `The low end ${low} is above the high end ${high}.` };
  const shared = goal !== undefined && (program.canonical.goals.some((x) => x.id !== goal.id && x.measure?.target === q.id) || program.canonical.limits.some((l) => l.measure?.bound === q.id));
  const id = shared ? `${goal!.id}_target` : q.id;
  // A typed figure is theirs.
  const filled: CanonicalQuantityT = { ...q, id, value: value, low, high, range_kind: onRange ? q.range_kind : null, status: 'known', author: 'person', party: edit.party ?? null,
    quote: words, question: null, basis: null, approval: 'approved' };
  const canonical = figurePostimage(program.canonical, filled, shared ? goal!.id : undefined);
  // `entered`: the record they typed, an existing figure or the goal's own target split off, recorded in history as entered (D074).
  const v = validatePostimage(program.canonical, canonical, { removals: [], words: [...program.person_words, words], fresh: [words], approver: edit.approver, entered: id,
    ...(edit.author !== undefined ? { author: edit.author } : {}) });
  if (!v.ok) return { status: 'refused', reason: v.reason };
  const next = withNewRun({ ...program, canonical: v.model, person_words: [...program.person_words, words] });
  if (next.evaluation.compiled.errors.length > 0) return { status: 'refused', reason: `That figure does not fit the model: ${next.evaluation.compiled.errors[0]!.message}` };
  const { write } = await savePostimage(deps.dispatch, { scenarioId, operationId: programOperationId(scenarioId, `card:${edit.operation_key}`), expectedIdentity: saved.identity,
    ...(deps.readTurn !== undefined ? { readTurn: deps.readTurn } : {}) },
    next.graph);
  return isSaved(write) ? { status: 'saved', receipt: 'receipt' in write ? write.receipt : undefined, changes: v.changes }
    : { status: write.status === 'unknown' ? 'unknown' : 'refused', reason: write.status === 'stale' ? 'Your model changed meanwhile; reload to see it.' : 'That change could not be saved.' };
}
