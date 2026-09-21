import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  partitionFor,
  computeSplit,
  splitHash,
  ScenarioSet,
  HoldoutIsolationError,
  assertSplitIntegrity,
  scenarioIdsIn,
  openScenarioSet,
  DEFAULT_SPLIT_SEED,
  MIN_HOLDOUT_SCENARIOS,
} from '../scorer/holdout.js';

const REAL_IDS = [
  'frozen-explain-journey',
  'frozen-journey',
  'journey-v2',
  's1-edit-tweak-loop',
  's2-add-factor-multiturn',
  's3-option-question-probe',
  's4-post-draft-framing',
  's5-rapid-reclick',
];

function tmpJourneys(ids: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'holdout-test-'));
  for (const id of ids) writeFileSync(join(dir, `${id}.json`), JSON.stringify({ turns: [] }));
  return dir;
}

describe('holdout split — determinism', () => {
  it('is stable across repeated computation (same seed, same ids)', () => {
    const a = computeSplit(REAL_IDS);
    for (let i = 0; i < 25; i++) {
      const b = computeSplit(REAL_IDS);
      expect(b.holdout).toEqual(a.holdout);
      expect(b.iteration).toEqual(a.iteration);
    }
  });

  it('is insensitive to input ORDER (shuffling the dir listing cannot move a scenario)', () => {
    const a = computeSplit(REAL_IDS);
    const shuffled = [...REAL_IDS].reverse();
    const b = computeSplit(shuffled);
    expect(b.holdout).toEqual(a.holdout);
    expect(b.iteration).toEqual(a.iteration);
  });

  it('partitions every scenario exactly once, with no overlap and no loss', () => {
    const s = computeSplit(REAL_IDS);
    expect([...s.holdout, ...s.iteration].sort()).toEqual([...REAL_IDS].sort());
    expect(s.holdout.filter((id) => s.iteration.includes(id))).toEqual([]);
    expect(s.total).toBe(REAL_IDS.length);
  });

  it('a different seed yields a different split (the seed is load-bearing)', () => {
    const a = computeSplit(REAL_IDS, DEFAULT_SPLIT_SEED);
    const b = computeSplit(REAL_IDS, 'some-other-seed');
    expect(b.holdout).not.toEqual(a.holdout);
  });

  it('splitHash is a pure function reproducible by hand', () => {
    expect(splitHash('abc')).toBe(splitHash('abc'));
    expect(splitHash('abc')).not.toBe(splitHash('abd'));
    expect(splitHash('')).toBeTypeOf('number');
  });
});

describe('holdout split — ANTI-GAMING: assignment cannot be laundered by growing the set', () => {
  it('adding scenarios never moves an EXISTING scenario across the boundary', () => {
    const before = computeSplit(REAL_IDS);
    const grown = computeSplit([...REAL_IDS, 'z9-decoy-a', 'z9-decoy-b', 'z9-decoy-c', 'z9-decoy-d']);
    for (const id of REAL_IDS) {
      const wasHoldout = before.holdout.includes(id);
      const isHoldout = grown.holdout.includes(id);
      expect(isHoldout, `${id} changed partition when decoys were added`).toBe(wasHoldout);
    }
  });

  it('deleting scenarios never moves a surviving scenario across the boundary', () => {
    const before = computeSplit(REAL_IDS);
    const shrunk = computeSplit(REAL_IDS.slice(0, 5));
    for (const id of REAL_IDS.slice(0, 5)) {
      expect(shrunk.holdout.includes(id)).toBe(before.holdout.includes(id));
    }
  });

  it("a scenario's partition depends only on (seed, id) — not on set membership", () => {
    for (const id of REAL_IDS) {
      const solo = computeSplit([id, 'filler-1', 'filler-2']);
      const inSet = computeSplit(REAL_IDS);
      expect(solo.holdout.includes(id)).toBe(inSet.holdout.includes(id));
    }
  });
});

