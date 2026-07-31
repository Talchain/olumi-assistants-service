/**
 * PROMOTION-GATE SHRINK GUARD (review amendment A3).
 *
 * The gate's derived discovery protects the ADD direction only. These tests pin
 * the two silent escapes the adversarial review proved against the unamended
 * gate — both reproduced verbatim first, both exit 0 at the time:
 *
 *   SHRINK — delete a task's promotion-pack.ts marker (or its manifest row) and
 *            a GATED-PASS becomes UNGATED / vanishes, with CI green.
 *   WIDEN  — hand-add a promotion-gate-baseline.json entry and a real BLOCK
 *            becomes a tolerated GRANDFATHERED row, with CI green.
 *
 * The git layer is exercised against a REAL, hermetic, two-commit temp repo, so
 * nothing here depends on this repo's history (or on a shallow CI checkout).
 */

import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  baselineKey,
  checkGatedSetShrink,
  extractPackTaskFromMarkerSource,
  loadAcknowledgments,
  readGateSetSnapshotAtRef,
  BASELINE_REPO_PATH,
  MANIFEST_REPO_PATH,
  DEFAULT_ACKNOWLEDGMENTS_PATH,
  type Acknowledgment,
  type GateSetSnapshot,
} from '../src/promotion-gate/shrink-guard.js';
import { discoverPacks } from '../src/promotion-gate/packs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

const snap = (over: Partial<GateSetSnapshot> = {}): GateSetSnapshot => ({
  present: true,
  gatedTasks: ['decision_review'],
  baselineEntries: [baselineKey('decision_review', 'b4f15305c2bb32e9')],
  ...over,
});

const ack = (over: Partial<Acknowledgment> = {}): Acknowledgment => ({
  kind: 'gated_set_removal',
  task: 'decision_review',
  reason: 'test',
  acknowledgedAt: '2026-07-31',
  ...over,
});

// ============================================================================
// Direction 1 — the gated set may not SHRINK silently
// ============================================================================

describe('SHRINK: a task dropping out of the gated set is fatal unless acknowledged', () => {
  it('BLOCKS an unacknowledged removal (the marker-deletion / manifest-row-deletion escape)', () => {
    const r = checkGatedSetShrink(snap(), snap({ gatedTasks: [] }), []);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/GATED-SET SHRINK/);
    expect(r.errors.join(' ')).toMatch(/decision_review/);
  });

  it('ALLOWS the same removal once it is explicitly acknowledged in-diff', () => {
    const r = checkGatedSetShrink(snap(), snap({ gatedTasks: [] }), [
      ack({ reason: 'pack retired, prompt no longer served' }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.notes.join(' ')).toMatch(/ACKNOWLEDGED removal/);
  });

  it('an acknowledgment for a DIFFERENT task does not cover this removal', () => {
    const r = checkGatedSetShrink(snap(), snap({ gatedTasks: [] }), [ack({ task: 'edit_graph' })]);
    expect(r.ok).toBe(false);
  });

  it('a baseline_addition acknowledgment does NOT license a gated-set removal (kinds are not interchangeable)', () => {
    const r = checkGatedSetShrink(snap(), snap({ gatedTasks: [] }), [
      ack({ kind: 'baseline_addition', promotedHash: 'b4f15305c2bb32e9' }),
    ]);
    expect(r.ok).toBe(false);
  });
});

// ============================================================================
// Direction 2 — the grandfather baseline may not WIDEN silently
// ============================================================================

describe('WIDEN: a new grandfather entry is fatal unless acknowledged', () => {
  const widened = snap({
    baselineEntries: [
      baselineKey('decision_review', 'b4f15305c2bb32e9'),
      baselineKey('edit_graph', '40b79180ad739011'),
    ],
  });

  it('BLOCKS a hand-added baseline entry (the review\'s exact widen attack)', () => {
    const r = checkGatedSetShrink(snap(), widened, []);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/GRANDFATHER WIDEN/);
    expect(r.errors.join(' ')).toMatch(/edit_graph@40b79180ad739011/);
  });

  it('ALLOWS it once acknowledged for that exact task AND hash', () => {
    const r = checkGatedSetShrink(snap(), widened, [
      ack({ kind: 'baseline_addition', task: 'edit_graph', promotedHash: '40b79180ad739011' }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.notes.join(' ')).toMatch(/ACKNOWLEDGED grandfather addition/);
  });

  it('an acknowledgment pinned to a DIFFERENT hash does not cover it (a moved hash is new drift)', () => {
    const r = checkGatedSetShrink(snap(), widened, [
      ack({ kind: 'baseline_addition', task: 'edit_graph', promotedHash: '0000000000000000' }),
    ]);
    expect(r.ok).toBe(false);
  });
});

// ============================================================================
// Not an always-block, and the fail-open is exactly one case
// ============================================================================

describe('the guard is not an always-block', () => {
  it('PASSES an unchanged set', () => {
    expect(checkGatedSetShrink(snap(), snap(), []).ok).toBe(true);
  });

  it('PASSES (and reports) the TIGHTENING directions: a newly gated task, a removed baseline entry', () => {
    const tighter = snap({ gatedTasks: ['decision_review', 'edit_graph'], baselineEntries: [] });
    const r = checkGatedSetShrink(snap(), tighter, []);
    expect(r.ok).toBe(true);
    expect(r.notes.join(' ')).toMatch(/TIGHTENED: "edit_graph" is newly gated/);
    expect(r.notes.join(' ')).toMatch(/TIGHTENED: grandfather entry decision_review@b4f15305c2bb32e9 removed/);
  });

  it('FAIL-OPEN exactly once, LOUDLY: no gate at the merge-base ⇒ pass with a note saying so', () => {
    const r = checkGatedSetShrink({ present: false, gatedTasks: [], baselineEntries: [] }, snap(), []);
    expect(r.ok).toBe(true);
    expect(r.notes.join(' ')).toMatch(/FAIL-OPEN \(once, deliberately\)/);
  });

  it('reports a STALE acknowledgment as a visible note, not a red (trap 7)', () => {
    const r = checkGatedSetShrink(snap(), snap(), [ack({ task: 'ghost' })]);
    expect(r.ok).toBe(true);
    expect(r.notes.join(' ')).toMatch(/STALE ACKNOWLEDGMENT/);
  });
});

// ============================================================================
// The git layer, against a REAL hermetic two-commit repo
// ============================================================================

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shrink-guard-repo-'));
  tmpDirs.push(dir);
  const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'test');
  return dir;
}

