/**
 * Agent lane — build a canonical model from the user's brief.
 *
 * The construction chain the banked experiment proved, wired to Olumi's own
 * admission and registration:
 *
 *   brief -> one-pass candidate (typed interventions) -> deterministic admission
 *         -> GraphV3 validation -> canonical registration
 *
 * ⭐ WHY ONE PASS. Measured 22 Sep on the live API against this module's own
 * `buildCandidateSchema()`: status "completed", in 838 / out 3404 (2070 of it
 * reasoning), 54.4 s, returning 4 options, 11 factors, 6 risks, 6 outcomes,
 * 18 links, 1 constraint and 4 interventions — and, the point of the exercise,
 * 5 of the 18 links came back `direction: "unknown"` rather than with a guessed
 * sign. The chain stays model-agnostic, so this is a configuration and not an
 * architecture.
 *
 * ⚠ A one-pass versus two-pass (builder → widener) comparison has NOT been
 * re-derived this session. Do not cite this docblock as settling that question.
 *
 * ⭐ WHY `interventions` IS ON THE SCHEMA. Without it the user's own number is
 * lost: the brief says "from £49 to £59" and, with the banked contract, 59
 * exists only as characters inside an option label — so the product asks the
 * user to restate a figure from their own first sentence. With this one field
 * the model returns `Pro plan monthly price = 59 [explicit]` on the option that
 * sets it, and readiness moved from 31 issues to 13 with two options `ready`.
 *
 * ⛔ REGISTRATION IS CANONICAL, NOT A DIRECT WRITE. An earlier shortcut used
 * `store_draft_graph`, which updates `graph` but NOT `graph_identity_hash`; the
 * two diverged and every CAS-bearing operation then failed `rpc_cas_conflict`,
 * including registration itself. The scenario had to be abandoned. This goes
 * through `/assist/v1/scenarios/:id/graph/register`, which computes and stores
 * the hash.
 */

import { createHash } from 'node:crypto';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import {
  assessConstructionSize,
  retryInstruction,
  keepsEveryUserStatedIdentity,
  nodeIdentity,
  type ConstructionSizeVerdict,
} from '../construction-size-gate.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { budgetFor } from '../model-budgets.js';
import type { ToolResult } from './agent-tools.js';
import type { InternalDispatch } from './agent-capabilities.js';

