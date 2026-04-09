/**
 * Response Assembler
 *
 * Assembles a typed OrchestratorResponseEnvelope from LLM output + action results.
 * Adds response_version: 2 to every response.
 */

import { randomUUID } from "node:crypto";
import type {
  OrchestratorResponseEnvelope,
  TypedConversationBlock,
  SuggestedAction,
  ResponseLineage,
  TurnPlan,
} from "../types.js";
import type {
  DeterministicTurnContext,
  LLMJsonResponse,
  LLMInsight,
  ActionResult,
  DeterministicPipelineResult,
  TurnQualityMeta,
  EntityRegistry,
} from "./types.js";
import { buildChipsFromRecommendations } from "./chip-assembler.js";
import { normaliseDeterministicResponse, scanBannedTerms } from "./response-normaliser.js";
import { computeContextHash } from "../context/context-hash.js";
import { createGraphPatchBlock } from "../blocks/factory.js";
import { generatePostAnalysisGuidance } from "../guidance/post-analysis.js";
import type { GuidanceItem } from "../types/guidance-item.js";
import { enforceProposalLanguage } from "./proposal-language-guard.js";
import { assessMutationHealth } from "./mutation-health.js";
import { applyPatchOperations } from "../patch-applier.js";
import { buildPatchSummary } from "../patch-summary.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Public API
// ============================================================================

export interface AssemblerInput {
  turnContext: DeterministicTurnContext;
  llmResponse: LLMJsonResponse | null;
  actionResult: ActionResult | null;
  turnId: string;
  routing: 'deterministic' | 'llm';
  selectedAction: string | null;
  executedActions: string[];
  /** LLM call latency in ms (if any). */
  llmLatencyMs?: number;
  /** How the LLM response was extracted. */
  extractionMethod?: 'native' | 'fence' | 'regex' | 'fallback';
  /** Whether TurnContext used the fallback path. */
  contextFallbackUsed?: boolean;
  /** Character count of the full system prompt. */
  promptCharCount?: number;
  /** Streaming text extractor state (only for streaming calls). */
  streamingExtractorState?: 'streaming' | 'fallback';
}

/**
 * Assemble the final response envelope from pipeline outputs.
 */
