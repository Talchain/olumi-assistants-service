#!/usr/bin/env tsx
/**
 * V6 dual-draft activation smoke CLI — `pnpm activation:v6:staging`.
 *
 * BUILT ON THE QUARANTINED PRODUCTION-SYSTEM BRANCH; NEVER RUN AS PART OF
 * THAT BRANCH'S WORK. Manual operator command only — never CI.
 *
 * Modes (default: plan — zero env/DB/network access):
 *   --mode plan       print what each check WOULD read and exit 0
 *   --mode fixtures   deterministic dry run over --fixtures-file JSON
 *   --mode live       config/DB READS only, gated by BOTH --operator-confirm
 *                     AND a per-check interactive y/N (non-TTY → exit 3)
 *
 * NO MODE CAN MAKE AN LLM CALL: no check invokes an adapter (the model
 * check stops at router RESOLUTION). Secret VALUES are never printed — env
 * checks are name-presence only. Reports land in the gitignored
 * test-diagnostics/v6-activation/.
 *
 * Exit codes (assurance-CLI convention):
 *   0 — plan mode, or all checks green/amber/skipped
 *   1 — at least one red
 *   2 — fatal harness error
 *   3 — blocked before running (missing confirmation / non-TTY / bad args)
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';

import {
  SMOKE_CHECKS,
  runAllChecks,
  M2_TASK,
} from '../../src/cee/dual-model/activation-smoke/checks.js';
import { renderPlan, createPlanModeIO } from '../../src/cee/dual-model/activation-smoke/plan.js';
import {
  renderEvidencePacket,
  computeExitCode,
} from '../../src/cee/dual-model/activation-smoke/report.js';
import {
  createFixturesIO,
  type SmokeFixtures,
} from '../../src/cee/dual-model/activation-smoke/fixtures-io.js';
import type { SmokeIO, SmokeParams, CheckResult } from '../../src/cee/dual-model/activation-smoke/types.js';

type Mode = 'plan' | 'fixtures' | 'live';

interface CliConfig {
  mode: Mode;
  fixturesFile?: string;
  operatorConfirm: boolean;
  expectedModel?: string;
  scenarioId?: string;
  servingSha?: string;
  telemetryFile?: string;
  graphPairFile?: string;
  outPath: string;
}

function usage(): string {
  return [
    'Usage: pnpm activation:v6:staging [-- --mode plan|fixtures|live] [options]',
    '',
    '  --mode plan            (DEFAULT) print the check plan; no access of any kind',
    '  --mode fixtures        deterministic dry run; requires --fixtures-file PATH',
    '  --mode live            config/DB READS only; requires --operator-confirm AND per-check y/N',
    '  --fixtures-file PATH   JSON matching SmokeFixtures (fixtures mode)',
    '  --telemetry-file PATH  operator-supplied telemetry export JSON (live mode)',
    '  --graph-pair-file PATH operator-supplied {before, after} graph JSON (live mode)',
    '  --expected-model ID    expected CEE_MODEL_M2_REVIEW value (safe to print)',
    '  --scenario ID          scenario for artifact-persistence evidence',
    '  --serving-sha SHA      serving build SHA to stamp on the evidence packet',
    '  --out PATH             report path (default test-diagnostics/v6-activation/report-<ts>.md)',
    '',
    'No mode can make an LLM call. Secret VALUES are never printed.',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): CliConfig | null {
  const cfg: CliConfig = {
    mode: 'plan',
    operatorConfirm: false,
    outPath: `test-diagnostics/v6-activation/report-${Date.now()}.md`,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--mode' && i + 1 < argv.length) {
      const mode = argv[++i]!;
      if (mode !== 'plan' && mode !== 'fixtures' && mode !== 'live') return null;
      cfg.mode = mode;
    } else if (arg === '--fixtures-file' && i + 1 < argv.length) cfg.fixturesFile = argv[++i]!;
    else if (arg === '--telemetry-file' && i + 1 < argv.length) cfg.telemetryFile = argv[++i]!;
    else if (arg === '--graph-pair-file' && i + 1 < argv.length) cfg.graphPairFile = argv[++i]!;
    else if (arg === '--expected-model' && i + 1 < argv.length) cfg.expectedModel = argv[++i]!;
    else if (arg === '--scenario' && i + 1 < argv.length) cfg.scenarioId = argv[++i]!;
    else if (arg === '--serving-sha' && i + 1 < argv.length) cfg.servingSha = argv[++i]!;
    else if (arg === '--out' && i + 1 < argv.length) cfg.outPath = argv[++i]!;
    else if (arg === '--operator-confirm') cfg.operatorConfirm = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      return null;
    }
  }
  return cfg;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Live-mode IO: config/prompt-store/router READS only, built lazily so plan
 * and fixtures modes never load service config. The adapter object produced
 * by the router is discarded — resolution metadata only.
 */