function commitAll(dir: string, message: string): string {
  const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8' });
  g('add', '-A');
  g('commit', '-q', '-m', message);
  return g('rev-parse', 'HEAD').trim();
}

function writeGateState(dir: string, opts: { tasks: string[]; baseline: [string, string][] }): void {
  mkdirSync(join(dir, 'Prompts', 'canonical'), { recursive: true });
  writeFileSync(
    join(dir, MANIFEST_REPO_PATH),
    JSON.stringify({ pms_prompts: opts.tasks.map((t) => ({ key: t })) }, null, 2),
  );
  mkdirSync(join(dir, 'tools', 'orchestrator-eval', 'src'), { recursive: true });
  for (const t of opts.tasks) {
    const packDir = join(dir, 'tools', 'orchestrator-eval', 'src', t);
    mkdirSync(packDir, { recursive: true });
    writeFileSync(
      join(packDir, 'promotion-pack.ts'),
      `export const PROMOTION_PACK = {\n  task: '${t}',\n  canonicalPromptPath: 'x',\n  packDir: 'y',\n};\n`,
    );
  }
  writeFileSync(
    join(dir, BASELINE_REPO_PATH),
    JSON.stringify(
      { entries: opts.baseline.map(([task, promotedHash]) => ({ task, promotedHash, reason: 'r', recordedAt: 'd' })) },
      null,
      2,
    ),
  );
}

