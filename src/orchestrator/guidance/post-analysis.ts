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
  const results = response.results;
  if (!Array.isArray(results)) return [];
  return results.filter((r): r is OptionResult => r !== null && typeof r === 'object');
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
): GuidanceItem[] {
  const cards = response.review_cards;
  if (!Array.isArray(cards)) return [];

  const items: GuidanceItem[] = [];

  for (const rawCard of cards) {
    if (!rawCard || typeof rawCard !== 'object') continue;
    const card = rawCard as Record<string, unknown>;

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

    // Determine target + action
    const nodeId = typeof card.node_id === 'string' ? card.node_id : undefined;
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
    title: 'Result is fragile — small changes could flip the recommendation',
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
): GuidanceItem[] {
  const items: GuidanceItem[] = [];

  const robustnessLevel = getRobustnessLevel(response);
  const results = getOptionResults(response)
    .sort((a, b) => getWinProbability(b) - getWinProbability(a));

  // Check for high-influence factors (top-level or per-result)
  let hasHighInfluenceFactor = false;
  for (const factor of getAllFactors(response)) {
    const influence = getFactorInfluence(factor);
    if (influence !== null && influence > TECHNIQUE_INFLUENCE_THRESHOLD) {
      hasHighInfluenceFactor = true;
      break;
    }
  }

  // PRE_MORTEM: fragile OR any factor influence > 0.5
  if (robustnessLevel === 'fragile' || hasHighInfluenceFactor) {
    const item_id = computeGuidanceItemId(SIGNAL_CODES.TECHNIQUE_PRE_MORTEM, undefined, 'analysis');
    const item: GuidanceItem = {
      item_id,
      signal_code: SIGNAL_CODES.TECHNIQUE_PRE_MORTEM,
      category: 'technique',
      source: 'analysis',
      title: 'Run a pre-mortem to identify failure scenarios',
      detail: 'Imagine the decision failed — what went wrong? A pre-mortem surfaces hidden risks before committing.',
      primary_action: { type: 'run_exercise', exercise: 'pre_mortem' },
      target_object: { type: 'graph' },
      priority: 25,
    };
    if (analysisHash) item.valid_while = { analysis_hash: analysisHash };
    items.push(item);
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

  // DEVIL_ADVOCATE: top two options within 10% win probability
  if (results.length >= 2) {
    const topProb = getWinProbability(results[0]);
    const runnerUpProb = getWinProbability(results[1]);
    if (Math.abs(topProb - runnerUpProb) <= TECHNIQUE_CLOSE_CALL_THRESHOLD) {
      const item_id = computeGuidanceItemId(SIGNAL_CODES.TECHNIQUE_DEVIL_ADVOCATE, undefined, 'analysis');
      const item: GuidanceItem = {
        item_id,
        signal_code: SIGNAL_CODES.TECHNIQUE_DEVIL_ADVOCATE,
        category: 'technique',
        source: 'analysis',
        title: 'It\'s close — argue against the top option',
        detail: 'The top two options are within 10% of each other. A devil\'s advocate exercise can surface factors you might be missing.',
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
 * @returns Sorted, deduplicated GuidanceItem[] (max 12)
 */
export function generatePostAnalysisGuidance(
  response: V2RunResponseEnvelope,
  graph: GraphV3T | null,
): GuidanceItem[] {
  const analysisHash = getAnalysisHash(response);
  const nodeMap = buildNodeMap(graph);

  const items: GuidanceItem[] = [
    ...convertProposalCards(response, analysisHash),
    ...convertFactorSensitivity(response, nodeMap, analysisHash),
    ...convertRobustness(response, analysisHash),
    ...convertConstraintViolations(response, analysisHash),
    // Technique offers appended last
    ...buildTechniqueOffers(response, analysisHash),
  ];

  return sortGuidanceItems(deduplicateGuidanceItems(items)).slice(0, MAX_ITEMS);
}
