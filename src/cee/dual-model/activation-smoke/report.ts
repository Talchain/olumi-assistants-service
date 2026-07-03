/**
 * Evidence-packet rendering + exit-code mapping (quarantined scaffold).
 * Markdown shape follows the assurance-CLI convention: verdict table,
 * per-check evidence, remediation for non-green. Secret VALUES never enter
 * CheckResult.evidence by construction (env checks are name-presence only).
 */
import type { CheckResult } from './types.js';

export interface EvidencePacketMeta {
  readonly generatedForMode: 'plan' | 'fixtures' | 'live';
  readonly servingSha?: string;
  /** Caller-supplied timestamp string (the library never reads the clock). */
  readonly generatedAt?: string;
}

const STATUS_BADGE: Readonly<Record<CheckResult['status'], string>> = {
  green: '🟢 green',
  amber: '🟠 amber',
  red: '🔴 red',
  skipped: '⚪ skipped',
};

export function renderEvidencePacket(
  results: readonly CheckResult[],
  meta: EvidencePacketMeta,
): string {
  const lines: string[] = [
    '# v6 dual-draft activation smoke — evidence packet',
    '',
    `- mode: ${meta.generatedForMode}`,
    ...(meta.generatedAt ? [`- generated at: ${meta.generatedAt}`] : []),
    ...(meta.servingSha ? [`- serving build SHA: ${meta.servingSha}`] : []),
    '',
    '| check | verdict |',
    '|---|---|',
    ...results.map((r) => `| ${r.id} | ${STATUS_BADGE[r.status]} |`),
    '',
  ];
  for (const r of results) {
    lines.push(`## ${r.id} — ${STATUS_BADGE[r.status]}`);
    for (const e of r.evidence) lines.push(`- ${e}`);
    if (r.status !== 'green') lines.push(`- **remediation:** ${r.remediation}`);
    lines.push('');
  }
  lines.push(
    '> Standing ruling: structural green here is necessary but NOT sufficient — production activation additionally requires a real merged-graph run_analysis SUCCESS and the 6 ordered activation gates, each with its own approval.',
  );
  return lines.join('\n');
}

/**
 * Exit codes follow the assurance-CLI convention:
 *   0 = green/amber/skipped only; 1 = at least one red.
 * (2 = fatal harness error and 3 = blocked-before-running are CLI-level.)
 */
export function computeExitCode(results: readonly CheckResult[]): 0 | 1 {
  return results.some((r) => r.status === 'red') ? 1 : 0;
}