function createLiveIO(cfg: CliConfig): SmokeIO {
  return {
    async getPromptText(slot) {
      const { getSystemPrompt } = await import('../../src/adapters/llm/prompt-loader.js');
      try {
        return await getSystemPrompt(slot);
      } catch {
        return null;
      }
    },
    async getConfiguredModel(task) {
      const { config } = await import('../../src/config/index.js');
      return task === M2_TASK ? (config.cee.models.m2_review ?? null) : null;
    },
    async getModelResolution(task) {
      const { getAdapterWithResolution } = await import('../../src/adapters/llm/router.js');
      try {
        const { resolution } = getAdapterWithResolution(task);
        return {
          provider: resolution.provider ?? 'unknown',
          resolved_model: resolution.resolved_model,
          resolution_source: resolution.resolution_source,
        };
      } catch (err) {
        console.error(`model resolution threw: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
    async getEnvPresence(name) {
      return process.env[name] !== undefined; // presence only — value never read
    },
    async getTelemetryExport() {
      return cfg.telemetryFile ? readJson(cfg.telemetryFile) : null;
    },
    async getGraphPair() {
      return cfg.graphPairFile
        ? (readJson(cfg.graphPairFile) as { before: unknown; after: unknown })
        : null;
    },
    async readArtifacts() {
      // The artifact store is not wired to any live client yet — the check
      // reports 'skipped: store absent' until the persistence lane lands.
      return null;
    },
  };
}

/** Per-check interactive gate around a live IO: every check must be y'd. */
async function runChecksWithConfirmation(
  io: SmokeIO,
  params: SmokeParams,
): Promise<readonly CheckResult[] | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const results: CheckResult[] = [];
    for (const { id, run } of SMOKE_CHECKS) {
      const answer = (await rl.question(`Run check "${id}"? [y/N] `)).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        results.push({
          id,
          status: 'skipped',
          evidence: ['operator declined'],
          remediation: 'Re-run and confirm this check when ready.',
        });
        continue;
      }
      try {
        results.push(await run(io, params));
      } catch (err) {
        results.push({
          id,
          status: 'red',
          evidence: [`check threw: ${err instanceof Error ? err.message : String(err)}`],
          remediation: 'Investigate the thrown error.',
        });
      }
    }
    return results;
  } finally {
    rl.close();
  }
}

function writeReport(outPath: string, markdown: string): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, markdown, 'utf-8');
  console.log(`\nEvidence packet written: ${outPath}`);
}

async function main(): Promise<number> {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg === null) {
    console.error(usage());
    return 3;
  }

  if (cfg.mode === 'plan') {
    console.log(renderPlan());
    // Sanity: the plan-mode IO must throw on any access — never used to run checks.
    void createPlanModeIO();
    return 0;
  }

  const params: SmokeParams = {
    expectedModel: cfg.expectedModel,
    scenarioId: cfg.scenarioId,
    servingSha: cfg.servingSha,
  };

  if (cfg.mode === 'fixtures') {
    if (!cfg.fixturesFile) {
      console.error('fixtures mode requires --fixtures-file PATH');
      return 3;
    }
    const fixtures = readJson(cfg.fixturesFile) as SmokeFixtures;
    const results = await runAllChecks(createFixturesIO(fixtures), params);
    const markdown = renderEvidencePacket(results, {
      generatedForMode: 'fixtures',
      servingSha: cfg.servingSha,
      generatedAt: new Date().toISOString(),
    });
    console.log(markdown);
    writeReport(cfg.outPath, markdown);
    return computeExitCode(results);
  }

  // live mode — double-gated.
  if (!cfg.operatorConfirm) {
    console.error('live mode is BLOCKED without --operator-confirm (and per-check y/N).');
    return 3;
  }
  if (!process.stdin.isTTY) {
    console.error('live mode requires an interactive TTY for per-check confirmation — blocked.');
    return 3;
  }
  console.log('LIVE MODE: config/DB reads only. No LLM call is possible from this tool.');
  const results = await runChecksWithConfirmation(createLiveIO(cfg), params);
  if (results === null) return 3;
  const markdown = renderEvidencePacket(results, {
    generatedForMode: 'live',
    servingSha: cfg.servingSha,
    generatedAt: new Date().toISOString(),
  });
  console.log(markdown);
  writeReport(cfg.outPath, markdown);
  return computeExitCode(results);
}

function isDirectCliInvocation(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectCliInvocation()) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    });
}
