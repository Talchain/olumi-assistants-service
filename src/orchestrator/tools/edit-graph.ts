/**
 * edit_graph Tool Handler
 *
 * Flow: graph + edit description → LLM call → sanitise → Zod validate →
 *       referential integrity → PLoT validate-patch → repair loop → GraphPatchBlock
 *
 * Orchestrator calls as function (same process).
 * Output: GraphPatchBlock (patch_type: 'edit', status: 'proposed' | 'rejected').
 *
 * Canonical-only: Reject ops with belief, belief_exists, confidence.
 * Map legacy → canonical, log telemetry.
 *
 * CEE is the structural gatekeeper (Zod schema + referential integrity).
 * PLoT is the semantic judge (validate-patch endpoint).
 * CEE never normalises values — no STRP, no strength clamping.
 *
 * PLoT failure policy:
 * - When PLoT is configured (plotClient !== null): PLoT failure is a hard reject.
 *   CEE must not propose semantically unvalidated patches.
 * - When PLoT is not configured (plotClient === null): skip semantic gate entirely.
 *   This is the dev/test path only.
 *
 * "No silent semantics": PLoT repairs are surfaced as repairs_applied on the block,
 * never silently rewritten into the operations array.
 */

import { createHash } from "node:crypto";
import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";
import { ORCHESTRATOR_TIMEOUT_MS } from "../../config/timeouts.js";
import { config } from "../../config/index.js";
import { getMaxTokensFromConfig } from "../../adapters/llm/router.js";
// Tier A #1 (edit-reliability, 2026-07-09): re-enabled with the v2
// stringified-payload schema (Lane 26 v8-aux-field trick applied to
// value/old_value) — see GRAMMAR BUDGET (v2) in anthropic-edit-graph-schema.ts.
import { ANTHROPIC_EDIT_GRAPH_SCHEMA } from "./anthropic-edit-graph-schema.js";
import { getSystemPrompt, getSystemPromptMeta } from "../../adapters/llm/prompt-loader.js";
import type { LLMAdapter, CallOpts } from "../../adapters/llm/types.js";
import { GraphV3, FactorCategoryV3 } from "../../schemas/cee-v3.js";
import type {
  TypedConversationBlock,
  ConversationContext,
  GraphPatchBlockData,
  GraphV3T,
  PendingClarificationState,
  PendingProposalState,
  PatchOperation,
  OrchestratorError,
  RepairEntry,
  ProposedChangesPayload,
  ProposedChangeActionType,
  SuggestedAction,
  AppliedChanges,
  AppliedChangeItem,
} from "../types.js";
import type { RouteMetadata } from "../pipeline/types.js";
import type { PLoTClient, ValidatePatchResult, PLoTClientRunOpts } from "../plot-client.js";
import { createGraphPatchBlock } from "../blocks/factory.js";
import { serialiseEditContextForLLMWithMeta } from "../context/serialise.js";
import { emitContextBudget } from "../../orchestrator-v5/context/context-budget-telemetry.js";
import {
  validatePatchOperations,
  formatPatchValidationErrors,
  type PatchValidationResult,
} from "../patch-validation.js";
import { applyPatchOperations, PatchApplyError } from "../patch-applier.js";
import { validateGraphStructure, VIOLATION_MESSAGES, type StructuralViolationCode } from "../graph-structure-validator.js";
import { buildPatchRejectionEnvelope, type PatchRejectionContext } from "../patch-rejection-helper.js";
import {
  classifyAddRiskToOptionRejection,
  ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER,
} from "../add-risk-rejection-guidance.js";
import { computeStructuralReadiness } from "./analysis-ready-helper.js";
import { encodeOptionInterventionsForEdit, optionIdsTouchedByOperations, optionIdsAddedWithInterventionIntent } from "./encode-option-interventions.js";
import { classifyUserIntent } from "../pipeline/phase1-enrichment/intent-classifier.js";
import { buildPatchSummary } from "../patch-summary.js";
import { sanitiseUserFacingText } from "../../orchestrator-v5/compose/output-safety.js";
import {
  findSuccessClaimHit,
  findForbiddenPhraseHit,
  findEditInternalsHit,
} from "../../orchestrator-v5/compose/forbidden-user-facing-phrases.js";
import { TOKEN_OVERLAP_STOPWORDS, hasTokenOverlap } from "./token-overlap.js";
import { STRUCTURAL_EDGE_DEFAULTS } from "../context/constants.js";
import { enforceProposalLanguage } from "../deterministic/proposal-language-guard.js";
import {
  buildEditRejectionResponse,
  type EditRejectionReason,
} from "../../orchestrator-v5/handlers/edit-rejection-text.js";
import { enforceRepairVocabularyDenylist } from "../shared/repair-vocabulary-denylist.js";
import { buildNoOpRecoveryChips } from "./edit-graph-noop-chips.js";
import { buildEditClarifyFallbackParts } from "../../orchestrator-v5/compose/edit-clarify-response.js";

// ============================================================================
// Types
// ============================================================================

export interface EditGraphResult {
  blocks: TypedConversationBlock[];
  assistantText: string | null;
  latencyMs: number;
  /** The applied graph from PLoT (post-edit), or null if rejected / PLoT not configured. */
  appliedGraph: GraphV3T | null;
  /** True if the edit was rejected (structural or semantic). */
  wasRejected: boolean;
  /** Suggested actions (e.g. "Re-run analysis" when rerun_recommended). */
  suggestedActions?: SuggestedAction[];
  pendingClarification?: PendingClarificationState;
  pendingProposal?: PendingProposalState;
  /** Lightweight proposal payload for propose_and_confirm mode. */
  proposedChanges?: ProposedChangesPayload;
  /** Edit-specific diagnostics for orchestrator turn trace (edit_graph turns only). */
  diagnostics?: EditGraphTraceDiagnostics;
  routeMetadata?: RouteMetadata;
  /** Structured receipt for successful edits. Absent on rejected edits. */
  appliedChanges?: AppliedChanges;
  /**
   * Canonical PatchOperation[] applied on the success path. Exposed for
   * downstream consumers (V5 edit-graph fact builder — DL-7 PR B) that
   * need to derive entity-kind classification per-operation against the
   * post-edit graph. Absent on rejected edits. Mirrors `operations` as
   * passed to PLoT validation (post-normalisation).
   */
  operations?: PatchOperation[];
  /**
   * Per-operation metadata captured by the v2 prompt — `{ impact,
   * rationale }` per op, parallel-indexed to `operations`. Exposed so
   * the V5 fact builder can derive an aggregate `impact` for the
   * accepted-edit fact (highest of per-op impacts, with a structural
   * fallback). Absent on rejected edits.
   */
  operation_meta?: EditGraphOperationMeta[];
  /**
   * R10 — true when the no-op branch preserved a scrubbed LLM clarifying
   * question instead of substituting the deterministic fallback copy. Read by
   * the V5 dispatcher's no-op recovery so its vague-edit branch stays inert
   * and cannot clobber the preserved question.
   */
  noOpClarificationPreserved?: boolean;
}

export interface EditGraphOpts {
  /** PLoT client for semantic validation. If null, PLoT gate is skipped (dev/test only). */
  plotClient?: PLoTClient | null;
  /** Max repair retries on structural/PLoT failure. Defaults to config.cee.maxRepairRetries. */
  maxRetries?: number;
  /** Turn budget opts forwarded to PLoT client for budget-aware retry. */
  plotOpts?: PLoTClientRunOpts;
  /** Internal invocation context carried through orchestrator state. */
  invocationInput?: Record<string, unknown>;
}

// ============================================================================
// Edit Graph LLM Result Types (v2 prompt output shape)
// ============================================================================

/** Per-operation metadata from the v2 prompt (not part of canonical PatchOperation). */
export interface EditGraphOperationMeta {
  impact: 'low' | 'moderate' | 'high';
  rationale: string;
}

/** Advisory metadata for edges removed as a consequence of node removal. */
export interface RemovedEdgeInfo {
  from: string;
  to: string;
  reason: string;
}

/** Coaching output from the v2 prompt. */
export interface EditGraphCoaching {
  summary: string;
  rerun_recommended: boolean;
}

/** Parsed result from the v2 edit_graph LLM response. */
export interface EditGraphLLMResult {
  operations: Array<PatchOperation & { impact?: string; rationale?: string }>;
  removed_edges: RemovedEdgeInfo[];
  warnings: string[];
  coaching: EditGraphCoaching | null;
}

export type EditIntentCategory = 'parameter_update' | 'option_configuration' | 'structural';

export type EditTargetMatchType =
  | 'exact_label'
  | 'alias'
  | 'active_entity'
  | 'graph_local'
  | 'ambiguous'
  | 'none';

export type EditResolutionConfidence = 'high' | 'medium' | 'low';

export type EditResolutionMode =
  | 'auto_apply'
  | 'propose_and_confirm'
  | 'clarify'
  | 'no_edit_answer';

export interface ResolvedEditTarget {
  id: string;
  label: string;
  type: string;
}

export interface EditTargetResolutionResult {
  match_type: EditTargetMatchType;
  resolved_target: ResolvedEditTarget | null;
  confidence: EditResolutionConfidence;
  alternatives: Array<{ id: string; label: string }>;
  candidate_labels: string[];
}

export interface EditGraphTraceDiagnostics {
  classified_intent: EditIntentCategory;
  instruction_mode_applied: 'narrow_parameter_update' | 'narrow_option_configuration' | 'structural_default';
  edit_instruction_preview: string | null;
  graph_context_node_count: number;
  graph_context_edge_count: number;
  operations_proposed_count: number;
  operations_proposed_types: string[];
  validation_outcome: string;
  validation_violation_codes: string[];
  recovery_path_chosen: string;
  conversational_state_summary: {
    active_entities_count: number;
    stated_constraints_count: number;
    current_topic: string;
  } | null;
  target_resolution: {
    method: EditTargetMatchType | null;
    confidence: EditResolutionConfidence | null;
    resolved_label: string | null;
    alternatives_count: number;
  } | null;
  resolution_mode: EditResolutionMode | null;
  proposal_returned: boolean | null;
  branch_taken: 'clarify' | 'propose' | 'apply' | 'no_op' | 'rejection' | 'recovery_question';
  branch_reason: string | null;
  failure_branch: string | null;
  failure_code: string | null;
  failure_message: string | null;
  // R7 — per-turn LLM call diagnostics. Optional so the existing partial
  // constructors (dispatch preflight, test fixtures) stay valid; the main
  // `diagnostics()` closure always populates them. `model`/`stop_reason` are
  // null and tokens are 0 on deterministic (no-LLM) returns. Tokens are summed
  // across repair attempts (= total turn cost); `stop_reason` is the final
  // decisive attempt's value. `plot_outcome` describes the PLoT verdict only.
  model?: string | null;
  input_tokens_est?: number;
  output_tokens?: number;
  stop_reason?: string | null;
  repair_attempts?: number;
  plot_outcome?: 'pass' | 'rejected' | 'unavailable' | 'skipped';
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of operations per patch. Configurable via MAX_PATCH_OPERATIONS env var, default 15. */
function getMaxPatchOperations(): number {
  return config.cee.maxPatchOperations;
}

// Tier A #1 (edit-reliability, 2026-07-09): appended to the edit_graph user
// message ONLY when structured outputs actually engage for this call (the
// adapter appends it only when its own flag+allowlist+thinking gate passes —
// see ChatArgs.structuredOutputsUserReminder). The v2 schema forces
// operations[].value / .old_value to be strings — this reminder tells the
// model to put the JSON-ENCODED payload inside those strings rather than
// prose or a raw (ungrammatical, schema-rejected) object. Mirrors
// STRUCTURED_OUTPUTS_AUX_STRING_REMINDER in adapters/llm/anthropic.ts
// (Lane 26, draft_graph). Omitted on the prompt-only fallback path, where
// the system prompt's existing object-shaped examples apply unchanged —
// parseStringifiedOperationPayload() accepts both shapes at ingress.
const EDIT_GRAPH_STRUCTURED_OUTPUTS_VALUE_REMINDER = `

OUTPUT FORMAT OVERRIDE (structured mode):
Emit "value" and "old_value" as JSON-encoded STRINGS, not objects — the
schema only allows strings there. Each string must contain exactly the JSON
the operation needs, with correctly escaped quotes. Examples:
"value": "{\\"id\\":\\"fac_x\\",\\"kind\\":\\"factor\\",\\"label\\":\\"X\\"}"
for add_node; "value": "0.8" (a bare JSON scalar string) for a single-field
update where the path already names the field. Omit "value"/"old_value"
entirely for remove_node/remove_edge — no payload is needed.`;

// Promise-aware copy for the propose-and-confirm path. The V5 dispatcher
// does not persist `pendingProposal` across turns and does not render
// accept/cancel chips (see edit-graph-dispatch.ts), so this branch
// cannot offer a one-click apply step. The copy must therefore promise
// only what the system can actually execute — which is to apply the
// change directly when the user restates the specific factor and value.
//
// Fallback used when we don't have a resolved target to anchor on
// (low-confidence resolution). Inventing concrete detail here would be
// dishonest — the user should restate their request more specifically.
const PROPOSE_AND_CONFIRM_FALLBACK_TEXT = 'I’ve drafted a change that fits your description, but I need the specifics to apply it directly. Tell me the specific factor and value you’d like, and I’ll make the change directly.';

// No-op path fallback: Lane 22 replaced the chip-less canned copy that
// lived here ("I couldn't see a concrete change to make…") with the
// shared clarify composer parts (buildEditClarifyFallbackParts), so the
// declined-preservation branch always ships deterministic copy WITH 1–3
// factor/option-label chips. The copy remains forward-looking by design —
// a denial-shaped default ("No changes were needed") would be rewritten
// by the V5 egress forbidden-phrase guard.

/**
 * Build the propose-and-confirm assistant text. Surfaces the concrete
 * resolved target and an example of the exact phrasing that would
 * commit the change deterministically. Never promises an "Apply" chip
 * (the V5 dispatcher does not wire pendingProposal round-trip — see
 * edit-graph-dispatch.ts:160–179).
 *
 * Stop-conditions (fall back to the generic stub):
 *  - No resolved target (low-confidence resolution).
 *  - Empty proposed-changes payload.
 *  - First change has no usable element_label.
 */
function buildProposeAndConfirmText(
  proposedChanges: ProposedChangesPayload,
  resolvedTarget: ResolvedEditTarget | null,
): string {
  if (!resolvedTarget) return PROPOSE_AND_CONFIRM_FALLBACK_TEXT;
  const changes = proposedChanges.changes ?? [];
  if (changes.length === 0) return PROPOSE_AND_CONFIRM_FALLBACK_TEXT;
  const first = changes[0];
  if (!first || !first.element_label) return PROPOSE_AND_CONFIRM_FALLBACK_TEXT;

  const label = resolvedTarget.label;
  if (changes.length === 1) {
    // Abstract phrasing only — no fabricated example values. The
    // previous version interpolated hardcoded scales like "120k" and
    // "20%" which were nonsensical for non-cost factors (e.g.
    // probabilities, durations, ratings). The structured
    // `proposedChanges` payload doesn't carry a concrete target value,
    // so the safest copy describes the *action type* against the
    // resolved label and asks the user to supply the value.
    const action =
      first.action_type === 'value_update'
        ? `Tell me the specific value or direction (e.g. "set to N" or "lower by N")`
        : first.action_type === 'option_config'
        ? `Tell me which option parameter to change and its target value`
        : first.action_type === 'structural_add'
        ? `Confirm the new element's label and how it connects`
        : `Confirm the element to remove`;
    return `I have a change in mind for **${label}**, but I need the specifics to apply it directly. ${action} and I'll make it.`;
  }

  const labels: string[] = [];
  for (const change of changes.slice(0, 3)) {
    if (change.element_label && !labels.includes(change.element_label)) {
      labels.push(change.element_label);
    }
  }
  if (labels.length === 0) return PROPOSE_AND_CONFIRM_FALLBACK_TEXT;

  const list =
    labels.length === 1
      ? `**${labels[0]}**`
      : labels.length === 2
      ? `**${labels[0]}** and **${labels[1]}**`
      : `**${labels.slice(0, -1).join('**, **')}** and **${labels[labels.length - 1]}**`;
  const more = changes.length > 3 ? ` (and ${changes.length - 3} more)` : '';
  return `I have changes in mind for ${list}${more}, but I need the specifics to apply them directly. Reply with the exact changes you'd like and I'll make them one at a time.`;
}

export function classifyEditIntent(editDescription: string): EditIntentCategory {
  const message = editDescription.toLowerCase();
  const hasStructuralVerb = /\b(add node|remove node|delete node|add edge|remove edge|delete edge|connect|disconnect|link|unlink|rewire|restructure|replace|insert|create|new factor|new outcome|new risk|new option|add (?:a |an )?(?:new )?(?:[a-z0-9_-]+\s+){0,2}(?:factor|outcome|risk|option|node|edge))\b/.test(message);
  const hasOptionConfigVerb = /\b(configure|set|adjust|update|change|tune|edit)\b/.test(message)
    && /\b(option|intervention)\b/.test(message);
  const hasValueUpdateVerb = /\b(set|lower|raise|increase|decrease|reduce|boost|make|adjust|update|tune|change|add)\b/.test(message);
  const hasValueTarget = /\b(high|low|higher|lower|more|less|sensitivity|cost|price|pay|willingness|churn|agency|percent|%|value|parameter|weight|strength|mean|std|probability|exists|month|months|week|weeks|day|days|year|years|delay|time)\b/.test(message);

  if (hasStructuralVerb) {
    return 'structural';
  }
  if (hasOptionConfigVerb) {
    return 'option_configuration';
  }
  if (hasValueUpdateVerb && hasValueTarget) {
    return 'parameter_update';
  }
  return 'structural';
}

// ============================================================================
// Constraint Detection
// ============================================================================

interface ConstraintDetectionResult {
  goalId: string;
  factorLabel: string;
  existingConstraints: unknown[];
  newConstraint: {
    node_id: string;
    type: 'threshold';
    threshold?: number;
    direction?: 'below' | 'above';
    label?: string;
  };
}

/**
 * Detect constraint-intent in user messages and extract structured data.
 * Returns null if the message is not a constraint request.
 *
 * Requires BOTH:
 * 1. Constraint language with a direction word (under/below/above/over)
 * 2. A threshold value (N% or N) in the message
 *
 * This combination avoids false positives on messages like "The constraint
 * of our budget is tight" (no threshold) or "Cost is 50%" (no direction).
 */
function detectConstraintIntent(
  editDescription: string,
  graph: GraphV3T,
): ConstraintDetectionResult | null {
  const msg = editDescription.toLowerCase();

  // Must contain a direction word paired with constraint language.
  // Bare "constraint" or "ceiling" without a direction + threshold is too ambiguous.
  const constraintWithDirection =
    /\b(?:keep|must|should|need to|needs to|has to|have to)\b.*\b(?:under|below|above|over|less than|more than|at least|at most)\b/.test(msg) ||
    /\b(?:under|below|above|over|less than|more than|at least|at most)\b.*\b(?:hard requirement|requirement|constraint|limit)\b/.test(msg);

  if (!constraintWithDirection) return null;

  // Must contain a threshold value (N% or standalone number near a direction word)
  const thresholdMatch = msg.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!thresholdMatch) return null;

  const threshold = parseFloat(thresholdMatch[1]) / 100;
  const thresholdPosition = thresholdMatch.index!;

  // Find goal node
  const nodes = graph.nodes ?? [];
  const goalNode = nodes.find((n) => (n as Record<string, unknown>).kind === 'goal');
  if (!goalNode) return null;
  const goalId = (goalNode as Record<string, unknown>).id as string;

  // Determine direction
  const belowPattern = /\b(under|below|less than|at most)\b/;
  const abovePattern = /\b(above|over|more than|at least)\b/;
  const direction = belowPattern.test(msg) ? 'below' as const : abovePattern.test(msg) ? 'above' as const : 'below' as const;

  // Match a factor/risk/outcome from the graph.
  // Score candidates by number of matching label words to pick the best match.
  const constraintTargetKinds = new Set(['factor', 'risk', 'outcome']);
  const candidates: Array<{ id: string; label: string; score: number }> = [];

  for (const node of nodes) {
    const nodeRec = node as Record<string, unknown>;
    if (!constraintTargetKinds.has(nodeRec.kind as string)) continue;

    const label = (nodeRec.label as string ?? '').toLowerCase();
    const labelWords = label.split(/[\s_-]+/).filter((w) => w.length >= 3);
    // Count how many label words appear in the message (excluding the threshold itself)
    const msgWithoutThreshold = msg.slice(0, thresholdPosition) + msg.slice(thresholdPosition + thresholdMatch[0].length);
    const matchCount = labelWords.filter((word) => msgWithoutThreshold.includes(word)).length;

    if (matchCount > 0) {
      candidates.push({ id: nodeRec.id as string, label: nodeRec.label as string, score: matchCount });
    }
  }

  if (candidates.length === 0) return null;

