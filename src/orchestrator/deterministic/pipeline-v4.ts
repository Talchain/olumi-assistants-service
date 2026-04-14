/**
 * Pipeline v4 — Native Tool-Use Pipeline
 *
 * Single pipeline for all turn types. Uses Anthropic native tool calling
 * instead of JSON-contract parsing. One routing path, one assembler,
 * one normaliser.
 *
 * Execution classes:
 * 1. Deterministic (no LLM): system events, pending confirmations
 * 2. LLM with tools (standard turn): user message + eligible action tools
 * 3. LLM with forced tool (chip click): tool_choice: { type: 'tool', name }
 *
 * Feature flag: CEE_PIPELINE_V4_ENABLED
 */

import { randomUUID } from "node:crypto";
import type { OrchestratorTurnRequest, ConversationContext } from "../types.js";
import type { DeterministicTurnContext, ActionResult } from "./types.js";
import type { ActionName } from "./actions/types.js";
import type { OrchestratorStreamEvent } from "../pipeline/stream-events.js";
import type { OrchestratorResponseEnvelopeV2 } from "../pipeline/types.js";
import { computeTurnContext } from "./turn-context.js";
import { handleSystemEvent } from "./system-event-handler.js";
import { handlePendingConfirmation } from "./confirmation-flow.js";
import { buildDeterministicPromptV2 } from "./prompt-builder-v2.js";
import { buildToolDefinitions } from "./tool-builder.js";
import { buildDeterministicChips } from "./chip-builder-v4.js";
import { processAdapterStream, PROGRESS_MESSAGES, PROGRESS_INTERVAL_MS } from "./stream-handler-v4.js";
import type { StreamHandlerResult, ToolExecution } from "./stream-handler-v4.js";
import { normaliseDeterministicResponse, scanBannedTerms } from "./response-normaliser.js";
import { ACTION_CATALOGUE } from "./actions/registry.js";
import { assembleMessages } from "../prompt-assembly.js";
import { sanitiseAssistantHistory } from "./history-sanitiser.js";
import { filterHistoryV4 } from "./history-filter-v4.js";
import { computeContextHash } from "../context/context-hash.js";
import { computeStructuralReadiness } from "../tools/analysis-ready-helper.js";
import { createGraphPatchBlock } from "../blocks/factory.js";
import { generatePostAnalysisGuidance } from "../guidance/post-analysis.js";
import { buildPatchSummary } from "../patch-summary.js";
import { enforceProposalLanguage } from "./proposal-language-guard.js";
import { sanitiseAssistantText, sanitiseEnvelopeText } from "./sanitise-output.js";
import { assessMutationHealth } from "./mutation-health.js";
import { applyPatchOperations } from "../patch-applier.js";
import { getAdapter, getMaxTokensFromConfig } from "../../adapters/llm/router.js";
import { ORCHESTRATOR_TIMEOUT_MS } from "../../config/timeouts.js";
import { log } from "../../utils/telemetry.js";
import { STREAM_ERROR_CODES } from "../pipeline/stream-events.js";
import type { GuidanceItem } from "../types/guidance-item.js";
import { config } from "../../config/index.js";
import { buildCoachingContext } from "./coaching-context-builder.js";
import type { CoachingContext } from "./coaching-context-builder.js";
import { mergeSessionState, advanceSessionState, updateLastChipIds, registerChipClick } from "./session-state.js";
import type { SessionState } from "./session-state.js";
import { composeResponse } from "./response-composer.js";
import { computeChips, getChipIdsForSession } from "./chip-engine.js";
import { normalizeAnalysisEnvelope } from "../analysis-state.js";

// ============================================================================
// Chip-Click Text Templates (Task 5)
// ============================================================================

/** Pre-generated text for forced tool calls (chip clicks). */
const CHIP_TEXT_TEMPLATES: Record<string, (ctx: DeterministicTurnContext) => string> = {
  compare_options: (ctx) => `Comparing your ${ctx.graph_summary.option_count} options.`,
  what_would_flip: () => 'Looking at what would need to change to flip the result.',
  run_premortem: () => 'Running a pre-mortem analysis.',
  explain_result: () => 'Breaking down what is driving the result.',
  run_analysis: () => 'Running the analysis now.',
  challenge_assumption: () => 'Examining that assumption more closely.',
  draft_graph: () => 'Building your decision model.',
};

/**
 * Fallback text templates for empty LLM responses after successful tool
 * execution. Fires only on the degenerate path where both the LLM and the
 * action handler produced no text (handler text or composer output is
 * preferred). Uses the same decision-language framing as the response
 * composer — no banned completion verbs (Added, Updated, Done, Applied).
 */