/** The construction contract: the banked schema plus typed interventions. */
export function buildCandidateSchema(): Record<string, unknown> {
  const provenance = { type: 'string', enum: ['explicit', 'inferred', 'ai_proposed'] };
  const obj = (properties: Record<string, unknown>, required: string[]) => ({
    type: 'object', additionalProperties: false, properties, required,
  });
  return obj({
    goal: obj({
      metric: { type: 'string' }, operator: { type: 'string', enum: ['>=', '<=', '>', '<'] },
      value: { type: 'number' }, unit: { type: 'string' },
      horizon_months: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, provenance,
    }, ['metric', 'operator', 'value', 'unit', 'horizon_months', 'provenance']),
    constraints: { type: 'array', items: obj({
      metric: { type: 'string' }, operator: { type: 'string', enum: ['>=', '<=', '>', '<'] },
      value: { type: 'number' }, unit: { type: 'string' }, provenance,
    }, ['metric', 'operator', 'value', 'unit', 'provenance']) },
    /**
     * ⛔ NO `maxItems` ON ANYTHING THAT CAN HOLD USER MATERIAL. Removed after an
     * exact-head review found the contract it broke.
     *
     * A cap of 6 options against a brief naming seven creates an IMPOSSIBLE
     * contract: preserve every explicit option AND emit at most six. The model can
     * only satisfy the schema by OMITTING what the user said — and the
     * post-admission size gate cannot detect what never arrived. A pre-gate cap is
     * therefore strictly more dangerous than the ≤12/≤20 admitted-model gate,
     * which sees the real graph and refuses out loud instead of silently shrinking.
     *
     * ⚠ The test that appeared to cover this proved nothing: it mocked
     * `callStructured` with a 14-option payload the real schema would have
     * REFUSED. A self-authored fixture standing in for the wire.
     *
     * If a cap is ever reinstated it needs a real-schema discriminator showing
     * explicit overflow REFUSES rather than disappears. `construction-user-material-protected.test.ts`
     * pins the absence so it cannot come back without one.
     */
    options: { type: 'array', items: obj({
      label: { type: 'string', description: 'A NAME, not a sentence. Keep it under 33 characters where you can.' },
      provenance,
      changes: { type: 'array', description:
        'Factor labels this option changes when it states no level \u2014 e.g. an option that phases, grandfathers or tests something. Use the factor labels exactly. An option that names nothing here and has no interventions is unreachable from the decision and cannot be analysed.',
        items: { type: 'string' } },
      interventions: { type: 'array', description:
        'The factor levels this option sets. Record a level the brief states, with provenance "explicit". Empty when the option changes nothing. Never guess a level.',
        items: obj({ factor_label: { type: 'string' }, value: { type: 'number' }, unit: { type: 'string' }, provenance },
          ['factor_label', 'value', 'unit', 'provenance']) },
    }, ['label', 'provenance', 'changes', 'interventions']) },
    factors: { type: 'array', items: obj({
      label: { type: 'string' }, role: { type: 'string', enum: ['controllable', 'observable', 'external'] },
      baseline_known: { type: 'boolean' }, baseline_value: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      unit: { anyOf: [{ type: 'string' }, { type: 'null' }] }, provenance,
      plausible_max: { type: 'number',
        description: 'REQUIRED, and NEVER null. The top of the range this factor could plausibly take, in its own unit \u2014 the SCALE it is read against, not a prediction. A percentage or a score out of 100: 100. A count, an amount or a price: a round number comfortably above anything realistic (a \u00a349 price might use 200; 300 subscribers might use 2000). Something ALREADY between 0 and 1: exactly 1. Every factor gets one, with or without a baseline today \u2014 a value adopted later is read against this same range.' },
    }, ['label', 'role', 'baseline_known', 'baseline_value', 'unit', 'provenance', 'plausible_max']) },
    risks: { type: 'array', items: obj({ label: { type: 'string' }, provenance }, ['label', 'provenance']) },
    outcomes: { type: 'array', items: obj({ label: { type: 'string' }, provenance }, ['label', 'provenance']) },
    links: { type: 'array', items: obj({
      from: { type: 'string' }, to: { type: 'string' },
      direction: { type: 'string', enum: ['positive', 'negative', 'unknown'] }, provenance,
    }, ['from', 'to', 'direction', 'provenance']) },
    unknowns: { type: 'array', items: { type: 'string' } },
  }, ['goal', 'constraints', 'options', 'factors', 'risks', 'outcomes', 'links', 'unknowns']);
}

