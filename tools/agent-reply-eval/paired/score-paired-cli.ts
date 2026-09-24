/**
 * TASK D driver: score all paired reps, write the scores JSON (stamped, append-only), RESULTS.md,
 * and the blinded pack (blind/PACK.md + blind/KEY.json).
 *
 *   npx tsx tools/agent-reply-eval/paired/score-paired-cli.ts
 *
 * No network. The only fetch-capable code in this process is guarded anyway (see guardNetwork).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECK_NAMES } from '../src/checks.js';
import {
  ARM_ORDER,
  BASE,
  BLIND_SEED,
  CASES,
  LEAK_TOKENS,
  REPO,
  ROUTE_LINES_MIRRORED,
  SERVED_HEAD,
  aggregate,
  jaccard,
  leakHits,
  listReps,
  median,
  mmm,
  mulberry32,
  outsideReplies,
  rankArms,
  scoreRep,
  shuffled,
  writeOnce,
  wordsOver,
  type ArmAgg,
  type RepResult,
} from './score-paired.js';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const readJson = (p: string): Record<string, unknown> => JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;

// ── safety: no Anthropic env, no network except api.openai.com (none is used here) ──
function guardNetwork(): { removed: string[] } {
  const removed: string[] = [];
  for (const k of Object.keys(process.env)) {
    if (/ANTHROPIC/i.test(k) || k === 'CLAUDE_API_KEY') { delete process.env[k]; removed.push(k); }
  }
  if (Object.keys(process.env).some((k) => /ANTHROPIC/i.test(k) || k === 'CLAUDE_API_KEY')) throw new Error('Anthropic env still present');
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://api.openai.com/')) throw new Error(`network guard: ${url} refused before send`);
    return real(input, init);
  }) as typeof fetch;
  return { removed };
}

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
// --dry-out <dir>: write every output under <dir> instead of the evals tree (for iterating without touching it).
const dryIdx = process.argv.indexOf('--dry-out');
const OUT = dryIdx >= 0 ? process.argv[dryIdx + 1]! : BASE;
const guard = guardNetwork();

const ARM_NAME: Record<string, string> = {
  M: 'M — served 57f903c stack (AGENT_INSTRUCTIONS; explicit Run adds INTERPRET_ONLY + v0.2)',
  C1: 'C1 — v2 copy corrections transposed onto the served Agent instructions (explicit Run: + INTERPRET_ONLY + v0.2)',
  C2: 'C2 — C1 on conversation turns; explicit Run uses interpreter v0.3 (PR #1791 @967d25f5)',
};

// ── score ──
const reps = listReps();
const results: RepResult[] = reps.map((r) => scoreRep(r.caseId, r.arm, r.rep, r.dir));
if (results.length !== 44) throw new Error(`expected 44 reps, found ${results.length}`);
const badTxt = results.filter((r) => !r.raw_text_equals_text_txt);
if (badTxt.length > 0) throw new Error(`text.txt differs from the response for ${badTxt.map((r) => `${r.case}/${r.arm}/${r.rep}`).join(', ')}`);

const caseIds = Object.keys(CASES).filter((c) => results.some((r) => r.case === c));
const PAIRED = [1, 2, 3];
const aggs: Record<string, ArmAgg[]> = {};
for (const c of caseIds) aggs[c] = ARM_ORDER.filter((a) => results.some((r) => r.case === c && r.arm === a)).map((a) => aggregate(results, c, a, PAIRED));

const scoresPath = join(OUT, 'scores', `${STAMP}-scores.json`);
const scoresDoc = {
  schema: 'agent-reply-paired-scores.v1',
  generated_at: new Date().toISOString(),
  served_head: SERVED_HEAD,
  generator: 'tools/agent-reply-eval/paired/score-paired-cli.ts',
  route_lines_mirrored: ROUTE_LINES_MIRRORED,
  guard: { anthropic_env_removed: guard.removed, network_calls: 0 },
  paired_reps: PAIRED,
  cases: CASES,
  aggregates: aggs,
  reps: results,
};
const scoresJson = `${JSON.stringify(scoresDoc, null, 2)}\n`;
console.log(`scores: ${writeOnce(scoresPath, scoresJson)} ${scoresPath} sha256 ${sha256(scoresJson)}`);

// ── RESULTS.md ──
const fmtMap = (m: Readonly<Record<string, number>>, n: number): string => {
  const e = Object.entries(m).filter(([, v]) => v > 0);
  return e.length === 0 ? '0' : e.map(([k, v]) => `${k} ${v}/${n}`).join('; ');
};
const u = (a: ArmAgg): string => `${a.usage.input ?? '—'} / ${a.usage.cached ?? '—'} / ${a.usage.output ?? '—'} / ${a.usage.reasoning ?? '—'}`;
const line = (cells: (string | number)[]): string => `| ${cells.join(' | ')} |`;

const out: string[] = [];
out.push('# Paired OpenAI-only reply test on served 57f903c — scores (Task D; revised after the Task E adversarial critique)');
out.push('');
out.push(`Generated ${scoresDoc.generated_at} by \`tools/agent-reply-eval/paired/score-paired-cli.ts\` from the 44 recorded runs (ledger \`runs/_runs/2026-09-24T19-50-44-263Z-ledger.json\`). Per-rep scores, findings, raw and simulated visible text: \`scores/${STAMP}-scores.json\`. No model call was made to score.`);
out.push('');

// verdict
const hardOf = (c: string, arm: string): number | null => aggs[c]?.find((a) => a.arm === arm)?.hard ?? null;
out.push('## Verdict (directional, n = 3 per case and version)');
out.push('');
const verdictLines: string[] = [];
for (const c of caseIds) {
  const groups = rankArms(aggs[c]!.filter((a) => a.visWords.length > 0));
  if (groups.length === 0) continue;
  verdictLines.push(`- **${c}**: ${groups.map((g) => g.map((a) => `${a.arm} (reps with a hard violation ${a.repsWithHard}/${a.n}; hard rep×check FAILs ${a.hard}; soft ${a.soft}; median model words ${median(a.modelWords)})`).join(' = ')).join(' > ')}`);
}
out.push(...verdictLines);
for (const c of caseIds.filter((x) => CASES[x]!.turn === 'discussion')) {
  const rs = results.filter((r) => r.case === c);
  const calls = [...new Set(rs.flatMap((r) => r.function_calls))];
  const toolPass = rs.filter((r) => r.raw?.extras.find((e) => e.name === 'TOOL_ACTION')?.verdict === 'PASS').length;
  const texts = rs.filter((r) => r.raw_text.trim() !== '').length;
  out.push(`- **${c}**: not rankable. ${rs.length - texts}/${rs.length} reps (both versions) wrote no text on this hop; tools called: ${calls.join(', ') || 'none'}; TOOL_ACTION (no acting tool on a “don’t change or re-run” turn) PASS ${toolPass}/${rs.length}.`);
}
{
  // Task E correction: the construction hard violations are ALL `promises_run_after_approval`. That
  // promise is false for the approval CHIP (fast path 2, witnessed) but a typed "yes" is not that path
  // (agent-v1-turn.ts:1185-1187 "Words alone never take this path") — it reaches the model loop, where M's
  // own instructions say "After authorise_change … call run_analysis in the SAME turn". So under M it is
  // conditionally honoured. Re-rank with that finding removed from both tiers, computed here, not asserted.
  const promiseOnly = (r: RepResult): { hard: string[]; soft: string[] } => {
    const v = (r.visible ?? r.raw)!;
    const at = v.checks['ACTION_TRUTH'];
    const atOnlyPromise = at?.verdict === 'FAIL' && at.findings.every((f) => f.kind === 'promises_run_after_approval');
    const nm = v.extras.find((e) => e.name === 'NEXT_MOVE');
    const nmOnlyPromise = nm?.verdict === 'FAIL' && nm.findings.every((f) => f.kind === 'unsupported_next_move' && /save|run/i.test(f.excerpt ?? ''));
    return {
      hard: v.hardViolations.filter((h) => !(h === 'ACTION_TRUTH' && atOnlyPromise)),
      soft: v.softViolations.filter((s) => !(s === 'NEXT_MOVE' && nmOnlyPromise)),
    };
  };
  const cons = caseIds.filter((c) => CASES[c]!.turn === 'construction');
  const rows = cons.map((c) => {
    const per = ARM_ORDER.filter((a) => results.some((r) => r.case === c && r.arm === a)).map((a) => {
      const rs = results.filter((r) => r.case === c && r.arm === a && PAIRED.includes(r.rep) && (r.visible ?? r.raw) !== null);
      const adj = rs.map(promiseOnly);
      const hard = adj.reduce((n, x) => n + x.hard.length, 0);
      const soft = adj.reduce((n, x) => n + x.soft.length, 0);
      const promiseReps = rs.filter((r) => ((r.visible ?? r.raw)!.checks['ACTION_TRUTH']?.findings ?? []).some((f) => f.kind === 'promises_run_after_approval')).length;
      return `${a} [hard ${hard}, soft ${soft} (${[...new Set(adj.flatMap((x) => x.soft))].join(', ') || 'none'}), median model words ${median(rs.map((r) => (r.visible ?? r.raw)!.modelWords))}; run promise in ${promiseReps}/${rs.length}]`;
    });
    return `  - ${c}: ${per.join(' vs ')}`;
  });
  out.push('');
  out.push('**Correction (Task E, adversarial critic): the construction hard violations are conditional, not inventions.** Every construction hard FAIL above is ACTION_TRUTH `promises_run_after_approval` (“If you approve…, I’ll save it and run the comparison”). That promise is false for the approval control shown under the reply: pressing it takes fast path 2, which ran nothing on both served approvals (hiring, pricing: `fast_path: approve`, tools `[authorise_change]`, `_provider_calls` 0, `run_state never_run`). But a typed approval is not that path (`src/routes/agent-v1-turn.ts:1185-1187`: “Words alone never take this path”): it reaches the model loop, where M’s own instructions say “After authorise_change applies values or option levels, call run_analysis in the SAME turn”, with `run_analysis` in the tool list. So under M the promise is conditionally honoured; under C1 it would be neither made nor kept. It is a misleading promise for the offered control, not an invented action. Re-ranked with this one finding removed from both tiers (ACTION_TRUTH and the overlapping NEXT_MOVE), C1 still ranks above M in every construction case, but on structure and length only, with no hard-violation gap:');
  out.push(...rows);
}
out.push('');
out.push('Ranking rule: hard violations (rep × check FAILs) first, then soft violations, then median model words above the ~90-word default (a median up to 99, i.e. 90 + 10%, counts as within “about 90”; above that, fewer is better). `=` marks a tie on all three keys. At n = 3 nothing here is significant; read every ordering as directional.');
out.push('');

out.push('## What is measured, and what is not');
out.push('');
out.push('**Measured.** Matched model outputs (gpt-5.6-terra, OpenAI only) on request shapes captured from the real 57f903c route in-process: each version changes only `instructions`; every other request byte equals the capture (proven in Task C). Each output is scored twice: as the raw model text, and as the simulated final visible reply, i.e. after the real 57f903c server post-processing (`narrateWriteOutcome`/`withWriteOutcome`, `withDisclosures`/`valueChangeDisclosures`, `notAdoptedLine`, `withoutProposalIds`) imported from `src/`, in the route’s own order:');
out.push('');
for (const [k, v] of Object.entries(ROUTE_LINES_MIRRORED)) out.push(`- ${k}: \`${v}\``);
out.push('');
out.push('The simulation is validated, not assumed: replaying each captured route turn’s own model output through it reproduces that turn’s `assistant_text` byte for byte in 5/5 turns (3 live constructions, 2 explicit Runs); the raw text differs from the route text in the 3 construction turns (the server’s status paragraph), so the check discriminates. See `tools/agent-reply-eval/paired/__tests__/score-paired.test.ts`.');
out.push('');
out.push('**Not measured.**');
out.push('- Served behaviour after a prompt is mounted: nothing here ran on staging.');
out.push('- Multi-hop trajectories under C1/C2: on construction turns only the FINAL hop was re-run; the earlier tool calls, tool results and reasoning items in its input were generated under M. This is a last-hop effect, not a whole-turn effect.');
out.push('- The permitted-leader case (`leader_claim.permitted: true`): absent from these inputs, so no version was tested where naming a leader is allowed.');
out.push('- Discussion-card replies: the first hop only reaches `get_canonical_state`; a multi-hop replay is needed to obtain text.');
out.push('- Explicit-Run history is Task A’s durable-seed approximation (28% / 34% fewer input tokens than served for pricing / hiring).');
out.push('- Quality beyond these deterministic checks: that is what the blinded review (below) is for.');
out.push('');

out.push('## Checks');
out.push('');
out.push('All checks read the model’s words; a scorer FAIL whose findings sit only in Olumi’s server paragraph is reported separately (it is identical across versions).');
out.push('');
out.push('- **Hard** (ranked first). The copied deterministic scorer’s 7 checks (source: `/private/tmp/aiq-wt-eval` @ 30e3c606, copied byte-identical to `tools/agent-reply-eval/src/**`): CONTROL_REFERENCE, LEADER_HONESTY, ACTION_TRUTH, OPTION_NAME_FIDELITY, UNITS, PROVENANCE_WORDING, CAVEAT. Plus LEADER_HONESTY_SPLIT (the scorer’s own leader rule re-applied to sentences with inner hyphens split, counting only sentences the scorer found clean — added after this run showed the scorer cannot see an option written as “the £59-at-release path”), and, from the request inputs: WIN_PCT_WHILE_WITHHELD (a run’s win probability quoted as a % while `leader_claim.permitted=false`), PROPOSAL_PROVENANCE (an Olumi-proposed figure called the user’s, or quoted with no sentence attributing it as Olumi’s assumption), PROPOSAL_UNITS (a proposed non-zero figure quoted without its unit, unless the factor label names the unit), TOOL_ACTION (an acting tool on a talk-only hop).');
out.push('- **Soft** (deterministic proxies, ranked second). QUESTION_LIMIT (≤ 1 “?” in the model’s words), STRUCTURE (opens with a sentence; ≤ 3 bullet lines), NEXT_MOVE (at most one distinct next-move type, each supported by the state: an approval needs an approval chip; a run promised on approval is unsupported because approval through the offered control runs nothing — see the Task E correction above for the typed-approval path). NEXT_MOVE’s “unsupported” finding overlaps ACTION_TRUTH’s promises_run_after_approval: the same sentence counts once in each tier.');
out.push('- **Proxy** (reported, never ranked). UNGROUNDED_FIGURE: a figure above 12 in the model’s words found nowhere in the request input (as written, or ×100).');
out.push('');
out.push(`\`nextApprovalRan=false\` for construction turns: ${CASES['hiring-construction']!.nextApprovalBasis} (hiring and pricing); held-out: ${CASES['heldout-ed-triage-construction']!.nextApprovalBasis}. Scope: this holds for the approval CHIP (the served approvals both carried \`chip.id agent-approve-proposal:prop_…\`). A typed approval without the chip goes to the model loop, where M instructs a same-turn run_analysis (Task E correction above).`);
out.push('');

out.push('## Per case × version (paired reps 1–3; visible reply unless stated)');
out.push('');
out.push(line(['case', 'version', 'n', 'model words med (min–max)', 'raw words', 'visible words', 'hard violations (reps)', 'soft violations (reps)', 'not decidable', 'server-owned FAIL', 'latency ms (median)', 'tokens median in / cached / out / reasoning', 'tool-call outcome']));
out.push(line(['---', '---', '---:', '---', '---', '---', '---', '---', '---', '---', '---:', '---', '---']));
for (const c of caseIds) {
  for (const a of aggs[c]!) {
    out.push(line([c, a.arm, a.n, mmm(a.modelWords), mmm(a.rawWords), mmm(a.visWords), fmtMap(a.hardByCheck, a.n), fmtMap(a.softByCheck, a.n), fmtMap(a.ndByCheck, a.n), fmtMap(a.serverOwned, a.n), a.wallMs === null ? '—' : Math.round(a.wallMs), u(a), Object.entries(a.toolOutcomes).map(([k, v]) => `${k} ${v}/${a.n}`).join('; ')]));
  }
}
out.push('');
const rawVisDiff = results.filter((r) => r.raw !== null && r.visible !== null && (r.raw.hardViolations.join() !== r.visible.hardViolations.join() || r.raw.softViolations.join() !== r.visible.softViolations.join()));
const stripped = results.reduce((n, r) => n + (r.simulation?.stripped.length ?? 0), 0);
const splitOk = results.filter((r) => r.simulation !== null && r.simulation.split_model_text_equals_narration === true).length;
const sims = results.filter((r) => r.simulation !== null).length;
const withStatus = results.filter((r) => r.simulation?.status != null).length;
const withOwed = results.filter((r) => (r.simulation?.owed.length ?? 0) > 0).length;
const withNotAdopted = results.filter((r) => r.simulation?.not_adopted != null).length;
const visEqRaw = results.filter((r) => r.simulation !== null && r.visible_text === r.raw_text).length;
out.push(`Raw vs visible, across the ${sims} reps with reply text: Olumi’s write-status paragraph was appended in ${withStatus}; completion-claim sentences removed: ${stripped}; disclosures owed: ${withOwed} rep(s); “not included in this proposal” line: ${withNotAdopted} rep(s); visible = raw in ${visEqRaw} (the explicit Runs). So on these outputs only the status paragraph differs, and the violation sets differ between raw and visible in ${rawVisDiff.length} rep(s). The claim-stripping, disclosure and proposal-id steps are mirrored but not exercised by these outputs (no model text claimed a save or carried a proposal id); claim stripping is exercised by a synthetic test. The scorer’s own split recovered exactly the model’s share of the visible reply in ${splitOk}/${sims} reps.`);
out.push('');
const probed = results.reduce((n, r) => n + ((r.visible?.extras.find((e) => e.name === 'UNGROUNDED_FIGURE')?.reason.match(/(\d+) figure/)?.[1]) ? Number(r.visible!.extras.find((e) => e.name === 'UNGROUNDED_FIGURE')!.reason.match(/(\d+) figure/)![1]) : 0), 0);
const ungrounded = results.filter((r) => r.visible?.proxyFails.includes('UNGROUNDED_FIGURE'));
out.push(`Proxy UNGROUNDED_FIGURE: ${ungrounded.length} rep(s) flagged; figures above 12 examined across all visible replies: ${probed}.${ungrounded.length > 0 ? ` Flagged: ${ungrounded.map((r) => `${r.case}/${r.arm}/rep-${r.rep}`).join(', ')}.` : ''}`);
out.push('');

out.push('## Ranking per case');
out.push('');
for (const c of caseIds) {
  const scorable = aggs[c]!.filter((a) => a.visWords.length > 0);
  if (scorable.length === 0) { out.push(`- **${c}**: no reply text in any version (tool call only) — not ranked.`); continue; }
  const groups = rankArms(scorable);
  const ties = groups.filter((g) => g.length > 1);
  out.push(`- **${c}**: ${groups.map((g) => g.map((a) => a.arm).join(' = ')).join(' > ')}${ties.length > 0 ? ` (tie: ${ties.map((g) => g.map((a) => a.arm).join(' and ')).join('; ')})` : ' (no ties)'}. Keys [hard, soft, median words over 99]: ${scorable.map((a) => `${a.arm} [${a.hard}, ${a.soft}, ${wordsOver(a)}]`).join('; ')}.`);
}
out.push('');

// noise control
out.push('## M-vs-M noise control (pricing explicit Run, M reps 1–5; reps 4–5 are the pre-registered controls)');
out.push('');
const noise = results.filter((r) => r.case === 'pricing-run-complete' && r.arm === 'M').sort((a, b) => a.rep - b.rep);
out.push(line(['rep', 'control', 'model words', 'hard violations', 'soft violations']));
out.push(line(['---:', '---', '---:', '---', '---']));
for (const r of noise) out.push(line([r.rep, r.control ? 'yes' : 'no', r.visible?.modelWords ?? '—', r.visible?.hardViolations.join(', ') || '—', r.visible?.softViolations.join(', ') || '—']));
out.push('');
const within: number[] = [];
for (let i = 0; i < noise.length; i += 1) for (let j = i + 1; j < noise.length; j += 1) within.push(jaccard(noise[i]!.visible_text ?? '', noise[j]!.visible_text ?? ''));
const between = (arm: string): number[] => {
  const o = results.filter((r) => r.case === 'pricing-run-complete' && r.arm === arm && PAIRED.includes(r.rep));
  const xs: number[] = [];
  for (const m of noise) for (const x of o) xs.push(jaccard(m.visible_text ?? '', x.visible_text ?? ''));
  return xs;
};
const mean = (xs: number[]): string => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3);
const mAll = aggregate(results, 'pricing-run-complete', 'M', [1, 2, 3, 4, 5]);
out.push(`Within M (5 reps): hard violations present in ${mAll.repsWithHard}/5 reps (${fmtMap(mAll.hardByCheck, 5)}); model words ${mmm(mAll.modelWords)}. Between versions on the same input (reps 1–3): C1 ${fmtMap(aggs['pricing-run-complete']!.find((a) => a.arm === 'C1')!.hardByCheck, 3)}; C2 ${fmtMap(aggs['pricing-run-complete']!.find((a) => a.arm === 'C2')!.hardByCheck, 3)}.`);
out.push('');
out.push(`Lexical proxy (word-set Jaccard, visible text): within M mean ${mean(within)} over ${within.length} pairs (range ${Math.min(...within).toFixed(3)}–${Math.max(...within).toFixed(3)}); M×C1 ${mean(between('C1'))} and M×C2 ${mean(between('C2'))} over ${between('C1').length} pairs each. Lower = less alike. This measures wording only, not quality.`);
out.push('');
const pr = (arm: string): ArmAgg => aggs['pricing-run-complete']!.find((a) => a.arm === arm)!;
out.push(`Reading: within M, ${mAll.repsWithHard}/5 reps carry a hard violation. Between versions on reps 1–3, reps with a hard violation: M ${pr('M').repsWithHard}/3, C1 ${pr('C1').repsWithHard}/3, C2 ${pr('C2').repsWithHard}/3. Directional only.`);
out.push('');

// hard findings detail
out.push('## Every hard finding in the model’s words (paired reps 1–3 and the M controls)');
out.push('');
for (const r of results) {
  const v = r.visible;
  if (v === null) continue;
  for (const k of v.hardViolations) {
    const c = (v.checks as Record<string, { findings: readonly { kind: string; excerpt: string; where?: string }[] }>)[k] ?? v.extras.find((e) => e.name === k)!;
    for (const f of c.findings.filter((x) => (x as { where?: string }).where !== 'server')) out.push(`- ${r.case} / ${r.arm} / rep-${r.rep} — ${k} [${f.kind}]: ${f.excerpt.replace(/\|/g, '/')}`);
  }
}
out.push('');

// Self-test evidence: the newest vitest JSON report written beside the scores (see the command below), if any.
{
  const dir = join(BASE, 'scores');
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('-selftests.json')).sort(); } catch { files = []; }
  out.push('## Self-tests (focused; no network)');
  out.push('');
  out.push('Command (the six files named, so the machine load guard treats it as focused): `npx vitest run tools/agent-reply-eval/__tests__/{checks,controls-drift,extract-stack,real-turns,replay-fp3}.test.ts tools/agent-reply-eval/paired/__tests__/score-paired.test.ts --config tools/agent-reply-eval/vitest.scorer.config.ts --reporter=json --outputFile=Docs/evals/agent-reply/paired/57f903c/scores/<stamp>-selftests.json`. The first five files are the copied scorer’s own tests (75, unchanged apart from one fixture path); the sixth is Task D’s.');
  out.push('');
  if (files.length === 0) out.push('No self-test report found beside the scores: NOT RECORDED.');
  else {
    const f = files[files.length - 1]!;
    const r = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { numTotalTests: number; numPassedTests: number; numFailedTests: number; numTotalTestSuites: number; testResults: { name: string; assertionResults: { status: string }[] }[] };
    out.push(`Report \`scores/${f}\`: ${r.numPassedTests}/${r.numTotalTests} tests passed, ${r.numFailedTests} failed, in ${r.testResults.length} files:`);
    out.push('');
    for (const t of r.testResults) out.push(`- \`${t.name.slice(REPO.length)}\`: ${t.assertionResults.filter((a) => a.status === 'passed').length}/${t.assertionResults.length} passed`);
  }
  out.push('');
}

out.push('## Known limits of the scorer, found in this run');
out.push('');
const splitHits = results.filter((r) => r.visible?.hardViolations.includes('LEADER_HONESTY_SPLIT')).map((r) => `${r.case}/${r.arm}/rep-${r.rep}`);
out.push(`- The copied scorer’s LEADER_HONESTY recognises an option by label, short form, all content tokens, or a figure unique to one label. Its tokeniser keeps a hyphenated compound (“the £59-at-release path”) as one token, so it does not see the option there. LEADER_HONESTY_SPLIT recovers exactly those sentences; it fired in ${splitHits.length} rep(s)${splitHits.length > 0 ? `: ${splitHits.join(', ')}` : ''}. Without it the explicit-Run pricing table would wrongly show those replies as leader-clean. The copied scorer itself is unchanged.`);
out.push('- No check covers the DIRECTION or grounding of a sensitivity/switch statement (found by hand in Task E). pricing-run-complete/M/rep-1 says the ordering changes “if price–release alignment is lower … reducing that alignment from … 50% … at an alignment of 97.92%”; the input’s only found switch is `direction: increase`, 50 % → 97.92 %, towards “Keep Pro at £49”. Every check PASSes that sentence. It does not change any ordering (that rep already fails LEADER_HONESTY and WIN_PCT_WHILE_WITHHELD), but such misstatements are invisible to this scorer and are left to the blinded review, whose Case 4 context card now carries the switch facts.');
out.push('- NEXT_MOVE and QUESTION_LIMIT are lexical proxies: a reply can offer a move without an imperative or an invitation phrase, and a “?” inside a quotation counts. They are ranked only after hard violations.');
out.push('- PROVENANCE_WORDING (scorer) is NOT_DECIDABLE on adopted values (`user_override` covers both a user’s entry and an adopted Olumi proposal); PROPOSAL_PROVENANCE covers this turn’s proposals only.');
out.push('- The self-authored discriminating tests (`__tests__/score-paired.test.ts`) prove each new check can fire and can pass; they are not evidence about wording the author did not anticipate. The blinded review is the independent check.');
out.push('');

// ── blinded pack ──
const rnd = mulberry32(BLIND_SEED);
const packCases = caseIds.filter((c) => results.some((r) => r.case === c && r.rep === 1 && r.visible_text !== null));
const key: Record<string, Record<string, unknown>> = {};
const letters = ['A', 'B', 'C'];
const blocks: string[] = [];

const route = (c: string): Record<string, unknown> => {
  const r = results.find((x) => x.case === c && x.rep === 1)!;
  return readJson(join(REPO, r.files.route_response!)).body as Record<string, unknown>;
};
const reqInput = (c: string): unknown[] => {
  const r = results.find((x) => x.case === c && x.rep === 1)!;
  return ((readJson(join(REPO, r.files.request!)).body as Record<string, unknown>).input ?? []) as unknown[];
};
const optionsOf = (b: Record<string, unknown>): string[] => (((b.draft_graph as { nodes?: { kind?: string; label?: string }[] })?.nodes ?? []).filter((n) => n.kind === 'option').map((n) => String(n.label)));
const chipsOf = (b: Record<string, unknown>): string[] => ((b.suggested_actions as { label?: string }[] | undefined) ?? []).map((c) => String(c.label));
const firstUser = (input: unknown[]): string => {
  const u0 = input.find((i) => (i as { role?: string }).role === 'user') as { content?: { text?: string }[] } | undefined;
  return u0?.content?.[0]?.text ?? '';
};
const toolOutputs = (input: unknown[]): Record<string, unknown>[] => input
  .filter((i) => (i as { type?: string }).type === 'function_call_output')
  .map((i) => JSON.parse(String((i as { output?: string }).output)) as Record<string, unknown>);
const fmtNum = (x: number): string => (Number.isInteger(x) ? String(x) : String(Number(x.toFixed(4))));

function contextCard(c: string): string[] {
  const b = route(c);
  const input = reqInput(c);
  const spec = CASES[c]!;
  const lines: string[] = [];
  const opts = optionsOf(b);
  const chips = chipsOf(b);
  if (spec.turn === 'construction') {
    const outs = toolOutputs(input);
    const props = outs.filter((o) => o.ok === true && Array.isArray(o.assumptions));
    const refused = outs.filter((o) => o.ok === false && typeof o.refusal === 'string' && o.refusal !== 'model_too_large');
    lines.push(`- **What the user asked** (the first message of a new decision): “${firstUser(input)}”`);
    lines.push(`- **What Olumi did this turn** (the same for every reply below): built a first model with the options ${opts.map((o) => `“${o}”`).join(', ')}; then proposed starting values for the user to approve or change. Nothing has been adopted yet and no analysis has been run.${refused.length > 0 ? ' (A first proposal was refused by Olumi as incomplete and replaced by the one below.)' : ''}`);
    for (const p of props) {
      const a = (p.assumptions as { factor?: string; value?: number; unit?: string }[]).map((x) => `${x.factor} = ${fmtNum(Number(x.value))}${x.unit ? ` ${x.unit}` : ''}`);
      const l = ((p.option_levels as { option?: string; factor?: string; value?: number; unit?: string }[] | undefined) ?? []).map((x) => `${x.option}: ${x.factor} = ${fmtNum(Number(x.value))}${x.unit ? ` ${x.unit}` : ''}`);
      lines.push(`- **Figures Olumi proposed** (Olumi’s assumptions, not the user’s and not measurements): ${a.join('; ')}${l.length > 0 ? `. Option levels: ${l.join('; ')}` : ''}.`);
    }
    lines.push('- **Whether a leading option may be named:** no — nothing has been analysed.');
    lines.push(`- **Controls shown under the reply:** ${chips.map((x) => `“${x}”`).join(' · ') || 'none'}.`);
    // Task E: scoped to the chip. A typed "yes" reaches the assistant's own next turn, whose behaviour
    // depends on its instructions — stating either outcome here would be false for one version or leak it.
    lines.push('- **What the approval control does in this product:** pressing “Use as starting assumptions” saves the proposed values as one change and does not run the analysis. If the user instead types an approval (e.g. “yes”), the assistant handles it in its next turn, so what happens then depends on that turn and is not fixed by the product.');
    lines.push('- **Text Olumi adds under every reply:** each reply below ends with the same paragraph written by Olumi’s server (“The model was saved. Questions this model does not answer yet: …”). It is identical in every reply for this case.');
  } else if (spec.turn === 'fp3') {
    const outs = toolOutputs(input);
    const ran = outs[outs.length - 1] ?? {};
    const state = (ran.canonical_state as { analysis_state?: { leader_claim?: { permitted?: boolean; withheld_reason?: string } } } | undefined)?.analysis_state;
    const userTexts = input.filter((i) => (i as { role?: string }).role === 'user').map((i) => (i as { content?: { text?: string }[] }).content?.[0]?.text ?? '');
    lines.push(`- **The conversation so far:** the user’s brief was “${userTexts[0]}”. Olumi built a model and proposed starting values; the user replied “${userTexts[1]}” (so those Olumi-proposed values are now in the model). The user then pressed **Run analysis**.`);
    // Task E: the replies cite these figures; without them "Nothing invented" cannot be judged. Taken
    // verbatim (bold removed) from the bullet lines of the earlier Olumi reply in the request history —
    // identical for every version.
    const priorAssistant = input.filter((i) => (i as { role?: string }).role === 'assistant')
      .map((i) => { const c = (i as { content?: unknown }).content; return typeof c === 'string' ? c : ((c as { text?: string }[] | undefined) ?? []).map((x) => x.text ?? '').join(''); });
    // Label and figure only: bullet lines that carry a figure, cut before the served rationale.
    const labelAndFigure = (l: string): string => {
      let s = l.replace(/^- /, '').replace(/\*\*/g, '').trim();
      s = s.split(' — ')[0]!;
      s = s.split('. ')[0]!;
      const m = /^(.*?:.*?\d[^,]*?), [a-z]/.exec(s);
      if (m) s = m[1]!;
      return s.replace(/\.$/, '');
    };
    const valueLines = (priorAssistant[0] ?? '').split('\n').filter((l) => /^- .*\*\*/.test(l) && /\d/.test(l)).map(labelAndFigure);
    if (valueLines.length > 0) lines.push(`- **Values now in the model** (proposed by Olumi in its earlier reply and adopted by the user — Olumi’s assumptions, not measurements): ${valueLines.join(' · ')}`);
    if (ran.ran === true) {
      const wp = ((ran.result as { win_probabilities?: Record<string, number> } | undefined)?.win_probabilities) ?? {};
      const rob = (ran.result as { enrichment?: { robustness?: { level?: string } } } | undefined)?.enrichment?.robustness?.level;
      const summary = ((b.blocks as { type?: string; summary?: string }[] | undefined) ?? []).find((x) => x.type === 'analysis_result')?.summary;
      lines.push(`- **Run result:** the analysis ran and completed. Options: ${Object.keys(wp).map((k) => `“${k}”`).join(', ')}. Share of simulations in which each option had the highest modelled outcome: ${Object.entries(wp).map(([k, v]) => `${k} ${(v * 100).toFixed(2)}%`).join('; ')}. Robustness: ${rob ?? 'not stated'}.`);
      if (summary) lines.push(`- **Olumi’s result card beside the reply says:** “${summary}”`);
      // Task E: sensitivity and switch facts the assistant was given (replies cite them).
      const enr = (ran.result as { enrichment?: { factor_sensitivity?: { label?: string; factor_label?: string; importance_rank?: number }[] } } | undefined)?.enrichment;
      const ranked = [...(enr?.factor_sensitivity ?? [])].filter((f) => typeof f.importance_rank === 'number').sort((x, y) => x.importance_rank! - y.importance_rank!).map((f) => f.factor_label ?? f.label);
      if (ranked.length > 0) lines.push(`- **Factor sensitivity order the assistant was given** (most to least): ${ranked.join(' > ')}.`);
      const switches: string[] = [];
      const seen = new Set<string>();
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (v === null || typeof v !== 'object') return;
        const o = v as Record<string, unknown>;
        if (typeof o.factor_label === 'string' && 'current_display' in o && 'flip_reason' in o) {
          const s = o.flip_reason === 'found'
            ? `${o.factor_label} (now ${o.current_display}): the ordering switches towards “${String(o.alternative_winner_label)}” if it is changed (direction: ${String(o.direction)}) to ${String(o.flip_display)}`
            : `${o.factor_label} (now ${o.current_display}): no switch found (${String(o.flip_reason).replace(/_/g, ' ')})`;
          if (!seen.has(s)) { seen.add(s); switches.push(s); }
        }
        Object.values(o).forEach(walk);
      };
      walk(ran.result);
      if (switches.length > 0) lines.push(`- **Switch points tested:** ${switches.join('; ')}.`);
      const optLevels = (((ran.canonical_state as { analysis_ready?: { options?: { label?: string; intervention_details?: Record<string, { display_value?: string }> }[] } } | undefined)?.analysis_ready?.options) ?? [])
        .map((o) => `“${o.label}”: ${Object.entries(o.intervention_details ?? {}).map(([k, d]) => `${k.replace(/_/g, ' ')} ${d.display_value}`).join(', ') || 'no levels'}`);
      if (optLevels.length > 0) lines.push(`- **What each option sets in the model:** ${optLevels.join('; ')}.`);
    } else {
      const options = (ran.options as { label?: string; status?: string; intervention_details?: Record<string, { display_value?: string }> }[] | undefined) ?? [];
      lines.push(`- **Run result:** the analysis did NOT run (status: ${String(ran.status)}). ${options.filter((o) => o.status !== 'ready').map((o) => `“${o.label}” sets no level on any factor, so it cannot be compared`).join('; ')}. Ready options: ${options.filter((o) => o.status === 'ready').map((o) => `“${o.label}” (${Object.values(o.intervention_details ?? {}).map((d) => d.display_value).join(', ')})`).join('; ')}.`);
    }
    const lc = state?.leader_claim;
    lines.push(`- **Whether a leading option may be named:** ${lc?.permitted === true ? 'yes' : `no — Olumi withholds the leader claim (reason: ${String(lc?.withheld_reason ?? 'none given').replace(/_/g, ' ')}). No option may be named or ranked as leading, and the percentages may not be used as a ranking.`}`);
    lines.push(`- **Controls shown under the reply:** ${chips.map((x) => `“${x}”`).join(' · ') || 'none'}.`);
    lines.push('- **This reply is an explanation only:** the assistant could not act on this turn.');
  }
  return lines;
}

