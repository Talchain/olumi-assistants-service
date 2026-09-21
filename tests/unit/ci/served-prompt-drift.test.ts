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

import {
  evaluateDrift,
  evaluateConsistency,
  evaluateTaskBinding,
  selectTrackedRow,
  shortSha256,
  TRACKED_KEY,
  TRACKED_PMS_TASK,
} from '../../../scripts/verify-served-prompt.mjs';

const REPO_ROOT = resolve(__dirname, '../../..');
const WORKFLOW_PATH = resolve(REPO_ROOT, '.github/workflows/served-prompt-drift.yml');
const SNAPSHOT_PATH = resolve(
  REPO_ROOT,
  'src/orchestrator-v5/context/__tests__/fixtures/served-orchestrator-prompt.txt',
);
const HISTORICAL_PATH = resolve(
  REPO_ROOT,
  'src/orchestrator-v5/context/__tests__/fixtures/served-orchestrator-prompt-v119-historical.txt',
);

/** The prompt that was live during the record-denial defect — the permanent control. */
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
      liveHash: 'adcc5128d4e6e6bc', // v120 — the REAL re-pin this alarm caught live
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

  it('the pinned snapshot exists and the HISTORICAL control fixture is still v119', () => {
    expect(existsSync(SNAPSHOT_PATH)).toBe(true);
    // The LIVE snapshot's identity is owned by the sanction gate's own IDENTITY
    // test (one source of truth — asserting it here too would be a second
    // hand-maintained copy of the pin, which is the defect class this estate
    // keeps re-learning). It legitimately moves on every re-ratification: it
    // has already gone v119 -> v120.
    expect(shortSha256(readFileSync(SNAPSHOT_PATH, 'utf8'))).toMatch(/^[0-9a-f]{16}$/);
    // The HISTORICAL fixture, by contrast, must NEVER move — it is the
    // permanent control proving the gate catches the original record-denial
    // defect regardless of how often the served prompt is re-pinned.
    expect(shortSha256(readFileSync(HISTORICAL_PATH, 'utf8'))).toBe(V119_HASH);
  });
});

