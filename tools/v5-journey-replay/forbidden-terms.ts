/**
 * V5 alpha hardening Phase 3 — forbidden-term list.
 *
 * Terms that must NEVER appear in user-facing `assistant_text` or chip
 * labels/messages. Scan each step's response against this list; any
 * match fails the evidence row with `failing_contract: "internal term leak"`.
 *
 * Sources:
 *   - Paul's brief forbids: ContextPack, analysis is null, handler,
 *     state_commit, validator, kind_mismatch
 *   - Real staging PLoT capture (2d2aab36...) contains raw ID prefixes:
 *     opt_1, fac_churn_rate_2, goal_1, risk_1, out_1, out_2
 *   - V5 stale-aware explain recovery brief — runtime defines a regex
 *     array of "contradiction phrases" (e.g. "I haven't applied any
 *     changes", "previous analysis", "cached result") that must never
 *     reach the user. The harness imports the same constant so brief
 *     and harness cannot drift.
 *
 * The id-prefix regex allows the underscored literal `analysis_status`
 * inside log JSON but blocks raw entity ids leaking into user text.
 */

import { FORBIDDEN_USER_FACING_PHRASES } from '../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js';

export const FORBIDDEN_STRINGS: readonly string[] = [
  'ContextPack',
  'analysis is null',
  'state_commit',
  'kind_mismatch',
  'HANDLER_INVOCATION_FAILED',
  'STATE_COMMIT_FAILED',
  'ENTITY_KIND_MISMATCH',
  'ENTITY_NOT_FOUND',
  'ENTITY_RESOLUTION_AMBIGUOUS',
  'ENTITY_RESOLUTION_SUSPICIOUS',
  'PARAMETER_INVALID',
  'PRECONDITION_UNMET',
  'HANDLER_NOT_FOUND',
  // P0 V5 golden-path repair (Wave 6) — extend the wordlist with the
  // terms the brief explicitly forbids in user-facing text. Each
  // term either names internal mechanics (Zod, normalised, fact_type)
  // or names a specific handler / function (set_factor_value,
  // explain_results, selectRunAnalysisFact, analysisProjection)
  // that must never reach the wire as user copy.
  'BUDGET_TARGET',
  'Zod',
  'noop',
  'fact_type',
  'analysis_status',
  'graph_hash',
  'set_factor_value',
  'explain_results',
  'what_would_flip',
  'run_analysis',
  'edit_graph',
  'selectRunAnalysisFact',
  'analysisProjection',
  'analysisFreshness',
  'normalised',
  'normalized',
  // Patch language — surfaces in pre-repair drafts; user-facing copy
  // must speak in plain product terms.
  'patch_id',
  // DL-7 expansion — internal terms that may leak through accepted-edit
  // wiring once edit_graph PR B emits the new HandlerFact. Each is an
  // internal field / module / type name and must never reach user copy.
  // Verified not to appear in any V5 deterministic recovery template
  // (handler assistant_text strings) at the time of this extension.
  'buildTurnContext',
  'orchestrator-v5',
  'HandlerFact',
  'recent_changes',
  'prior_facts',
  'accepted_edit',
];

// Raw internal ID patterns (`opt_1`, `goal_1`, `fac_churn`, `risk_1`, `out_2`).
export const ID_PREFIX_REGEX = /\b(opt|fac|goal|risk|out)_[A-Za-z0-9]+/;

/**
 * Graph-hash-shaped string: 12+ contiguous hex chars with word boundaries.
 * Tight enough that legitimate prose (numbers, UUIDs with dashes, short
 * hex codes) does not trip; tight enough that a 12-char or 16-char graph
 * hash leak is caught.
 *
 * Per the edit_graph DL-7 audit ("graph hashes remain diagnostic only"),
 * graph hashes must never appear in any user-facing text — replay
 * therefore scans every step for this pattern, not just the
 * `what_changed` step.
 */
export const GRAPH_HASH_LEAK_REGEX = /\b[0-9a-f]{12,}\b/i;

