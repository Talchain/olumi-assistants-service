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
  ExerciseBlockSchema,
  type ActionIntentLiteral,
  type CoachingBlock,
  type EvidenceBlock,
  type ExerciseBlock,
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
import {
  LENS_DSK_PROVENANCE,
  selectLens,
  whatIfSuggestionExecutorAvailable,
  type LensId,
  type LensSelection,
  type LensSelectorOptions,
} from './lens-selector.js';
import { resolveDskProtocolProvenance } from './dsk-protocol-record.js';
import {
  resolveDskClaimProvenance,
  type DskClaimProvenance,
} from './dsk-claim-record.js';
import { config } from '../../config/index.js';
import {
  classifyClaimUsable,
  TIER2_ACTIVATION_ENABLED,
  type ClaimUsableInput,
} from './claim-safety-cage.js';
import {
  flipThresholdCardBody,
  flipThresholdFallbackBody,
  readFlipThresholdCardRow,
} from './flip-threshold-card-row.js';
// ROADMAP 2.267 (D-2) — the ONE owner of the top-level `enrichment.flip_thresholds[]`
// parse. The option guard below needs the row's ATTESTED alternative winner, and it
// reads it through the same module the decision_review prompt projection reads, so
// the guard and the prompt can never disagree about what the producer said. That
// module imports nothing, so this edge cannot create a compose ⇄ context cycle.
import { readTopLevelFlipRows } from '../context/flip-threshold-rows.js';
import { findForbiddenPhraseHit, RAW_DECIMAL_RE } from './forbidden-user-facing-phrases.js';
import { applyTerminologyRewrite } from './terminology-rewrite.js';
import {
  evidenceSignals,
  fragileEdgeOfferSignals,
  guidanceSignalsForCoachingKind,
  reviewCardSignals,
} from './guidance-signals.js';
// ROADMAP 2.989 — the fragile-edge selector (pure) and the PER-FACT withheld
// leaf. `mayNameLeadingOptionForFact` is IMPORTED, not restated: the offer's
// wire-reached telemetry must branch on the same predicate compose branches on.
import { selectFragileEdge } from '../coaching/select-fragile-edge.js';
import { mayNameLeadingOptionForFact } from './withheld-claim-projection.js';

const SOURCE_HANDLER = 'decision_review_enricher';

const TITLE_MAX = 80;
/**
 * Capability P1 — the composer's cap on `pre_mortem.warning_signs`.
 *
 * ⚠ THIS IS A HAND-KEPT MIRROR, NOT A DERIVATION — say so plainly, because the
 * first version of this comment said the cap was "READ FROM the producer's
 * contract" and that was FALSE (CEE #770 review F1). It is a bare literal. The
 * authority it mirrors is the decision_review prompt's own declared bound,
 * `src/cee/decision-review/decompose-prompts.ts` —
 * `"warning_signs": ["string"],   // up to 3, observable and actionable`.
 *
 * Why a mirror at all, rather than parsing the prompt at runtime: a production
 * composer that reads a number out of a prompt STRING to decide how much user
 * content to keep is a worse failure mode than a guarded constant — one prompt
 * reword and the composer silently changes what users see, with no review.
 *
 * So the mirror is made FAIL-LOUD instead (CLAUDE.md trap 12; same shape as
 * `scripts/ci/assert-pnpm-overrides-readable.mjs`):
 * `warning-signs-cap-derivation.test.ts` parses the bound OUT of the prompt
 * source and asserts equality with this constant, and fails just as loudly if
 * the anchor it parses ever disappears. If the prompt moves to "up to 5", that
 * test REDs — instead of this composer quietly truncating conforming output and
 * firing a producer-drift alarm at a producer that did nothing wrong.
 *
 * `ExerciseBlockSchema` sets no maximum, so without this an over-long model
 * return rides to the renderer unbounded. Exceeding it is DISCLOSED via
 * `v5.capability.lens_companion_truncated`, never silently swallowed.
 */
export const WARNING_SIGNS_MAX = 3;
const BODY_MAX = 300;
const ACTION_LABEL_MAX = 40;
/**
 * Contract max for `action_prompt` (`PHASE3_ACTION_PROMPT_MAX`, schemas
 * 0.31.0). Equal to `BODY_MAX` by derivation, not by definition — the contract
 * declares them as separate named constants, so they are kept separate here
 * too rather than aliased.
 */
const ACTION_PROMPT_MAX = 300;
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
// ⭐ MOVED to `forbidden-user-facing-phrases.ts` (ROADMAP 2.688 slice 1)
// and IMPORTED here rather than declared locally. It had become a second
// prose-guard lexicon living apart from the canonical one, and the
// reference-class exercise builder needs the SAME rule — copying the
// regex into a second builder is precisely the hand-maintained mirror
// (CLAUDE.md trap 12). One definition site, both consumers derive.
//
// Banned recommendation/winner language is sourced from the central
// `FORBIDDEN_USER_FACING_PHRASES` list via `findForbiddenPhraseHit`.
// RC4: for the REWRITABLE prescriptive-lexicon subset the remedy is a
// deterministic terminology substitution, not a drop — see
// `validateProseAndSchemaOrDrop`.

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
 * Wave-4 δ2 — build a `GraphNodeLookup` directly from a raw graph record
 * (`{nodes[], edges[]}`), for the mutation / what_would_flip directive branches
 * that have NO run_analysis fact to read an enrichment graph from. Consumes the
 * persisted-snapshot graph the compose caller already holds. Absent / non-record
 * input ⇒ empty lookup ⇒ every consumer fails closed. Same node-kind gate + edge
 * handling as `buildGraphNodeLookup`'s fallback pass.
 */
