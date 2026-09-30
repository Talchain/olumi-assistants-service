/**
 * ⛔ SIX ENABLED FEATURES THAT DO NOT RUN — retired, not reported unhealthy on every boot (DL gap 4,
 * `ARCHITECTURE-FINDINGS.md`; MG #75 5912784055).
 *
 * Staging sets BIL_ENABLED, DSK_COACHING_ENABLED, CEE_ZONE2_REGISTRY_ENABLED, ENABLE_ORCHESTRATOR_V2 and
 * CEE_BRIEF_DETECTION_ENABLED. The producers of all five were deleted on 2026-07-22 (`f957d6d8`, #615), and the sixth
 * (entity memory) has had no production caller since. Every boot has logged all six as unhealthy, and nobody owned them.
 * The flags now parse into nothing: each is a DEAD env var (flagged for removal from deployment config), and none has a
 * health row, so a staging-like boot reports no unhealthy feature.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { _resetConfigCache, checkDeadEnvVars, config } from '../../config/index.js';
import { loadDskBundle, _resetDskBundle } from '../../orchestrator/dsk-loader.js';
import { checkFeatureHealth, FEATURE_DECLARATIONS } from '../feature-health.js';

const RETIRED_ENV = [
  'BIL_ENABLED',
  'DSK_COACHING_ENABLED',
  'CEE_ZONE2_REGISTRY_ENABLED',
  'ENABLE_ORCHESTRATOR_V2',
  'CEE_BRIEF_DETECTION_ENABLED',
] as const;
const RETIRED_FEATURES = ['BIL', 'DSK_coaching', 'zone2_registry', 'orchestrator_v2', 'brief_detection', 'entity_memory'];

afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
  _resetDskBundle();
});

describe('the six dead features are retired', () => {
  it('RED: each retired flag is a dead env var — set, it is flagged for removal, and no config field reads it', () => {
    for (const key of RETIRED_ENV) vi.stubEnv(key, 'true');
    _resetConfigCache();
    const dead = checkDeadEnvVars().map((w) => w.key);
    for (const key of RETIRED_ENV) expect(dead, key).toContain(key);
    const features = config.features as Record<string, unknown>;
    for (const field of ['bilEnabled', 'dskCoachingEnabled', 'zone2Registry', 'orchestratorV2', 'briefDetectionEnabled']) {
      expect(features, field).not.toHaveProperty(field);
    }
  });

  it('RED: a staging-like boot (every flag it sets, ISL configured) reports no unhealthy feature', async () => {
    for (const key of RETIRED_ENV) vi.stubEnv(key, 'true');
    vi.stubEnv('DSK_ENABLED', 'true');
    vi.stubEnv('CEE_GROUNDING_ENABLED', 'true');
    vi.stubEnv('CEE_CAUSAL_VALIDATION_ENABLED', 'true');
    vi.stubEnv('ISL_BASE_URL', 'https://isl.invalid');
    _resetConfigCache();
    loadDskBundle();
    const report = await checkFeatureHealth();
    expect(FEATURE_DECLARATIONS.map((d) => d.name)).not.toEqual(expect.arrayContaining([expect.stringMatching(
      new RegExp(`^(${RETIRED_FEATURES.join('|')})$`))]));
    expect(report.checks.filter((c) => c.enabled && !c.healthy).map((c) => c.name)).toEqual([]);
    expect(report.healthy_count, 'the control: the live subsystems are still checked').toBe(3);
  });

  it('CONTROL: the live DSK bundle flag is not retired', () => {
    vi.stubEnv('DSK_ENABLED', 'true');
    _resetConfigCache();
    expect(checkDeadEnvVars().map((w) => w.key)).not.toContain('DSK_ENABLED');
    expect(config.features.dskEnabled).toBe(true);
  });
});
