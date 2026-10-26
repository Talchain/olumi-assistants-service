/**
 * THE HOST'S OWN TURNS OF A PROGRAM SCENARIO (alpha), on the core route:
 *  · the FIRST turn: a scenario with no saved model is drafted by the CANONICAL drafter (`draft.ts`): one strict
 *    CanonicalModel call, compiled, repaired with the compiler's sentences in the same conversation (≤ 2), then evaluated as
 *    the scenario's first Run and saved WITH it as ONE core write (`program-save.ts`);
 *  · a Run press: no model call. The stored Run when it is current for this model and engine, else a new Run, saved.
 * Every other turn is the core agent's own native chat, with its tools on the program (`program-tools.ts`).
 */
import { CONFIRM_READING } from '../agent-lane/approval-chips.js';
import type { ProposalStore } from '../agent-lane/proposal.js';
import type { InternalDispatch } from '../core-route/internal-dispatch.js';
import type { ToolResult } from '../agent-lane/runtime/agent-tools.js';
import type { CanonicalModelT } from '../model-program/canonical.js';
import { compile, normalise, type Blocker } from '../model-program/compile.js';
import { draftCanonicalModel, ledgeredResponsesCall, type ResponsesCall } from './draft.js';
import { seedOf } from './evaluate.js';
import { asDrafted, readingOf, verbatimIn } from './postimage.js';
import { holdProgramCard } from './program-tools.js';
import { isSaved, programOperationId, savePostimage, withNewRun } from './program-save.js';
import { MODEL_PROGRAM, reopenProgram, savedProgramOf, type SavedProgram } from './program-store.js';
import { CANONICAL_SCHEMA_SHA256, DRAFTING_PROMPT_SHA256 } from './prompt.js';
import { readingGroups, readingLine } from './reading-groups.js';
import type { StoredRun } from './run-receipt.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export interface ProgramTurnInput {
  readonly scenarioId: string;
  readonly turnId: string;
  readonly message: string;
  /** The saved scenario as the turn found it: none (the first turn, drafting) or a program (a Run press). */
  readonly saved: { readonly graph: Rec | null; readonly identity: string | null };
  /** The route's counting dispatch (register + reads), so the write is accounted as every core write is. */
  readonly dispatch: InternalDispatch;
  /** Told the saved graph once a draft is registered (the route streams it as GRAPH_READY, as a core draft's is). */
  readonly onModelRegistered?: (graph: Rec) => void;
  /** Test seam only; the route passes nothing and gets the ledgered client. */
  readonly call?: ResponsesCall;
  /** Where the first draft's reading card is held (the route's store), and who would approve it. No store: no card. */
  readonly proposals?: ProposalStore;
  readonly userId?: string | null;
}
export interface ProgramTurnOutput {
  readonly assistantText: string;
  /** `code`: a refused save's own reason from the register (`details.code`, e.g. GRAPH_TOO_LARGE), when it gave one. */
  readonly toolCalls: { readonly name: string; readonly ok: boolean; readonly outcome: string; readonly refusal?: string; readonly code?: string; readonly mutated?: boolean; readonly proposal_id?: string }[];
  readonly toolResults: ToolResult[];
  readonly mutated: boolean;
  readonly verifiedSave: boolean;
  /** The turn payload's blocks: `canonical_analysis_view` (the stored Run's) and `model_program`. */
  readonly payload: { readonly canonical_analysis_view: unknown; readonly model_program: Rec };
}

type TurnKind = 'draft' | 'run';
/** The reading card's name for what it asks (the card's own heading is the UI's). */
const READING_LABEL = 'Your situation as I understood it';
const OPENING: Record<TurnKind, (m: CanonicalModelT) => string> = {
  draft: (m) => `I've drafted a first model of: ${m.question}`,
  run: () => 'Here is the analysis of the model as it stands.',
};
/**
 * The reply: what calculates (S2's own words per option, then which option is most likely to achieve the goal, or why none
 * is named, in the view's own words); then every one of the AI's OWN questions on what the Run waits on, in the model's
 * order (the drafter puts the most consequential first; no code ranking, no cap: strip, Paul 26 Oct); then one line counting
 * the rest. The code writes no question: a blocker with no question of the AI's (a reading, a recount) is counted, never worded.
 */
