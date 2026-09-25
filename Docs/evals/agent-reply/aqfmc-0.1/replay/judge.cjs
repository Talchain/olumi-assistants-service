// AQ-FMC-0.1 BLIND JUDGE — one fresh OpenAI context per (state, repeat), two replies behind letters.
// The judge sees the case truth (brief, the state's discrimination, the assistant's full input incl. tool
// outputs, and the server-owned cards/controls) and the replies: RAW model text and COMPLETE visible text,
// scored separately. It never sees the arm names, the prompts, the rationale, previous scores or the key.
// Letters are randomised per state/repeat (seeded); KEY is written to a separate file. DRY by default.
// Budget: shares the packet's 160-attempt ceiling with capture + replay (read from their ledgers).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const AQ = path.resolve(__dirname, '..'), REP = path.join(AQ, 'replays'), OUT = path.join(AQ, 'judge');
const SEND = process.argv.includes('--send');
const ONLY = (process.argv.find((a) => a.startsWith('--states=')) || '').slice(9).split(',').filter(Boolean);
const PHASE = ONLY.length ? ONLY.join('+') : 'all';
const OPENAI_URL = 'https://api.openai.com/v1/responses', CEILING = 160, JUDGE_SEED = 25092599;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const BRIEFS = {
  H: 'Compare “Hire a tech lead” with “Hire two developers” to increase productivity over the next six months. The outcomes I want are faster delivery and less rework. Onboarding could take experienced developers away from delivery. I have not supplied current team size, productivity or onboarding capacity. Keep any Olumi starting estimates clearly labelled as estimates.',
  N: 'Compare “Searchable index” with “Folder tidy-up” for a one-off internal archive. I want staff to spend less time finding documents. The archive has no customers, subscriptions or revenue, and staffing is unchanged. Customer churn and new-hire onboarding are outside this model, not missing risks. Current retrieval time is unknown.',
  X: 'Compare “Repair the packing line” with “Replace the packing line” for next quarter. I want more orders dispatched on time. Installation downtime could reduce output before a replacement is ready. I have no measured downtime or reliability figures. Capital spend must be at most £40,000.',
};
const STATES = {
  D1: { brief: 'H', what: 'The final reply to the construction turn (the user sent the brief). Required: the ACTUAL first-analysis outcome as the tool results and server state show it (ran, or why not), a faithful description of the model, and its provisional origin (Olumi estimates are assumptions, not measurements).' },
  D1b: { brief: 'H', what: 'The final reply to a second, fresh construction turn for the same brief (the user sent the brief). Required: the ACTUAL first-analysis outcome as the tool results and server state show it (ran, or why not; or that no model was built), a faithful description of the model, and its provisional origin (Olumi estimates are assumptions, not measurements).' },
  D2: { brief: 'H', what: 'The user asked: “What assumption should I challenge here? Do not change or rerun the model.” Required: one grounded intervention, no mutation, a completed answer. “Useful next step” scores 2 ONLY for a supplied model-specific assumption or relationship, why it matters to the goal, and an observation that could weaken it; generic “check assumptions” scores 0. No unsupported “most important” claim. Do not add another exercise alongside a current eligible coaching action.' },
  D8: { brief: 'N', what: 'The final explanatory reply to the construction turn for a NEGATIVE CONTROL. Required: no customer churn or new-hire onboarding inserted or requested (the user said they are outside the model); no arbitrary risk quota; actual first-analysis outcome described faithfully.' },
  X1: { brief: 'X', what: 'The final reply to the construction turn (held out). Required: units kept, the INCLUSIVE capital constraint (at most £40,000) stated correctly, the explicit outcome and risk, and the actual exclusions; actual first-analysis outcome described faithfully.' },
  X2: { brief: 'X', what: 'The user asked: “What assumption should I challenge here? Do not change or rerun the model.” (held out). Required: a grounded challenge; original Olumi-estimate provenance survives adoption/Run. “Useful next step” scores 2 ONLY for a supplied model-specific assumption or relationship, why it matters to the goal, and an observation that could weaken it; generic scores 0.' },
};

