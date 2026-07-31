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
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `tools/orchestrator-eval/src` — for the single-source (no-twin) source read. */
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

import { computePromotionGate, passesFloor, type GateOptions } from '../src/promotion-gate/gate.js';
import {
  buildDecisionReviewPromotionReport,
  type LiveCaptureReport,
} from '../src/decision-review/promotion-report.js';
import { applyGrandfather } from '../src/promotion-gate/grandfather.js';
import { loadManifestPrompts, promptHash16 } from '../src/promotion-gate/manifest.js';
import { discoverPacks } from '../src/promotion-gate/packs.js';
import { loadPromotionReports, parsePromotionReport } from '../src/promotion-gate/reports.js';
import { MIN_CERTIFYING_SAMPLE_SIZE } from '../src/promotion-gate/types.js';
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

const OPTS: GateOptions = {
  now: new Date('2026-07-31T00:00:00Z'),
  maxReportAgeDays: 90,
  maxFutureSkewDays: 1,
};

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
// AMENDMENTS (adversarial review of #769, adjudicated) — A1 / A2 / A5
//
// Each block below is a control the review proved the UNAMENDED gate fails.
// They are the RED-first evidence for the amendments: every one of them was
// shown failing against the pre-amendment gate before a line was changed.
// ============================================================================

describe('A1 — the floor RE-DERIVES the sample-size minimum (n<3 cannot certify)', () => {
  it('CONTROL 4 — n=2: a hash-matched, in-date, clean-dim report CLAIMING PASS on 2 samples is BLOCKED', () => {
    const s = scenario();
    const thin = report(s.task, s.hash, { sampleSize: 2 }); // verdict PASS, dims clean
    const g = computePromotionGate([s.entry], [s.pack], [thin], OPTS);
    expect(g.rows[0].decision).toBe('BLOCK');
    expect(g.rows[0].blockKind).toBe('EVAL_FAILED');
    expect(g.rows[0].reason).toMatch(/sample/i);
  });

  it('CONTROL 4b — n=1 and n=0 are equally refused by the floor', () => {
    expect(passesFloor(report('t', 'h', { sampleSize: 1 })).ok).toBe(false);
    expect(passesFloor(report('t', 'h', { sampleSize: 0 })).ok).toBe(false);
  });

  it('the threshold is DERIVED from the shared constant, not a literal (the boundary moves with it)', () => {
    expect(passesFloor(report('t', 'h', { sampleSize: MIN_CERTIFYING_SAMPLE_SIZE - 1 })).ok).toBe(false);
    expect(passesFloor(report('t', 'h', { sampleSize: MIN_CERTIFYING_SAMPLE_SIZE })).ok).toBe(true);
  });

  it('SINGLE SOURCE — the report builder and the gate floor share ONE constant (no twin; trap 12)', () => {
    const gateSrc = readFileSync(join(SRC_ROOT, 'promotion-gate', 'gate.ts'), 'utf-8');
    const builderSrc = readFileSync(join(SRC_ROOT, 'decision-review', 'promotion-report.ts'), 'utf-8');
    // Both must reference the shared constant …
    expect(gateSrc).toContain('MIN_CERTIFYING_SAMPLE_SIZE');
    expect(builderSrc).toContain('MIN_CERTIFYING_SAMPLE_SIZE');
    // … and NEITHER may carry a hardcoded sample-size threshold beside it. A twin
    // literal is exactly the hand-maintained mirror that drifts silently.
    const TWIN = /(?:sampleSize|scoredCaptures|samples)\s*(?:<|>=|<=|>)\s*\d/;
    expect(gateSrc).not.toMatch(TWIN);
    expect(builderSrc).not.toMatch(TWIN);
  });

  it('the report BUILDER derives its own n-threshold from the SAME constant', () => {
    const dims = [{ name: 'safety', status: 'pass' }];
    const capture = (n: number): LiveCaptureReport => ({
      servedHash: 'aaaaaaaaaaaaaaaa',
      reports: Array.from({ length: n }, (_, i) => ({
        fixtureId: `f${i}`,
        scores: [{ candidate: 'served', dimensions: dims }],
      })),
    });
    const build = (n: number) =>
      buildDecisionReviewPromotionReport(capture(n), {
        candidateLabel: 'served',
        evidenceSource: 'unit-test synthetic capture',
        model: 'test-model',
        promptSha16: 'aaaaaaaaaaaaaaaa',
        generatedAt: '2026-07-30T00:00:00.000Z',
      });
    expect(build(MIN_CERTIFYING_SAMPLE_SIZE - 1).verdict).toBe('BLOCK');
    expect(build(MIN_CERTIFYING_SAMPLE_SIZE).verdict).toBe('PASS');
  });
});