// Developer terms that may appear as chip labels but not in ASSISTANT_TEXT
// narration. These are softer — "handler" in isolation is developer talk;
// "handler.run_analysis" is definitely a leak. We scan for the developer
// phrasing.
export const DEVELOPER_PHRASES: readonly RegExp[] = [
  /\bhandler[ _](id|failed|error|registered)\b/i,
  /\bvalidator\b/i,
];

/**
 * Snake_case / PascalCase identifiers from `FORBIDDEN_STRINGS` that
 * should match case-insensitively. These are internal field/module/type
 * names — there is no legitimate scenario where they belong in
 * user-visible copy in any casing, so accidental capitalisation drift
 * (e.g. `Recent_Changes`, `NoOp`) is still a leak. Keep this set tight:
 * matching everything case-insensitively risks false positives on
 * legitimate prose.
 */
const CASE_INSENSITIVE_NEEDLES: ReadonlySet<string> = new Set([
  // Pre-existing forbidden identifiers — explicit opt-in for
  // case-insensitive matching at audit time.
  'noop',
  'fact_type',
  // DL-7 expansion.
  'buildTurnContext',
  'orchestrator-v5',
  'HandlerFact',
  'recent_changes',
  'prior_facts',
  'accepted_edit',
]);

export function findForbiddenMatches(text: string): readonly string[] {
  const matches: string[] = [];
  const lowerText = text.toLowerCase();
  for (const needle of FORBIDDEN_STRINGS) {
    if (CASE_INSENSITIVE_NEEDLES.has(needle)) {
      if (lowerText.includes(needle.toLowerCase())) matches.push(needle);
    } else {
      if (text.includes(needle)) matches.push(needle);
    }
  }
  const idMatch = text.match(ID_PREFIX_REGEX);
  if (idMatch) matches.push(`raw_id:${idMatch[0]}`);
  // Graph-hash leak detection — per the edit_graph DL-7 contract,
  // graph hashes are diagnostic-only and must not surface in user text
  // for ANY step (not just `what_changed`). Reported with the
  // `graph_hash:` prefix so reviewers can distinguish hash leaks from
  // identifier leaks at a glance in evidence rows.
  const hashMatch = text.match(GRAPH_HASH_LEAK_REGEX);
  if (hashMatch) matches.push(`graph_hash:${hashMatch[0]}`);
  for (const re of DEVELOPER_PHRASES) {
    const m = text.match(re);
    if (m) matches.push(`dev_phrase:${m[0]}`);
  }
  // V5 stale-aware explain recovery brief — shared "contradiction
  // phrases" list (runtime is the source of truth; this harness
  // imports it so brief and harness cannot drift). Reported with the
  // `user_facing_phrase:` prefix so reviewers can distinguish from
  // identifier leaks / hash leaks / dev phrases at a glance.
  for (const re of FORBIDDEN_USER_FACING_PHRASES) {
    const m = text.match(re);
    if (m) matches.push(`user_facing_phrase:${m[0]}`);
  }
  return matches;
}

// ===========================================================================
// V5 Golden Journey benchmark prep — #277-specific public-surface guards.
//
// SCOPE (per the approved lane amendment): these scanners target ONLY
// user-facing / public response payload — the public `analysis_result`
// enrichment object and user-facing flip prose. They are NOT run over the
// evidence-pack's own internal metadata, and they are NOT part of the
// general prose leak scan (`findForbiddenMatches`), which already hard-gates
// `assistant_text` + chip labels/messages in every step via `coreAssertions`.
//
// The enrichment-carrier scan is the #277 ("what_would_flip" P0-B) leak
// contract: #277's keep-list transform (`toSafeTransportEnrichment`) drops
// the structural debug/lineage carriers below. Detecting them in the public
// enrichment is therefore a #277-acceptance / full-golden concern — it is
// deliberately EXCLUDED from the partial-spine mode (which pins a build where
// #277 is not yet deployed, so the carriers may legitimately still be present
// and must not red the spine baseline).
// ===========================================================================

