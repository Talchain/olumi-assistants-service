import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const name = '20261013230000_agent_answer_run_narration';
const read = (path: string) => readFileSync(new URL(`../../../../supabase/migrations/${path}`, import.meta.url), 'utf8');
const executable = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
const params = (code: string, fn: string) => [...code.match(new RegExp(`CREATE FUNCTION public\\.${fn}\\(([^]*?)\\)\\s*RETURNS`))![1]!
  .matchAll(/(p_\w+)\s+(\w+)/g)].map(m => [m[1], m[2]]);
const OFFERS = '20261006230000_agent_answer_offers.sql';
const CONDITIONAL = '20261007090000_agent_answer_conditional_append.sql';

describe('T1h additive answer-narration migration (static, no DB)', () => {
  it('adds one nullable column with its own CHECK and exactly two NEW functions; nothing existing is touched', () => {
    const code = executable(read(`${name}.sql`));
    expect(code.match(/CREATE\s+(?:OR REPLACE\s+)?FUNCTION\s+[^\s(]+/gi)).toEqual([
      'CREATE FUNCTION public.append_agent_answer_narrated', 'CREATE FUNCTION public.append_agent_answer_if_latest_narrated']);
    expect(code.match(/\bALTER\b[^;]*;/gi)).toEqual(['ALTER TABLE public.v5_conversation_turns ADD COLUMN IF NOT EXISTS run_narration JSONB;',
      'ALTER TABLE public.v5_conversation_turns ADD CONSTRAINT v5_conversation_turns_run_narration_shape CHECK ( run_narration IS NULL OR '
      + "(CASE WHEN jsonb_typeof(run_narration) = 'object' THEN (run_narration - 'status' - 'run_key') = '{}'::jsonb "
      + "AND jsonb_typeof(run_narration->'status') = 'string' AND (run_narration->>'status') IN ('pending', 'ready', 'unavailable', 'stale') "
      + "AND jsonb_typeof(run_narration->'run_key') = 'string' AND (run_narration->>'run_key') ~ '^[0-9a-f]{16}$' ELSE FALSE END) IS TRUE ) NOT VALID;"]);
    // A missing field must REFUSE: a bare CHECK passes a NULL predicate ({} or {"status":"ready"}).
    expect(code).toMatch(/ELSE FALSE END\) IS TRUE \) NOT VALID;/);
    expect(code).not.toMatch(/\bDROP\b|CREATE\s+(?:TABLE|INDEX|TRIGGER)\b|\bDEFAULT\b/i);
    // The only data write: this column, on the new row the delegate just appended.
    expect(code.match(/(?<!FOR )\b(?:INSERT|UPDATE|DELETE)\b[^;]*;/gi)).toEqual([
      'UPDATE public.v5_conversation_turns SET run_narration = p_run_narration WHERE id = v_id AND scenario_id = p_scenario_id AND turn_id = p_turn_id AND request_hash = p_request_hash;']);
    expect(code.split('RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public')).toHaveLength(3);
  });

  it('production’s calls are unchanged: the live wrappers keep their exact signatures and are called, never redefined', () => {
    const sql = read(`${name}.sql`), code = executable(sql);
    for (const live of ['append_agent_answer_with_offers', 'append_agent_answer_with_guidance', 'append_agent_answer_if_latest', 'append_turn_atomic_v2']) {
      expect(code).not.toMatch(new RegExp(`FUNCTION public\\.${live}\\(`));
    }
    // The narrated twins take the live signatures plus ONE trailing parameter, so no overload shares a name with them.
    expect(params(sql, 'append_agent_answer_narrated')).toEqual([...params(read(OFFERS), 'append_agent_answer_with_offers'), ['p_run_narration', 'JSONB']]);
    expect(params(sql, 'append_agent_answer_if_latest_narrated')).toEqual([...params(read(CONDITIONAL), 'append_agent_answer_if_latest'), ['p_run_narration', 'JSONB']]);
  });

  it('delegates with the exact live arities, and the conditional twin keeps 20261007090000’s guard, lock and latest check', () => {
    const sql = read(`${name}.sql`), code = executable(sql);
    const offers = params(read(OFFERS), 'append_agent_answer_with_offers').map(p => p[0]);
    for (const [fn, count] of [['append_agent_answer_with_offers', 18], ['append_agent_answer_with_guidance', 16], ['append_turn_atomic_v2', 15]] as const) {
      expect(code).toContain(`public.${fn}( ${offers.slice(0, count).join(', ')} );`);
    }
    expect(code).toContain(`RETURN public.append_agent_answer_narrated( ${[...offers, 'p_run_narration'].join(', ')} );`);
    const conditional = executable(read(CONDITIONAL));
    const between = (text: string, from: string, to: string) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));
    const twin = code.slice(code.indexOf('CREATE FUNCTION public.append_agent_answer_if_latest_narrated'));
    expect(between(twin, 'IF p_turn_class', 'END IF;')).toBe(between(conditional, 'IF p_turn_class', 'END IF;'));
    expect(between(twin, 'PERFORM pg_advisory_xact_lock', 'RETURN public.')).toBe(between(conditional, 'PERFORM pg_advisory_xact_lock', 'IF p_suggested_actions'));
  });

  it('accepts only exactly {status, run_key} with a known status and a 16-hex key, and never replaces a first answer’s', () => {
    const code = executable(read(`${name}.sql`));
    expect(code).toContain("(p_run_narration - 'status' - 'run_key') <> '{}'::jsonb");
    expect(code).toContain("(p_run_narration->>'status') NOT IN ('pending', 'ready', 'unavailable', 'stale')");
    expect(code).toContain("(p_run_narration->>'run_key') !~ '^[0-9a-f]{16}$'");
    expect(code.indexOf('IF v_existing IS NULL THEN UPDATE public.v5_conversation_turns SET run_narration')).toBeGreaterThan(0);
    expect(code.indexOf("RAISE EXCEPTION 'invalid answer Run narration'")).toBeLessThan(code.indexOf('PERFORM 1 FROM public.scenarios'));
  });

  it('grants match the wrappers; the rollback drops exactly the two functions, the CHECK and the column', () => {
    const code = executable(read(`${name}.sql`)), rollback = executable(read(`rollback/${name}_rollback.sql.do-not-apply`)).trim();
    const one = 'uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, jsonb, jsonb, text, jsonb';
    for (const [fn, sig] of [['append_agent_answer_narrated', one], ['append_agent_answer_if_latest_narrated', `uuid, ${one}`]] as const) {
      expect(code).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn}( ${sig} ) FROM PUBLIC, anon, authenticated;`);
      expect(code).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}( ${sig} ) TO service_role;`);
    }
    expect(rollback).toBe(`DROP FUNCTION IF EXISTS public.append_agent_answer_if_latest_narrated( uuid, ${one} ); `
      + `DROP FUNCTION IF EXISTS public.append_agent_answer_narrated( ${one} ); `
      + 'ALTER TABLE public.v5_conversation_turns DROP CONSTRAINT IF EXISTS v5_conversation_turns_run_narration_shape; '
      + "ALTER TABLE public.v5_conversation_turns DROP COLUMN IF EXISTS run_narration; NOTIFY pgrst, 'reload schema';");
  });
});
