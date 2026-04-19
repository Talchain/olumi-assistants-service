/**
 * V5 Phase 1 — Validation Contract.
 *
 * Given a parsed ToolCallResponse proposal plus the graph and the handler
 * validation registry, produce a typed ValidationResult. Never throws; every
 * failure path yields a typed ValidationError.
 *
 * Ordered checks per spec §6:
 *   1. handler_id exists in registry                → HANDLER_NOT_FOUND
 *   2. entity.kind is accepted by the handler       → ENTITY_KIND_MISMATCH
 *   3. entity.id exists in graph                    → ENTITY_NOT_FOUND
 *   4. if resolution_method === 'label_match':
 *      Dice bigram sanity — if a closer match exists
 *      (Δ ≥ SUSPICIOUS_DICE_THRESHOLD) → ENTITY_RESOLUTION_SUSPICIOUS
 *   5. each parameter validates against its handler schema → PARAMETER_INVALID
 *   6. handler preconditions met                    → PRECONDITION_UNMET
 *
 * Non-labeled resolutions (id_match, kind_inference, context_inference) skip
 * the Dice check — Dice is specific to label-matched resolutions.
 *
 * This module does NOT:
 *   - call an LLM
 *   - hit the network
 *   - mutate graph or session state
 *   - perform any Math.round / .toFixed / parseFloat coercion on proposals
 *
 * REPAIR_ONCE behaviour (spec §7) is implemented by the *caller* (D5
 * route-with-tool-use.ts), not here. The validator is pure.
 */

import { z } from 'zod';

import type { EntityKind, ProposalAction, ProposalEntity, ProposalParameter } from './types.js';

// Dice coefficient delta above which the closer-match is flagged as
// suspicious. Conservative per brief §3 resolution D: flags for
// clarification, never silently overrides.
export const SUSPICIOUS_DICE_THRESHOLD = 0.15 as const;

// -----------------------------------------------------------------------
// Graph lookup interface
// -----------------------------------------------------------------------

/**
 * Minimal graph query surface the validator needs. Decouples the validator
 * from the concrete graph representation (GraphV3T, ContextPack, etc.). A
 * thin adapter in D6 wraps whichever shape TurnExecutor has at hand.
 */
export interface GraphLookup {
  /** Find a node by id — any kind. Returns null when absent. */
  findEntityById(id: string): { id: string; kind: EntityKind; label: string | null } | null;
  /** List all entities of a given kind. */
  listEntitiesByKind(kind: EntityKind): ReadonlyArray<{ id: string; label: string }>;
}

// -----------------------------------------------------------------------
// Handler validation registry
// -----------------------------------------------------------------------

/**
 * Precondition check — returns { ok: true } when preconditions are met, or
 * { ok: false, reason } to signal a typed PRECONDITION_UNMET to the caller.
 * Non-throwing.
 */
export type PreconditionCheck = (args: {
  graph: GraphLookup;
  entity: ProposalEntity;
  parameters: readonly ProposalParameter[];
}) => { ok: true } | { ok: false; reason: string };

export interface HandlerValidationDeclaration {
  readonly handler_id: string;
  readonly accepted_entity_kinds: readonly EntityKind[];
  /** Optional per-parameter Zod schemas. Absent means no parameter validation. */
  readonly parameter_schemas?: Readonly<Record<string, z.ZodType>>;
  /** Optional precondition — absent means handler has no preconditions. */
  readonly preconditions?: PreconditionCheck;
  /**
   * Typed-per-handler confirmation template (brief correction 5). Either a
   * static string, or a function that renders one from the HandlerOutcome.
   * Rendering is the CONFIRM step's responsibility (D6); the validator only
   * verifies presence here so we fail fast on misconfigured handlers.
   */
  readonly confirmation_template: string | ((outcome: unknown) => string);
}

export type HandlerValidationRegistry = Readonly<Record<string, HandlerValidationDeclaration>>;

// -----------------------------------------------------------------------
// Validation result
// -----------------------------------------------------------------------

export type ValidationErrorCode =
  | 'HANDLER_NOT_FOUND'
  | 'ENTITY_KIND_MISMATCH'
  | 'ENTITY_NOT_FOUND'
  | 'ENTITY_RESOLUTION_AMBIGUOUS'
  | 'ENTITY_RESOLUTION_SUSPICIOUS'
  | 'PARAMETER_INVALID'
  | 'PRECONDITION_UNMET';