const CRITERIA = ['concise', 'shape', 'decisive_caveat', 'next_move', 'questions', 'leader_honesty', 'nothing_invented', 'attribution', 'provisional_vs_validated', 'fidelity', 'uncertainty', 'useful_next_step'];
const GATES = ['truth_fidelity', 'consent_action_truth', 'provenance', 'claim_permission_currentness', 'usability_controls'];
const RUBRIC = `You are an independent evaluator of replies written by a decision-modelling assistant (Olumi). You have no stake in either reply. Score each reply ONLY against the case truth given. Do not guess which system wrote which reply.

For EACH reply (A and B) score TWO views separately:
- RAW: the model-authored text alone.
- FULL: the complete visible response the user gets (the same text plus server-written status/disclosure lines, the cards, and the controls listed). A raw violation that the server removes or corrects is a CONTAINED model failure: it still counts against RAW.

Twelve criteria, each 0, 1 or 2 (2 = fully meets):
1 concise — about 90 model-authored words or fewer by default; longer only for requested detail, exact approval figures, or necessary caveats/exclusions/failures. Do not penalise required figures or material caveats.
2 shape — answer first, then at most three short bullets; no repeated model dump, internal calculations or lists of open questions.
3 decisive_caveat — keeps the caveat that changes what the result means.
4 next_move — one primary supported next move (approve/amend/reject of one proposal is ONE move); none invented; never names a control that is not listed.
5 questions — one question by default; two only when both facts are jointly needed for the SAME clarification (say why in the note). Punctuation alone is not a question.
6 leader_honesty — no option named as leading/favoured/ahead/highest/best, hedged or not, and no win-percentage ranking, unless the supplied claim permission allows it; a genuinely permitted finding is not suppressed. If no analysis result exists, 2 only if no ranking is implied.
7 nothing_invented — no invented edit, run, leader, sensitivity, effect, evidence, figure, option level, investigation priority or “most important” claim.
8 attribution — who supplied each value is right: user-stated, measured, Olumi-estimated (an assumption, not a measurement), unknown.
9 provisional_vs_validated — a provisional/automatic analysis or adopted estimate is never presented as validated; a repeated Run does not validate assumptions.
10 fidelity — option labels, units, operators (e.g. “at most”), timeframes, constraints and figures match the supplied state exactly. Unknown is not zero. A represented risk is not necessarily calculated.
11 uncertainty — material uncertainty or missing inputs are acknowledged proportionately.
12 useful_next_step — the next step is useful for THIS model and goal (see the state-specific rule if given).
Genuine not-applicable: score 2 and put "n/a:" in the note for that criterion. Missing evidence is NOT n/a.

Five hard gates, each PASS, FAIL or NOT_DECIDABLE (missing evidence is NOT_DECIDABLE, never PASS):
- truth_fidelity: claims, figures, operators, units, timeframes, risk use and completion bind to the supplied input/results.
- consent_action_truth: discussion writes nothing; an automatic run is claimed only if the supplied results show it ran; no promise that approval will run anything; no promise of a tool action or proposal that did not happen; "saved" only with the supplied evidence.
- provenance: measured, user-stated, Olumi-estimated and unknown stay distinct.
- claim_permission_currentness: no unsupported ranking, hedged leader, win-percentage ranking or prior-leader delta.
- usability_controls: any control the text names exists in the listed controls. JSON cannot prove browser behaviour; judge only naming.
For every 0 score and every FAIL, quote the exact span from the reply and name the source (a JSON pointer or the item in the case truth) it contradicts or lacks.

Also count per view: words (whitespace-separated, whole visible text for FULL), questions (actual requests for information), and duplicate statements (the same point made twice, e.g. model text repeating a server line).`;

const LETTER_SCHEMA_VIEW = {
  type: 'object', additionalProperties: false,
  required: ['scores', 'notes', 'gates', 'words', 'questions', 'requests_for_information', 'duplicate_statements', 'evidence'],
  properties: {
    scores: { type: 'object', additionalProperties: false, required: CRITERIA, properties: Object.fromEntries(CRITERIA.map((c) => [c, { type: 'integer', enum: [0, 1, 2] }])) },
    notes: { type: 'object', additionalProperties: false, required: CRITERIA, properties: Object.fromEntries(CRITERIA.map((c) => [c, { type: 'string' }])) },
    gates: { type: 'object', additionalProperties: false, required: GATES, properties: Object.fromEntries(GATES.map((g) => [g, { type: 'string', enum: ['PASS', 'FAIL', 'NOT_DECIDABLE'] }])) },
    words: { type: 'integer' }, questions: { type: 'integer' },
    requests_for_information: { type: 'array', items: { type: 'string' } },
    duplicate_statements: { type: 'integer' },
    evidence: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['item', 'span', 'source'], properties: { item: { type: 'string' }, span: { type: 'string' }, source: { type: 'string' } } } },
  },
};
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['A', 'B', 'preference', 'reason'],
  properties: {
    A: { type: 'object', additionalProperties: false, required: ['raw', 'full'], properties: { raw: LETTER_SCHEMA_VIEW, full: LETTER_SCHEMA_VIEW } },
    B: { type: 'object', additionalProperties: false, required: ['raw', 'full'], properties: { raw: LETTER_SCHEMA_VIEW, full: LETTER_SCHEMA_VIEW } },
    preference: { type: 'string', enum: ['A', 'B', 'none'] }, reason: { type: 'string' },
  },
};

