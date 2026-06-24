#!/usr/bin/env tsx
/**
 * Golden-Journey Harness v1 — CLI.
 *
 * Two modes:
 *
 *   Live (drives the real service):
 *     pnpm tsx tools/golden-journey-harness/index.ts \
 *       --base-url http://localhost:3000 \
 *       --out Docs/golden-journey/golden-journey-v1-report.md
 *
 *     # staging — set the ASSIST key + enable the trace flags server-side
 *     export OLUMI_REPLAY_API_KEY='<staging-assist-key>'
 *     pnpm tsx tools/golden-journey-harness/index.ts \
 *       --base-url https://cee-staging.onrender.com --scenario-prefix gj-v1
 *
 *   Replay (deterministic; no network — runs the classifier over a recorded
 *   transcript so the report is reproducible in CI):
 *     pnpm tsx tools/golden-journey-harness/index.ts \
 *       --replay tools/golden-journey-harness/fixtures/golden-journey-v1.json
 *
 * Exit codes (mirror v5-journey-replay):
 *   0 — no fails (inconclusives allowed)
 *   1 — ≥1 invariant fail
 *   2 — fatal harness error
 *   3 — auth / preflight / deploy halt (live mode)
 *
 * Reuses the deploy gate, preflight, auth fail-fast, and redaction from
 * `../v5-journey-replay/`. Auth env var is `OLUMI_REPLAY_API_KEY` (shared
 * with that harness). Secrets are never logged or written to the report.
 */

import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { postTurn, type FetchResult, type TurnPayload } from '../v5-journey-replay/client.js';
import { createRedactor, redactString } from '../v5-journey-replay/redact.js';
import { formatTimingsEvidence } from '../v5-journey-replay/format-timings.js';
import {
  assertAuthForBaseUrl,
  evaluateDeployGate,
  readApiKey,
  runHealthz,
  runPreflight,
} from '../v5-journey-replay/index.js';
import type { HarnessConfig } from '../v5-journey-replay/types.js';

import {
  GOLDEN_STEPS,
  GOLDEN_SYNTHETIC_STEPS,
  captureLabelsFromDraft,
  resolveFactorLabel,
  roleForStep,
  threadHashMemory,
  type GoldenJourneyContext,
} from './journey.js';
import { evaluateJourney } from './invariants.js';
import { isAdvisoryFinding } from './components.js';
import { JourneyPreconditionError } from '../v5-journey-replay/steps.js';
import {
  getAnalysisReady,
  getAssistantText,
  getChips,
  getCurrentGraphHash,
  getDiagnosticTrace,
  getGraphHashAtRun,
  type TurnObservation,
  type WireBody,
} from './observation.js';
import { writeGoldenReport, type GoldenReportInput, type StepCapture } from './report.js';

interface Cli {
  readonly baseUrl: string;
  readonly out: string;
  readonly scenarioPrefix: string;
  readonly apiKey?: string;
  readonly expectedBuild?: string;
  readonly replayPath?: string;
  /** Force A6 to treat the diagnostic trace as expected-ON (guardrail #5). */
  readonly traceConfirmed: boolean;
}

function parseArgs(): Cli {
  const args = process.argv.slice(2);
  let baseUrl = 'http://localhost:3000';
  let out = 'Docs/golden-journey/golden-journey-v1-report.md';
  let scenarioPrefix = 'gj-local';
  let expectedBuild: string | undefined;
  let replayPath: string | undefined;
  let traceConfirmed = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--base-url' && i + 1 < args.length) baseUrl = args[++i]!;
    else if (arg === '--out' && i + 1 < args.length) out = args[++i]!;
    else if (arg === '--scenario-prefix' && i + 1 < args.length) scenarioPrefix = args[++i]!;
    else if (arg === '--expected-build' && i + 1 < args.length) expectedBuild = args[++i]!.trim() || undefined;
    else if (arg === '--replay' && i + 1 < args.length) replayPath = args[++i]!;
    else if (arg === '--trace-confirmed') traceConfirmed = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: pnpm tsx tools/golden-journey-harness/index.ts \\\n' +
          '         [--base-url URL] [--out PATH] [--scenario-prefix TAG] [--expected-build SHA]\n' +
          '         [--trace-confirmed]\n' +
          '       pnpm tsx tools/golden-journey-harness/index.ts --replay FIXTURE.json [--out PATH]\n\n' +
          'Auth (live, remote): set OLUMI_REPLAY_API_KEY.\n' +
          '--trace-confirmed: assert CEE_DIAGNOSTIC_TRACE_ENABLED is ON, so a missing trace fails A6\n' +
          '                   instead of being inconclusive (guardrail #5).',
      );
      process.exit(0);
    }
  }
  return { baseUrl, out, scenarioPrefix, apiKey: readApiKey(), expectedBuild, replayPath, traceConfirmed };
}

