#!/usr/bin/env tsx
/**
 * V5 staging assurance CLI — `pnpm assurance:v5:staging`.
 *
 * Replays a disposable V5 staging journey against cee-staging, captures
 * serving SHA + flag state, validates the current CEE/coaching spine
 * (graphless analysis_not_ready, draft-first PLoT, deterministic mutation,
 * stale post-check degrade, rerun-clears-stale), proves Tier-2/3 fields stay
 * absent, cleans up exact scenario IDs child-first, and writes a Paul-readable
 * red/amber/green report.
 *
 * Manual command only. Reads `.env.staging.local` for the Supabase
 * service-role key (cleanup) + the assist key (auth). Secret VALUES are never
 * printed. See ../README.md › "V5 staging assurance".
 *
 * Exit codes:
 *   0 — all checks green/amber (no red)
 *   1 — at least one red (hard contract failure / unsafe state / residual)
 *   2 — fatal harness error
 *   3 — blocked before running (missing secrets / deploy halt / auth)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runAssurance, type AssuranceConfig } from './run.js';
import { consoleSummary } from './report.js';

const DEFAULT_BASE_URL = 'https://cee-staging.onrender.com';
const DEFAULT_ENV_FILE = '.env.staging.local';

function parseArgs(argv: readonly string[]): AssuranceConfig {
  let baseUrl = DEFAULT_BASE_URL;
  let envFile = DEFAULT_ENV_FILE;
  let expectedBuild: string | undefined;
  let allowStaleDeploy = false;
  let scenarioPrefix = `assurance-${Date.now()}`;
  let outPath = `test-diagnostics/v5-assurance/report-${Date.now()}.md`;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--base-url' && i + 1 < argv.length) baseUrl = argv[++i]!;
    else if (arg === '--out' && i + 1 < argv.length) outPath = argv[++i]!;
    else if (arg === '--env-file' && i + 1 < argv.length) envFile = argv[++i]!;
    else if (arg === '--scenario-prefix' && i + 1 < argv.length) scenarioPrefix = argv[++i]!;
    else if (arg === '--expected-build' && i + 1 < argv.length) expectedBuild = argv[++i]!.trim() || undefined;
    else if (arg.startsWith('--expected-build=')) {
      const v = arg.slice('--expected-build='.length).trim();
      expectedBuild = v.length > 0 ? v : undefined;
    } else if (arg === '--allow-stale-deploy') allowStaleDeploy = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: pnpm assurance:v5:staging [-- --base-url URL] [--out PATH] [--env-file PATH]\n' +
          '         [--scenario-prefix TAG] [--expected-build SHA] [--allow-stale-deploy]\n' +
          '\n' +
          `Defaults: --base-url ${DEFAULT_BASE_URL}, --env-file ${DEFAULT_ENV_FILE},\n` +
          '          --out test-diagnostics/v5-assurance/report-<ts>.md (gitignored).\n' +
          '\n' +
          'Credentials (names only) read from the env file — VALUES never printed:\n' +
          '  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (cleanup; service-role, LOCAL ONLY)\n' +
          '  OLUMI_REPLAY_API_KEY (or ASSIST_API_KEY)  (assist auth)\n' +
          '\n' +
          'Manual command only. Never wire the service-role key into CI.',
      );
      process.exit(0);
    }
  }

  return { baseUrl, scenarioPrefix, outPath, envFile, expectedBuild, allowStaleDeploy };
}

async function main(): Promise<void> {
  const cfg = parseArgs(process.argv.slice(2));
  console.log('V5 staging assurance');
  console.log(`  base_url        = ${cfg.baseUrl}`);
  console.log(`  env_file        = ${cfg.envFile}`);
  console.log(`  scenario_prefix = ${cfg.scenarioPrefix}`);
  console.log(`  out             = ${cfg.outPath}`);
  console.log(`  expected_build  = ${cfg.expectedBuild ?? 'not set (well-formed-only)'}`);
  console.log('');

  const outcome = await runAssurance(cfg);

  // Always write the report (even blocked / red), to a gitignored scratch path.
  try {
    mkdirSync(dirname(cfg.outPath), { recursive: true });
    writeFileSync(cfg.outPath, outcome.reportMarkdown, 'utf8');
    console.log(`Report written to ${cfg.outPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Could not write report to ${cfg.outPath}: ${msg}`);
  }

  if (outcome.phase === 'blocked') {
    console.error(`\nBLOCKED — ${outcome.blockedReason}`);
  } else {
    console.log('');
    console.log(consoleSummary(outcome.checks));
    console.log(`scenarios: ${outcome.scenarioIds.join(', ')}`);
  }

  process.exit(outcome.exitCode);
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

if (isDirectCliInvocation()) {
  main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Assurance fatal error:', msg);
    process.exit(2);
  });
}

export { parseArgs, main };
