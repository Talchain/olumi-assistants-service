/**
 * ⭐ PATH-B: THE DRAFT ADAPTER (C5, 19 Oct 2026; Step 8 gap 3, DL 19 Oct). Olumi's PROVISIONAL first model from the user's brief.
 *  1. literal check only: the brief is in the user's own typed words (`inTheUsersWords`);
 *  2. ONE drafter call with the construction's model and strict schema, its STATIC instructions (`BUILD_INSTRUCTIONS` plus the
 *     AIE's one B-only sentence, `B_DRAFTER_SENTENCE`; A's instructions are untouched) and the
 *     literal brief in the shared turn context (`turnContextItems`): no host reading of the brief changes what the AI is told
 *     (#3473 R1: no event-by-date attestation, no range notes). The drafter's JSON becomes the model through Step 8's pure `candidateToGraph`:
 *     A's numbers and structure science on a label-blind copy, each figure with the origin the AI declared, no reading of the
 *     brief. It replaces the named bridge (`buildModelFromBrief`, DL-3 ruling 6), which path B no longer calls. The draft's
 *     statements are recorded on their subjects from the brief's own words (`candidateToGraph`'s carry);
 *  3. CREATE-ONLY registration under the construction's own operation id (`constructionOperationId`), so a lost response or a
 *     concurrent copy is recovered as this construction's own version, never a second one;
 *  4. an INDEPENDENT readback: `mutated` only when THIS registration's own receipt and CAS hashes match a fresh read AND
 *     that read holds the complete converted postimage (`approvedGraphHeld`), not merely an existing model.
 * The draft travels beside the receipt (DL carrier ruling: the CONVERSATION route): `declared` is the drafter's JSON verbatim,
 * `said` what the conversion did not carry or changed, in its own sentences, and `not_expressible` each declared origin GraphV3
 * cannot hold. A retry of a construction that already committed reports "already saved", never a second write or "model exists".
 */
import { z } from 'zod-v4';
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import {
  BUILD_INSTRUCTIONS, buildCandidateSchema, constructionOperationId, findConstructionVersion, strictForTheDrafter, type CallStructuredModel,
} from '../../agent-lane/runtime/build-model.js';
import { approvedGraphHeld } from '../../agent-lane/runtime/draft-replacement.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHashSha256 } from '../../context/graph-hash.js';
import type { AtomicCommittedModelVersionReceipt } from '../../session/store.js';
import { turnContextItems, turnContextText } from '../../agent-lane/turn-context.js';
import { budgetFor } from '../../agent-lane/model-budgets.js';
import { candidateToGraph } from './candidate-to-graph.js';
import { STANCE_DESCRIPTION } from './change-tools.js';
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

/**
 * ⭐ B-ONLY DRAFTER TEXT, sent on B's request only (A's BUILD_INSTRUCTIONS are untouched), verbatim, one space between:
 *  1. the AIE's sentence (19 Oct 2026; sha256 cfbe03aa8d84e1ed6452817987d331bbf15596be25487da26b93978316d95f49): an option's stated
 *     effect is a setting on the factor it changes, and an additive goal is a declared sum;
 *  2. the K5 P0 ruling's sentence (fresh Codex under §7.2, AIE silent; DL 20 Oct; sha256
 *     9111ed60fb9c8e4048118f3d49c6409ba98c59b2a39c2c0bcc90235faf9436ee): the goal's current level is its own fixed factor, a sum operand.
 *  3. Codex's corrected ONE-change sentence (20 Oct), sha256 96074041c73386e9e0a1e930dd4745ac422577aa91a40ceeedf28277508cb781.
 */
export const B_DRAFTER_SENTENCE = 'Represent each option\'s stated effect as a setting on the factor it changes rather than a sized link from the option, retaining every supplied point and complete range with the literal words, named speaker, source, stance, units, period and conditions; where the source meaning establishes that the goal quantity equals its current level plus additions, declare a sum in identities with bound current-level and addition operands and supported current levels for every operand and the total in the same quantity, units, period and reference; keep derived arithmetic visibly Olumi\'s, use zero only for a structurally defined increment at its stated reference, and leave unsupported levels or probability laws unknown.'
  + ' Where the source supports the goal level as its current level plus additions, represent that current level as a separate fixed factor carrying the supported goal baseline and its actual source, declare an entry in identities with operation sum, the goal as outcome and that factor plus every distinct addition as operands, and link each operand to the goal one for one in the same quantity, units, period and reference, retaining supported current levels, structural increment zeroes, effects, ranges and authorship while identifying the sum as Olumi’s interpretation and leaving unsupported probability laws unknown.'
  + ' For every figure, declare origin (user, third_party, olumi or unknown) and stance (stated_current, hypothetical, target or estimate) from its full source context; retain its literal source words where available, named source, sign, unit, period and conditions; identify your estimates and derivations as Olumi’s, preserve unresolved origin as unknown, and never promote a supposition to a stated current fact.'
  + ' Where the brief does not state a level, setting or size the model needs, propose a defensible Olumi starting estimate with origin=olumi and stance=estimate, explaining its basis, unit and period for the person to approve through the existing card, never presenting it as theirs; if no defensible estimate is possible, state the limitation and ask for the missing input rather than silently leaving the model unrunnable; in every draft with a supported additive goal, declare the sum identity with the separate current-level factor and every distinct addition as bound operands under the rules above.'
  + ' Declare stated additions in interventions with value_kind=additional, leaving unknown current levels as questions, and stated goal time limits in horizon_months and verbatim deadline_words, keeping relative periods relative without inventing dates.';