function replyOf(model: CanonicalModelT, run: StoredRun, kind: TurnKind, words: readonly string[], readingHeld = false): string {
  const view = run.result.canonical_analysis_view as { options?: readonly { cell: { kind: string; face?: string; reasons?: readonly { code: string; message: string | null }[] } }[];
    leader?: { words?: unknown } };
  const options = view.options ?? [];
  // A Run refused for its size withholds every cell for that one reason: said once, in the view's own words, and a Run press
  // never says it is an analysis (words#11).
  const tooLarge = options.some((o) => o.cell.kind === 'figure') ? null : options.flatMap((o) => o.cell.reasons ?? []).find((r) => r.code === 'too_large')?.message ?? null;
  const lines: string[] = kind === 'run' && tooLarge !== null ? [] : [OPENING[kind](model)];
  // The first draft says, in one line, how much is theirs, how much is Olumi's to check and how much is left out (alpha G13);
  // the reading card under it lists each, in the same groups. Said only when that card is held: the line is its summary.
  const counted = kind === 'draft' && readingHeld ? readingLine(readingGroups(model, (quote) => verbatimIn(quote, words))) : null;
  if (counted !== null) lines.push(counted);
  if (tooLarge !== null) lines.push(tooLarge);
  for (const o of options) if (o.cell.kind === 'figure' && typeof o.cell.face === 'string') lines.push(o.cell.face);
  // Which option is most likely to achieve the goal in this model, or why none is named: the view's own words (W6).
  if (typeof view.leader?.words === 'string' && view.leader.words.trim() !== '') lines.push(view.leader.words);
  const compiled = run.result.compile as { blockers?: readonly Blocker[] };
  // A Run stored before blockers (reused while current) gets them from the model as it stands: the same compiler, typed.
  const blockers = compiled.blockers ?? compile(model).blockers;
  const m = normalise(model);
  // The AI's own words on the record each blocker names. Never a guess at which record it is.
  const own = (b: Blocker): string | null => (b.code === 'asked' ? m.quantities.find((q) => q.id === b.id)?.question
    : b.code === 'measure' || b.code === 'deadline' ? [...m.goals, ...m.limits].find((r) => r.id === b.id)?.question : null) ?? null;
  const asked = [...new Set(blockers.map(own).filter((x): x is string => x !== null && x.trim() !== ''))];
  const rest = blockers.filter((b) => { const q = own(b); return q === null || !asked.includes(q); }).length;
  if (asked.length > 0) lines.push(asked.map((q, i) => `${i + 1}. ${q}`).join('\n'));
  if (rest > 0) lines.push(`The chance also waits on ${rest} other ${rest === 1 ? 'thing' : 'things'}, listed with the result.`);
  return lines.join('\n\n');
}

const runOf = (run: StoredRun) => ({ run_id: run.run_id, receipt: run.receipt, computed_at: run.computed_at });

