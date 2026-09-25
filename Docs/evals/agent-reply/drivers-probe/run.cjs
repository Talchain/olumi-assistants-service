// Does the Agent pick its challenge target from the analysis's own ranking when it can SEE the ranking?
// D2 final hop (AQ-FMC capture, served-H model): arm R = the captured request verbatim; arm D = the same request
// with the stored run's decision_brief.top_drivers added to get_canonical_state's `analysis`. Instructions identical.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
for (const k of Object.keys(process.env)) if (/ANTHROPIC|CLAUDE_API/i.test(k)) delete process.env[k];
const CAP = path.resolve(__dirname, '../aqfmc/captures/R/D2');
const req = JSON.parse(fs.readFileSync(path.join(CAP, 'llm-calls/02.request.json'), 'utf8')); const body = req.body ?? req;
const rb = JSON.parse(fs.readFileSync(path.join(CAP, 'canonical-readback.json'), 'utf8'));
const drivers = rb.analysis_result.enrichment.decision_brief.top_drivers;
const withDrivers = JSON.parse(JSON.stringify(body)); let n = 0;
for (const it of withDrivers.input) if (it.type === 'function_call_output') { const o = JSON.parse(it.output); if (o.analysis) { o.analysis.top_drivers = drivers; it.output = JSON.stringify(o); n++; } }
if (n < 1) throw new Error('no get_canonical_state output patched');
const sha = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 12);
console.log(JSON.stringify({ patched: n, drivers: drivers.map((d) => `${d.factor_label}:${d.sensitivity}`), instrEqual: body.instructions === withDrivers.instructions, R: sha(body), D: sha(withDrivers) }));
if (!process.argv.includes('--send')) process.exit(0);
const env = fs.readFileSync('/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env', 'utf8'); const KEY = (env.match(/^OPENAI_API_KEY=(.*)$/m) || [])[1]?.replace(/["'\r\s]/g, '');
const real = globalThis.fetch; let calls = 0, blocked = 0; globalThis.fetch = async (u, i) => { calls++; if (String(u) !== 'https://api.openai.com/v1/responses') { blocked++; throw new Error('blocked'); } return real(u, i); };
(async () => {
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  for (let rep = 1; rep <= 3; rep++) for (const [arm, b] of [['R', body], ['D', withDrivers]]) {
    const f = path.join(__dirname, 'out', `D2.${arm}.rep${rep}.json`); if (fs.existsSync(f)) continue;
    const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify(b) });
    const j = await res.json(); const text = (j.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
    const calls_ = (j.output ?? []).filter((o) => o.type === 'function_call').map((o) => o.name);
    fs.writeFileSync(f, JSON.stringify({ arm, rep, http: res.status, model: j.model, tool_calls: calls_, text }, null, 1));
    console.log(arm, rep, res.status, j.model, calls_.join(',') || 'text', text.slice(0, 110).replace(/\n/g, ' '));
  }
  fs.writeFileSync(path.join(__dirname, 'out', 'LEDGER.json'), JSON.stringify({ calls, blocked }));
})();
