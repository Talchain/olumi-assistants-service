import pg from 'pg';
const c = new pg.Client({ connectionString: process.argv[2], ssl: { rejectUnauthorized: false } });
await c.connect(); await c.query('set transaction read only');
const r = await c.query("select version from supabase_migrations.schema_migrations order by version desc limit 12");
const n = await c.query("select count(*)::int as n from supabase_migrations.schema_migrations");
const t = await c.query("select to_regclass('public.v5_conversation_turns') a, to_regclass('public.model_versions') b, to_regclass('public.v5_handler_facts') c2, to_regclass('public.v5_turn_fence') d");
console.log(JSON.stringify({ at: new Date().toISOString(), total: n.rows[0].n, latest12: r.rows.map(x=>x.version), tables: t.rows[0] }, null, 2));
await c.end();
