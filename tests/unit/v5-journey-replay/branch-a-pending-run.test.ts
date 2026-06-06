/**
 * V5 replay harness — Branch A pending-path run proof.
 *
 * Drives the full `branch-a-canonical` journey through a mocked service
 * (no live server) with BRANCH_A_ENFORCE unset — the default state until
 * PR #236 (feat/v5-p0-2-continuity) lands. Proves the contract the user
 * asked to see: steps 1-3 (draft → run_analysis → what_would_flip) run
 * today, and steps 4-8 are recorded as PENDING/skipped (not red), making
 * no HTTP calls. A clean run exits 0 (skips are not failures).
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

import {
  stubFetchRouter,
  REPLAY_FIXTURE_ANALYSIS_READY,
  REPLAY_FIXTURE_ASSISTANT_TEXT,
} from './_test-helpers.js';

let originalArgv: string[] = [];
let originalExit: typeof process.exit;
const consoleLogs: string[] = [];

describe('branch-a-canonical pending-path run (BRANCH_A_ENFORCE unset)', () => {
  beforeEach(() => {
    writes.length = 0;
    consoleLogs.length = 0;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete process.env.OLUMI_REPLAY_API_KEY;
    // Force pending mode regardless of ambient env.
    vi.stubEnv('BRANCH_A_ENFORCE', '');
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleLogs.push(args.map((a) => String(a)).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    originalArgv = process.argv;
    originalExit = process.exit;
    process.exit = ((code?: number | string | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    process.argv = originalArgv;
    process.exit = originalExit;
  });

  it('runs steps 1-3, marks steps 4-8 pending #236, makes no HTTP calls for pending steps, exits 0', async () => {
    process.argv = [
      'node',
      '/dev/null/v5-journey-replay/index.ts',
      '--base-url',
      'http://localhost:3000',
      '--out',
      '/tmp/v5-branch-a-pending.md',
      '--journey',
      'branch-a-canonical',
    ];

    let turnCallCount = 0;
    stubFetchRouter((url) => {
      if (url.endsWith('/healthz')) {
        return {
          status: 200,
          jsonValue: { ok: true, build: 'localdev', version: '0', service: 'assistants' },
        };
      }
      if (url.endsWith('/orchestrate/v2/turn')) {
        turnCallCount += 1;
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

    vi.resetModules();
    const mod = await import('../../../tools/v5-journey-replay/index.js');
    // A clean pending run has no failed rows → run() returns without exiting.
    await mod.run();

    // preflight (1) + steps 1-3 (3) = 4 turn POSTs. Steps 4-8 made none.
    expect(turnCallCount).toBe(4);

    expect(writes.length).toBe(1);
    const pack = writes[0]!.content;

    // Steps 1-3 passed.
    expect(pack).toMatch(/`1_draft_graph` \| \[PASS\] passed/);
    expect(pack).toMatch(/`2_run_analysis` \| \[PASS\] passed/);
    expect(pack).toMatch(/`3_what_would_flip` \| \[PASS\] passed/);

    // Steps 4-8 pending/skipped (not failed).
    for (const step of [
      '4_flip_proposal_present',
      '5_accept_proposal',
      '6_db_readback',
      '7_explain_leader_stale',
      '8_what_changed',
    ]) {
      const row = new RegExp(`\`${step}\` \\| \\[SKIP\\] skipped`);
      expect(pack).toMatch(row);
    }
    expect(pack).toMatch(/pending Branch A \(PR #236/);
    expect(pack).toMatch(/branch_a_enforced:\*\* no/);

    // No row is a failure → a pending run is green.
    expect(pack).not.toMatch(/\[FAIL\] failed/);

    // Console announced the pending steps.
    expect(consoleLogs.some((l) => l.includes('PENDING #236'))).toBe(true);
  });
});