const TOOL_RESULT_TEXT_TEMPLATES: Record<string, string> = {
  compare_options: "Here's how your options compare.",
  what_would_flip: "Here's what would need to change to flip the leading option.",
  run_premortem: 'Running a pre-mortem on your leading option.',
  explain_result: "Here's what's driving the result.",
  run_analysis: 'Running the analysis now.',
  draft_graph: 'Building your decision model.',
  set_factor_value: 'The factor value is now set.',
  add_factor: 'The factor is now in your model.',
  add_option: 'The option is now in your model.',
  add_constraint: 'The constraint is now in your model.',
  adjust_edge_strength: 'The edge strength is now set.',
  remove_factor: 'The factor is no longer in your model.',
  set_goal_target: 'The goal target is now set.',
  challenge_assumption: 'Examining that assumption.',
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Execute the v4 native tool-use pipeline as a streaming generator.
 *
 * Yields OrchestratorStreamEvent for SSE delivery. All turn types
 * (system events, normal messages, chip clicks, generate_model)
 * are handled through this single pipeline.
 */
export async function* executePipelineV4(
  turnRequest: OrchestratorTurnRequest,
  requestId: string,
  signal?: AbortSignal,
  /** Fastify request — needed by draft_graph action to call the unified pipeline. */
  fastifyRequest?: import("fastify").FastifyRequest,
): AsyncGenerator<OrchestratorStreamEvent> {
  const turnId = randomUUID();
  const startTime = Date.now();
  let seq = 0;
  let computedStage: string | null = null;

  try {
    // ── Class 1: System events (deterministic, no LLM) ──────────────
    const systemEventResult = handleSystemEvent(turnRequest, turnId, requestId);
    if (systemEventResult) {
      yield { type: 'turn_start', seq: seq++, turn_id: turnId, routing: 'deterministic', stage: turnRequest.context?.framing?.stage ?? 'frame' };
      yield { type: 'turn_complete', seq: seq++, envelope: systemEventResult.envelope as unknown as OrchestratorResponseEnvelopeV2 };

      log.info({
        request_id: requestId,
        turn_id: turnId,
        execution_class: 'system_event',
        event_type: turnRequest.system_event?.event_type,
        duration_ms: Date.now() - startTime,
      }, 'v4.turn_context');
      log.info({
        event: 'v4.turn_sources',
        request_id: requestId,
        turn_id: turnId,
        response_source: 'system_event' as const,
        chip_source: 'none' as const,
        chip_count: 0,
        executed_action: null,
      }, 'Turn response and chip sources');
      return;
    }

    // ── Normalise top-level state fields into context ────────────────
    // Mirrors pipeline-stream.ts:93-102. The UI sends the latest graph
    // and analysis via top-level fields (graph_state, analysis_state);
    // computeTurnContext and inferStage read context.*, so we merge here.
    // Top-level fields win over potentially stale context fields.
    if (turnRequest.analysis_state) {
      turnRequest.context.analysis_response = normalizeAnalysisEnvelope(turnRequest.analysis_state);
    } else if (turnRequest.context.analysis_response) {
      turnRequest.context.analysis_response = normalizeAnalysisEnvelope(
        turnRequest.context.analysis_response as import("../types.js").V2RunResponseEnvelope,
      );
    }
    if (turnRequest.graph_state) {
      turnRequest.context.graph = turnRequest.graph_state;
    }

    // Derive analysis_inputs from graph.analysis_ready when the caller did not
    // supply it. This matches the shape the run_analysis action requires
    // (ctx.analysis_inputs) and eliminates a client-side payload dependency:
    // any caller that sends the graph (with analysis_ready populated by draft)
    // can run analysis without separately echoing the interventions payload.
    if (!turnRequest.context.analysis_inputs) {
      const graph = turnRequest.context.graph as Record<string, unknown> | null | undefined;
      const analysisReady = graph?.analysis_ready as { options?: Array<Record<string, unknown>> } | undefined;
      if (analysisReady?.options && Array.isArray(analysisReady.options) && analysisReady.options.length > 0) {
        const derived = analysisReady.options
          .filter((opt): opt is Record<string, unknown> => opt != null && typeof opt === 'object')
          .map((opt) => ({
            option_id: (opt.option_id ?? opt.id) as string | undefined,
            label: opt.label as string | undefined,
            interventions: (opt.interventions ?? {}) as Record<string, unknown>,
          }))
          .filter((opt): opt is { option_id: string; label: string; interventions: Record<string, unknown> } =>
            typeof opt.option_id === 'string' && typeof opt.label === 'string',
          );
        if (derived.length > 0) {
          turnRequest.context.analysis_inputs = { options: derived } as import("../types.js").AnalysisInputs;
          log.debug({
            event: 'v4.analysis_inputs_derived',
            option_count: derived.length,
          }, 'Derived analysis_inputs from graph.analysis_ready');
        }
      }
    }

    // ── Compute TurnContext ──────────────────────────────────────────
    let turnContext: DeterministicTurnContext;
    let contextFallbackUsed = false;

    try {
      turnContext = computeTurnContext(turnRequest);
      turnContext.turn_id = turnId;
      // Thread FastifyRequest for draft_graph action
      turnContext.request = fastifyRequest;
    } catch (error) {
      contextFallbackUsed = true;
      log.warn({ request_id: requestId, error: error instanceof Error ? error.message : String(error) }, 'v4.turn_context_fallback');
      turnContext = buildFallbackContext(turnRequest, turnId);
    }
    // Thread abort signal after try/catch so both normal and fallback contexts get it
    turnContext.signal = signal;

    const effectiveMessage = turnRequest.message?.trim() ?? '';
    const stage = turnContext.stage;
    computedStage = stage;
    const executionClass = determineExecutionClass(turnRequest, turnContext, effectiveMessage);

    log.info({
      request_id: requestId,
      turn_id: turnId,
      stage,
      turn_count: turnContext.conversation.turn_count,
      entity_count: turnContext.entities.nodes.size,
      eligible_actions_count: turnContext.eligible_actions.length,
      execution_class: executionClass,
      generate_model: !!turnRequest.generate_model,
    }, 'v4.turn_context');

    // ── WS6 + WS1: Session state + Coaching context ─────────────────
    // Resolve session state from request (backward-compatible: defaults when absent).
    // Build coaching context for dynamic block enrichment and downstream consumers.
    // Feature flag: CEE_COACHING_CONTEXT_ENABLED (covers WS1 + WS8).
    let sessionState: SessionState = mergeSessionState(turnRequest.session_state);
    // Register the clicked chip so the 2-turn suppression window does not
    // hide it on re-render if it's still relevant.
    const clickedChipId = turnRequest.chip_metadata?.parameters?.chip_id;
    if (typeof clickedChipId === 'string') {
      sessionState = registerChipClick(sessionState, clickedChipId);
    }
    let coachingContext: CoachingContext | null = null;
    if (config.cee.coachingContextEnabled) {
      try {
        coachingContext = buildCoachingContext(turnContext, sessionState);
      } catch (err) {
        log.warn({ event: 'v4.coaching_context_error', error: (err as Error).message }, 'Coaching context build failed — skipping');
      }
    }

    if (signal?.aborted) return;

    // ── Class 1b: Pending confirmation (deterministic, no LLM) ──────
    if (effectiveMessage) {
      const confirmResult = handlePendingConfirmation(effectiveMessage, turnContext);
      if (confirmResult.handled && confirmResult.actionResult) {
        yield { type: 'turn_start', seq: seq++, turn_id: turnId, routing: 'deterministic', stage };

        // Yield blocks from confirmed action
        for (const block of confirmResult.actionResult.blocks) {
          yield { type: 'block', seq: seq++, block };
        }

        // WS6: Advance session state BEFORE envelope assembly so the chip
        // engine (called inside assembleV4Envelope) sees the post-confirmation
        // counters (accepted_patches / dismissed_patches). Without this,
        // chips are computed against the stale pre-confirmation state and
        // the updated counters are visible only on the next turn.
        const confirmedAction = confirmResult.executedProposal?.action_type as ActionName ?? null;
        const confirmSessionState = config.cee.coachingContextEnabled
          ? advanceSessionState(
              sessionState,
              confirmedAction,
              turnContext,
              {
                patch_accepted: !!confirmResult.executedProposal,
                patch_dismissed: !!confirmResult.cleared,
              },
            )
          : sessionState;

        // Resolve the chip tool set — chips carry explicit target_id, so
        // bypass disambiguation (same rationale as the main path). Confirmation
        // produces no LLM call, so we only need the chip-facing set here.
        const confirmToolDefs = buildToolDefinitions(
          [...turnContext.eligible_actions] as ActionName[],
          turnContext,
          { bypassDisambiguation: true },
        );
        const confirmToolNames = confirmToolDefs.map(t => t.name);
        const envelope = assembleV4Envelope({
          turnContext,
          turnId,
          requestId,
          executionClass,
          assistantText: confirmResult.actionResult.assistantText,
          actionResult: confirmResult.actionResult,
          routing: 'deterministic',
          executedAction: confirmedAction,
          contextFallbackUsed,
          coachingContext,
          sessionState: confirmSessionState,
          availableTools: confirmToolNames,
        });

        // Capture chip_ids produced this turn so the next turn's 2-turn
        // suppression window is driven by what the user actually saw.
        if (config.cee.coachingContextEnabled) {
          const chipIds = getChipIdsForSession(envelope.suggested_actions ?? []);
          const stateForRoundTrip = chipIds.length > 0
            ? updateLastChipIds(confirmSessionState, chipIds)
            : confirmSessionState;
          (envelope as unknown as Record<string, unknown>).updated_session_state = stateForRoundTrip;
        }

        // Telemetry: confirmation turn sources
        const confirmChipSource: 'chip_engine' | 'legacy' | 'none' =
          config.cee.chipEngineEnabled !== false && coachingContext != null && confirmSessionState != null
            ? 'chip_engine'
            : (envelope.suggested_actions?.length ?? 0) > 0 ? 'legacy' : 'none';
        log.info({
          event: 'v4.turn_sources',
          request_id: requestId,
          turn_id: turnId,
          // TODO(P2): Confirmation turns hardcode 'legacy_handler'. When the composer
          // is wired into the confirmation path, update this to reflect the actual
          // source. See ownership contract v1.1 transitional exceptions.
          response_source: 'legacy_handler' as const,
          chip_source: confirmChipSource,
          chip_count: envelope.suggested_actions?.length ?? 0,
          executed_action: confirmedAction,
        }, 'Turn response and chip sources');

        yield { type: 'turn_complete', seq: seq++, envelope };
        return;
      }
    }

    if (signal?.aborted) return;

    // ── Class 2/3: LLM call with tools ──────────────────────────────
    const routing: 'deterministic' | 'llm' = 'llm';
    yield { type: 'turn_start', seq: seq++, turn_id: turnId, routing, stage };

    // Build tool definitions — add draft_graph when generate_model or no usable graph.
    // An empty graph ({ nodes: [], edges: [] }) is truthy but has no model content,
    // so treat zero-node graphs the same as null for draft_graph eligibility.
    //
    // Tool definitions are built BEFORE pre-computing chip labels so that
    // both prompt injection and user-facing chips use the same resolved
    // tool list — no availability mismatch.
    const eligibleActions = [...turnContext.eligible_actions];
    if (turnRequest.generate_model || !turnContext.graph || turnContext.graph_summary.node_count === 0) {
      if (!eligibleActions.includes('draft_graph')) {
        eligibleActions.push('draft_graph');
      }
    }
    // Chip-click bypass for run_analysis: the staleness suppression in
    // tool-builder removes run_analysis whenever fresh analysis results already
    // exist. A user clicking the "Re-run analysis" chip is explicitly asking
    // to override that, so set bypassStaleness when the chip targets
    // run_analysis. The hard prerequisites (graph required) still apply, so
    // a click without a graph still downgrades cleanly.
    const chipAction = turnRequest.chip_metadata?.action_type as ActionName | undefined;
    const bypassStaleness = chipAction === 'run_analysis';
    // On a chip click (forced tool execution), bypass entity disambiguation
    // for the LLM tool set too. The user has already selected a specific
    // action+target via the chip, so LLM target-confusion protection is moot
    // for this turn — and without the bypass, a chip may be visible in the
    // chip set (pre-disambiguation) yet absent from the LLM set, which
    // downgrades the click to "action not available" and breaks the chip
    // contract.
    const isChipClick = !!chipAction;
    const toolDefs = buildToolDefinitions(
      eligibleActions as ActionName[],
      turnContext,
      { bypassStaleness, bypassDisambiguation: isChipClick },
    );
    const resolvedToolNames = toolDefs.map(t => t.name);

    // Chip tool set: pre-disambiguation. Chips carry explicit target_id
    // parameters (pre-computed by the chip engine), so LLM target-confusion
    // protection does not apply. The chip engine's tool-availability filter
    // should validate tool existence only — not LLM-safety mechanisms.
    const chipToolDefs = buildToolDefinitions(
      eligibleActions as ActionName[],
      turnContext,
      { bypassStaleness, bypassDisambiguation: true },
    );
    const chipToolNames: string[] = chipToolDefs.map(t => t.name);

    // Always log the resolved tool set for journey debugging.
    const toolNameSet = new Set(resolvedToolNames);
    const removed = eligibleActions.filter(a => !toolNameSet.has(a) && a !== 'generate_artefact');
    const chipOnlyTools = chipToolNames.filter(t => !toolNameSet.has(t));
    log.info({
      request_id: requestId,
      eligible_count: eligibleActions.length,
      tool_count: toolDefs.length,
      resolved_tools: resolvedToolNames,
      kept_tools: resolvedToolNames,
      removed_tools: removed,
      chip_tool_count: chipToolNames.length,
      // Tools available to chips but not LLM (disambiguation-suppressed for LLM only)
      chip_only_tools: chipOnlyTools,
      has_analysis: !!turnContext.analysis_summary,
      has_graph: !!turnContext.graph && turnContext.graph_summary.node_count > 0,
      disambiguation_hints: turnContext.disambiguation_hints.length,
      bypass_staleness: bypassStaleness,
    }, 'v4.tool_filtering');

    // WS5 (P1.2): precompute chip labels using the resolved tool list so
    // the LLM knows which suggestions the UI will render and avoids
    // duplicating them as inline quoted prose. Pre-execution state (no
    // executed action, no deferred actions yet) is used deliberately —
    // the final envelope chips are recomputed after the LLM call.
    let preComputedChipLabels: string[] = [];
    if (coachingContext && config.cee.chipEngineEnabled !== false) {
      try {
        const preChips = computeChips(coachingContext, sessionState, turnContext, null, [], chipToolNames);
        preComputedChipLabels = preChips.map(c => c.label);
      } catch (err) {
        log.warn({ event: 'v4.precompute_chips_error', error: (err as Error).message }, 'Precomputing chip labels for prompt failed');
      }
    }

    // Build prompt (async — loads from PMS with TTL cache)
    // WS8: pass coaching context + chip labels for dynamic block enrichment
    const prompt = await buildDeterministicPromptV2(turnContext, coachingContext, preComputedChipLabels);

    // Determine tool_choice.
    // Force the chip action when it survived all tool-builder filters
    // (data-availability, staleness with bypass, entity disambiguation, schema
    // validation). If any filter removed it, downgrade to 'auto' so the API
    // call stays valid and the LLM can pick something or respond conversationally.
    const chipActionInTools = chipAction && toolDefs.some(t => t.name === chipAction);
    const toolChoice = chipActionInTools
      ? { type: 'tool' as const, name: chipAction! }
      : { type: 'auto' as const };
    let chipDowngradeText: string | null = null;
    if (chipAction && !chipActionInTools) {
      chipDowngradeText = `That action isn't available right now. ${getDowngradeReason(chipAction, turnContext)}`;
      log.warn({
        request_id: requestId,
        chip_action: chipAction,
        tool_count: toolDefs.length,
      }, 'v4.chip_action_filtered_downgrade: chip action was removed by context filtering, downgrading tool_choice to auto');
    }

    // Build messages
    const conversationContext: ConversationContext = turnRequest.context ?? {
      messages: [],
      framing: { stage: 'frame' },
    };
    const messages = filterHistoryV4(sanitiseAssistantHistory(assembleMessages(conversationContext, effectiveMessage)));

    // Get adapter — task-based routing reads CEE_MODEL_ORCHESTRATOR, auto-detects provider
    const adapter = getAdapter('orchestrator');

    log.info({
      request_id: requestId,
      messages_sent: messages.length,
      system_prompt_chars: prompt.static_block.length + prompt.dynamic_block.length,
      has_cache_blocks: true,
      tool_count: toolDefs.length,
      tool_choice: toolChoice.type === 'tool' ? `forced:${toolChoice.name}` : toolChoice.type,
    }, 'v4.llm_call');

    if (signal?.aborted) return;

    // ── Chip-click pre-text (Task 5) ─────────────────────────────────
    // Yield deterministic text immediately for forced tool calls so the
    // user sees something while the tool executes.
    // Only emit when the chip action survived context filtering (chipActionInTools).
    // Otherwise the pre-text would be misleading — e.g. "Running the analysis now."
    // when run_analysis was filtered out and tool_choice downgraded to auto.
    let chipPreText: string | null = null;
    if (chipActionInTools && CHIP_TEXT_TEMPLATES[chipAction!]) {
      chipPreText = CHIP_TEXT_TEMPLATES[chipAction!](turnContext);
      yield { type: 'text_delta', seq: seq++, delta: chipPreText };
    }

    // Stream the LLM call — empty tool list is valid (model won't call tools)
    // tool_choice only meaningful when tools are present
    const hasTools = toolDefs.length > 0;
    if (!adapter.streamChatWithTools) {
      throw new Error(`Adapter ${adapter.name} does not support streaming tool calls — task 'orchestrator' requires a streaming-capable adapter`);
    }
    const stream = adapter.streamChatWithTools(
      {
        system: `${prompt.static_block}\n\n---\n\n${prompt.dynamic_block}`,
        system_cache_blocks: [
          { type: 'text', text: prompt.static_block, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: prompt.dynamic_block },
        ],
        messages,
        tools: toolDefs,
        ...(hasTools ? { tool_choice: toolChoice } : {}),
        temperature: 0,
        maxTokens: getMaxTokensFromConfig('orchestrator') ?? 4096,
      },
      { requestId, timeoutMs: ORCHESTRATOR_TIMEOUT_MS, signal },
    );

    // Process stream — yields text_delta, tool_start, block, tool_result events.
    // Long-running tools are deferred to the pipeline level (below) for real-time progress.
    const streamGen = processAdapterStream(stream, turnContext, requestId);
    let streamResult: StreamHandlerResult | undefined;

    while (true) {
      const { value, done } = await streamGen.next();
      if (done) {
        streamResult = value;
        break;
      }
      // Forward events with pipeline seq counter
      yield { ...value, seq: seq++ } as OrchestratorStreamEvent;
      if (signal?.aborted) {
        await streamGen.return(undefined as unknown as StreamHandlerResult);
        return;
      }
    }

    if (!streamResult) {
      throw new Error('Stream handler returned no result');
    }

    // ── Execute deferred long-running tool with real-time progress ────
    // The stream handler defers long-running tools so the pipeline can
    // yield progress events between Promise.race ticks.
    let toolExecution: ToolExecution | null = streamResult.toolExecution;
    let failedToolCall = streamResult.failedToolCall;

    if (streamResult.pendingLongRunningTool) {
      const pending = streamResult.pendingLongRunningTool;
      const actionDef = ACTION_CATALOGUE.get(pending.name as ActionName);

      if (actionDef) {
        const toolStartTime = Date.now();
        const progressMessage = PROGRESS_MESSAGES[pending.name as ActionName] ?? 'Processing\u2026';

        try {
          // Race execution against progress ticks — yield real-time progress events
          const execPromise = actionDef.execute(pending.input, turnContext);
          let execDone = false;
          let execResult: import("./types.js").ActionResult | undefined;
          let execError: unknown;

          const wrappedExec = execPromise.then(
            (r) => { execDone = true; execResult = r; },
            (e) => { execDone = true; execError = e; },
          );

          while (!execDone) {
            const tick = new Promise<void>((resolve) => setTimeout(resolve, PROGRESS_INTERVAL_MS));
            await Promise.race([wrappedExec, tick]);

            if (!execDone) {
              yield {
                type: 'progress',
                seq: seq++,
                tool_name: pending.name,
                elapsed_ms: Date.now() - toolStartTime,
                message: progressMessage,
              };
            }

            if (signal?.aborted) break;
          }

          // Await once more to ensure promise is settled
          await wrappedExec;

          if (execError) throw execError;

          const durationMs = Date.now() - toolStartTime;
          toolExecution = {
            toolName: pending.name,
            input: pending.input,
            result: execResult!,
            durationMs,
          };

          for (const block of execResult!.blocks) {
            yield { type: 'block', seq: seq++, block };
          }

          yield {
            type: 'tool_result',
            seq: seq++,
            tool_name: pending.name,
            success: true,
            duration_ms: durationMs,
          };

          log.info({
            request_id: requestId,
            tool_name: pending.name,
            success: true,
            duration_ms: durationMs,
            blocks_produced: execResult!.blocks.length,
          }, 'v4.tool_executed');

        } catch (error) {
          const durationMs = Date.now() - toolStartTime;
          const errorMessage = error instanceof Error ? error.message : String(error);
          failedToolCall = { name: pending.name, error: errorMessage };

          yield {
            type: 'tool_result',
            seq: seq++,
            tool_name: pending.name,
            success: false,
            duration_ms: durationMs,
          };

          log.error({
            request_id: requestId,
            tool_name: pending.name,
            duration_ms: durationMs,
            error: errorMessage,
          }, 'v4.tool_execution_failed');
        }
      }
    }

    const llmDurationMs = Date.now() - startTime;

    log.info({
      request_id: requestId,
      response_text_chars: streamResult.assistantText.length,
      tool_calls_count: toolExecution ? 1 : 0,
      discarded_tool_calls: streamResult.discardedToolCalls.length,
      extraction_method: 'native_tool_use',
      duration_ms: llmDurationMs,
    }, 'v4.llm_call');

    // ── Assemble response ─────────────────────────────────────────────
    const executedAction = toolExecution?.toolName as ActionName ?? null;
    const actionResult = toolExecution?.result ?? null;

    // ── Post-draft state recomputation ─────────────────────────────
    // After draft_graph produces a graph, recompute pipeline state so the
    // composer, chip engine, and stage indicator see the post-draft graph.
    // Pre-draft: stage=frame, coaching_mode=orient, eligible_actions=[],
    //   resolvedToolNames=["draft_graph"], coaching signals all null.
    // Post-draft: stage=ideate, coaching has tradeoff/inference signals,
    //   eligible_actions includes edit actions, chips can pass tool filter.
    let postDraftRecomputed = false;
    if (
      actionResult?.fact?.action === 'draft_created'
      && actionResult.applied_graph
      && !actionResult.failure
    ) {
      try {
        // Rebuild turn context with the post-draft graph on context.graph.
        // A new draft invalidates any prior analysis — the analysis was
        // computed against a previous graph structure, so carrying it
        // forward would mis-infer the stage as 'evaluate' when the user
        // has just rebuilt their model (should be 'ideate'). Clear both
        // analysis_response and analysis_inputs; they must be recomputed
        // against the new graph via a fresh run_analysis.
        const postDraftRequest: OrchestratorTurnRequest = {
          ...turnRequest,
          context: {
            ...turnRequest.context,
            graph: actionResult.applied_graph,
            analysis_response: null,
            analysis_inputs: null,
          },
          analysis_state: null,
        };
        const postDraftContext = computeTurnContext(postDraftRequest);
        postDraftContext.turn_id = turnId;
        postDraftContext.request = fastifyRequest;
        postDraftContext.signal = signal;

        // Rebuild coaching context with post-draft graph signals
        if (config.cee.coachingContextEnabled) {
          try {
            coachingContext = buildCoachingContext(postDraftContext, sessionState);
          } catch (err) {
            log.warn({ event: 'v4.post_draft_coaching_error', error: (err as Error).message }, 'Post-draft coaching context rebuild failed');
          }
        }

        // Rebuild tool set with post-draft eligible actions
        const postDraftEligible = [...postDraftContext.eligible_actions];
        if (!postDraftEligible.includes('draft_graph')) {
          postDraftEligible.push('draft_graph');
        }
        const postDraftToolDefs = buildToolDefinitions(postDraftEligible as ActionName[], postDraftContext);
        resolvedToolNames.length = 0;
        resolvedToolNames.push(...postDraftToolDefs.map(t => t.name));

        // Rebuild chip tool set (pre-disambiguation) for chip engine
        const postDraftChipToolDefs = buildToolDefinitions(
          postDraftEligible as ActionName[],
          postDraftContext,
          { bypassDisambiguation: true },
        );
        chipToolNames.length = 0;
        chipToolNames.push(...postDraftChipToolDefs.map(t => t.name));

        // Update turnContext for downstream consumers (stage_indicator, chips, envelope)
        Object.assign(turnContext, postDraftContext);
        computedStage = turnContext.stage;
        postDraftRecomputed = true;

        log.info({
          request_id: requestId,
          post_draft_stage: turnContext.stage,
          post_draft_node_count: turnContext.graph_summary.node_count,
          post_draft_eligible_actions: turnContext.eligible_actions,
          post_draft_resolved_tools: resolvedToolNames,
          post_draft_chip_tools: chipToolNames,
          coaching_tradeoff: !!coachingContext?.tradeoff,
          coaching_biggest_inference: !!coachingContext?.biggest_inference,
        }, 'v4.post_draft_recomputation');

        // Override block.data.summary on the graph_patch block using the
        // deterministic post-draft CoachingContext when available. The draft
        // handler runs BEFORE recomputation, so block.data.summary was built
        // from LLM coaching or fell back to count jargon. We only overwrite
        // when the existing summary is degraded (empty, count-jargon, or the
        // generic fallback) — never replace a good LLM coaching summary.
        try {
          maybeOverridePatchSummary(actionResult, coachingContext);
        } catch (err) {
          log.warn(
            { event: 'v4.post_draft_summary_override_error', error: (err as Error).message },
            'Post-draft summary override threw — leaving block summary unchanged',
          );
        }
      } catch (err) {
        log.warn({ event: 'v4.post_draft_recompute_error', error: (err as Error).message }, 'Post-draft recomputation failed — using pre-draft state');
      }
    }

    // ── Post-analysis state recomputation ──────────────────────────────
    // After run_analysis produces an analysis_response, recompute pipeline
    // state so the stage indicator, chip engine, and tool set see the
    // post-analysis context.
    // Pre-analysis: stage=ideate, can_explain_results=false, edit-only tools.
    // Post-analysis: stage=evaluate, explanation tools available, chips
    //   shift to interpret/decide bundles.
    let postAnalysisRecomputed = false;
    void postAnalysisRecomputed; // parity with postDraftRecomputed — reserved for downstream gating
    if (
      actionResult?.fact?.action === 'analysis_complete'
      && actionResult.analysis_response
      && !actionResult.failure
    ) {
      try {
        // Rebuild turn context with the post-analysis response on context.analysis_response.
        // Apply normalizeAnalysisEnvelope to match the entry-normalisation pattern —
        // computeTurnContext expects the canonical shape (results/factor_sensitivity
        // projected from evolving UI-forwarded shapes).
        const normalisedAnalysis = normalizeAnalysisEnvelope(
          actionResult.analysis_response as import("../types.js").V2RunResponseEnvelope,
        );
        const postAnalysisRequest: OrchestratorTurnRequest = {
          ...turnRequest,
          context: {
            ...turnRequest.context,
            analysis_response: normalisedAnalysis,
          },
        };
        const postAnalysisContext = computeTurnContext(postAnalysisRequest);
        postAnalysisContext.turn_id = turnId;
        postAnalysisContext.request = fastifyRequest;
        postAnalysisContext.signal = signal;

        // Rebuild coaching context with post-analysis signals
        if (config.cee.coachingContextEnabled) {
          try {
            coachingContext = buildCoachingContext(postAnalysisContext, sessionState);
          } catch (err) {
            log.warn({ event: 'v4.post_analysis_coaching_error', error: (err as Error).message }, 'Post-analysis coaching context rebuild failed');
          }
        }

        // Rebuild tool set with post-analysis eligible actions
        const postAnalysisEligible = [...postAnalysisContext.eligible_actions];
        const postAnalysisToolDefs = buildToolDefinitions(postAnalysisEligible as ActionName[], postAnalysisContext);
        resolvedToolNames.length = 0;
        resolvedToolNames.push(...postAnalysisToolDefs.map(t => t.name));

        // Rebuild chip tool set (pre-disambiguation) for chip engine
        const postAnalysisChipToolDefs = buildToolDefinitions(
          postAnalysisEligible as ActionName[],
          postAnalysisContext,
          { bypassDisambiguation: true },
        );
        chipToolNames.length = 0;
        chipToolNames.push(...postAnalysisChipToolDefs.map(t => t.name));

        // Update turnContext for downstream consumers (stage_indicator, chips, envelope)
        Object.assign(turnContext, postAnalysisContext);
        computedStage = turnContext.stage;
        postAnalysisRecomputed = true;

        log.info({
          request_id: requestId,
          post_analysis_stage: turnContext.stage,
          post_analysis_eligible_actions: turnContext.eligible_actions,
          post_analysis_resolved_tools: resolvedToolNames,
          post_analysis_chip_tools: chipToolNames,
        }, 'v4.post_analysis_recomputation');
      } catch (err) {
        log.warn({ event: 'v4.post_analysis_recompute_error', error: (err as Error).message }, 'Post-analysis recomputation failed — stage may stay at ideate');
      }
    }

    // Surface tool failure in the envelope when no text was produced.
    // NOTE: This text intentionally matches ERROR_PATTERNS in history-filter-v4.ts
    // so failed tool turns are excluded from conversation history.
    //
    // Trim leading/trailing whitespace because stream-handler-v4 accumulates
    // every text_delta including pathological whitespace-only deltas from
    // Sonnet 4.6. Preserving leading whitespace would produce envelope text
    // like `"\nActual headline."` once the chip pre-text is prepended.
    const rawAssistantText = streamResult.assistantText.trim();
    let assistantText: string | null = rawAssistantText.length > 0 ? rawAssistantText : null;
    let responseSource: 'composer' | 'legacy_handler' | 'llm_only' = assistantText ? 'llm_only' : 'legacy_handler';

    // ── WS2: Response composer (replaces handler text when fact is present) ─
    // When the action handler emitted a structured HandlerFact, run the
    // composer to produce decision-language text that replaces both the
    // handler's legacy assistantText AND any LLM-generated text for this
    // turn. The composer reads coachingContext, so it is gated on the
    // coaching-context feature flag.
    //
    // IMPORTANT: This runs BEFORE the empty-text injection below, so the
    // fallback-template path only fires when there is no fact AND no text.
    if (
      config.cee.coachingContextEnabled
      && actionResult?.fact
      && !actionResult.failure
      && !failedToolCall
    ) {
      try {
        // Detect whether this turn will emit a visible graph_patch card.
        // Draft handler pre-creates blocks; edit actions populate operations
        // (the block is created later at line ~884).
        const hasPatchBlock =
          (actionResult.blocks ?? []).some(b => b.block_type === 'graph_patch')
          || (actionResult.operations?.length ?? 0) > 0;

        const composed = composeResponse(actionResult.fact, coachingContext, hasPatchBlock);
        if (composed && composed.trim().length > 0) {
          assistantText = composed;
          responseSource = 'composer';
        }
      } catch (err) {
        log.warn(
          { event: 'v4.response_composer_error', error: (err as Error).message, action: actionResult.fact.action },
          'Response composer threw — falling back to handler text',
        );
      }
    }

    // ── Text injection for empty LLM responses (Task 3) ──────────────
    // When a tool executed successfully but the LLM produced no text,
    // inject text so no turn reaches the UI with a tool execution but no
    // assistant text. Note: as of Fix 1+2, the stream handler already
    // injects the tool handler's `assistantText` as a text_delta BEFORE
    // the block/tool_result events (preserving the required ordering), so
    // `streamResult.assistantText` will typically already carry the
    // handler text. This block only fires when BOTH the LLM and the tool
    // handler produced no text — a genuinely degenerate path — in which
    // case we fall back to a static template for envelope text only. We
    // intentionally do NOT yield a text_delta here because the block has
    // already been sent and a late delta would violate the event ordering
    // text_delta → block → tool_result.
    if ((!assistantText || !assistantText.trim()) && toolExecution && !failedToolCall) {
      responseSource = 'legacy_handler';
      if (toolExecution.result.assistantText) {
        assistantText = toolExecution.result.assistantText;
      } else {
        const templateText = TOOL_RESULT_TEXT_TEMPLATES[toolExecution.toolName];
        if (templateText) {
          assistantText = templateText;
        }
      }
    }

    // Prepend chip pre-text to assistantText so it enters the envelope.
    // Skip if LLM text already contains the pre-text (e.g. LLM echoed the template).
    if (chipPreText) {
      if (!assistantText || !assistantText.includes(chipPreText)) {
        assistantText = assistantText
          ? `${chipPreText}\n\n${assistantText}`
          : chipPreText;
      }
    }

    if (failedToolCall) {
      const errorText = "That action couldn't be completed. Try a different approach or rephrase your request.";
      if (!assistantText || !assistantText.trim()) {
        // No text at all — set outright.
        assistantText = errorText;
      } else {
        // Text is present (from LLM or chip pre-text) — always append the error sentinel
        // so history-filter-v4 can match ERROR_PATTERNS and drop this turn from history.
        // Without this, a failed turn with non-empty LLM text would appear to be a
        // success message in the next LLM call's conversation context.
        assistantText = `${assistantText}\n\n${errorText}`;
        if (chipPreText) {
          // Chip pre-text was already streamed as a delta — emit the error as a
          // follow-up delta so the streaming client also sees the failure.
          yield { type: 'text_delta', seq: seq++, delta: `\n\n${errorText}` };
        }
      }
    }

    // Prepend chip downgrade explanation when a chip action was unavailable.
    // Only prepend when the text doesn't already start with the downgrade string.
    if (chipDowngradeText) {
      if (!assistantText || !assistantText.startsWith(chipDowngradeText)) {
        assistantText = assistantText
          ? `${chipDowngradeText}\n\n${assistantText}`
          : chipDowngradeText;
      }
    }

    // Compound action acknowledgement: surface discarded tool calls as
    // deferred chips so the user can resume the unfulfilled intent. The
    // one-tool-per-turn policy means subsequent calls were silently dropped;
    // exposing them as top-priority chips preserves user intent without
    // changing the LLM's tool call behaviour.
    const deferredActions = streamResult.discardedToolCalls
      .map((d) => d.name as ActionName)
      .filter((name) => name !== executedAction);

    // Sanitise user-facing text before envelope assembly
    if (assistantText) {
      assistantText = sanitiseAssistantText(assistantText);
    }

    // WS6: Advance session state after action execution
    const actionOutcome = executedAction === 'set_factor_value' && streamResult.toolExecution?.input
      ? { calibrated_factor_id: streamResult.toolExecution.input.target_id as string | undefined }
      : undefined;
    const updatedSessionState = config.cee.coachingContextEnabled
      ? advanceSessionState(sessionState, executedAction, turnContext, actionOutcome)
      : null;

    const envelope = assembleV4Envelope({
      turnContext,
      turnId,
      requestId,
      executionClass,
      assistantText,
      actionResult,
      routing,
      executedAction,
      contextFallbackUsed,
      llmLatencyMs: llmDurationMs,
      deferredActions,
      coachingContext,
      sessionState: updatedSessionState ?? sessionState,
      availableTools: chipToolNames,
      responseSource,
    });

    // WS6: Attach updated session state to envelope for UI round-trip.
    // Capture the chip_ids produced this turn so the next turn's
    // chip_ids_shown_prev_turn + last_chip_ids_shown drive the 2-turn
    // suppression window deterministically.
    if (updatedSessionState) {
      const chipIds = getChipIdsForSession(envelope.suggested_actions ?? []);
      const stateForRoundTrip = chipIds.length > 0
        ? updateLastChipIds(updatedSessionState, chipIds)
        : updatedSessionState;
      (envelope as unknown as Record<string, unknown>).updated_session_state = stateForRoundTrip;
    }

    // Telemetry: response and chip source for debugging
    const useChipEngine =
      config.cee.chipEngineEnabled !== false
      && coachingContext != null
      && (updatedSessionState ?? sessionState) != null;
    const chipSource: 'chip_engine' | 'legacy' | 'none' = useChipEngine
      ? 'chip_engine'
      : (envelope.suggested_actions?.length ?? 0) > 0 ? 'legacy' : 'none';
    log.info({
      event: 'v4.turn_sources',
      request_id: requestId,
      turn_id: turnId,
      response_source: responseSource,
      chip_source: chipSource,
      chip_count: envelope.suggested_actions?.length ?? 0,
      executed_action: executedAction,
    }, 'Turn response and chip sources');

    yield { type: 'turn_complete', seq: seq++, envelope };

  } catch (error) {
    // Emit error event
    const errorCode = resolveErrorCode(error);
    const rawErrorMessage = error instanceof Error ? error.message : String(error);
    const graphNodes = (turnRequest.context?.graph as Record<string, unknown> | null)?.nodes;
    const hasGraph = turnRequest.context?.graph != null && Array.isArray(graphNodes) && (graphNodes as unknown[]).length > 0;
    const isDraftGraphLikely = turnRequest.generate_model || !hasGraph;
    const userFacingMessage = getUserFacingErrorMessage(errorCode, isDraftGraphLikely);

    yield {
      type: 'error',
      seq: seq++,
      error: { code: errorCode, message: userFacingMessage },
      recoverable: errorCode !== STREAM_ERROR_CODES.PIPELINE_ERROR,
    };

    // Log full raw error at error level for debugging — never surface to user
    log.error({
      request_id: requestId,
      turn_id: turnId,
      error_code: errorCode,
      error: rawErrorMessage,
      duration_ms: Date.now() - startTime,
    }, 'v4.pipeline_error');

    // Use computed stage if available (error after stage inference),
    // otherwise fall back to framing stage or 'frame'.
    const errorStage = computedStage ?? turnRequest.context?.framing?.stage ?? 'frame';

    // Emit error envelope as turn_complete for UI consistency
    const errorEnvelope = {
      turn_id: turnId,
      assistant_text: userFacingMessage,
      blocks: [],
      lineage: { context_hash: '' },
      turn_plan: { selected_tool: null, routing: 'llm' as const, long_running: false },
      stage_indicator: { stage: errorStage, confidence: 'low' as const, source: 'inferred' as const },
      suggested_actions: [],
      response_version: 2,
      guidance_items: [],
      error: {
        code: errorCode,
        message: userFacingMessage,
        recoverable: errorCode !== STREAM_ERROR_CODES.PIPELINE_ERROR,
      },
    } as unknown as OrchestratorResponseEnvelopeV2;

    yield { type: 'turn_complete', seq: seq++, envelope: errorEnvelope };
  }
}

// ============================================================================
// Response Assembly
// ============================================================================

export interface AssembleInput {
  turnContext: DeterministicTurnContext;
  turnId: string;
  requestId: string;
  executionClass: string;
  assistantText: string | null;
  actionResult: ActionResult | null;
  routing: 'deterministic' | 'llm';
  executedAction: ActionName | null;
  contextFallbackUsed: boolean;
  llmLatencyMs?: number;
  /** Tool names the LLM tried to call beyond the one-tool-per-turn limit. */
  deferredActions?: ActionName[];
  /** WS1/WS5: coaching context for chip-engine input. */
  coachingContext?: CoachingContext | null;
  /** WS6/WS5: session state for chip suppression. */
  sessionState?: SessionState | null;
  /** Resolved tool names for chip availability filtering. */
  availableTools?: readonly string[];
  /** When 'composer', the assistantText was produced by the response composer
   *  and should NOT be concatenated with actionResult.assistantText. */
  responseSource?: 'composer' | 'legacy_handler' | 'llm_only';
}

/**
 * Assemble the v4 response envelope.
 *
 * Chips are built deterministically — no LLM input.
 * Assistant text comes directly from LLM text blocks (never JSON).
 */
export function assembleV4Envelope(input: AssembleInput): OrchestratorResponseEnvelopeV2 {
  const {
    turnContext,
    turnId,
    requestId,
    executionClass,
    assistantText: rawAssistantText,
    actionResult,
    routing,
    executedAction,
    contextFallbackUsed: _contextFallbackUsed,
    llmLatencyMs,
    deferredActions = [],
    coachingContext = null,
    sessionState = null,
    availableTools = [],
    responseSource,
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
        tool_name: executedAction ?? 'unknown',
      },
      'Deterministic action returned structured failure',
    );
  }

  // Combine assistant text: failure user_message wins; composer text is
  // authoritative when present; otherwise action confirmation first, raw
  // LLM text second.
  let assistantText: string | null;
  if (actionResult?.failure) {
    assistantText = actionResult.failure.user_message;
  } else if (responseSource === 'composer') {
    // Composer text is authoritative — do not prepend handler count text.
    assistantText = rawAssistantText;
  } else {
    assistantText = rawAssistantText;
    if (actionResult?.assistantText && rawAssistantText) {
      const alreadyContains = rawAssistantText === actionResult.assistantText
        || rawAssistantText.includes(actionResult.assistantText);
      if (!alreadyContains) {
        assistantText = `${actionResult.assistantText}\n\n${rawAssistantText}`;
      }
    } else if (actionResult?.assistantText) {
      assistantText = actionResult.assistantText;
    }
  }

  // Build blocks. On failure: skip action.blocks too, since we don't want
  // ANY block leaking through alongside a CAP_EXCEEDED-style message.
  const blocks = actionResult?.failure ? [] : [...(actionResult?.blocks ?? [])];

  // Emit graph_patch block for graph-mutating actions. Skipped on failure.
  let emittedProposalBlock = false;
  if (!actionResult?.failure && actionResult?.operations && actionResult.operations.length > 0) {
    // T4: label-aware semantic patch summary using the pre-mutation graph
    // for label resolution. Falls back to count-based on resolution failure.
    const patchSummary = sanitiseAssistantText(buildPatchSummary(
      actionResult.operations,
      null,
      'edit',
      turnContext.graph ?? null,
    ), { preserveBold: true });
    // Fix 5: emit the past-tense variant so the UI can render the accepted
    // card without a patch_accepted round-trip. Optional and additive.
    const patchAppliedSummary = sanitiseAssistantText(buildPatchSummary(
      actionResult.operations,
      null,
      'accepted',
      turnContext.graph ?? null,
    ), { preserveBold: true });
    const patchBlock = createGraphPatchBlock(
      {
        patch_type: 'edit',
        operations: actionResult.operations,
        status: 'proposed',
        auto_apply: false,
        applied_graph_hash: actionResult.applied_graph_hash,
        applied_graph: actionResult.applied_graph,
        summary: patchSummary,
        applied_summary: patchAppliedSummary,
        // Propagate recomputed analysis_ready from the action handler.
        // Without this, downstream consumers (UI / next-turn run_analysis)
        // see the previous turn's stale view and PLoT rejects with
        // EMPTY_INTERVENTIONS — see add-option.ts for why this matters.
        ...(actionResult.analysis_ready ? { analysis_ready: actionResult.analysis_ready } : {}),
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
  // phrases ("Adding now", "I've added", "Setting X to Y"). On match, append
  // a corrective suffix and log telemetry.
  if (emittedProposalBlock && assistantText) {
    const guardResult = enforceProposalLanguage(
      assistantText,
      executedAction ?? 'deterministic',
    );
    if (guardResult.leaked && guardResult.suffixed) {
      assistantText = guardResult.suffixed;
    }
  }

  // T3: post-mutation health gate. Advisory — never blocks the response.
  // Builds a post-mutation graph (using actionResult.applied_graph when
  // available, otherwise the canonical applyPatchOperations from
  // patch-applier.ts) and checks for NEW structural violations, option
  // readiness degradation on existing options, and duplicate option labels.
  // On any issue, append a note to assistant text and downgrade
  // rerun_recommended on the patch block.
  if (
    !actionResult?.failure &&
    actionResult?.operations &&
    actionResult.operations.length > 0 &&
    turnContext.graph
  ) {
    try {
      const postGraph =
        actionResult.applied_graph ??
        applyPatchOperations(turnContext.graph, actionResult.operations);
      const health = assessMutationHealth(
        turnContext.graph,
        postGraph,
        actionResult.operations,
      );
      if (!health.healthy) {
        const issueText = health.issues.slice(0, 3).map((i) => `- ${i}`).join('\n');
        const hasExistingText = assistantText != null && assistantText.trim().length > 0;
        const prefix = hasExistingText ? `${assistantText}\n\n` : '';
        assistantText = `${prefix}Note:\n${issueText}\nYou may need to address these before running analysis.`;
        // Downgrade rerun_recommended on the just-pushed patch block.
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.block_type === 'graph_patch') {
          const data = (lastBlock as unknown as { data: Record<string, unknown> }).data;
          data.rerun_recommended = false;
        }
        log.warn(
          {
            event: 'v4.mutation_health_warning',
            issues: health.issues,
            tool_name: executedAction ?? 'unknown',
          },
          'Post-mutation health gate raised issues',
        );
      }
    } catch (err) {
      // Advisory — never let it break response assembly.
      log.warn(
        { event: 'v4.mutation_health_error', error: (err as Error).message },
        'Post-mutation health gate threw — skipping',
      );
    }
  }

  // Build chips deterministically — no LLM input.
  // Deferred actions (compound calls dropped by one-tool-per-turn) are
  // promoted to the front so the user can resume the unfulfilled intent.
  //
  // WS5: when the chip engine is enabled and a coaching context was built,
  // use the typed chip engine to produce decision-language chips. Falls
  // back to the legacy tool-name chip builder when the flag is off or the
  // coaching context is absent (e.g. fallback context path).
  const useChipEngine =
    config.cee.chipEngineEnabled !== false
    && coachingContext != null
    && sessionState != null;

  // Extract analysis_ready.status from the current turn's graph_patch block
  // (set on draft_graph / edit_graph) so the chip engine can suppress
  // 'Run analysis' when the model isn't ready to run.
  //
  // Fix 4: on conversational turns (no graph-mutating action), the action
  // result carries no readiness block. Without a fallback the gate reads
  // null → chip engine treats it as "no constraint" and surfaces the
  // Run Analysis chip on un-ready graphs. Fall back to the prior graph
  // state: prefer analysis_ready carried on turnRequest.context.graph,
  // then recompute structural readiness from the current graph. The
  // fallback preserves null only when no graph exists.
  const analysisReadyStatus =
    extractAnalysisReadyStatusFromResult(actionResult)
    ?? deriveAnalysisReadyStatusFallback(turnContext);

  const suggestedActions = useChipEngine
    ? computeChips(coachingContext!, sessionState!, turnContext, executedAction, deferredActions, availableTools, analysisReadyStatus)
    : buildDeterministicChips(turnContext, executedAction, deferredActions);

  // Sanitise chip labels and prompts (belt-and-braces — engine already sanitises).
  for (const chip of suggestedActions) {
    if (chip.label) chip.label = sanitiseAssistantText(chip.label);
    if (chip.prompt) chip.prompt = sanitiseAssistantText(chip.prompt);
  }

  // Build lineage
  const lineage = {
    context_hash: computeContextHash({
      graph: null,
      analysis_response: null,
      framing: turnContext.stage ? { stage: turnContext.stage } : null,
    }),
    ...(actionResult?.applied_graph_hash ? { graph_hash: actionResult.applied_graph_hash } : {}),
  };

  // Build turn plan
  const executedTools = executedAction ? [executedAction] : [];
  const turnPlan = {
    selected_tool: executedAction,
    routing,
    long_running: executedAction === 'run_analysis' || executedAction === 'draft_graph',
    ...(llmLatencyMs != null ? { tool_latency_ms: llmLatencyMs } : {}),
    executed_tools: executedTools,
    deferred_tools: deferredActions as string[],
  };

  // Collect guidance items
  let guidanceItems: GuidanceItem[] = [...(actionResult?.guidance_items ?? [])];
  if (
    (executedTools.includes('run_analysis') || executedTools.includes('explain_result')) &&
    turnContext.analysis &&
    guidanceItems.length === 0
  ) {
    try {
      const postAnalysis = generatePostAnalysisGuidance(turnContext.analysis, turnContext.graph);
      if (postAnalysis.length > 0) {
        guidanceItems = [...guidanceItems, ...postAnalysis];
      }
    } catch (error) {
      // Non-fatal — guidance items are nice-to-have, not required for the turn.
      // Log so silent regressions in generatePostAnalysisGuidance are visible.
      const analysisStatus = typeof (turnContext.analysis as Record<string, unknown> | null)?.analysis_status === 'string'
        ? (turnContext.analysis as Record<string, unknown>).analysis_status
        : null;
      log.warn({
        request_id: requestId,
        turn_id: turnId,
        stage: turnContext.stage,
        analysis_status: analysisStatus,
        error: error instanceof Error ? error.message : String(error),
      }, 'v4.post_analysis_guidance_failed');
    }
  }

  // Assemble envelope. Mirror failure_code / failure_recovery_hint onto the
  // envelope so future history threading and UI hint surfaces can read them
  // without reworking the response shape.
  const envelope = {
    turn_id: turnId,
    assistant_text: assistantText,
    blocks,
    suggested_actions: suggestedActions,
    analysis_response: actionResult?.analysis_response,
    // Mirror analysis_ready at the top-level envelope as well as on the
    // graph_patch block above. Some UI consumers read it from the envelope,
    // others from the patch block — populate both to keep them in sync.
    // Skipped on failure (no analysis_ready in a failure envelope).
    ...(!actionResult?.failure && actionResult?.analysis_ready
      ? { analysis_ready: actionResult.analysis_ready }
      : {}),
    lineage,
    turn_plan: turnPlan,
    stage_indicator: {
      stage: turnContext.stage,
      confidence: 'high' as const,
      source: 'inferred' as const,
    },
    response_version: 2 as const,
    guidance_items: guidanceItems,
    ...(failureCode ? { failure_code: failureCode } : {}),
    ...(failureRecoveryHint ? { failure_recovery_hint: failureRecoveryHint } : {}),
  };

  // Apply normaliser (cast: V4 envelope uses structured stage_indicator, normaliser expects V1 type)
  const normalised = normaliseDeterministicResponse(envelope as unknown as import("../types.js").OrchestratorResponseEnvelope, {
    v4Context: { request_id: requestId, turn_id: turnId, execution_class: executionClass },
  });

  // Belt-and-braces: sanitise ALL user-facing text fields on the assembled
  // envelope. Catches any em dashes, banned terms, or artefacts that slipped
  // through per-field sanitisation above (e.g. text injected by normaliser,
  // block titles, or composer-generated strings added after the per-field pass).
  sanitiseEnvelopeText(normalised as unknown as Record<string, unknown>);

  // Outbound contract validation (warn-only, never blocks response)
  validateEnvelope(normalised as unknown as Record<string, unknown>, turnId);

  // Scan banned terms
  scanBannedTerms(
    null, // no LLM JSON response — text comes from native tool-use
    normalised,
    turnContext.scenario_id,
    turnId,
  );

  return normalised as unknown as OrchestratorResponseEnvelopeV2;
}

// ============================================================================
// Outbound Envelope Validation
// ============================================================================

/**
 * Lightweight contract validation for the v4 response envelope.
 * Logs warnings but never blocks the response — observational only.
 */

/** Must match DecisionStage in ../types.ts */
const VALID_STAGES = new Set(['frame', 'ideate', 'evaluate', 'decide', 'optimise']);

export function validateEnvelope(envelope: Record<string, unknown>, turnId: string): void {
  const warnings: string[] = [];

  // assistant_text: null or non-empty string (never undefined or empty string)
  const text = envelope.assistant_text;
  if (text === undefined) {
    warnings.push('assistant_text is undefined (should be null or non-empty string)');
  } else if (text !== null && (typeof text !== 'string' || text.trim().length === 0)) {
    warnings.push(`assistant_text is empty string (should be null or non-empty), got: ${JSON.stringify(text)}`);
  }

  // blocks: must be array
  if (!Array.isArray(envelope.blocks)) {
    warnings.push(`blocks is not an array, got: ${typeof envelope.blocks}`);
  } else {
    for (let i = 0; i < (envelope.blocks as unknown[]).length; i++) {
      const block = (envelope.blocks as Record<string, unknown>[])[i];
      if (!block.block_type) warnings.push(`blocks[${i}] missing block_type`);
      if (!block.block_id) warnings.push(`blocks[${i}] missing block_id`);
    }
  }

  // turn_plan.routing
  const turnPlan = envelope.turn_plan as Record<string, unknown> | undefined;
  if (turnPlan) {
    if (turnPlan.routing !== 'llm' && turnPlan.routing !== 'deterministic') {
      warnings.push(`turn_plan.routing is "${String(turnPlan.routing)}", expected "llm" or "deterministic"`);
    }
  }

  // stage_indicator: must be an object with a valid stage field
  const stageInd = envelope.stage_indicator;
  if (stageInd === undefined || stageInd === null) {
    warnings.push('stage_indicator is missing');
  } else if (typeof stageInd === 'object' && 'stage' in stageInd) {
    const stageVal = (stageInd as Record<string, unknown>).stage;
    if (typeof stageVal !== 'string' || !VALID_STAGES.has(stageVal)) {
      warnings.push(`stage_indicator.stage is "${String(stageVal)}", expected one of: ${[...VALID_STAGES].join(', ')}`);
    }
  } else if (typeof stageInd === 'string') {
    // Backwards-compatible: accept bare string but warn
    if (!VALID_STAGES.has(stageInd)) {
      warnings.push(`stage_indicator is "${stageInd}", expected one of: ${[...VALID_STAGES].join(', ')}`);
    }
  } else {
    warnings.push(`stage_indicator is ${typeof stageInd}, expected an object with stage field`);
  }

  // response_version is 2
  if (envelope.response_version !== 2) {
    warnings.push(`response_version is ${String(envelope.response_version)}, expected 2`);
  }

  if (warnings.length > 0) {
    log.warn({ turn_id: turnId, violations: warnings }, 'v4.envelope_validation_warnings');
  }
}

// ============================================================================
// Helpers
// ============================================================================

function determineExecutionClass(
  turnRequest: OrchestratorTurnRequest,
  _turnContext: DeterministicTurnContext,
  effectiveMessage: string,
): string {
  if (turnRequest.system_event) return 'system_event';
  if (turnRequest.chip_metadata?.action_type) return 'forced_tool';
  if (turnRequest.generate_model) return 'generate_model';
  if (!effectiveMessage) return 'empty_message';
  return 'standard_turn';
}

function buildFallbackContext(turnRequest: OrchestratorTurnRequest, turnId: string): DeterministicTurnContext {
  return {
    stage: turnRequest.context?.framing?.stage ?? 'frame',
    entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null },
    graph_summary: { node_count: 0, edge_count: 0, option_count: 0, option_labels: [], goal_label: null, missing_structural: [] },
    analysis_summary: null,
    capabilities: { can_run_analysis: false, can_explain_results: false, can_edit_graph: false, can_compare_options: false, can_challenge: false, can_generate_artefact: false },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 0, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: [],
    disambiguation_hints: [],
    graph: turnRequest.context?.graph ?? null,
    analysis: turnRequest.context?.analysis_response ?? null,
    conversational_state: null,
    messages: Array.isArray(turnRequest.context?.messages) ? turnRequest.context.messages : [],
    scenario_id: turnRequest.scenario_id ?? '',
    turn_id: turnId,
    analysis_inputs: null,
    request: undefined,
    user_currency_hint: null,
  };
}

