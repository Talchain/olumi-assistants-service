/**
 * Shared decision_review LLM invocation helper.
 *
 * Extracted from src/routes/assist.v1.decision-review.ts for reuse by the
 * V5 Group 1 Task B auto-fire path. The HTTP endpoint keeps its full retry /
 * shape-correction logic layered on top; V5 uses single-shot semantics with
 * a hard 15s timeout, degrading to thin content on failure.
 *
 * Design:
 *  - `buildDecisionReviewUserMessage` exposes the exact user-message shape
 *    the prompt expects. Unchanged from the route handler.
 *  - `invokeDecisionReview` loads the prompt, calls the adapter, extracts
 *    JSON, and returns a parsed object plus call metadata. No retry; caller
 *    decides whether to retry. No rate limiting; that is a route concern.
 *  - Never throws on shape-check failure; returns null in `output` so the
 *    caller decides how to degrade.
 *  - Throws only on adapter errors / timeouts / aborts (caller catches and
 *    translates to graceful degradation).
 */

import { getSystemPromptSnapshot } from '../../adapters/llm/prompt-loader.js';
import type { SystemPromptMeta } from '../../adapters/llm/prompt-loader.js';
import {
  getAdapterWithResolution,
  getMaxTokensFromConfig,
  type ModelResolution,
} from '../../adapters/llm/router.js';
import type { CallOpts } from '../../adapters/llm/types.js';
import { extractJsonFromResponse } from '../../utils/json-extractor.js';
import {
  emitContextBudget,
  jsonStructureManifest,
} from '../../orchestrator-v5/context/context-budget-telemetry.js';
import {
  buildScienceClaimsSection,
  injectScienceClaimsSection,
} from './science-claims.js';

// ============================================================================
// Shared input shape (subset the V5 enricher needs; route schema is richer)
// ============================================================================

/**
 * Adapter-side diagnostics for the decision_review LLM call. Lives on the
 * input object, never injected into the user message — see
 * `buildDecisionReviewUserMessage` for the strict separation. v12 (the next
 * decision_review prompt revision) will read these signals through a future
 * adapter-side hook that overrides deterministic_coaching defaults; today
 * v11 is unaware of `_meta` and that is intentional.
 */
export interface DecisionReviewMeta {
  readonly input_shape_version: 'v5-normalised';
  /** Number of populated entries on flip_threshold_data after derivation. */
  readonly flip_threshold_count: number;
  /**
   * ROADMAP 2.228 F1 — WHICH enrichment shape the flip rows came from.
   *   `top_level`     — PLoT's live `enrichment.flip_thresholds[]`.
   *   `nested_legacy` — the historical `results[].factor_sensitivity[]
   *                     .flip_threshold` shape, used ONLY when the top-level
   *                     key is absent entirely.
   *   `none`          — neither shape yielded a row.
   *
   * ⚠ THIS IS A TRIPWIRE, NOT A SAMPLE. An earlier revision of this comment
   * called it evidence of the legacy branch's "real-world frequency"; that
   * framing is WITHDRAWN. PLoT's Tier-B always-emit contract ships
   * `flip_thresholds` as an array unconditionally, so the legacy branch is
   * reachable only for an envelope the contract forbids and this field should
   * read `'top_level'` on 100% of live turns. A single `'nested_legacy'` is a
   * contract violation to investigate, never a data point to average.
   *
   * (That contract is a cross-repo claim, sourced from the #784 adversarial
   * review at PLoT tip `29703ee` and NOT re-derived in this repo — which is
   * precisely why the label exists: it is the thing that would refute it.)
   *
   * Internal observability only; never reaches the user message.
   */
  readonly flip_threshold_source: 'top_level' | 'nested_legacy' | 'none';
  /**
   * ROADMAP 2.228 F1 — top-level rows the producer explicitly ATTESTED as
   * having no flip (`flip_value: null` plus a reason that satisfies
   * `isAttestedNoFlipReason`, which owns that vocabulary — the tokens are
   * deliberately NOT enumerated here, because a second copy of an open list is
   * the mirror this predicate was created to remove). These are deliberately
   * NOT forwarded to the prompt (see `readFlipThresholdData` in
   * decision-review-enricher.ts for the filter-vs-forward decision), so this
   * count is the only place the distinction between "the producer found
   * nothing" and "the producer said nothing" survives.
   */
  readonly flip_no_effect_count: number;
  /**
   * ROADMAP 2.228 F1 — flip PAIRS refused by
   * `flipRowScaleUnsafeForPromptUnits`, which owns the full rule and its
   * evidence. Not restated here: the predicate refuses on TWO grounds (a
   * positively-attested non-display `value_scale`, AND an absent scale on a
   * row that carries a unit with a value inside the normalised band), and an
   * enumeration here would go stale the moment that rule is refined — as this
   * comment already did once.
   *
   * The hazard in one line: such a value cannot be quoted with its unit
   * without producing the two-numbers defect ("0.8625 GBP" from the prompt vs
   * "£34,500" from the chip path), and this layer holds no `cap` with which to
   * invert it. Fail-closed, counted loudly.
   */
  readonly flip_scale_refused_count: number;
  /** Number of populated entries on isl_results.factor_sensitivity. */
  readonly factor_sensitivity_count: number;
  /** Number of populated entries on isl_results.fragile_edges. */
  readonly fragile_edge_count: number;
  /** Number of model_critiques carried by deterministic_coaching after
   *  adapter v1 wiring (2026-05-21). Sourced from
   *  `enrichment.m1_coaching.model_critiques` when present; 0 when absent
   *  or when upstream supplies an empty array. May still be 0 in practice
   *  while PLoT's m1_coaching critiques pipeline matures. */
  readonly model_critique_count: number;
  /** Number of upstream m1_coaching.evidence_gaps entries that were object-
   *  shaped but missing one of the four required fields (factor_id,
   *  factor_label, voi_score, confidence). Internal observability only —
   *  the contract test at decision-review-enricher.contract.test.ts §"_meta
   *  is adapter-only" asserts this key never reaches the user message. */
  readonly evidence_gaps_dropped_count: number;
  /** Number of upstream m1_coaching.model_critiques entries that were
   *  object-shaped but missing one of the three required fields (type,
   *  severity, message) — see {@link normaliseModelCritique} in
   *  decision-review-enricher.ts. Mirrors evidence_gaps_dropped_count.
   *  Internal observability only — never reaches the user message. */
  readonly model_critiques_dropped_count: number;
  /** Number of well-formed model_critiques entries dropped purely by the
   *  MAX_MODEL_CRITIQUES count cap (FIX 2, 1.41) — distinct from
   *  model_critiques_dropped_count (malformed entries). Internal
   *  observability only — never reaches the user message. */
  readonly model_critiques_capped_count: number;
  /** True when at least one real upstream m1_coaching signal was mapped:
   *  non-default `readiness` or `headline_type`, non-empty `evidence_gaps`,
   *  or non-empty `model_critiques`. False when adapter fell back entirely
   *  to safe defaults (no m1_coaching subtree, or every field defaulted /
   *  was dropped). v13 will branch on this to decide whether to trust the
   *  `<DETERMINISTIC_COACHING>` block or derive from raw signals (margin,
   *  robustness_level, factor_sensitivity). */
  readonly has_deterministic_coaching: boolean;
  /** winner.win_probability minus runner_up.win_probability. Null when no
   *  runner-up exists. */
  readonly margin: number | null;
  /** robustness.level pulled defensively from the V2 envelope. Null when
   *  absent. */
  readonly robustness_level: string | null;
}

