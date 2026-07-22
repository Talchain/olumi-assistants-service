/**
 * V5 Phase 3 block builders — Analysis tab data contract v1.3.
 *
 * Pure functions that decompose a `RunAnalysisHandlerFact`'s
 * `result.enrichment.decision_review` (the verbatim v11 LLM output from
 * the decision_review enricher) into typed `ReviewCardBlock` /
 * `CoachingBlock` / `EvidenceBlock` instances per v1.3 §1.1–§1.3.
 *
 * Source of truth: `Docs/v5/v5-analysis-tab-data-contract-v1_3.md`
 * (CEE PR #177, SHA-256 `2490512…`).
 *
 * Authoritative input shape (v11 LLM output schema per
 * `src/prompts/defaults.ts` OUTPUT_SCHEMA lines 1490-1518):
 *
 *   {
 *     narrative_summary: string,
 *     story_headlines: Record<option_id, string>,
 *     robustness_explanation: { summary, primary_risk,
 *                              stability_factors[], fragility_factors[] },
 *     readiness_rationale: string,
 *     evidence_enhancements: Record<factor_id,
 *       { specific_action, rationale, evidence_type, decision_hygiene }>,
 *     scenario_contexts: Record<edge_id,
 *       { trigger_description, consequence }>,
 *     flip_thresholds: Array<{ factor_id, factor_label, current_display,
 *                             flip_display, narrative }>,
 *     bias_findings: Array<{ type, source, description,
 *                            affected_elements[], suggested_action,
 *                            linked_critique_code? | brief_evidence? }>,
 *     key_assumptions: string[],
 *     decision_quality_prompts: Array<{ question, principle,
 *                                       applies_because }>,
 *     pre_mortem?: { failure_scenario, warning_signs[], mitigation,
 *                    grounded_in[], review_trigger? },
 *     framing_check?: { addresses_goal, concern?, suggested_reframe? },
 *     produced_at: ISO 8601 (V5-added),
 *   }
 *
 * **No new LLM call.** Every emitted block sources from existing
 * enrichment.decision_review fields. Per-factor confidence for
 * EvidenceBlock derives from the PLoT-provided
 * `enrichment.factor_sensitivity[].confidence`, NOT from decision_review
 * (which has no confidence field) — v11 does not expose calibrated
 * per-factor confidence inside decision_review. Documented at the
 * derivation call site below.
 *
 * Invariants:
 *   - Every emitted block is `safeParse`-validated against the
 *     `@talchain/schemas@0.13.0` schema before being added to the
 *     response. Validation failures DROP the block (never weaken the
 *     schema, never emit a partial / filler block).
 *   - Target ref ID-to-label resolution drops on miss (never falls
 *     back to `id`-as-label; that would leak IDs into user-facing
 *     prose per §0.1).
 *   - `signal_id` is deterministic per (block_kind, source-key,
 *     graph_hash) so the Analysis tab can dedupe across hero / lower
 *     sections per §0.3.
 *   - `freshness: 'fresh'` is the only value emitted by PR 2 — the
 *     enricher only runs on the current-turn fact, which is fresh by
 *     construction. PR 3 owns persistence-by-graph-hash and
 *     stale/invalidation rendering.
 *   - Copy-length proactive truncation (title ≤ 80, body ≤ 300,
 *     action_label ≤ 40) at the boundary in addition to Zod
 *     enforcement.
 */

import { z } from 'zod';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import {
  ReviewCardBlockSchema,
  CoachingBlockSchema,
  EvidenceBlockSchema,
  type ActionIntentLiteral,
  type CoachingBlock,
  type EvidenceBlock,
  type Phase3BlockSeverityLiteral,
  type ReviewCardBlock,
  type TargetRef,
  type TargetRefKindLiteral,
} from '@talchain/schemas/boundary';

import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import { ENTITY_ID_LEAK_RE } from '../../orchestrator/shared/entity-id-pattern.js';
import { isSlugShapedEntityId } from '../../orchestrator/shared/output-safety.js';
import { bandConfidence } from './confidence-bands.js';
import { deterministicBlockId } from './block-id.js';
import { selectLens } from './lens-selector.js';
import { findForbiddenPhraseHit } from './forbidden-user-facing-phrases.js';
import { applyTerminologyRewrite } from './terminology-rewrite.js';
import {
  evidenceSignals,
  guidanceSignalsForCoachingKind,
  reviewCardSignals,
} from './guidance-signals.js';

const SOURCE_HANDLER = 'decision_review_enricher';

const TITLE_MAX = 80;
const BODY_MAX = 300;
const ACTION_LABEL_MAX = 40;
const TECHNIQUE_MAX = 300;