function getDowngradeReason(action: string, ctx: DeterministicTurnContext): string {
  // Check blockers first — they carry the most specific reason
  const blocker = ctx.blockers.find((b) => b.action_type === action);
  if (blocker) return blocker.reason;

  // Stage-specific fallbacks for common chip actions
  if (action === 'run_analysis' && (ctx.stage === 'frame' || ctx.stage === 'ideate')) {
    return "Analysis isn't available during the modelling phase. Continue building your model, then analysis will become available.";
  }
  if ((action === 'explain_result' || action === 'compare_options' || action === 'what_would_flip') && !ctx.analysis_summary) {
    return 'Run the analysis first to unlock this action.';
  }

  return 'Try a different action or continue refining your model.';
}

function resolveErrorCode(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return STREAM_ERROR_CODES.TURN_BUDGET_EXCEEDED;
    if (error.message.includes('timeout')) return STREAM_ERROR_CODES.LLM_TIMEOUT;
    // Tool execution errors are caught by the inner handler (line ~383) and
    // surfaced via failedToolCall — they never reach this outer catch block.
    // Errors that DO reach here are LLM adapter or pipeline-level failures.
    if (error.message.includes('tool_execution_failed') || error.message.includes('action handler')) {
      return STREAM_ERROR_CODES.TOOL_ERROR;
    }
  }
  return STREAM_ERROR_CODES.PIPELINE_ERROR;
}

