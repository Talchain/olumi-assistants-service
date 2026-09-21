/**
 * Deterministic seeded holdout split (conversation-harness — Wave1-L3).
 *
 * WHY THIS EXISTS
 * ---------------
 * A coach prompt is tuned by looking at scenario transcripts and editing the
 * prompt until they look good. That loop overfits: the prompt learns the
 * scenarios, not the job. So the scenario set is split in two:
 *
 *   ITERATION partition — free to read, score, stare at, tune against.
 *   HOLDOUT   partition — read ONLY by the promotion verdict, at the moment a
 *                         candidate is proposed for shipping.
 *
 * DOCTRINE — the holdout is a pass/fail FLOOR, never a ranking.
 * -----------------------------------------------------------
 * The holdout answers exactly one question: "is this candidate good enough to
 * ship?" — a per-dimension floor check, pass or fail. It does NOT answer "which
 * candidate is best". The moment you rank candidates on the holdout you have
 * begun tuning against it (pick the best of K on the holdout ⇒ the holdout is
 * now training data, and its floor no longer generalises). This is why
 * `promotion-verdict.ts` emits pass/fail per dimension and never a score
 * ordering, and why it takes exactly ONE candidate.
 *
 * Corollary: a FAILED promotion is not a signal to iterate against. Read the
 * failing dimension NAME, go back to the iteration partition, fix the class of
 * problem there. Do not open the holdout transcripts.
 *
 * STRUCTURAL EXCLUSION (enforced in code, not convention)
 * ------------------------------------------------------
 * `openScenarioSet('iterate')` returns a ScenarioSet whose holdout members do
 * not exist: they are absent from `ids()`, and `resolve(id)`/`load(id)` THROW
 * for a holdout id rather than returning a path. An iterate-mode run has no
 * function available to it that yields a holdout scenario's path or bytes, so
 * it cannot read one by accident, by loop, or by a helpful refactor. The mode
 * is fixed at construction and the allowed-id set is frozen — there is no
 * setter, no override flag, and no env escape hatch.
 *
 * ASSIGNMENT STABILITY (why hash-bucket, not seeded-shuffle-and-take-N)
 * --------------------------------------------------------------------
 * A scenario's partition is a pure function of (seed, scenarioId) ALONE — it
 * does not depend on which other scenarios exist. Adding, renaming or deleting
 * a scenario cannot move a DIFFERENT scenario across the boundary.
 *
 * That property is the anti-gaming one. Under seeded-shuffle-then-take-N, the
 * partition of every scenario depends on the whole set, so anyone who overfits
 * the prompt to a scenario and then finds it landed in the holdout can add a
 * throwaway scenario, reshuffle, and walk it back into the iteration partition
 * — laundering a contaminated scenario into a "clean" floor. Hash-bucketing
 * makes that impossible: the only way to move scenario X is to rename X (which
 * is visible in the diff and is exactly the review signal we want) or to change
 * the seed (which `assertSplitIntegrity` surfaces, and which invalidates every
 * prior verdict).
 *
 * The price is that the holdout's SIZE is only approximate — it is a binomial
 * draw around HOLDOUT_FRACTION, not an exact N. That is a fine price, and
 * `assertSplitIntegrity` refuses a split that came out too small to be a
 * meaningful floor rather than letting a 1-scenario holdout quietly pass a
 * candidate.
 *
 * PURE — no src/ imports. fs only via `load()`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type Partition = 'iteration' | 'holdout';

/**
 * Harness run modes.
 *   'iterate'  — tuning. Holdout is structurally unreachable.
 *   'holdout'  — promotion verdict only. Iteration scenarios are unreachable,
 *                so a promotion run cannot pad its floor with scenarios the
 *                prompt was tuned on (the symmetric leak, and the easy one to
 *                forget).
 *   'full'     — diagnostics / this file's own tests. NEVER valid as the mode
 *                of a promotion verdict; promotion-verdict.ts rejects it.
 */
export type HarnessMode = 'iterate' | 'holdout' | 'full';

/** Default split seed. Changing this re-partitions everything and invalidates
 * every previously-recorded promotion verdict — treat it as a breaking change
 * to the evidence base, not a tuning knob. */
export const DEFAULT_SPLIT_SEED = 'olumi-coach-holdout-v1';

/** Target share of scenarios in the holdout. Approximate by construction — see
 * ASSIGNMENT STABILITY above. */
export const HOLDOUT_FRACTION = 0.375;

/** A holdout smaller than this is not a floor, it is an anecdote. */
export const MIN_HOLDOUT_SCENARIOS = 2;
/** An iteration partition smaller than this leaves nowhere to actually tune. */
export const MIN_ITERATION_SCENARIOS = 2;

/** FNV-1a (32-bit), then a xorshift finalizer so adjacent scenario ids (s1…,
 * s2…) — which differ in one low byte and would otherwise land in adjacent
 * buckets — scatter independently. Chosen over a crypto hash purely so the
 * assignment is reproducible from this file alone, by hand, in any language,
 * with no dependency: a reviewer must be able to check the split themselves. */
export function splitHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** The partition of ONE scenario — a pure function of (seed, id) only.
 * Deliberately exported: a reviewer can check any single assignment without
 * building a ScenarioSet or touching the filesystem. */
export function partitionFor(scenarioId: string, seed: string = DEFAULT_SPLIT_SEED): Partition {
  const bucket = splitHash(`${seed}:${scenarioId}`) / 0x100000000;
  return bucket < HOLDOUT_FRACTION ? 'holdout' : 'iteration';
}

