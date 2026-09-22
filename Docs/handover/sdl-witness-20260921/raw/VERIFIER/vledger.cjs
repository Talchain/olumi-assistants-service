const fs=require('fs');const {Client}=require('pg');
const E='/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env.staging.local';
const txt=fs.readFileSync(E,'latin1');
function k(n){const m=txt.match(new RegExp('^'+n+'=(.*)$','m'));return m?m[1].replace(/["'\r\n ]/g,''):null;}
const url=k('SUPABASE_URL');const ref=url.replace('https://','').split('.')[0];
(async()=>{
const c=new Client({host:'aws-0-us-east-1.pooler.supabase.com',port:5432,user:'postgres.'+ref,password:k('SUPABASE_DB_PASSWORD'),database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect(); await c.query('set transaction read only');
const cols=await c.query(`select column_name,data_type from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations' order by ordinal_position`);
const l=await c.query(`select version,name,created_by, array_length(statements,1) as n_stmt, char_length(array_to_string(statements, '')) as chars_joined_empty, char_length(array_to_string(statements, ';')) as chars_joined_semi from supabase_migrations.schema_migrations order by version desc limit 12`);
const raw=await c.query(`select statements from supabase_migrations.schema_migrations where version='20260920210000'`);
const out={ts:new Date().toISOString(),cols:cols.rows,ledger:l.rows};
if(raw.rows.length){const st=raw.rows[0].statements; out.stmt_count=st.length; out.total_chars=st.reduce((a,b)=>a+[...b].length,0); out.total_utf16=st.reduce((a,b)=>a+b.length,0); out.total_bytes=st.reduce((a,b)=>a+Buffer.byteLength(b,'utf8'),0);
 fs.writeFileSync('/private/tmp/claude-502/-Users-paulslee-Documents-GitHub/b9b90b64-25c1-4a6a-b2e8-866693c995f7/scratchpad/evidence/VERIFIER/ledger-20260920210000-statements.sql', st.join('\n;;;STATEMENT-SEP;;;\n'));}
else out.row='ABSENT';
console.log(JSON.stringify(out,null,2));
await c.end();})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
