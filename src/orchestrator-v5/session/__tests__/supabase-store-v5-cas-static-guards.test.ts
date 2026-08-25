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
