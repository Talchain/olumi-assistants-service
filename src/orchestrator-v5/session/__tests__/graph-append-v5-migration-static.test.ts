import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../../supabase/migrations/20260816120000_v5_graph_append_ack.sql',
    import.meta.url,
  ),
  'utf8',
);
const rollback = readFileSync(
  new URL(
    '../../../../supabase/migrations/rollback/20260816120000_v5_graph_append_ack_rollback.sql.do-not-apply',
    import.meta.url,
  ),
  'utf8',
);

function functionBody(): string {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.append_turn_atomic_v5(');
  expect(start).toBeGreaterThanOrEqual(0);
  const bodyStart = migration.indexOf('AS $$', start);
  const end = migration.indexOf('$$;', bodyStart);
  expect(bodyStart).toBeGreaterThan(start);
  expect(end).toBeGreaterThan(bodyStart);
  return migration.slice(bodyStart, end);
}

describe('append_turn_atomic_v5 migration — immutable replay witness', () => {
  it('adds the nullable accepted_graph witness and prevents later mutation', () => {
    expect(migration).toMatch(
      /ALTER TABLE public\.v5_conversation_turns\s+ADD COLUMN IF NOT EXISTS accepted_graph JSONB/,
    );
    expect(migration).toContain(
      'IF OLD.accepted_graph IS DISTINCT FROM NEW.accepted_graph THEN',
    );
    expect(migration).toMatch(
      /BEFORE UPDATE OF accepted_graph ON public\.v5_conversation_turns/,
    );
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.v5_guard_accepted_graph_immutable\(\)\s+FROM PUBLIC, anon, authenticated/,
    );
  });

  it('stores accepted_graph in the same insert that establishes the idempotency key', () => {
    const body = functionBody();
    const insert = body.indexOf('INSERT INTO public.v5_conversation_turns');
    const conflict = body.indexOf('ON CONFLICT (scenario_id, turn_id) DO NOTHING', insert);
    const acceptedColumn = body.indexOf('accepted_graph', insert);
    const acceptedValue = body.indexOf('p_user_message, p_assistant_message, p_graph', insert);

    expect(insert).toBeGreaterThanOrEqual(0);
    expect(acceptedColumn).toBeGreaterThan(insert);
    expect(acceptedColumn).toBeLessThan(conflict);
    expect(acceptedValue).toBeGreaterThan(insert);
    expect(acceptedValue).toBeLessThan(conflict);
  });
});

