/**
 * SPIKE S3: THE MODEL-PROGRAM CORE TURN, run in place of the SDK turn on the core route (`routes/core-turn.ts`) when the
 * first turn asks for the canonical drafting arm (`x-olumi-draft-arm: canonical`), and on every later turn of a scenario
 * whose saved model is a model program. Branch-only (wip/spike-s3-integrate): never staging.
 *
 *  · FIRST TURN: the drafting call returns a CanonicalModel; compile, and repair with the compiler's sentences in the same
 *    conversation (≤ 2); then evaluate (compile → simulate on the scenario's seed → present → project) and save.
 *  · ANSWER TURN: each answer is ONE edit filling exactly ONE quantity (S1 `fillQuantity`): the person's figure, in their
 *    words, approved by them. Then evaluate and save. No model call.
 *  · SAVE: the display graph with the model program in `living_model` (`{ model_program: 'v1', canonical, seed,
 *    person_words }`), through the core route's ONE write (`writeCorePostimage`: register, then an independent readback).
 *    The readback's canonical model must equal the saved one byte for byte.
 *  · RUN: every evaluation is a Run stored WITH the model in the same write (`run-receipt.ts`): its receipt (revision digest,
 *    engine versions, seed, draws) and the result it showed. A later evaluation appends a new Run; earlier ones never change.
 *  · REOPEN (`reopenModelProgram`): shows the newest STORED Run's result, never a recomputation, with whether it is current
 *    for the saved model and for today's engine.
 */
import { createHash } from 'node:crypto';
import type { InternalDispatch } from '../agent-lane/runtime/agent-capabilities.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { CanonicalModel, CANONICAL_VERSION, type CanonicalModelT } from '../model-program/canonical.js';
import { fillQuantity, type Answer } from '../model-program/answer.js';
import { writeCorePostimage, type CoreWrite } from '../path-b/tools/core-write.js';
import { readSaved, isSavedRead } from '../path-b/tools/context-tool.js';
import { draftCanonicalModel, ledgeredResponsesCall, type DraftOutcome, type ResponsesCall } from './draft.js';
import { chancesOf, evaluateCanonical, seedOf, type Evaluation } from './evaluate.js';
import { DRAFTING_PROMPT_SHA256, CANONICAL_SCHEMA_SHA256 } from './prompt.js';
import { ENGINE_VERSIONS, newRun, shownRun, type EngineVersions, type StoredRun } from './run-receipt.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export const MODEL_PROGRAM_ARM = 'canonical';
export const MODEL_PROGRAM_SAVE_VERSION = 'v1' as const;

export type SavedProgram = { readonly model_program: typeof MODEL_PROGRAM_SAVE_VERSION; readonly canonical: CanonicalModelT; readonly seed: number;
  readonly person_words: readonly string[]; readonly runs: readonly StoredRun[] };

/** The saved model program on a graph, or undefined when the graph holds none (or an unreadable one). */
export function savedProgramOf(graph: unknown): SavedProgram | undefined {
  const lm = isRec(graph) ? graph['living_model'] : undefined;
  if (!isRec(lm) || lm['model_program'] !== MODEL_PROGRAM_SAVE_VERSION) return undefined;
  const parsed = CanonicalModel.safeParse(lm['canonical']);
  const seed = lm['seed'];
  const words = lm['person_words'];
  if (!parsed.success || typeof seed !== 'number' || !Array.isArray(words) || !words.every((w) => typeof w === 'string')) return undefined;
  const runs = Array.isArray(lm['runs']) ? (lm['runs'] as unknown[]).filter((r): r is StoredRun => isRec(r) && isRec(r['receipt']) && isRec(r['result'])) : [];
  return { model_program: MODEL_PROGRAM_SAVE_VERSION, canonical: parsed.data, seed, person_words: words as string[], runs };
}
export const isModelProgramGraph = (graph: unknown): boolean => isRec(graph) && isRec(graph['living_model']) && graph['living_model']['model_program'] !== undefined;

/** The person's words the compiler checks quotes against: the brief and every answer they gave, in order. */
const sourceTextOf = (words: readonly string[]) => words.join('\n');

