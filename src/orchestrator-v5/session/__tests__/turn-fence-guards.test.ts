/**
 * V5 TURN FENCE — the guards that keep the fence from quietly becoming
 * decoration.
 *
 * Three separate concerns, each of which has a documented way of rotting:
 *
 *  1. THE PURE CLASSIFIER. The ordering of `stopped` before `superseded`, and
 *     the refusal to resolve a malformed payload to `current`, are decisions —
 *     not consequences of the SQL. They are pinned without a client so a
 *     mutation to either is visible on its own.
 *
 *  2. THE PRODUCTION STORE ACTUALLY IMPLEMENTS THE OPTIONAL METHODS. The fence
 *     methods are optional on `SessionStore` (mirroring `countTurns`) so the
 *     dozens of existing test doubles are not forced to grow them. That makes
 *     "production always implements it" a claim in a comment — and a comment is
 *     exactly the hand-maintained mirror CLAUDE.md trap 12 is about. This
 *     derives it from the class.
 *
 *  3. THE MIGRATION'S LOAD-BEARING LINES. The claim RPC's `ON CONFLICT DO
 *     UPDATE` being a NO-OP is not cosmetic: if it ever assigned `stopped_at`
 *     (or a `DEFAULT`), a Stop that arrived before the claim would be silently
 *     erased and the turn would commit. Same for the service_role-only grants.
 *     File-text guards, not a live DB connection — that is stated rather than
 *     implied.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SupabaseSessionStore } from '../supabase-store.js';
import { classifyTurnFence, TURN_FENCE_RPC } from '../turn-fence.js';

// ═══════════════════════════════════════════════════════════════════════════
describe('classifyTurnFence — the decisions, not the SQL', () => {
  it('reads `current` only when claimed, not stopped, and at the max generation', () => {
    expect(
      classifyTurnFence({ claimed: true, stopped: false, generation: 7, max_generation: 7 }),
    ).toEqual({ verdict: 'current', generation: 7, maxGeneration: 7 });
  });

  it('prefers `stopped` over `superseded` when a turn is BOTH', () => {
    // The user pressed Stop AND a later turn arrived. `stopped` is the reason
    // they would recognise, and the UI's copy is keyed on it.
    expect(
      classifyTurnFence({ claimed: true, stopped: true, generation: 1, max_generation: 9 }).verdict,
    ).toBe('stopped');
  });

  it('reads `superseded` on a strictly older generation', () => {
    expect(
      classifyTurnFence({ claimed: true, stopped: false, generation: 1, max_generation: 2 }).verdict,
    ).toBe('superseded');
  });

  it('reads `unclaimed` when no fence row exists', () => {
    expect(
      classifyTurnFence({ claimed: false, stopped: false, generation: null, max_generation: 4 })
        .verdict,
    ).toBe('unclaimed');
  });

  it('NEVER resolves a malformed payload to `current`', () => {
    for (const payload of [null, undefined, 'nope', 42, {}]) {
      const verdict = classifyTurnFence(payload).verdict;
      expect(verdict).not.toBe('current');
    }
  });

  it('treats claimed-but-no-max as `unavailable`, not as a clear fence', () => {
    // A claimed turn's own row is in the table, so MAX cannot be null. Reading
    // this as `current` would turn a misparse into a licence to write.
    const evaluation = classifyTurnFence({
      claimed: true,
      stopped: false,
      generation: 3,
      max_generation: null,
    });
    expect(evaluation.verdict).toBe('unavailable');
    expect(evaluation.unavailableReason).toBe('claimed_without_max_generation');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the PRODUCTION store implements the optional fence methods', () => {
  it('SupabaseSessionStore has claimTurnFence and markTurnStopped', () => {
    // Derived from the prototype, so deleting either method fails HERE rather
    // than degrading every turn to `unfenced` in silence.
    const proto = SupabaseSessionStore.prototype as unknown as Record<string, unknown>;
    expect(typeof proto.claimTurnFence).toBe('function');
    expect(typeof proto.markTurnStopped).toBe('function');
    // ROADMAP 2.171: the post-Stop disclosure read. Optional on the interface
    // (doubles fail toward the ordinary copy), but production MUST implement
    // it — removing it would silently retire a Paul-ratified behaviour.
    expect(typeof proto.wasLatestScenarioTurnStopped).toBe('function');
    // ⭐ ROADMAP 2.236 — THE METHOD THAT CLOSES C-1, AND THE ONE THIS GUARD
    //   MOST NEEDS TO COVER. `recordExplicitTurnStop` gates the tombstone
    //   upsert behind `typeof store.turnFenceRowExists === 'function'` and
    //   fail-OPEN when it is absent, so on the production store its absence
    //   would not degrade politely: it would RESTORE the graph-destruction
    //   defect — a caller-invented `turn_id` allocating a fresh BIGSERIAL
    //   generation and superseding a live turn into losing its graph write.
    //
    //   ⚠ AND `turn-stop-authorization.test.ts` ASSERTS 200 FOR "a store
    //     without turnFenceRowExists", because dozens of hand-rolled doubles
    //     across the repo do not implement it. That assertion is correct about
    //     DOUBLES and would BLESS the method's deletion from PRODUCTION —
    //     green suite, defect back. `createMockSessionStore`'s
    //     `Required<SessionStore>` annotation constrains the double, not this
    //     class. THIS LINE is the only thing standing between a deletion and a
    //     silent regression, which is precisely the concern in this file's
    //     header, applied to the newest optional method.
    expect(typeof proto.turnFenceRowExists).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
const MIGRATION_PATH = fileURLToPath(
  new URL('../../../../supabase/migrations/20260731120000_v5_turn_fence.sql', import.meta.url),
);
const sql = readFileSync(MIGRATION_PATH, 'utf8');
/** Comment-stripped: grant/DDL assertions must match executable SQL, not prose. */
const code = sql
  .split('\n')
  .map((line) => {
    const idx = line.indexOf('--');
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join('\n');
const codeOneline = code.replace(/\s+/g, ' ');

describe('v5_turn_fence migration — the load-bearing text', () => {
  it('creates the table with a bigserial generation and a (scenario, turn) unique key', () => {
    expect(codeOneline).toContain('CREATE TABLE IF NOT EXISTS public.v5_turn_fence');
    expect(codeOneline).toMatch(/generation\s+BIGSERIAL\s+PRIMARY KEY/i);
    expect(codeOneline).toContain('UNIQUE (scenario_id, turn_id)');
  });

  it('the CLAIM upsert is a NO-OP that cannot clear an existing tombstone', () => {
    // The whole of arrival 5 rests on this line. `DO UPDATE SET scenario_id =
    // v5_turn_fence.scenario_id` exists only so the existing generation can be
    // RETURNED; the moment it touches stopped_at, a Stop racing the claim is
    // erased and the stopped turn commits.
    expect(codeOneline).toMatch(
      /ON CONFLICT \(scenario_id, turn_id\) DO UPDATE SET scenario_id = public\.v5_turn_fence\.scenario_id RETURNING generation/i,
    );
    const claimBody = code.slice(
      code.indexOf('FUNCTION public.v5_claim_turn_fence'),
      code.indexOf('FUNCTION public.v5_evaluate_turn_fence'),
    );
    expect(claimBody).not.toMatch(/stopped_at/i);
  });

  it('the STOP upsert is first-Stop-wins and derives already_committed from the turns table', () => {
    expect(codeOneline).toMatch(/SET stopped_at = COALESCE\(public\.v5_turn_fence\.stopped_at, now\(\)\)/i);
    expect(codeOneline).toContain('FROM public.v5_conversation_turns');
    expect(codeOneline).toContain("'already_committed'");
  });

  it('the three RPC names match the ones the application calls', () => {
    for (const fn of Object.values(TURN_FENCE_RPC)) {
      expect(code).toContain(`FUNCTION public.${fn}(`);
    }
  });

  it('is service_role-only: RLS on, and every function REVOKEd from anon/authenticated', () => {
    expect(codeOneline).toContain('ALTER TABLE public.v5_turn_fence ENABLE ROW LEVEL SECURITY');
    expect(codeOneline).toContain('REVOKE ALL ON public.v5_turn_fence FROM PUBLIC, anon, authenticated');
    for (const fn of Object.values(TURN_FENCE_RPC)) {
      // Supabase auto-GRANTs EXECUTE to anon + authenticated on every new
      // public function, so each revoke is load-bearing, not belt-and-braces.
      expect(codeOneline).toMatch(
        new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`, 'i'),
      );
      expect(codeOneline).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`, 'i'),
      );
    }
    expect(codeOneline).not.toMatch(/GRANT [^;]*ON FUNCTION public\.v5_(claim|evaluate|mark)[^;]*TO (anon|authenticated)/i);
  });

  it('every function pins search_path and runs SECURITY DEFINER', () => {
    const definers = code.match(/SECURITY DEFINER/gi) ?? [];
    const searchPaths = code.match(/SET search_path = public, pg_temp/gi) ?? [];
    expect(definers).toHaveLength(3);
    expect(searchPaths).toHaveLength(3);
  });

  it('states the migration-first ordering the application half depends on', () => {
    // The code fails CLOSED when the RPCs are absent, so "execute this first"
    // is not advice — it is a deploy precondition, and it must be impossible to
    // read this file without meeting it.
    expect(sql).toMatch(/MIGRATION-FIRST IS LOAD-BEARING/i);
    expect(sql).toMatch(/FAILS CLOSED/i);
  });
});
