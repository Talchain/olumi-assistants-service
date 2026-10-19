/**
 * ⭐ PATH-B: THE DRAFT ADAPTER (C5, 19 Oct 2026; Step 8 gap 3, DL 19 Oct). Olumi's PROVISIONAL first model from the user's brief.
 *  1. literal check only: the brief is in the user's own typed words (`inTheUsersWords`);
 *  2. ONE drafter call, the construction's own first call (the same model, instructions, input and strict schema as
 *     `buildModelFromBrief`'s first pass), and the drafter's JSON becomes the model through Step 8's pure `candidateToGraph`:
 *     A's numbers and structure science on a label-blind copy, each figure with the origin the AI declared, no reading of the
 *     brief. It replaces the named bridge (`buildModelFromBrief`, DL-3 ruling 6), which path B no longer calls. The draft's
 *     statements are recorded on their subjects from the brief's own words (`candidateToGraph`'s carry);
 *  3. CREATE-ONLY registration under the construction's own operation id (`constructionOperationId`), so a lost response or a
 *     concurrent copy is recovered as this construction's own version, never a second one;
 *  4. an INDEPENDENT readback: `mutated` only when THIS construction's own version (`findConstructionVersion`) is on record AND
 *     a fresh read holds a model.
 * The draft travels beside the receipt (DL carrier ruling: the CONVERSATION route): `declared` is the drafter's JSON verbatim,
 * `said` what the conversion did not carry or changed, in its own sentences, and `not_expressible` each declared origin GraphV3
 * cannot hold. A retry of a construction that already committed reports "already saved", never a second write or "model exists".
 */
import { z } from 'zod-v4';
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import {
  buildCandidateSchema, buildInstructionsForBrief, constructionOperationId, findConstructionVersion, firstConstructInput, strictForTheDrafter,
  type CallStructuredModel,
} from '../../agent-lane/runtime/build-model.js';
import { budgetFor } from '../../agent-lane/model-budgets.js';
import { candidateToGraph } from './candidate-to-graph.js';
import { isNoModelYet, isSavedRead, readSaved } from './context-tool.js';
import { ok, refused, unavailable, type ToolOutcome } from './outcome.js';
import { inTheUsersWords, type TypedWords } from './user-words.js';

export const BUILD_MODEL_FROM_BRIEF = 'build_model_from_brief';
export const BuildModelParams = z.object({
  /** The user's brief, copied verbatim from their own messages. */
  brief: z.string(),
}).strict();
export type BuildModelArgs = z.infer<typeof BuildModelParams>;

export interface DraftDeps {
  readonly dispatch: InternalDispatch;
  readonly callStructured?: CallStructuredModel;
  /** The route's GRAPH_READY observer: told once, with the graph as read back. */
  readonly onModelRegistered?: (graph: Record<string, unknown>) => void;
}

const nodesIn = (graph: Record<string, unknown>): number => (Array.isArray(graph.nodes) ? graph.nodes.length : 0);

/** The construction's first drafter call, unchanged: the draft, or why there is none. Nothing is written. */
async function drafted(callStructured: CallStructuredModel, brief: string): Promise<{ readonly draft: unknown } | { readonly outcome: ToolOutcome }> {
  const budget = budgetFor('gpt-5.6-terra', 'whole');
  let out: Awaited<ReturnType<CallStructuredModel>>;
  try {
    out = await callStructured({
      model: budget.model,
      instructions: buildInstructionsForBrief(brief),
      input: firstConstructInput(brief),
      max_output_tokens: budget.max_output_tokens,
      reasoning_effort: budget.reasoning_effort,
      schema: strictForTheDrafter(buildCandidateSchema(), { providerBoundary: false }),
    });
  } catch {
    return { outcome: unavailable('construction_failed') };
  }
  // No answer, or one cut off before it closed: said as no structured output, never as the parse error it causes.
  if (out.text.length === 0) return { outcome: unavailable('no_structured_output') };
  try { return { draft: JSON.parse(out.text) as unknown }; } catch { return { outcome: unavailable('no_structured_output') }; }
}

export async function buildModel(deps: DraftDeps, ctx: Pick<AgentToolContext, 'scenario_id'> & TypedWords, args: BuildModelArgs): Promise<ToolOutcome> {
  if (!inTheUsersWords(args.brief, ctx)) return refused('brief_not_users_words');
  if (deps.callStructured === undefined) return unavailable('drafter_unavailable');
  const before = await readSaved(deps, ctx.scenario_id);
  // A new scenario has no model yet (`graph: null`, `graph_present: false`): that is where a first draft starts.
  if (!isSavedRead(before) && !isNoModelYet(before)) return before;
  const ownVersion = () => findConstructionVersion(deps.dispatch, ctx.scenario_id, args.brief).catch(() => null);
  if (isSavedRead(before) && nodesIn(before.graph) > 0) {
    const prior = await ownVersion();
    return prior === null ? refused('model_exists') : ok({ already_saved: true, model_version: prior }, { mutated: false });
  }

  const draft = await drafted(deps.callStructured, args.brief);
  if ('outcome' in draft) return draft.outcome;
  const converted = candidateToGraph(draft.draft, { words: args.brief, recorded_at: new Date().toISOString() });
  if ('refused' in converted) return refused(converted.refused);

  let reg: Awaited<ReturnType<InternalDispatch>>;
  try {
    reg = await deps.dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
      graph: converted.graph,
      brief_text: args.brief,
      operation_id: constructionOperationId(ctx.scenario_id, args.brief),
      // Create-only: the route refuses `GRAPH_STALE` if a model appeared since the read above (`buildModelFromBrief`'s contract).
      expected_graph_identity_hash: null,
    });
  } catch {
    return unavailable('not_confirmed', 'unknown');
  }
  const code = (reg.json.details as { code?: unknown } | undefined)?.code;
  if (reg.status === 409 && (code === 'GRAPH_STALE' || code === 'OPERATION_ID_REUSED')) {
    // This construction already committed (a lost response, or a concurrent copy won): its own version, or not ours.
    const prior = await ownVersion();
    if (prior !== null) return ok({ already_saved: true, model_version: prior }, { mutated: false });
    if (code === 'GRAPH_STALE') return refused('model_exists');
  }
  if (reg.status >= 500) return unavailable('not_confirmed', 'unknown');
  if (reg.status !== 200) return refused('registration_refused');

  const [receipt, after] = await Promise.all([ownVersion(), readSaved(deps, ctx.scenario_id)]);
  if (receipt === null || !isSavedRead(after) || nodesIn(after.graph) === 0) return unavailable('not_verified', 'unknown');
  if (reg.json.replayed === true) return ok({ already_saved: true, model_version: receipt }, { mutated: false });
  try { deps.onModelRegistered?.(after.graph); } catch { /* an observer never decides the outcome */ }
  return ok({
    provisional: 'olumi', model_version: receipt, revision: { graph_hash: after.graphHash, graph_identity_hash: after.identity },
    draft: {
      declared: converted.declared,
      said: [...new Set(converted.loss.map((l) => l.reason).filter((r): r is string => typeof r === 'string' && r.trim() !== ''))],
      not_expressible: converted.blocked_schema,
    },
  }, { mutated: true });
}
