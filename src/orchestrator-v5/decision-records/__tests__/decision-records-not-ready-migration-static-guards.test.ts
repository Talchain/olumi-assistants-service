/**
 * Migration 20260924120000 — decision_records "not ready to choose" + durable
 * reasoning text (schemas 0.57.0). SQL-text static guards, same convention as
 * the model-versions / append_turn_atomic guards: CI cannot reach a live
 * database, so these pin what the FILE says. ⚠ They prove nothing about a
 * database this file has not been applied to — applying it is a separate,
 * Paul-gated ops step, and no test here claims it happened.
 *
 * ⭐ THE DISCRIMINATING PAIR. Every "the fix admits X" claim is run against the
 * ORIGINAL 20260710113000 body (or the rollback, which restores it) and must
 * come out the opposite way — an assertion that has never seen the other
 * state is pinning nothing.
 *
 * What is pinned:
 *   1. SIGNATURE PARITY — the function is replaced in place (same 8-parameter
 *      list), so no overload can be created.
 *   2. MINIMAL DIFF — the forward body is the original body with EXACTLY the
 *      two documented transformations; everything else byte-identical.
 *   3. THE NOT-READY WHITELIST — admits position/graph_hash/committed_by_user
 *      and the four reasoning keys, and does NOT admit an option key or
 *      analysis_summary (the contradiction is refused at the store).
 *   4. THE BOUND — each reasoning key is guarded at char_length > N where N is
 *      CEE's DECISION_RECORD_TEXT_MAX_CHARS, and the key set equals CEE's
 *      REASONING_TEXT_FIELDS (the mirror cannot drift silently).
 *   5. THE TABLE CHECK — the not-ready disjunct exists, is COALESCE-guarded,
 *      and refuses option keys; the chosen disjunct still requires both.
 *   6. ROLLBACK — restores the original constraint and body verbatim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DECISION_RECORD_TEXT_MAX_CHARS,
  REASONING_TEXT_FIELDS,
} from '../user-commit.js';

const migrationPath = (rel: string): string =>
  fileURLToPath(new URL(`../../../../supabase/migrations/${rel}`, import.meta.url));

const FIX_SQL = readFileSync(
  migrationPath('20260924120000_v5_decision_records_not_ready_and_reasoning.sql'),
  'utf8',
);
const ROLLBACK_SQL = readFileSync(
  migrationPath(
    'rollback/20260924120000_v5_decision_records_not_ready_and_reasoning_rollback.sql.do-not-apply',
  ),
  'utf8',
);
const ORIGIN_SQL = readFileSync(migrationPath('20260710113000_v5_decision_records.sql'), 'utf8');

/** One function's text only, from its CREATE line to its closing `$$;`. */
function fnBody(sql: string, name: string): string {
  const lines = sql.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`CREATE OR REPLACE FUNCTION public.${name}(`));
  expect(start, `function not found: ${name}`).toBeGreaterThanOrEqual(0);
  expect(
    lines.findIndex((l, i) => i > start && l.startsWith(`CREATE OR REPLACE FUNCTION public.${name}(`)),
    `function defined twice: ${name}`,
  ).toBe(-1);
  const end = lines.findIndex((l, i) => i > start && l.trimEnd() === '$$;');
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join('\n');
}

/** The not-ready branch's whitelist expression: `p_decision - 'a' - 'b' … <> '{}'`. */
function notReadyWhitelistKeys(body: string): string[] {
  const m = /IF p_decision - 'position'((?:\s*-\s*'[a-z_]+')*)\s*<> '\{\}'::jsonb THEN/.exec(body);
  expect(m, 'not-ready whitelist expression not found').not.toBeNull();
  return ['position', ...[...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])];
}

const fixFn = fnBody(FIX_SQL, 'create_decision_record');
const originFn = fnBody(ORIGIN_SQL, 'create_decision_record');
const rollbackFn = fnBody(ROLLBACK_SQL, 'create_decision_record');

describe('20260924120000 — create_decision_record is replaced IN PLACE', () => {
  it('SIGNATURE PARITY: the parameter list up to RETURNS is byte-identical to 20260710113000 (no overload)', () => {
    const sig = (body: string) => body.slice(0, body.indexOf('RETURNS JSONB'));
    expect(sig(fixFn)).toBe(sig(originFn));
    // Exactly one definition in the forward file.
    expect(FIX_SQL.split('CREATE OR REPLACE FUNCTION').length - 1).toBe(1);
  });

  it('re-issues the explicit REVOKE/GRANT for the exact 8-parameter signature', () => {
    const sig = 'uuid, jsonb, jsonb, timestamptz, uuid, text, uuid, text';
    expect(FIX_SQL).toContain(
      `REVOKE EXECUTE ON FUNCTION public.create_decision_record(\n  ${sig}\n) FROM PUBLIC, anon, authenticated;`,
    );
    expect(FIX_SQL).toContain(
      `GRANT EXECUTE ON FUNCTION public.create_decision_record(\n  ${sig}\n) TO service_role;`,
    );
  });

  it('is one transaction: the CHECK relax and the RPC widen land together or not at all', () => {
    const begin = FIX_SQL.indexOf('\nBEGIN;\n');
    const commit = FIX_SQL.lastIndexOf('\nCOMMIT;\n');
    expect(begin).toBeGreaterThan(0);
    expect(commit).toBeGreaterThan(begin);
    expect(FIX_SQL.indexOf('ALTER TABLE public.decision_records')).toBeGreaterThan(begin);
    expect(FIX_SQL.indexOf('CREATE OR REPLACE FUNCTION')).toBeLessThan(commit);
  });

  it('does not touch record_decision_outcome, p_prediction or RLS', () => {
    expect(FIX_SQL).not.toContain('FUNCTION public.record_decision_outcome');
    expect(FIX_SQL).not.toMatch(/POLICY/);
    const predictionGuard = (body: string) => {
      const a = body.indexOf('IF p_prediction IS NULL');
      const b = body.indexOf('END IF;', a);
      return body.slice(a, b);
    };
    expect(predictionGuard(fixFn)).toBe(predictionGuard(originFn));
  });
});

