/**
 * Guards for the served-prompt drift alarm (`.github/workflows/served-prompt-drift.yml`).
 *
 * Two independent jobs, mirroring `staging-journey-smoke.test.ts`:
 *
 * 1. THE DISCRIMINATOR WORKS. `evaluateDrift` is exercised directly with the
 *    REAL historical hashes, both ways — an alarm whose comparison is only
 *    reachable through a live network call cannot be positive-controlled, and
 *    an absence assertion that cannot see a presence is vacuous (trap #13).
 *
 * 2. THE ALARM CANNOT BE SILENCED QUIETLY. These tests parse the workflow YAML
 *    and assert the properties whose absence made two earlier smoke workflows
 *    dead (`continue-on-error`, a `vars.` enable-gate, a missing trigger, a
 *    production target). The facts are DERIVED from the file — there is no
 *    second hand-maintained copy to drift.
 *
 * WHY THE `schedule` TRIGGER IS ASSERTED, NOT OPTIONAL: the coach prompt is
 * re-pinnable in PMS with NO commit and NO deploy. A push-only alarm cannot
 * observe that event at all, and the sanction gate would keep validating the
 * pack — and keep its prompt-hash-keyed waivers alive — against bytes we no
 * longer serve.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

import { evaluateDrift, shortSha256, TRACKED_KEY } from '../../../scripts/verify-served-prompt.mjs';

const REPO_ROOT = resolve(__dirname, '../../..');
const WORKFLOW_PATH = resolve(REPO_ROOT, '.github/workflows/served-prompt-drift.yml');
const SNAPSHOT_PATH = resolve(
  REPO_ROOT,
  'src/orchestrator-v5/context/__tests__/fixtures/served-orchestrator-prompt.txt',
);

/** The real served prompt at the time the sanction gate was ratified. */
const V119_HASH = '4e8e69f3d721c864';

// ---------------------------------------------------------------------------
// 1. The discriminator
// ---------------------------------------------------------------------------

describe('evaluateDrift — the comparison discriminates', () => {
  it('PASSES when the served hash equals the pinned snapshot', () => {
    const v = evaluateDrift({
      liveHash: V119_HASH,
      snapshotHash: V119_HASH,
      version: 119,
      liveChars: 24_410,
      snapshotChars: 24_410,
    });
    expect(v.ok).toBe(true);
    expect(v.message).toContain(TRACKED_KEY);
  });

  it('POSITIVE CONTROL — FAILS on a real re-pin (v119 pinned, a different prompt served)', () => {
    // This is the exact event the alarm exists for: a PMS re-pin, no deploy,
    // no commit — the snapshot silently describes a prompt we no longer serve.
    const v = evaluateDrift({
      liveHash: 'adcc5128d4e6e6bc', // a different served prompt
      snapshotHash: V119_HASH,
      version: 120,
      liveChars: 25_149,
      snapshotChars: 24_410,
    });
    expect(v.ok).toBe(false);
    expect(v.message).toContain('SERVED PROMPT DRIFT');
    // The operator must be told the waivers are now void, not just that bytes differ.
    expect(v.message).toContain('EXPIRED');
  });

  it('FAILS when the status row carries no hash at all (degraded PMS is not a pass)', () => {
    const v = evaluateDrift({
      liveHash: undefined,
      snapshotHash: V119_HASH,
      version: 119,
      liveChars: 0,
      snapshotChars: 24_410,
    });
    expect(v.ok).toBe(false);
  });

  it('the pinned snapshot on disk is the bytes the sanction gate ratified', () => {
    expect(existsSync(SNAPSHOT_PATH)).toBe(true);
    // Derived from the file, so a re-snapshot without re-ratification is visible here.
    expect(shortSha256(readFileSync(SNAPSHOT_PATH, 'utf8'))).toBe(V119_HASH);
  });
});

// ---------------------------------------------------------------------------
// 2. The alarm cannot be silenced quietly
// ---------------------------------------------------------------------------

