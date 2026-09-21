/**
 * append_turn_atomic_v5 — A REPLAY OF A COMMITTED TURN MUST NOT BE CALLED STALE.
 *
 * ── THE DEFECT THESE PIN ───────────────────────────────────────────────────
 * The deployed body (supabase/migrations/20260824200000_c8_atomic_model_version
 * _restore.sql) evaluates its null-safe CAS BEFORE it looks up whether the turn
 * already exists. Measured in the LIVE database on 2026-09-21 via
 * `pg_get_functiondef`, `--` comments stripped, offsets from the body's BEGIN:
 *
 *     "IF p_cas_enforce"        1743
 *     "ERRCODE = 'OLGC1'"       2059
 *     "INTO v_existing_turn_id" 2417   <- the replay lookup, AFTER the CAS
 *
 * So replaying an ALREADY-COMMITTED turn (same turn_id, same arguments) raises
 * OLGC1 "stale graph write" whenever the head has moved on since that commit —
 * which is the NORMAL state during the interruption a replay exists to recover
 * from. The caller is told its write was refused. The write COMMITTED, and the
 * durable `model_version_receipt` the replay arm exists to return is never
 * reached.
 *
 * v4, which v5 delegates to, has always decided replay FIRST and then, in its
 * own words, "SKIP CAS ENTIRELY and return the existing row id — retry safety"
 * (20260806120000_v5_turn_fence_first_write_exemption.sql:296-305). The fix
 * (20260920210000_v5_append_v5_replay_precedes_cas.sql) restores that parity:
 * it moves the pre-existence lookup above the CAS and guards the CAS with
 * `IF NOT v_turn_preexisting THEN`. The predicate itself is byte-identical.
 *
 * ── WHY THIS RUNS AGAINST A REAL DATABASE ──────────────────────────────────
 * The defect IS a statement ordering inside a plpgsql body. No plpgsql executes
 * in `test:required`, and a regex over the migration file cannot observe which
 * of two statements runs first at runtime — a regex that a DECLARE block can
 * satisfy will happily report the wrong order. Every assertion below is made by
 * CALLING the function and then READING the database.
 *
 * ── RED-FIRST, AND THE MUTANT THAT BINDS IT ────────────────────────────────
 * Measured on postgres:15 (15.19) on 2026-09-21, with the repo's migrations
 * applied to a throwaway container:
 *   · at the deployed body (prosrc md5 829c3deb90594099397d64d747f4854e — the
 *     SAME md5 as the live function): the replay pin below RAISES OLGC1. RED.
 *   · after 20260920210000 (md5 7b78d8e12550628570e15b2b739c2d4d): GREEN.
 *   · MUTANT — the fixed body with ONLY the `IF NOT v_turn_preexisting THEN`
 *     guard deleted, the moved lookup KEPT (md5 5346f5e7f92b2202ade713035
 *     f53e65c): RED again. So these pins bind to the GUARD, not merely to the
 *     statement move.
 *
 * ── HOW TO RUN (local container only — NEVER staging) ──────────────────────
 *   docker run -d --name c4pg -e POSTGRES_PASSWORD=c4test -e POSTGRES_DB=cee \
 *     -p 55432:5432 postgres:15
 *   # then follow tests/integration/README-c4-local-db.md §2-§3 (the
 *   # reconstructed `scenarios` baseline, then the migration loop)
 *   RUN_C4_CANONICAL_STATE=1 \
 *   DATABASE_URL='postgres://postgres:c4test@localhost:55432/cee' \
 *     pnpm vitest run tests/integration/c8-append-v5-replay-precedes-cas.contract.test.ts
 *
 * Without both variables the suite SKIPS and never opens a connection.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';

const SHOULD_RUN =
  process.env.RUN_C4_CANONICAL_STATE === '1' && !!process.env.DATABASE_URL;

/** Every row this suite creates carries this, so a stray row is attributable. */
const RUN_ID = `c8replay-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

type Sql = ReturnType<typeof postgres>;
let sql: Sql;

const hex64 = (seed: string): string =>
  createHash('sha256').update(seed).digest('hex');

const ENVELOPE = {
  algorithm: 'sha256',
  projection: 'c8-replay-proof-projection-v1',
  normaliser: 'c8-replay-proof-normaliser-v1',
  schema: 'c8-replay-proof-schema-v1',
} as const;

const graphAt = (n: number): Record<string, unknown> => ({
  nodes: [{ id: `n${n}`, label: `node ${n}` }],
  edges: [],
});

function errState(e: unknown): string | null {
  const code = (e as { code?: unknown })?.code;
  return typeof code === 'string' ? code : null;
}

interface TurnResult {
  ok: boolean;
  sqlstate: string | null;
  message: string | null;
  turnRowId: string | null;
  receipt: Record<string, unknown> | null;
}

interface TurnArgs {
  scenarioId: string;
  turnId: string;
  graph: Record<string, unknown>;
  expected: string | null;
  incoming: string;
  mutationId: string;
  analysisHash: string;
  fenceGeneration: number | null;
  baseKnown?: boolean;
  casEnforce?: boolean;
}

/**
 * `generation` is a GLOBAL `BIGSERIAL PRIMARY KEY`
 * (20260731120000_v5_turn_fence.sql:87) — the per-scenario order is derived as
 * `MAX(generation)` FILTERED by scenario, not from a per-scenario counter. A
 * fixture that hands v4 a hand-picked generation therefore collides across
 * scenarios; always let the sequence allocate.
 */
async function claimFence(scenarioId: string, turnId: string): Promise<number> {
  const rows = await sql<{ generation: string }[]>`
    INSERT INTO public.v5_turn_fence (scenario_id, turn_id)
    VALUES (${scenarioId}::uuid, ${turnId}::text)
    RETURNING generation`;
  return Number(rows[0].generation);
}

/**
 * The deployed posture is `p_cas_enforce = true`: CEE computes it as
 * `rpcMode === 'enforce'` (src/orchestrator-v5/session/supabase-store.ts) and
 * Render sets CEE_V5_GRAPH_CAS_RPC=enforce. It is passed explicitly on every
 * call below rather than defaulted, so each pin states the regime it measures.
 */
async function appendTurn(args: TurnArgs): Promise<TurnResult> {
  try {
    const rows = await sql<{ r: Record<string, unknown> }[]>`
      SELECT public.append_turn_atomic_v5(
        ${args.scenarioId}::uuid,
        ${args.turnId}::text,
        'direct_answer'::text,
        NULL::text,
        ${hex64(`req-${args.turnId}`)}::text,
        TRUE, 1, 10,
        '[]'::jsonb,
        ${sql.json(args.graph as never)}::jsonb,
        ${`${RUN_ID}-brief`}::text,
        '[]'::jsonb,
        NULL::jsonb,
        NULL::text,
        NULL::text,
        ${args.expected}::text,
        ${args.incoming}::text,
        ${args.casEnforce ?? true},
        ${args.fenceGeneration}::bigint,
        ${args.mutationId}::uuid,
        ${args.analysisHash}::text,
        ${ENVELOPE.algorithm}::text,
        ${ENVELOPE.projection}::text,
        ${ENVELOPE.normaliser}::text,
        ${ENVELOPE.schema}::text,
        'system'::text,
        NULL::text,
        'committed_mutation'::text,
        ${args.turnId}::text,
        ${args.baseKnown ?? true}) AS r`;
    const payload = rows[0].r as {
      turn_row_id: string;
      model_version_receipt: Record<string, unknown> | null;
    };
    return {
      ok: true,
      sqlstate: null,
      message: null,
      turnRowId: payload.turn_row_id,
      receipt: payload.model_version_receipt,
    };
  } catch (e) {
    return {
      ok: false,
      sqlstate: errState(e),
      message: e instanceof Error ? e.message : String(e),
      turnRowId: null,
      receipt: null,
    };
  }
}

// ===========================================================================

describe.runIf(SHOULD_RUN)(
  'append_turn_atomic_v5 — replay is decided before CAS',
  () => {
    const createdScenarios: string[] = [];

    /** Owner scenarios get a non-null user_id: version creation requires it. */
    async function freshScenario(owned: boolean): Promise<string> {
      const id = randomUUID();
      const owner = owned ? randomUUID() : null;
      await sql`SELECT public.ensure_scenario_exists(${id}::uuid, ${owner}::uuid)`;
      await sql`UPDATE public.scenarios SET brief_text = ${`${RUN_ID}-${id}`} WHERE id = ${id}::uuid`;
      createdScenarios.push(id);
      return id;
    }

    /**
     * Walks a scenario to the state the defect needs: T0 establishes a graph,
     * T1 is the turn we will replay, T2 moves the head on. Nothing is
     * hand-seeded — every hash below is one the function itself stamped.
     */
    async function walkToMovedHead(scenarioId: string, prefix: string) {
      const h0 = hex64(`${RUN_ID}-${prefix}-0`);
      const h1 = hex64(`${RUN_ID}-${prefix}-1`);
      const h2 = hex64(`${RUN_ID}-${prefix}-2`);
      const m1 = randomUUID();

      const g0 = await claimFence(scenarioId, `${prefix}-T0`);
      const t0 = await appendTurn({
        scenarioId, turnId: `${prefix}-T0`, graph: graphAt(0),
        expected: null, incoming: h0, mutationId: randomUUID(),
        analysisHash: hex64(`${prefix}-aah0`), fenceGeneration: g0,
      });
      expect(t0.ok, `setup T0 failed: ${t0.sqlstate} ${t0.message}`).toBe(true);

      const g1 = await claimFence(scenarioId, `${prefix}-T1`);
      const t1 = await appendTurn({
        scenarioId, turnId: `${prefix}-T1`, graph: graphAt(1),
        expected: h0, incoming: h1, mutationId: m1,
        analysisHash: hex64(`${prefix}-aah1`), fenceGeneration: g1,
      });
      expect(t1.ok, `setup T1 failed: ${t1.sqlstate} ${t1.message}`).toBe(true);

      const g2 = await claimFence(scenarioId, `${prefix}-T2`);
      const t2 = await appendTurn({
        scenarioId, turnId: `${prefix}-T2`, graph: graphAt(2),
        expected: h1, incoming: h2, mutationId: randomUUID(),
        analysisHash: hex64(`${prefix}-aah2`), fenceGeneration: g2,
      });
      expect(t2.ok, `setup T2 failed: ${t2.sqlstate} ${t2.message}`).toBe(true);

      // The head really did move: the pin below is only meaningful if the CAS
      // predicate would otherwise fire.
      const [row] = await sql<{ hash: string | null }[]>`
        SELECT graph_identity_hash AS hash FROM public.scenarios WHERE id = ${scenarioId}::uuid`;
      expect(row.hash, 'setup did not move the head — the CAS could not fire').toBe(h2);

      /** Byte-identical arguments to T1 — this is what a replay is. */
      const replayArgs: TurnArgs = {
        scenarioId, turnId: `${prefix}-T1`, graph: graphAt(1),
        expected: h0, incoming: h1, mutationId: m1,
        analysisHash: hex64(`${prefix}-aah1`), fenceGeneration: g1,
      };
      return { h0, h1, h2, m1, t1, replayArgs };
    }

    async function counts(scenarioId: string) {
      const [row] = await sql<{ mv: number; ct: number }[]>`
        SELECT
          (SELECT COUNT(*)::int FROM public.model_versions WHERE scenario_id = ${scenarioId}::uuid) AS mv,
          (SELECT COUNT(*)::int FROM public.v5_conversation_turns WHERE scenario_id = ${scenarioId}::uuid) AS ct`;
      return row;
    }

    beforeAll(async () => {
      sql = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {} });
    });

    afterAll(async () => {
      if (!sql) return;
      for (const id of createdScenarios) {
        await sql`DELETE FROM public.v5_handler_facts WHERE scenario_id = ${id}::uuid`;
        await sql`DELETE FROM public.v5_conversation_turns WHERE scenario_id = ${id}::uuid`;
        await sql`DELETE FROM public.v5_turn_fence WHERE scenario_id = ${id}::uuid`;
        await sql`UPDATE public.scenarios SET current_model_version_id = NULL WHERE id = ${id}::uuid`;
        await sql`DELETE FROM public.model_versions WHERE scenario_id = ${id}::uuid`;
        await sql`DELETE FROM public.scenarios WHERE id = ${id}::uuid`;
      }
      // PROVE THE TEARDOWN LANDED — a teardown with no postcondition cannot
      // report its own failure (the lesson c4's afterAll paid for).
      if (createdScenarios.length > 0) {
        const [left] = await sql<{ n: number }[]>`
          SELECT COUNT(*)::int AS n FROM public.scenarios
           WHERE id = ANY(${createdScenarios}::uuid[])`;
        await sql.end();
        expect(left.n, 'teardown left scenarios behind').toBe(0);
        return;
      }
      await sql.end();
    });

    it('carrier is present (fails loud rather than skipping)', async () => {
      const rows = await sql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM pg_proc p
          JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = 'public' AND p.proname = 'append_turn_atomic_v5'`;
      expect(rows[0].n, 'append_turn_atomic_v5 is not installed on DATABASE_URL').toBe(1);
    });

    /**
     * ORDERING PIN, read from the INSTALLED body rather than the file.
     * Comments are stripped and the body sliced after BEGIN first: the DECLARE
     * block names `v_existing_turn_id`, so an unsliced probe reports the
     * opposite order and passes for the wrong reason.
     */
    it('the installed body looks up the turn BEFORE it evaluates the CAS', async () => {
      const [row] = await sql<{ def: string }[]>`
        SELECT pg_get_functiondef(p.oid) AS def FROM pg_proc p
          JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = 'public' AND p.proname = 'append_turn_atomic_v5'`;
      const stripped = row.def
        .split('\n')
        .map((line) => line.replace(/--.*$/, ''))
        .join('\n');
      const beginAt = stripped.search(/\nBEGIN\b/);
      expect(beginAt, 'no BEGIN in the function body — the probe is blind').toBeGreaterThan(-1);
      const body = stripped.slice(beginAt);

      const lookupAt = body.indexOf('INTO v_existing_turn_id');
      const casAt = body.indexOf('IF p_cas_enforce');
      const guardAt = body.indexOf('IF NOT v_turn_preexisting THEN');

      // CONTRAST CONTROL: both probes must SEE something, or "lookup < cas"
      // would be satisfied by two -1s.
      expect(lookupAt, 'replay lookup not found in the sliced body').toBeGreaterThan(-1);
      expect(casAt, 'CAS block not found in the sliced body').toBeGreaterThan(-1);
      expect(guardAt, 'the CAS is not guarded by IF NOT v_turn_preexisting').toBeGreaterThan(-1);
      expect(lookupAt, 'the CAS is evaluated BEFORE the replay lookup').toBeLessThan(casAt);
      expect(guardAt, 'the replay guard opens before the CAS it guards').toBeLessThan(casAt);
    });

    it('THE DEFECT: replaying a committed turn after the head moved returns its receipt, and does not raise', async () => {
      const scenarioId = await freshScenario(true);
      const { t1, replayArgs } = await walkToMovedHead(scenarioId, 'owned');
      const before = await counts(scenarioId);

      const replay = await appendTurn(replayArgs);

      expect(
        replay.sqlstate,
        'the replay of a COMMITTED turn was refused as a stale write',
      ).toBe(null);
      expect(replay.ok).toBe(true);
      expect(replay.turnRowId, 'the replay returned a different turn row').toBe(t1.turnRowId);
      expect(
        replay.receipt,
        'the replay returned no model_version_receipt',
      ).not.toBe(null);
      // Bound by IDENTITY, not by shape: the whole receipt, deep-equal.
      expect(replay.receipt).toEqual(t1.receipt);

      const after = await counts(scenarioId);
      expect(after.mv, 'the replay created a second model version').toBe(before.mv);
      expect(after.ct, 'the replay created a second turn row').toBe(before.ct);
    });

    it('and the write it was previously told was stale is still durably there', async () => {
      const scenarioId = await freshScenario(true);
      const { m1, replayArgs } = await walkToMovedHead(scenarioId, 'durable');
      const replay = await appendTurn(replayArgs);
      expect(replay.ok).toBe(true);

      const [row] = await sql<{ turns: number; versions: number }[]>`
        SELECT
          (SELECT COUNT(*)::int FROM public.v5_conversation_turns
            WHERE scenario_id = ${scenarioId}::uuid AND turn_id = ${replayArgs.turnId}::text) AS turns,
          (SELECT COUNT(*)::int FROM public.model_versions
            WHERE scenario_id = ${scenarioId}::uuid AND mutation_id = ${m1}::uuid) AS versions`;
      expect(row.turns, 'the replayed turn has no durable row').toBe(1);
      expect(row.versions, 'the replayed turn has no durable model version').toBe(1);
    });

    it('C1 the CAS is NOT disabled: a genuinely stale NEW turn is still refused', async () => {
      const scenarioId = await freshScenario(true);
      const { h0 } = await walkToMovedHead(scenarioId, 'stale');
      const gen = await claimFence(scenarioId, 'stale-T3');
      const fresh = await appendTurn({
        scenarioId,
        turnId: 'stale-T3',
        graph: graphAt(3),
        expected: h0, // the base this writer READ, three turns ago
        incoming: hex64(`${RUN_ID}-stale-3`),
        mutationId: randomUUID(),
        analysisHash: hex64('stale-aah3'),
        fenceGeneration: gen,
      });
      expect(fresh.ok, 'a stale NEW write was accepted — the CAS is disabled').toBe(false);
      expect(fresh.sqlstate).toBe('OLGC1');
    });

    it('C2 replay identity is still guarded: the same turn_id with another mutation id is refused', async () => {
      const scenarioId = await freshScenario(true);
      const { replayArgs } = await walkToMovedHead(scenarioId, 'ident');
      const impostor = await appendTurn({ ...replayArgs, mutationId: randomUUID() });
      expect(impostor.ok, 'a replay carrying another mutation id was accepted').toBe(false);
      expect(impostor.sqlstate).toBe('MV422');
    });

    it('C3 a GUEST scenario commits with a NULL receipt, and its replay returns NULL rather than raising', async () => {
      const scenarioId = await freshScenario(false);
      const { t1, replayArgs } = await walkToMovedHead(scenarioId, 'guest');
      expect(t1.receipt, 'a guest turn must not mint a version receipt').toBe(null);

      const replay = await appendTurn(replayArgs);
      expect(replay.sqlstate, 'the guest replay was refused as a stale write').toBe(null);
      expect(replay.ok).toBe(true);
      expect(replay.receipt, 'a guest replay must return a NULL receipt').toBe(null);

      const [row] = await sql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM public.model_versions WHERE scenario_id = ${scenarioId}::uuid`;
      expect(row.n, 'a guest scenario must hold no model versions').toBe(0);
    });

    it('C5 the first-write exemption survives: a scenario whose current hash is NULL is not refused', async () => {
      const scenarioId = await freshScenario(true);
      const gen = await claimFence(scenarioId, 'firstwrite-T1');
      const first = await appendTurn({
        scenarioId,
        turnId: 'firstwrite-T1',
        graph: graphAt(9),
        // A legacy row whose graph exists but whose hash was never stamped:
        // the caller legitimately supplies a recomputed expected hash while
        // `current` reads NULL. Refusing that bricks every unstamped scenario.
        expected: hex64(`${RUN_ID}-never-stamped`),
        incoming: hex64(`${RUN_ID}-firstwrite-incoming`),
        mutationId: randomUUID(),
        analysisHash: hex64('firstwrite-aah'),
        fenceGeneration: gen,
      });
      expect(
        first.ok,
        `the first-write exemption was lost: ${first.sqlstate} ${first.message}`,
      ).toBe(true);
    });
  },
);
