// Corpus v6 input: every v5 reply (old label hidden from labellers) + the analysis evidence its model was given.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const v5 = JSON.parse(fs.readFileSync(path.join(ROOT, 'gate-corpus/corpus-v5-multidomain.json'), 'utf8'));
const src = (s) => s.startsWith('served-caf7d1a-') ? path.join(ROOT, 'served-leak/caf7d1a', s.slice('served-caf7d1a-'.length), 'explicit-run.response.json') : path.join(ROOT, 'captures', s, 'explicit-run.response.json');
function evidence(state) {
  const r = JSON.parse(fs.readFileSync(src(state), 'utf8'));
  const oc = [...JSON.stringify(r).matchAll(/"option_comparison":/g)].length ? (function find(o) { if (o && typeof o === 'object') { if (Array.isArray(o.option_comparison)) return o.option_comparison; for (const k of Object.keys(o)) { const f = find(o[k]); if (f) return f; } } return null; })(r) : null;
  const g = r.draft_graph ?? {};
  const kinds = (k) => (g.nodes ?? []).filter((n) => n.kind === k).map((n) => n.label);
  return {
    source_file: path.relative(ROOT, src(state)),
    goal: kinds('goal'), outcomes: kinds('outcome'), risks: kinds('risk'), constraints: kinds('constraint'),
    leader_claim: r.analysis_state?.leader_claim ?? null,
    permitted_analysis_mode: r.analysis_ready?.analysis_admission?.permitted_analysis_mode ?? null,
    leader_may_be_named: r.analysis_state?.leader_claim?.permitted === true && r.analysis_ready?.analysis_admission?.permitted_analysis_mode === 'comparative_leader',
    options: (oc ?? []).map((o) => ({ label: o.option_label ?? o.label, status: o.status, mean: o.outcome?.mean, p10: o.outcome?.p10, p50: o.outcome?.p50, p90: o.outcome?.p90, win_probability: o.win_probability })),
    note: 'outcome = the modelled goal outcome distribution the analysis reports per option; win_probability is a RANKING view',
  };
}
const states = Object.fromEntries([...new Set(v5.replies.map((x) => x.state))].map((s) => [s, evidence(s)]));
const replies = v5.replies.map((x) => ({ id: x.id, state: x.state, text: x.text }));
fs.writeFileSync(path.join(__dirname, 'input.json'), JSON.stringify({ states, replies }, null, 1));
fs.writeFileSync(path.join(__dirname, 'v5-labels-historical.json'), JSON.stringify(Object.fromEntries(v5.replies.map((x) => [x.id, { label: x.label, leak_phrases: x.leak_phrases }])), null, 1));
console.log(Object.entries(states).map(([s, e]) => `${s}: options ${e.options.length} goal ${JSON.stringify(e.goal)} lc ${JSON.stringify(e.leader_claim)}`).join('\n'));
