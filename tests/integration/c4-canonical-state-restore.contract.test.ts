/**
 * COMPONENT 4 — CANONICAL STATE / TRANSACTIONAL EDITING.
 * ACCEPTANCE FIXTURES for an all-or-nothing restore.
 *
 * ── WHAT THESE ARE FOR ─────────────────────────────────────────────────────
 * These pin the CONTRACT, not an implementation. They are written to pass or
 * fail ANY carrier that claims a restore is atomic. Exactly one thing is
 * carrier-specific — the `RestoreCarrier` binding below — and swapping it is
 * the whole cost of pointing these at a different implementation.
 *
 * The closure condition they exist to decide:
 *
 *   an accepted semantic mutation and a restore are each ALL-OR-NOTHING,
 *   and no partial state is representable.
 *
 * ── ⚠ WHY THIS RUNS AGAINST A REAL DATABASE, AND WHY IT MUST ───────────────
 * No plpgsql executes in `test:required`. SQL in this repo is otherwise
 * asserted only by regex-over-file static guards, and a regex cannot observe
 * a transaction boundary. A TypeScript-only version of this file would prove
 * things about TypeScript and NOTHING about atomicity — a green suite that
 * never reached a transaction, which is precisely the guarantee theatre this
 * estate hunts. So every assertion below is made by READING THE DATABASE
 * after the operation, never by trusting a response body.
 *
 * ── HOW TO RUN (local only — never staging) ────────────────────────────────
 *   docker run -d --name c4pg -e POSTGRES_PASSWORD=c4test -e POSTGRES_DB=cee \
 *     -p 55432:5432 postgres:15
 *   # apply the repo's migrations AND Codex's carrier migration
 *   # (20260824200000, on codex/c8-a-integration — NOT on this branch).
 *   # See tests/integration/README-c4-local-db.md — including the
 *   # mutation_id column-type collision check, which is not optional.
 *   RUN_C4_CANONICAL_STATE=1 \
 *   DATABASE_URL='postgres://postgres:c4test@localhost:55432/cee' \
 *     pnpm vitest run tests/integration/c4-canonical-state-restore.contract.test.ts
 *
 * ⚠ DO NOT POINT THIS AT STAGING. It installs and drops failure-injection
 * TRIGGERS (see below), which is a schema mutation. If anyone ever must run
 * it against a shared database, every object it creates is prefixed
 * `c4acc_` and every row it writes carries the RUN_ID in a marker column —
 * but the correct answer is a local container.
 *
 * ── HOW FAILURE INJECTION WORKS, AND WHY IT DISCRIMINATES ──────────────────
 * A restore touches three things: an undo snapshot, a new head version, and
 * the working graph. A NON-ATOMIC carrier writes them in separate
 * transactions, so a failure between any two leaves the earlier ones
 * committed. An ATOMIC carrier has no "between".
 *
 * These fixtures inject a failure with a BEFORE INSERT trigger keyed on a
 * sentinel, so the injection lands at the same logical step regardless of how
 * the carrier is built — it does not know or care whether the carrier issued
 * one statement or three. Then it reads the database and asks the only
 * question that matters: IS ANYTHING LEFT BEHIND?
 *
 * The suite runs against TWO carriers on purpose:
 *   · `pristineCarrier` — the pre-atomic three-transaction sequence, exactly
 *     as the route issued it (snapshot RPC → restore RPC → graph append).
 *   · `codexCarrier`   — the carrier under test:
 *     `restore_model_version_atomic_v1` (CEE codex/c8-a-integration @ 8e6de866).
 * The pins MUST go RED on the pristine carrier and GREEN on the atomic one.
 * A pin that passes for both is not measuring atomicity, and the
 * discrimination test at the bottom fails loudly if that ever happens. This
 * is the estate's discriminating-pair rule: one biting result proves
 * sensitivity to SOMETHING; the pair proves sensitivity to THE PROPERTY.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';

const SHOULD_RUN =
  process.env.RUN_C4_CANONICAL_STATE === '1' && !!process.env.DATABASE_URL;

/** Every object and row this suite creates carries this. */
const RUN_ID = `c4acc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

type Sql = ReturnType<typeof postgres>;
let sql: Sql;

// ---------------------------------------------------------------------------
// Identity helpers. The REAL identity hash is computed CEE-side by
// computeGraphIdentityHash; these fixtures are about the TRANSACTION, so they
// use a stable stand-in. What matters is that the same graph always maps to
// the same 64-hex value and different graphs to different ones — which is the
// only property the storage layer relies on.
// ---------------------------------------------------------------------------
function hashOf(graph: unknown): string {
  const s = JSON.stringify(graph);
  let h = 0n;
  for (const ch of s) h = (h * 131n + BigInt(ch.codePointAt(0)!)) % (1n << 128n);
  return h.toString(16).padStart(64, '0').slice(0, 64);
}

const ENVELOPE = {
  projection: 'identity.v1',
  normaliser: '1',
  schema: 'graph_v3',
  algorithm: 'sha256',
} as const;

// ---------------------------------------------------------------------------
// THE CARRIER BINDING — the ONLY implementation-specific code in this file.
// ---------------------------------------------------------------------------

export interface RestoreRequest {
  scenarioId: string;
  versionId: string;
  mutationId: string;
  /** The target version's graph, as the carrier would project it. */
  graph: unknown;
  /** The target version's stored identity hash. */
  sourceHash: string;
  /** CAS expectation against the WORKING graph. */
  expectedWorkingHash?: string | null;
  label?: string | null;
}

export type RestoreResult =
  | { ok: true; receipt: Record<string, unknown> }
  | { ok: false; sqlstate: string | null; message: string };

export interface RestoreCarrier {
  readonly name: string;
  /** True when the carrier claims all-or-nothing. Only used by the
   *  discrimination test's expectations — never by an invariant. */
  readonly claimsAtomic: boolean;
  restore(db: Sql, req: RestoreRequest): Promise<RestoreResult>;
}

function errState(e: unknown): string | null {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : null;
}

/**
 * THE CARRIER UNDER TEST — Codex's `restore_model_version_atomic_v1`
 * (CEE `codex/c8-a-integration` @ 8e6de866, migration
 * `20260824200000_c8_atomic_model_version_restore.sql`).
 *
 * This is the ONLY implementation-specific code in the file. Everything below
 * it asserts properties, not mechanics.
 *
 * Shape notes, so a failure here is never misread as a defect:
 *  · `p_mutation_id` is a UUID, not free text — the harness derives a STABLE
 *    UUID from its string key so a replay presents the same identity.
 *  · The carrier takes the current graph AND re-reads it under its own lock.
 *    The harness supplies the caller's view; the RPC's own read is what wins.
 *  · `p_actor_kind`/`p_authored_by` are constrained together
 *    (`model_versions_actor_consistency_ck`). 'system' + NULL is the valid
 *    pairing for a fixture with no human actor.
 *  · `p_source_turn_id` is uniquely indexed per scenario, so it is derived
 *    from the mutation key rather than shared.
 */
function stableUuidFrom(key: string): string {
  const h = createHash('sha256').update(key).digest('hex');
  // RFC-4122 v4-shaped so it satisfies the actor/UUID regex family.
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}

/** A second 64-hex hash standing in for the analysis-affecting hash. The
 *  carrier requires it NOT NULL and distinct in role from the identity hash. */
function analysisHashOf(graph: unknown): string {
  return hashOf({ __analysis: graph });
}

const codexCarrier: RestoreCarrier = {
  name: 'restore_model_version_atomic_v1 (Codex C8, single transaction)',
  claimsAtomic: true,
  async restore(db, req) {
    try {
      const cur = await db`
        SELECT graph, graph_identity_hash FROM public.scenarios
         WHERE id = ${req.scenarioId}::uuid`;
      const curGraph = cur[0]?.graph ?? null;
      const curHash = (cur[0]?.graph_identity_hash as string | null) ?? null;
      const rows = await db`
        SELECT public.restore_model_version_atomic_v1(
          ${req.scenarioId}::uuid,
          ${req.versionId}::uuid,
          ${stableUuidFrom(req.mutationId)}::uuid,
          ${db.json(req.graph as never)}::jsonb,
          ${hashOf(req.graph)}::text,
          ${analysisHashOf(req.graph)}::text,
          ${ENVELOPE.projection}::text,
          ${ENVELOPE.normaliser}::text,
          ${ENVELOPE.schema}::text,
          ${ENVELOPE.algorithm}::text,
          ${req.sourceHash}::text,
          ${curGraph === null ? null : db.json(curGraph as never)}::jsonb,
          ${curHash}::text,
          ${curGraph === null ? null : analysisHashOf(curGraph)}::text,
          ${req.expectedWorkingHash ?? null}::text,
          'system'::text,
          NULL::text,
          ${`turn_${stableUuidFrom(req.mutationId)}`}::text,
          ${req.label ?? null}::text
        ) AS receipt`;
      return { ok: true, receipt: rows[0].receipt as Record<string, unknown> };
    } catch (e) {
      return { ok: false, sqlstate: errState(e), message: String(e) };
    }
  },
};

/**
 * THE PRE-ATOMIC CARRIER, reproduced faithfully: three SEPARATE transactions,
 * in the order `src/routes/assist.v1.scenario-versions.ts` issued them at
 * staging `cd3d6aee` — snapshot (`:653`), restore RPC (`:685`), graph append
 * (`:742`). Each `db\`...\`` below is its own implicit transaction, which is
 * the entire defect: the route made three PostgREST round trips, and PostgREST
 * commits each one.
 *
 * This exists ONLY so the pins can be shown to bite. It is never a fallback.
 */