/** Map error codes to clean user-facing messages. Raw error details are never surfaced. */
function getUserFacingErrorMessage(errorCode: string, isDraftGraph?: boolean): string {
  switch (errorCode) {
    case STREAM_ERROR_CODES.LLM_TIMEOUT:
    case STREAM_ERROR_CODES.TURN_BUDGET_EXCEEDED:
      return isDraftGraph
        ? 'Building your decision model is taking longer than usual. Please try again — complex decisions can take up to a minute.'
        : 'This is taking longer than expected. Try again or rephrase your message.';
    case STREAM_ERROR_CODES.TOOL_ERROR:
      return "That action couldn't be completed. Try a different approach or rephrase your request.";
    default:
      return 'Something went wrong while processing your request. Please try again.';
  }
}

// ============================================================================
// Post-draft summary override
// ============================================================================

/**
 * Matches count-jargon summaries of the form "N factors" / "N nodes" /
 * "N edges" / "N connections" (e.g. "Added 5 factors, 3 options, and 24
 * connections"). Spec-scoped per the Pattern A correction brief: the
 * override must not rewrite summaries that merely mention option / goal /
 * outcome / risk / constraint counts without also leaking patch-machinery
 * terms, so those nouns are intentionally excluded from this regex.
 */
const COUNT_JARGON_RE = /\d+\s*(factors?|nodes?|edges?|connections?)/i;

