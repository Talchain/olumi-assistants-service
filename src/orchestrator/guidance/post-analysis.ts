/**
 * Post-Analysis GuidanceItem Generation
 *
 * Called from dispatch after run_analysis completes.
 * Pure function: takes V2RunResponseEnvelope + graph state → returns GuidanceItem[].
 *
 * Sources:
 * 1. ProposalCardV1[] from review_cards
 * 2. factor_sensitivity[] — high-influence + default confidence
 * 3. robustness_synthesis / robustness level
 * 4. constraint_analysis per_constraint / constraint_probabilities
 * 5. Technique offers (pre_mortem, disconfirmation, devil_advocate)
 *
 * Field name notes (from analysis-compact.ts):
 * - results[i].win_probability — win probability (number)
 * - results[i].factor_sensitivity[j].sensitivity or .elasticity — influence
 * - results[i].factor_sensitivity[j].label or .factor_label or .node_id — label
 * - results[i].factor_sensitivity[j].node_id or .factor_id — ID
 * - robustness_synthesis.overall_assessment → results[0].robustness.overall_robustness → robustness.level
 * - results[i].constraint_probabilities[j].constraint_id + .probability
 * - results[i].probability_of_joint_goal — joint probability
 *
 * Max 12 items. Sorted: priority desc, item_id asc.
 */

import type { V2RunResponseEnvelope } from "../types.js";
import type { GraphV3T } from "../../schemas/cee-v3.js";
import { DEFAULT_EXISTS_PROBABILITY } from "../context/constants.js";
import {
  SIGNAL_CODES,
  computeGuidanceItemId,
  deduplicateGuidanceItems,
  sortGuidanceItems,
} from "../types/guidance-item.js";
import type { GuidanceItem, GuidanceCategory } from "../types/guidance-item.js";
// S4 ROUND 6: the closeness classifiers below route through the SAME near-tie
// SSOT the V5 coaching surfaces use, so an upstream `near_tie.is_tie` override
// is honoured here instead of being reinvented from the local 10pp literal.
import {
  readRawRobustnessSignals,
  type RawRobustnessSignals,
} from "../../orchestrator-v5/coaching/pick-raw-robustness.js";
import { nearTieReasonByMargin } from "../../orchestrator-v5/coaching/robustness-honesty.js";

// ============================================================================
// Constants
// ============================================================================

const MAX_ITEMS = 12;
const FACTOR_INFLUENCE_THRESHOLD = 0.3;
const TECHNIQUE_INFLUENCE_THRESHOLD = 0.5;
const TECHNIQUE_WIN_PROBABILITY_THRESHOLD = 0.7;
const TECHNIQUE_CLOSE_CALL_THRESHOLD = 0.1;
const CONSTRAINT_VIOLATION_THRESHOLD = 0.5;

// ============================================================================
// Type helpers (read V2RunResponse fields defensively)
// ============================================================================

type OptionResult = Record<string, unknown>;
type FactorEntry = Record<string, unknown>;

function getOptionResults(response: V2RunResponseEnvelope): OptionResult[] {
  if (Array.isArray(response.results) && response.results.length > 0) {
    return response.results.filter((r): r is OptionResult => r !== null && typeof r === 'object');
  }
  const r = response as Record<string, unknown>;
  const oc = r.option_comparison;
  if (Array.isArray(oc) && oc.length > 0) {
    return oc.filter((r): r is OptionResult => r !== null && typeof r === 'object');
  }
  // UI may nest V2 fields inside results as an object
  if (r.results && typeof r.results === 'object' && !Array.isArray(r.results)) {
    const nested = r.results as Record<string, unknown>;
    if (Array.isArray(nested.option_comparison)) {
      return nested.option_comparison.filter((r): r is OptionResult => r !== null && typeof r === 'object');
    }
  }
  return [];
}

function getFactorSensitivity(result: OptionResult): FactorEntry[] {
  const fs = result.factor_sensitivity;
  if (!Array.isArray(fs)) return [];
  return fs.filter((f): f is FactorEntry => f !== null && typeof f === 'object');
}

