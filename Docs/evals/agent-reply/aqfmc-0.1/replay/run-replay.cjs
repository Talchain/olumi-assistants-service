// AQ-FMC-0.1 paired FINAL-HOP replay: R vs F on the captured reply-writing request of each state.
// ONLY `instructions` differs (asserted: diff == ['instructions'], key order equal, restSha equal, and
// F == R with the one terminal literal replaced, both bound to BINDING.json). Ported from
// tools/agent-reply-eval/paired/run-paired.ts (buildArmBody, mulberry32 schedule, fetch guard, outcome).
// DRY BY DEFAULT: it sends nothing unless `--send` is passed. OpenAI only; Anthropic env removed.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const AQ = path.resolve(__dirname, '..'), CAPS = path.join(AQ, 'captures'), OUT = path.join(AQ, 'replays');
const SEND = process.argv.includes('--send');
const ONLY = (process.argv.find((a) => a.startsWith('--states=')) || '').slice(9).split(',').filter(Boolean);
const PHASE = ONLY.length ? ONLY.join('+') : 'all';
const PAIRED_CAP = 80, REPS = 3, SEEDS = [25092501, 25092502, 25092503];
const OPENAI_URL = 'https://api.openai.com/v1/responses';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const restShaOf = (b) => { const { instructions: _i, ...r } = b; return sha(JSON.stringify(canon(r))); };

// ── Stacks: R and F cores derived from the bound FP3 stacks, then checked against BINDING ──
const B = JSON.parse(fs.readFileSync(path.join(AQ, 'BINDING.json'), 'utf8'));
const V1 = fs.readFileSync(path.join(AQ, 'stk/V1_fp3.txt'), 'utf8'), V2 = fs.readFileSync(path.join(AQ, 'stk/V2_fp3.txt'), 'utf8');
if (sha(V1) !== B.R_fp3 || sha(V2) !== B.F_fp3) throw new Error('FP3 stacks do not match BINDING');
let n = 0; while (n < V1.length && V1[V1.length - 1 - n] === V2[V2.length - 1 - n]) n += 1;
const suffixAt = V1.length - n + V1.slice(V1.length - n).indexOf('\n\n');
const SUFFIX = V1.slice(suffixAt);
const R_CORE = V1.slice(0, suffixAt), F_CORE = V2.slice(0, V2.length - SUFFIX.length);
if (sha(R_CORE) !== B.R_core || sha(F_CORE) !== B.F_core) throw new Error(`cores do not match BINDING: R ${sha(R_CORE).slice(0, 8)} F ${sha(F_CORE).slice(0, 8)}`);
const F_LIT = fs.readFileSync(path.join(AQ, 'F-literal.txt'), 'utf8');
if (sha(F_LIT) !== B.candidate_literal) throw new Error('F literal does not match BINDING');
const R_LIT = 'British English. Lead with one short sentence, then up to three short bullets when they help. Keep replies to up to about 90 words by default; go longer when the user asks (for example for ideas), or when approval figures and what they rest on, a material uncertainty, an exclusion or a failure need it. Keep any caveat that changes what the result means. Name one next move only when a tool result or the model state supports it, and ask at most one question, only when its answer would change the model. Do not repeat the model, internal calculations or a list of open questions, and do not mention a button or control unless a tool result said it exists.';
if (!R_CORE.endsWith(R_LIT) || R_CORE.split(R_LIT).length !== 2) throw new Error('R core does not end with the one expected v2 literal');
if (R_CORE.slice(0, -R_LIT.length) + F_LIT !== F_CORE) throw new Error('F core is not R core with only the terminal literal replaced');

