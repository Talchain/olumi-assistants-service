import { describe, it, expect } from 'vitest';

import { parseArgs } from '../../../../tools/v5-journey-replay/assurance/index.js';
import { runAssurance } from '../../../../tools/v5-journey-replay/assurance/run.js';

describe('assurance CLI — parseArgs', () => {
  it('defaults to cee-staging + .env.staging.local + gitignored scratch out', () => {
    const cfg = parseArgs([]);
    expect(cfg.baseUrl).toBe('https://cee-staging.onrender.com');
    expect(cfg.envFile).toBe('.env.staging.local');
    expect(cfg.outPath).toMatch(/^test-diagnostics\/v5-assurance\/report-\d+\.md$/);
    expect(cfg.allowStaleDeploy).toBe(false);
    expect(cfg.expectedBuild).toBeUndefined();
  });

  it('parses overrides', () => {
    const cfg = parseArgs([
      '--base-url', 'http://localhost:3000',
      '--out', 'x.md',
      '--env-file', '.env.alt',
      '--scenario-prefix', 'demo',
      '--expected-build', 'abc1234',
      '--allow-stale-deploy',
    ]);
    expect(cfg.baseUrl).toBe('http://localhost:3000');
    expect(cfg.outPath).toBe('x.md');
    expect(cfg.envFile).toBe('.env.alt');
    expect(cfg.scenarioPrefix).toBe('demo');
    expect(cfg.expectedBuild).toBe('abc1234');
    expect(cfg.allowStaleDeploy).toBe(true);
  });

  it('--expected-build= form and empty value', () => {
    expect(parseArgs(['--expected-build=def5678']).expectedBuild).toBe('def5678');
    expect(parseArgs(['--expected-build=']).expectedBuild).toBeUndefined();
  });
});

describe('runAssurance — blocked path (network-free, fail-fast on missing creds)', () => {
  it('returns blocked (exit 3) without creating scenarios when Supabase creds are absent', async () => {
    const outcome = await runAssurance({
      baseUrl: 'http://localhost:3000', // localhost → no assist key required
      scenarioPrefix: 'unit-test',
      outPath: 'test-diagnostics/v5-assurance/unit-test.md',
      envFile: '/definitely/not/a/real/.env.staging.local',
    });
    expect(outcome.phase).toBe('blocked');
    expect(outcome.exitCode).toBe(3);
    expect(outcome.scenarioIds).toEqual([]);
    expect(outcome.blockedReason).toMatch(/SUPABASE_URL/);
    expect(outcome.blockedReason).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    // blocked report must NOT print secret values (names only)
    expect(outcome.reportMarkdown).toContain('could not start');
    expect(outcome.reportMarkdown).not.toMatch(/eyJ|service_role.+=.+[A-Za-z0-9]{20}/);
  });
});