/**
 * Single generic fallback string that the override is allowed to replace.
 * Spec-scoped: the override never rewrites "Created a new decision model."
 * or "Applied graph changes." — those belong to edit/accepted contexts and
 * are handled by Fix 6 in buildPatchSummary.
 */
const GENERIC_SUMMARY_FALLBACKS = new Set<string>([
  'Review the proposed model.',
]);

/**
 * Replace the graph_patch block's `data.summary` with a coaching-derived
 * sentence when the existing summary is degraded (empty / count-jargon /
 * generic fallback). Always preserves a substantive LLM coaching summary.
 *
 * Emits `v4.post_draft_summary_override` with original/replacement/reason
 * whenever it rewrites. Emits nothing when it leaves the summary alone.
 */
function maybeOverridePatchSummary(
  actionResult: ActionResult,
  coachingContext: CoachingContext | null,
): void {
  const block = (actionResult.blocks ?? []).find((b) => b.block_type === 'graph_patch');
  if (!block || block.block_type !== 'graph_patch') return;

  const existing = (block.data.summary ?? '').trim();
  const existingIsEmpty = existing.length === 0;
  const existingIsJargon = COUNT_JARGON_RE.test(existing);
  const existingIsGeneric = GENERIC_SUMMARY_FALLBACKS.has(existing);

  const shouldOverwrite = existingIsEmpty || existingIsJargon || existingIsGeneric;
  if (!shouldOverwrite) return;

  // tradeoff doesn't carry the goal label — look it up from the applied graph.
  // Same lookup regardless of whether coaching is present, so no branching.
  const goalLabel = getGoalLabelFromResult(actionResult);
  const optionLabels = getOptionLabelsFromResult(actionResult);

  const replacement = buildCoachingSummary(coachingContext, goalLabel, optionLabels);
  if (!replacement || replacement === existing) return;

  block.data.summary = replacement;
  log.info(
    {
      event: 'v4.post_draft_summary_override',
      original: existing,
      replacement,
      reason: existingIsEmpty ? 'empty' : existingIsJargon ? 'count_jargon' : 'generic_fallback',
    },
    'Post-draft summary overridden with coaching-derived sentence',
  );
}

