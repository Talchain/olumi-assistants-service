/**
 * System Event Router
 *
 * Deterministic routing for system events arriving via OrchestratorTurnRequest.
 * System events bypass the intent gate entirely — routing is deterministic.
 *
 * Shared by both V1 (turn-handler.ts) and V2 (pipeline.ts) — single source of truth.
 *
 * ## Silent envelope invariant
 * All handlers that produce no visible response MUST return the full triple:
 *   assistant_text: null, blocks: [], guidanceItems: []
 * This ensures downstream consumers never need null-checks on these fields.
 *
 * ## [system] entries note
 * Entries in systemContextEntries must be filtered out before any future
 * conversation persistence. They are ephemeral context enrichment for the
 * current turn only — not part of the canonical conversation history.
 */

import { log } from "../utils/telemetry.js";
import type {
  SystemEvent,
  OrchestratorTurnRequest,
  ConversationBlock,
  ConversationMessage,
  GraphPatchBlockData,
  V2RunResponseEnvelope,
} from "./types.js";
import type { PLoTClient, PLoTClientRunOpts } from "./plot-client.js";
import type { GuidanceItem } from "./types/guidance-item.js";
import { generatePostDraftGuidance } from "./guidance/post-draft.js";
import { buildAnalysisBlocksAndGuidance } from "./tools/analysis-blocks.js";
import { createGraphPatchBlock } from "./blocks/factory.js";

// ============================================================================
// Types
// ============================================================================

export interface SystemEventRouterParams {
  event: SystemEvent;
  turnRequest: OrchestratorTurnRequest;
  turnId: string;
  requestId: string;
  plotClient: PLoTClient | null;
  plotOpts?: PLoTClientRunOpts;
}

/**
 * Result returned by the system event router.
 *
 * Callers assemble the final response envelope from this result.
 * When delegateToTool is set, the caller must route to the named tool
 * handler (path equivalence guarantee for direct_analysis_run Path B).
 */
export interface SystemEventRouterResult {
  /** Silent envelope invariant: always present (may be null). */
  assistantText: string | null;
  /** Silent envelope invariant: always present (may be empty array). */
  blocks: ConversationBlock[];
  /** Silent envelope invariant: always present (may be empty array). */
  guidanceItems: GuidanceItem[];
  /**
   * [system] sentinel strings to prepend to conversation context.
   * Callers must inject these via appendSystemMessages() before further processing.
   *
   * NOTE: These entries must be filtered before any future conversation persistence.
   * They are ephemeral turn-level context enrichment only.
   */
  systemContextEntries: string[];
  httpStatus: number;
  error?: { code: string; message: string };
  /** PLoT graph_hash from validate-patch (patch_accepted only). */
  graphHash?: string;
  /** Full analysis response (direct_analysis_run Path A only). */
  analysisResponse?: V2RunResponseEnvelope;
  /**
   * When set, the caller must delegate to this tool handler.
   * Used for direct_analysis_run Path B (path equivalence with "run the analysis" message).
   */
  delegateToTool?: 'run_analysis';
  /** When true, caller should chain explain_results if a message also accompanies the turn. */
  needsNarration?: boolean;
}

// ============================================================================
// Router Entry Point
// ============================================================================

/**
 * Route a system event to the appropriate deterministic handler.
 *
 * Logs every system event receipt: event_type, event_id, scenario_id, client_turn_id.
 * Never calls the intent gate or LLM (except when delegateToTool is returned).
 */