  // Pick best match (most label words matched)
  candidates.sort((a, b) => b.score - a.score);
  const matchedFactor = candidates[0];

  // Build constraint label
  const constraintLabel = `${matchedFactor.label} ${direction === 'below' ? '<' : '>'} ${(threshold * 100).toFixed(0)}%`;

  // Read existing goal_constraints
  const rawConstraints = (goalNode as Record<string, unknown>).goal_constraints;
  const existingConstraints = Array.isArray(rawConstraints) ? rawConstraints : [];

  return {
    goalId,
    factorLabel: matchedFactor.label,
    existingConstraints,
    newConstraint: {
      node_id: matchedFactor.id,
      type: 'threshold',
      threshold,
      direction,
      label: constraintLabel,
    },
  };
}

function buildIntentInstruction(intentCategory: EditIntentCategory): string | null {
  if (intentCategory === 'parameter_update') {
    return [
      'This is a narrow parameter/value update.',
      'Prefer update_node or update_edge operations only.',
      'Do not add_node, remove_node, add_edge, or remove_edge unless the user explicitly asked for a topology change.',
      'Update existing fields only.',
    ].join(' ');
  }
  if (intentCategory === 'option_configuration') {
    return [
      'This is an option/intervention configuration update.',
      'Prefer the narrowest valid update to an existing option or intervention field.',
      'Do not add_node, remove_node, add_edge, or remove_edge unless the user explicitly asked for a topology change.',
    ].join(' ');
  }
  return null;
}

function resolveInstructionMode(intentCategory: EditIntentCategory): EditGraphTraceDiagnostics['instruction_mode_applied'] {
  if (intentCategory === 'parameter_update') return 'narrow_parameter_update';
  if (intentCategory === 'option_configuration') return 'narrow_option_configuration';
  return 'structural_default';
}

// Seed aliases only. If a graph uses different labels, resolution safely falls
// back to later match stages and ultimately clarify when confidence stays low.
const TARGET_ALIAS_MAP: Record<string, string[]> = {
  onboarding: ['Onboarding Time'],
  'onboarding time': ['Onboarding Time'],
  churn: ['Monthly Churn Rate'],
  'monthly churn': ['Monthly Churn Rate'],
  'ramp up time': ['Onboarding Time', 'Hiring Delay'],
  'ramp-up time': ['Onboarding Time', 'Hiring Delay'],
};

function normaliseMatchingText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
}

function getResolvedTargets(context: ConversationContext): ResolvedEditTarget[] {
  return (context.graph?.nodes ?? [])
    .filter((node) => typeof node.label === 'string' && node.label.trim().length > 0)
    .map((node) => ({
      id: node.id,
      label: node.label.trim(),
      type: node.kind,
    }));
}

function dedupeTargets(targets: ResolvedEditTarget[]): ResolvedEditTarget[] {
  const seen = new Set<string>();
  const deduped: ResolvedEditTarget[] = [];
  for (const target of targets) {
    const key = `${target.id}:${target.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(target);
  }
  return deduped;
}

function buildResolutionResult(
  matchType: EditTargetMatchType,
  confidence: EditResolutionConfidence,
  matches: ResolvedEditTarget[],
): EditTargetResolutionResult {
  const uniqueMatches = dedupeTargets(matches);
  return {
    match_type: uniqueMatches.length > 1 ? 'ambiguous' : matchType,
    resolved_target: uniqueMatches.length === 1 ? uniqueMatches[0] : null,
    confidence: uniqueMatches.length > 1 ? 'medium' : confidence,
    alternatives: uniqueMatches.length > 1
      ? uniqueMatches.slice(0, 3).map((match) => ({ id: match.id, label: match.label }))
      : [],
    candidate_labels: uniqueMatches.map((match) => match.label),
  };
}

function containsCoreferenceReference(message: string): boolean {
  return /\b(it|this|that|them|those)\b/i.test(message);
}

/**
 * Compound-edit separator pattern. Treats `and`, `also`, `then`, and `,` as
 * indicators that the user requested independent edits across multiple
 * targets. Used for the *detection* (true/false) sites in this file.
 *
 * Note: the *splitting* regex inside `buildProposedChanges` is intentionally
 * narrower — it splits on `and`/`,` only, not `also`/`then`. The narrower
 * splitter preserves existing Mode A clause output (e.g. the pre-existing
 * "Update Price and also lower Price" test, which produces clauses
 * "Update Price" and "Also lower Price" rather than splitting on `also`).
 * The defence-in-depth label strip in `buildProposedChanges` only fires
 * when the resolved label itself trips this broader detection regex.
 */
const COMPOUND_EDIT_SEPARATOR_RE = /\b(and|also|then)\b|,/;

/** Escape a literal string for safe use inside a `RegExp` source. */
function escapeForRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Return `description` with case-insensitive literal occurrences of
 * `resolvedLabel` removed. No fuzzy matching, no token expansion, no
 * substring approximation — only the exact label characters are stripped.
 *
 * Callers MUST gate this on a high-confidence single-target resolution.
 * Using a low-confidence or null label to suppress compound detection would
 * silently broaden the heuristic in ways the resolver did not justify.
 */
function descriptionResidualAfterStrippingLabel(description: string, resolvedLabel: string): string {
  if (!resolvedLabel) return description;
  return description.replace(new RegExp(escapeForRegex(resolvedLabel), 'gi'), ' ');
}

/**
 * Detect compound-edit phrasing. When `resolvedLabel` is supplied (caller
 * has a high-confidence single-target resolution), the label is stripped
 * from `editDescription` before the test runs — so connector tokens
 * (`and`, `also`, `then`, comma) that are part of the resolved target's
 * own label (e.g. a factor named `Headcount and Scaling Spend`) do not
 * register as compound separators. Connector tokens OUTSIDE the resolved
 * label still trip the check.
 */
function isCompoundEditRequest(editDescription: string, resolvedLabel?: string): boolean {
  const target = resolvedLabel && resolvedLabel.length > 0
    ? descriptionResidualAfterStrippingLabel(editDescription, resolvedLabel)
    : editDescription;
  return COMPOUND_EDIT_SEPARATOR_RE.test(target.toLowerCase());
}

function isHighImpactEditRequest(editDescription: string, intentCategory: EditIntentCategory): boolean {
  if (intentCategory === 'structural') return true;
  return /\b(remove|delete|rebuild|replace|entirely|all|every|double|halve|major)\b/i.test(editDescription);
}

function isLowImpactEditRequest(
  editDescription: string,
  intentCategory: EditIntentCategory,
  resolvedLabel?: string,
): boolean {
  if (intentCategory === 'structural') return false;
  return /\b(set|update|change|make|adjust|lower|raise|increase|decrease)\b/i.test(editDescription)
    && !isCompoundEditRequest(editDescription, resolvedLabel)
    && !isHighImpactEditRequest(editDescription, intentCategory);
}

function selectGraphLocalTarget(
  context: ConversationContext,
  intentCategory: EditIntentCategory,
): ResolvedEditTarget[] {
  const targets = getResolvedTargets(context);
  if (intentCategory === 'option_configuration') {
    const options = targets.filter((target) => target.type === 'option');
    return options.length === 1 ? options : [];
  }
  const factors = targets.filter((target) => target.type === 'factor');
  return factors.length === 1 ? factors : [];
}

function resolveAliasMatches(editDescription: string, context: ConversationContext): ResolvedEditTarget[] {
  const normalisedMessage = normaliseMatchingText(editDescription);
  const targets = getResolvedTargets(context);
  const matches: ResolvedEditTarget[] = [];

  for (const [alias, labels] of Object.entries(TARGET_ALIAS_MAP)) {
    if (!normalisedMessage.includes(normaliseMatchingText(alias))) continue;
    for (const label of labels) {
      const target = targets.find((candidate) => normaliseMatchingText(candidate.label) === normaliseMatchingText(label));
      if (target) matches.push(target);
    }
  }

  return matches;
}

function resolveActiveEntityMatches(context: ConversationContext): ResolvedEditTarget[] {
  const activeEntities = context.conversational_state?.active_entities ?? [];
  const targets = getResolvedTargets(context);
  return activeEntities
    .map((entity) => targets.find((candidate) => normaliseMatchingText(candidate.label) === normaliseMatchingText(entity)) ?? null)
    .filter((target): target is ResolvedEditTarget => target !== null);
}

/**
 * Token overlap resolution: find graph nodes whose label tokens overlap significantly
 * with the edit description tokens (after stopword removal).
 * Requires ≥1 overlapping token AND ≥50% of label tokens matched.
 *
 * Delegates to shared hasTokenOverlap() from token-overlap.ts.
 */
function resolveTokenOverlapMatches(
  normalisedMessage: string,
  targets: ResolvedEditTarget[],
): ResolvedEditTarget[] {
  const messageTokens = normalisedMessage
    .split(/\s+/)
    .filter((t) => t.length > 2 && !TOKEN_OVERLAP_STOPWORDS.has(t));

  if (messageTokens.length === 0) return [];

  return targets.filter((target) => {
    const labelTokens = normaliseMatchingText(target.label)
      .split(/\s+/)
      .filter((t) => t.length > 2 && !TOKEN_OVERLAP_STOPWORDS.has(t));
    return hasTokenOverlap(messageTokens, labelTokens);
  });
}

export function resolveEditTarget(
  editDescription: string,
  context: ConversationContext,
  intentCategory: EditIntentCategory = classifyEditIntent(editDescription),
): EditTargetResolutionResult {
  const normalisedMessage = normaliseMatchingText(editDescription);
  const targets = getResolvedTargets(context);
  const exactMatches = targets.filter((target) => normalisedMessage.includes(normaliseMatchingText(target.label)));
  if (exactMatches.length > 0) {
    return buildResolutionResult('exact_label', 'high', exactMatches);
  }

  const aliasMatches = resolveAliasMatches(editDescription, context);
  if (aliasMatches.length > 0) {
    return buildResolutionResult('alias', aliasMatches.length === 1 ? 'high' : 'medium', aliasMatches);
  }

  // Token overlap match: find nodes where significant words from the edit
  // description overlap with node label words. Catches fuzzy matches like
  // "competitor pressure" → "Competitive Pressure" via substring containment.
  const tokenMatches = resolveTokenOverlapMatches(normalisedMessage, targets);
  if (tokenMatches.length > 0) {
    return buildResolutionResult(
      tokenMatches.length === 1 ? 'exact_label' : 'ambiguous',
      tokenMatches.length === 1 ? 'high' : 'medium',
      tokenMatches,
    );
  }

  if (containsCoreferenceReference(editDescription)) {
    const activeEntityMatches = resolveActiveEntityMatches(context);
    if (activeEntityMatches.length > 0) {
      return buildResolutionResult('active_entity', activeEntityMatches.length === 1 ? 'high' : 'medium', activeEntityMatches);
    }
  }

  const graphLocalMatches = selectGraphLocalTarget(context, intentCategory);
  if (graphLocalMatches.length > 0) {
    return buildResolutionResult('graph_local', 'high', graphLocalMatches);
  }

  return {
    match_type: 'none',
    resolved_target: null,
    confidence: 'low',
    alternatives: [],
    candidate_labels: [],
  };
}

export function determineEditResolutionMode(
  editDescription: string,
  context: ConversationContext,
  intentCategory: EditIntentCategory = classifyEditIntent(editDescription),
  resolution: EditTargetResolutionResult = resolveEditTarget(editDescription, context, intentCategory),
): EditResolutionMode {
  const conversationalIntent = classifyUserIntent(editDescription);
  if (conversationalIntent === 'explain' || conversationalIntent === 'recommend') {
    return 'no_edit_answer';
  }

  if (intentCategory === 'structural') {
    // Structural edits still pass through the full edit_graph validation flow.
    return 'auto_apply';
  }

  if (resolution.match_type === 'ambiguous') {
    return 'clarify';
  }

  if (resolution.confidence === 'low') {
    // For parameter_update with no match, propose the change for user confirmation
    // rather than asking "which one?" (clarify). The LLM's edit_graph prompt has the
    // complete graph and can match targets, but we want the user to confirm first.
    if (intentCategory === 'parameter_update') {
      return 'propose_and_confirm';
    }
    return 'clarify';
  }

  if (
    resolution.confidence === 'high'
    && resolution.resolved_target
    // Label-aware compound detection: connector tokens inside the resolved
    // target's own label (e.g. a factor named "Headcount and Scaling Spend")
    // do not count as compound-edit separators. Only `confidence === 'high'`
    // + non-null `resolved_target` + non-ambiguous `match_type` (already
    // routed at line 664) justify stripping the label.
    && !isCompoundEditRequest(editDescription, resolution.resolved_target.label)
    && isLowImpactEditRequest(editDescription, intentCategory, resolution.resolved_target.label)
  ) {
    return 'auto_apply';
  }

  return 'propose_and_confirm';
}

function formatClauseDescription(clause: string): string {
  return clause.trim().replace(/\s+/g, ' ').replace(/^[a-z]/, (char) => char.toUpperCase());
}

function inferActionTypeFromClause(clause: string, intentCategory: EditIntentCategory): ProposedChangeActionType {
  if (/\b(remove|delete)\b/i.test(clause)) return 'structural_remove';
  if (/\b(add|create|insert)\b/i.test(clause)) return 'structural_add';
  if (intentCategory === 'option_configuration' || /\b(option|intervention)\b/i.test(clause)) return 'option_config';
  return 'value_update';
}

function inferElementLabel(clause: string, resolvedTarget: ResolvedEditTarget | null, candidateLabels: string[] = []): string {
  if (resolvedTarget) return resolvedTarget.label;
  // Try matching clause text against known graph labels before falling back to clause text.
  // Handles compound requests where later clauses reference the same or a sibling entity.
  const normClause = normaliseMatchingText(clause);
  for (const label of candidateLabels) {
    if (normClause.includes(normaliseMatchingText(label))) return label;
  }
  const structuralMatch = clause.match(/\b(?:add|create|remove|delete)\s+(?:a |an )?(.*)$/i);
  if (structuralMatch?.[1]) {
    return formatClauseDescription(structuralMatch[1]);
  }
  return formatClauseDescription(clause);
}

function buildProposedChanges(
  editDescription: string,
  resolution: EditTargetResolutionResult,
  intentCategory: EditIntentCategory,
): ProposedChangesPayload {
  // Defence-in-depth: when a high-confidence single target is resolved AND
  // its label itself contains a compound-edit separator (`and`, `also`,
  // `then`, comma), strip the label from the description before splitting
  // on `\band\b|,`. This prevents a label such as `Headcount and Scaling
  // Spend` from being torn into two fake clauses (`Headcount` + `Scaling
  // Spend`) when Mode A is taken for non-routing reasons (e.g. high-impact
  // edits on a resolved target).
  //
  // The label-itself-has-separators gate keeps the existing multi-target
  // Mode A behaviour: a description like "Update Price and also lower
  // Price" with a clean label `Price` still splits into two clauses with
  // `Price` retained in each clause's description — the original behaviour
  // that the test at edit-graph-v2.test.ts pins.
  const resolvedLabel = resolution.confidence === 'high' ? resolution.resolved_target?.label ?? '' : '';
  const labelNeedsProtection = resolvedLabel.length > 0
    && COMPOUND_EDIT_SEPARATOR_RE.test(resolvedLabel.toLowerCase());
  const splitInput = labelNeedsProtection
    ? descriptionResidualAfterStrippingLabel(editDescription, resolvedLabel)
    : editDescription;
  const clauses = splitInput
    .split(/\band\b|,/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const changes = (clauses.length > 0 ? clauses : [editDescription]).map((clause, index) => ({
    description: formatClauseDescription(clause),
    element_label: index === 0
      ? inferElementLabel(clause, resolution.resolved_target)
      : inferElementLabel(clause, null, resolution.candidate_labels),
    action_type: inferActionTypeFromClause(clause, intentCategory),
  }));
  return { changes };
}

function buildClarificationQuestion(intentCategory: EditIntentCategory, alternatives: string[]): string {
  if (intentCategory === 'option_configuration') {
    return `Which option should I update${alternatives.length > 0 ? `: ${alternatives.join(' or ')}` : ''}?`;
  }
  return `Which one should I update${alternatives.length > 0 ? `: ${alternatives.join(' or ')}` : ''}?`;
}

function buildClarificationActions(
  editDescription: string,
  resolution: EditTargetResolutionResult,
): SuggestedAction[] {
  return resolution.alternatives.map((alternative) => ({
    label: alternative.label,
    prompt: `Update ${alternative.label}.`,
    role: 'facilitator',
  }));
}

function buildInstructionPreview(effectiveInstruction: string | null): string | null {
  if (!effectiveInstruction) return null;
  const sanitised = effectiveInstruction.replace(/\s+/g, ' ').trim();
  if (!sanitised) return null;
  return sanitised.slice(0, 240);
}

function hasStructuralOperations(operations: PatchOperation[]): boolean {
  return operations.some((op) =>
    op.op === 'add_node'
    || op.op === 'remove_node'
    || op.op === 'add_edge'
    || op.op === 'remove_edge',
  );
}

function buildRecoveryQuestion(
  intentCategory: EditIntentCategory,
  editDescription: string,
  context: ConversationContext,
): string {
  if (intentCategory === 'option_configuration') {
    const optionLabels = (context.graph?.nodes ?? [])
      .filter((node) => node.kind === 'option')
      .map((node) => ('label' in node && typeof node.label === 'string') ? node.label : null)
      .filter((label): label is string => label !== null && label.length > 0);
    if (optionLabels.length > 0) {
      return `Which option should I configure first${optionLabels.length <= 3 ? `: ${optionLabels.join(', ')}` : ''}?`;
    }
    return 'Which existing option should I configure, and what factor should it change?';
  }
  return `Which existing factor or edge should I update for "${editDescription.trim()}"?`;
}

function buildIntentRecoveryResult(
  intentCategory: EditIntentCategory,
  editDescription: string,
  context: ConversationContext,
  startTime: number,
  diagnostics?: EditGraphTraceDiagnostics,
): EditGraphResult {
  return {
    blocks: [],
    assistantText: buildRecoveryQuestion(intentCategory, editDescription, context),
    latencyMs: Date.now() - startTime,
    appliedGraph: null,
    wasRejected: true,
    diagnostics,
  };
}

// ============================================================================
// Edit Operation Normalisation (CEE_EDIT_NORMALISATION_ENABLED)
// ============================================================================

/**
 * Top-level node fields that belong on the operation value root, not inside `data`.
 * Used to detect and fix LLM wrapping the whole node payload inside `value.data`.
 */
const TOP_LEVEL_NODE_FIELDS = ['category', 'kind', 'label', 'id'];

/**
 * Normalise non-canonical field shapes in edit_graph operations before Zod
 * validation and PLoT submission.
 *
 * **Node normalisation (add_node):**
 * - Unwrap spurious `value.data` wrapper when `value.category` is absent:
 *   - External factor: `data.prior` → `value.prior` (data removed)
 *   - Controllable/observable: hoist `category`/`kind`/`label`/`id` from `data` to value root
 * - Rename `value.observed_state` → `value.data`
 *
 * **Edge normalisation (add_edge / update_edge):**
 * - Rename `belief_exists` → `exists_probability`
 *
 * Returns a new array — original is not mutated.
 * @internal Exported for testing.
 */
export function normaliseEditOpsForPlot(ops: PatchOperation[]): PatchOperation[] {
  if (!config.cee.editNormalisationEnabled) return ops;

  return ops.map((op, index) => {
    if (!op.value || typeof op.value !== 'object') return op;
    const value = { ...(op.value as Record<string, unknown>) };
    let changed = false;

    // ---- Node normalisation (add_node) ----
    if (op.op === 'add_node') {
      // Unwrap spurious `data` wrapper: model puts data sub-fields inside value.data
      // instead of at top level. Only act when `category` is absent (canonical nodes have
      // category at top level, so its presence means the shape is intentional).
      if (value.data && typeof value.data === 'object' && !value.category) {
        const inner = value.data as Record<string, unknown>;

        // External factor: data.prior → value.prior
        if (inner.prior && typeof inner.prior === 'object') {
          value.prior = inner.prior;
          delete value.data;
          changed = true;
          logNormalisation('data.prior→prior', 'prior', index);
        } else {
          // Controllable/observable: the LLM may wrap the entire payload in `data`
          // instead of keeping `data` as the factor-data sub-object. Detect this by
          // checking whether `data` contains top-level node fields (category, kind, label)
          // that should be at the value root, and hoist them out.
          const hoistable = TOP_LEVEL_NODE_FIELDS.filter((k) => k in inner && !(k in value));
          if (hoistable.length > 0) {
            // Deep-copy inner to avoid mutating the original op's data reference
            const cleaned = { ...inner };
            for (const k of hoistable) {
              value[k] = cleaned[k];
              delete cleaned[k];
            }
            // If data still has remaining fields, keep it; otherwise drop it
            const remainingKeys = Object.keys(cleaned);
            if (remainingKeys.length === 0) {
              delete value.data;
            } else {
              value.data = cleaned;
            }
            changed = true;
            logNormalisation('data→top_level', hoistable.join(','), index);
          }
          // If data already contains only sub-fields (value, raw_value, etc.), shape is correct — no-op.
        }
      }

      // Rename observed_state → data
      if ('observed_state' in value && !('data' in value)) {
        value.data = value.observed_state;
        delete value.observed_state;
        changed = true;
        logNormalisation('observed_state', 'data', index);
      }
    }

    // ---- Edge normalisation (add_edge / update_edge) ----
    if (op.op === 'add_edge' || op.op === 'update_edge') {
      // belief_exists → exists_probability
      if ('belief_exists' in value && !('exists_probability' in value)) {
        value.exists_probability = value.belief_exists;
        delete value.belief_exists;
        changed = true;
        logNormalisation('belief_exists', 'exists_probability', index);
      }
    }

    return changed ? { ...op, value } : op;
  });
}

function logNormalisation(fieldFrom: string, fieldTo: string, opIndex: number): void {
  log.info(
    { event: 'edit_graph.field_normalised', field_from: fieldFrom, field_to: fieldTo, op_index: opIndex },
    `edit_graph normalised field: ${fieldFrom} → ${fieldTo}`,
  );
}

// ============================================================================
// Structural Edge Enforcement (A1)
// ============================================================================

/**
 * Enforce canonical strength/probability on structural edges (decision→option,
 * option→factor). Only applies to `add_edge` operations where BOTH the source
 * and target node kinds match the structural pattern.
 *
 * Node kinds are validated against the existing graph + newly added nodes in
 * the same operation set — ID prefix matching alone is NOT sufficient. A factor
 * whose ID happens to start with `opt_` (naming error) must NOT be silently
 * normalised. Only nodes whose `kind` is 'decision'/'option'/'factor' qualify.
 *
 * Edges between non-structural pairs (factor→outcome, factor→risk, factor→factor)
 * are never touched, even if their IDs coincidentally match structural prefixes.
 *
 * @internal Exported for testing.
 */
export function enforceStructuralEdgeDefaults(
  ops: PatchOperation[],
  graph: { nodes: Array<{ id: string; kind?: string }>; edges?: unknown[] },
): PatchOperation[] {
  // Build kind lookup from existing graph + add_node ops in this batch
  const kindMap = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.kind) kindMap.set(node.id, node.kind);
  }
  for (const op of ops) {
    if (op.op === 'add_node' && op.value && typeof op.value === 'object') {
      const v = op.value as Record<string, unknown>;
      if (typeof v.id === 'string' && typeof v.kind === 'string') {
        kindMap.set(v.id, v.kind);
      }
    }
  }

  return ops.map((op, index) => {
    if (op.op !== 'add_edge' || !op.value || typeof op.value !== 'object') return op;
    const v = op.value as Record<string, unknown>;
    const from = String(v.from ?? '');
    const to = String(v.to ?? '');

    const fromKind = kindMap.get(from);
    const toKind = kindMap.get(to);

    // Structural: decision→option or option→factor (by kind, not ID prefix)
    const isStructural =
      (fromKind === 'decision' && toKind === 'option') ||
      (fromKind === 'option' && toKind === 'factor');

    if (!isStructural) return op;

    log.info(
      {
        event: 'edit_graph.structural_edge_enforced',
        op_index: index,
        from,
        to,
        from_kind: fromKind,
        to_kind: toKind,
        field_from: 'llm_values',
        field_to: 'structural_defaults',
      },
      `edit_graph enforced structural edge defaults: ${from}(${fromKind}) → ${to}(${toKind})`,
    );

    // Strip flat strength fields that would conflict with nested STRUCTURAL_EDGE_DEFAULTS.
    // nestEdgeStrengthForPlot() handles this later too, but cleaning here avoids
    // stale non-canonical fields surviving through Zod validation.
    const { strength_mean: _sm, strength_std: _ss, ...cleaned } = v;
    return { ...op, value: { ...cleaned, ...STRUCTURAL_EDGE_DEFAULTS } };
  });
}

