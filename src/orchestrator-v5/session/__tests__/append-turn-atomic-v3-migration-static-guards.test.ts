/**
 * append_turn_atomic_v3 (graph CAS) migration — SQL-text static guards.
 *
 * This lane cannot connect to a live database in CI, so — exactly like
 * model-management/__tests__/migration-static-guards.test.ts — these are
 * cheap textual guardrails that pin the load-bearing lines of the migration
 * FILE so a later edit cannot silently drop them. They assert the file's
 * text, not a live database.
 *
 * The DB behaviour these guard is the DB half of POC-BOARD item 3: an
 * IN-TRANSACTION compare-and-swap under FOR UPDATE that rejects a stale-base
 * graph write with SQLSTATE OLGC1 (the app maps it to GraphStaleWriteError —
 * retained as rollback evidence beside the v5 successor tests. Mutation anchor: delete the
 * CAS `IF p_cas_enforce … RAISE … OLGC1` block and the "in-transaction CAS"
 * assertions below go red — proving the guard bites.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/20260717120000_v5_append_turn_atomic_v3_graph_cas.sql',
    import.meta.url,
  ),
);
const ROLLBACK_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/rollback/20260717120000_v5_append_turn_atomic_v3_graph_cas_rollback.sql.do-not-apply',
    import.meta.url,
  ),
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');
const rollback = readFileSync(ROLLBACK_PATH, 'utf8');

/** Comment-stripped view — executable-SQL assertions must not match prose. */
const code = sql
  .split('\n')
  .map((line) => {
    const idx = line.indexOf('--');
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join('\n');
const codeOneline = code.replace(/\s+/g, ' ');

describe('append_turn_atomic_v3 migration — execution posture (Paul-gated)', () => {
  it('header declares AUTHORED-not-executed + Paul-gated with a pending execution date', () => {
    expect(sql).toMatch(/AUTHORED AS CODE — NOT YET EXECUTED/);
    expect(sql).toMatch(/Paul-gated/);
    expect(sql).toMatch(/Date executed:\s*\(pending/);
    // The design source of truth is named so the migration and proposal cannot drift.
    expect(sql).toContain('Docs/v5/proposals/append-turn-atomic-v3-graph-cas.md');
  });
});

describe('append_turn_atomic_v3 migration — anchor column', () => {
  it('adds scenarios.graph_identity_hash as a nullable TEXT column (IF NOT EXISTS)', () => {
    expect(codeOneline).toMatch(
      /ALTER TABLE public\.scenarios ADD COLUMN IF NOT EXISTS graph_identity_hash TEXT NULL/,
    );
  });
  it('the column is app-computed only — the comment forbids DB derivation', () => {
    expect(sql).toMatch(/COMPUTED BY THE APP/);
    expect(sql).toMatch(/never derives it/);
  });
});

describe('append_turn_atomic_v3 migration — distinct name (PostgREST ambiguity class)', () => {
  it('creates a DISTINCTLY named function — never an overload of append_turn_atomic / _v2', () => {
    expect(codeOneline).toMatch(/CREATE OR REPLACE FUNCTION public\.append_turn_atomic_v3\(/);
    // No CREATE targeting the base names (which would reintroduce the V5 Step 4
    // "could not choose the best candidate function" outage class).
    expect(code).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.append_turn_atomic\(/);
    expect(code).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.append_turn_atomic_v2\(/);
  });
});

describe('append_turn_atomic_v3 migration — backward compatibility (v2-equivalent when CAS absent)', () => {
  it('all three CAS params are optional with v2-equivalent defaults', () => {
    expect(codeOneline).toMatch(/p_expected_graph_identity_hash TEXT\s+DEFAULT NULL/);
    expect(codeOneline).toMatch(/p_incoming_graph_identity_hash TEXT\s+DEFAULT NULL/);
    expect(codeOneline).toMatch(/p_cas_enforce\s+BOOLEAN DEFAULT FALSE/);
  });
});

describe('append_turn_atomic_v3 migration — the in-transaction CAS (item 3 core)', () => {
  const fnBody = code.slice(
    code.indexOf('CREATE OR REPLACE FUNCTION public.append_turn_atomic_v3('),
    code.indexOf('$$;') + 3,
  );

  it('takes a FOR UPDATE row lock on the scenarios read (serialises concurrent writers)', () => {
    expect(fnBody).toMatch(
      /SELECT user_id, graph_identity_hash\s+INTO v_user_id, v_current_hash\s+FROM scenarios\s+WHERE id = p_scenario_id\s+FOR UPDATE/,
    );
  });

  it('the enforced compare is guarded by p_cas_enforce AND uses IS DISTINCT FROM against the expected base', () => {
    // The load-bearing predicate: enforce ON, expected present, current present,
    // current != expected. Deleting this block is the mutation anchor.
    expect(fnBody).toMatch(/IF p_cas_enforce/);
    expect(fnBody).toMatch(
      /v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash/,
    );
  });

  it('self-noop is exempt: incoming == current is always allowed even under enforce', () => {
    expect(fnBody).toMatch(
      /p_incoming_graph_identity_hash IS NULL\s+OR p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash/,
    );
  });

  it('a divergent enforced write raises the typed OLGC1 SQLSTATE (rolls the whole txn back)', () => {
    expect(fnBody).toMatch(/RAISE EXCEPTION USING\s+ERRCODE = 'OLGC1'/);
    // Exactly one OLGC1 raise in the function.
    expect((fnBody.match(/ERRCODE = 'OLGC1'/g) ?? []).length).toBe(1);
  });

  it('the UPDATE stamps graph_identity_hash in lock-step with scenarios.graph', () => {
    expect(fnBody).toMatch(
      /UPDATE scenarios\s+SET graph = p_graph,\s+graph_identity_hash = p_incoming_graph_identity_hash/,
    );
  });

  it('conflict-replay (ON CONFLICT DO NOTHING → NOT FOUND) returns the existing id BEFORE the CAS block (idempotency)', () => {
    const replayIdx = fnBody.indexOf('ON CONFLICT (scenario_id, turn_id) DO NOTHING');
    const replayReturnIdx = fnBody.indexOf('RETURN v_turn_id;', replayIdx);
    const casIdx = fnBody.indexOf("ERRCODE = 'OLGC1'");
    // The replay return must sit between the INSERT…ON CONFLICT and the CAS
    // raise, so a retried (already-committed) turn never hits CAS.
    expect(replayIdx).toBeGreaterThan(-1);
    expect(replayReturnIdx).toBeGreaterThan(replayIdx);
    expect(casIdx).toBeGreaterThan(replayReturnIdx);
  });

  it('the CAS compare lives inside the p_graph write block (non-graph turns never CAS)', () => {
    const graphBlockIdx = fnBody.indexOf('IF p_graph IS NOT NULL THEN');
    const casIdx = fnBody.indexOf('IF p_cas_enforce');
    expect(graphBlockIdx).toBeGreaterThan(-1);
    expect(casIdx).toBeGreaterThan(graphBlockIdx);
  });
});

describe('append_turn_atomic_v3 migration — security posture (A4 lesson)', () => {
  it('SECURITY DEFINER with a pinned search_path', () => {
    expect(codeOneline).toMatch(/SECURITY DEFINER/);
    expect(codeOneline).toMatch(/SET search_path = pg_catalog, public/);
  });

  it('REVOKE EXECUTE from PUBLIC, anon AND authenticated', () => {
    expect(codeOneline).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.append_turn_atomic_v3\([^)]*\) FROM PUBLIC, anon, authenticated/,
    );
  });

  it('GRANT EXECUTE to service_role ONLY (never authenticated/anon)', () => {
    expect(codeOneline).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.append_turn_atomic_v3\([^)]*\) TO service_role/,
    );
    const grants = code.match(/GRANT EXECUTE[^;]*/g) ?? [];
    expect(grants.length).toBe(1);
    for (const grant of grants) {
      expect(grant).not.toMatch(/\b(authenticated|anon|PUBLIC)\b/);
      expect(grant).toMatch(/service_role/);
    }
  });
});

describe('append_turn_atomic_v3 migration — rollback', () => {
  it('do-not-apply rollback drops the function AND the column, in that order', () => {
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS public\.append_turn_atomic_v3\(/);
    expect(rollback).toMatch(/DROP COLUMN IF EXISTS graph_identity_hash/);
    const fnIdx = rollback.indexOf('DROP FUNCTION IF EXISTS public.append_turn_atomic_v3');
    const colIdx = rollback.indexOf('DROP COLUMN IF EXISTS graph_identity_hash');
    expect(fnIdx).toBeGreaterThan(-1);
    expect(colIdx).toBeGreaterThan(fnIdx); // function before column
  });
});
