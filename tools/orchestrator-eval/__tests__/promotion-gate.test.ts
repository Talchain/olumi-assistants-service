/**
 * PROMOTION GATE — the gate must be able to BLOCK, and must tell "passed" from
 * "never ran" (brief §2, the review's priority: vacuity is the enemy).
 *
 * The three PLANTED CONTROLS each show a distinct way a report can be absent yet
 * a naive gate would pass — no report, an expired report, a report for a DIFFERENT
 * hash — and prove the gate BLOCKS each. The ALLOW path proves the gate is not
 * an always-block, and the RED-first swap proves the refused case passes once a
 * genuine passing report replaces the failing one.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { computePromotionGate, passesFloor, type GateOptions } from '../src/promotion-gate/gate.js';
import { applyGrandfather } from '../src/promotion-gate/grandfather.js';
import { loadManifestPrompts, promptHash16 } from '../src/promotion-gate/manifest.js';
import { discoverPacks } from '../src/promotion-gate/packs.js';
import { loadPromotionReports, parsePromotionReport } from '../src/promotion-gate/reports.js';
import type {
  GrandfatherEntry,
  ManifestPromptEntry,
  PackDescriptor,
  PromotionReport,
} from '../src/promotion-gate/types.js';

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

const OPTS: GateOptions = { now: new Date('2026-07-31T00:00:00Z'), maxReportAgeDays: 90 };

/** A temp canonical prompt file OUTSIDE the repo, with its manifest hash. */
function tmpPrompt(text = 'BANNED in every output string, no exceptions:\n- "x"\n- Internal vocabulary: foo\nTranslate: "y"\n</TERMINOLOGY>'): {
  path: string;
  hash: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'promo-gate-'));
  tmpDirs.push(dir);
  const path = join(dir, 'prompt.txt');
  writeFileSync(path, text);
  return { path, hash: promptHash16(text) };
}

/** A gated scenario: manifest entry + pack whose canonical export hashes to the
 * manifest's served hash (skew guard satisfied). */
function scenario(task = 'decision_review'): {
  task: string;
  hash: string;
  entry: ManifestPromptEntry;
  pack: PackDescriptor;
} {
  const { path, hash } = tmpPrompt();
  const entry: ManifestPromptEntry = {
    task,
    servedVersion: 14,
    servedHash: hash,
    canonicalFile: path,
    servedHashVerified: true,
  };
  const pack: PackDescriptor = { task, canonicalPromptPath: path, packDir: dirname(path) };
  return { task, hash, entry, pack };
}

function report(task: string, promptSha16: string, over: Partial<PromotionReport> = {}): PromotionReport {
  return {
    schemaVersion: 1,
    task,
    promptSha16,
    generatedAt: '2026-07-30T00:00:00.000Z',
    verdict: 'PASS',
    sampleSize: 3,
    dims: [
      { name: 'safety', status: 'pass', required: true },
      { name: 'shape', status: 'pass', required: true },
    ],
    ...over,
  };
}

// ============================================================================
// The three planted vacuity controls — each shown RED (BLOCK)
// ============================================================================

describe('vacuity controls — the gate BLOCKS when a report is absent, stale, or for the wrong hash', () => {
  it('CONTROL 1 — NO REPORT: a gated prompt with zero committed reports is BLOCKED', () => {
    const s = scenario();
    const g = computePromotionGate([s.entry], [s.pack], [], OPTS);
    expect(g.rows[0].decision).toBe('BLOCK');
    expect(g.rows[0].blockKind).toBe('NO_REPORT');
  });

  it('CONTROL 2 — EXPIRED: a hash-matched PASSING report older than the window is BLOCKED', () => {
    const s = scenario();
    const stale = report(s.task, s.hash, { generatedAt: '2026-01-01T00:00:00.000Z' }); // ~200d before OPTS.now
    const g = computePromotionGate([s.entry], [s.pack], [stale], OPTS);
    expect(g.rows[0].decision).toBe('BLOCK');
    expect(g.rows[0].blockKind).toBe('EXPIRED');
  });

  it('CONTROL 3 — WRONG HASH: a passing report for a DIFFERENT hash does NOT satisfy the promoted hash', () => {
    const s = scenario();
    const wrongHash = report(s.task, 'deadbeefdeadbeef'); // valid, passing — but a stale VERSION
    const g = computePromotionGate([s.entry], [s.pack], [wrongHash], OPTS);
    expect(g.rows[0].decision).toBe('BLOCK');
    expect(g.rows[0].blockKind).toBe('HASH_MISMATCH');
  });
});

