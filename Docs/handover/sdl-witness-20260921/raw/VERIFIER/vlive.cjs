const fs=require('fs');const {Client}=require('pg');
const E='/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env.staging.local';
const txt=fs.readFileSync(E,'latin1');
function k(n){const m=txt.match(new RegExp('^'+n+'=(.*)$','m'));return m?m[1].replace(/["'\r\n ]/g,''):null;}
const url=k('SUPABASE_URL');const ref=url.replace('https://','').split('.')[0];
const pw=k('SUPABASE_DB_PASSWORD');
console.error('ref_len',ref.length,'pw_len',pw.length);
(async()=>{
const c=new Client({host:'aws-0-us-east-1.pooler.supabase.com',port:5432,user:'postgres.'+ref,password:pw,database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
await c.query('set transaction read only');
const out={ts:new Date().toISOString()};
const v=await c.query('select version()');out.version=v.rows[0].version;
const q=await c.query(`select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args, p.pronargs, p.prosecdef, p.proacl::text as proacl, md5(p.prosrc) as md5, length(p.prosrc) as len, p.prosrc
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('append_turn_atomic_v5','append_turn_atomic_v4','create_model_version','restore_model_version') order by p.proname`);
out.fns=q.rows.map(r=>({name:r.proname,pronargs:r.pronargs,prosecdef:r.prosecdef,proacl:r.proacl,md5:r.md5,len:r.len}));
for(const r of q.rows){fs.writeFileSync('/private/tmp/claude-502/-Users-paulslee-Documents-GitHub/b9b90b64-25c1-4a6a-b2e8-866693c995f7/scratchpad/evidence/VERIFIER/live-'+r.proname+'.prosrc.sql',r.prosrc);}
// ledger
try{const l=await c.query(`select version, name, created_by, length(statements) as stmt_len, char_length(statements) as stmt_chars, applied_at from supabase_migrations.schema_migrations order by version desc limit 12`);out.ledger=l.rows;}catch(e){out.ledger_err=String(e.message);}
console.log(JSON.stringify(out,null,2));
await c.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