/** REOPEN: the newest STORED Run's result, exactly as it was computed; never recomputed here. */
export function reopenModelProgram(graph: unknown, versions: EngineVersions = ENGINE_VERSIONS): { readonly program: SavedProgram; readonly view: unknown;
  readonly run: StoredRun | null; readonly current: boolean; readonly engine_current: boolean } | undefined {
  const program = savedProgramOf(graph);
  if (program === undefined) return undefined;
  const shown = shownRun(program.runs, program.canonical, program.person_words, versions);
  return { program, view: shown?.run.result.canonical_analysis_view ?? null, run: shown?.run ?? null, current: shown?.current ?? false, engine_current: shown?.engine_current ?? false };
}

/** A NEW evaluation of the saved program (what a turn does before it stores a new Run): never what a reopen shows. */
export function reevaluateModelProgram(program: SavedProgram): Evaluation {
  return evaluateCanonical(program.canonical, { sourceText: sourceTextOf(program.person_words), seed: program.seed });
}

/** One answer to one ask, as an ask card sends it: the quantity it fills, the figure, and the person's own words. */
export type ProgramAnswer = { readonly quantity_id: string; readonly value?: number | null; readonly low?: number | null; readonly high?: number | null; readonly words: string };
export function parseProgramAnswers(raw: unknown): ProgramAnswer[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ProgramAnswer[] = [];
  for (const a of raw) {
    if (!isRec(a) || typeof a['quantity_id'] !== 'string' || typeof a['words'] !== 'string') return null;
    const num = (k: string) => (typeof a[k] === 'number' && Number.isFinite(a[k]) ? a[k] as number : null);
    out.push({ quantity_id: a['quantity_id'], value: num('value'), low: num('low'), high: num('high'), words: a['words'] });
  }
  return out;
}

export interface ProgramTurnInput {
  readonly scenarioId: string;
  readonly turnId: string;
  readonly message: string;
  readonly answers: readonly ProgramAnswer[] | null;
  /** The saved scenario as the turn found it. */
  readonly saved: { readonly graph: Rec | null; readonly identity: string | null };
  /** The route's counting dispatch (register + reads), so the write is accounted as every core write is. */
  readonly dispatch: InternalDispatch;
  /** Test seam only; the route passes nothing and gets the ledgered client. */
  readonly call?: ResponsesCall;
}
export interface ProgramTurnOutput {
  readonly assistantText: string;
  readonly toolCalls: { readonly name: string; readonly ok: boolean; readonly outcome: string; readonly refusal?: string }[];
  readonly toolResults: Rec[];
  readonly mutated: boolean;
  readonly verifiedSave: boolean;
  /** The turn payload's blocks: `canonical_analysis_view` and `model_program`. */
  readonly payload: { readonly canonical_analysis_view: unknown; readonly model_program: Rec };
}