function getWinProbability(result: OptionResult): number {
  const wp = result.win_probability;
  return typeof wp === 'number' ? wp : 0;
}

function getFactorInfluence(factor: FactorEntry): number | null {
  const s = typeof factor.sensitivity === 'number' ? factor.sensitivity : null;
  const e = typeof factor.elasticity === 'number' ? factor.elasticity : null;
  const raw = s ?? e;
  return raw !== null ? Math.abs(raw) : null;
}

function getFactorId(factor: FactorEntry): string | null {
  if (typeof factor.node_id === 'string') return factor.node_id;
  if (typeof factor.factor_id === 'string') return factor.factor_id;
  return null;
}

function getFactorLabel(factor: FactorEntry): string {
  if (typeof factor.label === 'string') return factor.label;
  if (typeof factor.factor_label === 'string') return factor.factor_label;
  return getFactorId(factor) ?? 'factor';
}

function getRobustnessLevel(response: V2RunResponseEnvelope): string {
  // Priority: robustness_synthesis.overall_assessment
  const synth = (response as Record<string, unknown>).robustness_synthesis;
  if (synth && typeof synth === 'object') {
    const assessment = (synth as Record<string, unknown>).overall_assessment;
    if (typeof assessment === 'string' && assessment.length > 0) return assessment;
  }
  // Fallback: results[0].robustness.overall_robustness
  const results = getOptionResults(response);
  if (results.length > 0) {
    const robustness = results[0].robustness;
    if (robustness && typeof robustness === 'object') {
      const overall = (robustness as Record<string, unknown>).overall_robustness;
      if (typeof overall === 'string' && overall.length > 0) return overall;
    }
  }
  // Fallback: top-level robustness.level
  if (response.robustness?.level) return response.robustness.level;
  return 'unknown';
}

function getAnalysisHash(response: V2RunResponseEnvelope): string | undefined {
  return response.response_hash ?? response.meta?.response_hash;
}

/**
 * S4 ROUND 6: read the RAW robustness signals (level + `near_tie.is_tie`
 * override) from the V2 envelope so the technique/CTA closeness classifiers can
 * consult the SAME near-tie verdict the V5 coaching surfaces use, instead of
 * reinventing closeness from the local 10pp literal alone. The override can sit
 * at the top-level `robustness` or inside `results[0].robustness`, so we OR the
 * flag across both addresses (a tie anywhere is a tie) and keep the first level.
 * Returns null when neither address carries a usable signal — callers then fall
 * back to the margin-only band exactly as before (byte-identical when upstream
 * emits no near_tie override, which every pre-round-6 fixture does).
 */
function readResponseRawRobustness(
  response: V2RunResponseEnvelope,
): RawRobustnessSignals | null {
  const addresses: unknown[] = [(response as Record<string, unknown>).robustness];
  const results = getOptionResults(response);
  if (results.length > 0) addresses.push(results[0].robustness);
  let level: string | null = null;
  let override = false;
  for (const addr of addresses) {
    const sig = readRawRobustnessSignals(addr);
    if (sig === null) continue;
    if (level === null && sig.level !== null) level = sig.level;
    if (sig.near_tie_is_tie) override = true;
  }
  if (level === null && !override) return null;
  return { level, near_tie_is_tie: override };
}

/**
 * The shared near-tie verdict for the guidance closeness classifiers.
 * `topTwoSeparation` is the top-two win-probability separation in PROBABILITY
 * space (0-1), so it is scaled to the percentage points the SSOT expects. A
 * non-finite separation (fewer than two options) yields a null margin — the
 * override alone can still return a verdict there, but upstream never flags a
 * single-option run as a tie. Returns 'margin' | 'override' | null exactly as
 * the SSOT `nearTieReasonByMargin`.
 */
function sharedTieReason(
  response: V2RunResponseEnvelope,
  topTwoSeparation: number,
): 'margin' | 'override' | null {
  const marginPp = Number.isFinite(topTwoSeparation) ? topTwoSeparation * 100 : null;
  return nearTieReasonByMargin(marginPp, readResponseRawRobustness(response));
}