describe('the git layer derives both sides from real commits (never a hand-pinned list)', () => {
  it('reads the gated set + baseline entries out of the object store at a ref', () => {
    const dir = tmpRepo();
    writeGateState(dir, { tasks: ['decision_review', 'edit_graph'], baseline: [['decision_review', 'aaaa']] });
    const c1 = commitAll(dir, 'gate exists');
    const s = readGateSetSnapshotAtRef(c1, dir);
    expect(s.present).toBe(true);
    expect(s.gatedTasks).toEqual(['decision_review', 'edit_graph']);
    expect(s.baselineEntries).toEqual(['decision_review@aaaa']);
  });

  it('SEES a marker deletion between two commits (the escape, caught end-to-end)', () => {
    const dir = tmpRepo();
    writeGateState(dir, { tasks: ['decision_review', 'edit_graph'], baseline: [] });
    const before = commitAll(dir, 'two gated tasks');
    rmSync(join(dir, 'tools', 'orchestrator-eval', 'src', 'edit_graph', 'promotion-pack.ts'));
    const after = commitAll(dir, 'marker deleted');

    const r = checkGatedSetShrink(readGateSetSnapshotAtRef(before, dir), readGateSetSnapshotAtRef(after, dir), []);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/GATED-SET SHRINK: "edit_graph"/);
  });

  it('SEES a manifest-row deletion between two commits (the other half of the same escape)', () => {
    const dir = tmpRepo();
    writeGateState(dir, { tasks: ['decision_review', 'edit_graph'], baseline: [] });
    const before = commitAll(dir, 'two gated tasks');
    writeFileSync(
      join(dir, MANIFEST_REPO_PATH),
      JSON.stringify({ pms_prompts: [{ key: 'decision_review' }] }, null, 2),
    );
    const after = commitAll(dir, 'manifest row deleted');

    const r = checkGatedSetShrink(readGateSetSnapshotAtRef(before, dir), readGateSetSnapshotAtRef(after, dir), []);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/GATED-SET SHRINK: "edit_graph"/);
  });

  it('SEES a hand-added grandfather entry between two commits', () => {
    const dir = tmpRepo();
    writeGateState(dir, { tasks: ['decision_review'], baseline: [] });
    const before = commitAll(dir, 'no grandfathers');
    writeGateState(dir, { tasks: ['decision_review'], baseline: [['decision_review', 'b4f15305c2bb32e9']] });
    const after = commitAll(dir, 'grandfather added by hand');

    const r = checkGatedSetShrink(readGateSetSnapshotAtRef(before, dir), readGateSetSnapshotAtRef(after, dir), []);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/GRANDFATHER WIDEN: baseline entry decision_review@b4f15305c2bb32e9/);
  });

  it('reports `present: false` at a commit where the gate does not exist (the first-landing case)', () => {
    const dir = tmpRepo();
    writeFileSync(join(dir, 'README.md'), 'no gate here\n');
    const c = commitAll(dir, 'pre-gate');
    expect(readGateSetSnapshotAtRef(c, dir).present).toBe(false);
  });
});

// ============================================================================
// POSITIVE CONTROL for the historical-side extractor (trap 13)
//
// The merge-base side cannot import a marker module, so it regex-extracts the
// task from the marker SOURCE. An extractor that silently saw nothing would
// make every comparison vacuous — a false "nothing was removed". So it is
// pinned against the LIVE loader on the real, committed markers.
// ============================================================================

describe('the historical extractor can SEE a presence before it is trusted to see an absence', () => {
  it('extracts exactly what discoverPacks() finds, from the real committed markers', async () => {
    const packs = await discoverPacks();
    expect(packs.length).toBeGreaterThan(0); // the gate itself fails loud on zero; belt and braces
    const extracted = packs
      .map((p) => {
        const marker = join(p.packDir, 'promotion-pack.ts');
        expect(existsSync(marker)).toBe(true);
        return extractPackTaskFromMarkerSource(readFileSync(marker, 'utf-8'), marker);
      })
      .sort();
    expect(extracted).toEqual(packs.map((p) => p.task).sort());
  });

  it('THROWS on a marker whose shape it cannot read (never treats it as an absent pack)', () => {
    expect(() => extractPackTaskFromMarkerSource('export const PROMOTION_PACK = { nope: true };', 'x')).toThrow(
      /cannot read the pack task/,
    );
  });
});

// ============================================================================
// The acknowledgment ledger loader
// ============================================================================

describe('acknowledgment ledger', () => {
  it('loads the committed ledger without error, and it is EMPTY (nothing is pre-authorised)', () => {
    const acks = loadAcknowledgments();
    expect(acks).toEqual([]);
    expect(existsSync(DEFAULT_ACKNOWLEDGMENTS_PATH)).toBe(true);
  });

  it('an ABSENT ledger yields zero acknowledgments (so every removal stays fatal)', () => {
    expect(loadAcknowledgments(join(HERE, 'no-such-ledger.json'))).toEqual([]);
  });

  it('THROWS on a malformed ledger rather than silently reading it as empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shrink-guard-ack-'));
    tmpDirs.push(dir);
    const noArray = join(dir, 'a.json');
    writeFileSync(noArray, JSON.stringify({ something_else: [] }));
    expect(() => loadAcknowledgments(noArray)).toThrow(/no "acknowledgments" array/);

    const badKind = join(dir, 'b.json');
    writeFileSync(badKind, JSON.stringify({ acknowledgments: [{ kind: 'whatever', task: 't', reason: 'r', acknowledgedAt: 'd' }] }));
    expect(() => loadAcknowledgments(badKind)).toThrow(/malformed/);

    const noHash = join(dir, 'c.json');
    writeFileSync(
      noHash,
      JSON.stringify({ acknowledgments: [{ kind: 'baseline_addition', task: 't', reason: 'r', acknowledgedAt: 'd' }] }),
    );
    expect(() => loadAcknowledgments(noHash)).toThrow(/malformed/);
  });
});