// ── Cases: every CAPTURED R final hop that ended on text ──
const unwrap = (j) => (j && typeof j.body === 'object' && j.body !== null && 'input' in j.body ? j.body : j);
function loadCases() {
  const cases = [], skipped = [];
  const rDir = path.join(CAPS, 'R');
  for (const state of fs.existsSync(rDir) ? fs.readdirSync(rDir).sort() : []) {
    const fh = path.join(rDir, state, 'final-hop.json');
    if (!fs.existsSync(fh)) { skipped.push({ state, reason: 'no final-hop.json' }); continue; }
    const f = JSON.parse(fs.readFileSync(fh, 'utf8'));
    const idx = f.index ?? f.final_hop_index ?? f.call_index;
    const reqPath = f.request_path ?? f.path ?? path.join(rDir, state, 'llm-calls', `${String(idx).padStart(2, '0')}.request.json`);
    const abs = path.isAbsolute(reqPath) ? reqPath : path.join(rDir, state, reqPath);
    if (!fs.existsSync(abs)) { skipped.push({ state, reason: `final-hop request missing: ${abs}` }); continue; }
    if (f.ended_on === 'tool_only' || f.ended_on_text === false || f.text_reply === false) { skipped.push({ state, reason: 'turn ended on a tool call only (not a completed reply)' }); continue; }
    if (f.turn_completed_reply === false || f.index == null) { skipped.push({ state, reason: `no completed reply (turn_ended_on ${f.turn_ended_on ?? '?'})` }); continue; }
    if (f.is_last_conversation_call === false) { skipped.push({ state, reason: 'the text-bearing call is not the last conversation call of the turn' }); continue; }
    const body = unwrap(JSON.parse(fs.readFileSync(abs, 'utf8')));
    if (typeof body.instructions !== 'string') { skipped.push({ state, reason: 'captured body has no string instructions' }); continue; }
    if (sha(body.instructions) !== B.R_core) { skipped.push({ state, reason: `final-hop instructions sha ${sha(body.instructions).slice(0, 12)} != R_core (not the reply-writing Agent call at R)` }); continue; }
    if (ONLY.length && !ONLY.includes(state)) { skipped.push({ state, reason: 'not in this phase' }); continue; }
    if (f.restSha && f.restSha !== restShaOf(body)) { skipped.push({ state, reason: `restSha mismatch with the capture's own (${f.restSha.slice(0, 12)})` }); continue; }
    cases.push({ state, requestFile: abs, body });
  }
  return { cases, skipped };
}

function buildArm(captured, arm) {
  const instructions = arm === 'R' ? captured.instructions : F_CORE;
  const body = { ...captured, instructions };
  const keys = [...new Set([...Object.keys(captured), ...Object.keys(body)])];
  const diff = keys.filter((k) => JSON.stringify(captured[k]) !== JSON.stringify(body[k]));
  const keyOrderEqual = JSON.stringify(Object.keys(captured)) === JSON.stringify(Object.keys(body));
  return { body, diff, keyOrderEqual, restSha: restShaOf(body) };
}