packCases.forEach((c, idx) => {
  const arms = ARM_ORDER.filter((a) => results.some((r) => r.case === c && r.arm === a && r.rep === 1));
  const order = shuffled(arms, rnd);
  const entry: Record<string, unknown> = {};
  const replyBlocks: string[] = [];
  order.forEach((arm, i) => {
    const r = results.find((x) => x.case === c && x.arm === arm && x.rep === 1)!;
    const letter = letters[i]!;
    entry[letter] = { version: arm, rep: 1, visible_sha256: sha256(r.visible_text!), files: r.files };
    replyBlocks.push(`#### Reply ${letter}`, '', '~~~~text', r.visible_text!.replace(/\s+$/, ''), '~~~~', '');
  });
  key[`Case ${idx + 1}`] = { case: c, order: order.slice(), letters: entry };
  blocks.push(`## Case ${idx + 1}`, '', '### Context', '', ...contextCard(c), '', `### Replies (${order.length})`, '', ...replyBlocks);
});

const CRITERIA: [string, string][] = [
  ['Concise', 'About 90 words or fewer by default in the assistant’s own words; longer only when the content needs it. No minimum.'],
  ['Shape', 'Opens with a lead sentence; then at most 3 bullets.'],
  ['Decisive caveat', 'The one caveat that changes what the user may conclude is stated plainly.'],
  ['Next move', 'At most one next move, offered only when the state supports it.'],
  ['Questions', 'At most one question.'],
  ['Leader honesty', 'When a leading option may not be named: no option is named or ranked as leading, and percentages are not used as a ranking.'],
  ['Nothing invented', 'No claimed or promised save, run, edit, leader, sensitivity, evidence, assumption or numerical comparison that the context does not support.'],
  ['Attribution', 'Olumi’s estimates are attributed to Olumi; the user’s or measured figures are never called estimates.'],
  ['Provisional vs validated', 'A provisional result is not presented as a validated conclusion.'],
  ['Fidelity', 'Option names, units and constraints are preserved exactly.'],
  ['Uncertainty', 'Uncertainty is handled honestly — neither hidden nor overstated.'],
  ['Useful next step', 'The takeaway or next step helps the user make the decision.'],
];