export interface DecisionReviewInvokeInput {
  readonly brief: string;
  readonly brief_hash: string;
  readonly graph: Record<string, unknown>;
  readonly isl_results: Record<string, unknown>;
  readonly deterministic_coaching: Record<string, unknown>;
  readonly winner: {
    readonly id: string;
    readonly label: string;
    readonly win_probability: number;
    readonly outcome_mean?: number;
    /**
     * Trust-spine board #1 (CEE half). Set true when the leading option
     * violates a hard constraint (CEE_CONSTRAINT_INFEASIBLE_GATE ON) so the
     * decision-review prompt does not frame it as a clean recommendation.
     * Absent when the gate is off or the winner is feasible.
     */
    readonly constraint_infeasible?: boolean;
    /** Set alongside `constraint_infeasible`; recommendation framing suppressed. */
    readonly recommendation_suppressed?: boolean;
    readonly [k: string]: unknown;
  };
  readonly runner_up: {
    readonly id: string;
    readonly label: string;
    readonly win_probability: number;
    readonly outcome_mean?: number;
    readonly [k: string]: unknown;
  } | null;
  readonly flip_threshold_data?: ReadonlyArray<Record<string, unknown>>;
  /**
   * D-ask-1 (2.11 P0-1) — P1-2: explicit disclosure that the analysed run
   * contains SCAFFOLDED options (placeholder interventions, not user
   * values). Built by `buildScaffoldPromptDisclosure` from the
   * `__scaffolded_options` outcome channel and rendered into the user
   * message's `<SCAFFOLDED_OPTIONS>` section (monolith path here; the
   * decomposed slices carry the same block) — without it, the review
   * narrates placeholder numbers as real user data. Absent on
   * non-scaffolded runs (byte-identical message).
   */
  readonly scaffold_disclosure?: string;
  /** Adapter-side diagnostics — never injected into the user message. */
  readonly _meta?: DecisionReviewMeta;
}

export interface InvokeDecisionReviewOptions {
  readonly requestId: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /**
   * RIDER-B / D-60 (2026-07-24): OVERRIDE-ONLY per-call model for the
   * decision_review A/B lever. When set, the review runs on this model instead
   * of the task-resolved default (routed as a `per_call` precedence source).
   * When ABSENT the behaviour is byte-identical to before — the default pin is
   * unchanged; this threads NO live model switch, only the ability to measure a
   * candidate arm on demand.
   */
  readonly model?: string;
}

