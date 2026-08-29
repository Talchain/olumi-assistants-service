/**
 * V5 pre-flight — A TURN MUST NOT RESURRECT A DELETED SCENARIO.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * `preflightEnsureScenario` calls `ensureScenarioExists`, whose RPC is
 * `INSERT … ON CONFLICT (id) DO NOTHING`. Reached with an id whose row is
 * GONE, it CREATES that row. The three sibling surfaces that reach the same
 * shared pre-flight (`assist.v1.scenario-graph`, `assist.v1.scenario-versions`,
 * `turn-stop`) each gate on `store.scenarioExists` FIRST precisely so a read
 * never creates the row it reads. The TURN path did not.
 *
 * Consequence, and it is a live hazard rather than a hypothetical: the UI
 * deletes a scenario by a direct PostgREST `DELETE` (DecisionGuideAI
 * `scenarioService.deleteScenario`) with NO cross-tab coordination
 * (`BroadcastChannel` has zero occurrences in that repo), so a second open tab
 * keeps posting turns on an id whose row the first tab just removed — and each
 * such turn silently recreated the scenario.
 *
 * ── WHY THESE TESTS MODEL THE TABLE RATHER THAN SPYING ON A CALL ───────────
 * The harm is not "a function was not called". The harm is THE ROW COMING
 * BACK. A test that asserted `expect(scenarioExists).toHaveBeenCalled()` would
 * pass against an implementation that probed and then upserted anyway. So the
 * double below models `INSERT … ON CONFLICT (id) DO NOTHING` against a real
 * Map, and the assertions read that Map: a deleted scenario must still be
 * absent after the pre-flight has run.
 *
 * ── THE THREE-WAY DISTINCTION, AND WHERE IT COMES FROM ─────────────────────
 * An absent `scenarios` row is ambiguous between "never existed", "deleted"
 * and "not yet created" — the table carries NO tombstone (derived: zero
 * `deleted_at` / `archived_at` / `is_deleted` / `scenario_deletions` anywhere
 * under `supabase/`, against firing contrast controls), and
 * `ensure_scenario_exists` `RETURNS UUID` so it discards the insert-vs-found
 * bit before its caller can see it.
 *
 * The distinction is therefore made from state that SURVIVES the delete.
 * `v5_conversation_turns` and `v5_handler_facts` are `ON DELETE CASCADE`, so
 * they are gone. `v5_turn_fence` has NO foreign key to `scenarios` and its
 * table comment states rows "are never deleted by the application" — so a
 * fence row for a scenario whose row is absent is durable evidence that the
 * scenario ONCE EXISTED and has since been removed. That is the discriminator:
 *
 *   row absent + NO admitted turn ever → never existed / not yet created
 *                                        → CREATE (preserves the first-turn
 *                                          race the upsert exists for)
 *   row absent + an admitted turn      → it existed and its row is gone
 *                                        → DELETED → REFUSE
 *
 * The residual gap is exactly the harmless case: a scenario deleted before any
 * turn was ever admitted on it has no conversation and no graph, so recreating
 * an empty row for it is indistinguishable from creating it fresh.
 *
 * ── THE ORDERING THAT MAKES THIS SAFE ──────────────────────────────────────
 * A first turn cannot trip over its OWN fence row: `admitCurrentTurnFence()`
 * runs AFTER `runPreFlight` succeeds (route-v2.ts — "The fence was NOT claimed
 * for this request … a rejected request is fence-neutral: it cannot supersede
 * a live turn and it grows no fence rows"). At pre-flight time the current
 * turn has no fence row.
 */
import { readFile } from 'node:fs/promises';

import { describe, it, expect, vi } from 'vitest';

import { preflightEnsureScenario } from '../build-turn-context.js';
import type { SessionStore } from '../session/store.js';

// Every test passes an explicit store, so this mock exists only to make an
// accidental fall-through to the ambient store loud rather than silent.
vi.mock('../session/index.js', () => ({
  getSessionStore: () => {
    throw new Error('SUPABASE_URL is not configured');
  },
}));

const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';
const OWNER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

interface FakeDb {
  /** The `public.scenarios` table. Presence of the key IS row existence. */
  readonly rows: Map<string, { user_id: string | null }>;
  readonly store: SessionStore;
}