// ============================================================================
// Legacy Field Detection
// ============================================================================

const LEGACY_FIELDS = new Set(['belief', 'belief_exists', 'confidence']);

/**
 * Check operations for legacy fields and log telemetry.
 * Returns cleaned operations with legacy fields removed.
 */
function sanitiseOperations(operations: PatchOperation[]): PatchOperation[] {
  let legacyCount = 0;

  const cleaned = operations.map((op) => {
    if (op.value && typeof op.value === 'object') {
      const value = { ...(op.value as Record<string, unknown>) };
      let modified = false;

      for (const field of LEGACY_FIELDS) {
        if (field in value) {
          delete value[field];
          legacyCount++;
          modified = true;
        }
      }

      if (modified) {
        return { ...op, value };
      }
    }
    return op;
  });

  if (legacyCount > 0) {
    log.info(
      { legacy_fields_removed: legacyCount },
      "edit_graph: removed legacy fields from operations",
    );
  }

  return cleaned;
}

// ============================================================================
// Populate old_value for undo data capture
// ============================================================================

/**
 * Populate `old_value` on update/remove operations by looking up the current
 * state from the graph. Enables undo and audit trail.
 *
 * - remove_node: old_value = full node object
 * - update_node: old_value = { fields being changed with current values }
 * - remove_edge: old_value = full edge object
 * - update_edge: old_value = { fields being changed with current values }
 *
 * Does NOT overwrite old_value if the LLM already provided it.
 */
function populateOldValues(
  operations: PatchOperation[],
  graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> },
): PatchOperation[] {
  const nodeMap = new Map(
    graph.nodes.map((n) => [n.id as string, n]),
  );
  const edgeMap = new Map(
    graph.edges.map((e) => [`${e.from}::${e.to}`, e]),
  );

  return operations.map((op) => {
    // Skip if old_value is already set
    if (op.old_value !== undefined) return op;

    switch (op.op) {
      case 'remove_node': {
        const node = nodeMap.get(op.path);
        if (node) return { ...op, old_value: node };
        break;
      }
      case 'update_node': {
        const node = nodeMap.get(op.path);
        if (node && op.value && typeof op.value === 'object') {
          const prev: Record<string, unknown> = {};
          for (const key of Object.keys(op.value as Record<string, unknown>)) {
            if (key in node) prev[key] = node[key];
          }
          if (Object.keys(prev).length > 0) return { ...op, old_value: prev };
        }
        break;
      }
      case 'remove_edge': {
        const edge = edgeMap.get(op.path);
        if (edge) return { ...op, old_value: edge };
        break;
      }
      case 'update_edge': {
        const edge = edgeMap.get(op.path);
        if (edge && op.value && typeof op.value === 'object') {
          const prev: Record<string, unknown> = {};
          for (const key of Object.keys(op.value as Record<string, unknown>)) {
            if (key in edge) prev[key] = edge[key];
          }
          if (Object.keys(prev).length > 0) return { ...op, old_value: prev };
        }
        break;
      }
      default:
        break;
    }

    return op;
  });
}

// ============================================================================
// PLoT Field Mapping
// ============================================================================

/**
 * Map CEE PatchOperation[] to PLoT's expected field names.
 * CEE uses `old_value`; PLoT uses `previous`.
 * CEE internal edge paths use `from::to`; PLoT expects `from->to`.
 * @internal Exported for testing only.
 */
const EDGE_OPS = new Set(['add_edge', 'remove_edge', 'update_edge']);

export function mapOpsForPlot(ops: PatchOperation[]): Record<string, unknown>[] {
  return ops.map(op => {
    // Convert CEE internal edge path format (from::to) to PLoT format (from->to).
    // Only apply to edge operations to avoid corrupting node IDs that might
    // contain colons (defensive — canonical IDs collapse :: to : but guard anyway).
    const isEdgeOp = EDGE_OPS.has(op.op);
    const mapped: Record<string, unknown> = {
      op: op.op,
      path: isEdgeOp && op.path.includes('::') ? op.path.replace('::', '->') : op.path,
    };
    if (op.value !== undefined) {
      // Re-nest flat strength_mean/strength_std into strength: { mean, std } for PLoT.
      // Zod schema uses flat fields; PLoT expects nested canonical format.
      // Gated behind CEE_EDIT_NORMALISATION_ENABLED — flag off preserves pre-change behaviour.
      mapped.value = (isEdgeOp && config.cee.editNormalisationEnabled)
        ? nestEdgeStrengthForPlot(op.value)
        : op.value;
    }
    if (op.old_value !== undefined) mapped.previous = op.old_value;
    return mapped;
  });
}

/**
 * Convert flat `strength_mean` / `strength_std` to nested `strength: { mean, std }`
 * for PLoT's canonical edge format. If `strength` is already nested, leave it alone.
 * If both flat and nested exist, nested wins.
 * @internal Exported for testing.
 */
export function nestEdgeStrengthForPlot(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;

  const hasFlat = 'strength_mean' in v || 'strength_std' in v;

  // Already nested — if flat fields also present, drop them (nested wins per spec)
  if (v.strength && typeof v.strength === 'object') {
    if (hasFlat) {
      const { strength_mean: _sm, strength_std: _ss, ...rest } = v;
      log.info(
        { event: 'edit_graph.field_normalised', field_from: 'strength_mean+strength_std', field_to: 'dropped (nested wins)', op_index: -1 },
        'edit_graph dropped flat strength fields — nested strength already present',
      );
      return { ...rest, strength: v.strength };
    }
    return value;
  }

  if (!hasFlat) return value;

  const { strength_mean, strength_std, ...rest } = v;
  const nested: Record<string, unknown> = {};
  if (strength_mean !== undefined) nested.mean = strength_mean;
  if (strength_std !== undefined) nested.std = strength_std;

  log.info(
    { event: 'edit_graph.field_normalised', field_from: 'strength_mean/strength_std', field_to: 'strength.mean/strength.std', op_index: -1 },
    'edit_graph re-nested flat strength fields for PLoT',
  );

  return { ...rest, strength: nested };
}

// ============================================================================
// Graph Hash
// ============================================================================

/**
 * Compute a short SHA-256 hash of the input graph for optimistic concurrency audit trail.
 */
export function computeGraphHash(graph: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(graph))
    .digest('hex')
    .substring(0, 16);
}

function readGroupedTargetLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((label): label is string => typeof label === 'string')
      .map((label) => label.trim())
      .filter((label) => label.length > 0),
  )];
}

function resolveExplicitGroupedTargets(
  context: ConversationContext,
  groupedTargetLabels: string[],
): ResolvedEditTarget[] {
  if (groupedTargetLabels.length === 0) return [];
  const allTargets = getResolvedTargets(context);
  return groupedTargetLabels
    .map((label) => allTargets.find((target) => normaliseMatchingText(target.label) === normaliseMatchingText(label)) ?? null)
    .filter((target): target is ResolvedEditTarget => target !== null);
}

// ============================================================================
// Applied Changes Receipt
// ============================================================================

/**
 * Return true if this operation is substantive (affects model outputs).
 * Label-only renames are cosmetic and do not warrant a rerun.
 */
function isSubstantiveOperation(op: PatchOperation): boolean {
  if (op.op === 'add_node' || op.op === 'remove_node') return true;
  if (op.op === 'add_edge' || op.op === 'remove_edge' || op.op === 'update_edge') return true;
  if (op.op === 'update_node') {
    const newVal = op.value as Record<string, unknown> | undefined;
    if (!newVal) return false;
    // If the only key changed is `label`, it is cosmetic
    const keys = Object.keys(newVal);
    if (keys.length === 1 && keys[0] === 'label') return false;
    return true;
  }
  return false;
}

/**
 * Resolve a human-readable label for a node path from the graph.
 *
 * Looks up the node by id in the post-edit `graph` first; on miss, falls back
 * to the pre-edit `preGraph` if supplied (covers `remove_node` ops where the
 * target no longer exists in the post-edit graph). Final fallback uses the
 * `opValue.label` if present (covers `add_node` whose target may not yet
 * exist in the graph snapshot under inspection). Returns the raw path only
 * when all three lookups miss — that fallthrough is the input the
 * downstream sanitiser would map to `'the relevant <kind>'`.
 *
 * Phase 2a step 3 (`claude/v5-step2a-step3-label-resolution`): added
 * `preGraph` parameter so callers thread BOTH graphs through. The companion
 * widening in `sanitiseAffectedEntityLabel` ensures a recovered pre-edit
 * label is not re-blanked by the egress sanitiser.
 */
function resolveElementLabel(
  path: string,
  graph: GraphV3T,
  preGraph: GraphV3T | null,
  opValue?: unknown,
): string {
  const nodes = (graph.nodes ?? []) as Array<{ id: string; label?: string }>;
  const node = nodes.find(n => n.id === path);
  if (node?.label) return node.label;
  // Pre-edit fallback — covers remove_node (and any path whose target
  // existed before but not after the mutation).
  if (preGraph) {
    const preNodes = (preGraph.nodes ?? []) as Array<{ id: string; label?: string }>;
    const preNode = preNodes.find(n => n.id === path);
    if (preNode?.label) return preNode.label;
  }
  // For add_node, the label is in the value
  if (opValue && typeof opValue === 'object') {
    const v = opValue as Record<string, unknown>;
    if (typeof v.label === 'string') return v.label;
  }
  return path;
}

/**
 * Build a human-readable description for a single patch operation.
 * Never contains internal node IDs.
 *
 * `preGraph` (when supplied) is consulted as a fallback for any element
 * whose post-edit `graph` lookup misses — see `resolveElementLabel`.
 */
function buildOperationDescription(
  op: PatchOperation,
  graph: GraphV3T,
  preGraph: GraphV3T | null,
): string {
  const label = resolveElementLabel(op.path, graph, preGraph, op.value);

  switch (op.op) {
    case 'add_node':
      return `Added ${label}`;
    case 'remove_node':
      return `Removed ${label}`;
    case 'add_edge': {
      const val = op.value as Record<string, unknown> | undefined;
      const fromLabel = val?.from ? resolveElementLabel(String(val.from), graph, preGraph) : op.path;
      const toLabel = val?.to ? resolveElementLabel(String(val.to), graph, preGraph) : '';
      return toLabel ? `Added edge from ${fromLabel} to ${toLabel}` : `Added edge on ${fromLabel}`;
    }
    case 'remove_edge': {
      const parts = op.path.split('::');
      const fromLabel = resolveElementLabel(parts[0] ?? op.path, graph, preGraph);
      const toLabel = parts[1] ? resolveElementLabel(parts[1], graph, preGraph) : '';
      return toLabel ? `Removed edge from ${fromLabel} to ${toLabel}` : `Removed edge on ${fromLabel}`;
    }
    case 'update_edge': {
      const parts = op.path.split('::');
      const fromLabel = resolveElementLabel(parts[0] ?? op.path, graph, preGraph);
      const toLabel = parts[1] ? resolveElementLabel(parts[1], graph, preGraph) : '';
      return toLabel ? `Updated edge from ${fromLabel} to ${toLabel}` : `Updated edge on ${fromLabel}`;
    }
    case 'update_node': {
      const newVal = op.value as Record<string, unknown> | undefined;
      const oldVal = op.old_value as Record<string, unknown> | undefined;
      if (!newVal) return `Updated ${label}`;
      const keys = Object.keys(newVal);
      if (keys.length === 1 && keys[0] === 'label') {
        const oldLabel = typeof oldVal?.label === 'string' ? oldVal.label : label;
        const newLabel = typeof newVal.label === 'string' ? newVal.label : label;
        return `Renamed "${oldLabel}" to "${newLabel}"`;
      }
      if (typeof newVal.value === 'number') {
        if (oldVal && typeof oldVal.value === 'number') {
          return `${label}: ${oldVal.value} -> ${newVal.value}`;
        }
        return `${label}: set to ${newVal.value}`;
      }
      return `Updated ${label}`;
    }
    default:
      return `Changed ${label}`;
  }
}

/**
 * Build a structured applied-change receipt from the patch operations.
 *
 * - Uses node labels (not internal IDs) in all user-facing fields.
 * - rerun_recommended: true when hasExistingAnalysis AND at least one substantive op.
 *   Edge/value/structural changes are substantive; label-only renames are not.
 *
 * `graph` should be the canonical post-edit (or, in V4 single-graph callers,
 * the pre-edit) graph used as the primary label source. `preGraph` (optional,
 * defaults to null) is consulted as a fallback when an op references an
 * entity absent from `graph` — most importantly `remove_node`, where the
 * target is gone from the post-edit graph by definition. Threading both
 * graphs is the Phase 2a step-3 contract.
 */