function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function schedule(states) {
  const out = [];
  SEEDS.forEach((seed, i) => {
    const rnd = mulberry32(seed); const a = [...states];
    for (let k = a.length - 1; k > 0; k -= 1) { const j = Math.floor(rnd() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
    for (const s of a) { const order = rnd() < 0.5 ? ['R', 'F'] : ['F', 'R']; for (const arm of order) out.push({ state: s, arm, rep: i + 1, seed }); }
  });
  return out;
}

function outcome(parsed) {
  let text = ''; const fns = [], refusals = [];
  for (const o of Array.isArray(parsed?.output) ? parsed.output : []) {
    if (o?.type === 'message') for (const c of Array.isArray(o.content) ? o.content : []) { if (c?.type === 'output_text') text += String(c.text ?? ''); else if (c?.type === 'refusal') refusals.push(String(c.refusal ?? '')); }
    else if (o?.type === 'function_call') fns.push({ name: String(o.name), call_id: o.call_id ?? null, arguments: o.arguments });
  }
  const type = parsed == null ? 'error' : text && fns.length ? 'text+function_call' : fns.length ? 'function_call' : text ? 'text' : refusals.length ? 'refusal' : 'empty';
  return { type, text, function_calls: fns, refusals, status: parsed?.status ?? null, incomplete_details: parsed?.incomplete_details ?? null };
}

(async () => {
  const { cases, skipped } = loadCases();
  const plan = schedule(cases.map((c) => c.state));
  const checks = cases.map((c) => {
    const r = buildArm(c.body, 'R'), f = buildArm(c.body, 'F');
    const ok = r.diff.length === 0 && JSON.stringify(f.diff) === '["instructions"]' && f.keyOrderEqual && r.restSha === f.restSha && sha(f.body.instructions) === B.F_core;
    return { state: c.state, requestFile: c.requestFile, ok, R_diff: r.diff, F_diff: f.diff, keyOrderEqual: f.keyOrderEqual, restSha: [r.restSha, f.restSha], model: c.body.model, reasoning: c.body.reasoning ?? null, max_output_tokens: c.body.max_output_tokens ?? null, tools: (c.body.tools ?? []).length, tool_choice: c.body.tool_choice ?? null, seed_in_request: c.body.seed ?? null, input_items: (c.body.input ?? []).length };
  });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `PLAN-${PHASE}.json`), JSON.stringify({ binding: B, R_literal_sha: sha(R_LIT), F_literal_sha: sha(F_LIT), cases: checks, skipped, schedule: plan, planned_calls: plan.length, paired_cap: PAIRED_CAP }, null, 1));
  console.log(JSON.stringify({ cases: checks.map((c) => ({ state: c.state, ok: c.ok, restSha: c.restSha[0].slice(0, 12), items: c.input_items, tools: c.tools, model: c.model })), skipped, planned_calls: plan.length }, null, 1));
  if (checks.some((c) => !c.ok)) throw new Error('matched-request assertion failed; nothing sent');
  if (plan.length > PAIRED_CAP) throw new Error('plan exceeds the paired cap');
  if (!SEND) { console.log('DRY RUN: nothing sent (pass --send)'); return; }

  for (const k of Object.keys(process.env)) if (/ANTHROPIC|CLAUDE_API/i.test(k)) delete process.env[k];
  const env = fs.readFileSync('~/Documents/GitHub/olumi-assistants-service/.env', 'utf8');
  const KEY = (env.match(/^OPENAI_API_KEY=(.*)$/m) || [])[1]?.replace(/["'\r\s]/g, '');
  if (!KEY) throw new Error('no OPENAI_API_KEY');
  const realFetch = globalThis.fetch; const ledger = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url); const ok = u === OPENAI_URL; ledger.push({ at: new Date().toISOString(), url: u, allowed: ok });
    if (!ok) throw new Error('network guard: blocked ' + u);
    if (Object.keys(process.env).some((x) => /ANTHROPIC|CLAUDE_API/i.test(x))) throw new Error('anthropic env present');
    return realFetch(url, init);
  };
  let attempts = 0;
  const byState = Object.fromEntries(cases.map((c) => [c.state, c]));
  for (const u of plan) {
    const id = `${u.state}.${u.arm}.rep${u.rep}`; const file = path.join(OUT, id + '.json');
    if (fs.existsSync(file)) { console.log('RESUME', id); continue; }
    const { body } = buildArm(byState[u.state].body, u.arm); const payload = JSON.stringify(body);
    let res, json = null, raw = '', ms = 0, transportError = null, tries = 0;
    for (;;) {
      if (attempts >= PAIRED_CAP) throw new Error('paired cap reached');
      attempts += 1; tries += 1; transportError = null; const t0 = Date.now();
      try { res = await fetch(OPENAI_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: payload }); raw = await res.text(); ms = Date.now() - t0; try { json = JSON.parse(raw); } catch { json = null; } }
      catch (e) { ms = Date.now() - t0; transportError = String(e.message || e); }
      const transport = transportError !== null || (res && (res.status >= 500 || res.status === 429));
      if (!transport || tries >= 2) break;
      console.log('TRANSPORT RETRY', id, transportError ?? res.status);
    }
    const o = outcome(json);
    fs.writeFileSync(file, JSON.stringify({
      id, state: u.state, arm: u.arm, rep: u.rep, order_seed: u.seed, tries, at: new Date().toISOString(),
      http: res?.status ?? null, transport_error: transportError, latency_ms: ms,
      request: { url: OPENAI_URL, authorization: '[REDACTED]', sha256: sha(payload), instructions_sha256: sha(body.instructions), rest_sha256: restShaOf(body), body },
      response_sha256: sha(raw), response_id: json?.id ?? null, model: json?.model ?? null, usage: json?.usage ?? null, response: json ?? raw,
      outcome: o, words: o.text.trim() ? o.text.trim().split(/\s+/).length : 0,
    }, null, 1));
    console.log(id, res?.status ?? transportError, ms + 'ms', o.type, (o.text.trim().split(/\s+/).filter(Boolean).length) + 'w', 'cached', json?.usage?.input_tokens_details?.cached_tokens ?? '?');
  }
  fs.writeFileSync(path.join(OUT, `LEDGER-${PHASE}.json`), JSON.stringify({ attempts, calls: ledger.length, blocked: ledger.filter((l) => !l.allowed).length, hosts: [...new Set(ledger.map((l) => new URL(l.url).host))], anthropic_env_absent_at_end: !Object.keys(process.env).some((k) => /ANTHROPIC|CLAUDE_API/i.test(k)), ledger }, null, 1));
  console.log('DONE attempts', attempts);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