describe('append_turn_atomic_v5 migration — replay disposition and zero mutation', () => {
  it('refuses graph-free use and exposes exactly the three raw dispositions', () => {
    const body = functionBody();
    expect(body).toContain('IF p_graph IS NULL THEN');
    expect(body).toContain("'inserted'");
    expect(body).toContain("'replayed_identical'");
    expect(body).toContain("'replayed_divergent'");

    const dispositions = [
      ...body.matchAll(/'(inserted|replayed_identical|replayed_divergent)'/g),
    ].map((match) => match[1]);
    expect(new Set(dispositions)).toEqual(
      new Set(['inserted', 'replayed_identical', 'replayed_divergent']),
    );
  });

  it('classifies an existing key before fence, CAS, insert, graph, facts, or brief writes', () => {
    const body = functionBody();
    const replayRead = body.indexOf('SELECT id, accepted_graph');
    const replayReturn = body.indexOf("THEN 'replayed_identical'", replayRead);
    const fence = body.indexOf('IF p_fence_generation IS NOT NULL THEN');
    const insert = body.indexOf('INSERT INTO public.v5_conversation_turns');
    const graphUpdate = body.indexOf('UPDATE public.scenarios');
    const facts = body.indexOf('INSERT INTO public.v5_handler_facts');
    const brief = body.indexOf('IF p_brief_text IS NOT NULL THEN');

    expect(replayRead).toBeGreaterThanOrEqual(0);
    expect(replayReturn).toBeGreaterThan(replayRead);
    for (const mutationOrGate of [fence, insert, graphUpdate, facts, brief]) {
      expect(mutationOrGate).toBeGreaterThan(replayReturn);
    }
  });

  it('classifies the ON CONFLICT race and returns before every accepted-insert side effect', () => {
    const body = functionBody();
    const conflict = body.indexOf('IF NOT FOUND THEN', body.indexOf('ON CONFLICT'));
    const conflictReturn = body.indexOf("THEN 'replayed_identical'", conflict);
    const conflictEnd = body.indexOf('END IF;', conflictReturn);
    const cas = body.indexOf('IF p_cas_enforce', conflictEnd);
    const graphUpdate = body.indexOf('UPDATE public.scenarios', conflictEnd);
    const facts = body.indexOf('INSERT INTO public.v5_handler_facts', conflictEnd);

    expect(conflict).toBeGreaterThanOrEqual(0);
    expect(conflictReturn).toBeGreaterThan(conflict);
    expect(conflictEnd).toBeGreaterThan(conflictReturn);
    expect(cas).toBeGreaterThan(conflictEnd);
    expect(graphUpdate).toBeGreaterThan(cas);
    expect(facts).toBeGreaterThan(graphUpdate);
  });

  it('serialises same-scenario A/A and A/C writers before either replay classification', () => {
    const body = functionBody();
    const scenarioLock = body.indexOf(
      'FROM public.scenarios\n    WHERE id = p_scenario_id\n    FOR UPDATE;',
    );
    const replayRead = body.indexOf('SELECT id, accepted_graph');
    const insert = body.indexOf('INSERT INTO public.v5_conversation_turns');
    const conflictRead = body.indexOf('SELECT id, accepted_graph', insert);

    // The scenario lock makes graph-v5 A/A settle as inserted+identical and
    // A/C as inserted+divergent. The conflict read remains necessary for a
    // concurrent graph-free/legacy writer, which does not share that lock.
    expect(scenarioLock).toBeGreaterThanOrEqual(0);
    expect(replayRead).toBeGreaterThan(scenarioLock);
    expect(insert).toBeGreaterThan(replayRead);
    expect(conflictRead).toBeGreaterThan(insert);
  });

  it('uses JSONB value equality rather than a second hash authority', () => {
    const body = functionBody();
    expect(body.match(/v_existing_graph IS NOT DISTINCT FROM p_graph/g)).toHaveLength(2);
    expect(body).not.toMatch(/digest\s*\(|sha256|md5\s*\(/i);
    expect(body).toContain('{"a":1,"b":2} vs {"b":2,"a":1} => identical');
    expect(body).toContain('[1,2] vs [2,1]');
    expect(body).toContain('{"x":null} vs {}');
    expect(body).toContain('{"x":[]} vs {"x":null}');
  });

  it('classifies a legacy NULL witness as divergent for every required non-null graph', () => {
    const body = functionBody();
    expect(body).toContain('IF p_graph IS NULL THEN');
    expect(body).toContain(
      "WHEN v_existing_graph IS NOT DISTINCT FROM p_graph\n          THEN 'replayed_identical'\n        ELSE 'replayed_divergent'",
    );
    expect(migration).toContain(
      'Legacy rows\n-- remain NULL and therefore classify as divergent/unverifiable on replay.',
    );
  });
});

describe('append_turn_atomic_v5 migration — retained v4 safety and rollout fencing', () => {
  it('retains stopped, superseded, unclaimed, CAS, and first-write behavior', () => {
    const body = functionBody();
    for (const code of ['OLTF1', 'OLTF2', 'OLTF3', 'OLGC1']) {
      expect(body).toContain(`ERRCODE = '${code}'`);
    }
    expect(body).toContain(
      'IF p_fence_generation < v_fence_max AND v_has_graph THEN',
    );
    expect(body).toContain('FOR UPDATE;');
  });

  it('cannot strand an inserted acknowledgement on CAS/fence refusal', () => {
    const body = functionBody();
    const fence = body.indexOf('IF p_fence_generation IS NOT NULL THEN');
    const insert = body.indexOf('INSERT INTO public.v5_conversation_turns');
    const cas = body.indexOf('IF p_cas_enforce', insert);
    const graphUpdate = body.indexOf('UPDATE public.scenarios', cas);

    // Fence refusals occur before INSERT. CAS refusal occurs after INSERT but
    // has no PL/pgSQL exception handler, so its RAISE aborts and rolls back the
    // entire function statement, including the accepted_graph row.
    expect(fence).toBeLessThan(insert);
    expect(cas).toBeGreaterThan(insert);
    expect(cas).toBeLessThan(graphUpdate);
    expect(body).not.toMatch(/EXCEPTION\s+WHEN/i);
    expect(migration).toContain(
      'PostgreSQL rolls the just-inserted\n  -- turn and accepted_graph witness back with it.',
    );
  });

  it('returns inserted only after current graph, facts, and brief side effects', () => {
    const body = functionBody();
    const graphUpdate = body.indexOf('UPDATE public.scenarios');
    const facts = body.indexOf('INSERT INTO public.v5_handler_facts');
    const brief = body.indexOf('IF p_brief_text IS NOT NULL THEN');
    const insertedReturn = body.lastIndexOf(
      "RETURN jsonb_build_object('id', v_turn_id, 'disposition', 'inserted')",
    );

    expect(facts).toBeGreaterThan(graphUpdate);
    expect(brief).toBeGreaterThan(facts);
    expect(insertedReturn).toBeGreaterThan(brief);
  });

  it('is service-role only with no authenticated/public execution', () => {
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.append_turn_atomic_v5\([\s\S]*?\) FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.append_turn_atomic_v5\([\s\S]*?\) TO service_role/,
    );
  });

  it('pins DB-first deployment and app-first rollback without dropping accepted_graph', () => {
    expect(migration).toContain('DB-FIRST ROLLOUT');
    expect(migration).toContain('The app deliberately has NO graph-bearing fallback');
    expect(rollback).toContain('Rollback order is app-first');
    expect(rollback).toContain('accepted_graph is intentionally retained');
    expect(rollback).not.toMatch(
      /^(?!\s*--).*DROP COLUMN(?: IF EXISTS)? accepted_graph/im,
    );
  });
});
