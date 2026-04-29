/**
 * Output safety — central egress entity-ID leak guard.
 *
 * Defence-in-depth scrubber that runs at the V5 chokepoint (sendFinalised200
 * in route-v2.ts). Catches raw internal entity IDs (e.g. `fac_delivery_cost`)
 * that slipped past every handler-level guard and replaces them with either a
 * resolved human label (when the graph is available) or a prefix-aware generic
 * fallback.
 *
 * Two layers protect user-facing prose:
 *   - Layer 1 (handler-local, e.g. edit-graph.ts): scrubs LLM/PLoT-generated
 *     strings before they enter `assistantText`. Logs the raw ID for triage.
 *   - Layer 2 (this file): scrubs the assembled OlumiResponse before egress.
 *     Logs ONLY the prefix type, never the raw ID.
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
 * Scope amendments to the original brief (recorded explicitly):
 *   - `edge_*` IDs are NOT in ENTITY_ID_LEAK_RE and are NOT covered by this
 *     scan. The brief listed `edge_` in the prefix taxonomy, but adding it to
 *     the shared regex requires co-reviewing 7 `.test()` callsites in
 *     patch-summary.ts (where over-matching changes bail-out behaviour in
 *     already-working code paths). Edge IDs in user-facing prose are
 *     vanishingly rare in this codebase (warnings reference nodes, not
 *     edges). Deferred to a separate change with explicit patch-summary
 *     co-review. If you encounter an edge ID leak in user-facing text,
 *     escalate the prefix expansion as a standalone work item.
 *   - Edge LABEL resolution is unsupported. The brief mentioned "node or
 *     edge label" but the canonical `EdgeV3T` schema in
 *     `src/schemas/cee-v3.ts` has no `label` field — only `from`, `to`,
 *     `strength`, `exists_probability`, `effect_direction`. Adding edge
 *     labels is a schema-contract change, not a sanitiser change. Until
 *     then, edge IDs (if their prefix gap above is closed) would always
 *     resolve via the generic-fallback path.
 *
 * Heuristic for distinguishing real IDs from English compounds:
 *   - Short prefixes (`fac`, `opt`, `dec`, `goal`): no English collisions in
 *     these prefixes. Any `fac_<anything>` / `opt_<anything>` etc. is treated
 *     as a confirmed internal ID even with a single-token suffix.
 *   - Risky short prefixes (`out`, `risk`, `con`): English collisions exist
 *     (`out_of_scope`, `risk_adjusted`, `constraint_based`/`con_text`). Apply
 *     the slug-shape gate.
 *   - Full-word prefixes (`factor`, `option`, `decision`, `outcome`,
 *     `constraint`): English compounds are common (`factor_analysis`,
 *     `option_value`). Apply the slug-shape gate.
 */

import type { OlumiResponse, Action, Insight, Block } from '@talchain/schemas/boundary';
import type { GraphV3T } from '../../orchestrator/types.js';
import { log } from '../../utils/telemetry.js';
import { ENTITY_ID_LEAK_RE, resolveLabel } from '../../orchestrator/shared/entity-id-pattern.js';

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

// ----------------------------------------------------------------------------
// Envelope-level walk
// ----------------------------------------------------------------------------

export interface EgressSanitiseOpts {
  readonly graph: GraphV3T | null;
  readonly requestId: string;
  /**
   * Exit path / handler context for telemetry correlation. REQUIRED — the
   * production chokepoint always has it. Making this required prevents
   * silent telemetry regression where a future caller forgets to thread
   * it through. Tests must supply a placeholder (e.g. 'test').
   */
  readonly exitPath: string;
}

/**
 * Apply `sanitiseUserFacingText` to every user-facing string field in the
 * OlumiResponse envelope. Returns a shallow-cloned response with field-level
 * replacement; never mutates the input.
 *
 * Logs `v5.egress_id_leak` once per match found, with PREFIX TYPE ONLY (never
 * the raw ID — this is the last line of defence and we don't want to surface
 * leaked IDs to log infrastructure).
 */
export function sanitiseOlumiResponseForEgress(
  response: OlumiResponse,
  opts: EgressSanitiseOpts,
): OlumiResponse {
  const allMatches: SanitiseMatch[] = [];
  const collect = (text: string): string => {
    const r = sanitiseUserFacingText(text, opts.graph);
    if (r.matches.length > 0) allMatches.push(...r.matches);
    return r.text;
  };

  const sanitised: OlumiResponse = {
    ...response,
    assistant_text: collect(response.assistant_text),
    blocks: response.blocks.map((b) => sanitiseBlock(b, collect)),
    suggested_actions: response.suggested_actions.map((a) => sanitiseAction(a, collect)),
    insights: response.insights.map((i) => sanitiseInsight(i, collect)),
  };

  for (const m of allMatches) {
    log.warn(
      {
        event: 'v5.egress_id_leak',
        request_id: opts.requestId,
        exit_path: opts.exitPath,
        prefix: m.prefix,
        resolution: m.resolved,
        // INTENTIONAL: do NOT log the raw matched string. Layer 1 logs raw
        // IDs for triage; Layer 2 redacts because it is the egress boundary.
      },
      'V5 egress: entity-id leak caught and replaced',
    );
  }

  return sanitised;
}

// ----------------------------------------------------------------------------
// Discriminated-union walker — exhaustiveness is enforced by the `never` check
// in the default branch. The `Block` type imported above is the boundary
// schema's discriminated union (`@talchain/schemas/boundary`). When that
// schema gains a new block-type variant (e.g. `BlockSchema` adds a member),
// the `never` assignment below becomes a compile error, forcing a deliberate
// decision about whether the new type contains user-facing prose. Treat the
// build break as a feature, not a chore: do not add a `default` branch that
// silently passes the new variant through unscanned.
// ----------------------------------------------------------------------------

function sanitiseBlock(block: Block, collect: (s: string) => string): Block {
  switch (block.type) {
    case 'text':
      return { ...block, content: collect(block.content) };

    case 'analysis_result':
      // enrichment / leading_option_id / win_probabilities are structured /
      // opaque — leave untouched.
      return { ...block, summary: collect(block.summary) };

    case 'explanation':
      // referenced_option_ids[] is intentional machine IDs — leave untouched.
      return { ...block, narrative: collect(block.narrative) };

    case 'comparison':
      return {
        ...block,
        narrative: block.narrative !== undefined ? collect(block.narrative) : block.narrative,
        options: block.options.map((opt) => ({
          ...opt,
          label: collect(opt.label),
          // option_id, win_probability, attributes: structured — untouched.
        })),
      };

    case 'flip_analysis':
      // flip_scenarios[].factor_id / from_option_id / to_option_id are
      // intentional machine IDs — leave untouched.
      return { ...block, narrative: collect(block.narrative) };

    case 'error':
      // error_code (enum), severity (enum), details (opaque passthrough) —
      // no user-facing prose to scrub.
      return block;

    case 'graph_patch':
      // status / operation (enums); target_id / before / after — structured
      // machine fields. No user-facing prose to scrub.
      return block;

    case 'draft_graph':
      // nodes / edges arrays of z.unknown() — opaque, untouched.
      return block;

    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return block;
    }
  }
}

function sanitiseAction(action: Action, collect: (s: string) => string): Action {
  // id, action_type are machine routing fields — untouched.
  return {
    ...action,
    label: collect(action.label),
    message: collect(action.message),
  };
}

function sanitiseInsight(insight: Insight, collect: (s: string) => string): Insight {
  return { ...insight, text: collect(insight.text) };
}