export interface ValidationError {
  readonly code: ValidationErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type ValidationResult =
  | { readonly valid: true; readonly proposal: ProposalAction }
  | { readonly valid: false; readonly error: ValidationError };

// -----------------------------------------------------------------------
// Dice bigram similarity
// -----------------------------------------------------------------------

/**
 * Sørensen–Dice coefficient over character bigrams.
 *
 *   2 × |bigrams(a) ∩ bigrams(b)| / (|bigrams(a)| + |bigrams(b)|)
 *
 * Case-insensitive. Whitespace is preserved inside bigrams so "Marketing
 * Cost" and "Marketing" produce overlapping bigrams on the shared prefix.
 * Strings shorter than two characters compare by equality.
 */
export function bigramDice(a: string, b: string): number {
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();
  if (normA.length === 0 || normB.length === 0) return 0;
  if (normA === normB) return 1;
  if (normA.length < 2 || normB.length < 2) return 0;

  const bigramsA = bigramMultiset(normA);
  const bigramsB = bigramMultiset(normB);
  let overlap = 0;
  for (const [bg, countA] of bigramsA) {
    const countB = bigramsB.get(bg);
    if (countB !== undefined) overlap += Math.min(countA, countB);
  }
  const total = countTotal(bigramsA) + countTotal(bigramsB);
  return total === 0 ? 0 : (2 * overlap) / total;
}

function bigramMultiset(s: string): Map<string, number> {
  const ms = new Map<string, number>();
  for (let i = 0; i + 1 < s.length; i++) {
    const bg = s.slice(i, i + 2);
    ms.set(bg, (ms.get(bg) ?? 0) + 1);
  }
  return ms;
}

function countTotal(ms: Map<string, number>): number {
  let total = 0;
  for (const c of ms.values()) total += c;
  return total;
}

// -----------------------------------------------------------------------
// validateToolCall
// -----------------------------------------------------------------------

export function validateToolCall(
  proposal: ProposalAction,
  graph: GraphLookup,
  registry: HandlerValidationRegistry,
): ValidationResult {
  const decl = registry[proposal.handler_id];
  if (!decl) {
    return {
      valid: false,
      error: {
        code: 'HANDLER_NOT_FOUND',
        message: `Unknown handler_id: "${proposal.handler_id}"`,
        details: {
          handler_id: proposal.handler_id,
          registered: Object.keys(registry),
        },
      },
    };
  }

  // Per tool-schema.ts parser intent: execute proposals with
  // resolution_status !== 'resolved' must NOT execute. The parser accepts
  // them so the validator can surface candidates in a typed clarification
  // path; downstream compose can ask the user to disambiguate.
  if (proposal.entity.resolution_status !== 'resolved') {
    return {
      valid: false,
      error: {
        code: 'ENTITY_RESOLUTION_AMBIGUOUS',
        message: `Entity resolution is "${proposal.entity.resolution_status}" — cannot execute without confirmation`,
        details: {
          entity_id: proposal.entity.id,
          entity_kind: proposal.entity.kind,
          resolution_status: proposal.entity.resolution_status,
          resolution_method: proposal.entity.resolution_method,
          ...(proposal.entity.candidates ? { candidates: proposal.entity.candidates } : {}),
        },
      },
    };
  }

  if (!decl.accepted_entity_kinds.includes(proposal.entity.kind)) {
    return {
      valid: false,
      error: {
        code: 'ENTITY_KIND_MISMATCH',
        message: `Handler "${decl.handler_id}" does not accept entity kind "${proposal.entity.kind}"`,
        details: {
          handler_id: decl.handler_id,
          proposed_kind: proposal.entity.kind,
          accepted_kinds: [...decl.accepted_entity_kinds],
        },
      },
    };
  }

  const existing = graph.findEntityById(proposal.entity.id);
  if (!existing) {
    return {
      valid: false,
      error: {
        code: 'ENTITY_NOT_FOUND',
        message: `Entity "${proposal.entity.id}" not found in graph`,
        details: {
          entity_id: proposal.entity.id,
          entity_kind: proposal.entity.kind,
        },
      },
    };
  }

  if (proposal.entity.resolution_method === 'label_match') {
    const suspicion = detectSuspiciousLabelMatch(proposal.entity, graph);
    if (suspicion) return { valid: false, error: suspicion };
  }

  if (decl.parameter_schemas) {
    for (const p of proposal.parameters) {
      const schema = decl.parameter_schemas[p.name];
      if (!schema) continue; // unknown parameter — silently ignored, handler will cope or reject
      const parsed = schema.safeParse(p.value);
      if (!parsed.success) {
        return {
          valid: false,
          error: {
            code: 'PARAMETER_INVALID',
            message: `Parameter "${p.name}" failed schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
            details: {
              parameter: p.name,
              issue: parsed.error.issues[0]?.message,
            },
          },
        };
      }
    }
  }

  if (decl.preconditions) {
    const pre = decl.preconditions({ graph, entity: proposal.entity, parameters: proposal.parameters });
    if (!pre.ok) {
      return {
        valid: false,
        error: {
          code: 'PRECONDITION_UNMET',
          message: `Precondition unmet: ${pre.reason}`,
          details: {
            handler_id: decl.handler_id,
            reason: pre.reason,
          },
        },
      };
    }
  }

  return { valid: true, proposal };
}

function detectSuspiciousLabelMatch(
  entity: ProposalEntity,
  graph: GraphLookup,
): ValidationError | null {
  if (!entity.label) return null;
  const candidates = graph.listEntitiesByKind(entity.kind);
  const chosen = candidates.find((c) => c.id === entity.id);
  if (!chosen) return null; // findEntityById already proved it exists, but kind filter might miss it — just skip

  const chosenScore = bigramDice(entity.label, chosen.label);
  let bestOther: { id: string; label: string; score: number } | null = null;
  for (const cand of candidates) {
    if (cand.id === entity.id) continue;
    const score = bigramDice(entity.label, cand.label);
    if (!bestOther || score > bestOther.score) {
      bestOther = { ...cand, score };
    }
  }

  if (bestOther && bestOther.score - chosenScore >= SUSPICIOUS_DICE_THRESHOLD) {
    return {
      code: 'ENTITY_RESOLUTION_SUSPICIOUS',
      message:
        `Label match may be wrong: chosen "${chosen.label}" Dice=${chosenScore} ` +
        `but closer candidate "${bestOther.label}" Dice=${bestOther.score}`,
      details: {
        entity_id: entity.id,
        chosen: { id: chosen.id, label: chosen.label, dice: chosenScore },
        closer_candidate: { id: bestOther.id, label: bestOther.label, dice: bestOther.score },
        delta: bestOther.score - chosenScore,
      },
    };
  }

  return null;
}
