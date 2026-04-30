/**
 * Output safety — neutral utility for entity-ID leak sanitisation.
 *
 * Single source of truth for the per-string scrubber `sanitiseUserFacingText`,
 * the slug-shape confirmation gate, and the prefix → generic-fallback mapping.
 * Originally lived in `src/orchestrator-v5/compose/output-safety.ts`; extracted
 * here so V4 (`src/orchestrator/tools/edit-graph.ts`), the unified pipeline
 * (`src/cee/unified-pipeline/stages/package.ts`), and V5 modules can all import
 * without creating a V4→V5 dependency edge. The V5 file retains the V5-specific
 * envelope walker `sanitiseOlumiResponseForEgress` and re-exports the moved
 * symbols for backward compatibility.
 *
 * Two layers of egress protection use this scrubber:
 *   - Layer 1 (handler-local, e.g. edit-graph.ts): scrubs LLM/PLoT-generated
 *     strings before they enter `assistantText`. Logs the raw ID for triage.
 *   - Layer 2 (V5 envelope walker): scrubs the assembled OlumiResponse before
 *     egress. Logs ONLY the prefix type, never the raw ID.
 *
 * Design notes:
 *   - The exported `ENTITY_ID_LEAK_RE` regex (in entity-id-pattern.ts) is the
 *     single source of truth. We never mutate it; instead we build a per-call
 *     global matcher via `new RegExp(ENTITY_ID_LEAK_RE.source, 'gi')`. Mutating
 *     the source regex would corrupt the 7 `.test()` callsites in patch-summary.ts.
 *   - The base regex over-matches English compounds (`factor_analysis`,
 *     `option_value`, etc.). `isLikelyEntityId` adds a tiered confirmation
 *     gate so legitimate prose is left alone.
 *
 * Heuristic for distinguishing real IDs from English compounds:
 *   - Short prefixes (`fac`, `opt`): no English collisions in these prefixes.
 *     Any `fac_<anything>` / `opt_<anything>` is treated as a confirmed
 *     internal ID even with a single-token suffix.
 *   - Risky short prefixes (`out`, `risk`, `con`, `goal`, `dec`): English
 *     collisions exist (`out_of_scope`, `risk_adjusted`, etc.). Apply the
 *     slug-shape gate.
 *   - Full-word prefixes (`factor`, `option`, `decision`, `outcome`,
 *     `constraint`): English compounds are common (`factor_analysis`,
 *     `option_value`). Apply the slug-shape gate.
 */

import type { GraphV3T } from '../types.js';
import { ENTITY_ID_LEAK_RE, resolveLabel } from './entity-id-pattern.js';

// ----------------------------------------------------------------------------
// Prefix → generic fallback mapping
// ----------------------------------------------------------------------------

const PREFIX_GENERIC: Readonly<Record<string, string>> = {
  fac: 'the relevant factor',
  factor: 'the relevant factor',
  opt: 'the relevant option',
  option: 'the relevant option',
  goal: 'the relevant goal',
  dec: 'the relevant decision',
  decision: 'the relevant decision',
  out: 'the relevant outcome',
  outcome: 'the relevant outcome',
  risk: 'the relevant risk',
  con: 'the relevant constraint',
  constraint: 'the relevant constraint',
};

// Prefix-extraction regex. The prefix list MUST stay in lockstep with the
// non-capturing group in `ENTITY_ID_LEAK_RE` (in entity-id-pattern.ts). If
// you add a prefix to one, add it to the other and update `PREFIX_GENERIC`
// + the heuristic comment block above.
const PREFIX_SPLIT_RE = /^(fac|opt|goal|dec|out|risk|con|factor|option|decision|outcome|constraint)[_:-](.+)$/i;

function splitMatch(match: string): { prefix: string; suffix: string } | null {
  const m = match.match(PREFIX_SPLIT_RE);
  if (!m) return null;
  return { prefix: m[1]!.toLowerCase(), suffix: m[2]! };
}

/**
 * Map an entity-ID-shaped string to its prefix-aware generic fallback,
 * e.g. `'opt_hire_local'` → `'the relevant option'`. Used by the V5
 * label resolver (`src/orchestrator-v5/compose/resolve-label.ts`) when
 * graph + analysis_ready + enrichment lookups all miss.
 *
 * Returns `'the relevant node'` for any input that doesn't split on a
 * known prefix — defensive default that never returns the raw ID.
 */
export function genericFallbackForId(id: string): string {
  const split = splitMatch(id);
  if (split === null) return 'the relevant node';
  return PREFIX_GENERIC[split.prefix] ?? 'the relevant node';
}

