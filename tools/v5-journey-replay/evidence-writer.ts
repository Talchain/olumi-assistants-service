/**
 * V5 alpha hardening Phase 3 — evidence pack markdown writer.
 *
 * Renders the per-step results as a product-shaped table plus a
 * pre-merge / post-authorised-deploy section split. Staging rows stay
 * empty until Paul authorises a push and the harness runs against the
 * live staging URL.
 */

import { writeFileSync } from 'node:fs';

import type { EvidenceRow } from './types.js';

export interface EvidenceHeader {
  readonly branch: string;
  readonly commit_sha: string;
  readonly base_url: string;
  readonly started_at: string;
  readonly prompt_version: string;
  readonly prompt_hash: string;
}

export function renderEvidencePack(
  header: EvidenceHeader,
  localRows: readonly EvidenceRow[],
): string {
  const lines: string[] = [];
  lines.push(`# V5 Golden Path — Evidence Pack (CEE)`);
  lines.push('');
  lines.push(
    'Phase 3 of V5 alpha hardening. This pack is produced by ' +
      '[tools/v5-journey-replay](../../tools/v5-journey-replay/) ' +
      'and serves as the V5 regression gate.',
  );
  lines.push('');
  lines.push('## Run metadata');
  lines.push('');
  lines.push(`- **Branch:** \`${header.branch}\``);
  lines.push(`- **Commit SHA:** \`${header.commit_sha}\``);
  lines.push(`- **Base URL:** ${header.base_url}`);
  lines.push(`- **Started at:** ${header.started_at}`);
  lines.push(`- **Prompt version:** \`${header.prompt_version}\``);
  lines.push(`- **Prompt hash:** \`${header.prompt_hash}\``);
  lines.push('');
  lines.push('## Pre-merge gate (local)');
  lines.push('');
  lines.push(
    'Harness runs against a locally-started server (`pnpm start`). Log ' +
      'capture is stdout-only per correction 15 — no remote log API. Step ' +
      '4 requires a reachable PLoT endpoint; when unreachable locally the ' +
      'step is marked `skipped` with the blocker noted. The unit-level ' +
      'regression for that path lives in ' +
      '[run-analysis-permissive-status.test.ts](../../src/orchestrator-v5/tools/handlers/__tests__/run-analysis-permissive-status.test.ts).',
  );
  lines.push('');
  lines.push('| step | status | evidence | failing_contract |');
  lines.push('|---|---|---|---|');
  for (const row of localRows) {
    const fc = row.failing_contract ?? '—';
    // Escape pipes in evidence strings so the table renders cleanly.
    const safeEvidence = row.evidence.replace(/\|/g, '\\|');
    const safeFC = fc.replace(/\|/g, '\\|');
    lines.push(`| \`${row.step}\` | ${statusEmoji(row.status)} ${row.status} | ${safeEvidence} | ${safeFC} |`);
  }
  lines.push('');
  lines.push('## Post-authorised-deploy gate (staging)');
  lines.push('');
  lines.push(
    'Populated by Paul after authorising the staging push. The harness ' +
      'runs against `https://cee-staging.onrender.com` with the same ' +
      'canonical steps. Staging log lines are pasted manually — no new ' +
      'log-exposure API surface is added.',
  );
  lines.push('');
  lines.push('| step | status | evidence | failing_contract |');
  lines.push('|---|---|---|---|');
  lines.push('| _pending Paul\'s authorisation_ | _—_ | _—_ | _—_ |');
  lines.push('');
  lines.push('## Canonical steps (exact brief)');
  lines.push('');
  lines.push('1. POST fresh scenario + decision brief → draft_graph response with post-draft chips');
  lines.push('2. "Which option looks weakest?" → references actual option/factor labels');
  lines.push('3. "Add another option" → product-shaped: 200, no BoundaryError, no internal terms');
  lines.push('4. chip_click payload for Run analysis → 200, PLoT completes, fact persisted');
  lines.push('5. "Why does the leading option win?" → names leading option + probability + driver + caveat');
  lines.push('6. "Increase the budget factor" → edit proposal or clarifying question');
  lines.push('');
  lines.push('### 4b — pinned unit regression (handler-level)');
  lines.push('');
  lines.push(
    'Unknown PLoT status with no usable result fields → typed fatal, not ' +
      'a misleading 200. Covered by the unit test ' +
      '`run-analysis-permissive-status.test.ts` (case: "unknown status ' +
      'with NO usable fields is fatal with cause_kind ' +
      'analysis_not_completed"). The handler cannot be exercised through ' +
      'the HTTP boundary without mocking the PLoT response, so this is ' +
      'asserted at the unit level rather than in the replay harness.',
  );
  lines.push('');
  lines.push('## Halt policy (correction 16)');
  lines.push('');
  lines.push(
    'If the harness uncovers a systemic blocker outside the approved ' +
      'Phase 2 scope, the row is marked `failed` with a specific ' +
      '`failing_contract` and the blocker documented below. Scope is ' +
      'NOT expanded to force green rows.',
  );
  lines.push('');

  // Discoveries section — items surfaced during review that are
  // intentionally deferred outside this branch's scope. Each carries a
  // one-line follow-up recommendation so Paul's next planning pass can
  // slot them in. Kept in the pack (not a separate doc) so the next
  // staging replay run has the deferred items visible in the same
  // artefact.
  lines.push('## Discoveries (deferred for follow-up)');
  lines.push('');
  lines.push(
    '| area | observation | follow-up recommendation |',
  );
  lines.push('|---|---|---|');
  lines.push(
    '| Handler failure recovery (P1-1) | `translateExecuteError` composes a coaching response for `HandlerInvocationFailedError` but returns via `failureType = HANDLER_INVOCATION_FAILED` → HTTP 500. Principle 1 ("default recoverable") suggests retryable handler failures (plot_timeout, plot_error, scenario_read_failed, options_not_configured) should commit as direct_answer and return 200, mirroring the Phase 2.2 validator pattern. | Extend Part B of the resilience contract to enumerate handler-failure fatals (only analysis_blocked / analysis_failed remain fatal) and port the `commitDirectAnswer` pattern to `translateExecuteError`. One table-driven test per retryable cause_kind. |',
  );
  lines.push(
    '| PLoT usable-fields enforcement on known statuses | `hasUsableResultFields` is only consulted for unknown statuses. Known statuses (`completed`, `computed`, `partial`) succeed regardless of whether records carry a usable id/label + finite probability. Contract Part C reads as a floor for ALL success paths; code enforces it selectively. | Thread `hasUsableResultFields` into the `ok` and `partial` branches of `evaluateAnalysisStatus`. When a known status arrives with no usable fields, demote to fatal (`analysis_not_completed`) with a dedicated cause_kind, or (softer) surface a caveat via assistant_text. Requires a decision on how strict to be. |',
  );
  lines.push('');

  const serverUnreachable = localRows.some((r) =>
    r.failing_contract === 'local server not running',
  );
  if (serverUnreachable) {
    lines.push('### Known blocker — local bootstrap');
    lines.push('');
    lines.push(
      'The pre-merge local gate requires `pnpm start` to be reachable at ' +
        'the `--base-url`. On this developer machine the server did NOT ' +
        'boot because required credentials (`SUPABASE_URL`, ' +
        '`SUPABASE_SERVICE_ROLE_KEY`) live only in the Render deploy env ' +
        'and are not present in the repo `.env` (see ' +
        '[reference_supabase_env.md](../../.claude/projects/-Users-paulslee-Documents-GitHub-olumi-assistants-service/memory/reference_supabase_env.md)).',
    );
    lines.push('');
    lines.push('**Implication:** per-step replay assertions could not run locally on this branch. The equivalent coverage for Phase 2 work is:');
    lines.push('');
    lines.push('- Phase 2.1 install: `src/orchestrator-v5/routing/__tests__/prompt-loader.test.ts` (8 tests, 1 conditional dist test)');
    lines.push('- Phase 2.2 recoverable validator: `src/orchestrator-v5/__tests__/turn-executor-recoverable-validator.test.ts` (8 tests, pinned ENTITY_KIND_MISMATCH + commit-failure-per-code)');
    lines.push('- Phase 2.3 PLoT matrix: `src/orchestrator-v5/tools/handlers/__tests__/run-analysis-permissive-status.test.ts` (11 tests)');
    lines.push('- Phase 2.4 chip gate: `src/orchestrator-v5/compose/__tests__/chip-generator.test.ts` (16 tests)');
    lines.push('- Phase 2.5 observability: `src/orchestrator-v5/__tests__/turn-executor-observability.test.ts` (3 tests)');
    lines.push('');
    lines.push(
      '**Recommendation:** run the harness against staging after Paul ' +
        'authorises the push. The post-authorised-deploy table above is ' +
        'the real end-to-end gate; the unit + integration tests are the ' +
        'pre-merge proof that each contract is implemented correctly.',
    );
    lines.push('');
  }

  return lines.join('\n');
}

export function writeEvidencePack(
  path: string,
  header: EvidenceHeader,
  rows: readonly EvidenceRow[],
): void {
  writeFileSync(path, renderEvidencePack(header, rows), 'utf-8');
}

function statusEmoji(s: string): string {
  if (s === 'passed') return '[PASS]';
  if (s === 'failed') return '[FAIL]';
  return '[SKIP]';
}
