#!/usr/bin/env node

/**
 * Advisory live-model witness for Core Runtime continuity.
 *
 * Run only with BOTH opt-ins:
 *   ORCHESTRATOR_EVAL_LIVE_CANDIDATES=1 \
 *     pnpm exec tsx tools/conversation-harness/canonical-precedence-cli.ts --live
 *
 * This is N=3 LIVE_MODEL_ROUTING evidence. It is not CI, mounted, full-wire or
 * reliability evidence. The deterministic harness remains the merge gate.
 */

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import {
  HARD_MAX_LIVE_TURNS_PER_RUN,
  enforceTurnCap,
  resolveLiveGate,
} from '../orchestrator-eval/src/live-gate.js';
import { beginLiveEvalSingleAttempt } from '../../src/adapters/llm/live-eval-retry-policy.js';
import {
  assertLivePromptIdentity,
  assembleCanonicalPrecedenceCase,
  canonicalCaseFixtureHash,
  loadCanonicalPrecedenceCase,
  resolveLiveOrchestrator,
  runLiveCanonicalPrecedenceCase,
  type LiveCaseObservation,
} from './scorer/canonical-state-precedence.js';

const FIXTURES = [
  'canonical-precedence-case.json',
  'summary-retention-case.json',
] as const;
const RERUNS = 3;
/** Cache fallback + max-token retry + repair can make four provider attempts. */
const WORST_CASE_PROVIDER_HTTP_ATTEMPTS_PER_RUN = 4;

function requestedMaxTurns(argv: readonly string[]): number | undefined {
  const index = argv.indexOf('--max-turns');
  if (index < 0) return undefined;
  const raw = argv[index + 1];
  if (raw === undefined) throw new Error('--max-turns requires a value');
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--max-turns must be a positive integer (got ${raw})`);
  }
  return parsed;
}

function cleanGitEvidence(): { sha: string; tree: string } {
  try {
    const dirty = execFileSync(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      { encoding: 'utf8' },
    ).trim();
    if (dirty.length > 0) {
      throw new Error('live evaluator requires a clean worktree so HEAD identifies the executed bytes');
    }
    return {
      sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('live evaluator requires')) {
      throw error;
    }
    throw new Error('live evaluator could not bind execution to a clean git commit');
  }
}

export async function runCanonicalPrecedenceCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  const gate = resolveLiveGate({ argv, env });
  if (!gate.live) {
    process.stderr.write(`${gate.reason}\n`);
    return 2;
  }

  const plannedCalls = FIXTURES.length * RERUNS * WORST_CASE_PROVIDER_HTTP_ATTEMPTS_PER_RUN;
  enforceTurnCap(plannedCalls, requestedMaxTurns(argv));
  if (plannedCalls > HARD_MAX_LIVE_TURNS_PER_RUN) {
    throw new Error('internal live-call plan exceeds the shared hard cap');
  }
  const git = cleanGitEvidence();
  const releaseRetryPolicy = beginLiveEvalSingleAttempt();

  try {
    const assemblies = FIXTURES.map((name) =>
      assembleCanonicalPrecedenceCase(loadCanonicalPrecedenceCase(name)));
    const expectedPrompt = assemblies[0]!.systemPrompt;
    const snapshot = await assertLivePromptIdentity(expectedPrompt);
    const resolved = resolveLiveOrchestrator();
    const observations: LiveCaseObservation[] = [];

    for (const assembly of assemblies) {
      for (let run = 1; run <= RERUNS; run += 1) {
        observations.push(await runLiveCanonicalPrecedenceCase(assembly, run, resolved));
      }
    }

    const pass = observations.every((observation) => observation.score.pass);
    const report = {
      schema: 'canonical_precedence_live_report.v1',
      evidence_rung: 'LIVE_MODEL_ROUTING',
      advisory_only: true,
      reliability_claim: false,
      status: pass ? 'PASS' : 'FAIL',
      n_per_case: RERUNS,
      aggregation: 'worst_run_any_failure',
      git_sha: git.sha,
      git_tree: git.tree,
      fixture_hashes: Object.fromEntries(
        FIXTURES.map((name) => [name, canonicalCaseFixtureHash(name)]),
      ),
      prompt: {
        source: snapshot.source,
        version: snapshot.version,
        sent_hash: snapshot.sent_hash,
        expected_sent_hash: expectedPrompt.sent_hash,
      },
      model_plan: {
        resolved_model: resolved.resolution.resolved_model,
        provider: resolved.resolution.provider ?? null,
        resolution_source: resolved.resolution.resolution_source,
      },
      retry_policy: {
        repository_max_attempts: 1,
        provider_sdk_max_retries: 0,
      },
      planned_provider_http_attempt_ceiling: plannedCalls,
      hard_provider_http_attempt_ceiling: HARD_MAX_LIVE_TURNS_PER_RUN,
      cases: assemblies.map((assembly) => ({
        case_id: assembly.kase.id,
        raw_summary: assembly.kase.conversation_summary.text,
        runs: observations.filter((row) => row.case_id === assembly.kase.id),
      })),
      caveat:
        'Synthetic N=3 routing-model witness only. Summary generation, persistence reload, HTTP/UI egress and mounted behaviour are outside this evaluator.',
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return pass ? 0 : 1;
  } finally {
    releaseRetryPolicy();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  runCanonicalPrecedenceCli(process.argv.slice(2), process.env)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