export async function runModelProgramTurn(input: ProgramTurnInput): Promise<ProgramTurnOutput> {
  const prior = savedProgramOf(input.saved.graph);
  let program: SavedProgram;
  let draftMeta: Rec | undefined;
  if (prior === undefined) {
    const draft = await draftCanonicalModel(input.message, input.call ?? ledgeredResponsesCall(), input.message, { interpret: true });
    // prompt_sha256 is the FIXED instructions; what was sent is them plus todayLine(today) (alpha G14, Codex on #3760).
    draftMeta = { prompt_sha256: DRAFTING_PROMPT_SHA256, schema_sha256: CANONICAL_SCHEMA_SHA256, today: draft.today, attempts: draft.attempts };
    if (draft.model === null || draft.compiled === null || draft.compiled.errors.length > 0) {
      const why = draft.model === null ? (draft.attempts.at(-1)?.failed ?? 'no draft came back') : `${draft.compiled!.errors.length} compile error(s) remain after ${draft.attempts.length - 1} repair(s)`;
      const model_program = { turn: 'draft', saved: false, draft: draftMeta, canonical: draft.model, compile: draft.compiled === null ? null : { compiles: false, errors: draft.compiled.errors } };
      // A call that threw: its typed provider fields, for the turn's summary log line.
      const provider_error = draft.attempts.at(-1)?.provider_error;
      return { assistantText: `I couldn't build a model that calculates from this yet (${why}). Nothing was saved.`,
        toolCalls: [{ name: 'draft_canonical_model', ok: false, outcome: 'refused', refusal: draft.model === null ? 'no_draft' : 'does_not_compile' }],
        toolResults: [{ ok: false, mutated: false, ...model_program, ...(provider_error !== undefined ? { provider_error } : {}) }], mutated: false, verifiedSave: false, payload: { canonical_analysis_view: null, model_program } };
    }
    // Host-owned: a draft is Olumi's reading until the person confirms it, so nothing in it is approved yet (step 2). The day
    // the drafter was told is kept as the model's period 0, so a later update counts its dates from the same day (words#5).
    program = { model_program: MODEL_PROGRAM, canonical: asDrafted(draft.model), seed: seedOf(input.scenarioId), person_words: [input.message], runs: [], drafted_on: draft.today };
  } else {
    // A Run press: the stored Run IS the analysis of this model on this engine, shown as stored, nothing written.
    const shown = reopenProgram(input.saved.graph);
    if (shown?.run && shown.current && shown.engine_current) {
      return { assistantText: replyOf(prior.canonical, shown.run, 'run', prior.person_words), toolCalls: [{ name: 'run_program', ok: true, outcome: 'stored' }], toolResults: [{ ok: true, mutated: false }],
        mutated: false, verifiedSave: false, payload: { canonical_analysis_view: shown.view, model_program: { turn: 'run', saved: false, stored: true, run: runOf(shown.run) } } };
    }
    program = prior;
  }

  // This evaluation is a NEW Run, stored with the model; the Runs before it are kept exactly as they were.
  const kind: TurnKind = prior === undefined ? 'draft' : 'run';
  const next = withNewRun(program);
  const { write, readback } = await savePostimage(input.dispatch, { scenarioId: input.scenarioId, operationId: programOperationId(input.scenarioId, `turn:${input.turnId}`),
    expectedIdentity: input.saved.identity, ...(kind === 'draft' ? { briefText: input.message } : {}) }, next.graph);
  const saved = isSaved(write);
  if (write.status === 'saved') { try { input.onModelRegistered?.(write.after.graph); } catch { /* an observer never decides the outcome */ } }
  const receipt = saved && 'receipt' in write ? write.receipt : null;
  // STEP 2, "Check what I understood": the saved draft read back on ONE held card, every item an add, for the person to confirm
  // ("Yes, that’s what I meant") or correct. Its model is the draft accepted by them, with a new Run; nothing more is saved now.
  const reading = kind === 'draft' && write.status === 'saved' && write.after.identity !== null && input.proposals !== undefined ? (() => {
    const v = readingOf(next.program.canonical, { words: next.program.person_words, approver: input.userId ?? null });
    if (!v.ok) return { call: { name: CONFIRM_READING, ok: false, outcome: 'refused', refusal: v.code, mutated: false }, result: { ok: false, mutated: false, refusal: v.code, ids: v.ids } };
    const p = holdProgramCard(input.proposals!, { scenarioId: input.scenarioId, userId: input.userId ?? null, graphHash: write.after.graphHash, identity: write.after.identity!, base: savedProgramOf(write.after.graph) ?? next.program },
      { label: READING_LABEL, basis: 'Olumi’s reading of the brief, for the person to confirm or correct.', program: withNewRun({ ...next.program, canonical: v.model }).program, changes: v.changes, reading: true });
    return { call: { name: CONFIRM_READING, ok: true, outcome: 'ok', mutated: false, proposal_id: p.proposal_id }, result: { ok: true, mutated: false, proposal_id: p.proposal_id, public_label: p.public_label } };
  })() : undefined;
  return {
    assistantText: saved ? replyOf(next.program.canonical, next.run, kind, next.program.person_words, reading?.result.ok === true)
      // An unknown outcome may have been written: never say nothing changed (alpha review G4). Where no acknowledgement came,
      // the save has already looked for this operation's own version (`savePostimage`): unknown here means none was found, or
      // the model read back is not the one sent, so this model is never narrated as saved.
      : write.status === 'unknown' ? 'The save could not be confirmed, so the model may or may not have changed. Reload to see the current model before changing it again.'
        : `The model could not be saved (${write.status}). Nothing was changed.`,
    toolCalls: [{ name: kind === 'draft' ? 'draft_canonical_model' : 'run_program', ok: saved, outcome: saved ? 'ok' : write.status, mutated: saved, ...(saved ? {} : { refusal: `save_${write.status}` }),
      ...(write.status === 'refused' && write.code !== null ? { code: write.code } : {}) },
      ...(reading !== undefined ? [reading.call] : [])],
    toolResults: [{ ok: saved, mutated: saved, ...(isRec(receipt) ? { model_version: receipt } : {}) }, ...(reading !== undefined ? [reading.result] : [])],
    mutated: saved, verifiedSave: write.status === 'saved',
    payload: {
      canonical_analysis_view: next.run.result.canonical_analysis_view,
      // The turn's own record; the model, its compile and its chances are the saved program's (`living_model`).
      model_program: { turn: kind, saved, write: write.status, readback, model_program: MODEL_PROGRAM, run: runOf(next.run), blockers: next.evaluation.compiled.blockers,
        ...(draftMeta !== undefined ? { draft: draftMeta } : {}) },
    },
  };
}
