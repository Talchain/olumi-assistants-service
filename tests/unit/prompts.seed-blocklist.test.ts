/**
 * Required-gate regression pin for the seedDefaults() blocklist
 * (ROADMAP 1.30f — the "Routing prompt size 57643" test-env startup red).
 *
 * WHY THIS EXISTS AS A UNIT TEST:
 *
 * The defect: `PMS_TASK_ALIAS` (src/prompts/tracked.ts) resolves the
 * `routing` prompt through the `orchestrator` PMS task, but the
 * `orchestrator` task's REGISTERED CODE DEFAULT is the legacy cf-v28 V4
 * mega-prompt (~57.6k chars — far above the routing size guard's
 * EXPECTED_SYSTEM_CHARS_MAX). When seedDefaults() auto-seeded that default
 * into any FRESH store (the file store the admin integration tests boot
 * with, or a new PROMPTS_ENABLED deployment), buildRoutingPromptSnapshot()
 * resolved the seeded row as the routing prompt and the size guard
 * correctly refused to start the server:
 *
 *   "Routing prompt size 57643 outside expected range [...] (source=store).
 *    Refusing to start."
 *
 * PR #421 (d3d649456, 2026-07-11) fixed this by adding 'orchestrator' to
 * SEED_BLOCKLIST in src/prompts/repository.ts. But that fix was pinned only
 * by tests/integration/** suites (admin.models, admin.routes), which are
 * EXCLUDED from the required CI gate (vitest.required.config.ts) and run
 * only in the permanently-red advisory jobs — a broken alarm. A blocklist
 * regression would land invisibly. This unit test moves the pin into the
 * required gate.
 *
 * Mutation-proven 2026-07-17: removing 'orchestrator' from SEED_BLOCKLIST
 * in a throwaway worktree turns BOTH this test and the admin integration
 * suites red (the latter with the exact historical startup signature).
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { PromptRepository } from '../../src/prompts/repository.js';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';
import { getDefaultPrompts } from '../../src/prompts/loader.js';
import { pmsResolveTaskId } from '../../src/prompts/tracked.js';
import {
  EXPECTED_SYSTEM_CHARS_MAX,
  EXPECTED_SYSTEM_CHARS_MIN,
} from '../../src/orchestrator-v5/routing/prompt-loader.js';

// Per-run unique path: the file store treats ':memory:' as a literal file
// name, and shared literal paths race under parallel vitest forks (see the
// note in tests/integration/admin.models.test.ts).
const STORE_PATH = join(
  tmpdir(),
  `prompt-store-seed-blocklist-${process.pid}-${Date.now()}.json`,
);

let repo: PromptRepository;

beforeAll(async () => {
  registerAllDefaultPrompts();
  repo = new PromptRepository(undefined, STORE_PATH);
  await repo.initialize();
});

afterAll(() => {
  rmSync(STORE_PATH, { force: true });
});

describe('seedDefaults() blocklist (required-gate pin for PR #421)', () => {
  it('never materialises store rows for routing / m2_graph_review / orchestrator', async () => {
    const result = await repo.seedDefaults();

    // Sanity: seeding did run and materialised the non-blocked defaults.
    expect(result.seeded).toBeGreaterThan(0);

    // The pin: a fresh, fully-seeded store must have NO row for any
    // blocklisted task. If 'orchestrator' regresses off the blocklist, its
    // ~57.6k cf-v28 default lands on the row the routing alias resolves,
    // and every PROMPTS_ENABLED test-env boot dies at the size guard.
    for (const taskId of ['routing', 'm2_graph_review', 'orchestrator'] as const) {
      const rows = await repo.list({ taskId });
      expect(rows, `seedDefaults() must not seed '${taskId}'`).toEqual([]);
    }
  });

  it('danger precondition holds: the orchestrator default cannot pass the routing size guard', () => {
    const defaults = getDefaultPrompts();

    // The alias coupling that makes seeding 'orchestrator' dangerous: the
    // routing prompt resolves through the orchestrator PMS task.
    expect(pmsResolveTaskId('routing')).toBe('orchestrator');

    // The orchestrator task's registered code default is the legacy cf-v28
    // mega-prompt, larger than the routing guard allows. (If this ever
    // shrinks below the guard max, the blocklist entry stops being
    // load-bearing for the guard — re-evaluate both tests together.)
    expect(defaults.orchestrator).toBeDefined();
    expect(defaults.orchestrator!.length).toBeGreaterThan(EXPECTED_SYSTEM_CHARS_MAX);

    // The routing task's own default is guard-safe — the fallback a PMS
    // miss is designed to land on.
    expect(defaults.routing).toBeDefined();
    expect(defaults.routing!.length).toBeGreaterThanOrEqual(EXPECTED_SYSTEM_CHARS_MIN);
    expect(defaults.routing!.length).toBeLessThanOrEqual(EXPECTED_SYSTEM_CHARS_MAX);
  });
});
