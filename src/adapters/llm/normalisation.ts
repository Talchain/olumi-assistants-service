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

      // Preserve flat V4 fields if already provided
      if (e.strength_mean !== undefined && e.strength_mean !== null) {
        const parsedMean = Number(e.strength_mean);
        if (!Number.isNaN(parsedMean)) {
          strength_mean = parsedMean;
        }
      }

      if (e.strength_std !== undefined && e.strength_std !== null) {
        const parsedStd = Number(e.strength_std);
        if (!Number.isNaN(parsedStd) && parsedStd > 0) {
          strength_std = parsedStd;
        }
      }

      if (e.belief_exists !== undefined && e.belief_exists !== null) {
        const rawBeliefExists = Number(e.belief_exists);
        if (!Number.isNaN(rawBeliefExists)) {
          if (rawBeliefExists < 0 || rawBeliefExists > 1) {
            belief_exists = Math.max(0, Math.min(1, rawBeliefExists));
            log.warn({
              event: 'llm.normalisation.belief_exists_clamped',
              edge_from: e.from,
              edge_to: e.to,
              raw: rawBeliefExists,
              clamped: belief_exists,
            }, `V4 belief_exists ${rawBeliefExists} clamped to ${belief_exists}`);
          } else {
            belief_exists = rawBeliefExists;
          }
        }
      }

      // Handle V4 nested strength object
      // Use Number() coercion to handle string numbers (e.g., "0.7" → 0.7)
      if (strength_mean === undefined && e.strength && typeof e.strength === 'object') {
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
        if (strength_std === undefined && !Number.isNaN(parsedStd) && parsedStd > 0) {
          strength_std = parsedStd;
        }
      }

      // Handle V4 exists_probability
      // Use Number() coercion to handle string numbers
      if (belief_exists === undefined && e.exists_probability !== undefined && e.exists_probability !== null) {
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

    // [DIAGNOSTIC] Temporary: stratified edge field sample after V4 extraction.
    // Samples 1 structural + 1 causal + 1 bridge edge to avoid sampling bias
    // (previous .slice(0,3) always picked structural dec→opt edges without strength).
    // Remove after confirming extraction behaviour on staging.
    if ((obj.edges as any[]).length > 0) {
      const allEdges = (obj.edges as any[]).filter((e: any) => e && typeof e === 'object');
      const sorted = [...allEdges].sort((a: any, b: any) =>
        `${a.from ?? ''}::${a.to ?? ''}`.localeCompare(`${b.from ?? ''}::${b.to ?? ''}`)
      );
      const mapEdge = (e: any) => ({
        from: e.from,
        to: e.to,
        strength_mean: e.strength_mean ?? 'MISSING',
        strength_nested: typeof e.strength === 'object' && e.strength !== null
          ? { mean: e.strength.mean, std: e.strength.std }
          : (e.strength === undefined ? 'UNDEFINED' : `TYPE:${typeof e.strength}`),
        weight: e.weight ?? 'MISSING',
        belief_exists: e.belief_exists ?? 'MISSING',
      });
      // Stratified: 1 structural (dec_/opt_ source), 1 causal (fac_ source), 1 bridge (→goal_ target)
      // Falls back to first sorted edge if no prefixed IDs found
      const structural = sorted.find((e: any) => e.from?.startsWith('dec_') || e.from?.startsWith('opt_'));
      const causal = sorted.find((e: any) => e.from?.startsWith('fac_'));
      const bridge = sorted.find((e: any) => e.to?.startsWith('goal_'));
      const stratified = [structural, causal, bridge].filter(Boolean);
      const diagSample = (stratified.length > 0 ? stratified : sorted.slice(0, 3)).map(mapEdge);

      const withStrengthCount = allEdges.filter((e: any) => e.strength_mean !== undefined).length;
      const withNestedCount = allEdges.filter((e: any) => typeof e.strength === 'object' && e.strength !== null).length;

      log.debug(
        {
          event: 'llm.normalisation.post_extraction_diagnostic',
          edge_count: allEdges.length,
          edges_with_strength_mean: withStrengthCount,
          edges_with_nested_strength: withNestedCount,
          sample_edges: diagSample,
        },
        `[DIAGNOSTIC] Edge fields after V4 extraction: ${withStrengthCount}/${allEdges.length} have strength_mean`,
      );
    }
  }

  if (normalisedCount > 0) {
    log.info({ normalised_count: normalisedCount }, `Normalised ${normalisedCount} non-standard node kind(s)`);
  }

  return obj;
}

/**
 * Ensure all controllable factors have baseline values (data.value).
 *
 * Controllable factors are factors with incoming option→factor edges.
 * When LLM fails to output data.value for a controllable factor,
 * we add a default value of 1.0 with extractionType: "inferred".
 *
 * This ensures ISL can compute sensitivity analysis.
 *
 * @param response - Draft graph response
 * @returns Response with baseline values ensured on controllable factors
 */
export function ensureControllableFactorBaselines(response: unknown): {
  response: unknown;
  defaultedFactors: string[];
} {
  const defaultedFactors: string[] = [];

  if (!response || typeof response !== 'object') {
    return { response, defaultedFactors };
  }

  const obj = response as Record<string, unknown>;
  const nodes = obj.nodes as Array<Record<string, unknown>> | undefined;
  const edges = obj.edges as Array<Record<string, unknown>> | undefined;

  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return { response, defaultedFactors };
  }

  // Build set of controllable factor IDs (factors with incoming option→factor edges)
  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) {
    if (typeof node.id === 'string' && typeof node.kind === 'string') {
      nodeKindMap.set(node.id, node.kind);
    }
  }

  const controllableFactorIds = new Set<string>();
  for (const edge of edges) {
    const fromId = edge.from ?? edge.source;
    const toId = edge.to ?? edge.target;
    if (typeof fromId === 'string' && typeof toId === 'string') {
      const fromKind = nodeKindMap.get(fromId);
      const toKind = nodeKindMap.get(toId);
      // option→factor edge makes the factor controllable
      if (fromKind === 'option' && toKind === 'factor') {
        controllableFactorIds.add(toId);
      }
    }
  }

  // For each controllable factor, ensure data.value exists
  const updatedNodes = nodes.map((node) => {
    const nodeId = typeof node.id === 'string' ? node.id : undefined;
    const nodeKind = typeof node.kind === 'string' ? node.kind : undefined;

    if (!nodeId || nodeKind !== 'factor' || !controllableFactorIds.has(nodeId)) {
      return node;
    }

    // Check if node already has data.value
    const data = node.data as Record<string, unknown> | undefined;
    if (data && typeof data.value === 'number') {
      return node; // Already has value
    }

    // Add default baseline value
    defaultedFactors.push(nodeId);
    log.info({
      event: 'llm.normalisation.factor_baseline_defaulted',
      factor_id: nodeId,
      default_value: 1.0,
      extraction_type: 'inferred',
    }, `Controllable factor ${nodeId} missing data.value, defaulting to 1.0`);

    return {
      ...node,
      data: {
        ...(data || {}),
        value: 1.0,
        extractionType: 'inferred',
      },
    };
  });

  if (defaultedFactors.length > 0) {
    emit(TelemetryEvents.FactorBaselineDefaulted, {
      defaulted_count: defaultedFactors.length,
      factor_ids: defaultedFactors,
    });
  }

  return {
    response: { ...obj, nodes: updatedNodes },
    defaultedFactors,
  };
}
