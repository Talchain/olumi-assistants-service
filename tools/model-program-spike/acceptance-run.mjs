#!/usr/bin/env node
/**
 * SPIKE S3 ACCEPTANCE RUN: N runs × each brief × the arms, with the operator answering from a facts sheet (loaded by path).
 *  · spike:   the model-program arm on the REAL core route in process, in-memory stores (acceptance.driver.test.ts);
 *  · control: TODAY's core route on the SAME SHA, a local CEE from this worktree (`--target`), real stores (control.mjs).
 * Both write the same record per run (the final saved model, its readable rendering, the chances from
 * canonical_analysis_view with their basis labels, the asks and answers, calls, tokens, $ and seconds) under <out>/<arm>/,
 * and a SUMMARY.md. Never scores.
 *
 *   node tools/model-program-spike/acceptance-run.mjs --out <dir> [--arms spike,control] [--runs 5] [--ids a,b]
 *        [--briefs <briefs.json>] [--facts <sheet>] [--target http://127.0.0.1:4731] [--max-usd 25]
 *
 * BUDGET line first. At most 2 runs in flight in total (one per arm when both run); waits while the 1-minute load is ≥ 25;
 * stops every arm on the first 429 (<out>/STOP-429.txt). A brief's facts section is its `facts_key`, else its id.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { envKey, loadFacts } from './operator.mjs';
import { runControl } from './control.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
if (!arg('out')) { console.error('--out <dir> is required'); process.exit(2); }
const OUT = path.resolve(arg('out'));
const BRIEFS = path.resolve(arg('briefs', '/private/tmp/claude-502/-Users-paulslee-Documents-GitHub/93d79c3e-7ce6-4624-a562-7383932a25e4/scratchpad/qrunner/paul-briefs.json'));
const briefs = JSON.parse(fs.readFileSync(BRIEFS, 'utf8')).briefs;
const IDS = arg('ids', briefs.map((b) => b.id).join(',')).split(',');
const RUNS = Number(arg('runs', '1'));
const ARMS = arg('arms', 'spike,control').split(',');
const MAX_USD = Number(arg('max-usd', '25'));
const FACTS = arg('facts', '') ? path.resolve(arg('facts').replace(/^~/, os.homedir())) : '';
const TARGET = arg('target', 'http://127.0.0.1:4731');
for (const id of IDS) if (!briefs.some((b) => b.id === id)) { console.error(`unknown brief id ${id}`); process.exit(2); }
const n = RUNS * IDS.length;
const perArm = { spike: '≤ 6 (≤ 3 drafting at gpt-6.1-sol medium; ≤ 3 operator at gpt-5.6-terra low)', control: '≤ ~16 (today\'s core turns: brief + ≤ 3 answers + card presses + 1 Run, each 1–3 calls; ≤ 3 operator)' };
console.log(`BUDGET: ${RUNS} run(s) × ${IDS.length} brief(s) × ${ARMS.length} arm(s) [${ARMS.join(', ')}] = ${n * ARMS.length} scenario(s); calls per scenario: ${ARMS.map((a) => `${a} ${perArm[a]}`).join('; ')}; spend cap $${MAX_USD} (half per arm when both run); ≤ 2 in flight; abort on the first 429. Facts: ${FACTS ? 'sheet by path' : 'none'}.`);
fs.mkdirSync(OUT, { recursive: true });
const STOP = path.join(OUT, 'STOP-429.txt');
const t0 = Date.now();
const waitLoad = async () => { while (os.loadavg()[0] >= 25) await new Promise((r) => setTimeout(r, 30_000)); };

const tasks = [];
if (ARMS.includes('spike')) {
  const dir = path.join(OUT, 'spike'); fs.mkdirSync(dir, { recursive: true });
  tasks.push(new Promise((resolve) => {
    // The driver stops on the shared STOP file through its own copy (it writes <dir>/STOP-429.txt); mirrored below.
    const child = spawn(path.join(ROOT, 'node_modules/.bin/vitest'), ['run', 'tools/model-program-spike/acceptance.driver.test.ts', '--reporter=dot'], {
      cwd: ROOT, stdio: 'inherit',
      env: { ...process.env, MP_ACCEPT_OUT: dir, MP_BRIEFS: BRIEFS, MP_IDS: IDS.join(','), MP_RUNS: String(RUNS), MP_PARALLEL: ARMS.includes('control') ? '1' : '2', MP_MAX_USD: String(ARMS.length > 1 ? MAX_USD / 2 : MAX_USD), MP_FACTS: FACTS, MP_STOP: STOP },
    });
    child.on('exit', (code) => resolve({ arm: 'spike', code }));
  }));
}
if (ARMS.includes('control')) {
  const dir = path.join(OUT, 'control'); fs.mkdirSync(dir, { recursive: true });
  const env = fs.readFileSync('/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env.staging.local', 'utf8');
  const assistKey = (env.match(/^ASSIST_API_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
  const apiKey = envKey();
  let spent = 0;
  const jobs = Array.from({ length: RUNS }, (_, i) => IDS.map((id) => ({ id, rep: i + 1 }))).flat();
  const width = ARMS.includes('spike') ? 1 : 2;
  let next = 0;
  tasks.push(Promise.all(Array.from({ length: width }, async () => {
    while (next < jobs.length && !fs.existsSync(STOP) && spent < (ARMS.length > 1 ? MAX_USD / 2 : MAX_USD)) {
      await waitLoad();
      const { id, rep } = jobs[next++];
      const b = briefs.find((x) => x.id === id);
      try {
        const rec = await runControl({ target: TARGET, assistKey, apiKey, id, rep, brief: b.brief, facts: loadFacts(FACTS, b.facts_key ?? id), out: dir, stopFile: STOP, onSpend: (u) => { spent += u; } });
        if (rec) console.log(`control ${id}-r${rep}: ${rec.calls} calls · $${rec.usd} · ${rec.seconds}s · chance ${rec.has_chance} · run ${rec.run_state?.kind ?? null}`);
      } catch (err) { fs.writeFileSync(path.join(dir, `${id}-r${rep}.FAILED.txt`), String(err?.stack ?? err)); }
    }
  })).then(() => ({ arm: 'control', code: 0 })));
}
const results = await Promise.all(tasks);

// ── summary: per arm, per brief, code-counted ────────────────────────────────────────────────────────────────────────
const L = ['# Model-program spike: acceptance run', '', `Briefs: ${BRIEFS} · runs ${RUNS} · arms ${ARMS.join(', ')} · ${((Date.now() - t0) / 1000).toFixed(0)} s${fs.existsSync(STOP) ? ' · STOPPED on 429' : ''} · exits ${JSON.stringify(results)}`, ''];
const pct = (c) => (c && typeof c.chance === 'number' ? `${(c.chance * 100).toFixed(1)}%` : c?.withheld ? 'withheld' : '—');
let total = { calls: 0, usd: 0 };
for (const arm of ARMS) {
  const dir = path.join(OUT, arm);
  if (!fs.existsSync(dir)) continue;
  const recs = fs.readdirSync(dir).filter((f) => /^[a-z0-9_-]+-r\d+\.json$/i.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const failed = fs.readdirSync(dir).filter((f) => f.endsWith('.FAILED.txt'));
  L.push(`## ${arm}`, '', '| brief | runs | runs with a chance (code-counted) | saved | calls | $ | median s |', '|---|---|---|---|---|---|---|');
  for (const id of IDS) {
    const rs = recs.filter((r) => r.id === id);
    const secs = rs.map((r) => r.seconds).sort((a, b) => a - b);
    L.push(`| ${id} | ${rs.length} | ${rs.filter((r) => r.has_chance).length} | ${rs.filter((r) => r.final_saved).length} | ${rs.reduce((a, r) => a + r.calls, 0)} | ${rs.reduce((a, r) => a + r.usd, 0).toFixed(3)} | ${secs.length ? secs[Math.floor(secs.length / 2)] : '—'} |`);
  }
  L.push('', '| run | chance | per option (cell) | answer turns | asks answered | calls | $ | s |', '|---|---|---|---|---|---|---|---|');
  for (const r of recs.sort((a, b) => `${a.id}${a.rep}`.localeCompare(`${b.id}${b.rep}`))) {
    const cells = (r.chances?.cells ?? []).map((c) => `${c.label}: ${c.kind === 'figure' ? `${c.display}${c.basis ? ` (${c.basis})` : ''}` : 'withheld'}`).join('; ') || '—';
    const answered = r.qa.filter((q) => q.status === 'answered').length;
    L.push(`| ${r.id}-r${r.rep} | ${r.has_chance ? 'yes' : 'no'} | ${cells} | ${r.answer_turns} | ${answered} | ${r.calls} | ${r.usd} | ${r.seconds} |`);
    total.calls += r.calls; total.usd += r.usd;
  }
  if (failed.length) L.push('', `FAILED: ${failed.join(', ')}`);
  L.push('');
}
L.push(`Total: ${total.calls} calls, $${total.usd.toFixed(3)} (rates as qrunner.mjs:25, UNVERIFIED list prices).`);
fs.writeFileSync(path.join(OUT, 'SUMMARY.md'), `${L.join('\n')}\n`);
console.log(L.join('\n'));