/** Build node lookup map from graph */
function buildNodeMap(graph: GraphV3T | null): Map<string, { label: string; exists_probability: number }> {
  const map = new Map<string, { label: string; exists_probability: number }>();
  if (!graph) return map;
  for (const node of graph.nodes) {
    const ep = (node as Record<string, unknown>).exists_probability;
    const existsProb = typeof ep === 'number' ? ep : DEFAULT_EXISTS_PROBABILITY;
    map.set(node.id, { label: node.label ?? node.id, exists_probability: existsProb });
  }
  return map;
}

/** Check if fact_ids exist in fact_objects */
function verifyFactIds(
  citationIds: unknown[],
  factObjects: unknown[] | undefined,
): { verified: string[]; unverified: string[] } {
  const factIdSet = new Set<string>();
  if (Array.isArray(factObjects)) {
    for (const f of factObjects) {
      const obj = f as Record<string, unknown>;
      if (typeof obj.fact_id === 'string') factIdSet.add(obj.fact_id);
    }
  }
  const verified: string[] = [];
  const unverified: string[] = [];
  for (const id of citationIds) {
    if (typeof id !== 'string') continue;
    if (factIdSet.has(id)) {
      verified.push(id);
    } else {
      unverified.push(id);
    }
  }
  return { verified, unverified };
}

// ============================================================================
// ProposalCard conversion
// ============================================================================

function convertProposalCards(
  response: V2RunResponseEnvelope,
  analysisHash: string | undefined,
  emittedReviewCardNodeIds?: Set<string>,
): GuidanceItem[] {
  const cards = response.review_cards;
  if (!Array.isArray(cards)) return [];

  const items: GuidanceItem[] = [];

  for (const rawCard of cards) {
    if (!rawCard || typeof rawCard !== 'object') continue;
    const card = rawCard as Record<string, unknown>;

    // Skip cards whose node is already rendered as a review_card block —
    // avoids duplicate content in the guidance strip vs response body.
    const nodeId = typeof card.node_id === 'string' ? card.node_id : undefined;
    if (nodeId && emittedReviewCardNodeIds?.has(nodeId)) continue;

    const priorityBand = typeof card.priority_band === 'string' ? card.priority_band.toLowerCase() : 'medium';

    let category: GuidanceCategory;
    let signal_code: string;
    let priority: number;

    switch (priorityBand) {
      case 'critical':
        category = 'must_fix'; signal_code = SIGNAL_CODES.PROPOSAL_CARD_CRITICAL; priority = 90; break;
      case 'high':
        category = 'must_fix'; signal_code = SIGNAL_CODES.PROPOSAL_CARD_HIGH; priority = 80; break;
      case 'low':
        category = 'could_fix'; signal_code = SIGNAL_CODES.PROPOSAL_CARD_LOW; priority = 40; break;
      default:
        category = 'should_fix'; signal_code = SIGNAL_CODES.PROPOSAL_CARD_MEDIUM; priority = 65;
    }

    // Determine target + action (nodeId already resolved above for dedup check)
    const nodeLabel = typeof card.node_label === 'string' ? card.node_label : undefined;

    const action = nodeId
      ? { type: 'open_inspector' as const, node_id: nodeId }
      : {
          type: 'discuss' as const,
          prompt: typeof card.title === 'string'
            ? `Tell me more about: ${card.title}`
            : 'Tell me more about this guidance.',
        };

    const targetObject = nodeId
      ? { type: 'node' as const, id: nodeId, label: nodeLabel }
      : { type: 'graph' as const };

    const item_id = computeGuidanceItemId(signal_code, targetObject.type !== 'graph' ? nodeId : undefined, 'analysis');

    // Verify fact_ids
    const citationIds = Array.isArray(card.citation_ids) ? card.citation_ids : [];
    const { verified, unverified } = verifyFactIds(citationIds, response.fact_objects);

    const item: GuidanceItem = {
      item_id,
      signal_code,
      category,
      source: 'analysis',
      title: typeof card.title === 'string' ? card.title : 'Analysis recommendation',
      detail: typeof card.body === 'string' ? card.body : undefined,
      primary_action: action,
      target_object: targetObject,
      priority,
    };

    if (analysisHash) {
      item.valid_while = { analysis_hash: analysisHash };
    }
    if (verified.length > 0) {
      item.fact_ids = verified;
    }
    if (unverified.length > 0) {
      item.citations = unverified;
    }

    items.push(item);
  }

  return items;
}