describe('evaluateConsistency — a split across instances is its OWN finding', () => {
  it('agreeing samples are consistent', () => {
    const s = [
      { version: 120, hash: 'adcc5128d4e6e6bc' },
      { version: 120, hash: 'adcc5128d4e6e6bc' },
      { version: 120, hash: 'adcc5128d4e6e6bc' },
    ];
    expect(evaluateConsistency(s).consistent).toBe(true);
  });

  it('POSITIVE CONTROL — the REAL 2026-07-25 split is caught and NAMED, not reported as drift', () => {
    // Observed live during the v119->v120 re-pin: consecutive reads of
    // /admin/prompts/status returned 119, 120, 119, 120. CEE staging runs
    // multiple instances and the prompt loader caches ~5 min, so for that
    // window the service served TWO DIFFERENT coach prompts depending on which
    // instance took the turn.
    const s = [
      { version: 119, hash: '4e8e69f3d721c864' },
      { version: 120, hash: 'adcc5128d4e6e6bc' },
      { version: 119, hash: '4e8e69f3d721c864' },
    ];
    const v = evaluateConsistency(s);
    expect(v.consistent).toBe(false);
    expect(v.message).toContain('NOT CONSISTENT ACROSS INSTANCES');
    // Both observed prompts must be named, or the operator cannot act.
    expect(v.message).toContain('v119/4e8e69f3d721c864');
    expect(v.message).toContain('v120/adcc5128d4e6e6bc');
    // It must NOT be mislabelled as settled drift — different operational state.
    expect(v.message).not.toContain('SERVED PROMPT DRIFT');
  });

  it('a same-version/different-hash split is caught too (a re-upload under one version)', () => {
    const s = [
      { version: 120, hash: 'adcc5128d4e6e6bc' },
      { version: 120, hash: 'ffffffffffffffff' },
    ];
    expect(evaluateConsistency(s).consistent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 1b. THE TASK BINDING — the verdict must be bound to WHOSE bytes these are
// ---------------------------------------------------------------------------
//
// WHY THIS BLOCK EXISTS. Before it, the alarm was TASK-BLIND: its verdict was
// bound to BYTES and never to the TASK IDENTITY that produced them. Measured
// at 9de184f1 with two surviving mutants, both 16/16 green:
//
//   M1  TRACKED_KEY 'routing' -> 'draft_graph'                  → SURVIVED
//   M2  row selection `.find(k => k.key === TRACKED_KEY)`
//       replaced by `body.keys[0]`                              → SURVIVED
//
// M1 survived because the only assertion naming the key was
// `expect(v.message).toContain(TRACKED_KEY)` — and the message is BUILT from
// TRACKED_KEY, so it cannot ever disagree. A guard agreeing with itself.
//
// The consequence is the one that matters for every A/B result this estate
// has recorded: a verify PASS proved "some prompt's bytes match the snapshot",
// never "the ROUTING prompt's bytes match the snapshot". `stagingVersion` has
// already been observed reporting a prompt the turns were not receiving, so a
// verdict that cannot name its own task cannot settle which bytes a user got.
//
// THESE ASSERTIONS DELIBERATELY USE STRING LITERALS, NOT THE IMPORTED
// CONSTANTS. Asserting against the constant is what made M1 survive.

describe('evaluateTaskBinding — the verdict names WHOSE bytes it read', () => {
  it('the tracked identity is `routing`, resolving the PMS task `orchestrator`', () => {
    // Literals, not constants: re-pointing either constant MUST turn this red.
    // The alias is declared at src/prompts/estate.ts (`routing: 'orchestrator'`).
    expect(TRACKED_KEY).toBe('routing');
    expect(TRACKED_PMS_TASK).toBe('orchestrator');
  });

  it('DERIVED: TRACKED_PMS_TASK agrees with the estate alias it mirrors', async () => {
    // `verify-served-prompt.mjs` is plain ESM and cannot import the TypeScript
    // alias map, so TRACKED_PMS_TASK is unavoidably a second copy. This is the
    // estate's dominant defect class, so the copy is DERIVED-CHECKED here
    // rather than left to drift silently.
    //
    // BOTH halves are kept on purpose (they are not redundant): the derived
    // check catches the two constants disagreeing, and the literal assertion
    // above catches the alias being re-pointed with the mirror dutifully
    // following it — which would keep this derived check green while the
    // pinned snapshot silently described a different PMS row.
    const { PMS_TASK_ALIAS } = await import('../../../src/prompts/estate.js');
    expect(PMS_TASK_ALIAS[TRACKED_KEY as 'routing']).toBe(TRACKED_PMS_TASK);
  });

  it('PASSES for the routing row resolved from its aliased PMS task', () => {
    const v = evaluateTaskBinding({ key: 'routing', pmsTask: 'orchestrator', source: 'pms' });
    expect(v.ok).toBe(true);
  });

  it('POSITIVE CONTROL — FAILS on a different task, and NAMES both sides', () => {
    // The substitution M2 made reachable: read whichever row came back first.
    const v = evaluateTaskBinding({ key: 'draft_graph', pmsTask: 'draft_graph', source: 'pms' });
    expect(v.ok).toBe(false);
    // Bound to the WRONG-ROW branch by its own header, not merely to `ok:false`.
    // Written the loose way first, this test PASSED with the key check disabled:
    // the payload fell through to the ALIAS branch, whose message also contains
    // both 'routing' and 'draft_graph'. A test that accepts any failing branch
    // is not a test of the branch it names. (Caught by mutant pair half 1.)
    expect(v.message).toContain('WRONG PROMPT ROW');
    expect(v.message).toContain('draft_graph');
    expect(v.message).toContain('routing');
  });

  it('FAILS when the alias has been re-pointed to a different PMS task', () => {
    // Bytes could still match the snapshot by coincidence or by copy; the
    // question "which PMS row is Paul editing when he edits this prompt?"
    // is not answerable from a hash.
    const v = evaluateTaskBinding({ key: 'routing', pmsTask: 'draft_graph', source: 'pms' });
    expect(v.ok).toBe(false);
    expect(v.message).toContain('PROMPT ALIAS RE-POINTED');
    expect(v.message).toContain('orchestrator');
  });

  it('FAILS when the task cannot be established at all (unprovable is not a pass)', () => {
    // Matches this module's FAIL-LOUD CONTRACT: there is no skip branch. An
    // absent pms_task means the row did not come from the live routing
    // snapshot, so the binding is unproven — which is exactly the state the
    // alarm exists to refuse to pass.
    const v = evaluateTaskBinding({ key: 'routing', pmsTask: undefined, source: 'default' });
    expect(v.ok).toBe(false);
    expect(v.message).toContain('PROMPT TASK NOT ESTABLISHED');
  });
});

describe('selectTrackedRow — the row is chosen BY KEY, never by position', () => {
  // `/admin/prompts/status` does not contract row order, and the reported set
  // is DERIVED (src/prompts/estate.ts) — it has already widened once. So the
  // routing row is deliberately NOT first in these fixtures: a positional
  // lookup must fail them.
  const body = {
    keys: [
      { key: 'draft_graph', version: '15', content_hash: 'aaaaaaaaaaaaaaaa', pms_task: 'draft_graph' },
      { key: 'routing', version: '121', sent_hash: 'bbbbbbbbbbbbbbbb', pms_task: 'orchestrator' },
      { key: 'edit_graph', version: '3', content_hash: 'cccccccccccccccc', pms_task: 'edit_graph' },
    ],
  };

  it('picks the routing row even when it is not first', () => {
    const r = selectTrackedRow(body);
    expect(r?.key).toBe('routing');
    expect(r?.pms_task).toBe('orchestrator');
  });

  it('POSITIVE CONTROL — a positional lookup would pick the WRONG row here', () => {
    // Pins this fixture's discriminating power in-test. Without this, someone
    // could reorder the fixture so routing came first and the test above would
    // keep passing while proving nothing.
    expect(body.keys[0].key).not.toBe('routing');
  });

  it('returns null when the tracked key is absent (degraded PMS is not a pass)', () => {
    expect(selectTrackedRow({ keys: [{ key: 'draft_graph' }] })).toBeNull();
    expect(selectTrackedRow({ keys: [] })).toBeNull();
    expect(selectTrackedRow({})).toBeNull();
  });
});

describe('the hash and the task identity appear on the SAME line', () => {
  // The brief's actual requirement: prove WHICH prompt bytes a task received.
  // A hash on one line and a task id on another cannot be correlated after the
  // fact — least of all across the multi-instance split this file documents.
  it('the OK verdict carries task, PMS task, source, version AND hash together', () => {
    const v = evaluateDrift({
      liveHash: V119_HASH,
      snapshotHash: V119_HASH,
      version: 119,
      liveChars: 24_410,
      snapshotChars: 24_410,
      pmsTask: 'orchestrator',
      source: 'pms',
    });
    expect(v.ok).toBe(true);
    const line = v.message.split('\n').find((l) => l.includes(V119_HASH));
    expect(line, 'no line carries the hash').toBeDefined();
    expect(line).toContain('routing');
    expect(line).toContain('orchestrator');
    expect(line).toContain('pms');
  });

  it('the DRIFT verdict names the task whose bytes drifted', () => {
    const v = evaluateDrift({
      liveHash: 'adcc5128d4e6e6bc',
      snapshotHash: V119_HASH,
      version: 120,
      liveChars: 25_149,
      snapshotChars: 24_410,
      pmsTask: 'orchestrator',
      source: 'pms',
    });
    expect(v.ok).toBe(false);
    const line = v.message.split('\n').find((l) => l.includes('adcc5128d4e6e6bc'));
    expect(line, 'no line carries the live hash').toBeDefined();
    expect(line).toContain('orchestrator');
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

  it('pins `ref: staging` on the checkout — a scheduled run checks out `main`, which has no script', () => {
    const doc = wf();
    const steps = (Object.values(doc.jobs)[0] as {
      steps: Array<{ uses?: string; name?: string; with?: Record<string, unknown> }>;
    }).steps;
    const checkouts = steps.filter(
      (s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout'),
    );
    expect(checkouts.length, 'no actions/checkout step to pin').toBeGreaterThan(0);
    for (const s of checkouts) {
      expect(
        s.with?.ref,
        'checkout does not pin `ref: staging` — GitHub fires `schedule:` from the DEFAULT branch, ' +
          'and `main` carries neither scripts/verify-served-prompt.mjs nor the pinned snapshot, ' +
          'so the scheduled run would die on a missing file',
      ).toBe('staging');
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // NOT A GUARD. A REQUIREMENT THIS SUITE IS STRUCTURALLY UNABLE TO CHECK.
  //
  // GitHub fires `schedule:` ONLY from the repository's DEFAULT branch. So this
  // workflow must EXIST ON `main` or the cron is inert no matter how well-formed
  // its declaration is. A unit test reads one working tree; it cannot see which
  // BRANCHES a file lives on. The `has BOTH a push trigger and a schedule
  // trigger` test above is therefore satisfied by a declaration that never
  // fires — and that is not hypothetical: between 2026-07-25 and 2026-08-29 the
  // file was on `staging` only, SCHEDULED RUNS = 0, while this suite was green
  // the whole time.
  //
  // The checks that CAN see it live outside this process:
  //   gh api repos/Talchain/olumi-assistants-service/contents/.github/workflows/served-prompt-drift.yml?ref=main
  //   gh api repos/Talchain/olumi-assistants-service/actions/workflows/320307337/runs?event=schedule --jq .total_count
  //
  // Do not read this comment as coverage. It is a note, not an assertion.
  // ───────────────────────────────────────────────────────────────────────────

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
