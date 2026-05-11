#!/usr/bin/env tsx
/**
 * V5 alpha hardening Phase 3 — journey replay CLI.
 *
 * Usage (local):
 *   # terminal 1
 *   pnpm start
 *   # terminal 2
 *   pnpm tsx tools/v5-journey-replay/index.ts \
 *     --base-url http://localhost:3000 \
 *     --out Docs/v5/v5-golden-path-evidence-cee.md
 *
 * Usage (staging):
 *   export OLUMI_REPLAY_API_KEY='[your-staging-key]'
 *   pnpm tsx tools/v5-journey-replay/index.ts \
 *     --base-url https://cee-staging.onrender.com \
 *     --out Docs/v5/v5-golden-path-evidence-cee.md \
 *     --scenario-prefix staging
 *
 * The CLI is idempotent: each run generates a fresh scenario UUID, posts
 * the canonical steps, captures per-step results, and overwrites the
 * evidence pack with the product-shaped table.
 *
 * Auth: env-only, no CLI flag. `OLUMI_REPLAY_API_KEY` is never logged,
 * echoed, or written to the evidence pack — see `redact.ts`.
 *
 * Exit codes:
 *   0 — all steps passed
 *   1 — some steps failed (replay ran, some rows failed)
 *   2 — fatal harness error (exception outside the step loop)
 *   3 — auth / preflight blocker (halt before burning the replay)
 */

import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { getHealthz, postTurn, preflightAuth, type FetchResult } from './client.js';
import {
  assertAnalysisRun,
  assertDraftGraph,
  assertEditGraphGeneric,
  assertExplainLeader,
  assertExplainLeaderStale,
  assertProductShape,
  assertSetFactorValue,
  assertWhatChanged,
  assertWhatWouldFlip,
  type AssertionResult,
  type DL7AssertionContext,
} from './assertions.js';
import {
  JOURNEY_IDS,
  JOURNEY_REGISTRY,
  JourneyPreconditionError,
  PR_B_GATED_JOURNEYS,
  selectFactorLabel,
  type JourneyContext,
  type JourneyId,
  type Step1Capture,
} from './steps.js';
import { writeEvidencePack, type EvidenceHeader } from './evidence-writer.js';
import { classifyResponse, hasErrorEnvelope, isTransportError } from './classify-outcome.js';
import { isLocalHost } from './localhost.js';
import { createRedactor, redactString } from './redact.js';
import type { EvidenceRow, HarnessConfig, HealthzResult, PreflightVerdict } from './types.js';

const MISSING_KEY_MESSAGE =
  'OLUMI_REPLAY_API_KEY environment variable is required when --base-url ' +
  'points at a remote host. Set it before re-running.';

/**
 * Well-formed `build` field check. The healthz endpoint returns
 * `GIT_COMMIT_SHA.slice(0, 7)` (see src/version.ts:59), so a healthy
 * deploy reports a 7-char hex string. We accept 7+ to remain forward-
 * compatible with longer slices, and reject `unknown` / empty / non-hex.
 */
const WELL_FORMED_BUILD = /^[0-9a-f]{7,}$/i;

/**
 * Determine whether the operator has authorised running against a
 * stale or degraded staging deploy. Used to bypass the deploy-halt
 * gate when intentionally exercising a different commit.
 */