// ============================================================================
// Factor sensitivity guidance
// ============================================================================

/** Collect factor entries from top-level and per-result factor_sensitivity (both shapes supported). */
function getAllFactors(response: V2RunResponseEnvelope): FactorEntry[] {
  const all: FactorEntry[] = [];
  // Top-level factor_sensitivity (preferred shape)
  if (Array.isArray(response.factor_sensitivity)) {
    for (const f of response.factor_sensitivity) {
      if (f !== null && typeof f === 'object') all.push(f as FactorEntry);
    }
  }
  // Per-result factor_sensitivity (alternative shape)
  for (const result of getOptionResults(response)) {
    for (const f of getFactorSensitivity(result)) {
      all.push(f);
    }
  }
  return all;
}

function convertFactorSensitivity(
  response: V2RunResponseEnvelope,
  nodeMap: Map<string, { label: string; exists_probability: number }>,
  analysisHash: string | undefined,
): GuidanceItem[] {
  const items: GuidanceItem[] = [];
  const seen = new Set<string>(); // deduplicate by factor_id

  for (const factor of getAllFactors(response)) {
      const factorId = getFactorId(factor);
      if (!factorId || seen.has(factorId)) continue;

      const influence = getFactorInfluence(factor);
      if (influence === null || influence <= FACTOR_INFLUENCE_THRESHOLD) continue;

      // Check if corresponding node has default confidence
      const nodeInfo = nodeMap.get(factorId);
      const existsProb = nodeInfo?.exists_probability ?? DEFAULT_EXISTS_PROBABILITY;
      if (existsProb !== DEFAULT_EXISTS_PROBABILITY) continue;

      seen.add(factorId);
      const label = nodeInfo?.label ?? getFactorLabel(factor);
      const priority = Math.min(79, Math.floor(influence * 100));
      const item_id = computeGuidanceItemId(SIGNAL_CODES.HIGH_INFLUENCE_LOW_CONFIDENCE, factorId, 'analysis');

      const item: GuidanceItem = {
        item_id,
        signal_code: SIGNAL_CODES.HIGH_INFLUENCE_LOW_CONFIDENCE,
        category: 'should_fix',
        source: 'analysis',
        title: `"${label}" is influential but has default confidence`,
        detail: 'This factor has high influence on the outcome but uses the default existence probability. Calibrate it for more accurate results.',
        primary_action: { type: 'open_inspector', node_id: factorId },
        target_object: { type: 'node', id: factorId, label },
        priority,
      };

      if (analysisHash) {
        item.valid_while = { analysis_hash: analysisHash };
      }

      items.push(item);
  }

  return items;
}

// ============================================================================
// Robustness guidance
// ============================================================================

function convertRobustness(
  response: V2RunResponseEnvelope,
  analysisHash: string | undefined,
): GuidanceItem[] {
  const robustnessLevel = getRobustnessLevel(response);
  if (robustnessLevel !== 'fragile') return [];

  const item_id = computeGuidanceItemId(SIGNAL_CODES.FRAGILE_RESULT, undefined, 'analysis');

  const item: GuidanceItem = {
    item_id,
    signal_code: SIGNAL_CODES.FRAGILE_RESULT,
    category: 'must_fix',
    source: 'analysis',
    title: 'Result is fragile. Small changes could flip the recommendation',
    detail: 'The model\'s outcome is sensitive to its assumptions. Consider running a pre-mortem or calibrating the key drivers.',
    primary_action: { type: 'discuss', prompt: 'What would need to change for the recommendation to flip?' },
    target_object: { type: 'graph' },
    priority: 85,
  };

  if (analysisHash) {
    item.valid_while = { analysis_hash: analysisHash };
  }

  return [item];
}

