/**
 * NodeKind Normalisation Module
 *
 * Maps non-standard LLM node types to canonical types to prevent schema errors.
 * Shared between all LLM adapters (OpenAI, Anthropic, etc.)
 */

import { emit, TelemetryEvents, log } from "../../utils/telemetry.js";

// ============================================================================
// Types
// ============================================================================

export type CanonicalNodeKind = 'goal' | 'decision' | 'option' | 'outcome' | 'risk' | 'action' | 'factor';

// ============================================================================
// Mappings
// ============================================================================

/**
 * Map of non-standard node kinds to canonical kinds.
 * LLMs may return synonyms like "evidence", "constraint", "benefit" etc.
 * that need to be normalised before Zod validation.
 */
export const NODE_KIND_MAP: Record<string, CanonicalNodeKind> = {
  // Canonical kinds (pass through)
  'goal': 'goal',
  'decision': 'decision',
  'option': 'option',
  'outcome': 'outcome',
  'risk': 'risk',
  'action': 'action',
  'factor': 'factor',

  // Synonyms that map to 'option'
  'evidence': 'option',
  'consideration': 'option',
  'alternative': 'option',
  'choice': 'option',
  'input': 'option',
  'criteria': 'option',
  'criterion': 'option',

  // Synonyms that map to 'risk'
  'constraint': 'risk',
  'issue': 'risk',
  'threat': 'risk',
  'problem': 'risk',
  'concern': 'risk',
  'challenge': 'risk',
  'blocker': 'risk',

  // Synonyms that map to 'outcome'
  'benefit': 'outcome',
  'result': 'outcome',
  'consequence': 'outcome',
  'impact': 'outcome',
  'effect': 'outcome',
  'reward': 'outcome',

  // Synonyms that map to 'goal'
  'objective': 'goal',
  'target': 'goal',
  'aim': 'goal',
  'purpose': 'goal',

  // Synonyms that map to 'action'
  'step': 'action',
  'task': 'action',
  'activity': 'action',
  'measure': 'action',

  // Synonyms that map to 'decision'
  'question': 'decision',
  'dilemma': 'decision',
};

// ============================================================================
// Functions
// ============================================================================

/**
 * Normalise a node kind from LLM output to a canonical kind.
 * Unknown kinds default to 'option' with a warning.
 */
export function normaliseNodeKind(kind: string): CanonicalNodeKind {
  const normalised = NODE_KIND_MAP[kind.toLowerCase().trim()];
  if (!normalised) {
    emit(TelemetryEvents.NodeKindNormalized, {
      original_kind: kind,
      normalised_kind: 'option',
      was_unknown: true,
    });
    log.warn({ original_kind: kind }, 'Unknown node kind from LLM, defaulting to option');
    return 'option';
  }
  return normalised;
}

/**
 * Normalise all node kinds in a draft response before Zod validation.
 * Also coerces string numbers to actual numbers for belief/weight.
 */