const pristineCarrier: RestoreCarrier = {
  name: 'pre-atomic three-transaction sequence (route @ cd3d6aee)',
  claimsAtomic: false,
  async restore(db, req) {
    // W1 — the pre-restore snapshot. Its own transaction.
    let undoId: string | null = null;
    try {
      const cur = await db`
        SELECT graph, graph_identity_hash FROM public.scenarios
         WHERE id = ${req.scenarioId}::uuid`;
      const curGraph = cur[0]?.graph ?? null;
      const curHash = cur[0]?.graph_identity_hash ?? null;
      if (curGraph !== null) {
        const snap = await db`
          SELECT public.create_model_version(
            ${req.scenarioId}::uuid, ${db.json(curGraph as never)}::jsonb,
            ${curHash}::text, ${ENVELOPE.projection}::text,
            ${ENVELOPE.normaliser}::text, ${ENVELOPE.schema}::text,
            ${ENVELOPE.algorithm}::text, 'Before restore'::text,
            'pre_restore'::text, ${`pre_restore_${req.mutationId}`}::text,
            NULL::text) AS o`;
        undoId = (snap[0].o as { version_id: string }).version_id;
      }
    } catch (e) {
      return { ok: false, sqlstate: errState(e), message: `W1 ${String(e)}` };
    }

    // W2 — the restore version row + head move. A SEPARATE transaction.
    let receipt: Record<string, unknown>;
    try {
      const r = await db`
        SELECT public.restore_model_version(
          ${req.scenarioId}::uuid, ${req.versionId}::uuid,
          ${req.label ?? null}::text, NULL::text,
          ${req.expectedWorkingHash ?? null}::text) AS o`;
      receipt = { ...(r[0].o as Record<string, unknown>), undo_version_id: undoId };
    } catch (e) {
      return { ok: false, sqlstate: errState(e), message: `W2 ${String(e)}` };
    }

    // W3 — the working graph. A THIRD transaction. If this fails, W1 and W2
    // are already committed — the `RESTORE_INCOMPLETE` state.
    try {
      await db`
        SELECT public.append_turn_atomic_v4(
          ${req.scenarioId}::uuid, ${`version_restore:${req.mutationId}`}::text,
          'direct_answer'::text, NULL::text,
          ${`version_restore:${req.mutationId}`}::text, FALSE, 0, 0,
          '[]'::jsonb, ${db.json(req.graph as never)}::jsonb, NULL::text,
          '[]'::jsonb, NULL::jsonb, NULL::text, NULL::text,
          ${req.expectedWorkingHash ?? null}::text, ${hashOf(req.graph)}::text,
          TRUE, NULL::bigint)`;
    } catch (e) {
      return { ok: false, sqlstate: errState(e), message: `W3 ${String(e)}` };
    }
    return { ok: true, receipt };
  },
};

// ---------------------------------------------------------------------------
// Failure injection — BEFORE INSERT triggers keyed on a sentinel.
// Carrier-agnostic: the injection lands at a logical STEP, and knows nothing
// about how many statements the carrier used to get there.
// ---------------------------------------------------------------------------

/**
 * ⚠ REWRITTEN when the suite was rebound to Codex's carrier, and the reason
 * matters: the FIRST version of these injectors keyed on `v5_conversation_turns`,
 * because the carrier it was written against wrote the working graph through
 * `append_turn_atomic_v4`. Codex's `restore_model_version_atomic_v1` writes
 * `scenarios` with a DIRECT `UPDATE` and inserts no turn row at all — so that
 * injector would silently never fire, and every partial-state pin would have
 * passed for the wrong reason. A fixture bound to HOW a carrier writes is not
 * carrier-agnostic; it must bind to WHAT changes.
 *
 * These key on the logical step instead:
 *   · restore version row  → BEFORE INSERT on model_versions, provenance='restore'
 *   · working graph write  → BEFORE UPDATE on scenarios, graph actually changing
 *
 * Armed through a control TABLE rather than a session GUC because postgres.js
 * pools connections: a `SET` would not reliably reach the connection the
 * carrier runs on.
 */
const INJECT_NONE = 'none';
const INJECT_RESTORE_ROW = 'restore_row';
const INJECT_GRAPH_WRITE = 'graph_write';