// ============================================================================
// The gate is not an always-block: it CAN pass, and the refused case passes
// once the report is swapped (brief §2 RED-first).
// ============================================================================

describe('the gate can PASS — and only on a real, hash-matched, in-date, floor-clearing report', () => {
  it('ALLOWS a hash-matched, in-date report that clears the floor', () => {
    const s = scenario();
    const g = computePromotionGate([s.entry], [s.pack], [report(s.task, s.hash)], OPTS);
    expect(g.rows[0].decision).toBe('GATED_PASS');
    expect(g.rows[0].matchedReportSha16).toBe(s.hash);
  });

  it('REFUSES a failing-report promotion, then ALLOWS it once the report is swapped for a passing one', () => {
    const s = scenario();
    const failing = report(s.task, s.hash, {
      verdict: 'PASS', // the report CLAIMS pass...
      dims: [{ name: 'safety', status: 'fail', required: true }], // ...but a required dim failed
    });
    const blocked = computePromotionGate([s.entry], [s.pack], [failing], OPTS);
    expect(blocked.rows[0].decision).toBe('BLOCK');
    expect(blocked.rows[0].blockKind).toBe('EVAL_FAILED');

    const passing = report(s.task, s.hash); // clean
    const allowed = computePromotionGate([s.entry], [s.pack], [passing], OPTS);
    expect(allowed.rows[0].decision).toBe('GATED_PASS');
  });

  it('every decision AND every block-kind is reachable — "passed" and "never ran" are distinguishable', () => {
    const kinds = new Set<string>();
    const s = scenario();
    kinds.add(computePromotionGate([s.entry], [s.pack], [report(s.task, s.hash)], OPTS).rows[0].decision); // GATED_PASS
    kinds.add(computePromotionGate([s.entry], [s.pack], [], OPTS).rows[0].blockKind!); // NO_REPORT
    kinds.add(computePromotionGate([s.entry], [s.pack], [report(s.task, 'ffffffffffffffff')], OPTS).rows[0].blockKind!); // HASH_MISMATCH
    kinds.add(
      computePromotionGate([s.entry], [s.pack], [report(s.task, s.hash, { generatedAt: '2020-01-01T00:00:00Z' })], OPTS).rows[0].blockKind!,
    ); // EXPIRED
    expect(kinds).toEqual(new Set(['GATED_PASS', 'NO_REPORT', 'HASH_MISMATCH', 'EXPIRED']));
  });
});

// ============================================================================
// The fail-closed FLOOR — re-derived from dims, never trusted from `verdict`
// ============================================================================

describe('fail-closed floor', () => {
  it('BLOCKS a report that claims PASS but carries a failing required dim', () => {
    const r = report('t', 'h', { verdict: 'PASS', dims: [{ name: 'x', status: 'fail', required: true }] });
    expect(passesFloor(r).ok).toBe(false);
  });

  it('BLOCKS a report with a required dim not_applicable (NA-on-required = BLOCK)', () => {
    const r = report('t', 'h', { verdict: 'PASS', dims: [{ name: 'x', status: 'not_applicable', required: true }] });
    expect(passesFloor(r).ok).toBe(false);
  });

  it('BLOCKS a report with ZERO dims (measured nothing)', () => {
    expect(passesFloor(report('t', 'h', { dims: [] })).ok).toBe(false);
  });

  it('BLOCKS a report whose only dims are all not_applicable (examined nothing)', () => {
    const r = report('t', 'h', {
      dims: [
        { name: 'a', status: 'not_applicable', required: false },
        { name: 'b', status: 'not_applicable', required: false },
      ],
    });
    expect(passesFloor(r).ok).toBe(false);
  });

  it('BLOCKS a report whose dims are clean but verdict is BLOCK (consistency)', () => {
    const r = report('t', 'h', { verdict: 'BLOCK' });
    expect(passesFloor(r).ok).toBe(false);
  });

  it('PASSES a report with a clean required dim and a conditional NA', () => {
    const r = report('t', 'h', {
      verdict: 'PASS',
      dims: [
        { name: 'safety', status: 'pass', required: true },
        { name: 'conditional', status: 'not_applicable', required: false },
      ],
    });
    expect(passesFloor(r).ok).toBe(true);
  });
});