export function buildAppliedChanges(
  operations: PatchOperation[],
  graph: GraphV3T,
  hasExistingAnalysis: boolean,
  preGraph: GraphV3T | null = null,
): AppliedChanges {
  const changes: AppliedChangeItem[] = operations.map(op => {
    const label = resolveElementLabel(op.path, graph, preGraph, op.value);
    const description = buildOperationDescription(op, graph, preGraph);
    return { label, description, element_ref: op.path };
  });

  const hasSubstantiveOp = operations.some(isSubstantiveOperation);
  const rerun_recommended = hasExistingAnalysis && hasSubstantiveOp;

  let summary: string;
  if (changes.length === 1) {
    summary = changes[0].description;
  } else {
    const labels = changes.map(c => c.label).join(', ');
    summary = `${changes.length} model parameters updated: ${labels}`;
  }

  return { summary, changes, rerun_recommended };
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Execute the edit_graph tool.
 *
 * @param context - Conversation context (must have graph)
 * @param editDescription - Natural language description of the edit
 * @param adapter - LLM adapter for generating edit operations
 * @param requestId - Request ID for tracing
 * @param turnId - Turn ID for block provenance
 * @param opts - Optional PLoT client and retry configuration
 * @returns GraphPatchBlock with edit operations
 */
export async function handleEditGraph(
  context: ConversationContext,
  editDescription: string,
  adapter: LLMAdapter,
  requestId: string,
  turnId: string,
  opts?: EditGraphOpts,
): Promise<EditGraphResult> {
  if (!context.graph) {
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: 'Cannot edit graph: no graph in context. Draft a graph first.',
      tool: 'edit_graph',
      recoverable: false,
    };
    throw Object.assign(new Error(err.message), { orchestratorError: err });
  }

  const startTime = Date.now();
  const maxRetries = opts?.maxRetries ?? config.cee.maxRepairRetries;
  const plotClient = opts?.plotClient ?? null;
  const invocationInput = opts?.invocationInput ?? {};
  const baseGraphHash = computeGraphHash(context.graph);
  const groupedTargetLabels = readGroupedTargetLabels(invocationInput.grouped_target_labels);
  const groupedTargets = resolveExplicitGroupedTargets(context, groupedTargetLabels);
  const pendingProposal = invocationInput.pending_proposal as PendingProposalState | undefined;
  const confirmationMode = invocationInput.confirmation_mode === 'apply_pending_proposal';
  const intentCategory = classifyEditIntent(editDescription);
  const targetResolution = groupedTargets.length > 0
    ? buildResolutionResult('graph_local', 'high', groupedTargets)
    : resolveEditTarget(editDescription, context, intentCategory);
  const resolutionMode = confirmationMode
    ? 'auto_apply'
    : groupedTargets.length > 0
    ? 'auto_apply'
    : determineEditResolutionMode(editDescription, context, intentCategory, targetResolution);
  const conversationalStateSummary = context.conversational_state
    ? {
        active_entities_count: context.conversational_state.active_entities.length,
        stated_constraints_count: context.conversational_state.stated_constraints.length,
        current_topic: context.conversational_state.current_topic,
      }
    : null;
  const targetResolutionSummary = {
    method: targetResolution.match_type,
    confidence: targetResolution.confidence,
    resolved_label: targetResolution.resolved_target?.label ?? null,
    alternatives_count: targetResolution.alternatives.length,
  };
  let proposalReturned = false;
  const routeMetadata = (): RouteMetadata | undefined => {
    if (confirmationMode) {
      return { outcome: 'proposal_confirmation', reasoning: 'confirmed_pending_proposal' };
    }
    if (proposalReturned) {
      return { outcome: 'proposal_created', reasoning: 'returned_pending_proposal' };
    }
    return undefined;
  };
  const resolvedTargetInstruction = targetResolution.resolved_target
    ? `Apply this request to the existing ${targetResolution.resolved_target.label} ${targetResolution.resolved_target.type} only.`
    : null;
  const groupedTargetInstruction = groupedTargets.length > 0
    ? `Apply the same change to these existing targets only: ${groupedTargets.map((target) => target.label).join(', ')}.`
    : null;
  const intentInstruction = [
    buildIntentInstruction(intentCategory),
    groupedTargetInstruction,
    resolutionMode === 'auto_apply' ? resolvedTargetInstruction : null,
  ]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
  const instructionModeApplied = resolveInstructionMode(intentCategory);
  const graphContextNodeCount = context.graph.nodes?.length ?? 0;
  const graphContextEdgeCount = context.graph.edges?.length ?? 0;
  let operationsProposedCount = 0;
  let operationsProposedTypes: string[] = [];
  let validationOutcome = 'not_evaluated';
  let validationViolationCodes: string[] = [];
  let recoveryPathChosen = 'none';
  let initialEffectiveInstruction: string | null = null;
  let branchTaken: EditGraphTraceDiagnostics['branch_taken'] = 'apply';
  let branchReason: string | null = null;
  let failureBranch: string | null = null;
  let failureCode: string | null = null;
  let failureMessage: string | null = null;
  // R7 — per-turn LLM diagnostics accumulators. Tokens summed across repair
  // attempts; model/stop_reason reflect the final decisive attempt.
  let lastModel: string | null = null;
  let inputTokensSum = 0;
  let outputTokensSum = 0;
  let lastStopReason: string | null = null;
  let repairAttempts = 0;
  let plotOutcome: EditGraphTraceDiagnostics['plot_outcome'] = 'skipped';

  const setViolationCodes = (codes: string[]): void => {
    validationViolationCodes = [...new Set(codes.filter((code) => code.length > 0))];
  };
  const setOpsTelemetry = (ops: PatchOperation[]): void => {
    operationsProposedCount = ops.length;
    operationsProposedTypes = [...new Set(ops.map((op) => op.op))];
  };
  const diagnostics = (): EditGraphTraceDiagnostics => ({
    classified_intent: intentCategory,
    instruction_mode_applied: instructionModeApplied,
    edit_instruction_preview: buildInstructionPreview(initialEffectiveInstruction),
    graph_context_node_count: graphContextNodeCount,
    graph_context_edge_count: graphContextEdgeCount,
    operations_proposed_count: operationsProposedCount,
    operations_proposed_types: operationsProposedTypes,
    validation_outcome: validationOutcome,
    validation_violation_codes: validationViolationCodes,
    recovery_path_chosen: recoveryPathChosen,
    conversational_state_summary: conversationalStateSummary,
    target_resolution: targetResolutionSummary,
    resolution_mode: resolutionMode,
    proposal_returned: proposalReturned,
    branch_taken: branchTaken,
    branch_reason: branchReason,
    failure_branch: failureBranch,
    failure_code: failureCode,
    failure_message: failureMessage,
    model: lastModel,
    input_tokens_est: inputTokensSum,
    output_tokens: outputTokensSum,
    stop_reason: lastStopReason,
    repair_attempts: repairAttempts,
    plot_outcome: plotOutcome,
  });

  // ── Constraint shortcut ────────────────────────────────────────────────
  // Constraints (keep X under/below Y, hard requirement) can't be expressed
  // as standard patch operations. Detect and construct goal_constraints update
  // deterministically instead of falling through to the edit_graph LLM.
  const constraintMatch = detectConstraintIntent(editDescription, context.graph);
  if (constraintMatch) {
    branchTaken = 'apply';
    branchReason = 'constraint_shortcut';
    const ops: PatchOperation[] = [{
      op: 'update_node',
      path: constraintMatch.goalId,
      value: {
        goal_constraints: [...constraintMatch.existingConstraints, constraintMatch.newConstraint],
      },
    }];
    setOpsTelemetry(ops);
    validationOutcome = 'constraint_shortcut';

    // Skip PLoT validation for constraint-only updates (no structural change)
    const constraintLabel = constraintMatch.newConstraint.label ?? constraintMatch.factorLabel;
    return {
      blocks: [createGraphPatchBlock(
        {
          patch_type: 'edit',
          operations: ops,
          status: 'proposed',
          auto_apply: false,
          applied_graph_hash: baseGraphHash,
        },
        turnId,
        undefined,
        undefined,
        'tool:edit_graph',
      )],
      assistantText: `Constraint **${constraintLabel}**${constraintMatch.newConstraint.threshold != null ? ` (threshold: ${constraintMatch.newConstraint.threshold})` : ''} would be added.`,
      latencyMs: Date.now() - startTime,
      appliedGraph: null,
      wasRejected: false,
      diagnostics: diagnostics(),
    };
  }

  if (resolutionMode === 'clarify') {
    branchTaken = 'clarify';
    branchReason = 'ambiguous_target_requires_clarification';
    const pendingClarification: PendingClarificationState = {
      tool: 'edit_graph',
      original_edit_request: editDescription.trim(),
      candidate_labels: targetResolution.alternatives.map((alternative) => alternative.label),
    };
    return {
      blocks: [],
      assistantText: buildClarificationQuestion(intentCategory, targetResolution.alternatives.map((alternative) => alternative.label)),
      latencyMs: Date.now() - startTime,
      appliedGraph: null,
      wasRejected: true,
      suggestedActions: buildClarificationActions(editDescription, targetResolution),
      pendingClarification,
      diagnostics: diagnostics(),
      routeMetadata: routeMetadata(),
    };
  }

  if (resolutionMode === 'propose_and_confirm') {
    branchTaken = 'propose';
    branchReason = confirmationMode ? 'confirmed_pending_proposal' : 'requires_confirmation_before_apply';
    proposalReturned = true;
    const proposedChanges = pendingProposal?.proposed_changes ?? buildProposedChanges(editDescription, targetResolution, intentCategory);
    const candidateLabels = pendingProposal?.candidate_labels
      ?? [...new Set(proposedChanges.changes.map((change) => change.element_label))];
    return {
      blocks: [],
      assistantText: buildProposeAndConfirmText(proposedChanges, targetResolution.resolved_target),
      latencyMs: Date.now() - startTime,
      appliedGraph: null,
      wasRejected: false,
      pendingProposal: {
        tool: 'edit_graph',
        original_edit_request: editDescription.trim(),
        proposed_changes: proposedChanges,
        candidate_labels: candidateLabels,
        base_graph_hash: baseGraphHash,
      },
      proposedChanges,
      diagnostics: diagnostics(),
      routeMetadata: routeMetadata(),
    };
  }

  // Load system prompt from prompt store (3-tier: cache → Supabase → hardcoded default)
  const systemPrompt = await getSystemPrompt('edit_graph');

  // Capture prompt metadata for telemetry/debugging
  let promptMeta: ReturnType<typeof getSystemPromptMeta> | undefined;
  // Context v2 S0: repair-prompt identity for the repair-attempt
  // `v5.context_budget` events. Resolved lazily on the first repair attempt;
  // `null` = resolution failed (observability-only, never fatal).
  let repairPromptMeta: ReturnType<typeof getSystemPromptMeta> | null | undefined;
  try {
    promptMeta = getSystemPromptMeta('edit_graph');
  } catch {
    // Non-fatal — metadata is for observability only
  }

  if (promptMeta) {
    log.info(
      {
        request_id: requestId,
        prompt_id: promptMeta.taskId,
        prompt_source: promptMeta.source,
        prompt_version: promptMeta.prompt_version,
        prompt_hash: promptMeta.prompt_hash,
        cache_status: promptMeta.cache_status,
      },
      "edit_graph prompt loaded",
    );
  }

  // Build context section for LLM (edit compact graph + framing + analysis + selected elements).
  // Context v2 S0: the WithMeta form additionally yields per-section char
  // counts + truncation records for `v5.context_budget` at this adapter
  // boundary. `.text` is byte-identical to the legacy serialiser output.
  const serialisedContext = serialiseEditContextForLLMWithMeta(context);
  const contextSection = serialisedContext.text;

  // Combine system prompt with serialised context
  const fullSystemPrompt = `${systemPrompt}\n\n${intentInstruction ? `${intentInstruction}\n\n` : ''}${contextSection}`;
  initialEffectiveInstruction = fullSystemPrompt;

  const callOpts: CallOpts = {
    requestId,
    timeoutMs: ORCHESTRATOR_TIMEOUT_MS,
  };

  // ---- Baseline structural violations (pre-existing in input graph) ----
  // Edits must not be rejected for violations that already existed before the edit.
  // E.g. a graph with 0 options should still allow factor updates without requiring
  // the edit to also add 2+ options.
  // Uses per-code counts so that a pre-existing ORPHAN_NODE doesn't mask a newly
  // introduced ORPHAN_NODE — only the pre-existing count is subtracted.
  const baselineViolationCounts = new Map<StructuralViolationCode, number>();
  for (const v of validateGraphStructure(context.graph).violations) {
    baselineViolationCounts.set(v.code, (baselineViolationCounts.get(v.code) ?? 0) + 1);
  }

  // ---- Attempt loop: LLM call → validate → PLoT → repair ----
  const totalAttempts = maxRetries + 1;
  let lastValidationResult: PatchValidationResult | undefined;
  let lastPlotErrors: string | undefined;
  let lastRawOps: unknown[] | undefined;
  let consecutiveNarrowStructuralFailures = 0;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    const isRepair = attempt > 1;
    // R7: repair_attempts = repairs beyond the first try (0 on first attempt).
    repairAttempts = attempt - 1;

    // Build the user message
    let userMessage: string;
    if (!isRepair) {
      userMessage = editDescription;
    } else {
      // Repair: include previous errors
      const errorSummary = lastValidationResult && !lastValidationResult.valid
        ? formatPatchValidationErrors(lastValidationResult)
        : lastPlotErrors ?? 'Unknown validation failure';

      userMessage = [
        `Attempt ${attempt} of ${totalAttempts}. Fix the following errors:`,
        '',
        '## Validation Errors',
        errorSummary,
        '',
        '## Original Edit Request',
        editDescription,
        '',
        ...(intentInstruction ? ['## Narrow Edit Constraint', intentInstruction, ''] : []),
        '## Previous (Invalid) Operations',
        // Lane CEE-D (edit-loop reliability): embed previous ops in the SAME
        // JSON OBJECT shape the repair prompt mandates for output
        // ({ "operations": [...] }). A bare array here primed the model
        // toward the v1 bare-array response format, contradicting the
        // repair prompt's own "Respond ONLY with a corrected JSON object"
        // instruction and priming repeat parse failures.
        JSON.stringify({ operations: lastRawOps ?? [] }, null, 2),
      ].join('\n');
    }

    // LLM call
    let chatResult;
    try {
      const effectiveInstruction = isRepair
        ? (await getSystemPrompt('repair_edit_graph')) + '\n\n' + contextSection
        : fullSystemPrompt;
      const editGraphThinking = config.cee.thinking?.editGraphEnabled
        ? { type: 'enabled' as const, budget_tokens: config.cee.thinking.editGraphBudget }
        : undefined;
      // Structured Outputs (Tier A #1, 2026-07-09): re-enabled via the v2
      // stringified-payload schema — value/old_value are `{ type: "string" }`
      // (Lane 26's v8-aux-field trick) so the closed-schema grammar no longer
      // forbids them. Skipped only when extended thinking is enabled
      // (incompatible with structured outputs, same as draft_graph). Applies
      // to BOTH the first attempt and repair attempts (same call site), so
      // the repair loop gets grammar enforcement too. The adapter itself
      // decides (flag + model allowlist) whether structured mode actually
      // engages; the reminder is only appended to the prompt when it does.
      const editGraphOutputSchema = !editGraphThinking
        ? ANTHROPIC_EDIT_GRAPH_SCHEMA as Record<string, unknown>
        : undefined;
      chatResult = await adapter.chat(
        {
          system: effectiveInstruction,
          userMessage,
          maxTokens: getMaxTokensFromConfig('edit_graph') ?? 4000,
          ...(editGraphThinking ? { thinking: editGraphThinking } : {}),
          ...(editGraphOutputSchema ? { outputSchema: editGraphOutputSchema } : {}),
          ...(editGraphOutputSchema ? { structuredOutputsUserReminder: EDIT_GRAPH_STRUCTURED_OUTPUTS_VALUE_REMINDER } : {}),
        },
        callOpts,
      );
    } catch (error) {
      // On last attempt, propagate LLM error
      if (attempt === totalAttempts) {
        const err: OrchestratorError = {
          code: 'TOOL_EXECUTION_FAILED',
          message: `Edit graph LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
          tool: 'edit_graph',
          recoverable: true,
          suggested_retry: 'Try describing the edit again.',
        };
        // R7: structured discriminator read by the dispatch turn-event so
        // failure_code distinguishes an LLM-call failure from a parse failure
        // without parsing the message string.
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { orchestratorError: err, editTurnFailureCode: 'llm_call_failed' as const });
      }
      log.warn(
        { request_id: requestId, attempt, error: error instanceof Error ? error.message : String(error) },
        "edit_graph LLM call failed, will retry",
      );
      continue;
    }

    // R7: accumulate per-call LLM diagnostics (summed across attempts;
    // model/stop_reason reflect the final decisive attempt). `usage` is
    // optional-guarded: production adapters always populate it, but the
    // contract allows its absence (and test adapters omit it) — a missing
    // usage must never crash a successful edit.
    lastModel = chatResult.model;
    inputTokensSum += chatResult.usage?.input_tokens ?? 0;
    outputTokensSum += chatResult.usage?.output_tokens ?? 0;
    lastStopReason = chatResult.stopReason ?? null;

    // Context v2 S0 (ROADMAP 1.73, 03 §2): once per LLM call at this
    // adapter boundary — repair attempts are their own call_site so the
    // dashboard separates first-try context cost from repair context cost.
    // The contextSection is IDENTICAL across attempts (only the system
    // prompt + user message differ), so section_chars repeat by design.
    // Prompt identity: the edit prompt's meta is captured above; the
    // repair prompt's is resolved lazily on first repair attempt.
    if (isRepair && repairPromptMeta === undefined) {
      try {
        repairPromptMeta = getSystemPromptMeta('repair_edit_graph');
      } catch {
        repairPromptMeta = null; // metadata is observability-only
      }
    }
    const budgetPromptMeta = isRepair ? repairPromptMeta : promptMeta;
    emitContextBudget({
      call_site: isRepair ? 'repair_edit_graph' : 'edit_graph',
      model: chatResult.model ?? null,
      prompt_version: budgetPromptMeta?.prompt_version != null ? String(budgetPromptMeta.prompt_version) : null,
      prompt_hash: budgetPromptMeta?.prompt_hash ?? null,
      request_id: requestId,
      scenario_id: context.scenario_id ?? null,
      section_chars: serialisedContext.sectionChars,
      total_chars: contextSection.length,
      truncations: serialisedContext.truncations,
      summary_lag_turns: null, // no summary layer until S4
      ui_narrowed: null, // narrowing marker is a routing-ingress concern
      usage: chatResult.usage,
    });

    // Bidirected edges: the edit_graph prompt (v6) constrains output to directional
    // from/to operations only. Bidirected edge references in the schema are for
    // context (the model may contain bidirected edges), but edit operations always
    // target a single directional edge. No decomposition logic needed.

    // Parse operations from LLM response (v2 object or legacy array)
    let llmResult: EditGraphLLMResult;
    try {
      llmResult = parseEditGraphResponse(chatResult.content);
    } catch (error) {
      if (attempt === totalAttempts) {
        const err: OrchestratorError = {
          code: 'TOOL_EXECUTION_FAILED',
          message: `Failed to parse edit operations from LLM response: ${error instanceof Error ? error.message : String(error)}`,
          tool: 'edit_graph',
          recoverable: true,
          suggested_retry: 'Try describing the edit more clearly.',
        };
        // R7: structured discriminator (see the LLM-call throw above).
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { orchestratorError: err, editTurnFailureCode: 'parse_fail' as const });
      }
      log.warn(
        { request_id: requestId, attempt, error: error instanceof Error ? error.message : String(error) },
        "edit_graph parse failed, will retry",
      );
      validationOutcome = 'parse_failed';
      setViolationCodes(['parse_error']);
      recoveryPathChosen = 'repair_retry';
      // Lane CEE-D (edit-loop reliability): PRESERVE lastRawOps across a
      // parse failure. Resetting to [] here wiped the previous attempt's
      // operations out of the next repair message — the model lost the
      // very context it needed to correct, priming repeat failures. A
      // first-attempt parse failure leaves lastRawOps undefined, which the
      // repair message renders as { "operations": [] } (nothing to keep).
      lastValidationResult = { valid: false, operations: [], zodErrors: undefined, referentialErrors: [{ index: 0, op: 'unknown', path: '', message: error instanceof Error ? error.message : String(error) }] };
      continue;
    }

    // Handle empty operations (no-op: conflict, forbidden edge, already-satisfied)
    if (llmResult.operations.length === 0) {
      const latencyMs = Date.now() - startTime;

      // R10 — preserve a scrubbed clarifying question on the no-op path.
      // When the LLM returns zero operations with a question in
      // `coaching.summary` (its mandated behaviour for an ambiguous edit
      // target), the user should keep that specific, useful question instead of
      // a generic dead-end. We scrub it with the SAME stack as the success
      // path, then a conservative trip test DECLINES preservation — falling
      // back to the deterministic clarify copy + chips — whenever the candidate
      // is empty, makes a success/mutation claim, carries a denial/jargon
      // phrase, internal vocabulary, or a raw id/path. A preserved question
      // never contains a success claim by construction, so the V5 false-success
      // rewrite stays disjoint and untouched.
      //
      // Scope: ONLY `coaching.summary` is preserved. `warnings` remain dropped
      // (the established Codex-P0 Mode-B contract): warnings are free prose that
      // can carry the same false-success / jargon vectors, and the clarifying
      // question the prompt mandates lives in coaching.summary, not warnings.
      // Trip-testing the un-prefixed summary also keeps the line-anchored
      // success-claim patterns effective (a "Note: " prefix would defeat them).
      const scrubGraph = context.graph ?? null;
      let noOpCandidate = llmResult.coaching?.summary
        ? sanitiseUserFacingText(llmResult.coaching.summary, scrubGraph).text
        : '';
      if (noOpCandidate) {
        // Same transforming guards as the success path, before the trip test.
        noOpCandidate = enforceRepairVocabularyDenylist(noOpCandidate).text;
        const proposalGuard = enforceProposalLanguage(noOpCandidate, 'edit_graph');
        if (proposalGuard.leaked && proposalGuard.suffixed) {
          noOpCandidate = proposalGuard.suffixed;
        }
        // Lane 22 — R10 relaxation (transform, not decline): the edit
        // prompt teaches the LLM the word "graph", so its clarifying
        // questions routinely say "the graph" where product copy says
        // "the model". Substituting the domain synonym is claim-safe
        // and lets an otherwise-clean question survive the trip test
        // below instead of being scrubbed to canned copy (live
        // 2026-07-07: coaching_dropped:true, clarification_preserved:
        // false). Case of the leading letter is preserved.
        noOpCandidate = noOpCandidate.replace(/\bgraph\b/gi, (m) =>
          m[0] === 'G' ? 'Model' : 'model',
        );
      }
      const noOpClarificationPreserved =
        noOpCandidate.trim().length > 0 &&
        findSuccessClaimHit(noOpCandidate) === null &&
        findForbiddenPhraseHit(noOpCandidate) === null &&
        findEditInternalsHit(noOpCandidate) === null;

      // Lane 22 — richer deterministic fallback. When preservation
      // declines (or there is no candidate at all), reuse the SAME copy +
      // factor/option-label chips as the route-level edit intercepts
      // (composeEditClarifyResponse) instead of the chip-less canned
      // NO_OP_FALLBACK_TEXT. The copy passes the egress phrase guards
      // (pinned by the edit-clarify-response tests).
      const clarifyFallback = noOpClarificationPreserved
        ? null
        : buildEditClarifyFallbackParts(
            context.graph.nodes as ReadonlyArray<{ id: string; kind: string; label: string }>,
          );
      const assistantText = noOpClarificationPreserved
        ? noOpCandidate
        : clarifyFallback!.text;

      // V5 edit lifecycle recovery v1 — deterministic chips for the
      // no-op branch. Source: validator referential errors first (the
      // only anchor that maps cleanly back to a graph node ID). PLoT
      // errors carry a free-text reason string with no structured
      // factor/edge anchor, so a no-op preceded ONLY by a PLoT failure
      // previously produced zero chips. Lane 22: when no
      // referential-error chips are available and the LLM's question was
      // not preserved, fall back to the clarify label chips so the user
      // always has an affordance (the live 2026-07-07 no-op shipped
      // canned copy with ZERO chips).
      const referentialChips = buildNoOpRecoveryChips({
        referentialErrors: lastValidationResult?.referentialErrors,
        nodes: context.graph.nodes,
      });
      const recoveryChips =
        referentialChips.length > 0
          ? referentialChips
          : clarifyFallback !== null
            ? clarifyFallback.chips.map((c) => ({
                label: c.label,
                prompt: c.message,
                role: 'facilitator' as const,
              }))
            : [];

      log.info(
        {
          request_id: requestId,
          attempt,
          warnings: llmResult.warnings.length,
          warnings_dropped: llmResult.warnings.length > 0,
          has_coaching: !!llmResult.coaching,
          coaching_dropped: !!llmResult.coaching?.summary && !noOpClarificationPreserved,
          clarification_preserved: noOpClarificationPreserved,
          preceded_by_plot_rejection: !!lastPlotErrors,
          preceded_by_validation_failure: !!(lastValidationResult && !lastValidationResult.valid),
          deterministic_chips_emitted: recoveryChips.length,
        },
        "edit_graph returned empty operations (no-op)",
      );
      // V5 edit lifecycle recovery v1 — also emit the event-based
      // `edit_graph.no_operations` telemetry on the V5 dispatch path
      // (the V4 pipeline emits it at phase4-tools/index.ts:203, but
      // the V5 dispatcher never reaches that code path so this
      // event was previously V4-only). Dashboards counting no-op
      // edit_graph rates need the V5 number too.
      emit(TelemetryEvents.EditGraphNoOperations, {
        request_id: requestId,
        scenario_id: context.scenario_id,
        attempt,
        warnings_dropped: llmResult.warnings.length > 0,
        coaching_dropped: !!llmResult.coaching?.summary && !noOpClarificationPreserved,
        clarification_preserved: noOpClarificationPreserved,
        preceded_by_plot_rejection: !!lastPlotErrors,
        preceded_by_validation_failure: !!(lastValidationResult && !lastValidationResult.valid),
        deterministic_chips_emitted: recoveryChips.length,
      });
      validationOutcome = 'no_operations';
      setViolationCodes([]);
      recoveryPathChosen = 'none';
      operationsProposedCount = 0;
      operationsProposedTypes = [];

      return {
        blocks: [],
        assistantText,
        latencyMs,
        appliedGraph: null,
        wasRejected: false,
        noOpClarificationPreserved,
        ...(recoveryChips.length > 0 ? { suggestedActions: [...recoveryChips] } : {}),
        diagnostics: diagnostics(),
      };
    }

    // Strip impact/rationale from operations for the validation pipeline
    const { operations: strippedOps, meta: operationMeta } = stripOperationMeta(llmResult.operations);

    // Normalise non-canonical field names before Zod validation (CEE_EDIT_NORMALISATION_ENABLED)
    const fieldNormalisedOps = normaliseEditOpsForPlot(strippedOps);
    // Enforce structural edge defaults (decision→option, option→factor) before Zod
    const normalisedOps = enforceStructuralEdgeDefaults(
      fieldNormalisedOps,
      context.graph as { nodes: Array<{ id: string; kind?: string }>; edges?: unknown[] },
    );
    setOpsTelemetry(normalisedOps);
    const rawOps: unknown[] = normalisedOps;
    lastRawOps = rawOps;

    if (intentCategory !== 'structural' && hasStructuralOperations(normalisedOps)) {
      consecutiveNarrowStructuralFailures++;
      validationOutcome = 'intent_guard_failed';
      setViolationCodes(['intent_guard_structural_ops']);
      recoveryPathChosen = 'repair_retry';
      lastValidationResult = {
        valid: false,
        operations: [],
        referentialErrors: [{
          index: 0,
          op: 'intent_guard',
          path: '',
          message: `Narrow ${intentCategory} request must use field-level updates only.`,
        }],
      };
      if (consecutiveNarrowStructuralFailures >= 2) {
        recoveryPathChosen = 'narrow_intent_recovery_question';
        return buildIntentRecoveryResult(intentCategory, editDescription, context, startTime, diagnostics());
      }
      continue;
    }

    // Guard: reject oversized operation arrays before expensive validation
    const maxOps = getMaxPatchOperations();
    if (rawOps.length > maxOps) {
      const msg = `Patch contains ${rawOps.length} operations (max ${maxOps}). Reduce the scope of the edit.`;
      log.warn(
        { request_id: requestId, attempt, operations_count: rawOps.length, max: maxOps },
        "edit_graph rejected — too many operations",
      );
      if (attempt === totalAttempts) {
        validationOutcome = 'max_operations_exceeded';
        setViolationCodes(['max_operations_exceeded']);
        recoveryPathChosen = 'rejection_block';
        // R7 (NB-2): label the diagnostics failure_code so this cap rejection is
        // distinct (not null) in the turn event — the highest-frequency cap path
        // R7 needs to measure across R1/R2. Label only; mirrors the trio the
        // sibling rejections set (e.g. budget_exceeded). No cap behaviour change.
        failureBranch = 'max_operations';
        failureCode = 'max_operations_exceeded';
        failureMessage = msg;
        return buildRejectionResult(msg, rawOps as PatchOperation[], baseGraphHash, turnId, startTime, 'MAX_OPERATIONS_EXCEEDED', undefined, attempt, diagnostics());
      }
      validationOutcome = 'max_operations_exceeded';
      setViolationCodes(['max_operations_exceeded']);
      recoveryPathChosen = 'repair_retry';
      lastValidationResult = { valid: false, operations: [], referentialErrors: [{ index: 0, op: 'batch', path: '', message: msg }] };
      continue;
    }

    // Step 1: Zod schema validation + referential integrity
    const graph = context.graph as { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string }> };
    const validationResult = validatePatchOperations(rawOps, graph);
    lastValidationResult = validationResult;

    if (!validationResult.valid) {
      validationOutcome = 'structural_validation_failed';
      setViolationCodes([
        ...(validationResult.zodErrors?.issues.map((issue) => `zod:${issue.code}`) ?? []),
        ...(validationResult.referentialErrors?.map((error) => error.op) ?? []),
      ]);
      recoveryPathChosen = 'repair_retry';
      if (intentCategory !== 'structural') {
        consecutiveNarrowStructuralFailures++;
        if (consecutiveNarrowStructuralFailures >= 2) {
          recoveryPathChosen = 'narrow_intent_recovery_question';
          return buildIntentRecoveryResult(intentCategory, editDescription, context, startTime, diagnostics());
        }
      } else {
        consecutiveNarrowStructuralFailures = 0;
      }
      log.warn(
        {
          request_id: requestId,
          attempt,
          zod_errors: validationResult.zodErrors?.issues.length ?? 0,
          ref_errors: validationResult.referentialErrors?.length ?? 0,
        },
        "edit_graph structural validation failed",
      );

      if (attempt === totalAttempts) {
        // All attempts exhausted — return rejection block
        recoveryPathChosen = 'rejection_block';
        return buildRejectionResult(
          `Structural validation failed after ${totalAttempts} attempts: ${formatPatchValidationErrors(validationResult)}`,
          rawOps as PatchOperation[],
          baseGraphHash,
          turnId,
          startTime,
          'STRUCTURAL_VALIDATION_FAILED',
          undefined,
          attempt,
          diagnostics(),
        );
      }
      continue;
    }

    // Sanitise: remove legacy fields
    let operations = sanitiseOperations(validationResult.operations as PatchOperation[]);

    // Populate old_value for undo data capture (before PLoT submission)
    operations = populateOldValues(
      operations,
      context.graph as { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> },
    );

    // Step 1.5: Strip no-ops and enforce complexity budget (cf-v11.1)
    const strippedForBudget = stripNoOps(operations);

    if (config.cee.patchBudgetEnabled) {
      const budgetResult = checkPatchBudget(strippedForBudget);
      if (!budgetResult.allowed) {
        log.warn(
          { request_id: requestId, attempt, node_ops: budgetResult.nodeOps, edge_ops: budgetResult.edgeOps },
          'edit_graph rejected — complexity budget exceeded',
        );
        const rejectionCtx: PatchRejectionContext = {
          reason: 'budget_exceeded',
          detail: 'Consider breaking this into smaller steps, or rebuilding the model from an updated brief.',
          node_ops: budgetResult.nodeOps,
          edge_ops: budgetResult.edgeOps,
          max_node_ops: MAX_NODE_OPS,
          max_edge_ops: budgetResult.effectiveMaxEdgeOps ?? MAX_EDGE_OPS,
          suggested_actions: [
            { role: 'facilitator', label: 'Break into smaller steps', prompt: "Let's make this change in smaller steps." },
            { role: 'challenger', label: 'Rebuild from updated brief', prompt: 'Would you like to rebuild the model from an updated brief instead?' },
          ],
        };
        const envelope = buildPatchRejectionEnvelope(rejectionCtx, turnId, context);
        validationOutcome = 'budget_exceeded';
        setViolationCodes(['budget_exceeded']);
        recoveryPathChosen = 'rejection_block';
        branchTaken = 'rejection';
        branchReason = 'patch_budget_exceeded';
        failureBranch = 'patch_budget';
        failureCode = 'budget_exceeded';
        failureMessage = rejectionCtx.detail;
        return {
          blocks: [],
          assistantText: envelope.assistant_text,
          latencyMs: Date.now() - startTime,
          appliedGraph: null,
          wasRejected: true,
          suggestedActions: envelope.suggested_actions?.map((action: SuggestedAction) => ({
            label: action.label,
            prompt: action.prompt,
            role: action.role,
          })),
          diagnostics: diagnostics(),
        };
      }
    }

    // Step 1.6: Pre-validation — apply patch to candidate graph and validate structure.
    //
    // V5 H5 follow-up: the candidate-graph COMPUTATION is now decoupled
    // from the patchPreValidationEnabled gate. The candidate is the
    // deterministic post-op graph produced by `applyPatchOperations`
    // (pure function, six PatchOperation kinds). It is the safe
    // fallback that the V4 success branch uses as `appliedGraph` when
    // PLoT did not supply one (see the synthesis block before "Success:
    // build block"). Always computing it lets the V5 edit_graph
    // dispatch path commit a real graph even when pre-validation is
    // disabled by config — the validation step below stays gated.
    //
    // `applyPatchOperations` throwing `PatchApplyError` IS a real
    // failure (NODE_NOT_FOUND, EDGE_NOT_FOUND, etc.) and must be
    // surfaced regardless of validation config. The existing error
    // handler stays in place.
    let candidateGraph: GraphV3T | undefined;
    try {
      candidateGraph = applyPatchOperations(context.graph as GraphV3T, operations);
    } catch (applyErr) {
      if (applyErr instanceof PatchApplyError) {
        if (intentCategory !== 'structural') {
          consecutiveNarrowStructuralFailures++;
          validationOutcome = 'patch_apply_error';
          setViolationCodes([applyErr.code]);
          recoveryPathChosen = 'repair_retry';
          lastValidationResult = {
            valid: false,
            operations: operations as unknown as import('../patch-validation.js').ValidatedPatchOperation[],
            referentialErrors: [{ index: 0, op: applyErr.code, path: '', message: applyErr.message }],
          };
          if (consecutiveNarrowStructuralFailures >= 2) {
            recoveryPathChosen = 'narrow_intent_recovery_question';
            branchTaken = 'recovery_question';
            branchReason = 'repeated_narrow_patch_apply_error';
            failureBranch = 'patch_apply_error';
            failureCode = applyErr.code;
            failureMessage = applyErr.message;
            return buildIntentRecoveryResult(intentCategory, editDescription, context, startTime, diagnostics());
          }
          continue;
        }
        log.warn(
          { request_id: requestId, attempt, code: applyErr.code, error: applyErr.message },
          'edit_graph rejected — patch apply error',
        );
        const rejectionCtx: PatchRejectionContext = {
          reason: 'structural_violation',
          detail: 'Try a different approach to the change.',
          violations: [applyErr.message],
          suggested_actions: [
            // Lane 22 — dead-end "Simplify the change" chip replaced (see
            // the structural-validation rejection site for the rationale).
            { role: 'facilitator', label: 'What would work instead?', prompt: 'What would work instead?' },
          ],
        };
        const envelope = buildPatchRejectionEnvelope(rejectionCtx, turnId, context);
        validationOutcome = 'patch_apply_error';
        setViolationCodes([applyErr.code]);
        recoveryPathChosen = 'patch_rejection_envelope';
        branchTaken = 'rejection';
        branchReason = 'structural_patch_apply_error';
        failureBranch = 'patch_apply_error';
        failureCode = applyErr.code;
        failureMessage = applyErr.message;
        return {
          blocks: [],
          assistantText: envelope.assistant_text,
          latencyMs: Date.now() - startTime,
          appliedGraph: null,
          wasRejected: true,
          suggestedActions: envelope.suggested_actions?.map((action: SuggestedAction) => ({
            label: action.label,
            prompt: action.prompt,
            role: action.role,
          })),
          diagnostics: diagnostics(),
        };
      }
      throw applyErr;
    }

    if (config.cee.patchPreValidationEnabled) {
      const structResultRaw = validateGraphStructure(candidateGraph);
      // Filter out violations that already existed in the input graph — edits should
      // not be rejected for pre-existing structural incompleteness (e.g. no options yet).
      // Uses count-based comparison: subtract baseline counts per code, so new instances
      // of the same violation code (e.g. a second ORPHAN_NODE) are still caught.
      const remainingBaseline = new Map(baselineViolationCounts);
      const newViolations = structResultRaw.violations.filter((v) => {
        const count = remainingBaseline.get(v.code) ?? 0;
        if (count > 0) {
          remainingBaseline.set(v.code, count - 1);
          return false; // absorbed by baseline
        }
        return true; // genuinely new
      });
      const structResult = {
        valid: newViolations.length === 0,
        violations: newViolations,
      };
      if (!structResult.valid) {
        validationOutcome = 'graph_structure_invalid';
        setViolationCodes(structResult.violations.map((violation) => violation.code));
        recoveryPathChosen = 'repair_retry';
        // Repair-eligible structural codes for the structural-intent path.
        // Default behaviour for structural intents is immediate reject — for
        // most structural failures (NO_GOAL, CYCLE_DETECTED, NODE_LIMIT_EXCEEDED,
        // etc.) repair is unlikely to recover. OPTION_NO_FACTOR_EDGES is the
        // exception: an LLM that emits add_node + decision-edge but forgets the
        // option → factor edge has made a known-fixable mistake. Per the brief,
        // this code must enter the repair loop before final rejection.
        const STRUCTURAL_REPAIRABLE_CODES = new Set<string>(['OPTION_NO_FACTOR_EDGES']);
        const allRepairable = structResult.violations.length > 0
          && structResult.violations.every((v) => STRUCTURAL_REPAIRABLE_CODES.has(v.code));
        const isLastAttempt = attempt === totalAttempts;
        if (intentCategory !== 'structural' || (allRepairable && !isLastAttempt)) {
          consecutiveNarrowStructuralFailures++;
          lastValidationResult = {
            valid: false,
            operations: operations as unknown as import('../patch-validation.js').ValidatedPatchOperation[],
            referentialErrors: structResult.violations.map((violation, index) => ({
              index,
              op: violation.code,
              path: '',
              message: violation.detail,
            })),
          };
          // Narrow-intent recovery-question guard only applies to non-structural
          // intents — for structural intents repairing OPTION_NO_FACTOR_EDGES,
          // skip the consecutive-failure recovery question (the structural intent
          // path doesn't have the "narrow recovery" semantics).
          if (intentCategory !== 'structural' && consecutiveNarrowStructuralFailures >= 2) {
            recoveryPathChosen = 'narrow_intent_recovery_question';
            branchTaken = 'recovery_question';
            branchReason = 'repeated_graph_structure_invalid';
            failureBranch = 'graph_structure_invalid';
            failureCode = structResult.violations[0]?.code ?? 'graph_structure_invalid';
            failureMessage = structResult.violations[0]?.detail ?? 'Graph structure invalid';
            return buildIntentRecoveryResult(intentCategory, editDescription, context, startTime, diagnostics());
          }
          continue;
        }
        const translatedViolations = structResult.violations.map(
          (v) => VIOLATION_MESSAGES[v.code] ?? v.detail,
        );
        log.warn(
          { request_id: requestId, attempt, violations: structResult.violations.map((v) => v.code) },
          'edit_graph rejected — structural validation failed',
        );
        // Lane 22 — vetted, claim-safe reasons: ONLY codes with an entry in
        // the user-facing VIOLATION_MESSAGES catalogue qualify (raw
        // `v.detail` strings carry internal ids and stay suppressed).
        const userSafeReasons = [
          ...new Set(
            structResult.violations
              .map((v) => VIOLATION_MESSAGES[v.code])
              .filter((m): m is string => typeof m === 'string' && m.length > 0),
          ),
        ].slice(0, 2);
        const rejectionCtx: PatchRejectionContext = {
          reason: 'structural_violation',
          detail: 'Consider simplifying the change or approaching it differently.',
          violations: translatedViolations,
          ...(userSafeReasons.length > 0 ? { user_safe_reasons: userSafeReasons } : {}),
          suggested_actions: [
            // Lane 22 — the old "Simplify the change" chip was a known
            // dead-end: its prompt re-entered the V4 edit LLM with no
            // context, no-oped, and needed an exact-text interceptor
            // (chip-simplify-intercept.ts, closed loop documented since
            // 2026-05-22) to break the loop. Replaced with a
            // question-shaped prompt that carries no edit verb, so it
            // routes to the conversational path instead of a guaranteed
            // no-op edit dispatch. The interceptor stays for
            // already-rendered legacy chips.
            { role: 'facilitator', label: 'What would work instead?', prompt: 'What would work instead?' },
            { role: 'challenger', label: 'Rebuild from updated brief', prompt: 'Would you like to rebuild the model from an updated brief instead?' },
          ],
        };
        // Capability 2A (flag-gated): for the unsupported add-risk / reachability
        // rejection class ONLY, substitute deterministic, structural-only next-step
        // copy in place of the generic suppression. The classifier returns null for
        // every other rejection, so all other reasons/types stay byte-identical
        // (and the flag is default-OFF). Placeholder copy — final wording authored
        // separately before any live run / flag enablement.
        if (config.cee.addRiskRejectionGuidanceEnabled) {
          const addRiskMatch = classifyAddRiskToOptionRejection(
            candidateGraph,
            structResult.violations,
            operations,
          );
          if (addRiskMatch) {
            rejectionCtx.structural_guidance = ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER;
          }
        }
        const envelope = buildPatchRejectionEnvelope(rejectionCtx, turnId, context);
        branchTaken = 'rejection';
        branchReason = 'graph_structure_invalid';
        failureBranch = 'graph_structure_invalid';
        failureCode = structResult.violations[0]?.code ?? 'graph_structure_invalid';
        failureMessage = translatedViolations[0] ?? 'Graph structure invalid';
        return {
          blocks: [],
          assistantText: envelope.assistant_text,
          latencyMs: Date.now() - startTime,
          appliedGraph: null,
          wasRejected: true,
          suggestedActions: envelope.suggested_actions?.map((action: SuggestedAction) => ({
            label: action.label,
            prompt: action.prompt,
            role: action.role,
          })),
          diagnostics: diagnostics(),
        };
      }
    }

    // Step 2: PLoT semantic validation (if client configured)
    let repairsApplied: RepairEntry[] | undefined;
    let appliedGraph: GraphV3T | undefined;
    let appliedGraphHash: string | undefined;
    let plotWarnings: string[] | undefined;
    const allWarnings: string[] = [];

    if (plotClient) {
      try {
        const plotPayload: Record<string, unknown> = {
          graph: context.graph,
          operations: mapOpsForPlot(operations),
          scenario_id: context.scenario_id,
          base_graph_hash: baseGraphHash,
        };

        const plotResult: ValidatePatchResult = await plotClient.validatePatch(plotPayload, requestId, opts?.plotOpts);
        // R7: PLoT responded — tentatively a pass; overridden below for the
        // feature-disabled (skipped) and rejection branches.
        plotOutcome = 'pass';

        // FEATURE_DISABLED (501) → skip semantic validation with warning (same as PLoT not configured)
        if (plotResult.kind === 'feature_disabled') {
          plotOutcome = 'skipped';
          log.info(
            { request_id: requestId, attempt },
            "edit_graph PLoT validate-patch FEATURE_DISABLED — skipping semantic validation",
          );
          allWarnings.push('PLOT_VALIDATION_SKIPPED: PLoT validate-patch not available — semantic validation skipped');
          // Fall through to success path (no semantic gate)
        } else if (plotResult.kind === 'rejection') {
          // 422 structured rejection — patch is semantically invalid
          const reason = plotResult.message ?? 'Semantic validation rejected by PLoT';
          const plotCode = plotResult.code;
          const plotViolations = plotResult.violations;
          plotOutcome = 'rejected';
          validationOutcome = 'plot_semantic_rejected';
          setViolationCodes([plotCode ?? 'plot_semantic_rejected']);
          recoveryPathChosen = 'repair_retry';
          if (intentCategory !== 'structural') {
            consecutiveNarrowStructuralFailures++;
            if (consecutiveNarrowStructuralFailures >= 2) {
              recoveryPathChosen = 'narrow_intent_recovery_question';
              branchTaken = 'recovery_question';
              branchReason = 'repeated_plot_semantic_rejection';
              failureBranch = 'plot_semantic_rejected';
              failureCode = plotCode ?? 'plot_semantic_rejected';
              failureMessage = reason;
              return buildIntentRecoveryResult(intentCategory, editDescription, context, startTime, diagnostics());
            }
          }

          log.warn(
            { request_id: requestId, attempt, reason, plot_code: plotCode },
            "edit_graph PLoT rejected patch",
          );

          if (attempt === totalAttempts) {
            recoveryPathChosen = 'rejection_block';
            branchTaken = 'rejection';
            branchReason = 'plot_semantic_rejected';
            failureBranch = 'plot_semantic_rejected';
            failureCode = plotCode ?? 'PLOT_SEMANTIC_REJECTED';
            failureMessage = reason;
            return buildRejectionResult(
              reason,
              operations,
              baseGraphHash,
              turnId,
              startTime,
              'PLOT_SEMANTIC_REJECTED',
              { plot_code: plotCode, plot_violations: plotViolations },
              attempt,
              diagnostics(),
            );
          }

          lastPlotErrors = reason;
          lastValidationResult = { valid: false, operations: validationResult.operations, referentialErrors: [{ index: 0, op: 'plot', path: '', message: reason }] };
          continue;
        } else {
          // Success — extract response fields
          const plotResponse = plotResult.data;

          // Check verdict field for backwards compatibility with older PLoT versions
          const verdict = plotResponse.verdict as string | undefined;
          if (verdict === 'rejected') {
            const reason = (plotResponse.reason as string) ?? 'Semantic validation rejected by PLoT';
            const plotCode = typeof plotResponse.code === 'string' ? plotResponse.code : undefined;
            const plotViolations = Array.isArray(plotResponse.violations) ? plotResponse.violations : undefined;
            plotOutcome = 'rejected';
            validationOutcome = 'plot_semantic_rejected';
            setViolationCodes([plotCode ?? 'plot_semantic_rejected']);
            recoveryPathChosen = 'repair_retry';
            if (intentCategory !== 'structural') {
              consecutiveNarrowStructuralFailures++;
              if (consecutiveNarrowStructuralFailures >= 2) {
                recoveryPathChosen = 'narrow_intent_recovery_question';
                branchTaken = 'recovery_question';
                branchReason = 'repeated_plot_verdict_rejection';
                failureBranch = 'plot_semantic_rejected';
                failureCode = plotCode ?? 'plot_semantic_rejected';
                failureMessage = reason;
                return buildIntentRecoveryResult(intentCategory, editDescription, context, startTime, diagnostics());
              }
            }

            log.warn(
              { request_id: requestId, attempt, verdict, reason, plot_code: plotCode },
              "edit_graph PLoT rejected patch (verdict field)",
            );

            if (attempt === totalAttempts) {
              recoveryPathChosen = 'rejection_block';
              branchTaken = 'rejection';
              branchReason = 'plot_semantic_rejected';
              failureBranch = 'plot_semantic_rejected';
              failureCode = plotCode ?? 'PLOT_SEMANTIC_REJECTED';
              failureMessage = reason;
              return buildRejectionResult(
                reason,
                operations,
                baseGraphHash,
                turnId,
                startTime,
                'PLOT_SEMANTIC_REJECTED',
                { plot_code: plotCode, plot_violations: plotViolations },
                attempt,
                diagnostics(),
              );
            }

            lastPlotErrors = reason;
            lastValidationResult = { valid: false, operations: validationResult.operations, referentialErrors: [{ index: 0, op: 'plot', path: '', message: reason }] };
            continue;
          }

          // Capture PLoT repairs (surfaced as-is, never rewritten into operations)
          if (plotResponse.repairs_applied && Array.isArray(plotResponse.repairs_applied) && plotResponse.repairs_applied.length > 0) {
            repairsApplied = plotResponse.repairs_applied as RepairEntry[];
            log.info(
              {
                request_id: requestId,
                repairs_count: repairsApplied.length,
                first_repair_keys: repairsApplied.length > 0
                  ? Object.keys(repairsApplied[0] as unknown as Record<string, unknown>)
                  : [],
              },
              "edit_graph PLoT applied repairs",
            );
          }

          // Capture applied_graph and its hash from PLoT response
          if (plotResponse.applied_graph && typeof plotResponse.applied_graph === 'object') {
            appliedGraph = plotResponse.applied_graph as GraphV3T;
            // Prefer PLoT's canonical hash; fall back to local computation
            appliedGraphHash = typeof plotResponse.graph_hash === 'string'
              ? plotResponse.graph_hash
              : computeGraphHash(appliedGraph);
            log.info(
              { request_id: requestId, applied_graph_hash: appliedGraphHash, hash_source: typeof plotResponse.graph_hash === 'string' ? 'plot' : 'local' },
              "edit_graph PLoT returned applied graph",
            );
          }

          // Surface PLoT warnings in block data
          if (plotResponse.warnings && Array.isArray(plotResponse.warnings) && plotResponse.warnings.length > 0) {
            plotWarnings = plotResponse.warnings.map((w: unknown) =>
              typeof w === 'string' ? w : typeof w === 'object' && w !== null && 'message' in w ? String((w as { message: unknown }).message) : JSON.stringify(w),
            );
          }
        }
      } catch (plotError) {
        // PLoT configured but failed — hard reject (CEE must not propose semantically unvalidated patches)
        const errorMessage = plotError instanceof Error ? plotError.message : String(plotError);
        plotOutcome = 'unavailable';

        log.error(
          {
            request_id: requestId,
            attempt,
            error: errorMessage,
          },
          "edit_graph PLoT validation failed — rejecting patch (semantic gate required)",
        );

        if (attempt === totalAttempts) {
          validationOutcome = 'plot_unavailable';
          setViolationCodes(['plot_unavailable']);
          recoveryPathChosen = 'rejection_block';
          branchTaken = 'rejection';
          branchReason = 'plot_unavailable';
          failureBranch = 'plot_unavailable';
          failureCode = 'PLOT_UNAVAILABLE';
          failureMessage = errorMessage;
          return buildRejectionResult(
            `PLoT semantic validation unavailable: ${errorMessage}`,
            operations,
            baseGraphHash,
            turnId,
            startTime,
            'PLOT_UNAVAILABLE',
            undefined,
            attempt,
            diagnostics(),
          );
        }

        validationOutcome = 'plot_unavailable';
        setViolationCodes(['plot_unavailable']);
        recoveryPathChosen = 'repair_retry';
        lastPlotErrors = `PLoT unavailable: ${errorMessage}`;
        lastValidationResult = { valid: false, operations: validationResult.operations, referentialErrors: [{ index: 0, op: 'plot', path: '', message: `PLoT unavailable: ${errorMessage}` }] };
        continue;
      }
    }

    // V5 H5 follow-up — appliedGraph synthesis from local candidateGraph.
    //
    // Before this block, `appliedGraph` is set only when PLoT supplied
    // `applied_graph` in its response (line 2243-2253 above). When the
    // V5 edit_graph dispatcher invokes this handler, no `plotClient` is
    // passed (intentional — V5 dispatch does not couple to PLoT
    // infrastructure), so PLoT never runs and `appliedGraph` stays
    // undefined. Staging Layer-B replay confirmed this: V4 returned
    // operations + appliedChanges + LLM coaching prose, but `appliedGraph:
    // null` cascaded through V5 dispatch as `successfulAppliedMutation =
    // false` → no edit_graph fact emitted → scenarios.graph not advanced
    // → recent_changes empty → stale/rerun blind to graph diffs.
    //
    // The fix synthesises `appliedGraph` from the locally-computed
    // `candidateGraph` (produced unconditionally by
    // `applyPatchOperations` at the apply block above; decoupled from
    // `config.cee.patchPreValidationEnabled`, which now gates only the
    // structural-validation step). The candidate is the deterministic
    // post-op graph and is semantically equivalent to what PLoT's
    // `applied_graph` would be ONLY when PLoT did not apply repairs.
    //
    // Safety rules (in order):
    //   A. plotClient null  → PLoT didn't run, no repairs possible →
    //      candidate is safe → synthesise.
    //   B. plotClient configured AND PLoT omitted applied_graph AND no
    //      repairs reported → candidate is safe → synthesise.
    //   C. plotClient configured AND PLoT omitted applied_graph AND
    //      repairs WERE reported → candidate does NOT carry the repairs,
    //      so substituting it would silently persist an unrepaired graph
    //      → REFUSE (return rejection). Operator should chase the PLoT
    //      contract violation rather than the system silently downgrading.
    //   D. appliedGraph is STILL null after the synthesis step (i.e.
    //      candidateGraph itself is missing because applyPatchOperations
    //      threw — though that path returns rejection earlier — or rule
    //      C above didn't fire to return rejection) → also REFUSE
    //      (return rejection). Cannot truthfully claim success without
    //      a graph to commit.
    if (!appliedGraph && candidateGraph) {
      const plotConfigured = plotClient !== null;
      const repairsReported = repairsApplied !== undefined && repairsApplied.length > 0;

      if (plotConfigured && repairsReported) {
        // Rule C — refuse to substitute candidateGraph silently. PLoT
        // applied repairs but did not echo the repaired graph back;
        // the candidate lacks the repairs so committing it would
        // persist a pre-repair shape that the LLM and downstream
        // assertions don't know about.
        log.error(
          {
            request_id: requestId,
            attempt,
            repairs_count: repairsApplied?.length ?? 0,
          },
          'edit_graph PLoT reported repairs but omitted applied_graph — refusing to persist unrepaired candidateGraph',
        );
        validationOutcome = 'plot_applied_graph_omitted_with_repairs';
        setViolationCodes(['plot_applied_graph_omitted_with_repairs']);
        recoveryPathChosen = 'rejection_block';
        branchTaken = 'rejection';
        branchReason = 'plot_applied_graph_omitted_with_repairs';
        failureBranch = 'plot_applied_graph_omitted_with_repairs';
        failureCode = 'PLOT_APPLIED_GRAPH_OMITTED_WITH_REPAIRS';
        failureMessage = 'PLoT reported repairs without echoing applied_graph; cannot persist unrepaired candidate';
        return buildRejectionResult(
          'The change was validated but the system could not capture the final applied state. Try the change again.',
          operations,
          baseGraphHash,
          turnId,
          startTime,
          'PLOT_APPLIED_GRAPH_OMITTED_WITH_REPAIRS',
          undefined,
          attempt,
          diagnostics(),
        );
      }

      // Rules A and B — safe to synthesise. The candidate is the
      // deterministic result of applying `operations` to
      // `context.graph` via `applyPatchOperations` (pure function,
      // covers all six PatchOperation kinds). When PLoT did not run
      // OR ran with no repairs, this is what PLoT would have returned.
      //
      // Safety backstop: strict-validate the candidate before promoting,
      // but ONLY when the base graph was already V3-valid. If the patch
      // took a valid graph and made it invalid, refuse — that is the
      // production failure mode (staging Step 1 draft was V3-valid; the
      // partial-strength patch in Step 2 dropped strength.std and the
      // resulting graph failed `GraphV3.safeParse` inside
      // `loadScenarioSnapshotForRunAnalysis` on the next chip-click).
      //
      // If the base was already V3-invalid (legacy persisted graph,
      // migration window, malformed test fixture), the patch is not the
      // cause of the defect and refusing here would block legitimate
      // edits without actually closing the failure window — the next
      // read of the base graph would have failed regardless. The narrow
      // conditional preserves the bug fix without scope-creeping into a
      // graph-wide canonicalisation gate.
      const baseValid = GraphV3.safeParse(context.graph as unknown).success;
      const candidateParse = baseValid ? GraphV3.safeParse(candidateGraph) : { success: true as const };
      if (!candidateParse.success) {
        const firstIssue = candidateParse.error.issues[0];
        log.error(
          {
            request_id: requestId,
            attempt,
            plot_configured: plotConfigured,
            issue_path: firstIssue?.path,
            issue_code: firstIssue?.code,
            issue_message: firstIssue?.message,
            issues_count: candidateParse.error.issues.length,
          },
          'edit_graph synthesised candidateGraph fails GraphV3 strict parse — refusing to persist',
        );
        validationOutcome = 'synthesized_graph_invalid';
        setViolationCodes(['synthesized_graph_invalid']);
        recoveryPathChosen = 'rejection_block';
        branchTaken = 'rejection';
        branchReason = 'synthesized_graph_invalid';
        failureBranch = 'synthesized_graph_invalid';
        failureCode = 'SYNTHESIZED_GRAPH_INVALID';
        failureMessage = 'Synthesised candidateGraph failed GraphV3 strict parse; cannot persist a graph that would break subsequent reads';
        return buildRejectionResult(
          'The change was validated but the system could not capture the final applied state. Try the change again.',
          operations,
          baseGraphHash,
          turnId,
          startTime,
          'SYNTHESIZED_GRAPH_INVALID',
          undefined,
          attempt,
          diagnostics(),
        );
      }

      appliedGraph = candidateGraph;
      appliedGraphHash = computeGraphHash(candidateGraph);
      log.info(
        {
          request_id: requestId,
          applied_graph_hash: appliedGraphHash,
          hash_source: 'local',
          plot_configured: plotConfigured,
        },
        'edit_graph appliedGraph synthesized from local candidateGraph',
      );
      emit(TelemetryEvents.V5EditGraphAppliedGraphSynthesizedLocally, {
        request_id: requestId,
        scenario_id: context.scenario_id ?? null,
        operations_count: operations.length,
        plot_configured: plotConfigured,
      });
    }

    // Rule D — refuse to enter the success branch without a graph to
    // commit. If `appliedGraph` is STILL undefined here, neither PLoT
    // nor the local synthesis above (Rules A/B/C) produced one. This
    // should not happen in normal operation post-fix — `candidateGraph`
    // is computed unconditionally and the synthesis block uses it — but
    // a future regression in the apply step (e.g., PatchApplyError
    // path returning success-shaped result by mistake) would land here.
    // Returning through the success branch with `appliedGraph: null`
    // was the bug staging replay surfaced; honest non-commit copy via
    // `buildRejectionResult` is the correct outcome.
    if (!appliedGraph) {
      log.error(
        {
          request_id: requestId,
          attempt,
          has_candidate: candidateGraph !== undefined,
          plot_configured: plotClient !== null,
          patch_pre_validation_enabled: config.cee.patchPreValidationEnabled,
        },
        'edit_graph cannot reach success branch without appliedGraph — refusing to commit',
      );
      validationOutcome = 'applied_graph_unavailable';
      setViolationCodes(['applied_graph_unavailable']);
      recoveryPathChosen = 'rejection_block';
      branchTaken = 'rejection';
      branchReason = 'applied_graph_unavailable';
      failureBranch = 'applied_graph_unavailable';
      failureCode = 'APPLIED_GRAPH_UNAVAILABLE';
      failureMessage = 'No applied graph available: PLoT did not supply one and no local candidate was computed';
      return buildRejectionResult(
        'Could not capture the final state of that edit. Try a simpler change or try again.',
        operations,
        baseGraphHash,
        turnId,
        startTime,
        'APPLIED_GRAPH_UNAVAILABLE',
        undefined,
        attempt,
        diagnostics(),
      );
    }

    // V5 edit_graph P0 (add-option encoding) — a successful edit must never
    // persist an analysis-incompatible option. Encode option interventions to
    // the canonical top-level InterventionV3 (deriving `value` from raw_value +
    // the target factor's cap via the canonical `normaliseFactorValue`, and
    // recovering the data.interventions / node-level shapes the edit LLM emits).
    // If a TOUCHED option carries intervention intent whose value cannot be
    // SAFELY derived (no cap to normalise against, or an ambiguous node-level
    // target), DEFER: reject the edit via the standard non-applied path so
    // scenarios.graph is left UNCHANGED rather than persisting an option that
    // would later fail run_analysis with `options_not_configured`.
    {
      const touchedOptionIds = optionIdsTouchedByOperations(operations, appliedGraph);
      // P0-A configure-or-don't-persist: an option ADDED while REQUESTING an
      // intervention configuration must end up with canonical top-level
      // interventions, or the add is deferred (graph unchanged) rather than
      // persisting an interventions:null option that later fails run_analysis
      // with options_not_configured. Intent-scoped (not "any added option") so a
      // bare needs_encoding add (no requested intervention, configured later) is
      // never rejected.
      const mustConfigureOptionIds = optionIdsAddedWithInterventionIntent(operations);
      const encoded = encodeOptionInterventionsForEdit(appliedGraph, touchedOptionIds, mustConfigureOptionIds);
      if (encoded.unresolvedOptionIds.length > 0) {
        validationOutcome = 'option_interventions_unresolvable';
        setViolationCodes(['option_interventions_unresolvable']);
        recoveryPathChosen = 'rejection_block';
        branchTaken = 'rejection';
        branchReason = 'option_interventions_unresolvable';
        failureBranch = 'option_interventions_unresolvable';
        failureCode = 'OPTION_INTERVENTIONS_UNRESOLVABLE';
        // Detailed id list stays in `failureMessage` for telemetry/diagnostics only;
        // the block's rejection.reason (which the UI may surface) is kept generic.
        failureMessage = `Option intervention value(s) could not be encoded: ${encoded.unresolvedOptionIds.join(', ')}`;
        return buildRejectionResult(
          'Option interventions could not be safely encoded.',
          operations,
          baseGraphHash,
          turnId,
          startTime,
          'OPTION_INTERVENTIONS_UNRESOLVABLE',
          undefined,
          attempt,
          diagnostics(),
        );
      }
      if (encoded.graph !== appliedGraph) {
        appliedGraph = encoded.graph as GraphV3T;
        appliedGraphHash = computeGraphHash(appliedGraph);
      }
    }

    // ---- Success: build block ----
    const latencyMs = Date.now() - startTime;

    // Collect validation warnings: LLM warnings + PLoT warnings + skip notice
    if (llmResult.warnings.length > 0) {
      allWarnings.push(...llmResult.warnings);
    }
    if (plotWarnings) {
      allWarnings.push(...plotWarnings);
    }
    if (!plotClient) {
      allWarnings.push('PLOT_VALIDATION_SKIPPED: PLoT was unavailable — this patch has not been canonically validated');
    }

    consecutiveNarrowStructuralFailures = 0;
    validationOutcome = 'success';
    setViolationCodes([]);
    recoveryPathChosen = 'none';

    // Compute analysis_ready from post-patch graph (single candidate graph flow)
    const readinessGraph = appliedGraph ?? candidateGraph;
    const analysisReady = readinessGraph ? computeStructuralReadiness(readinessGraph) : undefined;

    // Extract explicit intervention_updates from operations for downstream consumers.
    // Gated behind CEE_EDIT_INTERVENTION_ROUTING_ENABLED.
    const interventionUpdates = config.cee.editInterventionRoutingEnabled
      ? extractInterventionUpdates(operations)
      : [];

    const patchData: GraphPatchBlockData = {
      patch_type: 'edit',
      operations,
      status: 'proposed',
      auto_apply: false,
      base_graph_hash: baseGraphHash,
      // Pass the pre-mutation graph so buildPatchSummary can resolve target
      // labels for add_edge ops (the new option's intervention targets are
      // existing factors). Falls back to count-based summary on resolution failure.
      summary: buildPatchSummary(operations, llmResult.coaching?.summary, 'edit', context.graph ?? null),
      // Fix 5: past-tense summary so the UI can render the accepted card
      // without a patch_accepted round-trip. Optional and additive.
      applied_summary: buildPatchSummary(operations, llmResult.coaching?.summary, 'accepted', context.graph ?? null),
      ...(appliedGraph && { applied_graph: appliedGraph }),
      ...(appliedGraphHash && { applied_graph_hash: appliedGraphHash }),
      ...(repairsApplied && repairsApplied.length > 0 && { repairs_applied: repairsApplied }),
      ...(allWarnings.length > 0 && { validation_warnings: allWarnings }),
      ...(analysisReady && { analysis_ready: analysisReady }),
      ...(interventionUpdates.length > 0 && { intervention_updates: interventionUpdates }),
    };

    const block = createGraphPatchBlock(patchData, turnId, undefined, undefined, 'tool:edit_graph');

    // Store per-operation metadata and removed_edges in block debug payload
    // (attached to provenance for observability + mirrored at the data top-level
    // so the UI can read it without reaching into provenance internals).
    const debugMeta: Record<string, unknown> = {};
    if (operationMeta.some(m => m.impact !== 'low' || m.rationale !== '')) {
      debugMeta.operation_meta = operationMeta;
      // Top-level mirror for the conversation block — array of
      // { impact, rationale } indexed parallel to operations[].
      // The UI's GraphPatchBlock.operation_meta reads from this path.
      (block.data as GraphPatchBlockData).operation_meta = operationMeta;
    }
    if (llmResult.removed_edges.length > 0) {
      debugMeta.removed_edges = llmResult.removed_edges;
    }
    if (Object.keys(debugMeta).length > 0) {
      // Attach to block's provenance as _meta (non-contractual debug field)
      (block.provenance as unknown as Record<string, unknown>)._meta = debugMeta;
    }

    // Build deterministic applied-changes receipt from actual ops + analysis presence.
    // rerun_recommended is derived from ops (edge/value/structural = true, label-only = false)
    // and whether prior analysis exists — not from LLM coaching output.
    const hasExistingAnalysis = !!context.analysis_response;
    // Phase 2a step 3: thread BOTH pre- and post-edit graphs into label
    // resolution. The PRIMARY lookup uses the **post-edit** graph
    // (`appliedGraph` if PLoT supplied one, otherwise the local
    // `candidateGraph`). The post-edit graph is right for the dominant
    // case (add / update / edge ops where the entity is in the post-edit
    // graph and post-edit labels are the canonical user-facing strings
    // including renames). The **pre-edit** graph (`context.graph`) is the
    // FALLBACK consulted by `resolveElementLabel` when the post-edit
    // lookup misses — the specific shape that fixes `remove_node`:
    // the removed entity is no longer in the post-edit graph, so without
    // the pre-edit fallback the label resolution drops to the raw path
    // and the downstream sanitiser collapses it to "the relevant
    // factor". Either source may be missing in degenerate paths —
    // null-safe.
    const preGraphForReceipt = (context.graph ?? null) as GraphV3T | null;
    const postGraphForReceipt = (appliedGraph ?? candidateGraph ?? context.graph) as GraphV3T;
    const appliedChangesReceipt = buildAppliedChanges(
      operations,
      postGraphForReceipt,
      hasExistingAnalysis,
      preGraphForReceipt,
    );

    log.info(
      {
        elapsed_ms: latencyMs,
        operations_count: operations.length,
        attempts: attempt,
        plot_validated: !!plotClient,
        repairs_applied: repairsApplied?.length ?? 0,
        applied_graph_hash: appliedGraphHash,
        has_coaching: !!llmResult.coaching,
        rerun_recommended: appliedChangesReceipt.rerun_recommended,
        ...(promptMeta && {
          prompt_source: promptMeta.source,
          prompt_version: promptMeta.prompt_version,
        }),
      },
      "edit_graph completed",
    );

    // Build assistant text: coaching.summary preferred, warnings appended.
    //
    // Layer 1 entity-ID leak guard: every string composed into `textParts`
    // here is LLM- or PLoT-generated and may reference entity IDs by their
    // raw slug (e.g. `fac_delivery_cost`). We scrub each fragment via the
    // V5 egress sanitiser, preferring the post-mutation `appliedGraph` for
    // label resolution and falling back to `context.graph` (pre-mutation,
    // same source `buildPatchSummary` uses) and finally to prefix-aware
    // generic wording. Output safety is about the output, not the
    // provenance — PLoT-generated repair `reason` strings are scrubbed too.
    //
    // Telemetry asymmetry (intentional): Layer 1 logs the raw leaked ID
    // here for triage. Layer 2 (output-safety.ts central scan) logs only
    // the prefix type, never the raw ID. This is deliberate — Layer 1 is
    // internal observability for known-bug diagnosis; Layer 2 is the egress
    // boundary and must not surface raw user-visible IDs to log infra.
    const scrubGraph = appliedGraph ?? context.graph ?? null;
    const scrubFragment = (raw: string): string => {
      const r = sanitiseUserFacingText(raw, scrubGraph);
      if (r.matches.length > 0) {
        for (const m of r.matches) {
          log.info(
            {
              event: 'v5.internal_id_leak_caught',
              request_id: requestId,
              handler_id: 'edit_graph',
              prefix: m.prefix,
              resolution: m.resolved,
              // Layer 1 includes the raw text snippet for triage.
              snippet: raw.length > 240 ? raw.slice(0, 240) + '…' : raw,
            },
            'V5 edit_graph: entity-id leak caught at handler boundary',
          );
        }
      }
      return r.text;
    };

    let assistantText: string | null = null;
    const textParts: string[] = [];

    if (llmResult.coaching?.summary) {
      textParts.push(scrubFragment(llmResult.coaching.summary));
    }
    // P0 fix (2026-05): NEVER render PLoT repair / A5 enforcement reasons
    // into user-facing assistant_text. Repair `action` strings come from
    // operator-grade telemetry sources — e.g. graph-enforcement.ts:237
    // emits "Rescaled N causal inbound edges from sum=X.XXX to 1.0",
    // applyBudgetRescale / fixBridgeChaining / PLoT validators all emit
    // strings containing internal terminology like `|mean|`, `inbound`,
    // `sum=`, `bridge`, `BUDGET_TARGET`, `[INBOUND_BUDGET_RESCALED]`.
    // These leaked into the chat surface and the existing entity-ID
    // scrubFragment did NOT catch them (it only matches node/edge ID
    // prefixes, not internal vocabulary).
    //
    // Operators retain full repair signal via:
    //   - PLoT structured logs (CeeEnforcementApplied telemetry events).
    //   - The `repairs_applied` field on the V4 GraphPatchBlock if the
    //     boundary block is emitted (success path).
    //   - The `x-cee-failure-cause` response header on rejections.
    //   - V5 EditGraphResult.diagnostics stays unchanged.
    //
    // The previous narration block:
    //   `PLoT applied ${N} repair(s) to ensure semantic consistency:\n
    //    - [CODE] reason\n - ...`
    // is dropped. If repairs are applied, the user sees coaching.summary
    // (LLM-generated, scrubbed) plus optional warnings (also scrubbed).
    // No user-facing surface needs the operator-language detail.
    if (llmResult.warnings.length > 0) {
      textParts.push(`Note: ${scrubFragment(llmResult.warnings.join(' '))}`);
    }

    if (textParts.length > 0) {
      assistantText = textParts.join('\n\n');
    }

    // P1 fix (2026-05): final defence-in-depth pass against repair /
    // enforcement vocabulary leaking into user-facing prose. Sources
    // already targeted upstream (the removed PLoT-narration block at
    // 2337, scrubFragment for entity IDs) — this catches anything that
    // slipped through, including LLM-generated coaching.summary or
    // warnings that echo prompt vocabulary like `inbound`, `sum=`,
    // `bridge`, `BUDGET_TARGET`, `[INBOUND_*]`, `Σ`. Replacements are
    // counted and logged so dashboards observe the rate; a non-zero
    // rate signals upstream prompt drift.
    if (assistantText) {
      const denylistResult = enforceRepairVocabularyDenylist(assistantText);
      if (denylistResult.replacements > 0) {
        log.warn(
          {
            event: 'edit_graph.assistant_text_repair_vocabulary_redacted',
            request_id: requestId,
            replacement_count: denylistResult.replacements,
            // Length only — never log the raw text (which may still
            // contain the banned tokens before scrubbing).
            text_length_before: assistantText.length,
            text_length_after: denylistResult.text.length,
          },
          'edit_graph: repair vocabulary scrubbed from assistant_text',
        );
        assistantText = denylistResult.text;
      }
    }

    // T5: proposal-language guard. edit_graph's GraphPatchBlock always
    // reports auto_apply: false (block-shape contract, unrelated to whether
    // the graph was actually committed — see GraphPatchBlockData docs), so
    // `auto_apply === false` alone does NOT mean "not yet applied." This
    // success branch is unreachable without a real `appliedGraph` (guarded
    // above — "cannot reach success branch without appliedGraph"), i.e. the
    // change IS already committed here. Gate on that so the guard only
    // rewrites genuine pending-proposal narration (e.g. the no-op /
    // low-confidence branches) — never truthful "Added X" / "I've added X"
    // language on a turn that actually applied the edit (F3 — GM go-live
    // acceptance evidence: applied+committed edit_graph turns were being
    // mislabelled "Proposing to…", violating the four-state copy rule).
    if (patchData.auto_apply === false && !appliedGraph && assistantText) {
      const guardResult = enforceProposalLanguage(assistantText, 'edit_graph');
      if (guardResult.leaked && guardResult.suffixed) {
        assistantText = guardResult.suffixed;
      }
    }

    // Build suggested actions: "Re-run analysis" chip driven by deterministic rerun_recommended
    const suggestedActions: EditGraphResult['suggestedActions'] = [];
    if (appliedChangesReceipt.rerun_recommended) {
      suggestedActions.push({
        label: 'Re-run analysis',
        prompt: 'run the analysis again',
        role: 'facilitator',
      });
    }

    return {
      blocks: [block],
      assistantText,
      latencyMs,
      appliedGraph: appliedGraph ?? null,
      wasRejected: false,
      appliedChanges: appliedChangesReceipt,
      // Pass-through for the V5 edit-graph fact builder (DL-7 PR B).
      // Both fields are computed earlier in the success path; this just
      // surfaces them on the public result for downstream projection.
      operations,
      operation_meta: operationMeta,
      ...(suggestedActions.length > 0 && { suggestedActions }),
      diagnostics: diagnostics(),
      routeMetadata: routeMetadata(),
    };
  }

  // Should never reach here — final attempt returns rejection or throws
  const err: OrchestratorError = {
    code: 'TOOL_EXECUTION_FAILED',
    message: 'Edit graph exhausted all attempts without resolution.',
    tool: 'edit_graph',
    recoverable: true,
    suggested_retry: 'Try describing the edit again.',
  };
  throw Object.assign(new Error(err.message), { orchestratorError: err });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a rejection result when all repair attempts are exhausted.
 */
function buildRejectionResult(
  reason: string,
  operations: PatchOperation[],
  baseGraphHash: string,
  turnId: string,
  startTime: number,
  code?: string,
  plotDetails?: { plot_code?: string; plot_violations?: unknown[] },
  attempts?: number,
  diagnostics?: EditGraphTraceDiagnostics,
): EditGraphResult {
  const patchData: GraphPatchBlockData = {
    patch_type: 'edit',
    operations,
    status: 'rejected',
    base_graph_hash: baseGraphHash,
    rejection: {
      reason,
      ...(code && { code }),
      ...(plotDetails?.plot_code && { plot_code: plotDetails.plot_code }),
      ...(plotDetails?.plot_violations && plotDetails.plot_violations.length > 0 && { plot_violations: plotDetails.plot_violations }),
      ...(attempts != null && { attempts }),
    },
  };

  const block = createGraphPatchBlock(patchData, turnId, undefined, undefined, 'tool:edit_graph');
  const latencyMs = Date.now() - startTime;

  log.warn(
    { elapsed_ms: latencyMs, reason, code },
    "edit_graph rejected — all attempts exhausted",
  );

  // Never surface raw structural violation text to the user.
  // The raw reason is preserved in the block's rejection.reason for
  // debugging; the assistant text always gives a safe, actionable recovery
  // message via the centralised builder. Mapping (V5 A4 Commit 3):
  //   MAX_OPERATIONS_EXCEEDED       -> too_many_operations
  //   STRUCTURAL_VALIDATION_FAILED  -> structural_validation
  //   PLOT_SEMANTIC_REJECTED        -> structural_validation
  //   PLOT_UNAVAILABLE              -> structural_validation
  //   anything else                 -> structural_validation (safe default)
  const friendly = buildEditRejectionResponse(mapCodeToRejectionReason(code));

  return {
    blocks: [block],
    assistantText: friendly.assistantText,
    latencyMs,
    appliedGraph: null,
    wasRejected: true,
    suggestedActions: friendly.suggestedActions.length > 0 ? friendly.suggestedActions : undefined,
    diagnostics,
  };
}

function mapCodeToRejectionReason(code?: string): EditRejectionReason {
  switch (code) {
    case 'MAX_OPERATIONS_EXCEEDED':
      return 'too_many_operations';
    case 'STRUCTURAL_VALIDATION_FAILED':
    case 'PLOT_SEMANTIC_REJECTED':
    case 'PLOT_UNAVAILABLE':
      return 'structural_validation';
    default:
      return 'structural_validation';
  }
}

// ============================================================================
// Path Normalisation
// ============================================================================

/**
 * Normalise v2 prompt paths to the format expected by the patch validation pipeline.
 *
 * v2 prompt format → pipeline format:
 * - `/nodes/fac_x` → `fac_x`
 * - `/nodes/fac_x/label` → `fac_x` (field stored separately for update ops)
 * - `/edges/fac_a->out_b` → `fac_a::out_b`
 * - `/edges/fac_a->out_b/strength.mean` → `fac_a::out_b` (field stored separately)
 * - Already-normalised paths (no `/` prefix) pass through unchanged.
 */
function normalisePath(path: string): { path: string; field?: string } {
  // Already in pipeline format (no leading /)
  if (!path.startsWith('/')) {
    return { path };
  }

  // /edges/<from>-><to>[/<field>]
  const edgeMatch = path.match(/^\/edges\/([^/]+)->([^/]+)(?:\/(.+))?$/);
  if (edgeMatch) {
    return {
      path: `${edgeMatch[1]}::${edgeMatch[2]}`,
      field: edgeMatch[3],
    };
  }

  // /nodes/<id>[/<field>]
  const nodeMatch = path.match(/^\/nodes\/([^/]+)(?:\/(.+))?$/);
  if (nodeMatch) {
    return {
      path: nodeMatch[1],
      field: nodeMatch[2],
    };
  }

  // Unrecognised — pass through as-is
  return { path };
}

// ============================================================================
// Response Parsing (v2 object + legacy array)
// ============================================================================

/**
 * Extract JSON from LLM response text. Handles:
 * - Plain JSON (no wrapper)
 * - Markdown fenced code blocks (```json ... ```)
 * - Mixed text with embedded JSON
 */
function extractJson(text: string): unknown {
  // Strip markdown fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cleaned = fenceMatch ? fenceMatch[1].trim() : text.trim();

  // Try parsing the cleaned text directly
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through to regex extraction
  }

  // Try to extract a JSON object.
  //
  // Lane CEE-D (edit-loop reliability): the greedy object extraction MUST
  // NOT throw past the array fallback. A prose-wrapped legacy-array
  // response with 2+ operations mis-extracts `{op1}, {op2}` (first `{` →
  // last `}`), which is not valid JSON — previously the unguarded
  // JSON.parse here threw a SyntaxError and the array branch below was
  // never reached (live failure class: 2/3 LLM-path edit attempts failed).
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // Fall through to array extraction (legacy format).
    }
  }

  // Try to extract a JSON array (legacy format)
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    return JSON.parse(arrayMatch[0]);
  }

  throw new Error('No valid JSON found in LLM response');
}