/**
 * Prefixes with NO English-word collisions in normal prose. Any
 * `<prefix>_<anything>` for one of these is treated as an internal ID even
 * when the suffix is a single token, so a leaked `fac_churn` or `opt_x` is
 * caught at the central egress backstop even when label resolution is
 * unavailable (e.g. graph=null).
 *
 * Conservatively scoped to `fac` and `opt` only. Other short prefixes have
 * documented English collisions:
 *   - `goal`: `goal_setting`, `goal_alignment` (brief-mandated false positives)
 *   - `dec`: `decision_making`, `decision_support` (brief-mandated)
 *   - `out`: `out_of_scope` (brief-mandated)
 *   - `risk`: `risk_adjusted` (brief-mandated)
 *   - `con`: `constraint_based`, `con_text`
 * Those keep the slug-shape gate. Their internal IDs (`goal_revenue`,
 * `dec_q3`, `risk_5`, etc.) still get caught via:
 *   - label resolution (when graph is in scope), OR
 *   - digit detection (numeric IDs), OR
 *   - multi-segment slug (≥4-char first suffix segment).
 */
const UNAMBIGUOUS_SHORT_PREFIXES: ReadonlySet<string> = new Set([
  'fac',
  'opt',
]);

/**
 * Confirmation gate: filter out English-compound false positives.
 *
 * Real entity IDs in this codebase are slug-shaped — semantic words separated
 * by `_`, e.g. `fac_delivery_cost` (suffix first segment "delivery", 8
 * chars), `factor_team_morale` (first segment "team", 4 chars), or contain
 * digits like `option_42`.
 *
 * English compounds that the broad regex catches share a common shape: they
 * are either single-segment after the prefix (`factor_analysis`,
 * `option_value`) or multi-segment with a SHORT function-word first segment
 * (`out_of_scope` → "of"; `risk_to_revenue` → "to"). Real ID slugs do not
 * use 2-or-3-character connector words as their first segment.
 *
 * Rule (in order):
 *   1. If `resolveLabel(graph, match)` returns a label → confirmed ID.
 *   2. If the match contains a digit anywhere → confirmed ID.
 *   3. If the prefix is in `UNAMBIGUOUS_SHORT_PREFIXES` (`fac`, `opt`) →
 *      confirmed ID. Other short prefixes (`goal`, `dec`, `out`, `risk`,
 *      `con`) DO have English collisions (`goal_setting`, `risk_adjusted`,
 *      `out_of_scope`, etc.) and continue to the slug-shape gate.
 *   4. Else, if the suffix is single-segment (no `_`/`:`/`-` separator) →
 *      English compound, leave alone (`factor_analysis`, `risk_adjusted`).
 *   5. Else (multi-segment), require the first segment to be ≥ 4 chars.
 *      Short first segments are English connector words (`out_of_scope`).
 */
function isLikelyEntityId(
  match: string,
  graph: GraphV3T | null,
  split: { prefix: string; suffix: string },
): boolean {
  if (resolveLabel(graph, match)) return true;
  if (/\d/.test(match)) return true;
  if (UNAMBIGUOUS_SHORT_PREFIXES.has(split.prefix)) return true;
  // Find the first suffix segment using any of the slug separators.
  const firstSeg = split.suffix.split(/[_:-]/, 1)[0] ?? '';
  if (firstSeg === split.suffix) {
    // Single-segment suffix → English compound (e.g. `factor_analysis`).
    return false;
  }
  return firstSeg.length >= 4;
}

// ----------------------------------------------------------------------------
// String-level scrub
// ----------------------------------------------------------------------------

export interface SanitiseMatch {
  readonly prefix: string;
  readonly resolved: 'label' | 'generic';
}

export interface SanitiseResult {
  readonly text: string;
  readonly matches: ReadonlyArray<SanitiseMatch>;
}

/**
 * Scrub a single user-facing string for entity-ID leaks.
 *
 * Returns the (possibly unchanged) text plus structured match metadata for
 * caller-side telemetry. Empty/whitespace-only inputs are a no-op fast path.
 */
export function sanitiseUserFacingText(text: string, graph: GraphV3T | null): SanitiseResult {
  if (!text || !text.trim()) return { text, matches: [] };

  // Per-call global matcher — never mutate the imported regex.
  const matcher = new RegExp(ENTITY_ID_LEAK_RE.source, 'gi');
  const matches: SanitiseMatch[] = [];
  let changed = false;

  const replaced = text.replace(matcher, (match) => {
    const split = splitMatch(match);
    if (!split) return match;
    if (!isLikelyEntityId(match, graph, split)) return match;
    const label = resolveLabel(graph, match);
    if (label) {
      matches.push({ prefix: split.prefix, resolved: 'label' });
      changed = true;
      return label;
    }
    const generic = PREFIX_GENERIC[split.prefix] ?? 'the relevant element';
    matches.push({ prefix: split.prefix, resolved: 'generic' });
    changed = true;
    return generic;
  });

  return { text: changed ? replaced : text, matches };
}