// ============================================================================
// Skew guard + ungated marking
// ============================================================================

describe('skew guard and ungated marking', () => {
  it('BLOCKS when the canonical export hash disagrees with the manifest served hash', () => {
    const s = scenario();
    const skewed: ManifestPromptEntry = { ...s.entry, servedHash: 'aaaaaaaaaaaaaaaa' };
    const g = computePromotionGate([skewed], [s.pack], [report(s.task, s.hash)], OPTS);
    expect(g.rows[0].decision).toBe('BLOCK');
    expect(g.rows[0].blockKind).toBe('MANIFEST_EXPORT_SKEW');
  });

  it('marks a task with NO pack as UNGATED (visible, not silent) and does not block it', () => {
    const s = scenario('edit_graph');
    const g = computePromotionGate([s.entry], [], [], OPTS); // no packs
    expect(g.rows[0].decision).toBe('UNGATED');
    expect(g.blocked).toHaveLength(0);
    expect(g.ungated).toEqual(['edit_graph']);
  });
});

// ============================================================================
// Pack discovery — DERIVE, don't mirror; fail-loud on zero
// ============================================================================

describe('pack discovery is derived and fail-loud', () => {
  it('discovers the real decision_review pack from the filesystem marker', async () => {
    const packs = await discoverPacks();
    expect(packs.map((p) => p.task)).toContain('decision_review');
  });

  it('THROWS when zero packs are discovered (empty gated set = vacuous)', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'promo-gate-empty-'));
    tmpDirs.push(empty);
    await expect(discoverPacks(empty)).rejects.toThrow(/ZERO packs/);
  });

  it('THROWS on a marker that does not export a valid descriptor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'promo-gate-badmarker-'));
    tmpDirs.push(root);
    const packDir = join(root, 'broken');
    mkdirSync(packDir);
    writeFileSync(join(packDir, 'promotion-pack.ts'), 'export const PROMOTION_PACK = { nope: true };\n');
    await expect(discoverPacks(root)).rejects.toThrow(/does not export a valid PackDescriptor/);
  });
});

// ============================================================================
// Manifest + report loaders — fail-loud on malformed
// ============================================================================

describe('loaders fail loud on malformed input', () => {
  it('loads the real manifest and finds decision_review at hash b4f15305c2bb32e9', () => {
    const entries = loadManifestPrompts();
    const dr = entries.find((e) => e.task === 'decision_review');
    expect(dr?.servedHash).toBe('b4f15305c2bb32e9');
    expect(entries.length).toBeGreaterThanOrEqual(6);
  });

  it('THROWS on a manifest with no pms_prompts array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'promo-gate-manifest-'));
    tmpDirs.push(dir);
    const bad = join(dir, 'manifest.json');
    writeFileSync(bad, JSON.stringify({ something_else: [] }));
    expect(() => loadManifestPrompts(bad)).toThrow(/no "pms_prompts"/);
  });

  it('parses a valid report and THROWS on a malformed one', () => {
    expect(() => parsePromotionReport(report('t', 'h'), 'x')).not.toThrow();
    expect(() => parsePromotionReport({ ...report('t', 'h'), promptSha16: 123 }, 'x')).toThrow(/promptSha16/);
    expect(() =>
      parsePromotionReport({ ...report('t', 'h'), dims: [{ name: 'x', status: 'wat', required: true }] }, 'x'),
    ).toThrow(/malformed dim/);
  });

  it('loads the committed promotion reports directory without error', () => {
    expect(() => loadPromotionReports()).not.toThrow();
  });
});

