import pg from 'pg';
const c = new pg.Client({ connectionString: process.argv[2], ssl: { rejectUnauthorized: false } });
await c.connect(); await c.query('set transaction read only');
const q = await c.query(`select p.proname, p.pronargs, p.proacl::text as acl, p.prosecdef, md5(p.prosrc) as md5
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('append_turn_atomic_v5','append_turn_atomic_v4','create_model_version','restore_model_version')
  order by p.proname`);
const led = await c.query(`select count(*) filter (where version in ('20260920210000','20260920220000'))::int as new_ones,
  count(*) filter (where version='20260824200000')::int as c8_present, max(version) as max_version from supabase_migrations.schema_migrations`);
const cols = await c.query(`select column_name, data_type from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations' order by ordinal_position`);
console.log(JSON.stringify({ at: new Date().toISOString(), procs: q.rows, ledger: led.rows[0], ledger_columns: cols.rows }, null, 2));
await c.end();