// ============================================================================
// Constraint violation guidance
// ============================================================================

/** Collect constraint probability entries from top-level and per-result shapes. */
function getAllConstraintEntries(response: V2RunResponseEnvelope): Array<Record<string, unknown>> {
  const all: Array<Record<string, unknown>> = [];
  // Top-level constraint_analysis.per_constraint (preferred)
  if (response.constraint_analysis?.per_constraint && Array.isArray(response.constraint_analysis.per_constraint)) {
    for (const cp of response.constraint_analysis.per_constraint) {
      if (cp && typeof cp === 'object') all.push(cp as Record<string, unknown>);
    }
  }
  // Per-result constraint_probabilities (alternative shape)
  for (const result of getOptionResults(response)) {
    const constraintProbs = result.constraint_probabilities;
    if (!Array.isArray(constraintProbs)) continue;
    for (const cp of constraintProbs) {
      if (cp && typeof cp === 'object') all.push(cp as Record<string, unknown>);
    }
  }
  return all;
}

function convertConstraintViolations(
  response: V2RunResponseEnvelope,
  analysisHash: string | undefined,
): GuidanceItem[] {
  const items: GuidanceItem[] = [];
  const seen = new Set<string>();

  for (const cpObj of getAllConstraintEntries(response)) {
    const constraintId = typeof cpObj.constraint_id === 'string' ? cpObj.constraint_id : null;
    const probability = typeof cpObj.probability === 'number' ? cpObj.probability : null;

    if (!constraintId || probability === null) continue;
    if (seen.has(constraintId)) continue;
    if (probability >= CONSTRAINT_VIOLATION_THRESHOLD) continue;

    seen.add(constraintId);

    const item_id = computeGuidanceItemId(SIGNAL_CODES.CONSTRAINT_VIOLATION, constraintId, 'analysis');

    const item: GuidanceItem = {
      item_id,
      signal_code: SIGNAL_CODES.CONSTRAINT_VIOLATION,
      category: 'should_fix',
      source: 'analysis',
      title: 'Constraint unlikely to be satisfied',
      detail: `This constraint has a low probability of being satisfied (${(probability * 100).toFixed(0)}%). Review the model or relax the constraint.`,
      primary_action: { type: 'open_inspector', node_id: constraintId },
      target_object: { type: 'node', id: constraintId },
      priority: 70,
    };

    if (analysisHash) {
      item.valid_while = { analysis_hash: analysisHash };
    }

    items.push(item);
  }

  return items;
}

// ============================================================================
// Technique offers
// ============================================================================

