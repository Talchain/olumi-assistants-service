#!/usr/bin/env node
/**
 * REHEARSAL — append_turn_atomic_v4 generation-keyed fence gate (ROADMAP 2.301).
 *
 * Drives the REAL migration SQL, byte-for-byte from this repo, against an
 * ephemeral local Postgres 16 (Docker) or a caller-supplied LOCAL database,
 * and proves — RED-first, with MISMATCHED identities — that:
 *
 *   RED   (defect reproduction): v4 AS EXECUTED ON STAGING (20260731130000)
 *         REFUSES a commit whose write identity (p_turn_id = server
 *         request_id) differs from the claim identity the fence row was
 *         written under (browser turn_id), even though the caller passes its
 *         genuinely admitted generation. SQLSTATE OLTF3 — the staging outage
 *         in a bottle. The ORIGINAL #761 rehearsal used matched identities,
 *         so it structurally could not see this; this harness makes the
 *         mismatch the primary case.
 *   GREEN (the fix): the corrected v4 (20260802120000, generation-keyed
 *         lookup) ADMITS that same commit.
 *   FENCE STILL FENCES: stopped → OLTF1 (and wins over superseded),
 *         superseded → OLTF2, never-admitted generation → OLTF3,
 *         cross-scenario generation → OLTF3, all under mismatched write
 *         identity; refusals leak no rows and leave the graph untouched.
 *   UNCHANGED: matched-identity commits (draft/run_analysis shape), NULL
 *         generation (gate skipped), non-graph writes (never gated),
 *         CAS OLGC1, idempotent replay, ACLs, and the Stop-vs-append
 *         FOR-UPDATE serialisation point.
 *   ROLLBACK: the paired rollback drops exactly v4; re-forward is clean.
 *
 * Every absence/refusal assertion has a positive control (trap 13): the
 * harness first proves it can SEE a success before asserting any refusal,
 * and vice versa.
 *
 * Usage:
 *   node scripts/rehearse-turn-fence-atomic-append-generation-key.mjs
 *     — manages its own ephemeral `docker run postgres:16` (unique name,
 *       random port, removed afterwards).
 *   REHEARSAL_DB_URL=postgres://... node scripts/rehearse-...mjs
 *     — uses an existing LOCAL Postgres. Refuses non-local hosts: this
 *       harness must NEVER point at staging (migration execution is
 *       Paul-gated; this script is the rehearsal, not the execution).
 *
 * Exit code 0 = every check passed. Non-zero = at least one check failed;
 * the table names each failure. DO NOT execute the migration on staging
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
  v4AsExecuted: path.join(
    repo,
    'supabase/migrations/20260731130000_v5_turn_fence_atomic_append.sql',
  ),
  v4Corrected: path.join(
    repo,
    'supabase/migrations/20260802120000_v5_turn_fence_atomic_append_generation_key.sql',
  ),
  v4CorrectedRollback: path.join(
    repo,
    'supabase/migrations/rollback/20260802120000_v5_turn_fence_atomic_append_generation_key_rollback.sql.do-not-apply',
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

// ── Database lifecycle ──────────────────────────────────────────────────────
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
  containerName = `fence-rehearsal-${suffix}`;
  const port = 54000 + Math.floor(Math.random() * 1000);
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
  // Wait for readiness.
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
let sql; // postgres.js tagged-template client

async function applyFile(file) {
  const text = readFileSync(file, 'utf8');
  await sql.unsafe(text);
}

/**
 * Call append_turn_atomic_v4 with named args. Returns
 * { ok: true, id } or { ok: false, code, detail, message }.
 */
