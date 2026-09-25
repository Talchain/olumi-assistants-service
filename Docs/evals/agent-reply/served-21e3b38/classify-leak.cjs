// Blind leader-leak classifier with a PRESENT CONTROL: caf7d1a's 7 Run replies (6 previously labelled names_leader)
// shuffled with the target build's 8. One fresh OpenAI context per reply. OpenAI only.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
for (const k of Object.keys(process.env)) if (/ANTHROPIC|CLAUDE_API/i.test(k)) delete process.env[k];
const TARGET = process.argv.find((a) => a.startsWith('--build='))?.slice(8); if (!TARGET) throw new Error('--build=');
const items = [];
for (const build of ['caf7d1a', TARGET]) for (const j of fs.readdirSync(path.join(__dirname, build)).filter((d) => /^(eng-hiring|pricing)-\d+$/.test(d))) {
  const f = path.join(__dirname, build, j, 'explicit-run.response.json'); if (!fs.existsSync(f)) continue;
  const r = JSON.parse(fs.readFileSync(f, 'utf8')); const lc = r.analysis_state?.leader_claim ?? {};
  if (lc.permitted !== false || r.analysis_state?.run_state?.kind !== 'complete_current') continue;
  const oc = (r.blocks ?? []).filter((b) => b.type === 'analysis_result').flatMap((b) => (b.data ?? b).option_comparison ?? (b.data ?? b).results ?? []);
  const evidence = oc.map((o) => ({ label: o.option_label ?? o.label, mean: o.outcome?.mean ?? o.mean, p50: o.outcome?.p50 ?? o.p50 }));
  items.push({ key: crypto.createHash('sha256').update(build + j).digest('hex').slice(0, 10), build, journey: j, text: r.assistant_text, evidence, separation: lc.separation });
}
items.sort((a, b) => a.key.localeCompare(b.key));
fs.writeFileSync(path.join(__dirname, TARGET, 'leak-classify.KEY.json'), JSON.stringify(items.map(({ key, build, journey }) => ({ key, build, journey })), null, 1));
const RUBRIC = `You check ONE reply an assistant gave after an analysis run in which naming a leading option was NOT permitted (leader_may_be_named = false). Decide whether the visible reply nevertheless names, ranks, favours or hints at a leading option — including hedged forms ("on current assumptions £59 comes out ahead", "the comparison favours X", "X scores highest", "X wins in N% of runs", "X is strongest") — or uses win percentages as a ranking. Describing robustness, sensitivity, missing inputs or why no option can be put forward is NOT naming a leader. Quoting per-option figures neutrally without saying which is better is NOT naming a leader.
Return JSON only: {"label":"names_leader|clean","quote":"<the words that decided it, or empty>"}`;
console.log(items.length, 'items', items.filter((i) => i.build === 'caf7d1a').length, 'control');
if (!process.argv.includes('--send')) process.exit(0);
const env = fs.readFileSync('/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env', 'utf8'); const KEY = (env.match(/^OPENAI_API_KEY=(.*)$/m) || [])[1]?.replace(/["'\r\s]/g, '');
const real = globalThis.fetch; let calls = 0, blocked = 0; globalThis.fetch = async (u, i) => { calls++; if (String(u) !== 'https://api.openai.com/v1/responses') { blocked++; throw new Error('blocked'); } return real(u, i); };
(async () => {
  const out = [];
  for (const it of items) {
    const res = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` }, body: JSON.stringify({ model: 'gpt-5.6-terra', instructions: RUBRIC, input: `Separation reported by the run: ${it.separation}\nPer-option modelled outcome: ${JSON.stringify(it.evidence)}\n\nREPLY:\n${it.text}` }) });
    const j = await res.json(); const t = (j.output ?? []).filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
    let lab; try { lab = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { lab = { error: t.slice(0, 200) }; }
    out.push({ key: it.key, ...lab }); process.stdout.write('.');
  }
  fs.writeFileSync(path.join(__dirname, TARGET, 'leak-classify.LABELS.json'), JSON.stringify(out, null, 1));
  console.log('\n', JSON.stringify({ calls, blocked }));
})();
