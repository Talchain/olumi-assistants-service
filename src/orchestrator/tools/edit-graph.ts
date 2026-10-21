/** Shared edit helpers retained for held-card and canvas writers. The retired natural-language executor has been removed. */
import { createHash } from "node:crypto";
import { log, emit, TelemetryEvents } from "../../utils/telemetry.js";
import { config } from "../../config/index.js";
// ROADMAP 2.474 / A3 — ONE definition of the complexity budget, shared with the
// structural-edit batch splitter (see patch-budget-limits.ts for why).
import { MAX_NODE_OPS, MAX_EDGE_OPS, OPTION_ADD_MAX_EDGE_OPS, type PatchBudgetDimension } from "./patch-budget-limits.js";
import { FactorCategoryV3 } from "../../schemas/cee-v3.js";
import type { TypedConversationBlock, ConversationContext, GraphV3T, PendingClarificationState, PendingProposalState, PatchOperation, ProposedChangesPayload, SuggestedAction, AppliedChanges, AppliedChangeItem } from "../types.js";
import type { RouteMetadata } from "../pipeline/types.js";
import type { PLoTClient, PLoTClientRunOpts } from "../plot-client.js";
// Value imports: `classifyPlotFailureCode` discriminates on these CLASSES.
// Binding by class identity rather than by message text is deliberate — a
// substring predicate over an error message is exactly the kind of guard this
// estate has repeatedly shipped too wide (CLAUDE.md trap 22).
import { PLoTError, PLoTTimeoutError } from "../plot-client.js";
import { classifyUserIntent } from "../pipeline/phase1-enrichment/intent-classifier.js";
import { detectLabelValueDivergences, buildLabelValueDivergenceDescription, type LabelValueDivergence } from "../../orchestrator-v5/label-value-divergence.js";
import { detectStatedLevelDivergences, buildStatedLevelDivergenceDescription, type StatedLevelDivergence } from "../../orchestrator-v5/stated-level-divergence.js";
import { TOKEN_OVERLAP_STOPWORDS, hasTokenOverlap } from "./token-overlap.js";
import { STRUCTURAL_EDGE_DEFAULTS } from "../context/constants.js";


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
   * ROADMAP 2.1003 — "did the user-meaningful model actually move?"
   *
   * `true`  — a graph was applied and it is IDENTICAL to the pre-edit graph
   *           (the measured identical-replay case: PLoT applied one operation,
   *           the graph did not move, and the product said "Applied edit").
   * `false` — the model moved.
   * `undefined` — no verdict available (no applied graph, or no pre-edit
   *           graph). A GUESS IS NOT A VERDICT: consumers must not render
   *           "no change" copy from `undefined`.
   *
   * ⚠ TRAP 21 — this is NOT `isSuccessfulAppliedMutation` and must never be
   * folded into it. That predicate answers "is there a graph to commit?" and
   * has 12+ readers (persistence, analysis_ready, fact emission, the GM gate).
   * This one answers "did anything change?" and is consumed ONLY by the
   * confirmation copy, the turn event, and the edit fact summary.
   */
  modelUnchanged?: boolean;
  /**
   * ROADMAP 2.1003 — ids of nodes whose `display_value` was recomputed or
   * cleared because this edit moved their observed state. Content-free count
   * only reaches telemetry; the ids are here for the receipt/diagnostics.
   */
  displayAnchorsRepaired?: string[];
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
  /**
   * ROADMAP 2.474 / AMENDMENT A1 — THE SINGLE ENTRY SEAM for an
   * externally-composed batch (today: the coach's `propose_structural_edit`
   * tool, after its grounding validator has accepted the batch WHOLE).
   *
   * When present, this handler SKIPS ITS OWN COMPOSITION — no edit_graph LLM
   * call, no parse — and runs the batch down the IDENTICAL downstream train:
   * field normalisation, structural-edge defaults, Zod validation, the PLoT
   * semantic gate, apply, receipts. Everything after composition is shared
   * byte-for-byte with the deterministic path, which is the whole point: a
   * tool that reached the graph through its own applier would be a second
   * referee↔applier agreement surface, i.e. 2.380's parity defect built on
   * purpose. There is one applier, one gate, one commit.
   *
   * REPAIR IS DISABLED on this path. The composer's contract is
   * reject-don't-repair: a batch that fails validation here is a batch the
   * grounding validator already accepted, so a repair round would be the
   * pipeline arguing with a decision that was already made against the
   * persisted graph. It fails honestly instead.
   */
  preComposedOperations?: readonly PatchOperation[];
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
  /**
   * ROADMAP 2.1003 — set when the resolution came from the TOKEN-OVERLAP arm,
   * i.e. a fuzzy match that reports itself as `exact_label` at `high`
   * confidence although nothing exact happened. Deliberately a separate field
   * rather than a demotion of `confidence`: `confidence === 'high'` is also
   * read by `buildProposedChanges` for compound-label protection, and
   * rewriting a shared field to reach one consumer is the trap-21 defect.
   *
   * Exactly one reader: `determineEditResolutionMode`, which demotes to
   * `propose_and_confirm` (consent, not refusal) so a heuristically picked
   * entity is named to the user before anything is written.
   */
  heuristic_match?: true;
  /**
   * REVIEW-573 C-1 — set when `preferOptionTargetForOptionConfiguration`
   * REDIRECTED the resolution to a single named option over a wider match
   * set. The preference is a text heuristic that is blind to negation and
   * to whether the configure/option vocabulary actually GOVERNS the option
   * ("…the configuration of Cloud-Native CRM shouldn't change" still
   * resolves the option). `determineEditResolutionMode` therefore demotes
   * flagged resolutions out of auto-apply eligibility: the held-proposal
   * consent flow makes a wrong-entity pick visible and declinable instead
   * of silently written.
   */
  option_target_preferred?: boolean;
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
  /**
   * Served-prompt identity for this edit call, bound to the bytes actually
   * sent: content and meta come from ONE `getSystemPromptSnapshot('edit_graph')`
   * resolution, which asserts `entry.promptHash === sha256(content)`. Consumed
   * by `extractEditLlmCallTelemetry` so an edit turn's `_diagnostic_trace` can
   * say WHICH PROMPT VERSION produced the edit.
   *
   * SCOPE: the INITIAL `edit_graph` resolution ONLY. Repair attempts are
   * served by `repair_edit_graph` and report their own identity in the
   * `repair_prompt_*` fields below.
   *
   * All three stay `undefined` on the deterministic (no-LLM) exits, which
   * return before the prompt is resolved at all, and `prompt_hash` is also
   * `undefined` on a loader cache miss — an honest absence, never a
   * fabricated digest.
   */
  prompt_hash?: string;
  prompt_version?: string;
  prompt_source?: string;
  /**
   * Served-prompt identity for the REPAIR attempts, bound the same way as the
   * initial edit identity: content and meta come from ONE
   * `getSystemPromptSnapshot('repair_edit_graph')` resolution, whose bytes are
   * the bytes actually sent on the repair call.
   *
   * WHY THIS EXISTS. `repair_attempts` and `stop_reason` update PER ATTEMPT
   * while the edit identity is captured ONCE, before the loop — so on
   * `repair_attempts > 0` a consumer reading `prompt_hash` alongside
   * `stop_reason` was pairing the INITIAL call's prompt with the LAST
   * attempt's outcome. Not a fabrication, but an active misattribution: it
   * sends anyone debugging a bad edit to change the wrong prompt.
   *
   * `undefined` when no repair ran, and also when a repair ran but the
   * snapshot could not be resolved — those two are distinguished by
   * `repair_attempts`. Never back-filled from `prompt_hash`: reusing the edit
   * prompt's digest here would restate the very untruth these fields remove.
   */
  repair_prompt_hash?: string;
  repair_prompt_version?: string;
  repair_prompt_source?: string;
}


