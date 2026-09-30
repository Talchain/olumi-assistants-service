/**
 * Feature-health HONESTY tests.
 *
 * The startup feature-health report is an OPS surface: an incident triage that
 * trusts it starts from whatever it says. Until 2026-07-30 six of its nine
 * checks computed `healthy` from the flag itself (`healthy: enabled`, or a
 * hardcoded `true`), so it reported `healthy: true` for four subsystems whose
 * producing code was deleted on 2026-07-22 (`f957d6d8`, #615), for a fifth
 * whose producer has no caller, and for the DSK bundle even when it failed to
 * load or failed HASH VERIFICATION.
 *
 * These tests are written against the OBSERVABLE report, not the internals:
 *
 *  - RED-first (§1): each dishonest verdict, asserted false with the evidence
 *    named. Every one of these fails on `ae16ac47` (the pre-fix tip).
 *  - Positive controls (§2): the genuinely-live subsystems must STILL report
 *    healthy — so "mark everything unhealthy" cannot pass as a fix — and the
 *    healthy/unhealthy partition is pinned exactly, so the suite cannot pass
 *    vacuously.
 *  - Derivation pins (§3): the report's producer-module verdicts are
 *    re-derived INDEPENDENTLY from the filesystem, and the one verdict that
 *    cannot be derived at runtime (`no_producer`) is pinned by a caller count.
 *    Both fail loud on drift instead of assuming good — a re-added module, a
 *    typo'd specifier, or a newly-wired producer all RED here.
 *
 * Config is driven through the REAL env → `parseConfig()` → `config` proxy path
 * (`vi.stubEnv` + `_resetConfigCache`), deliberately with no config mock: a
 * mock factory here would be its own hand-maintained mirror (trap 12).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _resetConfigCache } from '../../config/index.js';
import { loadDskBundle, getDskVersionHash, _resetDskBundle } from '../../orchestrator/dsk-loader.js';
import {
  checkFeatureHealth,
  evaluateFeatureEvidence,
  logFeatureHealth,
  FEATURE_DECLARATIONS,
  type FeatureHealthCheck,
} from '../feature-health.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every flag this report reads, so each scenario starts from a known floor. */
const ALL_FLAG_ENV = [
  'DSK_ENABLED',
  'ENABLE_DSK_V0',
  'CEE_GROUNDING_ENABLED',
  'CEE_CAUSAL_VALIDATION_ENABLED',
  'ISL_BASE_URL',
] as const;

function stubEnv(overrides: Record<string, string>): void {
  for (const key of ALL_FLAG_ENV) vi.stubEnv(key, '');
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  _resetConfigCache();
}

async function reportFor(overrides: Record<string, string>) {
  stubEnv(overrides);
  const report = await checkFeatureHealth();
  const byName = new Map<string, FeatureHealthCheck>(report.checks.map((c) => [c.name, c]));
  return { report, byName };
}

function check(byName: Map<string, FeatureHealthCheck>, name: string): FeatureHealthCheck {
  const found = byName.get(name);
  if (!found) throw new Error(`no check named "${name}" in the report`);
  return found;
}

/** Every flag on, ISL configured — the staging-like "everything armed" case. */
const ALL_ON: Record<string, string> = {
  DSK_ENABLED: 'true',
  CEE_GROUNDING_ENABLED: 'true',
  CEE_CAUSAL_VALIDATION_ENABLED: 'true',
  ISL_BASE_URL: 'https://isl.invalid',
};

beforeEach(() => {
  _resetDskBundle();
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
  _resetDskBundle();
});

// ---------------------------------------------------------------------------
// §1 RED-first — the dishonest verdicts
// ---------------------------------------------------------------------------

