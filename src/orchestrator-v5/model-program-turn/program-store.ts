/**
 * THE SAVED MODEL PROGRAM (alpha): what a program scenario's saved graph holds, and how it is read back. Light: no model call,
 * no write, so the scenario read can show the stored Run without loading the drafting client.
 *
 * ONE canonical authority (the PL's ruling, 23 Oct): the saved graph is S1's GraphV3 PROJECTION of the canonical model, never
 * a second model to edit. The program rides it in `living_model`, under ONE discriminator every writer, router and reader uses:
 *   { model_program: 'v1', canonical, seed, person_words, runs }
 *  · canonical: the CanonicalModel (its own `version`);
 *  · seed: fixed per scenario; person_words: every text of the person's the quotes are checked against (the brief, their
 *    later figures and answers);
 *  · runs: every Run with its receipt (`run-receipt.ts`), newest last. A reopen shows the newest stored Run, never a recompute.
 * A living model that CLAIMS a program (it carries `model_program`) but cannot be read as v1 is UNREADABLE: refused with a
 * way forward, never treated as a legacy model or as no model.
 */
import { CanonicalModel, withDeclaredTiming, type CanonicalModelT } from '../model-program/canonical.js';
import { ENGINE_VERSIONS, shownRun, shownView, type EngineVersions, type StoredRun } from './run-receipt.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

export const MODEL_PROGRAM = 'v1' as const;

export type SavedProgram = {
  readonly model_program: typeof MODEL_PROGRAM;
  readonly canonical: CanonicalModelT;
  readonly seed: number;
  readonly person_words: readonly string[];
  readonly runs: readonly StoredRun[];
};

/** A stored Run as the store keeps it: its id, its receipt and its result (their insides are the engine's, read as stored). */
const isStoredRun = (r: unknown): r is StoredRun => isRec(r) && typeof r['run_id'] === 'string' && isRec(r['receipt']) && isRec(r['result']);

/** Whether a saved graph CLAIMS to be a program scenario's: its living model carries the discriminator, readable or not. */
export const isProgramGraph = (graph: unknown): boolean => isRec(graph) && isRec(graph['living_model']) && 'model_program' in graph['living_model'];

export type ProgramRead = { readonly kind: 'program'; readonly program: SavedProgram } | { readonly kind: 'unreadable'; readonly reason: string } | { readonly kind: 'none' };
/** The saved program, or why a claimed one cannot be read, or none (a legacy model, or no model). */
export function programReadOf(graph: unknown): ProgramRead {
  if (!isProgramGraph(graph)) return { kind: 'none' };
  const lm = (graph as Rec)['living_model'] as Rec;
  if (lm['model_program'] !== MODEL_PROGRAM) return { kind: 'unreadable', reason: `its model is in a form this version cannot read (${JSON.stringify(lm['model_program'])})` };
  const parsed = CanonicalModel.safeParse(withDeclaredTiming(lm['canonical']));
  if (!parsed.success) return { kind: 'unreadable', reason: 'its saved model does not match the model format' };
  const words = lm['person_words'];
  if (typeof lm['seed'] !== 'number' || !Array.isArray(words) || !words.every((w) => typeof w === 'string')) return { kind: 'unreadable', reason: 'its saved model is missing its seed or the person\'s words' };
  const runs: unknown = lm['runs'];
  if (!Array.isArray(runs) || !runs.every(isStoredRun)) return { kind: 'unreadable', reason: 'its stored Runs are not readable' };
  return { kind: 'program', program: { model_program: MODEL_PROGRAM, canonical: parsed.data, seed: lm['seed'], person_words: words as string[], runs } };
}
/** The saved program, or undefined when the graph holds none or an unreadable one (the caller tells those apart with `programReadOf`). */
export function savedProgramOf(graph: unknown): SavedProgram | undefined {
  const r = programReadOf(graph);
  return r.kind === 'program' ? r.program : undefined;
}

/** The words a person sees when a claimed program cannot be read: what happened, that nothing changed, and the way on. */
export const unreadableWords = (reason: string): string =>
  `This scenario's model can't be opened here: ${reason}. Nothing was changed. You can start a new scenario from your brief, and this one stays as it was.`;

/** The living model a write stores: exactly the program, nothing derived beyond its stored Runs. */
export const livingModelOf = (p: SavedProgram): Rec => ({ model_program: p.model_program, canonical: p.canonical, seed: p.seed, person_words: p.person_words, runs: p.runs });

/** The person's words the compiler checks quotes against: the brief and every answer they gave, in order. */
export const sourceTextOf = (words: readonly string[]): string => words.join('\n');

/** REOPEN: the newest STORED Run's result, exactly as computed (marked stale when the model moved since); never recomputed. */
export function reopenProgram(graph: unknown, versions: EngineVersions = ENGINE_VERSIONS): { readonly program: SavedProgram; readonly view: unknown;
  readonly run: StoredRun | null; readonly current: boolean; readonly engine_current: boolean } | undefined {
  const program = savedProgramOf(graph);
  if (program === undefined) return undefined;
  const stored = isRec(graph) && isRec(graph['living_model']) ? graph['living_model']['canonical'] : undefined;
  const shown = shownRun(program.runs, program.canonical, program.person_words, versions, stored);
  // Stale when the model moved or the engine did; said as "from before an update" when only an update did (S4).
  return { program, view: shown === undefined ? null : shownView(shown.run, shown.current && shown.engine_current, shown.updated), run: shown?.run ?? null,
    current: shown?.current ?? false, engine_current: shown?.engine_current ?? false };
}