export function assembleDeterministicResponse(input: AssemblerInput): DeterministicPipelineResult {
  const {
    turnContext,
    llmResponse,
    actionResult,
    turnId,
    routing,
    selectedAction,
    executedActions,
    llmLatencyMs,
    extractionMethod,
    contextFallbackUsed,
    promptCharCount,
    streamingExtractorState,
  } = input;

  // T1 (Phase A): structured failure short-circuit. When the action handler
  // returned a failure object (e.g. CAP_EXCEEDED), surface user_message as
  // assistant_text, mirror code+hint to envelope-level fields, log telemetry,
  // and skip ALL operations / blocks / gates. The failure path is mutually
  // exclusive with the operations path — handlers never set both.
  let failureCode: string | undefined;
  let failureRecoveryHint: string | undefined;
  if (actionResult?.failure) {
    failureCode = actionResult.failure.code;
    failureRecoveryHint = actionResult.failure.recovery_hint;
    log.warn(
      {
        event: 'v4.action_failed',
        code: actionResult.failure.code,
        tool_name: selectedAction ?? 'unknown',
      },
      'Deterministic action returned structured failure',
    );
  }

  // Build assistant text — failure user_message wins; otherwise action
  // confirmation first, LLM coaching second.
  let assistantText: string | null = null;
  if (actionResult?.failure) {
    assistantText = actionResult.failure.user_message;
  } else if (actionResult?.assistantText) {
    assistantText = actionResult.assistantText;
  }
  if (!actionResult?.failure && llmResponse?.text) {
    assistantText = assistantText
      ? `${assistantText}\n\n${llmResponse.text}`
      : llmResponse.text;
  }

  // Build blocks. On failure: skip action.blocks too, since we don't want
  // ANY block leaking through alongside a CAP_EXCEEDED-style message.
  const blocks: TypedConversationBlock[] = actionResult?.failure
    ? []
    : [...(actionResult?.blocks ?? [])];

  // Emit graph_patch block when operations were produced (and no failure).
  let emittedProposalBlock = false;
  if (!actionResult?.failure && actionResult?.operations && actionResult.operations.length > 0) {
    // T4: build a label-aware semantic summary using the pre-mutation graph
    // for label resolution. Falls back to count-based on resolution failure.
    const patchSummary = buildPatchSummary(
      actionResult.operations,
      null,
      'edit',
      turnContext.graph ?? null,
    );
    const patchBlock = createGraphPatchBlock(
      {
        patch_type: 'edit',
        operations: actionResult.operations,
        status: 'proposed',
        auto_apply: false,
        applied_graph_hash: actionResult.applied_graph_hash,
        applied_graph: actionResult.applied_graph,
        summary: patchSummary,
      },
      turnId,
    );
    blocks.push(patchBlock);
    // Track for the T5 proposal-language guard. Gates on the actual emitted
    // block's auto_apply being false — NOT on operations.length, so a future
    // path emitting auto-applied operations would not trigger the guard.
    emittedProposalBlock = true;
  }

  // T5: proposal-language guard. When this turn emits a proposal block
  // (auto_apply: false), scan the assembled assistant text for completion
  // phrases ("Adding now", "I've added", "Done"). On match, append a
  // corrective suffix and log telemetry.
  if (emittedProposalBlock && assistantText) {
    const guardResult = enforceProposalLanguage(assistantText, selectedAction ?? 'deterministic');
    if (guardResult.leaked && guardResult.suffixed) {
      assistantText = guardResult.suffixed;
    }
  }

  // T3: post-mutation health gate. Advisory — never blocks the response.
  // Builds a post-mutation graph (using actionResult.applied_graph when
  // available, otherwise the applyOperationsToGraph shim) and checks for
  // structural violations, option readiness degradation, and duplicate
  // option labels. On any issue, append a note to assistant text and
  // downgrade rerun_recommended on the patch block.
  if (
    !actionResult?.failure &&
    actionResult?.operations &&
    actionResult.operations.length > 0 &&
    turnContext.graph
  ) {
    try {
      // Reuse the canonical patch applier (patch-applier.ts) — same code
      // path PLoT validation uses, so the gate sees the exact post-state
      // production would. Throws on invalid ops; the surrounding catch
      // skips the gate when that happens (advisory, never blocking).
      const postGraph =
        actionResult.applied_graph ??
        applyPatchOperations(turnContext.graph, actionResult.operations);
      const health = assessMutationHealth(turnContext.graph, postGraph, actionResult.operations);
      if (!health.healthy) {
        const issueText = health.issues.slice(0, 3).map((i) => `- ${i}`).join('\n');
        const note = `\n\nNote:\n${issueText}\nYou may need to address these before running analysis.`;
        assistantText = (assistantText ?? '') + note;
        // Downgrade rerun_recommended on the just-pushed patch block. The
        // block is the last entry in `blocks` because emittedProposalBlock
        // is true (push happened above). Cast via unknown to bypass the
        // strict block-data union — we already know it's a graph_patch block.
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.block_type === 'graph_patch') {
          const data = (lastBlock as unknown as { data: Record<string, unknown> }).data;
          data.rerun_recommended = false;
        }
        log.warn(
          {
            event: 'v4.mutation_health_warning',
            issues: health.issues,
            tool_name: selectedAction ?? 'unknown',
          },
          'Post-mutation health gate raised issues',
        );
      }
    } catch (err) {
      // Health gate is advisory — never let it break response assembly.
      log.warn(
        { event: 'v4.mutation_health_error', error: (err as Error).message },
        'Post-mutation health gate threw — skipping',
      );
    }
  }

  // Build chips from LLM recommendations
  let suggestedActions: SuggestedAction[] = [];
  let strippedActions: string[] = [];
  if (llmResponse?.recommended_actions && llmResponse.recommended_actions.length > 0) {
    const chipResult = buildChipsFromRecommendations(
      llmResponse.recommended_actions,
      turnContext,
    );
    suggestedActions = chipResult.chips;
    strippedActions = chipResult.strippedActions;
  }

  // Build lineage
  const lineage: ResponseLineage = {
    context_hash: computeContextHash({
      graph: null,
      analysis_response: null,
      framing: turnContext.stage ? { stage: turnContext.stage } : null,
    }),
    ...(actionResult?.applied_graph_hash ? { graph_hash: actionResult.applied_graph_hash } : {}),
  };

  // Build turn plan
  const turnPlan: TurnPlan = {
    selected_tool: selectedAction,
    routing,
    long_running: selectedAction === 'run_analysis',
    ...(llmLatencyMs != null ? { tool_latency_ms: llmLatencyMs } : {}),
    executed_tools: executedActions,
    deferred_tools: [],
  };

  // Cap insights at 3, resolve entity IDs → labels, and include in envelope
  const rawInsights = llmResponse?.insights?.slice(0, 3) ?? [];
  const insights = rawInsights.map((ins) => resolveInsightEntities(ins, turnContext.entities));

  // Collect guidance_items from action result + post-analysis guidance
  let guidanceItems: GuidanceItem[] = [...(actionResult?.guidance_items ?? [])];

  // Generate post-analysis guidance when analysis-related actions executed
  if (
    (executedActions.includes('run_analysis') || executedActions.includes('explain_result')) &&
    turnContext.analysis &&
    guidanceItems.length === 0
  ) {
    try {
      const postAnalysis = generatePostAnalysisGuidance(turnContext.analysis, turnContext.graph);
      if (postAnalysis.length > 0) {
        guidanceItems = [...guidanceItems, ...postAnalysis];
      }
    } catch {
      // Non-fatal — guidance is supplementary
    }
  }

  // Assemble envelope. T1 (Phase A): mirror failure_code / failure_recovery_hint
  // onto the envelope so future Phase B (history threading) and any future UI
  // hint surface can read them without reworking the response shape.
  const envelope: OrchestratorResponseEnvelope & {
    response_version: 2;
    guidance_items?: unknown[];
    failure_code?: string;
    failure_recovery_hint?: string;
  } = {
    turn_id: turnId,
    assistant_text: assistantText,
    blocks,
    suggested_actions: suggestedActions.length > 0 ? suggestedActions : undefined,
    analysis_response: actionResult?.analysis_response,
    lineage,
    turn_plan: turnPlan,
    stage_indicator: turnContext.stage,
    response_version: 2,
    ...(insights.length > 0 ? { insights } : {}),
    guidance_items: guidanceItems,
    ...(failureCode ? { failure_code: failureCode } : {}),
    ...(failureRecoveryHint ? { failure_recovery_hint: failureRecoveryHint } : {}),
  };

  // Apply normaliser
  const normalised = normaliseDeterministicResponse(envelope);

  // Check if normaliser had to inject default text (was empty before normaliser fixed it)
  const emptyBeforeNormalisation = !envelope.assistant_text || envelope.assistant_text.trim().length === 0;

  // Scan banned terms on user-visible surfaces
  const bannedTermsFound = scanBannedTerms(
    llmResponse,
    normalised,
    turnContext.scenario_id,
    turnId,
  );

  // Build quality metadata for telemetry
  // When LLM call failed (extractionMethod undefined), report as 'error' not 'native'
  const quality: TurnQualityMeta = {
    parse_method: extractionMethod ?? (llmResponse ? 'native' : 'error'),
    banned_terms_found: bannedTermsFound,
    ineligible_actions_stripped: strippedActions,
    insights_count: llmResponse?.insights?.length ?? 0,
    actions_count: llmResponse?.recommended_actions?.length ?? 0,
    text_word_count: (normalised.assistant_text ?? '').split(/\s+/).filter(Boolean).length,
    has_science_concept: llmResponse?.insights?.some((i) => !!i.science_concept) ?? false,
    disambiguation_triggered: turnContext.disambiguation_hints.length > 0,
    empty_before_normalisation: emptyBeforeNormalisation,
    llm_action_count_pre_filter: llmResponse?.recommended_actions?.length ?? 0,
    context_fallback_used: contextFallbackUsed ?? false,
    prompt_char_count: promptCharCount ?? 0,
    ...(streamingExtractorState ? { streaming_extractor_state: streamingExtractorState } : {}),
  };

  return {
    envelope: normalised as OrchestratorResponseEnvelope & { response_version: 2 },
    httpStatus: 200,
    _quality: quality,
  };
}

// ============================================================================
// Entity Resolution for Insights
// ============================================================================

/**
 * Regex matching all known node entity ID prefixes.
 * Covers: fac, opt, goal, dec, out, risk, con — followed by _, :, or -
 * then the ID body (lowercase alphanumeric, underscores, colons, hyphens)
 * matching CANONICAL_ID_REGEX from src/cee/utils/id-normalizer.ts.
 *
 * edge_ is excluded — edges use from→to format, not the nodes map.
 */
const ENTITY_ID_RE = /\b(?:fac|opt|goal|dec|out|risk|con)[_:-][a-z0-9_:-]+\b/g;

/**
 * Replace raw entity IDs with human-readable labels in insight fields.
 * - Resolves inline IDs in `description` text via regex
 * - Leaves `target_id` unchanged (programmatic reference)
 */
export function resolveInsightEntities(
  insight: LLMInsight,
  entities: EntityRegistry,
): LLMInsight {
  const resolved = { ...insight };

  // Replace inline entity IDs in description
  if (resolved.description) {
    resolved.description = resolved.description.replace(
      ENTITY_ID_RE,
      (match) => entities.nodes.get(match)?.label ?? match,
    );
  }

  return resolved;
}
