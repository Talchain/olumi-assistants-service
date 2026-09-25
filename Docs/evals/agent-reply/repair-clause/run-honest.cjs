// After #1875 (733b7812): does the served Agent stack (R, #1866) still invent a fix when the run says a limit
// "cannot be checked in this model yet"? Same 8 served e39f6e0 FP3 inputs; ONLY the unanchored arm's sentence
// is swapped from the served copy to #1875's. Instructions = served R (sha-pinned). OpenAI only.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
for (const k of Object.keys(process.env)) if (/ANTHROPIC|CLAUDE_API/i.test(k)) delete process.env[k];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const V1 = fs.readFileSync(path.resolve(__dirname, '../aqfmc/stk/V1_fp3.txt'), 'utf8'); if (sha(V1) !== '06a876d3d4fa74cd37c7e75f1ec62952f4a8a01d892badb23538ea1526fba8af') throw new Error('R drift');
const OLD = /The part of your model it points at is worked out from other parts, so it has no measured starting point of its own, and restating the limit cannot give it one\. Tell me which part of your model it applies to and I will record it there; this one stays on the model\. Then run the analysis again\./g;
const NEW = 'The part of your model it points at is worked out from other parts, and Olumi cannot yet test a limit on a quantity like that, so it cannot be checked in this model yet; this one stays on the model unchecked.';
const ROOT = path.resolve(__dirname, '../served-leak/e39f6e0'); const STATES = ['eng-hiring-3', 'eng-hiring-4', 'eng-hiring-5', 'eng-hiring-6', 'pricing-1', 'pricing-3', 'pricing-4', 'pricing-5'];
const swap = (v, n) => typeof v === 'string' ? v.replace(OLD, () => { n.c++; return NEW; }) : Array.isArray(v) ? v.map((x) => swap(x, n)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x, n)])) : v;
const bodies = Object.fromEntries(STATES.map((s) => { const d = JSON.parse(fs.readFileSync(path.join(ROOT, s, 'fp3-reconstructed.request.json'), 'utf8')); const n = { c: 0 }; const b = swap(d.body ?? d, n); if (n.c < 1) throw new Error(`${s}: served sentence not found`); if (JSON.stringify(b).includes('Tell me which part')) throw new Error(`${s}: residue`); return [s, { b, n: n.c }]; }));
console.log(JSON.stringify({ R: sha(V1).slice(0, 12), swapped: Object.fromEntries(STATES.map((s) => [s, bodies[s].n])) }));
if (!process.argv.includes('--send')) process.exit(0);
const env = fs.readFileSync('/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env', 'utf8'); const KEY = (env.match(/^OPENAI_API_KEY=(.*)$/m) || [])[1]?.replace(/["'\r\s]/g, '');
const real = globalThis.fetch; let calls = 0, blocked = 0; globalThis.fetch = async (u, i) => { calls++; if (String(u) !== 'https://api.openai.com/v1/responses') { blocked++; throw new Error('blocked'); } return real(u, i); };
(async () => {
  const OUT = path.join(__dirname, 'runs-honest'); fs.mkdirSync(OUT, { recursive: true });
  for (let rep = 1; rep <= 2; rep++) for (const s of STATES) {
    const f = path.join(OUT, `${s}.A.rep${rep}.json`); if (fs.existsSync(f)) continue;
    const b = { ...bodies[s].b, instructions: V1 }; const t0 = Date.now();
    const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify(b) });
    const j = await res.json(); const text = (j.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
    fs.writeFileSync(f, JSON.stringify({ state: s, arm: 'A-honest', rep, http: res.status, ms: Date.now() - t0, model: j.model, usage: j.usage, text }, null, 1));
    console.log(s, rep, res.status, j.model, text.split(/\s+/).length + 'w');
  }
  fs.writeFileSync(path.join(OUT, 'LEDGER.json'), JSON.stringify({ calls, blocked }));
})();