/**
 * Parse the LLM response into an EditGraphLLMResult.
 *
 * Supports two formats:
 * 1. **v2 object**: `{ operations, removed_edges, warnings, coaching }`
 * 2. **Legacy array**: `[{ op, path, value, ... }, ...]` — backward compat with metric logging.
 *
 * Path normalisation is applied to all operations (v2 paths → pipeline paths).
 */
export function parseEditGraphResponse(text: string): EditGraphLLMResult {
  const parsed = extractJson(text);

  // Legacy array format detection
  if (Array.isArray(parsed)) {
    // Phase 2A — additive telemetry. The existing event is preserved
    // unchanged; downstream consumers (Datadog dashboards, Render saved
    // log filters, runbooks, alert queries) keep receiving it. The new
    // event is emitted alongside with the same structured metadata so
    // operators can migrate at their own pace. See DL-2 in
    // Docs/edit_graph_v9_deferred_items.md for the sunset protocol —
    // the old event MUST NOT be removed in this branch.
    //
    // Telemetry fires regardless of array length: an empty bare-array
    // is still a bare-array shape and operators may want the signal.
    const telemetryFields = { format: 'legacy_array', operations_count: parsed.length };
    log.info(telemetryFields, 'edit_graph.legacy_array_response');
    log.info(telemetryFields, 'edit_graph.legacy_array_wrapped');
    const normalised = (parsed as Array<Record<string, unknown>>).map(normaliseOperation);
    // Phase 2A — safe coaching defaults, gated on a non-empty array.
    //
    // The defaults exist to fix the success-path quality gap: when the
    // model emits a bare-array response with operations, the
    // success-path text builder at line ~2341 needs something to
    // render so assistantText isn't null. "Proposed graph edit." is
    // the safe fallback for that case.
    //
    // For an EMPTY bare-array (parsed.length === 0), the operations
    // are about to short-circuit through the empty-ops branch at
    // line ~1625 which has its own correct user-facing fallback:
    // "No changes were needed for this request." Populating coaching
    // here would leak "Proposed graph edit." into a no-op response
    // (misleading to the user — nothing was proposed). Keep
    // coaching=null on the empty case so the existing fallback fires.
    //
    // Test coverage: A5 (non-empty defaults), A8 (empty no-op text),
    // and A6 (jargon-free) in
    // tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts.
    const coaching: EditGraphCoaching | null = parsed.length > 0
      ? { summary: 'Proposed graph edit.', rerun_recommended: false }
      : null;
    return {
      operations: normalised,
      removed_edges: [],
      warnings: [],
      coaching,
    };
  }

  // v2 object format
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;

    // Validate required field
    if (!Array.isArray(obj.operations)) {
      // Lane CEE-D (edit-loop reliability): a BARE SINGLE-OPERATION object
      // — either emitted directly by the model, or produced by the greedy
      // object extraction mis-slicing the first op out of a prose-wrapped
      // single-op legacy array — previously died here with the live error
      // 'v2 response missing required "operations" array'. When the object
      // is unambiguously a patch operation (known `op` + string `path`),
      // wrap it into `operations: [op]` and continue. Same safe coaching
      // defaults as the legacy-array branch (non-empty ops case).
      if (isBareSinglePatchOp(obj)) {
        emit(TelemetryEvents.EditGraphBareSingleOpWrapped, {
          op: obj.op as string,
        });
        log.info(
          { event: 'edit_graph.bare_single_op_wrapped', op: obj.op },
          'edit_graph wrapped bare single-operation object into operations array',
        );
        return {
          operations: [normaliseOperation(obj)],
          removed_edges: [],
          warnings: [],
          coaching: { summary: 'Proposed graph edit.', rerun_recommended: false },
        };
      }
      throw new Error('v2 response missing required "operations" array');
    }

    const operations = (obj.operations as Array<Record<string, unknown>>).map(normaliseOperation);

    const removed_edges: RemovedEdgeInfo[] = Array.isArray(obj.removed_edges)
      ? (obj.removed_edges as RemovedEdgeInfo[])
      : [];

    const warnings: string[] = Array.isArray(obj.warnings)
      ? (obj.warnings as string[])
      : [];

    let coaching: EditGraphCoaching | null = null;
    if (obj.coaching && typeof obj.coaching === 'object') {
      const c = obj.coaching as Record<string, unknown>;
      coaching = {
        summary: typeof c.summary === 'string' ? c.summary : '',
        rerun_recommended: c.rerun_recommended === true,
      };
    }

    return { operations, removed_edges, warnings, coaching };
  }

  throw new Error('LLM response is neither an array nor an object');
}