export interface DecisionReviewInvokeResult {
  /** Parsed JSON object from the LLM response, or null when extraction failed. */
  readonly output: Record<string, unknown> | null;
  /** Raw LLM content (pre-extraction), for logging. */
  readonly raw: string;
  readonly model: string;
  readonly provider: string;
  readonly llm_latency_ms: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly prompt_version: string | undefined;
  /**
   * Served-prompt identity for THIS call, bound to the bytes actually sent:
   * content and meta come from ONE `getSystemPromptSnapshot('decision_review')`
   * resolution, which asserts `entry.promptHash === sha256(content)`.
   *
   * That binding is the point. Two independent reads (`getSystemPrompt` then
   * `getSystemPromptMeta`) CAN disagree — on the transient store-failure path
   * the loader serves default bytes while the uncached, unevicted store entry
   * is still what a separate meta read returns — which would certify a
   * default-bytes brief as a store prompt at the store's hash.
   *
   * `prompt_hash` is `undefined` when the loader had no cache entry to
   * report (cold start / cache miss / a variabled prompt that is deliberately
   * not cached) — an honest absence, never a fabricated digest. Consumers MUST
   * treat "no hash" as "identity unknown for this call" and omit the
   * attribution rather than substitute a placeholder.
   *
   * `prompt_source` is the loader's own `'store' | 'default'` verdict. It is
   * threaded verbatim rather than relabelled: calling a hardcoded-default
   * prompt "pms" would be exactly the class of untruth this attribution
   * exists to prevent. The decompose path (four fragment prompts composed
   * into one review) reports `'decompose_composite'` and NO hash, because no
   * single served prompt produced that output — the only honest identity
   * there is "not one prompt".
   */
  readonly prompt_hash: string | undefined;
  readonly prompt_source: SystemPromptMeta['source'] | 'decompose_composite';
  /**
   * Model-routing resolution for this call. Closes the V5 holistic audit
   * UU-16 observability gap: previously this site used `getAdapter(...)`
   * which does not surface the precedence-chain outcome, leaving the only
   * post-run_analysis LLM call invisible on the `model_resolutions`
   * dashboard. Callers that have per-turn context (the V5 enricher does)
   * forward this into `recordModelResolution` so turn-debug attributions
   * cover decision_review alongside ORIENT.
   */
  readonly resolution: ModelResolution;
}

// ============================================================================
// FIX 2 (1.41) — prompt size budgets
//
// Live evidence (flag-activation trial, 2026-07-08) captured this prompt at
// ~9.9k input tokens for a MODEST 4-option/5-factor/15-edge decision, with
// zero capping anywhere on <GRAPH>, <ISL_RESULTS>, or <DETERMINISTIC_COACHING>
// (each is a raw `JSON.stringify` of whatever the caller forwards — see
// Docs/lanes for the FIX-2 read-only assessment). Nothing stops this from
// growing linearly (or worse) with graph/option/factor count on a larger
// real decision. The caps below are a structural ceiling: array-length caps
// (primary defense, keeping the most decision-relevant entries — highest
// |elasticity| factors, highest switch_probability edges, highest
// win_probability options) plus a hard per-section byte ceiling (backstop
// for pathological single-entry bloat, e.g. an oversized node.data blob,
// that array-count capping alone would not catch). Truncation is always
// disclosed in-prompt via a `[TRUNCATED: ...]` marker — never silent.
// ============================================================================

/** Max graph.nodes entries forwarded (structural cap — no per-node relevance signal at this layer, so we keep the first N). */
export const DECISION_REVIEW_MAX_GRAPH_NODES = 40;
/** Max graph.edges entries forwarded (same rationale as MAX_GRAPH_NODES). */
export const DECISION_REVIEW_MAX_GRAPH_EDGES = 80;
/** Max isl_results.factor_sensitivity entries forwarded — ranked by |elasticity| descending when truncating (matches the prompt's own "pick by highest voi/influence, not position" doctrine). */
export const DECISION_REVIEW_MAX_FACTOR_SENSITIVITY = 15;
/** Max isl_results.fragile_edges entries forwarded — ranked by switch_probability descending (most severe first) when truncating. */
export const DECISION_REVIEW_MAX_FRAGILE_EDGES = 15;
/** Max isl_results.option_comparison entries forwarded — ranked by win_probability descending when truncating. */
export const DECISION_REVIEW_MAX_OPTION_COMPARISON = 20;
/** Hard per-section byte ceiling applied AFTER array-count capping — a pure backstop, not the primary mechanism. Chosen well above typical (currently-observed) section sizes so it never clips a normal, well-formed payload. */
export const DECISION_REVIEW_SECTION_MAX_CHARS = 8_000;
/**
 * Max flip_threshold_data entries forwarded — ranked by smallest
 * |flip_value - current_value| (closest-to-flip = most actionable /
 * decision-relevant) when truncating, mirroring the historical
 * `deriveFlipThresholds` closest-distance doctrine in
 * `src/orchestrator/context/analysis-compact.ts`.
 *
 * FIX A (1.41 fix round, C1): this section was still raw uncapped
 * `JSON.stringify` after FIX 2 shipped — one entry per factor, uncapped —
 * defeating the "hard ceiling" claim for graphs with many flip-eligible
 * factors.
 */
export const DECISION_REVIEW_MAX_FLIP_THRESHOLD_ENTRIES = 15;
/**
 * Max `<BRIEF>` character length. The brief is user-controlled free text
 * (no array structure to count-cap), so this is a direct char ceiling with
 * disclosed truncation — same "never silent" doctrine as the hard
 * per-section byte ceiling.
 *
 * FIX A (1.41 fix round, C1): the brief was still raw, uncapped user input
 * forwarded verbatim.
 */
export const DECISION_REVIEW_MAX_BRIEF_CHARS = 2_000;