/**
 * Structured enrichment keys that #277 drops as debug/lineage carriers.
 * Presence of any of these inside the PUBLIC `analysis_result.enrichment`
 * payload is a leak once #277 is live. Detected by key presence at any depth
 * (not prose matching) — these are object keys, not user copy.
 *
 * Source: #277 PR body "Deliberately dropped as leak/debug carriers".
 */
export const ENRICHMENT_LEAK_CARRIER_KEYS: readonly string[] = [
  '_meta',
  'meta',
  'm1_coaching',
  'm1_review',
  'decision_brief',
  'fact_objects',
  'downstream_calls',
  'critiques',
  'graph',
  'seed',
];

/**
 * Leaf VALUE markers that must never appear inside the public enrichment
 * payload. `[REDACTED]` is the redaction sentinel (a kept field carrying it
 * means a debug carrier survived); `isl_engine` is internal engine lineage.
 */
export const ENRICHMENT_LEAK_VALUE_MARKERS: readonly string[] = [
  '[REDACTED]',
  'isl_engine',
];

export interface EnrichmentLeakFinding {
  readonly kind: 'carrier_key' | 'value_marker';
  /** The carrier key name or the value marker string that matched. */
  readonly detail: string;
  /** Dotted path within the enrichment object where it was found. */
  readonly path: string;
}

/**
 * Recursively scan a PUBLIC enrichment payload (or any public response
 * sub-object) for #277 leak carriers. Returns every finding so the evidence
 * pack can list them. Depth-bounded as a defensive guard against pathological
 * nesting. Caller decides whether a finding fails the run (it is a hard gate
 * only in `gate-277` / `p0-full-golden`).
 */
export function findEnrichmentLeakCarriers(
  enrichment: unknown,
  maxDepth = 12,
): readonly EnrichmentLeakFinding[] {
  const findings: EnrichmentLeakFinding[] = [];
  const visit = (node: unknown, path: string, depth: number): void => {
    if (node === null || node === undefined || depth > maxDepth) return;
    if (typeof node === 'string') {
      for (const marker of ENRICHMENT_LEAK_VALUE_MARKERS) {
        if (node.includes(marker)) {
          findings.push({ kind: 'value_marker', detail: marker, path: path || '<root>' });
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => visit(v, `${path}[${i}]`, depth + 1));
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const childPath = path ? `${path}.${k}` : k;
        if (ENRICHMENT_LEAK_CARRIER_KEYS.includes(k)) {
          findings.push({ kind: 'carrier_key', detail: k, path: childPath });
        }
        visit(v, childPath, depth + 1);
      }
    }
  };
  visit(enrichment, '', 0);
  return findings;
}

/**
 * #277 flip honesty — the dishonest "no practical flip, yet says small
 * changes could flip" contradiction.
 *
 * `FLIP_NO_TIPPING_POINT_RE` matches the honest #277 copy ("no single factor
 * on its own reached a tipping point ...", "no realistic single-factor shift
 * ... within the current bounds"). `FLIP_COULD_FLIP_CLAIM_RE` matches the
 * pre-#277 dishonest flippability claim ("even small adjustments ... could
 * shift which option leads"). Co-occurrence is the contradiction the live
 * `no_effect` case exposed. Each regex is anchored so the honest sentence
 * ("...that would change which option leads") does NOT trip the could-flip
 * pattern (which requires "small ... could shift/flip").
 */
export const FLIP_NO_TIPPING_POINT_RE =
  /\bno (?:single |realistic single-)?(?:factor|factor shift)\b[^.]*\btipping point\b|\bno realistic single-factor shift\b|\bno single factor on its own reached a tipping point\b/i;

export const FLIP_COULD_FLIP_CLAIM_RE =
  /\bsmall (?:adjustments?|changes?|movements?)\b[^.]*\b(?:shift|flip|change which option leads)\b|\bcould (?:shift|flip) which option leads\b/i;
