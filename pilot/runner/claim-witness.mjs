#!/usr/bin/env node
// S1e config driver. Product code and stock run-pilot.mjs are unchanged.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { typedPayload, pressPayload, runPayload, runControl, readSummary, stamp, postTurn, readScenario, loadIdentity, authHeaders, UI_ORIGIN } from './run-pilot.mjs'
import { currentCards, freshSessionVerdict } from '../../live/approve-intent.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const configPath = path.join(here, 'claim-witness.config.json')
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex')
const hex = (x) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x) ? x : /^[a-f0-9]{64}$/.test(x?.value ?? '') ? x.value : null
const tupleEqual = (a, b) => ['ui', 'cee', 'plot', 'isl'].every((k) => a?.[k] && a[k] === b?.[k])
const config = () => JSON.parse(fs.readFileSync(configPath, 'utf8'))
const write = (p, x) => fs.writeFileSync(p, JSON.stringify(x, null, 2) + '\n')

export function observe(body) {
  const nodes = Array.isArray(body?.graph?.nodes) ? body.graph.nodes : []
  return {
    graph_hash: body?.graph_hash ?? null, graph_identity_hash: body?.graph_identity_hash ?? null,
    read: readSummary(body), run: body?.canonical_analysis_view?.run ?? null,
    // Raw, complete records: no legacy source/status/approval backfill and no timestamp invented as a claim id.
    claim_carriers: nodes.filter((n) => n && Object.hasOwn(n, 'user_statements')).map((n) => ({ owner_node_id: n.id, raw: n.user_statements })),
    claims: nodes.flatMap((n) => (Array.isArray(n?.user_statements) ? n.user_statements : []).map((record, index) => ({ owner_node_id: n.id, local_record_index: index, record }))),
  }
}
export function automaticEvidence(rec, rd, before, role) {
  const tc = rec?.response_body?._agent?.tool_calls ?? []
  const run = rd?.body?.canonical_analysis_view?.run ?? null
  const responseRun = rec?.response_body?.canonical_analysis_view?.run ?? null
  const attempted = ['card_press', 'server_restore'].includes(role) && tc.some((t) => t.name === 'run_analysis' && t.ok)
  return {
    status: attempted ? 'OBSERVED_WIRE_REQUIRES_JUDGE' : 'NOT-REACHED',
    role, automatic_tool_ok: attempted, preceding_run: before?.canonical_analysis_view?.run ?? null,
    current_run: run, response_run: responseRun,
    read_revision: rd?.summary?.revision ?? null,
    hash_matches_saved_read: run ? run.graph_hash_at_run === rd?.body?.graph_hash && rd?.body?.analysis_result?.computed_against_hash === rd?.body?.graph_hash : null,
    response_run_matches_read: run && responseRun ? run.run_id === responseRun.run_id : null,
    guidance: rec?.response_body?.guidance ?? null, insights: rec?.response_body?.insights ?? null,
    provisional_view: rec?.response_body?._agent?.provisional_view ?? null,
    comparison: rec?.response_body?._agent?.run_comparison ?? rec?.response_body?.run_comparison ?? null,
    note: 'Raw response/read retain all claim-input and comparison fields. A scripted Run never passes as automatic; hashes alone do not prove claim-use identity or a correct comparison.',
  }
}
export function eligibleCards(captured, allowed, pressed = new Set(), minIssuerSeq = 1) {
  return currentCards(captured).filter((card) => {
    if (pressed.has(card.proposal_id)) return false
    const issuing = captured.find((c) => c.request_body?.turn_id === card.issued_turn_id || c.body?._agent?.turn_id === card.issued_turn_id)
    return issuing && issuing.seq >= minIssuerSeq && (issuing.body?._agent?.tool_calls ?? []).some((t) => t.ok && t.proposal_id === card.proposal_id && allowed.includes(t.name))
  })
}
export function restorePayload(version, current) {
  if (!version?.version_id || !hex(version.full_hash) || !hex(current?.graph_identity_hash)) return null
  return { version_id: version.version_id, mutation_id: crypto.randomUUID(), expected_graph_identity_hash: hex(current.graph_identity_hash) }
}
function plan(c) {
  assert.equal(c.cases.length, 4)
  assert.deepEqual(c.cases.map((x) => x.source), ['user', 'party', 'unknown', 'party'])
  return {
    mode: 'OFFLINE_PLAN', served: false, provider_calls: 0, tuple: null,
    config_sha256: sha(fs.readFileSync(configPath)), stock_runner_sha256: sha(fs.readFileSync(path.join(here, 'run-pilot.mjs'))),
    spec_sha256: sha(fs.readFileSync(c.spec)), aie_sha256: sha(fs.readFileSync(c.aie)),
    max_outer_turn_requests: 29, max_committed_restore_requests: 1,
    physical_provider_calls: 'UNMEASURED; outer requests are not provider attempts',
    stages: c.cases.map((x) => ({ id: x.id, expected: x.expected, turns: [x.brief, x.offer, ...(x.correction ? [x.correction] : []), x.cold], approvals: 'runtime-issued own card only, at most two per stage', correction: !!x.correction, undo: x.correction ? 'actual version-list identity + existing committed restore API' : 'not requested', result: 'NOT-RUN' })),
    boundaries: ['No fixture, journey or sealed corpus is opened.', 'Offline mode does not call stamp or load credentials.', 'No-browser restore is not a UI Undo click.', 'Scripted post-restore Run is CONTROL-ONLY; UI automatic continuation remains NOT-REACHED.', 'All served outcomes need independent judging; no kit-wide PASS is emitted.'],
  }
}
export function selfcheck() {
  let network = 0
  const priorFetch = globalThis.fetch
  globalThis.fetch = () => { network++; throw new Error('offline network forbidden') }
  try {
    const c = config(), p = plan(c)
    assert.equal(p.max_outer_turn_requests, c.cases.length * (1 + 1 + c.max_presses_per_stage + 1 + 1) + (1 + c.max_presses_per_stage + 1 + 1))
    const raw = { graph: { nodes: [{ id: 'local-only', user_statements: [{ subject_key: 'local', statements: [{ speaker: 'unknown', source: 'Fresh local control.', quote: 'Fresh local control.' }], history: [{ status: 'superseded', statements: [{ said_by: 'party', party: 'local control team', quote: 'Earlier local control.' }] }] }] }] } }
    const before = JSON.stringify(raw), o = observe(raw)
    assert.equal(o.claims[0].record.status, undefined); assert.equal(o.claims[0].record.statements[0].said_by, undefined)
    assert.equal(JSON.stringify(raw), before); assert.equal(o.claims[0].record.history.length, 1)
    assert.equal(observe({ graph: { nodes: [{ id: 'malformed-local', user_statements: 'malformed local carrier' }] } }).claim_carriers[0].raw, 'malformed local carrier')
    const id = 'prop_' + 'a'.repeat(32)
    const body = { _agent: { turn_id: 'offer', tool_calls: [{ name: 'propose_statement', ok: true, proposal_id: id }] }, _proposal_fields: { graph_hash: 'local-hash', proposals: [{ proposal_id: id, issued_turn_id: 'offer', revision: 'local-revision', digest: 'local-digest', fields: [], approve_action: { id: 'agent-approve-proposal:' + id, message: 'Approve the displayed local control.' } }] } }
    const captured = [{ seq: 1, request_body: { turn_id: 'brief' }, body: {} }, { seq: 2, request_body: { turn_id: 'offer' }, body }]
    assert.equal(eligibleCards(captured, c.proposal_tools).length, 1)
    assert.equal(eligibleCards(captured, [], new Set()).length, 0)
    assert.equal(eligibleCards(captured, c.proposal_tools, new Set([id])).length, 0)
    assert.equal(eligibleCards(captured, c.proposal_tools, new Set(), 3).length, 0)
    assert.equal(pressPayload({ scenarioId: 'local', body, proposalId: 'absent' }), null)
    const payload = pressPayload({ scenarioId: 'local', body, proposalId: id })
    assert.equal(payload.proposal_edits.digest, 'local-digest'); assert.equal(payload.message, body._proposal_fields.proposals[0].approve_action.message)
    assert.equal(restorePayload(null, {}), null)
    assert.equal(restorePayload({ version_id: 'local', full_hash: 'f'.repeat(64) }, {}), null)
    const restore = restorePayload({ version_id: '12b3374a-a788-4a35-81a3-b50f2714c2a8', full_hash: 'f'.repeat(64) }, { graph_identity_hash: { value: 'e'.repeat(64) } })
    assert.equal(restore.version_id, '12b3374a-a788-4a35-81a3-b50f2714c2a8'); assert.equal(restore.expected_graph_identity_hash, 'e'.repeat(64))
    assert.equal(automaticEvidence({ response_body: { _agent: { tool_calls: [{ name: 'run_analysis', ok: true }] } } }, {}, {}, 'manual_run_control').status, 'NOT-REACHED')
    assert.equal(tupleEqual({ ui: 'a' }, { ui: 'a' }), false)
    assert.equal(tupleEqual({ ui: 'a', cee: 'b', plot: 'c', isl: 'd' }, { ui: 'a', cee: 'x', plot: 'c', isl: 'd' }), false)
    assert.equal(network, 0)
    return { rung: 'LOCAL_CONTROLS_ONLY', served: false, network_requests: network, provider_calls: 0, result: 'PASS', note: 'Config/observer/wire controls only; no app or served witness PASS.' }
  } finally { globalThis.fetch = priorFetch }
}

