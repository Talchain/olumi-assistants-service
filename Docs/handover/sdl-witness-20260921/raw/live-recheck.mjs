import pg from 'pg';
const c = new pg.Client({ connectionString: process.argv[2], ssl: { rejectUnauthorized: false } });
await c.connect(); await c.query('set transaction read only');
const led = await c.query(`select version, name, created_by, (statements is not null) as has_statements,
   coalesce(array_length(statements,1),0) as n_statements,
   coalesce(length(array_to_string(statements,'')),0) as statements_len
  from supabase_migrations.schema_migrations
  where version >= '20260918000000' order by version`);
const p = await c.query(`select p.proname, md5(p.prosrc) as md5, length(p.prosrc) as len, p.proacl::text as acl, p.prosecdef, p.pronargs,
   pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('append_turn_atomic_v5','create_model_version','restore_model_version') order by p.proname`);
const rows = p.rows.map(r => {
  const stripped = r.def.split('\n').map(l=>l.replace(/--.*$/,'')).join('\n');
  const bi = stripped.search(/\nBEGIN\b/);
  const body = bi>=0 ? stripped.slice(bi) : '';
  return { proname: r.proname, md5: r.md5, len: r.len, acl: r.acl, secdef: r.prosecdef, nargs: r.pronargs,
    off: { cas: body.indexOf('IF p_cas_enforce'), olgc1: body.indexOf("ERRCODE = 'OLGC1'"), lookup: body.indexOf('INTO v_existing_turn_id'),
           guard: body.indexOf('IF NOT v_turn_preexisting THEN'), mv422: body.indexOf("ERRCODE = 'MV422'"),
           mv409: body.indexOf("ERRCODE = 'MV409'"), dedupe: body.indexOf('deduped') } };
});
console.log(JSON.stringify({ at: new Date().toISOString(), ledger_since_20260918: led.rows, procs: rows }, null, 2));
await c.end();
