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
import { admitCandidateModel, findMechanismPath, type CandidateModel } from '../admit-model.js';
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
      // ⭐ THE GOAL'S CURRENT LEVEL, in the factor pattern (`baseline_known` beside a
      // nullable value). Without it a level-framed goal has no baseline and ISL
      // refuses Goal fit (`missing_goal_baseline`). REQUIRED so strict output must
      // say "not given" (null) rather than omit it — an absent key is how silent
      // defaults happen. `admit-model.ts` writes it; nothing is derived from the target.
      baseline_known: { type: 'boolean', description: 'True only when the brief states the goal metric\u2019s CURRENT level.' },
      baseline_value: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'The goal metric\u2019s current level in the goal unit, exactly as the brief states it; null when the brief does not. Never an estimate, never the target.' },
      baseline_provenance: provenance,
    }, ['metric', 'operator', 'target_stated', 'value', 'unit', 'horizon_months', 'provenance', 'baseline_known', 'baseline_value', 'baseline_provenance']),
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
        'Factor labels this option changes when it states no level \u2014 e.g. an option that phases, grandfathers or tests something. Use the factor labels exactly. An option (other than the one marked is_status_quo, which stays empty) that names nothing here and has no interventions is unreachable from the decision and cannot be analysed.',
        items: { type: 'string' } },
      interventions: { type: 'array', description:
        'The factor level this option sets, or a signed addition to its baseline. Distinguish these meanings with value_kind. Preserve user numbers; an estimated level is ai_proposed, never explicit.',
        items: obj({ factor_label: { type: 'string' }, value: { type: 'number' }, value_kind: { type: 'string', enum: ['absolute', 'additional'] }, unit: { type: 'string' }, provenance },
          ['factor_label', 'value', 'value_kind', 'unit', 'provenance']) },
      // ⛔ THE HELD STATUS QUO MUST NOT DEPEND ON WORDING (served c673223: "Continue
      // Current Staffing" was not a readiness idiom, so the turn blocked). The drafter
      // DECLARES the current-state option; admission reads this first. Strict output
      // requires every key, so "optional" is `null`.
      is_status_quo: { anyOf: [{ type: 'boolean' }, { type: 'null' }], description:
        'true ONLY for the one option that keeps things as they are now (the current state or status quo), whatever it is called. null for every other option. Never true on more than one option.' },
    }, ['label', 'provenance', 'changes', 'interventions', 'is_status_quo']) },
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
  'Record the goal metric\u2019s CURRENT level in goal.baseline_value, in the goal unit. When the brief states it: baseline_known true, baseline_provenance "explicit". When it does not, leave baseline_value null with baseline_known false. Do not estimate it: a guessed current level would set the chance of reaching the target on a guess. It is where things stand today, never the target.',
  'For each option fill `interventions` with its factor settings. value_kind:"absolute" means the resulting total or level; value_kind:"additional" means a signed change from the same factor baseline. For hiring, adding two to a proposed baseline of five means total seven, never total two. Record the user-stated addition as explicit but keep an estimated resulting level ai_proposed. Keep one unit and plausible_max frame per factor across all baselines and options.',
  'Mark the option that keeps things as they are now with is_status_quo:true \u2014 at most one option, whatever it is called \u2014 and give it no levels; every other option has is_status_quo:null.',
  'Connect options to the controllable factors they change, then through supported causal mechanisms to risks and the goal. Never emit a direct option-to-risk link: it cannot be interpreted as an option setting a risk value. Retain each meaningful risk hypothesis, its sign and its downstream path; express its exposure through a causal factor or mediator, rather than deleting the risk or claiming equal exposure.',
  'EVERY OPTION MUST SAY WHAT IT DOES \u2014 except the one marked is_status_quo, which names no changes and no levels because it keeps things as they are. Any OTHER option (not marked is_status_quo) with no `interventions` AND no `changes` is inert: it can never be compared with another option, whatever values are supplied later, and the whole decision becomes unanswerable. The option marked is_status_quo is meant to be empty \u2014 it is compared by holding today\u2019s levels, so leave it empty. If the brief does not say what an option changes, still name the factors it ACTS ON in `changes` \u2014 that is a structural claim, not a numeric one. '
  + 'EVERY option (except the one marked is_status_quo) must also list, in `changes`, the factors it acts on WITHOUT a stated level. An option (other than the one marked is_status_quo) that names no interventions and no changes is disconnected from the decision and cannot be analysed at all, so this is not optional bookkeeping.',
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
  'EVERY LIMIT MUST NAME A NODE THE ANALYSIS CAN CHECK. Each `constraints[].metric` must be the EXACT label of a factor or outcome you keep in this model \u2014 a limit whose metric names no node is withheld from the model, and the analysis cannot check it. If the user limits a total such as cost, budget or spend, keep that total in the model as a factor the options set or an outcome their factors feed, wired toward the goal like every other factor, and use its exact label as the metric. Keep the direction the user stated: a budget, cost or spend cap is an upper bound ("<=") and a floor such as a minimum margin is a lower bound (">="); never add the opposite bound to the same limit.',
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
    // The current level is part of the goal, so it is pinned too; an absent value
    // (a candidate from before the field) pins to "not given".
    baseline_known: { type: 'boolean', enum: [goal.baseline_known === true] },
    baseline_value: typeof goal.baseline_value === 'number'
      ? { type: 'number', enum: [goal.baseline_value] }
      : { type: 'null' },
    baseline_provenance: { type: 'string', enum: [goal.baseline_provenance ?? goal.provenance] },
  };
  return schema;
}