function safeGit(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Compose a compact, redaction-safe per-step evidence string. */
function summariseObservation(obs: TurnObservation): string {
  const ar = getAnalysisReady(obs.body);
  const trace = getDiagnosticTrace(obs.body);
  const parts: string[] = [`http=${obs.httpStatus}`, `text_len=${getAssistantText(obs.body).length}`];
  if (ar) {
    parts.push(`analysis_status=${String(ar.status)}`);
    if (ar.freshness) parts.push(`freshness=${ar.freshness}`);
    const run = getGraphHashAtRun(obs.body);
    const cur = getCurrentGraphHash(obs.body);
    if (run) parts.push(`hash_at_run=${run.slice(0, 10)}`);
    if (cur) parts.push(`current_hash=${cur.slice(0, 10)}`);
    if (Array.isArray(ar.model_adjustments) && ar.model_adjustments.length > 0) {
      parts.push(`repairs=${ar.model_adjustments.length}`);
    }
  }
  parts.push(`chips=${getChips(obs.body).length}`);
  if (trace?.exit_path) parts.push(`exit_path=${String(trace.exit_path)}`);
  parts.push(`trace=${trace ? 'present' : 'absent'}`);
  const timings = formatTimingsEvidence(obs.body);
  if (timings) parts.push(timings);
  return parts.join(' ');
}

/** Append the two synthetic (non-HTTP) coverage steps so the report lists all 10. */
function syntheticCaptures(): StepCapture[] {
  return GOLDEN_SYNTHETIC_STEPS.map((s) => ({
    step: s.name,
    role: 'evaluation',
    synthetic: true,
    evidence: `evaluation over captured turns — exercises ${s.invariants.join(', ')}: ${s.description}`,
  }));
}

// GoldenReportInput + the out path travel together internally.
type RunReportInput = GoldenReportInput & { readonly out_path: string };

function finishAndExit(input: RunReportInput, redact: (v: unknown) => string): never {
  writeGoldenReport(input.out_path, input, redact);
  console.log('');
  console.log(`Report written to ${input.out_path}`);
  const fails = input.findings.filter((f) => f.status === 'fail').length;
  const gatingFails = input.findings.filter((f) => f.status === 'fail' && !isAdvisoryFinding(f)).length;
  const advisoryFails = fails - gatingFails;
  const inconclusive = input.findings.filter((f) => f.status === 'inconclusive').length;
  console.log(
    `findings: ${input.findings.length} (fail=${fails} [gating=${gatingFails} advisory=${advisoryFails}] inconclusive=${inconclusive})`,
  );
  // Only GATING fails set a non-zero exit code. Advisory fails (A5 / provisional
  // A1 except the wire-grounded stale-as-fresh finding — semantic, LLM-variance-
  // prone) are reported but do not hard-gate a single live run; the deterministic
  // replay is the stable regression gate. The A1 stale-as-fresh finding is
  // emitted WITHOUT `provisional`, so it counts toward `gatingFails` and a
  // stale-results-presented-as-fresh turn fails the run (Coaching Context Pack v1).
  process.exit(gatingFails > 0 ? 1 : 0);
}

// --------------------------------------------------------------------------
// Replay mode — deterministic, no network.
// --------------------------------------------------------------------------

interface ReplayFixture {
  readonly name?: string;
  readonly brief?: string;
  readonly transcript?: {
    readonly diagnostic_trace_enabled?: boolean;
    readonly timing_debug_enabled?: boolean;
    readonly observations?: ReadonlyArray<{
      readonly step: string;
      readonly http_status: number;
      readonly body: WireBody;
    }>;
  };
}

function runReplay(cli: Cli): never {
  const redact = createRedactor(undefined);
  const raw = readFileSync(cli.replayPath!, 'utf-8');
  const fixture = JSON.parse(raw) as ReplayFixture;
  const obsIn = fixture.transcript?.observations ?? [];
  const traceExpected = Boolean(fixture.transcript?.diagnostic_trace_enabled) || cli.traceConfirmed;

  // Parse labels from the draft observation, thread to all.
  const draft = obsIn.find((o) => roleForStep(o.step) === 'draft');
  const { optionLabels, factorLabels } = captureLabelsFromDraft(draft?.body);

  const built: TurnObservation[] = obsIn.map((o) => ({
    step: o.step,
    role: roleForStep(o.step),
    httpStatus: o.http_status,
    body: o.body,
    diagnosticTraceExpected: traceExpected,
    optionLabels,
    factorLabels,
  }));
  const threaded = threadHashMemory(built);
  const { findings, caveats } = evaluateJourney(threaded, { diagnosticTraceExpected: traceExpected });

  const captures: StepCapture[] = threaded.map((obs) => ({
    step: obs.step,
    role: obs.role,
    http_status: obs.httpStatus,
    evidence: summariseObservation(obs),
    assistant_text: getAssistantText(obs.body) || undefined,
    chips: getChips(obs.body),
  }));
  captures.push(...syntheticCaptures());

  finishAndExit(
    {
      out_path: cli.out,
      mode: 'replay',
      startedAt: 'replay (deterministic fixture)',
      branch: safeGit('git rev-parse --abbrev-ref HEAD'),
      commitSha: safeGit('git rev-parse HEAD'),
      diagnosticTraceExpected: traceExpected,
      captures,
      findings,
      caveats,
    },
    redact,
  );
}

// --------------------------------------------------------------------------
// Live mode — drives the real /orchestrate/v2/turn.
// --------------------------------------------------------------------------

async function runLive(cli: Cli): Promise<void> {
  const redact = createRedactor(cli.apiKey);
  const scenarioId = randomUUID();
  const startedAt = new Date().toISOString();

  console.log('Golden-journey harness (live)');
  console.log(`  base_url        = ${cli.baseUrl}`);
  console.log(`  scenario_id     = ${scenarioId}`);
  console.log(`  out             = ${cli.out}`);
  console.log(`  auth            = ${cli.apiKey ? 'enabled (env key)' : 'disabled (localhost or no key)'}`);
  console.log('');

  const cfg: HarnessConfig = {
    baseUrl: cli.baseUrl,
    outPath: cli.out,
    scenarioPrefix: cli.scenarioPrefix,
    apiKey: cli.apiKey,
    expectedBuild: cli.expectedBuild,
  };

  // Reuse v5-journey-replay's fail-fast auth + deploy + preflight gates.
  assertAuthForBaseUrl(cfg);
  const healthz = await runHealthz(cfg, redact);
  console.log(`[HEALTHZ] ${healthz.note}`);
  const deployGate = evaluateDeployGate(cli.baseUrl, healthz.result, cli.expectedBuild);
  if (deployGate.halt) {
    console.error(`[DEPLOY HALT] ${deployGate.reason}`);
    process.exit(3);
  }
  const preflight = await runPreflight(cfg, redact);
  if (preflight.kind === 'halt') {
    console.error(`[PREFLIGHT HALT] ${preflight.reason}`);
    process.exit(3);
  }
  console.log(`[PREFLIGHT] ${preflight.note}`);
  console.log('');

  const ctx: GoldenJourneyContext = {
    scenario_id: scenarioId,
    optionLabels: [],
    factorLabels: [],
    resolvedFactorLabel: null,
    factorLabelReason: 'no_factor_labels',
  };

  const rawObs: TurnObservation[] = [];
  const captures: StepCapture[] = [];
  const notPassed = new Set<string>();

  for (const step of GOLDEN_STEPS) {
    if (step.depends_on && notPassed.has(step.depends_on)) {
      captures.push({
        step: step.name,
        role: step.role,
        skipped: true,
        evidence: `skipped: prerequisite ${step.depends_on} did not pass`,
      });
      notPassed.add(step.name);
      console.log(`[SKIP] ${step.name} (depends on ${step.depends_on})`);
      continue;
    }

    let payload: TurnPayload;
    try {
      payload = step.buildPayload(ctx);
    } catch (err) {
      if (err instanceof JourneyPreconditionError) {
        captures.push({
          step: step.name,
          role: step.role,
          skipped: true,
          evidence: `precondition unmet: ${redactString(err.message, cli.apiKey)} (${err.failingContract})`,
        });
        notPassed.add(step.name);
        console.log(`[SKIP] ${step.name}: ${err.failingContract}`);
        continue;
      }
      throw err;
    }

    let result: FetchResult | undefined;
    let httpStatus = 0;
    let body: WireBody | undefined;
    try {
      result = await postTurn(cli.baseUrl, payload, 90_000, cli.apiKey);
      httpStatus = result.status;
      body = result.body as unknown as WireBody;
    } catch (err) {
      const msg = redactString(err instanceof Error ? err.message : String(err), cli.apiKey);
      captures.push({ step: step.name, role: step.role, http_status: 0, evidence: `transport/exception: ${msg}` });
      // Still record an observation so A6/A7 flag the failure.
      rawObs.push({ step: step.name, role: step.role, httpStatus: 0, body: undefined, diagnosticTraceExpected: false });
      notPassed.add(step.name);
      console.log(`[FAIL] ${step.name}: ${msg}`);
      continue;
    }

    // Capture draft labels for downstream steps.
    if (step.role === 'draft') {
      const { optionLabels, factorLabels } = captureLabelsFromDraft(body);
      ctx.optionLabels = optionLabels;
      ctx.factorLabels = factorLabels;
      const resolved = resolveFactorLabel(factorLabels);
      ctx.resolvedFactorLabel = resolved.label;
      ctx.factorLabelReason = resolved.reason;
    }

    const obs: TurnObservation = {
      step: step.name,
      role: step.role,
      httpStatus,
      body,
      elapsedMs: result.elapsed_ms,
      diagnosticTraceExpected: false, // set globally after the loop
    };
    rawObs.push(obs);

    // A 200 is the bar for "passed" gating of dependents; richer pass/fail
    // is decided by the classifier. Treat non-200 as not-passed so
    // dependents skip with a clear cause.
    if (httpStatus !== 200) notPassed.add(step.name);
    console.log(`[${httpStatus === 200 ? 'OK ' : 'BAD'}] ${step.name}: ${redact(summariseObservation(obs))}`);
  }

  // Trace expectation: confirmed by flag, or auto-derived from any turn
  // actually returning a diagnostic trace (the flag is effectively ON).
  const anyTrace = rawObs.some((o) => getDiagnosticTrace(o.body) !== undefined);
  const traceExpected = cli.traceConfirmed || anyTrace;

  // Re-stamp the trace expectation + draft labels onto every observation.
  const stamped = rawObs.map((o) => ({
    ...o,
    diagnosticTraceExpected: traceExpected,
    optionLabels: ctx.optionLabels,
    factorLabels: ctx.factorLabels,
  }));
  const threaded = threadHashMemory(stamped);
  const { findings, caveats } = evaluateJourney(threaded, { diagnosticTraceExpected: traceExpected });

  // Build per-step captures with full evidence from the threaded observations.
  for (const obs of threaded) {
    const existing = captures.find((c) => c.step === obs.step);
    const cap: StepCapture = {
      step: obs.step,
      role: obs.role,
      http_status: obs.httpStatus,
      evidence: summariseObservation(obs),
      assistant_text: getAssistantText(obs.body) || undefined,
      chips: getChips(obs.body),
    };
    if (existing) Object.assign(existing, cap);
    else captures.push(cap);
  }
  captures.push(...syntheticCaptures());

  finishAndExit(
    {
      out_path: cli.out,
      mode: 'live',
      baseUrl: cli.baseUrl,
      startedAt,
      branch: safeGit('git rev-parse --abbrev-ref HEAD'),
      commitSha: safeGit('git rev-parse HEAD'),
      healthzBuild: healthz.result?.body?.build,
      diagnosticTraceExpected: traceExpected,
      captures,
      findings,
      caveats,
    },
    redact,
  );
}

async function main(): Promise<void> {
  const cli = parseArgs();
  if (cli.replayPath) {
    runReplay(cli); // never returns
  } else {
    await runLive(cli);
  }
}

function isDirectCliInvocation(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

export { parseArgs, summariseObservation, runReplay, runLive };

if (isDirectCliInvocation()) {
  main().catch((err) => {
    const secret = readApiKey();
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Harness fatal error:', redactString(msg, secret));
    process.exit(2);
  });
}
