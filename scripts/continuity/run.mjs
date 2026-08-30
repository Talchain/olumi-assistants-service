#!/usr/bin/env node
/**
 * CONTINUITY HARNESS — Tier 2, the deployed-wire battery.
 *
 *   node scripts/continuity/run.mjs
 *
 * Drives the real product at https://cee-staging.onrender.com/proxy/v5/turn
 * with the UI's Origin, in fresh guest scenarios. No application code is
 * imported; nothing is stubbed.
 *
 * WHAT THIS RUNNER GUARANTEES, AND WHY EACH GUARANTEE EXISTS
 * ----------------------------------------------------------
 *  1. THE BUILD IS DERIVED, NEVER INHERITED. /healthz is read and compared to
 *     the expected SHA. A battery run against an unexpected build is worse
 *     than no battery, because its result will be quoted.
 *  2. THE REDACTOR IS PROVEN BEFORE THE FIRST CAPTURE, with a positive AND a
 *     contrast control. An unproven absence-of-secrets is not a result.
 *  3. A CASE WITHOUT A CONTROL CANNOT RUN. Shape validation refuses it. This
 *     is the requirement "a case that can pass without discriminating is
 *     worthless" enforced by construction rather than by convention.
 *  4. PRECONDITION AND DISCRIMINATION ARE GATES, NOT ASSERTIONS. Failing
 *     either yields COULD_NOT_MEASURE — never PASS, never FAIL.
 *  5. SPLIT REPLAYS ARE A FINDING. Disagreeing replays are reported as a
 *     distribution and voided, never majority-voted into a verdict.
 *  6. A TRAILING GLOBAL CONTROL must still discriminate at the end of the run.
 *     A blind instrument can fake agreement; it cannot fake a discrimination
 *     it is not making. If it stops discriminating, the whole run is void.
 *
 * EXIT CODES
 *   0  every case PASSED
 *   1  at least one case FAILED (a real, measured product defect)
 *   2  the instrument could not measure — preflight failure, a voided case,
 *      or a dead trailing control. NEVER treat 2 as a pass.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TurnClient, deriveBuild, DEFAULT_BASE, UI_ORIGIN, mentions } from './lib/wire.mjs';
import { proveRedactorFires } from './lib/redact.mjs';
import {
  PASS, FAIL, CNM, EXIT,
  assertArmsDiscriminate, collapseReplays, scoreCase, validateCaseShape, check, requireNonEmpty,
} from './lib/verdict.mjs';
import { BRIEF_FULLY_SPECIFIED, draft, optionLabels } from './lib/scenarios.mjs';

import askAnswerReferent from './cases/ask-answer-referent.mjs';
import pronounIdentity from './cases/pronoun-identity.mjs';
import editRerunConsequence from './cases/edit-rerun-consequence.mjs';
import postAnalysisGrounding from './cases/post-analysis-grounding.mjs';
import coldReturnDurable from './cases/cold-return-durable.mjs';
import longConversationRetention from './cases/long-conversation-retention.mjs';
import hotWindowOverflow from './cases/hot-window-overflow.mjs';
import answerGroundedToVersion from './cases/answer-grounded-to-version.mjs';

const ALL_CASES = [
  askAnswerReferent,
  pronounIdentity,
  editRerunConsequence,
  postAnalysisGrounding,
  coldReturnDurable,
  longConversationRetention,
  hotWindowOverflow,
  answerGroundedToVersion,
];

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { only: null, replays: 1, expectBuild: process.env.CONTINUITY_EXPECT_BUILD || 'caceba1', list: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--only') opts.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--replays') opts.replays = Math.max(1, Number(argv[++i] || 1));
    else if (a === '--expect-build') opts.expectBuild = String(argv[++i] || '');
    else if (a === '--any-build') opts.expectBuild = null;
    else if (a === '--list') opts.list = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const paint = (v) => (v === PASS ? `${C.green}PASS${C.reset}` : v === FAIL ? `${C.red}FAIL${C.reset}` : `${C.yellow}COULD_NOT_MEASURE${C.reset}`);

// ---------------------------------------------------------------------------
// Preflight — every gate here can VOID the run before a single capture is taken
// ---------------------------------------------------------------------------
async function preflight(opts) {
  const problems = [];
  console.log(`${C.bold}── PREFLIGHT ──${C.reset}`);

  // (1) Redactor controls FIRST: nothing is captured until the redactor is proven.
  const red = proveRedactorFires();
  for (const c of red.checks) {
    console.log(`  redactor ${c.control.padEnd(8)} ${c.ok ? `${C.green}ok${C.reset}` : `${C.red}BROKEN${C.reset}`}  ${c.detail}`);
  }
  if (!red.ok) problems.push('redactor controls did not both behave — refusing to capture wire traffic');

  // (2) Derive the deployed build.
  let build = null;
  try {
    build = await deriveBuild(DEFAULT_BASE);
    console.log(`  build derived  ${C.cyan}${build.build}${C.reset} (version ${build.version}, degraded=${build.degraded})`);
  } catch (err) {
    problems.push(`could not derive build from /healthz: ${err.message}`);
  }
  if (build && opts.expectBuild && !String(build.build).startsWith(opts.expectBuild)) {
    problems.push(
      `BUILD MISMATCH: deployed "${build.build}" does not start with expected "${opts.expectBuild}". ` +
      'Re-derive the expectation or pass --any-build deliberately.',
    );
  }
  if (build && build.degraded) {
    problems.push('service reports degraded=true — results would not be about a healthy build');
  }

  console.log(`  target         ${DEFAULT_BASE}/proxy/v5/turn`);
  console.log(`  origin         ${UI_ORIGIN}`);
  return { ok: problems.length === 0, problems, build };
}

// ---------------------------------------------------------------------------
// Trailing global control — proves the instrument still discriminates at the END
// ---------------------------------------------------------------------------
async function trailingControl(client) {
  const { scenarioId, response } = await draft(client, BRIEF_FULLY_SPECIFIED, 'TRAILING-control-draft');
  const options = optionLabels(response.body);
  const real = options[0];
  const fabricated = 'Relocate Head Office To Reykjavik';

  if (!real) {
    return { ok: false, detail: 'could not obtain a real option label — trailing control is itself blind' };
  }

  const [realResp, fakeResp] = await Promise.all([
    client.turn({ scenarioId, message: `Tell me about the ${real} option.`, label: 'TRAILING-real-option' }),
    client.turn({ scenarioId, message: `Tell me about the ${fabricated} option.`, label: 'TRAILING-fabricated-option' }),
  ]);

  const ne1 = requireNonEmpty('trailing real', realResp.text, { minLength: 2 });
  const ne2 = requireNonEmpty('trailing fabricated', fakeResp.text, { minLength: 2 });
  if (!ne1.ok || !ne2.ok) {
    return { ok: false, detail: `${ne1.reason || ''} ${ne2.reason || ''}`.trim() };
  }

  const disc = assertArmsDiscriminate(realResp.text, fakeResp.text);
  const affirmsFake = mentions(fakeResp.text, 'Reykjavik') && !/\b(no|not|don'?t|isn'?t|doesn'?t|can'?t|unable|no such)\b/i.test(fakeResp.text);

  return {
    ok: disc.ok && !affirmsFake,
    detail: disc.ok
      ? (affirmsFake
        ? 'the fabricated option was AFFIRMED — the instrument is no longer discriminating real from invented'
        : `discriminates: real vs fabricated option answers differ (${disc.reason})`)
      : `TRAILING CONTROL STOPPED DISCRIMINATING — ${disc.reason}. The whole run is void.`,
  };
}

// ---------------------------------------------------------------------------
// Run one case, once
// ---------------------------------------------------------------------------
async function runCaseOnce(ctx, kase) {
  const setup = await kase.setup(ctx);
  const preconditionChecks = kase.precondition(setup);

  // Do not spend turns on a case whose fixture no longer reproduces the state.
  if (preconditionChecks.some((c) => !c.ok)) {
    return { setup, preconditionChecks, discrimination: null, armChecks: [], controlChecks: [], armResp: null, controlResp: null };
  }

  const [armResp, controlResp] = await Promise.all([kase.arm(ctx, setup), kase.control(ctx, setup)]);

  const transport = [
    check('arm transport ok', armResp.ok, armResp.ok ? `HTTP ${armResp.status}` : `HTTP ${armResp.status} ${armResp.networkError || ''}`),
    check('control transport ok', controlResp.ok, controlResp.ok ? `HTTP ${controlResp.status}` : `HTTP ${controlResp.status} ${controlResp.networkError || ''}`),
  ];
  if (transport.some((c) => !c.ok)) {
    return { setup, preconditionChecks: [...preconditionChecks, ...transport], discrimination: null, armChecks: [], controlChecks: [], armResp, controlResp };
  }

  const discrimination = assertArmsDiscriminate(armResp.text, controlResp.text);
  const armChecks = kase.assertArm(armResp, setup);
  const controlChecks = kase.assertControl(controlResp, setup);

  return { setup, preconditionChecks, discrimination, armChecks, controlChecks, armResp, controlResp };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    console.log(`
CONTINUITY HARNESS — deployed-wire battery

  node scripts/continuity/run.mjs [options]

  --only <ids>        comma-separated case ids (default: all)
  --replays <n>       independent full re-runs per case (default 1; >=3 to assess determinism)
  --expect-build <s>  required /healthz build prefix (default caceba1)
  --any-build         run against whatever is deployed (states this in the report)
  --list              list case ids and exit

Exit: 0 all pass · 1 a case failed · 2 could-not-measure (NEVER a pass)
`);
    return EXIT.OK;
  }

  if (opts.list) {
    for (const k of ALL_CASES) console.log(`${k.id.padEnd(30)} seam ${k.seam}  ${k.title}`);
    return EXIT.OK;
  }

  const selected = opts.only ? ALL_CASES.filter((k) => opts.only.includes(k.id)) : ALL_CASES;
  if (selected.length === 0) {
    console.error(`No cases matched --only ${opts.only}`);
    return EXIT.COULD_NOT_MEASURE;
  }

  // ---- Shape validation: refuse a case that cannot be falsified -----------
  const shapeProblems = [];
  for (const k of selected) {
    const v = validateCaseShape(k);
    if (!v.ok) shapeProblems.push(`${k.id}: ${v.problems.join('; ')}`);
  }
  if (shapeProblems.length) {
    console.error(`${C.red}CASE SHAPE INVALID — refusing to run:${C.reset}\n  ${shapeProblems.join('\n  ')}`);
    return EXIT.COULD_NOT_MEASURE;
  }

  const pre = await preflight(opts);
  if (!pre.ok) {
    console.error(`\n${C.red}PREFLIGHT FAILED — the harness is not entitled to an opinion:${C.reset}`);
    for (const p of pre.problems) console.error(`  · ${p}`);
    return EXIT.COULD_NOT_MEASURE;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceDir = join(HERE, 'evidence', `${stamp}-${pre.build ? pre.build.build : 'unknown'}`);
  mkdirSync(evidenceDir, { recursive: true });
  const client = new TurnClient({ base: DEFAULT_BASE, evidenceDir });
  const ctx = { client, build: pre.build };

  if (opts.replays < 3) {
    console.log(`\n${C.yellow}NOTE:${C.reset} replays=${opts.replays}. Determinism is UNASSESSED at n<3; ` +
      'routing non-determinism has been observed on this surface. Use --replays 3 to assess it.');
  }

  console.log(`\n${C.bold}── CASES (${selected.length}) ──${C.reset}  evidence → ${evidenceDir}\n`);

  const results = [];
  for (const kase of selected) {
    process.stdout.write(`${C.bold}${kase.id}${C.reset} ${C.dim}[seam ${kase.seam} · ${kase.stateClass}]${C.reset}\n`);
    const perReplay = [];
    let last = null;
    let error = null;

    for (let r = 0; r < opts.replays; r += 1) {
      try {
        last = await runCaseOnce(ctx, kase);
        const scored = scoreCase(last);
        perReplay.push(scored);
        process.stdout.write(`   replay ${r + 1}/${opts.replays}: ${paint(scored.verdict)}\n`);
      } catch (err) {
        error = String(err && err.stack ? err.stack : err);
        perReplay.push({ verdict: CNM, stage: 'exception', reason: String(err && err.message ? err.message : err) });
        process.stdout.write(`   replay ${r + 1}/${opts.replays}: ${paint(CNM)} (exception)\n`);
      }
    }

    const collapsed = collapseReplays(perReplay.map((p) => p.verdict));
    const detail = perReplay[perReplay.length - 1] || { reason: 'no replay completed' };

    // Diagnostics are informational and never change a verdict.
    let diagnostic = null;
    if (typeof kase.diagnostic === 'function' && last && last.setup) {
      try {
        diagnostic = await kase.diagnostic(ctx, last.setup);
      } catch (err) {
        diagnostic = { name: 'diagnostic', ok: false, detail: `threw: ${err.message}` };
      }
    }

    const record = {
      id: kase.id,
      seam: kase.seam,
      state_class: kase.stateClass,
      title: kase.title,
      expected_at_authoring: kase.expectedAt || {},
      verdict: collapsed.verdict,
      replay_distribution: collapsed.distribution,
      split_reading: collapsed.split,
      collapse_reason: collapsed.reason,
      stage: detail.stage,
      reason: detail.reason,
      precondition_checks: last ? last.preconditionChecks : [],
      discrimination: last ? last.discrimination : null,
      arm_checks: last ? last.armChecks : [],
      control_checks: last ? last.controlChecks : [],
      diagnostic,
      exception: error,
    };
    results.push(record);

    console.log(`   ${C.bold}verdict${C.reset} ${paint(collapsed.verdict)}  ${C.dim}${collapsed.reason}${C.reset}`);
    if (collapsed.verdict !== PASS) console.log(`   ${C.dim}why: ${detail.reason}${C.reset}`);
    for (const c of [...(record.arm_checks || []), ...(record.control_checks || [])]) {
      if (!c.ok) console.log(`     ${C.red}✗${C.reset} ${c.name} — ${c.detail}`);
    }
    if (diagnostic) console.log(`   ${C.dim}diagnostic: ${diagnostic.name} — ${diagnostic.detail}${C.reset}`);
    console.log('');
  }

  // ---- Trailing global control ------------------------------------------
  console.log(`${C.bold}── TRAILING CONTROL ──${C.reset}`);
  let trailing;
  try {
    trailing = await trailingControl(client);
  } catch (err) {
    trailing = { ok: false, detail: `threw: ${err.message}` };
  }
  console.log(`  ${trailing.ok ? `${C.green}discriminating${C.reset}` : `${C.red}DEAD${C.reset}`} — ${trailing.detail}\n`);

  // ---- Report ------------------------------------------------------------
  const counts = results.reduce((a, r) => ({ ...a, [r.verdict]: (a[r.verdict] || 0) + 1 }), {});
  const report = {
    harness: 'continuity',
    tier: 2,
    generated_at: new Date().toISOString(),
    target: `${DEFAULT_BASE}/proxy/v5/turn`,
    origin: UI_ORIGIN,
    build_derived: pre.build,
    build_expectation: opts.expectBuild || '(any, explicitly requested)',
    replays: opts.replays,
    determinism_assessed: opts.replays >= 3,
    rung: 'WIRE-WITNESSED — no case drives the browser; nothing here is JOURNEY-WITNESSED',
    trailing_control: trailing,
    counts,
    cases: results,
  };
  const reportFile = join(evidenceDir, 'report.json');
  writeFileSync(reportFile, JSON.stringify(report, null, 2));

  console.log(`${C.bold}── SUMMARY ──${C.reset}`);
  for (const r of results) {
    console.log(`  ${paint(r.verdict).padEnd(28)} ${r.id.padEnd(30)} ${C.dim}seam ${r.seam} · ${r.state_class}${C.reset}`);
  }
  console.log(`\n  ${PASS}=${counts[PASS] || 0}  ${FAIL}=${counts[FAIL] || 0}  ${CNM}=${counts[CNM] || 0}`);
  console.log(`  RUNG: WIRE-WITNESSED at build ${pre.build ? pre.build.build : '?'}. Not journey-witnessed.`);
  console.log(`  determinism: ${opts.replays >= 3 ? 'assessed' : 'UNASSESSED (replays<3)'}`);
  console.log(`  report: ${reportFile}\n`);

  if (!trailing.ok) {
    console.error(`${C.red}RUN VOID: the trailing control stopped discriminating. No verdict above is trustworthy.${C.reset}`);
    return EXIT.COULD_NOT_MEASURE;
  }
  if ((counts[FAIL] || 0) > 0) return EXIT.FAILED;
  if ((counts[CNM] || 0) > 0) return EXIT.COULD_NOT_MEASURE;
  return EXIT.OK;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('HARNESS EXCEPTION:', err && err.stack ? err.stack : err);
    process.exit(EXIT.COULD_NOT_MEASURE);
  });
