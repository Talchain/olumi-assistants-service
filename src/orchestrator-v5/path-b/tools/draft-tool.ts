/**
 * ⭐ PATH-B: THE DRAFT ADAPTER (C5, 19 Oct 2026). Builds Olumi's PROVISIONAL first model from the user's brief through the
 * product's primitives, below every C1/C2 meaning gate:
 *  1. literal check: the brief is the user's own typed words (`quoteSpansIn`, the existing literal matcher); nothing more;
 *  2. the drafter call: the existing schema, instructions and budget, one call (`callStructured`);
 *  3. `candidateToGraph` (step 8's pure conversion, injected): the draft as a valid graph, every claim with the source the AI
 *     declared, refusing nothing on meaning. Absent ⇒ `unavailable`, never a fallback through the meaning gates;
 *  4. ONE create-only registration (`expected_graph_identity_hash: null`, the construction's operation id);
 *  5. an INDEPENDENT fresh readback (the one context reader): `mutated` only when the read's hash is the registration's.
 * It never edits an existing model: a model already there is `refused('model_exists')`.
 */
import { z } from 'zod/v4';
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { buildCandidateSchema, buildInstructionsForBrief, constructionOperationId, firstConstructInput, strictForTheDrafter,
  type CallStructuredModel } from '../../agent-lane/runtime/build-model.js';
import { budgetFor } from '../../agent-lane/model-budgets.js';
import { plainQuoteWords } from '../../agent-lane/quote-confirmation.js';
import { quoteSpansIn } from '../../agent-lane/stated-by-user.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { readCanonicalContext } from './context-tool.js';
import { ok, refused, unavailable, type ToolOutcome } from './outcome.js';

export const BUILD_MODEL_FROM_BRIEF = 'build_model_from_brief';
export const BuildModelParams = z.object({
  /** The user's brief, copied verbatim from their own messages. */
  brief: z.string().min(1).max(20_000),
}).strict();
export type BuildModelArgs = z.infer<typeof BuildModelParams>;

/** Step 8's pure conversion (no C1/C2 decisions): a valid graph, or the protocol reason it could not convert. */
export type CandidateToGraph = (candidate: unknown, brief: string) =>
  { readonly graph: Record<string, unknown> } | { readonly refused: string };

export interface DraftDeps {
  readonly dispatch: InternalDispatch;
  readonly callStructured?: CallStructuredModel;
  readonly candidateToGraph?: CandidateToGraph;
  /** The route's GRAPH_READY observer: told once, after the readback confirms the registration. */
  readonly onModelRegistered?: (graph: Record<string, unknown>) => void;
}

const DRAFT_BUDGET = budgetFor('gpt-5.6-terra', 'whole');
const isRec = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function writtenByTheUser(brief: string, ctx: Pick<AgentToolContext, 'verified_user_messages' | 'user_turn_text'>): boolean {
  const said = plainQuoteWords(brief);
  return [...(ctx.verified_user_messages ?? []), ...(ctx.user_turn_text === undefined ? [] : [ctx.user_turn_text])]
    .some((m) => quoteSpansIn(plainQuoteWords(m), said).length > 0);
}

export async function buildModel(deps: DraftDeps,
  ctx: Pick<AgentToolContext, 'scenario_id' | 'verified_user_messages' | 'user_turn_text'>, args: BuildModelArgs): Promise<ToolOutcome> {
  if (!writtenByTheUser(args.brief, ctx)) return refused('brief_not_users_words');
  if (deps.callStructured === undefined) return unavailable('drafter_unavailable');
  if (deps.candidateToGraph === undefined) return unavailable('conversion_unavailable');
  const before = await readCanonicalContext(deps, ctx);
  if (before.status !== 'ok') return before;
  if (before.data.empty !== true) return refused('model_exists');

  let text: string;
  try {
    const out = await deps.callStructured({
      model: DRAFT_BUDGET.model, max_output_tokens: DRAFT_BUDGET.max_output_tokens, reasoning_effort: DRAFT_BUDGET.reasoning_effort,
      // No host reading of the brief decides the instructions: the event-by-date addendum opens only on a host attestation.
      instructions: buildInstructionsForBrief(args.brief, { event_by_date_prompted: false }),
      input: firstConstructInput(args.brief),
      schema: strictForTheDrafter(buildCandidateSchema(), { providerBoundary: false }),
    });
    if (out.status === 'incomplete') return unavailable('draft_cut_off', 'none', out.incomplete_reason);
    text = out.text;
  } catch {
    return unavailable('drafter_failed');
  }
  let candidate: unknown;
  try { candidate = JSON.parse(text); } catch { return unavailable('draft_unreadable'); }
  const converted = deps.candidateToGraph(candidate, args.brief);
  if ('refused' in converted) return refused(converted.refused);
  if (!GraphV3.safeParse(converted.graph).success) return refused('graph_invalid');

  let reg: Awaited<ReturnType<InternalDispatch>>;
  try {
    reg = await deps.dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
      graph: converted.graph, brief_text: args.brief,
      operation_id: constructionOperationId(ctx.scenario_id, args.brief), expected_graph_identity_hash: null,
    });
  } catch {
    return unavailable('not_confirmed', 'unknown');
  }
  if (reg.status === 409) return refused('model_exists', isRec(reg.json.details) ? String(reg.json.details.code ?? '') : undefined);
  if (reg.status >= 400 && reg.status < 500) return refused('registration_refused', `HTTP ${reg.status}`);
  if (reg.status !== 200 || typeof reg.json.graph_hash !== 'string') return unavailable('not_confirmed', 'unknown');

  const after = await readCanonicalContext(deps, ctx);
  const revision = after.status === 'ok' && isRec(after.data.revision) ? after.data.revision : undefined;
  if (revision?.graph_hash !== reg.json.graph_hash) return unavailable('not_verified', 'unknown');
  try { deps.onModelRegistered?.(converted.graph); } catch { /* an observer never decides the outcome */ }
  return ok({
    provisional: 'olumi',
    revision,
    ...(reg.json.model_version_receipt === undefined ? {} : { model_version: reg.json.model_version_receipt }),
    ...(reg.json.replayed === true ? { replayed: true } : {}),
  }, { mutated: reg.json.replayed !== true });
}