export async function routeSystemEvent(
  params: SystemEventRouterParams,
): Promise<SystemEventRouterResult> {
  const { event, turnRequest, turnId, requestId, plotClient, plotOpts } = params;

  log.info(
    {
      event_type: event.event_type,
      event_id: event.event_id,
      scenario_id: turnRequest.scenario_id,
      client_turn_id: turnRequest.client_turn_id,
      request_id: requestId,
    },
    'System event received',
  );

  // ── System event validation (cf-v11.1) ──────────────────────────────────

  // patch_accepted / patch_dismissed: verify a pending patch exists in context
  if (event.event_type === 'patch_accepted' || event.event_type === 'patch_dismissed') {
    if (!hasPendingPatch(turnRequest.context.messages)) {
      log.warn(
        { event_type: event.event_type, session_id: turnRequest.scenario_id, reason: 'no_pending_patch' },
        'System event ignored — no pending patch in conversation context',
      );
      // Ignore silently — no error to user
      return {
        assistantText: null,
        blocks: [],
        guidanceItems: [],
        systemContextEntries: [],
        httpStatus: 200,
      };
    }
  }

  // direct_analysis_run: verify graph exists in context
  if (event.event_type === 'direct_analysis_run') {
    if (!turnRequest.graph_state && !turnRequest.context.graph) {
      log.info(
        { event_type: event.event_type, session_id: turnRequest.scenario_id },
        'direct_analysis_run — no graph in context, returning guidance',
      );
      return {
        assistantText: "You'll need a model before running analysis. Describe your decision and I'll draft one.",
        blocks: [],
        guidanceItems: [],
        systemContextEntries: [],
        httpStatus: 200,
      };
    }
  }

  switch (event.event_type) {
    case 'patch_accepted':
      return handlePatchAccepted(event, turnRequest, turnId, requestId, plotClient, plotOpts);
    case 'patch_dismissed':
      return handlePatchDismissed(event, turnRequest);
    case 'direct_graph_edit':
      return handleDirectGraphEdit(event, turnRequest, turnId);
    case 'direct_analysis_run':
      return handleDirectAnalysisRun(event, turnRequest, turnId, requestId);
    case 'feedback_submitted':
      return handleFeedbackSubmitted(event, turnRequest);
  }
}

// ============================================================================
// [system] Context Entry Helper
// ============================================================================

/**
 * Append [system] sentinel strings to a messages array.
 *
 * Returns a new array — does not mutate the input.
 *
 * NOTE: [system] entries must be filtered out before any future conversation
 * persistence. They are ephemeral context enrichment for the current turn only.
 */
export function appendSystemMessages(
  messages: ConversationMessage[],
  entries: string[],
): ConversationMessage[] {
  if (entries.length === 0) return messages;
  const systemMessages: ConversationMessage[] = entries.map((content) => ({
    role: 'user' as const,
    content,
  }));
  return [...messages, ...systemMessages];
}

// ============================================================================
// patch_accepted
// ============================================================================

