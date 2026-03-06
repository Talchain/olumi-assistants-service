/**
 * Decision Review — Science Claims Injection
 *
 * Builds the <SCIENCE_CLAIMS> section from the loaded DSK bundle and injects it
 * into the decision review prompt between </INPUT_FIELDS> and <CONSTRUCTION_FLOW>.
 *
 * The v11 prompt uses section presence as the enablement signal: if <SCIENCE_CLAIMS>
 * is present, the LLM emits DSK fields. If absent, it doesn't.
 */

import { getAllByType } from '../../orchestrator/dsk-loader.js';
import { config } from '../../config/index.js';
import { log } from '../../utils/telemetry.js';
import type { DSKClaim, DSKProtocol } from '../../dsk/types.js';

// ============================================================================
// Types
// ============================================================================

export interface ScienceClaimsResult {
  /** Full <SCIENCE_CLAIMS>...</SCIENCE_CLAIMS> text for prompt injection */
  section: string;
  biasCount: number;
  techniqueCount: number;
}

// ============================================================================
// Builder
// ============================================================================

/**
 * Build the <SCIENCE_CLAIMS> section from the loaded DSK bundle.
 *
 * Returns null (with appropriate logging) when:
 * - DSK is disabled by config
 * - DSK bundle failed to load (empty claims list)
 */
export function buildScienceClaimsSection(): ScienceClaimsResult | null {
  if (!config.features.dskEnabled) {
    log.info({}, 'DSK disabled by config — science claims section omitted.');
    return null;
  }

  const claims = getAllByType('claim') as DSKClaim[];
  if (claims.length === 0) {
    log.warn(
      {},
      'DSK bundle load failed — science claims section omitted. Decision review will run without science grounding.',
    );
    return null;
  }

  // Split into bias claims (DSK-B-*) and technique claims (DSK-T-*)
  const biasClaims = claims
    .filter((c) => c.id.startsWith('DSK-B-'))
    .sort((a, b) => a.id.localeCompare(b.id));

  const techniqueClaims = claims
    .filter((c) => c.id.startsWith('DSK-T-'))
    .sort((a, b) => a.id.localeCompare(b.id));

  // Build protocol reverse-map: claim ID → protocol ID
  const protocols = getAllByType('protocol') as DSKProtocol[];
  const claimToProtocol = new Map<string, string>();
  for (const p of protocols) {
    if (p.linked_claim_id) {
      claimToProtocol.set(p.linked_claim_id, p.id);
    }
  }

  // Build section
  const lines: string[] = [];
  lines.push('<SCIENCE_CLAIMS>');
  lines.push('Ground bias_findings and decision_quality_prompts using these DSK claims. When referencing');
  lines.push('a claim, include its dsk_claim_id and copy evidence_strength exactly as listed below.');
  lines.push('');

  // Bias claims table
  lines.push('BIAS CLAIMS — use for bias_findings:');
  lines.push('| ID        | Strength | Title                                                          |');
  lines.push('|-----------|----------|----------------------------------------------------------------|');
  for (const c of biasClaims) {
    lines.push(`| ${c.id.padEnd(9)} | ${c.evidence_strength.padEnd(8)} | ${c.title.padEnd(62)} |`);
  }
  lines.push('');

  // Technique claims table
  lines.push('TECHNIQUE CLAIMS — use for decision_quality_prompts:');
  lines.push('| ID        | Strength | Title                                                          | Protocol  |');
  lines.push('|-----------|----------|----------------------------------------------------------------|-----------|');
  for (const c of techniqueClaims) {
    const protocolId = claimToProtocol.get(c.id) ?? '\u2014';
    lines.push(
      `| ${c.id.padEnd(9)} | ${c.evidence_strength.padEnd(8)} | ${c.title.padEnd(62)} | ${protocolId.padEnd(9)} |`,
    );
  }
  lines.push('');
  lines.push('Only reference IDs from the tables above. Any other ID will cause hard rejection.');
  lines.push('</SCIENCE_CLAIMS>');

  return {
    section: lines.join('\n'),
    biasCount: biasClaims.length,
    techniqueCount: techniqueClaims.length,
  };
}

// ============================================================================
// Injector
// ============================================================================

const INPUT_FIELDS_END = '</INPUT_FIELDS>';
const CONSTRUCTION_FLOW_START = '<CONSTRUCTION_FLOW>';

/**
 * Inject the <SCIENCE_CLAIMS> section into the decision review prompt.
 *
 * The section is placed between </INPUT_FIELDS> and <CONSTRUCTION_FLOW>.
 * Throws on missing markers or if the prompt already contains <SCIENCE_CLAIMS>
 * (double-injection guard).
 */
export function injectScienceClaimsSection(prompt: string, section: string): string {
  // Guard: double-injection
  if (prompt.includes('<SCIENCE_CLAIMS>')) {
    throw new Error(
      'Prompt already contains <SCIENCE_CLAIMS> — refusing to double-inject',
    );
  }

  const endIdx = prompt.indexOf(INPUT_FIELDS_END);
  if (endIdx === -1) {
    throw new Error(
      `Decision review prompt missing ${INPUT_FIELDS_END} marker — cannot inject <SCIENCE_CLAIMS>`,
    );
  }

  const flowIdx = prompt.indexOf(CONSTRUCTION_FLOW_START);
  if (flowIdx === -1) {
    throw new Error(
      `Decision review prompt missing ${CONSTRUCTION_FLOW_START} marker — cannot inject <SCIENCE_CLAIMS>`,
    );
  }

  if (endIdx >= flowIdx) {
    throw new Error(
      `${INPUT_FIELDS_END} appears after ${CONSTRUCTION_FLOW_START} — prompt structure invalid for <SCIENCE_CLAIMS> injection`,
    );
  }

  // Insert between the end of </INPUT_FIELDS> and the start of <CONSTRUCTION_FLOW>
  const insertionPoint = endIdx + INPUT_FIELDS_END.length;
  return (
    prompt.slice(0, insertionPoint) +
    '\n\n' +
    section +
    '\n\n' +
    prompt.slice(insertionPoint).replace(/^\s*\n/, '') // trim leading blank line to avoid triple-spacing
  );
}
