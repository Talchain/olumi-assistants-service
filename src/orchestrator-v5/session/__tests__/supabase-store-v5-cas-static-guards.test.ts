/**
 * B1/B3 static guards — the SQL-side ORACLE, and the deploy-order doc.
 *
 * These do not claim to execute Postgres. They pin the two facts that make
 * `supabase-store-atomic-version-v5.test.ts`'s behavioural assertions MEAN
 * something, derived from the producer's own bytes rather than from a reading
 * of what the parameters ought to do:
 *
 *   1. `append_turn_atomic_v4` compares `p_expected_graph_identity_hash`
 *      against `v_current_hash`, and `v_current_hash` is read FROM
 *      `scenarios.graph_identity_hash`. Therefore supplying the expected value
 *      by re-reading that same column makes the comparison FALSE BY
 *      CONSTRUCTION — the CAS can never fire.
 *   2. `append_turn_atomic_v5` forwards the three CAS parameters to v4
 *      VERBATIM, so (1) governs the versioned path too.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const V4_MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/20260806120000_v5_turn_fence_first_write_exemption.sql',
    import.meta.url,
  ),
);
const V5_MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/20260824200000_c8_atomic_model_version_restore.sql',
    import.meta.url,
  ),
);
const FEATURE_FLAGS_PATH = fileURLToPath(
  new URL('../../../../Docs/FEATURE_FLAGS.md', import.meta.url),
);

/** Strip `--` line comments so a guard never matches prose about the code. */
function codeOnly(sql: string): string {
  return sql
    .split('\n')
    .map((line) => (line.indexOf('--') === -1 ? line : line.slice(0, line.indexOf('--'))))
    .join('\n');
}

const v4Code = codeOnly(readFileSync(V4_MIGRATION_PATH, 'utf8'));
const v5Code = codeOnly(readFileSync(V5_MIGRATION_PATH, 'utf8'));
const v4OneLine = v4Code.replace(/\s+/g, ' ');
const v5OneLine = v5Code.replace(/\s+/g, ' ');
const featureFlags = readFileSync(FEATURE_FLAGS_PATH, 'utf8');

describe('B1 oracle — why a re-read of scenarios.graph_identity_hash cannot be the CAS base', () => {
  it('POSITIVE CONTROL: the v4 and v5 migration sources are non-empty and were actually read', () => {
    // Without this, every "toContain" below could pass vacuously on an empty
    // string (a comparison of two nothings agrees with everything).
    expect(v4Code.length).toBeGreaterThan(1000);
    expect(v5Code.length).toBeGreaterThan(1000);
    expect(v4OneLine).toContain('append_turn_atomic_v4');
    expect(v5OneLine).toContain('append_turn_atomic_v5');
  });

  it('v4 reads v_current_hash FROM scenarios.graph_identity_hash under FOR UPDATE', () => {
    expect(v4OneLine).toContain(
      'SELECT user_id, graph_identity_hash, (graph IS NOT NULL) INTO v_user_id, v_current_hash',
    );
    expect(v4OneLine).toMatch(/INTO v_user_id, v_current_hash[^;]*FROM scenarios[^;]*FOR UPDATE/);
  });

  it('v4 compares p_expected_graph_identity_hash against that SAME v_current_hash', () => {
    expect(v4OneLine).toContain(
      'v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash',
    );
  });

  it('v4 skips the comparison entirely when the expected base is NULL — the honest uninstrumented case', () => {
    // This is what makes `undefined -> SQL NULL` an HONEST "not CAS'd" rather
    // than a tautological "passed".
    expect(v4OneLine).toContain('p_cas_enforce AND p_expected_graph_identity_hash IS NOT NULL');
  });

  it('v5 forwards the three CAS parameters to v4 VERBATIM, so v4 governs the versioned path', () => {
    expect(v5OneLine).toMatch(
      /public\.append_turn_atomic_v4\([^)]*p_expected_graph_identity_hash, p_incoming_graph_identity_hash, p_cas_enforce, p_fence_generation[^)]*\)/,
    );
  });

  it('v5 REQUIRES a 64-hex incoming hash in every mode — why p_incoming is not mode-derived', () => {
    // v4's 'off' branch sends a NULL incoming hash; v5 cannot, because it
    // stamps the version row. This pins why the fix leaves p_incoming
    // unconditional while deriving only p_cas_enforce.
    expect(v5OneLine).toContain('p_incoming_graph_identity_hash IS NULL');
    expect(v5OneLine).toContain('both durable hashes must be 64-hex');
  });
});