describe('holdout split — integrity refuses degenerate splits', () => {
  it('flags a holdout too small to be a floor', () => {
    // Find an id set whose holdout is under-sized by using ids that all hash to iteration.
    const iterationOnly = REAL_IDS.filter((id) => partitionFor(id) === 'iteration');
    const s = computeSplit(iterationOnly);
    expect(s.holdout.length).toBeLessThan(MIN_HOLDOUT_SCENARIOS);
    expect(s.ok).toBe(false);
    expect(() => assertSplitIntegrity(s)).toThrow(/not usable as a promotion floor/);
  });

  it('flags duplicate ids as ambiguous', () => {
    const s = computeSplit([...REAL_IDS, REAL_IDS[0]]);
    expect(s.problems.join(' ')).toMatch(/duplicate/);
    expect(s.ok).toBe(false);
  });

  it('accepts the real journeys/ set (the shipped split is usable)', () => {
    const s = computeSplit(REAL_IDS);
    expect(s.problems).toEqual([]);
    expect(s.ok).toBe(true);
    expect(() => assertSplitIntegrity(s)).not.toThrow();
  });
});

describe('holdout ISOLATION — iterate mode is incapable of reading a holdout scenario', () => {
  const dir = tmpJourneys(REAL_IDS);
  const split = computeSplit(REAL_IDS);
  const holdoutId = split.holdout[0];
  const iterationId = split.iteration[0];

  it('holdout ids are absent from ids() in iterate mode', () => {
    const set = new ScenarioSet(dir, 'iterate', REAL_IDS);
    expect(set.ids()).toEqual([...split.iteration].sort());
    for (const id of split.holdout) expect(set.ids()).not.toContain(id);
  });

  it('resolve() THROWS HoldoutIsolationError for a holdout id in iterate mode', () => {
    const set = new ScenarioSet(dir, 'iterate', REAL_IDS);
    expect(() => set.resolve(holdoutId)).toThrow(HoldoutIsolationError);
  });

  it('load() THROWS for a holdout id in iterate mode — no bytes reachable', () => {
    const set = new ScenarioSet(dir, 'iterate', REAL_IDS);
    expect(() => set.load(holdoutId)).toThrow(HoldoutIsolationError);
  });

  it('every holdout id is unreachable — not just the first (exhaustive)', () => {
    const set = new ScenarioSet(dir, 'iterate', REAL_IDS);
    for (const id of split.holdout) {
      expect(() => set.load(id), `holdout scenario ${id} was reachable in iterate mode`).toThrow(
        HoldoutIsolationError,
      );
    }
  });

  it('iterate mode CAN read its own partition', () => {
    const set = new ScenarioSet(dir, 'iterate', REAL_IDS);
    expect(() => set.load(iterationId)).not.toThrow();
    expect(set.resolve(iterationId)).toContain(iterationId);
  });

  it('holdout mode is symmetric — it cannot read ITERATION scenarios', () => {
    const set = new ScenarioSet(dir, 'holdout', REAL_IDS);
    expect(set.ids()).toEqual([...split.holdout].sort());
    expect(() => set.load(iterationId)).toThrow(HoldoutIsolationError);
    expect(() => set.load(holdoutId)).not.toThrow();
  });

  it('an unknown id is a typo (plain Error), NOT reported as a contained leak', () => {
    const set = new ScenarioSet(dir, 'iterate', REAL_IDS);
    expect(() => set.resolve('no-such-scenario')).toThrow(/unknown scenario/);
    expect(() => set.resolve('no-such-scenario')).not.toThrow(HoldoutIsolationError);
  });

  it('the mode and allowed-set are immutable — no post-construction override', () => {
    const set = new ScenarioSet(dir, 'iterate', REAL_IDS);
    expect(Object.isFrozen(set)).toBe(true);
    try {
      (set as unknown as { mode: string }).mode = 'full';
    } catch {
      /* strict mode throws; sloppy mode silently ignores — both acceptable */
    }
    expect(set.mode).toBe('iterate');
    expect(() => set.load(holdoutId)).toThrow(HoldoutIsolationError);
  });

  it('full mode reads both partitions (diagnostics only)', () => {
    const set = new ScenarioSet(dir, 'full', REAL_IDS);
    expect(set.ids().sort()).toEqual([...REAL_IDS].sort());
  });

  it('scenarioIdsIn / openScenarioSet read the dir and honour the mode', () => {
    expect(scenarioIdsIn(dir)).toEqual([...REAL_IDS].sort());
    const set = openScenarioSet('iterate', dir);
    expect(set.ids()).toEqual([...split.iteration].sort());
    rmSync(dir, { recursive: true, force: true });
  });
});