async function handlePatchAccepted(
  event: Extract<SystemEvent, { event_type: 'patch_accepted' }>,
  turnRequest: OrchestratorTurnRequest,
  turnId: string,
  requestId: string,
  plotClient: PLoTClient | null,
  plotOpts?: PLoTClientRunOpts,
): Promise<SystemEventRouterResult> {
  const { details } = event;
  const patchId = details.patch_id ?? details.block_id ?? 'unknown';

  // Warning: empty operations array is unusual for patch_accepted
  if (details.operations.length === 0) {
    log.warn(
      { request_id: requestId, patch_id: patchId, event_id: event.event_id },
      'patch_accepted: operations array is empty — this is unusual',
    );
  }

  if (details.applied_graph_hash) {
    // ── Path A: UI already validated ──────────────────────────────────────
    // Guard: applied_graph_hash requires graph_state so we can refresh guidance.
    if (!turnRequest.graph_state) {
      return {
        assistantText: null,
        blocks: [],
        guidanceItems: [],
        systemContextEntries: [],
        httpStatus: 400,
        error: {
          code: 'MISSING_GRAPH_STATE',
          message: 'applied_graph_hash is present but graph_state is missing from the request. ' +
            'CEE cannot refresh guidance or update context without the graph.',
        },
      };
    }

    // Trust the UI's validation result — do NOT call PLoT validate-patch.
    const graphHash = details.applied_graph_hash;

    // Regenerate post-draft guidance from the new graph state.
    const framing = turnRequest.context.framing ?? null;
    const guidanceItems = generatePostDraftGuidance(
      turnRequest.graph_state,
      [],
      framing,
    );

    const contextEntry = `[system] User accepted patch ${patchId}. Applied (graph_hash: ${graphHash}).`;

    const block = buildGraphPatchBlock(
      patchId,
      details.operations,
      graphHash,
      turnId,
    );

    log.info(
      { request_id: requestId, patch_id: patchId, graph_hash: graphHash, path: 'A' },
      'patch_accepted: Path A — UI-validated, skipping PLoT',
    );

    return {
      assistantText: null,
      blocks: [block],
      guidanceItems,
      systemContextEntries: [contextEntry],
      httpStatus: 200,
      graphHash,
    };
  }

  // ── Path B: UI did not validate — CEE must call PLoT ───────────────────
  // Path B requires graph_state (full GraphV3) — no fallback to context.graph.
  if (!turnRequest.graph_state) {
    return {
      assistantText: null,
      blocks: [],
      guidanceItems: [],
      systemContextEntries: [],
      httpStatus: 400,
      error: {
        code: 'MISSING_GRAPH_STATE',
        message: 'patch_accepted Path B requires graph_state in the request.',
      },
    };
  }

  if (!plotClient) {
    // No PLoT client configured — treat same as feature_disabled.
    log.warn({ request_id: requestId, patch_id: patchId }, 'patch_accepted: PLoT client not configured');
    return {
      assistantText: 'Graph validation is currently unavailable. Please try again later.',
      blocks: [],
      guidanceItems: [],
      systemContextEntries: [],
      httpStatus: 200,
    };
  }

  const plotPayload: Record<string, unknown> = {
    graph: turnRequest.graph_state,
    operations: details.operations,
    scenario_id: turnRequest.scenario_id,
  };

  let result;
  try {
    result = await plotClient.validatePatch(plotPayload, requestId, plotOpts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ request_id: requestId, patch_id: patchId, error: msg }, 'patch_accepted: PLoT validate-patch threw');
    return {
      assistantText: 'Graph validation is currently unavailable. Please try again later.',
      blocks: [],
      guidanceItems: [],
      systemContextEntries: [],
      httpStatus: 200,
    };
  }

  if (result.kind === 'feature_disabled') {
    log.info({ request_id: requestId, patch_id: patchId }, 'patch_accepted: PLoT validate-patch FEATURE_DISABLED');
    return {
      assistantText: 'Graph validation is currently unavailable. Please try again later.',
      blocks: [],
      guidanceItems: [],
      systemContextEntries: [],
      httpStatus: 200,
    };
  }

  if (result.kind === 'rejection') {
    const rejectionMsg = result.message ?? 'The patch could not be applied due to a validation error.';
    const contextEntry = `[system] User accepted patch ${patchId} but it was rejected by validation: ${rejectionMsg}`;

    const rejectionBlock: ConversationBlock = {
      block_id: `blk_graph_patch_rej_${patchId.substring(0, 16)}`,
      block_type: 'graph_patch',
      data: {
        patch_type: 'edit',
        operations: [],
        status: 'rejected',
        rejection: {
          reason: 'validation_rejected',
          message: rejectionMsg,
          code: result.code,
          plot_code: result.code,
          plot_violations: result.violations,
        },
      } satisfies GraphPatchBlockData,
      provenance: {
        trigger: 'system_event:patch_accepted',
        turn_id: turnId,
        timestamp: new Date().toISOString(),
      },
    };

    log.warn(
      { request_id: requestId, patch_id: patchId, code: result.code, path: 'B' },
      'patch_accepted: PLoT validate-patch rejected',
    );

    return {
      assistantText: `The patch could not be applied: ${rejectionMsg}`,
      blocks: [rejectionBlock],
      guidanceItems: [],
      systemContextEntries: [contextEntry],
      httpStatus: 200,
    };
  }

  // Success
  const graphHash = typeof result.data.graph_hash === 'string' ? result.data.graph_hash : undefined;
  const contextEntry = `[system] User accepted patch ${patchId}. Applied (graph_hash: ${graphHash ?? 'unknown'}).`;

  // Refresh guidance from the provided graph_state after successful validation.
  const framing = turnRequest.context.framing ?? null;
  const guidanceItems = generatePostDraftGuidance(turnRequest.graph_state, [], framing);

  const block = buildGraphPatchBlock(
    patchId,
    details.operations,
    graphHash,
    turnId,
  );

  log.info(
    { request_id: requestId, patch_id: patchId, graph_hash: graphHash, path: 'B' },
    'patch_accepted: PLoT validate-patch succeeded',
  );

  return {
    assistantText: null,
    blocks: [block],
    guidanceItems,
    systemContextEntries: [contextEntry],
    httpStatus: 200,
    graphHash,
  };
}