describe('20260924120000 — the not-ready branch (discriminating: absent from the original)', () => {
  it('branches on the PRESENCE of position, and only admits the value not_ready', () => {
    expect(fixFn).toContain("IF p_decision ? 'position' THEN");
    expect(fixFn).toContain("OR p_decision->>'position' <> 'not_ready' THEN");
    // CONTRAST: the original has no position concept at all.
    expect(originFn).not.toContain("'position'");
  });

  it('the not-ready whitelist admits exactly {position, graph_hash, committed_by_user} + the four reasoning keys', () => {
    const keys = notReadyWhitelistKeys(fixFn);
    expect([...keys].sort()).toEqual(
      ['position', 'graph_hash', 'committed_by_user', ...REASONING_TEXT_FIELDS].sort(),
    );
  });

  it('THE CONTRADICTION IS REFUSED AT THE STORE: the not-ready whitelist admits no option key and no analysis_summary', () => {
    const keys = notReadyWhitelistKeys(fixFn);
    expect(keys).not.toContain('chosen_option_id');
    expect(keys).not.toContain('chosen_option_label');
    expect(keys).not.toContain('analysis_summary');
  });

  it('a not-ready decision requires committed_by_user = true (ambient capture can never produce one)', () => {
    expect(fixFn).toContain("OR p_decision->'committed_by_user' IS DISTINCT FROM 'true'::jsonb THEN");
  });

  it('the chosen branch keeps its pre-0.57.0 required-string guard verbatim', () => {
    const guard = (body: string) => {
      const a = body.indexOf("IF jsonb_typeof(p_decision->'chosen_option_id') IS DISTINCT FROM 'string'");
      const b = body.indexOf('END IF;', a);
      expect(a).toBeGreaterThan(0);
      // Compare modulo indentation: the fix nests it one level deeper.
      return body
        .slice(a, b)
        .split('\n')
        .map((l) => l.trim())
        .join('\n');
    };
    expect(guard(fixFn)).toBe(guard(originFn));
  });

  it('the chosen whitelist is the original one widened by EXACTLY the four reasoning keys', () => {
    const chosenKeys = (body: string) => {
      const m =
        /IF p_decision - 'chosen_option_id' - 'chosen_option_label' - 'graph_hash' - 'analysis_summary'((?:\s*-\s*'[a-z_]+')*)\s*<> '\{\}'::jsonb THEN/.exec(
          body,
        );
      expect(m).not.toBeNull();
      return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    };
    expect(chosenKeys(originFn)).toEqual(['committed_by_user']);
    expect([...chosenKeys(fixFn)].sort()).toEqual(['committed_by_user', ...REASONING_TEXT_FIELDS].sort());
  });
});

describe('20260924120000 — the reasoning-text bound is CEE\'s bound (mirror pinned)', () => {
  it.each(REASONING_TEXT_FIELDS.map((f) => [f]))(
    '%s: optional, non-empty string, char_length > DECISION_RECORD_TEXT_MAX_CHARS refused',
    (field) => {
      expect(fixFn).toContain(`(p_decision ? '${field}'`);
      expect(fixFn).toContain(`jsonb_typeof(p_decision->'${field}') <> 'string'`);
      expect(fixFn).toContain(`OR p_decision->>'${field}' = ''`);
      expect(fixFn).toContain(
        `OR char_length(p_decision->>'${field}') > ${DECISION_RECORD_TEXT_MAX_CHARS}`,
      );
      // CONTRAST: the original stored none of them.
      expect(originFn).not.toContain(`'${field}'`);
    },
  );

  it('there is exactly ONE bound in the file, and it is CEE\'s', () => {
    const bounds = [...fixFn.matchAll(/char_length\(p_decision->>'[a-z_]+'\) > (\d+)/g)].map((m) =>
      Number(m[1]),
    );
    expect(bounds).toHaveLength(REASONING_TEXT_FIELDS.length);
    expect(new Set(bounds)).toEqual(new Set([DECISION_RECORD_TEXT_MAX_CHARS]));
  });
});

