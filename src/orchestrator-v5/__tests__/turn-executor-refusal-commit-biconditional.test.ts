/**
 * P0 — THE ANALYSE REFUSAL MUST SURVIVE ITS OWN COMMIT.
 *
 * Witnessed on deployed staging 2026-08-29 (CEE build `fc08ac6`, guest
 * scenario `cc591488-…`): three consecutive composer `stage: "analyse"` turns
 * returned HTTP 500 `turn_commit` / `state_commit_failed_or_turn_runtime_failure`
 * with `stages_completed` ending at `handler_recovery` — the honest, specific
 * refusal was COMPOSED and then discarded, and the user saw only
 * "Something went wrong on our side."
 *
 * Root cause, read at the live Render log rather than inferred from the error
 * string (which names two different failures under one code):
 *
 *   append_turn_atomic_v2 RPC failed: new row for relation
 *   "v5_conversation_turns" violates check constraint
 *   "v5_conversation_turns_handler_id_biconditional"
 *
 * That constraint (supabase/migrations/20260417160000_v5_session_store.sql) is
 *
 *   CHECK ((turn_class = 'handler') = (handler_id IS NOT NULL))
 *
 * a strict BICONDITIONAL. The recovery arm in `turn-executor.ts` committed
 * `turn_class: 'direct_answer'` together with `handler_id: 'run_analysis'`
 * whenever it persisted an analysis-refusal continuity fact — a pair the
 * database rejects. The chip_click arm
 * (`handlers/chip-click-dispatch.ts`) commits `turn_class: 'handler'` with the
 * same `handler_id`, which is why the deployed Rerun control refused CLEANLY
 * on the identical graph in the same minute. The two arms disagreed about the
 * same event (CLAUDE.md trap 21).
 *
 * WHY EVERY EXISTING TEST WAS GREEN: the executor specs mock
 * `getSessionStore().append`, and a mock accepts any (turn_class, handler_id)
 * pair. The only enforcer of this invariant lived in Postgres, so no unit test
 * in the estate could observe the violation. These tests move the invariant to
 * where the specs can see it, by asserting the SHAPE OF THE WRITE that reaches
 * the store.
 *
 * The invariant below is written against the SPEC (the constraint), not
 * against the failure mode — so it also REDs on the opposite violation
 * (`turn_class: 'handler'` with a null `handler_id`).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';


import { log,setTestSink } from '../../utils/telemetry.js';




interface CapturedWrite {
  readonly turn_class?: unknown;
  readonly handler_id?: unknown;
  readonly handler_facts?: readonly unknown[];
}

const appendCalls: CapturedWrite[] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write as CapturedWrite);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

















// A value no other fact in this file carries, so the success twin binds to
// THIS handler's own output by identity rather than to composer copy that a
// different turn could also produce (CLAUDE.md trap 19).




/**
 * THE SPEC, restated from the migration rather than from the symptom.
 * `v5_conversation_turns_handler_id_biconditional`:
 *   CHECK ((turn_class = 'handler') = (handler_id IS NOT NULL))
 */


let events: Array<{ event: string; data: Record<string, unknown> }> = [];
let warnSpy: ReturnType<typeof vi.spyOn> | null = null;
let errorSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  events = [];
  appendCalls.length = 0;
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setTestSink(null);
  warnSpy?.mockRestore();
  errorSpy?.mockRestore();
  vi.restoreAllMocks();
});

describe('TurnExecutor — the analyse refusal survives its own commit', () => {
  // The premise this whole file rests on is DERIVED from the migration, not
  // mirrored by hand: if the constraint is ever changed, these tests are
  // asserting a rule the database no longer has, and that must fail loudly
  // rather than pass for a stale reason (CLAUDE.md trap 12).
  it('the biconditional this file enforces is still the deployed constraint', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const migration = readFileSync(
      path.resolve(here, '../../../supabase/migrations/20260417160000_v5_session_store.sql'),
      'utf8',
    );
    expect(migration).toContain('v5_conversation_turns_handler_id_biconditional');
    expect(migration.replace(/\s+/g, ' ')).toContain(
      "CHECK ((turn_class = 'handler') = (handler_id IS NOT NULL))",
    );
  });

  // THE DEFECT. Both continuity causes, so the guard is not pinned to one
  // string — a fix that special-cases `analysis_not_ready` alone still REDs.


  // OPPOSITE-DIRECTION TWIN. The lazy fix — always commit `turn_class:
  // 'handler'` on the recovery arm — satisfies the database for the refusal
  // case and breaks it for every other recoverable cause, which persists no
  // handler fact and must keep `handler_id: null`. A recovery that is not an
  // analysis refusal must not acquire a handler identity.


  // THE SUCCESS TWIN. A fix that stops discarding refusals must not start
  // accepting states that are genuinely invalid, and must not disturb the
  // turn that legitimately succeeds: it still commits and still returns its
  // own result.

});
