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
  COMPACT_LIMITS,
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
    /**
     * ⛔ AN UNSTATED TARGET MUST BE SAYABLE. `value` used to be a bare
     * `{ type: 'number' }` in `required`, so the schema made "the brief names no
     * numeric target" IMPOSSIBLE to express: the model had to emit a number, and for
     * "increase productivity" it emitted 0. Admission then wrote
     * `goal_threshold_raw: 0, unit: '%'` and stamped it `from_brief`, so the product
     * told the user THEY had asked for a 0% increase. Measured on Paul's hiring brief
     * (#63 5811781699): "Goal productivity_increase is stamped from_brief,
     * threshold_raw 0, unit %, frame level; admission says goal_target_stated=true.
     * Brief states no numeric target."
     *
     * ⭐ THE FIX IS THE PATTERN THIS SCHEMA ALREADY USES FOR FACTORS, not a new one:
     * `baseline_known: boolean` beside a nullable `baseline_value`, so a factor can
     * say "no baseline was given". The goal had no equivalent. It does now.
     * `target_stated` stays in `required` so the key must be emitted — an absent
     * flag is how this estate gets silent defaults.
     */
    goal: obj({
      metric: { type: 'string' }, operator: { type: 'string', enum: ['>=', '<=', '>', '<'] },
      target_stated: { type: 'boolean' },
      value: { anyOf: [{ type: 'number' }, { type: 'null' }] }, unit: { type: 'string' },
      horizon_months: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, provenance,
    }, ['metric', 'operator', 'target_stated', 'value', 'unit', 'horizon_months', 'provenance']),
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
        'The factor level this option sets, or a signed addition to its baseline. Distinguish these meanings with value_kind. Preserve user numbers; an estimated level is ai_proposed, never explicit. Include the unchanged levels for the current-state option.',
        items: obj({ factor_label: { type: 'string' }, value: { type: 'number' }, value_kind: { type: 'string', enum: ['absolute', 'additional'] }, unit: { type: 'string' }, provenance },
          ['factor_label', 'value', 'value_kind', 'unit', 'provenance']) },
    }, ['label', 'provenance', 'changes', 'interventions']) },
    factors: { type: 'array', items: obj({
      label: { type: 'string' }, role: { type: 'string', enum: ['controllable', 'observable', 'external'] },
      baseline_known: { type: 'boolean', description: 'True only for a baseline supplied by the user or evidence. A provisional AI estimate keeps this false.' },
      baseline_value: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'A stated baseline or a clearly provisional AI modelling estimate. Provide a reasonable estimate for a first calculation when possible; use null only when no defensible estimate is available.' },
      unit: { anyOf: [{ type: 'string' }, { type: 'null' }] }, provenance,
      plausible_max: { type: 'number',
        description: 'REQUIRED, and NEVER null. The top of the range this factor could plausibly take, in its own unit \u2014 the SCALE it is read against, not a prediction. A percentage or a score out of 100: 100. A count, an amount or a price: a round number comfortably above anything realistic (a \u00a349 price might use 200; 300 subscribers might use 2000). Something ALREADY between 0 and 1: exactly 1. Every factor gets one, with or without a baseline today \u2014 a value adopted later is read against this same range.' },
    }, ['label', 'role', 'baseline_known', 'baseline_value', 'unit', 'provenance', 'plausible_max']) },
    risks: { type: 'array', items: obj({ label: { type: 'string' }, provenance }, ['label', 'provenance']) },
    outcomes: { type: 'array', items: obj({ label: { type: 'string' }, provenance }, ['label', 'provenance']) },
    links: { type: 'array', description:
      'Causal links, stated as hypotheses. Every factor you keep needs at least one link FROM it toward the goal metric (directly, or via a kept outcome that links to the goal). Never link an option directly to a risk \u2014 link the option to the factor it changes and the factor to the risk, because a bare option-to-risk link cannot be analysed.',
      items: obj({
      from: { type: 'string' }, to: { type: 'string' },
      direction: { type: 'string', enum: ['positive', 'negative', 'unknown'], description:
        'The direction read from the brief or from causal reasoning you can state in one line. "unknown" only when you genuinely cannot say \u2014 then ask which way it runs in `unknowns`; an unknown link is withheld and is not a path.' },
      provenance,
    }, ['from', 'to', 'direction', 'provenance']) },
    unknowns: { type: 'array', items: { type: 'string' } },
  }, ['goal', 'constraints', 'options', 'factors', 'risks', 'outcomes', 'links', 'unknowns']);
}