// ============================================================================
// Dotted-Key Restructuring
// ============================================================================

/**
 * Known dotted keys that must be restructured into nested objects.
 * Only these explicit keys are handled — unknown dotted paths pass through
 * unchanged and fail explicitly at PLoT validation.
 */
const DOTTED_KEY_SEGMENTS: ReadonlyMap<string, readonly [string, string]> = new Map([
  ['strength.mean', ['strength', 'mean']],
  ['strength.std', ['strength', 'std']],
  ['prior.range_min', ['prior', 'range_min']],
  ['prior.range_max', ['prior', 'range_max']],
]);

/**
 * Restructure known dotted keys into nested objects for PLoT's canonical format.
 * e.g. `{ "strength.mean": -0.6 }` → `{ strength: { mean: -0.6 } }`
 *
 * Merges into existing nested objects when present.
 * @internal Exported for testing.
 */
export function nestDottedKeys(value: Record<string, unknown>): Record<string, unknown> {
  let result: Record<string, unknown> | undefined;

  for (const [dotted, [outer, inner]] of DOTTED_KEY_SEGMENTS) {
    if (!(dotted in value)) continue;

    if (!result) result = { ...value };
    const val = result[dotted];
    delete result[dotted];

    const existing = result[outer];
    if (existing && typeof existing === 'object') {
      result[outer] = { ...(existing as Record<string, unknown>), [inner]: val };
    } else {
      result[outer] = { [inner]: val };
    }

    log.info(
      { event: 'edit_graph.dotted_key_nested', field_from: dotted, field_to: `${outer}.${inner}` },
      `edit_graph restructured dotted key: ${dotted} → ${outer}.${inner}`,
    );
  }

  return result ?? value;
}

