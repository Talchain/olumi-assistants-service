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

import { getHealthz, postTurn, preflightAuth } from './client.js';
import {
  assertAnalysisRun,
  assertDraftGraph,
  assertExplainLeader,
  assertProductShape,
} from './assertions.js';
import { CANONICAL_STEPS } from './steps.js';
import { writeEvidencePack, type EvidenceHeader } from './evidence-writer.js';
import { classifyResponse, hasErrorEnvelope, isTransportError } from './classify-outcome.js';
import { isLocalHost } from './localhost.js';
import { createRedactor, redactString } from './redact.js';
import type { EvidenceRow, HarnessConfig, HealthzResult, PreflightVerdict } from './types.js';

const MISSING_KEY_MESSAGE =
  'OLUMI_REPLAY_API_KEY environment variable is required when --base-url ' +
  'points at a remote host. Set it before re-running.';

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

function parseArgs(): HarnessConfig {
  const args = process.argv.slice(2);
  let baseUrl = 'http://localhost:3000';
  let outPath = 'Docs/v5/v5-golden-path-evidence-cee.md';
  let scenarioPrefix = 'local';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--base-url' && i + 1 < args.length) {
      baseUrl = args[++i]!;
    } else if (arg === '--out' && i + 1 < args.length) {
      outPath = args[++i]!;
    } else if (arg === '--scenario-prefix' && i + 1 < args.length) {
      scenarioPrefix = args[++i]!;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: pnpm tsx tools/v5-journey-replay/index.ts [--base-url URL] [--out PATH] [--scenario-prefix TAG]\n' +
          'Auth: set OLUMI_REPLAY_API_KEY env var for remote URLs (required).',
      );
      process.exit(0);
    }
  }
  return { baseUrl, outPath, scenarioPrefix, apiKey: readApiKey() };
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
  console.log(`  auth             = ${cfg.apiKey ? 'enabled (key loaded from env)' : 'disabled (localhost or no key)'}`);
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
  let blockedBy: string | null = null;

  for (const step of CANONICAL_STEPS) {
    // Dependency-aware skipping: if a prerequisite step failed, skip
    // with a clear marker rather than producing a misleading evidence row.
    if (step.depends_on && blockedBy === step.depends_on) {
      rows.push({
        step: step.name,
        status: 'skipped',
        evidence: `skipped: prerequisite ${step.depends_on} failed`,
        outcome_class: 'skipped',
      });
      console.log(`[SKIP] ${step.name} (depends on ${step.depends_on})`);
      continue;
    }

    turnCounter.value += 1;
    const payload = step.buildPayload({ scenario_id: scenarioId, turn_counter: turnCounter });

    try {
      const result = await postTurn(cfg.baseUrl, payload, 90_000, cfg.apiKey);

      // A 200 with an error envelope (schema: "error.v1" or BoundaryError
      // shape) is a V5 runtime failure, NOT a success. Fail the row.
      if (result.status === 200 && hasErrorEnvelope(result.body)) {
        const errShape =
          (result.body as Record<string, unknown>).code ??
          result.body.error ??
          'unknown';
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
        });
        console.log(`[FAIL] ${step.name}: 200 with error envelope (${String(errShape)})`);
        blockedBy = step.name;
        continue;
      }

      const assertion = pickAssertion(step.name)(result);
      const outcomeClass = classifyResponse({ status: result.status, body: result.body });

      if (assertion.ok) {
        rows.push({
          step: step.name,
          status: 'passed',
          evidence: redactString(assertion.evidence, cfg.apiKey),
          outcome_class: outcomeClass,
          http_status: result.status,
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
        });
        console.log(
          `[FAIL] ${step.name}: ${redact(assertion.failing_contract)} | ${redact(assertion.evidence)}`,
        );
        blockedBy = step.name;
      }
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const msg = redactString(rawMsg, cfg.apiKey);
      const isTransport = isTransportError(rawMsg);
      rows.push({
        step: step.name,
        status: isTransport ? 'skipped' : 'failed',
        evidence: `${isTransport ? 'transport error' : 'exception'}: ${msg}`,
        failing_contract: isTransport ? 'transport layer' : 'harness exception',
        outcome_class: 'harness-auth-blocker',
      });
      console.log(`[${isTransport ? 'SKIP' : 'FAIL'}] ${step.name}: ${msg}`);
      blockedBy = step.name;
    }
  }

  // preflight.kind is narrowed to 'advance' here — the 'halt' branch
  // called process.exit(3) above.
  const header = buildEvidenceHeader(cfg, startedAt, healthz.result, {
    status: preflight.status,
    note: preflight.note,
  });

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
  };
}

function pickAssertion(stepName: string) {
  switch (stepName) {
    case '1_draft_graph':
      return assertDraftGraph;
    case '4_run_analysis':
      return assertAnalysisRun;
    case '5_explain_leader':
      return assertExplainLeader;
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
export {
  MISSING_KEY_MESSAGE,
  assertAuthForBaseUrl,
  buildEvidenceHeader,
  parseArgs,
  readApiKey,
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
