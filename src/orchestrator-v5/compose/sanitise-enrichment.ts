/**
 * V5 enrichment-prose sanitiser — pure function bundle.
 *
 * Implements the analysis-enrichment-critique-prose-safety contract:
 *   - Critique partitioning (D / U / S buckets per the implementation
 *     plan's classification table).
 *   - S-bucket replacement-message catalogue (Paul-approved copy,
 *     2026-04-30).
 *   - Path-aware scrub of user-facing enrichment prose: resolve entity
 *     IDs to labels, check Tier A (hard-ban) and Tier B (warning) token
 *     patterns.
 *   - Allowlist walker over the 15 user-facing prose paths the brief
 *     enumerates.
 *
 * No call-sites yet. The decision-review enricher (Commit 5) and the
 * response-finaliser backstop (Commit 6) consume this. Pure functions
 * throughout — no side effects, no logging, no IO.
 */

import { ENTITY_ID_LEAK_RE } from '../../orchestrator/shared/entity-id-pattern.js';
import {
  HARD_BAN_PATTERNS,
  WARNING_PATTERNS,
} from '../../orchestrator/shared/forbidden-tokens.js';
import {
  resolveLabelOrFallback,
  type LabelResolverContext,
} from './resolve-label.js';

// ============================================================================
// Critique-bucket classification
// ============================================================================

export type CritiqueBucket = 'D' | 'U' | 'S';

/**
 * Classification table — pinned in the implementation plan
 * (Docs/v5/fix-brief-...-implementation-plan.md). Every ISL critique
 * code from Inference-Service-Layer/src/models/critique.py is listed
 * here. Any new code defaults to 'D' via `bucketFor` below — fail-safe.
 */
export const CRITIQUE_BUCKETS: Readonly<Record<string, CritiqueBucket>> = {
  // ── Bucket D — diagnostic, suppress to _diagnostics ───────────────────
  MISSING_GOAL_NODE: 'D',
  GRAPH_CYCLE_DETECTED: 'D',
  GRAPH_EMPTY: 'D',
  INVALID_NODE_ID: 'D',
  DUPLICATE_NODE_ID: 'D',
  EDGE_STRENGTH_OUT_OF_RANGE: 'D',
  EDGE_STD_INVALID: 'D',
  EDGE_ENDPOINT_MISSING: 'D',
  NEGLIGIBLE_EDGE_STRENGTH: 'D',
  DUPLICATE_OPTION_ID: 'D',
  INTERVENTION_VALUE_INVALID: 'D',
  MONTE_CARLO_FAILED: 'D',
  BASELINE_NEAR_ZERO: 'D',
  INFERENCE_TIMEOUT: 'D',
  SEED_INVALID: 'D',
  NUMERICAL_INSTABILITY: 'D',
  IDENTIFIABILITY_ISSUE: 'D',
  CONSTRAINT_NODE_DEFAULT_BASE: 'D',
  INTERNAL_ERROR: 'D',
  // ── Bucket U — plain English, surface as-is after ID resolution ──────
  NO_OPTIONS: 'U',
  INSUFFICIENT_OPTIONS: 'U',
  DEGENERATE_OUTCOMES: 'U',
  // ── Bucket S — replace message with approved generic copy ────────────
  EMPTY_INTERVENTIONS: 'S',
  INVALID_INTERVENTION_TARGET: 'S',
  NO_EFFECTIVE_PATH_TO_GOAL: 'S',
  IDENTICAL_OPTIONS: 'S',
  GRAPH_DISCONNECTED: 'S',
  OPTION_NO_INTERVENTIONS: 'S',
  LOW_EFFECTIVE_SAMPLES: 'S',
  DEGENERATE_OPTION_ZERO_VARIANCE: 'S',
  HIGH_TIE_RATE: 'S',
};

/**
 * Resolve a critique code to its bucket. Unknown codes default to 'D'
 * — fail-safe rule: any future ISL code added without a conscious
 * promotion to U or S is suppressed by default.
 */
export function bucketFor(code: string | undefined | null): CritiqueBucket {
  if (typeof code !== 'string' || code.length === 0) return 'D';
  return CRITIQUE_BUCKETS[code] ?? 'D';
}

