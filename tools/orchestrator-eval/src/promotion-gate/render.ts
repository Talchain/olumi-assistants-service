/**
 * PROMOTION GATE — human-readable rendering of a final result.
 */

import type { FinalResult, FinalRow } from './types.js';

function statusIcon(row: FinalRow): string {
  if (row.decision === 'GATED_PASS') return '✅ GATED-PASS';
  if (row.decision === 'UNGATED') return '◻️  UNGATED';
  return row.grandfathered ? '🔒 GRANDFATHERED' : '❌ BLOCK';
}

export function renderGateResult(result: FinalResult): string {
  const lines: string[] = [];
  lines.push('# Eval-pass promotion gate');
  lines.push('');
  lines.push(result.ok ? '**PASS** — no un-grandfathered block, no baseline drift.' : '**FAIL** — a promotion is blocked (see below).');
  lines.push('');
  lines.push('| task | v | promoted hash | decision | why |');
  lines.push('|---|---|---|---|---|');
  for (const r of result.rows) {
    lines.push(`| ${r.task} | ${r.servedVersion} | \`${r.promotedHash}\` | ${statusIcon(r)}${r.blockKind ? ` (${r.blockKind})` : ''} | ${r.reason} |`);
  }
  lines.push('');
  const gated = result.rows.filter((r) => r.decision === 'GATED_PASS').length;
  const gf = result.rows.filter((r) => r.grandfathered).length;
  const ungated = result.rows.filter((r) => r.decision === 'UNGATED').length;
  const blocked = result.rows.filter((r) => r.decision === 'BLOCK' && !r.grandfathered).length;
  lines.push(`_${gated} gated-pass · ${gf} grandfathered (pre-gate, locked to hash) · ${ungated} ungated (no pack, visible) · ${blocked} BLOCKED._`);
  if (result.baselineErrors.length > 0) {
    lines.push('');
    lines.push('## Baseline drift (fatal)');
    for (const e of result.baselineErrors) lines.push(`- ${e}`);
  }
  lines.push('');
  lines.push('_Grandfathered rows are pre-gate promotions with no passing eval, tolerated ONLY at the exact hash shown; any bump requires a passing eval. Ungated rows have no pack yet — they fall under the gate automatically when a pack marker lands. This gate reads the GIT source-of-truth; a live-only admin promotion that never updates the committed manifest is not visible here (runtime seam, sequenced separately)._');
  return lines.join('\n') + '\n';
}
