import pg from 'pg';
import crypto from 'node:crypto';

const DSN = process.env.DSN || 'postgres://postgres:postgres@127.0.0.1:55433/postgres';
const PHASE = process.argv[2] || 'UNLABELLED';
const H = (s) => crypto.createHash('sha256').update(s).digest('hex');
const RUN = process.env.RUN_ID || 'sdlA';

const c = new pg.Client({ connectionString: DSN });
await c.connect();

const out = { phase: PHASE, at: new Date().toISOString(), steps: [], controls: {} };
const log = (o) => { out.steps.push(o); };

// ---- function identity under test -------------------------------------------------
const fd = await c.query("select md5(prosrc) m, length(prosrc) l from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='append_turn_atomic_v5'");
out.function_under_test = { prosrc_md5: fd.rows[0].m, prosrc_len: fd.rows[0].l };

// ---- fixture -----------------------------------------------------------------------
const uid = crypto.randomUUID();
await c.query('insert into auth.users(id) values ($1) on conflict do nothing', [uid]);
const owned = (await c.query('insert into public.scenarios(user_id, brief_text) values ($1,$2) returning id', [uid, `${RUN}-owned-${PHASE}`])).rows[0].id;
const guest = (await c.query('insert into public.scenarios(user_id, brief_text) values (NULL,$1) returning id', [`${RUN}-guest-${PHASE}`])).rows[0].id;
const firstwrite = (await c.query('insert into public.scenarios(user_id, brief_text) values ($1,$2) returning id', [uid, `${RUN}-firstwrite-${PHASE}`])).rows[0].id;
out.fixture = { owned_scenario: owned, guest_scenario: guest, firstwrite_scenario: firstwrite, owner_user_id: uid };

const SQL = `select public.append_turn_atomic_v5(
  $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::boolean,$7::int,$8::int,$9::jsonb,$10::jsonb,
  $11::text,$12::jsonb,$13::jsonb,$14::text,$15::text,$16::text,$17::text,$18::boolean,$19::bigint,
  $20::uuid,$21::text,$22::text,$23::text,$24::text,$25::text,$26::text,$27::text,$28::text,$29::text,$30::boolean) as r`;

// generation is a GLOBAL bigserial PK (20260731120000_v5_turn_fence.sql:87); per-scenario
// ordering is derived as MAX(generation) filtered by scenario. Let the sequence allocate.
async function fence(scenario, turnId) {
  const r = await c.query('insert into public.v5_turn_fence(scenario_id, turn_id) values ($1,$2) returning generation', [scenario, turnId]);
  return Number(r.rows[0].generation);
}

async function call(name, a) {
  const args = [
    a.scenario, a.turnId, 'direct_answer', null, H('req-' + a.turnId), true, 1, 10,
    JSON.stringify([]), JSON.stringify(a.graph), a.brief ?? null, JSON.stringify([]), null,
    'u', 'a', a.expected, a.incoming, a.casEnforce ?? true, a.fenceGen ?? null,
    a.mutationId, a.aah, 'sha256', 'p1', 'n1', 'g1', 'system', null, 'committed_mutation', a.turnId,
    a.baseKnown ?? true,
  ];
  if (args.length !== 30) throw new Error('arity ' + args.length);
  try {
    const r = await c.query(SQL, args);
    const rec = r.rows[0].r;
    log({ name, ok: true, turn_row_id: rec.turn_row_id, receipt_is_null: rec.model_version_receipt === null, receipt: rec.model_version_receipt });
    return { ok: true, value: rec };
  } catch (e) {
    log({ name, ok: false, sqlstate: e.code, message: e.message });
    return { ok: false, code: e.code, message: e.message };
  }
}

const gO = (n) => ({ nodes: [{ id: 'n' + n }], edges: [] });
const hO = (n) => H('owned-graph-' + n);
const gG = (n) => ({ nodes: [{ id: 'g' + n }], edges: [] });
const hG = (n) => H('guest-graph-' + n);

// ===== OWNED: establish graph, then T1, then T2 moves the head =====================
const M0 = crypto.randomUUID(), M1 = crypto.randomUUID(), M2 = crypto.randomUUID(), M3 = crypto.randomUUID(), MX = crypto.randomUUID();
const fT0 = await fence(owned, 'T0');
const t0 = await call('OWNED T0 first write (expected NULL, incoming H0)', { scenario: owned, turnId: 'T0', graph: gO(0), expected: null, incoming: hO(0), fenceGen: fT0, mutationId: M0, aah: H('aah0') });
const fT1 = await fence(owned, 'T1');
const t1 = await call('OWNED T1 (expected H0, incoming H1) — the turn we will replay', { scenario: owned, turnId: 'T1', graph: gO(1), expected: hO(0), incoming: hO(1), fenceGen: fT1, mutationId: M1, aah: H('aah1') });
const fT2 = await fence(owned, 'T2');
const t2 = await call('OWNED T2 (expected H1, incoming H2) — head moves on', { scenario: owned, turnId: 'T2', graph: gO(2), expected: hO(1), incoming: hO(2), fenceGen: fT2, mutationId: M2, aah: H('aah2') });