// ============================================================================
// S-bucket replacement messages (Paul-approved copy, 2026-04-30)
// ============================================================================
//
// Each entry is a thunk taking the critique's structured fields + the
// label resolver context. Returns the verbatim replacement message.
// `<label>` slots are filled via `resolveLabelOrFallback` so the output
// is always a human label OR `"the relevant option/factor"` — never a
// raw ID.

export interface SCritiqueVars {
  readonly affected_option_ids?: ReadonlyArray<string>;
  readonly affected_node_ids?: ReadonlyArray<string>;
}

function pickOptionId(vars: SCritiqueVars, idx = 0): string {
  return vars.affected_option_ids?.[idx] ?? '';
}

export const S_BUCKET_REPLACEMENTS: Readonly<
  Record<string, (ctx: LabelResolverContext, vars: SCritiqueVars) => string>
> = {
  EMPTY_INTERVENTIONS: (ctx, vars) =>
    `Option '${resolveLabelOrFallback(pickOptionId(vars), ctx)}' does not change anything yet. Specify what makes this option different.`,

  INVALID_INTERVENTION_TARGET: (ctx, vars) =>
    `Option '${resolveLabelOrFallback(pickOptionId(vars), ctx)}' refers to something that is not currently in the model.`,

  NO_EFFECTIVE_PATH_TO_GOAL: (ctx, vars) =>
    `Option '${resolveLabelOrFallback(pickOptionId(vars), ctx)}' does not currently connect to your goal.`,

  IDENTICAL_OPTIONS: (ctx, vars) =>
    `Options '${resolveLabelOrFallback(pickOptionId(vars, 0), ctx)}' and '${resolveLabelOrFallback(pickOptionId(vars, 1), ctx)}' currently make the same changes, so the analysis treats them as equivalent.`,

  GRAPH_DISCONNECTED: (_ctx, _vars) =>
    `Some parts of the model are not connected to your goal.`,

  OPTION_NO_INTERVENTIONS: (ctx, vars) =>
    `Option '${resolveLabelOrFallback(pickOptionId(vars), ctx)}' represents the current state, with no changes applied.`,

  LOW_EFFECTIVE_SAMPLES: (_ctx, _vars) =>
    `This analysis is less reliable than usual, so treat the result as a signal to check rather than a settled answer.`,

  DEGENERATE_OPTION_ZERO_VARIANCE: (ctx, vars) =>
    `Option '${resolveLabelOrFallback(pickOptionId(vars), ctx)}' does not currently affect the goal.`,

  HIGH_TIE_RATE: (_ctx, _vars) =>
    `The options are very close in this analysis. Treat the current lead as finely balanced.`,
};

// ============================================================================
// User-facing-prose path allowlist
// ============================================================================
//
// 15 paths that get scanned + scrubbed inside `enrichment`. Anything
// else is left byte-equal. Encoded as a list of "path matchers" —
// callable predicates over a JSONPath-like string the walker builds.
//
// Path syntax matches the walker below: starts with `$.blocks[*]` (the
// scrubber receives the inner enrichment object only — caller handles
// outer block iteration).

const ALLOWLISTED_LEAF_PATHS: ReadonlyArray<RegExp> = [
  /^\$\.critiques\[\d+\]\.message$/,
  /^\$\.critiques\[\d+\]\.suggestion$/,
  /^\$\.gaps\[\d+\]\.description$/,
  /^\$\.robustness\[\d+\]\.caveat$/,
  /^\$\.summary$/,
  /^\$\.narrative$/,
  /^\$\.improvement_guidance\[\d+\]$/,
  /^\$\.factor_sensitivity\[\d+\]\.interpretation$/,
  /^\$\.m1_review\[\d+\]\.text$/,
  /^\$\.m1_coaching\[\d+\]\.text$/,
  /^\$\.rationale$/,
  /^\$\.robustness_synthesis$/,
  /^\$\.review_cards\[\d+\]\.what$/,
  /^\$\.review_cards\[\d+\]\.why$/,
  /^\$\.review_cards\[\d+\]\.items\[\d+\]\.suggested_evidence$/,
];