export function buildGraphNodeLookupFromGraph(graph: unknown): GraphNodeLookup {
  const lookup = new Map<string, GraphNodeRef>();
  const record = readRecord(graph);
  if (record !== null) {
    populateGraphNodeLookup(lookup, record);
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

// ============================================================================
// Wave-4 δ1 — the ONE shared entity→node-id resolver (ROADMAP 1.202 + 1.135).
//
// DERIVED (not mirrored, trap-12) from the forward `GraphNodeLookup` above: the
// reverse `label → id` index is a pure O(nodes) derivation of the SAME map, so it
// cannot desync — it has no independent source. Two consumers share it:
//   - 1.202 (the ui_directive emitter, δ2) uses the FORWARD path (id → ref) it
//     already has — every deterministic fact names its subject by id;
//   - 1.135 (clickable coach copy) uses this REVERSE path (label → id) to link
//     entity NAMES inside LLM-authored prose to their nodes.
// Fail-closed everywhere: a duplicate normalised label is AMBIGUOUS → never
// linked (we do not guess which node the prose meant); a too-short / bare-generic
// label is not linked in prose (reusing the shipped over-match rails); a miss is
// unlinked. Reuses `normaliseForPhraseMatch` + `containsWholePhrase` +
// `LEVER_LABEL_MIN_LEN` + `GENERIC_LEVER_TOKENS` — the exact matching rails the
// lever-naming guard already ships, so a producer label change or new node kind
// flows through automatically (one input, no second list to maintain).
// ============================================================================

/**
 * Sentinel: a normalised label shared by TWO OR MORE nodes. Such a label resolves
 * to nothing (fail-closed unlinked) — the required ambiguity ruling. A unique
 * `symbol` so it can never collide with a real string id.
 */
export const AMBIGUOUS_LABEL: unique symbol = Symbol('AMBIGUOUS_LABEL');

/** Reverse index: normalised label → the single node id that owns it, or
 *  `AMBIGUOUS_LABEL` when two+ nodes share the normalised label. */
export type LabelIndex = ReadonlyMap<string, string | typeof AMBIGUOUS_LABEL>;

/**
 * Build the reverse `label → id` index from a forward `GraphNodeLookup`. One
 * pass; duplicate normalised label → `AMBIGUOUS_LABEL`. Pure + deterministic;
 * derived every build from the forward map (no hand-maintained mirror).
 */
export function buildLabelIndex(lookup: GraphNodeLookup): LabelIndex {
  const index = new Map<string, string | typeof AMBIGUOUS_LABEL>();
  for (const ref of lookup.values()) {
    const key = normaliseForPhraseMatch(ref.label);
    if (key.length === 0) continue;
    // First writer wins the id slot; the SECOND collision flips the key to
    // AMBIGUOUS and it never reverts (fail-closed on duplicate labels).
    index.set(key, index.has(key) ? AMBIGUOUS_LABEL : ref.id);
  }
  return index;
}

/**
 * Resolve a single candidate label token to its node id, or `null`. Fail-closed
 * on: too-short / bare-generic label (would over-match), ambiguous (duplicate)
 * label, or a miss. Reuses the shipped normalisation + over-match rails so a lone
 * "Cost" / "AI" / "C#" never links.
 */
export function resolveLabelToId(index: LabelIndex, rawLabel: string): string | null {
  const key = normaliseForPhraseMatch(rawLabel);
  if (key.length < LEVER_LABEL_MIN_LEN) return null;
  if (!key.includes(' ') && GENERIC_LEVER_TOKENS.has(key)) return null;
  const resolved = index.get(key);
  if (resolved === undefined || resolved === AMBIGUOUS_LABEL) return null;
  return resolved;
}

/**
 * 1.135 — scan LLM-authored prose for the graph node labels it NAMES and return
 * one deduped `TargetRef` per unambiguously-resolved node, in lookup order.
 * Whole-phrase, both-ends-bounded matching (reusing `containsWholePhrase`, which
 * already encodes the "Equity Offered to CTO" vs bare "CTO" over-match lesson);
 * too-short / bare-generic single-word labels are skipped; a label shared by two
 * nodes (`AMBIGUOUS_LABEL`) links to NEITHER. Pure; no producer value is read —
 * only the node's own display label. Byte-inert until a builder calls it.
 */
export function resolveProseEntityRefs(
  lookup: GraphNodeLookup,
  index: LabelIndex,
  prose: string,
): readonly TargetRef[] {
  const hay = normaliseForPhraseMatch(prose);
  if (hay.length === 0) return [];
  const refs: TargetRef[] = [];
  const seen = new Set<string>();
  for (const ref of lookup.values()) {
    const needle = normaliseForPhraseMatch(ref.label);
    if (needle.length < LEVER_LABEL_MIN_LEN) continue;
    // A bare generic single word ("cost") over-matches ordinary decision prose —
    // require a distinctive single word or a multi-word phrase (same rule as the
    // lever-naming guard's Finding-5 tempering).
    if (!needle.includes(' ') && GENERIC_LEVER_TOKENS.has(needle)) continue;
    if (!containsWholePhrase(hay, needle)) continue;
    // Fail-closed on ambiguity: a duplicate normalised label resolves to
    // AMBIGUOUS_LABEL → link to neither node.
    const resolved = index.get(needle);
    if (resolved === undefined || resolved === AMBIGUOUS_LABEL) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    refs.push({ id: ref.id, label: ref.label, kind: ref.kind });
  }
  return refs;
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
 * ROADMAP 2.267 — factor_id → the option id the PRODUCER attests would take
 * over once that factor crosses its flip value.
 *
 * Read through {@link readTopLevelFlipRows}, the single owner of this parse, so
 * the card guard and the decision_review prompt projection can never disagree
 * about what PLoT said. Rows with no attested identity contribute no entry —
 * a MISS therefore means "nothing attested", which is the state in which the
 * card may name no option at all.
 */
function readAttestedFlipWinners(fact: RunAnalysisHandlerFact): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const enrichment = readRecord((fact.result as Record<string, unknown>).enrichment);
  if (enrichment === null) return out;
  for (const row of readTopLevelFlipRows(enrichment)) {
    if (row.alternative_winner_id !== null) out.set(row.factor_id, row.alternative_winner_id);
  }
  return out;
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
  // `leverLabels` is deliberately NOT passed: the D-U F2 lever-naming ban is
  // scoped OUT of this one surface by ruling (a pre-mortem names the lever as a
  // failure WATCH-POINT, which is coaching, not steering). See the block
  // comment on buildPreMortemCard for the measurement and the reasoning. Every
  // other surface in this file still receives it.
  const preMortem = buildPreMortemCard(dr, lookup, ctx);
  if (preMortem !== null) blocks.push(preMortem);

  // flip_threshold (rank 3) — one per entry; within-kind sub-rank by order.
  // ROADMAP 2.267 — the card's option guard needs the two things THIS FACT
  // attests about option identity: which option the flip row itself says would
  // take over, and which option is leading. Both read from the fact, never from
  // the LLM's output.
  blocks.push(
    ...buildFlipThresholdCards(
      dr,
      lookup,
      ctx,
      readAttestedFlipWinners(fact),
      typeof fact.result.leading_option_id === 'string' && fact.result.leading_option_id.length > 0
        ? fact.result.leading_option_id
        : null,
    ),
  );

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
 * ROADMAP 2.964 — THE DSK CLAIM BADGE ON A CALIBRATION PROMPT.
 *
 * Olumi grounds its coaching in a decision-science bundle and refuses a
 * fabricated citation at the enrichment egress, and until now the user was
 * never told any of it. This is the producer half: the emit/omit rule for
 * `CoachingBlock.dsk_claim_provenance` (schemas 0.39.0).
 *
 * ── WHEN A BADGE IS EARNED ──────────────────────────────────────────────────
 * ONLY on a `dsk_grounding` verdict of `attested` or `resolved`, and only for
 * an id in the TECHNIQUE family. Every clause is somebody else's declared
 * semantics, not this file's reading of what a field ought to mean:
 *
 *   - the three verdicts and their meanings are `dsk-grounding-policy.ts`'s.
 *     `general` is a POSITIVE wire state meaning "genuinely unattested"; a
 *     badge on it would be the false disclaimer that policy exists to prevent.
 *   - an ABSENT verdict earns nothing. That policy's header says a consumer
 *     "must treat ABSENCE as 'no verdict was made' — never as `general`", and
 *     the same reasoning refuses `attested`. This is not hypothetical: the
 *     `decision_review` subtree rides the UNTYPED enrichment passthrough and is
 *     persisted per graph hash, so a payload minted before the policy existed
 *     reaches this producer carrying a plausible id and no verdict at all.
 *   - the family restriction is `science-claims.ts`'s: it builds the prompt's
 *     two tables and labels them "BIAS CLAIMS — use for bias_findings" and
 *     "TECHNIQUE CLAIMS — use for decision_quality_prompts". A `DSK-B-*`
 *     citation here cannot have come from the table the model was shown for
 *     this field, whatever verdict happens to sit beside it.
 *
 * ── WHY THE TRIPLE IS RE-RESOLVED FROM THE BUNDLE ───────────────────────────
 * The entry ALREADY carries `principle`, `evidence_strength` and
 * `dsk_protocol_id`, and none of them is read. Only the id is, and everything
 * displayed under the bundle's authority comes back out of `data/dsk/v1.json`
 * via `resolveDskClaimProvenance`. The model may cite an id correctly and
 * paraphrase the title beside it; the badge must attest to what the bundle
 * says, not to what the model typed. CEE #830 is the measured cost of the
 * other choice.
 *
 * ── FAIL-CLOSED, ALWAYS ─────────────────────────────────────────────────────
 * `null` costs the badge and never the card. That matters more here than
 * elsewhere: `CoachingBlockSchema` is `.strict()` and the triple is a strict
 * object with three REQUIRED members, so an incomplete or out-of-enum value
 * would not degrade to a plain card — it would fail the parse in
 * `validateProseAndSchemaOrDrop` and take the whole coaching card off the wire.
 * A missing badge is a lost affordance; a vanished card is lost coaching.
 *
 * ── WHAT IS DELIBERATELY NOT DONE HERE (ROADMAP 2.965) ──────────────────────
 * `buildBiasCards` gets NO badge, even though `ReviewCardBlockSchema` carries
 * the same field. Bias-finding ids are UNVALIDATED on the live V5 path — a
 * fabricated `DSK-B-*` can reach the wire inside the passthrough today — so
 * attaching there would ship the exact trust hole this chain closes. It is
 * gated on id validation for bias findings landing first.
 */
const DSK_GROUNDED_VERDICTS: ReadonlySet<string> = new Set(['attested', 'resolved']);

/** `DskClaimProvenanceSchema.claim_id` narrowed to the TECHNIQUE arm. */
const DSK_TECHNIQUE_CLAIM_ID_RE = /^DSK-T-\d{3}$/;

function dskClaimProvenanceForPrompt(
  entry: Record<string, unknown>,
): DskClaimProvenance | null {
  const verdict = entry.dsk_grounding;
  if (typeof verdict !== 'string' || !DSK_GROUNDED_VERDICTS.has(verdict)) return null;
  const claimId = entry.dsk_claim_id;
  if (typeof claimId !== 'string' || !DSK_TECHNIQUE_CLAIM_ID_RE.test(claimId)) return null;
  return resolveDskClaimProvenance(claimId);
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
  // Wave-4 δ2 / 1.135 — the shared reverse index for clickable-copy linking. One
  // derivation of the forward lookup (trap-12); reused by BOTH coaching kinds so
  // an entity NAMED in the surviving coach prose carries a `target_ref` the UI
  // renders as a link. Fail-closed inside `resolveProseEntityRefs` (ambiguous /
  // generic / too-short labels are not linked); a lever-naming assumption is
  // already dropped upstream, so only non-lever entities can link.
  const labelIndex = buildLabelIndex(lookup);

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
        // 1.135: link entity names in the (surviving, pre-truncation) prose.
        target_refs: resolveProseEntityRefs(lookup, labelIndex, text),
        priority_rank: 100 + idx, // coaching ranks deprioritised vs review cards
        // Wave-2 ask 1 (0.19.0): producer-owned guidance signals.
        ...guidanceSignalsForCoachingKind('assumption_check'),
        action_intent: 'confirm_factor' as ActionIntentLiteral,
        action_label: truncate('Confirm this assumption', ACTION_LABEL_MAX),
        // ROADMAP 2.225 — PRODUCER-AUTHORED, dispatched VERBATIM as the user's
        // next turn (UI #554). A hardcoded literal like every label above: the
        // contract forbids the consumer composing one, and forbids falling
        // back to `action_intent`/`action_label`, so the pill is dark until
        // this string exists. Imperative and self-contained, because the user
        // sees it become their own message.
        action_prompt: truncate(
          'Help me pressure-test this assumption before I rely on it.',
          ACTION_PROMPT_MAX,
        ),
      };
      const block = validateProseAndSchemaOrDrop(CoachingBlockSchema, candidate, {
        block_type: 'coaching',
        kind: 'assumption_check',
        prose: [
          { name: 'title', value: candidate.title },
          { name: 'body', value: candidate.body },
          { name: 'action_label', value: candidate.action_label },
          { name: 'action_prompt', value: candidate.action_prompt },
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
      // Resolved BEFORE the candidate so the emit/omit decision is one
      // expression and the spread below cannot half-apply it.
      const dskClaimProvenance = dskClaimProvenanceForPrompt(e);
      const candidate = {
        ...commonMetadata('coach:calibration', String(idx), ctx),
        type: 'coaching' as const,
        coaching_kind: 'calibration_prompt' as const,
        title: truncate(titleText, TITLE_MAX),
        body: truncate(question, BODY_MAX),
        source: 'decision_review' as const,
        // 1.135: link entity names in the calibration question prose.
        target_refs: resolveProseEntityRefs(lookup, labelIndex, question),
        priority_rank: 200 + idx,
        ...guidanceSignalsForCoachingKind('calibration_prompt'),
        action_intent: 'start_guided_chat' as ActionIntentLiteral,
        action_label: truncate('Try this prompt', ACTION_LABEL_MAX),
        // ROADMAP 2.225 — the ONE producer whose prompt is not a fixed
        // literal, deliberately: the card's whole proposition is "Try THIS
        // prompt", and the calibration question IS the prompt. Dispatching a
        // generic stand-in would send something the user never saw, while the
        // question they DID see sat one line above it. Still
        // producer-authored (the model wrote it, this producer chose it), and
        // still verbatim — no templating, no interpolation.
        action_prompt: truncate(question, ACTION_PROMPT_MAX),
        // ROADMAP 2.964 — the DSK claim badge. `e` is the ONE place carrying
        // both the grounding verdict and the cited id; until now this mint read
        // `question` + `principle` and dropped the lineage on the floor. See
        // `dskClaimProvenanceForPrompt` for the emit/omit rule and why the
        // triple is re-resolved from the bundle rather than copied from `e`.
        ...(dskClaimProvenance !== null
          ? { dsk_claim_provenance: dskClaimProvenance }
          : {}),
      };
      const block = validateProseAndSchemaOrDrop(CoachingBlockSchema, candidate, {
        block_type: 'coaching',
        kind: 'calibration_prompt',
        prose: [
          { name: 'title', value: candidate.title },
          { name: 'body', value: candidate.body },
          { name: 'action_label', value: candidate.action_label },
          { name: 'action_prompt', value: candidate.action_prompt },
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
    // ROADMAP 2.225 — producer-authored, dispatched verbatim (UI #554).
    action_prompt: truncate(
      'Re-run the analysis so the insights match my current decision graph.',
      ACTION_PROMPT_MAX,
    ),
  };
  return validateProseAndSchemaOrDrop(CoachingBlockSchema, candidate, {
    block_type: 'coaching',
    kind: 'stale_rerun',
    prose: [
      { name: 'title', value: candidate.title },
      { name: 'body', value: candidate.body },
      { name: 'action_label', value: candidate.action_label },
      { name: 'action_prompt', value: candidate.action_prompt },
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
/**
 * Wave-3 σ (ROADMAP 1.203) — THE field-level claim-safety chokepoint for the
 * Phase-3 value-surfacing path. Every builder that would surface a
 * science-bearing enrichment field's VALUE must pass it through here first: the
 * cage (`classifyClaimUsable`, compose/claim-safety-cage.ts) decides whether this
 * surface may claim about `field`. On a PASS the value is returned unchanged; on
 * a DENY the field is OMITTED (returns `null` — fail-closed to silence, never
 * rewrite, never a "suppressed" caption) and a reason-tagged
 * `v5.claim_cage.field_evaluated` event fires so the deny is observable, never a
 * silent no-op (the broken-alarm class). Content-free: the event carries the
 * field NAME + decision + reason tag, never the value.
 *
 * Today no live lens surfaces a value (every lens is claim-safe by omission), so
 * routing through here is BYTE-INERT on the current wire — it stands ready for
 * the first value-surfacing λ / P1 increment, which will do
 * `const v = composeCagedField(field, realValue, gate); if (v !== null) attach(v)`.
 *
 * Scope-honest: the cage keys on the field NAME. It gates WHETHER a surface may
 * claim about a field / an uncomputed-or-stale field — NOT whether a value under
 * the right name was sourced from the WRONG field (the win%-as-target-fit
 * MISLABEL class; that is builder-grounding + the ζ conformance harness).
 */
export function composeCagedField<T>(
  field: string,
  value: T,
  gateInput: ClaimUsableInput,
): T | null {
  const decision = classifyClaimUsable(field, gateInput);
  if (decision.usable) {
    emit(TelemetryEvents.V5ClaimCageFieldEvaluated, { field, decision: 'allowed' });
    return value;
  }
  emit(TelemetryEvents.V5ClaimCageFieldEvaluated, {
    field,
    decision: 'denied',
    reason: decision.reason,
  });
  return null;
}

/**
 * Companion-status claim-safety input for `field` (Brief 5 §10), derived from the
 * fact enrichment. Claim-safe when the field's explicit `<field>_status` reads
 * `'computed'`; for a field with no separate status key, when the field itself is
 * present as a non-empty computed structure. Defensive + fail-closed: absent or
 * non-`'computed'` ⇒ false.
 */
/**
 * F9 (2026-07-24): strict per-field value schemas for the three allow-listed
 * companion fields ({@link TIER2_CANDIDATE_FIELDS}). When the explicit
 * `<field>_status` is ABSENT, the OLD heuristic admitted ANY non-null scalar/object
 * or non-empty array as claim-safe — so `confidence_tier: ""`, `robustness: {}`,
 * `confidence_tier: false`, `confidence_tier: 0` and `factor_sensitivity: [{}]` all
 * passed. These validate the VALUE strictly instead.
 *
 * DERIVED from the real PLoT enrichment shape (a factor_id-bearing sensitivity row,
 * a non-empty tier LABEL, a non-empty robustness object) — deliberately NOT the
 * ENRICH_FACTORS *input* namesake `FactorSensitivityInput` ({factor_id, elasticity,
 * rank}), which the live `enrichment.factor_sensitivity` does not carry (it uses
 * influence_score/influence_rank/confidence) — binding to it would over-block a
 * legitimately-computed value. A NEW allow-listed field with no entry here fails
 * CLOSED (deny), the safe default for a claim-safety cage.
 */
const COMPANION_VALUE_SCHEMAS: Readonly<Record<string, (value: unknown) => boolean>> = Object.freeze({
  // A confidence tier LABEL — a non-empty, non-whitespace string.
  confidence_tier: (value) => typeof value === 'string' && value.trim().length > 0,
  // A non-empty array of factor-sensitivity rows, each an object bearing a
  // non-empty string `factor_id`. Rejects `[]` and `[{}]`.
  factor_sensitivity: (value) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((row) => {
      const r = readRecord(row);
      return r !== null && typeof r.factor_id === 'string' && r.factor_id.length > 0;
    }),
  // A non-empty object. Rejects `{}`, scalars and arrays.
  robustness: (value) => {
    const r = readRecord(value);
    return r !== null && Object.keys(r).length > 0;
  },
});

export function deriveCompanionClaimSafe(fact: RunAnalysisHandlerFact, field: string): boolean {
  const enrichment = readRecord((fact.result as Record<string, unknown>).enrichment);
  if (enrichment === null) return false;
  const status = enrichment[`${field}_status`];
  // Fail CLOSED on ANY present status, not only a string one (egress-F2,
  // 2026-07-24). A present-but-malformed `<field>_status` (object/number/bool —
  // e.g. an upstream enrichment drift to `{state:'computed'}`) must DENY, not
  // fall through to the value branch and read as claim-safe. Only a genuinely
  // absent status defers to the strict per-field value schema below.
  if (status !== undefined) return status === 'computed';
  // F9: absent status ⇒ validate the VALUE against its strict field schema
  // (never the old loose non-null/non-empty-array heuristic).
  const validate = COMPANION_VALUE_SCHEMAS[field];
  return validate !== undefined && validate(enrichment[field]);
}

/**
 * Capability layer P1 — the lens surface for one fact: the suggestion block
 * that reached the wire AND the selection that produced it, together.
 *
 * WHY THE PAIR IS RETURNED RATHER THAN RE-DERIVED. The P1 companion block
 * (`buildLensCompanionBlocks`) must accompany EXACTLY the lens the suggestion
 * announced. Calling `selectLens` a second time at the companion site would be
 * two derivations of one fact over inputs that a future refactor can let
 * diverge — the same shape as the two `generateGraphHash` twins and the
 * re-derived constraint verdict this funnel's own comment refuses (CLAUDE.md
 * trap 12/16). One selection, threaded.
 */
export interface LensSurface {
  /** The coaching block that SURVIVED the prose/schema gate. */
  readonly suggestion: CoachingBlock;
  /** The selection that produced it — the companion's only key. */
  readonly selection: LensSelection;
}

/**
 * ROADMAP 2.989 — the fragile-edge offer's user-facing parts, composed from the
 * ONE selected relationship. `null` for every other lens.
 *
 * ⚠ THE ACCEPTANCE TEXT HAS TO CLEAR THREE INDEPENDENT GATES, and it is asserted
 * against all three rather than eyeballed (`__tests__/fragile-edge-offer.test.ts`):
 *   1. `EDIT_GRAPH_POSITIVE_REGEX` must MATCH — otherwise the turn never reaches
 *      the `edit_graph` dispatch and the chip is inert (2.770: no inert chips).
 *      "Adjust" is in the positive verb set.
 *   2. `EDIT_GRAPH_NEGATIVE_REGEX` must NOT match — a meta-question veto. This is
 *      not a formality: the veto set includes `flip`, `explain`, `why`, `tell me`,
 *      `show me`, so the obvious phrasings of a fragility offer ("…that could flip
 *      the result", "tell me the new value") are exactly the ones that would
 *      silently stop dispatching.
 *   3. `scanProse` — no bare `0.x` decimal, no slug-shaped entity id, no forbidden
 *      phrase. This is why the text names the endpoints by LABEL and carries no
 *      number, and why a label that itself trips a gate DROPS the whole block
 *      rather than shipping a half-honest one (fail-closed, pinned by test).
 *
 * NO NUMERIC TARGET IS STATED, and that is the ruling rather than a gap: nothing
 * in the enrichment computes a RECOMMENDED new strength. `flip_mean` is the value
 * at which the ranking flips — advising the user to set it there would be both a
 * Tier-3 disclosure and backwards advice. The user supplies the number; the draft
 * is prefilled and editable, which is row 3.17's ratified fulfilment channel (a
 * pre-filled natural-language turn, measured 3/3 on staging — NOT a bare chip,
 * which measured 0/5 precisely because it carried no entity and no strength).
 */
interface FragileEdgeOffer {
  readonly body: string;
  readonly targetRefs: readonly TargetRef[];
  readonly actionLabel: string;
  readonly actionPrompt: string;
}

/** The label the acceptance chip carries. Producer-authored, fixed. */
export const FRAGILE_EDGE_ACTION_LABEL = 'Adjust this relationship';

/** Compose the acceptance turn. Exported so the routing gates can be asserted on
 *  the EXACT string the block ships, not on a re-spelling of it. */
export function composeFragileEdgeActionPrompt(fromLabel: string, toLabel: string): string {
  return `Adjust the strength of the link from ${fromLabel} to ${toLabel} in my model.`;
}

/**
 * The sentence that NAMES the relationship. It LEADS the body, and the lens's
 * generic tail follows — because the body is truncated at {@link BODY_MAX} and
 * a naming sentence placed last is the first thing truncation eats (measured:
 * the naming-last ordering silently dropped the second endpoint label on the
 * live capture, so the card named half a relationship).
 */
export function composeFragileEdgeNaming(fromLabel: string, toLabel: string): string {
  return `On this run the link from ${fromLabel} to ${toLabel} is the relationship the result leans on most.`;
}

/** Naming sentence first, the lens's generic tail second. */
export function composeFragileEdgeBody(base: string, fromLabel: string, toLabel: string): string {
  return `${composeFragileEdgeNaming(fromLabel, toLabel)} ${base}`;
}

function buildFragileEdgeOffer(selection: LensSelection): FragileEdgeOffer | null {
  if (selection.lens !== 'fragile_edge_resolution') return null;
  const edge = selection.fragileEdge;
  // Fail closed. The evaluator only fires with a selection, so this is
  // unreachable through `selectLens` — it is here because a lens id and its
  // payload travelling as two separate fields is exactly the pairing a future
  // refactor can break, and the honest failure is NO OFFER, never a half one.
  if (edge === undefined) return null;
  // FAIL CLOSED ON A HALF-NAMED RELATIONSHIP. Endpoint labels are producer data
  // and are not length-bounded; if the naming sentence alone would not survive
  // `BODY_MAX`, truncation would ship a card that names one endpoint and trails
  // off — worse than no offer, because it still carries an action chip.
  if (composeFragileEdgeNaming(edge.fromLabel, edge.toLabel).length > BODY_MAX) return null;
  return {
    body: composeFragileEdgeBody(selection.body, edge.fromLabel, edge.toLabel),
    // The EDGE identity, with the schema's own `edge` kind — `id` is the
    // `from→to` composite `tools/handlers/adjust-edge-strength.ts::parseEdgeId`
    // accepts, so the thing the card points at and the thing the handler
    // resolves are one string, not two spellings of one idea.
    targetRefs: [
      {
        id: edge.edgeIdentity,
        label: `${edge.fromLabel} → ${edge.toLabel}`,
        kind: 'edge' as const,
      },
    ],
    actionLabel: FRAGILE_EDGE_ACTION_LABEL,
    actionPrompt: composeFragileEdgeActionPrompt(edge.fromLabel, edge.toLabel),
  };
}

/**
 * ⚠ TEST-ONLY as of ROADMAP 2.211. Complete caller manifest at this tip
 * (`rg -a` over the whole repo excluding `node_modules`): this definition, one
 * prose mention in `lens-selector.ts`, and three spec files
 * (`lens-suggestion-block`, `claim-cage-wiring`, `ui-directive-focus`).
 * **Zero production callers.** The live path goes through
 * {@link buildLensSurface}, which `compose.ts` calls with the turn's lens
 * history.
 *
 * `previousAnalysisLens` is REQUIRED rather than optional on purpose. This
 * function is a second, live-LOOKING door into lens selection, and an optional
 * parameter is exactly how a future caller wires one up while silently
 * defaulting the history away — shipping a lens that ignores the
 * no-immediate-repeat rule with nothing going red. Required, the compiler makes
 * that a decision: pass the turn's history, or pass `null` and mean it.
 */
export function buildLensSuggestionCoachingBlock(
  fact: RunAnalysisHandlerFact,
  ctx: BlockBuildCtx,
  previousAnalysisLens: LensId | null,
): CoachingBlock | null {
  return buildLensSurface(fact, ctx, previousAnalysisLens)?.suggestion ?? null;
}

/**
 * Wave-3 λ (ROADMAP 1.203): the what-if lens's executor availability —
 * the ROADMAP 1.195 enable-gate (a code constant, CLEARED 2026-08-03 — see
 * `lens-selector.ts::WHATIF_SUGGESTION_GATE_CLEARED` for the derivation of why a
 * number-free offer is not what items 2/3/4 protect) AND the ISL transport being
 * configured (item 1: `config.isl.baseUrl` set ≡ `createCounterfactualClient() !== null`).
 * The transport leg is now the LIVE one: with `ISL_BASE_URL` unset this is still
 * `false` and the proactive what-if suggestion cannot fire.
 *
 * EXPORTED and shared (ROADMAP 2.211) because there are now THREE `selectLens`
 * call sites for one turn — the suggestion block, the `focus` ui_directive, and
 * the prior-lens replay — and they must be handed the SAME availability. Three
 * copies of this literal is the two-derivations-of-one-fact shape the funnel's
 * own comments refuse (CLAUDE.md trap 12/16); the env read still happens at the
 * compose layer, keeping `lens-selector.ts` env-free.
 */
export function liveLensExecutorAvailability(): LensSelectorOptions {
  return {
    executorAvailable: {
      what_if_counterfactual: whatIfSuggestionExecutorAvailable(Boolean(config.isl.baseUrl)),
    },
  };
}

export function buildLensSurface(
  fact: RunAnalysisHandlerFact,
  ctx: BlockBuildCtx,
  previousAnalysisLens?: LensId | null,
): LensSurface | null {
  // ROADMAP 2.989 — ONE derivation of the fragile-edge decision for this turn,
  // computed HERE and threaded into the selector, because this site has to emit
  // its telemetry (both arms) and a selector that emitted its own would stop
  // being pure. `selectFragileEdge` is pure and total, so the threaded value and
  // the value `selectLens` would have computed for itself are the same by
  // construction — pinned by a threaded-vs-omitted equality test.
  const enrichment = (fact.result as Record<string, unknown>).enrichment;
  const fragileEdgeDecision = selectFragileEdge(enrichment);

  // THE DECISION IS THE OBSERVABLE, NOT THE OFFER. A refusal is a first-class
  // outcome of this loop ("the run has nothing honest to offer"), so it is
  // emitted on the same event as a selection with a closed `refusal_reason`.
  // Emitted BEFORE the lens race, because the decision is a property of the run
  // and not of which lens happened to win the slot: gating it on the win would
  // make the refusal rate unmeasurable on exactly the turns another lens took.
  emit(TelemetryEvents.V5FragileEdgeSelection, {
    rationale_code: 'FRAGILE_EDGE_RESOLVABLE',
    e_value_joined: fragileEdgeDecision.eValueJoined,
    stability_band: fragileEdgeDecision.stabilityBand,
    refusal_reason: fragileEdgeDecision.refusalReason,
  });

  const selection = selectLens(fact, {
    ...liveLensExecutorAvailability(),
    // ROADMAP 2.211 — the no-immediate-repeat tie-break's ONE input. Omitted /
    // null ⇒ byte-identical to the pre-amendment selection.
    previousAnalysisLens: previousAnalysisLens ?? null,
    fragileEdge: fragileEdgeDecision,
  });
  if (selection === null) return null;

  // ROADMAP 2.989 — the offer, present on exactly one lens. `offer` is `null`
  // for every other lens, so the spreads below are byte-inert on them.
  const offer = buildFragileEdgeOffer(selection);
  // THE LENS EXISTS ONLY TO CARRY THE OFFER. Its body's opening clause has no
  // antecedent without the naming sentence ("Change IT and…"), and its whole
  // proposition is an action. So an offer that could not be composed drops the
  // SURFACE, not just the action fields — a lens card with neither the named
  // relationship nor a chip is a card about nothing.
  if (selection.lens === 'fragile_edge_resolution' && offer === null) return null;

  const candidate = {
    ...commonMetadata(`coach:lens:${selection.lens}`, selection.lens, ctx),
    type: 'coaching' as const,
    coaching_kind: 'strengthen' as const,
    title: truncate(selection.title, TITLE_MAX),
    body: truncate(offer?.body ?? selection.body, BODY_MAX),
    source: 'deterministic_signal' as const,
    target_refs: (offer?.targetRefs ?? []) as readonly TargetRef[],
    priority_rank: 15,
    // Wave-2 ask 1 (0.19.0) + 1.120 residual (0.21.0): producer-owned guidance
    // signals for `strengthen` (category could_fix, signal_code STRENGTHEN_ITEM)
    // — except on the fragile-edge offer, whose detector class is result
    // fragility (see `guidance-signals.ts::fragileEdgeOfferSignals`).
    ...(offer !== null ? fragileEdgeOfferSignals() : guidanceSignalsForCoachingKind('strengthen')),
    // ROADMAP 2.989 — the ACTION. ⚠ NO `action_intent`, and that is derived,
    // not forgotten. `ActionIntentLiteral` is a CLOSED 15-value schema enum with
    // no edge-mutation member; its nearest value, `edit_factor`, would state a
    // wrong OBJECT on a producer-owned field (the schema's own `TargetRefKind`
    // distinguishes `factor` from `edge`) — the wrong-object class ROADMAP 2.392
    // exists to kill, and the field two UI block renderers record as "wiring
    // action_intent to turn dispatch is a recorded follow-up". Measured at the
    // deployed UI tip: the chip is live on `action_label` + `action_prompt` and
    // `action_intent` is never dispatched (it rides as a data-* attribute).
    // Omitting it costs nothing and promises nothing false.
    ...(offer !== null
      ? {
          action_label: truncate(offer.actionLabel, ACTION_LABEL_MAX),
          action_prompt: truncate(offer.actionPrompt, ACTION_PROMPT_MAX),
        }
      : {}),
  };
  const block = validateProseAndSchemaOrDrop(CoachingBlockSchema, candidate, {
    block_type: 'coaching',
    kind: 'strengthen',
    prose: [
      { name: 'title', value: candidate.title },
      { name: 'body', value: candidate.body },
      // ROADMAP 2.989: the action fields are user-facing prose too — the chip
      // caption and the turn text the user sends in their own name — so they go
      // through the SAME guard as the body. Absent on every other lens, and
      // `scanProse` skips non-strings, so this is inert for them.
      { name: 'action_label', value: offer?.actionLabel },
      { name: 'action_prompt', value: offer?.actionPrompt },
    ],
  });
  if (block === null) return null;

  // Wave-3 σ (ROADMAP 1.203): route the field this lens grounds its claim in
  // through the claim-safety cage BEFORE the lens ever surfaces that field's
  // value. Today the lens ships prose-only (claim-safe by omission), so no value
  // is passed and the block above is emitted UNCHANGED regardless of the
  // verdict — this is BYTE-INERT on the wire. Its purpose is to make the cage a
  // LIVE caller on the exact field a lens claims about and its verdict
  // staging-observable (`v5.claim_cage.field_evaluated`), so the first
  // value-surfacing increment finds the gate already wired + proven. The return
  // is intentionally discarded (`void`): there is no value to attach yet — the
  // observable side-effect (the cage telemetry) is the whole point of wiring the
  // precondition before the payload.
  void composeCagedField(selection.groundingField, undefined, {
    tier2Enabled: TIER2_ACTIVATION_ENABLED,
    companionStatusClaimSafe: deriveCompanionClaimSafe(fact, selection.groundingField),
    // F8 (2026-07-24): pass ctx.freshness UNCHANGED. The cage denies absent
    // freshness (not_fresh) by design — the removed `?? 'fresh'` default turned
    // an OMITTED verdict into a claim-usable one, defeating the deny-by-default
    // freshness lock at the live caller. Deny-by-default now holds end-to-end.
    freshness: ctx.freshness,
  });

  // ⚠ KNOWN SKEW, PRE-EXISTING, DELIBERATELY NOT FIXED HERE (CEE #770 review B4).
  // This event fires when the block survives CONSTRUCTION. It does NOT mean the
  // block reached the wire: every lens suggestion is `coaching_kind:'strengthen'`,
  // which is in `LEADER_PRESUMING_COACHING_KINDS`, so the compose funnel DROPS it
  // on a withheld turn — after this line has already fired. So
  // `v5.capability.lens_suggestion_emitted` OVER-REPORTS by exactly the withheld
  // rate, and has since #632.
  //
  // The P1 companion's own event (`V5LensCompanionEmitted`) is fired from the
  // funnel instead, for exactly this reason — so the two events are NOT
  // comparable one-to-one: companion < suggestion partly by gating, partly by
  // this skew. Anyone sizing P1 uptake from that ratio must account for it.
  //
  // Not fixed in #770: moving it changes the semantics of a shipped P0
  // observability surface and rewrites its existing unit assertion
  // (`lens-suggestion-block.test.ts` drives this builder directly). That is a
  // reviewable behaviour change in its own right, not a drive-by. ROWED.
  // DSK slice 1 — provenance rides TELEMETRY, not the wire: the ExerciseBlock
  // schema at 0.32.0 is `.strict()` with no dsk field, so the protocol/trigger
  // ids a DSK lens was derived from are stamped here (attested against the
  // bundle bytes by `dsk-provenance-attestation.test.ts`). Keys are ABSENT for
  // the non-DSK lenses — absence is the honest default, never an empty string.
  // ROADMAP 2.989 — THE OFFER REACHED THE COMPOSED RESPONSE.
  //
  // ⚠ THIS EVENT DELIBERATELY DOES NOT INHERIT THE SKEW DOCUMENTED BELOW. The
  // suggestion event fires on surviving CONSTRUCTION, which over-reports by
  // exactly the withheld rate because every `strengthen` block is dropped by
  // compose's leader-presuming filter on a withheld turn. An offer counted on a
  // turn where it was suppressed would make acceptance-vs-offer — the PR5
  // measurement this event exists for — silently wrong.
  //
  // So the emit is gated on the SAME predicate compose branches on, IMPORTED
  // rather than restated (`mayNameLeadingOptionForFact`, the per-fact leaf): one
  // pure function of one fact, evaluated twice, cannot disagree with itself. A
  // hand-copied kind list here would be the mirror class instead.
  if (offer !== null && mayNameLeadingOptionForFact(fact)) {
    emit(TelemetryEvents.V5FragileEdgeOfferEmitted, {
      // The fulfilment FAMILY, not a wire field: the composed prompt routes
      // through `edit_graph` to the registered `adjust_edge_strength` handler.
      // Deliberately not an `ActionIntentLiteral` — see the block mint above for
      // why the wire carries no `action_intent`.
      action_intent: 'edit_graph',
      signal_code: fragileEdgeOfferSignals().signal_code,
      graph_hash_at_generation: ctx.graph_hash_at_generation,
    });
  }

  const dskProvenance = LENS_DSK_PROVENANCE[selection.lens];
  emit(TelemetryEvents.V5LensSuggestionEmitted, {
    lens_id: selection.lens,
    rationale_code: selection.rationaleCode,
    graph_hash_at_generation: ctx.graph_hash_at_generation,
    ...(dskProvenance !== undefined
      ? {
          dsk_protocol_id: dskProvenance.protocolId,
          dsk_trigger_id: dskProvenance.triggerId,
        }
      : {}),
  });

  // ROADMAP 2.211 — the displaced/chosen PAIR, emitted only when the
  // no-immediate-repeat tie-break actually moved the slot. Fired here rather
  // than inside `selectLens` so the selector stays a pure function, and AFTER
  // the prose/schema gate so it counts displacements that produced a real block
  // rather than displacements that were then discarded. It carries the same
  // known construction-vs-wire skew as the suggestion event above (both fire
  // before the withheld-arm filter) — sized identically, so the RATIO of
  // displaced to suggested is unaffected by it.
  if (selection.displacedLens !== undefined) {
    emit(TelemetryEvents.V5LensNoRepeatDisplaced, {
      displaced_lens_id: selection.displacedLens,
      chosen_lens_id: selection.lens,
      rationale_code: selection.rationaleCode,
      graph_hash_at_generation: ctx.graph_hash_at_generation,
    });
  }
  return { suggestion: block, selection };
}

// ============================================================================
// Capability layer P1 — structured lens COMPANION blocks (ROADMAP 1.183 P1).
// ============================================================================

/**
 * The structured artefact that accompanies the P0 lens suggestion.
 *
 * P0 ships the lens as coach TEXT. P1 attaches, for the lens `selectLens`
 * actually chose, the structured block the contract already carries and the UI
 * already renders — so the user gets the decision-science artefact, not only a
 * sentence about it.
 *
 * ── WHAT IS BUILT, AND — MORE IMPORTANTLY — WHAT IS NOT ─────────────────────
 * Exactly ONE companion is buildable at this tip, and the other two are blocked
 * by the claim-safety cage, not by effort. Recording the derivation here because
 * the next reader's first instinct will be to "finish the set":
 *
 *   pre_mortem            → ExerciseBlock (built — see below). Carries no
 *                           CEE-AUTHORED numeric fields (the emitted key set is
 *                           pinned by spec); the PROSE is the producer's, and
 *                           producer-authored numbers inside it are guarded only
 *                           against leading-decimal form. See the scope note on
 *                           `buildPreMortemExerciseBlock` — an earlier revision
 *                           of this line said "carries NO numbers at all: pure
 *                           producer prose", which was FALSE and is exactly the
 *                           label that teaches the next reader to stop looking.
 *
 *   sensitivity_flip_risk → FlipAnalysisBlock: NOT BUILT. The block's payload is
 *                           `flip_scenarios[].{current_value, flip_threshold}`,
 *                           whose only real source is `enrichment.flip_thresholds`
 *                           — a RATIFIED TIER-3 CLAIM-DENY key
 *                           (claim-safety-cage.ts TIER3_LEAK_BLOCK_FIELDS, whose
 *                           own header names this field as the canonical
 *                           "transport-clean, claim-denied" case). Surfacing it
 *                           is denied at the first fork of `classifyClaimUsable`,
 *                           both locks notwithstanding. The residual — a block
 *                           whose every numeric field is `null` — renders in the
 *                           live UI as "Factor: — → —" (V5FlipAnalysisBlock's
 *                           `formatValue` returns an em-dash for null). That is a
 *                           card that reads as an analysis and contains none:
 *                           the guarantee-theatre class this programme exists to
 *                           refuse. Unblocking it is a Tier-3 ratification
 *                           decision, not a builder.
 *
 *   evpi_evidence_priority→ ComparisonBlock: NOT BUILT. Its payload is
 *                           `option_comparison[].win_probability`, and
 *                           `option_comparison` is deliberately NOT in Lock 2
 *                           (`TIER2_COACHING_ALLOWLIST`) — lens-selector.ts's
 *                           `GROUNDING_FIELD_BY_RATIONALE` comment states the
 *                           omission is intentional and serves as a live cage
 *                           DENIAL control. Adding it is Brief 4 gate G2: a
 *                           per-field decision with science sign-off, not a
 *                           build-lane edit. (The EVPI lens's evidence is already
 *                           surfaced first-class by the EvidenceBlocks.)
 *
 *   consider_opposite     → ExerciseBlock (DSK slice 1, deterministic): fixed
 *                           instruction copy in `counter_case`, target_ref =
 *                           the leading option via the shared lookup. No
 *                           producer-content dependency, so no review-card
 *                           coupling — the permission derivation that matters
 *                           here is the SELECTION itself (deterministic) plus
 *                           the permitted-arm positional gate.
 *
 *   devils_advocacy       → ExerciseBlock (DSK slice 1, deterministic): same
 *                           shape, target_ref = the dominant factor the
 *                           selection named (identity-threaded subjectRef).
 *
 *   what_if_counterfactual→ nothing, and this is now LOAD-BEARING rather than
 *                           incidental. Before 2026-08-03 the lens could not
 *                           fire at all (WHATIF_SUGGESTION_GATE_CLEARED === false),
 *                           so "no companion" cost nothing. The gate is now
 *                           cleared and the empty return is what keeps the
 *                           activated suggestion NUMBER-FREE: adding a companion
 *                           here would put an executed counterfactual's values in
 *                           front of a user while ROADMAP 1.195 items 2/3/4 (ISL
 *                           model-fidelity probe · owner-placement ·
 *                           target-semantics) are still open. Do not "finish the
 *                           set" until those close.
 *
 * ── WITHHELD-VERDICT DISCIPLINE ────────────────────────────────────────────
 * Companions are appended by `rebuildPhase3BlocksFresh` on the PERMITTED arm
 * only. That is not belt-and-braces, it is required: every lens suggestion is
 * `coaching_kind: 'strengthen'`, which is in `LEADER_PRESUMING_COACHING_KINDS`,
 * so on a withheld turn the suggestion itself is dropped. A companion surviving
 * that drop would be an orphan structured artefact on precisely the turn the
 * disclosure withholds — the R3-M2 shape. It also cannot be caught by the
 * existing `presumesLeadingOption` predicate, which keys on
 * `card_kind`/`coaching_kind`: an ExerciseBlock has neither, and
 * comparison/flip_analysis are `.strict()` with no metadata at all, so no wire
 * tag could ever carry the verdict. Placement inside the permitted branch is
 * the only gate that cannot rot into a hand-kept type list (trap 12).
 */
export function buildLensCompanionBlocks(
  fact: RunAnalysisHandlerFact,
  ctx: BlockBuildCtx,
  selection: LensSelection,
  reviewCards: readonly ReviewCardBlock[],
  lookup: GraphNodeLookup,
): readonly ExerciseBlock[] {
  // Compile-exhaustive over `LensId`: a NEW lens fails the build here until it
  // declares its companion (or declares that it has none). Fail-loud on drift,
  // never a silent default.
  switch (selection.lens) {
    case 'pre_mortem': {
      const block = buildPreMortemExerciseBlock(fact, ctx, reviewCards);
      return block === null ? [] : [block];
    }
    case 'consider_opposite': {
      // Subject: the leading option the disconfirmation argues against —
      // resolved through the shared lookup, fail-closed to [] on miss.
      const leadingOptionId =
        typeof fact.result.leading_option_id === 'string' &&
        fact.result.leading_option_id.length > 0
          ? fact.result.leading_option_id
          : null;
      const block = buildDskExerciseBlock(
        'consider_opposite',
        CONSIDER_OPPOSITE_COUNTER_CASE,
        leadingOptionId,
        ctx,
        lookup,
      );
      return block === null ? [] : [block];
    }
    case 'devils_advocacy': {
      // Subject: the dominant factor the selection named (identity-threaded
      // from the SAME selectLens hit — never a re-derivation).
      const block = buildDskExerciseBlock(
        'devils_advocacy',
        DEVILS_ADVOCACY_COUNTER_CASE,
        selection.subjectRef?.id ?? null,
        ctx,
        lookup,
      );
      return block === null ? [] : [block];
    }
    // ROADMAP 2.989 — `fragile_edge_resolution` declares NO companion,
    // deliberately: its executor is not a deterministic exercise block, it is
    // the `edit_graph` turn the suggestion's own action chip dispatches. A
    // companion would be a second structured artefact about an offer whose
    // whole point is one acceptance.
    case 'sensitivity_flip_risk':
    case 'evpi_evidence_priority':
    case 'fragile_edge_resolution':
    case 'what_if_counterfactual':
      return [];
    default: {
      // Exhaustiveness is kept by the `never` binding (a new LensId fails the
      // BUILD here). But the RUNTIME value must be a typed empty, not the
      // narrowed variable: `return exhaustive` returns whatever unexpected value
      // actually arrived — at runtime a string, where the caller spreads a
      // `readonly ExerciseBlock[]`. Compile-safe, runtime-nonsense. Fail closed
      // to "no companion" instead, which is this module's safe direction
      // everywhere else.
      const exhaustive: never = selection.lens;
      void exhaustive;
      return [];
    }
  }
}

// ============================================================================
// DSK slice 1 — deterministic exercise companions (consider_opposite /
// devils_advocacy)
// ============================================================================

/**
 * Fixed exercise copy for the two DSK lenses. DETERMINISTIC BY DESIGN, and the
 * difference from the pre_mortem companion is the point, not an economy:
 * the decision_review completion carries NO disconfirmation / devil's-advocate
 * object (`composeFragments` — `decompose.ts` — is the complete field set), so
 * there is no producer prose to carry verbatim, and inventing case-specific
 * prose here would be fabrication. What CAN be authored deterministically is
 * the exercise INSTRUCTION itself — the same class of fixed, prose-guard-clean
 * copy as `TITLE_BY_LENS` / `BODY_BY_RATIONALE`. The card's specificity comes
 * from its `target_refs` (the leading option / the dominant factor, resolved
 * by identity through the shared lookup), never from interpolated prose — no
 * label, number, or id ever rides these strings.
 *
 * `counter_case` is the carrier for BOTH kinds: it is the contract's
 * argue-the-other-side prose slot, the live UI renders it as the card body
 * (`V5ExerciseBlock.tsx`, testid `v5-exercise-counter-case`, verified at DGAI
 * staging `dae8908f`), and the UI drops a prose-less exercise — so the fixed
 * instruction is also what keeps the card renderable.
 */
const CONSIDER_OPPOSITE_COUNTER_CASE =
  'Take the opposite view for a moment: assume the option in front turns out to be the wrong choice. What would have to be true for that to happen? Write down the strongest argument against it, and note what evidence would confirm or rule out that argument.';

const DEVILS_ADVOCACY_COUNTER_CASE =
  'Argue against the factor this result leans on most: make the case that it is overstated, that it could move against you, or that something outside the model matters more. If the dissent uncovers a real weakness, adjust the model; if it does not, the result has earned more trust.';

/**
 * Build the deterministic ExerciseBlock companion for a DSK lens.
 *
 * - `subjectId` → `target_refs` through the shared {@link GraphNodeLookup},
 *   FAIL-CLOSED: an unresolvable subject yields `target_refs: []` (the card
 *   still renders on its prose), never a fabricated label (the same rule the
 *   `focus` directive follows on lookup miss).
 * - Routed through {@link validateProseAndSchemaOrDrop} like every Phase-3
 *   block — the strict `ExerciseBlockSchema` parse plus the prose guard, so a
 *   future edit to the copy banks above that introduces banned vocabulary, a
 *   raw decimal, or an id-shaped token drops the block rather than shipping it.
 * - At most ONE exercise per turn holds by construction (one lens per turn →
 *   one companion) — which is also the UI pacing contract: `phase3Pacing.ts`
 *   reserves exactly one default-expanded slot for the turn's exercise.
 */
function buildDskExerciseBlock(
  kind: 'consider_opposite' | 'devils_advocacy',
  counterCase: string,
  subjectId: string | null,
  ctx: BlockBuildCtx,
  lookup: GraphNodeLookup,
): ExerciseBlock | null {
  const subject = subjectId !== null ? lookup.get(subjectId) : undefined;
  // 0.37.0 / ROADMAP 2.490 slice 2 — the DSK attribution now reaches the USER,
  // not only telemetry. The id comes from `LENS_DSK_PROVENANCE` (the same
  // hand-written map `dsk-provenance-attestation.test.ts` attests against the
  // bundle bytes); the TITLE and STRENGTH are read from the bundle record
  // itself, never typed here. That asymmetry is the point: a title written in
  // this file could drift from the science it names and nothing would notice —
  // which is CEE #830's defect, where a badge printed prose that no record
  // backed. Resolution is fail-closed, so an unverifiable bundle costs the
  // badge and never the card.
  const provenanceId = LENS_DSK_PROVENANCE[kind]?.protocolId;
  const dskProvenance =
    provenanceId !== undefined ? resolveDskProtocolProvenance(provenanceId) : null;
  const candidate = {
    ...commonMetadata(`exercise:${kind}`, '', ctx),
    type: 'exercise' as const,
    exercise_kind: kind,
    counter_case: counterCase,
    target_refs: subject !== undefined ? [subject] : ([] as readonly GraphNodeRef[]),
    ...(dskProvenance !== null ? { dsk_provenance: dskProvenance } : {}),
  };
  return validateProseAndSchemaOrDrop(ExerciseBlockSchema, candidate, {
    block_type: 'exercise',
    kind,
    prose: [{ name: 'counter_case', value: counterCase }],
  });
}

/**
 * The pre-mortem lens's structured form: an `ExerciseBlock`
 * (`exercise_kind: 'pre_mortem'`) carrying the producer's `warning_signs`,
 * `mitigation` and `review_trigger`.
 *
 * WHY THOSE THREE FIELDS AND NOT `failure_scenario`. The v11 producer emits
 * `pre_mortem: { failure_scenario, warning_signs[], mitigation, grounded_in[],
 * review_trigger? }`. `buildPreMortemCard` renders ONLY `failure_scenario`
 * (as the "If things go wrong" review card body) and throws the other three
 * away: an `rg` over `src/` (non-test) finds no producer of `warning_signs` /
 * `mitigation` / `review_trigger` on any wire surface — the sole hits are
 * `output-safety.ts`'s defensive scrub arms for a block kind nothing emitted.
 * They are computed on every analysis and discarded. So this block is NEW
 * content, not a second rendering of the card above it — and it fabricates
 * nothing: every string is the producer's own, verbatim.
 *
 * ⚠ WHAT "NO FABRICATION" DOES AND DOES NOT MEAN HERE — the honest scope, after
 * CEE #770's adversarial review (B2) found the first wording overstated.
 *
 *   TRUE, and enforced: this builder authors NO numeric field of its own. The
 *   emitted key set is pinned exactly by `lens-companion-blocks.test.ts`, so a
 *   builder that invents any field — numeric or prose — REDs; and every emitted
 *   string is asserted byte-identical to a member of the producer's own
 *   `pre_mortem` object, so interpolation REDs too.
 *
 *   NOT TRUE, and NOT claimed: that the block carries no numbers. These strings
 *   are authored by the R3 decision_review completion, whose PROMPT INPUT
 *   includes the Tier-3-denied `flip_thresholds` values and fragile-edge
 *   probabilities, and which is taught a verbatim `'16000 GBP'` value format.
 *   `scanProse`'s `RAW_DECIMAL_RE` catches LEADING-DECIMAL form only — `'16000
 *   GBP'`, `'55%'` and `'~0.55'` all pass it (probe: 4/4). So a producer-authored
 *   number CAN ride these fields.
 *
 *   WHY THAT IS NOT A BLOCKER FOR THIS INCREMENT, stated rather than assumed:
 *   the identical channel already ships at base. `buildPreMortemCard` surfaces
 *   `failure_scenario` from the SAME completion, and `buildFlipThresholdCards`
 *   ships narratives the prompt ORDERS to restate unrounded flip values. This
 *   block adds no new defect class — it adds three more fields to a carrier that
 *   already exists. The open question (is the Tier-3 deny composition-only by
 *   design, or do LLM prose echoes need a numeric-token scan?) is ROADMAP 2.205:
 *   a design ruling with its own lane, because a blanket numeric block would gut
 *   legitimate prose ("review in 3 months").
 *
 * WHY IT IS COUPLED TO THE SURVIVING REVIEW CARD. The same prose object is
 * already governed by four independent drop rules inside `buildPreMortemCard`
 * (lever-named, grounding lookup-miss, context-unanchored, prose guard/schema).
 * Restating any of them here would be a second hand-kept copy of a safety rule
 * — the dominant defect class. Instead this builder DERIVES its permission:
 * the exercise ships only when the pre_mortem review card built from the same
 * object survived, and it reuses that card's already-resolved `target_refs`.
 * Every present and future rule the card gains is inherited for free; a rule
 * that starts dropping the card automatically stops the exercise.
 */
function buildPreMortemExerciseBlock(
  fact: RunAnalysisHandlerFact,
  ctx: BlockBuildCtx,
  reviewCards: readonly ReviewCardBlock[],
): ExerciseBlock | null {
  const card = reviewCards.find((c) => c.card_kind === 'pre_mortem');
  if (card === undefined) return null;

  const dr = readDecisionReview(fact);
  if (dr === null) return null;
  const pm = readRecord(dr.pre_mortem);
  if (pm === null) return null;

  const allWarningSigns = (Array.isArray(pm.warning_signs) ? pm.warning_signs : []).flatMap(
    (raw) => {
      if (typeof raw !== 'string') return [];
      const trimmed = raw.trim();
      return trimmed.length > 0 ? [truncate(trimmed, BODY_MAX)] : [];
    },
  );
  // Bound to `WARNING_SIGNS_MAX` — a hand-kept mirror of the decision_review
  // prompt's own declared bound ("up to 3"), NOT a value read from it at
  // runtime. See the constant's docstring for why it is a mirror and for the
  // fail-loud derivation guard that REDs if the prompt and the constant drift.
  // The ExerciseBlock schema sets no max, so without this an over-long model
  // return rides to the UI as an unbounded bullet list. Truncation is DISCLOSED
  // (never silent): a producer exceeding its own declared bound is a drift
  // signal worth seeing, not noise to swallow.
  const warningSigns = allWarningSigns.slice(0, WARNING_SIGNS_MAX);
  if (allWarningSigns.length > warningSigns.length) {
    emit(TelemetryEvents.V5LensCompanionTruncated, {
      lens_id: 'pre_mortem',
      field: 'warning_signs',
      received: allWarningSigns.length,
      kept: warningSigns.length,
    });
  }
  const mitigation =
    typeof pm.mitigation === 'string' && pm.mitigation.trim().length > 0
      ? truncate(pm.mitigation.trim(), BODY_MAX)
      : undefined;
  const reviewTrigger =
    typeof pm.review_trigger === 'string' && pm.review_trigger.trim().length > 0
      ? truncate(pm.review_trigger.trim(), BODY_MAX)
      : undefined;

  // Fail closed on a content-less card. This is not defensive padding: the live
  // UI adapter (`src/v5/phase3TypedBlocks.ts::adaptTypedExerciseBlock`) drops a
  // schema-valid exercise carrying no producer prose, so a content-less block
  // would ARRIVE and never render — the arrived-unrendered class, invisible from
  // this side. Refuse to emit it here instead.
  if (warningSigns.length === 0 && mitigation === undefined && reviewTrigger === undefined) {
    emitDrop({
      block_type: 'exercise',
      kind: 'pre_mortem',
      reason: 'no_producer_content',
      field: 'warning_signs|mitigation|review_trigger',
    });
    return null;
  }

  // `warning_signs` is an ARRAY, and `validateProseAndSchemaOrDrop`'s
  // terminology-rewrite patch is keyed by top-level field NAME — an indexed
  // pseudo-name would write a bogus key onto a `.strict()` candidate. So the
  // signs get the prose scan WITHOUT the rewrite fallback: any hit drops the
  // whole block. Strictly more conservative than the scalar path, deliberately.
  const signsHit = scanProse(
    warningSigns.map((value, i) => ({ name: `warning_signs[${i}]`, value })),
  );
  if (signsHit !== null) {
    emitDrop({
      block_type: 'exercise',
      kind: 'pre_mortem',
      reason: `prose_guard_${signsHit.reason}`,
      field: signsHit.field,
      sample: signsHit.sample,
    });
    return null;
  }

  const candidate = {
    ...commonMetadata('exercise:pre_mortem', '', ctx),
    type: 'exercise' as const,
    exercise_kind: 'pre_mortem' as const,
    ...(warningSigns.length > 0 ? { warning_signs: warningSigns } : {}),
    ...(mitigation !== undefined ? { mitigation } : {}),
    ...(reviewTrigger !== undefined ? { review_trigger: reviewTrigger } : {}),
    // Derived, not re-resolved: the card already turned `grounded_in` into
    // canonical refs and DROPPED itself when that resolution failed.
    target_refs: card.target_refs,
  };

  const block = validateProseAndSchemaOrDrop(ExerciseBlockSchema, candidate, {
    block_type: 'exercise',
    kind: 'pre_mortem',
    prose: [
      { name: 'mitigation', value: mitigation },
      { name: 'review_trigger', value: reviewTrigger },
    ],
  });
  // NOTE — no telemetry here, deliberately. Surviving this builder is NOT the
  // same event as reaching the wire: the funnel drops every companion on the
  // withheld arm AFTER this point. An "emitted" event fired here would report a
  // block the user never saw, on exactly the turns that matter most — a broken
  // alarm of the kind this estate has been bitten by. `V5LensCompanionEmitted`
  // fires at the funnel, from the permitted branch, where the wire decision is
  // actually made.
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

/**
 * ⚠ NOTE THE ABSENT PARAMETER: this builder takes NO `leverLabels`, and that is
 * a RULING, not an oversight.
 *
 * Doctrine D-U F2 bans NAMING an option-set lever as an uncertainty, and it is
 * applied on every other free-text decision-review surface (narrative,
 * scenario_context, calibration, assumption) plus the structural
 * `isLeverFactor` skip on the evidence surfaces. It used to be applied here
 * too — and it was eating the card.
 *
 * MEASURED (fix-2211-lens-emission.md §1.1–1.4, replayed over the walk's real
 * captured wire bytes): of the 4 turns where the producer emitted a
 * `pre_mortem` object, the `lever_named` guard dropped **2** — a 50% loss rate
 * on this card, from a guard written for a different surface. The attribution
 * was witnessed, not assumed (the discriminating a3/a5 pair).
 *
 * RULING (orchestrator, with the no-recommendations doctrine as the frame): a
 * pre-mortem is a different SPEECH ACT from the surfaces the ban protects. It
 * says "imagine the option you chose did not pay off — what broke?". Naming the
 * chosen lever as the thing that FAILED is a failure watch-point: coaching, not
 * steering. The ban stays, unchanged, everywhere naming a lever would steer a
 * choice; it is scoped out of THIS path only.
 *
 * Everything else on this path is untouched and still enforced — BIND (the
 * hypothetical frame) and ANCHOR (`context_unanchored`) both still drop. Do not
 * read this ruling as "ship anything".
 */
function buildPreMortemCard(
  dr: Record<string, unknown>,
  lookup: GraphNodeLookup,
  ctx: BlockBuildCtx,
): ReviewCardBlock | null {
  const pm = readRecord(dr.pre_mortem);
  // Previously a SILENT `return null`. On the walk this exit and the one below
  // accounted for 2 of 6 turns — so the two commonest causes of "no card" were
  // exactly the two the drop dashboard could not see, and it under-counted the
  // true drop rate by precisely the producer-absent rate. A counter that reads
  // healthy because it is blind is a broken alarm (CLAUDE.md trap 7).
  if (pm === null) {
    emitDrop({
      block_type: 'review_card',
      kind: 'pre_mortem',
      reason: 'producer_absent',
      field: 'pre_mortem',
    });
    return null;
  }
  const failure = typeof pm.failure_scenario === 'string'
    ? pm.failure_scenario.trim()
    : '';
  // Also previously silent — see the note above.
  if (failure.length === 0) {
    emitDrop({
      block_type: 'review_card',
      kind: 'pre_mortem',
      reason: 'failure_scenario_empty',
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

/**
 * ROADMAP 2.267 (D-2) — the smallest phrase that can stand for an option's
 * identity in prose. A single shared token cannot: the estate's own
 * "Equity Offered to CTO" vs bare "CTO" lesson (see {@link containsWholePhrase})
 * is the same over-match, and the witnessed narrative names the FACTOR
 * "Leeds Site Activation" in a graph that also has an option
 * "Open Second Warehouse in Leeds" — a one-token rule would read that as naming
 * the option.
 */
const OPTION_ALIAS_MIN_TOKENS = 2;

/**
 * ROADMAP 2.267 (D-2) — per-option, the phrases that IDENTIFY it in free text.
 *
 * ⚠ WHY WHOLE-LABEL MATCHING IS NOT ENOUGH, and why this exists rather than
 * reusing {@link resolveProseEntityRefs} unchanged. On the witnessed turn the
 * card read *"…the leading option changes between Leeds and the Status Quo"* and
 * the option's canonical label is **"Continue at Current Capacity (Status Quo)"**.
 * A whole-label scan returns ZERO hits on that sentence. A guard built on it
 * would pass the exact card it was written to stop — guarantee theatre, in the
 * house style. Measured, not assumed: the fixture in
 * `__tests__/flip-threshold-option-naming-guard.test.ts` pins both readings.
 *
 * So an option is also identified by any CONTIGUOUS RUN of ≥
 * {@link OPTION_ALIAS_MIN_TOKENS} tokens of its label — how people actually
 * shorten a name.
 *
 * ⚠ AND THE OVER-MATCH RAIL IS DERIVED FROM THE GRAPH, NOT HAND-LISTED
 * (CLAUDE.md trap 12). A candidate phrase is DISCARDED when it also occurs in
 * any other node's label, because then it does not distinguish this option from
 * that node. No stop-word list is maintained anywhere; add a node to the graph
 * and the rail moves with it.
 *
 * WHICH RAIL DOES WHAT, stated exactly rather than impressively — the two are
 * easy to conflate and only one of them is load-bearing per case:
 *   - a BARE token shared with a factor (`"leeds"`, also in the factor "Leeds
 *     Site Activation") never becomes a candidate at all, because a single
 *     token is below {@link OPTION_ALIAS_MIN_TOKENS}. The distinctiveness rail
 *     is not what saves that case.
 *   - a MULTI-token phrase shared with another node is what the rail is for.
 *     Its witnessed instance is run C: the option "Buy Vendor Platform" and the
 *     factor "Vendor Platform Approach" share `"vendor platform"`, and the
 *     narrative names the FACTOR. Without the rail that card is suppressed on
 *     any turn where that option is not already permitted — which is why the
 *     test for it deliberately moves `leading_option_id` off it, or it would
 *     pass while testing nothing.
 *
 * The shipped {@link LEVER_LABEL_MIN_LEN} / {@link GENERIC_LEVER_TOKENS} rails
 * still apply on top, so a one-word option called "Cost" never matches.
 */
function buildOptionIdentityNeedles(lookup: GraphNodeLookup): Map<string, readonly string[]> {
  const options: { readonly id: string; readonly norm: string }[] = [];
  const otherLabelNorms: string[] = [];
  for (const ref of lookup.values()) {
    const norm = normaliseForPhraseMatch(ref.label);
    if (norm.length === 0) continue;
    if (ref.kind === 'option') options.push({ id: ref.id, norm });
    else otherLabelNorms.push(norm);
  }

  const out = new Map<string, readonly string[]>();
  for (const option of options) {
    const tokens = option.norm.split(' ').filter((t) => t.length > 0);
    const candidates = new Set<string>([option.norm]);
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + OPTION_ALIAS_MIN_TOKENS; j <= tokens.length; j++) {
        candidates.add(tokens.slice(i, j).join(' '));
      }
    }
    const needles: string[] = [];
    for (const needle of candidates) {
      if (needle.length < LEVER_LABEL_MIN_LEN) continue;
      if (!needle.includes(' ') && GENERIC_LEVER_TOKENS.has(needle)) continue;
      // Derived distinctiveness — see the ⚠ above.
      if (options.some((o) => o.id !== option.id && containsWholePhrase(o.norm, needle))) continue;
      if (otherLabelNorms.some((n) => containsWholePhrase(n, needle))) continue;
      needles.push(needle);
    }
    out.set(option.id, needles);
  }
  return out;
}

/** Which options does this prose NAME? Ids, in lookup order; `[]` when none. */
function optionsNamedInProse(
  prose: string,
  needlesByOptionId: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const hay = normaliseForPhraseMatch(prose);
  if (hay.length === 0) return [];
  const named: string[] = [];
  for (const [optionId, needles] of needlesByOptionId) {
    if (needles.some((needle) => containsWholePhrase(hay, needle))) named.push(optionId);
  }
  return named;
}

function buildFlipThresholdCards(
  dr: Record<string, unknown>,
  lookup: GraphNodeLookup,
  ctx: BlockBuildCtx,
  attestedWinnerIdByFactorId: ReadonlyMap<string, string>,
  leadingOptionId: string | null,
): readonly ReviewCardBlock[] {
  if (!Array.isArray(dr.flip_thresholds)) return [];
  // Derived once per fact, and only when there is a card to guard.
  const optionNeedles =
    dr.flip_thresholds.length > 0
      ? buildOptionIdentityNeedles(lookup)
      : new Map<string, readonly string[]>();
  const out: ReviewCardBlock[] = [];
  let idx = 0;
  /**
   * How many bodies this fact swapped. Counted separately from the per-card
   * warning so the OVER-MATCH RATE is measurable before anyone tunes the
   * matcher: the per-card line says a phrase matched, this says how often, and
   * `card_count` gives it a denominator. Tuning the matcher on a guess about
   * its own hit rate is how a fix becomes an outage — the reasoning
   * `leading-option-egress-guard.ts` already applies to its observe-only mode.
   */
  let swappedCount = 0;
  for (const raw of dr.flip_thresholds) {
    // Amendment A1 — the row-shape gate now lives in ONE place, shared with the
    // ContextPack display licence (./flip-threshold-card-row.ts). The licence
    // must be the CARD's predicate, not a near-copy of it.
    const row = readFlipThresholdCardRow(raw);
    if (row === null) continue;
    const { factor_id: factorId, narrative } = row;
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
    // ────────────────────────────────────────────────────────────────────────
    // ROADMAP 2.267 — THE OPTION GUARD (defect D-2).
    //
    // The lookup gate above fail-closes on an LLM-invented FACTOR. There was no
    // equivalent for the OPTION, and on 2026-08-01 that cost us a false card:
    // the row attested `opt_bristol` / "Expand Existing Bristol Site" and the
    // shipped body said the leader changes to *"the Status Quo"* — an option
    // whose slope in that factor is zero, so it cannot take over at any value
    // (`witness-2265-targeted-flip.md` §4, §13). The Analysis tab renders the
    // CORRECT winner from the same field on the same turn, so the two surfaces
    // contradicted each other.
    //
    // WHAT MAY BE NAMED: only an option this fact ATTESTS — the row's own
    // alternative winner, or the run's `leading_option_id`. Anything else is
    // the model asserting an identity nothing gave it.
    //
    // WHY A BODY SWAP AND NOT A DROP. Dropping is what the factor gate does,
    // but a factor miss makes the whole card unanchored, whereas here the
    // factor, the direction and the two display values are all attested and
    // correct — only the NAME is invented. Dropping would delete the dock's
    // only flip surface to remove one clause. The fallback keeps the honest
    // card and loses the clause.
    //
    // MONOTONE BY CONSTRUCTION: this branch can only REMOVE a name that the
    // pre-2.267 code shipped verbatim. It never introduces prose that names an
    // option, so it cannot widen what the claim-safety cage permits — the cage
    // stays the sole authority on WHETHER a leader may be named; this guard
    // only answers WHICH.
    // ────────────────────────────────────────────────────────────────────────
    const attestedWinnerId = attestedWinnerIdByFactorId.get(factorId) ?? null;
    const unattestedNamedOptions = optionsNamedInProse(narrative, optionNeedles).filter(
      (optionId) => optionId !== attestedWinnerId && optionId !== leadingOptionId,
    );
    const namesUnattestedOption = unattestedNamedOptions.length > 0;
    if (namesUnattestedOption) {
      swappedCount++;
      log.warn(
        {
          event: 'v5.phase3.flip_option_naming_withheld',
          block_type: 'review_card',
          block_kind: 'flip_threshold',
          // Structural only — no prose, no labels, no graph ids.
          matched_option_count: unattestedNamedOptions.length,
          attested_winner_present: attestedWinnerId !== null,
          fallback_carries_displays: row.current_display !== null && row.flip_display !== null,
        },
        // ⚠ THIS MESSAGE DESCRIBES THE MECHANISM, NOT A VERDICT, AND THE
        // DIFFERENCE IS THE WHOLE POINT. Its first wording said the card "named
        // an option this run does not attest" — a claim the guard cannot
        // support. Adversarial review demonstrated the over-match directly: the
        // innocent aside *"relative to the status quo."* false-swaps 2 of the 3
        // live witness captures. A swap therefore means A PHRASE MATCHED, which
        // is sometimes a real wrong name and sometimes an aside. Writing the verdict
        // into the log would teach every future reader to stop looking — the
        // known-red-registry defect (CLAUDE.md trap 7b) planted at the source.
        'V5 Phase 3 flip card matched an option-identifying phrase it cannot attest; body replaced with the non-naming form',
      );
    }
    const candidate = {
      ...commonMetadata('review:flip', factorId, ctx),
      type: 'review_card' as const,
      card_kind: 'flip_threshold' as const,
      title: truncate(`What would flip the result on ${ref.label}`, TITLE_MAX),
      // Amendment A1(b) / exit 4 — the emitted body is now produced by the
      // SHARED function the display licence checks the digits against, so the
      // licence can never believe digits survived a cut they did not.
      body: namesUnattestedOption
        ? flipThresholdFallbackBody(ref.label, row.current_display, row.flip_display)
        : flipThresholdCardBody(narrative),
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
  if (swappedCount > 0) {
    log.info(
      {
        event: 'v5.phase3.flip_option_naming_swap_count',
        swapped_count: swappedCount,
        card_count: out.length,
      },
      'V5 Phase 3 flip cards with a swapped body on this fact',
    );
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