function isStaleDeployOverrideEnabled(): boolean {
  const raw = (process.env.OLUMI_REPLAY_ALLOW_STALE_DEPLOY ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/**
 * Read the strict-mode expected SHA from `OLUMI_REPLAY_EXPECTED_BUILD`.
 * Empty / whitespace-only value behaves as missing. CLI flag takes
 * precedence over this — see `parseArgs`.
 */
function readExpectedBuildEnv(): string | undefined {
  const raw = process.env.OLUMI_REPLAY_EXPECTED_BUILD;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

export interface DeployGateVerdict {
  readonly halt: boolean;
  readonly reason?: string;
}

/**
 * Inspect a /healthz result and decide whether the run should halt
 * before preflight. Two-mode contract:
 *   - Default (no `expectedBuild`): confirm the deploy is alive — halt
 *     only if `build` is missing or malformed (not 7+ hex chars). Does
 *     not compare against any reference SHA.
 *   - Strict (with `expectedBuild`): additionally halt on build
 *     mismatch. Use this for "I just pushed X, confirm staging is on X"
 *     workflows.
 * Always halts on unreachable healthz and on `degraded === true`.
 * Every halt is overridable via OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true.
 * Localhost runs skip the gate entirely (local builds use arbitrary
 * SHAs).
 *
 * The healthz `build` field is already `GIT_COMMIT_SHA.slice(0, 7)`
 * server-side (see src/version.ts:59), so direct equality is the right
 * comparison in strict mode.
 */
export function evaluateDeployGate(
  baseUrl: string,
  healthz: HealthzResult | undefined,
  expectedBuild?: string,
): DeployGateVerdict {
  // Local runs: skip the gate. Local builds use arbitrary SHAs.
  try {
    const url = new URL(baseUrl);
    if (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '0.0.0.0' ||
      url.hostname.replace(/^\[/, '').replace(/\]$/, '') === '::1'
    ) {
      return { halt: false };
    }
  } catch {
    // Invalid URL — let the auth gate or fetch error path surface it.
    return { halt: false };
  }

  const override = isStaleDeployOverrideEnabled();

  if (healthz === undefined || healthz.body === undefined) {
    if (override) return { halt: false };
    return {
      halt: true,
      reason:
        '/healthz unreachable or returned no body — cannot externally verify deploy. ' +
        'Set OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true to override.',
    };
  }

  const build = healthz.body.build;
  if (build === undefined || !WELL_FORMED_BUILD.test(build)) {
    if (override) return { halt: false };
    return {
      halt: true,
      reason:
        `/healthz returned build=${build ?? 'unknown'} which is not a well-formed short SHA ` +
        '(expected 7+ hex chars). Cannot externally verify deploy identity. ' +
        'Set OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true to override.',
    };
  }

  if (expectedBuild !== undefined && build !== expectedBuild) {
    if (override) return { halt: false };
    return {
      halt: true,
      reason:
        `/healthz reports build=${build} but --expected-build (or OLUMI_REPLAY_EXPECTED_BUILD) ` +
        `requires ${expectedBuild}. Staging may be stale or you may be checking the wrong host. ` +
        'Set OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true to override.',
    };
  }

  if (healthz.body.degraded === true) {
    if (override) return { halt: false };
    const reasons = (healthz.body.degraded_reasons ?? []).join(', ') || 'no reasons reported';
    return {
      halt: true,
      reason:
        `/healthz reports degraded=true (${reasons}). ` +
        'Set OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true to override.',
    };
  }

  return { halt: false };
}

function readApiKey(): string | undefined {
  const raw = process.env.OLUMI_REPLAY_API_KEY;
  if (raw === undefined) return undefined;
  // Empty and whitespace-only env var must behave as missing — a shell
  // with `export OLUMI_REPLAY_API_KEY=""` should fail fast on remote,
  // not let a malformed request through.
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  return raw;
}

function parseJourneyArg(raw: string): JourneyId {
  const trimmed = raw.trim();
  if ((JOURNEY_IDS as readonly string[]).includes(trimmed)) {
    return trimmed as JourneyId;
  }
  throw new Error(
    `Unknown --journey "${trimmed}". Allowed: ${JOURNEY_IDS.join(', ')}.`,
  );
}

/**
 * `HarnessConfig` keeps `journey` optional so legacy unit-test fixtures
 * (which omit it) typecheck. `ResolvedHarnessConfig` is the internal
 * shape produced by `parseArgs()`: every CLI run resolves `journey` to
 * a concrete `JourneyId` (defaulting to `canonical`). Downstream `run()`
 * code reads `cfg.journey` as a required value.
 */
type ResolvedHarnessConfig = Omit<HarnessConfig, 'journey'> & { readonly journey: JourneyId };

function parseArgs(): ResolvedHarnessConfig {
  const args = process.argv.slice(2);
  let baseUrl = 'http://localhost:3000';
  let outPath = 'Docs/v5/v5-golden-path-evidence-cee.md';
  let scenarioPrefix = 'local';
  let expectedBuildCli: string | undefined;
  // Default journey is `canonical` so existing CLI invocations and
  // harness self-tests stay backwards-compatible.
  let journey: JourneyId = 'canonical';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--base-url' && i + 1 < args.length) {
      baseUrl = args[++i]!;
    } else if (arg === '--out' && i + 1 < args.length) {
      outPath = args[++i]!;
    } else if (arg === '--scenario-prefix' && i + 1 < args.length) {
      scenarioPrefix = args[++i]!;
    } else if (arg === '--expected-build' && i + 1 < args.length) {
      expectedBuildCli = args[++i]!.trim() || undefined;
    } else if (arg.startsWith('--expected-build=')) {
      const val = arg.slice('--expected-build='.length).trim();
      expectedBuildCli = val.length > 0 ? val : undefined;
    } else if (arg === '--journey' && i + 1 < args.length) {
      journey = parseJourneyArg(args[++i]!);
    } else if (arg.startsWith('--journey=')) {
      journey = parseJourneyArg(arg.slice('--journey='.length));
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: pnpm tsx tools/v5-journey-replay/index.ts \\\n' +
          '         [--base-url URL] [--out PATH] [--scenario-prefix TAG] \\\n' +
          '         [--expected-build SHA] [--journey ID]\n' +
          '\n' +
          'Auth: set OLUMI_REPLAY_API_KEY env var for remote URLs (required).\n' +
          '\n' +
          'Strict-mode SHA check: --expected-build SHA (or set OLUMI_REPLAY_EXPECTED_BUILD).\n' +
          'CLI flag takes precedence over the env var. When both are unset, the deploy\n' +
          'gate only confirms /healthz returned a well-formed build field.\n' +
          '\n' +
          `Journeys (--journey, default "canonical"): ${JOURNEY_IDS.join(', ')}.\n` +
          'DL-7 journeys: dl7-set-factor (V5 set_factor_value mutation handler),\n' +
          'dl7-staleness (post-analysis edit → stale signal), dl7-edit-graph\n' +
          '(generic edit_graph dispatcher — live on staging; emergency rollback\n' +
          'switch DL7_PR_B_DISABLE=true re-gates the journey).',
      );
      process.exit(0);
    }
  }

  // CLI flag wins; fall back to env. Both being unset means default
  // mode (well-formed-only check, no SHA comparison).
  const expectedBuild = expectedBuildCli ?? readExpectedBuildEnv();

  return { baseUrl, outPath, scenarioPrefix, apiKey: readApiKey(), expectedBuild, journey };
}