// Round-4 review: defence-in-depth prose guard. Each Phase 3 block carries
// LLM-authored prose in user-facing fields; the output-safety layer scrubs
// entity-ID-shaped tokens at the wire, but Phase 3 drops at the source so
// the block never reaches the wire to be scrubbed.
//
// Entity-ID detection uses the SHARED ENTITY_ID_LEAK_RE
// (`src/orchestrator/shared/entity-id-pattern.ts`) plus
// `isSlugShapedEntityId` for the English-compound confirmation gate.
// This keeps the Phase 3 source guard in lockstep with the egress
// scrub — adding a prefix in one place automatically covers Phase 3
// (`fac_`, `opt_`, `con_`, `out_`, etc. — all in scope). Reusing the
// shared detector closes the round-4 P1 finding (local regex missed
// the `fac_/con_/out_` short prefixes).
//
// `RAW_DECIMAL_RE` is intentionally narrow: leading `0.\d` or `.\d`
// only. "v1.3", "1.5x", "10.5%" do NOT match (no leading zero/dot
// pattern).
//
// Banned recommendation/winner language is sourced from the central
// `FORBIDDEN_USER_FACING_PHRASES` list via `findForbiddenPhraseHit`.
// RC4: for the REWRITABLE prescriptive-lexicon subset the remedy is a
// deterministic terminology substitution, not a drop — see
// `validateProseAndSchemaOrDrop`.
const RAW_DECIMAL_RE = /(?:^|[\s(=,])(?:0\.\d|\.\d)/;

// ============================================================================
// Doctrine D-U F2 — option-set lever suppression on "investigate this" surfaces
// ============================================================================

/**
 * Shared empty set for the default (no-lever-set) call — keeps the
 * lever-unaware callers byte-identical and avoids allocating a set per call.
 */
const EMPTY_FACTOR_ID_SET: ReadonlySet<string> = new Set<string>();

/**
 * Doctrine D-U F2: is this evidence-gap factor an option-set LEVER? Authority
 * is STRUCTURAL `factor_id` membership in the intervention-controlled (union-
 * lever) set only — never the label (labels collide) — mirroring
 * `intervention-controlled-drivers.isInterventionControlledDriver`. An empty
 * set (the default) suppresses nothing, so lever-unaware callers are unchanged.
 */
function isLeverFactor(
  factorId: string,
  interventionControlledFactorIds: ReadonlySet<string>,
): boolean {
  if (interventionControlledFactorIds.size === 0) return false;
  const id = factorId.trim();
  return id.length > 0 && interventionControlledFactorIds.has(id);
}

/**
 * Minimum lever-label length used for the NAMING scan below. A 1–2 char label
 * (an unlabelled or degenerate node) would over-match arbitrary prose, so it is
 * ignored for detection — structural membership (`isLeverFactor`) is unaffected.
 * The length is measured on the NORMALISED, punctuation-stripped label so a
 * label like `"C#"` (one letter after normalisation) is treated as too short.
 */
const LEVER_LABEL_MIN_LEN = 3;

/**
 * Finding 5 (over-suppression): generic single-word lever labels that collide
 * with ordinary decision prose. A lever whose WHOLE label normalises to just
 * one of these bare words ("Cost", "Time") cannot be distinguished from
 * incidental use of the word in a NON-lever assumption ("Implementation cost
 * estimates are uncertain"), so the free-text NAME scan refuses to suppress on
 * such a label alone — stronger identity (a multi-word phrase, or a distinctive
 * single word) is required. This is a fail-closed choice: err toward keeping an
 * honest surface over silently dropping it on a weak-identity match. STRUCTURAL
 * factor_id suppression (`isLeverFactor`, used by the evidence surfaces) is
 * unaffected — this guard only tempers label-based detection in free text.
 */
const GENERIC_LEVER_TOKENS: ReadonlySet<string> = new Set([
  'cost', 'costs', 'time', 'price', 'prices', 'value', 'values', 'risk',
  'risks', 'quality', 'revenue', 'budget', 'scope', 'speed', 'effort',
  'resource', 'resources', 'team', 'size', 'rate', 'growth', 'demand',
  'supply', 'margin', 'profit', 'sales', 'people', 'timeline', 'timelines',
]);

/**
 * Finding 5 (under-suppression + Unicode): normalise a label / free-text body
 * for whole-phrase matching. NFKC folds Unicode compatibility forms (curly
 * apostrophes, full-width chars, non-breaking spaces); lower-casing folds case;
 * every run of non-letter/non-number is collapsed to a single space so
 * punctuation cannot block a match — `"Time-to-market"` and `"Time to market"`
 * both normalise to `"time to market"`. Result is trimmed; interior words are
 * single-space separated.
 */
function normaliseForPhraseMatch(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Doctrine D-U F2 (assumption surface): resolve the option-set LEVER factor_ids
 * to their canonical graph LABELS. The `key_assumptions` / `assumption_check`
 * surface is FREE TEXT the enrichment emits with NO factor_id, so a lever can
 * only be detected there by the NAME it is given — the label. MEMBERSHIP stays
 * STRUCTURAL (factor_id in the union set, resolved via the same lookup every
 * builder trusts); the label is used ONLY to find the naming, never to decide
 * lever membership. Empty set / unresolved / too-short labels ⇒ no labels ⇒
 * suppress nothing. No producer number is read.
 */
function collectLeverLabels(
  interventionControlledFactorIds: ReadonlySet<string>,
  lookup: GraphNodeLookup,
): readonly string[] {
  if (interventionControlledFactorIds.size === 0) return [];
  const labels: string[] = [];
  for (const id of interventionControlledFactorIds) {
    const ref = lookup.get(id.trim());
    if (ref === undefined || ref.kind !== 'factor') continue;
    const label = ref.label.trim();
    // Length is measured on the NORMALISED form so a punctuation-only or 1–2
    // letter label ("C#", "AI") is dropped from the naming scan.
    if (normaliseForPhraseMatch(label).length >= LEVER_LABEL_MIN_LEN) {
      labels.push(label);
    }
  }
  return labels;
}

/**
 * Whole-phrase containment with letter/number word boundaries on BOTH ends.
 * Both arguments are expected to be pre-normalised via `normaliseForPhraseMatch`
 * (so only Unicode letters/numbers and single spaces remain). Scans every
 * occurrence so a first boundary-failing hit cannot mask a later valid one. A
 * bare shared token must NOT match — on live staging the lever "Equity Offered
 * to CTO" and a non-lever assumption both contain "CTO", so a token match would
 * over-suppress. Boundaries use the Unicode letter/number classes so accented
 * words ("café") are bounded correctly.
 */
function containsWholePhrase(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : haystack[at - 1]!;
    const afterIdx = at + needle.length;
    const after = afterIdx >= haystack.length ? '' : haystack[afterIdx]!;
    const boundedBefore = before === '' || !/[\p{L}\p{N}]/u.test(before);
    const boundedAfter = after === '' || !/[\p{L}\p{N}]/u.test(after);
    if (boundedBefore && boundedAfter) return true;
    from = at + 1;
  }
}

/**
 * Doctrine D-U F2: does this free-text prose NAME an option-set lever? True when
 * the body contains a lever's whole label as a bounded phrase (after Unicode +
 * punctuation normalisation, so "Time-to-market" matches "Time to market").
 * Empty label set (the default) ⇒ never suppresses (byte-identical). A bare
 * generic single-word label ("Cost") is skipped (Finding 5 over-suppression) —
 * stronger identity is required. Display-only: no producer value is read;
 * membership is the structural lever set. Used across every free-text
 * decision-review surface (narrative, pre-mortem, scenario, assumption,
 * calibration) so a lever is never NAMED as an uncertainty on any of them.
 */
function proseNamesLever(
  text: string,
  leverLabels: readonly string[],
): boolean {
  if (leverLabels.length === 0) return false;
  const hay = normaliseForPhraseMatch(text);
  if (hay.length === 0) return false;
  for (const label of leverLabels) {
    const needle = normaliseForPhraseMatch(label);
    if (needle.length < LEVER_LABEL_MIN_LEN) continue;
    // Finding 5: a bare generic single word ("cost") over-matches ordinary
    // decision prose. Require a multi-word (space-containing) phrase before
    // suppressing on a generic token — a distinctive single word ("Kubernetes")
    // still suppresses.
    if (!needle.includes(' ') && GENERIC_LEVER_TOKENS.has(needle)) continue;
    if (containsWholePhrase(hay, needle)) return true;
  }
  return false;
}

// ============================================================================
// Public API
// ============================================================================

export interface BlockBuildCtx {
  /** ISO 8601 timestamp with offset. Stamped onto every emitted block. */
  readonly created_at: string;
  /** Graph hash from `fact.result.graph_hash_at_run` — passes through to
   *  `graph_hash_at_generation` on every analysis-derived block. */
  readonly graph_hash_at_generation: string;
  /**
   * V5 Phase 3A PR 3 — block lifecycle freshness label. Defaults to
   * `'fresh'` when omitted (PR #178/180 behaviour: only fresh blocks
   * emitted from current-turn run_analysis facts). PR 3 sets this to
   * `'stale'` when the source fact's graph hash differs from the
   * current scenario graph hash, signalling to the UI that the block
   * is reused from a prior analysis whose underlying graph has since
   * changed. The `'pending'` and `'failed'` enum values are reserved
   * for in-flight generation states and are not used by the
   * deterministic composer.
   */
  readonly freshness?: 'fresh' | 'stale';
}

export interface GraphNodeRef {
  readonly id: string;
  readonly label: string;
  readonly kind: TargetRefKindLiteral;
}

/** factor_id → {id, label, kind} resolved from `enrichment.graph.nodes[]`. */
export type GraphNodeLookup = ReadonlyMap<string, GraphNodeRef>;

/**
 * Build a lookup table from `fact.result.enrichment.graph.{nodes,edges}[]`
 * for ID-to-label-and-kind resolution, falling back to the persisted
 * scenario snapshot graph when the enrichment source is absent or empty.
 * Defensive: skips nodes/edges missing required fields and skips nodes
 * whose `kind` is outside the v1.3 `TargetRefKind` union.
 *
 * R4 lookup fix (live-verified at deployed build 441dc0d): the PLoT
 * /v2/run envelope stored byte-for-byte as `fact.result.enrichment`
 * (run-analysis.ts) has NO top-level `graph` key, so the enrichment
 * source yields ZERO entries on every production run — every Phase 3
 * block shipped `target_refs: []` (or dropped at its fail-closed lookup
 * gate) and the flag-gated ui_directive emitter could never resolve its
 * option target. `fallbackGraph` is the persisted graph CEE already
 * holds for the turn (`EnrichedTurnContext.persistedGraph` /
 * `RunAnalysisScenarioSnapshot.rawPersistedGraph` — the canvas/CEE shape:
 * nodes with id/kind/label, edges with `from`/`to`). It is consulted
 * ONLY when the enrichment graph produced no entries; a present,
 * non-empty enrichment graph stays authoritative. Non-TargetRefKind
 * node kinds in the persisted shape (`action`, `decision`) are skipped
 * by the same `isTargetRefKind` gate. With neither source the lookup is
 * empty and every consumer fails closed exactly as before.
 *
 * Edge handling (round-4 review non-blocking follow-up): edges live under
 * `graph.edges[]` with `id`, endpoint ids (`from_node_id`/`to_node_id` in
 * the enrichment shape, `from`/`to` in the persisted shape), and
 * optionally `label`. When `label` is missing, derive a human-readable
 * label from the endpoint node labels as `"<from> → <to>"`. When
 * endpoints can't be resolved (graph drift), skip the edge — the
 * resulting scenario_context card will drop downstream rather than emit
 * an unresolved edge reference.
 */
export function buildGraphNodeLookup(
  fact: RunAnalysisHandlerFact,
  fallbackGraph?: unknown,
): GraphNodeLookup {
  const lookup = new Map<string, GraphNodeRef>();
  const enrichment = readRecord(
    (fact.result as Record<string, unknown>).enrichment,
  );
  const enrichmentGraph = enrichment === null ? null : readRecord(enrichment.graph);
  if (enrichmentGraph !== null) {
    populateGraphNodeLookup(lookup, enrichmentGraph);
  }
  if (lookup.size > 0) return lookup;

  const fallback = readRecord(fallbackGraph);
  if (fallback !== null) {
    populateGraphNodeLookup(lookup, fallback);
  }
  return lookup;
}

/**
 * Populate `lookup` from a `{nodes[], edges[]}` graph record. Shared by
 * the enrichment source and the persisted-snapshot fallback — the two
 * shapes differ only in the edge endpoint field names, which are read
 * permissively here (`from_node_id`/`to_node_id` first, then `from`/`to`).
 */
function populateGraphNodeLookup(
  lookup: Map<string, GraphNodeRef>,
  graph: Record<string, unknown>,
): void {
  // Pass 1: nodes. Required for both node lookups AND edge label
  // derivation.
  const nodes = graph.nodes;
  if (Array.isArray(nodes)) {
    for (const raw of nodes) {
      const n = readRecord(raw);
      if (n === null) continue;
      const id = typeof n.id === 'string' ? n.id : null;
      const label = typeof n.label === 'string' ? n.label : null;
      const kind = typeof n.kind === 'string' ? n.kind : null;
      if (id === null || label === null || kind === null) continue;
      if (!isTargetRefKind(kind)) continue;
      lookup.set(id, { id, label, kind });
    }
  }

  // Pass 2: edges. Round-4 non-blocking follow-up — edges live under
  // `graph.edges[]`, not as `kind: 'edge'` entries in `graph.nodes[]`.
  // Without this pass, every scenario_context card would drop (the
  // round-3 fail-closed gate is correct; the lookup just needed to be
  // wider).
  const edges = graph.edges;
  if (Array.isArray(edges)) {
    for (const raw of edges) {
      const e = readRecord(raw);
      if (e === null) continue;
      const id = typeof e.id === 'string' ? e.id : null;
      if (id === null) continue;
      const explicitLabel = typeof e.label === 'string' && e.label.length > 0
        ? e.label
        : null;
      if (explicitLabel !== null) {
        lookup.set(id, { id, label: explicitLabel, kind: 'edge' });
        continue;
      }
      // Derive `from → to` from canonical endpoint node labels. Skip if
      // either endpoint isn't in the node lookup (graph drift). Endpoint
      // ids: `from_node_id`/`to_node_id` (enrichment shape) or `from`/`to`
      // (persisted GraphStateIngress shape).
      const fromId = typeof e.from_node_id === 'string' ? e.from_node_id
        : typeof e.from === 'string' ? e.from
        : null;
      const toId = typeof e.to_node_id === 'string' ? e.to_node_id
        : typeof e.to === 'string' ? e.to
        : null;
      if (fromId === null || toId === null) continue;
      const fromRef = lookup.get(fromId);
      const toRef = lookup.get(toId);
      if (fromRef === undefined || toRef === undefined) continue;
      lookup.set(id, {
        id,
        label: `${fromRef.label} → ${toRef.label}`,
        kind: 'edge',
      });
    }
  }
}

/**
 * Build a factor_id → confidence-band lookup from
 * `enrichment.factor_sensitivity[].confidence` (the PLoT-provided
 * value). v11 `decision_review` does NOT expose per-entry calibrated
 * confidence inside `evidence_enhancements`; this is the only real
 * source today.
 *
 * Mapping: `≥ 0.7` → `'high'`; `≥ 0.3 && < 0.7` → `'medium'`;
 * `< 0.3` → `'low'`.
 *
 * Missing / null / non-finite confidence is **omitted from the
 * lookup** (round-2 review correction). The contract test
 * [`decision-review-enricher.contract.test.ts:321`] explicitly proves
 * `confidence` can be absent in real PLoT envelopes — silently
 * defaulting every such factor to `'low'` would mislabel
 * EvidenceBlocks with `severity: critical/warning` based on a
 * fabricated band. Callers MUST treat a lookup miss as "confidence
 * unknown" and fail-closed (EvidenceBlock drops the entry).
 *
 * Future upgrade path: when v12 / ISL enrichment exposes a calibrated
 * per-factor confidence inside `evidence_enhancements` directly, this
 * derivation can be relaxed (or the lookup can fold in the new
 * source). Until then, EvidenceBlock emission is gated on a real
 * PLoT-provided confidence signal.
 */
export function buildFactorConfidenceLookup(
  fact: RunAnalysisHandlerFact,
): ReadonlyMap<string, 'high' | 'medium' | 'low'> {
  const out = new Map<string, 'high' | 'medium' | 'low'>();
  const enrichment = readRecord(
    (fact.result as Record<string, unknown>).enrichment,
  );
  if (enrichment === null) return out;
  const fs = enrichment.factor_sensitivity;
  if (!Array.isArray(fs)) return out;
  for (const raw of fs) {
    const e = readRecord(raw);
    if (e === null) continue;
    const factorId = typeof e.factor_id === 'string' ? e.factor_id
      : typeof e.node_id === 'string' ? e.node_id
      : typeof e.id === 'string' ? e.id
      : null;
    if (factorId === null) continue;
    // Banding is derived from the SHARED `bandConfidence` (confidence-bands.ts)
    // so the evidence-block band and the lens selector's `'low confidence'`
    // trigger can never silently diverge (anti-mirror). A non-finite / absent
    // confidence returns null → omit: the caller treats missing as "confidence
    // unknown" and drops the EvidenceBlock entirely. NEVER silently default to
    // a band that would mislabel severity.
    const band = bandConfidence(e.confidence);
    if (band === null) continue;
    out.set(factorId, band);
  }
  return out;
}

/** Reads `enrichment.decision_review` defensively; returns `null` when
 *  absent / not an object. */
export function readDecisionReview(
  fact: RunAnalysisHandlerFact,
): Record<string, unknown> | null {
  const enrichment = readRecord(
    (fact.result as Record<string, unknown>).enrichment,
  );
  if (enrichment === null) return null;
  return readRecord(enrichment.decision_review);
}

/**
 * Build all Phase 3 ReviewCardBlocks from a fresh `decision_review`
 * enrichment. Returns `[]` when no enrichment is present. Each emitted
 * block is `BlockSchema`-validated; failures DROP the block.
 */
export function buildReviewCardBlocks(
  fact: RunAnalysisHandlerFact,
  lookup: GraphNodeLookup,
  ctx: BlockBuildCtx,
  interventionControlledFactorIds: ReadonlySet<string> = EMPTY_FACTOR_ID_SET,
): readonly ReviewCardBlock[] {
  const dr = readDecisionReview(fact);
  if (dr === null) return [];
  const blocks: ReviewCardBlock[] = [];
  // Doctrine D-U F2 / Finding 1: lever labels for EVERY free-text surface
  // (structural membership resolved to labels via the shared lookup). Computed
  // once and threaded into the free-text builders so a lever is never NAMED as
  // an uncertainty on any of them. Empty ⇒ suppress nothing (byte-identical).
  const leverLabels = collectLeverLabels(interventionControlledFactorIds, lookup);

  // narrative (rank 1) — free-text prose; Finding 1 lever-naming guard applies.
  const narrative = buildNarrativeCard(dr, ctx, leverLabels);
  if (narrative !== null) blocks.push(narrative);

  // pre_mortem (rank 2) — optional in the LLM output; free-text failure prose.
  const preMortem = buildPreMortemCard(dr, lookup, ctx, leverLabels);
  if (preMortem !== null) blocks.push(preMortem);

  // flip_threshold (rank 3) — one per entry; within-kind sub-rank by order
  blocks.push(...buildFlipThresholdCards(dr, lookup, ctx));

  // bias (rank 4) — one per finding
  blocks.push(...buildBiasCards(dr, lookup, ctx));

  // robustness (rank 5)
  const robustness = buildRobustnessCard(dr, ctx);
  if (robustness !== null) blocks.push(robustness);

  // evidence_priority (rank 6) — top-1 of evidence_enhancements; the rest
  // ride as EvidenceBlocks (not ReviewCards). One review card per fact.
  const evidencePriority = buildEvidencePriorityCard(
    dr,
    lookup,
    ctx,
    interventionControlledFactorIds,
  );
  if (evidencePriority !== null) blocks.push(evidencePriority);

  // assumption (rank 7) — one per key_assumptions string. D-U F2: a
  // free-text assumption that NAMES an option-set lever is dropped (the
  // channel stays open; non-lever assumptions still ship).
  blocks.push(...buildAssumptionCards(dr, ctx, leverLabels));

  // scenario_context (rank 8) — one per edge; free-text trigger/consequence
  // prose gets the Finding 1 lever-naming guard.
  blocks.push(...buildScenarioContextCards(dr, lookup, ctx, leverLabels));

  return blocks;
}

/**
 * Build all Phase 3 CoachingBlocks from a fresh `decision_review`
 * enrichment. v11 decision_review sources only `assumption_check` and
 * `calibration_prompt` coaching kinds; the four draft_graph-sourced
 * kinds (`orientation` / `widening` / `bias_signal` / `strengthen`)
 * stay out of PR 2 scope and are reserved for the draft_graph
 * coaching sidecar wiring (separate workstream).
 */
export function buildCoachingBlocks(
  fact: RunAnalysisHandlerFact,
  lookup: GraphNodeLookup,
  ctx: BlockBuildCtx,
  interventionControlledFactorIds: ReadonlySet<string> = EMPTY_FACTOR_ID_SET,
): readonly CoachingBlock[] {
  const dr = readDecisionReview(fact);
  if (dr === null) return [];
  const blocks: CoachingBlock[] = [];
  // Doctrine D-U F2 / Finding 1: lever labels for the free-text coaching
  // surfaces (structural membership resolved to labels via the shared lookup).
  // Empty ⇒ suppress nothing. Threaded into BOTH the assumption_check and the
  // calibration_prompt branches so a lever is never NAMED as an assumption to
  // confirm nor as a calibration question to answer.
  const leverLabels = collectLeverLabels(interventionControlledFactorIds, lookup);

  // assumption_check — one per key_assumptions entry, ranked by order.
  if (Array.isArray(dr.key_assumptions)) {
    let idx = 0;
    for (const raw of dr.key_assumptions) {
      if (typeof raw !== 'string') continue;
      const text = raw.trim();
      if (text.length === 0) continue;
      // Doctrine D-U F2: never NAME an option-set lever as an assumption to
      // confirm. Skip before the index bump so survivors stay contiguous.
      if (proseNamesLever(text, leverLabels)) continue;
      idx++;
      const candidate = {
        ...commonMetadata('coach:assumption', String(idx), ctx),
        type: 'coaching' as const,
        coaching_kind: 'assumption_check' as const,
        title: truncate('An assumption to check', TITLE_MAX),
        body: truncate(text, BODY_MAX),
        source: 'decision_review' as const,
        target_refs: [] as readonly TargetRef[],
        priority_rank: 100 + idx, // coaching ranks deprioritised vs review cards
        // Wave-2 ask 1 (0.19.0): producer-owned guidance signals.
        ...guidanceSignalsForCoachingKind('assumption_check'),
        action_intent: 'confirm_factor' as ActionIntentLiteral,
        action_label: truncate('Confirm this assumption', ACTION_LABEL_MAX),
      };
      const block = validateProseAndSchemaOrDrop(CoachingBlockSchema, candidate, {
        block_type: 'coaching',
        kind: 'assumption_check',
        prose: [
          { name: 'title', value: candidate.title },
          { name: 'body', value: candidate.body },
          { name: 'action_label', value: candidate.action_label },
        ],
      });
      if (block !== null) blocks.push(block);
    }
  }

  // calibration_prompt — one per decision_quality_prompts entry.
  if (Array.isArray(dr.decision_quality_prompts)) {
    let idx = 0;
    for (const raw of dr.decision_quality_prompts) {
      const e = readRecord(raw);
      if (e === null) continue;
      const question = typeof e.question === 'string' ? e.question.trim() : '';
      const principle = typeof e.principle === 'string' ? e.principle.trim() : '';
      if (question.length === 0) continue;
      // Doctrine D-U F2 / Finding 1: a calibration question that NAMES an
      // option-set lever is dropped — a lever is a decision variable being SET,
      // not an uncertainty to calibrate. Skip before the index bump so
      // survivors stay contiguous (empty labels ⇒ suppress nothing).
      if (proseNamesLever(question, leverLabels)) continue;
      idx++;
      const titleText = principle.length > 0
        ? `${principle} prompt`
        : 'Calibration prompt';
      const candidate = {
        ...commonMetadata('coach:calibration', String(idx), ctx),
        type: 'coaching' as const,
        coaching_kind: 'calibration_prompt' as const,
        title: truncate(titleText, TITLE_MAX),
        body: truncate(question, BODY_MAX),
        source: 'decision_review' as const,
        target_refs: [] as readonly TargetRef[],
        priority_rank: 200 + idx,
        ...guidanceSignalsForCoachingKind('calibration_prompt'),
        action_intent: 'start_guided_chat' as ActionIntentLiteral,
        action_label: truncate('Try this prompt', ACTION_LABEL_MAX),
      };
      const block = validateProseAndSchemaOrDrop(CoachingBlockSchema, candidate, {
        block_type: 'coaching',
        kind: 'calibration_prompt',
        prose: [
          { name: 'title', value: candidate.title },
          { name: 'body', value: candidate.body },
          { name: 'action_label', value: candidate.action_label },
        ],
      });
      if (block !== null) blocks.push(block);
    }
  }

  return blocks;
}

/**
 * Build all Phase 3 EvidenceBlocks from a fresh `decision_review`
 * enrichment. One block per top-N `evidence_enhancements` entry (ranked
 * by the LLM's emission order — the spec says "cover at least the 3
 * evidence_gaps with highest voi" so emission order ≈ voi rank).
 *
 * factor_ref + target_refs primary entry resolved via lookup; on miss
 * the block is DROPPED rather than emitting `id`-as-label (per §0.1).
 * `current_confidence` derived from
 * `enrichment.factor_sensitivity[].confidence` per the
 * `confidenceLookup` argument.
 */
export function buildEvidenceBlocks(
  fact: RunAnalysisHandlerFact,
  lookup: GraphNodeLookup,
  confidenceLookup: ReadonlyMap<string, 'high' | 'medium' | 'low'>,
  ctx: BlockBuildCtx,
  interventionControlledFactorIds: ReadonlySet<string> = EMPTY_FACTOR_ID_SET,
): readonly EvidenceBlock[] {
  const dr = readDecisionReview(fact);
  if (dr === null) return [];
  const enhancements = readRecord(dr.evidence_enhancements);
  if (enhancements === null) return [];

  const blocks: EvidenceBlock[] = [];
  let rank = 0;
  for (const [factorId, rawEntry] of Object.entries(enhancements)) {
    const entry = readRecord(rawEntry);
    if (entry === null) continue;

    // Doctrine D-U F2: an option-set LEVER is a decision variable, not an
    // uncertain factor to gather evidence about — never NAME it in an
    // "investigate / strengthen this evidence" block. Drop the entry (the
    // channel stays open: non-lever gaps below still ship and re-rank). No
    // producer value is read; membership is structural factor_id only.
    if (isLeverFactor(factorId, interventionControlledFactorIds)) continue;

    const factorRef = lookup.get(factorId);
    if (factorRef === undefined || factorRef.kind !== 'factor') {
      // §1.3: factor_ref must match a factor entry in target_refs.
      // Drop rather than emit unresolved or wrong-kind.
      continue;
    }

    const specificAction = typeof entry.specific_action === 'string'
      ? entry.specific_action.trim()
      : '';
    if (specificAction.length === 0) {
      // Codex correction #2: drop the block rather than emit awkward
      // filler when the actionable verb is missing.
      continue;
    }

    const rationale = typeof entry.rationale === 'string'
      ? entry.rationale.trim()
      : '';
    if (rationale.length === 0) continue;

    const impact = typeof entry.decision_hygiene === 'string'
      ? entry.decision_hygiene.trim()
      : '';
    if (impact.length === 0) continue;

    const evidenceType = typeof entry.evidence_type === 'string'
      ? entry.evidence_type.trim()
      : '';

    const suggestedTechnique = formatSuggestedTechnique(
      evidenceType,
      specificAction,
    );
    if (suggestedTechnique === null) continue;

    // Round-2 review correction: drop the EvidenceBlock entirely when
    // PLoT confidence is unavailable for this factor. v11 decision_review
    // does not expose calibrated confidence inside evidence_enhancements,
    // and the `factor_sensitivity[].confidence` field is OPTIONAL per the
    // contract test at `decision-review-enricher.contract.test.ts:321`.
    // Without a real signal, any band we assigned would silently mislabel
    // the block (e.g. 'low' → severity critical/warning). The evidence-
    // gap insight still surfaces via the `evidence_priority`
    // ReviewCardBlock (which has no current_confidence field).
    const currentConfidence = confidenceLookup.get(factorId);
    if (currentConfidence === undefined) continue;
    rank++;

    // Severity per the deterministic scheme: low confidence + top-1 →
    // critical; low confidence otherwise → warning; else info.
    let severity: Phase3BlockSeverityLiteral = 'info';
    if (currentConfidence === 'low') {
      severity = rank === 1 ? 'critical' : 'warning';
    }

    const candidate = {
      ...commonMetadata('evidence', factorId, ctx),
      type: 'evidence' as const,
      factor_label: factorRef.label,
      factor_ref: { id: factorRef.id, label: factorRef.label, kind: 'factor' as const },
      target_refs: [{ id: factorRef.id, label: factorRef.label, kind: 'factor' as const }],
      current_confidence: currentConfidence,
      evidence_gap: truncate(rationale, BODY_MAX),
      suggested_technique: suggestedTechnique,
      impact_if_gathered: truncate(impact, BODY_MAX),
      priority_rank: rank,
      // Wave-2 ask 1 (0.19.0) + 1.120 residual (0.21.0): severity + derived
      // category/priority + the evidence signal_code from one argument, so they
      // can never disagree.
      ...evidenceSignals(severity),
      action_intent: 'gather_evidence' as ActionIntentLiteral,
      action_label: truncate('Strengthen this evidence', ACTION_LABEL_MAX),
    };
    const block = validateProseAndSchemaOrDrop(EvidenceBlockSchema, candidate, {
      block_type: 'evidence',
      prose: [
        { name: 'factor_label', value: candidate.factor_label },
        { name: 'evidence_gap', value: candidate.evidence_gap },
        { name: 'suggested_technique', value: candidate.suggested_technique },
        { name: 'impact_if_gathered', value: candidate.impact_if_gathered },
        { name: 'action_label', value: candidate.action_label },
      ],
    });
    if (block !== null) blocks.push(block);
  }
  return blocks;
}

/**
 * PR 3 — stale-safe rerun CoachingBlock.
 *
 * Emitted by the lifecycle composer when the source `run_analysis` fact's
 * `graph_hash_at_run` differs from the current scenario graph hash. The
 * block prompts the user to re-run analysis to refresh the insights; the
 * UI surfaces it at the top of the Analysis tab because `priority_rank:1`
 * sorts above every fresh-state Phase 3 block (which start at 10).
 *
 * Per the PR 3 spec, when this block is emitted, NO ReviewCardBlock /
 * EvidenceBlock / other CoachingBlock is emitted from the source fact —
 * the stale state is communicated by this single block alone. The
 * `signal_id` is keyed on the SOURCE fact's `graph_hash_at_run` (the one
 * the persisted analysis was computed against) so re-emissions across
 * multiple stale turns share the same identity for UI dedupe.
 */
export function buildStaleRerunCoachingBlock(
  ctx: BlockBuildCtx,
): CoachingBlock | null {
  // Source-fact graph_hash carries the stale ID — the block's
  // `graph_hash_at_generation` is the SAME stale hash so the wire-side
  // freshness comparator can pair the block back to its source.
  const candidate = {
    ...commonMetadata('coach:stale_rerun', '', { ...ctx, freshness: 'stale' as const }),
    type: 'coaching' as const,
    coaching_kind: 'orientation' as const,
    title: truncate('The graph has changed since the last analysis', TITLE_MAX),
    body: truncate(
      'Re-run analysis to refresh the insights and explore the updated decision.',
      BODY_MAX,
    ),
    source: 'decision_review' as const,
    target_refs: [] as readonly TargetRef[],
    priority_rank: 1,
    // Wave-2 ask 1 (0.19.0). Also the honest filter signal for the UI's
    // framing slot: a should_fix orientation nudge is housekeeping, never a
    // framing question (the UI-SEM-078 leak class).
    ...guidanceSignalsForCoachingKind('orientation'),
    action_intent: 'rerun_analysis' as ActionIntentLiteral,
    action_label: truncate('Re-run analysis', ACTION_LABEL_MAX),
  };
  return validateProseAndSchemaOrDrop(CoachingBlockSchema, candidate, {
    block_type: 'coaching',
    kind: 'stale_rerun',
    prose: [
      { name: 'title', value: candidate.title },
      { name: 'body', value: candidate.body },
      { name: 'action_label', value: candidate.action_label },
    ],
  });
}

/**
 * Capability layer P0 (ROADMAP 1.183) — the deterministic lens SUGGESTION.
 *
 * Rides the EXISTING coaching-block surface (the "Strengthen your model" class
 * — `coaching_kind: 'strengthen'`, whose guidance signals already exist but
 * which had no live V5 emitter until now). It is NOT a new block kind and NOT a
 * new recommendation home.
 *
 * The lens is chosen by the deterministic selector (`lens-selector.ts`) from
 * REAL analysis signals — no LLM call. When the selector returns nothing
 * (`selectLens === null`, the load-bearing negative), NO block is emitted.
 *
 * `source: 'deterministic_signal'` is the honest provenance: this suggestion is
 * derived from the analysis SIGNALS (option/factor sensitivity, EVPI,
 * confidence tier), NOT from the LLM `decision_review` pass.
 *
 * NO `action_intent` chip: the on-card action_intent affordance is inert on the
 * live UI today (V5CoachingBlock renders it display-only). Per the
 * capability-layer brief Revision-1 item 3 ("no inert chips, ever"), the P0
 * suggestion ships as coach TEXT + rationale only — the body names the live
 * action (what-would-flip / pre-mortem / gather-evidence) in prose. Wiring the
 * chip to a typed dispatch is S2 work.
 *
 * `priority_rank: 15` places it just below the narrative summary (rank 10) and
 * above the review cards (pre_mortem 20+): the proactive lens call-to-action.
 * The selector returns AT MOST ONE lens, so the "one proactive suggestion per
 * turn" frequency cap holds by construction. `signal_id` keys on
 * (lens, graph_hash) so re-emissions for the same graph hash carry identical
 * identity for UI dedupe (don't re-offer the same lens until the graph
 * changes).
 *
 * Telemetry: exactly ONE frozen-manifest-registered event
 * (`v5.capability.lens_suggestion_emitted`) fires when the block SURVIVES the
 * prose/schema gate and is returned — never on a drop, never twice. Payload is
 * the lens id + rationale CODE only (both closed enums); no user text.
 */
export function buildLensSuggestionCoachingBlock(
  fact: RunAnalysisHandlerFact,
  ctx: BlockBuildCtx,
): CoachingBlock | null {
  const selection = selectLens(fact);
  if (selection === null) return null;

  const candidate = {
    ...commonMetadata(`coach:lens:${selection.lens}`, selection.lens, ctx),
    type: 'coaching' as const,
    coaching_kind: 'strengthen' as const,
    title: truncate(selection.title, TITLE_MAX),
    body: truncate(selection.body, BODY_MAX),
    source: 'deterministic_signal' as const,
    target_refs: [] as readonly TargetRef[],
    priority_rank: 15,
    // Wave-2 ask 1 (0.19.0) + 1.120 residual (0.21.0): producer-owned guidance
    // signals for `strengthen` (category could_fix, signal_code STRENGTHEN_ITEM).
    ...guidanceSignalsForCoachingKind('strengthen'),
  };
  const block = validateProseAndSchemaOrDrop(CoachingBlockSchema, candidate, {
    block_type: 'coaching',
    kind: 'strengthen',
    prose: [
      { name: 'title', value: candidate.title },
      { name: 'body', value: candidate.body },
    ],
  });
  if (block === null) return null;

  emit(TelemetryEvents.V5LensSuggestionEmitted, {
    lens_id: selection.lens,
    rationale_code: selection.rationaleCode,
    graph_hash_at_generation: ctx.graph_hash_at_generation,
  });
  return block;
}

// ============================================================================
// ReviewCardBlock builders (one per card_kind)
// ============================================================================

function buildNarrativeCard(
  dr: Record<string, unknown>,
  ctx: BlockBuildCtx,
  leverLabels: readonly string[] = [],
): ReviewCardBlock | null {
  if (typeof dr.narrative_summary !== 'string') return null;
  const summary = dr.narrative_summary.trim();
  const body = truncate(summary, BODY_MAX);
  if (body.length === 0) return null;
  // Doctrine D-U F2 / Finding 1: drop the narrative when it NAMES an option-set
  // lever as an uncertainty. Scan the FULL summary (pre-truncation) so a lever
  // named past the length cap is still caught. Empty labels ⇒ no suppression.
  if (proseNamesLever(summary, leverLabels)) {
    emitDrop({
      block_type: 'review_card',
      kind: 'narrative',
      reason: 'lever_named',
      field: 'narrative_summary',
    });
    return null;
  }
  const candidate = {
    ...commonMetadata('review:narrative', '', ctx),
    type: 'review_card' as const,
    card_kind: 'narrative' as const,
    title: truncate('How the analysis reads', TITLE_MAX),
    body,
    ...reviewCardSignals('narrative', 'info'),
    target_refs: [] as readonly TargetRef[],
    priority_rank: 10,
  };
  return validateProseAndSchemaOrDrop(ReviewCardBlockSchema, candidate, {
    block_type: 'review_card',
    kind: 'narrative',
    prose: [
      { name: 'title', value: candidate.title },
      { name: 'body', value: candidate.body },
    ],
  });
}

/**
 * DGAI #342(1) — the pre-mortem body is re-surfaced VERBATIM by downstream
 * surfaces (the DGAI Decision-overview panel promotes the top-ranked
 * interrogative block body into "Olumi's framing question", stripped of this
 * card's "If things go wrong" frame). Un-framed failure prose then reads as a
 * statement that the decision ALREADY failed. Two rules make the body honest
 * on ANY surface (canned-never-a-substitute doctrine):
 *
 *   1. BIND — the emitted body must stand alone: it is prefixed with an
 *      explicit hypothetical frame ({@link PRE_MORTEM_FRAME_PREFIX}) unless
 *      the LLM prose already opens hypothetically
 *      ({@link OPENS_HYPOTHETICALLY_RE}).
 *   2. ANCHOR — the card ships only when it is anchored to the user's model:
 *      `grounded_in` resolves to at least one real node, OR the failure
 *      prose names a graph node label (same whole-phrase matcher as the
 *      lever-naming guard). A fully context-free canned question is DROPPED
 *      (`context_unanchored`), not decorated.
 */
const PRE_MORTEM_FRAME_PREFIX = 'Imagine this decision has failed: ';

/** LLM prose that already carries its own hypothetical frame. */
const OPENS_HYPOTHETICALLY_RE = /^(?:imagine|suppose|picture|what\s+if|if\b)/i;

/** True when the prose names ANY graph node label (model anchor). Reuses the
 *  lever-guard's normalised whole-phrase matcher; 1–2 char labels are skipped
 *  (same over-match rule as {@link collectLeverLabels}). */
function proseNamesGraphNode(text: string, lookup: GraphNodeLookup): boolean {
  const hay = normaliseForPhraseMatch(text);
  if (hay.length === 0) return false;
  for (const ref of lookup.values()) {
    const needle = normaliseForPhraseMatch(ref.label);
    if (needle.length < LEVER_LABEL_MIN_LEN) continue;
    if (containsWholePhrase(hay, needle)) return true;
  }
  return false;
}

function buildPreMortemCard(
  dr: Record<string, unknown>,
  lookup: GraphNodeLookup,
  ctx: BlockBuildCtx,
  leverLabels: readonly string[] = [],
): ReviewCardBlock | null {
  const pm = readRecord(dr.pre_mortem);
  if (pm === null) return null;
  const failure = typeof pm.failure_scenario === 'string'
    ? pm.failure_scenario.trim()
    : '';
  if (failure.length === 0) return null;
  // Doctrine D-U F2 / Finding 1: drop the pre-mortem when its failure prose
  // NAMES an option-set lever as an uncertainty. Empty labels ⇒ no suppression.
  if (proseNamesLever(failure, leverLabels)) {
    emitDrop({
      block_type: 'review_card',
      kind: 'pre_mortem',
      reason: 'lever_named',
      field: 'failure_scenario',
    });
    return null;
  }
  const grounded = Array.isArray(pm.grounded_in) ? pm.grounded_in : [];
  // Round-3 review correction: when `grounded_in` was provided but EVERY
  // entry misses canonical lookup, drop the block. Emitting with
  // `target_refs: []` would silently misrepresent the LLM's intent —
  // the model claimed graph references that don't exist. When
  // `grounded_in` is absent or all-empty, the LLM made no grounding
  // claim and `target_refs: []` is honest.
  const groundedStrings = grounded.filter((g): g is string => typeof g === 'string' && g.length > 0);
  const targetRefs: TargetRef[] = [];
  for (const raw of groundedStrings) {
    const ref = lookup.get(raw);
    if (ref !== undefined) targetRefs.push(ref);
  }
  if (groundedStrings.length > 0 && targetRefs.length === 0) {
    emitDrop({
      block_type: 'review_card',
      kind: 'pre_mortem',
      reason: 'lookup_miss',
      field: 'grounded_in',
    });
    return null;
  }
  // DGAI #342(1) ANCHOR rule: no resolved grounding AND the prose names no
  // graph node ⇒ a context-free canned question. Drop it — a template
  // question with no anchor to the user's model is never a substitute for
  // real coaching, and downstream surfaces re-render this body verbatim.
  if (targetRefs.length === 0 && !proseNamesGraphNode(failure, lookup)) {
    emitDrop({
      block_type: 'review_card',
      kind: 'pre_mortem',
      reason: 'context_unanchored',
      field: 'failure_scenario',
    });
    return null;
  }
  // DGAI #342(1) BIND rule: the body must read as a hypothetical on any
  // surface, including ones that strip this card's "If things go wrong"
  // frame. Fixed prefix only — no derived content, no rewriting of the
  // LLM's prose.
  const standaloneBody = OPENS_HYPOTHETICALLY_RE.test(failure)
    ? failure
    : `${PRE_MORTEM_FRAME_PREFIX}${failure}`;
  const candidate = {
    ...commonMetadata('review:pre_mortem', '', ctx),
    type: 'review_card' as const,
    card_kind: 'pre_mortem' as const,
    title: truncate('If things go wrong', TITLE_MAX),
    body: truncate(standaloneBody, BODY_MAX),
    ...reviewCardSignals('pre_mortem', 'warning'),
    target_refs: targetRefs,
    priority_rank: 20,
    action_intent: 'run_pre_mortem' as ActionIntentLiteral,
    action_label: truncate('Run a pre-mortem', ACTION_LABEL_MAX),
  };
  return validateProseAndSchemaOrDrop(ReviewCardBlockSchema, candidate, {
    block_type: 'review_card',
    kind: 'pre_mortem',
    prose: [
      { name: 'title', value: candidate.title },
      { name: 'body', value: candidate.body },
      { name: 'action_label', value: candidate.action_label },
    ],
  });
}

function buildFlipThresholdCards(
  dr: Record<string, unknown>,
  lookup: GraphNodeLookup,
  ctx: BlockBuildCtx,
): readonly ReviewCardBlock[] {
  if (!Array.isArray(dr.flip_thresholds)) return [];
  const out: ReviewCardBlock[] = [];
  let idx = 0;
  for (const raw of dr.flip_thresholds) {
    const entry = readRecord(raw);
    if (entry === null) continue;
    const factorId = typeof entry.factor_id === 'string'
      ? entry.factor_id
      : '';
    const factorLabel = typeof entry.factor_label === 'string'
      ? entry.factor_label.trim()
      : '';
    const narrative = typeof entry.narrative === 'string'
      ? entry.narrative.trim()
      : '';
    if (factorId.length === 0 || factorLabel.length === 0 || narrative.length === 0) continue;
    // Round-3 review correction: drop when the LLM-claimed factor isn't
    // in the canonical graph lookup. Prior behaviour fell back to the
    // LLM-provided factor_label, but we have no proof the LLM honoured
    // the "use canonical labels" prompt rule, and the fallback propagated
    // a possibly-fake factor_id into target_refs. Fail-closed restores
    // the invariant stated in the file header (line 52-54): target ref
    // ID-to-label resolution drops on miss.
    const ref = lookup.get(factorId);
    if (ref === undefined || ref.kind !== 'factor') {
      emitDrop({
        block_type: 'review_card',
        kind: 'flip_threshold',
        reason: 'lookup_miss',
        field: 'factor_id',
      });
      continue;
    }
    idx++;
    const candidate = {
      ...commonMetadata('review:flip', factorId, ctx),
      type: 'review_card' as const,
      card_kind: 'flip_threshold' as const,
      title: truncate(`What would flip the result on ${ref.label}`, TITLE_MAX),
      body: truncate(narrative, BODY_MAX),
      ...reviewCardSignals('flip_threshold', 'warning'),
      target_refs: [ref] as readonly TargetRef[],
      priority_rank: 30 + idx,
      action_intent: 'what_would_flip' as ActionIntentLiteral,
      action_label: truncate('Explore what flips this', ACTION_LABEL_MAX),
    };
    const block = validateProseAndSchemaOrDrop(ReviewCardBlockSchema, candidate, {
      block_type: 'review_card',
      kind: 'flip_threshold',
      prose: [
        { name: 'title', value: candidate.title },
        { name: 'body', value: candidate.body },
        { name: 'action_label', value: candidate.action_label },
      ],
    });
    if (block !== null) out.push(block);
  }
  return out;
}

function buildBiasCards(
  dr: Record<string, unknown>,
  lookup: GraphNodeLookup,
  ctx: BlockBuildCtx,
): readonly ReviewCardBlock[] {
  if (!Array.isArray(dr.bias_findings)) return [];
  const out: ReviewCardBlock[] = [];
  let idx = 0;
  for (const raw of dr.bias_findings) {
    const entry = readRecord(raw);
    if (entry === null) continue;
    const description = typeof entry.description === 'string'
      ? entry.description.trim()
      : '';
    const biasType = typeof entry.type === 'string' ? entry.type.trim() : '';
    if (description.length === 0 || biasType.length === 0) continue;
    idx++;
    const affected = Array.isArray(entry.affected_elements)
      ? entry.affected_elements
      : [];
    const targetRefs: TargetRef[] = [];
    for (const elt of affected) {
      if (typeof elt !== 'string') continue;
      const ref = lookup.get(elt);
      if (ref !== undefined) targetRefs.push(ref);
    }
    const candidate = {
      ...commonMetadata('review:bias', biasType, ctx),
      type: 'review_card' as const,
      card_kind: 'bias' as const,
      title: truncate(`Something to check: ${humaniseBiasType(biasType)}`, TITLE_MAX),
      body: truncate(description, BODY_MAX),
      ...reviewCardSignals('bias', 'warning'),
      target_refs: targetRefs,
      priority_rank: 40 + idx,
      action_intent: 'gather_evidence' as ActionIntentLiteral,
      action_label: truncate('Investigate this', ACTION_LABEL_MAX),
    };
    const block = validateProseAndSchemaOrDrop(ReviewCardBlockSchema, candidate, {
      block_type: 'review_card',
      kind: 'bias',
      prose: [
        { name: 'title', value: candidate.title },
        { name: 'body', value: candidate.body },
        { name: 'action_label', value: candidate.action_label },
      ],
    });
    if (block !== null) out.push(block);
  }
  return out;
}

function buildRobustnessCard(
  dr: Record<string, unknown>,
  ctx: BlockBuildCtx,
): ReviewCardBlock | null {
  const robust = readRecord(dr.robustness_explanation);
  if (robust === null) return null;
  const summary = typeof robust.summary === 'string' ? robust.summary.trim() : '';
  if (summary.length === 0) return null;
  const primaryRisk = typeof robust.primary_risk === 'string'
    ? robust.primary_risk.trim()
    : '';
  const candidate = {
    ...commonMetadata('review:robustness', '', ctx),
    type: 'review_card' as const,
    card_kind: 'robustness' as const,
    title: truncate('How robust is this?', TITLE_MAX),
    body: truncate(summary, BODY_MAX),
    ...reviewCardSignals('robustness', primaryRisk.length > 0 ? 'warning' : 'info'),
    target_refs: [] as readonly TargetRef[],
    priority_rank: 50,
  };
  return validateProseAndSchemaOrDrop(ReviewCardBlockSchema, candidate, {
    block_type: 'review_card',
    kind: 'robustness',
    prose: [
      { name: 'title', value: candidate.title },
      { name: 'body', value: candidate.body },
    ],
  });
}

function buildEvidencePriorityCard(
  dr: Record<string, unknown>,
  lookup: GraphNodeLookup,
  ctx: BlockBuildCtx,
  interventionControlledFactorIds: ReadonlySet<string> = EMPTY_FACTOR_ID_SET,
): ReviewCardBlock | null {
  const enhancements = readRecord(dr.evidence_enhancements);
  if (enhancements === null) return null;
  const entries = Object.entries(enhancements);
  if (entries.length === 0) return null;
  // Take the top entry — emission order ≈ voi rank per the v11 prompt.
  for (const [factorId, rawEntry] of entries) {
    const entry = readRecord(rawEntry);
    if (entry === null) continue;

    // Doctrine D-U F2: never crown an option-set LEVER as the highest-leverage
    // "evidence gap to strengthen". Skip it and let the next non-lever gap take
    // the card (channel preserved); if none remains, no card is emitted.
    if (isLeverFactor(factorId, interventionControlledFactorIds)) continue;
    const rationale = typeof entry.rationale === 'string'
      ? entry.rationale.trim()
      : '';
    if (rationale.length === 0) continue;
    const ref = lookup.get(factorId);
    if (ref === undefined || ref.kind !== 'factor') continue;
    const candidate = {
      ...commonMetadata('review:evidence_priority', factorId, ctx),
      type: 'review_card' as const,
      card_kind: 'evidence_priority' as const,
      title: truncate(`Highest-leverage evidence gap: ${ref.label}`, TITLE_MAX),
      body: truncate(rationale, BODY_MAX),
      ...reviewCardSignals('evidence_priority', 'info'),
      target_refs: [ref],
      priority_rank: 60,
      action_intent: 'gather_evidence' as ActionIntentLiteral,
      action_label: truncate('Strengthen this evidence', ACTION_LABEL_MAX),
    };
    return validateProseAndSchemaOrDrop(ReviewCardBlockSchema, candidate, {
      block_type: 'review_card',
      kind: 'evidence_priority',
      prose: [
        { name: 'title', value: candidate.title },
        { name: 'body', value: candidate.body },
        { name: 'action_label', value: candidate.action_label },
      ],
    });
  }
  return null;
}

function buildAssumptionCards(
  dr: Record<string, unknown>,
  ctx: BlockBuildCtx,
  leverLabels: readonly string[] = [],
): readonly ReviewCardBlock[] {
  if (!Array.isArray(dr.key_assumptions)) return [];
  const out: ReviewCardBlock[] = [];
  let idx = 0;
  for (const raw of dr.key_assumptions) {
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    if (text.length === 0) continue;
    // Doctrine D-U F2: an option-set LEVER is a decision variable being SET,
    // not a load-bearing UNCERTAINTY to confirm — never NAME it as an
    // assumption to check. Skip before the index/rank bump so surviving
    // non-lever assumptions stay contiguous (empty labels ⇒ suppress nothing).
    if (proseNamesLever(text, leverLabels)) continue;
    idx++;
    const candidate = {
      ...commonMetadata('review:assumption', String(idx), ctx),
      type: 'review_card' as const,
      card_kind: 'assumption' as const,
      title: truncate('A load-bearing assumption', TITLE_MAX),
      body: truncate(text, BODY_MAX),
      ...reviewCardSignals('assumption', 'info'),
      target_refs: [] as readonly TargetRef[],
      priority_rank: 70 + idx,
    };
    const block = validateProseAndSchemaOrDrop(ReviewCardBlockSchema, candidate, {
      block_type: 'review_card',
      kind: 'assumption',
      prose: [
        { name: 'title', value: candidate.title },
        { name: 'body', value: candidate.body },
      ],
    });
    if (block !== null) out.push(block);
  }
  return out;
}

function buildScenarioContextCards(
  dr: Record<string, unknown>,
  lookup: GraphNodeLookup,
  ctx: BlockBuildCtx,
  leverLabels: readonly string[] = [],
): readonly ReviewCardBlock[] {
  const contexts = readRecord(dr.scenario_contexts);
  if (contexts === null) return [];
  const out: ReviewCardBlock[] = [];
  let idx = 0;
  for (const [edgeId, rawEntry] of Object.entries(contexts)) {
    const entry = readRecord(rawEntry);
    if (entry === null) continue;
    const trigger = typeof entry.trigger_description === 'string'
      ? entry.trigger_description.trim()
      : '';
    const consequence = typeof entry.consequence === 'string'
      ? entry.consequence.trim()
      : '';
    if (trigger.length === 0 || consequence.length === 0) continue;
    // Doctrine D-U F2 / Finding 1: skip a scenario whose free-text trigger /
    // consequence NAMES an option-set lever as an uncertainty. Skip before the
    // index bump so surviving scenarios keep contiguous ranks (empty labels ⇒
    // no suppression).
    if (proseNamesLever(`${trigger} ${consequence}`, leverLabels)) {
      emitDrop({
        block_type: 'review_card',
        kind: 'scenario_context',
        reason: 'lever_named',
        field: 'scenario_contexts',
      });
      continue;
    }
    // Round-3 review correction: drop when the LLM-keyed edge isn't in
    // the canonical graph lookup. The Record key IS the edge claim;
    // emitting with `target_refs: []` would publish a "scenario about
    // an unknown thing" — fail-closed instead.
    const ref = lookup.get(edgeId);
    if (ref === undefined || ref.kind !== 'edge') {
      emitDrop({
        block_type: 'review_card',
        kind: 'scenario_context',
        reason: 'lookup_miss',
        field: 'edge_id',
      });
      continue;
    }
    idx++;
    // Compose body as trigger + consequence; sentence-case join.
    const body = trigger.endsWith('.')
      ? `${trigger} ${consequence}`
      : `${trigger}. ${consequence}`;
    const candidate = {
      ...commonMetadata('review:scenario', edgeId, ctx),
      type: 'review_card' as const,
      card_kind: 'scenario_context' as const,
      title: truncate('A scenario worth considering', TITLE_MAX),
      body: truncate(body, BODY_MAX),
      ...reviewCardSignals('scenario_context', 'info'),
      target_refs: [ref] as readonly TargetRef[],
      priority_rank: 80 + idx,
    };
    const block = validateProseAndSchemaOrDrop(ReviewCardBlockSchema, candidate, {
      block_type: 'review_card',
      kind: 'scenario_context',
      prose: [
        { name: 'title', value: candidate.title },
        { name: 'body', value: candidate.body },
      ],
    });
    if (block !== null) out.push(block);
  }
  return out;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Codex correction #2: `suggested_technique` formatting rule. No em
 * dashes. Sentence case. Colon separator if `evidence_type` is present.
 * Drop the block (return null) if `specific_action` is missing — caller
 * decides whether to emit at all.
 */
function formatSuggestedTechnique(
  evidenceType: string,
  specificAction: string,
): string | null {
  if (specificAction.length === 0) return null;
  if (evidenceType.length === 0) {
    return truncate(sentenceCase(specificAction), TECHNIQUE_MAX);
  }
  const label = humaniseEvidenceType(evidenceType);
  if (label.length === 0) {
    return truncate(sentenceCase(specificAction), TECHNIQUE_MAX);
  }
  return truncate(`${label}: ${sentenceCase(specificAction)}`, TECHNIQUE_MAX);
}

/**
 * Map the v11-emitted `evidence_type` enum to a human display label.
 * Returns `''` when the value is outside the known set so the caller
 * falls back to action-only formatting.
 */
function humaniseEvidenceType(s: string): string {
  switch (s) {
    case 'internal_data': return 'Internal data';
    case 'market_research': return 'Market research';
    case 'expert_input': return 'Expert input';
    case 'customer_research': return 'Customer research';
    default: return '';
  }
}

function humaniseBiasType(s: string): string {
  // LLM emits SCREAMING_SNAKE_CASE; UI prefers sentence case.
  const lower = s.toLowerCase().replace(/_/g, ' ');
  if (lower.length === 0) return 'a bias signal';
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function sentenceCase(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

function stableSignalId(
  prefix: string,
  key: string,
  ctx: BlockBuildCtx,
): string {
  return key.length > 0
    ? `${prefix}:${key}:${ctx.graph_hash_at_generation}`
    : `${prefix}:${ctx.graph_hash_at_generation}`;
}

/**
 * PR 3 — common metadata stamped onto every Phase 3 block. Derives
 * `signal_id` deterministically per `(prefix, key, graph_hash)` and
 * `block_id` as a UUID v5 of that signal_id under the V5 Phase 3
 * namespace, so re-emissions of the same logical block across turns
 * carry identical `block_id` and `signal_id` (lets the UI dedupe
 * cached vs newly-rebuilt blocks). `freshness` defaults to `'fresh'`
 * when the ctx omits it (preserves PR #178/180 behaviour); the
 * stale-emission path threads `'stale'` through `ctx.freshness`.
 */
function commonMetadata(
  prefix: string,
  key: string,
  ctx: BlockBuildCtx,
): {
  readonly block_id: string;
  readonly signal_id: string;
  readonly created_at: string;
  readonly source_handler: typeof SOURCE_HANDLER;
  readonly graph_hash_at_generation: string;
  readonly freshness: 'fresh' | 'stale';
} {
  const signal_id = stableSignalId(prefix, key, ctx);
  return {
    block_id: deterministicBlockId(signal_id),
    signal_id,
    created_at: ctx.created_at,
    source_handler: SOURCE_HANDLER,
    graph_hash_at_generation: ctx.graph_hash_at_generation,
    freshness: ctx.freshness ?? 'fresh',
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isTargetRefKind(s: string): s is TargetRefKindLiteral {
  return s === 'factor' || s === 'option' || s === 'edge' || s === 'goal' ||
    s === 'risk' || s === 'constraint' || s === 'outcome';
}

/**
 * Round-3 review: scan an ordered list of user-facing prose fields for
 * banned wording (`FORBIDDEN_USER_FACING_PHRASES`), raw probability
 * decimals, or entity-id-shaped tokens. Returns the first unsafe
 * `{ field, reason, sample }` triple, or `null` when the block is
 * clean. The `sample` is the matched substring, NOT the full prose —
 * loggers can record it without leaking the entire LLM authorship.
 *
 * Used by every Phase 3 builder before `validateOrDrop` so unsafe LLM
 * output drops at the source rather than riding through Zod and out
 * to the wire (where the per-block output-safety layer would scrub
 * IDs but not banned wording or raw decimals).
 */
interface ProseField {
  readonly name: string;
  readonly value: string | undefined;
}

interface ProseGuardHit {
  readonly field: string;
  readonly reason: 'forbidden_phrase' | 'raw_decimal' | 'raw_id';
  readonly sample: string;
}

function scanProse(fields: readonly ProseField[]): ProseGuardHit | null {
  for (const { name, value } of fields) {
    if (typeof value !== 'string' || value.length === 0) continue;
    const phraseHit = findForbiddenPhraseHit(value);
    if (phraseHit !== null) {
      return { field: name, reason: 'forbidden_phrase', sample: phraseHit };
    }
    const decimalMatch = RAW_DECIMAL_RE.exec(value);
    if (decimalMatch !== null) {
      return { field: name, reason: 'raw_decimal', sample: decimalMatch[0].trim() };
    }
    // Round-4 review: reuse the shared ENTITY_ID_LEAK_RE + slug-shape
    // confirmation gate so the Phase 3 source guard stays in lockstep
    // with the egress scrub (covers `fac_`, `opt_`, `con_`, `out_`,
    // etc.). Walk all matches in case the first is an English-compound
    // false positive that the slug-shape gate filters out.
    const idMatcher = new RegExp(ENTITY_ID_LEAK_RE.source, 'gi');
    let idMatch: RegExpExecArray | null;
    while ((idMatch = idMatcher.exec(value)) !== null) {
      if (isSlugShapedEntityId(idMatch[0])) {
        // Round-4 P1: log only the prefix segment of the matched ID,
        // never the full token. Mirrors the egress-layer privacy
        // policy (output-safety.ts logs prefix/resolution only).
        const prefix = idMatch[0].split(/[_:-]/, 1)[0] ?? 'entity_id';
        return { field: name, reason: 'raw_id', sample: `${prefix.toLowerCase()}_*` };
      }
    }
  }
  return null;
}

/**
 * Round-3 review: telemetry on block drops. Logs structurally (block type,
 * card/coaching kind, reason) WITHOUT user prose or raw IDs so dashboards
 * can detect composer / schema drift without re-introducing the
 * privacy/leak risks the drop was protecting against.
 *
 * `sample` is the matched substring from the prose guard (e.g. "0.73",
 * "factor_abc12345", "recommendation"). For schema-validation drops,
 * `sample` is undefined and `reason` carries the Zod issue path summary.
 */
interface DropReason {
  readonly block_type: string;
  readonly kind?: string;
  readonly reason: string;
  readonly field?: string;
  readonly sample?: string;
}

function emitDrop(reason: DropReason): void {
  log.warn(
    {
      event: 'v5.phase3.block_dropped',
      block_type: reason.block_type,
      block_kind: reason.kind,
      drop_reason: reason.reason,
      field: reason.field,
      sample: reason.sample,
    },
    'V5 Phase 3 block dropped before egress',
  );
}

/**
 * Round-3 review: combined prose-guard + schema-validate gate. Returns the
 * typed block on success, null on failure. Drops are logged with
 * structural metadata only (no user prose / raw IDs).
 *
 * RC4 proportionate remedies (2026-07-15 session RCA): a `forbidden_phrase`
 * hit is now REWRITE-FIRST. Live evidence: the robustness review card was
 * dropped on every review emission for containing the word "recommendation"
 * — generated coaching destroyed by its own guard. When the hit belongs to
 * the rewritable prescriptive-lexicon class, the deterministic terminology
 * substitution (`applyTerminologyRewrite` — the prompt TERMINOLOGY map) is
 * applied to every prose field, the fields are RE-SCANNED, and only a
 * residual hit (a fatal-class phrase with no safe rewrite: denial, false
 * success, staleness, jargon) — or a `raw_decimal` / `raw_id` hit, which
 * never had a rewrite — drops the block as before. A successful rewrite is
 * VISIBLE via `v5.phase3.block_rewritten` (gate id + substituted terms).
 * Note the rewritten field re-enters the Zod parse below, so a rewrite that
 * pushed a field over its schema cap still fails closed (drop, logged) —
 * never an oversize block on the wire.
 */
function validateProseAndSchemaOrDrop<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  candidate: unknown,
  ctx: {
    block_type: string;
    kind?: string;
    prose: readonly ProseField[];
  },
): z.infer<TSchema> | null {
  let effectiveCandidate = candidate;
  let proseHit = scanProse(ctx.prose);
  if (proseHit !== null && proseHit.reason === 'forbidden_phrase') {
    const appliedTerms: string[] = [];
    const rewrittenFields: string[] = [];
    const rewrittenProse: ProseField[] = ctx.prose.map((f) => {
      if (typeof f.value !== 'string' || f.value.length === 0) return f;
      const r = applyTerminologyRewrite(f.value);
      if (r.applied.length === 0) return f;
      appliedTerms.push(...r.applied);
      rewrittenFields.push(f.name);
      return { name: f.name, value: r.text };
    });
    if (appliedTerms.length > 0 && scanProse(rewrittenProse) === null) {
      // Every prose field is clean after the substitution — ship the block
      // with the rewritten fields instead of dropping it.
      const patch: Record<string, unknown> = {};
      for (const f of rewrittenProse) {
        if (rewrittenFields.includes(f.name)) patch[f.name] = f.value;
      }
      effectiveCandidate = {
        ...(candidate as Record<string, unknown>),
        ...patch,
      };
      proseHit = null;
      log.info(
        {
          event: 'v5.phase3.block_rewritten',
          block_type: ctx.block_type,
          block_kind: ctx.kind,
          rewritten_fields: rewrittenFields,
          // Generic banned vocabulary only (the matched terms) — safe to log.
          terms: appliedTerms,
        },
        'V5 Phase 3 block prose rewritten (terminology substitution) before egress',
      );
    }
  }
  if (proseHit !== null) {
    emitDrop({
      block_type: ctx.block_type,
      kind: ctx.kind,
      reason: `prose_guard_${proseHit.reason}`,
      field: proseHit.field,
      sample: proseHit.sample,
    });
    return null;
  }
  const parsed = schema.safeParse(effectiveCandidate);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    emitDrop({
      block_type: ctx.block_type,
      kind: ctx.kind,
      reason: 'schema_validation_failed',
      field: firstIssue?.path?.join('.') ?? undefined,
      // Round-3: include only the Zod error code, not any data value —
      // codes like `invalid_type`, `too_small`, `invalid_enum_value` are
      // structural and safe to log.
      sample: firstIssue?.code,
    });
    return null;
  }
  return parsed.data;
}