async function installInjectors(db: Sql): Promise<void> {
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS public.c4acc_control (
      id INT PRIMARY KEY DEFAULT 1, inject TEXT NOT NULL DEFAULT 'none');
    INSERT INTO public.c4acc_control (id, inject) VALUES (1, 'none')
      ON CONFLICT (id) DO UPDATE SET inject = 'none';

    CREATE OR REPLACE FUNCTION public.c4acc_fail_on_restore_row()
    RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
    BEGIN
      IF (SELECT inject FROM public.c4acc_control WHERE id = 1) = '${INJECT_RESTORE_ROW}'
         AND NEW.provenance = 'restore' THEN
        RAISE EXCEPTION 'c4acc injected failure at the restore version row'
          USING ERRCODE = 'C4INJ';
      END IF;
      RETURN NEW;
    END $fn$;

    DROP TRIGGER IF EXISTS c4acc_restore_row_injector ON public.model_versions;
    CREATE TRIGGER c4acc_restore_row_injector
      BEFORE INSERT ON public.model_versions
      FOR EACH ROW EXECUTE FUNCTION public.c4acc_fail_on_restore_row();

    CREATE OR REPLACE FUNCTION public.c4acc_fail_on_graph_write()
    RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
    BEGIN
      IF (SELECT inject FROM public.c4acc_control WHERE id = 1) = '${INJECT_GRAPH_WRITE}'
         AND NEW.graph IS DISTINCT FROM OLD.graph THEN
        RAISE EXCEPTION 'c4acc injected failure at the working-graph write'
          USING ERRCODE = 'C4INJ';
      END IF;
      RETURN NEW;
    END $fn$;

    DROP TRIGGER IF EXISTS c4acc_graph_write_injector ON public.scenarios;
    CREATE TRIGGER c4acc_graph_write_injector
      BEFORE UPDATE ON public.scenarios
      FOR EACH ROW EXECUTE FUNCTION public.c4acc_fail_on_graph_write();`);
}

/** Arm/disarm. Always disarmed in a finally — a leaked arm would red the
 *  whole rest of the file with an unrelated cause. */
async function setInject(db: Sql, mode: string): Promise<void> {
  await db`UPDATE public.c4acc_control SET inject = ${mode} WHERE id = 1`;
}

async function removeInjectors(db: Sql): Promise<void> {
  await db.unsafe(
    `DROP TRIGGER IF EXISTS c4acc_restore_row_injector ON public.model_versions;
     DROP TRIGGER IF EXISTS c4acc_graph_write_injector ON public.scenarios;
     DROP FUNCTION IF EXISTS public.c4acc_fail_on_restore_row();
     DROP FUNCTION IF EXISTS public.c4acc_fail_on_graph_write();
     DROP TABLE IF EXISTS public.c4acc_control;`,
  );
}

// ---------------------------------------------------------------------------
// Authoritative state — read from the database, never from a receipt.
// ---------------------------------------------------------------------------

interface AuthoritativeState {
  graph: unknown;
  graphHash: string | null;
  headId: string | null;
  headGraph: unknown;
  headHash: string | null;
  versionCount: number;
  versionIds: string[];
  preRestoreCount: number;
}

async function readState(db: Sql, scenarioId: string): Promise<AuthoritativeState> {
  const s = await db`
    SELECT graph, graph_identity_hash, current_model_version_id
      FROM public.scenarios WHERE id = ${scenarioId}::uuid`;
  const headId = (s[0]?.current_model_version_id as string | null) ?? null;
  const head = headId
    ? await db`SELECT graph, graph_identity_hash FROM public.model_versions
                WHERE id = ${headId}::uuid`
    : [];
  const vs = await db`
    SELECT id, provenance FROM public.model_versions
     WHERE scenario_id = ${scenarioId}::uuid ORDER BY version_number`;
  return {
    graph: s[0]?.graph ?? null,
    graphHash: (s[0]?.graph_identity_hash as string | null) ?? null,
    headId,
    headGraph: head[0]?.graph ?? null,
    headHash: (head[0]?.graph_identity_hash as string | null) ?? null,
    versionCount: vs.length,
    versionIds: vs.map((r) => r.id as string),
    preRestoreCount: vs.filter((r) => r.provenance === 'pre_restore').length,
  };
}

// ---------------------------------------------------------------------------
// Scenario seeding.
// ---------------------------------------------------------------------------

const GRAPH_V1 = { nodes: [{ id: 'n1', label: 'A' }], edges: [] };
const GRAPH_V2 = { nodes: [{ id: 'n1', label: 'A' }, { id: 'n2', label: 'B' }], edges: [] };
/** A working graph that NO version captures — see `seedDivergent`. */
const GRAPH_DRIFT = {
  nodes: [{ id: 'n1', label: 'A' }, { id: 'n2', label: 'B' }, { id: 'n3', label: 'C' }],
  edges: [],
};

interface Seeded {
  scenarioId: string;
  v1Id: string;
  v1Hash: string;
}

/**
 * ⚠ TWO STATE-CLASSES, AND THEY MEASURE DIFFERENT THINGS.
 *
 * `seedScenario` produces the STEADY state: the head version's identity
 * already equals the working graph's, because a version was saved from it.
 *
 * `seedDivergent` produces the DRIFTED state: the working graph has moved on
 * and NO version captures it. That is not a contrived case — it is routine.
 * CEE's commit-seam version hook is fire-and-forget OUTSIDE the commit
 * transaction (`src/orchestrator-v5/commit.ts:1208`, `void
 * recordModelVersionForCommit(...)`), is flag-gated, is skipped for guests,
 * and has a documented bootstrap case that writes no version at all. So the
 * graph routinely moves without a version behind it.
 *
 * The distinction is load-bearing and was found BY RUNNING THIS SUITE: in the
 * steady state `create_model_version`'s no-op dedupe returns the existing
 * head instead of inserting, so a failed restore leaves NO orphan row and P1
 * has nothing to observe. The orphan — and the undo snapshot's whole reason
 * for existing — appears only when the working graph has drifted. A fixture
 * that only ever seeded the steady state would have reported the pristine
 * carrier as clean at P1, which is false.
 */
async function seedScenario(db: Sql): Promise<Seeded> {
  const scenarioId = randomUUID();
  const ownerId = randomUUID();
  await db`SELECT public.ensure_scenario_exists(${scenarioId}::uuid, ${ownerId}::uuid)`;
  await db`UPDATE public.scenarios SET brief_text = ${`${RUN_ID} DELETE ME`}
            WHERE id = ${scenarioId}::uuid`;

  await writeWorkingGraph(db, scenarioId, GRAPH_V1, `${RUN_ID}-seed1`);
  const v1 = await db`
    SELECT public.create_model_version(
      ${scenarioId}::uuid, ${db.json(GRAPH_V1 as never)}::jsonb,
      ${hashOf(GRAPH_V1)}::text, ${ENVELOPE.projection}::text,
      ${ENVELOPE.normaliser}::text, ${ENVELOPE.schema}::text,
      ${ENVELOPE.algorithm}::text, 'v1'::text, 'user_save'::text,
      NULL::text, NULL::text) AS o`;

  await writeWorkingGraph(db, scenarioId, GRAPH_V2, `${RUN_ID}-seed2`);
  await db`
    SELECT public.create_model_version(
      ${scenarioId}::uuid, ${db.json(GRAPH_V2 as never)}::jsonb,
      ${hashOf(GRAPH_V2)}::text, ${ENVELOPE.projection}::text,
      ${ENVELOPE.normaliser}::text, ${ENVELOPE.schema}::text,
      ${ENVELOPE.algorithm}::text, 'v2'::text, 'user_save'::text,
      NULL::text, NULL::text) AS o`;

  const o = v1[0].o as { version_id: string };
  return { scenarioId, v1Id: o.version_id, v1Hash: hashOf(GRAPH_V1) };
}

/**
 * The DRIFTED state-class: the working graph moves to GRAPH_DRIFT with NO
 * version created, exactly as an ordinary turn does when the fire-and-forget
 * version hook does not land. After this the head is v2 while the working
 * graph is GRAPH_DRIFT — the state an undo snapshot exists to protect.
 */
async function seedDivergent(db: Sql): Promise<Seeded> {
  const s = await seedScenario(db);
  await writeWorkingGraph(db, s.scenarioId, GRAPH_DRIFT, `${RUN_ID}-drift-${randomUUID()}`);
  return s;
}

async function writeWorkingGraph(
  db: Sql,
  scenarioId: string,
  graph: unknown,
  turnId: string,
): Promise<void> {
  await db`
    SELECT public.append_turn_atomic_v4(
      ${scenarioId}::uuid, ${turnId}::text, 'direct_answer'::text, NULL::text,
      ${turnId}::text, FALSE, 0, 0, '[]'::jsonb,
      ${db.json(graph as never)}::jsonb, NULL::text, '[]'::jsonb, NULL::jsonb,
      NULL::text, NULL::text, NULL::text, ${hashOf(graph)}::text, FALSE,
      NULL::bigint)`;
}

// ===========================================================================

describe.runIf(SHOULD_RUN)('C4 — canonical state: restore is all-or-nothing', () => {
  const createdScenarios: string[] = [];

  beforeAll(async () => {
    sql = postgres(process.env.DATABASE_URL!, { max: 8, onnotice: () => {} });
    await installInjectors(sql);
  });

  afterAll(async () => {
    if (!sql) return;
    await removeInjectors(sql);
    for (const id of createdScenarios) {
      // FK order. Only rows this run created — nothing pre-existing.
      await sql`DELETE FROM public.v5_handler_facts WHERE scenario_id = ${id}::uuid`;
      await sql`DELETE FROM public.v5_conversation_turns WHERE scenario_id = ${id}::uuid`;
      await sql`UPDATE public.scenarios SET current_model_version_id = NULL WHERE id = ${id}::uuid`;
      await sql`UPDATE public.model_versions SET undo_version_id = NULL WHERE scenario_id = ${id}::uuid`;
      await sql`DELETE FROM public.model_versions WHERE scenario_id = ${id}::uuid`;
      await sql`DELETE FROM public.scenarios WHERE id = ${id}::uuid`;
    }
    await sql.end({ timeout: 5 });
  });

  async function seed(): Promise<Seeded> {
    const s = await seedScenario(sql);
    createdScenarios.push(s.scenarioId);
    return s;
  }

  /** The DRIFTED state-class — see seedDivergent. */
  async function seedDrifted(): Promise<Seeded> {
    const s = await seedDivergent(sql);
    createdScenarios.push(s.scenarioId);
    return s;
  }

  // ── 0. The instrument must be able to SEE. ────────────────────────────────
  describe('instrument liveness (a control that returns nothing proves nothing)', () => {
    it('the carrier under test is PRESENT in this database', async () => {
      const rows = await sql`
        SELECT proname FROM pg_proc WHERE proname = 'restore_model_version_atomic_v1'`;
      expect(
        rows.length,
        'restore_model_version_atomic_v1 is ABSENT. This suite is BLOCKED ON ' +
          "THE MIGRATION: apply Codex's " +
          'supabase/migrations/20260824200000_c8_atomic_model_version_restore.sql ' +
          'to this database. Not a skip — an unapplied migration must be loud.',
      ).toBe(1);
    });

    it('the seeded fixture really is a divergent restore (not a no-op)', async () => {
      const { scenarioId, v1Id, v1Hash } = await seed();
      const before = await readState(sql, scenarioId);
      // The precondition every pin below depends on: the working graph is
      // NOT already the target. A fixture that silently became a no-op would
      // make every "nothing changed" assertion pass vacuously.
      expect(before.graphHash).toBe(hashOf(GRAPH_V2));
      expect(v1Hash).toBe(hashOf(GRAPH_V1));
      expect(before.graphHash).not.toBe(v1Hash);
      expect(before.versionCount).toBe(2);
      expect(v1Id).toBeTruthy();
    });

    it('the injectors really fire (positive control)', async () => {
      const { scenarioId } = await seed();
      let threw = false;
      await setInject(sql, INJECT_GRAPH_WRITE);
      try {
        await writeWorkingGraph(sql, scenarioId, GRAPH_V1, `${RUN_ID}-inj-control`);
      } catch (e) {
        threw = true;
        expect(errState(e)).toBe('C4INJ');
      } finally {
        await setInject(sql, INJECT_NONE);
      }
      expect(threw, 'the graph-write injector did not fire — every partial-state pin below would pass vacuously').toBe(true);
    });

    it('the injectors do NOT fire without the sentinel (contrast control)', async () => {
      const { scenarioId } = await seed();
      await setInject(sql, INJECT_NONE);
      await expect(
        writeWorkingGraph(sql, scenarioId, GRAPH_V1, `${RUN_ID}-clean-control`),
      ).resolves.toBeUndefined();
    });
  });

  // ── The invariant suite, run against BOTH carriers. ───────────────────────
  for (const carrier of [pristineCarrier, codexCarrier]) {
    const expectAtomic = carrier.claimsAtomic;
    // A pin's expectation is derived from the carrier's CLAIM, so the pristine
    // carrier documents the defect rather than being skipped. `expectAtomic`
    // is never read by the measurement — only by the expectation.
    describe(`carrier: ${carrier.name}`, () => {
      // ── PARTIAL STATE 1 — failure at the RESTORE VERSION ROW, i.e. AFTER
      //    any undo snapshot has been taken. This is the UNDISCLOSED one: the
      //    pre-atomic route reported it as an ordinary refusal with no hint
      //    that a `pre_restore` row and a moved head were left behind.
      it(`P1: a failure after the undo snapshot leaves ${
        expectAtomic ? 'NOTHING' : 'AN ORPHAN pre_restore ROW'
      }`, async () => {
        // DRIFTED state-class: the undo snapshot must actually INSERT here,
        // so a failure immediately after it leaves an observable orphan. In
        // the steady state the snapshot dedupes to head and there is nothing
        // to observe — measured, see seedDivergent.
        const { scenarioId, v1Id, v1Hash } = await seedDrifted();
        const before = await readState(sql, scenarioId);

        await setInject(sql, INJECT_RESTORE_ROW);
        let res: RestoreResult;
        try {
          res = await carrier.restore(sql, {
            scenarioId,
            versionId: v1Id,
            mutationId: `${RUN_ID}-p1-${randomUUID()}`,
            graph: GRAPH_V1,
            sourceHash: v1Hash,
            expectedWorkingHash: before.graphHash,
            label: 'p1',
          });
        } finally {
          await setInject(sql, INJECT_NONE);
        }
        expect(res.ok, 'the injected failure did not refuse the operation').toBe(false);

        const after = await readState(sql, scenarioId);
        if (expectAtomic) {
          expect(after.versionCount, 'an atomic carrier must leave NO version row behind').toBe(
            before.versionCount,
          );
          expect(after.preRestoreCount).toBe(before.preRestoreCount);
          expect(after.headId, 'the head must not move on a refused restore').toBe(before.headId);
        } else {
          // The defect, measured rather than asserted.
          expect(after.preRestoreCount).toBeGreaterThan(before.preRestoreCount);
          expect(after.headId).not.toBe(before.headId);
        }
        // TRUE OF BOTH: the working graph must never move on a refusal.
        expect(after.graphHash).toBe(before.graphHash);
      });

      // ── PARTIAL STATE 2 — failure at the WORKING GRAPH WRITE, i.e. after
      //    the version row and the head move. This is `RESTORE_INCOMPLETE`.
      it(`P2: a failure at the graph write leaves ${
        expectAtomic ? 'head AND graph in agreement' : 'THE HEAD AHEAD OF THE GRAPH'
      }`, async () => {
        const { scenarioId, v1Id, v1Hash } = await seed();
        const before = await readState(sql, scenarioId);

        await setInject(sql, INJECT_GRAPH_WRITE);
        let res: RestoreResult;
        try {
          res = await carrier.restore(sql, {
            scenarioId,
            versionId: v1Id,
            mutationId: `${RUN_ID}-p2-${randomUUID()}`,
            graph: GRAPH_V1,
            sourceHash: v1Hash,
            expectedWorkingHash: before.graphHash,
            label: 'p2',
          });
        } finally {
          await setInject(sql, INJECT_NONE);
        }
        expect(res.ok, 'the injected failure did not refuse the operation').toBe(false);

        const after = await readState(sql, scenarioId);
        // THE CLOSURE CONDITION, stated as one assertion: the head version's
        // content and the working graph must describe the same model.
        if (expectAtomic) {
          expect(
            after.headHash,
            'ATOMICITY VIOLATED: the head version and the working graph disagree ' +
              'after a refused restore — this is the RESTORE_INCOMPLETE state',
          ).toBe(after.graphHash);
          expect(after.versionCount).toBe(before.versionCount);
          expect(after.headId).toBe(before.headId);
        } else {
          expect(after.headHash).not.toBe(after.graphHash);
          expect(after.graphHash).toBe(before.graphHash);
        }
      });

      // ── SUCCESS PATH: reload agreement. ────────────────────────────────
      it('S1: the receipt agrees with a FRESH read of authoritative state', async () => {
        const { scenarioId, v1Id, v1Hash } = await seed();
        const before = await readState(sql, scenarioId);

        const res = await carrier.restore(sql, {
          scenarioId,
          versionId: v1Id,
          mutationId: `${RUN_ID}-s1`,
          graph: GRAPH_V1,
          sourceHash: v1Hash,
          expectedWorkingHash: before.graphHash,
          label: 'reload agreement',
        });
        expect(res.ok, `restore failed: ${!res.ok ? res.message : ''}`).toBe(true);
        if (!res.ok) return;

        const after = await readState(sql, scenarioId);
        expect(after.graphHash, 'the working graph is not the restored graph').toBe(v1Hash);
        expect(after.graph).toEqual(GRAPH_V1);
        expect(String(res.receipt.version_id), 'the head disagrees with the receipt').toBe(
          String(after.headId),
        );
      });

      // ── THE RE-PROJECTION TWIN. Atomicity alone does NOT satisfy this. ──
      it('S2: the head version graph and scenarios.graph describe the SAME CONTENT', async () => {
        const { scenarioId, v1Id, v1Hash } = await seed();
        const before = await readState(sql, scenarioId);

        const res = await carrier.restore(sql, {
          scenarioId,
          versionId: v1Id,
          mutationId: `${RUN_ID}-s2`,
          graph: GRAPH_V1,
          sourceHash: v1Hash,
          expectedWorkingHash: before.graphHash,
          label: 're-projection twin',
        });
        expect(res.ok).toBe(true);
        if (!res.ok) return;

        const after = await readState(sql, scenarioId);
        // Bound by CONTENT, not by "both writes happened". A carrier that
        // byte-copies the target into the version row while writing
        // RE-PROJECTED bytes to the working graph is atomic and still wrong.
        expect(
          after.headGraph,
          'the head version and the working graph hold DIFFERENT content — ' +
            'a transaction cannot fix this; the carrier must write ONE graph to both',
        ).toEqual(after.graph);
        expect(after.headHash).toBe(after.graphHash);
      });

      /**
       * ── THE RE-PROJECTION TWIN THAT CAN ACTUALLY FAIL. ─────────────────
       *
       * ⚠ S2 above is VACUOUS for the defect it names, and that is worth
       * stating rather than hiding: it restores a version whose stored bytes
       * are ALREADY equal to the projected bytes, so a carrier that
       * byte-copies the target into the version row and writes re-projected
       * bytes to the working graph would still pass it. The two are only
       * distinguishable when re-projection actually CHANGES something.
       *
       * Here the stored version carries a legacy field that today's
       * persistence projection strips. The carrier is handed the PROJECTED
       * graph — which is what `projectGraphForPersistence` produces and what
       * the working graph will receive. The head version must receive THE
       * SAME BYTES. A carrier that stores the target's raw bytes in the
       * version row fails here even though it is perfectly atomic.
       */
      it('S2b: after restoring a version saved under an OLDER projection, head and working graph STILL match', async () => {
        const scenarioId = randomUUID();
        const ownerId = randomUUID();
        await sql`SELECT public.ensure_scenario_exists(${scenarioId}::uuid, ${ownerId}::uuid)`;
        createdScenarios.push(scenarioId);

        // A version stored under an older projection: it carries a field
        // today's projection removes.
        const LEGACY = {
          nodes: [{ id: 'n1', label: 'A' }],
          edges: [],
          legacy_layout_hint: 'REMOVED_BY_TODAYS_PROJECTION',
        };
        const PROJECTED = { nodes: [{ id: 'n1', label: 'A' }], edges: [] };
        expect(
          JSON.stringify(LEGACY),
          'fixture precondition: the stored and projected bytes MUST differ, ' +
            'or this test cannot observe the defect it exists for',
        ).not.toBe(JSON.stringify(PROJECTED));

        await writeWorkingGraph(sql, scenarioId, LEGACY, `${RUN_ID}-legacy-${randomUUID()}`);
        const old = await sql`
          SELECT public.create_model_version(
            ${scenarioId}::uuid, ${sql.json(LEGACY as never)}::jsonb,
            ${hashOf(LEGACY)}::text, ${ENVELOPE.projection}::text,
            ${ENVELOPE.normaliser}::text, ${ENVELOPE.schema}::text,
            ${ENVELOPE.algorithm}::text, 'legacy'::text, 'user_save'::text,
            NULL::text, NULL::text) AS o`;
        const legacyId = (old[0].o as { version_id: string }).version_id;

        // Move the working graph on so the restore is not a no-op.
        await writeWorkingGraph(sql, scenarioId, GRAPH_V2, `${RUN_ID}-legacy2-${randomUUID()}`);
        const before = await readState(sql, scenarioId);

        const res = await carrier.restore(sql, {
          scenarioId,
          versionId: legacyId,
          mutationId: `${RUN_ID}-s2b-${randomUUID()}`,
          graph: PROJECTED, // what projectGraphForPersistence would produce
          sourceHash: hashOf(LEGACY),
          expectedWorkingHash: before.graphHash,
          label: 're-projection twin',
        });
        expect(res.ok, `restore failed: ${!res.ok ? res.message : ''}`).toBe(true);
        if (!res.ok) return;

        const after = await readState(sql, scenarioId);
        expect(after.graph, 'the working graph is not the projected graph').toEqual(PROJECTED);
        if (expectAtomic) {
          expect(
            after.headGraph,
            'THE HEAD VERSION STORES DIFFERENT CONTENT FROM THE WORKING GRAPH. ' +
              'The carrier byte-copied the target instead of writing the projected ' +
              'graph to both. Atomicity does not fix this.',
          ).toEqual(after.graph);
          expect(after.headHash).toBe(after.graphHash);
        } else {
          // ⚠ THE PRE-ATOMIC CARRIER FAILS THIS, MEASURED — and it is a
          // SEPARATE defect from the atomicity one. `restore_model_version`
          // byte-copies the TARGET's graph and envelope into the new version
          // row, while the working graph receives the RE-PROJECTED bytes. So
          // for any version saved under an older projection, the head and the
          // working graph describe different content the moment the restore
          // reports success. No transaction fixes this; the carrier has to
          // write ONE graph to both.
          expect(after.headGraph).not.toEqual(after.graph);
          expect(after.headHash).not.toBe(after.graphHash);
        }
      });

      // ── HISTORICAL IMMUTABILITY — asserted, not assumed. ────────────────
      it('S3: every pre-existing version row is byte-identical afterwards', async () => {
        const { scenarioId, v1Id, v1Hash } = await seed();
        const before = await sql`
          SELECT id, version_number, graph, graph_identity_hash, label,
                 provenance, created_at, restored_from_version_id
            FROM public.model_versions WHERE scenario_id = ${scenarioId}::uuid
           ORDER BY version_number`;
        const state = await readState(sql, scenarioId);

        const res = await carrier.restore(sql, {
          scenarioId,
          versionId: v1Id,
          mutationId: `${RUN_ID}-s3`,
          graph: GRAPH_V1,
          sourceHash: v1Hash,
          expectedWorkingHash: state.graphHash,
          label: 'immutability',
        });
        expect(res.ok).toBe(true);

        const after = await sql`
          SELECT id, version_number, graph, graph_identity_hash, label,
                 provenance, created_at, restored_from_version_id
            FROM public.model_versions WHERE scenario_id = ${scenarioId}::uuid
             AND id IN ${sql(before.map((r) => r.id as string))}
           ORDER BY version_number`;
        expect(after.length).toBe(before.length);
        expect(JSON.parse(JSON.stringify(after))).toEqual(
          JSON.parse(JSON.stringify(before)),
        );
      });
    });
  }

  // ── Properties that only the atomic carrier is expected to hold. ─────────
  describe('idempotency and concurrency (atomic carrier)', () => {
    it('R1: a replay of the same mutation_id returns the ORIGINAL receipt and writes NO second row', async () => {
      const { scenarioId, v1Id, v1Hash } = await seed();
      const before = await readState(sql, scenarioId);
      const mutationId = `${RUN_ID}-replay`;

      const first = await codexCarrier.restore(sql, {
        scenarioId,
        versionId: v1Id,
        mutationId,
        graph: GRAPH_V1,
        sourceHash: v1Hash,
        expectedWorkingHash: before.graphHash,
        label: 'replay',
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const afterFirst = await readState(sql, scenarioId);

      // The replay carries the ORIGINAL expected hash, which is now stale.
      // A correct carrier answers from the idempotency key, NOT with a 409.
      const second = await codexCarrier.restore(sql, {
        scenarioId,
        versionId: v1Id,
        mutationId,
        graph: GRAPH_V1,
        sourceHash: v1Hash,
        expectedWorkingHash: before.graphHash,
        label: 'replay',
      });
      expect(second.ok, `replay was refused: ${!second.ok ? second.message : ''}`).toBe(true);
      if (!second.ok) return;

      expect(second.receipt.version_id).toBe(first.receipt.version_id);
      expect(second.receipt.replayed).toBe(true);

      // Asserted by QUERYING, never by trusting the response body.
      const afterSecond = await readState(sql, scenarioId);
      expect(afterSecond.versionCount, 'a replay wrote a second version row').toBe(
        afterFirst.versionCount,
      );
      expect(afterSecond.headId).toBe(afterFirst.headId);
    });

    it('C1: two concurrent restores from ONE base → exactly one success, one conflict', async () => {
      const { scenarioId, v1Id, v1Hash } = await seed();
      const before = await readState(sql, scenarioId);

      // Two DISTINCT mutation ids: this measures the CAS under real row
      // locking, not the idempotency key. Same base hash for both.
      const [a, b] = await Promise.all([
        codexCarrier.restore(sql, {
          scenarioId,
          versionId: v1Id,
          mutationId: `${RUN_ID}-cc-a`,
          graph: GRAPH_V1,
          sourceHash: v1Hash,
          expectedWorkingHash: before.graphHash,
          label: 'concurrent-a',
        }),
        codexCarrier.restore(sql, {
          scenarioId,
          versionId: v1Id,
          mutationId: `${RUN_ID}-cc-b`,
          graph: GRAPH_V1,
          sourceHash: v1Hash,
          expectedWorkingHash: before.graphHash,
          label: 'concurrent-b',
        }),
      ]);

      const successes = [a, b].filter((r) => r.ok);
      const conflicts = [a, b].filter((r) => !r.ok && r.sqlstate === 'MV409');
      expect(successes.length, 'exactly one concurrent restore must succeed').toBe(1);
      expect(conflicts.length, 'the loser must be a CAS conflict (MV409), not a crash').toBe(1);

      const after = await readState(sql, scenarioId);
      expect(after.headHash).toBe(after.graphHash);
    });
  });

  /**
   * ── PRESENTATION-VS-SEMANTIC TWINS ───────────────────────────────────────
   *
   * The standing constraint: "Layout, focus, selection and viewport are not
   * semantic mutations and must not create versions or invalidate an
   * analysis." A genuine semantic change must create exactly one version.
   *
   * This uses the REAL `computeGraphIdentityHash`, not the stand-in above,
   * because the whole property IS that function's projection: identity
   * equality is what makes `create_model_version` no-op-dedupe, so
   * "creates no version" is downstream of "is identity-neutral". Testing it
   * with a stand-in hash would be a fixture agreeing with itself.
   *
   * ⚠ MEASURED FINDING — LAYOUT IS NOT IDENTITY-NEUTRAL.
   * `TRANSIENT_UI_KEYS` (graph-identity.ts:114) strips selection, hover,
   * viewport and ui/panel state. It does NOT strip `position`. So moving a
   * node changes the identity hash, which creates a version and moves the
   * hash the analysis-staleness machinery reads — i.e. the constraint above
   * is satisfied for focus/selection/viewport and VIOLATED for layout.
   *
   * That gap is pinned EXPLICITLY below rather than left as a red test or
   * quietly omitted: the suite asserts the EXACT partition, so it REDs if the
   * set grows (a new presentation key starts counting as semantic) OR shrinks
   * (someone fixes layout and forgets to update this). A gap recorded in the
   * suite is honest; a gap invisible to it is how it survives.
   */
  describe('presentation-vs-semantic twins', () => {
    /** Presentation changes that ARE identity-neutral today. */
    const IDENTITY_NEUTRAL: ReadonlyArray<[string, (g: any) => void]> = [
      ['selection', (g) => { g.nodes[0].selected = true; }],
      ['hover', (g) => { g.nodes[1].hovered = true; }],
      ['viewport', (g) => { g.viewport = { x: 5, y: 5, zoom: 2 }; }],
      ['ui_state', (g) => { g.ui_state = { panel: 'open' }; }],
      ['node array order', (g) => { g.nodes.reverse(); }],
    ];

    /**
     * ⚠ KNOWN GAP, pinned exactly. These are presentation-only by the
     * standing constraint but are NOT identity-neutral in the code. If this
     * list ever changes in either direction, this test REDs and someone must
     * decide deliberately.
     */
    const KNOWN_NOT_NEUTRAL: ReadonlyArray<[string, (g: any) => void]> = [
      ['layout position', (g) => { g.nodes[0].position = { x: 999, y: 999 }; }],
    ];

    const BASE = {
      nodes: [
        { id: 'n1', label: 'A', position: { x: 0, y: 0 } },
        { id: 'n2', label: 'B', position: { x: 10, y: 10 } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    };
    const clone = () => JSON.parse(JSON.stringify(BASE));

    it('T1: presentation-only changes are identity-neutral (and so create no version)', async () => {
      const { computeGraphIdentityHash } = await import(
        '../../src/orchestrator-v5/context/graph-identity.js'
      );
      const baseHash = computeGraphIdentityHash(BASE as never)?.value;
      expect(baseHash, 'positive control: the base graph must hash at all').toBeTruthy();

      for (const [name, mutate] of IDENTITY_NEUTRAL) {
        const g = clone();
        mutate(g);
        expect(
          JSON.stringify(g),
          `fixture precondition: "${name}" must actually change the graph, ` +
            'or this row asserts nothing',
        ).not.toBe(JSON.stringify(BASE));
        expect(
          computeGraphIdentityHash(g as never)?.value,
          `"${name}" is presentation-only but CHANGED the identity hash — it ` +
            'would create a version and stale the analysis',
        ).toBe(baseHash);
      }
    });

    it('T2: KNOWN GAP — layout is NOT identity-neutral (pinned exactly, both directions)', async () => {
      const { computeGraphIdentityHash } = await import(
        '../../src/orchestrator-v5/context/graph-identity.js'
      );
      const baseHash = computeGraphIdentityHash(BASE as never)?.value;
      for (const [name, mutate] of KNOWN_NOT_NEUTRAL) {
        const g = clone();
        mutate(g);
        expect(
          computeGraphIdentityHash(g as never)?.value,
          `"${name}" has become identity-neutral. That is an IMPROVEMENT — the ` +
            'standing constraint says layout is not a semantic mutation. Move ' +
            'it from KNOWN_NOT_NEUTRAL to IDENTITY_NEUTRAL.',
        ).not.toBe(baseHash);
      }
    });

    it('T3: a presentation-only change creates NO new version row; a semantic one creates EXACTLY ONE', async () => {
      const { computeGraphIdentityHash } = await import(
        '../../src/orchestrator-v5/context/graph-identity.js'
      );
      const realHash = (g: unknown) => computeGraphIdentityHash(g as never)!.value;

      const scenarioId = randomUUID();
      await sql`SELECT public.ensure_scenario_exists(${scenarioId}::uuid, ${randomUUID()}::uuid)`;
      createdScenarios.push(scenarioId);

      const saveVersion = async (g: unknown) => {
        const r = await sql`
          SELECT public.create_model_version(
            ${scenarioId}::uuid, ${sql.json(g as never)}::jsonb, ${realHash(g)}::text,
            ${ENVELOPE.projection}::text, ${ENVELOPE.normaliser}::text,
            ${ENVELOPE.schema}::text, ${ENVELOPE.algorithm}::text,
            'twin'::text, 'user_save'::text, NULL::text, NULL::text) AS o`;
        return r[0].o as { deduped: boolean };
      };
      const count = async () =>
        Number(
          (
            await sql`SELECT count(*)::int AS n FROM public.model_versions
                       WHERE scenario_id = ${scenarioId}::uuid`
          )[0].n,
        );

      await saveVersion(BASE);
      const afterFirst = await count();
      expect(afterFirst, 'the semantic baseline must create exactly one version').toBe(1);

      // Presentation-only → identity-equal → the RPC's no-op dedupe fires.
      const pres = clone();
      pres.nodes[0].selected = true;
      pres.viewport = { x: 1, y: 1, zoom: 3 };
      const presOutcome = await saveVersion(pres);
      expect(presOutcome.deduped, 'a presentation-only change was NOT deduped').toBe(true);
      expect(await count(), 'a presentation-only change created a version row').toBe(afterFirst);

      // Semantic → exactly one more.
      const sem = clone();
      sem.nodes.push({ id: 'n3', label: 'C', position: { x: 0, y: 0 } });
      const semOutcome = await saveVersion(sem);
      expect(semOutcome.deduped, 'a genuine semantic change was wrongly deduped').toBe(false);
      expect(await count(), 'a semantic change must create EXACTLY one version').toBe(
        afterFirst + 1,
      );
    });
  });

  /**
   * ── append_turn_atomic_v5 vs v4: A DE-DUPLICATION THAT CHANGED BEHAVIOUR ──
   *
   * v5 is a copy of v4's fence/CAS/turn body with version creation added.
   * Two full implementations of one piece of logic is a drift hazard; these
   * pins measure the drift that ALREADY EXISTS rather than asserting it.
   *
   * Measured at the bytes on `codex/c8-a-integration` @ 8e6de866:
   *   · `p_cas_enforce` occurs in v5 EXACTLY ONCE — in the signature. Its
   *     body never reads it. v4 reads it in its CAS predicate.
   *   · v5's CAS predicate is
   *       current IS DISTINCT FROM expected AND incoming IS DISTINCT FROM current
   *     v4's additionally requires `p_cas_enforce`, `expected IS NOT NULL` and
   *     `current IS NOT NULL`. v5 dropped all three.
   *
   * Consequence: v5 refuses two cases v4 documents as ACCEPTED, and it does
   * so unconditionally — there is no kill switch on the path that now carries
   * every semantic commit.
   *
   * Each pin below carries a CONTRAST ARM that both versions accept, so a
   * failure means "v5 diverges here", never "v5 refuses everything".
   */
  describe('append_turn_atomic_v4 → v5 drift (two copies of one predicate)', () => {
    /** Fresh owned scenario; optionally give it a working graph first. */
    async function freshScenario(withGraph: boolean): Promise<{ id: string; hash: string | null }> {
      const id = randomUUID();
      await sql`SELECT public.ensure_scenario_exists(${id}::uuid, ${randomUUID()}::uuid)`;
      createdScenarios.push(id);
      if (!withGraph) return { id, hash: null };
      await writeWorkingGraph(sql, id, GRAPH_V1, `${RUN_ID}-drift-${randomUUID()}`);
      return { id, hash: hashOf(GRAPH_V1) };
    }

    async function callV4(
      scenarioId: string,
      opts: { expected: string | null; incoming: string; enforce: boolean },
    ): Promise<{ ok: boolean; sqlstate: string | null }> {
      const turn = `v4-${randomUUID()}`;
      try {
        await sql`
          SELECT public.append_turn_atomic_v4(
            ${scenarioId}::uuid, ${turn}::text, 'direct_answer'::text, NULL::text,
            ${turn}::text, FALSE, 0, 0, '[]'::jsonb,
            ${sql.json(GRAPH_V2 as never)}::jsonb, NULL::text, '[]'::jsonb,
            NULL::jsonb, NULL::text, NULL::text,
            ${opts.expected}::text, ${opts.incoming}::text, ${opts.enforce},
            NULL::bigint)`;
        return { ok: true, sqlstate: null };
      } catch (e) {
        return { ok: false, sqlstate: errState(e) };
      }
    }

    async function callV5(
      scenarioId: string,
      opts: { expected: string | null; incoming: string; enforce: boolean },
    ): Promise<{ ok: boolean; sqlstate: string | null }> {
      const turn = `v5-${randomUUID()}`;
      try {
        await sql`
          SELECT public.append_turn_atomic_v5(
            ${scenarioId}::uuid, ${turn}::text, 'direct_answer'::text, NULL::text,
            ${turn}::text, FALSE, 0, 0, '[]'::jsonb,
            ${sql.json(GRAPH_V2 as never)}::jsonb, NULL::text, '[]'::jsonb,
            NULL::jsonb, NULL::text, NULL::text,
            ${opts.expected}::text, ${opts.incoming}::text, ${opts.enforce},
            NULL::bigint,
            ${randomUUID()}::uuid,
            ${analysisHashOf(GRAPH_V2)}::text,
            ${ENVELOPE.algorithm}::text,
            ${ENVELOPE.projection}::text,
            ${ENVELOPE.normaliser}::text,
            ${ENVELOPE.schema}::text,
            'system'::text, NULL::text,
            'committed_mutation'::text,
            ${turn}::text)`;
        return { ok: true, sqlstate: null };
      } catch (e) {
        return { ok: false, sqlstate: errState(e) };
      }
    }

    it('N0 CONTRAST ARM: with expected === current, BOTH v4 and v5 accept', async () => {
      const a = await freshScenario(true);
      const b = await freshScenario(true);
      const v4 = await callV4(a.id, { expected: a.hash, incoming: hashOf(GRAPH_V2), enforce: true });
      const v5 = await callV5(b.id, { expected: b.hash, incoming: hashOf(GRAPH_V2), enforce: true });
      expect(v4.ok, 'v4 refused the contrast arm — the probe is not discriminating').toBe(true);
      expect(v5.ok, 'v5 refused the contrast arm — the probe is not discriminating').toBe(true);
    });

    it('N1a: expected = NULL against a SET current hash — v4 accepts, v5 REFUSES', async () => {
      const a = await freshScenario(true);
      const b = await freshScenario(true);
      const v4 = await callV4(a.id, { expected: null, incoming: hashOf(GRAPH_V2), enforce: true });
      const v5 = await callV5(b.id, { expected: null, incoming: hashOf(GRAPH_V2), enforce: true });
      expect(v4.ok, "v4 must accept a NULL expectation — its documented 'no expectation' case").toBe(true);
      expect(
        v5.ok,
        'v5 now ACCEPTS a NULL expectation. That is a behavioural change back ' +
          "towards v4 — good, but this pin records the divergence, so update it " +
          'deliberately rather than deleting it.',
      ).toBe(false);
      expect(v5.sqlstate).toBe('OLGC1');
    });

    it('N1b: NULL current hash (first graph write) — v4 accepts, v5 REFUSES', async () => {
      const a = await freshScenario(false);
      const b = await freshScenario(false);
      const stale = hashOf({ some: 'other' });
      const v4 = await callV4(a.id, { expected: stale, incoming: hashOf(GRAPH_V2), enforce: true });
      const v5 = await callV5(b.id, { expected: stale, incoming: hashOf(GRAPH_V2), enforce: true });
      expect(v4.ok, "v4 must accept a first graph write — it guards on current IS NOT NULL").toBe(true);
      expect(v5.ok, 'v5 dropped the current-IS-NOT-NULL guard').toBe(false);
      expect(v5.sqlstate).toBe('OLGC1');
    });

    /**
     * ⚠ THE LAYOUT GAP, INHERITED — AND NOW ON THE COMMIT PATH.
     *
     * v5 gates version creation on
     *   `v_current_hash IS DISTINCT FROM p_incoming_graph_identity_hash`
     * i.e. purely on the identity hash. `TRANSIENT_UI_KEYS` strips selection,
     * hover, viewport and ui state — so those are correctly free — but it does
     * NOT strip `position`. So a pure node MOVE changes the identity hash,
     * creates a version, and moves the hash the staleness machinery reads.
     *
     * On the old path that produced a stray version. On this path v5 carries
     * EVERY semantic commit and always writes `scenarios.graph_identity_hash`,
     * so the same gap now sits on the main line. That raises its severity; it
     * does not change its cause.
     *
     * Pinned in BOTH directions: presentation-only must stay free, layout must
     * be recorded as costing a version until someone decides otherwise.
     */
    it('N3: presentation-only creates NO version on the v5 path; LAYOUT still does (known gap)', async () => {
      const { computeGraphIdentityHash } = await import(
        '../../src/orchestrator-v5/context/graph-identity.js'
      );
      const realHash = (g: unknown) => computeGraphIdentityHash(g as never)!.value;
      const BASE: any = {
        nodes: [
          { id: 'n1', label: 'A', position: { x: 0, y: 0 } },
          { id: 'n2', label: 'B', position: { x: 10, y: 10 } },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      };
      const clone = () => JSON.parse(JSON.stringify(BASE));

      const scenarioId = randomUUID();
      await sql`SELECT public.ensure_scenario_exists(${scenarioId}::uuid, ${randomUUID()}::uuid)`;
      createdScenarios.push(scenarioId);

      const commit = async (graph: unknown) => {
        const turn = `n3-${randomUUID()}`;
        // ⚠ The expected hash is READ BACK each time rather than passed as
        // NULL. v5 dropped v4's `expected IS NOT NULL` guard (pin N1a), so it
        // has no "no expectation" mode at all — a NULL expectation against a
        // set current hash is refused OLGC1. This helper tripped exactly that
        // on its first draft, which is the divergence reaching a caller.
        const cur = await sql`
          SELECT graph_identity_hash FROM public.scenarios
           WHERE id = ${scenarioId}::uuid`;
        const expected = (cur[0]?.graph_identity_hash as string | null) ?? null;
        await sql`
          SELECT public.append_turn_atomic_v5(
            ${scenarioId}::uuid, ${turn}::text, 'direct_answer'::text, NULL::text,
            ${turn}::text, FALSE, 0, 0, '[]'::jsonb,
            ${sql.json(graph as never)}::jsonb, NULL::text, '[]'::jsonb,
            NULL::jsonb, NULL::text, NULL::text,
            ${expected}::text, ${realHash(graph)}::text, TRUE, NULL::bigint,
            ${randomUUID()}::uuid, ${analysisHashOf(graph)}::text,
            ${ENVELOPE.algorithm}::text, ${ENVELOPE.projection}::text,
            ${ENVELOPE.normaliser}::text, ${ENVELOPE.schema}::text,
            'system'::text, NULL::text, 'committed_mutation'::text, ${turn}::text)`;
      };
      const versions = async () =>
        Number(
          (
            await sql`SELECT count(*)::int AS n FROM public.model_versions
                       WHERE scenario_id = ${scenarioId}::uuid`
          )[0].n,
        );

      await commit(BASE);
      const afterBase = await versions();
      expect(afterBase, 'the first commit must create exactly one version').toBe(1);

      // Presentation-only — identity-neutral, so v5 must not create a version.
      const pres = clone();
      pres.nodes[0].selected = true;
      pres.viewport = { x: 3, y: 3, zoom: 2 };
      expect(
        realHash(pres),
        'fixture precondition: presentation-only must be identity-neutral',
      ).toBe(realHash(BASE));
      await commit(pres);
      expect(
        await versions(),
        'a presentation-only commit created a version on the v5 path',
      ).toBe(afterBase);

      // Layout-only — the known gap.
      const moved = clone();
      moved.nodes[0].position = { x: 999, y: 999 };
      expect(
        realHash(moved),
        'LAYOUT HAS BECOME IDENTITY-NEUTRAL. That is the fix this gap wants — ' +
          'update N3 and the T2 known-gap pin together.',
      ).not.toBe(realHash(BASE));
      await commit(moved);
      expect(
        await versions(),
        'layout no longer creates a version — the gap is closed; update this pin',
      ).toBe(afterBase + 1);
    });

    it('N2: p_cas_enforce is INERT in v5 — there is no kill switch on this path', async () => {
      const a = await freshScenario(true);
      const b = await freshScenario(true);
      const stale = hashOf({ some: 'other' });
      // enforce = FALSE. In v4 this suppresses the CAS entirely.
      const v4 = await callV4(a.id, { expected: stale, incoming: hashOf(GRAPH_V2), enforce: false });
      const v5 = await callV5(b.id, { expected: stale, incoming: hashOf(GRAPH_V2), enforce: false });
      expect(v4.ok, 'v4 with p_cas_enforce=false must accept a stale expectation').toBe(true);
      expect(
        v5.ok,
        'v5 now HONOURS p_cas_enforce. If that was fixed deliberately, update ' +
          'this pin; if the parameter was deleted instead, delete this pin and ' +
          'the comments that claim the posture flag has an effect.',
      ).toBe(false);
      expect(v5.sqlstate).toBe('OLGC1');
    });
  });

  // ── THE DISCRIMINATING PAIR. ─────────────────────────────────────────────
  // Without this, every pin above could be passing for the wrong reason.
  describe('discrimination (the pins must bite)', () => {
    it('D1: the pristine carrier really does produce the partial state the pins forbid', async () => {
      const { scenarioId, v1Id, v1Hash } = await seed();
      const before = await readState(sql, scenarioId);

      await setInject(sql, INJECT_GRAPH_WRITE);
      try {
        await pristineCarrier.restore(sql, {
          scenarioId,
          versionId: v1Id,
          mutationId: `${RUN_ID}-disc-${randomUUID()}`,
          graph: GRAPH_V1,
          sourceHash: v1Hash,
          expectedWorkingHash: before.graphHash,
          label: 'discrimination',
        });
      } finally {
        await setInject(sql, INJECT_NONE);
      }
      const afterPristine = await readState(sql, scenarioId);

      // The defect, in one line: the head names a version the working graph
      // is not. If this ever stops being true, the pins are no longer
      // measuring atomicity and must not be trusted.
      expect(
        afterPristine.headHash,
        'the pristine carrier NO LONGER produces a partial state — the pins ' +
          'above are not discriminating and this suite proves nothing',
      ).not.toBe(afterPristine.graphHash);
    });

    it('D2: the atomic carrier refuses the SAME injection with no residue', async () => {
      const { scenarioId, v1Id, v1Hash } = await seed();
      const before = await readState(sql, scenarioId);

      await setInject(sql, INJECT_GRAPH_WRITE);
      let res: RestoreResult;
      try {
        res = await codexCarrier.restore(sql, {
          scenarioId,
          versionId: v1Id,
          mutationId: `${RUN_ID}-disc2-${randomUUID()}`,
          graph: GRAPH_V1,
          sourceHash: v1Hash,
          expectedWorkingHash: before.graphHash,
          label: 'discrimination',
        });
      } finally {
        await setInject(sql, INJECT_NONE);
      }
      expect(res.ok).toBe(false);

      const after = await readState(sql, scenarioId);
      expect(after.headHash).toBe(after.graphHash);
      expect(after.versionCount).toBe(before.versionCount);
      expect(after.headId).toBe(before.headId);
      expect(after.graphHash).toBe(before.graphHash);
    });
  });
});