// ============================================================================
// Grandfather ratchet — shrink-only, fail-loud in both directions
// ============================================================================

describe('grandfather ratchet', () => {
  const gf = (task: string, promotedHash: string): GrandfatherEntry => ({
    task,
    promotedHash,
    reason: 'test',
    recordedAt: '2026-07-31',
  });

  it('tolerates a BLOCK at the exact grandfathered hash, and reports ok', () => {
    const s = scenario();
    const gate = computePromotionGate([s.entry], [s.pack], [], OPTS); // NO_REPORT -> BLOCK
    const final = applyGrandfather(gate, [gf(s.task, s.hash)]);
    expect(final.ok).toBe(true);
    expect(final.rows[0].grandfathered).toBe(true);
  });

  it('does NOT tolerate a BLOCK whose promoted hash has MOVED since grandfathering (new drift)', () => {
    const s = scenario();
    const gate = computePromotionGate([s.entry], [s.pack], [], OPTS);
    const final = applyGrandfather(gate, [gf(s.task, 'old0000000000000')]);
    expect(final.ok).toBe(false);
    expect(final.rows[0].grandfathered).toBe(false);
    expect(final.baselineErrors.join(' ')).toMatch(/no longer applies/);
  });

  it('fails loud on a STALE entry — a task that now has a passing eval must not stay grandfathered', () => {
    const s = scenario();
    const gate = computePromotionGate([s.entry], [s.pack], [report(s.task, s.hash)], OPTS); // GATED_PASS
    const final = applyGrandfather(gate, [gf(s.task, s.hash)]);
    expect(final.ok).toBe(false);
    expect(final.baselineErrors.join(' ')).toMatch(/STALE/);
  });

  it('fails loud on a grandfather entry for a task with no manifest row', () => {
    const s = scenario();
    const gate = computePromotionGate([s.entry], [s.pack], [report(s.task, s.hash)], OPTS);
    const final = applyGrandfather(gate, [gf('ghost_task', 'x')]);
    expect(final.ok).toBe(false);
    expect(final.baselineErrors.join(' ')).toMatch(/no manifest row/);
  });

  it('an un-grandfathered BLOCK makes the whole result NOT ok', () => {
    const s = scenario();
    const gate = computePromotionGate([s.entry], [s.pack], [], OPTS);
    const final = applyGrandfather(gate, []);
    expect(final.ok).toBe(false);
  });
});

// ============================================================================
// Integration on the REAL committed state — the green is EARNED, not vacuous
// ============================================================================

describe('real committed state', () => {
  it('is GREEN with the real baseline, and would RED WITHOUT it (decision_review really is BLOCK)', async () => {
    const manifest = loadManifestPrompts();
    const packs = await discoverPacks();
    const reports = loadPromotionReports();
    const gate = computePromotionGate(manifest, packs, reports, {
      now: new Date('2026-07-31T00:00:00Z'),
      maxReportAgeDays: 90,
    });

    // decision_review must be a BLOCK before grandfathering — this is the
    // anti-vacuity proof for the real data: the gate SEES the un-evalled prompt.
    const dr = gate.rows.find((r) => r.task === 'decision_review');
    expect(dr?.decision).toBe('BLOCK');
    expect(dr?.blockKind).toBe('EVAL_FAILED');

    // Without the baseline, the whole gate is RED.
    expect(applyGrandfather(gate, []).ok).toBe(false);

    // With the committed baseline, it is GREEN and decision_review is visibly
    // grandfathered (not silently passed).
    const { loadGrandfatherBaseline } = await import('../src/promotion-gate/baseline.js');
    const final = applyGrandfather(gate, loadGrandfatherBaseline());
    expect(final.ok).toBe(true);
    expect(final.rows.find((r) => r.task === 'decision_review')?.grandfathered).toBe(true);
  });
});
