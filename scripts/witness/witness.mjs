#!/usr/bin/env node
/**
 * SDL state-spine witness — OWNED scenario, deployed staging.
 * Every assertion reads a DB row or a wire JSON field. Never assistant prose.
 */
import { readFileSync, appendFileSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Client } = require('/private/tmp/claude-502/-Users-paulslee-Documents-GitHub/b9b90b64-25c1-4a6a-b2e8-866693c995f7/scratchpad/node_modules/pg')

const S = '/private/tmp/claude-502/-Users-paulslee-Documents-GitHub/b9b90b64-25c1-4a6a-b2e8-866693c995f7/scratchpad'
const BASE = process.env.WITNESS_BASE_URL ?? 'https://cee-staging.onrender.com'
const ENV = '/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env.staging.local'
const LOG = `${S}/evidence/W3-owned-witness.log`

const envVal = (k) => {
  const l = readFileSync(ENV, 'latin1').split('\n').find((x) => x.startsWith(`${k}=`))
  if (!l) throw new Error(`missing ${k}`)
  return l.slice(k.length + 1).replace(/["'\r]/g, '').trim()
}
const session = JSON.parse(readFileSync(`${S}/witness-auth/session.json`, 'utf8'))
const ASSIST = envVal('ASSIST_API_KEY')

const log = (...a) => { const line = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); console.log(line); appendFileSync(LOG, line + '\n') }

function db() {
  const ref = envVal('SUPABASE_URL').replace('https://', '').split('.')[0]
  return new Client({ host: 'aws-0-us-east-1.pooler.supabase.com', port: 5432, user: `postgres.${ref}`,
    password: envVal('SUPABASE_DB_PASSWORD'), database: 'postgres', ssl: { rejectUnauthorized: false } })
}

async function turn({ scenarioId, message, stage = 'frame', turnClass = 'frame', source = 'composer', chip, turnId, timeoutMs = 240000 }) {
  const body = { kind: 'message', turn_id: turnId ?? randomUUID(), scenario_id: scenarioId,
    stage, message, turn_class: turnClass, source, ...(chip ? { chip } : {}) }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  const started = Date.now()
  try {
    const res = await fetch(`${BASE}/orchestrate/v2/turn`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'x-olumi-assist-key': ASSIST,
        Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify(body) })
    const text = await res.text()
    let json = null; try { json = JSON.parse(text) } catch { /* keep raw */ }
    return { status: res.status, json, raw: text.slice(0, 600), ms: Date.now() - started, sentTurnId: body.turn_id }
  } finally { clearTimeout(timer) }
}

async function readScenario(c, id) {
  const { rows } = await c.query(
    `select s.id, s.user_id, s.graph_identity_hash, s.current_model_version_id,
            (s.graph is not null) has_graph, s.updated_at
       from scenarios s where s.id = $1`, [id])
  const versions = (await c.query(
    `select id, version_number, creation_kind, graph_identity_hash, left(analysis_affecting_hash,16) aah16,
            mutation_id, parent_version_id, source_turn_id, created_at
       from model_versions where scenario_id = $1 order by version_number`, [id])).rows
  const turns = (await c.query(
    `select turn_id, turn_class, handler_id, model_version_mutation_id, model_version_created, created_at
       from v5_conversation_turns where scenario_id = $1 order by created_at`, [id])).rows
  const facts = (await c.query(
    `select handler_id, payload->'result'->>'graph_hash_at_run' ghar,
            payload->'result'->>'computed_at' computed_at, created_at
       from v5_handler_facts where scenario_id = $1 order by created_at`, [id])).rows
  return { scenario: rows[0] ?? null, versions, turns, facts }
}

const PHASE = process.argv[2] ?? 'all'
const SCENARIO = process.argv[3] ?? randomUUID()

