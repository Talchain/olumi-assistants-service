#!/usr/bin/env node
/**
 * SPIKE S3 ACCEPTANCE RUN: N runs × each brief through the REAL core route in process (the model-program arm), with the
 * operator answering asks from a facts sheet, then save → readback → cold reopen. Writes one record per run (final canonical
 * model, its readable rendering, compile states, chances with their basis labels, asks and answers, calls, tokens, cost,
 * seconds) and a summary table.
 *
 *   node tools/model-program-spike/acceptance-run.mjs --out <dir> [--runs 1] [--ids capacity,hiring]
 *        [--briefs <briefs.json>] [--heldout <briefs.json>] [--facts <facts-sheet>] [--max-usd 5] [--parallel 2]
 *
 * Prints a BUDGET line first. At most 2 runs in flight; waits while the 1-minute load is ≥ 25; stops on the first 429
 * (STOP-429.txt in --out, written by the driver's fetch). Run from the worktree root.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.resolve(arg('out', ''));
if (!arg('out')) { console.error('--out <dir> is required'); process.exit(2); }
const BRIEFS = path.resolve(arg('heldout', arg('briefs', '/private/tmp/claude-502/-Users-paulslee-Documents-GitHub/93d79c3e-7ce6-4624-a562-7383932a25e4/scratchpad/qrunner/paul-briefs.json')));
const all = JSON.parse(fs.readFileSync(BRIEFS, 'utf8')).briefs.map((b) => b.id);
const IDS = (arg('ids', all.join(','))).split(',');
const RUNS = Number(arg('runs', '1'));
const PAR = Math.min(2, Number(arg('parallel', '2')));
const MAX_USD = Number(arg('max-usd', '5'));
const FACTS = arg('facts', '') ? path.resolve(arg('facts')) : '';
for (const id of IDS) if (!all.includes(id)) { console.error(`unknown brief id ${id} in ${BRIEFS}`); process.exit(2); }
const n = RUNS * IDS.length;

console.log(`BUDGET: ${RUNS} run(s) × ${IDS.length} brief(s) = ${n} scenario(s) × ≤ 6 calls (≤ 3 drafting at gpt-6.1-sol medium: 1 draft + ≤ 2 repairs; ≤ 3 operator at gpt-5.6-terra low) = ≤ ${6 * n} calls; spend cap $${MAX_USD}; ${PAR} in flight; abort on the first 429. Facts: ${FACTS ? 'sheet by path' : 'none (every ask answered "I don\'t know")'}.`);
fs.mkdirSync(OUT, { recursive: true });
const load = () => os.loadavg()[0];
if (load() >= 25) console.log(`load ${load().toFixed(1)} ≥ 25: the driver waits before each run`);

const t0 = Date.now();
const res = spawnSync(path.join(ROOT, 'node_modules/.bin/vitest'), ['run', 'tools/model-program-spike/acceptance.driver.test.ts', '--reporter=dot'], {
  cwd: ROOT, stdio: 'inherit',
  env: { ...process.env, MP_ACCEPT_OUT: OUT, MP_BRIEFS: BRIEFS, MP_IDS: IDS.join(','), MP_RUNS: String(RUNS), MP_PARALLEL: String(PAR), MP_MAX_USD: String(MAX_USD), MP_FACTS: FACTS },
});
const stopped = fs.existsSync(path.join(OUT, 'STOP-429.txt'));

// ── summary ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const recs = fs.readdirSync(OUT).filter((f) => /^[a-z0-9_-]+-r\d+\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')));
const failed = fs.readdirSync(OUT).filter((f) => f.endsWith('.FAILED.txt'));
const pct = (c) => (c && typeof c.chance === 'number' ? `${(c.chance * 100).toFixed(1)}%` : c?.withheld ? 'withheld' : '—');
const L = ['# Model-program spike: acceptance run', '', `Briefs: ${BRIEFS} · runs ${RUNS} · ${((Date.now() - t0) / 1000).toFixed(0)} s · vitest exit ${res.status}${stopped ? ' · STOPPED on 429' : ''}`, '',
  '| run | compiles (first / end) | repairs | asks → answered | answer turns | saved | reopen identical | per option: joint within limits (basis) | calls | $ | s |', '|---|---|---|---|---|---|---|---|---|---|---|'];
for (const r of recs.sort((a, b) => `${a.id}${a.rep}`.localeCompare(`${b.id}${b.rep}`))) {
  const draft = r.turns[0];
  const attempts = draft?.draft_attempts ?? [];
  const first = attempts[0]?.errors?.length === 0;
  const end = r.compile_states.at(-1)?.compiles === true;
  const asked = r.qa.filter((q) => q.turn !== null).length;
  const answered = r.qa.filter((q) => q.status === 'answered').length;
  const cells = (r.chances.per_option ?? []).map((o) => {
    const cell = (r.chances.cells ?? []).find((c) => c.option_id === o.option_id);
    return `${cell?.label ?? o.option_id}: ${pct(o.joint_within_limits)}${cell?.basis ? ` (${cell.basis})` : cell?.kind === 'withheld' ? ' (shown withheld)' : ''}`;
  }).join('; ') || (r.chances.cells ?? []).map((c) => `${c.label}: withheld`).join('; ');
  L.push(`| ${r.id}-r${r.rep} | ${first ? 'yes' : 'no'} / ${end ? 'yes' : 'no'} | ${Math.max(0, attempts.length - 1)} | ${asked} → ${answered} | ${r.turns.length - 1} | ${r.final_saved} | ${r.reopen.view_identical && r.reopen.canonical_bytes_identical ? 'yes' : 'NO'} | ${cells} | ${r.calls} | ${r.usd} | ${r.seconds} |`);
}
if (failed.length) L.push('', `FAILED runs: ${failed.join(', ')}`);
const spent = recs.reduce((a, r) => a + r.usd, 0);
L.push('', `Total: ${recs.length} run(s), ${recs.reduce((a, r) => a + r.calls, 0)} calls, $${spent.toFixed(3)} (rates as qrunner.mjs:25, UNVERIFIED list prices).`);
fs.writeFileSync(path.join(OUT, 'SUMMARY.md'), `${L.join('\n')}\n`);
console.log(L.join('\n'));
process.exit(res.status ?? 1);