/**
 * Resolve declared additions before admission's absolute-level contract.
 *
 * Two kinds of finding, and they are NOT the same weight:
 *
 * - `additions_without_total` — an addition that cannot become a total (no finite
 *   baseline, units that differ, an ambiguous factor, an unknown `value_kind`).
 *   ⛔ IT DEGRADES, IT NEVER REFUSES (review 5822711266, B1). Refusing gave "should we
 *   hire two more engineers?" with no team size NO model on turn 1 and a raw code. So
 *   the level is dropped — admitting "hire two" as a total of two would misstate the
 *   option — and the option keeps ACTING on the factor as a structural `changes`
 *   entry, with no level invented. The build result names each one and what would
 *   make it a total. No retry is spent on it: the missing figure is the user's to give.
 * - `provenance_demoted` — see the guard below.
 * - `mechanism_issues` — a MACHINE-AUTHORED option→risk link with NO
 *   option→factor→…→risk mechanism in the candidate. It asks the retry to route
 *   the hypothesis through a factor, and NOTHING MORE: if the retry cannot, the
 *   original is kept and admission's own ruling (#1830) applies — the edge is kept,
 *   no sign is invented, and the repair proposal reaches the user through
 *   `not_represented`. A link the USER stated (`explicit`) is their claim and is
 *   never an issue; a shortcut over an existing mechanism is folded by admission
 *   and is never an issue either, so this can never pre-empt that fold. The
 *   mechanism test is admission's own (`findMechanismPath`), over the same edges
 *   admission searches: option→factor from `changes`/`interventions`, every
 *   directed link, and no machine shortcut.
 *
 * ⛔ An EXPLICIT `value_kind:"absolute"` level on a factor whose baseline is NOT
 * known is demoted to `ai_proposed`: with no known starting point it may be an
 * addition mislabelled as a total, derived from Olumi's estimate, and stamping it
 * as the user's would exempt a modelling guess from the money invariant's audit.
 * ⚠ BUT A USER'S OWN NUMBER MUST NEVER SILENTLY READ AS OLUMI'S (review 5822711266,
 * B2): every demotion is returned in `provenance_demoted` and said to the user, who
 * can confirm it. A candidate with no `value_kind` (stored before the field) is left
 * exactly as it was on staging.
 */
export interface AdditionWithoutTotal {
  readonly option: string;
  readonly factor: string;
  readonly value: number;
  readonly unit?: string;
  readonly reason: 'baseline_unknown' | 'unit_mismatch' | 'factor_unknown' | 'factor_ambiguous' | 'value_kind_unknown';
  readonly factor_unit?: string;
}
export interface DemotedProvenance { readonly option: string; readonly factor: string; readonly value: number }
/**
 * ⛔ A LIMIT THE USER STATED IS NEVER DROPPED UNSEEN.
 *
 * `admit-constraint.ts` withholds a limit whose metric names no node in the admitted model, rather
 * than attach it to a guessed target — right — and records a warn-level loss. Until now only horizon,
 * goal_operator, mechanism and status-quo losses reached `not_represented`, so a build that drafted
 * "under 15% net margin" as a "Net-margin breach" RISK (no "Net margin" node; 1 of 15 live builds on
 * served 9417228) registered a model with no limit and said nothing: `goal_constraints_carried: 0` is a
 * count, not a sentence. Named here from the candidate's own words, so the Agent can tell the user
 * exactly which limit the analysis will not check. No remedy is offered: the withheld limit is not kept.
 */