describe('B3 — the deploy order is documented, not just the rollback order', () => {
  it('POSITIVE CONTROL: FEATURE_FLAGS.md was read and carries the versions flag row', () => {
    expect(featureFlags.length).toBeGreaterThan(1000);
    expect(featureFlags).toContain('CEE_MODEL_VERSIONS_ENABLED');
  });

  it('documents DEPLOY ORDER naming migration 20260824200000', () => {
    expect(featureFlags).toContain('DEPLOY ORDER');
    const deployClause = featureFlags.slice(featureFlags.indexOf('DEPLOY ORDER'));
    expect(deployClause).toContain('20260824200000');
  });

  it('still documents the ROLLBACK ORDER — the deploy clause did not displace it', () => {
    // CONTRAST: both orders must be present; adding one must not silently
    // remove the other.
    expect(featureFlags).toContain('ROLLBACK ORDER');
  });

  it('states the user-visible cost of deploying before the migration', () => {
    const deployClause = featureFlags.slice(featureFlags.indexOf('DEPLOY ORDER'));
    expect(deployClause).toContain('PGRST202');
    expect(deployClause.toLowerCase()).toContain('not persisted');
  });
});

/**
 * CODEX C8-A REVIEW — DEFECT 1: the null-base CAS bypass.
 *
 * The behavioural proof lives in the C4 oracle (N1c), which needs a real
 * Postgres and is excluded from the required gate. These guards are what the
 * required gate CAN see: the SQL bytes that make N1c's outcome inevitable.
 * They are derived from the producer, not from a reading of intent.
 *
 * The defect: v4's CAS is guarded by `p_expected_graph_identity_hash IS NOT
 * NULL AND v_current_hash IS NOT NULL`. Those are correct for v4, whose
 * parameter DEFAULTS to NULL and therefore genuinely means "no expectation
 * supplied". They are wrong for a caller that READ the base and found it
 * absent — on an unstamped scenario every concurrent writer sends NULL, both
 * guards short-circuit, and no CAS runs for any of them.
 */
describe('C8-A defect 1 — known-base CAS (SQL oracle)', () => {
  const v5Body = v5Code.slice(
    v5Code.indexOf('CREATE OR REPLACE FUNCTION public.append_turn_atomic_v5'),
  );
  /**
   * The GUARD, isolated. Anchored on `AND p_expected_base_known` — the
   * conjunct — because a bare `p_expected_base_known` also matches the
   * PARAMETER DECLARATION in the signature, and slicing from there silently
   * spans the whole validation preamble instead of the predicate. A guard
   * that measures the wrong region is exactly the instrument defect these
   * files exist to catch.
   */
  const guardStart = v5Body.indexOf('AND p_expected_base_known');
  const guard = v5Body.slice(
    guardStart,
    v5Body.indexOf('END IF;', guardStart) + 'END IF;'.length,
  );

  it('PROBE LIVENESS: the guard region was actually located and is non-empty', () => {
    expect(guardStart, 'the guard conjunct was not found — every assertion below would be vacuous').toBeGreaterThan(-1);
    expect(guard.length).toBeGreaterThan(80);
    expect(guard).toContain('RAISE EXCEPTION');
  });

  it('v5 declares p_expected_base_known, defaulted FALSE so every existing caller keeps delegating', () => {
    expect(
      /p_expected_base_known\s+BOOLEAN\s+DEFAULT\s+FALSE/i.test(v5Body),
      'the parameter must exist AND default FALSE. Without the default, adding ' +
        'it silently changes every 30-argument caller — including the C4 ' +
        "oracle's delegation pins — from delegation to enforcement.",
    ).toBe(true);
  });

  it('v5 compares the base with IS DISTINCT FROM — null-safe, no IS NOT NULL bypass', () => {
    expect(
      /v_current_hash\s+IS\s+DISTINCT\s+FROM\s+p_expected_graph_identity_hash/i.test(
        guard,
      ),
      'a null-safe comparison is the whole point: `=` returns NULL (falsy) ' +
        'when either side is NULL, which is the bypass being closed.',
    ).toBe(true);
    expect(
      /p_expected_graph_identity_hash\s+IS\s+NOT\s+NULL\s+AND\s+v_current_hash\s+IS\s+NOT\s+NULL/i.test(
        guard,
      ),
      "v5's own guard must not reproduce v4's two-NULL bypass — that is the " +
        'defect, not the fix.',
    ).toBe(false);
  });

  it('v5 PRESERVES the first-write exemption, so an unstamped legacy row is not bricked', () => {
    expect(
      /NOT\s*\(\s*v_current_hash\s+IS\s+NULL\s+AND\s+p_expected_graph_identity_hash\s+IS\s+NOT\s+NULL\s*\)/i.test(
        guard,
      ),
      'Without this exemption the guard refuses every scenario whose graph ' +
        'exists but whose graph_identity_hash column was never stamped — a ' +
        'far larger outage than the lost update it closes. The migration that ' +
        'introduced v4\'s equivalent is literally named after this exemption.',
    ).toBe(true);
  });

  it('the CAS conflict is raised on the canonical SQLSTATE the client already maps', () => {
    expect(
      guard.includes('OLGC1'),
      'a bespoke SQLSTATE would surface as an opaque StateCommitFailedError ' +
        'instead of the typed GraphStaleWriteError the caller handles.',
    ).toBe(true);
  });

  it('the REVOKE/GRANT signatures track the new arity (a stale grant leaves v5 unexecutable)', () => {
    const grants = v5Code.match(
      /(?:REVOKE|GRANT)\s+EXECUTE\s+ON\s+FUNCTION\s+public\.append_turn_atomic_v5\s*\(([^)]*)\)/gi,
    );
    expect(grants, 'both a REVOKE and a GRANT must be present').toHaveLength(2);
    for (const g of grants!) {
      expect(
        g.trim().endsWith('BOOLEAN\n)') || /,\s*BOOLEAN\s*\)$/.test(g.trim()),
        'the grant signature must end with the new BOOLEAN parameter, or it ' +
          'names a function signature that no longer exists and the GRANT ' +
          'silently applies to nothing.',
      ).toBe(true);
    }
  });
});