export interface SplitIntegrity {
  ok: boolean;
  seed: string;
  total: number;
  iteration: string[];
  holdout: string[];
  problems: string[];
}

/** Compute the split over an explicit id list. Order-insensitive by
 * construction; ids are sorted in the output so the artifact is stable. */
export function computeSplit(scenarioIds: readonly string[], seed: string = DEFAULT_SPLIT_SEED): SplitIntegrity {
  const ids = [...new Set(scenarioIds)].sort();
  const iteration: string[] = [];
  const holdout: string[] = [];
  for (const id of ids) (partitionFor(id, seed) === 'holdout' ? holdout : iteration).push(id);
  const problems: string[] = [];
  if (holdout.length < MIN_HOLDOUT_SCENARIOS) {
    problems.push(
      `holdout has ${holdout.length} scenario(s), need >= ${MIN_HOLDOUT_SCENARIOS} — too small to be a floor`,
    );
  }
  if (iteration.length < MIN_ITERATION_SCENARIOS) {
    problems.push(`iteration has ${iteration.length} scenario(s), need >= ${MIN_ITERATION_SCENARIOS}`);
  }
  if (scenarioIds.length !== ids.length) {
    problems.push('duplicate scenario ids supplied — the split is ambiguous');
  }
  return { ok: problems.length === 0, seed, total: ids.length, iteration, holdout, problems };
}

/** Thrown when code in one mode reaches for a scenario belonging to the other
 * partition. Distinct type so a test can assert the ISOLATION failure
 * specifically, rather than matching on a message and passing on an unrelated
 * throw (e.g. ENOENT) that happens to look like a block. */
export class HoldoutIsolationError extends Error {
  readonly scenarioId: string;
  readonly mode: HarnessMode;
  constructor(scenarioId: string, mode: HarnessMode, partition: Partition) {
    super(
      `scenario "${scenarioId}" is in the ${partition} partition and is not readable in "${mode}" mode. ` +
        (partition === 'holdout'
          ? 'The holdout is a promotion floor, not a tuning surface — go fix the problem class on the iteration partition.'
          : 'A promotion verdict must run on the holdout only — iteration scenarios were tuned against and cannot floor-gate.'),
    );
    this.name = 'HoldoutIsolationError';
    this.scenarioId = scenarioId;
    this.mode = mode;
  }
}

/** Which partition a mode may read. 'full' reads both and is never promotable. */
function readablePartitions(mode: HarnessMode): Partition[] {
  if (mode === 'iterate') return ['iteration'];
  if (mode === 'holdout') return ['holdout'];
  return ['iteration', 'holdout'];
}

/**
 * The ONLY sanctioned way to reach scenario files. Holds its mode immutably.
 * Members outside the mode's readable partitions are not merely filtered from
 * `ids()` — `resolve`/`load` throw HoldoutIsolationError for them, so an
 * id obtained from anywhere else (a hardcoded string, a stale list, a log)
 * still cannot be turned into bytes.
 */
export class ScenarioSet {
  readonly mode: HarnessMode;
  readonly seed: string;
  readonly split: SplitIntegrity;
  private readonly dir: string;
  private readonly allowed: ReadonlySet<string>;
  private readonly known: ReadonlySet<string>;

  constructor(dir: string, mode: HarnessMode, allIds: readonly string[], seed: string = DEFAULT_SPLIT_SEED) {
    this.dir = dir;
    this.mode = mode;
    this.seed = seed;
    this.split = computeSplit(allIds, seed);
    const readable = new Set(readablePartitions(mode));
    this.allowed = Object.freeze(
      new Set([...this.split.iteration, ...this.split.holdout].filter((id) => readable.has(partitionFor(id, seed)))),
    );
    this.known = Object.freeze(new Set([...this.split.iteration, ...this.split.holdout]));
    Object.freeze(this);
  }

  /** Scenario ids this mode may read. Holdout ids are absent in 'iterate'. */
  ids(): string[] {
    return [...this.allowed].sort();
  }

  /** Absolute path, or throw. Unknown ids throw a plain Error (a typo), known
   * out-of-partition ids throw HoldoutIsolationError (a leak). Keeping those
   * distinct matters: a typo must not be silently reported as a contained leak. */
  resolve(id: string): string {
    if (!this.known.has(id)) throw new Error(`unknown scenario "${id}" (not in ${this.dir})`);
    if (!this.allowed.has(id)) throw new HoldoutIsolationError(id, this.mode, partitionFor(id, this.seed));
    return join(this.dir, `${id}.json`);
  }

  load(id: string): unknown {
    return JSON.parse(readFileSync(this.resolve(id), 'utf-8'));
  }
}

/** Scenario ids in a journeys dir: the .json basenames, sorted. */
export function scenarioIdsIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

/** Open the journeys dir in a mode. The entrypoint every caller must use. */
export function openScenarioSet(
  mode: HarnessMode,
  dir: string = join(import.meta.dirname ?? __dirname, '..', 'journeys'),
  seed: string = DEFAULT_SPLIT_SEED,
): ScenarioSet {
  return new ScenarioSet(dir, mode, scenarioIdsIn(dir), seed);
}

/** Throw unless the split is usable as a floor. Called by the promotion
 * verdict BEFORE scoring: a degenerate split must fail loudly, never pass a
 * candidate on a 1-scenario "holdout". */
export function assertSplitIntegrity(split: SplitIntegrity): void {
  if (!split.ok) {
    throw new Error(`holdout split is not usable as a promotion floor: ${split.problems.join('; ')}`);
  }
}