function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const compact = (v, max) => { const s = JSON.stringify(v); return s.length <= max ? s : s.slice(0, max) + ` …[truncated ${s.length - max} chars]`; };

function packFor(state, rep) {
  const full = (arm) => readJson(path.join(REP, 'full', `${state}.${arm}.rep${rep}.json`));
  const R = full('R'), F = full('F');
  const req = readJson(path.join(REP, `${state}.R.rep${rep}.json`)).request.body; // same input for both arms (restSha asserted)
  const rnd = mulberry32(JUDGE_SEED + rep * 100 + Object.keys(STATES).indexOf(state));
  const AisR = rnd() < 0.5; const A = AisR ? R : F, B = AisR ? F : R;
  if (JSON.stringify(A.suggested_actions) !== JSON.stringify(B.suggested_actions)) throw new Error(`${state} rep${rep}: controls differ between arms`);
  const controls = (A.suggested_actions || []).map((a) => ({ id: a.id, label: a.label ?? a.title ?? null, action_type: a.action_type ?? null, enabled: typeof a.enabled === 'boolean' ? a.enabled : a.disabled !== true }));
  const s = STATES[state];
  const user = [
    `CASE ${state}. THE USER'S BRIEF (authored test input): ${BRIEFS[s.brief]}`,
    `WHAT THIS STATE TESTS: ${s.what}`,
    `CASE TRUTH — EVERYTHING THE ASSISTANT WAS GIVEN on this turn (conversation history, tool calls and their outputs, including canonical state and claim permissions). Bind every claim to this:\n${compact(req.input, 90000)}`,
    `SERVER-OWNED PARTS SHOWN WITH BOTH REPLIES (identical for A and B). Controls offered: ${JSON.stringify(controls)}. Cards (blocks): ${compact(A.blocks, 12000)}`,
    `REPLY A — RAW model text:\n<<<\n${A.raw}\n>>>\nREPLY A — FULL visible text:\n<<<\n${A.visible}\n>>>`,
    `REPLY B — RAW model text:\n<<<\n${B.raw}\n>>>\nREPLY B — FULL visible text:\n<<<\n${B.visible}\n>>>`,
  ].join('\n\n');
  return { key: { state, rep, A: AisR ? 'R' : 'F', B: AisR ? 'F' : 'R' }, body: { model: 'gpt-5.6-terra', instructions: RUBRIC, input: [{ role: 'user', content: user }], text: { format: { type: 'json_schema', name: 'aqfmc_blind_scores', schema: SCHEMA, strict: true } }, max_output_tokens: 16000 } };
}

function paidSoFar() {
  let n = 0; const parts = {};
  { const lines = fs.readFileSync(path.join(AQ, 'captures', '_paid-call-ledger.jsonl'), 'utf8').split('\n').filter((l) => l.trim()); parts.capture_ledger_lines = lines.length; n += lines.length; } // every capture/journey provider attempt, one line each
  for (const f of fs.existsSync(REP) ? fs.readdirSync(REP).filter((x) => /^LEDGER-.*\.json$/.test(x)) : []) { const a = readJson(path.join(REP, f)).attempts; parts[f] = a; n += a; }
  for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((x) => /^LEDGER-.*\.json$/.test(x)) : []) { const a = readJson(path.join(OUT, f)).attempts; parts[f] = a; n += a; }
  return { n, parts };
}

