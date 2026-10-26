/**
 * SAVING A MODEL PROGRAM (alpha): every change is evaluated as a NEW Run and written WITH it, as ONE core write through the
 * core route's existing writer (`writeCorePostimage`: register with CAS on the base identity and an operation id, then an
 * independent readback). The saved graph is S1's GraphV3 projection; the program rides it in `living_model`.
 */
import { createHash } from 'node:crypto';
import type { InternalDispatch } from '../core-route/internal-dispatch.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { findOperationVersion, unknownWrite, writeCorePostimage, type CoreWrite } from '../path-b/tools/core-write.js';
import { approvedGraphHeld, isSavedRead, readSaved } from './saved-read.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { compile } from '../model-program/compile.js';
import { project } from '../model-program/project.js';
import { chancesOf, evaluateCanonical, type Evaluation } from './evaluate.js';
import { livingModelOf, savedProgramOf, sourceTextOf, type SavedProgram } from './program-store.js';
import { newRun, type StoredRun } from './run-receipt.js';

type Rec = Record<string, unknown>;

/** What a turn reports of a compile: the typed outcomes, never the executable model itself. */
export const compileBlock = (e: Evaluation) => ({
  compiles: e.compiled.errors.length === 0, executable: e.compiled.executable !== null,
  errors: e.compiled.errors, per_goal: e.compiled.perGoal, per_limit: e.compiled.perLimit, per_option: e.compiled.perOption,
  joint: e.compiled.joint, within_limits: e.compiled.within_limits, blockers: e.compiled.blockers, unverified: e.compiled.unverified,
  conversions: e.compiled.conversions, implicit_as_stated: e.compiled.implicit_as_stated,
});

/**
 * Evaluate the program as it now stands and append that evaluation as a NEW Run; earlier Runs are kept as they were. The
 * Run names the display graph it was computed with (`graph_hash_at_run`: the same analysis hash the scenario read serves).
 * `graph` is the complete postimage that stores it.
 */
export function withNewRun(program: SavedProgram): { readonly program: SavedProgram; readonly evaluation: Evaluation; readonly run: StoredRun; readonly graph: Rec } {
  const evaluation = evaluateCanonical(program.canonical, { sourceText: sourceTextOf(program.person_words), seed: program.seed, ...briefOf(program) });
  const run = newRun({ canonical: program.canonical, personWords: program.person_words, seed: program.seed, draws: evaluation.sim?.draws ?? null,
    index: program.runs.length, graphHash: analysisHashOf(evaluation.projection.graph),
    result: { canonical_analysis_view: evaluation.view, chances: chancesOf(evaluation.sim), compile: compileBlock(evaluation) } });
  const next = { ...program, runs: [...program.runs, run] };
  return { program: next, evaluation, run, graph: { ...evaluation.projection.graph, living_model: livingModelOf(next) } };
}

/** The analysis hash the scenario read serves for this display graph (its ingress shape, checked, never cast). */
const analysisHashOf = (graph: unknown): string | null => {
  const parsed = GraphStateIngressSchema.safeParse(graph);
  return parsed.success ? computeAnalysisAffectingGraphHash(parsed.data) : null;
};

const briefOf = (p: SavedProgram) => (p.person_words[0] !== undefined ? { brief: p.person_words[0] } : {});

/** The complete postimage of a program as stored: the display graph of its model, with the program (and its Runs) as its living model. */
export function postimageOf(program: SavedProgram): Rec {
  const compiled = compile(program.canonical, { sourceText: sourceTextOf(program.person_words) });
  return { ...project(program.canonical, compiled, briefOf(program)).graph, living_model: livingModelOf(program) };
}

/** A stable UUID-shaped operation id: a retry of the same change is the same operation, never a second write. */
export function programOperationId(scenarioId: string, key: string): string {
  const b = Buffer.from(createHash('sha256').update(`model_program:${scenarioId}:${key}`).digest().subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export type ProgramSave = { readonly write: CoreWrite; readonly readback: Rec };

/**
 * ONE core write of a postimage, then an independent read: the saved program and its Runs must come back equal. Compared
 * key-order-free (a JSONB column reorders keys; every digest here is over `stableStringify`, so order never moves a result).
 * A write whose acknowledgement never came (the register threw, or answered 5xx or 409 reused) may have landed: this
 * operation's own version is looked up once more, by its own id (writes#4). A hit proves this operation committed, never
 * what (a resend's other bytes, or a save after it), so it IS this save, never a second revision, only while the read holds
 * the complete postimage sent; otherwise, as when none is found, it stays unknown. The register's own 409 lookup (a caller's
 * `ownVersion`) is held to the same read: an `already_saved` whose postimage the read no longer holds is unknown, as a later
 * save stands where it was (Codex r2). An acknowledged write whose read does not match is never settled by the lookup: its
 * content is in doubt.
 */
export async function savePostimage(dispatch: InternalDispatch, w: { readonly scenarioId: string; readonly operationId: string; readonly expectedIdentity: string | null;
  readonly briefText?: string; readonly ownVersion?: () => Promise<unknown | null> }, graph: Rec): Promise<ProgramSave> {
  const sentWrite = await writeCorePostimage({ dispatch }, { scenarioId: w.scenarioId, graph, operationId: w.operationId, expectedIdentity: w.expectedIdentity,
    ...(w.briefText !== undefined ? { briefText: w.briefText } : {}), ownVersion: w.ownVersion ?? (async () => null) });
  const own = sentWrite.status === 'unknown' && sentWrite.outcome.status === 'unavailable' && sentWrite.outcome.reason === 'not_confirmed'
    ? await (w.ownVersion ?? (() => findOperationVersion(dispatch, w.scenarioId, w.operationId)))().catch(() => null) : null;
  const sent = savedProgramOf(graph);
  const read = await readSaved({ dispatch }, w.scenarioId);
  const back = isSavedRead(read) ? savedProgramOf(read.graph) : undefined;
  const held = isSavedRead(read) && approvedGraphHeld(graph, read.graph);
  const write: CoreWrite = own !== null && held ? { status: 'already_saved', receipt: own }
    : sentWrite.status === 'already_saved' && !held ? unknownWrite('not_verified', { check: 'hash_mismatch', field: 'read_identity', expected: null, actual: null }) : sentWrite;
  return { write, readback: { read: isSavedRead(read), version: back?.canonical.version ?? null, model_program: back?.model_program ?? null,
    seed_identical: back !== undefined && back.seed === sent?.seed,
    canonical_identical: back !== undefined && stableStringify(back.canonical) === stableStringify(sent?.canonical),
    runs_identical: back !== undefined && stableStringify(back.runs) === stableStringify(sent?.runs) } };
}

export const isSaved = (w: CoreWrite): boolean => w.status === 'saved' || w.status === 'already_saved';