describe('20260924120000 — the journey event carries the position', () => {
  it("details gain 'position' (stripped when NULL, so a chosen record's event is byte-identical)", () => {
    expect(fixFn).toContain("'position', p_decision->>'position',");
    expect(fixFn).toContain("'details',    jsonb_strip_nulls(jsonb_build_object(");
    expect(originFn).not.toContain("'position', p_decision->>'position'");
  });
});

describe('20260924120000 — MINIMAL DIFF: nothing else in the body moved', () => {
  it('undoing the two documented transformations reproduces the ORIGINAL body byte for byte', () => {
    // Transformation (b): drop the added details comment + position line.
    let undone = fixFn.replace(
      / {6}-- 0\.57\.0: `position` joins the details\.[\s\S]*?one, which carries no option keys — so a reader of the journey can\n {6}-- never mistake it for a choice\.\n/,
      '',
    );
    undone = undone.replace("                      'position', p_decision->>'position',\n", '');
    // Transformation (a): the whole guard region is replaced; restore the
    // original region from the origin body and compare everything else.
    const regionStart = (body: string, marker: string) => {
      const i = body.indexOf(marker);
      expect(i, `marker absent: ${marker}`).toBeGreaterThan(0);
      return i;
    };
    const FIX_A = '  -- 0.57.0 amendment (2026-09-24): `decision` is EITHER a chosen option';
    const FIX_B = "  -- 0.57.0 amendment: the four reasoning keys, on EITHER branch.";
    const ORIG_A = "  IF p_decision - 'chosen_option_id' - 'chosen_option_label' - 'graph_hash' - 'analysis_summary'";
    const AFTER = '  -- 0.16.0 amendment: committed_by_user distinguishes an explicit "log';
    const fixStart = regionStart(undone, FIX_A);
    regionStart(undone, FIX_B);
    const fixEnd = regionStart(undone, AFTER);
    const origStart = regionStart(originFn, ORIG_A);
    const origEnd = regionStart(originFn, AFTER);
    const rebuilt = undone.slice(0, fixStart) + originFn.slice(origStart, origEnd) + undone.slice(fixEnd);
    expect(rebuilt).toBe(originFn);
  });
});

describe('20260924120000 — dr_decision_shape (the table CHECK)', () => {
  const checkOf = (sql: string): string => {
    const a = sql.indexOf('ADD CONSTRAINT dr_decision_shape CHECK (');
    expect(a, 'ADD CONSTRAINT dr_decision_shape not found').toBeGreaterThan(0);
    const b = sql.indexOf('  );', a);
    return sql.slice(a, b);
  };

  it('drops then re-adds the constraint (re-runnable)', () => {
    expect(FIX_SQL).toContain('DROP CONSTRAINT IF EXISTS dr_decision_shape;');
  });

  it('keeps graph_hash required on every record', () => {
    expect(checkOf(FIX_SQL)).toContain("AND decision ? 'graph_hash'");
  });

  it('the chosen disjunct: no position AND both option keys (every existing row satisfies it)', () => {
    expect(checkOf(FIX_SQL)).toMatch(
      /\(NOT \(decision \? 'position'\)\s+AND decision \? 'chosen_option_id'\s+AND decision \? 'chosen_option_label'\)/,
    );
  });

  it('the not-ready disjunct: COALESCE-guarded position = not_ready AND NEITHER option key', () => {
    expect(checkOf(FIX_SQL)).toMatch(
      /\(COALESCE\(decision->>'position', ''\) = 'not_ready'\s+AND NOT \(decision \? 'chosen_option_id'\)\s+AND NOT \(decision \? 'chosen_option_label'\)\)/,
    );
  });

  it('CONTRAST — the original CHECK required an option on every row', () => {
    const orig = ORIGIN_SQL.slice(
      ORIGIN_SQL.indexOf('CONSTRAINT dr_decision_shape CHECK ('),
      ORIGIN_SQL.indexOf('CONSTRAINT dr_prediction_shape'),
    );
    expect(orig).toContain("AND decision ? 'chosen_option_id'");
    expect(orig).not.toContain('not_ready');
  });
});

describe('20260924120000 — the rollback restores the original verbatim', () => {
  it('the rollback function body IS the original body', () => {
    expect(rollbackFn).toBe(originFn);
  });

  it('the rollback CHECK is the original presence-only CHECK', () => {
    expect(ROLLBACK_SQL).toContain(
      "ADD CONSTRAINT dr_decision_shape CHECK (\n    jsonb_typeof(decision) = 'object'\n    AND decision ? 'chosen_option_id'\n    AND decision ? 'chosen_option_label'\n    AND decision ? 'graph_hash'\n  );",
    );
    expect(ROLLBACK_SQL).not.toContain("= 'not_ready'");
  });

  it('warns that it FAILS once a not-ready row exists (never silently rewrites user records)', () => {
    expect(ROLLBACK_SQL).toContain("WHERE decision ? 'position';");
    expect(ROLLBACK_SQL).toMatch(/FAILS/);
  });
});
