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
  // `node_` is a scanner-only prefix (see `coaching-safety-scanner.ts`) — used
  // by `sanitiseCoachingProse` when the LLM emits a generic `node_<x>` token
  // that does not carry kind information. The general-purpose entity-ID regex
  // (`ENTITY_ID_LEAK_RE`) does NOT include `node_`, so the only caller of this
  // entry is the coaching-context scrubber.
  node: 'the relevant element',
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

/**
 * Public, graph-free slug-shape gate. Returns true when `text` looks
 * like a real internal entity ID (`fac_delivery_cost`, `opt_42`,
 * `goal_revenue_growth`); false for English compounds the broad regex
 * over-matches (`risk-adjusted`, `out-of-scope`, `goal-setting`,
 * `factor_analysis`, `option_value`, `constraint-based`).
 *
 * Used by callers that need the slug-shape rule WITHOUT graph access —
 * e.g. the V5 multi-source resolver's unsafe-label check
 * (`compose/resolve-label.ts:isUnsafeLabel`), where the question is
 * "could this label be a confirmed leak?" rather than "does this graph
 * carry a node by this id?".
 *
 * Rule (no graph; mirrors `isLikelyEntityId` rules 2-5):
 *   1. Contains a digit anywhere → confirmed ID.
 *   2. Prefix is `fac` or `opt` (no English collisions) → confirmed ID.
 *   3. Single-segment suffix → English compound, NOT an ID.
 *   4. Multi-segment, first suffix segment < 4 chars → English connector
 *      word ("of", "to") → NOT an ID.
 *   5. Multi-segment, first suffix segment ≥ 4 chars → confirmed ID.
 *
 * Inputs that do NOT match the broad `ENTITY_ID_LEAK_RE` shape (no
 * `prefix[_:-]suffix` split) return false. Callers should pre-filter
 * with `ENTITY_ID_LEAK_RE` if they want to walk a string for confirmed
 * matches.
 */
