/**
 * append_turn_atomic_v5 — REPLAY IS DECIDED BEFORE CAS. SQL-text static guards,
 * the same convention as the v3/v4 guards beside this file: CI cannot reach a
 * live database, so these pin the load-bearing ORDER of the migration FILE so a
 * later edit cannot silently restore the defect.
 *
 * THE DEFECT THESE PIN. 20260824200000 evaluates v5's null-safe CAS ABOVE the
 * turn pre-existence lookup. v4 does the opposite and says so
 * (20260806120000:298-305, "SKIP CAS ENTIRELY and return the existing row id —
 * retry safety"). So replaying an already-committed turn raised OLGC1 whenever
 * the graph had moved on since — which is exactly the state an interrupted
 * client replays from, and it fails in the direction that invites re-applying a
 * change that already landed.
 *
 * ⭐ THE DISCRIMINATING PAIR. Ordering alone is not evidence that this test can
 * SEE an ordering: the ROLLBACK file carries the original, defective order, so
 * every ordering assertion below is run against BOTH files and must come out
 * opposite ways. A test that passed on both would be pinning nothing.
 *
 * Mutation anchors: move the lookup back below the CAS and the ordering
 * assertions go red; delete the `IF NOT v_turn_preexisting THEN` guard and the
 * guard assertion goes red; alter any conjunct of the CAS predicate and the
 * byte-parity assertion goes red (the fix must not change the predicate).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIX_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/20260920210000_v5_append_v5_replay_precedes_cas.sql',
    import.meta.url,
  ),
);
const ROLLBACK_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/rollback/20260920210000_v5_append_v5_replay_precedes_cas_rollback.sql.do-not-apply',
    import.meta.url,
  ),
);
const ORIGIN_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/20260824200000_c8_atomic_model_version_restore.sql',
    import.meta.url,
  ),
);

/** Comment-stripped view — executable-SQL assertions must not match prose. */
function executable(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

/** The v5 function body only. The files also define siblings; order across
 *  functions would be a different claim from order WITHIN v5. */
function v5Body(sql: string): string {
  const lines = executable(sql).split('\n');
  const start = lines.findIndex((l) =>
    l.startsWith('CREATE OR REPLACE FUNCTION public.append_turn_atomic_v5('),
  );
  expect(start).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && l.trimEnd() === '$$;');
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join('\n');
}

const fix = v5Body(readFileSync(FIX_PATH, 'utf8'));
const rolledBack = v5Body(readFileSync(ROLLBACK_PATH, 'utf8'));
const origin = v5Body(readFileSync(ORIGIN_PATH, 'utf8'));

const LOOKUP_MARKER = 'v_turn_preexisting := FOUND;';
const CAS_PREDICATE_HEAD = 'IF p_cas_enforce';

/** Index of a marker that MUST occur exactly once — a second occurrence would
 *  make every ordering claim below ambiguous rather than false. */
function soleIndexOf(body: string, marker: string): number {
  const first = body.indexOf(marker);
  expect(first, `marker absent: ${marker}`).toBeGreaterThanOrEqual(0);
  expect(
    body.indexOf(marker, first + 1),
    `marker occurs more than once, ordering is ambiguous: ${marker}`,
  ).toBe(-1);
  return first;
}

describe('append_turn_atomic_v5 — replay precedes CAS (migration static guards)', () => {
  it('the fix looks up the pre-existing turn BEFORE evaluating CAS', () => {
    expect(soleIndexOf(fix, LOOKUP_MARKER)).toBeLessThan(
      soleIndexOf(fix, CAS_PREDICATE_HEAD),
    );
  });

  it('⭐ CONTRAST CONTROL — the rollback carries the opposite order, so the assertion above discriminates', () => {
    expect(soleIndexOf(rolledBack, CAS_PREDICATE_HEAD)).toBeLessThan(
      soleIndexOf(rolledBack, LOOKUP_MARKER),
    );
  });

  it('⭐ CONTRAST CONTROL — the ORIGINAL 20260824200000 carries the defective order too', () => {
    expect(soleIndexOf(origin, CAS_PREDICATE_HEAD)).toBeLessThan(
      soleIndexOf(origin, LOOKUP_MARKER),
    );
  });

  it('the CAS block is guarded by the replay marker, and only in the fix', () => {
    expect(fix).toContain('IF NOT v_turn_preexisting THEN');
    expect(rolledBack).not.toContain('IF NOT v_turn_preexisting THEN');
    expect(origin).not.toContain('IF NOT v_turn_preexisting THEN');
  });

  it('the guard OPENS before the CAS predicate and the predicate sits inside it', () => {
    const guard = soleIndexOf(fix, 'IF NOT v_turn_preexisting THEN');
    const cas = soleIndexOf(fix, CAS_PREDICATE_HEAD);
    expect(guard).toBeLessThan(cas);
    // the guard's own END IF must come after the predicate, or the predicate is
    // outside the block the guard claims to wrap
    expect(fix.lastIndexOf('END IF;')).toBeGreaterThan(cas);
  });

  it('⛔ the CAS PREDICATE ITSELF is byte-identical to the original — this fix reorders, it does not re-specify', () => {
    const conjuncts = [
      'p_cas_enforce',
      'p_expected_base_known',
      'v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash',
      'p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash',
      'NOT (v_current_hash IS NULL AND p_expected_graph_identity_hash IS NOT NULL)',
    ];
    for (const conjunct of conjuncts) {
      expect(fix, `conjunct dropped: ${conjunct}`).toContain(conjunct);
      expect(origin, `control: conjunct absent from the original: ${conjunct}`).toContain(
        conjunct,
      );
    }
    // and no conjunct was ADDED: the predicate's AND-count must match
    const andCount = (body: string) => {
      const from = body.indexOf(CAS_PREDICATE_HEAD);
      const to = body.indexOf('THEN', from);
      return (body.slice(from, to).match(/\bAND\b/g) ?? []).length;
    };
    expect(andCount(fix)).toBe(andCount(origin));
  });

  it('the replay-identity guards survive — a replay with a different mutation id is still refused', () => {
    expect(fix).toContain("USING ERRCODE = 'MV422'");
    expect(fix).toContain("USING ERRCODE = 'MV409'");
    // and the delegation to v4 is untouched: v4 is a no-op on a replay, which
    // is what keeps MV409 ("canonical replay returned another turn row")
    // meaningful rather than vacuous.
    expect(fix).toContain('v_turn_id := public.append_turn_atomic_v4(');
  });

  it('block structure balances — one more IF and one more END IF than the original, and no more', () => {
    const count = (body: string, re: RegExp) => (body.match(re) ?? []).length;
    expect(count(fix, /^\s*IF\s/gm)).toBe(count(origin, /^\s*IF\s/gm) + 1);
    expect(count(fix, /END IF;/g)).toBe(count(origin, /END IF;/g) + 1);
    // nothing else moved: the RAISE and RETURN inventories are unchanged
    expect(count(fix, /RAISE /g)).toBe(count(origin, /RAISE /g));
    expect(count(fix, /RETURN /g)).toBe(count(origin, /RETURN /g));
  });
});