const c = db()
await c.connect()
try {
  log(`\n===== ${new Date().toISOString()} phase=${PHASE} scenario=${SCENARIO} =====`)
  log(`owner sub=${session.userId} base=${BASE}`)

  if (PHASE === 'draft' || PHASE === 'all') {
    const brief = 'We are a B2B SaaS company deciding whether to raise our entry plan from £59 to £79 per month. '
      + 'Churn is currently 3% monthly. We have 1,200 customers. Help me model this decision.'
    log('\n-- STEP 1: draft turn (owned)')
    const r = await turn({ scenarioId: SCENARIO, message: brief })
    log(`  http=${r.status} ms=${r.ms} turn_id=${r.sentTurnId}`)
    if (r.status !== 200) log(`  body: ${r.raw}`)
    const st = await readScenario(c, SCENARIO)
    log(`  DB scenario row: ${st.scenario ? 'present' : 'ABSENT'}`)
    if (st.scenario) {
      log(`  user_id=${st.scenario.user_id ?? 'NULL(guest)'}  OWNED=${st.scenario.user_id === session.userId}`)
      log(`  graph_identity_hash(A)=${st.scenario.graph_identity_hash}`)
      log(`  current_model_version_id=${st.scenario.current_model_version_id}`)
    }
    log(`  versions=${st.versions.length} ${JSON.stringify(st.versions.map(v => ({ n: v.version_number, kind: v.creation_kind, idh: (v.graph_identity_hash||'').slice(0,12) })))}`)
    log(`  turns=${st.turns.length} mutationIds=${st.turns.filter(t=>t.model_version_mutation_id).length}`)
  }

  if (PHASE === 'mutate' || PHASE === 'all') {
    const before = await readScenario(c, SCENARIO)
    const hashA = before.scenario.graph_identity_hash
    log(`\n-- STEP 2: mutation (propose then confirm). hash A=${hashA.slice(0,16)}...`)

    log('  turn 2a: propose')
    const p = await turn({ scenarioId: SCENARIO, message: 'Change Entry Plan Monthly Price to £62 per month.' })
    log(`    http=${p.status} ms=${p.ms} turn_id=${p.sentTurnId}`)
    if (p.status !== 200) log(`    body: ${p.raw}`)

    log('  turn 2b: confirm')
    const confirmTurnId = randomUUID()
    const y = await turn({ scenarioId: SCENARIO, message: 'Yes', turnId: confirmTurnId })
    log(`    http=${y.status} ms=${y.ms} turn_id=${confirmTurnId}`)
    const receipt = y.json?.model_version_receipt ?? null
    log(`    wire model_version_receipt: ${receipt ? 'PRESENT' : 'ABSENT'}`)
    if (receipt) log(`      mutation_id=${receipt.mutation_id} version_id=${receipt.version_id} sequence=${receipt.sequence} full_hash=${String(receipt.full_hash).slice(0,16)}...`)

    const after = await readScenario(c, SCENARIO)
    const hashB = after.scenario.graph_identity_hash
    log(`\n  RESULT`)
    log(`    hash A -> B changed: ${hashA !== hashB}  B=${(hashB||'').slice(0,16)}...`)
    log(`    versions now: ${JSON.stringify(after.versions.map(v => ({ n: v.version_number, kind: v.creation_kind, idh: (v.graph_identity_hash||'').slice(0,12), parent: (v.parent_version_id||'').slice(0,8), mut: (v.mutation_id||'').slice(0,8), src_turn: (v.source_turn_id||'').slice(0,8) })))}`)
    const head = after.versions[after.versions.length - 1]
    log(`    pointer -> head: ${after.scenario.current_model_version_id === head.id}`)
    log(`    head identity == scenario identity: ${head.graph_identity_hash === hashB}`)
    log(`    head is committed_mutation: ${head.creation_kind === 'committed_mutation'}`)
    log(`    head parent == version 1: ${head.parent_version_id === after.versions[0].id}`)
    if (receipt) {
      log(`    receipt mutation_id == head mutation_id: ${receipt.mutation_id === head.mutation_id}`)
      log(`    receipt full_hash == head identity: ${receipt.full_hash === head.graph_identity_hash}`)
    }
    log(`    confirm turn recorded: ${JSON.stringify(after.turns.filter(t => t.turn_id === confirmTurnId).map(t => ({ cls: t.turn_class, h: t.handler_id, mut: (t.model_version_mutation_id||'').slice(0,8), created: t.model_version_created })))}`)
    require('node:fs').writeFileSync(`${S}/witness-auth/step2.json`, JSON.stringify({ hashA, hashB, confirmTurnId, receipt, versions: after.versions }, null, 2))
  }

  if (PHASE === 'state') {
    const st = await readScenario(c, SCENARIO)
    log(JSON.stringify(st, null, 2))
  }
} finally { await c.end() }
