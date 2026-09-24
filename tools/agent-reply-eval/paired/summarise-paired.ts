/**
 * Read-only summary of runs/ written by run-paired.ts. Makes no network call.
 *
 *   npx tsx tools/agent-reply-eval/paired/summarise-paired.ts <ledger.json>
 *
 * Descriptive only (no quality scoring — that is the blinded reviewer's job):
 *   - per case × arm: outcome types, words, tokens, latency;
 *   - request identity: every rep's request body minus `instructions` equals the captured request's,
 *     and its instructions equal the arm file (re-read from disk, not from the ledger);
 *   - M-vs-M noise control: mean pairwise word-set Jaccard within pricing-run-complete/M (reps 1–5)
 *     versus across M×C1 and M×C2 on the same case (a crude lexical proxy, labelled as such).
 * Writes runs/_runs/<stamp>-summary.json (write-once).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256, writeOnce } from './capture/network-guard.js';
import { REPO_ROOT } from './run-paired.js';

const BASE = join(REPO_ROOT, 'Docs/evals/agent-reply/paired/57f903c');
const RUNS = join(BASE, 'runs');
const readJson = (p: string): any => JSON.parse(readFileSync(p, 'utf8'));

const ledgerPath = resolve(process.argv[2] ?? '');
if (!existsSync(ledgerPath)) throw new Error('usage: summarise-paired.ts <ledger.json>');
const ledger = readJson(ledgerPath);

interface Rep { caseId: string; arm: string; rep: number; meta: any; text: string | null; req: any }
const reps: Rep[] = [];
for (const caseId of readdirSync(RUNS).filter((d) => !d.startsWith('_')).sort()) {
  for (const arm of readdirSync(join(RUNS, caseId)).sort()) {
    const dir = join(RUNS, caseId, arm);
    for (const f of readdirSync(dir).filter((x) => /^rep-\d+\.meta\.json$/.test(x))) {
      const k = Number(f.match(/^rep-(\d+)/)![1]);
      const stem = join(dir, `rep-${k}`);
      reps.push({
        caseId, arm, rep: k, meta: readJson(`${stem}.meta.json`),
        text: existsSync(`${stem}.text.txt`) ? readFileSync(`${stem}.text.txt`, 'utf8') : null,
        req: readJson(`${stem}.request.json`),
      });
    }
  }
}
reps.sort((a, b) => (a.caseId + a.arm).localeCompare(b.caseId + b.arm) || a.rep - b.rep);

// Request identity, re-derived from disk.
const identity: any[] = [];
for (const r of reps) {
  const captured = readJson(join(REPO_ROOT, r.meta.captured_request));
  const strip = (b: any) => { const { instructions: _i, ...rest } = b; return JSON.stringify(rest); };
  const armText = readFileSync(join(REPO_ROOT, r.meta.settings.instructions_file), 'utf8');
  identity.push({
    case: r.caseId, arm: r.arm, rep: r.rep,
    rest_equal_to_capture: strip(r.req.body) === strip(captured.body),
    instructions_equal_arm_file: r.req.body.instructions === armText,
    whole_body_equal_to_capture: JSON.stringify(r.req.body) === JSON.stringify(captured.body),
    auth_redacted: r.req.headers?.authorization === '[REDACTED]',
  });
}

const n = (x: unknown) => (typeof x === 'number' ? x : 0);
const mean = (xs: number[]) => (xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10);
const groups = new Map<string, Rep[]>();
for (const r of reps) { const k = `${r.caseId}/${r.arm}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
const perArm = [...groups.entries()].map(([k, rs]) => ({
  key: k, n: rs.length,
  reps: rs.map((r) => r.rep),
  http: rs.map((r) => r.meta.http_status),
  outcome_types: rs.map((r) => r.meta.outcome.type),
  function_calls: rs.map((r) => r.meta.outcome.function_calls.map((f: any) => f.name)),
  words: rs.map((r) => r.meta.outcome.words),
  mean_words: mean(rs.map((r) => r.meta.outcome.words)),
  input_tokens: rs.map((r) => n(r.meta.usage?.input_tokens)),
  cached_tokens: rs.map((r) => n(r.meta.usage?.cached_tokens)),
  output_tokens: rs.map((r) => n(r.meta.usage?.output_tokens)),
  reasoning_tokens: rs.map((r) => n(r.meta.usage?.reasoning_tokens)),
  wall_ms: rs.map((r) => r.meta.wall_ms),
  mean_wall_ms: mean(rs.map((r) => r.meta.wall_ms)),
  response_status: rs.map((r) => r.meta.response_status),
}));

// Noise control: lexical Jaccard.
const wordSet = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}%£$.\s-]/gu, ' ').split(/\s+/).filter(Boolean));
const jac = (a: string, b: string) => { const A = wordSet(a), B = wordSet(b); const i = [...A].filter((x) => B.has(x)).length; return i / (A.size + B.size - i || 1); };
const pairMean = (xs: Rep[], ys: Rep[] | null) => {
  const vals: number[] = [];
  if (ys === null) { for (let i = 0; i < xs.length; i += 1) for (let j = i + 1; j < xs.length; j += 1) vals.push(jac(xs[i]!.text ?? '', xs[j]!.text ?? '')); }
  else for (const x of xs) for (const y of ys) vals.push(jac(x.text ?? '', y.text ?? ''));
  return { pairs: vals.length, mean: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000 : null, min: vals.length ? Math.round(Math.min(...vals) * 1000) / 1000 : null, max: vals.length ? Math.round(Math.max(...vals) * 1000) / 1000 : null };
};
const pm = groups.get('pricing-run-complete/M') ?? [];
const noise = {
  proxy: 'word-set Jaccard of output text (crude lexical similarity; not a quality measure)',
  within_M_reps_1_to_5: pairMean(pm, null),
  M_x_C1: pairMean(pm, groups.get('pricing-run-complete/C1') ?? []),
  M_x_C2: pairMean(pm, groups.get('pricing-run-complete/C2') ?? []),
  within_C1: pairMean(groups.get('pricing-run-complete/C1') ?? [], null),
  within_C2: pairMean(groups.get('pricing-run-complete/C2') ?? [], null),
  M_words_reps_1_to_5: pm.map((r) => r.meta.outcome.words),
};

const summary = {
  schema: 'agent-reply-paired-summary.v1', ledger: ledgerPath.replace(`${REPO_ROOT}/`, ''),
  recorded_reps: reps.length,
  text_files: reps.filter((r) => r.text !== null).length,
  text_sha256: Object.fromEntries(reps.map((r) => [`${r.caseId}/${r.arm}/rep-${r.rep}`, r.text === null ? null : sha256(r.text)])),
  request_identity: {
    all_rest_equal: identity.every((i) => i.rest_equal_to_capture),
    all_instructions_equal_arm_file: identity.every((i) => i.instructions_equal_arm_file),
    M_whole_body_equal: identity.filter((i) => i.arm === 'M').every((i) => i.whole_body_equal_to_capture),
    non_M_whole_body_differs: identity.filter((i) => i.arm !== 'M').every((i) => !i.whole_body_equal_to_capture),
    all_auth_redacted: identity.every((i) => i.auth_redacted),
    rows: identity,
  },
  per_arm: perArm,
  noise_control: noise,
};
const out = join(RUNS, '_runs', `${ledger.run_stamp}-summary.json`);
writeOnce(out, summary);
console.log(`summary: ${out.replace(`${REPO_ROOT}/`, '')} | reps ${reps.length} | text files ${summary.text_files}`);
console.log(`identity: rest_equal=${summary.request_identity.all_rest_equal} instr_equal_arm=${summary.request_identity.all_instructions_equal_arm_file} M_whole_equal=${summary.request_identity.M_whole_body_equal} nonM_differs=${summary.request_identity.non_M_whole_body_differs} auth_redacted=${summary.request_identity.all_auth_redacted}`);
for (const a of perArm) console.log(`  ${a.key.padEnd(36)} n=${a.n} http=${JSON.stringify(a.http)} types=${JSON.stringify(a.outcome_types)} fn=${JSON.stringify(a.function_calls)} words=${JSON.stringify(a.words)} out_tok=${JSON.stringify(a.output_tokens)} reas=${JSON.stringify(a.reasoning_tokens)} wall=${JSON.stringify(a.wall_ms)}`);
console.log(`noise: ${JSON.stringify(noise)}`);
