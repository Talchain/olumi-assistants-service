// SERVED JOURNEY SCORER — one fresh OpenAI context per served turn; the same 12 criteria and 5 gates as
// AQ-FMC (shared text copied from judge.cjs). Case truth = the user's message + the served response's own
// state (draft_graph, analysis_state, analysis_ready, blocks, controls). Only the FULL visible reply exists
// on the served route (raw model text is not exposed), so only the FULL view is scored. DRY unless --send.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SEND = process.argv.includes('--send'); const ROOT = process.argv.find((a) => a.startsWith('--root='))?.slice(7);
if (!ROOT) throw new Error('usage: judge-served.cjs --root=<dir of journey dirs> [--send]');
const OPENAI_URL = 'https://api.openai.com/v1/responses', MAX_CALLS = 16;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const compact = (v, max) => { const s = JSON.stringify(v); return s.length <= max ? s : s.slice(0, max) + ` …[truncated ${s.length - max} chars]`; };
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
const SCHEMA_PAIR_UNUSED = {
  type: 'object', additionalProperties: false, required: ['A', 'B', 'preference', 'reason'],
  properties: {
    A: { type: 'object', additionalProperties: false, required: ['raw', 'full'], properties: { raw: LETTER_SCHEMA_VIEW, full: LETTER_SCHEMA_VIEW } },
    B: { type: 'object', additionalProperties: false, required: ['raw', 'full'], properties: { raw: LETTER_SCHEMA_VIEW, full: LETTER_SCHEMA_VIEW } },
    preference: { type: 'string', enum: ['A', 'B', 'none'] }, reason: { type: 'string' },
  },
};


const SERVED_SCHEMA = { type: 'object', additionalProperties: false, required: ['full', 'top_defect'], properties: { full: LETTER_SCHEMA_VIEW, top_defect: { type: 'string' } } };
const TURNS = ['construction', 'approve', 'explicit-run', 'challenge'];
const units = [];
for (const j of fs.readdirSync(ROOT).filter((d) => fs.statSync(path.join(ROOT, d)).isDirectory()).sort())
  for (const t of TURNS) { const f = path.join(ROOT, j, `${t}.response.json`); if (fs.existsSync(f)) units.push({ journey: j, turn: t, file: f }); }
if (units.length > MAX_CALLS) throw new Error(`too many units (${units.length} > ${MAX_CALLS})`);
function body(u) {
  const r = JSON.parse(fs.readFileSync(u.file, 'utf8')); const q = JSON.parse(fs.readFileSync(u.file.replace('.response.json', '.request.json'), 'utf8'));
  const controls = (r.suggested_actions || []).map((a) => ({ id: a.id, label: a.label ?? null, action_type: a.action_type ?? null }));
  const user = [
    `SERVED TURN (${u.turn}). THE USER SENT: ${q.message}${q.chip ? ` [via control ${JSON.stringify(q.chip)}]` : ''}`,
    `CASE TRUTH — the served response's own state after this turn (bind every claim to this; tool calls this turn: ${JSON.stringify((r._agent?.tool_calls || []).map((c) => ({ name: c.name, mutated: c.mutated, refusal: c.refusal ?? null })))}; first analysis: ${JSON.stringify(r._diagnostic_trace?.first_analysis ?? null)}):\n${compact({ draft_graph: r.draft_graph, analysis_state: r.analysis_state, analysis_ready: r.analysis_ready, blocks: r.blocks }, 60000)}`,
    `CONTROLS SHOWN WITH THE REPLY: ${JSON.stringify(controls)}`,
    `THE REPLY THE USER SAW (FULL visible text):\n<<<\n${r.assistant_text}\n>>>`,
    'Score ONLY the FULL view (there is no raw view for a served turn). Also name the single most important defect in one sentence (or "none").',
  ].join('\n\n');
  return { model: 'gpt-5.6-terra', instructions: RUBRIC, input: [{ role: 'user', content: user }], text: { format: { type: 'json_schema', name: 'served_turn_score', schema: SERVED_SCHEMA, strict: true } }, max_output_tokens: 16000 };
}
(async () => {
  console.log(JSON.stringify({ units: units.map((u) => `${u.journey}/${u.turn}`) }));
  if (!SEND) { console.log('DRY RUN'); return; }
  for (const k of Object.keys(process.env)) if (/ANTHROPIC|CLAUDE_API/i.test(k)) delete process.env[k];
  const env = fs.readFileSync('~/Documents/GitHub/olumi-assistants-service/.env', 'utf8');
  const KEY = (env.match(/^OPENAI_API_KEY=(.*)$/m) || [])[1]?.replace(/["'\r\s]/g, ''); if (!KEY) throw new Error('no key');
  const real = globalThis.fetch; const ledger = [];
  globalThis.fetch = async (url, init) => { const ok = String(url) === OPENAI_URL; ledger.push({ url: String(url), ok }); if (!ok) throw new Error('blocked ' + url); return real(url, init); };
  const out = [];
  for (const u of units) {
    const f = path.join(ROOT, u.journey, `${u.turn}.score.json`); if (fs.existsSync(f)) { out.push(JSON.parse(fs.readFileSync(f, 'utf8'))); continue; }
    const b = body(u); const t0 = Date.now(); const res = await fetch(OPENAI_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify(b) });
    const json = await res.json(); const text = (json.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
    let s = null; try { s = JSON.parse(text); } catch {}
    const rec = { journey: u.journey, turn: u.turn, http: res.status, ms: Date.now() - t0, usage: json.usage ?? null, total: s ? Object.values(s.full.scores).reduce((a, b) => a + b, 0) : null, fails: s ? Object.entries(s.full.gates).filter(([, g]) => g === 'FAIL').map(([g]) => g) : null, top_defect: s?.top_defect ?? null, score: s };
    fs.writeFileSync(f, JSON.stringify(rec, null, 1)); out.push(rec);
    console.log(`${u.journey}/${u.turn} ${res.status} ${rec.total}/24 fails=${JSON.stringify(rec.fails)} :: ${String(rec.top_defect).slice(0, 200)}`);
  }
  fs.writeFileSync(path.join(ROOT, 'SERVED-SCORES.json'), JSON.stringify({ calls: ledger.length, blocked: ledger.filter((l) => !l.ok).length, out }, null, 1));
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
