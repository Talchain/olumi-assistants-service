/**
 * ⭐ THE 14 OCT ACTION BAR ON A CORE SCENARIO (DL 93d79c3e 09:24Z, for Lenses' panel bar). The one ranker the legacy turn and
 * reload use (`actionBarOf(actionFactsOf(…))`), over ONE scenario-graph read's own body, keeping only the actions a press on
 * the core route serves: a core press reaches the AI as the action's user line (`core-turn.ts`), and only the pre-mortem is
 * witnessed there (café, 23 Oct). An action core cannot serve is absent, never a dead button (`rank.ts`: an offer is present
 * only while its contract can be offered). Core writes no guidance history or pending carrier, so neither is read: the turn
 * and its reload rank the same read alike. None to show is no bar, so the panel keeps its method strip.
 */
import { readEvaluatedIdentityNodeIds } from '../agent-lane/admit-model.js';
import type { ActionId } from '../agent-lane/actions/registry.js';
import { actionBarOf, type ActionBarV1, type ActionOffer } from '../agent-lane/actions/rank.js';
import { actionFactsOf } from '../agent-lane/actions/state.js';

/** The actions a press on the core route serves today. */
const CORE_SERVED: ReadonlySet<ActionId> = new Set<ActionId>(['pre_mortem']);

const rec = (v: unknown): Record<string, unknown> | undefined =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined);

/** The bar for a core scenario, from a body of `/assist/v1/scenarios/:id/graph`; none when nothing it offers is served. */
export function coreActionBarOf(scenarioId: string, body: Readonly<Record<string, unknown>>): ActionBarV1 | undefined {
  try {
    const evaluated = readEvaluatedIdentityNodeIds(body.analysis_identity_evaluated_node_ids);
    const bar = actionBarOf(actionFactsOf({
      scenarioId, graph: body.graph ?? null, ...(typeof body.graph_hash === 'string' ? { graphHash: body.graph_hash } : {}),
      analysisState: body.analysis_state, analysisReady: body.analysis_ready ?? rec(body.current_read)?.analysis_ready,
      analysisResult: body.analysis_result, optionParticipation: body.analysis_option_participation,
      ...(evaluated !== undefined ? { identityEvaluated: evaluated } : {}), guidance: null, pending: [],
    }));
    const served = (o: ActionOffer) => CORE_SERVED.has(o.action_id);
    // The bias-risk row presses offers this bar no longer carries, so it is not sent.
    const core: ActionBarV1 = { v: bar.v, state_key: bar.state_key, revision: bar.revision,
      priority: bar.priority.filter(served), standard: bar.standard.filter(served), more: bar.more.filter(served) };
    return core.priority.length + core.standard.length + core.more.length === 0 ? undefined : core;
  } catch {
    // A failed ranking carries no bar and never costs the turn or the read.
    return undefined;
  }
}