/**
 * ROLLBACK-SIGNATURE DRIFT — a rollback that silently rolls nothing back.
 *
 * `DROP FUNCTION IF EXISTS f(<types>)` matches on the ARGUMENT TYPE LIST. Change
 * the forward function's arity without changing the rollback's list and the
 * DROP matches nothing, `IF EXISTS` swallows it, and the script exits 0 having
 * left the function in place. The operator reads a successful rollback; the
 * database still carries the thing they meant to remove.
 *
 * This is a hand-maintained mirror of the forward signature, so it is DERIVED
 * here instead of restated: the guard reads the forward CREATE's parameter
 * count and asserts the rollback's DROP list matches it.
 */
describe('C8-A rollback signature tracks the forward migration', () => {
  const rollback = readFileSync(
    fileURLToPath(
      new URL(
        '../../../../supabase/migrations/rollback/20260824200000_c8_atomic_model_version_restore_rollback.sql.do-not-apply',
        import.meta.url,
      ),
    ),
    'utf8',
  );

  function paramCountOfForwardV5(): number {
    const start = v5Code.indexOf(
      'CREATE OR REPLACE FUNCTION public.append_turn_atomic_v5(',
    );
    const open = v5Code.indexOf('(', start);
    const close = v5Code.indexOf(')\nRETURNS', open);
    return v5Code
      .slice(open + 1, close)
      .split(',')
      .filter((p) => p.trim().length > 0).length;
  }

  function dropTypeCountOfRollbackV5(): number {
    const start = rollback.indexOf(
      'DROP FUNCTION IF EXISTS public.append_turn_atomic_v5(',
    );
    const open = rollback.indexOf('(', start);
    const close = rollback.indexOf(')', open);
    return rollback
      .slice(open + 1, close)
      .split(',')
      .filter((p) => p.trim().length > 0).length;
  }

  it('PROBE LIVENESS: both signatures were located and are non-trivial', () => {
    expect(paramCountOfForwardV5()).toBeGreaterThan(20);
    expect(dropTypeCountOfRollbackV5()).toBeGreaterThan(20);
  });

  it('the rollback DROP lists exactly as many argument types as v5 declares parameters', () => {
    expect(
      dropTypeCountOfRollbackV5(),
      'the rollback DROP signature has drifted from the forward CREATE. ' +
        'PostgreSQL will match no function, IF EXISTS will swallow it, and the ' +
        'rollback will report success while append_turn_atomic_v5 survives.',
    ).toBe(paramCountOfForwardV5());
  });

  it('the rollback still drops the function the flag must be turned off BEFORE removing', () => {
    // Deploy-order coupling, pinned so the ordering note cannot rot silently:
    // the turn path calls this RPC whenever a version carrier is built, so
    // dropping it while CEE_MODEL_VERSIONS_ENABLED is live breaks turn writes.
    expect(rollback).toContain(
      'DROP FUNCTION IF EXISTS public.append_turn_atomic_v5(',
    );
  });
});
