/**
 * Model Management v1 — SQL-text static guards.
 *
 * CEE hygiene batch (FIX 2) correction: this migration was AUTHORED as
 * code-only on 2026-07-05, but Paul's mandated execution approval landed
 * and it has since been EXECUTED on staging (2026-07-08, build e122f16) —
 * live model_versions rows exist (acceptance-evidence/gm-mm/
 * 03-mm-owned-scenario-proof.md). This lane still cannot connect to a live
 * database in CI, so these remain cheap textual guardrails that pin the
 * security-load-bearing lines of the FILE so a later edit cannot silently
 * drop them:
 *
 *   - owner_user_id NOT NULL (D3 Branch A — no unowned durable rows)
 *   - ENABLE + FORCE RLS; owner-only SELECT policy; no JWT write policies
 *   - explicit REVOKE (PUBLIC + anon + authenticated) for EVERY function
 *     (Supabase default privileges auto-grant on new public functions —
 *     the A4 lesson; the revokes are load-bearing)
 *   - GRANT EXECUTE to service_role ONLY — never to authenticated/anon
 *   - distinct SQLSTATEs (MV001 guest / MV404 not-found / MV409 CAS)
 *   - append-only: no UPDATE/DELETE of model_versions rows anywhere
 *
 * Live grant-layer verification (pg_proc/proacl) is a separate concern from
 * these file-level assertions — these tests assert the file's text, not a
 * live database connection.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../supabase/migrations/20260705120000_v5_model_versions.sql',
    import.meta.url,
  ),
);

const sql = readFileSync(MIGRATION_PATH, 'utf8');
/** Comment-stripped view — grant/policy assertions must match executable
 *  SQL, not prose in comments. */