export function isAllowlistedPath(path: string): boolean {
  for (const re of ALLOWLISTED_LEAF_PATHS) {
    if (re.test(path)) return true;
  }
  return false;
}

// ============================================================================
// Per-string scrubber
// ============================================================================

export interface SanitiseTextResult {
  readonly text: string;
  /**
   * Tier A hits found in the user-facing prose. Always non-empty when
   * `suppress === true`. Surfaced for telemetry; the `text` field is
   * authoritative for what should land on the wire.
   */
  readonly hardBans: ReadonlyArray<string>;
  /** Tier B hits — warnings only. */
  readonly warnings: ReadonlyArray<string>;
  /** Entity-ID matches that were replaced via the resolver. */
  readonly resolved: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  /**
   * **Fail-shut signal.** True when one or more `HARD_BAN_PATTERNS`
   * matched after ID resolution. Callers MUST suppress the field
   * entirely (route critique to bucket D, drop prose leaf) rather than
   * shipping `text` — the engine vocabulary still contaminates user-
   * facing prose even with IDs resolved.
   */
  readonly suppress: boolean;
}

/**
 * Scrub a single user-facing string:
 *   1. Replace every ENTITY_ID_LEAK_RE match with `resolveLabelOrFallback`.
 *   2. After ID resolution, scan for HARD_BAN_PATTERNS (Tier A).
 *      → if ANY match: set `suppress=true`. Caller fails closed.
 *   3. Scan for WARNING_PATTERNS (Tier B) — does not modify `suppress`.
 *
 * Fail-shut policy: `suppress=true` means the field MUST NOT ship
 * verbatim. Caller decides the replacement (route critique to bucket
 * D; drop a prose leaf to a generic "_redacted_" or null). The
 * sanitiser intentionally does NOT auto-replace because the right
 * response varies by surface — a critique routes to `_diagnostics`
 * with structural fields preserved; a `summary` leaf is simply
 * removed; a `review_card.what` may be replaced with the card's
 * structured fields.
 */
export function sanitiseEnrichmentText(
  text: string,
  ctx: LabelResolverContext,
): SanitiseTextResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { text: text ?? '', hardBans: [], warnings: [], resolved: [], suppress: false };
  }

  const resolved: Array<{ id: string; label: string }> = [];
  const global = new RegExp(ENTITY_ID_LEAK_RE.source, 'gi');
  const out = text.replace(global, (match) => {
    const label = resolveLabelOrFallback(match, ctx);
    resolved.push({ id: match, label });
    return label;
  });

  const hardBans: string[] = [];
  for (const re of HARD_BAN_PATTERNS) {
    const m = out.match(re);
    if (m && typeof m[0] === 'string') hardBans.push(m[0]);
  }

  const warnings: string[] = [];
  for (const re of WARNING_PATTERNS) {
    const m = out.match(re);
    if (m && typeof m[0] === 'string') warnings.push(m[0]);
  }

  return { text: out, hardBans, warnings, resolved, suppress: hardBans.length > 0 };
}

// ============================================================================
// Critique-array partitioner
// ============================================================================

export interface CritiqueLike {
  readonly id?: string;
  readonly code?: string;
  readonly severity?: string;
  readonly source?: string;
  readonly message?: string;
  readonly suggestion?: string;
  readonly affected_option_ids?: ReadonlyArray<string>;
  readonly affected_node_ids?: ReadonlyArray<string>;
  readonly [k: string]: unknown;
}

export interface PartitionedCritiques {
  readonly user: ReadonlyArray<CritiqueLike>;
  readonly diagnostic: ReadonlyArray<CritiqueLike>;
  readonly hardBans: ReadonlyArray<{ readonly path: string; readonly hit: string }>;
  readonly warnings: ReadonlyArray<{ readonly path: string; readonly hit: string }>;
}

