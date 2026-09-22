import pg from 'pg';
const dsn = process.argv[2];
const readOnly = process.argv[3] === 'ro';
const c = new pg.Client({ connectionString: dsn, ssl: dsn.includes('supabase.com') ? { rejectUnauthorized: false } : undefined });
await c.connect();
if (readOnly) await c.query('set transaction read only');
const v = (await c.query('select version() as v')).rows[0].v;
const r = await c.query("select pg_get_functiondef(p.oid) as d, md5(p.prosrc) as m, length(p.prosrc) as len from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='append_turn_atomic_v5'");
if (r.rows.length !== 1) { console.log(JSON.stringify({ error: 'expected 1 function, got ' + r.rows.length })); await c.end(); process.exit(2); }
const def = r.rows[0].d;
// strip -- comments (line comments only), then slice after the first standalone BEGIN
const stripped = def.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
const bi = stripped.search(/\nBEGIN\b/);
if (bi < 0) { console.log(JSON.stringify({ error: 'no BEGIN found' })); await c.end(); process.exit(2); }
const body = stripped.slice(bi);
const probes = {
  'IF p_cas_enforce': body.indexOf('IF p_cas_enforce'),
  "ERRCODE = 'OLGC1'": body.indexOf("ERRCODE = 'OLGC1'"),
  'INTO v_existing_turn_id': body.indexOf('INTO v_existing_turn_id'),
  'IF NOT v_turn_preexisting THEN': body.indexOf('IF NOT v_turn_preexisting THEN'),
  "ERRCODE = 'MV422'": body.indexOf("ERRCODE = 'MV422'"),
  'append_turn_atomic_v4(': body.indexOf('append_turn_atomic_v4('),
};
const casFirst = probes['IF p_cas_enforce'] >= 0 && probes['INTO v_existing_turn_id'] >= 0 && probes['IF p_cas_enforce'] < probes['INTO v_existing_turn_id'];
console.log(JSON.stringify({ at: new Date().toISOString(), version: v, prosrc_md5: r.rows[0].m, prosrc_len: r.rows[0].len, body_len: body.length, offsets: probes, ordering: casFirst ? 'CAS_BEFORE_REPLAY_LOOKUP' : 'REPLAY_LOOKUP_BEFORE_CAS' }, null, 2));
await c.end();