function getGoalLabelFromResult(actionResult: ActionResult): string | null {
  const graph = actionResult.applied_graph;
  if (!graph) return null;
  const goal = graph.nodes.find((n) => n.kind === 'goal');
  return goal?.label ?? null;
}

function getOptionLabelsFromResult(actionResult: ActionResult): string[] {
  const graph = actionResult.applied_graph;
  if (!graph) return [];
  return graph.nodes.filter((n) => n.kind === 'option').map((n) => n.label);
}

/**
 * Read `analysis_ready.status` from the first `graph_patch` block on an
 * ActionResult, if any. Returns null when no block carries a readiness
 * payload (e.g. non-graph actions, errors, or pre-draft turns).
 */
function extractAnalysisReadyStatusFromResult(
  actionResult: ActionResult | null,
): string | null {
  if (!actionResult) return null;
  const block = (actionResult.blocks ?? []).find((b) => b.block_type === 'graph_patch');
  if (!block || block.block_type !== 'graph_patch') return null;
  const status = block.data.analysis_ready?.status;
  return typeof status === 'string' ? status : null;
}

/**
 * Fix 4: fallback source for analysis_ready.status on turns where the action
 * result carries no graph_patch block (conversational turns, info-only
 * actions, etc.).
 *
 * Lookup order:
 *   1. `turnRequest.context.graph.analysis_ready.status` — caller-provided,
 *      freshest authoritative view when the caller passes graph_state with
 *      an up-to-date payload.
 *   2. `computeStructuralReadiness(turnContext.graph)` — recompute from the
 *      current graph. Authoritative when the caller didn't carry a payload.
 *   3. null — only when no graph exists.
 *
 * The gate (chip-engine `canRunAnalysis`) must not receive null on any turn
 * where a graph exists, or the Run Analysis chip will appear on un-ready
 * graphs.
 */