describe('A2 — the floor requires at least one REQUIRED dimension MEASURED', () => {
  it('CONTROL 5 — a report whose ONLY dim is a non-required pass does NOT certify', () => {
    const r = report('t', 'h', {
      verdict: 'PASS',
      dims: [{ name: 'conditional_only', status: 'pass', required: false }],
    });
    expect(passesFloor(r).ok).toBe(false);
    expect(passesFloor(r).reason).toMatch(/required/i);
  });

  it('CONTROL 5b — at the gate, the only-non-required-pass report is BLOCKED (EVAL_FAILED)', () => {
    const s = scenario();
    const r = report(s.task, s.hash, {
      dims: [{ name: 'conditional_only', status: 'pass', required: false }],
    });
    const g = computePromotionGate([s.entry], [s.pack], [r], OPTS);
    expect(g.rows[0].decision).toBe('BLOCK');
    expect(g.rows[0].blockKind).toBe('EVAL_FAILED');
  });

  it('a required dim measured alongside conditional passes still certifies (not an always-block)', () => {
    const r = report('t', 'h', {
      dims: [
        { name: 'safety', status: 'pass', required: true },
        { name: 'conditional_only', status: 'pass', required: false },
      ],
    });
    expect(passesFloor(r).ok).toBe(true);
  });
});

