#!/usr/bin/env node
/**
 * REHEARSAL — append_turn_atomic_v4 FIRST-WRITE EXEMPTION (ROADMAP 2.709).
 *
 * Drives the REAL migration SQL, byte-for-byte from this repo, against an
 * ephemeral local Postgres 16 (Docker) or a caller-supplied LOCAL database,
 * and proves, RED-first:
 *
 *   RED   (defect reproduction): v4 as currently deployed (20260802120000)
 *         REFUSES a FIRST draft's graph commit with OLTF2 when a later turn
 *         has merely CLAIMED the scenario — the fresh-journey P0 in a
 *         bottle (scenario left with graph NULL and zero turn rows while
 *         the browser shows the rendered preview).
 *   GREEN (the fix): after 20260806120000, the SAME commit ADMITS: the
 *         scenario held no graph, so the supersede protected nothing.
 *   FENCE STILL FENCES (the Stop-fence P0 protections, unchanged):
 *         · stopped first write on a graph-less scenario → OLTF1;
 *         · superseded write when the scenario HOLDS a graph → OLTF2,
 *           nothing clobbered;
 *         · stopped + superseded + graph present → OLTF1 (stopped wins);
 *         · never-claimed generation → OLTF3;
 *         · a NEWER turn's own graph write after an exempted first write
 *           commits normally (later intent wins — verdict current);
 *         · idempotent replay; NULL generation skips the gate.
 *   COLUMNS: graph_write_failed_at / graph_write_failure_reason exist,
 *         accept the app's mark UPDATE, and are readable by the
 *         continuation / notice predicates.
 *   ROLLBACK: the paired rollback restores unconditional OLTF2 (the RED
 *         case refuses again) and KEEPS the columns; re-forward is clean.
 *
 * Every refusal assertion is preceded by a positive control (trap 13).
 *
 * Usage:
 *   node scripts/rehearse-turn-fence-first-write-exemption.mjs
 *     — manages its own ephemeral `docker run postgres:16`.
 *   REHEARSAL_DB_URL=postgres://... node scripts/rehearse-...mjs
 *     — uses an existing LOCAL Postgres. Refuses non-local hosts: this
 *       harness rehearses; it never executes against staging.
 *
 * Exit 0 = every check passed. DO NOT execute the migration on staging
 * until this passes end-to-end.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

const MIGRATIONS = {
  fence: path.join(repo, 'supabase/migrations/20260731120000_v5_turn_fence.sql'),
  v4Deployed: path.join(
    repo,
    'supabase/migrations/20260802120000_v5_turn_fence_atomic_append_generation_key.sql',
  ),
  exemption: path.join(
    repo,
    'supabase/migrations/20260806120000_v5_turn_fence_first_write_exemption.sql',
  ),
  exemptionRollback: path.join(
    repo,
    'supabase/migrations/rollback/20260806120000_v5_turn_fence_first_write_exemption_rollback.sql.do-not-apply',
  ),
};

// ── Result table ────────────────────────────────────────────────────────────
const results = [];
let failed = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── Database lifecycle (same conventions as the generation-key rehearsal) ──
const externalUrl = process.env.REHEARSAL_DB_URL ?? null;
let containerName = null;
let dbUrl;

function assertLocalUrl(url) {
  const host = new URL(url).hostname;
  const ok = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!ok) {
    console.error(
      `REFUSING non-local REHEARSAL_DB_URL host "${host}". ` +
        'This harness rehearses; it never executes against staging.',
    );
    process.exit(2);
  }
}

async function startEphemeralPostgres() {
  const suffix = randomBytes(4).toString('hex');
  containerName = `fence-fwx-rehearsal-${suffix}`;
  const port = 55000 + Math.floor(Math.random() * 1000);
  const password = randomBytes(12).toString('hex');
  execFileSync('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    containerName,
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-p',
    `127.0.0.1:${port}:5432`,
    'postgres:16',
  ]);
  dbUrl = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
  const { default: postgres } = await import('postgres');
  for (let i = 0; i < 60; i += 1) {
    try {
      const probe = postgres(dbUrl, { max: 1, connect_timeout: 2 });
      await probe`SELECT 1`;
      await probe.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('ephemeral postgres never became ready');
}

function stopEphemeralPostgres() {
  if (containerName) {
    spawnSync('docker', ['stop', containerName], { stdio: 'ignore' });
  }
}

// ── SQL helpers ─────────────────────────────────────────────────────────────
let sql;

async function applyFile(file) {
  const text = readFileSync(file, 'utf8');
  await sql.unsafe(text);
}

async function callV4({
  scenarioId,
  turnId,
  fenceGeneration = null,
  graph = { nodes: [{ id: 'n1' }], edges: [] },
  turnClass = 'direct_answer',
}) {
  try {
    const rows = await sql`
      SELECT public.append_turn_atomic_v4(
        p_scenario_id                  => ${scenarioId}::uuid,
        p_turn_id                      => ${turnId},
        p_turn_class                   => ${turnClass},
        p_handler_id                   => NULL,
        p_request_hash                 => 'req-hash',
        p_response_emitted             => TRUE,
        p_llm_calls_used               => 0,
        p_duration_ms                  => 10,
        p_handler_facts                => '[]'::jsonb,
        p_graph                        => ${graph === null ? null : sql.json(graph)},
        p_brief_text                   => NULL,
        p_pending_actions              => '[]'::jsonb,
        p_coaching_state               => NULL,
        p_user_message                 => NULL,
        p_assistant_message            => NULL,
        p_expected_graph_identity_hash => ${null},
        p_incoming_graph_identity_hash => ${graph === null ? null : 'hash-incoming'},
        p_cas_enforce                  => ${false},
        p_fence_generation             => ${fenceGeneration}
      ) AS id
    `;
    return { ok: true, id: rows[0].id };
  } catch (err) {
    return {
      ok: false,
      code: err?.code ?? null,
      detail: err?.detail ?? null,
      message: err?.message ?? String(err),
    };
  }
}

async function newScenario() {
  const rows = await sql`
    INSERT INTO scenarios (id) VALUES (gen_random_uuid()) RETURNING id
  `;
  return rows[0].id;
}

async function claim(scenarioId, turnId) {
  const rows = await sql`
    SELECT public.v5_claim_turn_fence(${scenarioId}::uuid, ${turnId}) AS generation
  `;
  return Number(rows[0].generation);
}

async function stop(scenarioId, turnId) {
  await sql`SELECT public.v5_mark_turn_stopped(${scenarioId}::uuid, ${turnId})`;
}

async function turnRowCount(scenarioId) {
  const rows = await sql`
    SELECT count(*)::int AS n FROM v5_conversation_turns WHERE scenario_id = ${scenarioId}::uuid
  `;
  return rows[0].n;
}

async function scenarioGraph(scenarioId) {
  const rows = await sql`SELECT graph FROM scenarios WHERE id = ${scenarioId}::uuid`;
  return rows[0]?.graph ?? null;
}

// The diagnosis's induced repro as DB state: draft admitted (gen 1), a
// mid-draft interrupt claims gen 2, the draft's commit then arrives.
async function phantomShape() {
  const s = await newScenario();
  const draftGen = await claim(s, 'browser-draft-turn');
  await claim(s, 'browser-interrupt-turn'); // the question; writes no graph
  return { s, draftGen };
}

// ── Bootstrap — identical faithful shapes to the generation-key rehearsal ──
async function bootstrap() {
  await sql.unsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS public.scenarios (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             UUID,
      graph               JSONB,
      graph_identity_hash TEXT,
      brief_text          TEXT,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS scenarios_updated_at ON public.scenarios;
    CREATE TRIGGER scenarios_updated_at
      BEFORE UPDATE ON public.scenarios
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at();

    CREATE TABLE IF NOT EXISTS public.v5_conversation_turns (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scenario_id      UUID NOT NULL,
      user_id          UUID,
      turn_id          TEXT NOT NULL,
      turn_class       TEXT NOT NULL,
      handler_id       TEXT,
      request_hash     TEXT NOT NULL,
      response_emitted BOOLEAN NOT NULL DEFAULT TRUE,
      llm_calls_used   INTEGER NOT NULL DEFAULT 0,
      duration_ms      INTEGER NOT NULL DEFAULT 0,
      pending_actions  JSONB NOT NULL DEFAULT '[]'::jsonb,
      coaching_state   JSONB,
      user_message     TEXT,
      assistant_message TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT v5_conversation_turns_scenario_turn_key UNIQUE (scenario_id, turn_id),
      CONSTRAINT v5_conversation_turns_turn_class_valid
        CHECK (turn_class IN ('direct_answer', 'clarify', 'handler', 'unhandled')),
      CONSTRAINT v5_conversation_turns_handler_id_biconditional
        CHECK ((turn_class = 'handler') = (handler_id IS NOT NULL))
    );

    CREATE TABLE IF NOT EXISTS public.v5_handler_facts (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      v5_conversation_turn_id  UUID NOT NULL,
      scenario_id              UUID NOT NULL,
      user_id                  UUID,
      handler_id               TEXT,
      action_type              TEXT,
      noop                     BOOLEAN NOT NULL DEFAULT FALSE,
      payload                  JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// ── The battery ─────────────────────────────────────────────────────────────
async function main() {
  if (externalUrl) {
    assertLocalUrl(externalUrl);
    dbUrl = externalUrl;
    console.log('Using caller-supplied LOCAL database.');
  } else {
    console.log('Starting ephemeral Docker postgres:16 …');
    await startEphemeralPostgres();
  }
  const { default: postgres } = await import('postgres');
  sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

  console.log('\n── Phase 0: bootstrap + REAL fence migration + v4 as deployed (20260802120000)');
  await bootstrap();
  await applyFile(MIGRATIONS.fence);
  await applyFile(MIGRATIONS.v4Deployed);
  const v4a = await sql`
    SELECT pronargs FROM pg_proc WHERE proname = 'append_turn_atomic_v4'
  `;
  record('v4-as-deployed present, 19 args', v4a.length === 1 && v4a[0].pronargs === 19);

  // POSITIVE CONTROL (trap 13): an unsuperseded first write commits.
  {
    const s = await newScenario();
    const g = await claim(s, 'bt-solo');
    const res = await callV4({ scenarioId: s, turnId: 'bt-solo', fenceGeneration: g });
    record(
      'positive control: an unmolested first write commits under v4-as-deployed',
      res.ok === true,
      res.ok ? '' : `${res.code}: ${res.message}`,
    );
  }

  // ── THE RED: the fresh-journey P0 reproduced ──
  {
    const { s, draftGen } = await phantomShape();
    const res = await callV4({ scenarioId: s, turnId: 'browser-draft-turn', fenceGeneration: draftGen });
    record(
      'RED: a superseded FIRST write on a graph-less scenario is REFUSED OLTF2 by v4-as-deployed (the phantom state)',
      res.ok === false && res.code === 'OLTF2',
      res.ok ? 'UNEXPECTED COMMIT' : `code=${res.code}`,
    );
    record('RED refusal left graph NULL + zero turn rows (the phantom, verbatim)',
      (await scenarioGraph(s)) === null && (await turnRowCount(s)) === 0);
  }

  console.log('\n── Phase 1: apply 20260806120000 (first-write exemption + trace columns)');
  await applyFile(MIGRATIONS.exemption);
  const v4b = await sql`
    SELECT pronargs, prosrc LIKE '%v_has_graph%' AS exempt_aware,
           prosrc LIKE '%generation = p_fence_generation%' AS gen_keyed
    FROM pg_proc WHERE proname = 'append_turn_atomic_v4'
  `;
  record(
    'exemption v4 present: one function, 19 args, generation-keyed, graph-presence-aware',
    v4b.length === 1 && v4b[0].pronargs === 19 && v4b[0].exempt_aware === true && v4b[0].gen_keyed === true,
  );
  const cols = await sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'v5_turn_fence' AND column_name IN ('graph_write_failed_at','graph_write_failure_reason')
  `;
  record('trace columns exist on v5_turn_fence', cols[0].n === 2, `n=${cols[0].n}`);

  // ── THE GREEN: the same phantom-shaped commit now ADMITS ──
  {
    const { s, draftGen } = await phantomShape();
    const res = await callV4({ scenarioId: s, turnId: 'browser-draft-turn', fenceGeneration: draftGen });
    record(
      'GREEN: the SAME superseded first write COMMITS under the exemption',
      res.ok === true,
      res.ok ? '' : `${res.code}: ${res.message}`,
    );
    record('GREEN commit persisted graph + turn row',
      (await scenarioGraph(s)) !== null && (await turnRowCount(s)) === 1);

    // Later intent still wins: the interrupt turn later writes ITS OWN graph
    // (e.g. an edit) at the higher generation → ordinary overwrite.
    const interruptGen = await claim(s, 'browser-interrupt-turn'); // idempotent re-claim
    const res2 = await callV4({
      scenarioId: s,
      turnId: 'browser-interrupt-turn',
      fenceGeneration: interruptGen,
      graph: { nodes: [{ id: 'n2' }], edges: [] },
    });
    record('later turn’s own graph write still commits over the exempted first write (later intent wins)',
      res2.ok === true, res2.ok ? '' : `${res2.code}`);
    const g2 = await scenarioGraph(s);
    record('…and the newer graph is the one persisted', JSON.stringify(g2?.nodes) === JSON.stringify([{ id: 'n2' }]));
  }

  console.log('\n── Phase 2: the fence STILL FENCES');
  // (a) stopped first write on a graph-less scenario → OLTF1 (never exempted).
  {
    const { s, draftGen } = await phantomShape();
    await stop(s, 'browser-draft-turn');
    const res = await callV4({ scenarioId: s, turnId: 'browser-draft-turn', fenceGeneration: draftGen });
    record('stopped first write on graph-less scenario → OLTF1 (Stop is never exempted)',
      res.ok === false && res.code === 'OLTF1', `code=${res.code}`);
    record('…and nothing was written', (await scenarioGraph(s)) === null && (await turnRowCount(s)) === 0);
  }
  // (b) superseded write when the scenario HOLDS a graph → OLTF2 (the original clobber protection).
  {
    const s = await newScenario();
    const gA = await claim(s, 'bt-old');
    const gB = await claim(s, 'bt-new');
    const resB = await callV4({
      scenarioId: s, turnId: 'bt-new', fenceGeneration: gB,
      graph: { nodes: [{ id: 'newer' }], edges: [] },
    });
    record('control: the newer turn’s graph commits first', resB.ok === true);
    const resA = await callV4({ scenarioId: s, turnId: 'bt-old', fenceGeneration: gA });
    record('superseded write over a COMMITTED graph → OLTF2 (clobber protection unchanged)',
      resA.ok === false && resA.code === 'OLTF2', `code=${resA.code}`);
    const g = await scenarioGraph(s);
    record('…and the newer graph survived untouched', JSON.stringify(g?.nodes) === JSON.stringify([{ id: 'newer' }]));
  }
  // (c) stopped + superseded + graph present → OLTF1 (stopped wins).
  {
    const s = await newScenario();
    const gA = await claim(s, 'bt-stopped-old');
    const gB = await claim(s, 'bt-live-new');
    await callV4({ scenarioId: s, turnId: 'bt-live-new', fenceGeneration: gB });
    await stop(s, 'bt-stopped-old');
    const res = await callV4({ scenarioId: s, turnId: 'bt-stopped-old', fenceGeneration: gA });
    record('stopped + superseded + graph present → OLTF1 (stopped still wins)',
      res.ok === false && res.code === 'OLTF1', `code=${res.code}`);
  }
  // (d) never-claimed generation → OLTF3.
  {
    const s = await newScenario();
    const res = await callV4({ scenarioId: s, turnId: 'bt-unclaimed', fenceGeneration: 999999 });
    record('never-claimed generation → OLTF3 (fail closed unchanged)',
      res.ok === false && res.code === 'OLTF3', `code=${res.code}`);
  }
  // (e) NULL generation skips the gate; non-graph writes never gated.
  {
    const s = await newScenario();
    const res = await callV4({ scenarioId: s, turnId: 'bt-nullgen', fenceGeneration: null });
    record('NULL fence generation skips the gate (v3-equivalent)', res.ok === true);
    const s2 = await newScenario();
    const g = await claim(s2, 'bt-nongraph');
    await claim(s2, 'bt-nongraph-later');
    const res2 = await callV4({ scenarioId: s2, turnId: 'bt-nongraph', fenceGeneration: g, graph: null });
    record('a superseded NON-graph write still commits (gate is graph-scoped)', res2.ok === true);
  }
  // (f) idempotent replay of an exempted commit.
  {
    const { s, draftGen } = await phantomShape();
    const first = await callV4({ scenarioId: s, turnId: 'browser-draft-turn', fenceGeneration: draftGen });
    const replay = await callV4({ scenarioId: s, turnId: 'browser-draft-turn', fenceGeneration: draftGen });
    record('idempotent replay returns the same row id', first.ok && replay.ok && first.id === replay.id);
  }
  // (g) ROADMAP 2.738(a) — commit → Stop → identical retry.
  //     The replay check now runs BEFORE OLTF1, so an already-committed turn
  //     replays instead of being told it was stopped. The audit's case.
  {
    const s = await newScenario();
    const gA = await claim(s, 'retry-after-stop');
    const first = await callV4({ scenarioId: s, turnId: 'retry-after-stop', fenceGeneration: gA });
    record('control: the turn commits', first.ok === true, `code=${first.code ?? 'ok'}`);
    await stop(s, 'retry-after-stop');
    const replay = await callV4({ scenarioId: s, turnId: 'retry-after-stop', fenceGeneration: gA });
    record('2.738(a): commit → Stop → identical retry REPLAYS (was: OLTF1 for a persisted turn)',
      replay.ok === true && replay.id === first.id, `code=${replay.code ?? 'ok'}`);
  }
  // (h) 2.738(a) DISCRIMINATOR — OLTF1 must still refuse a turn that was
  //     stopped and never committed. Without this pair, (g) could be passing
  //     because the Stop check was removed altogether rather than reordered.
  {
    const s = await newScenario();
    const gA = await claim(s, 'stopped-uncommitted');
    await stop(s, 'stopped-uncommitted');
    const res = await callV4({ scenarioId: s, turnId: 'stopped-uncommitted', fenceGeneration: gA });
    record('2.738(a) DISCRIMINATOR: stopped-and-UNCOMMITTED still → OLTF1',
      res.ok === false && res.code === 'OLTF1', `code=${res.code}`);
    const g = await scenarioGraph(s);
    record('…and the stopped turn wrote no graph', g === null);
  }
  // (i) 2.738(a) — the replay path writes NOTHING, so it cannot resurrect a
  //     graph. Commit a graph, overwrite it with a newer turn, Stop the old
  //     turn, then replay the old turn: the newer graph must survive.
  {
    const s = await newScenario();
    const gA = await claim(s, 'replay-no-write-old');
    await callV4({ scenarioId: s, turnId: 'replay-no-write-old', fenceGeneration: gA });
    const gB = await claim(s, 'replay-no-write-new');
    await callV4({
      scenarioId: s, turnId: 'replay-no-write-new', fenceGeneration: gB,
      graph: { nodes: [{ id: 'newer' }], edges: [] },
    });
    await stop(s, 'replay-no-write-old');
    const replay = await callV4({ scenarioId: s, turnId: 'replay-no-write-old', fenceGeneration: gA });
    record('2.738(a): the replay answer is read-only (returns an id)', replay.ok === true);
    const g = await scenarioGraph(s);
    record('…and the NEWER graph is untouched by the replay',
      JSON.stringify(g?.nodes) === JSON.stringify([{ id: 'newer' }]));
  }

  console.log('\n── Phase 3: the trace columns accept the app’s mark + reads');
  {
    const { s } = await phantomShape();
    await sql`
      UPDATE v5_turn_fence
        SET graph_write_failed_at = now(), graph_write_failure_reason = 'superseded'
      WHERE scenario_id = ${s}::uuid AND turn_id = 'browser-draft-turn' AND graph_write_failed_at IS NULL
    `;
    const marked = await sql`
      SELECT count(*)::int AS n FROM v5_turn_fence
      WHERE scenario_id = ${s}::uuid AND graph_write_failed_at IS NOT NULL
    `;
    record('the app’s mark UPDATE lands', marked[0].n === 1);
    const live = await sql`
      SELECT count(*)::int AS n FROM v5_turn_fence
      WHERE scenario_id = ${s}::uuid AND turn_id <> 'browser-interrupt-turn' AND graph_write_failed_at IS NULL
    `;
    record('the continuation read excludes the failure-marked row', live[0].n === 0);
  }

  // ── ROADMAP 2.735 — the DISCLOSURE columns, and the predicate split ──────
  {
    const { s } = await phantomShape();
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'v5_turn_fence'
        AND column_name IN ('graph_loss_disclosable_at', 'graph_loss_resolved_at')
      ORDER BY column_name
    `;
    record('2.735: both disclosure columns exist', cols.length === 2,
      cols.map((c) => c.column_name).join(','));

    // A turn_dead_only mark: failed, NOT disclosable.
    await sql`
      UPDATE v5_turn_fence
        SET graph_write_failed_at = now(),
            graph_write_failure_reason = 'draft_graph_pipeline_threw_before_preview'
      WHERE scenario_id = ${s}::uuid AND turn_id = 'browser-draft-turn'
    `;
    const notice1 = await sql`
      SELECT count(*)::int AS n FROM v5_turn_fence
      WHERE scenario_id = ${s}::uuid
        AND graph_loss_disclosable_at IS NOT NULL AND graph_loss_resolved_at IS NULL
    `;
    record('2.735: a turn_dead_only mark does NOT satisfy the notice predicate', notice1[0].n === 0);

    // …and the SAME row, marked disclosable, does.
    await sql`
      UPDATE v5_turn_fence SET graph_loss_disclosable_at = now()
      WHERE scenario_id = ${s}::uuid AND turn_id = 'browser-draft-turn'
    `;
    const notice2 = await sql`
      SELECT count(*)::int AS n FROM v5_turn_fence
      WHERE scenario_id = ${s}::uuid
        AND graph_loss_disclosable_at IS NOT NULL AND graph_loss_resolved_at IS NULL
    `;
    record('2.735 DISCRIMINATOR: the same row marked draft_loss DOES satisfy it', notice2[0].n === 1);

    // …and a resolution stamp takes it back out, permanently.
    await sql`
      UPDATE v5_turn_fence SET graph_loss_resolved_at = now()
      WHERE scenario_id = ${s}::uuid
        AND graph_loss_disclosable_at IS NOT NULL AND graph_loss_resolved_at IS NULL
    `;
    const notice3 = await sql`
      SELECT count(*)::int AS n FROM v5_turn_fence
      WHERE scenario_id = ${s}::uuid
        AND graph_loss_disclosable_at IS NOT NULL AND graph_loss_resolved_at IS NULL
    `;
    record('2.735: an explicit resolution ends the notice (survives the graph going away)',
      notice3[0].n === 0);
  }

  // ── ROADMAP 2.738(b) — the continuation read must exclude STOPPED rows ───
  {
    const s = await newScenario();
    await claim(s, 'stopped-live-check');
    await claim(s, 'asking-turn');
    const before = await sql`
      SELECT count(*)::int AS n FROM v5_turn_fence
      WHERE scenario_id = ${s}::uuid AND turn_id <> 'asking-turn'
        AND stopped_at IS NULL AND graph_write_failed_at IS NULL
    `;
    record('control: an unstopped, unmarked claim reads LIVE', before[0].n === 1);
    await stop(s, 'stopped-live-check');
    const after = await sql`
      SELECT count(*)::int AS n FROM v5_turn_fence
      WHERE scenario_id = ${s}::uuid AND turn_id <> 'asking-turn'
        AND stopped_at IS NULL AND graph_write_failed_at IS NULL
    `;
    record('2.738(b): a STOPPED (never failure-marked) claim reads NOT live', after[0].n === 0);
  }

  console.log('\n── Phase 4: rollback rehearsal');
  await applyFile(MIGRATIONS.exemptionRollback);
  const rolled = await sql`
    SELECT prosrc LIKE '%v_has_graph%' AS exempt_aware FROM pg_proc WHERE proname = 'append_turn_atomic_v4'
  `;
  record('rollback restores the unconditional-OLTF2 body', rolled.length === 1 && rolled[0].exempt_aware === false);
  {
    const { s, draftGen } = await phantomShape();
    const res = await callV4({ scenarioId: s, turnId: 'browser-draft-turn', fenceGeneration: draftGen });
    record('…and the RED case refuses again post-rollback (OLTF2)', res.ok === false && res.code === 'OLTF2', `code=${res.code}`);
  }
  const colsAfter = await sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'v5_turn_fence' AND column_name IN ('graph_write_failed_at','graph_write_failure_reason')
  `;
  record('rollback KEEPS the trace columns (nullable, inert)', colsAfter[0].n === 2);
  await applyFile(MIGRATIONS.exemption);
  const reForward = await sql`
    SELECT prosrc LIKE '%v_has_graph%' AS exempt_aware FROM pg_proc WHERE proname = 'append_turn_atomic_v4'
  `;
  record('re-forward after rollback is clean', reForward.length === 1 && reForward[0].exempt_aware === true);

  // ── Summary ──
  console.log('\n════════ REHEARSAL SUMMARY ════════');
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  }
  console.log(
    `\n${results.length - failed}/${results.length} checks passed${failed ? ` — ${failed} FAILED` : ''}`,
  );
  await sql.end();
  return failed === 0 ? 0 : 1;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (err) {
  console.error('\nREHEARSAL ABORTED:', err);
  exitCode = 1;
} finally {
  stopEphemeralPostgres();
}
process.exit(exitCode);
