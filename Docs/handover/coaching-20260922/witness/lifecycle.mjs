/**
 * PRIORITY 4 — one authoritative lifecycle:
 *   graph revision -> analysis freshness -> readiness -> DISPLAYED result.
 * The user-facing claim under test: once the model changes, a previously
 * produced analysis result must not still present itself as current.
 */
import { sql, env } from './db.mjs';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.CEE_BASE ?? 'https://cee-staging.onrender.com';
const KEY = env.ASSIST_API_KEY;
const OWNER = process.env.WITNESS_OWNER ?? null;
const JWT = process.env.WITNESS_JWT ?? null;
const SRC = '105baa8c-f206-4880-9017-59803af99193';

const hz = await (await fetch(`${BASE}/healthz`)).json();
console.log(`## LIFECYCLE PROBE — build ${hz.build} owner=${OWNER ? 'signed-in' : 'guest'}\n`);

const [src] = await sql`select graph from public.scenarios where id=${SRC}`;
const sid = (await sql`insert into public.scenarios (user_id,title,stage,graph,scenario_schema_version)
  values (${OWNER}, 'ZZZ-LIFECYCLE', 'evaluate', ${sql.json(src.graph)}, 1) returning id`)[0].id;

const turn = async (msg, stage = 'frame') => {
  const h = { 'content-type': 'application/json', 'x-olumi-assist-key': KEY, 'x-request-id': randomUUID() };
  if (JWT) h.authorization = `Bearer ${JWT}`;
  const r = await fetch(`${BASE}/orchestrate/v2/turn`, { method: 'POST', headers: h,
    body: JSON.stringify({ kind: 'message', turn_id: randomUUID(), scenario_id: sid, stage, message: msg, turn_class: 'decide', source: 'composer' }),
    signal: AbortSignal.timeout(240000) });
  const b = await r.text(); let j = null; try { j = JSON.parse(b); } catch {}
  return { status: r.status, j, b };
};

// Walk the WHOLE payload — do not assume where the carrier sits.
const findAll = (o, re, path = '$', out = []) => {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) {
    if (re.test(k) && (v === null || typeof v !== 'object')) out.push([`${path}.${k}`, v]);
    findAll(v, re, `${path}.${k}`, out);
  }
  return out;
};
const FRESH = /fresh|stale|graph_hash|revision|analysis_ready|may_run|^status$/i;
const snap = (tag, r) => {
  const hits = findAll(r.j, FRESH);
  console.log(`--- ${tag} (HTTP ${r.status}) ---`);
  const seen = new Set();
  for (const [p, v] of hits) { const key = p.replace(/\.\d+\./g, '.[].'); if (seen.has(key + String(v))) continue; seen.add(key + String(v)); console.log(`   ${key} = ${JSON.stringify(v)?.slice(0, 60)}`); }
  if (!hits.length) console.log('   (no freshness/revision carrier in payload)');
  return Object.fromEntries(hits.map(([p, v]) => [p, v]));
};

const a = await turn('run the analysis', 'analyse');
const A = snap('1. analysis run', a);
const gh1 = (await sql`select graph_identity_hash h from public.scenarios where id=${sid}`)[0]?.h;

const b = await turn('change Sales Cycle Length to 21');
console.log(`\n--- 2. mutation (HTTP ${b.status}) --- "${String(b.j?.assistant_text ?? '').slice(0, 70)}"`);
const gh2 = (await sql`select graph_identity_hash h from public.scenarios where id=${sid}`)[0]?.h;
console.log(`   graph hash ${String(gh1).slice(0, 12)} -> ${String(gh2).slice(0, 12)}  changed=${gh1 !== gh2}`);

const c = await turn('what did the analysis say?');
const C = snap('3. after the edit — does the analysis still claim to be current?', c);
console.log(`\n   assistant_text: "${String(c.j?.assistant_text ?? '').slice(0, 220)}"`);

fs.writeFileSync(process.env.OUT ?? '/tmp/lifecycle.json', JSON.stringify({ build: hz.build, sid, gh1, gh2, A, C, texts: { run: a.j?.assistant_text, edit: b.j?.assistant_text, after: c.j?.assistant_text } }, null, 2));
await sql.end();