describe('A5 — future-dated reports and the canonical-path binding', () => {
  it('CONTROL 6 — a POST-DATED report (generatedAt in the future) is BLOCKED, never "fresh"', () => {
    const s = scenario();
    const postdated = report(s.task, s.hash, { generatedAt: '2027-01-01T00:00:00.000Z' }); // 5 months ahead
    const g = computePromotionGate([s.entry], [s.pack], [postdated], OPTS);
    expect(g.rows[0].decision).toBe('BLOCK');
    expect(g.rows[0].blockKind).toBe('FUTURE_DATED');
  });

  it('a report inside the small clock-skew tolerance is still accepted (not an always-block)', () => {
    const s = scenario();
    const slightlyAhead = report(s.task, s.hash, {
      generatedAt: new Date(OPTS.now.getTime() + 60 * 60 * 1000).toISOString(), // +1h
    });
    const g = computePromotionGate([s.entry], [s.pack], [slightlyAhead], OPTS);
    expect(g.rows[0].decision).toBe('GATED_PASS');
  });

  it('CONTROL 7 — the skew guard asserts the pack scores the manifest\'s OWN canonical file', () => {
    const s = scenario();
    const other = tmpPrompt(); // a DIFFERENT file that happens to hash the same? no — different path
    const packElsewhere: PackDescriptor = { ...s.pack, canonicalPromptPath: other.path };
    const entrySameHash: ManifestPromptEntry = { ...s.entry, servedHash: other.hash };
    const g = computePromotionGate([entrySameHash], [packElsewhere], [report(s.task, other.hash)], OPTS);
    expect(g.rows[0].decision).toBe('BLOCK');
    expect(g.rows[0].blockKind).toBe('MANIFEST_EXPORT_SKEW');
    expect(g.rows[0].reason).toMatch(/canonical file/i);
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
      maxFutureSkewDays: 1,
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

// ============================================================================
// The report builder's PROVENANCE must describe the evidence it actually
// aggregated.
//
// ⚠ WHY THESE TESTS EXIST (E1, 2026-07-31). The builder wrote its `evidence`
// block as STRING LITERALS: `source: 'H1 #767 … two 2026-07-30 deployed-pair
// captures'`, `model: 'gpt-4.1-2025-04-14'`, and block reasons naming
// *"r1 no_internal_vocabulary, r3 no_dashes"* — regardless of what was passed
// in. Reused on any new corpus it emitted a gate artifact that MISDESCRIBED its
// own source, which is the guarantee-theatre pattern one level up: a report
// whose provenance cannot be wrong is a provenance nobody is checking.
//
// The fix makes provenance a REQUIRED input (a caller cannot forget it) and
// DERIVES the block reasons from the aggregated dims (they cannot drift from
// what was scored).
// ============================================================================
describe('promotion report — provenance is carried, never asserted', () => {
  const captureOf = (
    dims: ReadonlyArray<{ name: string; status: string }>,
    n = 3,
  ): LiveCaptureReport => ({
    servedHash: 'aaaaaaaaaaaaaaaa',
    reports: Array.from({ length: n }, (_, i) => ({
      fixtureId: `f${i}`,
      scores: [{ candidate: 'served', dimensions: dims }],
    })),
  });

  const OPTS_BASE = {
    candidateLabel: 'served',
    promptSha16: 'bbbbbbbbbbbbbbbb',
    generatedAt: '2026-07-31T00:00:00.000Z',
    evidenceSource: 'lane corpus: 7 fixtures x 3 arms, offline',
    model: 'some-model-id-9',
  };

  it('the evidence block reports the CALLER provenance, not a literal', () => {
    const r = buildDecisionReviewPromotionReport(
      captureOf([{ name: 'safety', status: 'pass' }]),
      OPTS_BASE,
    );
    const ev = r.evidence as Record<string, unknown>;
    expect(ev.source).toBe(OPTS_BASE.evidenceSource);
    expect(ev.model).toBe(OPTS_BASE.model);
    // and it must not smuggle in the frozen H1 provenance
    expect(JSON.stringify(ev)).not.toContain('H1 #767');
    expect(JSON.stringify(ev)).not.toContain('gpt-4.1-2025-04-14');
  });

  it('block_reasons NAME THE DIMENSIONS THAT ACTUALLY FAILED', () => {
    const r = buildDecisionReviewPromotionReport(
      captureOf([
        { name: 'safety', status: 'pass' },
        { name: 'tone_alignment', status: 'fail' },
        { name: 'numbers_grounded', status: 'fail' },
      ]),
      OPTS_BASE,
    );
    const reasons = ((r.evidence as Record<string, unknown>).block_reasons ?? []) as string[];
    const blob = reasons.join(' | ');
    expect(r.verdict).toBe('BLOCK');
    expect(blob).toContain('tone_alignment');
    expect(blob).toContain('numbers_grounded');
    // the OLD literal named dimensions that did not fail in THIS corpus
    expect(blob).not.toContain('no_internal_vocabulary');
    expect(blob).not.toContain('no_dashes');
  });

  it('a required dim that went NOT_APPLICABLE is named as the reason it is', () => {
    const r = buildDecisionReviewPromotionReport(
      captureOf([
        { name: 'safety', status: 'pass' },
        { name: 'tone_alignment', status: 'not_applicable' },
      ]),
      OPTS_BASE,
    );
    const blob = (((r.evidence as Record<string, unknown>).block_reasons ?? []) as string[]).join(' | ');
    expect(r.verdict).toBe('BLOCK');
    expect(blob).toContain('tone_alignment');
    expect(blob).toMatch(/unmeasured|not_applicable/i);
  });

  it('a clean PASS carries NO block reasons at all', () => {
    const r = buildDecisionReviewPromotionReport(
      captureOf([{ name: 'safety', status: 'pass' }]),
      OPTS_BASE,
    );
    expect(r.verdict).toBe('PASS');
    expect((r.evidence as Record<string, unknown>).block_reasons).toEqual([]);
  });

  it('SOURCE GUARD — no frozen H1 provenance literal survives in the builder', () => {
    const builderSrc = readFileSync(join(SRC_ROOT, 'decision-review', 'promotion-report.ts'), 'utf-8');
    // These are the exact strings the builder used to emit unconditionally.
    // A literal here can only ever describe ONE corpus, so it is wrong for
    // every other one; the mention in a comment is fine, an emitted string
    // is not. Scope the check to the returned object by requiring the
    // literal not appear inside quotes on a non-comment line.
    for (const line of builderSrc.split('\n')) {
      if (/^\s*(\*|\/\/)/.test(line)) continue;
      expect(line).not.toContain('H1 #767');
      expect(line).not.toContain('gpt-4.1-2025-04-14');
      expect(line).not.toContain('r1 no_internal_vocabulary');
    }
  });
});
