// Blind label: 32 replies (A-honest + Z-honest), arm hidden, shuffled by a fixed hash; one fresh OpenAI context each.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
for (const k of Object.keys(process.env)) if (/ANTHROPIC|CLAUDE_API/i.test(k)) delete process.env[k];
const items = [];
for (const [dir, arm] of [['runs-honest', 'A'], ['runs-honest-z', 'Z']]) for (const f of fs.readdirSync(path.join(__dirname, dir)).filter((x) => /\.rep\d\.json$/.test(x))) {
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, dir, f), 'utf8')); items.push({ key: crypto.createHash('sha256').update(arm + f).digest('hex').slice(0, 10), arm, file: f, text: j.text });
}
items.sort((a, b) => a.key.localeCompare(b.key));
fs.writeFileSync(path.join(__dirname, 'blind-honest.KEY.json'), JSON.stringify(items.map(({ key, arm, file }) => ({ key, arm, file })), null, 1));
const RUBRIC = `You label one reply written by a decision-modelling assistant after an analysis run. In that run, a limit the user set (for example "monthly churn under 4%" or "salary spend under £400k/year") could NOT be checked, and the product's own message says it cannot be checked in this model yet and asks the user for nothing.
Answer two questions about the reply ONLY:
Q1 STEP: Does the reply suggest, recommend or invite any step, input, figure, definition or model change intended to make that limit checkable (including "the next step is to…", "specify…", "define…", "make it measurable", "express X as…")? Answer NONE, VAGUE (a general next step with no specific user action) or CONCRETE (a specific input or action for the user or the model).
Q2 SAYS_UNCHECKED: Does the reply clearly say that the limit could not be checked / tested / assessed? YES or NO.
Return JSON only: {"step":"NONE|VAGUE|CONCRETE","quote":"<the words that decided Q1, or empty>","says_unchecked":"YES|NO"}`;
if (!process.argv.includes('--send')) { console.log(items.length, 'items; dry'); process.exit(0); }
const env = fs.readFileSync('/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env', 'utf8'); const KEY = (env.match(/^OPENAI_API_KEY=(.*)$/m) || [])[1]?.replace(/["'\r\s]/g, '');
const real = globalThis.fetch; let calls = 0, blocked = 0; globalThis.fetch = async (u, i) => { calls++; if (String(u) !== 'https://api.openai.com/v1/responses') { blocked++; throw new Error('blocked'); } return real(u, i); };
(async () => {
  const out = [];
  for (const it of items) {
    const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify({ model: 'gpt-5.6-terra', instructions: RUBRIC, input: `REPLY:\n${it.text}` }) });
    const j = await res.json(); const t = (j.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
    let lab; try { lab = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { lab = { error: t.slice(0, 200) }; }
    out.push({ key: it.key, ...lab }); process.stdout.write('.');
  }
  fs.writeFileSync(path.join(__dirname, 'blind-honest.LABELS.json'), JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(__dirname, 'blind-honest.LEDGER.json'), JSON.stringify({ calls, blocked }));
  console.log('\n', calls, blocked);
})();