/**
 * A store double that models the REAL write semantics of the RPC rather than
 * reporting a canned answer, so "the row came back" is observable.
 *
 * `admittedTurns` models `v5_turn_fence` survivorship — whether any turn was
 * ever admitted on this scenario.
 */
function makeDb(opts: {
  rowPresent: boolean;
  storedOwner?: string | null;
  admittedTurns: boolean;
  existsThrows?: boolean;
  admittedThrows?: boolean;
  /** Omit the optional probes entirely (a legacy test double). */
  omitExists?: boolean;
  omitAdmitted?: boolean;
}): FakeDb {
  const rows = new Map<string, { user_id: string | null }>();
  if (opts.rowPresent) rows.set(SCENARIO_ID, { user_id: opts.storedOwner ?? null });

  const store: Record<string, unknown> = {
    // INSERT … ON CONFLICT (id) DO NOTHING, then re-read the authoritative
    // owner — exactly what `ensure_scenario_exists` does.
    ensureScenarioExists: vi.fn(async (id: string, userId: string | null) => {
      if (!rows.has(id)) rows.set(id, { user_id: userId });
      return { user_id: rows.get(id)!.user_id };
    }),
  };
  if (opts.omitExists !== true) {
    store.scenarioExists = vi.fn(async (id: string) => {
      if (opts.existsThrows === true) throw new Error('scenarios existence read failed');
      return rows.has(id);
    });
  }
  if (opts.omitAdmitted !== true) {
    store.scenarioHasAdmittedTurn = vi.fn(async (_id: string) => {
      if (opts.admittedThrows === true) throw new Error('turn fence read failed');
      return opts.admittedTurns;
    });
  }
  return { rows, store: store as unknown as SessionStore };
}

