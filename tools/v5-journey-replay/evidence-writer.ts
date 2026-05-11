/**
 * V5 alpha hardening Phase 3 — evidence pack markdown writer.
 *
 * Renders a single run's outcome: executive summary → deploy confirmation
 * (from public /healthz) → preflight → per-step results with outcome
 * class → discoveries.
 *
 * Redactor contract: a `redact` function is passed in by the caller.
 * Every row field and every header string that could possibly contain a
 * secret is run through `redact` before being written. This is the
 * third (belt-and-suspenders) redaction layer — rows should already be
 * clean by the time they arrive.
 */

import { writeFileSync } from 'node:fs';

import { createRedactor } from './redact.js';
import type { JourneyId, Step1Capture } from './steps.js';
import type { EvidenceRow, HealthzResult } from './types.js';

export interface EvidenceHeader {
  readonly branch: string;
  readonly commit_sha: string;
  readonly base_url: string;
  readonly started_at: string;
  readonly prompt_version: string;
  readonly prompt_hash: string;
  readonly healthz: HealthzResult | undefined;
  readonly preflight: { readonly status: number; readonly note: string };
  readonly auth_mode: 'authenticated' | 'unauthenticated';
  /**
   * Strict-mode opt-in SHA. When set, the executive summary asserts
   * `healthz.body.build === expected_build`. When unset, the deploy
   * row reports "well-formed build observed, no strict comparison".
   */
  readonly expected_build?: string;
  /**
   * Journey identifier this run executed. Optional and additive — the
   * field is rendered when present and elided when absent so existing
   * harness self-tests (which build headers without it) stay green.
   */
  readonly journey?: JourneyId;
  /**
   * DL7 PR-B feature flag observed at run time. Threaded into the
   * header so reviewers can see at a glance which gated assertions
   * were active. Optional for backwards-compat.
   */
  readonly dl7_pr_b_landed?: boolean;
  /**
   * Optional Step 1 capture surface. When present, the renderer adds a
   * "Step 1 capture" subsection to the journey block listing the
   * parsed option/factor labels, the resolved factor (with fallback
   * reason), and the captured graph hash. Reviewers use this to
   * verify the deterministic factor fallback (per the audit §3) and
   * cross-reference graph hashes across turns.
   */
  readonly step1_capture?: Step1Capture;
}

type Redactor = (v: unknown) => string;

// When no caller-supplied redactor is provided, fall back to a
// no-secret redactor from `redact.ts` rather than a hand-rolled
// stringifier. Keeps the rendering behaviour identical whether or
// not a secret is in play (modulo the actual replacement).
const identityRedact: Redactor = createRedactor(undefined);

function escapePipes(s: string): string {
  return s.replace(/\|/g, '\\|');
}

function statusLabel(s: string): string {
  if (s === 'passed') return '[PASS]';
  if (s === 'failed') return '[FAIL]';
  return '[SKIP]';
}

type StartupConfirmation = boolean | 'unverifiable' | 'not strict-checked';

function yesNo(
  v: boolean | StartupConfirmation | 'not capturable' | 'not externally verified',
): string {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  return v;
}

interface ExecutiveSummary {
  readonly reached_orchestrator: boolean;
  readonly v38_2_startup_confirmed: StartupConfirmation;
  readonly v38_2_per_turn_confirmed: boolean | 'not capturable';
  // Step 4 ran end-to-end (handler → PLoT → commit → response). The
  // boolean only flips true when step 4 PASSES — failures earlier in
  // the chain (commit, persistence, post-PLoT) cannot be distinguished
  // from "PLoT never called" without server logs.
  readonly run_analysis_passed_endtoend: boolean | 'not externally verified';
  readonly analysis_persisted_followup: boolean | 'not externally verified';
  readonly no_internal_terms: boolean;
}

