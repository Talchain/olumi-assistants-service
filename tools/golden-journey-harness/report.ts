/**
 * Golden-Journey Harness v1 — classified report writer.
 *
 * Renders the run as markdown: an executive verdict + the single "which
 * core component must fix this next", a 6-component matrix, the A1..A7
 * invariant table, a per-step table for the full 10-step journey, the
 * findings detail, and the dispatch coverage caveats.
 *
 * Reuses `../v5-journey-replay/redact.js` for the secret-redaction
 * contract. The per-step assistant_text dump mirrors the evidence-pack
 * convention from `../v5-journey-replay/evidence-writer.js`.
 */

import { writeFileSync } from 'node:fs';

import { createRedactor } from '../v5-journey-replay/redact.js';
import type { WireChip } from './observation.js';

import {
  COMPONENT_LABEL,
  COMPONENT_NUMBER,
  CORE_COMPONENTS,
  INVARIANT_TITLE,
  isAdvisoryFinding,
  type CoreComponent,
  type CoverageCaveat,
  type Finding,
  type InvariantId,
  type InvariantStatus,
} from './components.js';

type Redactor = (v: unknown) => string;
const identityRedact: Redactor = createRedactor(undefined);

const INVARIANT_ORDER: readonly InvariantId[] = [
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'A7',
  'A8',
  'A9',
  'A10',
  'A11',
];

/** Raw per-step capture produced by the runner (before classification). */
export interface StepCapture {
  readonly step: string;
  readonly role: string;
  readonly http_status?: number;
  readonly skipped?: boolean;
  readonly synthetic?: boolean;
  readonly evidence: string;
  readonly assistant_text?: string;
  readonly chips?: readonly WireChip[];
}

/** One row of the latency summary (A10 — captured per turn for tracking). */
export interface LatencyRow {
  readonly step: string;
  readonly role: string;
  readonly totalMs: number | undefined;
  readonly cls: string;
  readonly budgetMs: number;
  readonly llmCalls: number | undefined;
  readonly overBudget: boolean;
}

export interface GoldenReportInput {
  readonly mode: 'live' | 'replay';
  readonly baseUrl?: string;
  readonly startedAt: string;
  readonly branch?: string;
  readonly commitSha?: string;
  readonly healthzBuild?: string;
  readonly diagnosticTraceExpected: boolean;
  readonly captures: readonly StepCapture[];
  readonly findings: readonly Finding[];
  readonly caveats: readonly CoverageCaveat[];
  readonly latencySummary?: readonly LatencyRow[];
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, '\\|');
}

/** Worst status wins: fail > inconclusive > pass. */
function worst(a: InvariantStatus, b: InvariantStatus): InvariantStatus {
  const rank: Record<InvariantStatus, number> = { fail: 0, inconclusive: 1, pass: 2 };
  return rank[a] <= rank[b] ? a : b;
}

function statusBadge(s: InvariantStatus | 'skipped'): string {
  switch (s) {
    case 'pass':
      return '[PASS] pass';
    case 'fail':
      return '[FAIL] fail';
    case 'inconclusive':
      return '[INCONCLUSIVE] inconclusive';
    default:
      return '[SKIP] skipped';
  }
}

/** Aggregate findings to a single status per invariant. */
export function statusByInvariant(findings: readonly Finding[]): Record<InvariantId, InvariantStatus | undefined> {
  const out: Partial<Record<InvariantId, InvariantStatus>> = {};
  for (const f of findings) {
    const prev = out[f.invariant_id];
    out[f.invariant_id] = prev === undefined ? f.status : worst(prev, f.status);
  }
  return out as Record<InvariantId, InvariantStatus | undefined>;
}

/**
 * "Which core component must fix this next?" — the primary component of the
 * highest-priority finding. Priority: a GATING fail beats an ADVISORY fail
 * (A5 / provisional A1 are semantic & LLM-variance-prone) beats an
 * inconclusive; ties broken by invariant order (A1..A7), then component number.
 */