const OPERATOR_WORDS: Readonly<Record<string, string>> = { '>=': 'at least', '<=': 'at most', '>': 'more than', '<': 'less than' };
function unattachedLimitLines(model: CandidateModel, loss: readonly { readonly field_path: string; readonly before?: unknown }[]): string[] {
  // Admission withholds BY METRIC (`admit-constraint.ts` resolves `c.metric` to a node, or not), so every
  // bound on an unattached metric shares that fate. Iterate the BOUNDS, not the loss entries: a loss entry
  // carries only the metric, and mapping it back by first match repeats one bound and hides the rest, with
  // the wrong author (pre-review 5828829492: ">= 15%" said twice, Olumi's "<= 30%" never said, and called the user's).
  const unattached = new Set(loss.filter((l) => /^goal_constraints\[.*\]\.node_id$/.test(l.field_path)).map((l) => String(l.before ?? '')));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const c of model.constraints ?? []) {
    if (!unattached.has(c.metric)) continue;
    // Words, never symbols: this sentence reaches the user (RC 5828938080 §3, Runtime's copy point).
    const bound = OPERATOR_WORDS[c.operator] ?? c.operator;
    const unit = c.unit === undefined || c.unit === '' ? '' : c.unit.startsWith('%') ? c.unit : ` ${c.unit}`;
    const limit = `${c.metric} of ${bound} ${c.value}${unit}`;
    // The same rule as `admit-constraint.ts` `isUserAuthored`: only a bound the user stated is called theirs.
    const users = c.provenance === 'explicit';
    const key = `${users ? 'user' : 'olumi'}\u0000${limit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${users ? `Your limit "${limit}"` : `The limit Olumi proposed ("${limit}")`} is not in the model: no part of the model is "${c.metric}", so the analysis cannot check it.`);
  }
  return lines;
}
/** The user-facing sentence for an addition kept with no total: what is missing, and how to supply it. */
function sayAdditionWithoutTotal(a: AdditionWithoutTotal): string {
  const amount = `${a.value}${a.unit ? ` ${a.unit}` : ''}`;
  const why =
    a.reason === 'baseline_unknown' ? `the current level of "${a.factor}" is not known`
    : a.reason === 'unit_mismatch' ? `it is stated in ${a.unit ?? 'another unit'}, while "${a.factor}" is measured in ${a.factor_unit ?? 'another unit'}`
    : a.reason === 'factor_unknown' ? `no factor called "${a.factor}" is in the model`
    : a.reason === 'factor_ambiguous' ? `more than one factor is called "${a.factor}"`
    : 'it was not clear whether it is an addition or a total';
  const fix =
    a.reason === 'baseline_unknown' ? `Tell me the current level of "${a.factor}" and it becomes a total.`
    : a.reason === 'unit_mismatch' ? `Say whether those are the same unit and it becomes a total.`
    : a.reason === 'factor_unknown' ? `Say which factor "${a.option}" changes and it can be connected.`
    : `Say what "${a.option}" sets "${a.factor}" to and it becomes a level.`;
  return `"${a.option}" adds ${amount} to "${a.factor}", but ${why}, so no total was set: the option is kept as ` +
    `changing "${a.factor}", with no level of its own. ${fix}`;
}

/**
 * What the first pass had to disclose, carried across an ADOPTED retry (review
 * 5822933692, B3). A repair retry answers a different question (a risk mechanism,
 * or size); it must not silently erase a demoted user total or an addition left
 * with no total. An entry survives while it is still true of the adopted candidate:
 *  · a demotion, while that option sets that factor with no user-stated level;
 *  · an addition with no total, while that option sets no level on that factor.
 * Entries the retry's own preparation found are kept, and never duplicated.
 */
