/**
 * BIL formatting — XML context blocks for LLM prompt injection.
 *
 * Two formats:
 * - Coaching: full <BRIEF_ANALYSIS> for orchestrator coaching prompt
 * - Draft graph: lighter <BRIEF_CONTEXT> for draft_graph pipeline
 */

import type { BriefIntelligence } from "../../schemas/brief-intelligence.js";

/**
 * Format BIL for orchestrator coaching prompt.
 * Appended to user message after the brief text.
 */
export function formatBilForCoaching(bil: BriefIntelligence): string {
  const lines: string[] = [
    '<BRIEF_ANALYSIS>',
    'Preliminary observations from deterministic brief analysis.',
    'The model may identify additional elements beyond these findings.',
    '',
  ];

  lines.push(`Completeness: ${bil.completeness_band}`);

  if (bil.goal) {
    lines.push(`Goal: ${bil.goal.label} (measurable: ${bil.goal.measurable})`);
  } else {
    lines.push('Goal: Not detected');
  }

  if (bil.options.length > 0) {
    const labels = bil.options.map((o) => o.label).join(', ');
    lines.push(`Options detected: ${bil.options.length} — ${labels}`);
  } else {
    lines.push('Options detected: 0');
  }

  if (bil.constraints.length > 0) {
    const labels = bil.constraints.map((c) => `${c.label} [${c.type}]`).join(', ');
    lines.push(`Constraints: ${bil.constraints.length} — ${labels}`);
  } else {
    lines.push('Constraints: 0');
  }

  if (bil.factors.length > 0) {
    const labels = bil.factors.map((f) => f.label).join(', ');
    lines.push(`Factors mentioned: ${bil.factors.length} — ${labels}`);
  } else {
    lines.push('Factors mentioned: 0');
  }

  if (bil.missing_elements.length > 0) {
    lines.push(`Missing: ${bil.missing_elements.join(', ')}`);
  }

  if (bil.dsk_cues.length > 0) {
    const cueDescs = bil.dsk_cues.map((c) => `${c.bias_type}: ${c.signal}`).join('; ');
    lines.push(`Potential cognitive patterns: ${cueDescs}`);
  }

  lines.push('</BRIEF_ANALYSIS>');
  return lines.join('\n');
}

/**
 * Format BIL for draft_graph pipeline context.
 * Lighter than coaching — only constraints and missing elements.
 */
export function formatBilForDraftGraph(bil: BriefIntelligence): string {
  const lines: string[] = ['<BRIEF_CONTEXT>'];

  if (bil.constraints.length > 0) {
    const labels = bil.constraints.map((c) => `${c.label} [${c.type}]`).join(', ');
    lines.push(`Pre-extracted constraints: ${labels}`);
  } else {
    lines.push('Pre-extracted constraints: none');
  }

  if (bil.missing_elements.length > 0) {
    lines.push(`Missing from brief: ${bil.missing_elements.join(', ')}`);
  }

  lines.push('</BRIEF_CONTEXT>');
  return lines.join('\n');
}
