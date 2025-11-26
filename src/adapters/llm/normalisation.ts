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

export type CanonicalNodeKind = 'goal' | 'decision' | 'option' | 'outcome' | 'risk' | 'action';

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

  // Synonyms that map to 'option'
  'evidence': 'option',
  'factor': 'option',
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

  // Coerce string numbers to numbers for belief/weight on edges
  if (Array.isArray(obj.edges)) {
    obj.edges = obj.edges.map((edge: unknown) => {
      if (!edge || typeof edge !== 'object') return edge;
      const e = edge as Record<string, unknown>;

      return {
        ...e,
        weight: e.weight !== undefined ? Number(e.weight) : undefined,
        belief: e.belief !== undefined ? Number(e.belief) : undefined,
      };
    });
  }

  if (normalisedCount > 0) {
    log.info({ normalised_count: normalisedCount }, `Normalised ${normalisedCount} non-standard node kind(s)`);
  }

  return obj;
}