/**
 * ROADMAP 2.1003 — does the message carry an EXPLICIT structural verb?
 *
 * `classifyEditIntent` returns `'structural'` from two very different places:
 * this predicate firing, and the FINAL `return 'structural'` — the DEFAULT
 * taken when a message is neither recognisably option-configuration nor
 * recognisably a value update. Those are different facts wearing one name
 * (trap 21), and `determineEditResolutionMode` unconditionally auto-applies
 * both.
 *
 * Measured by execution at `6b8698a4`: "Change the Salesforce annual licence
 * fee to £30,000" reaches the DEFAULT, because `hasValueTarget` is a
 * hand-maintained vocabulary (`cost|price|pay|churn|percent|%|…`) that does
 * not contain "fee". An ordinary value edit whose noun is outside the
 * vocabulary is therefore classified structural by fallthrough and
 * auto-applies with no confidence, compound or low-impact check ever running.
 *
 * Exposed so the resolution-mode gate can tell the two apart. It does NOT
 * change `classifyEditIntent`'s output — widening that vocabulary is a
 * natural-language predicate change that needs a corpus from outside the
 * author's head (trap 22) and is handed back, not attempted here.
 */
export function hasExplicitStructuralVerb(editDescription: string): boolean {
  return STRUCTURAL_VERB_RE.test(editDescription.toLowerCase());
}


