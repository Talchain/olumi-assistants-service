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
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _resetConfigCache } from '../../config/index.js';
import { loadDskBundle, getDskVersionHash, _resetDskBundle } from '../../orchestrator/dsk-loader.js';
import {
  checkFeatureHealth,
  logFeatureHealth,
  FEATURE_DECLARATIONS,
  type FeatureHealthCheck,
} from '../feature-health.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every flag this report reads, so each scenario starts from a known floor. */
const ALL_FLAG_ENV = [
  'BIL_ENABLED',
  'DSK_ENABLED',
  'ENABLE_DSK_V0',
  'DSK_COACHING_ENABLED',
  'CEE_ZONE2_REGISTRY_ENABLED',
  'ENABLE_ORCHESTRATOR_V2',
  'CEE_BRIEF_DETECTION_ENABLED',
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
  BIL_ENABLED: 'true',
  DSK_ENABLED: 'true',
  DSK_COACHING_ENABLED: 'true',
  CEE_ZONE2_REGISTRY_ENABLED: 'true',
  ENABLE_ORCHESTRATOR_V2: 'true',
  CEE_BRIEF_DETECTION_ENABLED: 'true',
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
  // Producer deleted in f957d6d8 (#615): src/orchestrator/brief-intelligence/**
  it('BIL: flag on, producer deleted → unhealthy, naming the unresolvable module', async () => {
    const { byName } = await reportFor({ BIL_ENABLED: 'true' });
    const bil = check(byName, 'BIL');
    expect(bil.enabled).toBe(true);
    expect(bil.healthy).toBe(false);
    expect(bil.reason).toMatch(/producer_module_unresolvable/);
    expect(bil.reason).toMatch(/brief-intelligence/);
  });

  // The known instance. All three dependency flags true on staging, and the
  // producer (src/orchestrator/dsk-coaching/**) has been deleted since 22 Jul.
  it('DSK_coaching: all three flags on, producer deleted → unhealthy', async () => {
    stubEnv({ DSK_ENABLED: 'true', BIL_ENABLED: 'true', DSK_COACHING_ENABLED: 'true' });
    loadDskBundle();
    const report = await checkFeatureHealth();
    const byName = new Map(report.checks.map((c) => [c.name, c]));
    const coaching = check(byName, 'DSK_coaching');
    expect(coaching.enabled).toBe(true);
    expect(coaching.healthy).toBe(false);
    expect(coaching.reason).toMatch(/producer_module_unresolvable/);
    expect(coaching.reason).toMatch(/dsk-coaching/);
  });

  it('zone2_registry: flag on, prompt-zones deleted → unhealthy', async () => {
    const { byName } = await reportFor({ CEE_ZONE2_REGISTRY_ENABLED: 'true' });
    const zone2 = check(byName, 'zone2_registry');
    expect(zone2.healthy).toBe(false);
    expect(zone2.reason).toMatch(/prompt-zones/);
  });

  it('orchestrator_v2: flag on, five-phase pipeline deleted → unhealthy', async () => {
    const { byName } = await reportFor({ ENABLE_ORCHESTRATOR_V2: 'true' });
    const v2 = check(byName, 'orchestrator_v2');
    expect(v2.healthy).toBe(false);
    expect(v2.reason).toMatch(/pipeline/);
  });

  it('brief_detection: flag on, intent-gate deleted → unhealthy', async () => {
    const { byName } = await reportFor({ CEE_BRIEF_DETECTION_ENABLED: 'true' });
    const brief = check(byName, 'brief_detection');
    expect(brief.healthy).toBe(false);
    expect(brief.reason).toMatch(/intent-gate/);
  });

  it('entity_memory: producer present but uncalled → unhealthy, not a hardcoded true', async () => {
    const { byName } = await reportFor({});
    const entity = check(byName, 'entity_memory');
    expect(entity.enabled).toBe(true); // unconditional feature, still reported
    expect(entity.healthy).toBe(false);
    expect(entity.reason).toMatch(/no_producer/);
    expect(entity.reason).toMatch(/trackEntityStates/);
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

  it('the startup log line WARNs and carries the dead subsystems in its details', async () => {
    const { log } = await import('../../utils/telemetry.js');
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      stubEnv(ALL_ON);
      loadDskBundle();
      await logFeatureHealth();
      expect(warn).toHaveBeenCalled();
      const [payload, message] = warn.mock.calls[0] as [Record<string, unknown>, string];
      expect(payload.event).toBe('feature_health');
      expect(payload.unhealthy).toBeGreaterThanOrEqual(6);
      expect(String(message)).toMatch(/DSK_coaching=✗/);
      expect(String(message)).toMatch(/BIL=✗/);
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
    expect(check(byName, 'BIL').enabled).toBe(false);
    expect(check(byName, 'BIL').reason).toBe('disabled');
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
    expect(unhealthy).toEqual([
      'BIL',
      'DSK_coaching',
      'brief_detection',
      'entity_memory',
      'orchestrator_v2',
      'zone2_registry',
    ]);
    expect(report.healthy_count).toBe(3);
    expect(report.unhealthy_count).toBe(6);
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
function producerFileExists(specifier: string): boolean {
  const featureHealthModule = new URL('../feature-health.ts', import.meta.url);
  const asJs = fileURLToPath(new URL(specifier, featureHealthModule));
  const asTs = asJs.replace(/\.js$/, '.ts'); // dev/test tree is .ts, dist is .js
  return fs.existsSync(asJs) || fs.existsSync(asTs);
}

describe('feature health: the verdicts are DERIVED, and drift fails loud', () => {
  it('every producer_module verdict agrees with an independent filesystem check', async () => {
    stubEnv(ALL_ON);
    loadDskBundle();
    const report = await checkFeatureHealth();
    const byName = new Map(report.checks.map((c) => [c.name, c]));

    const moduleBacked = FEATURE_DECLARATIONS.filter(
      (d) => d.evidence.kind === 'producer_module',
    );
    // Guard the guard: if this list empties, the assertion below is vacuous.
    expect(moduleBacked.length).toBeGreaterThanOrEqual(5);

    for (const declaration of moduleBacked) {
      const specifier =
        declaration.evidence.kind === 'producer_module' ? declaration.evidence.specifier : '';
      const onDisk = producerFileExists(specifier);
      const reported = check(byName, declaration.name);
      expect(
        reported.healthy,
        `${declaration.name}: report says healthy=${reported.healthy} but ` +
          `${specifier} ${onDisk ? 'EXISTS' : 'does NOT exist'} on disk. ` +
          `Either the specifier is wrong (so the probe fails for the wrong reason) ` +
          `or the module came back and the health verdict must be re-derived.`,
      ).toBe(onDisk);
    }
  });

  /**
   * The one verdict that cannot be derived at runtime: `entity_memory` is dead
   * because its producer has no CALLER, not because its module is gone — a
   * module probe would report a false green. So pin the caller count here.
   *
   * Scope: every `*.ts` under `src/`, excluding test files and exactly two
   * files that NAME the symbol without calling it — the producer itself, and
   * `feature-health.ts`, whose evidence text quotes it. Any THIRD file
   * mentioning it REDs here. Read through Node's `fs` rather than `grep`,
   * which is blind to this repo's NUL-sentinel source files (trap 17).
   */
  it('entity_memory stays no_producer only while trackEntityStates has no caller', () => {
    const srcRoot = fileURLToPath(new URL('../../', import.meta.url));
    const producerFile = path.join(srcRoot, 'orchestrator', 'context', 'entity-state-tracker.ts');
    const documentsItWithoutCalling = [
      producerFile,
      path.join(srcRoot, 'diagnostics', 'feature-health.ts'),
    ];
    expect(fs.existsSync(producerFile)).toBe(true); // the producer really is still there

    const callers: string[] = [];
    let scanned = 0;
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
        if (documentsItWithoutCalling.includes(full)) continue;
        scanned += 1;
        if (fs.readFileSync(full, 'utf8').includes('trackEntityStates')) {
          callers.push(path.relative(srcRoot, full));
        }
      }
    };
    walk(srcRoot);

    // Guard the guard: a walk that scanned nothing would assert nothing.
    expect(scanned).toBeGreaterThan(500);
    expect(
      callers,
      `trackEntityStates() now has ${callers.length} caller(s) in src/ (${callers.join(', ')}). ` +
        `entity_memory's health verdict is pinned to "no_producer" — upgrade it to a real ` +
        `runtime_state/producer_module probe instead of leaving it permanently red.`,
    ).toEqual([]);
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
          /^(producer_module_unresolvable|runtime_state_absent|dependency_unsatisfied|no_producer):/,
        );
      }
    }
  });
});