function deriveAnalysisReadyStatusFallback(
  turnContext: DeterministicTurnContext,
): string | null {
  if (!turnContext.graph) return null;

  // Source 1: analysis_ready carried on the caller-provided graph object.
  // The field is a sibling of nodes/edges on turnRequest.context.graph and
  // survives onto turnContext.graph by reference; it's not in the static
  // GraphV3T schema, so access via an object cast.
  const graphAsAny = turnContext.graph as unknown as Record<string, unknown>;
  const contextReady = graphAsAny.analysis_ready as { status?: unknown } | undefined;
  const contextStatus = contextReady?.status;
  if (typeof contextStatus === 'string' && contextStatus.length > 0) return contextStatus;

  // Source 2: recompute from the current graph structure.
  const recomputed = computeStructuralReadiness(turnContext.graph);
  if (recomputed?.status && typeof recomputed.status === 'string') return recomputed.status;
  return null;
}

// Test-only exports for unit testing the post-draft summary override helpers
// without spinning up the full streaming pipeline.
export const __test_only = {
  maybeOverridePatchSummary,
  extractAnalysisReadyStatusFromResult,
  deriveAnalysisReadyStatusFallback,
  buildCoachingSummary,
  COUNT_JARGON_RE,
};

/**
 * Build a decision-framed summary from coaching signals and graph structure.
 * Returns null when we have nothing better than what the caller already had.
 */