function buildTechniqueOffers(
  response: V2RunResponseEnvelope,
  analysisHash: string | undefined,
  options?: { responseMode?: string },
): GuidanceItem[] {
  // RECOVER mode → suppress all technique offers
  if (options?.responseMode === 'RECOVER') return [];

  const items: GuidanceItem[] = [];

  const robustnessLevel = getRobustnessLevel(response);
  const results = getOptionResults(response)
    .sort((a, b) => getWinProbability(b) - getWinProbability(a));

  // Compute separation for PRE_MORTEM trigger
  const topTwoSeparation = results.length >= 2
    ? Math.abs(getWinProbability(results[0]) - getWinProbability(results[1]))
    : Infinity;

  // S4 ROUND 6: the shared near-tie verdict OUTRANKS the local 10pp band — an
  // upstream-flagged tie (raw `near_tie.is_tie`) must surface a close-call even
  // when the point-margin exceeds 10pp. Layered ABOVE the local threshold, never
  // replacing it: the 10pp band still owns "worth a technique" at 2-10pp; the
  // override adds the wide-gap tie the margin-only classifier structurally
  // missed (the same defect class round 5 closed on compare_options /
  // what_would_flip / the run_analysis headline).
  const tieReason = sharedTieReason(response, topTwoSeparation);
  const isClose = topTwoSeparation <= TECHNIQUE_CLOSE_CALL_THRESHOLD || tieReason !== null;

  // PRE_MORTEM: close call (local band OR shared tie verdict) AND not robust
  if (isClose && robustnessLevel !== 'robust') {
    const item_id = computeGuidanceItemId(SIGNAL_CODES.TECHNIQUE_PRE_MORTEM, undefined, 'analysis');
    const item: GuidanceItem = {
      item_id,
      signal_code: SIGNAL_CODES.TECHNIQUE_PRE_MORTEM,
      category: 'technique',
      source: 'analysis',
      title: 'Run a pre-mortem to identify failure scenarios',
      detail: 'Imagine the decision failed. What went wrong? A pre-mortem surfaces hidden risks before committing.',
      primary_action: { type: 'run_exercise', exercise: 'pre_mortem' },
      target_object: { type: 'graph' },
      priority: 25,
    };
    if (analysisHash) item.valid_while = { analysis_hash: analysisHash };
    items.push(item);
  }

  // DOMINANT_FACTOR: any factor with influence > 0.5
  for (const factor of getAllFactors(response)) {
    const influence = getFactorInfluence(factor);
    if (influence !== null && influence > TECHNIQUE_INFLUENCE_THRESHOLD) {
      const factorId = getFactorId(factor);
      const factorLabel = getFactorLabel(factor);
      const item_id = computeGuidanceItemId(SIGNAL_CODES.DOMINANT_FACTOR, factorId ?? undefined, 'analysis');
      const item: GuidanceItem = {
        item_id,
        signal_code: SIGNAL_CODES.DOMINANT_FACTOR,
        category: 'should_fix',
        source: 'analysis',
        title: `"${factorLabel}" dominates the outcome`,
        detail: 'This factor has outsized influence on the result. Verify its calibration or consider whether the model is too dependent on a single driver.',
        primary_action: factorId
          ? { type: 'open_inspector', node_id: factorId }
          : { type: 'discuss', prompt: `Examine why "${factorLabel}" dominates the analysis.` },
        target_object: factorId
          ? { type: 'node', id: factorId, label: factorLabel }
          : { type: 'graph' },
        priority: 60,
      };
      if (analysisHash) item.valid_while = { analysis_hash: analysisHash };
      items.push(item);
      break; // Only emit for the first dominant factor
    }
  }

  // DISCONFIRMATION: top option win_probability > 0.7
  if (results.length > 0 && getWinProbability(results[0]) > TECHNIQUE_WIN_PROBABILITY_THRESHOLD) {
    const item_id = computeGuidanceItemId(SIGNAL_CODES.TECHNIQUE_DISCONFIRMATION, undefined, 'analysis');
    const item: GuidanceItem = {
      item_id,
      signal_code: SIGNAL_CODES.TECHNIQUE_DISCONFIRMATION,
      category: 'technique',
      source: 'analysis',
      title: 'Challenge the recommendation: what would flip it?',
      detail: 'The top option has a strong win probability. Stress-test it by asking what evidence would change this conclusion.',
      primary_action: { type: 'run_exercise', exercise: 'disconfirmation' },
      target_object: { type: 'graph' },
      priority: 20,
    };
    if (analysisHash) item.valid_while = { analysis_hash: analysisHash };
    items.push(item);
  }

  // DEVIL_ADVOCATE: top two options close (local 10pp band OR shared tie verdict)
  if (results.length >= 2) {
    if (isClose) {
      const item_id = computeGuidanceItemId(SIGNAL_CODES.TECHNIQUE_DEVIL_ADVOCATE, undefined, 'analysis');
      const item: GuidanceItem = {
        item_id,
        signal_code: SIGNAL_CODES.TECHNIQUE_DEVIL_ADVOCATE,
        category: 'technique',
        source: 'analysis',
        title: 'It\'s close. Argue against the top option',
        // Verdict-driven copy, not a hard "within 10%" claim: the override tier
        // fires on a WIDER point-margin, so asserting "within 10%" there would
        // be the mirror-image false claim (a tie narrated with a false gap).
        detail: 'The top two options are close. A devil\'s advocate exercise can surface factors you might be missing.',
        primary_action: { type: 'run_exercise', exercise: 'devil_advocate' },
        target_object: { type: 'graph' },
        priority: 20,
      };
      if (analysisHash) item.valid_while = { analysis_hash: analysisHash };
      items.push(item);
    }
  }

  return items;
}

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate GuidanceItems after run_analysis.
 *
 * @param response - Full V2RunResponseEnvelope from PLoT
 * @param graph - Current graph state (for node lookup)
 * @param options - Optional intent/mode context for conditional guidance
 * @returns Sorted, deduplicated GuidanceItem[] (max 12)
 */
