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

const SOURCE_HANDLER = 'decision_review_enricher';

const TITLE_MAX = 80;
const BODY_MAX = 300;
const ACTION_LABEL_MAX = 40;
const TECHNIQUE_MAX = 300;

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
 * Build a lookup table from `fact.result.enrichment.graph.nodes[]` for
 * ID-to-label-and-kind resolution. Defensive: skips nodes missing any of
 * `id`, `label`, or `kind`, and skips nodes whose `kind` is outside the
 * v1.3 `TargetRefKind` union.
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
  const nodes = graph.nodes;
  if (!Array.isArray(nodes)) return lookup;
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
      const block = validateOrDrop(CoachingBlockSchema, candidate);
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
      const block = validateOrDrop(CoachingBlockSchema, candidate);
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
    const block = validateOrDrop(EvidenceBlockSchema, candidate);
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
  return validateOrDrop(ReviewCardBlockSchema, candidate);
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
  const targetRefs: TargetRef[] = [];
  for (const raw of grounded) {
    if (typeof raw !== 'string') continue;
    const ref = lookup.get(raw);
    if (ref !== undefined) targetRefs.push(ref);
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
  return validateOrDrop(ReviewCardBlockSchema, candidate);
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
    idx++;
    const ref = lookup.get(factorId);
    const targetRefs: readonly TargetRef[] = ref !== undefined && ref.kind === 'factor'
      ? [ref]
      : [{ id: factorId, label: factorLabel, kind: 'factor' as const }];
    // Note: when the factor isn't in the graph lookup, we fall back to
    // the LLM-provided factor_label rather than dropping — flip_thresholds
    // are sourced from PLoT-validated flip_threshold_data with the
    // label already canonical (per defaults.ts:1411-1424 prompt spec).
    const candidate = {
      block_id: randomUUID(),
      signal_id: stableSignalId('review:flip', factorId, ctx),
      created_at: ctx.created_at,
      source_handler: SOURCE_HANDLER,
      graph_hash_at_generation: ctx.graph_hash_at_generation,
      freshness: 'fresh' as const,
      type: 'review_card' as const,
      card_kind: 'flip_threshold' as const,
      title: truncate(`What would flip the result on ${factorLabel}`, TITLE_MAX),
      body: truncate(narrative, BODY_MAX),
      severity: 'warning' as Phase3BlockSeverityLiteral,
      target_refs: targetRefs,
      priority_rank: 30 + idx,
      action_intent: 'what_would_flip' as ActionIntentLiteral,
      action_label: truncate('Explore what flips this', ACTION_LABEL_MAX),
    };
    const block = validateOrDrop(ReviewCardBlockSchema, candidate);
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
    const block = validateOrDrop(ReviewCardBlockSchema, candidate);
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
  return validateOrDrop(ReviewCardBlockSchema, candidate);
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
    return validateOrDrop(ReviewCardBlockSchema, candidate);
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
    const block = validateOrDrop(ReviewCardBlockSchema, candidate);
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
    idx++;
    const ref = lookup.get(edgeId);
    const targetRefs: readonly TargetRef[] = (ref !== undefined && ref.kind === 'edge')
      ? [ref]
      : [];
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
      target_refs: targetRefs,
      priority_rank: 80 + idx,
    };
    const block = validateOrDrop(ReviewCardBlockSchema, candidate);
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
 * `safeParse` the candidate against its Zod schema; return the typed
 * block on success, null on failure. Validation failures DROP the block
 * (never weaken the schema, never emit partial/filler).
 */
function validateOrDrop<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  candidate: unknown,
): z.infer<TSchema> | null {
  const parsed = schema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