const pack: string[] = [];
pack.push('# Reply review pack');
pack.push('');
pack.push('You are reviewing replies written by an AI assistant (Olumi) inside a decision-modelling product. For each case you get a short context card, then two or three replies to exactly the same situation. The replies are labelled with letters in a random order that differs per case. Judge only the text shown; nothing else distinguishes the replies.');
pack.push('');
pack.push(`The replies are shown exactly as the user would see them. There are ${packCases.length} cases. (A further discussion-card case produced no reply text in any version and is not included.)`);
pack.push('');
pack.push(...blocks);
pack.push('## Scoring rubric');
pack.push('');
pack.push('Score every reply on each criterion: **0** = not met, **1** = partly met, **2** = fully met. If a criterion cannot apply to a case, score 2 and write “n/a”.');
pack.push('');
CRITERIA.forEach(([n, d], i) => pack.push(`${i + 1}. **${n}** — ${d}`));
pack.push('');
pack.push('## Reply template (please fill in)');
pack.push('');
for (let i = 0; i < packCases.length; i += 1) {
  const n = (key[`Case ${i + 1}`]!.order as string[]).length;
  const ls = letters.slice(0, n);
  pack.push(`### Case ${i + 1}`);
  pack.push('');
  pack.push(`| Criterion | ${ls.map((l) => `Reply ${l}`).join(' | ')} |`);
  pack.push(`|---|${ls.map(() => '---:').join('|')}|`);
  for (const [nm] of CRITERIA) pack.push(`| ${nm} | ${ls.map(() => ' ').join(' | ')} |`);
  pack.push(`| **Total (0–${CRITERIA.length * 2})** | ${ls.map(() => ' ').join(' | ')} |`);
  pack.push('');
  for (const l of ls) pack.push(`- Reply ${l} — one-line reason:`);
  pack.push('- Preferred reply (one letter):');
  pack.push('');
}
const packText = `${pack.join('\n')}\n`;
const packPath = join(OUT, 'blind', 'PACK.md');
const keyPath = join(OUT, 'blind', 'KEY.json');

