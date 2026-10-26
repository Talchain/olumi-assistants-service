/**
 * THE DURABLE RUN RECEIPT (alpha). A Run is stored WITH the saved model program,
 * in the same write, and a cold reopen shows THAT stored result; it is never recomputed on a read. A new evaluation (a turn
 * that changes the model) appends a NEW Run with its own receipt; every earlier Run stays byte for byte as it was.
 *
 * The receipt is minimal: the revision digest of what was evaluated (the canonical model and the person's words its quotes
 * were checked against), the engine versions, the seed and the draws. Whether the shown Run is current is read from the
 * receipt, never assumed: `current` when its digest is the saved model's, `engine_current` when its versions are today's.
 *
 * Why here and not the core route's Run store: that store is the `run_analysis` handler fact (`@talchain/schemas`
 * RunAnalysisHandlerFactSchema, the `v5_handler_facts` table), whose result is PLoT/ISL's shape. A model-program Run there
 * needs a new fact type in the shared schemas package: a cross-repo contract change, the DL's call. Until then the Run
 * lives beside the model it was computed from, and for these scenarios it is the only Run authority.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { CANONICAL_VERSION, type CanonicalModelT } from '../model-program/canonical.js';

/** The engine's modules outside `model-program/`: the evaluation itself and the helpers present.ts imports. */
const ENGINE_MODULES_OUTSIDE = ['model-program-turn/evaluate', 'agent-lane/say-figure', 'goal-target/goal-target-basis', 'goal-target/goal-chance-driver',
  'goal-target/goal-chance-display', 'goal-target/goal-targets-joint'];
/** The engine token of these modules' bytes (path and contents), so any change to one makes earlier Runs read as before an update. */
export function engineToken(files: readonly { readonly path: string; readonly bytes: Uint8Array }[]): string {
  const h = createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) h.update(`${f.path}\0${f.bytes.length}\0`).update(f.bytes);
  return `mp-${h.digest('hex').slice(0, 12)}`;
}
/** The engine modules that actually run beside `here` (`.ts` from src, `.js` from dist): every module under `model-program/`, and the rest. */
export function engineFilesBeside(here: string): { readonly path: string; readonly bytes: Uint8Array }[] {
  const ext = extname(fileURLToPath(here)), root = fileURLToPath(new URL('../', here));
  const walk = (rel: string): string[] => readdirSync(join(root, rel), { withFileTypes: true }).flatMap((d) => (d.isDirectory()
    ? (d.name === '__tests__' ? [] : walk(`${rel}/${d.name}`)) : d.name.endsWith(ext) && !d.name.endsWith('.d.ts') ? [`${rel}/${d.name}`] : []));
  return [...walk('model-program'), ...ENGINE_MODULES_OUTSIDE.map((m) => m + ext)].map((path) => ({ path, bytes: readFileSync(join(root, path)) }));
}
/** Computed once at start-up. Unreadable modules give a token no stored Run carries, so every earlier Run reads as not current. */
function engineAtStartUp(): string {
  try {
    const files = engineFilesBeside(import.meta.url);
    if (files.length > ENGINE_MODULES_OUTSIDE.length) return engineToken(files);
  } catch { /* fall through */ }
  return `mp-unhashed-${randomBytes(6).toString('hex')}`;
}

/** The engine a Run was computed with: `engine` is the hash of the engine's own modules, never a hand-bumped literal (R11). */
export const ENGINE_VERSIONS = Object.freeze({
  canonical: CANONICAL_VERSION,
  /** executable.ts interface revision (S1 owns it; r5 at 84fadd52). */
  executable: 'r5',
  engine: engineAtStartUp(),
});
export type EngineVersions = Readonly<Record<keyof typeof ENGINE_VERSIONS, string>>;

export type RunReceipt = {
  readonly revision_digest: string;
  readonly versions: EngineVersions;
  readonly seed: number;
  readonly draws: number | null;
};
export type StoredRun = {
  readonly run_id: string;
  readonly computed_at: string;
  readonly receipt: RunReceipt;
  /** What the Run showed, exactly: the analysis view, the chances, and the compile outcome it rested on. */
  readonly result: { readonly canonical_analysis_view: unknown; readonly chances: unknown; readonly compile: unknown };
};

/** The digest of what an evaluation reads: the canonical model and the person's words. */
export function revisionDigest(canonical: CanonicalModelT, personWords: readonly string[]): string {
  // Absent declarations read as null without changing an old model's digest. A declared bound still changes its identity.
  const quantities = canonical.quantities.map(({ direction, floor, ceiling, ...q }) => ({
    ...q,
    ...(direction === null || direction === undefined ? {} : { direction }),
    ...(floor === null || floor === undefined ? {} : { floor }),
    ...(ceiling === null || ceiling === undefined ? {} : { ceiling }),
  }));
  return createHash('sha256').update(stableStringify({ canonical: { ...canonical, quantities }, person_words: personWords }), 'utf8').digest('hex');
}