/** B declares meaning in the existing strict structured output; A's candidate schema stays unchanged. */
function bCandidateSchema(): Record<string, unknown> {
  const schema = buildCandidateSchema() as Record<string, any>;
  const origin = { type: 'string', enum: ['user', 'third_party', 'olumi', 'unknown'] };
  const stance = { type: 'string', enum: ['stated_current', 'hypothetical', 'target', 'estimate'], description: STANCE_DESCRIPTION };
  const pair = { origin, stance };
  const p = schema.properties;
  // B declares relative or calendar timing; A retains its calendar-clarification description.
  delete p.goal.properties.deadline_words.description;
  Object.assign(p.goal.properties, { target_origin: origin, target_stance: stance, baseline_origin: origin, baseline_stance: stance });
  for (const key of ['factors', 'risks', 'outcomes', 'links']) Object.assign(p[key].items.properties, pair);
  Object.assign(p.options.items.properties.interventions.items.properties, pair);
  return strictForTheDrafter(schema, { providerBoundary: false });
}

/** The ONE drafter call, on the static instructions and the literal brief: the draft, or why there is none. Nothing is written. */
async function drafted(callStructured: CallStructuredModel, brief: string): Promise<{ readonly draft: unknown } | { readonly outcome: ToolOutcome }> {
  const budget = budgetFor('gpt-5.6-terra', 'whole');
  let out: Awaited<ReturnType<CallStructuredModel>>;
  try {
    out = await callStructured({
      model: budget.model,
      instructions: `${BUILD_INSTRUCTIONS} ${B_DRAFTER_SENTENCE}`,
      input: turnContextItems({ now: new Date(), briefText: brief, conversation: [], construction: {} }).map(turnContextText).join('\n\n'),
      max_output_tokens: budget.max_output_tokens,
      reasoning_effort: budget.reasoning_effort,
      schema: bCandidateSchema(),
    });
  } catch {
    return { outcome: unavailable('construction_failed') };
  }
  // No answer, or one cut off before it closed: said as no structured output, never as the parse error it causes.
  if (out.text.length === 0) return { outcome: unavailable('no_structured_output') };
  try { return { draft: JSON.parse(out.text) as unknown }; } catch { return { outcome: unavailable('no_structured_output') }; }
}

export async function buildModel(deps: DraftDeps, ctx: Pick<AgentToolContext, 'scenario_id'> & TypedWords, args: BuildModelArgs): Promise<ToolOutcome> {
  const outcome = await construct(deps, ctx, args);
  const save_outcome = outcome.status === 'ok' ? 'VERIFIED_SAVED'
    : outcome.status === 'unavailable' && outcome.write === 'unknown' ? 'UNKNOWN' : 'VERIFIED_NO_WRITE';
  return { ...outcome, data: { ...outcome.data, save_outcome }, ...(save_outcome === 'UNKNOWN' ? {
    detail: 'The construction was dispatched, but its save could not be verified. It may already be saved. Do not say nothing was saved, and do not repeat a write or Run to repair the reply.',
  } : {}) };
}

async function construct(deps: DraftDeps, ctx: Pick<AgentToolContext, 'scenario_id'> & TypedWords, args: BuildModelArgs): Promise<ToolOutcome> {
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
    return unavailable('not_confirmed', 'unknown');
  }
  if (reg.status >= 400 && reg.status < 500) return refused('registration_refused');
  if (reg.status !== 200) return unavailable('not_confirmed', 'unknown');

  // The response is THIS create-only registration's receipt; history availability is not save verification.
  const receipt = reg.json.model_version as Partial<AtomicCommittedModelVersionReceipt> | undefined;
  const ack = typeof reg.json.graph_identity_hash === 'string' ? reg.json.graph_identity_hash
    : (reg.json.graph_identity_hash as { value?: unknown } | undefined)?.value;
  const after = await readSaved(deps, ctx.scenario_id);
  if (receipt == null || typeof receipt.version_id !== 'string' || receipt.version_id === ''
    || !Number.isSafeInteger(receipt.version_number) || Number(receipt.version_number) < 1
    || typeof receipt.mutation_id !== 'string' || receipt.mutation_id === ''
    || !isSavedRead(after) || typeof ack !== 'string' || ack !== after.identity
    || receipt.graph_identity_hash !== ack || computeGraphIdentityHash(after.graph as never)?.value !== ack
    || reg.json.graph_hash !== after.graphHash || receipt.analysis_affecting_hash !== computeAnalysisAffectingGraphHashSha256(after.graph as never)
    || !approvedGraphHeld(converted.graph, after.graph)) return unavailable('not_verified', 'unknown');
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