/** Ops whose Zod schemas require a `value` payload. */
const VALUE_REQUIRING_OPS: ReadonlySet<string> = new Set([
  'add_node',
  'update_node',
  'add_edge',
  'update_edge',
]);

/** The full operation vocabulary (mirrors PatchOperation.op / _PatchOp). */
const KNOWN_PATCH_OPS: ReadonlySet<string> = new Set([
  'add_node',
  'remove_node',
  'update_node',
  'add_edge',
  'remove_edge',
  'update_edge',
]);

/**
 * Keys that belong to the OPERATION envelope, not the payload. Everything
 * else on a raw op object is candidate inline payload.
 */
const RESERVED_OP_KEYS: ReadonlySet<string> = new Set([
  'op',
  'path',
  'value',
  'old_value',
  'impact',
  'rationale',
]);

/**
 * Alternate keys models have used in place of `value`. Checked in
 * declaration order; a lift only happens when EXACTLY ONE is present
 * (ambiguity → leave the op alone and let Zod reject it into the repair
 * loop).
 */
const ALTERNATE_VALUE_KEYS: readonly string[] = [
  'new_value',
  'newValue',
  'updated_value',
  'updatedValue',
  'data',
  'payload',
  'node',
  'edge',
  'fields',
  'updates',
  'properties',
  'changes',
];

