/**
 * THE HOST'S OWN TURNS OF A PROGRAM SCENARIO (alpha), on the core route:
 *  · the FIRST turn: a scenario with no saved model is drafted by the CANONICAL drafter (`draft.ts`): one strict
 *    CanonicalModel call, compiled, repaired with the compiler's sentences in the same conversation (≤ 2), then evaluated as
 *    the scenario's first Run and saved WITH it as ONE core write (`program-save.ts`);
 *  · a Run press: no model call. The stored Run when it is current for this model and engine, else a new Run, saved.
 * Every other turn is the core agent's own native chat, with its tools on the program (`program-tools.ts`).
 */
import type { InternalDispatch } from '../agent-lane/runtime/agent-capabilities.js';
import type { ToolResult } from '../agent-lane/runtime/agent-tools.js';
import type { CanonicalModelT } from '../model-program/canonical.js';
import { normalise, type Blocker } from '../model-program/compile.js';
import { draftCanonicalModel, ledgeredResponsesCall, type ResponsesCall } from './draft.js';
import { seedOf } from './evaluate.js';
import { isSaved, programOperationId, savePostimage, withNewRun } from './program-save.js';
import { MODEL_PROGRAM, reopenProgram, savedProgramOf, type SavedProgram } from './program-store.js';
import { CANONICAL_SCHEMA_SHA256, DRAFTING_PROMPT_SHA256 } from './prompt.js';
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
}
export interface ProgramTurnOutput {
  readonly assistantText: string;
  readonly toolCalls: { readonly name: string; readonly ok: boolean; readonly outcome: string; readonly refusal?: string }[];
  readonly toolResults: ToolResult[];
  readonly mutated: boolean;
  readonly verifiedSave: boolean;
  /** The turn payload's blocks: `canonical_analysis_view` (the stored Run's) and `model_program`. */
  readonly payload: { readonly canonical_analysis_view: unknown; readonly model_program: Rec };
}

type TurnKind = 'draft' | 'run';
const OPENING: Record<TurnKind, (m: CanonicalModelT) => string> = {
  draft: (m) => `I've drafted a first model of: ${m.question}`,
  run: () => 'Here is the analysis of the model as it stands.',
};
/** The most of the AI's own questions the first reply prints (simplify v1 A4); the rest are counted, and listed on the result. */
export const REPLY_QUESTIONS = 3;
/**
 * The reply: what calculates (S2's own words per option); then at most three of the AI's OWN questions on what the Run waits
 * on, in the model's order (the drafter puts the most consequential first; no code ranking); then one line counting the rest. The code
 * writes no question: a blocker with no question of the AI's (a reading, a structural figure) is counted, never worded.
 */
function replyOf(model: CanonicalModelT, run: StoredRun, kind: TurnKind): string {
  const lines: string[] = [OPENING[kind](model)];
  const view = run.result.canonical_analysis_view as { options?: readonly { cell: { kind: string; face?: string } }[] };
  for (const o of view.options ?? []) if (o.cell.kind === 'figure' && typeof o.cell.face === 'string') lines.push(o.cell.face);
  const compiled = run.result.compile as { blockers?: readonly Blocker[] };
  const blockers = compiled.blockers ?? [];
  const m = normalise(model);
  // The AI's own words on the record each blocker names; with no aim at all, its note on the situation as a whole (a left-out
  // record concerning nothing else) carries its question on what result they want.
  const own = (b: Blocker): string | null => (b.code === 'asked' ? m.quantities.find((q) => q.id === b.id)?.question
    : b.code === 'measure' || b.code === 'deadline' ? [...m.goals, ...m.limits].find((r) => r.id === b.id)?.question
      : b.code === 'no_goal' ? m.left_out.find((x) => x.concerns.length === 0 && x.question !== null)?.question : null) ?? null;
  const asked = [...new Set(blockers.map(own).filter((x): x is string => x !== null && x.trim() !== ''))].slice(0, REPLY_QUESTIONS);
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
    draftMeta = { prompt_sha256: DRAFTING_PROMPT_SHA256, schema_sha256: CANONICAL_SCHEMA_SHA256, attempts: draft.attempts };
    if (draft.model === null || draft.compiled === null || draft.compiled.errors.length > 0) {
      const why = draft.model === null ? (draft.attempts.at(-1)?.failed ?? 'no draft came back') : `${draft.compiled!.errors.length} compile error(s) remain after ${draft.attempts.length - 1} repair(s)`;
      const model_program = { turn: 'draft', saved: false, draft: draftMeta, canonical: draft.model, compile: draft.compiled === null ? null : { compiles: false, errors: draft.compiled.errors } };
      return { assistantText: `I couldn't build a model that calculates from this yet (${why}). Nothing was saved.`,
        toolCalls: [{ name: 'draft_canonical_model', ok: false, outcome: 'refused', refusal: draft.model === null ? 'no_draft' : 'does_not_compile' }],
        toolResults: [{ ok: false, mutated: false, ...model_program }], mutated: false, verifiedSave: false, payload: { canonical_analysis_view: null, model_program } };
    }
    program = { model_program: MODEL_PROGRAM, canonical: draft.model, seed: seedOf(input.scenarioId), person_words: [input.message], runs: [] };
  } else {
    // A Run press: the stored Run IS the analysis of this model on this engine, shown as stored, nothing written.
    const shown = reopenProgram(input.saved.graph);
    if (shown?.run && shown.current && shown.engine_current) {
      return { assistantText: replyOf(prior.canonical, shown.run, 'run'), toolCalls: [{ name: 'run_program', ok: true, outcome: 'stored' }], toolResults: [{ ok: true, mutated: false }],
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
  return {
    assistantText: saved ? replyOf(next.program.canonical, next.run, kind) : `The model could not be saved (${write.status}). Nothing was changed.`,
    toolCalls: [{ name: kind === 'draft' ? 'draft_canonical_model' : 'run_program', ok: saved, outcome: saved ? 'ok' : write.status, ...(saved ? {} : { refusal: `save_${write.status}` }) }],
    toolResults: [{ ok: saved, mutated: saved, ...(isRec(receipt) ? { model_version: receipt } : {}) }],
    mutated: saved, verifiedSave: write.status === 'saved',
    payload: {
      canonical_analysis_view: next.run.result.canonical_analysis_view,
      // The turn's own record; the model, its compile and its chances are the saved program's (`living_model`).
      model_program: { turn: kind, saved, write: write.status, readback, model_program: MODEL_PROGRAM, run: runOf(next.run), blockers: next.evaluation.compiled.blockers,
        ...(draftMeta !== undefined ? { draft: draftMeta } : {}) },
    },
  };
}