// ============================================================================
// patch_dismissed
// ============================================================================

function handlePatchDismissed(
  event: Extract<SystemEvent, { event_type: 'patch_dismissed' }>,
  turnRequest: OrchestratorTurnRequest,
): SystemEventRouterResult {
  const { details } = event;
  const patchId = details.patch_id ?? details.block_id ?? 'unknown';

  log.info(
    {
      event_id: event.event_id,
      patch_id: patchId,
      reason: details.reason,
      scenario_id: turnRequest.scenario_id,
    },
    'patch_dismissed: logged',
  );

  const contextEntry = `[system] User dismissed patch ${patchId}.`;

  // Silent envelope invariant: assistant_text: null, blocks: [], guidanceItems: []
  return {
    assistantText: null,
    blocks: [],
    guidanceItems: [],
    systemContextEntries: [contextEntry],
    httpStatus: 200,
  };
}

// ============================================================================
// direct_graph_edit
// ============================================================================

function handleDirectGraphEdit(
  event: Extract<SystemEvent, { event_type: 'direct_graph_edit' }>,
  turnRequest: OrchestratorTurnRequest,
  _turnId: string,
): SystemEventRouterResult {
  const { details } = event;
  const N = details.changed_node_ids.length;
  const M = details.changed_edge_ids.length;
  const opsStr = details.operations.join(', ');

  const contextEntry =
    `[system] User edited the graph directly: ${N} node${N === 1 ? '' : 's'} and ${M} edge${M === 1 ? '' : 's'} changed (${opsStr}).`;

  // Refresh guidance only when graph_state is present and non-null.
  let guidanceItems: GuidanceItem[] = [];
  if (turnRequest.graph_state) {
    const framing = turnRequest.context.framing ?? null;
    guidanceItems = generatePostDraftGuidance(turnRequest.graph_state, [], framing);
  }

  // Silent envelope invariant: assistant_text: null, blocks: []
  return {
    assistantText: null,
    blocks: [],
    guidanceItems,
    systemContextEntries: [contextEntry],
    httpStatus: 200,
  };
}

// ============================================================================
// direct_analysis_run
// ============================================================================

function handleDirectAnalysisRun(
  event: Extract<SystemEvent, { event_type: 'direct_analysis_run' }>,
  turnRequest: OrchestratorTurnRequest,
  turnId: string,
  requestId: string,
): SystemEventRouterResult {
  const contextEntry = '[system] User triggered analysis via Play button.';

  if (turnRequest.analysis_state) {
    // ── Path A: UI already ran analysis ───────────────────────────────────
    const analysisState = turnRequest.analysis_state;
    const graphState = turnRequest.graph_state ?? turnRequest.context.graph ?? null;

    // Consistency warning: if analysis metadata graph_hash differs from graph_state
    const analysisGraphHash = (analysisState as Record<string, unknown>).graph_hash;
    const graphStateHash = (graphState as Record<string, unknown> | null)?.hash;
    if (
      analysisGraphHash &&
      graphStateHash &&
      analysisGraphHash !== graphStateHash
    ) {
      log.warn(
        {
          request_id: requestId,
          event_id: event.event_id,
          analysis_graph_hash: analysisGraphHash,
          graph_state_hash: graphStateHash,
        },
        'direct_analysis_run Path A: analysis_state graph_hash differs from graph_state hash — possible stale analysis',
      );
    }

    const { blocks, guidanceItems } = buildAnalysisBlocksAndGuidance(
      analysisState,
      graphState,
      turnId,
    );

    // Narration rule: if no message (or trivial), no explain_results call.
    // Caller chains explain_results only when needsNarration is true.
    const hasMessage = turnRequest.message.trim().length > 5;

    log.info(
      { request_id: requestId, event_id: event.event_id, path: 'A', needs_narration: hasMessage },
      'direct_analysis_run: Path A — using UI-provided analysis',
    );

    return {
      assistantText: null,
      blocks,
      guidanceItems,
      systemContextEntries: [contextEntry],
      httpStatus: 200,
      analysisResponse: analysisState,
      needsNarration: hasMessage,
    };
  }

  // ── Path B: UI did not run analysis — delegate to run_analysis tool ────
  // Path equivalence guarantee: same code path as "run the analysis" message.
  log.info(
    { request_id: requestId, event_id: event.event_id, path: 'B' },
    'direct_analysis_run: Path B — delegating to run_analysis tool handler',
  );

  return {
    assistantText: null,
    blocks: [],
    guidanceItems: [],
    systemContextEntries: [contextEntry],
    httpStatus: 200,
    delegateToTool: 'run_analysis',
  };
}