export function carryFindingsAcrossRetry<P extends ReturnType<typeof prepareProvisionalCandidate>>(first: P, retry: P): P {
  const levelOf = (option: string, factor: string) =>
    retry.candidate.options.find((o) => o.label === option)?.interventions?.find((i) => i.factor_label === factor);
  const hasOption = (option: string) => retry.candidate.options.some((o) => o.label === option);
  const key = (x: { option: string; factor: string }) => `${x.option}\u0000${x.factor}`;
  const demotedKeys = new Set(retry.provenance_demoted.map(key));
  const additionKeys = new Set(retry.additions_without_total.map(key));
  return {
    ...retry,
    provenance_demoted: [
      ...retry.provenance_demoted,
      ...first.provenance_demoted.filter((d) =>
        !demotedKeys.has(key(d)) && hasOption(d.option) && levelOf(d.option, d.factor)?.provenance !== 'explicit'),
    ],
    additions_without_total: [
      ...retry.additions_without_total,
      ...first.additions_without_total.filter((a) =>
        !additionKeys.has(key(a)) && hasOption(a.option) && levelOf(a.option, a.factor) === undefined),
    ],
  };
}

export function prepareProvisionalCandidate(model: CandidateModel): {
  candidate: CandidateModel;
  mechanism_issues: string[];
  additions_without_total: AdditionWithoutTotal[];
  provenance_demoted: DemotedProvenance[];
} {
  const mechanism_issues: string[] = [];
  const additions_without_total: AdditionWithoutTotal[] = [];
  const provenance_demoted: DemotedProvenance[] = [];
  const factorsByLabel = (label: string) => model.factors.filter((f) => f.label === label);
  type Iv = NonNullable<CandidateModel['options'][number]['interventions']>[number];
  const options = model.options.map((option) => {
    const becameChanges: string[] = [];
    const interventions: Iv[] = [];
    for (const intervention of option.interventions ?? []) {
      const kind = (intervention as Iv & { value_kind?: string }).value_kind;
      const factors = factorsByLabel(intervention.factor_label);
      if (kind === undefined) { interventions.push(intervention); continue; } // Stored before the field: as on staging.
      if (kind === 'absolute') {
        const unknownBaseline = factors.length === 1 && factors[0]!.baseline_known !== true;
        if (intervention.provenance === 'explicit' && unknownBaseline) {
          provenance_demoted.push({ option: option.label, factor: intervention.factor_label, value: intervention.value });
          interventions.push({ ...intervention, provenance: 'ai_proposed' });
        } else {
          interventions.push(intervention);
        }
        continue;
      }
      const factor = factors.length === 1 ? factors[0] : undefined;
      const unresolved = (reason: AdditionWithoutTotal['reason']): void => {
        additions_without_total.push({
          option: option.label, factor: intervention.factor_label, value: intervention.value, reason,
          ...(intervention.unit ? { unit: intervention.unit } : {}),
          ...(factor?.unit ? { factor_unit: factor.unit } : {}),
        });
        // Kept as what the option ACTS ON, with no level — never a guessed total.
        if (factors.length > 0) becameChanges.push(intervention.factor_label);
      };
      if (kind !== 'additional') { unresolved('value_kind_unknown'); continue; }
      if (factors.length === 0) { unresolved('factor_unknown'); continue; }
      if (factor === undefined) { unresolved('factor_ambiguous'); continue; }
      if (typeof factor.baseline_value !== 'number' || !Number.isFinite(factor.baseline_value)
        || !Number.isFinite(intervention.value) || !Number.isFinite(factor.baseline_value + intervention.value)) {
        unresolved('baseline_unknown'); continue;
      }
      if (!factor.unit || !intervention.unit || factor.unit.trim().toLowerCase() !== intervention.unit.trim().toLowerCase()) {
        unresolved('unit_mismatch'); continue;
      }
      interventions.push({
        ...intervention, value_kind: 'absolute', value: factor.baseline_value + intervention.value,
        provenance: factor.baseline_known && factor.provenance === 'explicit' && intervention.provenance === 'explicit'
          ? 'explicit' : 'ai_proposed',
      } as Iv);
    }
    const changes = [...(option.changes ?? [])];
    for (const f of becameChanges) if (!changes.includes(f)) changes.push(f);
    return {
      ...option,
      ...(option.interventions !== undefined ? { interventions } : {}),
      ...(option.changes !== undefined || becameChanges.length > 0 ? { changes } : {}),
    };
  });
  const optionLabels = new Set(model.options.map((o) => o.label));
  const riskLabels = new Set(model.risks.map((r) => r.label));
  const factorLabels = new Set(model.factors.map((f) => f.label));
  const pair = (l: { from: string; to: string }) => `${l.from}\u0000${l.to}`;
  const shortcuts = model.links.filter((l) => optionLabels.has(l.from) && riskLabels.has(l.to) && l.provenance !== 'explicit');
  const shortcutPairs = new Set(shortcuts.map(pair));
  const mechanismGraph = [
    ...model.options.flatMap((o) => [...(o.changes ?? []), ...(o.interventions ?? []).map((i) => i.factor_label)]
      .filter((f) => factorLabels.has(f))
      .map((f) => ({ from: o.label, to: f }))),
    ...model.links.filter((l) => l.direction !== 'unknown' && !shortcutPairs.has(pair(l))),
  ];
  for (const link of shortcuts) {
    if (findMechanismPath(mechanismGraph, link.from, link.to) !== null) continue;
    mechanism_issues.push(`${link.from} -> ${link.to}: retain this risk hypothesis through a causal factor or mediator, not a direct option-risk setting`);
  }
  return { candidate: { ...model, options }, mechanism_issues, additions_without_total, provenance_demoted };
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

/** The size-only retry's edit rule (measured: `construction-size-retry-edits-first-draft.test.ts`). */
const SIZE_RETRY_EDITS_FIRST_DRAFT =
  'Return your previous model with only the items you ADDED beyond the brief removed. Copy every item you keep EXACTLY '
  + 'as it is in your previous model: the same label, wording, provenance and relationships. Do not rename, merge, reword or re-add anything.';

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

  // The drafter's own words, kept for a repair retry: re-preparing a PREPARED
  // candidate finds nothing (review 5822933692, B3), so the retry sees the original.
  const firstCandidate = candidate;
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
  // Only a missing risk mechanism asks the retry to repair. An addition with no total
  // DEGRADES instead (see `prepareProvisionalCandidate`): the figure is the user's to give.
  const repairIssues = (p: typeof preparation): string[] => p.mechanism_issues;
  if (needsSizeRetry || repairIssues(preparation).length > 0) {
    sizeRetried = needsSizeRetry;
    constructionRetried = true;
    try {
      const retry = await callStructured({
        model: budget.model,
        // The delta is APPENDED, so every rule the first pass obeyed still holds —
        // provenance, wiring, plausible_max and clearly labelled estimates.
        // ⛔ A SIZE-ONLY RETRY EDITS ITS OWN FIRST DRAFT. Regenerated from the brief alone it renamed the user's
        // options ("Hire two senior engineers" → "hire 2 senior engineers"), so `keepsEveryUserStatedIdentity`
        // rejected it every time: measured 0/8 adoptable vs 8/8 when the retry is handed its draft to edit
        // (construction-size-retry-edits-first-draft.test.ts). A retry with construction issues is unchanged.
        instructions: repairIssues(preparation).length === 0 && needsSizeRetry
          ? `${BUILD_INSTRUCTIONS} ${retryInstruction(size)} ${SIZE_RETRY_EDITS_FIRST_DRAFT}`
          : `${BUILD_INSTRUCTIONS} ${needsSizeRetry ? retryInstruction(size) : ''} Repair only the listed construction issues. Preserve every option and risk hypothesis, its causal direction and path to the goal; do not delete them to clear validation.`,
        input: repairIssues(preparation).length > 0
          ? `${brief}\n\nConstruction issues: ${JSON.stringify(repairIssues(preparation))}\nCandidate to repair: ${JSON.stringify(firstCandidate)}`
          : `${brief}\n\nYour previous model, to shrink: ${JSON.stringify(firstCandidate)}`,
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
          keepsUserMaterial && repairIssues(retryPreparation).length === 0 &&
          (repairIssues(preparation).length === 0 || retainsRiskHypotheses(candidate, retryCandidate))
        ) {
          const kept = new Set(retryAdmitted.nodes.map(nodeIdentity));
          leftOut = admitted.nodes
            .filter((n) => !kept.has(nodeIdentity(n)))
            .map((n) => ({ kind: String(n.kind), label: String((n as { description?: unknown }).description ?? n.label) }));
          candidate = retryCandidate;
          admitted = retryAdmitted;
          size = retrySize;
          // ⛔ An adopted retry must not erase what the first pass had to disclose
          // (review 5822933692, B3): a retry that echoes the prepared candidate
          // re-prepares to nothing, and the user's 7 would read as Olumi's again.
          preparation = carryFindingsAcrossRetry(preparation, retryPreparation);
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
   * ⚠ THIS RE-READ ALONE NARROWED THE WINDOW; IT DID NOT CLOSE IT. What remained was
   * this read to the route's own read. The route has since gained an assert-absent
   * convention (explicit `null` `expected_graph_identity_hash`), and the
   * registration below now sends it — see "CREATE-ONLY". This re-read stays: it
   * refuses before a register call is spent, with the same words.
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

  /**
   * ⛔ CREATE-ONLY: THE REGISTRATION ASSERTS THE MODEL IS STILL EMPTY (ChatGPT #69 5834761926 item 1).
   *
   * The re-read above leaves the gap from that read to the route's own read. An explicit `null`
   * `expected_graph_identity_hash` closes it with the route's existing absence contract
   * (`assist.v1.scenario-graph-register.ts`, "explicit `null` now asserts absence"): the route refuses 409
   * `GRAPH_STALE` if a graph exists at ITS read, and hands its own read to the atomic writer as a KNOWN-absent
   * base (`p_expected_base_known`, `append_turn_atomic_v5`), which refuses the same way in CAS `enforce` mode.
   *
   * ⚠ THE ROUTE CHECKS ABSENCE BEFORE THE ATOMIC RPC DECIDES A REPLAY, so a retry of THIS construction, already
   * committed, now meets `GRAPH_STALE` rather than a replayed receipt. It is recovered below exactly as the
   * `OPERATION_ID_REUSED` loser is: the versions read finds this construction's own version, or it is not ours.
   */
  const reg = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph/register`, {
    graph,
    brief_text: brief,
    operation_id: constructionOperationId(scenarioId, brief),
    expected_graph_identity_hash: null,
  });
  const regCode = (reg.json.details as { code?: unknown } | undefined)?.code;
  if (reg.status === 409 && regCode === 'GRAPH_STALE') {
    const prior = await findConstructionVersion(dispatch, scenarioId, brief);
    if (prior !== null) return { ok: true, mutated: false, replayed: true, model_version: prior };
    return {
      ok: false,
      mutated: false,
      refusal: 'model_already_exists',
      detail: 'While that model was being built, something was added to this one — so nothing was written, and '
        + 'your own change is untouched. Ask me to propose a change to the model you now have.',
    };
  }
  if (reg.status === 409 && regCode === 'OPERATION_ID_REUSED') {
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
    // B1/B2 (review 5822711266), machine-readable beside the sentences below.
    ...(preparation.additions_without_total.length > 0 ? { additions_without_total: preparation.additions_without_total } : {}),
    ...(preparation.provenance_demoted.length > 0 ? { provenance_demoted: preparation.provenance_demoted } : {}),
    not_represented: [
      ...unattachedLimitLines(candidate, admitted.loss),
      ...preparation.additions_without_total.map(sayAdditionWithoutTotal),
      ...preparation.provenance_demoted.map((d) =>
        `I've treated your ${d.value} for "${d.factor}" in "${d.option}" as a working figure because the current ` +
        `level of "${d.factor}" is unknown \u2014 confirm it and I'll mark it as yours.`),
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
        // `observed_state.baseline`: a goal's current level that could not be carried
        // (`admit-model.ts`) — the user is told why, and what would let it count.
        .filter((l) => /\.(horizon_months|goal_operator|mechanism_missing|status_quo_held|bound_direction)$|\.observed_state\.baseline$/.test(l.field_path))
        .map((l) => l.reason),
    ].filter((s): s is string => s !== undefined),
  };
}