async function callV4({
  scenarioId,
  turnId,
  fenceGeneration = null,
  graph = { nodes: [{ id: 'n1' }], edges: [] },
  casEnforce = false,
  expectedHash = null,
  incomingHash = 'hash-incoming',
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
        p_expected_graph_identity_hash => ${expectedHash},
        p_incoming_graph_identity_hash => ${graph === null ? null : incomingHash},
        p_cas_enforce                  => ${casEnforce},
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

// ── Bootstrap: roles + the three tables at their REAL staging constraint
//    shapes (adversarial-review A2: an over-permissive bootstrap let a
//    control "pass" a call the real schema would 23514-refuse — trap 13).
//    Faithful pieces, each derived from the repo's own migrations:
//      · v5_conversation_turns: UNIQUE (scenario_id, turn_id) (idempotency
//        branch), request_hash NOT NULL, turn_class_valid CHECK and
//        handler_id_biconditional CHECK — all per 20260417160000 (:30-37,
//        :168-184);
//      · scenarios: guest-nullable user_id per 20260422000000,
//        graph_identity_hash per 20260717120000, and the
//        scenarios_updated_at BEFORE-UPDATE trigger per 20260226010000
//        (the update_updated_at() function body predates this repo's
//        migrations on staging; the standard NEW.updated_at = now() shape
//        is used here).
//    The REAL fence migrations are applied verbatim afterwards — the
//    objects under test are never hand-mocked. ──────────────────────────
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
  // max: 1 — the migration files carry their own BEGIN/COMMIT, which
  // postgres.js only permits on a single-connection client (UNSAFE_TRANSACTION
  // guard). The race probe uses its own second client.
  sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

  console.log('\n── Phase 0: bootstrap + REAL fence migration (20260731120000)');
  await bootstrap();
  await applyFile(MIGRATIONS.fence);
  const fenceRpcs = await sql`
    SELECT count(*)::int AS n FROM pg_proc
    WHERE proname IN ('v5_claim_turn_fence','v5_evaluate_turn_fence','v5_mark_turn_stopped')
  `;
  record('fence schema live (3 RPCs)', fenceRpcs[0].n === 3, `n=${fenceRpcs[0].n}`);

  console.log('\n── Phase 1: v4 AS EXECUTED ON STAGING (20260731130000)');
  await applyFile(MIGRATIONS.v4AsExecuted);
  const v4a = await sql`
    SELECT pronargs FROM pg_proc WHERE proname = 'append_turn_atomic_v4'
  `;
  record('v4-as-executed present, 19 args', v4a.length === 1 && v4a[0].pronargs === 19);

  // POSITIVE CONTROL first (trap 13): matched identity commits under
  // v4-as-executed — proves the rig can see a SUCCESS before any refusal
  // claim is made.
  {
    const s = await newScenario();
    const g = await claim(s, 'browser-turn-matched');
    const res = await callV4({ scenarioId: s, turnId: 'browser-turn-matched', fenceGeneration: g });
    record(
      'positive control: MATCHED identity commits under v4-as-executed',
      res.ok === true,
      res.ok ? '' : `${res.code}: ${res.message}`,
    );
  }

  // ── THE RED: the staging outage reproduced ──
  {
    const s = await newScenario();
    const g = await claim(s, 'browser-turn-X');
    const res = await callV4({ scenarioId: s, turnId: 'request-id-R', fenceGeneration: g });
    record(
      'RED: MISMATCHED identity (write=request_id, claim=browser id, SAME admitted generation) is REFUSED by v4-as-executed with OLTF3',
      res.ok === false && res.code === 'OLTF3',
      res.ok ? 'UNEXPECTED COMMIT' : `code=${res.code}`,
    );
    const n = await turnRowCount(s);
    record('RED refusal leaked no turn row', n === 0, `rows=${n}`);
  }

  console.log('\n── Phase 2: apply the CORRECTED migration (20260802120000)');
  await applyFile(MIGRATIONS.v4Corrected);
  const v4b = await sql`
    SELECT pronargs, prosrc LIKE '%generation = p_fence_generation%' AS gen_keyed
    FROM pg_proc WHERE proname = 'append_turn_atomic_v4'
  `;
  record(
    'corrected v4 present: one function, 19 args (signature unchanged), generation-keyed',
    v4b.length === 1 && v4b[0].pronargs === 19 && v4b[0].gen_keyed === true,
  );

  // ── THE GREEN: the same mismatched-identity commit now ADMITS ──
  {
    const s = await newScenario();
    const g = await claim(s, 'browser-turn-X2');
    const res = await callV4({ scenarioId: s, turnId: 'request-id-R2', fenceGeneration: g });
    record(
      'GREEN: the SAME mismatched-identity commit is ADMITTED by corrected v4',
      res.ok === true,
      res.ok ? '' : `${res.code}: ${res.message}`,
    );
    const graph = await scenarioGraph(s);
    record('GREEN commit persisted the graph', graph !== null);
    const rows = await sql`
      SELECT turn_id FROM v5_conversation_turns WHERE scenario_id = ${s}::uuid
    `;
    record(
      'GREEN turn row keyed by the WRITE identity (request id) — insert key unchanged',
      rows.length === 1 && rows[0].turn_id === 'request-id-R2',
    );
  }

  console.log('\n── Phase 3: the fence STILL FENCES (all with mismatched write identity)');
  // (a) stopped → OLTF1
  {
    const s = await newScenario();
    const g = await claim(s, 'bt-stop');
    await stop(s, 'bt-stop');
    const res = await callV4({ scenarioId: s, turnId: 'req-stop', fenceGeneration: g });
    const detailOk = (() => {
      try {
        const d = JSON.parse(res.detail ?? '');
        return typeof d.generation === 'number' && typeof d.max_generation === 'number';
      } catch {
        return false;
      }
    })();
    record('stopped → OLTF1', res.ok === false && res.code === 'OLTF1', `code=${res.code}`);
    record('OLTF1 DETAIL carries {generation,max_generation} JSON', detailOk, res.detail ?? '');
    record('stopped refusal leaked no turn row', (await turnRowCount(s)) === 0);
    record('stopped refusal left the graph untouched', (await scenarioGraph(s)) === null);
  }
  // (b) superseded → OLTF2
  {
    const s = await newScenario();
    const g1 = await claim(s, 'bt-old');
    await claim(s, 'bt-new');
    const res = await callV4({ scenarioId: s, turnId: 'req-old', fenceGeneration: g1 });
    record('superseded → OLTF2', res.ok === false && res.code === 'OLTF2', `code=${res.code}`);
    record('superseded refusal leaked no turn row', (await turnRowCount(s)) === 0);
  }
  // (c) stopped WINS over superseded
  {
    const s = await newScenario();
    const g1 = await claim(s, 'bt-both');
    await claim(s, 'bt-later');
    await stop(s, 'bt-both');
    const res = await callV4({ scenarioId: s, turnId: 'req-both', fenceGeneration: g1 });
    record(
      'stopped WINS over superseded (OLTF1, not OLTF2)',
      res.ok === false && res.code === 'OLTF1',
      `code=${res.code}`,
    );
  }
  // (d) never-admitted generation → OLTF3
  {
    const s = await newScenario();
    const g = await claim(s, 'bt-real');
    const res = await callV4({ scenarioId: s, turnId: 'req-ghost', fenceGeneration: g + 100000 });
    record(
      'never-admitted generation → OLTF3',
      res.ok === false && res.code === 'OLTF3',
      `code=${res.code}`,
    );
  }
  // (e) cross-scenario generation → OLTF3 (the scenario_id + generation key)
  {
    const sA = await newScenario();
    const sB = await newScenario();
    const gA = await claim(sA, 'bt-a');
    const res = await callV4({ scenarioId: sB, turnId: 'req-b', fenceGeneration: gA });
    record(
      "another scenario's generation → OLTF3 (cross-scenario key guard)",
      res.ok === false && res.code === 'OLTF3',
      `code=${res.code}`,
    );
  }

  console.log('\n── Phase 4: unchanged behaviours');
  // (f) matched identity — the REAL draft-dispatcher shape (A2 review fix:
  // the earlier control used turn_class 'draft', which the real
  // turn_class_valid CHECK 23514-refuses; the actual draft commit is
  // turn_class 'direct_answer' + handler_id NULL with payload.turn_id as
  // the write identity — draft-graph-dispatch.ts:696).
  {
    const s = await newScenario();
    const g = await claim(s, 'bt-draft');
    const res = await callV4({
      scenarioId: s,
      turnId: 'bt-draft',
      fenceGeneration: g,
      turnClass: 'direct_answer',
    });
    record(
      'matched-identity (real draft-dispatcher shape) commit unchanged',
      res.ok === true,
      res.ok ? '' : `${res.code}: ${res.message}`,
    );
  }
  // (g) NULL generation skips the gate
  {
    const s = await newScenario();
    const res = await callV4({ scenarioId: s, turnId: 'req-nogen', fenceGeneration: null });
    record('NULL p_fence_generation skips the gate (v3-equivalent)', res.ok === true);
  }
  // (h) non-graph write never gated — even on a STOPPED turn's generation
  {
    const s = await newScenario();
    const g = await claim(s, 'bt-stopped-nograph');
    await stop(s, 'bt-stopped-nograph');
    const res = await callV4({
      scenarioId: s,
      turnId: 'req-nograph',
      fenceGeneration: g,
      graph: null,
    });
    record('non-graph write never gated (commits despite stopped fence row)', res.ok === true);
  }
  // (i) CAS OLGC1 still enforced inside v4
  {
    const s = await newScenario();
    await sql`UPDATE scenarios SET graph_identity_hash = 'hash-current' WHERE id = ${s}::uuid`;
    const g = await claim(s, 'bt-cas');
    const res = await callV4({
      scenarioId: s,
      turnId: 'req-cas',
      fenceGeneration: g,
      casEnforce: true,
      expectedHash: 'hash-stale-base',
      incomingHash: 'hash-incoming-different',
    });
    record('CAS conflict still raises OLGC1', res.ok === false && res.code === 'OLGC1', `code=${res.code}`);
  }
  // (j) idempotent replay: same (scenario_id, turn_id) returns the same row id
  {
    const s = await newScenario();
    const g = await claim(s, 'bt-replay');
    const first = await callV4({ scenarioId: s, turnId: 'req-replay', fenceGeneration: g });
    const second = await callV4({ scenarioId: s, turnId: 'req-replay', fenceGeneration: g });
    record(
      'idempotent replay returns the same row id, no re-mutation',
      first.ok && second.ok && first.id === second.id,
    );
  }

  console.log('\n── Phase 5: Stop-vs-append serialisation (FOR UPDATE on the fence row)');
  {
    // A transaction holding the turn's fence row (as v5_mark_turn_stopped
    // does mid-Stop) must BLOCK the v4 append, and after it commits the
    // tombstone, the append must refuse OLTF1 — the C1 probe from the #761
    // rehearsal, now under the generation key.
    const s = await newScenario();
    const g = await claim(s, 'bt-race');
    const holder = postgres(dbUrl, { max: 1, onnotice: () => {} });
    let appendSettled = false;
    let appendResult = null;
    let appendPromise = null;
    await holder.begin(async (tx) => {
      // Simulate v5_mark_turn_stopped holding its transaction open with the
      // tombstone written but uncommitted (it updates this same row).
      await tx`
        UPDATE v5_turn_fence SET stopped_at = now()
        WHERE scenario_id = ${s}::uuid AND turn_id = 'bt-race'
      `;
      appendPromise = callV4({ scenarioId: s, turnId: 'req-race', fenceGeneration: g }).then(
        (r) => {
          appendSettled = true;
          appendResult = r;
          return r;
        },
      );
      // Give the append time to reach the FOR UPDATE and block.
      await new Promise((r) => setTimeout(r, 1500));
      record(
        'append BLOCKS on the held fence row (not settled after 1.5 s)',
        appendSettled === false,
      );
      // Returning commits the holder txn (the Stop lands).
    });
    await appendPromise;
    record(
      'after the Stop commits, the BLOCKED append settles with OLTF1',
      appendResult !== null && appendResult.ok === false && appendResult.code === 'OLTF1',
      appendResult ? `code=${appendResult.code}` : 'never settled',
    );
    await holder.end();
  }

  console.log('\n── Phase 6: ACL posture');
  {
    const acl = await sql`
      SELECT
        has_function_privilege('service_role','public.append_turn_atomic_v4(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint)','EXECUTE') AS svc,
        has_function_privilege('anon','public.append_turn_atomic_v4(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint)','EXECUTE') AS anon,
        has_function_privilege('authenticated','public.append_turn_atomic_v4(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, text, text, boolean, bigint)','EXECUTE') AS auth
    `;
    record(
      'EXECUTE: service_role only (anon/authenticated refused)',
      acl[0].svc === true && acl[0].anon === false && acl[0].auth === false,
      JSON.stringify(acl[0]),
    );
  }

  console.log('\n── Phase 7: rollback rehearsal');
  await applyFile(MIGRATIONS.v4CorrectedRollback);
  const afterDrop = await sql`
    SELECT
      (SELECT count(*)::int FROM pg_proc WHERE proname = 'append_turn_atomic_v4') AS v4,
      (SELECT count(*)::int FROM pg_proc WHERE proname IN ('v5_claim_turn_fence','v5_evaluate_turn_fence','v5_mark_turn_stopped')) AS fence_rpcs
  `;
  record(
    'rollback drops exactly v4 (fence RPCs intact)',
    afterDrop[0].v4 === 0 && afterDrop[0].fence_rpcs === 3,
    JSON.stringify(afterDrop[0]),
  );
  await applyFile(MIGRATIONS.v4Corrected);
  const reForward = await sql`
    SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'append_turn_atomic_v4'
  `;
  record('re-forward after rollback is clean', reForward[0].n === 1);

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