function operationIdOf(scenarioId: string, turnId: string): string {
  const b = Buffer.from(createHash('sha256').update(`model_program:${scenarioId}:${turnId}`).digest().subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const compileBlock = (e: Evaluation) => ({
  compiles: e.compiled.errors.length === 0, executable: e.compiled.executable !== null,
  errors: e.compiled.errors, per_goal: e.compiled.perGoal, per_limit: e.compiled.perLimit, per_option: e.compiled.perOption,
  joint: e.compiled.joint, within_limits: e.compiled.within_limits, coaching: e.compiled.coaching, unverified: e.compiled.unverified,
  conversions: e.compiled.conversions, implicit_as_stated: e.compiled.implicit_as_stated,
});

/** The reply: what calculates (S2's own words per option), what waits and on which questions. Host words, spike only. */
function replyOf(model: CanonicalModelT, e: Evaluation, first: boolean): string {
  const lines: string[] = [first ? `I've drafted a first model of: ${model.question}` : 'I\'ve added your answers to the model.'];
  if (e.compiled.errors.length > 0) {
    lines.push(`It does not calculate yet: ${e.compiled.errors.slice(0, 3).map((x) => x.message).join(' ')}`);
    return lines.join('\n\n');
  }
  const view = e.view as { options?: readonly { cell: { kind: string; face?: string } }[]; goal_chance?: { notes?: readonly string[] } };
  for (const o of view.options ?? []) if (o.cell.kind === 'figure' && typeof o.cell.face === 'string') lines.push(o.cell.face);
  for (const n of view.goal_chance?.notes ?? []) lines.push(n);
  const asks = e.compiled.asks.filter((a) => a.feeds.length > 0);
  if (asks.length > 0) lines.push(['To work out what is still missing, I need:', ...asks.map((a, i) => `${i + 1}. ${a.question}`)].join('\n'));
  for (const c of e.compiled.coaching) lines.push(c.question);
  return lines.join('\n\n');
}

async function save(input: ProgramTurnInput, program: SavedProgram, e: Evaluation, briefText?: string): Promise<{ write: CoreWrite; readback: Rec }> {
  const graph: Rec = { ...e.projection.graph, living_model: { model_program: program.model_program, canonical: program.canonical, seed: program.seed,
    person_words: program.person_words, runs: program.runs } };
  const write = await writeCorePostimage({ dispatch: input.dispatch }, {
    scenarioId: input.scenarioId, graph, operationId: operationIdOf(input.scenarioId, input.turnId), expectedIdentity: input.saved.identity,
    ...(briefText !== undefined ? { briefText } : {}), ownVersion: async () => null,
  });
  // READBACK: an independent read; the saved canonical model, with its version, must come back byte for byte.
  const read = await readSaved({ dispatch: input.dispatch }, input.scenarioId);
  const back = isSavedRead(read) ? savedProgramOf(read.graph) : undefined;
  const sent = JSON.stringify(program.canonical);
  const got = back === undefined ? null : JSON.stringify(back.canonical);
  return { write, readback: { read: isSavedRead(read), version: back?.canonical.version ?? null, seed_identical: back?.seed === program.seed,
    runs_identical: back !== undefined && JSON.stringify(back.runs) === JSON.stringify(program.runs),
    canonical_bytes_identical: got === sent, canonical_stable_identical: back !== undefined && stableStringify(back.canonical) === stableStringify(program.canonical),
    canonical_sha256: createHash('sha256').update(sent).digest('hex') } };
}

export async function runModelProgramTurn(input: ProgramTurnInput): Promise<ProgramTurnOutput> {
  const prior = savedProgramOf(input.saved.graph);
  let program: SavedProgram;
  let draft: DraftOutcome | undefined;
  let fills: Rec[] = [];
  if (prior === undefined) {
    // FIRST TURN: the drafting call, with its repairs.
    draft = await draftCanonicalModel(input.message, input.call ?? ledgeredResponsesCall());
    const attempts = draft.attempts.map((a) => ({ attempt: a.attempt, errors: a.errors?.length ?? null, failed: a.failed ?? null, status: a.status, ms: a.ms }));
    const meta = { arm: MODEL_PROGRAM_ARM, prompt_sha256: DRAFTING_PROMPT_SHA256, schema_sha256: CANONICAL_SCHEMA_SHA256, attempts, draft_attempts: draft.attempts };
    if (draft.model === null || draft.compiled === null || draft.compiled.errors.length > 0) {
      const why = draft.model === null ? (draft.attempts.at(-1)?.failed ?? 'no draft came back') : `${draft.compiled!.errors.length} compile error(s) remain after ${draft.attempts.length - 1} repair(s)`;
      return { assistantText: `I couldn't build a model that calculates from this yet (${why}). Nothing was saved.`,
        toolCalls: [{ name: 'draft_canonical_model', ok: false, outcome: 'refused', refusal: draft.model === null ? 'no_draft' : 'does_not_compile' }],
        toolResults: [{ draft: meta }], mutated: false, verifiedSave: false,
        payload: { canonical_analysis_view: null, model_program: { turn: 'draft', saved: false, draft: meta,
          canonical: draft.model, compile: draft.compiled === null ? null : { compiles: false, errors: draft.compiled.errors } } } };
    }
    program = { model_program: MODEL_PROGRAM_SAVE_VERSION, canonical: draft.model, seed: seedOf(input.scenarioId), person_words: [input.message], runs: [] };
  } else {
    // ANSWER TURN: each answer fills exactly one quantity, in the person's words. Nothing else changes.
    if (input.answers === null || input.answers.length === 0) {
      return { assistantText: 'On this spike route a saved model takes answers to its questions only.', toolCalls: [{ name: 'answer_asks', ok: false, outcome: 'refused', refusal: 'no_answers' }],
        toolResults: [], mutated: false, verifiedSave: false, payload: { canonical_analysis_view: reopenModelProgram(input.saved.graph)?.view ?? null, model_program: { turn: 'answer', saved: false, fills: [] } } };
    }
    let model = prior.canonical;
    const words = [...prior.person_words];
    for (const a of input.answers) {
      const ranged = a.low != null && a.high != null;
      const answer: Answer | null = ranged ? { value: a.value ?? null, low: a.low!, high: a.high! } : a.value != null ? { value: a.value } : null;
      const r = answer === null ? { ok: false as const, reason: 'An answer needs a figure, or both ends of a range.' } : fillQuantity(model, a.quantity_id, answer, a.words);
      fills.push({ quantity_id: a.quantity_id, words: a.words, value: a.value ?? null, low: a.low ?? null, high: a.high ?? null, applied: r.ok, ...(r.ok ? {} : { reason: r.reason }) });
      if (r.ok) { model = r.model; if (!words.includes(a.words)) words.push(a.words); }
    }
    if (!fills.some((f) => f['applied'] === true)) {
      return { assistantText: `None of those answers could be added: ${fills.map((f) => f['reason']).join(' ')}`, toolCalls: [{ name: 'answer_asks', ok: false, outcome: 'refused', refusal: 'no_fill_applied' }],
        toolResults: [{ fills }], mutated: false, verifiedSave: false, payload: { canonical_analysis_view: reopenModelProgram(input.saved.graph)?.view ?? null, model_program: { turn: 'answer', saved: false, fills } } };
    }
    program = { ...prior, canonical: model, person_words: words };
  }

  const evaluation = evaluateCanonical(program.canonical, { sourceText: sourceTextOf(program.person_words), seed: program.seed });
  // This evaluation is a NEW Run, stored with the model; the Runs before it are kept exactly as they were.
  const run = newRun({ canonical: program.canonical, personWords: program.person_words, seed: program.seed, draws: evaluation.sim?.draws ?? null, index: program.runs.length,
    result: { canonical_analysis_view: evaluation.view, chances: chancesOf(evaluation.sim), compile: compileBlock(evaluation) } });
  program = { ...program, runs: [...program.runs, run] };
  const { write, readback } = await save(input, program, evaluation, prior === undefined ? input.message : undefined);
  const saved = write.status === 'saved' || write.status === 'already_saved';
  const receipt = write.status === 'saved' || write.status === 'already_saved' ? write.receipt : null;
  const name = prior === undefined ? 'draft_canonical_model' : 'answer_asks';
  return {
    assistantText: saved ? replyOf(program.canonical, evaluation, prior === undefined) : `The model could not be saved (${write.status}). Nothing was changed.`,
    toolCalls: [{ name, ok: saved, outcome: saved ? 'ok' : write.status, ...(saved ? {} : { refusal: `save_${write.status}` }) }],
    toolResults: [{ ...(receipt !== null && isRec(receipt) ? { model_version: receipt } : {}) }],
    mutated: saved, verifiedSave: write.status === 'saved',
    payload: {
      canonical_analysis_view: run.result.canonical_analysis_view,
      model_program: {
        run: { run_id: run.run_id, receipt: run.receipt, computed_at: run.computed_at },
        turn: prior === undefined ? 'draft' : 'answer', saved, write: write.status, readback, seed: program.seed, version: CANONICAL_VERSION,
        ...(draft !== undefined ? { draft: { arm: MODEL_PROGRAM_ARM, prompt_sha256: DRAFTING_PROMPT_SHA256, schema_sha256: CANONICAL_SCHEMA_SHA256, attempts: draft.attempts } } : {}),
        ...(prior !== undefined ? { fills } : {}),
        canonical: program.canonical, compile: compileBlock(evaluation), asks: evaluation.compiled.asks, chances: chancesOf(evaluation.sim),
        draws: evaluation.sim?.draws ?? null, display: { items: evaluation.projection.items },
      },
    },
  };
}