const code = sql
  .split('\n')
  .map((line) => {
    const idx = line.indexOf('--');
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join('\n');
const codeOneline = code.replace(/\s+/g, ' ');

const FUNCTIONS = ['create_model_version', 'restore_model_version'] as const;

describe('model_versions migration — header + execution posture', () => {
  it('declares itself EXECUTED on staging with a date + evidence pointer (FIX 2 correction)', () => {
    // Was: "AUTHORED AS CODE ONLY... NEVER BEEN EXECUTED" — that claim went
    // stale the moment Paul's execution approval landed and live rows were
    // written (2026-07-08, acceptance-evidence/gm-mm/
    // 03-mm-owned-scenario-proof.md). The header must now say so, not
    // silently keep asserting the pre-execution posture.
    expect(sql).toMatch(/EXECUTED ON STAGING/);
    expect(sql).toMatch(/2026-07-08/);
    expect(sql).toContain('acceptance-evidence/gm-mm/03-mm-owned-scenario-proof.md');
    // Negative: the old false claim must not linger anywhere in the file.
    expect(sql).not.toMatch(/NEVER BEEN EXECUTED/);
    expect(sql).not.toMatch(/HAS NEVER BEEN EXECUTED/);
  });
});

describe('model_versions migration — ownership (D3 Branch A)', () => {
  it('owner_user_id is uuid NOT NULL', () => {
    expect(codeOneline).toMatch(/owner_user_id\s+UUID\s+NOT NULL/i);
  });

  it('owner_user_id carries NO foreign key to auth.users (deliberate — see brief §3)', () => {
    expect(codeOneline).not.toMatch(/owner_user_id\s+UUID\s+NOT NULL\s+REFERENCES/i);
    expect(code).not.toMatch(/auth\.users/);
  });

  it('guest refusal SQLSTATE MV001 is raised in BOTH RPCs', () => {
    const occurrences = code.match(/ERRCODE = 'MV001'/g) ?? [];
    expect(occurrences.length).toBe(2);
  });
});

describe('model_versions migration — RLS posture (A4 checklist)', () => {
  it('ENABLE + FORCE ROW LEVEL SECURITY on model_versions', () => {
    expect(codeOneline).toMatch(
      /ALTER TABLE public\.model_versions ENABLE ROW LEVEL SECURITY/,
    );
    expect(codeOneline).toMatch(
      /ALTER TABLE public\.model_versions FORCE ROW LEVEL SECURITY/,
    );
  });

  it('exactly one policy: owner-only SELECT for authenticated', () => {
    const policies = code.match(/CREATE POLICY/g) ?? [];
    expect(policies.length).toBe(1);
    expect(codeOneline).toMatch(
      /CREATE POLICY select_own_model_versions ON public\.model_versions FOR SELECT TO authenticated USING \(auth\.uid\(\) = owner_user_id\)/,
    );
  });

  it('no INSERT/UPDATE/DELETE policies for any JWT role', () => {
    expect(code).not.toMatch(/FOR INSERT/i);
    expect(code).not.toMatch(/POLICY.*FOR UPDATE/i);
    expect(code).not.toMatch(/FOR DELETE/i);
  });

  it('table grants: REVOKE ALL from PUBLIC/anon/authenticated; SELECT-only re-grant to authenticated', () => {
    expect(codeOneline).toMatch(
      /REVOKE ALL ON public\.model_versions FROM PUBLIC, anon, authenticated/,
    );
    expect(codeOneline).toMatch(/GRANT SELECT ON public\.model_versions TO authenticated/);
    // The ONLY grants naming authenticated anywhere in the file are the
    // policy-scoped SELECT; nothing broader, and anon gets no grant at all.
    const authGrants = code.match(/GRANT [^;]*\b(authenticated|anon)\b/g) ?? [];
    expect(authGrants).toEqual(['GRANT SELECT ON public.model_versions TO authenticated']);
  });
});

describe('model_versions migration — function grants (A4 lesson, per function)', () => {
  for (const fn of FUNCTIONS) {
    it(`${fn}: SECURITY DEFINER with pinned search_path`, () => {
      const body = code.slice(code.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`));
      const firstFn = body.slice(0, body.indexOf('$$;') + 3);
      expect(firstFn).toMatch(/SECURITY DEFINER/);
      expect(firstFn).toMatch(/SET search_path = pg_catalog, public/);
    });

    it(`${fn}: explicit REVOKE FROM PUBLIC, anon AND authenticated present`, () => {
      const revoke = new RegExp(
        `REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`,
      );
      expect(codeOneline).toMatch(revoke);
    });

    it(`${fn}: GRANT EXECUTE to service_role only`, () => {
      const grant = new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`,
      );
      expect(codeOneline).toMatch(grant);
    });
  }

  it('no GRANT EXECUTE to authenticated or anon anywhere', () => {
    const grants = code.match(/GRANT EXECUTE[^;]*/g) ?? [];
    for (const grant of grants) {
      expect(grant).not.toMatch(/\b(authenticated|anon|PUBLIC)\b/);
      expect(grant).toMatch(/service_role/);
    }
    // And exactly one GRANT EXECUTE per function.
    expect(grants.length).toBe(FUNCTIONS.length);
  });

  it('distinct function names — no overloads of existing RPCs (PostgREST ambiguity class)', () => {
    expect(code).not.toMatch(/FUNCTION public\.append_turn_atomic/);
    expect(code).not.toMatch(/FUNCTION public\.store_draft_graph/);
    expect(code).not.toMatch(/FUNCTION public\.append_scenario_event/);
    expect(code).not.toMatch(/FUNCTION public\.create_snapshot/);
  });
});

describe('model_versions migration — structure + semantics pins', () => {
  it('per-scenario version uniqueness: UNIQUE (scenario_id, version_number)', () => {
    expect(codeOneline).toMatch(/UNIQUE \(scenario_id, version_number\)/);
  });

  it('pointer column: scenarios.current_model_version_id with ON DELETE SET NULL', () => {
    expect(codeOneline).toMatch(
      /ALTER TABLE public\.scenarios ADD COLUMN IF NOT EXISTS current_model_version_id UUID REFERENCES public\.model_versions\(id\) ON DELETE SET NULL/,
    );
  });

  it('restore lineage: nullable self-FK restored_from_version_id', () => {
    expect(codeOneline).toMatch(
      /restored_from_version_id\s+UUID REFERENCES public\.model_versions\(id\)/,
    );
  });

  it('identity envelope columns are all present and NOT NULL', () => {
    for (const col of [
      'graph_identity_hash',
      'hash_algorithm',
      'identity_projection_version',
      'identity_normaliser_version',
      'graph_schema_version',
    ]) {
      expect(codeOneline).toMatch(new RegExp(`${col}\\s+TEXT NOT NULL`));
    }
  });

  it('row-lock discipline: both RPCs take FOR UPDATE on the scenarios row', () => {
    const locks = code.match(/FROM public\.scenarios\s+WHERE id = p_scenario_id\s+FOR UPDATE/g) ?? [];
    expect(locks.length).toBe(2);
  });

  it('CAS + not-found SQLSTATEs present: MV409 in both RPCs, MV404 in restore', () => {
    expect((code.match(/ERRCODE = 'MV409'/g) ?? []).length).toBe(2);
    expect((code.match(/ERRCODE = 'MV404'/g) ?? []).length).toBe(1);
  });

  it('append-only: no UPDATE or DELETE ever targets model_versions rows', () => {
    expect(code).not.toMatch(/UPDATE\s+(public\.)?model_versions/i);
    expect(code).not.toMatch(/DELETE\s+FROM\s+(public\.)?model_versions/i);
  });

  it('versions table has no updated_at (immutable rows)', () => {
    const tableDef = code.slice(
      code.indexOf('CREATE TABLE IF NOT EXISTS public.model_versions'),
      code.indexOf('COMMENT ON TABLE public.model_versions'),
    );
    expect(tableDef).not.toMatch(/updated_at/);
  });

  it('restore creates a NEW version (INSERT in restore body; provenance recorded)', () => {
    const restoreBody = code.slice(
      code.indexOf('CREATE OR REPLACE FUNCTION public.restore_model_version('),
    );
    const fnBody = restoreBody.slice(0, restoreBody.indexOf('$$;') + 3);
    expect(fnBody).toMatch(/INSERT INTO public\.model_versions/);
    expect(fnBody).toMatch(/'restore', p_version_id/);
  });

  it('journey events ride scenarios.events with the append_scenario_event shape', () => {
    for (const eventType of ['model_version_created', 'model_version_restored']) {
      expect(code).toContain(`'${eventType}'`);
    }
    for (const key of ["'event_id'", "'event_type'", "'seq'", "'timestamp'", "'details'", "'hashes'"]) {
      expect(code).toContain(key);
    }
  });
});