describe('feature health: a deleted or uncalled producer must NOT report healthy', () => {
  // The mechanism, on the evidence itself: since 2026-09-30 no declared feature is dead (the six were retired, see
  // retired-dead-flags.test.ts), so these rows keep the probe's negative paths tested.
  it('a producer module that no longer resolves is unhealthy, naming the module (a real f957d6d8 deletion)', async () => {
    const verdict = await evaluateFeatureEvidence({
      kind: 'producer_module', specifier: '../orchestrator/brief-intelligence/extract.js', producesExport: 'extractBriefIntelligence',
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/^producer_module_unresolvable: .*brief-intelligence/);
  });

  it('a module that resolves without its producing export is unhealthy', async () => {
    const verdict = await evaluateFeatureEvidence({ kind: 'producer_module', specifier: '../grounding/index.js', producesExport: 'noSuchProducer' });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/^producer_export_missing:/);
    // CONTROL: the same module with its real export is healthy.
    expect((await evaluateFeatureEvidence({ kind: 'producer_module', specifier: '../grounding/index.js', producesExport: 'extractTextFromPdf' })).ok).toBe(true);
  });

  it('a producer with no caller is unhealthy, never a hardcoded true', async () => {
    const verdict = await evaluateFeatureEvidence({ kind: 'no_producer', describes: 'nothing calls it' });
    expect(verdict).toEqual({ ok: false, reason: 'no_producer: nothing calls it' });
  });

  // loadDskBundle() returns silently on ENOENT / bad JSON / bad shape / HASH
  // MISMATCH — it does not throw. So "the flag is on and the server started"
  // is not evidence the bundle is there.
  it('DSK: flag on but bundle NOT loaded → unhealthy (a load or hash failure is visible)', async () => {
    _resetDskBundle();
    const { byName } = await reportFor({ DSK_ENABLED: 'true' });
    expect(getDskVersionHash()).toBeNull();
    const dsk = check(byName, 'DSK');
    expect(dsk.enabled).toBe(true);
    expect(dsk.healthy).toBe(false);
    expect(dsk.reason).toMatch(/runtime_state_absent/);
  });

  it('causal_validation: flag on but ISL unconfigured → unhealthy', async () => {
    const { byName } = await reportFor({ CEE_CAUSAL_VALIDATION_ENABLED: 'true' });
    const causal = check(byName, 'causal_validation');
    expect(causal.healthy).toBe(false);
    expect(causal.reason).toMatch(/dependency_unsatisfied/);
  });

  it('the startup log line WARNs and carries the unhealthy subsystem in its details', async () => {
    const { log } = await import('../../utils/telemetry.js');
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      stubEnv({ ...ALL_ON, ISL_BASE_URL: '' });
      loadDskBundle();
      await logFeatureHealth();
      expect(warn).toHaveBeenCalled();
      const [payload, message] = warn.mock.calls[0] as [Record<string, unknown>, string];
      expect(payload.event).toBe('feature_health');
      expect(payload.unhealthy).toBe(1);
      expect(String(message)).toMatch(/causal_validation=✗ \(dependency_unsatisfied/);
    } finally {
      warn.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// §2 Positive controls — live subsystems must still report healthy
// ---------------------------------------------------------------------------

describe('feature health: live subsystems still report healthy', () => {
  it('grounding: flag on and src/grounding resolves → healthy', async () => {
    const { byName } = await reportFor({ CEE_GROUNDING_ENABLED: 'true' });
    const grounding = check(byName, 'grounding');
    expect(grounding.enabled).toBe(true);
    expect(grounding.healthy).toBe(true);
    expect(grounding.reason).toBeUndefined();
  });

  it('DSK: flag on and the REAL bundle loads + hash-verifies → healthy', async () => {
    stubEnv({ DSK_ENABLED: 'true' });
    loadDskBundle();
    expect(getDskVersionHash()).not.toBeNull(); // the bundle really loaded
    const report = await checkFeatureHealth();
    const dsk = check(new Map(report.checks.map((c) => [c.name, c])), 'DSK');
    expect(dsk.healthy).toBe(true);
    expect(dsk.reason).toBeUndefined();
  });

  it('causal_validation: flag on and ISL configured → healthy', async () => {
    const { byName } = await reportFor({
      CEE_CAUSAL_VALIDATION_ENABLED: 'true',
      ISL_BASE_URL: 'https://isl.invalid',
    });
    expect(check(byName, 'causal_validation').healthy).toBe(true);
  });

  it('a disabled feature is reported disabled, not unhealthy-with-a-cause', async () => {
    const { report, byName } = await reportFor({});
    expect(check(byName, 'grounding').enabled).toBe(false);
    expect(check(byName, 'grounding').reason).toBe('disabled');
    expect(report.disabled_count).toBeGreaterThan(0);
  });

  // Anti-vacuity: pins the exact partition with everything armed, so neither
  // "everything healthy" (the old defect) nor "everything unhealthy" (a lazy
  // fix) can pass.
  it('with every flag armed, the healthy set is exactly the three live subsystems', async () => {
    stubEnv(ALL_ON);
    loadDskBundle();
    const report = await checkFeatureHealth();
    const healthy = report.checks.filter((c) => c.enabled && c.healthy).map((c) => c.name).sort();
    const unhealthy = report.checks.filter((c) => c.enabled && !c.healthy).map((c) => c.name).sort();
    expect(healthy).toEqual(['DSK', 'causal_validation', 'grounding']);
    expect(unhealthy).toEqual([]);
    expect(report.healthy_count).toBe(3);
    expect(report.unhealthy_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §3 Derivation pins — fail loud on drift, never assume-good
// ---------------------------------------------------------------------------

/**
 * Resolve a producer-module specifier the way `feature-health.ts` does — the
 * specifier is relative to THAT module, not to this test — and report whether
 * the file exists. Independent of the runtime probe (`fs` vs `import()`), so
 * the two mechanisms have to agree.
 */
function specifierToRepoPath(specifier: string): string {
  const featureHealthModule = new URL('../feature-health.ts', import.meta.url);
  return fileURLToPath(new URL(specifier, featureHealthModule));
}

function producerFileExists(specifier: string): boolean {
  const asJs = specifierToRepoPath(specifier);
  const asTs = asJs.replace(/\.js$/, '.ts'); // dev/test tree is .ts, dist is .js
  return fs.existsSync(asJs) || fs.existsSync(asTs);
}

const moduleBackedDeclarations = () =>
  FEATURE_DECLARATIONS.filter((d) => d.evidence.kind === 'producer_module').map((d) => ({
    name: d.name,
    specifier: d.evidence.kind === 'producer_module' ? d.evidence.specifier : '',
    producesExport: d.evidence.kind === 'producer_module' ? d.evidence.producesExport : '',
  }));

describe('feature health: the verdicts are DERIVED, and drift fails loud', () => {
  it('every producer_module verdict agrees with an independent filesystem check', async () => {
    stubEnv(ALL_ON);
    loadDskBundle();
    const report = await checkFeatureHealth();
    const byName = new Map(report.checks.map((c) => [c.name, c]));

    const moduleBacked = moduleBackedDeclarations();
    // Guard the guard: if this list empties, the assertion below is vacuous.
    expect(moduleBacked.length).toBeGreaterThanOrEqual(1);

    for (const declaration of moduleBacked) {
      const onDisk = producerFileExists(declaration.specifier);
      const reported = check(byName, declaration.name);
      expect(
        reported.healthy,
        `${declaration.name}: report says healthy=${reported.healthy} but ` +
          `${declaration.specifier} ${onDisk ? 'EXISTS' : 'does NOT exist'} on disk. ` +
          `A present-but-unhealthy module means it failed to LOAD or lost its ` +
          `producing export; an absent-but-healthy one should be impossible.`,
      ).toBe(onDisk);
    }
  });

  /**
   * AMENDMENT 2 (same review). `import()` alone proved RESOLUTION, not
   * production: gutting `grounding/index.ts` to `export {}` left the module
   * resolvable and the report `healthy: true`, 17/17 green. The probe now
   * requires the named producing export to be callable. This pins the live
   * declaration's export name against the real module, so a rename in
   * `grounding/index.ts` REDs here rather than going quietly false-green.
   */
  it('a live producer must actually EXPORT its declared producing symbol', async () => {
    const live = [];
    for (const declaration of moduleBackedDeclarations()) {
      if (!producerFileExists(declaration.specifier)) continue;
      live.push(declaration);
      const mod = (await import(
        specifierToRepoPath(declaration.specifier).replace(/\.js$/, '.ts')
      )) as Record<string, unknown>;
      expect(
        typeof mod[declaration.producesExport],
        `${declaration.name}: declared producing export ` +
          `"${declaration.producesExport}" is not a callable in ` +
          `${declaration.specifier}. Either the export was renamed (update the ` +
          `declaration) or the module lost its producing surface.`,
      ).toBe('function');
    }
    // Guard the guard: with no live module-backed declaration this proves nothing.
    expect(live.length).toBeGreaterThanOrEqual(1);
  });

  it('no check derives its verdict from the flag alone', async () => {
    stubEnv(ALL_ON);
    loadDskBundle();
    const report = await checkFeatureHealth();
    expect(report.checks.length).toBe(FEATURE_DECLARATIONS.length);
    for (const c of report.checks) {
      expect(
        ['runtime_state', 'producer_module', 'dependency', 'no_producer'],
        `${c.name} reports no evidence kind`,
      ).toContain(c.evidence_kind);
      // An unhealthy enabled feature must say what was missing, and the reason
      // must name the evidence — never just restate that the flag is on.
      if (c.enabled && !c.healthy) {
        expect(c.reason, `${c.name} is unhealthy with no stated cause`).toBeTruthy();
        expect(c.reason).toMatch(
          /^(producer_module_unresolvable|producer_export_missing|runtime_state_absent|dependency_unsatisfied|no_producer):/,
        );
      }
    }
  });
});