export function newRun(args: { canonical: CanonicalModelT; personWords: readonly string[]; seed: number; draws: number | null; result: StoredRun['result'];
  /** How many Runs the scenario already holds: part of the id, so a re-evaluation of the same digest is still a new Run. */
  index: number; versions?: EngineVersions; now?: Date;
  /** The analysis hash of the display graph the Run was computed with (what the scenario read serves as `graph_hash`). */
  graphHash?: string | null }): StoredRun {
  const receipt: RunReceipt = { revision_digest: revisionDigest(args.canonical, args.personWords), versions: { ...(args.versions ?? ENGINE_VERSIONS) }, seed: args.seed, draws: args.draws };
  const run_id = `mp_run_${args.index + 1}_${createHash('sha256').update(stableStringify(receipt), 'utf8').digest('hex').slice(0, 12)}`;
  const computed_at = (args.now ?? new Date()).toISOString();
  const result = JSON.parse(JSON.stringify(args.result)) as StoredRun['result'];
  return { run_id, computed_at, receipt, result: { ...result, canonical_analysis_view: viewOf(result.canonical_analysis_view, { run_id, graph_hash_at_run: args.graphHash ?? receipt.revision_digest.slice(0, 16), computed_at }, true) } };
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
/** CEE's sentence for a Run the model has moved on from (the core view's `face_when_stale`, one authority for both). */
export const RUN_AGAIN_FOR_CHANCE = 'Run the analysis again to see the chance.';
/** For a Run the person's model has NOT moved on from, made stale by an update (the engine, or how the model is read): S4. */
export const RUN_AGAIN_AFTER_UPDATE = 'This result is from before an update. Run again to see the chance.';
/**
 * A Run's view bound to its own record (run id, the analysis hash of its graph, its time) and to whether the saved model is
 * still the one it was computed from, in the core view's freshness words; the result itself is untouched.
 */
function viewOf(view: unknown, run: { readonly run_id: string; readonly graph_hash_at_run: string; readonly computed_at: string }, current: boolean, updated = false): unknown {
  if (!isRec(view) || !isRec(view['staleness'])) return view;
  const { face_when_stale: _face, ...all } = view;
  // W6 review B3: a Run that is not current names no leader (run-facts.ts; DGAI canonicalAnalysisView.ts: "CEE nulls it for
  // a Run that is not current"), on every path that serves a stale view (reopen, card-edit turns, the agent's read).
  const { leader: _leader, ...notCurrent } = all;
  const rest = current ? all : { ...notCurrent, leader_licence: 'withheld' };
  return { ...rest, run, ...(current ? {} : { face_when_stale: updated ? RUN_AGAIN_AFTER_UPDATE : RUN_AGAIN_FOR_CHANCE }),
    staleness: { ...view['staleness'], stale: !current, reason: current ? 'graph_hash_match' : updated ? 'engine_or_format_updated' : 'graph_hash_diverged',
      limitation: 'Hash equality cannot detect brief, framing or stage changes.' } };
}
/**
 * The stored view as a reopen shows it: stale when the saved model is no longer the one the Run was computed from, or the
 * engine is not the one it ran on; `updated` when the person's model has not moved (only the engine, or the model's format).
 */
export function shownView(run: StoredRun, current: boolean, updated = false): unknown {
  const view = run.result.canonical_analysis_view;
  return current || !isRec(view) || !isRec(view['run']) ? view : viewOf(view, view['run'] as { run_id: string; graph_hash_at_run: string; computed_at: string }, false, updated);
}

/** The Run a reopen shows: the newest stored one, with whether it is the saved model's and today's engine's. */
export function shownRun(runs: readonly StoredRun[], canonical: CanonicalModelT, personWords: readonly string[], versions: EngineVersions = ENGINE_VERSIONS,
  /** The model exactly as stored, before it is read (an older format is read once, in its newer form). */
  stored?: unknown): { readonly run: StoredRun; readonly current: boolean; readonly engine_current: boolean; readonly updated: boolean } | undefined {
  const run = runs.at(-1);
  if (run === undefined) return undefined;
  const current = run.receipt.revision_digest === revisionDigest(canonical, personWords);
  const engine_current = stableStringify(run.receipt.versions) === stableStringify(versions);
  // The person's model is the one the Run read when only its format moved (the stored bytes still give the Run's digest).
  const unmoved = current || (stored !== undefined && run.receipt.revision_digest === revisionDigest(stored as CanonicalModelT, personWords));
  return { run, current, engine_current, updated: unmoved && !(current && engine_current) };
}
