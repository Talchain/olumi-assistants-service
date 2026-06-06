/**
 * V5 replay harness — Branch A pending-scenario acceptance split (precise).
 *
 * Proves the run-level gating of the `pending-scenario` downgrade on the
 * `branch-a-canonical` journey's step 4 (`4_flip_proposal_present`):
 *
 *   - chip ABSENT + --db-readback confirms flip_thresholds[].flip_value
 *     ALL NULL  → step 4 is a `pending-scenario` SKIP (not red); steps 5-8
 *     cascade as pending-scenario; the run is GREEN (exit 0).
 *   - chip ABSENT + DB shows a NON-null flip_value (emit regression) → step
 *     4 stays RED (exit 1). The pending-scenario mode must NOT mask this.
 *
 * `readFlipThresholdsNullness` is mocked so the DB read-back result is
 * deterministic; the rest of `db-readback.js` is preserved. The
 * what_would_flip turn returns NO set_factor_value chip, so step 4's
 * `assertFlipProposalPresent` fails `branch_a_flip_proposal_chip_absent` —
 * the only failure eligible for the downgrade. Default modes:
 * BRANCH_A_DISABLE unset (enforced) + BRANCH_A_PENDING_SCENARIO unset
 * (default true).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const writes: Array<{ path: string; content: string }> = [];
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    writeFileSync: vi.fn((path: string, content: string) => {
      writes.push({ path: String(path), content: String(content) });
    }),
  };
});

// Deterministic control of the DB flip-nullness read-back. `vi.hoisted` so
// the mutable is available to the hoisted `vi.mock` factory.
const ctl = vi.hoisted(() => ({
  flip: { status: 'all_null', detail: 'mock' } as { status: string; detail: string },
}));
vi.mock('../../../tools/v5-journey-replay/db-readback.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../tools/v5-journey-replay/db-readback.js')>();
  return {
    ...actual,
    readFlipThresholdsNullness: async () => ctl.flip,
  };
});

import {
  stubFetchRouter,
  REPLAY_FIXTURE_ANALYSIS_READY,
  REPLAY_FIXTURE_ASSISTANT_TEXT,
} from './_test-helpers.js';

let originalArgv: string[] = [];
let originalExit: typeof process.exit;
const consoleLogs: string[] = [];

class ProcessExitError extends Error {
  constructor(public code: number | string | null | undefined) {
    super(`process.exit(${code})`);
    this.name = 'ProcessExitError';
  }
}

describe('branch-a-canonical pending-scenario split (enforced + --db-readback)', () => {
  beforeEach(() => {
    writes.length = 0;
    consoleLogs.length = 0;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete process.env.OLUMI_REPLAY_API_KEY;
    // Enforced (not disabled) + pending-scenario mode at its default (on).
    vi.stubEnv('BRANCH_A_DISABLE', '');
    vi.stubEnv('BRANCH_A_PENDING_SCENARIO', '');
    // db-readback only reads from the mock, but the live path guards on creds
    // being present; provide harmless placeholders so no real client is built.
    vi.stubEnv('SUPABASE_URL', 'http://localhost:9');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only-not-real');
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      consoleLogs.push(a.map((x) => String(x)).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    originalArgv = process.argv;
    originalExit = process.exit;
    process.exit = ((code?: number | string | null | undefined) => {
      throw new ProcessExitError(code);
    }) as typeof process.exit;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    process.argv = originalArgv;
    process.exit = originalExit;
  });

  // Steps 1-3 pass; the what_would_flip turn carries NO set_factor_value chip
  // (so step 4 → chip_absent — the downgrade-eligible failure).
  function stubChipAbsent() {
    stubFetchRouter((url) => {
      if (url.endsWith('/healthz')) {
        return { status: 200, jsonValue: { ok: true, build: 'localdev', version: '0', service: 'assistants' } };
      }
      if (url.endsWith('/orchestrate/v2/turn')) {
        return {
          status: 200,
          jsonValue: {
            response_version: 2,
            assistant_text: REPLAY_FIXTURE_ASSISTANT_TEXT,
            suggested_actions: [{ id: 'c1', label: 'Chip', message: 'msg' }],
            analysis_ready: REPLAY_FIXTURE_ANALYSIS_READY,
          },
        };
      }
      return { status: 404, jsonValue: {} };
    });
  }

  async function run() {
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      'http://localhost:3000',
      '--out',
      '/tmp/v5-branch-a-pending-scenario.md',
      '--journey',
      'branch-a-canonical',
      '--db-readback',
    ];
    vi.resetModules();
    const mod = await import('../../../tools/v5-journey-replay/index.js');
    return mod.run();
  }

  it('chip absent + DB-confirmed all-null flips → step 4 pending-scenario (green, exit 0)', async () => {
    ctl.flip = { status: 'all_null', detail: 'entries=2 all null' };
    stubChipAbsent();
    await run(); // returns (no exit) — pending-scenario is a skip, not a failure

    expect(writes.length).toBe(1);
    const pack = writes[0]!.content;
    expect(pack).toMatch(/`1_draft_graph` \| \[PASS\] passed/);
    expect(pack).toMatch(/`3_what_would_flip` \| \[PASS\] passed/);
    expect(pack).toMatch(/`4_flip_proposal_present` \| \[SKIP\] skipped/);
    expect(pack).toMatch(/pending-scenario: staging produced no live flip-capable result/);
    // Steps 5-8 cascade as pending-scenario.
    for (const step of ['5_accept_proposal', '6_db_readback', '7_explain_leader_stale', '8_what_changed']) {
      expect(pack).toMatch(new RegExp(`\`${step}\` \\| \\[SKIP\\] skipped`));
    }
    // No real regression anywhere → green.
    expect(pack).not.toMatch(/\[FAIL\] failed/);
    expect(consoleLogs.some((l) => l.includes('PENDING-SCENARIO'))).toBe(true);
  });

  it('chip absent + DB shows a NON-null flip (emit regression) → step 4 RED (exit 1, NOT masked)', async () => {
    ctl.flip = { status: 'has_non_null', detail: 'entries=2 one finite flip_value' };
    stubChipAbsent();
    await expect(run()).rejects.toMatchObject({ name: 'ProcessExitError', code: 1 });

    const pack = writes[0]!.content;
    expect(pack).toMatch(/`4_flip_proposal_present` \| \[FAIL\] failed/);
    expect(pack).toMatch(/emit regression/);
    // The downgrade did NOT fire.
    expect(pack).not.toMatch(/`4_flip_proposal_present` \| \[SKIP\]/);
  });
});
