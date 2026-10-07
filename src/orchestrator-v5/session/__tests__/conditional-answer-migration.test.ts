import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const name = '20261007090000_agent_answer_conditional_append';
const read = (path: string) => readFileSync(new URL(`../../../../supabase/migrations/${path}`, import.meta.url), 'utf8');
const executable = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');

describe('S-D.1b additive conditional append migration (static, no DB)', () => {
  it('creates exactly one distinct invoker function, with no existing schema mutations', () => {
    const code = executable(read(`${name}.sql`));
    expect(code.match(/CREATE\s+(?:OR REPLACE\s+)?FUNCTION\s+[^\s(]+/gi)).toEqual(['CREATE FUNCTION public.append_agent_answer_if_latest']);
    expect(code).not.toMatch(/\b(?:ALTER|DROP)\b|CREATE\s+(?:TABLE|INDEX|TRIGGER)\b/i);
    expect(code).toContain('RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER');
    expect(code).toContain('SET search_path = pg_catalog, public');
    expect(code).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
  });

  it('scenario advisory lock precedes the exact latest-row query and NULL-safe refusal', () => {
    const code = executable(read(`${name}.sql`));
    expect(code).toContain('pg_advisory_xact_lock(hashtextextended(p_scenario_id::text, 0))');
    expect(code).toContain("SELECT id INTO v_latest FROM public.v5_conversation_turns WHERE scenario_id = p_scenario_id AND turn_id NOT LIKE '%:claim' ORDER BY created_at DESC LIMIT 1;");
    expect(code).toContain("IF v_latest IS DISTINCT FROM p_expected_latest_row_id THEN RETURN jsonb_build_object('status', 'latest_moved'); END IF;");
    expect(code.indexOf('pg_advisory_xact_lock')).toBeLessThan(code.indexOf('SELECT id INTO v_latest'));
    expect(code.indexOf("'latest_moved'")).toBeLessThan(code.indexOf('RETURN public.append_agent_answer_with_offers'));
  });

  it('takes the exact delegate arguments plus expected id and returns existing delegates unchanged', () => {
    const sql = read(`${name}.sql`), delegate = read('20261006230000_agent_answer_offers.sql');
    const params = (code: string) => [...code.match(/CREATE FUNCTION[^]*?\(([^]*?)\)\s*RETURNS/)![1]!.matchAll(/(p_\w+)\s+(\w+)/g)].map(m => [m[1], m[2]]);
    expect(params(sql)).toEqual([['p_expected_latest_row_id', 'UUID'], ...params(delegate)]);
    const code = executable(sql);
    for (const [fn, count] of [['append_agent_answer_with_offers', 18], ['append_agent_answer_with_guidance', 16], ['append_turn_atomic_v2', 15]] as const) {
      const expectedArgs = params(delegate).slice(0, count).map(p => p[0]).join(', ');
      expect(code).toContain(`${fn}( ${expectedArgs} )`);
    }
    expect(code).toContain('IF p_suggested_actions IS NOT NULL THEN RETURN public.append_agent_answer_with_offers(');
    expect(code).toContain('ELSIF p_agent_guidance IS NOT NULL THEN RETURN public.append_agent_answer_with_guidance(');
    expect(code).toContain('RETURN to_jsonb(public.append_turn_atomic_v2(');
  });

  it('new function grants match delegates; rollback drops only its exact signature', () => {
    const sql = read(`${name}.sql`), rollback = executable(read(`rollback/${name}_rollback.sql.do-not-apply`));
    const signature = 'uuid, uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, jsonb, jsonb, text';
    expect(sql.split(signature)).toHaveLength(3);
    expect(executable(sql)).toContain(`REVOKE EXECUTE ON FUNCTION public.append_agent_answer_if_latest( ${signature} ) FROM PUBLIC, anon, authenticated;`);
    expect(executable(sql)).toContain(`GRANT EXECUTE ON FUNCTION public.append_agent_answer_if_latest( ${signature} ) TO service_role;`);
    expect(rollback.trim()).toBe(`DROP FUNCTION IF EXISTS public.append_agent_answer_if_latest( ${signature} ); NOTIFY pgrst, 'reload schema';`);
  });

  it('header discloses deploy order and the transaction-time residual window', () => {
    const sql = read(`${name}.sql`);
    expect(sql).toMatch(/additive/i);
    expect(sql).toMatch(/deploy code first/i);
    expect(sql).toMatch(/READ COMMITTED/);
    expect(sql).toMatch(/NOW\(\)/);
    expect(sql).toMatch(/not guaranteed to be older/i);
    expect(sql).toMatch(/replay/i);
    expect(sql).toMatch(/ties/i);
  });
});
