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

import { randomUUID } from 'node:crypto';

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

import { log } from '../../utils/telemetry.js';
import { ENTITY_ID_LEAK_RE } from '../../orchestrator/shared/entity-id-pattern.js';
import { isSlugShapedEntityId } from '../../orchestrator/shared/output-safety.js';
import { findForbiddenPhraseHit } from './forbidden-user-facing-phrases.js';

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
const RAW_DECIMAL_RE = /(?:^|[\s(=,])(?:0\.\d|\.\d)/;

// ============================================================================
// Public API
// ============================================================================

export interface BlockBuildCtx {
  /** ISO 8601 timestamp with offset. Stamped onto every emitted block. */
  readonly created_at: string;
  /** Graph hash from `fact.result.graph_hash_at_run` — passes through to
   *  `graph_hash_at_generation` on every analysis-derived block. */
  readonly graph_hash_at_generation: string;
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
 * for ID-to-label-and-kind resolution. Defensive: skips nodes/edges missing
 * required fields and skips nodes whose `kind` is outside the v1.3
 * `TargetRefKind` union.
 *
 * Edge handling (round-4 review non-blocking follow-up): edges live under
 * `graph.edges[]` with `id`, `from_node_id`, `to_node_id`, and optionally
 * `label`. When `label` is missing, derive a human-readable label from
 * the endpoint node labels as `"<from> → <to>"`. When endpoints can't be
 * resolved (graph drift), skip the edge — the resulting scenario_context
 * card will drop downstream rather than emit an unresolved edge reference.
 */
export function buildGraphNodeLookup(
  fact: RunAnalysisHandlerFact,
): GraphNodeLookup {
  const lookup = new Map<string, GraphNodeRef>();
  const enrichment = readRecord(
    (fact.result as Record<string, unknown>).enrichment,
  );
  if (enrichment === null) return lookup;
  const graph = readRecord(enrichment.graph);
  if (graph === null) return lookup;

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

  // Pass 2: edges. Round-4 non-blocking follow-up — in production
  // `enrichment.graph` carries edges under `graph.edges[]`, not as
  // `kind: 'edge'` entries in `graph.nodes[]`. Without this pass, every
  // scenario_context card would drop in production (the round-3
  // fail-closed gate is correct; the lookup just needed to be wider).
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
      // either endpoint isn't in the node lookup (graph drift).
      const fromId = typeof e.from_node_id === 'string' ? e.from_node_id : null;
      const toId = typeof e.to_node_id === 'string' ? e.to_node_id : null;
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

  return lookup;
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
      : typeof e.id === 'string' ? e.id
      : null;
    if (factorId === null) continue;
    const c = e.confidence;
    if (typeof c !== 'number' || !Number.isFinite(c)) {
      // Omit — caller treats missing as "confidence unknown" and drops
      // the EvidenceBlock entirely. NEVER silently default to a band
      // that would mislabel severity.
      continue;
    }
    if (c >= 0.7) out.set(factorId, 'high');
    else if (c >= 0.3) out.set(factorId, 'medium');
    else out.set(factorId, 'low');
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
): readonly ReviewCardBlock[] {
  const dr = readDecisionReview(fact);
  if (dr === null) return [];
  const blocks: ReviewCardBlock[] = [];

  // narrative (rank 1)
  const narrative = buildNarrativeCard(dr, ctx);
  if (narrative !== null) blocks.push(narrative);

  // pre_mortem (rank 2) — optional in the LLM output
  const preMortem = buildPreMortemCard(dr, lookup, ctx);
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
  const evidencePriority = buildEvidencePriorityCard(dr, lookup, ctx);
  if (evidencePriority !== null) blocks.push(evidencePriority);

  // assumption (rank 7) — one per key_assumptions string
  blocks.push(...buildAssumptionCards(dr, ctx));

  // scenario_context (rank 8) — one per edge
  blocks.push(...buildScenarioContextCards(dr, lookup, ctx));

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
  _lookup: GraphNodeLookup,
  ctx: BlockBuildCtx,
): readonly CoachingBlock[] {
  const dr = readDecisionReview(fact);
  if (dr === null) return [];
  const blocks: CoachingBlock[] = [];

  // assumption_check — one per key_assumptions entry, ranked by order.
  if (Array.isArray(dr.key_assumptions)) {
    let idx = 0;
    for (const raw of dr.key_assumptions) {
      if (typeof raw !== 'string') continue;
      const text = raw.trim();
      if (text.length === 0) continue;
      idx++;
      const candidate = {
        block_id: randomUUID(),
        signal_id: stableSignalId('coach:assumption', String(idx), ctx),
        created_at: ctx.created_at,
        source_handler: SOURCE_HANDLER,
        graph_hash_at_generation: ctx.graph_hash_at_generation,
        freshness: 'fresh' as const,
        type: 'coaching' as const,
        coaching_kind: 'assumption_check' as const,
        title: truncate('An assumption to check', TITLE_MAX),
        body: truncate(text, BODY_MAX),
        source: 'decision_review' as const,
        target_refs: [] as readonly TargetRef[],
        priority_rank: 100 + idx, // coaching ranks deprioritised vs review cards
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
      idx++;
      const titleText = principle.length > 0
        ? `${principle} prompt`
        : 'Calibration prompt';
      const candidate = {
        block_id: randomUUID(),
        signal_id: stableSignalId('coach:calibration', String(idx), ctx),
        created_at: ctx.created_at,
        source_handler: SOURCE_HANDLER,
        graph_hash_at_generation: ctx.graph_hash_at_generation,
        freshness: 'fresh' as const,
        type: 'coaching' as const,
        coaching_kind: 'calibration_prompt' as const,
        title: truncate(titleText, TITLE_MAX),
        body: truncate(question, BODY_MAX),
        source: 'decision_review' as const,
        target_refs: [] as readonly TargetRef[],
        priority_rank: 200 + idx,
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
      block_id: randomUUID(),
      signal_id: stableSignalId('evidence', factorId, ctx),
      created_at: ctx.created_at,
      source_handler: SOURCE_HANDLER,
      graph_hash_at_generation: ctx.graph_hash_at_generation,
      freshness: 'fresh' as const,
      type: 'evidence' as const,
      factor_label: factorRef.label,
      factor_ref: { id: factorRef.id, label: factorRef.label, kind: 'factor' as const },
      target_refs: [{ id: factorRef.id, label: factorRef.label, kind: 'factor' as const }],
      current_confidence: currentConfidence,
      evidence_gap: truncate(rationale, BODY_MAX),
      suggested_technique: suggestedTechnique,
      impact_if_gathered: truncate(impact, BODY_MAX),
      priority_rank: rank,
      severity,
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

// ============================================================================
// ReviewCardBlock builders (one per card_kind)
// ============================================================================

function buildNarrativeCard(
  dr: Record<string, unknown>,
  ctx: BlockBuildCtx,
): ReviewCardBlock | null {
  if (typeof dr.narrative_summary !== 'string') return null;
  const body = truncate(dr.narrative_summary.trim(), BODY_MAX);
  if (body.length === 0) return null;
  const candidate = {
    block_id: randomUUID(),
    signal_id: stableSignalId('review:narrative', '', ctx),
    created_at: ctx.created_at,
    source_handler: SOURCE_HANDLER,
    graph_hash_at_generation: ctx.graph_hash_at_generation,
    freshness: 'fresh' as const,
    type: 'review_card' as const,
    card_kind: 'narrative' as const,
    title: truncate('How the analysis reads', TITLE_MAX),
    body,
    severity: 'info' as Phase3BlockSeverityLiteral,
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

function buildPreMortemCard(
  dr: Record<string, unknown>,
  lookup: GraphNodeLookup,
  ctx: BlockBuildCtx,
): ReviewCardBlock | null {
  const pm = readRecord(dr.pre_mortem);
  if (pm === null) return null;
  const failure = typeof pm.failure_scenario === 'string'
    ? pm.failure_scenario.trim()
    : '';
  if (failure.length === 0) return null;
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
  const candidate = {
    block_id: randomUUID(),
    signal_id: stableSignalId('review:pre_mortem', '', ctx),
    created_at: ctx.created_at,
    source_handler: SOURCE_HANDLER,
    graph_hash_at_generation: ctx.graph_hash_at_generation,
    freshness: 'fresh' as const,
    type: 'review_card' as const,
    card_kind: 'pre_mortem' as const,
    title: truncate('If things go wrong', TITLE_MAX),
    body: truncate(failure, BODY_MAX),
    severity: 'warning' as Phase3BlockSeverityLiteral,
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
      block_id: randomUUID(),
      signal_id: stableSignalId('review:flip', factorId, ctx),
      created_at: ctx.created_at,
      source_handler: SOURCE_HANDLER,
      graph_hash_at_generation: ctx.graph_hash_at_generation,
      freshness: 'fresh' as const,
      type: 'review_card' as const,
      card_kind: 'flip_threshold' as const,
      title: truncate(`What would flip the result on ${ref.label}`, TITLE_MAX),
      body: truncate(narrative, BODY_MAX),
      severity: 'warning' as Phase3BlockSeverityLiteral,
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
      block_id: randomUUID(),
      signal_id: stableSignalId('review:bias', biasType, ctx),
      created_at: ctx.created_at,
      source_handler: SOURCE_HANDLER,
      graph_hash_at_generation: ctx.graph_hash_at_generation,
      freshness: 'fresh' as const,
      type: 'review_card' as const,
      card_kind: 'bias' as const,
      title: truncate(`Something to check: ${humaniseBiasType(biasType)}`, TITLE_MAX),
      body: truncate(description, BODY_MAX),
      severity: 'warning' as Phase3BlockSeverityLiteral,
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
    block_id: randomUUID(),
    signal_id: stableSignalId('review:robustness', '', ctx),
    created_at: ctx.created_at,
    source_handler: SOURCE_HANDLER,
    graph_hash_at_generation: ctx.graph_hash_at_generation,
    freshness: 'fresh' as const,
    type: 'review_card' as const,
    card_kind: 'robustness' as const,
    title: truncate('How robust is this?', TITLE_MAX),
    body: truncate(summary, BODY_MAX),
    severity: (primaryRisk.length > 0 ? 'warning' : 'info') as Phase3BlockSeverityLiteral,
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
): ReviewCardBlock | null {
  const enhancements = readRecord(dr.evidence_enhancements);
  if (enhancements === null) return null;
  const entries = Object.entries(enhancements);
  if (entries.length === 0) return null;
  // Take the top entry — emission order ≈ voi rank per the v11 prompt.
  for (const [factorId, rawEntry] of entries) {
    const entry = readRecord(rawEntry);
    if (entry === null) continue;
    const rationale = typeof entry.rationale === 'string'
      ? entry.rationale.trim()
      : '';
    if (rationale.length === 0) continue;
    const ref = lookup.get(factorId);
    if (ref === undefined || ref.kind !== 'factor') continue;
    const candidate = {
      block_id: randomUUID(),
      signal_id: stableSignalId('review:evidence_priority', factorId, ctx),
      created_at: ctx.created_at,
      source_handler: SOURCE_HANDLER,
      graph_hash_at_generation: ctx.graph_hash_at_generation,
      freshness: 'fresh' as const,
      type: 'review_card' as const,
      card_kind: 'evidence_priority' as const,
      title: truncate(`Highest-leverage evidence gap: ${ref.label}`, TITLE_MAX),
      body: truncate(rationale, BODY_MAX),
      severity: 'info' as Phase3BlockSeverityLiteral,
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
): readonly ReviewCardBlock[] {
  if (!Array.isArray(dr.key_assumptions)) return [];
  const out: ReviewCardBlock[] = [];
  let idx = 0;
  for (const raw of dr.key_assumptions) {
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    if (text.length === 0) continue;
    idx++;
    const candidate = {
      block_id: randomUUID(),
      signal_id: stableSignalId('review:assumption', String(idx), ctx),
      created_at: ctx.created_at,
      source_handler: SOURCE_HANDLER,
      graph_hash_at_generation: ctx.graph_hash_at_generation,
      freshness: 'fresh' as const,
      type: 'review_card' as const,
      card_kind: 'assumption' as const,
      title: truncate('A load-bearing assumption', TITLE_MAX),
      body: truncate(text, BODY_MAX),
      severity: 'info' as Phase3BlockSeverityLiteral,
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
      block_id: randomUUID(),
      signal_id: stableSignalId('review:scenario', edgeId, ctx),
      created_at: ctx.created_at,
      source_handler: SOURCE_HANDLER,
      graph_hash_at_generation: ctx.graph_hash_at_generation,
      freshness: 'fresh' as const,
      type: 'review_card' as const,
      card_kind: 'scenario_context' as const,
      title: truncate('A scenario worth considering', TITLE_MAX),
      body: truncate(body, BODY_MAX),
      severity: 'info' as Phase3BlockSeverityLiteral,
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
  const proseHit = scanProse(ctx.prose);
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
  const parsed = schema.safeParse(candidate);
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

