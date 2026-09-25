// AQ-FMC-0.1: lock, then unblind and apply the preregistered rule (PREREG-INTERPRETATION.md).
//   node select.cjs lock <phase>     hash every <state>.rep<n>.scores.json of the phase BEFORE the key is read
//   node select.cjs report           unblind (only against a matching lock) and apply rules 1–8
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const AQ = path.resolve(__dirname, '..'), J = path.join(AQ, 'judge'), REP = path.join(AQ, 'replays');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const DEV = ['D1', 'D1b', 'D2', 'D8'], HELD = ['X1', 'X2']; // PREREG-ADDENDUM-1: every captured development state counts
const median = (xs) => { const a = xs.filter((x) => typeof x === 'number').sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const wordsOf = (s) => (String(s).trim() ? String(s).trim().split(/\s+/).length : 0);

const [cmd, phase] = process.argv.slice(2);
if (cmd === 'lock') {
  const states = phase.split('+');
  const files = fs.readdirSync(J).filter((f) => /\.rep\d\.scores\.json$/.test(f) && states.includes(f.split('.')[0])).sort();
  const lock = { phase, locked_at: new Date().toISOString(), key_file_sha256: sha(fs.readFileSync(path.join(J, `KEY-${phase}.json`))), prereg_sha256: sha(fs.readFileSync(path.join(__dirname, 'PREREG-INTERPRETATION.md'))), files: Object.fromEntries(files.map((f) => [f, sha(fs.readFileSync(path.join(J, f)))])) };
  const out = path.join(J, `LOCK-${phase}.json`);
  if (fs.existsSync(out)) throw new Error('already locked: ' + out);
  fs.writeFileSync(out, JSON.stringify(lock, null, 1));
  console.log(JSON.stringify({ lock: out, lock_sha256: sha(fs.readFileSync(out)), files: files.length }));
  process.exit(0);
}

// ── report ──
const locks = fs.readdirSync(J).filter((f) => /^LOCK-.*\.json$/.test(f));
const rows = [];
for (const lf of locks) {
  const lock = readJson(path.join(J, lf));
  for (const [f, h] of Object.entries(lock.files)) if (sha(fs.readFileSync(path.join(J, f))) !== h) throw new Error(`scores changed after lock: ${f}`);
  const key = readJson(path.join(J, `KEY-${lock.phase}.json`));
  if (sha(fs.readFileSync(path.join(J, `KEY-${lock.phase}.json`))) !== lock.key_file_sha256) throw new Error('key changed after lock');
  for (const f of Object.keys(lock.files)) {
    const s = readJson(path.join(J, f)); const k = key.find((x) => x.state === s.state && x.rep === s.rep);
    if (!s.scores) { rows.push({ state: s.state, rep: s.rep, arm: 'R', unscored: true }, { state: s.state, rep: s.rep, arm: 'F', unscored: true }); continue; }
    for (const L of ['A', 'B']) {
      const arm = k[L]; const v = s.scores[L]; const rep = readJson(path.join(REP, `${s.state}.${arm}.rep${s.rep}.json`)); const full = readJson(path.join(REP, 'full', `${s.state}.${arm}.rep${s.rep}.json`));
      const u = rep.usage || {}; const cached = u.input_tokens_details?.cached_tokens ?? null;
      rows.push({ state: s.state, rep: s.rep, arm, letter: L, raw: sum(v.raw.scores), full: sum(v.full.scores), rawScores: v.raw.scores, fullScores: v.full.scores, rawGates: v.raw.gates, fullGates: v.full.gates, evidence: { raw: v.raw.evidence, full: v.full.evidence }, notes: { raw: v.raw.notes, full: v.full.notes },
        rawWords: wordsOf(full.raw), visibleWords: wordsOf(full.visible), questions: { raw: v.raw.questions, full: v.full.questions }, duplicates: v.full.duplicate_statements, requests: v.raw.requests_for_information,
        outcome: rep.outcome.type, latency: rep.latency_ms, uncached: u.input_tokens != null && cached != null ? u.input_tokens - cached : null, cached, output: u.output_tokens ?? null, reasoning: u.output_tokens_details?.reasoning_tokens ?? null, response_id: rep.response_id, gate_changed: full.gate_changed, stripped: full.stripped.length, preference: s.scores.preference === L });
    }
  }
}
const by = (state, arm) => rows.filter((r) => r.state === state && r.arm === arm && !r.unscored);
const states = [...new Set(rows.map((r) => r.state))];
const table = states.map((s) => {
  const R = by(s, 'R'), F = by(s, 'F');
  const m = (xs, k) => median(xs.map((x) => x[k]));
  return { state: s, n: [R.length, F.length], raw: { R: m(R, 'raw'), F: m(F, 'raw'), R_range: [Math.min(...R.map((x) => x.raw)), Math.max(...R.map((x) => x.raw))], F_range: [Math.min(...F.map((x) => x.raw)), Math.max(...F.map((x) => x.raw))] },
    full: { R: m(R, 'full'), F: m(F, 'full'), R_range: [Math.min(...R.map((x) => x.full)), Math.max(...R.map((x) => x.full))], F_range: [Math.min(...F.map((x) => x.full)), Math.max(...F.map((x) => x.full))] },
    words: { raw: { R: m(R, 'rawWords'), F: m(F, 'rawWords') }, visible: { R: m(R, 'visibleWords'), F: m(F, 'visibleWords') } },
    latency: { R: m(R, 'latency'), F: m(F, 'latency') }, output_tokens: { R: m(R, 'output'), F: m(F, 'output') },
    paired_diff_full: [1, 2, 3].map((rep) => { const r = R.find((x) => x.rep === rep), f = F.find((x) => x.rep === rep); return r && f ? f.full - r.full : null; }),
    paired_diff_raw: [1, 2, 3].map((rep) => { const r = R.find((x) => x.rep === rep), f = F.find((x) => x.rep === rep); return r && f ? f.raw - r.raw : null; }),
    gate_fails: { R: R.flatMap((x) => [...Object.entries(x.rawGates).filter(([, g]) => g === 'FAIL').map(([g]) => `raw:${g}@rep${x.rep}`), ...Object.entries(x.fullGates).filter(([, g]) => g === 'FAIL').map(([g]) => `full:${g}@rep${x.rep}`)]), F: F.flatMap((x) => [...Object.entries(x.rawGates).filter(([, g]) => g === 'FAIL').map(([g]) => `raw:${g}@rep${x.rep}`), ...Object.entries(x.fullGates).filter(([, g]) => g === 'FAIL').map(([g]) => `full:${g}@rep${x.rep}`)]) },
    not_decidable: { R: R.flatMap((x) => [...Object.entries(x.rawGates), ...Object.entries(x.fullGates)].filter(([, g]) => g === 'NOT_DECIDABLE').map(([g]) => g)).length, F: F.flatMap((x) => [...Object.entries(x.rawGates), ...Object.entries(x.fullGates)].filter(([, g]) => g === 'NOT_DECIDABLE').map(([g]) => g)).length },
    intervention: { R: R.map((x) => [x.rawScores.useful_next_step, x.fullScores.useful_next_step]), F: F.map((x) => [x.rawScores.useful_next_step, x.fullScores.useful_next_step]) },
    outcomes: { R: R.map((x) => x.outcome), F: F.map((x) => x.outcome) }, gate_changed: { R: R.filter((x) => x.gate_changed).length, F: F.filter((x) => x.gate_changed).length },
    judge_preferred: { R: R.filter((x) => x.preference).length, F: F.filter((x) => x.preference).length } };
});
const T = Object.fromEntries(table.map((t) => [t.state, t]));
const have = (xs) => xs.filter((s) => T[s]);
const devHave = have(DEV), heldHave = have(HELD);
const meanGain = (view) => devHave.length ? devHave.reduce((a, s) => a + (T[s][view].F - T[s][view].R), 0) / devHave.length : null;
const Fall = rows.filter((r) => r.arm === 'F' && !r.unscored), Rall = rows.filter((r) => r.arm === 'R' && !r.unscored);
const tot = (xs, k) => xs.reduce((a, x) => a + (x[k] ?? NaN), 0);
const rules = {
  r1_F_all_gates_pass: Fall.every((x) => ![...Object.values(x.rawGates), ...Object.values(x.fullGates)].includes('FAIL')),
  r1_R_all_gates_pass: Rall.every((x) => ![...Object.values(x.rawGates), ...Object.values(x.fullGates)].includes('FAIL')),
  r2_D2_intervention_2_all: T.D2 ? T.D2.intervention.F.length === 3 && T.D2.intervention.F.every(([a, b]) => a === 2 && b === 2) : 'NOT_TESTED',
  r3_mean_dev_gain_raw: meanGain('raw'), r3_mean_dev_gain_full: meanGain('full'),
  r3_pass: meanGain('raw') !== null && meanGain('raw') >= 2 && meanGain('full') >= 2,
  r4_no_dev_regression: devHave.every((s) => T[s].raw.F >= T[s].raw.R && T[s].full.F >= T[s].full.R),
  r5_held_no_regression: heldHave.length === HELD.length ? heldHave.every((s) => T[s].raw.F >= T[s].raw.R && T[s].full.F >= T[s].full.R) : 'NOT_TESTED',
  r5_X2_intervention_2_all: T.X2 ? T.X2.intervention.F.length === 3 && T.X2.intervention.F.every(([a, b]) => a === 2 && b === 2) : 'NOT_TESTED',
  r6_same_call_pattern: Fall.every((x) => x.outcome === 'text'),
  r7_latency_ratio: median(Fall.map((x) => x.latency)) / median(Rall.map((x) => x.latency)),
  r8_token_ratios: { uncached: tot(Fall, 'uncached') / tot(Rall, 'uncached'), cached: tot(Fall, 'cached') / tot(Rall, 'cached'), output: tot(Fall, 'output') / tot(Rall, 'output') },
  r8_median_per_reply_cost: 'NOT_DECIDABLE (no timestamped gpt-5.6-terra price card in hand)',
  disclose_over_125: table.filter((t) => t.latency.F > 1.25 * t.latency.R || t.output_tokens.F > 1.25 * t.output_tokens.R).map((t) => ({ state: t.state, latency: t.latency, output_tokens: t.output_tokens })),
};
rules.r7_pass = rules.r7_latency_ratio <= 1.1;
rules.r8_price_independent_pass = Object.values(rules.r8_token_ratios).every((x) => x <= 1.1);
const all = [rules.r1_F_all_gates_pass, rules.r2_D2_intervention_2_all === true, rules.r3_pass, rules.r4_no_dev_regression, rules.r5_held_no_regression === true, rules.r5_X2_intervention_2_all === true, rules.r6_same_call_pattern, rules.r7_pass, rules.r8_price_independent_pass];
const verdict = all.every(Boolean) ? 'PROMPT_TEST_PASS (5 of 10 states; D3–D7 BLOCKED_PRECONDITION)' : rules.r1_R_all_gates_pass ? 'KEEP_R (F not selected)' : (rules.r1_F_all_gates_pass ? 'F not selected; R fails a hard gate' : 'NO_ACCEPTABLE_WINNER (both fail a hard gate)');
fs.writeFileSync(path.join(J, 'REPORT.json'), JSON.stringify({ verdict, rules, table, rows }, null, 1));
console.log(JSON.stringify({ verdict, rules, table: table.map((t) => ({ s: t.state, raw: `${t.raw.R}→${t.raw.F}`, full: `${t.full.R}→${t.full.F}`, words: `${t.words.visible.R}→${t.words.visible.F}`, fails: t.gate_fails, iv: t.intervention.F })) }, null, 1));