export const BUILD_INSTRUCTIONS = [
  'Produce a complete causal decision model from the brief in ONE pass.',
  'Preserve exact user facts, numbers, constraint semantics and time horizon. Do not invent numeric baselines or behavioural effects.',
  'For each option fill `interventions` with the factor levels it sets \u2014 record a level the brief states with provenance "explicit", and never guess one it does not give.',
  'EVERY OPTION MUST SAY WHAT IT DOES. An option with no `interventions` AND no `changes` is inert: it can never be compared with another option, whatever values are supplied later, and the whole decision becomes unanswerable. If the brief does not say what an option changes, still name the factors it ACTS ON in `changes` \u2014 that is a structural claim, not a numeric one. '
  + 'EVERY option must also list, in `changes`, the factors it acts on WITHOUT a stated level. An option that names no interventions and no changes is disconnected from the decision and cannot be analysed at all, so this is not optional bookkeeping.',
  // ⛔ THE EXPLOSION CLAUSE, REPLACED. This previously read: "Then widen: add the
  // options, factors, risks, outcomes and causal mechanisms that materially improve
  // strategic reasoning, including alternatives beyond the user's initial frame."
  // Turn one was INSTRUCTED to widen, and because two further rules below require
  // every risk and factor to be wired through to the goal, each widened node also
  // acquired a chain — which is how Paul's first turn reached 26 nodes / 57 edges
  // from one sentence. The node count and the edge count had one root cause.
  //
  // Strategic additions are not abandoned; they move to `unknowns` and to later
  // proposals, where the user can accept them one at a time.
  'KEEP THE FIRST MODEL DECISION-CRITICAL, NOT COMPREHENSIVE. Include only what this decision cannot be reasoned about without: the goal, the options, the few factors that actually move the goal, and the risks that would change the answer. '
  + 'Do NOT widen on this turn. Do not add speculative options, secondary factors, or risks and outcomes that are not decision-critical for this question. '
  + 'Anything you judge material but that does not meet that bar belongs in `unknowns` as a question, NOT as a node — it can become a proposal later. '
  + 'Aim for at most 12 nodes and 20 links in total. Fewer, correct, connected items beat a comprehensive map: an oversized first model is refused before it reaches the canvas.',
  'Mark provenance honestly on EVERY item: "explicit" only for what the user stated, "inferred" for what you read out of the brief, "ai_proposed" for anything you added beyond it.',
  'THE GOAL METRIC MUST BE THE TERMINAL NODE. Every option needs a causal path that ends at the goal metric you named in `goal.metric`. Use that EXACT label as the endpoint of the final link \u2014 do not invent a near-synonym outcome like "X Improvement" for a goal called "X change", because a separate synonym leaves the goal disconnected and the model cannot be analysed at all.',
  'EVERY RISK AND EVERY FACTOR MUST BE WIRED IN. A node with no link, or with links that dead-end before the goal, is not merely decorative \u2014 it stops the ENTIRE model being analysed. Give every risk a link to what it threatens, and every factor a chain of links that ends at the goal metric. Measured on a real model: 8 of 20 nodes were unreachable, all five risks among them, and the analysis refused outright.',
  'GIVE EVERY FACTOR A `plausible_max`. IT IS REQUIRED AND NEVER NULL, for every factor, whether or not it has a baseline today. A number above 1 with no range beside it CANNOT BE ANALYSED \u2014 the engine has nothing to read it against, Olumi refuses the WHOLE analysis rather than guess, and NO LATER EDIT CAN SUPPLY THE RANGE: the only remedy is rebuilding the model. The range is a SCALE, not a forecast: 100 for a percentage or a score out of 100, exactly 1 for something already between 0 and 1, and a round number comfortably above anything realistic for a count, an amount or a price. Measured twice on real models.',
  'Where a causal direction is genuinely unknown, say "unknown" rather than guessing a sign.',
  'Labels are NAMES, not sentences.',
  'Output only the schema.',
].join(' ');

export type CallStructuredModel = (req: {
  model: string; instructions: string; input: string;
  max_output_tokens: number; schema: Record<string, unknown>;
  reasoning_effort?: 'low' | 'medium' | 'high';
}) => Promise<{ text: string; usage?: Record<string, unknown> }>;

/**
 * ⭐ THE CONSTRUCTION'S OPERATION IDENTITY — derived, never minted.
 *
 * The same (scenario, brief) always names the same operation, so if a
 * registration response is lost and the build is retried, the retry reaches the
 * registration route's replay arm and gets back the ORIGINAL receipt instead of
 * minting a second version. A different brief is a different operation.
 *
 * A v4-shaped UUID because the route validates `operation_id` as a UUID; the
 * version and variant nibbles are forced, the rest is the digest.
 */