export function normaliseDraftResponse(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;

  const obj = raw as Record<string, unknown>;
  let normalisedCount = 0;

  // Normalise node kinds
  if (Array.isArray(obj.nodes)) {
    obj.nodes = obj.nodes.map((node: unknown) => {
      if (!node || typeof node !== 'object') return node;
      const n = node as Record<string, unknown>;

      if (typeof n.kind === 'string') {
        const original = n.kind;
        const normalised = normaliseNodeKind(n.kind);
        if (original.toLowerCase() !== normalised) {
          normalisedCount++;
          emit(TelemetryEvents.NodeKindNormalized, {
            original_kind: original,
            normalised_kind: normalised,
            node_id: n.id,
            was_unknown: false,
          });
        }
        return { ...n, kind: normalised };
      }
      return n;
    });
  }

  // Coerce string numbers to numbers for belief/weight on edges, and clamp to valid ranges
  // Also handle V4 format (strength.mean, strength.std, exists_probability)
  if (Array.isArray(obj.edges)) {
    obj.edges = obj.edges.map((edge: unknown) => {
      if (!edge || typeof edge !== 'object') return edge;
      const e = edge as Record<string, unknown>;

      // ========================================================================
      // V4 FORMAT HANDLING: strength.mean/std and exists_probability
      // Convert to internal representation (strength_mean, strength_std, belief_exists)
      // while preserving backwards compatibility with legacy weight/belief fields
      // ========================================================================

      let strength_mean: number | undefined = undefined;
      let strength_std: number | undefined = undefined;
      let belief_exists: number | undefined = undefined;

      // Handle V4 nested strength object
      // Use Number() coercion to handle string numbers (e.g., "0.7" → 0.7)
      if (e.strength && typeof e.strength === 'object') {
        const strength = e.strength as { mean?: unknown; std?: unknown };
        const parsedMean = Number(strength.mean);
        if (!Number.isNaN(parsedMean) && strength.mean !== undefined && strength.mean !== null) {
          strength_mean = parsedMean;
          log.debug({
            event: 'llm.normalisation.v4_strength_mean',
            edge_from: e.from,
            edge_to: e.to,
            strength_mean,
            was_string: typeof strength.mean === 'string',
          }, 'V4 strength.mean extracted');
        }
        const parsedStd = Number(strength.std);
        if (!Number.isNaN(parsedStd) && parsedStd > 0) {
          strength_std = parsedStd;
        }
      }

      // Handle V4 exists_probability
      // Use Number() coercion to handle string numbers
      if (e.exists_probability !== undefined && e.exists_probability !== null) {
        const rawProb = Number(e.exists_probability);
        if (!Number.isNaN(rawProb)) {
          if (rawProb < 0 || rawProb > 1) {
            belief_exists = Math.max(0, Math.min(1, rawProb));
            log.warn({
              event: 'llm.normalisation.exists_probability_clamped',
              edge_from: e.from,
              edge_to: e.to,
              raw: rawProb,
              clamped: belief_exists,
            }, `V4 exists_probability ${rawProb} clamped to ${belief_exists}`);
          } else {
            belief_exists = rawProb;
          }
        }
      }

      // ========================================================================
      // LEGACY FORMAT HANDLING: weight and belief
      // Use as fallback when V4 fields not present
      // ========================================================================

      // Parse and clamp belief to [0, 1] (legacy format)
      let belief: number | undefined = undefined;
      if (e.belief !== undefined && e.belief !== null) {
        const rawBelief = Number(e.belief);
        if (!isNaN(rawBelief)) {
          if (rawBelief < 0 || rawBelief > 1) {
            const clampedBelief = Math.max(0, Math.min(1, rawBelief));
            log.warn({
              event: 'llm.normalisation.belief_clamped',
              edge_from: e.from,
              edge_to: e.to,
              raw_belief: rawBelief,
              clamped_belief: clampedBelief,
            }, `Edge belief value ${rawBelief} clamped to ${clampedBelief}`);
            belief = clampedBelief;
          } else {
            belief = rawBelief;
          }
        }
      }

      // Parse weight (no clamping - can be any number for inverse relationships)
      let weight: number | undefined = undefined;
      if (e.weight !== undefined && e.weight !== null) {
        const rawWeight = Number(e.weight);
        if (!isNaN(rawWeight)) {
          weight = rawWeight;
        }
      }

      // ========================================================================
      // OUTPUT: V4 fields are primary, legacy fields preserved if present
      // Phase 2d: Downstream consumers now read V4 fields directly
      // Legacy fields only populated from original input (not mapped from V4)
      // ========================================================================

      return {
        ...e,
        // V4 fields (primary)
        strength_mean,
        strength_std,
        belief_exists,
        // Legacy fields (only from original input, NOT from V4 mapping)
        // Kept for backwards compatibility with old fixtures/inputs
        weight,
        belief,
      };
    });
  }

  if (normalisedCount > 0) {
    log.info({ normalised_count: normalisedCount }, `Normalised ${normalisedCount} non-standard node kind(s)`);
  }

  return obj;
}