export function isSlugShapedEntityId(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  const split = splitMatch(text);
  if (split === null) return false;
  if (/\d/.test(text)) return true;
  if (UNAMBIGUOUS_SHORT_PREFIXES.has(split.prefix)) return true;
  const firstSeg = split.suffix.split(/[_:-]/, 1)[0] ?? '';
  if (firstSeg === split.suffix) return false;
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

// ----------------------------------------------------------------------------
// Coaching-context scrub — narrow-guard variant for draft_graph coaching
// prose where the LLM prompt forbids ID emission entirely. Uses the same
// prefix taxonomy as `scanCoachingForIdLeakage`
// (`src/cee/validation/coaching-safety-scanner.ts`) so detection scanner
// and rewriter share a single set and findings are coherent.
// ----------------------------------------------------------------------------

/**
 * Tracked prefixes for coaching-context ID detection. Seven short prefixes,
 * mirroring `NODE_ID_PREFIXES` in `coaching-safety-scanner.ts`. `con_`
 * (constraint) is intentionally absent here even though it is present in
 * the broader `ENTITY_ID_LEAK_RE` / `PREFIX_GENERIC` — the scanner does
 * not track it, so neither does this rewriter; alignment keeps scanner
 * findings and rewriter capabilities matched.
 *
 * Full-word forms (`factor_`, `option_`, …) are NOT tracked here. The
 * draft_graph adapter emits short prefixes; full-word forms come from
 * deterministic V4 handlers whose strings flow through
 * `sanitiseUserFacingText`, not through this function.
 */
const COACHING_ID_RE = /\b(?:fac|opt|out|risk|goal|dec|node)_[a-z0-9_]+\b/i;

const COACHING_SPLIT_RE = /^(fac|opt|out|risk|goal|dec|node)_(.+)$/i;

function splitCoachingMatch(match: string): { prefix: string; suffix: string } | null {
  const m = match.match(COACHING_SPLIT_RE);
  if (!m) return null;
  return { prefix: m[1]!.toLowerCase(), suffix: m[2]! };
}

/**
 * Rule 2 — orphan high-confidence gate. An orphan (token NOT present in
 * `graph.nodes[].id`) is replaced only when its shape unambiguously
 * identifies it as an internal ID rather than an English compound:
 *
 *   - Suffix contains a digit (`fac_42`, `risk_5`).
 *   - Prefix is `fac` or `opt` (no English collisions exist for these;
 *     same rule as the codebase-wide `UNAMBIGUOUS_SHORT_PREFIXES`).
 *   - Suffix is multi-segment AND the first segment is ≥4 chars
 *     (`risk_churn_rate`, `goal_revenue_growth`). Short first segments
 *     like `of`/`to` indicate English connectors (`out_of_scope`).
 *
 * Anything else — single-segment risky-prefix orphan with no digit
 * (e.g. `risk_adjusted`, `goal_setting`, `risk_phantom`) — is
 * preserved by the caller (rule 3 in `sanitiseCoachingProse`). The
 * trade-off is intentional: producing `the relevant risk` in place of
 * `risk_adjusted` would mangle legitimate English compounds, and broken
 * user-facing copy is worse than a residual leak on a genuinely
 * ambiguous hallucinated single-segment token.
 */
function isHighConfidenceCoachingOrphan(split: { prefix: string; suffix: string }): boolean {
  if (/\d/.test(split.suffix)) return true;
  if (split.prefix === 'fac' || split.prefix === 'opt') return true;
  const firstSeg = split.suffix.split('_', 1)[0] ?? '';
  if (firstSeg === split.suffix) return false;
  return firstSeg.length >= 4;
}

/**
 * Scrub a single coaching-context string for entity-ID leaks using a
 * narrow guard. Compared to `sanitiseUserFacingText`:
 *
 *   - Uses the seven scanner-taxonomy short prefixes only
 *     (`fac/opt/out/risk/goal/dec/node`); the broader
 *     `ENTITY_ID_LEAK_RE` (with `con` and full-word forms) is NOT used.
 *   - Rule 1 (graph hit): looks the token up in `graph.nodes[].id`
 *     directly. When the node exists with a usable label
 *     (non-empty AND `label !== id`) the label is substituted; when the
 *     node exists but the label is missing or equals the id, falls back
 *     to the prefix-aware `PREFIX_GENERIC` neutral phrase. This closes
 *     the leak path where the existing label-resolution gate misses
 *     real graph nodes with `label === id`.
 *   - Rule 2 (orphan): only high-confidence orphans
 *     (`isHighConfidenceCoachingOrphan` above) are replaced; ambiguous
 *     single-segment risky-prefix orphans are preserved.
 *
 * Caller (`sanitiseCoachingForDisplay` in
 * `src/cee/unified-pipeline/stages/package.ts`) must pass a graph
 * projection that retains nodes where `label === id` so rule 1 can
 * detect them; otherwise they fall through to rule 2 and leak.
 *
 * Returns `SanitiseResult` matching `sanitiseUserFacingText` for
 * telemetry parity. Empty/whitespace-only inputs are a no-op fast path.
 * `matches[]` is only populated for actual replacements; preserved
 * tokens (rule 3) do not generate entries.
 */
export function sanitiseCoachingProse(text: string, graph: GraphV3T | null): SanitiseResult {
  if (!text || !text.trim()) return { text, matches: [] };

  // Build the lookup once per call. `idSet` answers "is this token a real
  // node ID?" (rule 1 gate). `idToLabel` answers "if it is, what label do
  // we substitute?" — populated only when the node carries a usable label
  // (non-empty AND distinct from the id). When a node is in `idSet` but
  // absent from `idToLabel`, rule 1 falls back to `PREFIX_GENERIC`.
  const idSet = new Set<string>();
  const idToLabel = new Map<string, string>();
  if (graph !== null) {
    for (const node of graph.nodes) {
      const id = (node as { id?: string }).id;
      if (typeof id !== 'string' || id.length === 0) continue;
      idSet.add(id);
      const label = (node as { label?: string }).label;
      if (typeof label === 'string' && label.length > 0 && label !== id) {
        idToLabel.set(id, label);
      }
    }
  }

  // Per-call global matcher — never mutate the source regex.
  const matcher = new RegExp(COACHING_ID_RE.source, 'gi');
  const matches: SanitiseMatch[] = [];
  let changed = false;

  const replaced = text.replace(matcher, (match) => {
    const split = splitCoachingMatch(match);
    if (!split) return match;

    // Rule 1: exact graph-ID hit.
    if (idSet.has(match)) {
      const label = idToLabel.get(match);
      if (typeof label === 'string') {
        matches.push({ prefix: split.prefix, resolved: 'label' });
        changed = true;
        return label;
      }
      const generic = PREFIX_GENERIC[split.prefix] ?? 'the relevant element';
      matches.push({ prefix: split.prefix, resolved: 'generic' });
      changed = true;
      return generic;
    }

    // Rule 2: orphan — apply the high-confidence gate.
    if (isHighConfidenceCoachingOrphan(split)) {
      const generic = PREFIX_GENERIC[split.prefix] ?? 'the relevant element';
      matches.push({ prefix: split.prefix, resolved: 'generic' });
      changed = true;
      return generic;
    }

    // Rule 3: ambiguous single-segment risky-prefix orphan — preserve.
    return match;
  });

  return { text: changed ? replaced : text, matches };
}