async function execute(c, opts) {
  assert.ok(Number.isInteger(opts.maxCalls) && opts.maxCalls > 0 && Number.isInteger(opts.reserve) && opts.reserve > 0, 'Execution requires a DL-verified call allowance and per-turn reserve; no default allowance')
  assert.ok(opts.tokenFile, 'Committed version Undo needs the operator-provided signed-in test identity; no credentials are created by this kit')
  assert.ok(!fs.existsSync(opts.out), 'Served output must be a new directory; an existing capture is never overwritten')
  const identity = loadIdentity(opts.tokenFile), meta = { input_plan: plan(c), mode: 'SERVED_CAPTURE', served: false, started: new Date().toISOString(), result: 'UNJUDGED', max_reported_calls: opts.maxCalls, operator_declared_per_turn_reserve: opts.reserve, physical_provider_calls: null, provider_entries: 0, outer_turn_requests: 0, stop: null, cases: [] }
  fs.mkdirSync(opts.out, { recursive: true })
  meta.tuple_start = await stamp('claim kit start')
  const saveMeta = () => write(path.join(opts.out, 'RUN.json'), meta)
  const stop = (why) => { meta.stop ??= why; saveMeta() }
  if (!tupleEqual(meta.tuple_start, meta.tuple_start)) {
    meta.ended = new Date().toISOString(); meta.elapsed_ms = Date.parse(meta.ended) - Date.parse(meta.started)
    meta.not_started = c.cases.map((x) => x.id); meta.result = 'NOT-RUN_STAMP_UNMEASURED'; stop('INCOMPLETE_TUPLE'); return meta
  }
  const api = async (sid, suffix, requestBody) => {
    const url = UI_ORIGIN + '/bff/cee/scenarios/' + encodeURIComponent(sid) + suffix
    const started = Date.now(), rec = { url, method: 'POST', request_body: { user_id: identity.userId, ...requestBody }, sent_at: new Date().toISOString() }
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: UI_ORIGIN, ...authHeaders(identity) }, body: JSON.stringify(rec.request_body), signal: AbortSignal.timeout(300000) })
      rec.status = res.status; const text = await res.text()
      try { rec.response_body = JSON.parse(text) } catch { rec.raw = text.slice(0, 4000) }
      if (res.status === 429 || /rate_limit_error|RATE_LIMITED/.test(text)) stop('RATE_LIMIT')
    } catch (e) { rec.error = String(e); stop('TRANSPORT_UNKNOWN') }
    rec.ms = Date.now() - started
    return rec
  }
  for (const item of c.cases) {
    if (meta.stop) break
    const dir = path.join(opts.out, item.id); fs.mkdirSync(dir, { recursive: true })
    const sid = crypto.randomUUID(), captured = [], pressed = new Set()
    const j = { id: item.id, scenario_id: sid, expected: item.expected, tuple_start: await stamp(item.id + ' start'), result: 'UNJUDGED', steps: [], unreached: [] }
    meta.cases.push(j)
    if (!tupleEqual(meta.tuple_start, j.tuple_start)) { stop('TUPLE_MOVED_BEFORE_CASE'); break }
    let last = null, n = 0, applied = false
    const send = async (kind, payload, role, stream = false) => {
      if (meta.stop) { j.unreached.push({ kind, why: meta.stop }); return null }
      if (meta.provider_entries + opts.reserve > opts.maxCalls) { stop('CALL_RESERVE_EXHAUSTED'); return null }
      meta.served = true; meta.outer_turn_requests++
      const before = last?.rd?.body ?? null, rec = await postTurn({ payload, stream, runDir: opts.out, where: item.id + ' ' + kind, identity })
      const pc = rec.response_body?._provider_calls
      if (!Array.isArray(pc)) stop('PROVIDER_ACCOUNTING_UNKNOWN')
      else { meta.provider_entries += pc.length; if (pc.length > opts.reserve || meta.provider_entries > opts.maxCalls) stop('DECLARED_RESERVE_OR_ALLOWANCE_EXCEEDED') }
      if (rec.status === 429 || rec.response_body?.error?.code === 'RATE_LIMITED') stop('RATE_LIMIT')
      if (rec.error || (stream && !rec.sse?.saw_complete)) stop('TRANSPORT_OR_STREAM_INCOMPLETE')
      if (fs.existsSync(path.join(opts.out, 'STOP-429.txt'))) stop('RATE_LIMIT')
      const rd = await readScenario(sid, opts.out, item.id + ' ' + kind, identity)
      if (rd.status !== 200 || fs.existsSync(path.join(opts.out, 'STOP-429.txt'))) stop(rd.status === 429 ? 'RATE_LIMIT' : 'READ_UNAVAILABLE_OR_RATE_LIMIT')
      const builds = [...new Set([rec.server_headers?.['x-olumi-service-build'], ...(Array.isArray(pc) ? pc : []).map((x) => x.cee_build)].filter(Boolean))]
      if (builds.some((x) => /^[a-f0-9]{40}$/.test(x) && x !== j.tuple_start.cee)) stop('CEE_BUILD_MISMATCH')
      const row = { n: ++n, kind, role, stamp: j.tuple_start, observed_cee_builds: builds, request: rec, read: rd, observed: observe(rd.body), analysis: automaticEvidence(rec, rd, before, role) }
      write(path.join(dir, String(n).padStart(2, '0') + '-' + kind + '.json'), row)
      j.steps.push({ n, kind, role, http: rec.status ?? null, provider_entries: Array.isArray(pc) ? pc.length : null, observation: row.observed, analysis: row.analysis })
      captured.push({ seq: n, request_body: payload, body: rec.response_body ?? null })
      last = { rec, rd }
      saveMeta(); return last
    }
    const typed = (message, extra = {}) => typedPayload({ scenarioId: sid, hasModel: !!last?.rd?.summary?.nodes, message, ...extra })
    const pressStage = async (tag, minIssuerSeq = 1) => {
      let any = false, attempts = 0
      for (let k = 0; k < c.max_presses_per_stage && !meta.stop; k++) {
        const cards = eligibleCards(captured, c.proposal_tools, pressed, minIssuerSeq)
        if (cards.length !== 1) { j.unreached.push({ kind: tag, why: cards.length ? 'AMBIGUOUS_OWN_CLAIM_CARDS' : 'NO_FRESH_OWN_CLAIM_CARD' }); break }
        const card = cards[0], offering = [...captured].reverse().find((x) => (x.body?._proposal_fields?.proposals ?? []).some((p) => p.proposal_id === card.proposal_id))
        const payload = pressPayload({ scenarioId: sid, body: offering?.body, proposalId: card.proposal_id })
        if (!payload) { j.unreached.push({ kind: tag, why: 'NO_BOUND_APPROVAL_PAYLOAD' }); break }
        pressed.add(card.proposal_id)
        attempts++
        const r = await send(tag + '-' + (k + 1), payload, 'card_press')
        const ok = r?.rec?.response_body?._agent?.tool_calls?.some((t) => t.name === 'authorise_change' && t.ok && t.mutated)
        any ||= !!ok
        if (!ok) break
      }
      if (attempts === c.max_presses_per_stage && eligibleCards(captured, c.proposal_tools, pressed, minIssuerSeq).length)
        j.unreached.push({ kind: tag, why: 'RUNNER_PRESS_LIMIT_REACHED; remaining cards untested, not a product refusal' })
      return any
    }
    const manualRun = async (tag) => {
      if (!last || meta.stop) return
      const control = runControl(last.rd.body)
      if (control.shown) await send(tag, runPayload({ scenarioId: sid }), 'manual_run_control')
      else j.unreached.push({ kind: tag, why: control.why, role: 'CONTROL_NOT_SENT' })
    }
    await send('brief', typed(item.brief), 'construction', true)
    if (last?.rd?.summary?.nodes) {
      await send('claim-offer', typed(item.offer), 'claim_request')
      applied = await pressStage('claim-press')
      await manualRun('baseline-run-control')
      if (item.correction && !meta.stop) {
        const before = last.rd.body, beforeObservation = observe(before)
        const versions = await api(sid, '/versions', { limit: 200 }); write(path.join(dir, 'versions-before-correction.json'), versions)
        const candidates = (versions.response_body?.versions ?? []).filter((v) => hex(v.full_hash) === hex(before.graph_identity_hash)).sort((a, b) => b.sequence - a.sequence)
        const priorVersion = candidates[0] ?? null
        const correctionSeq = captured.length + 1
        await send('correction-offer', typed(item.correction), 'correction_request')
        const corrected = await pressStage('correction-press', correctionSeq)
        await manualRun('post-correction-run-control')
        const restore = corrected && priorVersion ? restorePayload(priorVersion, last?.rd?.body) : null
        if (restore && !meta.stop) {
          const rec = await api(sid, '/versions/restore', restore), rd = await readScenario(sid, opts.out, item.id + ' restore', identity)
          const receipt = rec.response_body?.receipt, obs = observe(rd.body)
          const undo = { role: 'REAL_SERVER_VERSION_RESTORE', rec, read: rd, observed: obs,
            receipt_bound: rec.status === 200 && rec.response_body?.restored === true && receipt?.mutation_id === restore.mutation_id,
            full_identity_restored: hex(rd.body?.graph_identity_hash) === hex(before.graph_identity_hash),
            complete_claim_records_restored: isDeepStrictEqual(obs.claims, beforeObservation.claims),
            automatic_analysis: automaticEvidence(rec, rd, last?.rd?.body, 'server_restore'),
            ui_undo_click: 'NOT-REACHED (no browser); no local Undo is substituted' }
          write(path.join(dir, 'committed-undo.json'), undo); j.undo = undo
          last = { rec, rd }
          if (undo.receipt_bound) await manualRun('post-restore-run-control')
        } else j.unreached.push({ kind: 'committed-undo', why: corrected ? 'NO_VERSION_BOUND_TO_EXACT_PRE_CORRECTION_IDENTITY' : 'NO_CONFIRMED_CORRECTION_PRESS' })
      }
      if (!meta.stop) {
        const before = last.rd.body, session = 'sess_claims_' + crypto.randomUUID()
        const r = await send('cold-reopen', { ...typed(item.cold), agent_session_id: session }, 'server_cold_read')
        j.cold = { session: freshSessionVerdict({ sent: session, replySession: r?.rec?.response_body?._agent?.session_id, status: r?.rec?.status }),
          full_identity_unchanged: hex(before.graph_identity_hash) === hex(r?.rd?.body?.graph_identity_hash),
          complete_graph_unchanged: isDeepStrictEqual(before.graph, r?.rd?.body?.graph),
          no_reported_mutation: r?.rec?.response_body?._agent?.mutated === false, ui_cold_reopen: 'NOT-REACHED (server session only)' }
      }
    } else j.unreached.push({ kind: 'claim/analysis/restore/cold', why: 'NO_SAVED_MODEL_AFTER_BRIEF' })
    j.approval_reported = applied; j.tuple_end = await stamp(item.id + ' end'); j.tuple_stable = tupleEqual(j.tuple_start, j.tuple_end)
    if (!j.tuple_stable) { j.result = 'DIAGNOSIS'; stop('TUPLE_MOVED_OR_UNMEASURED') }
    write(path.join(dir, 'case.json'), j); saveMeta()
  }
  meta.ended = new Date().toISOString(); meta.tuple_end = await stamp('claim kit end')
  meta.elapsed_ms = Date.parse(meta.ended) - Date.parse(meta.started); meta.tuple_stable = tupleEqual(meta.tuple_start, meta.tuple_end)
  if (meta.stop || !meta.tuple_stable) meta.result = 'DIAGNOSIS_OR_INCOMPLETE'
  meta.not_started = c.cases.filter((x) => !meta.cases.some((j) => j.id === x.id)).map((x) => x.id)
  saveMeta(); return meta
}

async function main() {
  const args = process.argv.slice(2), arg = (k) => { const i = args.indexOf('--' + k); return i < 0 ? null : args[i + 1] }
  if (args.includes('--selfcheck')) { console.log(JSON.stringify(selfcheck(), null, 2)); return }
  const c = config(), out = arg('out') ?? path.join(here, 'claim-witness-offline')
  if (!args.includes('--execute')) { fs.mkdirSync(out, { recursive: true }); write(path.join(out, 'PLAN.json'), plan(c)); console.log('OFFLINE only; zero service/provider/credential access. ' + out); return }
  const result = await execute(c, { out, tokenFile: arg('token-file'), maxCalls: Number(arg('max-calls')), reserve: Number(arg('reserve-calls')) })
  console.log(JSON.stringify({ result: result.result, stop: result.stop, elapsed_ms: result.elapsed_ms, provider_entries: result.provider_entries, cases: result.cases.length, tuple_stable: result.tuple_stable }, null, 2))
  if (result.stop || result.tuple_stable !== true) process.exitCode = 2
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e.message); process.exitCode = 1 })