function buildCoachingSummary(
  coachingContext: CoachingContext | null,
  goalLabel: string | null,
  optionLabels: string[],
): string | null {
  // Best: coaching context gives us the core trade-off. We preserve the
  // tradeoff even when the applied graph has no resolvable goal label —
  // losing the tradeoff to the generic fallback would be a strict regression.
  if (coachingContext?.tradeoff) {
    const t = coachingContext.tradeoff;
    return goalLabel
      ? `Your ${goalLabel} trades ${t.benefit_a} against ${t.benefit_b}.`
      : `This decision trades ${t.benefit_a} against ${t.benefit_b}.`;
  }

  // Next: goal + option names grounds the summary in decision language.
  if (goalLabel && optionLabels.length > 0) {
    const shown = optionLabels.slice(0, 3);
    const joined = shown.length === 1
      ? shown[0]
      : shown.length === 2
        ? `${shown[0]} or ${shown[1]}`
        : `${shown.slice(0, -1).join(', ')}, or ${shown[shown.length - 1]}`;
    return `${goalLabel}: ${joined}.`;
  }

  // Options alone — still decision-framed, just no goal anchor.
  if (optionLabels.length > 0) {
    const shown = optionLabels.slice(0, 3);
    const joined = shown.length === 1
      ? shown[0]
      : shown.length === 2
        ? `${shown[0]} or ${shown[1]}`
        : `${shown.slice(0, -1).join(', ')}, or ${shown[shown.length - 1]}`;
    return `A decision model comparing ${joined}.`;
  }

  return null;
}