function computeExecutiveSummary(
  rows: readonly EvidenceRow[],
  healthz: HealthzResult | undefined,
  expectedBuild: string | undefined,
): ExecutiveSummary {
  const hadRuntime = rows.some((r) => r.outcome_class === 'v5-runtime');
  const anyInternalTerm = rows.some((r) =>
    r.failing_contract?.toLowerCase().includes('forbidden term'),
  );
  const step4 = rows.find((r) => r.step === '4_run_analysis');
  const step5 = rows.find((r) => r.step === '5_explain_leader');

  // Step 4 only proves run_analysis end-to-end if it passes. A failure
  // mode like `chip_click_run_analysis_commit_failed` happens AFTER
  // the handler returns and (likely) after PLoT was called — so
  // reporting "PLoT = no" on a commit failure would be misleading. We
  // deliberately collapse to "not externally verified" unless the row
  // passes.
  const step4Endtoend: boolean | 'not externally verified' =
    step4?.status === 'passed' ? true : 'not externally verified';
  const step5Persisted: boolean | 'not externally verified' =
    step5?.status === 'passed' ? true : 'not externally verified';

  // Deploy confirmation. Three states:
  //   - 'unverifiable' — healthz returned no build field
  //   - 'not strict-checked' — well-formed build observed, no
  //     `expected_build` supplied (default mode)
  //   - true / false — strict mode: build matches / does not match
  //     `expected_build`
  const build = healthz?.body?.build;
  const startupConfirmed: StartupConfirmation =
    build === undefined
      ? 'unverifiable'
      : expectedBuild === undefined
        ? 'not strict-checked'
        : build === expectedBuild;

  return {
    reached_orchestrator: hadRuntime,
    v38_2_startup_confirmed: startupConfirmed,
    v38_2_per_turn_confirmed: 'not capturable',
    run_analysis_passed_endtoend: step4Endtoend,
    analysis_persisted_followup: step5Persisted,
    no_internal_terms: !anyInternalTerm,
  };
}