describe('preflightEnsureScenario — a turn must not resurrect a deleted scenario', () => {
  it('REFUSES a turn on a DELETED scenario (row gone, a turn was once admitted)', async () => {
    const db = makeDb({ rowPresent: false, admittedTurns: true });

    const result = await preflightEnsureScenario(SCENARIO_ID, null, REQUEST_ID, db.store);

    expect(result).toEqual({ ok: false, reason: 'scenario_deleted' });
  });

  it('THE HARM: a refused turn leaves the deleted scenario ABSENT — the row does not come back', async () => {
    const db = makeDb({ rowPresent: false, admittedTurns: true });

    await preflightEnsureScenario(SCENARIO_ID, null, REQUEST_ID, db.store);

    // This is the defect, stated as the user experiences it: the decision the
    // user deleted must still be gone.
    expect(db.rows.has(SCENARIO_ID)).toBe(false);
  });

  it('THE HARM, signed-in owner: a deleted OWNED scenario is not recreated by its owner’s stale tab', async () => {
    const db = makeDb({ rowPresent: false, admittedTurns: true });

    const result = await preflightEnsureScenario(SCENARIO_ID, OWNER_ID, REQUEST_ID, db.store);

    expect(result).toEqual({ ok: false, reason: 'scenario_deleted' });
    expect(db.rows.has(SCENARIO_ID)).toBe(false);
  });

  it('ALLOWS a genuine first turn on a never-seen scenario, and CREATES the row (the race the upsert exists for)', async () => {
    const db = makeDb({ rowPresent: false, admittedTurns: false });

    const result = await preflightEnsureScenario(SCENARIO_ID, null, REQUEST_ID, db.store);

    expect(result).toEqual({ ok: true });
    expect(db.rows.has(SCENARIO_ID)).toBe(true);
  });

  it('ALLOWS a turn on an EXISTING scenario, and the upsert is then a pure read', async () => {
    const db = makeDb({ rowPresent: true, storedOwner: null, admittedTurns: true });

    const result = await preflightEnsureScenario(SCENARIO_ID, null, REQUEST_ID, db.store);

    expect(result).toEqual({ ok: true });
    expect(db.rows.get(SCENARIO_ID)).toEqual({ user_id: null });
  });

  it('ownership still decides on an EXISTING owned scenario (the gate did not displace the IDOR check)', async () => {
    const db = makeDb({ rowPresent: true, storedOwner: OWNER_ID, admittedTurns: true });

    const result = await preflightEnsureScenario(SCENARIO_ID, null, REQUEST_ID, db.store);

    expect(result).toEqual({ ok: false, reason: 'scenario_requires_authenticated_owner' });
  });

  it('binds to THIS scenario: an admitted turn on a DIFFERENT scenario does not refuse this one', async () => {
    // Identity binding, not a value predicate another object could satisfy
    // (CLAUDE.md trap 19). A store that answered "some scenario somewhere has
    // a fence row" would pass every other test in this file while refusing
    // every first turn in production.
    const rows = new Map<string, { user_id: string | null }>();
    const OTHER_SCENARIO = '99999999-9999-4999-8999-999999999999';
    const store = {
      scenarioExists: vi.fn(async (id: string) => rows.has(id)),
      // Only the OTHER scenario has ever admitted a turn.
      scenarioHasAdmittedTurn: vi.fn(async (id: string) => id === OTHER_SCENARIO),
      ensureScenarioExists: vi.fn(async (id: string, userId: string | null) => {
        if (!rows.has(id)) rows.set(id, { user_id: userId });
        return { user_id: rows.get(id)!.user_id };
      }),
    } as unknown as SessionStore;

    const result = await preflightEnsureScenario(SCENARIO_ID, null, REQUEST_ID, store);

    expect(result).toEqual({ ok: true });
    expect(rows.has(SCENARIO_ID)).toBe(true);
    expect(store.scenarioHasAdmittedTurn).toHaveBeenCalledWith(SCENARIO_ID);
  });

  it('THE ORDERING THIS GATE DEPENDS ON: fence admission happens AFTER the pre-flight', async () => {
    // The discriminator is only sound because the asking turn has no fence row
    // yet when the pre-flight runs. If `admitCurrentTurnFence()` were ever
    // hoisted above `runPreFlight`, every genuine first turn would see its own
    // admission and be refused as a deleted scenario — a total outage for new
    // decisions, with nothing else in the suite able to see it.
    //
    // DERIVED from the route rather than described in a comment, so a reorder
    // REDs here instead of shipping.
    const routeSource = await readFile(
      new URL('../../orchestrator/route-v2.ts', import.meta.url),
      'utf8',
    );
    const preFlightAt = routeSource.indexOf('await runPreFlight(req)');
    const admissionAt = routeSource.indexOf('await admitCurrentTurnFence()');

    // Positive control: both anchors must actually be found, or this guard is
    // comparing -1 to -1 and asserting nothing.
    expect(preFlightAt).toBeGreaterThan(-1);
    expect(admissionAt).toBeGreaterThan(-1);
    expect(admissionAt).toBeGreaterThan(preFlightAt);
  });

  describe('degradation — this gate is an integrity guard, NOT an authorization control', () => {
    // It therefore fails OPEN: refusing a turn because a fence read blipped
    // would cost a legitimate user their session, and failing open degrades to
    // the PRE-EXISTING behaviour rather than opening anything new. The
    // ownership checks below it are unchanged and still fail CLOSED.

    it('existence read THROWS → proceed (degrade to prior behaviour), ownership unchanged', async () => {
      const db = makeDb({ rowPresent: false, admittedTurns: true, existsThrows: true });

      const result = await preflightEnsureScenario(SCENARIO_ID, null, REQUEST_ID, db.store);

      expect(result).toEqual({ ok: true });
    });

    it('fence read THROWS → proceed rather than refuse a possibly-legitimate first turn', async () => {
      const db = makeDb({ rowPresent: false, admittedTurns: true, admittedThrows: true });

      const result = await preflightEnsureScenario(SCENARIO_ID, null, REQUEST_ID, db.store);

      expect(result).toEqual({ ok: true });
    });

    it('store cannot probe existence (legacy double) → proceed, exactly as turn-stop does', async () => {
      const db = makeDb({ rowPresent: false, admittedTurns: true, omitExists: true });

      const result = await preflightEnsureScenario(SCENARIO_ID, null, REQUEST_ID, db.store);

      expect(result).toEqual({ ok: true });
    });

    it('store cannot answer the fence question (legacy double) → proceed', async () => {
      const db = makeDb({ rowPresent: false, admittedTurns: true, omitAdmitted: true });

      const result = await preflightEnsureScenario(SCENARIO_ID, null, REQUEST_ID, db.store);

      expect(result).toEqual({ ok: true });
    });
  });
});
