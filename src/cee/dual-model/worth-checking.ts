/**
 * "Worth checking" surfacing composer (quarantined scaffold — NOT wired into
 * any coaching/canvas surface; standing ruling: defer artifacts stay in
 * telemetry until the harness/coaching lane authorises surfacing,
 * dual-draft amendment #3. Wiring sketch: Docs/v6 handoff, commit 11).
 *
 * Deterministic, capped rendering of M2 defer artifacts as plain-language
 * pointers. HARD TEXT RULES:
 *   - no analysis claims: reuses the live G14 scanner (findAnalysisClaim) on
 *     every rendered line, PLUS stricter composer-local patterns (any
 *     digit-%, probabilit*, analy[sz]ed, recommend*, optimal, best option) —
 *     this is user-visible coaching text and must not imply evaluation even
 *     where G14 would allow it;
 *   - no internal-leak tokens: a LOCAL copy of the chip-egress token list
 *     (src/cee must not import src/orchestrator-v5 — layering rule; a
 *     test-scope parity check keeps the copy exactly equal to
 *     chip-safety.ts's CHIP_EGRESS_FORBIDDEN_TOKENS);
 *   - never claims a deferred option was analysed/compared/evaluated — the
 *     added_option template says exactly the opposite;
 *   - FAIL CLOSED: one violating line nulls the WHOLE section (a hostile
 *     batch forfeits the surface; suppression is cheap, leakage is not).
 */
import { findAnalysisClaim } from '../dual-draft/guards.js';
import { extractDeferredOptionLabel } from './option-enrichment/synthesise-option-candidate.js';
import { M2_ARTIFACT_TYPES, type M2ArtifactType } from './artifacts/types.js';

export const WORTH_CHECKING_MAX_ITEMS = 3;
export const WORTH_CHECKING_LINE_MAX_CHARS = 240;
const MAX_ITEMS_CLAMP = 8; // never more than a full turn's artifact cap

/**
 * Composer-local strictness beyond G14 — evaluation/steering language is
 * banned outright in this surface.
 */
export const WORTH_CHECKING_FORBIDDEN_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly re: RegExp;
}> = [
  { label: 'percentage', re: /\d\s*%/ },
  { label: 'probability_language', re: /\bprobabilit/i },
  { label: 'analysed_language', re: /\banaly[sz]ed\b/i },
  { label: 'recommendation_language', re: /\brecommend/i },
  { label: 'optimality_language', re: /\boptimal\b/i },
  { label: 'best_option_language', re: /\bbest option\b/i },
];

/**
 * LOCAL copy of orchestrator-v5/compose/chip-safety.ts
 * CHIP_EGRESS_FORBIDDEN_TOKENS (layering rule forbids the src import).
 * worth-checking.test.ts asserts exact equality so the copy cannot drift.
 */
export const WORTH_CHECKING_LEAK_TOKENS: readonly string[] = [
  'apply_proposed_change',
  'pending_actions',
  'proposal_ref',
  'chip_metadata',
  'graph_hash',
  'add_constraint',
  'set_factor_value',
  'adjust_edge_strength',
  'run_analysis',
  'what_would_flip',
  'explain_from_structure',
  'explain_results',
  'explain_result',
  'compare_options',
  'edit_graph_add_risk',
  'zod',
  'structural_validation_failed',
  'entity_kind_mismatch',
  'precondition_unmet',
  'invalid_type',
  '{"',
  'prop_',
  'chip_',
];

export interface WorthCheckingArtifactInput {
  /** DeferArtifact.type or M2ArtifactRecord.proposal_type. */
  readonly type: string;
  /** DeferArtifact.question or M2ArtifactRecord.question. */
  readonly question: string;
}

export interface WorthCheckingItem {
  readonly kind: M2ArtifactType;
  readonly text: string;
}

export interface WorthCheckingSection {
  readonly heading: 'Worth checking';
  readonly items: readonly WorthCheckingItem[];
  /** Inputs that did not render: unknown type, empty, over-length, duplicate, over-cap. */
  readonly omitted_count: number;
}

export interface ComposeWorthCheckingOptions {
  readonly maxItems?: number;
}

const RENDER_PRIORITY: Readonly<Record<M2ArtifactType, number>> = {
  clarification_proposal: 0,
  added_evidence_gap: 1,
  uncertainty_flag: 2,
  added_option: 3,
};

function renderLine(kind: M2ArtifactType, question: string): string {
  switch (kind) {
    case 'added_evidence_gap':
      return `Worth checking: ${question}`;
    case 'uncertainty_flag':
      return `Flagged as uncertain: ${question}`;
    case 'clarification_proposal':
      return `A question that could sharpen this: ${question}`;
    case 'added_option': {
      const label = extractDeferredOptionLabel(question);
      return `An option was suggested but not evaluated: "${label}"`;
    }
  }
}

function isUnsafeLine(line: string): boolean {
  if (findAnalysisClaim(line) !== null) return true;
  for (const { re } of WORTH_CHECKING_FORBIDDEN_PATTERNS) {
    if (re.test(line)) return true;
  }
  const haystack = line.toLowerCase();
  for (const token of WORTH_CHECKING_LEAK_TOKENS) {
    if (haystack.includes(token.toLowerCase())) return true;
  }
  return false;
}

/**
 * Deterministic, fail-closed composition. Returns null when nothing safe
 * survives — and when ANY candidate line violates the text rules (whole-
 * section suppression). Never throws.
 */
export function composeWorthChecking(
  artifacts: readonly WorthCheckingArtifactInput[],
  opts?: ComposeWorthCheckingOptions,
): WorthCheckingSection | null {
  const maxItems = Math.min(
    MAX_ITEMS_CLAMP,
    Math.max(1, opts?.maxItems ?? WORTH_CHECKING_MAX_ITEMS),
  );

  let omitted = 0;
  const candidates: Array<{ kind: M2ArtifactType; question: string; input_order: number }> = [];
  artifacts.forEach((artifact, input_order) => {
    const kind = (M2_ARTIFACT_TYPES as readonly string[]).includes(artifact.type)
      ? (artifact.type as M2ArtifactType)
      : null;
    const question = artifact.question.trim();
    if (kind === null || question.length === 0) {
      omitted++;
      return;
    }
    candidates.push({ kind, question, input_order });
  });

  // Stable priority order: class first, original order within class.
  candidates.sort(
    (a, b) => RENDER_PRIORITY[a.kind] - RENDER_PRIORITY[b.kind] || a.input_order - b.input_order,
  );

  const seen = new Set<string>();
  const rendered: WorthCheckingItem[] = [];
  for (const candidate of candidates) {
    const text = renderLine(candidate.kind, candidate.question);
    if (isUnsafeLine(text)) return null; // fail closed: one violation forfeits the section
    if (text.length > WORTH_CHECKING_LINE_MAX_CHARS) {
      omitted++;
      continue;
    }
    const dedupeKey = text.toLowerCase();
    if (seen.has(dedupeKey)) {
      omitted++;
      continue;
    }
    seen.add(dedupeKey);
    rendered.push({ kind: candidate.kind, text });
  }

  if (rendered.length === 0) return null;

  const items = rendered.slice(0, maxItems);
  omitted += rendered.length - items.length;

  return { heading: 'Worth checking', items, omitted_count: omitted };
}