const STRUCTURAL_VERB_RE = /\b(add node|remove node|delete node|add edge|remove edge|delete edge|connect|disconnect|link|unlink|rewire|restructure|replace|insert|create|new factor|new outcome|new risk|new option|add (?:a |an )?(?:new )?(?:[a-z0-9_-]+\s+){0,2}(?:factor|outcome|risk|option|node|edge))\b/;


export function classifyEditIntent(editDescription: string): EditIntentCategory {
  const message = editDescription.toLowerCase();
  const hasStructuralVerb = STRUCTURAL_VERB_RE.test(message);
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


/**
 * POC-BOARD 5c (Step-0 capture T12b, 2026-07-17) — option-configuration
 * target preference. An option-configuration edit names the OPTION being
 * configured AND the factors whose intervention values it sets:
 * "Configure the Cloud-Native CRM option: set CRM Feature Depth to 0.7,
 * set CRM Platform Cost to 0.55." Treating every matched label as a
 * competing TARGET made this ambiguous, and the clarifier asked "Which
 * option should I update: CRM Feature Depth or CRM Platform Cost or
 * Cloud-Native CRM?" — offering FACTORS as options. Live dead-end: the
 * user answered the option and looped.
 *
 * Doctrine: in an option-configuration edit, factor labels are the FIELDS
 * being configured, never candidate targets. Exactly one matched option →
 * it IS the target (high confidence). Several matched options → still
 * ambiguous, but the alternatives list contains ONLY options.
 *
 * Fires for `option_configuration` intent, and for `parameter_update`
 * carrying explicit configure vocabulary (T12 names the option by label
 * without the word "option", so `classifyEditIntent` cannot see the
 * category — the graph-aware resolver can). NEVER fires for `structural`
 * intent: an add-option request that mentions an existing option must not
 * snap to it.
 */
function preferOptionTargetForOptionConfiguration(
  editDescription: string,
  intentCategory: EditIntentCategory,
  matches: ResolvedEditTarget[],
): EditTargetResolutionResult | null {
  if (intentCategory === 'structural') return null;
  const isOptionConfigure =
    intentCategory === 'option_configuration'
    || /\bconfigur(?:e|es|ed|ing|ation)\b/i.test(editDescription);
  if (!isOptionConfigure) return null;
  const optionMatches = dedupeTargets(matches.filter((match) => match.type === 'option'));
  if (optionMatches.length === 0) return null;
  if (optionMatches.length === 1) {
    if (matches.length === 1) return null; // single match — default path is already right
    // REVIEW-573 C-1: flag the redirect so the mode decision demotes it out
    // of auto-apply eligibility (see `option_target_preferred` on the
    // interface). BOTH arms are flagged — the adversarial probes proved the
    // exposure is shared, not configure-vocab-specific: A5/A6 land via the
    // configure-vocab arm ("…the configuration of Cloud-Native CRM
    // shouldn't change" → parameter_update + /configur/), and "The
    // Cloud-Native CRM option shouldn't change. Set CRM Platform Cost to
    // 0.55." lands the same wrong-entity auto-apply via the
    // option_configuration-intent arm ("change" + "option" classifies the
    // intent with no configure vocabulary at all).
    return {
      ...buildResolutionResult('exact_label', 'high', optionMatches),
      option_target_preferred: true,
    };
  }
  // Several options named: still ambiguous, but only options are candidates.
  return buildResolutionResult('exact_label', 'medium', optionMatches);
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
    return (
      preferOptionTargetForOptionConfiguration(editDescription, intentCategory, exactMatches)
      ?? buildResolutionResult('exact_label', 'high', exactMatches)
    );
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
    const preferred = preferOptionTargetForOptionConfiguration(editDescription, intentCategory, tokenMatches);
    if (preferred) return preferred;
    // ROADMAP 2.1003 — this arm is a FUZZY match, and it reports itself as
    // `exact_label` at `high` confidence although nothing exact happened.
    // Measured at HEAD by execution: "Change the Salesforce annual licence
    // fee to £30,000", against a graph with NO Salesforce node, resolves to
    // `fac_annual_crm_cost` ("Annual CRM Licence Cost") at `exact_label` /
    // `high` and routes to `auto_apply` — a different object than the user
    // named, silently. The overlap predicate is one-directional: it measures
    // how much of the LABEL the message covers and never asks whether the
    // message's own most distinctive token exists anywhere in the graph.
    //
    // The stamp is a separately-named field, NOT a change to `confidence`.
    // `confidence === 'high'` has another reader (`buildProposedChanges`
    // uses it to protect a label containing compound separators), and
    // rewriting a shared field to reach one consumer is the trap-21 defect
    // this seam exists to stop. One new field, one new reader.
    return {
      ...buildResolutionResult(
        tokenMatches.length === 1 ? 'exact_label' : 'ambiguous',
        tokenMatches.length === 1 ? 'high' : 'medium',
        tokenMatches,
      ),
      heuristic_match: true,
    };
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

  // ⚠⚠ ROADMAP 2.1003 — THE ROUTING DEMOTION IS DELIBERATELY **NOT** HERE.
  //
  // The identity harm is real and reproduces at this tip by execution:
  //   resolveEditTarget('Change the Salesforce annual licence fee to £30,000')
  //   against a graph with NO Salesforce node returns
  //   { match_type: 'exact_label', confidence: 'high',
  //     resolved_target.id: 'fac_annual_crm_cost' }  and this function
  //   returns 'auto_apply' — a different object than the user named, silently.
  //
  // AND THE ROOT CAUSE IS NOT THE CONFIDENCE PATH. Measured:
  // `classifyEditIntent` requires `hasValueUpdateVerb && hasValueTarget` for
  // 'parameter_update', and `hasValueTarget` is a hand-maintained vocabulary
  // (`cost|price|pay|churn|percent|%|…`) that does not contain "fee". The
  // message therefore falls through to the FINAL `return 'structural'` — the
  // DEFAULT — and the structural early-return below auto-applies
  // unconditionally, before any confidence, compound or low-impact check runs.
  // (The honest phrasing "…annual CRM licence COST…" contains "cost", becomes
  // 'parameter_update', and confirms. The product was STRICTEST with the user
  // who named the object correctly.)
  //
  // A demotion gated on `heuristic_match` was built here and WITHDRAWN after
  // it was measured breaking a legitimate rename: "Rename the setup factor"
  // token-overlaps "Setup Complexity" at exactly 0.5, so it is a heuristic
  // match too, and the demotion stopped it applying
  // (`normal-path-value-op-canonicalisation.test.ts` > "flag ON — a benign
  // rename still APPLIES on a V3-invalid base" went RED).
  //
  // That is trap 22 landing on its feet: a predicate over natural language,
  // whose corpus came from the author's head, met a class the author did not
  // imagine — and an EXISTING TEST, not my own kit, is what caught it. The
  // correct next step is the brief's B4 obligation (the 27 captured edit-turn
  // messages as a table-driven corpus), which this lane does not have. Routing
  // is therefore UNCHANGED here; `heuristic_match` is carried as an honest
  // FACT so the class can be measured before anyone changes behaviour on it.
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

  // REVIEW-573 C-1 — consent demotion for option-preferred resolutions.
  // The option-target preference is negation/governance-blind (probes A5
  // "Set CRM Platform Cost to 0.55 - the configuration of Cloud-Native CRM
  // shouldn't change." and A6 "Configure nothing on Cloud-Native CRM; just
  // set CRM Platform Cost to 0.55." both resolved the PROTECTED option at
  // high confidence and auto-applied toward it). A heuristically redirected
  // target never auto-applies: the held-proposal consent flow names the
  // resolved entity, so a wrong pick is visible and declinable — one extra
  // confirm turn on the narrow non-compound single-clause class (the four
  // captured 5c phrasings are all compound and already confirm-first).
  // Confirmed replays are unaffected: `confirmationMode` forces auto_apply
  // upstream of this function.
  if (resolution.option_target_preferred === true) {
    return 'propose_and_confirm';
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
/**
 * The user-facing clarification for the `ambiguous_scale_value` rejection class.
 *
 * Exported so the rejection path can be tested BY IDENTITY rather than against a
 * hand-copied string: a test that rebuilds this sentence itself would keep passing
 * if the product's copy changed underneath it. Used at exactly ONE site, for both
 * `detail` (the internal log line) and `structural_guidance` (the user copy), so
 * the two cannot drift apart.
 *
 * Deterministic and structural-only by construction: every part comes from the
 * operation and the user's own graph — the proposed value, the factor's label and
 * its currently-recorded amount. It asserts nothing about an analysis.
 */
export function buildAmbiguousScaleClarification(op: {
  readonly newValue: number;
  readonly label?: string | null;
  readonly currentRawValue?: number | null;
}): string {
  const factorName = op.label ?? 'this factor';
  const currently = Number.isFinite(op.currentRawValue as number)
    ? ` (currently ${op.currentRawValue})`
    : '';
  return (
    `${op.newValue} reads as a proportion, but \u201c${factorName}\u201d is recorded as an amount` +
    `${currently}. Tell me the amount you want, or give the value with its unit.`
  );
}


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


// ============================================================================
// Applied Changes Receipt
// ============================================================================

/**
 * ROADMAP 2.1003 (c) — the fields on a node that a user AUTHORS as prose.
 *
 * Same list, same precedence and same provenance as
 * `orchestrator-v5/routing/edit-outcome-binding.ts` — see that module's header
 * for why the two spellings name one thing (`cee/transforms/schema-v3.ts:245`
 * maps V1 `body` onto V3 `description`; `cee/extraction/intervention-extractor.ts:1655`
 * already reads `description || body`).
 */
const AUTHORED_PROSE_KEYS = ['description', 'body'] as const;


/** Membership view of the list above. ONE list, so the two cannot drift. */
const AUTHORED_PROSE_KEY_SET: ReadonlySet<string> = new Set(AUTHORED_PROSE_KEYS);


/** Keys on an `update_node` value that cannot move a number. Derived, not copied. */
const NON_NUMERIC_NODE_KEYS: ReadonlySet<string> = new Set([
  'label',
  ...AUTHORED_PROSE_KEYS,
]);


/**
 * The authored prose carried on an operation's `value` / `old_value`, or `null`
 * when there is none.
 *
 * ⚠ STRING-ONLY and ABSENT ≡ EMPTY ≡ WHITESPACE-ONLY, for the same reasons as
 * the comparator's own `projectAuthoredProse`: a structured annotation is not a
 * user writing a note, and an empty string must not read as "a note was added".
 */
function firstAuthoredProse(value: Record<string, unknown> | undefined): string | null {
  if (!value) return null;
  for (const key of AUTHORED_PROSE_KEYS) {
    const raw = value[key];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}


/**
 * Return true if this operation is substantive (affects model outputs).
 * Label-only renames are cosmetic and do not warrant a rerun.
 *
 * ⚠ ROADMAP 2.1003 (c) — SO ARE NOTES, AND FOR THE SAME REASON.
 * The oracle is not this function's own history but the repo's authority on
 * what affects outputs: `computeAnalysisAffectingGraphHash`
 * (`orchestrator-v5/context/graph-hash.ts:104`) names `descriptions` in its
 * EXCLUDED list. Prose is not an input to the maths, so a note-only edit must
 * not recommend a rerun — otherwise the fix that finally reports a note as a
 * CHANGE would immediately start demanding a pointless recompute, collapsing
 * "the user's model moved" into "the numbers are stale". Those are two
 * questions and the comparator split exists to keep them apart.
 *
 * ⚠ THE OPPOSITE-DIRECTION TWIN: the narrowing is "prose/label AND NOTHING
 * ELSE". A compound op that also carries a numeric field stays substantive —
 * suppressing ITS rerun would present a stale analysis as current, which is the
 * worse harm of the two.
 */
function isSubstantiveOperation(op: PatchOperation): boolean {
  if (op.op === 'add_node' || op.op === 'remove_node') return true;
  if (op.op === 'add_edge' || op.op === 'remove_edge' || op.op === 'update_edge') return true;
  if (op.op === 'update_node') {
    const newVal = op.value as Record<string, unknown> | undefined;
    if (!newVal) return false;
    const keys = Object.keys(newVal);
    if (keys.length === 0) return false;
    // Cosmetic when EVERY changed key is a label or authored prose. `every` on
    // a non-empty list, deliberately: a single unrecognised key makes the whole
    // op substantive, so an unknown field can never be silently treated as
    // cosmetic (fail towards recommending the rerun).
    if (keys.every((k) => NON_NUMERIC_NODE_KEYS.has(k))) return false;
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
      // ROADMAP 2.1003 (c) — a note-only edit. Once the comparator reports it as
      // a CHANGE, this is the sentence the user reads
      // (`edit-graph-dispatch.ts:1541`), so it must say what moved. A bare
      // "Updated <label>" was true of a no-change apply and of a wrong-object
      // apply alike — the same defect class the receipt was built to close.
      //
      // Narrow on purpose: PROSE KEYS AND NOTHING ELSE. A compound op that also
      // carries `label` or `value` falls through to the branches below, so
      // renames and value transitions keep today's phrasing exactly.
      if (keys.length > 0 && keys.every((k) => AUTHORED_PROSE_KEY_SET.has(k))) {
        const newNote = firstAuthoredProse(newVal);
        const oldNote = firstAuthoredProse(oldVal);
        if (newNote === null) {
          return oldNote === null ? `Updated ${label}` : `Removed the note on ${label}`;
        }
        return oldNote === null ? `Added a note to ${label}` : `Updated the note on ${label}`;
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
  // Deterministic cross-check: a label-only rename that changes an embedded
  // quantity on a node with a modelled value has NOT changed that value. Such
  // an op must never read as a completed value change (the P0 leak: a bare
  // `Renamed "…$49" to "…$39"` receipt while the intervention stays 0.49).
  const divergences = detectLabelValueDivergences(operations, preGraph, graph);
  const divergenceByIndex = new Map<number, LabelValueDivergence>();
  for (const d of divergences) divergenceByIndex.set(d.index, d);

  // The same cross-check one shape over: a PROSE-ONLY write onto a node whose
  // number is still the product's own guess has not given that factor a value,
  // and "Added a note to X" is true of this apply and of an apply that DID move
  // the number alike. Witnessed on capture d9c4066c (2026-09-19): the person
  // said product quality would be very high, the note landed, the receipt said
  // "Added a note", and the analysis six minutes later ran on 0.5.
  //
  // Disjoint from the label-value family by construction — that one requires a
  // `label` key on the op, this one refuses any key that is not prose — so the
  // two can never contend for the same index. The prose key list is PASSED IN,
  // never re-declared, so this file keeps exactly one copy of it.
  const statedLevelDivergences = detectStatedLevelDivergences(operations, graph, AUTHORED_PROSE_KEYS);
  const statedLevelByIndex = new Map<number, StatedLevelDivergence>();
  for (const d of statedLevelDivergences) statedLevelByIndex.set(d.index, d);

  const changes: AppliedChangeItem[] = operations.map((op, index) => {
    const label = resolveElementLabel(op.path, graph, preGraph, op.value);
    const divergence = divergenceByIndex.get(index);
    const statedLevel = statedLevelByIndex.get(index);
    let description: string;
    if (divergence) {
      description = buildLabelValueDivergenceDescription(divergence);
    } else if (statedLevel) {
      description = buildStatedLevelDivergenceDescription(statedLevel);
    } else {
      description = buildOperationDescription(op, graph, preGraph);
    }
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


/**
 * Every rejection code `buildRejectionResult` can be handed, as a runtime
 * array AND (derived from it) the compile-time union.
 *
 * ⭐ THIS IS THE COMPLETENESS GUARD, and it is derived rather than
 * hand-maintained (CLAUDE.md trap 12). Because `buildRejectionResult`'s
 * `code` parameter is typed `EditRejectionCode`, a new call site passing a
 * literal that is absent from this array is a COMPILE ERROR — the compiler
 * reads every call site, so this list cannot silently go short the way a
 * hand-copied list does. And because the switch below closes on a `never`
 * arm, adding a member here without giving it a case is also a compile
 * error. The two together mean an unmapped code cannot reach a user.
 */
export const EDIT_REJECTION_CODES = [
  'MAX_OPERATIONS_EXCEEDED',
  'STRUCTURAL_VALIDATION_FAILED',
  'PLOT_SEMANTIC_REJECTED',
  'PLOT_UNAVAILABLE',
  'PLOT_REQUEST_FAILED',
  'PLOT_APPLIED_GRAPH_OMITTED_WITH_REPAIRS',
  'SYNTHESIZED_GRAPH_INVALID',
  'APPLIED_GRAPH_UNAVAILABLE',
  'OPTION_INTERVENTIONS_UNRESOLVABLE',
  'OPERATION_DID_NOT_LAND',
] as const;


export type EditRejectionCode = (typeof EDIT_REJECTION_CODES)[number];


/**
 * ⭐ WHICH PLoT FAILURES MAY BE CALLED "COULDN'T REACH THE ANALYSIS SERVICE".
 *
 * The `catch (plotError)` this feeds wraps the ENTIRE PLoT region — the
 * outbound payload check, the fetch, and CEE's own handling of a successful
 * response. Until 2026-09-07 every one of those became `PLOT_UNAVAILABLE`, so
 * the user was told the service was unreachable when PLoT had in fact answered
 * (400 / 413 / 429 / a malformed 200), when the request was never sent at all
 * (`INTERNAL_PAYLOAD_ERROR`, thrown before any fetch), or when our own
 * post-response code threw. That is the same defect class this module exists to
 * fix, one layer up: a marking predicate written for one cause and then fired on
 * every exception.
 *
 * ⚠ THE INVARIANT IS WRITTEN AGAINST THE SPEC, NOT AGAINST THE FAILURE MODE:
 * *"I couldn't reach the analysis service" may be shown ONLY when we can PROVE
 * no response was received.* Provability is decided by CLASS, never by parsing a
 * message:
 *
 *   - `PLoTTimeoutError`      — the client gave up waiting. No usable answer,
 *                               and transient. PROVABLE.
 *   - `PLoTError`, status>=500 — the analysis service answered that it is
 *                               broken. "Unavailable" is true of the service,
 *                               and the retry advice is right. The threshold is
 *                               not invented here: `plot-client.ts`'s own
 *                               `isRetryableError` defines `status >= 500` as
 *                               the transient class, so this reads the
 *                               producer's declared semantics rather than a
 *                               fresh guess (CLAUDE.md trap 13c).
 *   - `PLoTError`, status<500  — PLoT was reached and answered deterministically
 *                               (400 INVALID_REQUEST, 413 BAD_INPUT, 429
 *                               RATE_LIMIT). "Couldn't reach" is FALSE, and for
 *                               400/413 "try again in a moment" is futile —
 *                               413 is deterministic in the size of the user's
 *                               graph.
 *   - anything else            — a pre-fetch payload error, an abort, a network
 *                               error, or a throw from our own response
 *                               handling. NOT PROVABLE either way.
 *
 * The unprovable bucket deliberately UNDER-CLAIMS: it takes the neutral code,
 * whose copy attributes nothing and offers both routes forward. A genuine
 * network outage (a bare `TypeError: fetch failed`) therefore gets neutral
 * rather than outage-specific copy. That is the intended trade — the only way to
 * put network errors in the specific bucket is to match on message substrings,
 * and a confidently wrong sentence is worse than a correct general one. Neither
 * branch ever blames the user, which is this module's actual guarantee.
 */
export function classifyPlotFailureCode(plotError: unknown): EditRejectionCode {
  if (plotError instanceof PLoTTimeoutError) return 'PLOT_UNAVAILABLE';
  if (plotError instanceof PLoTError && plotError.status >= 500) return 'PLOT_UNAVAILABLE';
  return 'PLOT_REQUEST_FAILED';
}


/**
 * POC-BOARD #6 — bounded refusal for an over-cap edit (CEE_EDIT_CAP_SPLIT ON).
 *
 * Distinct from {@link buildRejectionResult}'s `MAX_OPERATIONS_EXCEEDED` dead end
 * in three ways, so a >15-op edit is never a bare dead end:
 *   1. a DISTINCT rejection code (`MAX_OPERATIONS_SPLIT_SUGGESTED`) — downstream
 *      consumers can tell a bounded split-suggestion apart from the old hard cap;
 *   2. user-facing copy that offers a CONCRETE next step (make the change in a
 *      couple of smaller passes) plus recovery chips the user can act on now —
 *      not a static "reduce the scope" deflection;
 *   3. the structured count/cap preserved in `rejection.reason` (the raw `msg`,
 *      never surfaced to the user) so the turn trace still records exactly how far
 *      over the cap the batch was.
 *
 * Nothing is applied: an arbitrary index-`maxOps` truncation of an LLM op array
 * risks an incoherent partial batch (an `add_edge` whose `add_node` fell past the
 * cut), so the honest, in-scope fix is the bounded refusal — the acceptance floor
 * explicitly permits "a bounded refusal with a next step" as the alternative to a
 * true split/continuation. The user-facing prose stays banned-token clean
 * (no operation counts / schema language — see edit-rejection-text.test.ts).
 */
/**
 * Recovery chips for the over-cap split refusal, exported so the no-dead-end
 * rule can be pinned as an EXACT SET (see
 * `tests/unit/orchestrator-v5/compose/recovery-chip-actionability.test.ts`).
 *
 * ⭐ NAMES A MOVE, NOT A MANNER OF SPEAKING. The first prompt used to read
 * "Let's start with the single most important change." — which tells the
 * product nothing it can act on, because only the user knows which change that
 * is. Clicking it re-submits that sentence as a fresh user turn and the router
 * has no referent, so the product refuses the move it just offered. Measured on
 * the sibling edit-rejection path (staging 2026-09-14, scenario 9677de7d,
 * request 809d0ee2). The replacement is an INSTRUCTION over the batch the
 * product is already holding.
 */
export const OVER_CAP_SPLIT_CHIPS: readonly SuggestedAction[] = [
  {
    label: 'Start with the key change',
    prompt: 'Make just the most important part of that change and leave the rest for now.',
    role: 'facilitator',
  },
  {
    label: 'Split into smaller edits',
    prompt: 'Help me break this into a few smaller edits.',
    role: 'challenger',
  },
];


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
  //
  // ROADMAP 2.11 / P0-2 — intervention OBJECT leaves are wrapped too. The
  // edit prompt's option-configuration contract ("patch the whole
  // intervention object at /nodes/<opt>/data/interventions/<factor_id>",
  // its EXAMPLE 2) emits an OBJECT value `{value, raw_value, unit, cap}`.
  // The scalar-only wrap dropped the field key for that shape, so the
  // object was Object.assign-smeared onto the option node: the
  // `<factor_id>` attribution was LOST, the referee saw unsanctioned
  // node-field roots (`value`/`raw_value`/`unit`/`cap`) and REJECTED, and
  // a multi-factor option could never be configured through chat (pinned
  // by option-configure-apply-chain.test.ts hop 1). Scoped to the
  // interventions subtree only: other object-valued field updates keep
  // their long-standing spread semantics.
  const isInterventionFieldPath =
    typeof field === 'string' && /^data\/interventions\/.+$/.test(field);
  if (field && (raw.op === 'update_node' || raw.op === 'update_edge')) {
    if (
      value !== undefined &&
      (typeof value !== 'object' || value === null || (isInterventionFieldPath && !Array.isArray(value)))
    ) {
      value = { [field]: value };
    }
    if (
      oldValue !== undefined &&
      (typeof oldValue !== 'object' || oldValue === null || (isInterventionFieldPath && !Array.isArray(oldValue)))
    ) {
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

// ROADMAP 2.474 / A3 — the three budget numbers now live in a LEAF module
// (`patch-budget-limits.ts`) so the structural-edit batch splitter can size a
// part against the SAME numbers this function enforces, rather than mirroring
// them (CLAUDE.md trap 12). They are imported at the top of this file.

interface PatchBudgetResult {
  allowed: boolean;
  nodeOps: number;
  edgeOps: number;
  /** When option-addition is present, which limit was breached: 'incident' | 'unrelated' | 'node' | null */
  breachedLimit?: 'incident' | 'unrelated' | 'node' | null;
  /** The effective max edge ops that was applied for the breached category. */
  effectiveMaxEdgeOps?: number;
  /**
   * ROADMAP 2.655 — the breach in the terms a USER can be told about, derived
   * from the two allow/deny verdicts themselves rather than from bucket
   * bookkeeping.
   *
   * ⚠ WHY NOT JUST READ `breachedLimit`. Measured at the bytes, that field
   * cannot answer this question:
   *   · a plain edge-only breach (no option addition) leaves it `null`, because
   *     only the option-addition branch ever assigns an edge value;
   *   · when node AND edge both breach under an option addition, the edge
   *     bucket is assigned first and the `!nodeAllowed` clause is skipped, so
   *     the node breach disappears from the report.
   * Copy driven off it would therefore be silent, or wrong, in exactly the
   * cases where it most needs to be right. `breachedLimit` is unchanged and
   * keeps its existing meaning for its existing readers.
   */
  breachedDimensions: readonly PatchBudgetDimension[];
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
 * 'option'/'intervention'), edge ops are BUCKETED: those incident to the new
 * option node(s) are budgeted at OPTION_ADD_MAX_EDGE_OPS, unrelated edge ops
 * at MAX_EDGE_OPS, and both buckets must pass INDEPENDENTLY.
 *
 * ⚠ ROADMAP 2.624 — READ THIS WITH `patch-budget-limits.ts`, WHICH THIS
 * COMMENT CONTRADICTED. The old wording ("this prevents the elevated budget
 * from masking unrelated high-impact edge rewires") described only the
 * unrelated bucket and left the reader believing the branch was no more
 * permissive than the flat cap. It is more permissive, and a discriminating
 * pair shows it:
 *
 *   [option add_node, 7 incident edges, 5 unrelated edges] → edgeOps 12, ALLOWED
 *   CONTROL, the same 12 edge ops under a plain add_node → edgeOps 12, REFUSED
 *
 * Because the two buckets are checked independently, this branch admits up to
 * MAX_EDGE_OPS + OPTION_ADD_MAX_EDGE_OPS (sixteen at today's values) against
 * a flat cap of eight. The two constants are currently EQUAL, so it is the
 * BUCKET SPLIT — not the constant — that is the elevation. Whether to raise
 * OPTION_ADD_MAX_EDGE_OPS or delete the branch entirely is rowed, not decided
 * here; what matters at this seam is that a reader is not told the opposite of
 * what the code does.
 *
 * The structural-edit splitter is unaffected in either direction: it sizes
 * parts against the strict FLAT cap, which is stricter than anything this
 * branch admits, so a part it emits is legal here. That implication is no
 * longer prose — it is executed by the property test in
 * `orchestrator-v5/tools/__tests__/structural-edit-batch-split.test.ts`,
 * which calls THIS function on every part the splitter produces.
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

  // ROADMAP 2.655 — derived from the verdicts, so it can never disagree with
  // what was enforced and can never go silent on a dimension that breached.
  const breachedDimensions: PatchBudgetDimension[] = [];
  if (!nodeAllowed) breachedDimensions.push('node');
  if (!edgeAllowed) breachedDimensions.push('edge');

  return {
    allowed: nodeAllowed && edgeAllowed,
    nodeOps,
    edgeOps,
    breachedLimit,
    effectiveMaxEdgeOps,
    breachedDimensions,
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