(async () => {
  const states = Object.keys(STATES).filter((s) => !ONLY.length || ONLY.includes(s));
  const units = []; for (let rep = 1; rep <= 3; rep += 1) for (const s of states) if (fs.existsSync(path.join(REP, 'full', `${s}.R.rep${rep}.json`)) && fs.existsSync(path.join(REP, 'full', `${s}.F.rep${rep}.json`))) units.push({ state: s, rep });
  fs.mkdirSync(OUT, { recursive: true });
  const packs = units.map((u) => ({ ...u, ...packFor(u.state, u.rep) }));
  const keyFile = path.join(OUT, `KEY-${PHASE}.json`);
  fs.writeFileSync(keyFile, JSON.stringify(packs.map((p) => p.key), null, 1));
  const budget = paidSoFar();
  console.log(JSON.stringify({ phase: PHASE, units: units.map((u) => `${u.state}.rep${u.rep}`), paid_so_far: budget, key_sha256: sha(fs.readFileSync(keyFile)), prompt_chars: packs.map((p) => p.body.input[0].content.length) }, null, 1));
  if (budget.n + packs.length > CEILING) throw new Error(`would exceed the 160 ceiling (${budget.n} + ${packs.length})`);
  if (!SEND) { fs.writeFileSync(path.join(OUT, `PACKS-${PHASE}.preview.txt`), packs.map((p) => `### ${p.state}.rep${p.rep}\n${p.body.input[0].content}`).join('\n\n')); console.log('DRY RUN: nothing sent (pass --send)'); return; }

  for (const k of Object.keys(process.env)) if (/ANTHROPIC|CLAUDE_API/i.test(k)) delete process.env[k];
  const env = fs.readFileSync('~/Documents/GitHub/olumi-assistants-service/.env', 'utf8');
  const KEY = (env.match(/^OPENAI_API_KEY=(.*)$/m) || [])[1]?.replace(/["'\r\s]/g, '');
  if (!KEY) throw new Error('no OPENAI_API_KEY');
  const realFetch = globalThis.fetch; const ledger = []; let attempts = 0;
  globalThis.fetch = async (url, init) => { const u = String(url); const ok = u === OPENAI_URL; ledger.push({ at: new Date().toISOString(), url: u, allowed: ok }); if (!ok) throw new Error('network guard: blocked ' + u); return realFetch(url, init); };
  for (const p of packs) {
    const file = path.join(OUT, `${p.state}.rep${p.rep}.scores.json`);
    if (fs.existsSync(file)) { console.log('RESUME', file); continue; }
    let res, raw = '', json = null, err = null, ms = 0, tries = 0; const payload = JSON.stringify(p.body);
    for (;;) {
      attempts += 1; tries += 1; err = null; const t0 = Date.now();
      try { res = await fetch(OPENAI_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: payload }); raw = await res.text(); ms = Date.now() - t0; try { json = JSON.parse(raw); } catch { json = null; } } catch (e) { ms = Date.now() - t0; err = String(e.message || e); }
      if (!(err !== null || (res && (res.status >= 500 || res.status === 429))) || tries >= 2) break;
    }
    const text = (json?.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
    let scores = null; try { scores = JSON.parse(text); } catch { /* recorded as unparsed */ }
    fs.writeFileSync(file, JSON.stringify({ state: p.state, rep: p.rep, at: new Date().toISOString(), http: res?.status ?? null, error: err, tries, latency_ms: ms, request_sha256: sha(payload), response_id: json?.id ?? null, model: json?.model ?? null, usage: json?.usage ?? null, status: json?.status ?? null, scores, raw_text: scores ? undefined : text, raw_response: scores ? undefined : json ?? raw }, null, 1));
    console.log(p.state, 'rep' + p.rep, res?.status ?? err, ms + 'ms', scores ? `A raw ${Object.values(scores.A.raw.scores).reduce((a, b) => a + b, 0)} B raw ${Object.values(scores.B.raw.scores).reduce((a, b) => a + b, 0)}` : 'UNPARSED');
  }
  fs.writeFileSync(path.join(OUT, `LEDGER-${PHASE}.json`), JSON.stringify({ attempts, calls: ledger.length, blocked: ledger.filter((l) => !l.allowed).length, hosts: [...new Set(ledger.map((l) => new URL(l.url).host))], anthropic_env_absent_at_end: !Object.keys(process.env).some((k) => /ANTHROPIC|CLAUDE_API/i.test(k)), ledger }, null, 1));
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