const beforeReplay = (await c.query('select (select count(*)::int from public.model_versions where scenario_id=$1) mv, (select count(*)::int from public.v5_conversation_turns where scenario_id=$1) ct, (select graph_identity_hash from public.scenarios where id=$1) hash', [owned])).rows[0];
out.controls.state_before_replay = beforeReplay;
out.controls.hashes = { H0: hO(0), H1: hO(1), H2: hO(2) };

// ===== THE REPLAY — byte-identical arguments to T1 =================================
const replay = await call('REPLAY of T1 — byte-identical args to T1 (expected H0, incoming H1, current H2)', { scenario: owned, turnId: 'T1', graph: gO(1), expected: hO(0), incoming: hO(1), fenceGen: fT1, mutationId: M1, aah: H('aah1') });
out.replay = replay;

// durability proof: the write the caller was told was stale
const dur = (await c.query("select (select count(*)::int from public.v5_conversation_turns where scenario_id=$1 and turn_id='T1') turn_T1, (select count(*)::int from public.model_versions where scenario_id=$1 and mutation_id=$2) version_M1, (select count(*)::int from public.model_versions where scenario_id=$1) mv_total, (select count(*)::int from public.v5_conversation_turns where scenario_id=$1) ct_total", [owned, M1])).rows[0];
out.controls.durability_after_replay = dur;
out.controls.counts_unchanged = dur.mv_total === beforeReplay.mv && dur.ct_total === beforeReplay.ct;
if (replay.ok && t1.ok) {
  out.controls.receipt_deep_equal_to_T1 = JSON.stringify(replay.value.model_version_receipt) === JSON.stringify(t1.value.model_version_receipt);
  out.controls.turn_row_id_equal_to_T1 = replay.value.turn_row_id === t1.value.turn_row_id;
}

// ===== C1: a genuinely STALE NEW turn must still be refused ========================
const fT3 = await fence(owned, 'T3');
const c1 = await call('C1 STALE NEW turn T3 (fresh turn_id, expected H0, current H2)', { scenario: owned, turnId: 'T3', graph: gO(3), expected: hO(0), incoming: hO(3), fenceGen: fT3, mutationId: M3, aah: H('aah3') });
out.controls.C1 = { raised_OLGC1: !c1.ok && c1.code === 'OLGC1', detail: c1 };

// ===== C2: replay of T1 with a DIFFERENT mutation id ==============================
const c2 = await call('C2 REPLAY of T1 with a DIFFERENT mutation id', { scenario: owned, turnId: 'T1', graph: gO(1), expected: hO(0), incoming: hO(1), fenceGen: fT1, mutationId: MX, aah: H('aah1') });
out.controls.C2 = { raised_MV422: !c2.ok && c2.code === 'MV422', detail: c2 };

// ===== C3: GUEST scenario =========================================================
const G0 = crypto.randomUUID(), G1 = crypto.randomUUID(), G2 = crypto.randomUUID();
const fG0 = await fence(guest, 'GT0');
const g0 = await call('C3 GUEST GT0 first write', { scenario: guest, turnId: 'GT0', graph: gG(0), expected: null, incoming: hG(0), fenceGen: fG0, mutationId: G0, aah: H('gaah0') });
const fG1 = await fence(guest, 'GT1');
const g1 = await call('C3 GUEST GT1 (the turn we replay)', { scenario: guest, turnId: 'GT1', graph: gG(1), expected: hG(0), incoming: hG(1), fenceGen: fG1, mutationId: G1, aah: H('gaah1') });
const fG2 = await fence(guest, 'GT2');
const g2 = await call('C3 GUEST GT2 — head moves on', { scenario: guest, turnId: 'GT2', graph: gG(2), expected: hG(1), incoming: hG(2), fenceGen: fG2, mutationId: G2, aah: H('gaah2') });
const greplay = await call('C3 GUEST REPLAY of GT1', { scenario: guest, turnId: 'GT1', graph: gG(1), expected: hG(0), incoming: hG(1), fenceGen: fG1, mutationId: G1, aah: H('gaah1') });
const gmv = (await c.query('select count(*)::int n from public.model_versions where scenario_id=$1', [guest])).rows[0].n;
out.controls.C3 = {
  write_committed: g1.ok,
  write_receipt_null: g1.ok ? g1.value.model_version_receipt === null : null,
  replay_ok: greplay.ok,
  replay_receipt_null: greplay.ok ? greplay.value.model_version_receipt === null : null,
  guest_model_versions_count: gmv,
  detail: { g1, greplay },
};

// ===== C5: first-write exemption (current hash NULL, expected non-null) ===========
const F1 = crypto.randomUUID();
const fF1 = await fence(firstwrite, 'FT1');
const f1 = await call('C5 FIRST-WRITE exemption: current hash NULL, expected NON-NULL, base_known', { scenario: firstwrite, turnId: 'FT1', graph: { nodes: [], edges: [] }, expected: H('never-stamped'), incoming: H('fw-incoming'), fenceGen: fF1, mutationId: F1, aah: H('fwaah') });
out.controls.C5 = { not_refused: f1.ok, detail: f1 };

console.log(JSON.stringify(out, null, 2));
await c.end();