export function nextComponentToFix(
  findings: readonly Finding[],
): { component: CoreComponent; invariant: InvariantId; evidence: string; advisory: boolean } | null {
  const ranked = findings
    .filter((f) => f.status !== 'pass')
    .map((f) => ({
      f,
      // 0 = gating fail, 1 = advisory fail, 2 = inconclusive
      priority: f.status === 'fail' ? (isAdvisoryFinding(f) ? 1 : 0) : 2,
      invOrder: INVARIANT_ORDER.indexOf(f.invariant_id),
      compNum: COMPONENT_NUMBER[f.component_primary],
    }))
    .sort(
      (a, b) =>
        a.priority - b.priority || a.invOrder - b.invOrder || a.compNum - b.compNum,
    );
  if (ranked.length === 0) return null;
  const top = ranked[0]!.f;
  return {
    component: top.component_primary,
    invariant: top.invariant_id,
    evidence: top.evidence,
    advisory: isAdvisoryFinding(top),
  };
}

export function renderGoldenReport(input: GoldenReportInput, redact: Redactor = identityRedact): string {
  const lines: string[] = [];
  const invStatus = statusByInvariant(input.findings);
  const failCount = input.findings.filter((f) => f.status === 'fail').length;
  const gatingFailCount = input.findings.filter((f) => f.status === 'fail' && !isAdvisoryFinding(f)).length;
  const advisoryFailCount = failCount - gatingFailCount;
  const inconclusiveCount = input.findings.filter((f) => f.status === 'inconclusive').length;
  const passCount = input.findings.filter((f) => f.status === 'pass').length;
  const next = nextComponentToFix(input.findings);

  lines.push('# Olumi Golden-Journey Harness v1 — Classified Report');
  lines.push('');
  lines.push(
    'Produced by [tools/golden-journey-harness](../../tools/golden-journey-harness/). Drives the core PoC ' +
      'journey (draft → run analysis → explain → follow-up → mutate → rerun → explain what changed → ' +
      'reload → verify chips → capture debug) and classifies every assertion into one of the six core ' +
      'components.',
  );
  lines.push('');

  // ---- Executive verdict ----
  lines.push('## Executive verdict');
  lines.push('');
  lines.push('| signal | value |');
  lines.push('|---|---|');
  lines.push(`| Mode | ${input.mode} |`);
  lines.push(`| Findings: pass / inconclusive / fail | ${passCount} / ${inconclusiveCount} / ${failCount} |`);
  lines.push(`| Fails: gating / advisory | ${gatingFailCount} / ${advisoryFailCount} |`);
  lines.push(
    `| **Next component to fix** | ${
      next === null
        ? '_none — no fails or inconclusives_'
        : `**${COMPONENT_NUMBER[next.component]}. ${COMPONENT_LABEL[next.component]}** (via ${next.invariant})${
            next.advisory ? ' — _advisory only (not a gate; deterministic replay is the gate)_' : ''
          }`
    } |`,
  );
  lines.push(
    `| Gating verdict | ${gatingFailCount > 0 ? `${gatingFailCount} gating fail(s)` : 'no gating fails'} (advisory fails do not gate) |`,
  );
  lines.push(
    `| Diagnostic-trace flag confirmed ON | ${input.diagnosticTraceExpected ? 'yes' : 'no — A6 mostly inconclusive (guardrail #5)'} |`,
  );
  lines.push('');
  if (!input.diagnosticTraceExpected) {
    lines.push(
      '> ⚠ **Guardrail #5:** `CEE_DIAGNOSTIC_TRACE_ENABLED` / `V5_TIMING_DEBUG` were not confirmed ON for ' +
        'this run. Observability (A6) is mostly inconclusive and this baseline must not be treated as ' +
        'meaningful coverage until the trace flags are confirmed safely enabled.',
    );
    lines.push('');
  }
  // Gating doctrine — which invariants drive the exit code, and why.
  lines.push('## Gating doctrine');
  lines.push('');
  lines.push('- **Deterministic + safety invariants gate** (A3, A6, A7 — structural; a fail is a real regression).');
  lines.push('- **LLM-semantic *quality* invariants advise** (A5 coaching-grounding — variance-prone; reported, not exit-gating).');
  lines.push(
    '- **A4 stays gating** despite reading assistant text: it is a safety/honesty invariant (no claiming a ' +
      'mutation that did not happen), where a false-fail is the safe direction and trust rests on the Brief 4 ' +
      'structural-honesty detector — not free-text quality.',
  );
  lines.push(
    '- **A1 is advisory _for now_** (still provisional; prose/context-observability dependent). It **graduates ' +
      'to gating** once canonical-state **M3 `_context_summary`** + the canonical state object make coherence ' +
      'wire-grounded.',
  );
  lines.push(
    '- **M3 double role:** unblocks **A2** live context observability (in-process-only until then) AND closes ' +
      'the residual **A5** content-level uncertainty by exposing the actual context the model received during ' +
      'future thin-response checks.',
  );
  lines.push('');

  // ---- Run metadata ----
  lines.push('## Run metadata');
  lines.push('');
  lines.push(`- **Mode:** ${input.mode}`);
  if (input.baseUrl) lines.push(`- **Base URL:** ${escapePipes(redact(input.baseUrl))}`);
  lines.push(`- **Started at:** ${input.startedAt}`);
  if (input.branch) lines.push(`- **Branch:** \`${escapePipes(redact(input.branch))}\``);
  if (input.commitSha) lines.push(`- **Harness commit:** \`${escapePipes(redact(input.commitSha))}\``);
  if (input.healthzBuild) lines.push(`- **Deployed build (/healthz):** \`${escapePipes(redact(input.healthzBuild))}\``);
  lines.push('');

  // ---- 6-component matrix ----
  lines.push('## Core-component matrix');
  lines.push('');
  lines.push('| # | component | invariants | worst status |');
  lines.push('|---|---|---|---|');
  for (const comp of CORE_COMPONENTS) {
    const invs = INVARIANT_ORDER.filter(
      (id) => input.findings.some((f) => f.invariant_id === id && f.component_primary === comp),
    );
    let compWorst: InvariantStatus | undefined;
    for (const id of invs) {
      const s = invStatus[id];
      if (s) compWorst = compWorst === undefined ? s : worst(compWorst, s);
    }
    lines.push(
      `| ${COMPONENT_NUMBER[comp]} | ${COMPONENT_LABEL[comp]} | ${invs.length > 0 ? invs.join(', ') : '—'} | ${
        compWorst ? statusBadge(compWorst) : '—'
      } |`,
    );
  }
  lines.push('');

  // ---- Invariant table ----
  lines.push('## Invariant results (A1..A7)');
  lines.push('');
  lines.push('| id | invariant | primary component | status | note |');
  lines.push('|---|---|---|---|---|');
  for (const id of INVARIANT_ORDER) {
    const relevant = input.findings.filter((f) => f.invariant_id === id);
    const status = invStatus[id];
    const primary = relevant[0]?.component_primary;
    const provisional = relevant.some((f) => f.provisional);
    // Prefer a failing finding's evidence; else inconclusive; else pass.
    const repr =
      relevant.find((f) => f.status === 'fail') ??
      relevant.find((f) => f.status === 'inconclusive') ??
      relevant[0];
    lines.push(
      `| ${id}${provisional ? ' _(provisional)_' : ''} | ${escapePipes(INVARIANT_TITLE[id])} | ${
        primary ? `${COMPONENT_NUMBER[primary]}. ${COMPONENT_LABEL[primary]}` : '—'
      } | ${status ? statusBadge(status) : '— not evaluated'} | ${repr ? escapePipes(redact(repr.evidence)) : '—'} |`,
    );
  }
  lines.push('');

  // ---- Per-step table (full 10-step journey) ----
  lines.push('## Journey steps');
  lines.push('');
  lines.push('| step | role | http | status | evidence |');
  lines.push('|---|---|---|---|---|');
  for (const cap of input.captures) {
    const stepFindings = input.findings.filter((f) => f.step === cap.step);
    let status: InvariantStatus | 'skipped';
    if (cap.skipped) {
      status = 'skipped';
    } else if (stepFindings.length === 0) {
      status = cap.synthetic ? 'pass' : 'inconclusive';
    } else {
      status = stepFindings.reduce<InvariantStatus>((acc, f) => worst(acc, f.status), 'pass');
    }
    lines.push(
      `| \`${cap.step}\` | ${cap.role} | ${cap.http_status ?? '—'} | ${statusBadge(status)} | ${escapePipes(
        redact(cap.evidence),
      )} |`,
    );
  }
  lines.push('');

  // ---- Findings detail (fails + inconclusives) ----
  const actionable = input.findings.filter((f) => f.status !== 'pass');
  lines.push('## Findings (fails + inconclusives)');
  lines.push('');
  if (actionable.length === 0) {
    lines.push('_No fails or inconclusives — every wire-observable invariant held._');
  } else {
    lines.push('| invariant | status | gating? | severity | component | step | evidence |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const f of actionable) {
      const gating = f.status === 'fail' && !isAdvisoryFinding(f) ? 'gating' : f.status === 'fail' ? 'advisory' : '—';
      lines.push(
        `| ${f.invariant_id}${f.provisional ? ' _(prov.)_' : ''} | ${f.status} | ${gating} | ${f.severity} | ${
          COMPONENT_NUMBER[f.component_primary]
        }. ${COMPONENT_LABEL[f.component_primary]} | ${f.step ?? '—'} | ${escapePipes(redact(f.evidence))} |`,
      );
    }
  }
  lines.push('');

  // ---- Coverage caveats (dispatch guardrails) ----
  lines.push('## Coverage caveats (what this run did NOT prove)');
  lines.push('');
  if (input.caveats.length === 0) {
    lines.push('_None recorded._');
  } else {
    lines.push('| component | caveat | detail |');
    lines.push('|---|---|---|');
    for (const c of input.caveats) {
      lines.push(
        `| ${COMPONENT_NUMBER[c.component]}. ${COMPONENT_LABEL[c.component]} | ${escapePipes(c.title)} | ${escapePipes(
          c.detail,
        )} |`,
      );
    }
  }
  lines.push('');

  // ---- CEE acceptance requirements (inconclusive = unobservable, NOT pass) ----
  const inconclusive = input.findings.filter((f) => f.status === 'inconclusive');
  lines.push('## CEE acceptance requirements (close these to turn the baseline green)');
  lines.push('');
  lines.push(
    'Each row is something the harness **could not prove** because the signal is not observable today — ' +
      'recorded as an acceptance requirement, **not** a pass. Closing these (mostly wire-surfacing on the CEE ' +
      'side) is what lets the corresponding invariant graduate to a real pass/fail.',
  );
  lines.push('');
  if (inconclusive.length === 0) {
    lines.push('_None — every invariant was wire-observable this run._');
  } else {
    lines.push('| invariant | component | requirement (evidence) |');
    lines.push('|---|---|---|');
    for (const f of inconclusive) {
      lines.push(
        `| ${f.invariant_id} | ${COMPONENT_NUMBER[f.component_primary]}. ${COMPONENT_LABEL[f.component_primary]} | ${escapePipes(
          redact(f.evidence),
        )} |`,
      );
    }
  }
  lines.push('');

  // ---- Latency summary (A10 — captured per turn for improvement tracking) ----
  if (input.latencySummary && input.latencySummary.length > 0) {
    lines.push('## Latency summary (A10 — advisory)');
    lines.push('');
    lines.push(
      'Per-turn wall-clock from `_timings.turn.total_ms` (fallback: client elapsed). **Simple deterministic ' +
        'turns** (`llm_calls=0`) are the class tracked for latency improvement; budgets are advisory and never ' +
        'gate the exit code.',
    );
    lines.push('');
    lines.push('| step | role | total_ms | class | budget_ms | llm_calls | verdict |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const r of input.latencySummary) {
      const verdict = r.totalMs === undefined ? 'not observable' : r.overBudget ? 'OVER (advisory)' : 'within';
      lines.push(
        `| \`${r.step}\` | ${r.role} | ${r.totalMs ?? '—'} | ${r.cls} | ${r.budgetMs} | ${
          r.llmCalls ?? '—'
        } | ${verdict} |`,
      );
    }
    lines.push('');
  }

  // ---- assistant_text per step (redacted) ----
  const withText = input.captures.filter((c) => typeof c.assistant_text === 'string' && c.assistant_text.length > 0);
  if (withText.length > 0) {
    lines.push('## assistant_text per step (redacted)');
    lines.push('');
    for (const cap of withText) {
      lines.push(`### \`${cap.step}\``);
      lines.push('');
      lines.push('```');
      lines.push(redact(cap.assistant_text ?? ''));
      lines.push('```');
      if (cap.chips && cap.chips.length > 0) {
        lines.push('Chips:');
        for (const chip of cap.chips) {
          const action = chip.action_type ? ` action_type=\`${escapePipes(redact(chip.action_type))}\`` : '';
          lines.push(`- **${escapePipes(redact(chip.label))}** — "${escapePipes(redact(chip.message))}"${action}`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function writeGoldenReport(path: string, input: GoldenReportInput, redact: Redactor = identityRedact): void {
  writeFileSync(path, renderGoldenReport(input, redact), 'utf-8');
}