/**
 * Partition `enrichment.critiques[]` into:
 *   - `user`: critiques that should remain on `enrichment.critiques[]`
 *     after sanitisation. Bucket U keeps the original message (with IDs
 *     resolved + Tier A scrubbed); bucket S has its message replaced
 *     by `S_BUCKET_REPLACEMENTS`.
 *   - `diagnostic`: critiques routed to `enrichment._diagnostics.critiques[]`.
 *     Bucket D. Caller decides whether to emit `_diagnostics` based on
 *     `CEE_TURN_DEBUG_ENABLED`.
 *
 * Structural fields (id, code, severity, source, affected_*) are
 * preserved verbatim for both buckets. Only the `message` field is
 * rewritten on bucket-S critiques.
 */
export function partitionCritiques(
  critiques: ReadonlyArray<CritiqueLike>,
  ctx: LabelResolverContext,
): PartitionedCritiques {
  const user: CritiqueLike[] = [];
  const diagnostic: CritiqueLike[] = [];
  const hardBans: Array<{ path: string; hit: string }> = [];
  const warnings: Array<{ path: string; hit: string }> = [];

  for (let i = 0; i < critiques.length; i++) {
    const c = critiques[i]!;
    const bucket = bucketFor(c.code);

    if (bucket === 'D') {
      diagnostic.push(c);
      continue;
    }

    if (bucket === 'S') {
      const replacementFn = c.code ? S_BUCKET_REPLACEMENTS[c.code] : undefined;
      const replacedMessage = replacementFn
        ? replacementFn(ctx, {
            affected_option_ids: c.affected_option_ids,
            affected_node_ids: c.affected_node_ids,
          })
        : c.message ?? '';
      // Ensure the replacement itself is clean (defensive — the catalogue
      // strings are reviewed but the resolver might inject a label that
      // contains a hard-ban substring under freak circumstances).
      const scrubbed = sanitiseEnrichmentText(replacedMessage, ctx);
      for (const hit of scrubbed.hardBans) {
        hardBans.push({ path: `$.critiques[${i}].message`, hit });
      }
      for (const hit of scrubbed.warnings) {
        warnings.push({ path: `$.critiques[${i}].message`, hit });
      }
      // Fail-shut: if the S-bucket replacement itself trips a hard-ban
      // (catalogue regression OR an injected label contains an engine
      // token), route the critique to D rather than ship contaminated
      // copy. Structural fields preserved.
      if (scrubbed.suppress) {
        diagnostic.push(c);
      } else {
        user.push({ ...c, message: scrubbed.text });
      }
      continue;
    }

    // bucket === 'U'
    const scrubbed = sanitiseEnrichmentText(c.message ?? '', ctx);
    for (const hit of scrubbed.hardBans) {
      hardBans.push({ path: `$.critiques[${i}].message`, hit });
    }
    for (const hit of scrubbed.warnings) {
      warnings.push({ path: `$.critiques[${i}].message`, hit });
    }
    let updated: CritiqueLike = { ...c, message: scrubbed.text };
    let suppressDueToSuggestion = false;
    if (typeof c.suggestion === 'string') {
      const scrubbedSug = sanitiseEnrichmentText(c.suggestion, ctx);
      for (const hit of scrubbedSug.hardBans) {
        hardBans.push({ path: `$.critiques[${i}].suggestion`, hit });
      }
      for (const hit of scrubbedSug.warnings) {
        warnings.push({ path: `$.critiques[${i}].suggestion`, hit });
      }
      updated = { ...updated, suggestion: scrubbedSug.text };
      if (scrubbedSug.suppress) suppressDueToSuggestion = true;
    }
    // Fail-shut: a U-bucket critique whose message OR suggestion tripped
    // a hard-ban after ID resolution must not ship verbatim. Engine
    // vocabulary survived the resolver, which is exactly what the
    // brief warned about. Route the whole critique to D so structural
    // fields are still preserved (caller surfaces them in
    // _diagnostics for engineers).
    if (scrubbed.suppress || suppressDueToSuggestion) {
      diagnostic.push(c);
    } else {
      user.push(updated);
    }
  }

  return { user, diagnostic, hardBans, warnings };
}

// ============================================================================
// Allowlist walker (operates on enrichment subtree, not full response)
// ============================================================================