export function renderEvidencePack(
  header: EvidenceHeader,
  rows: readonly EvidenceRow[],
  redact: Redactor = identityRedact,
): string {
  const summary = computeExecutiveSummary(rows, header.healthz, header.expected_build);
  const lines: string[] = [];

  lines.push(`# V5 Golden Path — Evidence Pack (CEE)`);
  lines.push('');
  lines.push(
    'Phase 3 of V5 alpha hardening. Produced by ' +
      '[tools/v5-journey-replay](../../tools/v5-journey-replay/). This ' +
      'pack is the V5 replay gate.',
  );
  lines.push('');

  // ---- Executive summary ----
  lines.push('## Executive summary');
  lines.push('');
  lines.push('| signal | value |');
  lines.push('|---|---|');
  lines.push(`| Replay reached orchestrator | ${yesNo(summary.reached_orchestrator)} |`);
  lines.push(
    `| v38.2 confirmed (startup / healthz build) | ${yesNo(summary.v38_2_startup_confirmed)} |`,
  );
  lines.push(
    `| v38.2 confirmed (per-turn) | ${yesNo(summary.v38_2_per_turn_confirmed)} |`,
  );
  lines.push(
    `| run_analysis passed end-to-end (handler + commit + response) | ${yesNo(summary.run_analysis_passed_endtoend)} |`,
  );
  lines.push(
    `| Analysis persisted into follow-up context | ${yesNo(summary.analysis_persisted_followup)} |`,
  );
  lines.push(
    `| No internal terms in user-facing text | ${yesNo(summary.no_internal_terms)} |`,
  );
  lines.push('');

  // ---- Run metadata ----
  lines.push('## Run metadata');
  lines.push('');
  lines.push(`- **Branch:** \`${escapePipes(redact(header.branch))}\``);
  lines.push(
    `- **Harness code SHA at run time:** \`${escapePipes(redact(header.commit_sha))}\` ` +
      `(the SHA the replay harness was built from when this pack was produced; ` +
      `the commit that lands this pack into git history is typically one commit ahead — ` +
      `see the committed-by SHA in \`git log\` for that)`,
  );
  lines.push(`- **Base URL:** ${escapePipes(redact(header.base_url))}`);
  lines.push(`- **Started at:** ${header.started_at}`);
  lines.push(`- **Expected prompt version:** \`${header.prompt_version}\``);
  lines.push(`- **Expected prompt hash:** \`${header.prompt_hash}\``);
  lines.push(`- **Auth mode:** ${header.auth_mode}`);
  lines.push(
    `- **Expected build:** ${
      header.expected_build === undefined
        ? '_not set (default: well-formed-only check)_'
        : `\`${escapePipes(redact(header.expected_build))}\``
    }`,
  );
  if (header.journey !== undefined) {
    lines.push(`- **Journey:** \`${header.journey}\``);
  }
  if (header.dl7_pr_b_landed !== undefined) {
    // Historical name: `DL7_PR_B_LANDED`. The journey is no longer
    // PR-B-gated by default — DL-7 PR B merged on staging — but the
    // harness still honours an `DL7_PR_B_DISABLE=true` emergency
    // rollback switch. The semantic surfaced to readers is "is the
    // edit_graph journey currently active on this run?" not "did
    // PR B land?", so the label is renamed accordingly.
    const editGraphActive = header.dl7_pr_b_landed
      ? 'yes (edit_graph dispatch live on staging; assertions active)'
      : 'no (DL7_PR_B_DISABLE=true engaged — emergency rollback path)';
    lines.push(`- **edit_graph_journey_active:** ${editGraphActive}`);
    const gatedRows = rows.filter((r) => r.requires_dl7_pr_b === true);
    if (gatedRows.length > 0) {
      lines.push(
        `- **edit_graph-gated rows:** ${gatedRows.length} ` +
          '(skipped or marked `not_applicable` when DL7_PR_B_DISABLE=true)',
      );
    }
  }
  lines.push('');

  // ---- Deploy confirmation ----
  lines.push('## Deploy confirmation (Phase 2)');
  lines.push('');
  if (header.healthz === undefined) {
    lines.push('`/healthz` was not reached. Deploy metadata unverifiable for this run.');
  } else {
    const b = header.healthz.body ?? {};
    lines.push(`- **GET /healthz status:** ${header.healthz.status}`);
    lines.push(`- **build (commit short):** \`${escapePipes(redact(b.build ?? 'unknown'))}\``);
    lines.push(`- **version:** \`${escapePipes(redact(b.version ?? 'unknown'))}\``);
    lines.push(`- **service:** \`${escapePipes(redact(b.service ?? 'unknown'))}\``);
    lines.push(`- **degraded:** ${b.degraded ?? false}`);
    if (b.degraded_reasons && b.degraded_reasons.length > 0) {
      lines.push(`- **degraded_reasons:** ${escapePipes(redact(b.degraded_reasons.join(', ')))}`);
    }
    lines.push(`- **elapsed:** ${header.healthz.elapsed_ms}ms`);
    const observedBuild = escapePipes(redact(b.build ?? 'unknown'));
    if (summary.v38_2_startup_confirmed === true) {
      const expected = escapePipes(redact(header.expected_build ?? 'unknown'));
      lines.push('');
      lines.push(
        `Deploy confirmed: \`/healthz\` build \`${observedBuild}\` matches \`--expected-build ${expected}\`.`,
      );
    } else if (summary.v38_2_startup_confirmed === false) {
      const expected = escapePipes(redact(header.expected_build ?? 'unknown'));
      lines.push('');
      lines.push(
        `Deploy MISMATCH: \`/healthz\` build \`${observedBuild}\` does NOT match ` +
          `\`--expected-build ${expected}\`. Staging may be stale or you may be checking the wrong host.`,
      );
    } else if (summary.v38_2_startup_confirmed === 'unverifiable') {
      lines.push('');
      lines.push('Deploy metadata unverifiable (no build field in /healthz body).');
    } else {
      // 'not strict-checked' — well-formed build observed, no expected supplied.
      lines.push('');
      lines.push(
        `Deploy reachable: \`/healthz\` build \`${observedBuild}\` is well-formed. ` +
          'No strict-mode comparison run (set `--expected-build` or ' +
          '`OLUMI_REPLAY_EXPECTED_BUILD` to assert against a specific SHA).',
      );
    }
  }
  lines.push('');
  lines.push(
    '**Per-turn prompt evidence:** not capturable from the current ' +
      'response envelope. The runtime emits `prompt_version` / `system_chars` ' +
      'to structured telemetry at server startup, but the `/orchestrate/v2/turn` ' +
      'response payload does not surface them. Deploy confirmation relies on ' +
      '`/healthz.build` + Render dashboard as the externally-verifiable signal.',
  );
  lines.push('');

  // ---- Preflight ----
  lines.push('## Preflight (Phase 3)');
  lines.push('');
  lines.push(
    'Two-stage probe before the six canonical steps: (a) public `/healthz` ' +
      'for reachability, (b) authenticated POST to `/orchestrate/v2/turn` ' +
      'with a minimal body. Halt on 401/403/5xx/exception — do not burn ' +
      'the replay on a known-bad state.',
  );
  lines.push('');
  lines.push(
    `- **Auth probe status:** ${header.preflight.status} — ${escapePipes(redact(header.preflight.note))}`,
  );
  lines.push('');

  // ---- Six-step replay table ----
  lines.push('## Six-step replay');
  lines.push('');
  if (rows.length === 0) {
    lines.push(
      '_No rows: replay halted before the canonical steps ran. See preflight section above._',
    );
  } else {
    lines.push('| step | status | outcome class | http | evidence | failing_contract |');
    lines.push('|---|---|---|---|---|---|');
    for (const row of rows) {
      const fc = row.failing_contract ?? '—';
      const http = row.http_status !== undefined ? String(row.http_status) : '—';
      const ev = escapePipes(redact(row.evidence));
      const fcOut = escapePipes(redact(fc));
      lines.push(
        `| \`${row.step}\` | ${statusLabel(row.status)} ${row.status} | ${row.outcome_class} | ${http} | ${ev} | ${fcOut} |`,
      );
    }
  }
  lines.push('');

  // Per-step assistant_text dump. Folded under the table rather than
  // into a column so the table stays scannable. Pre-fix baseline showed
  // Step 5 passed structurally with text_len=1497 while curl on the
  // same staging build returned a denial phrase — content persistence
  // closes that blind spot. Each block is rendered inside a fenced
  // code section with the redacted text verbatim.
  const rowsWithText = rows.filter(
    (r) => typeof r.assistant_text === 'string' && r.assistant_text.length > 0,
  );
  if (rowsWithText.length > 0) {
    lines.push('### assistant_text per step (redacted)');
    lines.push('');
    for (const row of rowsWithText) {
      lines.push(`#### \`${row.step}\``);
      lines.push('');
      lines.push('```');
      lines.push(redact(row.assistant_text ?? ''));
      lines.push('```');
      // Phase 2.6.4: render chip details inline so reviewers can see
      // chip-based signals (e.g. "rerun analysis" prompts that satisfy
      // a staleness contract via chip rather than text). Empty chip
      // array prints nothing.
      if (row.chips && row.chips.length > 0) {
        lines.push('Chips:');
        for (const chip of row.chips) {
          const action = chip.action_type ? ` action_type=\`${escapePipes(redact(chip.action_type))}\`` : '';
          lines.push(`- \`${escapePipes(redact(chip.id))}\` — **${escapePipes(redact(chip.label))}** — "${escapePipes(redact(chip.message))}"${action}`);
        }
      }
      lines.push('');
    }
  }

  // ---- Canonical steps brief (canonical journey only) ----
  // For DL-7 journeys, the step descriptions live in `steps.ts`
  // alongside each `JourneyStep.description`; the table above already
  // captures the per-step verdict. Suppress the canonical brief here
  // when the run was a DL-7 journey to avoid misleading readers.
  if (header.journey === undefined || header.journey === 'canonical') {
    lines.push('## Canonical steps (from brief)');
    lines.push('');
    lines.push('1. POST fresh scenario + decision brief → draft_graph response with post-draft chips');
    lines.push('2. "Which option looks weakest?" → references actual option/factor labels');
    lines.push('3. "Add another option" → product-shaped: 200, no BoundaryError, no internal terms');
    lines.push('4. chip_click payload for Run analysis → 200, PLoT completes, fact persisted');
    lines.push('5. "Why does the leading option win?" → names leading option + probability + driver + caveat');
    lines.push('6. "Increase the budget factor" → edit proposal or clarifying question');
    lines.push('');
  } else {
    lines.push(`## DL-7 journey: \`${header.journey}\``);
    lines.push('');
    lines.push(
      'See per-step `description` fields in [tools/v5-journey-replay/steps.ts]' +
        '(../../tools/v5-journey-replay/steps.ts) for the canonical narrative of this journey. ' +
        'The replay table above is the authoritative pass/fail record.',
    );
    lines.push('');
    if (header.step1_capture !== undefined) {
      const cap = header.step1_capture;
      lines.push('### Step 1 capture');
      lines.push('');
      lines.push(
        `- **Option labels parsed:** ${
          cap.optionLabels.length === 0
            ? '_none_'
            : cap.optionLabels.map((l) => `\`${escapePipes(redact(l))}\``).join(', ')
        }`,
      );
      lines.push(
        `- **Factor labels parsed:** ${
          cap.factorLabels.length === 0
            ? '_none_'
            : cap.factorLabels.map((l) => `\`${escapePipes(redact(l))}\``).join(', ')
        }`,
      );
      lines.push(
        `- **Resolved factor for Step 2:** ${
          cap.resolvedFactorLabel === null
            ? '_none — Step 2 fails with `no_factor_label_available`_'
            : `\`${escapePipes(redact(cap.resolvedFactorLabel))}\``
        } _(fallback reason: \`${cap.factorLabelReason}\`)_`,
      );
      lines.push(
        `- **Graph hash at draft (post-Step 1):** ${
          cap.graphHashAtDraft === null
            ? '_not surfaced on wire envelope_'
            : `\`${escapePipes(redact(cap.graphHashAtDraft))}\``
        }`,
      );
      lines.push('');
    }
  }
  lines.push('### 4b — pinned unit regression (handler-level)');
  lines.push('');
  lines.push(
    'Unknown PLoT status with no usable result fields → typed fatal, not ' +
      'a misleading 200. Covered by the unit test ' +
      '[run-analysis-permissive-status.test.ts](../../src/orchestrator-v5/tools/handlers/__tests__/run-analysis-permissive-status.test.ts). ' +
      'The handler cannot be exercised through the HTTP boundary without mocking ' +
      'the PLoT response, so this is asserted at the unit level.',
  );
  lines.push('');

  // ---- Halt policy ----
  lines.push('## Halt policy');
  lines.push('');
  lines.push(
    'If the harness uncovers a systemic blocker outside the approved Phase 2 ' +
      'scope, the row is marked `failed` with a specific `failing_contract` ' +
      'and the blocker documented in Discoveries. Scope is NOT expanded to ' +
      'force green rows.',
  );
  lines.push('');

  // ---- Discoveries ----
  lines.push('## Discoveries (deferred for follow-up)');
  lines.push('');
  lines.push('| area | observation | follow-up recommendation |');
  lines.push('|---|---|---|');
  lines.push(
    '| Handler failure recovery (P1-1) | `translateExecuteError` composes a coaching response for `HandlerInvocationFailedError` but returns via `failureType = HANDLER_INVOCATION_FAILED` → HTTP 500. Principle 1 ("default recoverable") suggests user-recoverable handler failures (args_validation_failed, options_not_configured, analysis_blocked) should commit as direct_answer and return 200. | See [v5-p1-1-handler-failure-scope.md](v5-p1-1-handler-failure-scope.md) for the full cause-kind classification table. |',
  );
  lines.push(
    '| PLoT usable-fields enforcement on known statuses | `hasUsableResultFields` is only consulted for unknown statuses. Known statuses (`completed`, `computed`, `partial`) succeed regardless of whether records carry a usable id/label + finite probability. | Thread `hasUsableResultFields` into the `ok` / `partial` branches of `evaluateAnalysisStatus`. When a known status arrives with no usable fields, demote to fatal (`analysis_not_completed`) or surface a caveat. |',
  );
  lines.push(
    '| `v5_journey_id` in unknown-status warning | `evaluateAnalysisStatus` logs `event: external_contract_unknown_status` with `request_id` but not `v5_journey_id`. Adding it requires a `ctx` signature change. | Deferred from this branch per the hard "one-liner only" limit. Pick up when the next `evaluateAnalysisStatus` change happens. |',
  );
  lines.push(
    '| Per-step assertions are content-shape only | Step 2 does not assert that the response references actual option/factor labels from step 1\'s draft. Step 4 cannot verify analysis fact persistence without reading Supabase. Step 5 does not require leading option, probability, driver, or caveat to be present. A generic 200 with non-empty `assistant_text` can pass these. | Strengthen the per-step DSL: thread step 1\'s parsed labels into step 2\'s assertion; add Supabase facts-table read for step 4 (or a dedicated unit test); add required-substring matchers (probability percent, "leading", "driver", caveat marker) for step 5. New brief — out of scope here. |',
  );
  lines.push(
    '| Forbidden-term scan tolerates plain `handler` | The brief lists `handler` as forbidden user-facing terminology. Current implementation matches `handler[ _](id\\|failed\\|error\\|registered)` only — plain `handler` in isolation passes. The looser stance was deliberate (avoid false positives on "handles" / legitimate user-facing uses) but diverges from the brief. | Decision required: tighten to brief-strict (and accept some false positives) or document the loose policy in the forbidden-terms.ts header. New brief — out of scope here. |',
  );
  lines.push('');

  return lines.join('\n');
}

export function writeEvidencePack(
  path: string,
  header: EvidenceHeader,
  rows: readonly EvidenceRow[],
  redact: Redactor = identityRedact,
): void {
  writeFileSync(path, renderEvidencePack(header, rows, redact), 'utf-8');
}
