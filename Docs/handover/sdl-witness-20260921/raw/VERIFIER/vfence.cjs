const fs=require('fs');const {Client}=require('pg');
const E='/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env.staging.local';
const t=fs.readFileSync(E,'latin1');
const k=n=>{const m=t.match(new RegExp('^'+n+'=(.*)$','m'));return m?m[1].replace(/["'\r\n ]/g,''):null;};
const ref=k('SUPABASE_URL').replace('https://','').split('.')[0];
(async()=>{const c=new Client({host:'aws-0-us-east-1.pooler.supabase.com',port:5432,user:'postgres.'+ref,password:k('SUPABASE_DB_PASSWORD'),database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();await c.query('set transaction read only');
const q=await c.query(`select p.proname, pg_get_function_identity_arguments(p.oid) args, p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname ilike '%fence%' order by p.proname`);
for(const r of q.rows){fs.writeFileSync('evidence/VERIFIER/live-fence-'+r.proname+'.sql',r.prosrc);console.log('FN',r.proname,'(',r.args,') len',r.prosrc.length);}
await c.end();})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