function readSortNum(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

/**
 * Absolute-magnitude sort key for a rank field where "highest |value|" is
 * the keep-doctrine (e.g. elasticity). A missing/non-numeric value must
 * sort LAST (least relevant), never first — computing `Math.abs` on top of
 * `readSortNum`'s `NEGATIVE_INFINITY` sentinel would invert that
 * (`Math.abs(-Infinity) === Infinity`, so a malformed entry would sort as
 * the highest-magnitude entry and displace well-formed ones). This mirrors
 * the `flipDistance` sentinel doctrine below (missing data => least
 * relevant, via a value that always loses the comparison).
 */
function readAbsSortNum(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : Number.NEGATIVE_INFINITY;
}

/**
 * Cap an array to `max` entries. Under the cap: no-op (preserves original
 * order/content exactly — no behaviour change for typical/small payloads).
 * Over the cap: sorts by `rank` (descending relevance) before truncating,
 * so the KEPT entries are the most decision-relevant and the DROPPED tail
 * is the least relevant. Non-array input is treated as empty.
 */
function capArray<T>(
  arr: unknown,
  max: number,
  rank?: (a: T, b: T) => number,
): { kept: T[]; droppedCount: number } {
  if (!Array.isArray(arr)) return { kept: [], droppedCount: 0 };
  const list = arr as T[];
  if (list.length <= max) return { kept: list, droppedCount: 0 };
  const ranked = rank ? [...list].sort(rank) : list;
  return { kept: ranked.slice(0, max), droppedCount: list.length - max };
}

/**
 * Shrink a JSON value until it fits `maxChars`, WITHOUT ever producing invalid
 * JSON and without discarding the whole body.
 *
 * Arrays lose trailing elements; an object loses one element at a time from
 * whichever of its array members is currently longest, so a section made of
 * several lists degrades evenly instead of one list vanishing. Every caller
 * here has already rank-capped its arrays by decision relevance (highest
 * |elasticity|, highest switch_probability, closest-to-flip), so "trailing" is
 * "least relevant" by construction.
 *
 * Each round removes exactly one element, so this terminates. If nothing is
 * left to remove and the value still does not fit — a single pathological
 * scalar or deeply-nested blob — only then does it fall back to a marker
 * object, which is itself valid JSON.
 */
function shrinkJsonValueToFit(
  value: unknown,
  maxChars: number,
  originalChars: number,
): { json: string; note: string } {
  let working: unknown;
  try {
    working = JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    working = null;
  }

  const arraysOf = (v: unknown): unknown[][] => {
    if (Array.isArray(v)) return [v];
    if (v !== null && typeof v === 'object') {
      return Object.values(v as Record<string, unknown>).filter((m): m is unknown[] =>
        Array.isArray(m),
      );
    }
    return [];
  };

  let dropped = 0;
  let json = JSON.stringify(working, null, 2) ?? '';
  while (json.length > maxChars) {
    const candidates = arraysOf(working).filter((a) => a.length > 0);
    if (candidates.length === 0) break;
    let longest = candidates[0]!;
    for (const candidate of candidates) {
      if (candidate.length > longest.length) longest = candidate;
    }
    longest.pop();
    dropped += 1;
    json = JSON.stringify(working, null, 2) ?? '';
  }

  if (json.length > maxChars) {
    return {
      json: JSON.stringify(
        {
          _truncated: true,
          _reason: 'section exceeded the prompt ceiling',
          _original_chars: originalChars,
        },
        null,
        2,
      ),
      // `hard ceiling` is a PINNED phrase (invoke.prompt-cap.test.ts:231) — it
      // is the disclosure an operator greps for. A single oversized scalar
      // field is exactly the case that reaches here, and it is exactly the case
      // that test was written for.
      note: `section body omitted at the hard ceiling — a single oversized field cannot be bounded by entry removal (${originalChars} chars)`,
    };
  }
  return {
    json,
    note: `${dropped} trailing entr${dropped === 1 ? 'y' : 'ies'} omitted to fit the ${maxChars}-char section ceiling`,
  };
}

/**
 * Stringify a (already array-capped) section value, then apply the hard
 * byte-ceiling backstop. Any truncation (array-level or byte-level) is
 * disclosed via an appended `[TRUNCATED: ...]` marker — never silent.
 */
function boundedJsonBlock(value: unknown, notes: readonly string[]): string {
  let json = JSON.stringify(value, null, 2);
  const allNotes = [...notes];
  if (json.length > DECISION_REVIEW_SECTION_MAX_CHARS) {
    // ⛔ THIS USED TO BE `json.slice(0, MAX)` AND THAT HANDED THE MODEL
    // MALFORMED JSON — a mid-object cut ending the body at an arbitrary byte.
    // It fires today on `<ISL_RESULTS>` for a real 12-fragile-edge capture, so
    // this is not a hypothetical path.
    //
    // ⚠ AND THE OBVIOUS REPLACEMENT — a "body omitted" marker — IS WORSE, which
    // was MEASURED, not reasoned: swapping the slice for a marker object turned
    // a 12-edge ISL_RESULTS section into 212 characters of apology and took a
    // sibling spec red. A malformed body at least still carries the leading
    // entries the model needs; an empty one carries nothing.
    //
    // So the value is SHRUNK and re-serialised: valid JSON at every size, and
    // the leading (most decision-relevant, since every caller has already
    // rank-capped) entries survive. The graph section has its own
    // relationship-aware variant — see `boundedGraphJsonBlock`.
    const shrunk = shrinkJsonValueToFit(value, DECISION_REVIEW_SECTION_MAX_CHARS, json.length);
    json = shrunk.json;
    allNotes.push(shrunk.note);
  }
  return allNotes.length > 0 ? `${json}\n[TRUNCATED: ${allNotes.join('; ')}]` : json;
}

/**
 * ⭐⭐ THE GRAPH SECTION, BOUNDED WITHOUT EVER BECOMING UNPARSEABLE AND WITHOUT
 * SILENTLY LOSING EVERY RELATIONSHIP.
 *
 * Two defects this replaces, both latent until the reviewing model was actually
 * given a graph:
 *
 * ⛔ 1. RELATIONSHIPS WERE CAPPED INDEPENDENTLY OF THEIR ENDPOINTS. `nodes` cap
 * at 40 and `edges` cap at 80 ran as two unrelated slices, so a retained edge
 * could point at a node that had been dropped. The model then sees a causal
 * link between two ids, one of which is not in the graph — and the contract
 * gate, grounding against the same projection, would refuse the model's own
 * citation of it. Endpoints of retained edges are now retained FIRST, and any
 * edge whose endpoint did not survive is dropped WITH ITS DISCLOSURE rather
 * than left dangling.
 *
 * ⛔ 2. THE BYTE CEILING SLICED THE JSON STRING. See `boundedJsonBlock`. Here
 * the VALUE is shrunk and re-serialised instead, so the output is valid JSON at
 * every size. Shrinking drops from the tail one entity at a time — a guaranteed
 * decrement, so the loop terminates — and edges go before nodes, because a node
 * list with no edges still tells the model what exists whereas edges pointing
 * at absent nodes tell it something false.
 *
 * Every omission is disclosed twice: machine-readably inside the object as
 * `_omitted`, and in the section's `[TRUNCATED: …]` marker.
 */
function boundedGraphJsonBlock(graph: Record<string, unknown>): string {
  const rawNodes = Array.isArray(graph['nodes']) ? (graph['nodes'] as unknown[]) : null;
  const rawEdges = Array.isArray(graph['edges']) ? (graph['edges'] as unknown[]) : null;
  if (rawNodes === null && rawEdges === null) {
    // Not a recognisable node/edge graph — fall back to the generic backstop.
    return boundedJsonBlock(graph, []);
  }

  const originalNodeCount = rawNodes?.length ?? 0;
  const originalEdgeCount = rawEdges?.length ?? 0;

  const idOf = (entity: unknown): string | null => {
    if (entity === null || typeof entity !== 'object' || Array.isArray(entity)) return null;
    const id = (entity as Record<string, unknown>)['id'];
    return typeof id === 'string' && id.length > 0 ? id : null;
  };
  const endpointsOf = (entity: unknown): readonly string[] => {
    if (entity === null || typeof entity !== 'object' || Array.isArray(entity)) return [];
    const e = entity as Record<string, unknown>;
    return [e['from'], e['to']].filter((v): v is string => typeof v === 'string' && v.length > 0);
  };

  let edges = (rawEdges ?? []).slice(0, DECISION_REVIEW_MAX_GRAPH_EDGES);

  // Endpoint-first node retention: nodes an EDGE depends on take the cap's
  // places before unreferenced nodes do.
  const needed = new Set<string>();
  for (const edge of edges) for (const id of endpointsOf(edge)) needed.add(id);
  const allNodes = rawNodes ?? [];
  const referenced = allNodes.filter((n) => {
    const id = idOf(n);
    return id !== null && needed.has(id);
  });
  const unreferenced = allNodes.filter((n) => {
    const id = idOf(n);
    return id === null || !needed.has(id);
  });
  let nodes = [...referenced, ...unreferenced].slice(0, DECISION_REVIEW_MAX_GRAPH_NODES);

  const dropDanglingEdges = () => {
    if (rawNodes === null) return;
    const present = new Set(nodes.map(idOf).filter((v): v is string => v !== null));
    edges = edges.filter((edge) => {
      const ends = endpointsOf(edge);
      return ends.length === 0 || ends.every((id) => present.has(id));
    });
  };
  dropDanglingEdges();

  // ⚠ BYTE-IDENTICAL WHEN NOTHING IS DROPPED. A graph that fits is emitted
  // exactly as it arrived — no `_node_count`, no `_omitted`, no added noise —
  // so this function changes the prompt ONLY on the graphs it actually has to
  // bound. Every other turn's bytes are unchanged, which keeps the blast radius
  // of this repair to the case it exists for.
  const render = (): string => {
    const intact = nodes.length === originalNodeCount && edges.length === originalEdgeCount;
    if (intact) return JSON.stringify(graph, null, 2);
    return JSON.stringify(
      {
        ...graph,
        ...(rawNodes !== null ? { nodes } : {}),
        ...(rawEdges !== null ? { edges } : {}),
        ...(rawNodes !== null ? { _node_count: nodes.length } : {}),
        ...(rawEdges !== null ? { _edge_count: edges.length } : {}),
        _omitted: {
          nodes: originalNodeCount - nodes.length,
          edges: originalEdgeCount - edges.length,
          of_nodes: originalNodeCount,
          of_edges: originalEdgeCount,
          reason: 'prompt budget; isolated nodes dropped first, then edges with their endpoints',
        },
      },
      null,
      2,
    );
  };

  const referencedIds = (): Set<string> => {
    const set = new Set<string>();
    for (const edge of edges) for (const id of endpointsOf(edge)) set.add(id);
    return set;
  };

  let json = render();
  // ⛔ ORDER MATTERS, AND THE OBVIOUS ORDER IS WRONG. Dropping the tail entity
  // — edges first — was written here and MEASURED: a 120-node/150-edge graph
  // came out with all 150 edges gone and the node list still over budget, which
  // is precisely the "silently drop every relationship" outcome this function
  // exists to prevent. A list of nodes with no edges is not a model.
  //
  // So ISOLATES GO FIRST: a node no retained edge touches costs budget and
  // carries no relationship. Only when every remaining node is load-bearing
  // does an edge go — and then its orphaned endpoints go WITH it, so what
  // survives is always a connected sub-model rather than a scatter of ids.
  //
  // Every branch removes at least one entity, so this terminates at the floor
  // (`nodes: [], edges: []`), which is still valid JSON.
  while (json.length > DECISION_REVIEW_SECTION_MAX_CHARS && (edges.length > 0 || nodes.length > 0)) {
    const referenced = referencedIds();
    // Reverse scan rather than `findLastIndex` — this project's `lib` predates
    // es2023, and the gate catches it (TS2550) while vitest does not.
    let isolate = -1;
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const id = idOf(nodes[index]);
      if (id === null || !referenced.has(id)) {
        isolate = index;
        break;
      }
    }
    if (isolate >= 0) {
      nodes = nodes.filter((_, index) => index !== isolate);
    } else if (edges.length > 0) {
      edges = edges.slice(0, edges.length - 1);
      const stillReferenced = referencedIds();
      nodes = nodes.filter((node) => {
        const id = idOf(node);
        return id !== null && stillReferenced.has(id);
      });
    } else {
      nodes = nodes.slice(0, nodes.length - 1);
    }
    json = render();
  }

  // ⚠ `additional graph.nodes entries omitted` IS A PINNED PHRASE, and it is
  // pinned in `tools/`, OUTSIDE `src/` — a scoped run of the touched source
  // directories collects none of it and reads green. The denominator is added
  // AROUND the existing wording rather than replacing it, so the disclosure
  // gains information without breaking the contract its readers grep for.
  const notes: string[] = [];
  const droppedNodes = originalNodeCount - nodes.length;
  const droppedEdges = originalEdgeCount - edges.length;
  if (droppedNodes > 0) {
    notes.push(`${droppedNodes} additional graph.nodes entries omitted (of ${originalNodeCount})`);
  }
  if (droppedEdges > 0) {
    notes.push(`${droppedEdges} additional graph.edges entries omitted (of ${originalEdgeCount})`);
  }
  return notes.length > 0 ? `${json}\n[TRUNCATED: ${notes.join('; ')}]` : json;
}