export const BUILD_INSTRUCTIONS = [
  'Produce a complete causal decision model from the brief in ONE pass.',
  'Preserve exact user facts, numbers, constraint semantics and time horizon. The first model must support a PROVISIONAL calculation before user adoption: provide defensible starting estimates where the brief gives no baseline, mark those factors ai_proposed with baseline_known:false, and explain the uncertainty in unknowns. These are modelling assumptions, never measurements or user-validated facts. If no defensible estimate is possible, leave it null and name the specific unresolved input.',
  'For each option fill `interventions` with its factor settings. value_kind:"absolute" means the resulting total or level; value_kind:"additional" means a signed change from the same factor baseline. For hiring, adding two to a proposed baseline of five means total seven, never total two. Record the user-stated addition as explicit but keep an estimated resulting level ai_proposed. Keep one unit and plausible_max frame per factor across all baselines and options; the current-state option explicitly keeps those baseline levels.',
  'Connect options to the controllable factors they change, then through supported causal mechanisms to risks and the goal. Never emit a direct option-to-risk link: it cannot be interpreted as an option setting a risk value. Retain each meaningful risk hypothesis, its sign and its downstream path; express its exposure through a causal factor or mediator, rather than deleting the risk or claiming equal exposure.',
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
  //
  // ⭐ THE ENVELOPE, NOT A MINIMUM (Release Control, 23 Sep). "Decision-critical"
  // alone was read as "as few as possible": measured on served 553254d, Paul's
  // hiring brief came back as 6 nodes — decision, goal, 2 options, 2 factors — and
  // no factor linked on to the goal, so the analysis refused. The shape below is
  // the stated envelope; the node and link ceilings are the size gate's own.
  'KEEP THE FIRST MODEL DECISION-CRITICAL, NOT COMPREHENSIVE \u2014 BUT NOT THIN. The shape to aim for is this envelope: one goal; '
  + 'EVERY option the user stated, never dropped or merged, and normally 3 to 5 options in total \u2014 when the user states fewer than 3, add carrying on as now if they did not state it, then the strongest alternative the question itself points to (such as a partial, phased or smaller version of a stated option), each marked "ai_proposed"; '
  + 'roughly 4 to 8 factors that actually move the goal \u2014 besides any factor an option sets directly, name the MECHANISMS through which those changes reach the goal, never an option merely restated as a quantity; '
  + 'and up to 4 to 6 outcomes and risks between them, only where they materially change the reasoning (the outcome the factors act through, the risk that could reverse the answer). '
  + 'A model below this envelope cannot carry the reasoning; a model above it buries it. Do NOT widen beyond it on this turn: no speculative options, secondary factors, or decorative risks and outcomes. '
  + 'Anything you judge material but that does not meet that bar belongs in `unknowns` as a question, NOT as a node \u2014 it can become a proposal later. '
  + `Stay within ${COMPACT_LIMITS.maxNodes} nodes and ${COMPACT_LIMITS.maxEdges} links in total, counting one link from the decision to each option. Correct, connected items beat a comprehensive map: an oversized first model is refused before it reaches the canvas.`,
  'Mark provenance honestly on EVERY item: "explicit" only for what the user stated, "inferred" for what you read out of the brief, "ai_proposed" for anything you added beyond it.',
  /*
   * ⛔ THE COMPANION INSTRUCTION TO `target_stated`. The schema now lets the model say
   * "no target was given"; nothing yet told it WHEN to. Without this the nullable field
   * is a capability no caller uses — and a 0 attributed to the user is the worst of the
   * available wrong answers, because it reads as a deliberate choice they made.
   */
  'A GOAL TARGET THE BRIEF DOES NOT STATE MUST BE LEFT UNSTATED. If the user named a number to reach \u2014 "to 40%", "by \u00a33m", "under 4 weeks" \u2014 set `target_stated: true` and put that number in `goal.value`. If they only named a DIRECTION \u2014 "increase productivity", "cut churn", "improve velocity" \u2014 then set `target_stated: false` and `goal.value: null`. Never substitute 0, never invent a plausible target, and never treat the absence of a number as a target of zero: a direction with no number is a complete and ordinary goal, and the analysis compares options against it perfectly well. Getting this wrong tells the user they asked for something they did not ask for.',
  'THE GOAL METRIC MUST BE THE TERMINAL NODE. Every option needs a causal path that ends at the goal metric you named in `goal.metric`. Use that EXACT label as the endpoint of the final link \u2014 do not invent a near-synonym outcome like "X Improvement" for a goal called "X change", because a separate synonym leaves the goal disconnected and the model cannot be analysed at all.',
  // ⛔ THE LINK CONTRACT (#63 ruling 5793252993). There is NO default-positive
  // factor->goal repair in admission, by ruling: a sign nobody stated would be a
  // fabricated belief. So the drafter itself must state every link toward the
  // goal as a HYPOTHESIS with a direction, or say it cannot and ask. The measured
  // failure it answers: served 553254d, option->factor links only, goal orphaned.
  'EVERY RISK AND EVERY FACTOR MUST BE WIRED IN. A node with no link, or with links that dead-end before the goal, is not merely decorative \u2014 it stops the ENTIRE model being analysed. Measured on a real model: 8 of 20 nodes were unreachable, all five risks among them, and the analysis refused outright. '
  + 'EVERY FACTOR YOU KEEP NEEDS ITS OWN LINK TOWARD THE GOAL in `links`: straight to the goal metric (its EXACT label), or to a kept outcome that itself links to the goal metric. An option naming a factor in `changes` connects the option TO the factor; it does NOT connect the factor to anything, so a factor that only receives links from options dead-ends. Measured on a real first model: two factors, both fed only by options, neither linked on, the goal orphaned and the analysis refused. Give every risk a link to what it threatens. '
  + 'AND NEVER LINK AN OPTION STRAIGHT TO A RISK. An option changes a FACTOR, and it is the factor that raises or lowers the risk, so state it as `option -> factor` (through `changes`/`interventions`) and then `factor -> risk` with its own direction, and the risk on to what it threatens. A bare option -> risk link is the one shape that LOOKS connected and cannot be analysed at all: Olumi has to stop and ask how that option changes that risk before ANY of the model can run. Measured: ONE such link refuses the whole analysis, and a real first model carried four of them. If you cannot name the factor in between, do not draw the link: ask which factor carries it in `unknowns`.',
  'EACH LINK IS A CAUSAL HYPOTHESIS, AND ITS DIRECTION MUST BE STATED, NOT DEFAULTED. Take the direction from the brief where it says so; otherwise from the causal reasoning you could state in one line ("more delivery capacity raises velocity"; "a higher price raises churn"; "higher churn lowers recurring revenue"). '
  + 'Such a link is Olumi\'s hypothesis, not the user\'s claim: provenance "inferred" when it is read out of the brief, "ai_proposed" when it is your own reasoning, and "explicit" ONLY when the user stated that relationship. '
  + 'WHICH option is better is the question the analysis answers \u2014 it is never a reason to mark a factor\'s link to the goal "unknown": more capacity raises velocity whichever option supplies it. '
  + 'Only when you genuinely cannot say which way a link runs, set its direction to "unknown" AND add a question to `unknowns` asking the user which way it runs. An "unknown" link is withheld from the model and never counts as a path, so every option must still reach the goal through links whose direction you can state.',
  'GIVE EVERY FACTOR A `plausible_max`. IT IS REQUIRED AND NEVER NULL, for every factor, whether or not it has a baseline today. A number above 1 with no range beside it CANNOT BE ANALYSED \u2014 the engine has nothing to read it against, Olumi refuses the WHOLE analysis rather than guess, and NO LATER EDIT CAN SUPPLY THE RANGE: the only remedy is rebuilding the model. The range is a SCALE, not a forecast: 100 for a percentage or a score out of 100, exactly 1 for something already between 0 and 1, and a round number comfortably above anything realistic for a count, an amount or a price. Measured twice on real models.',
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

/**
 * The retry's contract, with the user's OWN goal fixed as structured input
 * (independent review of #1775, 5802902264 then 5803023774).
 *
 * MEASURED on served `785185b7` (2 of 12 hiring draws): the compact retry fixed the
 * size and kept the user's options but reworded the goal ("delivery velocity" →
 * "velocity"); the label-keyed identity check then discarded a valid model and the
 * user got none. The repair is NOT to decide afterwards that two goals are
 * equivalent — cardinality and shared words both proved unsafe (a different
 * objective, or "defect rate" vs "defect escape rate", would pass). The retry is a
 * COMPACTION: it may not choose a goal at all. Every goal field is pinned to the
 * first model's value, so strict structured output must return that exact goal and
 * the model links to it by its exact label; the unchanged identity check still
 * refuses anything else.
 */
export function retrySchemaPinningGoal(goal: CandidateModel['goal']): Record<string, unknown> {
  const schema = buildCandidateSchema();
  const goalSchema = (schema['properties'] as Record<string, Record<string, unknown>>)['goal'];
  if (goalSchema === undefined) return schema;
  goalSchema['properties'] = {
    metric: { type: 'string', enum: [goal.metric] },
    operator: { type: 'string', enum: [goal.operator] },
    // A pinned `null` must stay expressible: `{type:'number', enum:[null]}` is
    // unsatisfiable, so the compaction retry could never return the goal it was
    // pinned to and every unstated-target brief would lose its retry.
    target_stated: { type: 'boolean', enum: [goal.target_stated !== false] },
    value: goal.value === null || typeof goal.value !== 'number'
      ? { type: 'null' }
      : { type: 'number', enum: [goal.value] },
    unit: { type: 'string', enum: [goal.unit] },
    horizon_months: goal.horizon_months === null ? { type: 'null' } : { type: 'integer', enum: [goal.horizon_months] },
    provenance: { type: 'string', enum: [goal.provenance] },
  };
  return schema;
}

/** Resolve declared additions before admission's absolute-level contract. */
export function prepareProvisionalCandidate(model: CandidateModel): { candidate: CandidateModel; issues: string[] } {
  const issues: string[] = [];
  const options = model.options.map((option) => ({
    ...option,
    interventions: option.interventions?.map((intervention) => {
      const kind = (intervention as typeof intervention & { value_kind?: string }).value_kind;
      if (kind === undefined || kind === 'absolute') return intervention; // Existing stored candidates.
      if (kind !== 'additional') {
        issues.push(`${option.label}: unknown value_kind for ${intervention.factor_label}`);
        return intervention;
      }
      const factors = model.factors.filter((f) => f.label === intervention.factor_label);
      const factor = factors.length === 1 ? factors[0] : undefined;
      if (factor === undefined || typeof factor.baseline_value !== 'number' || !Number.isFinite(factor.baseline_value)
        || !Number.isFinite(intervention.value) || !Number.isFinite(factor.baseline_value + intervention.value)
        || !factor.unit || !intervention.unit || factor.unit.trim().toLowerCase() !== intervention.unit.trim().toLowerCase()) {
        issues.push(`${option.label}: ${intervention.factor_label} needs one finite baseline and matching units before an addition can become a total`);
        return intervention;
      }
      return {
        ...intervention, value_kind: 'absolute', value: factor.baseline_value + intervention.value,
        provenance: factor.baseline_known && factor.provenance === 'explicit' && intervention.provenance === 'explicit'
          ? 'explicit' : 'ai_proposed',
      };
    }),
  }));
  const optionLabels = new Set(model.options.map((o) => o.label));
  const riskLabels = new Set(model.risks.map((r) => r.label));
  for (const link of model.links) {
    if (optionLabels.has(link.from) && riskLabels.has(link.to)) {
      issues.push(`${link.from} -> ${link.to}: retain this risk hypothesis through a causal factor or mediator, not a direct option-risk setting`);
    }
  }
  return { candidate: { ...model, options }, issues };
}

/** A repair may replace an invalid direct edge, but must preserve its signed path. */
function retainsRiskHypotheses(before: CandidateModel, after: CandidateModel): boolean {
  const paths = (model: CandidateModel, from: string, to: string): Set<number> => {
    const links = [
      ...model.links.filter((l) => l.direction !== 'unknown').map((l) => ({ from: l.from, to: l.to, sign: l.direction === 'negative' ? -1 : 1 })),
      ...model.options.flatMap((o) => [...(o.changes ?? []), ...(o.interventions ?? []).map((i) => i.factor_label)]
        .map((factor) => ({ from: o.label, to: factor, sign: 1 }))),
    ];
    const signs = new Set<number>();
    const walk = (at: string, sign: number, seen: Set<string>): void => {
      if (at === to) { signs.add(sign); return; }
      for (const link of links.filter((l) => l.from === at && !seen.has(l.to))) {
        walk(link.to, sign * link.sign, new Set([...seen, link.to]));
      }
    };
    walk(from, 1, new Set([from]));
    return signs;
  };
  for (const risk of before.risks) {
    if (!after.risks.some((r) => r.label === risk.label)) return false;
    const downstream = paths(after, risk.label, after.goal.metric);
    if (downstream.size === 0 || [...paths(before, risk.label, before.goal.metric)].some((s) => !downstream.has(s))) return false;
    for (const option of before.options) {
      const prior = paths(before, option.label, risk.label);
      const repaired = paths(after, option.label, risk.label);
      if ([...prior].some((s) => !repaired.has(s))) return false;
    }
  }
  return before.options.every((o) => after.options.some((kept) => kept.label === o.label));
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

  let preparation = prepareProvisionalCandidate(candidate);
  candidate = preparation.candidate;
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
  let constructionRetried = false;
  // ⛔ NEVER SILENTLY. What an adopted retry shed from the first draft, and the
  // questions it parked in `unknowns`, travel with the result so the Agent can say
  // them — otherwise an option the model mislabelled as its own vanishes unseen.
  let leftOut: { kind: string; label: string }[] = [];
  const needsSizeRetry = !size.within && !size.user_material_exceeds_limit;
  if (needsSizeRetry || preparation.issues.length > 0) {
    sizeRetried = needsSizeRetry;
    constructionRetried = true;
    try {
      const retry = await callStructured({
        model: budget.model,
        // The delta is APPENDED, so every rule the first pass obeyed still holds —
        // provenance, wiring, plausible_max and clearly labelled estimates.
        instructions: `${BUILD_INSTRUCTIONS} ${needsSizeRetry ? retryInstruction(size) : ''} Repair only the listed construction issues. Preserve every option and risk hypothesis, its causal direction and path to the goal; do not delete them to clear validation.`,
        input: preparation.issues.length > 0
          ? `${brief}\n\nConstruction issues: ${JSON.stringify(preparation.issues)}\nCandidate to repair: ${JSON.stringify(candidate)}`
          : brief,
        max_output_tokens: budget.max_output_tokens,
        reasoning_effort: budget.reasoning_effort,
        schema: retrySchemaPinningGoal(candidate.goal),
      });
      if (retry.text.length > 0) {
        const retryPreparation = prepareProvisionalCandidate(JSON.parse(retry.text) as CandidateModel);
        const retryCandidate = retryPreparation.candidate;
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
          (needsSizeRetry ? retrySize.nodes <= size.nodes && retrySize.edges <= size.edges : retrySize.within || retrySize.user_material_exceeds_limit) &&
          keepsUserMaterial && retryPreparation.issues.length === 0 &&
          (!preparation.issues.length || retainsRiskHypotheses(candidate, retryCandidate))
        ) {
          const kept = new Set(retryAdmitted.nodes.map(nodeIdentity));
          leftOut = admitted.nodes
            .filter((n) => !kept.has(nodeIdentity(n)))
            .map((n) => ({ kind: String(n.kind), label: String((n as { description?: unknown }).description ?? n.label) }));
          candidate = retryCandidate;
          admitted = retryAdmitted;
          size = retrySize;
          preparation = retryPreparation;
        }
      }
    } catch {
      // A failed retry costs the retry, never the turn: the refusal below reports
      // the FIRST model's real counts rather than inventing a reason.
    }
  }

  if (preparation.issues.length > 0) {
    return { ok: false, mutated: false, refusal: 'construction_needs_semantic_repair',
      detail: 'The model could not preserve a supported risk mechanism or a coherent option total. Nothing was saved.',
      issues: preparation.issues, retried: constructionRetried };
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
  const parked = (candidate as { unknowns?: unknown }).unknowns;
  const openQuestions = Array.isArray(parked) ? parked.filter((q): q is string => typeof q === 'string' && q.trim() !== '') : [];

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

  /**
   * ⛔⛔ THE CALLER'S EMPTY-GRAPH GUARD WENT STALE WHILE THIS WAS THINKING.
   *
   * `agent-capabilities.ts` refuses `model_already_exists` when the graph already
   * has nodes — but it reads that BEFORE calling in here, and the generative call
   * above takes tens of seconds. So a person who starts a build from a brief and
   * then adds a node on the canvas, well inside that window, had their node
   * REPLACED: this registration writes the whole graph, and `operation_id` only
   * de-duplicates an IDENTICAL construction, so it cannot see a different writer.
   *
   * ⚠ IT HAS TO BE HERE, NOT AT THE CALL SITE. My first attempt put the re-check
   * after `buildModelFromBrief` returned — which is too late, because the
   * registration happens inside this function. A check after the write cannot
   * prevent the write.
   *
   * ⚠ THIS NARROWS THE WINDOW; IT DOES NOT CLOSE IT. What remains is this read to
   * the route's own read — milliseconds — instead of a person's think-time plus a
   * model call. Said plainly, because a re-read presented as a fix is how a race
   * gets forgotten.
   *
   * ⛔ AND IT CANNOT BE CLOSED CAS-STYLE FROM A CALLER, measured not assumed:
   * `computeExpectedGraphCasHashes` returns `analysis=null` for `null`,
   * `undefined` AND `{nodes:[],edges:[]}`, so a caller cannot express "I expect no
   * graph" — any expectation on a creation write would 409 every construction.
   * Closing it needs an assert-absent convention or create-only semantics at the
   * write boundary: the atomic-writer lease, not this file.
   *
   * ⭐ A FAILED READ DOES NOT REFUSE. Degrading to today's behaviour is right —
   * throwing away a build we have already paid for because a READ failed would
   * cost the user their turn for no gain.
   */
  const stillEmpty = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph`, {});
  if (stillEmpty.status === 200) {
    const g = (stillEmpty.json.graph ?? {}) as { nodes?: unknown[] };
    if (Array.isArray(g.nodes) && g.nodes.length > 0) {
      return {
        ok: false,
        mutated: false,
        refusal: 'model_already_exists',
        detail: 'While that model was being built, something was added to this one — so nothing was written, and '
          + 'your own change is untouched. Ask me to propose a change to the model you now have.',
      };
    }
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
    construction_retried: constructionRetried,
    ...(size.user_material_exceeds_limit
      ? { admitted_over_limit_because: 'your own stated options and facts exceed the compact limit' }
      : {}),
    options: admitted.nodes.filter((n) => n.kind === 'option').length,
    // What the projection could not carry — the Agent is expected to say this.
    withheld: admitted.withheld.map((w) => ({ from: w.from, to: w.to, reason: w.reason })),
    projected_field_count: admitted.loss.length,
    ...(admitted.treated_as_context !== undefined ? { treated_as_context: admitted.treated_as_context } : {}),
    // Options that say what they DO, versus options that are inert. An inert
    // option can never be compared, whatever values arrive later.
    options_that_change_nothing: admitted.withheld
      .filter((w) => w.reason === 'option_changes_nothing')
      .map((w) => w.from),
    // Carried WITH the graph (GraphV3 declares `goal_constraints`), verified
    // surviving registration on deployed staging.
    goal_constraints_carried: admitted.goal_constraints.length,
    ...(leftOut.length > 0 ? { left_out_to_stay_compact: leftOut } : {}),
    // ⭐ EVERY build, not only a retry: the compact instruction parks Olumi's own
    // strategic additions in `unknowns`, and on the common path (a first pass already
    // within budget — 3 of 3 live benchmark runs) nothing else ever showed them.
    ...(openQuestions.length > 0 ? { open_questions: openQuestions } : {}),
    not_represented: [
      admitted.withheld.length > 0
        ? `${admitted.withheld.length} relationship(s) were left out because nobody has stated which way they run.`
        : undefined,
      leftOut.length > 0
        ? `${leftOut.length} item(s) from the first draft were left out to keep the model compact: ${leftOut.map((x) => x.label).join('; ')}.`
        : undefined,
      // ⭐ THE GOAL'S DEADLINE AND DIRECTION, WHICH GraphV3 CANNOT HOLD. `admit-model.ts`
      // already records each as a warn-level loss with the reason written out; until now
      // only `projected_field_count` travelled, and a NUMBER is not something the Agent
      // can turn into a sentence. Measured on served 3f412be across the six estate briefs
      // in `Docs/v5/evidence/records-v11-cause-not-option-2026-08-30/briefs`: 0 of 6
      // carried the values OR the loss records anywhere, while `goal_threshold_raw`,
      // `goal_constraints`, `scale_frame` and `provenance` all did.
      //
      // ⛔ The cost is not thinness, it is a disagreement. The Agent narrates from the
      // brief, so on B2 its prose said "the goal of £3m new ARR within 18 months" while
      // the model held no horizon at all and `permitted_analysis_mode` was
      // `quantified_provisional` — figures shown against a deadline the analysis never
      // received. Saying it is the only honest option while the projection cannot hold it.
      ...admitted.loss
        // `status_quo_held`: the held status quo is a machine-inferred MEANING
        // (`admit-model.ts`, `wireInertStatusQuo`), so it must be said and correctable.
        .filter((l) => /\.(horizon_months|goal_operator|mechanism_missing|status_quo_held)$/.test(l.field_path))
        .map((l) => l.reason),
    ].filter((s): s is string => s !== undefined),
  };
}