/**
 * Lane CEE-D (edit-loop reliability): a bare single-operation object —
 * `{ op, path, ... }` with a known op — is unambiguously a patch
 * operation, not a malformed v2 envelope. Used by parseEditGraphResponse
 * to wrap it into `operations: [op]` instead of failing with the live
 * 'v2 response missing required "operations" array' error.
 */
function isBareSinglePatchOp(obj: Record<string, unknown>): boolean {
  return (
    typeof obj.op === 'string' &&
    KNOWN_PATCH_OPS.has(obj.op) &&
    typeof obj.path === 'string' &&
    obj.path.length > 0
  );
}

/**
 * Lane CEE-D (edit-loop reliability): lift inline / alternate-key payloads
 * into `value` for value-requiring ops (add_node / update_node / add_edge /
 * update_edge) where the payload location is UNAMBIGUOUS. Live failure:
 * PatchOperationSchema requires `value` for these ops, but models sometimes
 * put the payload under an alternate key (`new_value`, `data`, …) or inline
 * at the top level of the op object — producing the zod 'value — Required'
 * rejection and burning repair attempts.
 *
 * Lift rules (each lift is logged):
 *   1. EXACTLY ONE alternate key present → lift its value into `value`.
 *   2. NO alternate key, but non-reserved top-level keys present → lift
 *      those keys as an inline payload record.
 *   3. Anything ambiguous (2+ alternate keys) or absent → return the op
 *      unchanged; Zod rejects it into the existing repair loop.
 */
function liftAlternateValuePayload(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.value !== undefined) return raw;
  const op = raw.op;
  if (typeof op !== 'string' || !VALUE_REQUIRING_OPS.has(op)) return raw;

  const presentAlternates = ALTERNATE_VALUE_KEYS.filter((k) => raw[k] !== undefined);
  if (presentAlternates.length === 1) {
    const key = presentAlternates[0]!;
    const lifted: Record<string, unknown> = { ...raw, value: raw[key] };
    delete lifted[key];
    log.info(
      { event: 'edit_graph.value_lifted', op, source: 'alternate_key', alternate_key: key },
      `edit_graph lifted alternate-key payload "${key}" into value for ${op}`,
    );
    return lifted;
  }
  if (presentAlternates.length > 1) return raw; // ambiguous — leave for Zod + repair

  const inlineKeys = Object.keys(raw).filter(
    (k) => !RESERVED_OP_KEYS.has(k) && raw[k] !== undefined,
  );
  if (inlineKeys.length > 0) {
    const payload: Record<string, unknown> = {};
    for (const k of inlineKeys) payload[k] = raw[k];
    const lifted: Record<string, unknown> = {};
    for (const k of Object.keys(raw)) {
      if (RESERVED_OP_KEYS.has(k)) lifted[k] = raw[k];
    }
    lifted.value = payload;
    log.info(
      { event: 'edit_graph.value_lifted', op, source: 'inline_payload', field_count: inlineKeys.length },
      `edit_graph lifted ${inlineKeys.length} inline payload field(s) into value for ${op}`,
    );
    return lifted;
  }

  return raw;
}

/**
 * Tier A #1 (edit-reliability, 2026-07-09): unwrap the v2 structured-outputs
 * stringified `value` / `old_value` fields (see GRAMMAR BUDGET (v2) in
 * anthropic-edit-graph-schema.ts) back into their real shape — object,
 * scalar, or array — before any downstream consumer (alternate-key lifting,
 * dotted-key restructuring, Zod) sees the field.
 *
 * Only touches a field that IS a string. `parseEditGraphResponse` has no
 * reliable signal telling it whether THIS particular response came from a
 * structured-outputs call or the prompt-only fallback (the adapter can fall
 * back mid-call on a 400), so this function must not assume either mode —
 * it treats a successful `JSON.parse` as proof-positive of the v2
 * stringified-payload shape and leaves anything else untouched:
 *
 * - Structured mode: `value: "\"New\""` (JSON-encoded string) parses to the
 *   scalar `"New"`. `value: "{\"id\":...}"` parses to the node/edge object.
 * - Prompt-only mode (existing, pre-Tier-A#1 convention): `value: "New"` is
 *   already the real scalar — `JSON.parse("New")` THROWS (bare text is not
 *   valid JSON), so the catch branch below leaves it as the string "New",
 *   IDENTICAL to today's behaviour. This is what makes the function safe to
 *   run unconditionally on every response, not just structured-mode ones.
 *
 * On parse failure the field is left EXACTLY as received (never deleted) —
 * deleting would silently break the prompt-only path's long-standing
 * bare-scalar convention (e.g. a plain label rename), which is the dominant
 * case today. A field that was genuinely meant as a stringified object/array
 * (starts with `{`/`[`) but fails to parse still surfaces a warning for
 * observability; Zod naturally rejects the wrong-shaped string downstream
 * and drives the repair loop exactly as an omitted field would — enforcement
 * is never worse than the status-quo prompt-only path.
 *
 * Deliberately does NOT apply the "unwrap one extra layer" double-encoding
 * heuristic that `parseStringifiedAuxFields()` (adapters/llm/normalisation.ts,
 * Lane 26) uses for coaching/causal_claims/topology_plan — those aux fields
 * are ALWAYS objects/arrays, so a first-pass string result unambiguously
 * means double-encoding. `value`/`old_value` can legitimately END in a bare
 * string scalar (e.g. renaming a label to "Unit Price"), so a second parse
 * pass would wrongly shred a valid string payload.
 *
 * @internal Exported for testing.
 */
export function parseStringifiedOperationPayload(rawInput: Record<string, unknown>): Record<string, unknown> {
  if (typeof rawInput.value !== 'string' && typeof rawInput.old_value !== 'string') {
    return rawInput;
  }
  const result = { ...rawInput };
  for (const key of ['value', 'old_value'] as const) {
    const raw = result[key];
    if (typeof raw !== 'string') continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      result[key] = parsed;
      log.info(
        { event: 'edit_graph.stringified_payload_parsed', field: key, op: result.op },
        `edit_graph parsed stringified JSON "${key}" field`,
      );
    } catch (err) {
      // Leave the field UNTOUCHED — this is either the prompt-only path's
      // ordinary bare-scalar convention (the common case; no signal here),
      // or a genuinely malformed structured-mode encoding (Zod will reject
      // it downstream and drive the repair loop either way).
      const looksLikeIntendedPayload = raw.length > 0 && (raw[0] === '{' || raw[0] === '[');
      if (looksLikeIntendedPayload) {
        log.warn(
          {
            event: 'edit_graph.stringified_payload_parse_failed',
            field: key,
            op: result.op,
            error: err instanceof Error ? err.message : String(err),
            raw_preview: raw.slice(0, 120),
          },
          `edit_graph "${key}" field looked like a stringified object/array but was not valid JSON — left as-is; Zod will reject it and the repair loop takes over`,
        );
      }
    }
  }
  return result;
}

const VALID_FACTOR_CATEGORIES: ReadonlySet<string> = new Set(FactorCategoryV3.options);

/**
 * ROADMAP 1.46 residual (task_97fbcb00) — the edit LLM can synthesise a
 * node `category` value outside GraphV3's enum (e.g. "strategic"), which
 * previously survived normalisation unchanged and failed the WHOLE edit
 * at the final `GraphV3.safeParse` gate with SYNTHESIZED_GRAPH_INVALID —
 * despite an otherwise well-formed op.
 *
 * Two-layer defence:
 *   1. Constrained-at-source: `anthropic-edit-graph-schema.ts` declares a
 *      real, grammar-enforced `category` enum directly on the operation
 *      (a small side-channel next to the opaque stringified `value`
 *      blob the grammar cannot look inside). When the model uses it, the
 *      model literally cannot emit an invalid value — this wins over
 *      whatever `value` may separately carry.
 *   2. Coerced-with-disclosure: for the residual case where the model
 *      still writes an out-of-enum `category` INSIDE the un-grammar-
 *      checked `value` string, drop it rather than fail the entire edit
 *      over one bad enum value — `category` is optional on GraphV3's
 *      factor-node schema, so a node without it is still valid. Logged
 *      at WARN so the drop is never silent.
 *
 * @internal Exported for testing.
 */
export function resolveNodeCategoryForOp(
  raw: Record<string, unknown>,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const structuredCategory = raw.category;
  if (typeof structuredCategory === 'string' && VALID_FACTOR_CATEGORIES.has(structuredCategory)) {
    return { ...value, category: structuredCategory };
  }
  if (typeof value.category === 'string' && !VALID_FACTOR_CATEGORIES.has(value.category)) {
    const { category: invalidCategory, ...rest } = value;
    log.warn(
      {
        event: 'edit_graph.invalid_category_coerced',
        op: raw.op,
        path: raw.path,
        invalid_category: invalidCategory,
      },
      'edit_graph dropped an out-of-enum node category from the stringified value payload rather than failing the whole edit',
    );
    return rest;
  }
  return value;
}

/**
 * Normalise a single raw operation from the LLM:
 * - Unwrap v2 structured-outputs stringified value/old_value fields
 * - Lift inline / alternate-key payloads into `value` (value-requiring ops)
 * - Convert v2 paths to pipeline format
 * - Restructure dotted keys (strength.mean → nested) for canonical format
 * - Preserve impact/rationale as extra fields (stripped later)
 */
function normaliseOperation(rawInput: Record<string, unknown>): PatchOperation & { impact?: string; rationale?: string } {
  const raw = liftAlternateValuePayload(parseStringifiedOperationPayload(rawInput));
  const { path: normalisedPath, field } = normalisePath(String(raw.path ?? ''));

  let value = raw.value as unknown;
  let oldValue = raw.old_value;

  // For field-level update ops (path had /field suffix), wrap scalar value into { field: value }
  // so the Zod update schemas (which expect a record) validate correctly.
  if (field && (raw.op === 'update_node' || raw.op === 'update_edge')) {
    if (value !== undefined && (typeof value !== 'object' || value === null)) {
      value = { [field]: value };
    }
    if (oldValue !== undefined && (typeof oldValue !== 'object' || oldValue === null)) {
      oldValue = { [field]: oldValue };
    }
  }

  // Restructure dotted keys into nested objects for canonical format.
  // e.g. { "strength.mean": -0.6 } → { strength: { mean: -0.6 } }
  if (value && typeof value === 'object' && value !== null) {
    value = nestDottedKeys(value as Record<string, unknown>);
  }
  if (oldValue && typeof oldValue === 'object' && oldValue !== null) {
    oldValue = nestDottedKeys(oldValue as Record<string, unknown>);
  }

  // ROADMAP 1.46 residual (task_97fbcb00) — see resolveNodeCategoryForOp doc.
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (raw.op === 'add_node' || raw.op === 'update_node')
  ) {
    value = resolveNodeCategoryForOp(raw, value as Record<string, unknown>);
  }

  return {
    op: raw.op as PatchOperation['op'],
    path: normalisedPath,
    ...(value !== undefined && { value }),
    ...(oldValue !== undefined && { old_value: oldValue }),
    ...(typeof raw.impact === 'string' && { impact: raw.impact }),
    ...(typeof raw.rationale === 'string' && { rationale: raw.rationale }),
  };
}

/**
 * Strip impact and rationale from operations, returning clean PatchOperations
 * and a parallel array of per-operation metadata.
 */
function stripOperationMeta(
  ops: Array<PatchOperation & { impact?: string; rationale?: string }>,
): { operations: PatchOperation[]; meta: EditGraphOperationMeta[] } {
  const operations: PatchOperation[] = [];
  const meta: EditGraphOperationMeta[] = [];

  for (const op of ops) {
    const { impact, rationale, ...cleanOp } = op as PatchOperation & { impact?: string; rationale?: string };
    operations.push(cleanOp);
    meta.push({
      impact: (impact as EditGraphOperationMeta['impact']) ?? 'low',
      rationale: rationale ?? '',
    });
  }

  return { operations, meta };
}

// ============================================================================
// Intervention Update Extraction (M5)
// ============================================================================

/**
 * Scan operations for intervention-related data on option nodes and extract
 * a flat `{ option_id, factor_id, value }` array for downstream consumers.
 *
 * Checks both `update_node` and `add_node` operations targeting `opt_*` paths.
 * Reads interventions from:
 * 1. `value.data.interventions` — nested prompt-taught location
 * 2. `value.interventions` — top-level passthrough location
 * 3. Slash-keyed flat entries (`data/interventions/fac_*`)
 *
 * @internal Exported for testing.
 */
export function extractInterventionUpdates(
  operations: PatchOperation[],
): Array<{ option_id: string; factor_id: string; value: number }> {
  const updates: Array<{ option_id: string; factor_id: string; value: number }> = [];
  const seen = new Set<string>(); // deduplicate by "optionId::factorId"

  for (const op of operations) {
    const isOptionOp = (op.op === 'update_node' || op.op === 'add_node') && op.path?.startsWith('opt_');
    if (!isOptionOp) continue;
    if (!op.value || typeof op.value !== 'object') continue;

    const optionId = op.path;
    const value = op.value as Record<string, unknown>;

    const addUpdate = (facId: string, num: number): void => {
      const key = `${optionId}::${facId}`;
      if (seen.has(key)) return;
      seen.add(key);
      updates.push({ option_id: optionId, factor_id: facId, value: num });
    };

    const extractNum = (intv: unknown): number | undefined => {
      if (typeof intv === 'number') return intv;
      if (intv && typeof intv === 'object' && 'value' in intv) {
        const inner = (intv as Record<string, unknown>).value;
        if (typeof inner === 'number') return inner;
      }
      return undefined;
    };

    // Source 1: data.interventions nested structure
    const data = value.data;
    if (data && typeof data === 'object') {
      const interventions = (data as Record<string, unknown>).interventions;
      if (interventions && typeof interventions === 'object') {
        for (const [facId, intv] of Object.entries(interventions as Record<string, unknown>)) {
          const num = extractNum(intv);
          if (num !== undefined) addUpdate(facId, num);
        }
      }
    }

    // Source 2: top-level value.interventions
    if (value.interventions && typeof value.interventions === 'object') {
      for (const [facId, intv] of Object.entries(value.interventions as Record<string, unknown>)) {
        const num = extractNum(intv);
        if (num !== undefined) addUpdate(facId, num);
      }
    }

    // Source 3: slash-keyed flat entries
    for (const [k, v] of Object.entries(value)) {
      const match = k.match(/^data\/interventions\/(.+)$/);
      if (match) {
        const num = extractNum(v);
        if (num !== undefined) addUpdate(match[1], num);
      }
    }
  }

  if (updates.length > 0) {
    log.info(
      { event: 'edit_graph.intervention_updates_extracted', count: updates.length, updates },
      `edit_graph extracted ${updates.length} intervention update(s) from operations`,
    );
  }

  return updates;
}

// ============================================================================
// Patch Budget (cf-v11.1)
// ============================================================================

const MAX_NODE_OPS = 4;
const MAX_EDGE_OPS = 8;
/** Elevated edge budget for option-addition edits — adding an option naturally
 *  requires connecting to multiple factors, so the default 4-edge limit is too tight. */
const OPTION_ADD_MAX_EDGE_OPS = 8;

interface PatchBudgetResult {
  allowed: boolean;
  nodeOps: number;
  edgeOps: number;
  /** When option-addition is present, which limit was breached: 'incident' | 'unrelated' | 'node' | null */
  breachedLimit?: 'incident' | 'unrelated' | 'node' | null;
  /** The effective max edge ops that was applied for the breached category. */
  effectiveMaxEdgeOps?: number;
}

/**
 * Detect whether the operation set contains an option-addition (add_node with
 * kind 'option' or 'intervention'). These edits inherently require multiple
 * add_edge ops to wire the new option into the causal graph.
 */
export function hasOptionAddition(operations: PatchOperation[]): boolean {
  return operations.some((op) => {
    if (op.op !== 'add_node') return false;
    const value = op.value as Record<string, unknown> | undefined;
    if (!value || typeof value !== 'object') return false;
    const kind = value.kind as string | undefined;
    return kind === 'option' || kind === 'intervention';
  });
}

/**
 * Collect IDs of newly added option/intervention nodes.
 */
function collectNewOptionNodeIds(operations: PatchOperation[]): Set<string> {
  const ids = new Set<string>();
  for (const op of operations) {
    if (op.op !== 'add_node') continue;
    const value = op.value as Record<string, unknown> | undefined;
    if (!value || typeof value !== 'object') continue;
    const kind = value.kind as string | undefined;
    if (kind === 'option' || kind === 'intervention') {
      const id = value.id as string | undefined;
      if (id) ids.add(id);
    }
  }
  return ids;
}

/**
 * Check whether an edge operation is incident to one of the given node IDs.
 * Reads `from`/`to` from the operation's value, or parses the path as `from::to`.
 */
function isEdgeIncidentTo(op: PatchOperation, nodeIds: Set<string>): boolean {
  const value = op.value as Record<string, unknown> | undefined;
  const from = (value?.from as string) ?? null;
  const to = (value?.to as string) ?? null;
  if (from && nodeIds.has(from)) return true;
  if (to && nodeIds.has(to)) return true;
  // Fallback: parse path (format: "from::to")
  if (typeof op.path === 'string' && op.path.includes('::')) {
    const [pFrom, pTo] = op.path.split('::');
    if (nodeIds.has(pFrom) || nodeIds.has(pTo)) return true;
  }
  return false;
}

/**
 * Check whether a set of operations fits within the complexity budget.
 *
 * Classification:
 * - add_node, remove_node, update_node → node op
 * - add_edge, remove_edge, update_edge → edge op
 *
 * Implicit edge removals from remove_node do NOT count.
 *
 * When the operation set includes an option-addition (add_node with kind
 * 'option'/'intervention'), edge ops incident to the new option node(s) are
 * budgeted at the elevated OPTION_ADD_MAX_EDGE_OPS limit, while unrelated
 * edge ops stay under the standard MAX_EDGE_OPS cap. This prevents the
 * elevated budget from masking unrelated high-impact edge rewires.
 */
export function checkPatchBudget(operations: PatchOperation[]): PatchBudgetResult {
  let nodeOps = 0;
  let edgeOps = 0;

  const newOptionIds = collectNewOptionNodeIds(operations);
  const hasOptionAdd = newOptionIds.size > 0;
  let incidentEdgeOps = 0;
  let unrelatedEdgeOps = 0;

  for (const op of operations) {
    switch (op.op) {
      case 'add_node':
      case 'remove_node':
      case 'update_node':
        nodeOps++;
        break;
      case 'add_edge':
      case 'remove_edge':
      case 'update_edge':
        edgeOps++;
        if (hasOptionAdd) {
          if (isEdgeIncidentTo(op, newOptionIds)) {
            incidentEdgeOps++;
          } else {
            unrelatedEdgeOps++;
          }
        }
        break;
    }
  }

  // When option-addition is present, split budget: incident edges get elevated cap,
  // unrelated edges keep the standard cap. Both must pass independently.
  const nodeAllowed = nodeOps <= MAX_NODE_OPS;
  let edgeAllowed: boolean;
  let breachedLimit: PatchBudgetResult['breachedLimit'] = null;
  let effectiveMaxEdgeOps = MAX_EDGE_OPS;

  if (hasOptionAdd) {
    const incidentOk = incidentEdgeOps <= OPTION_ADD_MAX_EDGE_OPS;
    const unrelatedOk = unrelatedEdgeOps <= MAX_EDGE_OPS;
    edgeAllowed = incidentOk && unrelatedOk;
    if (!incidentOk) {
      breachedLimit = 'incident';
      effectiveMaxEdgeOps = OPTION_ADD_MAX_EDGE_OPS;
    } else if (!unrelatedOk) {
      breachedLimit = 'unrelated';
      effectiveMaxEdgeOps = MAX_EDGE_OPS;
    }
  } else {
    edgeAllowed = edgeOps <= MAX_EDGE_OPS;
  }

  if (!nodeAllowed && !breachedLimit) {
    breachedLimit = 'node';
  }

  return {
    allowed: nodeAllowed && edgeAllowed,
    nodeOps,
    edgeOps,
    breachedLimit,
    effectiveMaxEdgeOps,
  };
}

/**
 * Remove no-op operations (where value deeply equals old_value).
 *
 * Uses recursive structural equality — not JSON.stringify (key order is not guaranteed).
 * Operations without old_value are kept (safe default).
 */
export function stripNoOps(operations: PatchOperation[]): PatchOperation[] {
  return operations.filter((op) => {
    if (op.old_value === undefined) return true;
    if (op.value === undefined) return true;
    return !deepEqual(op.value, op.old_value);
  });
}

/**
 * Simple recursive structural equality for JSON-compatible values.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a !== 'object') return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, (b as unknown[])[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every((key) => key in bObj && deepEqual(aObj[key], bObj[key]));
}
