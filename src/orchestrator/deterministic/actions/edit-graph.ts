/**
 * edit_graph V4 action — thin adapter around V2 handleEditGraph.
 *
 * The V2 handler is battle-tested: PLoT integration, patch validation,
 * structural checks, proposal-language guard, per-op metadata, retries.
 * This adapter:
 *   1. Builds a ConversationContext from DeterministicTurnContext + turnRequest.
 *   2. Resolves adapter + PLoT client.
 *   3. Calls handleEditGraph.
 *   4. Remaps EditGraphResult → ActionResult, applying V4 hardening layers:
 *        - ID sanitisation in assistantText
 *        - Edge endpoint validation (includes add_node-created ids)
 *        - Orphan check on fully-applied preview graph
 *        - Intervention preservation snapshot/detect/log (no auto-restore)
 *        - Matching-artefact honesty guard
 *        - Unsupported-capability fallback
 *
 * v1 scope: ideate only. requires_confirmation=false. pendingProposal and
 * pendingClarification are treated distinctly: clarification becomes an
 * assistantText question; proposal is deferred to the unsupported-capability
 * fallback (v1 does not run V2's confirmation flow).
 */

import type { ActionDefinition } from "./types.js";
import type { DeterministicTurnContext, ActionResult, ActionFailure } from "../types.js";
import type { HandlerFact } from "../response-composer.js";
import type {
  ConversationContext,
  GraphPatchBlockData,
  OrchestratorError,
  PatchOperation,
  SuggestedAction,
  TypedConversationBlock,
} from "../../types.js";
import type { GraphV3T, NodeV3T, NodeKindV3T } from "../../../schemas/cee-v3.js";
import type { EditGraphResult } from "../../tools/edit-graph.js";
import { log } from "../../../utils/telemetry.js";
import { flattenInterventions } from "../../utils/flatten-interventions.js";
import { TOKEN_OVERLAP_STOPWORDS } from "../../tools/token-overlap.js";

const STRUCTURAL_INTENT_RE =
  /\b(connect|disconnect|fix|wire|link|rewire|add.*connection|remove.*connection|isn'?t connected|not connected|missing connection)\b/i;

// ──────────────────────────────────────────────────────────────────────
// Zero-match kind inference + similarity (S2 fix)
//
// When handleEditGraph returns a pendingClarification with empty
// candidate_labels (match_type='none'), the V2 path hands back a generic
// "which one did you mean?" question with no visible graph entities.
// This block intercepts before the V4 clarification return and builds a
// grounded response using nodes of the inferred kind, falling back to
// global label similarity when the inferred kind has no nodes.
// ──────────────────────────────────────────────────────────────────────

/**
 * Synonyms grouped by inferred kind. Shared between inferEditKind and
 * substituteEntityInMessage so the substitution can find whichever synonym
 * the user actually wrote (e.g. "danger" instead of "risk").
 */
const KIND_SYNONYMS: Record<Exclude<NodeKindV3T, 'action' | 'decision'>, readonly string[]> = {
  risk: ['risk', 'danger', 'threat'],
  factor: ['factor', 'cost', 'budget', 'capacity'],
  outcome: ['outcome', 'result'],
  option: ['option', 'alternative'],
  goal: ['goal', 'objective'],
} as const;

/** Map keyword hits in the user's message to a NodeKindV3T. */
function inferEditKind(message: string): NodeKindV3T | null {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const [kind, synonyms] of Object.entries(KIND_SYNONYMS)) {
    const pattern = new RegExp(`\\b(?:${synonyms.join('|')})\\b`, 'i');
    if (pattern.test(lower)) return kind as NodeKindV3T;
  }
  return null;
}

function tokeniseForSimilarity(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !TOKEN_OVERLAP_STOPWORDS.has(t));
}

/**
 * Score a node label against the user's phrase using simple token-overlap
 * ratio. Returns 0 when no significant tokens overlap.
 */
function labelSimilarity(phraseTokens: string[], label: string): number {
  if (phraseTokens.length === 0) return 0;
  const labelTokens = tokeniseForSimilarity(label);
  if (labelTokens.length === 0) return 0;
  const phraseSet = new Set(phraseTokens);
  let overlap = 0;
  for (const lt of labelTokens) {
    if (phraseSet.has(lt)) {
      overlap++;
      continue;
    }
    for (const pt of phraseTokens) {
      const shorter = lt.length <= pt.length ? lt : pt;
      const longer = lt.length <= pt.length ? pt : lt;
      if (longer.includes(shorter) && shorter.length / longer.length >= 0.6) {
        overlap++;
        break;
      }
    }
  }
  return overlap / labelTokens.length;
}

