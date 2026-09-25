// Repair-fidelity A/B on 8 served e39f6e0 explicit Runs (reconstructed FP3, what_is_missing = the run's own summary).
// A = R (served stack, #1866), B = R + Q appended after the leader entry's last sentence. Only instructions differ.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
for (const k of Object.keys(process.env)) if (/ANTHROPIC|CLAUDE_API/i.test(k)) delete process.env[k];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const V1 = fs.readFileSync(path.resolve(__dirname, '../aqfmc/stk/V1_fp3.txt'), 'utf8'); if (sha(V1) !== '06a876d3d4fa74cd37c7e75f1ec62952f4a8a01d892badb23538ea1526fba8af') throw new Error('R drift');
const ANCHOR = 'say that this uncertainty is itself the finding.'; if (V1.split(ANCHOR).length !== 2) throw new Error('anchor');
const Q = fs.readFileSync(path.join(__dirname, 'Q-sentence.txt'), 'utf8').trim();
const Q2 = fs.readFileSync(path.join(__dirname, 'Q2-sentence.txt'), 'utf8').trim();
const STACK = { A: V1, B: V1.replace(ANCHOR, ANCHOR + ' ' + Q), C: V1.replace(ANCHOR, ANCHOR + ' ' + Q2) };
const ARMS = (process.argv.find((a) => a.startsWith('--arms='))?.slice(7) || 'A,B').split(',');
const ROOT = path.resolve(__dirname, '../served-leak/e39f6e0'); const STATES = ['eng-hiring-3', 'eng-hiring-4', 'eng-hiring-5', 'eng-hiring-6', 'pricing-1', 'pricing-3', 'pricing-4', 'pricing-5'];
const bodyOf = (s) => { const d = JSON.parse(fs.readFileSync(path.join(ROOT, s, 'fp3-reconstructed.request.json'), 'utf8')); return d.body ?? d; };
const SEND = process.argv.includes('--send');
console.log(JSON.stringify({ A: sha(STACK.A).slice(0, 12), B: sha(STACK.B).slice(0, 12), C: sha(STACK.C).slice(0, 12), arms: ARMS, states: STATES.length }));
if (!SEND) process.exit(0);
const env = fs.readFileSync('~/Documents/GitHub/olumi-assistants-service/.env', 'utf8'); const KEY = (env.match(/^OPENAI_API_KEY=(.*)$/m) || [])[1]?.replace(/["'\r\s]/g, '');
const real = globalThis.fetch; let calls = 0, blocked = 0; globalThis.fetch = async (u, i) => { calls++; if (String(u) !== 'https://api.openai.com/v1/responses') { blocked++; throw new Error('blocked'); } return real(u, i); };
(async () => {
  fs.mkdirSync(path.join(__dirname, 'runs'), { recursive: true });
  for (let rep = 1; rep <= 2; rep++) for (const s of STATES) for (const arm of ARMS) {
    const f = path.join(__dirname, 'runs', `${s}.${arm}.rep${rep}.json`); if (fs.existsSync(f)) continue;
    const b = { ...bodyOf(s), instructions: STACK[arm] }; const t0 = Date.now();
    const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify(b) });
    const j = await res.json(); const text = (j.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
    fs.writeFileSync(f, JSON.stringify({ state: s, arm, rep, http: res.status, ms: Date.now() - t0, usage: j.usage, text }, null, 1));
    console.log(s, arm, rep, res.status, text.split(/\s+/).length + 'w');
  }
  fs.writeFileSync(path.join(__dirname, 'LEDGER.json'), JSON.stringify({ calls, blocked }));
})();