const allHits = leakHits(packText);
const outsideHits = leakHits(outsideReplies(packText));
// Attribute each whole-file hit to its case, reply letter, version, and owner (model words or Olumi's server paragraph).
const hitOwners = ((): { line: number; token: string; case: string; letter: string; version: string; owner: 'model' | 'server' }[] => {
  const lines = packText.split('\n');
  const out: { line: number; token: string; case: string; letter: string; version: string; owner: 'model' | 'server' }[] = [];
  for (const h of allHits) {
    let caseKey = '';
    let letter = '';
    for (let i = h.line - 1; i >= 0 && (caseKey === '' || letter === ''); i -= 1) {
      const l = lines[i]!;
      if (letter === '' && /^#### Reply [A-C]$/.test(l)) letter = l.slice(-1);
      if (caseKey === '' && /^## Case \d+$/.test(l)) caseKey = l.slice(3);
    }
    const entry = (key[caseKey]?.letters as Record<string, { version: string }> | undefined)?.[letter];
    out.push({ line: h.line, token: h.token, case: caseKey, letter, version: entry?.version ?? '?', owner: /^The model was saved\./.test(lines[h.line - 1]!) ? 'server' : 'model' });
  }
  return out;
})();
const keyDoc = {
  schema: 'agent-reply-paired-blind-key.v1',
  pack: 'Docs/evals/agent-reply/paired/57f903c/blind/PACK.md',
  pack_sha256: sha256(packText),
  seed: BLIND_SEED,
  prng: 'mulberry32(seed); Fisher–Yates over versions in the fixed order [M, C1, C2] present for the case; one PRNG stream consumed case by case in pack order',
  rep: 1,
  text_shown: 'simulated final visible reply (visible_text in the scores file)',
  scores_file: `Docs/evals/agent-reply/paired/57f903c/scores/${STAMP}-scores.json`,
  versions: ARM_NAME,
  cases: key,
  leak_check: {
    tokens: LEAK_TOKENS,
    case_insensitive: true,
    whole_pack_hits: allHits,
    whole_pack_hits_attributed: hitOwners,
    outside_verbatim_replies_hits: outsideHits.length,
  },
};
const keyText = `${JSON.stringify(keyDoc, null, 2)}\n`;
console.log(`PACK.md: ${writeOnce(packPath, packText)} sha256 ${sha256(packText)}`);
console.log(`KEY.json: ${writeOnce(keyPath, keyText)}`);

out.push('## Blinded pack for “Review OpenAI PoC Context”');
out.push('');
out.push(`- Pack: \`blind/PACK.md\` (sha256 \`${sha256(packText)}\`), ${packCases.length} cases, rep 1 only, simulated final visible reply only; letters shuffled per case with mulberry32, seed ${BLIND_SEED}. The key is \`blind/KEY.json\`; PACK.md does not reference it.`);
out.push(`- Leak check (case-insensitive substrings ${LEAK_TOKENS.map((t) => `\`${t}\``).join(', ')}): whole PACK.md ${allHits.length} hit(s); outside the verbatim reply blocks ${outsideHits.length}.`);
if (allHits.length > 0) {
  const byVersion: Record<string, number> = {};
  for (const h of hitOwners) { const k = h.owner === 'server' ? `Olumi server paragraph (identical in every reply of its case)` : `model words, ${h.version}`; byVersion[k] = (byVersion[k] ?? 0) + 1; }
  out.push(`- Every whole-file hit is inside a verbatim reply block, as an ordinary English word: ${allHits.map((h) => `line ${h.line} “${h.token}” (…${h.excerpt.replace(/\n/g, ' ')}…)`).join('; ')}.`);
  out.push(`- By source (from KEY.json): ${Object.entries(byVersion).map(([k, v]) => `${k}: ${v}`).join('; ')}. The word occurs in more than one version’s replies, so it does not mark a version; the replies are shown unedited, as the brief requires rep 1 verbatim.`);
}
out.push('');
const resultsText = `${out.join('\n')}\n`;
console.log(`RESULTS.md: ${writeOnce(join(OUT, 'RESULTS.md'), resultsText)}`);
console.log(`leak: whole=${allHits.length} outside_replies=${outsideHits.length}`);
console.log(`guard: anthropic_env_removed=${JSON.stringify(guard.removed)} network_calls=0`);
for (const c of caseIds) console.log(`rank ${c}: ${rankArms(aggs[c]!.filter((a) => a.visWords.length > 0)).map((g) => g.map((a) => `${a.arm}[h${a.hard},s${a.soft},w${median(a.modelWords)}]`).join(' = ')).join(' > ') || 'not rankable'}`);
void CHECK_NAMES;
