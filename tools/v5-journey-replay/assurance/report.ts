/**
 * V5 staging assurance — red/amber/green report.
 *
 *   green = the contract held;
 *   amber = the step ran but the signal was soft / non-blocking (e.g. the
 *           stale prompt didn't elicit confident advice so no post-check
 *           fired, but the answer was safe; or out-of-band telemetry was
 *           unavailable while the wire behaviour was correct);
 *   red   = a hard contract failure or an unsafe state (exit non-zero).
 *
 * Default output is a gitignored scratch path (test-diagnostics/), never a
 * committed Docs/v5 evidence file.
 */

export type RagStatus = 'green' | 'amber' | 'red';

export interface CheckResult {
  readonly id: string;
  readonly title: string;
  readonly status: RagStatus;
  readonly detail: string;
  /** Optional supporting lines (DB counts, hashes, request ids). */
  readonly evidence?: readonly string[];
  readonly scenario_id?: string;
  readonly request_id?: string;
}

export interface FlagCapture {
  readonly name: string;
  readonly value: string;
  /** Where the value came from: 'wire' (/healthz or /diagnostics) or 'deploy-config' (not wire-exposed). */
  readonly source: 'wire' | 'deploy-config' | 'unavailable';
}

export interface ReportHeader {
  readonly command: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly baseUrl: string;
  readonly environment: string;
  readonly servingSha: string;
  readonly healthzOk: boolean | undefined;
  readonly degraded: boolean | undefined;
  readonly version: string | undefined;
  readonly expectedBuild?: string;
  readonly flags: readonly FlagCapture[];
  readonly scenarioIds: readonly string[];
}

export interface RagCounts {
  readonly green: number;
  readonly amber: number;
  readonly red: number;
}

export function countRag(checks: readonly CheckResult[]): RagCounts {
  let green = 0;
  let amber = 0;
  let red = 0;
  for (const c of checks) {
    if (c.status === 'green') green += 1;
    else if (c.status === 'amber') amber += 1;
    else red += 1;
  }
  return { green, amber, red };
}

const ICON: Record<RagStatus, string> = {
  green: '🟢',
  amber: '🟡',
  red: '🔴',
};

function fmtBool(v: boolean | undefined): string {
  if (v === undefined) return 'unknown';
  return v ? 'true' : 'false';
}

/**
 * Render the full markdown report. `cleanupLines` / `residualLines` are
 * pre-formatted by the orchestrator (the report module does not depend on
 * the cleanup module's types, keeping it decoupled and easy to test).
 */
export function renderReport(
  header: ReportHeader,
  checks: readonly CheckResult[],
  cleanupLines: readonly string[],
  residualLines: readonly string[],
): string {
  const counts = countRag(checks);
  const overall: RagStatus =
    counts.red > 0 ? 'red' : counts.amber > 0 ? 'amber' : 'green';

  const lines: string[] = [];
  lines.push(`# V5 staging assurance — ${ICON[overall]} ${overall.toUpperCase()}`);
  lines.push('');
  lines.push(
    `**${counts.green} green · ${counts.amber} amber · ${counts.red} red** — ` +
      `exit ${counts.red > 0 ? 'non-zero (red present)' : '0'}.`,
  );
  lines.push('');

  // ── Header ──
  lines.push('## Run');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Command | \`${header.command}\` |`);
  lines.push(`| Run id / scenario prefix | \`${header.runId}\` |`);
  lines.push(`| Environment | ${header.environment} |`);
  lines.push(`| Base URL | ${header.baseUrl} |`);
  lines.push(`| Started | ${header.startedAt} |`);
  lines.push(`| Finished | ${header.finishedAt} |`);
  lines.push(`| Serving SHA (/healthz build) | \`${header.servingSha}\` |`);
  if (header.expectedBuild) {
    lines.push(`| Expected build (strict) | \`${header.expectedBuild}\` |`);
  }
  lines.push(`| healthz ok | ${fmtBool(header.healthzOk)} |`);
  lines.push(`| degraded | ${fmtBool(header.degraded)} |`);
  lines.push(`| version | ${header.version ?? 'unknown'} |`);
  lines.push(`| Scenario IDs | ${header.scenarioIds.map((s) => `\`${s}\``).join(', ') || '(none)'} |`);
  lines.push('');

  // ── Flag state (captured, never set) ──
  lines.push('## Flag state (captured, never set)');
  lines.push('');
  lines.push('| Flag | Value | Source |');
  lines.push('|---|---|---|');
  for (const f of header.flags) {
    lines.push(`| \`${f.name}\` | ${f.value} | ${f.source} |`);
  }
  lines.push('');

  // ── Checks ──
  lines.push('## Checks');
  lines.push('');
  lines.push('| | Check | Detail |');
  lines.push('|---|---|---|');
  for (const c of checks) {
    const detail = c.detail.replace(/\|/g, '\\|');
    lines.push(`| ${ICON[c.status]} | ${c.title} | ${detail} |`);
  }
  lines.push('');

  // Evidence / attribution per check (only where present).
  const withEvidence = checks.filter(
    (c) => (c.evidence && c.evidence.length) || c.request_id || c.scenario_id,
  );
  if (withEvidence.length > 0) {
    lines.push('### Evidence & attribution');
    lines.push('');
    for (const c of withEvidence) {
      lines.push(`- **${c.title}** ${ICON[c.status]}`);
      if (c.scenario_id) lines.push(`  - scenario_id: \`${c.scenario_id}\``);
      if (c.request_id) lines.push(`  - request_id: \`${c.request_id}\``);
      for (const e of c.evidence ?? []) lines.push(`  - ${e.replace(/\|/g, '\\|')}`);
    }
    lines.push('');
  }

  // ── Cleanup ──
  lines.push('## Cleanup (exact-ID, child-first)');
  lines.push('');
  for (const l of cleanupLines) lines.push(`- ${l}`);
  lines.push('');
  lines.push('### Residual after cleanup');
  lines.push('');
  for (const l of residualLines) lines.push(`- ${l}`);
  lines.push('');

  return lines.join('\n');
}

/** Compact one-line console summary (also redaction-safe — no secrets). */
export function consoleSummary(checks: readonly CheckResult[]): string {
  const c = countRag(checks);
  const overall = c.red > 0 ? 'RED' : c.amber > 0 ? 'AMBER' : 'GREEN';
  return `${overall} — ${c.green} green / ${c.amber} amber / ${c.red} red`;
}
