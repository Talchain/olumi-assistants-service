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

import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
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
    }, ['label', 'role', 'baseline_known', 'baseline_value', 'unit', 'provenance']) },
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
  'EVERY option must also list, in `changes`, the factors it acts on WITHOUT a stated level. An option that names no interventions and no changes is disconnected from the decision and cannot be analysed at all, so this is not optional bookkeeping.',
  'Then widen: add the options, factors, risks, outcomes and causal mechanisms that materially improve strategic reasoning, including alternatives beyond the user’s initial frame.',
  'Mark provenance honestly on EVERY item: "explicit" only for what the user stated, "inferred" for what you read out of the brief, "ai_proposed" for anything you added beyond it.',
  'THE GOAL METRIC MUST BE THE TERMINAL NODE. Every option needs a causal path that ends at the goal metric you named in `goal.metric`. Use that EXACT label as the endpoint of the final link \u2014 do not invent a near-synonym outcome like "X Improvement" for a goal called "X change", because a separate synonym leaves the goal disconnected and the model cannot be analysed at all.',
  'Where a causal direction is genuinely unknown, say "unknown" rather than guessing a sign.',
  'Labels are NAMES, not sentences.',
  'Output only the schema.',
].join(' ');

export type CallStructuredModel = (req: {
  model: string; instructions: string; input: string;
  max_output_tokens: number; schema: Record<string, unknown>;
  reasoning_effort?: 'low' | 'medium' | 'high';
}) => Promise<{ text: string; usage?: Record<string, unknown> }>;

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

  const admitted = admitCandidateModel(candidate, {});
  const graph = { nodes: admitted.nodes, edges: admitted.edges };

  // Never persist a graph the product cannot then read.
  const parsed = GraphV3.safeParse(graph);
  if (!parsed.success) {
    return {
      ok: false, mutated: false, refusal: 'admitted_graph_invalid',
      issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')),
    };
  }

  const reg = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph/register`, { graph, brief_text: brief });
  if (reg.status !== 200) {
    return { ok: false, mutated: false, refusal: 'registration_refused', http: reg.status, detail: String(reg.json.message ?? '').slice(0, 200) };
  }

  return {
    ok: true,
    mutated: true,
    nodes: admitted.nodes.length,
    edges: admitted.edges.length,
    options: admitted.nodes.filter((n) => n.kind === 'option').length,
    // What the projection could not carry — the Agent is expected to say this.
    withheld: admitted.withheld.map((w) => ({ from: w.from, to: w.to, reason: w.reason })),
    projected_field_count: admitted.loss.length,
    // ⚠ REPRESENTATION LOSS AT THIS BOUNDARY, recorded rather than hidden.
    // `/graph/register` accepts `graph` and `brief_text` only. The admitted
    // goal constraints have no carrier on this route, so a constraint the user
    // stated is NOT enforced by the model this call persists.
    goal_constraints_not_carried: admitted.goal_constraints.length,
    not_represented: [
      admitted.withheld.length > 0
        ? `${admitted.withheld.length} relationship(s) were left out because nobody has stated which way they run.`
        : undefined,
      admitted.goal_constraints.length > 0
        ? `${admitted.goal_constraints.length} stated constraint(s) are not carried by this write and are not being enforced yet.`
        : undefined,
    ].filter((s): s is string => s !== undefined),
  };
}
