/**
 * SPIKE S3: THE DURABLE RUN RECEIPT (the PL's correction 3, DL "lean" brief). A Run is stored WITH the saved model program,
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
import { createHash } from 'node:crypto';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { CANONICAL_VERSION, type CanonicalModelT } from '../model-program/canonical.js';

/** The engine a Run was computed with. Bumped by hand when a change could move a stored result. */
export const ENGINE_VERSIONS = Object.freeze({
  canonical: CANONICAL_VERSION,
  /** executable.ts interface revision (S1 owns it; r5 at 84fadd52). */
  executable: 'r5',
  /** compile.ts + simulate.ts + range-law.ts + present.ts as merged on wip/spike-s3-integrate (S1 84fadd52, S2 47cc9ce3). */
  engine: 'mp-spike-2026-10-23.1',
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
  return createHash('sha256').update(stableStringify({ canonical, person_words: personWords }), 'utf8').digest('hex');
}

export function newRun(args: { canonical: CanonicalModelT; personWords: readonly string[]; seed: number; draws: number | null; result: StoredRun['result'];
  /** How many Runs the scenario already holds: part of the id, so a re-evaluation of the same digest is still a new Run. */
  index: number; versions?: EngineVersions; now?: Date }): StoredRun {
  const receipt: RunReceipt = { revision_digest: revisionDigest(args.canonical, args.personWords), versions: { ...(args.versions ?? ENGINE_VERSIONS) }, seed: args.seed, draws: args.draws };
  const run_id = `mp_run_${args.index + 1}_${createHash('sha256').update(stableStringify(receipt), 'utf8').digest('hex').slice(0, 12)}`;
  return { run_id, computed_at: (args.now ?? new Date()).toISOString(), receipt, result: JSON.parse(JSON.stringify(args.result)) as StoredRun['result'] };
}

/** The Run a reopen shows: the newest stored one, with whether it is the saved model's and today's engine's. */
export function shownRun(runs: readonly StoredRun[], canonical: CanonicalModelT, personWords: readonly string[], versions: EngineVersions = ENGINE_VERSIONS):
  { readonly run: StoredRun; readonly current: boolean; readonly engine_current: boolean } | undefined {
  const run = runs.at(-1);
  if (run === undefined) return undefined;
  return { run, current: run.receipt.revision_digest === revisionDigest(canonical, personWords),
    engine_current: stableStringify(run.receipt.versions) === stableStringify(versions) };
}
