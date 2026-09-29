import { buildSourceFirstModel } from '../source-first/index.js';
import { COMPACT_LIMITS } from '../construction-size-gate.js';
import { registerConstructedGraph } from './construction-registration.js';
import type { InternalDispatch } from './agent-capabilities.js';
import type { CallStructuredModel } from './build-model.js';
import type { ToolResult } from './agent-tools.js';

/** Experimental producer through the same validation and canonical write door. */
export async function buildSourceFirstFromBrief(
  scenarioId: string,
  brief: string,
  dispatch: InternalDispatch,
  callStructured: CallStructuredModel,
): Promise<ToolResult> {
  let built: Awaited<ReturnType<typeof buildSourceFirstModel>>;
  try {
    built = await buildSourceFirstModel(brief, callStructured);
  } catch (error) {
    const kind = error instanceof Error && error.message.startsWith('source_first_incomplete:')
      ? 'construction_incomplete' : 'construction_failed';
    return { ok: false, mutated: false, refusal: kind };
  }

  const registered = await registerConstructedGraph({ scenarioId, brief, graph: built.graph, dispatch });
  if (!registered.ok || !registered.mutated) return registered;
  return {
    ...registered,
    nodes: built.graph.nodes.length,
    edges: built.graph.edges.length,
    options: built.graph.nodes.filter((n) => n.kind === 'option').length,
    within_compact_limits: built.graph.nodes.length <= COMPACT_LIMITS.maxNodes
      && built.graph.edges.length <= COMPACT_LIMITS.maxEdges,
    goal_constraints_carried: built.graph.goal_constraints?.length ?? 0,
    construction_retried: false,
    size_retried: false,
    open_questions: built.open_questions,
    not_represented: built.loss.map((finding) => finding.question),
    projected_field_count: built.loss.length,
    constructor_trace: { ...built.trace, latency_ms: built.latency_ms, arm: 'source_first' },
    // Suggestions are deliberately outside GraphV3. M1 keeps them for the
    // separate widening/adoption path, without treating them as user facts.
    deferred_suggestions: built.proposals.length,
  };
}