/**
 * Read the emergency rollback flag. edit_graph DL-7 PR B is live on
 * staging (PR #159 docs merge pending), so `dl7-edit-graph` runs as a
 * core V5 path by default. Setting `DL7_PR_B_DISABLE=true` re-gates
 * the journey — use this only if PR B regresses on staging and you
 * need to take it out of the replay critical path while a fix lands.
 *
 * The pre-merge `DL7_PR_B_LANDED=true` env var is also honoured (as a
 * no-op affirmation) so existing CI invocations don't break — but its
 * effect is now redundant since the default state is "ungated."
 *
 * Returns true when the journey is gated (i.e. emergency disable on),
 * false otherwise.
 */
function isDL7EditGraphDisabled(): boolean {
  const raw = (process.env.DL7_PR_B_DISABLE ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/**
 * Pre-merge compatibility: the executive summary of older evidence
 * packs reported `dl7_pr_b_landed`. We continue to surface the same
 * field name, but the value now reflects "is the journey active?"
 * rather than "did the operator opt in?" — i.e. it is `true` unless
 * explicitly disabled via `DL7_PR_B_DISABLE`.
 */
function isDL7PrBLanded(): boolean {
  return !isDL7EditGraphDisabled();
}

/**
 * Enforce the auth fail-fast gate. Throws an Error with the exact
 * `MISSING_KEY_MESSAGE` string when the brief's condition is met. The
 * error message never contains the key (there is no key to leak here —
 * this runs only when the env var is missing).
 */
function assertAuthForBaseUrl(cfg: HarnessConfig): void {
  let local: boolean;
  try {
    local = isLocalHost(cfg.baseUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid --base-url: ${cfg.baseUrl} (${msg})`);
  }
  if (!local && !cfg.apiKey) {
    throw new Error(MISSING_KEY_MESSAGE);
  }
}

async function runHealthz(
  cfg: HarnessConfig,
  redact: (v: unknown) => string,
): Promise<{ result: HealthzResult | undefined; note: string }> {
  try {
    const result = await getHealthz(cfg.baseUrl);
    return { result, note: `status=${result.status} elapsed=${result.elapsed_ms}ms` };
  } catch (err) {
    return { result: undefined, note: `healthz unreachable: ${redact(err)}` };
  }
}

async function runPreflight(
  cfg: HarnessConfig,
  redact: (v: unknown) => string,
): Promise<PreflightVerdict> {
  try {
    const probe = await preflightAuth(cfg.baseUrl, cfg.apiKey);
    if (probe.status === 401 || probe.status === 403) {
      return {
        kind: 'halt',
        status: probe.status,
        reason: `auth rejected on preflight (HTTP ${probe.status}) — check OLUMI_REPLAY_API_KEY`,
      };
    }
    if (probe.status >= 500) {
      return {
        kind: 'halt',
        status: probe.status,
        reason: `server error on preflight (HTTP ${probe.status}) — staging unhealthy, do not burn replay`,
      };
    }
    // 400 / 422 → auth accepted, body rejected (expected).
    // 200 → unexpected permissive accept, log but advance.
    return {
      kind: 'advance',
      status: probe.status,
      note:
        probe.status === 200
          ? `auth accepted (unexpected 200 on empty body); proceeding`
          : `auth accepted (HTTP ${probe.status} as expected for empty body)`,
    };
  } catch (err) {
    return {
      kind: 'halt',
      status: 0,
      reason: `preflight exception: ${redact(err)}`,
    };
  }
}

async function run(): Promise<void> {
  const cfg = parseArgs();
  const redact = createRedactor(cfg.apiKey);
  const scenarioId = randomUUID();
  const startedAt = new Date().toISOString();

  console.log(`V5 journey replay`);
  console.log(`  base_url         = ${cfg.baseUrl}`);
  console.log(`  scenario_id      = ${scenarioId}`);
  console.log(`  scenario_prefix  = ${cfg.scenarioPrefix}`);
  console.log(`  out              = ${cfg.outPath}`);
  console.log(`  journey          = ${cfg.journey}`);
  console.log(
    `  edit_graph state = ${
      isDL7EditGraphDisabled()
        ? 'DISABLED via DL7_PR_B_DISABLE (emergency rollback)'
        : 'live (PR B accepted on staging; pending PR #159 docs merge)'
    }`,
  );
  console.log(`  auth             = ${cfg.apiKey ? 'enabled (key loaded from env)' : 'disabled (localhost or no key)'}`);
  console.log(
    `  expected_build   = ${cfg.expectedBuild ?? 'not set (default: well-formed-only check)'}`,
  );
  console.log('');

  // Fail-fast gate. Throws with MISSING_KEY_MESSAGE for remote+no-key.
  assertAuthForBaseUrl(cfg);

  // Phase 2: deploy confirmation via public /healthz. Captured into
  // evidence header regardless of outcome so reviewers can see what the
  // deployed build reports.
  const healthz = await runHealthz(cfg, redact);
  console.log(`[HEALTHZ] ${healthz.note}`);
  if (healthz.result?.body) {
    console.log(
      `  build=${healthz.result.body.build ?? '?'} version=${healthz.result.body.version ?? '?'} ` +
        `degraded=${healthz.result.body.degraded ?? false}`,
    );
  }

  // Halt before preflight if the deployed build is missing or
  // malformed, healthz is unreachable on a remote URL, the deployed
  // build mismatches `--expected-build` (when supplied), or the
  // service reports degraded. Operator can override with
  // OLUMI_REPLAY_ALLOW_STALE_DEPLOY=true.
  const deployGate = evaluateDeployGate(cfg.baseUrl, healthz.result, cfg.expectedBuild);
  if (deployGate.halt) {
    console.error(`[DEPLOY HALT] ${deployGate.reason}`);
    const haltHeader = buildEvidenceHeader(cfg, startedAt, healthz.result, {
      status: 0,
      note: `deploy gate halted: ${deployGate.reason}`,
    });
    writeEvidencePack(cfg.outPath, haltHeader, [], redact);
    console.log(`Evidence pack written to ${cfg.outPath}`);
    process.exit(3);
  }

  // Phase 3 preflight: auth probe. Halt on 401/403/5xx/exception — do not
  // burn the replay on a known-bad state.
  const preflight = await runPreflight(cfg, redact);
  if (preflight.kind === 'halt') {
    console.error(`[PREFLIGHT HALT] ${preflight.reason}`);
    // Still emit an evidence pack so the halt is recorded.
    const haltHeader = buildEvidenceHeader(cfg, startedAt, healthz.result, {
      status: preflight.status,
      note: preflight.reason,
    });
    writeEvidencePack(cfg.outPath, haltHeader, [], redact);
    console.log(`Evidence pack written to ${cfg.outPath}`);
    process.exit(3);
  }
  console.log(`[PREFLIGHT] ${preflight.note}`);
  console.log('');

  const rows: EvidenceRow[] = [];
  const turnCounter = { value: 0 };
  // Track every step that did not pass. A step is skipped if its
  // direct prerequisite is in this set — this also handles transitive
  // dependencies because a skipped step adds itself to the set.
  const notPassed = new Set<string>();
  // Threaded out of the per-journey block so buildEvidenceHeader can
  // surface Step 1 captures (option/factor labels, graph hash,
  // resolved factor + fallback reason) into the evidence pack.
  let step1Capture: Step1Capture | undefined;

  // Resolve the journey. edit_graph DL-7 PR B is live on staging so
  // `dl7-edit-graph` is no longer gated by default — it runs as a
  // core V5 path. The `DL7_PR_B_DISABLE` emergency switch re-gates
  // the edit-graph journey if PR B regresses on staging; in that case
  // we emit a single skipped row pointing at the disable mechanism.
  const journeySteps = JOURNEY_REGISTRY[cfg.journey];
  const editGraphDisabled = isDL7EditGraphDisabled();
  const journeyDisabled =
    cfg.journey === 'dl7-edit-graph' && editGraphDisabled;

  if (journeyDisabled || PR_B_GATED_JOURNEYS.has(cfg.journey)) {
    rows.push({
      step: `journey:${cfg.journey}`,
      status: 'skipped',
      evidence:
        `journey "${cfg.journey}" is disabled via DL7_PR_B_DISABLE=true. ` +
        'edit_graph DL-7 PR B is live on staging by default; this switch only ' +
        'gates the replay journey when PR B is being rolled back.',
      outcome_class: 'skipped',
      journey_id: cfg.journey,
      requires_dl7_pr_b: true,
    });
    console.log(
      `[NOT APPLICABLE] journey "${cfg.journey}" disabled via DL7_PR_B_DISABLE; skipping all steps`,
    );
  } else {
    // Mutable journey context — the harness writes Step 1 capture into
    // `step1Capture` after the draft turn succeeds so DL-7 steps can
    // resolve their factor label deterministically.
    const journeyCtx: JourneyContext = {
      scenario_id: scenarioId,
      turn_counter: turnCounter,
    };
    const draftStepName = '1_draft_graph';

    for (const step of journeySteps) {
      if (step.depends_on && notPassed.has(step.depends_on)) {
        rows.push({
          step: step.name,
          status: 'skipped',
          evidence: `skipped: prerequisite ${step.depends_on} did not pass`,
          outcome_class: 'skipped',
          journey_id: cfg.journey,
        });
        console.log(`[SKIP] ${step.name} (depends on ${step.depends_on})`);
        notPassed.add(step.name);
        continue;
      }

      turnCounter.value += 1;

      // Build the request payload. DL-7 steps may throw
      // JourneyPreconditionError when Step 1 capture is missing data
      // (e.g. no factor labels); convert that to a clean failure row
      // without making an HTTP call.
      let payload;
      try {
        payload = step.buildPayload(journeyCtx);
      } catch (err) {
        if (err instanceof JourneyPreconditionError) {
          rows.push({
            step: step.name,
            status: 'failed',
            evidence: redactString(err.message, cfg.apiKey),
            failing_contract: err.failingContract,
            outcome_class: 'harness-auth-blocker',
            journey_id: cfg.journey,
          });
          console.log(`[FAIL] ${step.name}: ${err.failingContract} (precondition unmet)`);
          notPassed.add(step.name);
          continue;
        }
        throw err;
      }

      try {
        const result = await postTurn(cfg.baseUrl, payload, 90_000, cfg.apiKey);

        // Capture the per-step assistant_text once, redacted.
        const assistantTextRedacted = result.body?.assistant_text
          ? redactString(result.body.assistant_text, cfg.apiKey)
          : undefined;

        // A 200 with an error envelope (schema: "error.v1" or BoundaryError
        // shape) is a V5 runtime failure, NOT a success. Fail the row.
        if (result.status === 200 && hasErrorEnvelope(result.body)) {
          const errShape = result.body.code ?? result.body.error ?? 'unknown';
          rows.push({
            step: step.name,
            status: 'failed',
            evidence: redactString(
              `status=200 but error envelope present (${String(errShape)})`,
              cfg.apiKey,
            ),
            failing_contract: 'v5-runtime 200 with error envelope',
            outcome_class: 'v5-runtime',
            http_status: result.status,
            assistant_text: assistantTextRedacted,
            journey_id: cfg.journey,
          });
          console.log(`[FAIL] ${step.name}: 200 with error envelope (${String(errShape)})`);
          notPassed.add(step.name);
          continue;
        }

        // Step 1 capture: option labels (used by Step 5/6), factor
        // labels (used by DL-7 Step 2), and a best-effort graph hash
        // for the evidence pack. Defensive parsing — anything missing
        // degrades gracefully.
        if (step.name === draftStepName) {
          journeyCtx.step1Capture = captureStep1(result);
          step1Capture = journeyCtx.step1Capture;
        }

        const assertionCtx = buildAssertionContext(journeyCtx);
        const assertion = pickAssertion(step.name, assertionCtx)(result);
        const outcomeClass = classifyResponse({ status: result.status, body: result.body });

        // Capture chip details per step. Phase 2.6.4: supports triage of
        // staleness-signal-missing and similar chip-based-signal cases
        // where the relevant content lives in `action_type` / `label` /
        // `message` rather than `assistant_text`. Always redacted.
        const chipsRedacted = (result.body?.suggested_actions ?? []).map((chip) => ({
          id: chip.id,
          label: redactString(chip.label, cfg.apiKey),
          message: redactString(chip.message, cfg.apiKey),
          ...(chip.action_type !== undefined ? { action_type: chip.action_type } : {}),
        }));

        if (assertion.ok) {
          rows.push({
            step: step.name,
            status: 'passed',
            evidence: redactString(assertion.evidence, cfg.apiKey),
            outcome_class: outcomeClass,
            http_status: result.status,
            assistant_text: assistantTextRedacted,
            journey_id: cfg.journey,
            chips: chipsRedacted,
          });
          console.log(`[PASS] ${step.name}: ${redact(assertion.evidence)}`);
        } else {
          rows.push({
            step: step.name,
            status: 'failed',
            evidence: redactString(assertion.evidence, cfg.apiKey),
            failing_contract: redactString(assertion.failing_contract, cfg.apiKey),
            outcome_class: outcomeClass,
            http_status: result.status,
            assistant_text: assistantTextRedacted,
            journey_id: cfg.journey,
            chips: chipsRedacted,
          });
          console.log(
            `[FAIL] ${step.name}: ${redact(assertion.failing_contract)} | ${redact(assertion.evidence)}`,
          );
          notPassed.add(step.name);
        }
      } catch (err) {
        const rawMsg = err instanceof Error ? err.message : String(err);
        const msg = redactString(rawMsg, cfg.apiKey);
        const isTransport = isTransportError(rawMsg);
        rows.push({
          step: step.name,
          status: 'failed',
          evidence: `${isTransport ? 'transport error' : 'exception'}: ${msg}`,
          failing_contract: isTransport ? 'transport layer' : 'harness exception',
          outcome_class: 'harness-auth-blocker',
          journey_id: cfg.journey,
        });
        console.log(`[FAIL] ${step.name}: ${msg}`);
        notPassed.add(step.name);
      }
    }
  }

  // preflight.kind is narrowed to 'advance' here — the 'halt' branch
  // called process.exit(3) above.
  const header = buildEvidenceHeader(
    cfg,
    startedAt,
    healthz.result,
    { status: preflight.status, note: preflight.note },
    step1Capture,
  );

  writeEvidencePack(cfg.outPath, header, rows, redact);
  console.log('');
  console.log(`Evidence pack written to ${cfg.outPath}`);

  const failedCount = rows.filter((r) => r.status === 'failed').length;
  if (failedCount > 0) {
    console.error(`\n${failedCount} step(s) FAILED. Do not request staging push yet.`);
    process.exit(1);
  }
}

function buildEvidenceHeader(
  cfg: HarnessConfig,
  startedAt: string,
  healthz: HealthzResult | undefined,
  preflight: { readonly status: number; readonly note: string },
  step1Capture?: Step1Capture,
): EvidenceHeader {
  return {
    branch: safeGit('git rev-parse --abbrev-ref HEAD'),
    commit_sha: safeGit('git rev-parse HEAD'),
    base_url: cfg.baseUrl,
    started_at: startedAt,
    prompt_version: 'v38.2',
    prompt_hash: '2e25001a025e288c',
    healthz,
    preflight,
    auth_mode: cfg.apiKey ? 'authenticated' : 'unauthenticated',
    expected_build: cfg.expectedBuild,
    journey: cfg.journey,
    dl7_pr_b_landed: isDL7PrBLanded(),
    step1_capture: step1Capture,
  };
}

/**
 * Best-effort capture of Step 1 (`1_draft_graph`) outputs into the
 * journey context. DL-7 journeys read `resolvedFactorLabel` to craft
 * Step 2's payload; all journeys may read `optionLabels` for Step 5/6.
 *
 * Defensive parsing — every field is optional and degrades gracefully
 * when the response shape is unexpected. The `graphHashAtDraft` field
 * pulls from whichever wire field carries it (best-effort) and falls
 * back to null.
 */
function captureStep1(result: FetchResult): Step1Capture {
  const body = result.body as
    | {
        readonly draft_graph?: unknown;
        readonly graph_hash?: unknown;
        readonly analysis_ready?: { readonly graph_hash?: unknown };
      }
    | undefined;

  const draftGraph = body?.draft_graph;
  const nodes =
    draftGraph && typeof draftGraph === 'object' && 'nodes' in draftGraph
      ? (draftGraph as { nodes?: unknown }).nodes
      : null;

  const optionLabels: string[] = [];
  const factorLabels: string[] = [];
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      if (typeof n !== 'object' || n === null) continue;
      const kind = (n as { kind?: unknown }).kind;
      const label = (n as { label?: unknown }).label;
      if (typeof label !== 'string') continue;
      if (kind === 'option') optionLabels.push(label);
      else if (kind === 'factor') factorLabels.push(label);
    }
  }

  // Graph hash capture is optional and best-effort. The wire envelope
  // may not surface the analysis-affecting hash in every shape; record
  // null when absent rather than failing the journey.
  let graphHashAtDraft: string | null = null;
  if (typeof body?.graph_hash === 'string') {
    graphHashAtDraft = body.graph_hash;
  } else if (typeof body?.analysis_ready?.graph_hash === 'string') {
    graphHashAtDraft = body.analysis_ready.graph_hash;
  }

  const { label: resolvedFactorLabel, reason: factorLabelReason } =
    selectFactorLabel(factorLabels);

  return {
    optionLabels,
    factorLabels,
    graphHashAtDraft,
    resolvedFactorLabel,
    factorLabelReason,
  };
}

/**
 * Build the per-step assertion context out of the journey context.
 * Centralised so adding a new field (e.g. graph hash captures) only
 * touches one site.
 */
function buildAssertionContext(journeyCtx: JourneyContext): DL7AssertionContext {
  const step1 = journeyCtx.step1Capture;
  return {
    factorLabel: step1?.resolvedFactorLabel ?? null,
    step1OptionLabels: step1?.optionLabels ?? [],
    graphHashAtDraft: step1?.graphHashAtDraft ?? null,
  };
}

/**
 * Bind per-journey context into each step's assertion at factory time,
 * so the call site stays uniform (`pickAssertion(name, ctx)(result)`).
 *
 * Step-name conventions are stable across journeys — every DL-7 journey
 * starts with `1_draft_graph`, every analysis turn is `*_run_analysis`,
 * etc. — so dispatch is purely on the suffix after the leading number.
 */
function pickAssertion(
  stepName: string,
  ctx: DL7AssertionContext,
): (result: FetchResult) => AssertionResult {
  switch (stepName) {
    case '1_draft_graph':
      return assertDraftGraph;
    case '4_run_analysis':
    case '2_run_analysis':
      return assertAnalysisRun;
    case '5_explain_leader':
      return (result) => assertExplainLeader(result, ctx);
    case '4_explain_leader_stale':
      return (result) => assertExplainLeaderStale(result, ctx);
    case '2_set_factor_value':
    case '3_set_factor_value':
      return (result) => assertSetFactorValue(result, ctx);
    case '2_edit_graph_generic':
    case '3_edit_graph_generic':
      return (result) => assertEditGraphGeneric(result, ctx);
    case '3_what_changed':
      return (result) => assertWhatChanged(result, ctx);
    case '6_what_would_flip':
      return (result) => assertWhatWouldFlip(result, ctx);
    default:
      return assertProductShape;
  }
}

function safeGit(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

// Export for unit-test access. The CLI bootstrap below guards against
// accidental re-invocation on import.
// (`evaluateDeployGate` is exported inline above — do not re-export.)
export {
  MISSING_KEY_MESSAGE,
  WELL_FORMED_BUILD,
  assertAuthForBaseUrl,
  buildEvidenceHeader,
  isStaleDeployOverrideEnabled,
  parseArgs,
  readApiKey,
  readExpectedBuildEnv,
  run,
  runHealthz,
  runPreflight,
};

// Bootstrap only when invoked directly. Uses the canonical ESM pattern
// `import.meta.url === pathToFileURL(process.argv[1]).href` so the
// module is a no-op when imported by tests or other callers.
function isDirectCliInvocation(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectCliInvocation()) {
  run().catch((err) => {
    // Redact the secret if present. We don't have `cfg.apiKey` here, so
    // fall back to reading env (the same source).
    const secret = readApiKey();
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Harness fatal error:', redactString(msg, secret));
    // Fail-fast missing-key message exits 3 (auth blocker, not generic
    // failure). Any other fatal is exit 2.
    if (msg === MISSING_KEY_MESSAGE) {
      process.exit(3);
    }
    process.exit(2);
  });
}