export function constructionOperationId(scenarioId: string, brief: string): string {
  const h = createHash('sha256').update(`agent_construction:${scenarioId}:${brief}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** The version a construction became, as the Agent may cite it. */
export interface ConstructionVersion {
  readonly version_id: string;
  readonly version_number: number;
  readonly mutation_id: string | null;
  readonly creation_kind: string;
  readonly source_turn_id: string;
}

/**
 * ⭐ FIND A CONSTRUCTION THAT ALREADY COMMITTED — by its operation, not by guessing.
 *
 * ⛔ THE DEFECT THIS CLOSES, from the independent review of #1691 at 84dadabb:
 * after a build commits and its response is lost, a retry reached the
 * "model already has entities" guard BEFORE it ever sent the derived
 * operation id, so the registration replay arm was unreachable from the Agent
 * — the model was saved and the Agent reported a refusal.
 *
 * The lookup is a READ through the product's own versions route: the
 * construction's version carries `creation.source_turn_id`, and the turn id is
 * derived from the SAME function the registration route uses. Anything the read
 * cannot answer (a guest has no versions; the flag is off; a non-200) is "not
 * found", never a receipt — so the caller falls back to today's behaviour
 * rather than inventing one.
 */
export async function findConstructionVersion(
  dispatch: InternalDispatch,
  scenarioId: string,
  brief: string,
): Promise<ConstructionVersion | null> {
  const turnId = registrationTurnId(scenarioId, constructionOperationId(scenarioId, brief));
  let cursor: string | undefined;
  // Bounded: a construction is the FIRST version, so it is on the last page of
  // a newest-first history; five pages of 200 is far past any retry window.
  for (let page = 0; page < 5; page += 1) {
    const r = await dispatch(`/assist/v1/scenarios/${scenarioId}/versions`, {
      limit: 200,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (r.status !== 200) return null;
    const versions = Array.isArray(r.json.versions) ? (r.json.versions as Array<Record<string, unknown>>) : [];
    const hit = versions.find((v) => (v.creation as { source_turn_id?: unknown } | undefined)?.source_turn_id === turnId);
    if (hit !== undefined) {
      const creation = hit.creation as { kind?: unknown; mutation_id?: unknown; source_turn_id?: unknown };
      return {
        version_id: String(hit.version_id),
        version_number: Number(hit.sequence),
        mutation_id: typeof creation.mutation_id === 'string' ? creation.mutation_id : null,
        creation_kind: String(creation.kind),
        // The id the ROW carries, not the one we searched for: equal under a
        // correct match, and under any drift the returned object must not mask it.
        source_turn_id: String(creation.source_turn_id),
      };
    }
    cursor = typeof r.json.next_cursor === 'string' ? r.json.next_cursor : undefined;
    if (cursor === undefined) return null;
  }
  return null;
}

export async function buildModelFromBrief(
  scenarioId: string,
  brief: string,
  dispatch: InternalDispatch,
  callStructured: CallStructuredModel,
): Promise<ToolResult> {
  const budget = budgetFor('gpt-5.6-terra', 'whole');
  let candidate: CandidateModel;
  try {
    const out = await callStructured({
      model: budget.model,
      instructions: BUILD_INSTRUCTIONS,
      input: brief,
      max_output_tokens: budget.max_output_tokens,
      reasoning_effort: budget.reasoning_effort,
      schema: buildCandidateSchema(),
    });
    if (out.text.length === 0) {
      // Measured failure mode: at too small a budget, reasoning consumes the
      // whole allowance and no structured answer is emitted at all.
      return { ok: false, mutated: false, refusal: 'no_structured_output' };
    }
    candidate = JSON.parse(out.text) as CandidateModel;
  } catch (err) {
    return { ok: false, mutated: false, refusal: 'construction_failed', detail: String(err).slice(0, 200) };
  }

  let admitted = admitCandidateModel(candidate, {});

  /**
   * ⭐ THE COMPACT FIRST-MODEL GATE — one bounded retry, then an honest refusal.
   *
   * Measured on Paul's exact first turn: 26 nodes / 57 edges from one sentence.
   * The size is judged on the ADMITTED graph, never the candidate, because
   * admission is what decides which items become nodes at all — a cap read off
   * the raw candidate would measure a different object from the one registered
   * and would disagree with the canvas the user sees.
   *
   * ⛔ NOTHING HERE TRUNCATES. The gate returns counts, not a model (its verdict
   * carries no array at all, pinned by its own spec), so "use the gate's output"
   * cannot quietly become "persist the smaller graph". Oversize is answered by
   * asking the model again under a tighter instruction, or by refusing out loud.
   *
   * ⭐⭐ AND THE CAP NEVER OVERRIDES THE USER. When the brief's OWN stated
   * material alone exceeds the limit, the model is ADMITTED and the fact is
   * reported: a user with thirteen options has thirteen options, and a size
   * target that deleted one would be the wrong way round.
   */
  let size: ConstructionSizeVerdict = assessConstructionSize(admitted);
  let sizeRetried = false;
  // ⛔ NEVER SILENTLY. What an adopted retry shed from the first draft, and the
  // questions it parked in `unknowns`, travel with the result so the Agent can say
  // them — otherwise an option the model mislabelled as its own vanishes unseen.
  let leftOut: { kind: string; label: string }[] = [];
  let openQuestions: string[] = [];
  if (!size.within && !size.user_material_exceeds_limit) {
    sizeRetried = true;
    try {
      const retry = await callStructured({
        model: budget.model,
        // The delta is APPENDED, so every rule the first pass obeyed still holds —
        // provenance, wiring, plausible_max, no invented numbers.
        instructions: `${BUILD_INSTRUCTIONS} ${retryInstruction(size)}`,
        input: brief,
        max_output_tokens: budget.max_output_tokens,
        reasoning_effort: budget.reasoning_effort,
        schema: buildCandidateSchema(),
      });
      if (retry.text.length > 0) {
        const retryCandidate = JSON.parse(retry.text) as CandidateModel;
        const retryAdmitted = admitCandidateModel(retryCandidate, {});
        const retrySize = assessConstructionSize(retryAdmitted);
        // ⚠ ADOPT ONLY WHAT IS ACTUALLY SMALLER, on BOTH dimensions. A retry that
        // trades 4 nodes for 11 links is not a compaction, and taking it on faith
        // would let a second model call make the problem worse.
        // ⭐⭐ AND IT MUST NOT HAVE COST THE USER ANYTHING. Smaller is not
        // sufficient: a retry that sheds two widened factors while also dropping a
        // relationship the user stated is a worse model, and the size numbers alone
        // cannot tell the difference. So the brief-stated counts must not regress —
        // that is what makes "the cap never overrides the user" true of RETRIES and
        // not merely of the refusal path.
        // ⛔ BY IDENTITY, NOT COUNT (independent review at 78b07e8b): every option,
        // fact and relationship the user stated must still be there by name.
        const keepsUserMaterial = keepsEveryUserStatedIdentity(size, retrySize);
        if (
          retrySize.nodes <= size.nodes &&
          retrySize.edges <= size.edges &&
          keepsUserMaterial
        ) {
          const kept = new Set(retryAdmitted.nodes.map(nodeIdentity));
          leftOut = admitted.nodes
            .filter((n) => !kept.has(nodeIdentity(n)))
            .map((n) => ({ kind: String(n.kind), label: String((n as { description?: unknown }).description ?? n.label) }));
          const parked = (retryCandidate as { unknowns?: unknown }).unknowns;
          openQuestions = Array.isArray(parked) ? parked.filter((q): q is string => typeof q === 'string' && q.trim() !== '') : [];
          candidate = retryCandidate;
          admitted = retryAdmitted;
          size = retrySize;
        }
      }
    } catch {
      // A failed retry costs the retry, never the turn: the refusal below reports
      // the FIRST model's real counts rather than inventing a reason.
    }
  }

  if (!size.within && !size.user_material_exceeds_limit) {
    return {
      ok: false,
      mutated: false,
      refusal: 'model_too_large',
      detail: size.detail,
      nodes: size.nodes,
      edges: size.edges,
      limits: size.limits,
      by_kind: size.by_kind,
      // What was added beyond the brief — the honest shed target, reported so the
      // refusal cannot read as "your decision was too complicated".
      added_beyond_brief: size.sheddable_nodes,
      from_your_brief: size.brief_stated_nodes,
      retried: sizeRetried,
    };
  }

  /**
   * ⭐ THE USER'S STATED LIMITS TRAVEL WITH THE GRAPH.
   *
   * ⛔ I PREVIOUSLY RECORDED — AND PUBLISHED — THAT THEY HAD NO CARRIER, on the
   * grounds that `/graph/register` accepts only `graph` and `brief_text`. That
   * was wrong, and wrong in the expensive direction: it wrote off a capability
   * the product already had. `GraphV3` declares `goal_constraints`, and a live
   * probe against deployed staging confirmed they survive registration and read
   * back intact. The reasoning error was inferring a limit from the ROUTE's
   * body fields without checking what the GRAPH itself may carry.
   *
   * So a brief that says "no more than £100,000" or "under 4% churn" now
   * produces an enforceable constraint rather than a sentence the model merely
   * mentioned.
   */
  const graph = {
    nodes: admitted.nodes,
    edges: admitted.edges,
    ...(admitted.goal_constraints.length > 0
      ? { goal_constraints: admitted.goal_constraints }
      : {}),
  };

  // Never persist a graph the product cannot then read.
  const parsed = GraphV3.safeParse(graph);
  if (!parsed.success) {
    return {
      ok: false, mutated: false, refusal: 'admitted_graph_invalid',
      issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')),
    };
  }

  const reg = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph/register`, {
    graph,
    brief_text: brief,
    operation_id: constructionOperationId(scenarioId, brief),
  });
  if (reg.status === 409 && (reg.json.details as { code?: unknown } | undefined)?.code === 'OPERATION_ID_REUSED') {
    /**
     * ⭐ A CONCURRENT BUILD OF THE SAME CONSTRUCTION ALREADY WON. Both calls passed
     * the empty-graph guard and generated a model — generation is not
     * deterministic, so the bytes differ — and the route refused this one
     * because the operation was already committed. That is the SAME
     * construction, saved once: recover its receipt instead of reporting a
     * refusal for a model the user now has.
     */
    const prior = await findConstructionVersion(dispatch, scenarioId, brief);
    if (prior !== null) return { ok: true, mutated: false, replayed: true, model_version: prior };
  }
  if (reg.status !== 200) {
    return { ok: false, mutated: false, refusal: 'registration_refused', http: reg.status, detail: String(reg.json.message ?? '').slice(0, 200) };
  }

  // The canonical version this construction produced, so the Agent can cite a
  // real version number instead of asserting one. Absent when the registration
  // wrote no version (a graph GraphV3 cannot version) — the Agent must then not
  // claim one.
  const modelVersion = (reg.json as { model_version?: unknown }).model_version;
  // True only when this construction had ALREADY been committed and the route
  // handed back the original version rather than writing another.
  const replayed = (reg.json as { replayed?: unknown }).replayed === true;

  return {
    ok: true,
    mutated: true,
    ...(modelVersion === undefined ? {} : { model_version: modelVersion }),
    ...(replayed ? { replayed: true } : {}),
    nodes: admitted.nodes.length,
    edges: admitted.edges.length,
    // The compact verdict travels with the success, so a caller never has to
    // re-derive it — and `size_retried` makes the second model call visible
    // rather than hidden inside a latency number.
    within_compact_limits: size.within,
    size_retried: sizeRetried,
    ...(size.user_material_exceeds_limit
      ? { admitted_over_limit_because: 'your own stated options and facts exceed the compact limit' }
      : {}),
    options: admitted.nodes.filter((n) => n.kind === 'option').length,
    // What the projection could not carry — the Agent is expected to say this.
    withheld: admitted.withheld.map((w) => ({ from: w.from, to: w.to, reason: w.reason })),
    projected_field_count: admitted.loss.length,
    // Options that say what they DO, versus options that are inert. An inert
    // option can never be compared, whatever values arrive later.
    options_that_change_nothing: admitted.withheld
      .filter((w) => w.reason === 'option_changes_nothing')
      .map((w) => w.from),
    // Carried WITH the graph (GraphV3 declares `goal_constraints`), verified
    // surviving registration on deployed staging.
    goal_constraints_carried: admitted.goal_constraints.length,
    ...(leftOut.length > 0 ? { left_out_to_stay_compact: leftOut } : {}),
    ...(openQuestions.length > 0 ? { open_questions: openQuestions } : {}),
    not_represented: [
      admitted.withheld.length > 0
        ? `${admitted.withheld.length} relationship(s) were left out because nobody has stated which way they run.`
        : undefined,
      leftOut.length > 0
        ? `${leftOut.length} item(s) from the first draft were left out to keep the model compact: ${leftOut.map((x) => x.label).join('; ')}.`
        : undefined,
    ].filter((s): s is string => s !== undefined),
  };
}