function topSimilarNodes(
  phrase: string,
  nodes: ReadonlyArray<NodeV3T>,
  limit: number,
): Array<{ node: NodeV3T; score: number }> {
  const tokens = tokeniseForSimilarity(phrase);
  const scored: Array<{ node: NodeV3T; score: number }> = [];
  for (const node of nodes) {
    if (!node.label) continue;
    const score = labelSimilarity(tokens, node.label);
    if (score > 0) scored.push({ node, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.node.id.localeCompare(b.node.id);
  });
  return scored.slice(0, limit);
}

/**
 * Substitute the unresolved entity phrase in the user's message with a
 * concrete candidate label, preserving the rest of the message verbatim.
 *
 * Example: "connect the pricing risk to the revenue outcome" with
 * inferredKind='risk' and candidate='Market Pricing Risk' →
 * "connect Market Pricing Risk to the revenue outcome".
 *
 * Matches up to 3 words preceding the kind keyword (optional article),
 * replaces the whole span with the candidate label. When the inferred kind
 * was detected via a synonym (e.g. "danger" → risk), the synonym pattern
 * matches so substitution still works.
 *
 * If no kind noun can be found in the message (generic input, no kind
 * inference), a disambiguation suffix is appended so the chip's
 * edit_description ALWAYS references the selected candidate — otherwise
 * clicking the chip re-submits the same ambiguous text and V2 rebounds to
 * clarify again.
 */
function substituteEntityInMessage(
  userMessage: string,
  inferredKind: NodeKindV3T | null,
  candidateLabel: string,
): string {
  const trimmed = userMessage.trim();
  if (!trimmed) return candidateLabel;
  if (inferredKind && inferredKind in KIND_SYNONYMS) {
    const synonyms = KIND_SYNONYMS[inferredKind as keyof typeof KIND_SYNONYMS];
    // Match optional article + up to 3 descriptor words + any synonym for
    // this kind. Use word boundaries so we don't cut inside longer words.
    const synonymAlternation = synonyms.join('|');
    const kindPattern = new RegExp(
      `\\b(?:the\\s+|a\\s+|an\\s+|some\\s+|this\\s+|that\\s+)?(?:\\w+\\s+){0,3}(?:${synonymAlternation})\\b`,
      'i',
    );
    if (kindPattern.test(trimmed)) {
      return trimmed.replace(kindPattern, candidateLabel);
    }
  }
  // Fallback: no kind noun in the message (or no inferred kind). Append a
  // disambiguation suffix so the chip prompt can't re-trigger the same
  // zero-match path on click. House style forbids em-dashes in user-facing
  // copy; use a comma-led clause instead.
  return `${trimmed}, referring to "${candidateLabel}"`;
}

/**
 * Build the clarification response for a zero-match edit_graph turn.
 * Returns an ActionResult with assistantText + suggestedActions (chips
 * capped at 3 per DS v5). When no grounded candidates can be found,
 * returns a short text-only response with no chips.
 */
function buildZeroMatchClarification(
  editDescription: string,
  graph: GraphV3T,
  turnId: string,
  userMessage?: string | null,
): ActionResult {
  const inferredKind = inferEditKind(editDescription);
  const structural = STRUCTURAL_INTENT_RE.test(editDescription);
  const actionVerb = structural ? 'Connect' : 'Edit';
  // Canonical phrase to substitute into: prefer the user's raw turn message,
  // fall back to the edit_description passed to the tool.
  const sourceMessage = (userMessage ?? '').trim() || editDescription;

  const makeChip = (node: NodeV3T, index: number): SuggestedAction => {
    const candidateLabel = node.label ?? node.id;
    // Preserve the user's full intent (e.g. "connect X to the revenue
    // outcome") with the entity reference swapped to the concrete label.
    // Falls back to the explicit "Connect/Edit <label>" phrasing when no
    // kind-bearing noun phrase was found in the user's message.
    const preservedPrompt = substituteEntityInMessage(
      sourceMessage,
      inferredKind,
      candidateLabel,
    );
    const chipLabel = `${actionVerb} ${candidateLabel}`;
    return {
      label: chipLabel,
      prompt: preservedPrompt,
      role: 'facilitator',
      action_type: 'edit_graph',
      parameters: {
        edit_description: preservedPrompt,
        target_id: node.id,
        chip_id: `edit_zero_match_${index}_${node.id}`,
      },
    };
  };

  // Try kind-inferred matches first.
  if (inferredKind) {
    const sameKind = graph.nodes.filter((n) => n.kind === inferredKind);
    if (sameKind.length > 0) {
      // Rank by similarity to phrase; if >5, cap the shown set at 5 for
      // the assistant text, then cap chips at 3. If similarity returns zero
      // ranked candidates (no token overlap), fall back to the deterministic
      // first 5 by id — clarification must never list no nodes.
      let ranked: NodeV3T[];
      if (sameKind.length <= 5) {
        ranked = sameKind.slice();
      } else {
        const scored = topSimilarNodes(editDescription, sameKind, 5).map((s) => s.node);
        ranked = scored.length > 0
          ? scored
          : sameKind.slice().sort((a, b) => a.id.localeCompare(b.id)).slice(0, 5);
      }
      const labels = ranked.map((n) => n.label ?? n.id);
      const assistantText = `I couldn't find that exact element. Your model has these ${inferredKind} nodes: ${labels.join(', ')}. Which did you mean?`;
      const chips = ranked.slice(0, 3).map((n, i) => makeChip(n, i));

      log.info({
        event: 'v4.edit_graph_zero_match_clarification',
        turn_id: turnId,
        inferred_kind: inferredKind,
        candidates_shown: labels.length,
        user_phrase: editDescription.slice(0, 120),
        fallback_used: false,
      }, 'Zero-match clarification with kind-inferred candidates');

      return {
        blocks: [],
        assistantText,
        guidance_items: [],
        suggested_actions_override: chips,
      };
    }
  }

  // Global similarity fallback.
  const top = topSimilarNodes(editDescription, graph.nodes, 5);
  const abovethreshold = top.filter((s) => s.score >= 0.3);
  if (abovethreshold.length > 0) {
    const labels = abovethreshold.map((s) => s.node.label ?? s.node.id);
    const assistantText = `I couldn't find that exact element. Your model has these similar nodes: ${labels.join(', ')}. Which did you mean?`;
    const chips = abovethreshold.slice(0, 3).map((s, i) => makeChip(s.node, i));

    log.info({
      event: 'v4.edit_graph_zero_match_clarification',
      turn_id: turnId,
      inferred_kind: inferredKind,
      candidates_shown: labels.length,
      user_phrase: editDescription.slice(0, 120),
      fallback_used: true,
    }, 'Zero-match clarification via global similarity fallback');

    return {
      blocks: [],
      assistantText,
      guidance_items: [],
      suggested_actions_override: chips,
    };
  }

  // No grounded candidates. Text-only response, no chips (v1 safety: do
  // not auto-offer an add path until it is validated).
  log.info({
    event: 'v4.edit_graph_zero_match_clarification',
    turn_id: turnId,
    inferred_kind: inferredKind,
    candidates_shown: 0,
    user_phrase: editDescription.slice(0, 120),
    fallback_used: inferredKind === null,
  }, 'Zero-match clarification — no grounded candidates');

  // Explicit empty override: authoritative "no chips" signal to the envelope
  // assembler, which would otherwise fall through to the chip engine.
  return {
    blocks: [],
    assistantText: "Your model doesn't include an element matching that description.",
    guidance_items: [],
    suggested_actions_override: [],
  };
}

/**
 * Exported for use by tool-builder: returns true if the user's raw message
 * implies a structural edit. Tool-builder uses this to suppress
 * adjust_edge_strength from the resolved LLM tool set, biasing toward
 * edit_graph without hard-coding the choice.
 */
export function messageImpliesStructuralEdit(message: string | null | undefined): boolean {
  if (!message) return false;
  return STRUCTURAL_INTENT_RE.test(message);
}

/**
 * Snapshot per-option intervention maps by passing the graph through
 * computeStructuralReadiness and running each option's intervention record
 * through the shared flattenInterventions normaliser. This is the canonical
 * intervention payload — what analysis_ready exposes to downstream consumers
 * — so detection tracks real intervention loss (including value-only
 * removals), not just inbound-edge count proxies.
 *
 * Returns Map<option_id, flat Record<factor_id, number>>. Options whose
 * interventions can't be flattened (malformed values) are skipped with a
 * warning; detection is advisory, so we degrade rather than throw.
 */
export function snapshotOptionInterventions(
  graph: GraphV3T | null,
  computeReadiness: (g: GraphV3T) => { options: Array<{ option_id: string; interventions: Record<string, number> }> } | undefined,
): Map<string, Record<string, number>> {
  const snapshots = new Map<string, Record<string, number>>();
  if (!graph) return snapshots;
  const ready = computeReadiness(graph);
  if (!ready) return snapshots;
  for (const opt of ready.options) {
    try {
      snapshots.set(opt.option_id, flattenInterventions(opt.interventions, opt.option_id, 0));
    } catch (err) {
      log.warn(
        { err, option_id: opt.option_id },
        'v4.edit_graph_snapshot_flatten_failed',
      );
      snapshots.set(opt.option_id, {});
    }
  }
  return snapshots;
}

/** Extract the id an add_node op creates. */
function addNodeId(op: PatchOperation): string | null {
  if (op.op !== 'add_node') return null;
  if (typeof op.path === 'string' && op.path.length > 0) return op.path;
  if (op.value && typeof op.value === 'object') {
    const id = (op.value as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return null;
}

/** Extract the id an remove_node op removes. */
function removeNodeId(op: PatchOperation): string | null {
  if (op.op !== 'remove_node') return null;
  if (typeof op.path === 'string' && op.path.length > 0) return op.path;
  return null;
}

/**
 * Validate every add_edge op sequentially against a rolling id set: each
 * add_edge may reference base-graph nodes and nodes created by EARLIER
 * operations in the same patch, not later ones. The V2 patch-applier runs
 * operations in order, so an edge referencing a not-yet-added node would
 * fail at apply time. Validation must match apply semantics.
 */
export function validateEdgeEndpoints(
  baseGraph: GraphV3T | null,
  operations: PatchOperation[],
): { kept: PatchOperation[]; stripped: PatchOperation[] } {
  const rollingIds = new Set<string>();
  for (const n of baseGraph?.nodes ?? []) rollingIds.add(n.id);

  const kept: PatchOperation[] = [];
  const stripped: PatchOperation[] = [];

  for (const op of operations) {
    if (op.op === 'add_edge' && op.value && typeof op.value === 'object') {
      const from = (op.value as { from?: unknown }).from;
      const to = (op.value as { to?: unknown }).to;
      const fromOk = typeof from === 'string' && rollingIds.has(from);
      const toOk = typeof to === 'string' && rollingIds.has(to);
      if (!fromOk || !toOk) {
        stripped.push(op);
        continue;
      }
      kept.push(op);
      continue;
    }

    // Mutate the rolling id set AFTER the op's own endpoint check.
    kept.push(op);
    const added = addNodeId(op);
    if (added) rollingIds.add(added);
    const removed = removeNodeId(op);
    if (removed) rollingIds.delete(removed);
  }

  return { kept, stripped };
}

/**
 * Sanitise node IDs (fac_*, opt_*, risk_*, goal_*, dec_*, out_*) in the
 * assistant text by replacing them with the corresponding node's label.
 * Falls back to "that element" when no match is found.
 */
export function sanitiseNodeIdsInText(text: string, graph: GraphV3T | null): string {
  if (!text || !graph) return text;
  const idToLabel = new Map<string, string>();
  for (const n of graph.nodes ?? []) {
    if (typeof n.id === 'string' && typeof n.label === 'string') {
      idToLabel.set(n.id, n.label);
    }
  }
  return text.replace(/\b(fac|opt|risk|goal|dec|out)_[a-z0-9_]+/g, (match) => {
    const label = idToLabel.get(match);
    return label ?? 'that element';
  });
}

/**
 * Honesty guard: if the assistant says it performed a structural change but
 * the returned operations are calibration-only (update_edge weight/belief
 * only), rewrite the text. Prevents overclaiming.
 */
export function detectCalibrationOnlyArtefact(
  text: string,
  operations: PatchOperation[],
): boolean {
  if (!text || operations.length === 0) return false;
  const structuralLanguage = /\b(connecting|adding|removing|rewiring|connected|added|removed|rewired)\b/i;
  if (!structuralLanguage.test(text)) return false;
  return operations.every((op) => op.op === 'update_edge');
}

/**
 * Orphan check: list ids added this patch that have no incident edge in the
 * fully-applied preview graph.
 */
export function findOrphans(
  appliedGraph: GraphV3T,
  addedNodeIds: string[],
): string[] {
  const orphans: string[] = [];
  for (const id of addedNodeIds) {
    const incident = (appliedGraph.edges ?? []).some(
      (e) => e.from === id || e.to === id,
    );
    if (!incident) orphans.push(id);
  }
  return orphans;
}

/** Extract add_node ids from a list of operations. */
function extractAddedNodeIds(operations: PatchOperation[]): string[] {
  const ids: string[] = [];
  for (const op of operations) {
    const id = addNodeId(op);
    if (id) ids.push(id);
  }
  return ids;
}

function liftGraphPatchBlockData(
  blocks: TypedConversationBlock[],
): GraphPatchBlockData | null {
  for (const block of blocks) {
    if (block.block_type === 'graph_patch') {
      return block.data;
    }
  }
  return null;
}

export const editGraphAction: ActionDefinition = {
  action_type: 'edit_graph',
  description:
    'Make structural changes to the decision model: add or remove factors and options, create or remove connections between nodes, rename nodes, or fix disconnected nodes. Use for anything that is not a simple value update (set_factor_value) or adding a new option (add_option).',
  stage_eligibility: new Set(['ideate']),
  requires_target: false,
  requires_confirmation: false,
  execution_risk: 'moderate',
  reversible: true,
  surface: 'proposal_card',
  role: 'facilitator',
  cooldown: 'none',
  input_schema: {
    type: 'object',
    properties: {
      edit_description: {
        type: 'string',
        description: 'Natural language description of the edit to make to the graph.',
      },
    },
    required: ['edit_description'],
    additionalProperties: false,
  },

  prerequisite_checks(ctx: DeterministicTurnContext): string | null {
    if (!ctx.graph) return 'No decision model available.';
    return null;
  },

  async execute(params: Record<string, unknown>, ctx: DeterministicTurnContext): Promise<ActionResult> {
    const editDescription = typeof params.edit_description === 'string' ? params.edit_description : '';
    if (!editDescription.trim()) {
      return unsupportedFallback();
    }

    const { handleEditGraph } = await import("../../tools/edit-graph.js");
    const { createPLoTClient } = await import("../../plot-client.js");
    const { getAdapter } = await import("../../../adapters/llm/router.js");
    const { generatePostDraftGuidance } = await import("../../guidance/post-draft.js");
    const { computeStructuralReadiness } = await import("../../tools/analysis-ready-helper.js");

    const adapter = getAdapter('edit_graph');
    const plotClient = createPLoTClient();

    const context: ConversationContext = {
      graph: ctx.graph,
      analysis_response: ctx.analysis,
      framing: ctx.stage ? { stage: ctx.stage } : null,
      messages: ctx.messages ?? [],
      scenario_id: ctx.scenario_id,
      analysis_inputs: ctx.analysis_inputs ?? undefined,
      ...(ctx.conversational_state ? { conversational_state: ctx.conversational_state } : {}),
    };

    const requestId = `v4-edit-${ctx.turn_id}`;

    // Snapshot canonical per-option intervention maps BEFORE edit (detect-only,
    // no auto-restore in v1). Uses computeStructuralReadiness + shared
    // flattenInterventions so detection reflects the payload analysis_ready
    // exposes, not an inbound-edge-count proxy.
    const preSnapshots = snapshotOptionInterventions(ctx.graph, computeStructuralReadiness);

    let result: EditGraphResult;
    try {
      result = await handleEditGraph(
        context,
        editDescription,
        adapter,
        requestId,
        ctx.turn_id,
        { plotClient, invocationInput: params },
      );
    } catch (err) {
      // V2 handleEditGraph attaches .orchestratorError to thrown errors
      // (missing graph, LLM failure, parse failure, etc.). Mirror
      // run-analysis.ts: branch on orchestratorError.code to produce
      // structured failure codes and friendlier user text instead of a
      // single generic EDIT_GRAPH_HANDLER_ERROR, so telemetry and the
      // eventual UI can distinguish recoverable vs fatal outcomes.
      const orchestratorErr = (err as { orchestratorError?: OrchestratorError }).orchestratorError;
      if (orchestratorErr) {
        log.error(
          { err, turn_id: ctx.turn_id, error_code: orchestratorErr.code },
          'v4.edit_graph_orchestrator_error',
        );
        const userMessage = friendlyEditGraphError(orchestratorErr);
        return {
          blocks: [],
          assistantText: userMessage,
          guidance_items: [],
          failure: {
            code: `EDIT_GRAPH_${orchestratorErr.code}`,
            message: orchestratorErr.message,
            user_message: userMessage,
            recovery_hint: orchestratorErr.recoverable
              ? 'Try rephrasing the edit.'
              : undefined,
          },
        };
      }

      log.error(
        { err, turn_id: ctx.turn_id },
        'v4.edit_graph_handler_threw',
      );
      return {
        blocks: [],
        assistantText: "I couldn't apply that edit. Could you try rephrasing it?",
        guidance_items: [],
        failure: {
          code: 'EDIT_GRAPH_HANDLER_ERROR',
          message: err instanceof Error ? err.message : String(err),
          user_message: "I couldn't apply that edit. Could you try rephrasing it?",
        },
      };
    }

    // ── Pending clarification: surface as assistantText question ─────────
    if (result.pendingClarification) {
      // S2 intercept: V2 returns pendingClarification with empty
      // candidate_labels when resolveEditTarget hit match_type='none'.
      // Replace the generic question with a grounded response that names
      // nodes of the inferred kind (or falls back to label similarity).
      const candidateLabels = result.pendingClarification.candidate_labels ?? [];
      if (candidateLabels.length === 0 && ctx.graph) {
        // Pull the latest user message from conversation history so chip
        // prompts can preserve full intent (verb, target, relationship)
        // with only the entity reference substituted.
        const lastUserMessage = (ctx.messages ?? [])
          .filter((m) => m.role === 'user' && typeof m.content === 'string')
          .map((m) => m.content as string)
          .pop() ?? null;
        return buildZeroMatchClarification(editDescription, ctx.graph, ctx.turn_id, lastUserMessage);
      }
      const text = extractClarificationText(result);
      return {
        blocks: [],
        assistantText: sanitiseNodeIdsInText(text, ctx.graph),
        guidance_items: [],
      };
    }

    // ── Pending proposal: v1 defers proposal flow → unsupported fallback ─
    if (result.pendingProposal) {
      log.info(
        { turn_id: ctx.turn_id },
        'v4.edit_graph_proposal_deferred',
      );
      return unsupportedFallback();
    }

    // ── Rejection (PLoT hard-reject, structural reject) ──────────────────
    if (result.wasRejected) {
      const userMessage = result.assistantText?.trim() || "I couldn't apply that edit to the model.";
      const sanitised = sanitiseNodeIdsInText(userMessage, ctx.graph);
      return {
        blocks: [],
        assistantText: sanitised,
        guidance_items: [],
        failure: {
          code: 'EDIT_GRAPH_REJECTED',
          message: result.assistantText ?? 'rejected',
          user_message: sanitised,
          recovery_hint: 'Try rephrasing the edit, or describe the change more concretely.',
        },
      };
    }

    // ── Lift operations / applied_graph_hash from the graph_patch block ──
    const blockData = liftGraphPatchBlockData(result.blocks);
    let operations: PatchOperation[] = blockData?.operations ?? [];
    const appliedGraphHash = blockData?.applied_graph_hash;

    // PLoT-certified path: when V2 ran PLoT and returned a non-null
    // applied_graph without rejection, the patch has already cleared
    // Zod + referential + structural + semantic validation. Re-running our
    // belt-and-braces checks here risks wrongly stripping a valid op
    // (operations represent the LLM proposal; PLoT's applied_graph may
    // reflect silent repairs not re-applied to the operations array), which
    // would leave `operations` inconsistent with `applied_graph`.
    //
    // The hardening layers act as a SAFETY NET for the PLoT-not-configured
    // case (dev/test) — we still run them when applied_graph is null.
    const plotCertified = result.appliedGraph != null;

    // ── Edge endpoint validation (safety net for non-certified path) ─────
    if (!plotCertified) {
      const { kept, stripped } = validateEdgeEndpoints(ctx.graph, operations);
      if (stripped.length > 0) {
        log.warn(
          { turn_id: ctx.turn_id, stripped_count: stripped.length },
          'v4.edit_graph_invalid_edge_rejected',
        );
        operations = kept;
        if (operations.length === 0) {
          return {
            blocks: [],
            assistantText: "I couldn't place an edge between those nodes. One of them doesn't exist in the current model.",
            guidance_items: [],
            failure: {
              code: 'EDIT_GRAPH_INVALID_EDGE',
              message: `Stripped ${stripped.length} add_edge operation(s) referencing unknown endpoints.`,
              user_message: "I couldn't place an edge between those nodes. One of them doesn't exist in the current model.",
              recovery_hint: 'Name the specific existing factors or options to connect.',
            },
          };
        }
      }
    }

    // ── Orphan check (safety net for non-certified path) ─────────────────
    const addedNodeIds = extractAddedNodeIds(operations);
    let appliedGraphPreview: GraphV3T | null = result.appliedGraph;
    if (!appliedGraphPreview && ctx.graph && operations.length > 0) {
      try {
        const { applyPatchOperations } = await import("../../patch-applier.js");
        appliedGraphPreview = applyPatchOperations(ctx.graph, operations);
      } catch (err) {
        log.warn(
          { err, turn_id: ctx.turn_id },
          'v4.edit_graph_preview_apply_failed',
        );
        appliedGraphPreview = null;
      }
    }

    if (!plotCertified && addedNodeIds.length > 0 && appliedGraphPreview) {
      const orphans = findOrphans(appliedGraphPreview, addedNodeIds);
      if (orphans.length > 0) {
        log.warn(
          { turn_id: ctx.turn_id, orphans },
          'v4.edit_graph_orphan_rejected',
        );
        return {
          blocks: [],
          assistantText:
            'The change would create a disconnected element. Please specify how it connects to the rest of the model.',
          guidance_items: [],
          failure: {
            code: 'EDIT_GRAPH_ORPHAN',
            message: `Orphaned new nodes: ${orphans.join(', ')}`,
            user_message:
              'The change would create a disconnected element. Please specify how it connects to the rest of the model.',
            recovery_hint: 'Describe the factor it influences or is influenced by.',
          },
        };
      }
    }

    // ── Intervention preservation: detect only (no auto-restore) ─────────
    if (appliedGraphPreview) {
      const postSnapshots = snapshotOptionInterventions(appliedGraphPreview, computeStructuralReadiness);
      const directlyTouchedOptionIds = new Set<string>();
      for (const op of operations) {
        if (typeof op.path === 'string' && op.path.startsWith('opt_')) {
          directlyTouchedOptionIds.add(op.path);
        }
        if (op.value && typeof op.value === 'object') {
          const maybeId = (op.value as { id?: unknown }).id;
          if (typeof maybeId === 'string' && maybeId.startsWith('opt_')) {
            directlyTouchedOptionIds.add(maybeId);
          }
        }
      }
      const lostForUntouched: Array<{ option_id: string; lost_factors: string[] }> = [];
      for (const [optionId, before] of preSnapshots.entries()) {
        if (directlyTouchedOptionIds.has(optionId)) continue;
        const after = postSnapshots.get(optionId) ?? {};
        const lostFactors: string[] = [];
        for (const factorId of Object.keys(before)) {
          if (!(factorId in after)) lostFactors.push(factorId);
        }
        if (lostFactors.length > 0) {
          lostForUntouched.push({ option_id: optionId, lost_factors: lostFactors });
        }
      }
      if (lostForUntouched.length > 0) {
        log.warn(
          {
            turn_id: ctx.turn_id,
            options_with_lost_interventions: lostForUntouched,
          },
          'v4.edit_graph_intervention_loss_detected',
        );
      }
    }

    // ── Matching-artefact honesty guard ──────────────────────────────────
    let assistantText = result.assistantText ?? '';
    const structuralLanguage = /\b(connecting|adding|removing|rewiring|connected|added|removed|rewired)\b/i;
    const hasStructuralLanguage = structuralLanguage.test(assistantText);
    const hasStructuralOps = operations.some((op) => op.op !== 'update_edge');
    const guardFired = detectCalibrationOnlyArtefact(assistantText, operations);
    log.info(
      {
        event: 'v4.edit_graph_honesty_guard',
        turn_id: ctx.turn_id,
        has_structural_language: hasStructuralLanguage,
        has_structural_ops: hasStructuralOps,
        ops_count: operations.length,
        guard_fired: guardFired,
        text_preview: assistantText?.slice(0, 100),
      },
      'Honesty guard evaluated',
    );
    if (guardFired) {
      log.info({ turn_id: ctx.turn_id }, 'v4.edit_graph_honesty_guard_triggered');
      assistantText =
        "I adjusted the strength of an existing connection but couldn't make the structural change you asked for. Could you describe exactly what you'd like to connect or modify?";
    }

    // ── ID sanitisation in the final user-facing text ────────────────────
    assistantText = sanitiseNodeIdsInText(assistantText, ctx.graph);

    // ── Unsupported-capability fallback ──────────────────────────────────
    if (
      result.blocks.length === 0
      && !assistantText.trim()
      && operations.length === 0
    ) {
      return unsupportedFallback();
    }

    // ── Post-edit guidance ───────────────────────────────────────────────
    const guidanceItems =
      result.appliedGraph && !result.wasRejected
        ? generatePostDraftGuidance(result.appliedGraph, [], context.framing ?? null)
        : [];

    // Strip the V2 graph_patch block: pipeline-v4's envelope assembler
    // re-emits a graph_patch from the returned `operations` array (which is
    // the HARDENED set — invalid-edge ops already stripped). Keeping the
    // inbound V2 block would cause double-emission of graph_patch, and the
    // response-normaliser dedup keeps the first block (V2's pre-hardening
    // operations), which would leak un-hardened patches to the UI.
    const nonPatchBlocks = result.blocks.filter((b) => b.block_type !== 'graph_patch');

    // WS2: Build HandlerFact so the response composer produces
    // decision-language text with correct proposal/applied tense.
    const editFact = operations.length > 0
      ? buildEditGraphFact(operations, ctx)
      : undefined;

    return {
      blocks: nonPatchBlocks,
      assistantText: assistantText || null,
      guidance_items: guidanceItems,
      operations: operations.length > 0 ? operations : undefined,
      applied_graph_hash: appliedGraphHash,
      applied_graph: result.appliedGraph ?? undefined,
      analysis_ready: blockData?.analysis_ready,
      ...(editFact ? { fact: editFact } : {}),
    };
  },

  chipLabel(rec) {
    const desc = (rec.parameters?.edit_description as string | undefined)?.slice(0, 40);
    return desc ? `Edit model: ${desc}` : 'Edit model';
  },
  chipPrompt(rec) {
    const desc = (rec.parameters?.edit_description as string | undefined) ?? '';
    return desc || 'Edit the model';
  },
};

function friendlyEditGraphError(err: OrchestratorError): string {
  switch (err.code) {
    case 'TOOL_EXECUTION_FAILED':
      return "I couldn't apply that edit. Could you try rephrasing it?";
    case 'MISSING_GRAPH_STATE':
      return 'There is no decision model to edit yet. Build one first.';
    case 'LLM_TIMEOUT':
      return 'The edit took too long. Your model is unchanged; try again.';
    case 'VALIDATION_REJECTED':
      return "I couldn't validate that edit. Describe the change more concretely.";
    default:
      return "I couldn't apply that edit. Could you try rephrasing it?";
  }
}

function extractClarificationText(result: EditGraphResult): string {
  const pc = result.pendingClarification as unknown as { question?: unknown; prompt?: unknown } | undefined;
  if (pc && typeof pc.question === 'string') return pc.question;
  if (pc && typeof pc.prompt === 'string') return pc.prompt;
  return result.assistantText?.trim() || 'Could you clarify which element you mean?';
}

function unsupportedFallback(): ActionResult {
  return {
    blocks: [],
    assistantText:
      "I wasn't able to make that change to the model. Could you describe specifically what you'd like to add, remove, or connect?",
    guidance_items: [],
  };
}

/**
 * Build a HandlerFact from edit_graph operations so the response composer
 * can produce decision-language text with correct proposal tense.
 */
function buildEditGraphFact(
  operations: PatchOperation[],
  ctx: DeterministicTurnContext,
): HandlerFact {
  // Collect affected entities from operations
  const entities: Array<{ id: string; label: string; kind: string }> = [];
  const seen = new Set<string>();
  for (const op of operations) {
    const id = typeof op.path === 'string' ? op.path : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const entry = ctx.entities.nodes.get(id);
    if (entry) {
      entities.push({ id: entry.id, label: entry.label, kind: entry.kind });
    }
  }

  // Summarise what changed
  const adds = operations.filter((o) => o.op === 'add_node' || o.op === 'add_edge').length;
  const updates = operations.filter((o) => o.op === 'update_node' || o.op === 'update_edge').length;
  const removes = operations.filter((o) => o.op === 'remove_node' || o.op === 'remove_edge').length;
  const parts: string[] = [];
  if (adds > 0) parts.push(`${adds} addition${adds > 1 ? 's' : ''}`);
  if (updates > 0) parts.push(`${updates} update${updates > 1 ? 's' : ''}`);
  if (removes > 0) parts.push(`${removes} removal${removes > 1 ? 's' : ''}`);
  const whatChanged = parts.length > 0 ? parts.join(', ') : 'structural changes';

  return {
    action: 'graph_edited',
    entities_affected: entities.length > 0 ? entities : [{ id: '', label: 'the model', kind: 'graph' }],
    what_changed: whatChanged,
    stale_analysis: ctx.analysis_summary != null,
    auto_apply: false,
  };
}