describe('served-prompt-drift.yml — the alarm cannot be silenced quietly', () => {
  it('the workflow exists (deleting it turns this red)', () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
  });

  const wf = () => parse(readFileSync(WORKFLOW_PATH, 'utf8'));

  it('has BOTH a push trigger and a schedule trigger', () => {
    // `on` parses to the boolean `true` key in YAML 1.1; the `yaml` package
    // keeps it as the string 'on'. Accept either so this cannot silently pass.
    const doc = wf();
    const on = doc.on ?? doc[true as unknown as keyof typeof doc];
    expect(on, 'no triggers block found').toBeTruthy();
    expect(on.push, 'push trigger missing — a snapshot change would go unverified').toBeTruthy();
    expect(
      on.schedule,
      'SCHEDULE MISSING — a PMS re-pin produces no commit and no deploy, so only a timer can catch it',
    ).toBeTruthy();
    expect(Array.isArray(on.schedule)).toBe(true);
    expect(on.schedule.length).toBeGreaterThan(0);
    expect(on.schedule[0].cron).toMatch(/\S/);
  });

  it('pushes are watched on staging, never main', () => {
    const doc = wf();
    const on = doc.on ?? doc[true as unknown as keyof typeof doc];
    expect(on.push.branches).toContain('staging');
    expect(on.push.branches).not.toContain('main');
  });

  // NOTE: these assert against the PARSED YAML, never the raw text. This file's
  // own header names `continue-on-error` and `vars.` as the things it forbids,
  // and a raw-text match flagged those COMMENTS on the first run — a guard that
  // fires on its own prose is not a guard. Structure is what the runner obeys.

  it('has NO continue-on-error anywhere (a red step must fail the run)', () => {
    const doc = wf();
    for (const [name, job] of Object.entries(doc.jobs) as Array<
      [string, { 'continue-on-error'?: unknown; steps: Array<Record<string, unknown>> }]
    >) {
      expect(job['continue-on-error'], `job "${name}" is continue-on-error`).toBeUndefined();
      for (const step of job.steps) {
        expect(
          step['continue-on-error'],
          `step "${String(step.name ?? step.uses)}" is continue-on-error`,
        ).toBeUndefined();
      }
    }
  });

  it('has NO `vars.` enable-gate (it cannot be switched off by leaving a variable unset)', () => {
    const doc = wf();
    for (const job of Object.values(doc.jobs) as Array<{
      if?: string;
      steps: Array<Record<string, unknown>>;
    }>) {
      // A `vars.` reference is fine as a NON-gating default (the base URL);
      // it is forbidden in any CONDITION, where it becomes an off switch.
      expect(job.if ?? '', 'job-level `vars.` gate').not.toMatch(/vars\./);
      for (const step of job.steps) {
        expect(
          typeof step.if === 'string' ? step.if : '',
          `step "${String(step.name ?? step.uses)}" has a \`vars.\` gate`,
        ).not.toMatch(/vars\./);
      }
    }
  });

  it('every job step runs — no step-level `if:` conditions', () => {
    const doc = wf();
    for (const job of Object.values(doc.jobs) as Array<{ steps: Array<Record<string, unknown>> }>) {
      for (const step of job.steps) {
        // `if: always()` on the artifact upload is a MORE-runs condition, not a gate.
        if (typeof step.if === 'string') expect(step.if).toBe('always()');
      }
    }
  });

  it('uses `shell: bash` on the piped step, so pipefail is on', () => {
    const doc = wf();
    const steps = (Object.values(doc.jobs)[0] as { steps: Array<Record<string, string>> }).steps;
    const piped = steps.filter((s) => typeof s.run === 'string' && s.run.includes('|'));
    expect(piped.length).toBeGreaterThan(0);
    for (const s of piped) {
      expect(
        s.shell,
        'without `shell: bash` the run exits with tee status 0 and the alarm passes while drifted',
      ).toBe('bash');
    }
  });

  it('does not target production — structurally, in the env the step actually uses', () => {
    const doc = wf();
    const steps = (Object.values(doc.jobs)[0] as {
      steps: Array<{ env?: Record<string, string> }>;
    }).steps;
    const urls = steps.flatMap((s) => (s.env?.CEE_BASE_URL ? [s.env.CEE_BASE_URL] : []));
    expect(urls.length, 'no CEE_BASE_URL supplied to the step').toBeGreaterThan(0);
    for (const u of urls) {
      expect(u).toContain('cee-staging');
      expect(u).not.toContain('cee-production');
    }
  });
});