export interface SanitiseEnrichmentResult {
  readonly enrichment: Record<string, unknown>;
  readonly diagnostic: { readonly critiques: ReadonlyArray<CritiqueLike> };
  readonly hardBans: ReadonlyArray<{ readonly path: string; readonly hit: string }>;
  readonly warnings: ReadonlyArray<{ readonly path: string; readonly hit: string }>;
}

/**
 * Walk an `enrichment` object, scrubbing every allowlisted user-facing
 * prose path and partitioning `critiques[]` by bucket. Returns:
 *   - `enrichment`: the cloned-and-rewritten enrichment, with bucket-D
 *     critiques REMOVED from `critiques[]`.
 *   - `diagnostic.critiques`: bucket-D critiques verbatim, for the
 *     caller to attach as `enrichment._diagnostics.critiques` when
 *     `CEE_TURN_DEBUG_ENABLED=true`.
 *   - `hardBans` / `warnings`: every Tier-A / Tier-B hit, path-tagged.
 *
 * Structural fields (everything not in the allowlist) are preserved
 * by deep-clone: the contract acceptance test asserts byte-equal on
 * the excluded subtrees pre/post.
 */
export function sanitiseEnrichment(
  enrichment: Record<string, unknown>,
  graph: LabelResolverContext['graph'] = null,
  analysisReady: LabelResolverContext['analysisReady'] = null,
): SanitiseEnrichmentResult {
  const ctx: LabelResolverContext = { graph, analysisReady, enrichment };
  // Node 17+ global; `globalThis.` prefix avoids a no-undef lint hit
  // under the project's lint config (matches src/orchestrator/patch-applier.ts pattern).
  const cloned = globalThis.structuredClone(enrichment) as Record<string, unknown>;
  const hardBans: Array<{ path: string; hit: string }> = [];
  const warnings: Array<{ path: string; hit: string }> = [];

  // ── strip any pre-existing _diagnostics ───────────────────────────────
  // Hard contract: `_diagnostics` is CEE-owned, debug-only, and is
  // attached EXCLUSIVELY by the enricher (Commit 5) when
  // CEE_TURN_DEBUG_ENABLED=true. Any `_diagnostics` already present on
  // the input — from a cached upstream producer, a future regression,
  // or a misbehaving handler — is removed here so the
  // "absent when debug=false" acceptance is guaranteed by the
  // sanitiser's own output, not by the caller-side gate alone.
  delete cloned._diagnostics;

  // ── critiques (bucket-aware partition) ────────────────────────────────
  let diagnosticCritiques: ReadonlyArray<CritiqueLike> = [];
  const rawCritiques = cloned['critiques'];
  if (Array.isArray(rawCritiques)) {
    const partition = partitionCritiques(rawCritiques as CritiqueLike[], ctx);
    cloned['critiques'] = partition.user;
    diagnosticCritiques = partition.diagnostic;
    for (const h of partition.hardBans) hardBans.push(h);
    for (const w of partition.warnings) warnings.push(w);
  }

  // ── flat string leaves ────────────────────────────────────────────────
  // Fail-shut policy: a hard-ban hit on a prose leaf means engine
  // vocabulary survived ID resolution. The leaf is DELETED rather than
  // shipped — the structural shape stays consistent (the field becomes
  // optional/missing) and downstream consumers fall back to whatever
  // they render when the field is absent. This is the same fail-shut
  // contract `partitionCritiques` applies to critique-array entries.
  const flatStringLeaves: ReadonlyArray<string> = [
    'summary',
    'narrative',
    'rationale',
    'robustness_synthesis',
  ];
  for (const key of flatStringLeaves) {
    const v = cloned[key];
    if (typeof v === 'string' && v.length > 0) {
      const path = `$.${key}`;
      if (!isAllowlistedPath(path)) continue;
      const scrubbed = sanitiseEnrichmentText(v, ctx);
      for (const hit of scrubbed.hardBans) hardBans.push({ path, hit });
      for (const hit of scrubbed.warnings) warnings.push({ path, hit });
      if (scrubbed.suppress) {
        delete cloned[key];
      } else {
        cloned[key] = scrubbed.text;
      }
    }
  }

  // ── string-array leaves (improvement_guidance) ────────────────────────
  const stringArrayLeaves: ReadonlyArray<string> = ['improvement_guidance'];
  for (const key of stringArrayLeaves) {
    const arr = cloned[key];
    if (!Array.isArray(arr)) continue;
    const out: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (typeof v !== 'string') {
        out.push(v as never);
        continue;
      }
      const path = `$.${key}[${i}]`;
      if (!isAllowlistedPath(path)) {
        out.push(v);
        continue;
      }
      const scrubbed = sanitiseEnrichmentText(v, ctx);
      for (const hit of scrubbed.hardBans) hardBans.push({ path, hit });
      for (const hit of scrubbed.warnings) warnings.push({ path, hit });
      // Fail-shut: drop the offending entry from the array. The array
      // shape is preserved (string[]) but the contaminated entry is
      // omitted.
      if (scrubbed.suppress) continue;
      out.push(scrubbed.text);
    }
    cloned[key] = out;
  }

  // ── object-of-strings within an array (factor_sensitivity, m1_review,
  //     m1_coaching, gaps, robustness) ────────────────────────────────────
  const arrayOfObjectLeaves: ReadonlyArray<{ arrayKey: string; field: string }> = [
    { arrayKey: 'factor_sensitivity', field: 'interpretation' },
    { arrayKey: 'm1_review', field: 'text' },
    { arrayKey: 'm1_coaching', field: 'text' },
    { arrayKey: 'gaps', field: 'description' },
    { arrayKey: 'robustness', field: 'caveat' },
  ];
  for (const { arrayKey, field } of arrayOfObjectLeaves) {
    const arr = cloned[arrayKey];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (item == null || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const v = rec[field];
      if (typeof v !== 'string' || v.length === 0) continue;
      const path = `$.${arrayKey}[${i}].${field}`;
      if (!isAllowlistedPath(path)) continue;
      const scrubbed = sanitiseEnrichmentText(v, ctx);
      for (const hit of scrubbed.hardBans) hardBans.push({ path, hit });
      for (const hit of scrubbed.warnings) warnings.push({ path, hit });
      // Fail-shut: drop the prose field but leave the structural item
      // intact (sensitivity_value, node_id, etc. still surface).
      if (scrubbed.suppress) {
        delete rec[field];
      } else {
        rec[field] = scrubbed.text;
      }
    }
  }

  // ── review_cards user-facing prose (what / why / items[*].suggested_evidence) ──
  const reviewCards = cloned['review_cards'];
  if (Array.isArray(reviewCards)) {
    for (let i = 0; i < reviewCards.length; i++) {
      const card = reviewCards[i];
      if (card == null || typeof card !== 'object') continue;
      const cardRec = card as Record<string, unknown>;
      for (const f of ['what', 'why'] as const) {
        const v = cardRec[f];
        if (typeof v !== 'string' || v.length === 0) continue;
        const path = `$.review_cards[${i}].${f}`;
        const scrubbed = sanitiseEnrichmentText(v, ctx);
        for (const hit of scrubbed.hardBans) hardBans.push({ path, hit });
        for (const hit of scrubbed.warnings) warnings.push({ path, hit });
        if (scrubbed.suppress) {
          delete cardRec[f];
        } else {
          cardRec[f] = scrubbed.text;
        }
      }
      const items = cardRec['items'];
      if (Array.isArray(items)) {
        for (let j = 0; j < items.length; j++) {
          const it = items[j];
          if (it == null || typeof it !== 'object') continue;
          const itRec = it as Record<string, unknown>;
          const v = itRec['suggested_evidence'];
          if (typeof v !== 'string' || v.length === 0) continue;
          const path = `$.review_cards[${i}].items[${j}].suggested_evidence`;
          const scrubbed = sanitiseEnrichmentText(v, ctx);
          for (const hit of scrubbed.hardBans) hardBans.push({ path, hit });
          for (const hit of scrubbed.warnings) warnings.push({ path, hit });
          if (scrubbed.suppress) {
            delete itRec['suggested_evidence'];
          } else {
            itRec['suggested_evidence'] = scrubbed.text;
          }
        }
      }
    }
  }

  return {
    enrichment: cloned,
    diagnostic: { critiques: diagnosticCritiques },
    hardBans,
    warnings,
  };
}
