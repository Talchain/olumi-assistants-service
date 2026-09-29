/**
 * create_model_version / restore_model_version — DEDUPE IS DECIDED BEFORE CAS.
 * SQL-text static guards, same convention as the append_turn_atomic_v3/v4/v5
 * guards: CI cannot reach a live database, so these pin the load-bearing ORDER
 * of the migration FILE so a later edit cannot silently restore the defect.
 *
 * THE DEFECT THESE PIN. Both functions raised MV409 on their optional
 * in-transaction CAS BEFORE reaching their dedupe arm. A post-commit retry sends
 * the same expected base and the same target; after the first call committed the
 * head IS the target, so the CAS compares base-vs-target, fails, and raises —
 * although the dedupe nine lines below would have matched exactly and returned
 * `deduped: true`. `restore_model_version`'s own header claims that dedupe "also
 * makes post-commit RETRIES of an identical call idempotent end-to-end"; the
 * ordering defeated the guarantee the file itself states.
 *
 * ⭐ THE DISCRIMINATING PAIR. An ordering assertion that has never seen the other
 * ordering is pinning nothing, so every claim below runs against BOTH the fix and
 * the files that carry the DEFECTIVE order (the rollback, and the original
 * 20260705120000), and must come out opposite ways.
 *
 * Mutation anchors: move either dedupe back below its CAS and the ordering
 * assertions go red; alter either CAS predicate and the byte-parity assertion
 * goes red (this fix moves blocks, it does not rewrite them).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIX_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/20260920220000_v5_model_versions_dedupe_precedes_cas.sql',
    import.meta.url,
  ),
);
const ROLLBACK_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/rollback/20260920220000_v5_model_versions_dedupe_precedes_cas_rollback.sql.do-not-apply',
    import.meta.url,
  ),
);
const ORIGIN_PATH = fileURLToPath(
  new URL('../../../../supabase/migrations/20260705120000_v5_model_versions.sql', import.meta.url),
);

/** One function's text only. Order ACROSS functions is a different claim. */
function fnBody(sql: string, name: string): string {
  const lines = sql.split('\n');
  const start = lines.findIndex((l) =>
    l.startsWith(`CREATE OR REPLACE FUNCTION public.${name}(`),
  );
  expect(start, `function not found: ${name}`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && l.trimEnd() === '$$;');
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join('\n');
}

const CAS_HEAD = 'IF p_expected_graph_identity_hash IS NOT NULL THEN';
/** The dedupe arm's own opening test — distinct from the CAS by its subject. */
const DEDUPE_HEAD = 'IF v_head_id IS NOT NULL AND v_head.id IS NOT NULL';

function soleIndexOf(body: string, marker: string, label: string): number {
  const first = body.indexOf(marker);
  expect(first, `marker absent (${label}): ${marker}`).toBeGreaterThanOrEqual(0);
  expect(
    body.indexOf(marker, first + 1),
    `marker occurs more than once, ordering is ambiguous (${label})`,
  ).toBe(-1);
  return first;
}

const fixSql = readFileSync(FIX_PATH, 'utf8');
const rollbackSql = readFileSync(ROLLBACK_PATH, 'utf8');
const originSql = readFileSync(ORIGIN_PATH, 'utf8');

const FUNCTIONS = ['create_model_version', 'restore_model_version'] as const;

describe('model versions — dedupe precedes CAS (migration static guards)', () => {
  for (const fn of FUNCTIONS) {
    it(`${fn}: the fix reaches its DEDUPE arm before its CAS`, () => {
      const body = fnBody(fixSql, fn);
      expect(soleIndexOf(body, DEDUPE_HEAD, fn)).toBeLessThan(
        soleIndexOf(body, CAS_HEAD, fn),
      );
    });

    it(`⭐ CONTRAST CONTROL — ${fn}: the rollback carries the opposite order`, () => {
      const body = fnBody(rollbackSql, fn);
      expect(soleIndexOf(body, CAS_HEAD, fn)).toBeLessThan(
        soleIndexOf(body, DEDUPE_HEAD, fn),
      );
    });

    it(`⭐ CONTRAST CONTROL — ${fn}: the ORIGINAL 20260705120000 carries the defective order`, () => {
      const body = fnBody(originSql, fn);
      expect(soleIndexOf(body, CAS_HEAD, fn)).toBeLessThan(
        soleIndexOf(body, DEDUPE_HEAD, fn),
      );
    });

    it(`⛔ ${fn}: the CAS predicate and the MV409 raise are unchanged — this fix MOVES blocks, it does not rewrite them`, () => {
      const fix = fnBody(fixSql, fn);
      const origin = fnBody(originSql, fn);
      for (const line of [
        CAS_HEAD,
        'IF v_head_id IS NULL OR v_head.id IS NULL',
        'OR v_head.graph_identity_hash <> p_expected_graph_identity_hash THEN',
        "USING ERRCODE = 'MV409'",
      ]) {
        expect(fix, `dropped from ${fn}: ${line}`).toContain(line);
        expect(origin, `control: absent from the original ${fn}: ${line}`).toContain(line);
      }
      // the dedupe's conjuncts are intact too — a narrowed dedupe would silently
      // stop matching the retries this fix exists to admit
      for (const line of [
        'v_head.identity_projection_version',
        'v_head.identity_normaliser_version',
        'v_head.graph_schema_version',
        "'deduped', true",
      ]) {
        expect(fix, `dedupe conjunct dropped from ${fn}: ${line}`).toContain(line);
      }
    });

    it(`${fn}: block structure is preserved — same END IF, RAISE and RETURN inventory as the original`, () => {
      const count = (body: string, re: RegExp) => (body.match(re) ?? []).length;
      const fix = fnBody(fixSql, fn);
      const origin = fnBody(originSql, fn);
      expect(count(fix, /END IF;/g)).toBe(count(origin, /END IF;/g));
      expect(count(fix, /RAISE /g)).toBe(count(origin, /RAISE /g));
      expect(count(fix, /RETURN jsonb_build_object\(/g)).toBe(
        count(origin, /RETURN jsonb_build_object\(/g),
      );
    });
  }
});
