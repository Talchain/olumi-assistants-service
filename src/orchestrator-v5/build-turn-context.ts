/**
 * Build a minimal V5 TurnContext from an ingress payload (A1).
 *
 * A1 TurnContext is skeletal per Paul's "/orchestrator namespace scope" lock-in:
 * stage, entity_registry (empty for direct_answer), capabilities (all false
 * — A1 has no handlers), messages (single user turn), session/request IDs,
 * and budgets from env.
 */

import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';
import type { TurnContext } from '@talchain/schemas/orchestrator';

import { getTurnExecutorBudgets } from './budgets.js';

export function buildTurnContext(payload: OrchestratorTurnPayload, requestId: string): TurnContext {
  const budgets = getTurnExecutorBudgets();

  return {
    stage: payload.stage,
    entity_registry: {
      option_ids: [],
      goal_id: null,
    },
    capabilities: {
      // A1 has zero handlers. Every capability is explicitly false.
      // Adding real handlers in later slices flips individual entries.
      can_run_analysis: false,
      can_edit_graph: false,
      can_run_decision_review: false,
      can_generate_coaching: false,
      can_invoke_tools: false,
      can_commit_session_state: false,
    },
    messages: [
      { role: 'user', content: payload.message },
    ],
    session_id: payload.scenario_id,
    request_id: requestId,
    budgets,
  };
}