export function generatePostAnalysisGuidance(
  response: V2RunResponseEnvelope,
  graph: GraphV3T | null,
  options?: { intentClassification?: string; responseMode?: string; emittedReviewCardNodeIds?: Set<string> },
): GuidanceItem[] {
  const analysisHash = getAnalysisHash(response);
  const nodeMap = buildNodeMap(graph);

  const items: GuidanceItem[] = [
    ...convertProposalCards(response, analysisHash, options?.emittedReviewCardNodeIds),
    ...convertFactorSensitivity(response, nodeMap, analysisHash),
    ...convertRobustness(response, analysisHash),
    ...convertConstraintViolations(response, analysisHash),
    // Technique offers appended last
    ...buildTechniqueOffers(response, analysisHash, { responseMode: options?.responseMode }),
  ];

  // CTA_LITE: fires after every analysis, unless explain intent or RECOVER mode
  if (options?.intentClassification !== 'explain' && options?.responseMode !== 'RECOVER') {
    const results = getOptionResults(response)
      .sort((a, b) => getWinProbability(b) - getWinProbability(a));
    const robustnessLevel = getRobustnessLevel(response);
    const topTwoSeparation = results.length >= 2
      ? Math.abs(getWinProbability(results[0]) - getWinProbability(results[1]))
      : Infinity;

    // S4 ROUND 6: fold the shared near-tie verdict into the CTA framing so an
    // upstream tie override flips "Ready to decide?" → "Strengthen the model"
    // even at a wide point-margin. `isFragileOrClose` is checked FIRST below, so
    // an override tie routes to the evidence CTA regardless of `isRobustAndClear`.
    const tieReason = sharedTieReason(response, topTwoSeparation);
    const isRobustAndClear = robustnessLevel !== 'fragile' && results.length > 0 && getWinProbability(results[0]) > 0.6;
    const isFragileOrClose = robustnessLevel === 'fragile' || topTwoSeparation <= TECHNIQUE_CLOSE_CALL_THRESHOLD || tieReason !== null;

    let ctaPrompt: string;
    if (isFragileOrClose) {
      ctaPrompt = 'What evidence would strengthen the model?';
    } else if (isRobustAndClear) {
      ctaPrompt = 'Generate the decision brief';
    } else {
      // Default fallback → brief CTA
      ctaPrompt = 'Generate the decision brief';
    }

    const ctaItemId = computeGuidanceItemId(SIGNAL_CODES.CTA_LITE, undefined, 'analysis');
    const ctaItem: GuidanceItem = {
      item_id: ctaItemId,
      signal_code: SIGNAL_CODES.CTA_LITE,
      category: 'technique',
      source: 'analysis',
      title: isFragileOrClose ? 'Strengthen the model' : 'Ready to decide?',
      primary_action: { type: 'discuss', prompt: ctaPrompt },
      target_object: { type: 'graph' },
      priority: 10,
    };
    if (analysisHash) ctaItem.valid_while = { analysis_hash: analysisHash };
    items.push(ctaItem);
  }

  return sortGuidanceItems(deduplicateGuidanceItems(items)).slice(0, MAX_ITEMS);
}
