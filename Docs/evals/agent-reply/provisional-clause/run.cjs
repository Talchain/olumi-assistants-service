// Separable-provisional explicit Run (paid search, served caf7d1a input): A = R stack, B = R + P sentence.
// Both arms get claim_permissions {leader_may_be_named:true, provisional:true} (the proposed permission). Only instructions differ.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
for (const k of Object.keys(process.env)) if (/ANTHROPIC|CLAUDE_API/i.test(k)) delete process.env[k];
const AQ = path.resolve(__dirname, '..', 'aqfmc'); const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const V1 = fs.readFileSync(path.join(AQ, 'stk/V1_fp3.txt'), 'utf8'); if (sha(V1) !== '06a876d3d4fa74cd37c7e75f1ec62952f4a8a01d892badb23538ea1526fba8af') throw new Error('R fp3 drift');
const ANCHOR = "never name a leader from it.";
const P = fs.readFileSync(path.join(__dirname, 'P-sentence.txt'), 'utf8').trim();
if (V1.split(ANCHOR).length !== 2) throw new Error('anchor not unique');
const STACK = { A: V1, B: V1.replace(ANCHOR, ANCHOR + ' ' + P) };
const req = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'captures/caf7d1a-paid-search/fp3-reconstructed.request.json'), 'utf8'));
const base = req.body ?? req; const last = base.input[base.input.length - 1]; const out = JSON.parse(last.output);
const cs = out.canonical_state; const lc = cs?.analysis_state?.leader_claim; const mode = cs?.analysis_ready?.analysis_admission?.permitted_analysis_mode;
if (!(lc?.permitted === true && lc?.separation === 'separated' && mode === 'quantified_provisional')) throw new Error('precondition: not separable provisional ' + JSON.stringify({ lc, mode }));
const { canonical_state, claim_permissions: _old, ...ran } = out;
last.output = JSON.stringify({ ...ran, claim_permissions: { leader_may_be_named: true, provisional: true, permitted_analysis_mode: mode }, canonical_state });
const SEND = process.argv.includes('--send');
console.log(JSON.stringify({ A: sha(STACK.A).slice(0, 12), B: sha(STACK.B).slice(0, 12), input_items: base.input.length, model: base.model, tool_choice: base.tool_choice }));
if (!SEND) { console.log('DRY'); process.exit(0); }
const env = fs.readFileSync('~/Documents/GitHub/olumi-assistants-service/.env', 'utf8'); const KEY = (env.match(/^OPENAI_API_KEY=(.*)$/m) || [])[1]?.replace(/["'\r\s]/g, '');
const real = globalThis.fetch; const ledger = []; globalThis.fetch = async (u, i) => { const ok = String(u) === 'https://api.openai.com/v1/responses'; ledger.push(ok); if (!ok) throw new Error('blocked'); return real(u, i); };
(async () => {
  fs.mkdirSync(path.join(__dirname, 'runs'), { recursive: true });
  for (let rep = 1; rep <= 4; rep++) for (const arm of rep % 2 ? ['A', 'B'] : ['B', 'A']) {
    const f = path.join(__dirname, 'runs', `${arm}.rep${rep}.json`); if (fs.existsSync(f)) continue;
    const b = { ...base, instructions: STACK[arm] }; const t0 = Date.now();
    const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify(b) });
    const j = await res.json(); const text = (j.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
    fs.writeFileSync(f, JSON.stringify({ arm, rep, http: res.status, ms: Date.now() - t0, usage: j.usage, instructions_sha: sha(STACK[arm]), text }, null, 1));
    console.log(arm, rep, res.status, text.split(/\s+/).length + 'w');
  }
  fs.writeFileSync(path.join(__dirname, 'LEDGER.json'), JSON.stringify({ calls: ledger.length, blocked: ledger.filter((x) => !x).length }));
})();
