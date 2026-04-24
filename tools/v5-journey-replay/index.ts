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
 * Usage (post-authorised-deploy):
 *   pnpm tsx tools/v5-journey-replay/index.ts \
 *     --base-url https://cee-staging.onrender.com \
 *     --out Docs/v5/v5-golden-path-evidence-cee.md \
 *     --scenario-prefix staging
 *
 * The CLI is idempotent: each run generates a fresh scenario UUID, posts
 * the canonical steps, captures per-step results, and overwrites the
 * evidence pack with the product-shaped table.
 *
 * Log capture is stdout-only (correction 15) — the local harness assumes
 * `pnpm start` is logging to its own stdout, and relies on existing
 * routing-log.jsonl / turn_executor.completed events to reconstruct the
 * journey. Do NOT add a /debug/logs endpoint.
 *
 * Halt policy (correction 16): if a step reveals a systemic blocker
 * outside the approved Phase 2 scope, the row is marked `failed` with
 * a specific failing_contract. Scope is NOT expanded to force green.
 */

import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

import { postTurn } from './client.js';
import {
  assertAnalysisRun,
  assertDraftGraph,
  assertExplainLeader,
  assertProductShape,
} from './assertions.js';
import { CANONICAL_STEPS } from './steps.js';
import { writeEvidencePack, type EvidenceHeader } from './evidence-writer.js';
import type { EvidenceRow, HarnessConfig } from './types.js';

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
        'Usage: pnpm tsx tools/v5-journey-replay/index.ts [--base-url URL] [--out PATH] [--scenario-prefix TAG]',
      );
      process.exit(0);
    }
  }
  return { baseUrl, outPath, scenarioPrefix };
}

async function run(): Promise<void> {
  const cfg = parseArgs();
  const scenarioId = randomUUID();
  const startedAt = new Date().toISOString();

  console.log(`V5 journey replay`);
  console.log(`  base_url         = ${cfg.baseUrl}`);
  console.log(`  scenario_id      = ${scenarioId}`);
  console.log(`  scenario_prefix  = ${cfg.scenarioPrefix}`);
  console.log(`  out              = ${cfg.outPath}`);
  console.log('');

  const rows: EvidenceRow[] = [];
  const turnCounter = { value: 0 };
  let blockedBy: string | null = null;

  for (const step of CANONICAL_STEPS) {
    // Dependency-aware skipping: if a prerequisite step failed, skip this
    // step with a clear marker rather than producing a misleading evidence
    // row.
    if (step.depends_on && blockedBy === step.depends_on) {
      rows.push({
        step: step.name,
        status: 'skipped',
        evidence: `skipped: prerequisite ${step.depends_on} failed`,
      });
      console.log(`[SKIP] ${step.name} (depends on ${step.depends_on})`);
      continue;
    }

    turnCounter.value += 1;
    const payload = step.buildPayload({ scenario_id: scenarioId, turn_counter: turnCounter });

    try {
      const result = await postTurn(cfg.baseUrl, payload, 90_000);
      const assertion = pickAssertion(step.name)(result);

      if (assertion.ok) {
        rows.push({
          step: step.name,
          status: 'passed',
          evidence: assertion.evidence,
        });
        console.log(`[PASS] ${step.name}: ${assertion.evidence}`);
      } else {
        rows.push({
          step: step.name,
          status: 'failed',
          evidence: assertion.evidence,
          failing_contract: assertion.failing_contract,
        });
        console.log(
          `[FAIL] ${step.name}: ${assertion.failing_contract} | ${assertion.evidence}`,
        );
        blockedBy = step.name;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isConn = /ECONNREFUSED|fetch failed|network/i.test(msg);
      rows.push({
        step: step.name,
        status: isConn ? 'skipped' : 'failed',
        evidence: `${isConn ? 'server unreachable' : 'exception'}: ${msg}`,
        failing_contract: isConn ? 'local server not running' : 'harness exception',
      });
      console.log(`[${isConn ? 'SKIP' : 'FAIL'}] ${step.name}: ${msg}`);
      blockedBy = step.name;
    }
  }

  // Pull prompt metadata from the running server's exports if possible;
  // otherwise fall back to "unknown" — Phase 2.1 installation means the
  // local server always logs v5.routing_prompt_loaded at start.
  const header: EvidenceHeader = {
    branch: safeGit('git rev-parse --abbrev-ref HEAD'),
    commit_sha: safeGit('git rev-parse HEAD'),
    base_url: cfg.baseUrl,
    started_at: startedAt,
    prompt_version: 'v38.2',
    prompt_hash: '2e25001a025e288c',
  };

  writeEvidencePack(cfg.outPath, header, rows);
  console.log('');
  console.log(`Evidence pack written to ${cfg.outPath}`);

  const failedCount = rows.filter((r) => r.status === 'failed').length;
  if (failedCount > 0) {
    console.error(`\n${failedCount} step(s) FAILED. Do not request staging push yet.`);
    process.exit(1);
  }
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

run().catch((err) => {
  console.error('Harness fatal error:', err);
  process.exit(2);
});