// ============================================================================
// feedback_submitted
// ============================================================================

function handleFeedbackSubmitted(
  event: Extract<SystemEvent, { event_type: 'feedback_submitted' }>,
  turnRequest: OrchestratorTurnRequest,
): SystemEventRouterResult {
  // Log only — do NOT inject into conversation context.
  // Feedback is observability, not conversation state.
  log.info(
    {
      event_id: event.event_id,
      turn_id: event.details.turn_id,
      rating: event.details.rating,
      has_comment: Boolean(event.details.comment),
      scenario_id: turnRequest.scenario_id,
    },
    'feedback_submitted: logged',
  );

  // Silent envelope invariant: assistant_text: null, blocks: [], guidanceItems: []
  return {
    assistantText: null,
    blocks: [],
    guidanceItems: [],
    systemContextEntries: [],  // No context injection for feedback
    httpStatus: 200,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function buildGraphPatchBlock(
  patchId: string,
  operations: Record<string, unknown>[],
  graphHash: string | undefined,
  turnId: string,
): ConversationBlock {
  const data: GraphPatchBlockData = {
    patch_type: 'edit',
    operations: [],  // UI-provided ops are opaque — not mapped to PatchOperation[]
    status: 'accepted',
    applied_graph_hash: graphHash,
    summary: `Patch ${patchId} applied.`,
  };

  return createGraphPatchBlock(data, turnId, undefined, [
    {
      action_id: `undo_${patchId}`,
      label: 'Undo',
      action_type: 'undo',
    },
  ]);
}

// ============================================================================
// Pending Patch Detection
// ============================================================================

/**
 * Check whether the conversation context contains a pending (proposed/previewed) patch.
 *
 * Scans messages for the most recent graph_patch block with status 'proposed' or 'previewed'.
 * Uses structured block scanning only — no string matching (which can false-positive
 * on user messages that mention "graph_patch" or "proposed").
 *
 * This is the canonical source of truth — no separate server-side tracking.
 */
function hasPendingPatch(messages: ConversationMessage[]): boolean {
  // Walk backwards through messages to find the latest graph_patch block.
  // ConversationMessage.content is typed as string (Zod-coerced at route boundary),
  // so we check both structured object content (from unit-test mocks or future type
  // widening) and string content (serialized blocks or keyword markers).
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const content = msg.content as unknown; // widen to check both shapes

    // Path 1: structured content (unit tests, future type widening)
    if (typeof content === 'object' && content !== null) {
      const blocks = (content as Record<string, unknown>).blocks;
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (
            typeof block === 'object' && block !== null &&
            (block as Record<string, unknown>).block_type === 'graph_patch'
          ) {
            const data = (block as Record<string, unknown>).data as Record<string, unknown> | undefined;
            if (data && (data.status === 'proposed' || data.status === 'previewed')) {
              return true;
            }
          }
        }
      }
    }

    // Path 2: string content — look for serialized graph_patch with pending status
    if (typeof content === 'string' && content.includes('graph_patch')) {
      if (content.includes('"proposed"') || content.includes('"previewed"')) {
        return true;
      }
    }
  }

  return false;
}