/**
 * Cap a free-text block (the `<BRIEF>` section — user-controlled, no array
 * structure to count-cap) to `maxChars`. Under the cap: no-op (byte-identical
 * for typical/small briefs). Over the cap: hard-slice and disclose via the
 * same `[TRUNCATED: ...]` marker doctrine as `boundedJsonBlock` — never
 * silent.
 */
function boundedTextBlock(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n[TRUNCATED: brief truncated at ${maxChars} chars (hard ceiling), ${omitted} chars omitted]`;
}

/**
 * Distance-to-flip for a flip_threshold_data entry: |flip_value -
 * current_value|. Missing/non-numeric fields sort last (treated as least
 * relevant, not most) so a malformed entry never displaces a well-formed one
 * from the kept set.
 */
function flipDistance(entry: Record<string, unknown>): number {
  const flip = entry['flip_value'];
  const current = entry['current_value'];
  if (typeof flip !== 'number' || typeof current !== 'number' || !Number.isFinite(flip) || !Number.isFinite(current)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(flip - current);
}

// ============================================================================
// User message assembly (identical to route handler's buildUserMessage)
// ============================================================================

export function buildDecisionReviewUserMessage(
  input: DecisionReviewInvokeInput,
  margin: number | null,
): string {
  const sections: string[] = [];

  sections.push('<BRIEF>');
  sections.push(boundedTextBlock(input.brief, DECISION_REVIEW_MAX_BRIEF_CHARS));
  sections.push('</BRIEF>');

  // GRAPH — cap nodes/edges by count (no decision-relevance signal exists
  // for individual nodes/edges at this layer; keep the first N).
  // Relationship-aware, always-parseable bounding — see `boundedGraphJsonBlock`.
  // The independent nodes/edges caps this replaces could retain an edge whose
  // endpoint node had been dropped, and the byte ceiling sliced the JSON string.
  sections.push('<GRAPH>');
  sections.push(boundedGraphJsonBlock(input.graph));
  sections.push('</GRAPH>');

  // ISL_RESULTS — cap factor_sensitivity / fragile_edges / option_comparison,
  // ranking by decision-relevance when truncation is actually needed.
  const islRaw = input.isl_results;
  const factorSensitivityRaw = islRaw['factor_sensitivity'];
  const fragileEdgesRaw = islRaw['fragile_edges'];
  const optionComparisonRaw = islRaw['option_comparison'];

  const factorCap = capArray<Record<string, unknown>>(
    factorSensitivityRaw,
    DECISION_REVIEW_MAX_FACTOR_SENSITIVITY,
    (a, b) => readAbsSortNum(b.elasticity) - readAbsSortNum(a.elasticity),
  );
  const edgeCap = capArray<Record<string, unknown>>(
    fragileEdgesRaw,
    DECISION_REVIEW_MAX_FRAGILE_EDGES,
    (a, b) => readSortNum(b.switch_probability) - readSortNum(a.switch_probability),
  );
  const optionCap = capArray<Record<string, unknown>>(
    optionComparisonRaw,
    DECISION_REVIEW_MAX_OPTION_COMPARISON,
    (a, b) => readSortNum(b.win_probability) - readSortNum(a.win_probability),
  );

  const cappedIslResults: Record<string, unknown> = {
    ...islRaw,
    ...(Array.isArray(factorSensitivityRaw) ? { factor_sensitivity: factorCap.kept } : {}),
    ...(Array.isArray(fragileEdgesRaw) ? { fragile_edges: edgeCap.kept } : {}),
    ...(Array.isArray(optionComparisonRaw) ? { option_comparison: optionCap.kept } : {}),
  };
  const islNotes: string[] = [];
  if (factorCap.droppedCount > 0) {
    islNotes.push(`${factorCap.droppedCount} lower-sensitivity factor_sensitivity entries omitted`);
  }
  if (edgeCap.droppedCount > 0) {
    islNotes.push(`${edgeCap.droppedCount} lower-severity fragile_edges entries omitted`);
  }
  if (optionCap.droppedCount > 0) {
    islNotes.push(`${optionCap.droppedCount} lower-probability option_comparison entries omitted`);
  }

  sections.push('<ISL_RESULTS>');
  sections.push(boundedJsonBlock(cappedIslResults, islNotes));
  sections.push('</ISL_RESULTS>');

  // DETERMINISTIC_COACHING — array-length capping (model_critiques allowlist
  // + count cap) happens upstream at the source
  // (orchestrator-v5/coaching/decision-review-enricher.ts
  // normaliseDeterministicCoachingFromM1, mirroring the evidence_gaps
  // pattern). Here we only apply the hard byte-ceiling backstop, since this
  // block's shape is caller-defined (the HTTP route handler builds its own
  // richer deterministic_coaching) and not always the enricher's output.
  sections.push('<DETERMINISTIC_COACHING>');
  sections.push(boundedJsonBlock(input.deterministic_coaching, []));
  sections.push('</DETERMINISTIC_COACHING>');

  sections.push('<DECISION_CONTEXT>');
  sections.push(`winner: ${JSON.stringify(input.winner)}`);
  if (input.runner_up !== null) {
    sections.push(`runner_up: ${JSON.stringify(input.runner_up)}`);
  } else {
    sections.push('runner_up: null (single-option decision)');
  }
  sections.push(`margin: ${JSON.stringify(margin)}`);
  sections.push('</DECISION_CONTEXT>');

  // D-ask-1 (2.11 P0-1) — P1-2: scaffolded-placeholder disclosure. Emitted
  // ONLY when the run scaffolded at least one option, so non-scaffolded
  // runs assemble a byte-identical message. Free text (already bounded by
  // construction: one short line per scaffolded option + a fixed caveat),
  // guarded by the same hard per-section ceiling as every other block.
  if (typeof input.scaffold_disclosure === 'string' && input.scaffold_disclosure.length > 0) {
    sections.push('<SCAFFOLDED_OPTIONS>');
    sections.push(boundedTextBlock(input.scaffold_disclosure, DECISION_REVIEW_SECTION_MAX_CHARS));
    sections.push('</SCAFFOLDED_OPTIONS>');
  }

  sections.push('<FLIP_THRESHOLD_DATA>');
  if (input.flip_threshold_data && input.flip_threshold_data.length > 0) {
    const flipCap = capArray<Record<string, unknown>>(
      input.flip_threshold_data,
      DECISION_REVIEW_MAX_FLIP_THRESHOLD_ENTRIES,
      (a, b) => flipDistance(a) - flipDistance(b),
    );
    const flipNotes: string[] = [];
    if (flipCap.droppedCount > 0) {
      flipNotes.push(`${flipCap.droppedCount} farther-from-flip flip_threshold_data entries omitted`);
    }
    sections.push(boundedJsonBlock(flipCap.kept, flipNotes));
  } else {
    sections.push('Not available');
  }
  sections.push('</FLIP_THRESHOLD_DATA>');

  return sections.join('\n\n');
}

/**
 * Context v2 S0: rendered char length of one `<TAG>…</TAG>` block inside the
 * assembled user message (tags + body). 0 when the tag is absent. Pure
 * measurement — never touches assembly.
 */
function taggedBlockChars(message: string, tag: string): number {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = message.indexOf(open);
  if (start === -1) return 0;
  const end = message.indexOf(close, start);
  if (end === -1) return 0;
  return end + close.length - start;
}

/**
 * Context v2 S0: the BODY of one `<TAG>…</TAG>` block — the bytes between the
 * tags, trimmed. `null` when the tag is absent (distinct from an empty body,
 * which returns `''`). Pure; the source of truth is the assembled user message
 * itself, so a manifest derived from it describes what was SENT.
 */
function taggedBlockBody(message: string, tag: string): string | null {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = message.indexOf(open);
  if (start === -1) return null;
  const end = message.indexOf(close, start);
  if (end === -1) return null;
  return message.slice(start + open.length, end).trim();
}

// ============================================================================
// Single-shot invocation
// ============================================================================

/**
 * Load the decision_review prompt, call the configured adapter once, and
 * extract the JSON body. Returns `output: null` when JSON extraction fails.
 * Throws only on adapter / transport / timeout errors; caller is expected to
 * catch and decide how to degrade.
 */
export async function invokeDecisionReview(
  input: DecisionReviewInvokeInput,
  options: InvokeDecisionReviewOptions,
): Promise<DecisionReviewInvokeResult> {
  // ONE bound resolution, not two independent reads. `getSystemPrompt` +
  // `getSystemPromptMeta` could disagree: on the transient store-failure path
  // the loader serves hardcoded DEFAULT bytes, deliberately does not cache
  // them, and does not evict the expired store entry — so the separate meta
  // read returned that stale entry and certified a default-bytes brief as
  // "store prompt vN at hash H1". `getSystemPromptSnapshot` builds content and
  // meta from the SAME resolution entry and additionally asserts
  // `entry.promptHash === sha256(content)`, so the identity recorded below
  // describes the bytes actually sent.
  const { content: rawPrompt, meta: promptMeta } = await getSystemPromptSnapshot('decision_review');

  let assembledPrompt = rawPrompt;
  const scienceResult = buildScienceClaimsSection();
  if (scienceResult !== null && !rawPrompt.includes('<SCIENCE_CLAIMS>')) {
    assembledPrompt = injectScienceClaimsSection(rawPrompt, scienceResult.section);
  }

  const margin =
    input.runner_up !== null
      ? input.winner.win_probability - input.runner_up.win_probability
      : null;

  const userMessage = buildDecisionReviewUserMessage(input, margin);

  // RIDER-B: thread an OPTIONAL per-call model override (A/B lever). Absent ⇒
  // EXACTLY `getAdapterWithResolution('decision_review')` (default path
  // byte-identical, no extra positional args); present ⇒ the override resolves
  // as a `per_call` source — measure-a-candidate-arm only, no live default flip.
  const { adapter, resolution } = options.model
    ? getAdapterWithResolution('decision_review', options.model, 'per_call')
    : getAdapterWithResolution('decision_review');
  const configuredMaxTokens = getMaxTokensFromConfig('decision_review');
  const maxTokens = configuredMaxTokens ?? 4096;

  const callOpts: CallOpts = {
    requestId: options.requestId,
    timeoutMs: options.timeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
  };

  const llmResult = await adapter.chat(
    {
      system: assembledPrompt,
      userMessage,
      temperature: 0,
      maxTokens,
      responseFormat: 'json_object',
    },
    callOpts,
  );

  // Context v2 S0 (ROADMAP 1.73, 03 §2): once per LLM call at this adapter
  // boundary. Section chars are measured over the tag-delimited blocks the
  // builder just assembled — no change to message assembly itself. The
  // `graph_json` / `isl_results` / `brief` names line up with the 03 §1
  // decision_review budget table (implemented later by the Program-C
  // rewrite lane; S0 only measures).
  emitContextBudget({
    call_site: 'decision_review',
    model: llmResult.model ?? null,
    prompt_version: promptMeta.prompt_version != null ? String(promptMeta.prompt_version) : null,
    prompt_hash: promptMeta.prompt_hash ?? null,
    request_id: options.requestId,
    scenario_id: null, // scenario identity is not part of this input contract
    section_chars: {
      brief: taggedBlockChars(userMessage, 'BRIEF'),
      graph_json: taggedBlockChars(userMessage, 'GRAPH'),
      isl_results: taggedBlockChars(userMessage, 'ISL_RESULTS'),
      deterministic_coaching: taggedBlockChars(userMessage, 'DETERMINISTIC_COACHING'),
      decision_context: taggedBlockChars(userMessage, 'DECISION_CONTEXT'),
      flip_threshold_data: taggedBlockChars(userMessage, 'FLIP_THRESHOLD_DATA'),
    },
    // CONTENT MANIFEST. `graph_json: 21` was a real staging reading meaning
    // "no graph reached the reviewing model", and it took arithmetic over three
    // hypothetical renderings to establish that (enricher docs, :121-134). Read
    // straight off the assembled message, so it describes the SENT bytes.
    section_shape: {
      graph_json: jsonStructureManifest(taggedBlockBody(userMessage, 'GRAPH')),
    },
    total_chars: userMessage.length,
    truncations: [],
    summary_lag_turns: null, // S4-inject is routing-only; this site has no summary layer yet
    ui_narrowed: null,
    usage: llmResult.usage,
  });

  const extraction = extractJsonFromResponse(llmResult.content, {
    task: 'decision_review',
    model: llmResult.model,
    correlationId: options.requestId,
  });

  const parsed =
    extraction.json && typeof extraction.json === 'object' && !Array.isArray(extraction.json)
      ? (extraction.json as Record<string, unknown>)
      : null;

  return {
    output: parsed,
    raw: llmResult.content,
    model: llmResult.model,
    provider: adapter.name,
    llm_latency_ms: llmResult.latencyMs,
    input_tokens: llmResult.usage.input_tokens,
    output_tokens: llmResult.usage.output_tokens,
    prompt_version: promptMeta.prompt_version,
    prompt_hash: promptMeta.prompt_hash,
    prompt_source: promptMeta.source,
    resolution,
  };
}
