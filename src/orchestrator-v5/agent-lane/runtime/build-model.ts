import { briefAttestsEventByDate, draftedTeamPartOf, isQuantityGoalCandidate, eventByDateRefusalOf } from '../../goal-target/event-by-date-model.js';
import { chanceGoalDeadlineAsk } from '../../goal-target/goal-kind.js';
import { goalIdentityScopeIsMaterial, materialScopeQuestion, reconciliationPending, untypedScopeComponents, untypedScopeDisclosure } from '../goal-scope.js';
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
import { reachableNodeIds, optionsWithoutGoalPath } from '../../../orchestrator/graph-structure-validator.js';
import { verifiedOptionSetting } from '../verified-option-setting.js';
import { FRESH_READ } from '../turn-read-cache.js';
import { collapsedChainIssue, collapsedChains, costOffRevenueLine, costsAgainst, droppedStatedCostLines, drawsChainAsTheUsers, unmodelledMechanismChallenge, withoutUnsupportedMechanisms, type CostOffRevenue, type UnmodelledMechanism } from '../unsupported-mechanism.js';
import { unsizedLeaderGoalPaths } from '../goal-certainty.js';
import { reachedGoalPaths, targetTestabilityOf } from '../../admission/target-testability.js';
import { identityCanCarryExactLinks } from '../../admission/identity-evaluations.js';
import { holdAcrossRetry, keepOptionsAndQuantitiesApart, keptApartLine, notToldApartLine, setAsideLinkLine, setAsideLinkQuestion } from '../keep-options-apart.js';
import { markOlumiOptions } from '../olumi-option-marker.js';
import { widenDraft } from './widen-draft.js';
import { dropOptionLevelsOverOwnLevers, sayOptionLevelOverOwnLevers, type OptionLevelOverOwnLevers } from '../option-level-over-own-levers.js';
import { admitCandidateModel, admitOrdinaryCandidateModel, admittedReachesGoal, admitGoalLevelBesideHeldCeiling, canonicalLabel, carryWithheldOptions, slugId, findMechanismPath, limitedOutcomeFrame, metricNamesLabel, metricReadsAsPlainTotal, productIdentityOpenQuestions, sumIdentityOpenQuestions, unlevelledProductQuestions, type AdmittedModel, type CandidateModel, type ConstructionAdmission, type WithheldOption } from '../admit-model.js';
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
import { LIMIT_OPERATOR_WORDS, writtenLimitFrame } from '../admit-constraint.js';
import { isChangeFrame, limitNeedsTodaysLevel, sayLimitInFrame } from '../limit-frame.js';
import { droppedGoalProductLine, gapResidualLine, unconfirmGoalProducts, withoutGapResidual, withReconcilingProductIdentity, type DroppedGoalProduct, type GapResidual } from '../reconciling-product.js';
import { withRateCountProducts } from '../rate-count-product.js';
import { admitAccumulationIdentities, withAdmittedAccumulations } from '../accumulation-identity.js';
import { withGoalSenseReading, type GoalSenseReading } from '../goal-sense-reading.js';
import { briefGoalLevel } from '../unplaced-goal-level.js';
import { foldProductCarrierIntoGoal, foldedCarrierLines, type FoldedCarrier } from '../goal-product-carrier.js';
import { clampForPersist, refitFramesForStatedEffects, refitFramesForOlumiEstimates } from '../refit-frames.js';
import { perOneLinksForConstantProducts } from '../per-one-product.js';
import { NOT_REPRESENTABLE } from '../../../cee/magnitude/link-effect.js';
import { figureTheUserWrote, figureTheUserWroteFor, writtenRangeFor, goalLevelTheUserWrote, holdStatedGoalAttributes, levelWrittenApartFromTarget, statedCountInterventionRange, timesTheUserWrote } from '../stated-by-user.js';
import { heldEventRiskLine, holdStatedEventRisks, refusedEventRiskLine } from '../stated-event-risk-draft.js';
import { sameUnit } from '../same-unit.js';
import { admitInterventionRange } from '../../intervention-range.js';
import { budgetFor } from '../model-budgets.js';
import { goalUnitReading } from '../goal-unit-reading.js';
import { findStatedAmounts, findStatedRanges, readCurrencyUnitWithQualifiers, type StatedRange } from '../../../cee/provenance/stated-amounts.js';
import { limitedLevelAsks, optionSetLimitAsks } from '../limited-level-ask.js';
import type { ToolResult } from './agent-tools.js';
import type { InternalDispatch } from './agent-capabilities.js';

/**
 * Carry only the range the user wrote immediately around THIS absolute count. The drafter supplies no range field:
 * strip any such field and rebuild the receipt from one named user sentence. Reuses the link centre-range reader,
 * but no link spread, ignorance prior or plausible_max is evidence for an option's count range.
 */
export function withCountInterventionRanges(model: CandidateModel, brief: string): CandidateModel {
  const quantities = [{ label: model.goal.metric, unit: model.goal.unit }, ...model.factors, ...model.outcomes, ...(model.risks ?? [])];
  return { ...model, options: model.options.map(option => ({ ...option, ...(option.interventions === undefined ? {} : {
    interventions: option.interventions.map(intervention => {
      const { range: _untrusted, ...point } = intervention;
      const factors = model.factors.filter(f => canonicalLabel(f.label) === canonicalLabel(point.factor_label));
      const factor = factors.length === 1 ? factors[0] : undefined;
      const unit = factor?.unit;
      if (typeof unit !== 'string'
        || (point.unit !== undefined && !sameUnit(point.unit, unit))
        || (point as typeof point & { value_kind?: string }).value_kind === 'additional'
        || (point as typeof point & { derived_total?: boolean }).derived_total === true) return point;
      const range = statedCountInterventionRange(point.value, unit, point.factor_label, option.label, brief, quantities);
      if (range === undefined) return point;
      const verdict = admitInterventionRange({ ...point, range: {
        low: range.low, high: range.high, meaning: 'likely_range', source: 'brief_extraction', source_quote: range.text,
      } });
      return verdict !== undefined && 'range' in verdict ? { ...point, range: verdict.range } : point;
    }),
  }) })) };
}

/** The construction contract: the banked schema plus typed interventions. */
/**
 * An outcome's or a risk's quantity frame, as the drafter states it. A risk that bears on a MONEY goal is drafted as its
 * money EXPOSURE (R3 5916156932 PoC shortcut), so its link to the goal is money to money and can be sized.
 */
const QUANTITY_FRAME = {
  unit: { anyOf: [{ type: 'string' }, { type: 'null' }], description:
    'For an outcome that is a QUANTITY (a count such as "qualified conversations", an amount of money): its unit. A risk that '
    + 'bears on a money goal is drafted as its money EXPOSURE (for example "Funding lost to distraction"), with the money unit. '
    + 'null for an outcome or risk that is not a quantity.' },
  plausible_max: { anyOf: [{ type: 'number' }, { type: 'null' }], description:
    'With a unit: a SCALE for it, exactly as for a factor \u2014 a round number comfortably above anything realistic. null with no unit.' },
} as const;

/**
 * ⭐ STRICT ONLY AT THE OPENAI BOUNDARY (DL #75 5916270318, option D). OpenAI's strict json_schema needs every property in
 * `required`. The candidate contract (`buildCandidateSchema`) lets an outcome or a risk omit its frame, so a candidate
 * recorded before the frames existed still validates, and admission reads an absent frame as null (`withQuantityFrames`);
 * what is SENT requires every property, each missing key appended in order. Candidate-call schemas keep the new
 * evidence carrier optional; only the actual strict-provider boundary requires it. Existing frame/link handling stays.
 */
export function strictForTheDrafter(schema: Record<string, unknown>, { providerBoundary = true } = {}): Record<string, unknown> {
  const walk = (s: unknown): unknown => {
    if (Array.isArray(s)) return s.map(walk);
    if (s === null || typeof s !== 'object') return s;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
      out[k] = k === 'properties' && v !== null && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([name, sub]) => [name, walk(sub)]))
        : walk(v);
    }
    const properties = out['properties'];
    if (out['type'] === 'object' && properties !== null && typeof properties === 'object' && !Array.isArray(properties)) {
      const required = Array.isArray(out['required']) ? [...(out['required'] as string[])] : [];
      for (const name of Object.keys(properties)) {
        if (!providerBoundary && (name === 'stated_evidence' || name === 'baseline_evidence')) continue;
        if (!required.includes(name)) required.push(name);
      }
      out['required'] = required;
    }
    return out;
  };
  return walk(schema) as Record<string, unknown>;
}

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
      kind: { anyOf: [{ type: 'string', enum: ['event_by_date'] }, { type: 'null' }] },
      deliverable: { anyOf: [{ type: 'string', maxLength: 100 }, { type: 'null' }] },
      metric: { type: 'string' }, operator: { type: 'string', enum: ['>=', '<=', '>', '<'] },
      target_stated: { type: 'boolean' },
      value: { anyOf: [{ type: 'number' }, { type: 'null' }] }, unit: { type: 'string' },
      horizon_months: { anyOf: [{ type: 'integer' }, { type: 'null' }] }, provenance,
      // R1 (`@talchain/schemas` 0.61.0, `limit-frame.ts`): the frame the TARGET is stated in. REQUIRED, so strict output
      // must say "level" rather than omit it; `admit-model.ts` writes a change only beside the user's stated level.
      frame: { type: 'string', enum: ['level', 'change_abs', 'change_rel'] },
      // ⭐ THE GOAL'S CURRENT LEVEL, in the factor pattern (`baseline_known` beside a
      // nullable value). Without it a level-framed goal has no baseline and ISL
      // refuses Goal fit (`missing_goal_baseline`). REQUIRED so strict output must
      // say "not given" (null) rather than omit it — an absent key is how silent
      // defaults happen. `admit-model.ts` writes it; nothing is derived from the target.
      baseline_known: { type: 'boolean', description: 'True only when the brief states the goal metric\u2019s CURRENT level.' },
      baseline_value: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'The goal metric\u2019s current level in the goal unit, exactly as the brief states it; null when the brief does not. Never an estimate, never the target.' },
      baseline_provenance: provenance,
      // ⛔ C46: "£20k MRR" — the Pro plan's or all plans'? REQUIRED so strict output must say
      // "no such question" (null) rather than omit it. `admit-model.ts` records an unstated scope on
      // the goal as Olumi's assumption and the build asks which was meant (#70 5841314428: never
      // silently pick one).
      scope: { anyOf: [{ type: 'null' }, obj({
        modelled: { type: 'string', description: 'The part or whole the model measures, in words, e.g. "the Pro plan only".' },
        alternative: { type: 'string', description: 'The other reading the goal could have, e.g. "all plans together".' },
        stated_in_brief: { type: 'boolean', description: 'True only when the brief itself says which.' },
      }, ['modelled', 'alternative', 'stated_in_brief'])], description:
        'Null unless the goal metric could mean one part (a plan, product, segment or region) or the whole.' },
    }, ['metric', 'operator', 'target_stated', 'value', 'unit', 'horizon_months', 'provenance', 'frame', 'baseline_known', 'baseline_value', 'baseline_provenance', 'scope']),
    constraints: { type: 'array', items: obj({
      metric: { type: 'string' }, operator: { type: 'string', enum: ['>=', '<=', '>', '<'] },
      value: { type: 'number' }, unit: { type: 'string' }, provenance,
      // The frame the analysis compares the limit in (ISL refuses an unframed limit: `frame_not_stamped`).
      // R1 (`@talchain/schemas` 0.61.0, `limit-frame.ts`): the contract's three writable frames. Legacy `delta` (a change
      // from the MODEL'S ORIGIN) gets no new writers.
      frame: { type: 'string', enum: ['level', 'change_abs', 'change_rel'] },
    }, ['metric', 'operator', 'value', 'unit', 'provenance', 'frame']) },
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
        'Factor labels this option acts on for which no defensible level exists \u2014 each one leaves the user a value question before anything can be calculated, so prefer a level in `interventions` (your ai_proposed estimate when the brief states none). Use the factor labels exactly. The option marked is_status_quo leaves this empty. An option (other than the one marked is_status_quo) that names nothing here and has no interventions is unreachable from the decision and cannot be analysed.',
        items: { type: 'string' } },
      interventions: { type: 'array', description:
        'The factor level this option sets, or a signed addition to its baseline. Distinguish these meanings with value_kind. Preserve user numbers; an estimated level is ai_proposed, never explicit.',
        items: obj({ factor_label: { type: 'string' }, value: { type: 'number' }, value_kind: { type: 'string', enum: ['absolute', 'additional'] }, unit: { type: 'string' }, provenance,
          stated_evidence: { anyOf: [{ type: 'null' }, obj({
            quote: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' }, amount_start: { type: 'integer' },
            option_quote: { type: 'string' }, option_start: { type: 'integer' }, option_end: { type: 'integer' },
          }, ['quote', 'start', 'end', 'amount_start', 'option_quote', 'option_start', 'option_end'])] },
        },
          ['factor_label', 'value', 'value_kind', 'unit', 'provenance']) },
      // ⛔ THE HELD STATUS QUO MUST NOT DEPEND ON WORDING (served c673223: "Continue
      // Current Staffing" was not a readiness idiom, so the turn blocked). The drafter
      // DECLARES the current-state option; admission reads this first. Strict output
      // requires every key, so "optional" is `null`.
      added_capacity: { anyOf: [{ type: 'null' }, obj({
        monthly_share_pct: { type: 'number', minimum: 0, maximum: 100 },
        lead_months_low: { type: 'number', minimum: 0 },
        lead_months_high: { type: 'number', minimum: 0 },
      }, ['monthly_share_pct', 'lead_months_low', 'lead_months_high'])] },
      is_status_quo: { anyOf: [{ type: 'boolean' }, { type: 'null' }], description:
        'true ONLY for the one option that keeps things as they are now (the current state or status quo), whatever it is called. null for every other option. Never true on more than one option.' },
    }, ['label', 'provenance', 'changes', 'interventions', 'is_status_quo']) },
    factors: { type: 'array', items: obj({
      label: { type: 'string' }, role: { type: 'string', enum: ['controllable', 'observable', 'external'] },
      // ⭐ A CHANGE FROM TODAY is 0 today BY DEFINITION, not by estimate (served AI Quality B3, CEE 1f8327c: "cut our list
      // price 15%" registered with no level because "% from current list price" was marked unknown). Known-zero is what
      // lets admission restate a signed change as "% of today" (restateSignedPercentChanges, rows 4a/4b); the restated
      // factor carries no source, so no authority is claimed for the zero.
      baseline_known: { type: 'boolean', description: 'True only for a baseline supplied by the user or evidence. A provisional AI estimate keeps this false. EXCEPTION: a factor measured as a CHANGE FROM TODAY (e.g. "% change from the current price", "extra hires") is 0 today by definition: baseline_known true, baseline_value 0.' },
      baseline_evidence: { anyOf: [{ type: 'null' }, obj({ quote: { type: 'string' } }, ['quote'])], description: 'Complete verbatim brief sentence stating this factor’s current level; null otherwise.' },
      baseline_value: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'A stated baseline or a clearly provisional AI modelling estimate. Provide a reasonable estimate for a first calculation when possible; use null only when no defensible estimate is available.' },
      unit: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'The unit of baseline_value, as the brief writes it ("%", a count such as "subscribers", "<currency>/<period>"). ONLY a money amount charged, paid or earned PER ITEM names that item: "<currency> per <item> per <period>", where <item> is what another factor counts.' }, provenance,
      plausible_max: { type: 'number',
        description: 'REQUIRED, and NEVER null. The top of the range this factor could plausibly take, in its own unit \u2014 the SCALE it is read against, not a prediction. A percentage or a score out of 100: 100. A count, an amount or a price: a round number comfortably above anything realistic (a \u00a349 price might use 200; 300 subscribers might use 2000). Something ALREADY between 0 and 1: exactly 1. Every factor gets one, with or without a baseline today \u2014 a value adopted later is read against this same range.' },
    }, ['label', 'role', 'baseline_known', 'baseline_value', 'unit', 'provenance', 'plausible_max']) },
    // ⭐ THE FRAME A FACTOR HAS (DL #75 5916155976 (a); R3 5916156932 (b)): without `unit` + `plausible_max` no size into or
    // out of an outcome or a risk can be read, so a goal they feed could never be sized in its own unit.
    // ⛔ OPTIONAL HERE, REQUIRED ONLY WHERE IT IS SENT (DL 5916270318, option D): a candidate recorded before the frames
    // existed still validates against this contract, and `strictForTheDrafter` requires both keys of the drafter itself.
    risks: { type: 'array', items: obj({ label: { type: 'string' }, provenance, ...QUANTITY_FRAME }, ['label', 'provenance']) },
    outcomes: { type: 'array', items: obj({ label: { type: 'string' }, provenance, ...QUANTITY_FRAME }, ['label', 'provenance']) },
    links: { type: 'array', description:
      'Causal links, stated as hypotheses. Every factor you keep needs at least one link FROM it toward the goal metric (directly, or via a kept outcome that links to the goal). Never link an option directly to a risk \u2014 link the option to the factor it changes and the factor to the risk, because a bare option-to-risk link cannot be analysed.',
      items: obj({
      from: { type: 'string' }, to: { type: 'string' },
      direction: { type: 'string', enum: ['positive', 'negative', 'unknown'], description:
        'The direction read from the brief or from causal reasoning you can state in one line. "unknown" only when you genuinely cannot say \u2014 then ask which way it runs in `unknowns`; an unknown link is withheld and is not a path.' },
      provenance,
      // \u2b50 THE MAGNITUDE CONTRACT (D1). A size in NATURAL units, read on each end's own frame by admission
      // (`cee/magnitude/link-effect.ts`). REQUIRED so strict output must say "not known" (null) rather than omit it.
      effect_amount: { anyOf: [{ type: 'number' }, { type: 'null' }], description:
        'The signed change in the TARGET\u2019s own unit that `effect_per_source_change` of the source causes. For a percentage target, in points: 4% to 3% is -1. null when you cannot give a defensible size.' },
      effect_per_source_change: { anyOf: [{ type: 'number' }, { type: 'null' }], description:
        'The change in the SOURCE\u2019s own unit that causes `effect_amount`: 1 for switching a yes/no on, 10 for a GBP 10 price rise. null when `effect_amount` is null.' },
      effect_provenance: { anyOf: [provenance, { type: 'null' }], description:
        '"explicit" only when the user stated this size; null when `effect_amount` is null.' },
      // ⭐ DL #75 5916504679: the drafter's word that a link holds by definition. Optional in the contract (a recorded
      // candidate validates unchanged), required in what is sent (`strictForTheDrafter`); checked before any edge has it.
      definitional: { anyOf: [{ type: 'boolean' }, { type: 'null' }], description:
        'true ONLY when this link holds BY DEFINITION, not by estimate: the source is part of the target\u2019s own quantity, in the SAME unit, '
        + 'so one unit of the source moves the target by exactly one unit (money lost to a risk is money the goal does not get: '
        + 'effect_amount -1, effect_per_source_change 1). null for every other link.' },
      // ⭐ SCIENCE §(p)(1) + §(u)(b) (#2842 follow-up): the one-line reason Olumi's own size holds. Optional in the
      // contract (a recorded candidate validates unchanged), required in what is sent (`strictForTheDrafter`).
      basis: { anyOf: [{ type: 'string' }, { type: 'null' }], description:
        'One short line, from the brief, saying why this size and its direction hold (for example "a higher price pushes '
        + 'more customers to cancel"). null when `effect_amount` is null or the user stated the size.' },
    }, ['from', 'to', 'direction', 'provenance', 'effect_amount', 'effect_per_source_change', 'effect_provenance']) },
    /**
     * ⛔ C46: a product the analysis can only ADD UP must be DECLARED, never read off a label.
     * The analyse path is a linear SCM, so "Pro MRR = price × subscribers" is approximated, and
     * where an option pushes the inputs apart even the sign can flip (#70 5841215337). The
     * drafter states the definition; `admit-model.ts` checks it against the admitted links and
     * marks whether its sign is provable. REQUIRED so "none" is an empty list, never an omission.
     */
    identities: { type: 'array', description:
      'Quantities in this model that are, BY DEFINITION, other quantities in this model multiplied together, or (accumulation) a stock worked out month by month to the goal\u2019s deadline, including the goal itself. Empty when none.',
      items: obj({
        outcome: { type: 'string', description: 'The EXACT label of the quantity that is the product, or the stock at the deadline.' },
        operation: { type: 'string', enum: ['product', 'accumulation'] },
        factors: { type: 'array', items: { type: 'string' }, description: 'The EXACT labels of every quantity multiplied; for accumulation EXACTLY three, in this order: the stock today, the percentage lost per month, the amount added per month; for a stated net change EXACTLY two: the level today, the net amount added per month.' },
        provenance,
        reading: { anyOf: [{ type: 'string', enum: ['net', 'gross'] }, { type: 'null' }] },
      }, ['outcome', 'operation', 'factors', 'provenance']) },
    unknowns: { type: 'array', items: { type: 'string' } },
    // ⭐ THE QUESTION CARD'S TITLE (Paul, 27 Sep: served "Decision: MRR"). COPIED, never written: admission takes it only
    // when it is verbatim brief text (`admit-model.ts` `decisionEntityFor`). REQUIRED so strict output must say "no
    // question" (null) rather than omit it.
    decision_question: { anyOf: [{ type: 'string' }, { type: 'null' }], description:
      'The question the brief asks, copied VERBATIM from the brief (only the question itself, without any lead-in clause), or null if it asks none.' },
  }, ['goal', 'constraints', 'options', 'factors', 'risks', 'outcomes', 'links', 'identities', 'unknowns', 'decision_question']);
}

export const BUILD_INSTRUCTIONS = [
  'For an EVENT by a date (meet the deadline, launch by, deliver on time, ship by Q2), emit goal.kind event_by_date and goal.deliverable as a short noun phrase such as the feature launch. Never use likelihood, chance or probability as its quantity. A QUANTITY with a deadline (£150k MRR by March) keeps its present level goal with kind and deliverable null. For event_by_date, do not draft a goal baseline or user target; admission defines completion as 100%. Each option adding capacity supplies added_capacity {monthly_share_pct, lead_months_low, lead_months_high}: your estimate of extra percentage of the deliverable per month (0–100%) and recruitment/notice/onboarding lead time. Disclose these as Olumi’s estimates, never user figures. The status quo has added_capacity null. Preserve stated limits, factors, risks, option settings and their links in their corresponding collections. Ask for the date first, then how long today’s team takes, then when new people start. Never ask today’s level of the event goal.',
  'r5-stated-evidence-v1: For an EXPLICIT absolute option setting only, supply stated_evidence with its complete verbatim assertion (quote,start,end), the owned-option anchor (option_quote,option_start,option_end), and amount_start at the written figure. All offsets are UTF-16, end-exclusive, in the original brief. Include the full sentence, including bounds or alternatives; never shorten it to hide context. Use null for estimates, bounds, unresolved alternatives, additions or ambiguous ownership.',
  'For a factor whose CURRENT level the brief states, give baseline_evidence.quote as the complete verbatim sentence that states it; null for estimates, targets, limits or ambiguous ownership.',
  'Produce a complete causal decision model from the brief in ONE pass.',
  'Preserve exact user facts, numbers, constraint semantics and time horizon. The first model must support a PROVISIONAL calculation before user adoption: provide defensible starting estimates where the brief gives no baseline, mark those factors ai_proposed with baseline_known:false, and explain the uncertainty in unknowns. These are modelling assumptions, never measurements or user-validated facts. If no defensible estimate is possible, leave it null and name the specific unresolved input.',
  'Record the goal metric\u2019s CURRENT level in goal.baseline_value, in the goal unit. When the brief states it: baseline_known true, baseline_provenance "explicit". When it does not, leave baseline_value null with baseline_known false. Do not estimate it: a guessed current level would set the chance of reaching the target on a guess. It is where things stand today, never the target.',
  'For each option fill `interventions` with its factor settings. value_kind:"absolute" means the resulting total or level; value_kind:"additional" means a signed change from the same factor baseline. For hiring, adding two to a proposed baseline of five means total seven, never total two. Record the user-stated addition as explicit but keep an estimated resulting level ai_proposed. Keep one unit and plausible_max frame per factor across all baselines and options.',
  'Mark the option that keeps things as they are now with is_status_quo:true \u2014 at most one option, whatever it is called \u2014 and give it no levels; every other option has is_status_quo:null.',
  // ⛔ ONE QUANTITY, ONE MEANING (R3 #75 5914500931; AIQ 5914532431; DL 5915507578 item 4). Paul's brief weighs angel
  // outreach against "whether the overhead would be worth it"; the served draft kept ONE lever, "Funding process overhead"
  // (hours/week), that the options set and that cut investor conversations. Paul then sized it as EFFORT ("more effort
  // equates to more potential funding opportunities"), so his size landed on a meaning he never held.
  'KEEP AN ACTIVITY\u2019S EFFORT AND ITS COST APART. When the brief weighs an activity against its overhead, time or cost '
  + '("whether the overhead would be worth it"), draft TWO quantities, never one that means both: the EFFORT the options set, '
  + 'named for the activity itself (for example "Hours per week on angel outreach"), linked to what that effort produces; and '
  + 'its COST as a separate factor, outcome or risk (for example "Fundraising admin time" or "Distraction from the product"), '
  + 'linked from the effort and on to what it harms. Never name a lever the options set for its cost ("overhead"), and never '
  + 'let one node carry both the benefit and the cost of the same activity: a user who sizes it must be able to tell which one it is. '
  // AIQ CR on #2380 (5916139879): a SPEND lever must stay whole, or a user's money limit is judged across an Olumi-sized link.
  + 'This never splits MONEY the options set: a budget, a price, a spend or a split of spend IS the lever, and stays ONE quantity in its own money unit.',
  'Connect options to the controllable factors they change, then through supported causal mechanisms to risks and the goal. Never emit a direct option-to-risk link: it cannot be interpreted as an option setting a risk value. Retain each meaningful risk hypothesis, its sign and its downstream path; express its exposure through a causal factor or mediator, rather than deleting the risk or claiming equal exposure.',
  // ⭐ A4b (R3 row; DL 5918678308): 0 of 4 raw-captured drafts of Paul's funding brief drew its risk as money, despite the
  // `unit` field's own description, so every risk → £ goal link was a ±0.5 placeholder and #2386's definitional link never
  // engaged. Said where the drafter reads its rules, with the one shape that holds by definition.
  'A RISK THAT CUTS A MONEY GOAL IS THAT MONEY. When the goal is an amount of money the user wants MORE of (funding, revenue, '
  + 'MRR, profit), draft each risk that would cut it as the money it would cost, named for that loss (for example "Funding lost '
  + 'to fundraising distraction"), in the goal\u2019s money unit with a plausible_max, and link it to the goal with effect_amount '
  + '-1, effect_per_source_change 1 and definitional true: money lost to it is money the goal does not get. What causes it '
  + 'still links into it as usual. This rule says nothing about a goal the user wants LESS of (a cost or a spend).',
  'EVERY OPTION MUST SAY WHAT IT DOES \u2014 except the one marked is_status_quo, which names no changes and no levels because it keeps things as they are. Any OTHER option (not marked is_status_quo) with no `interventions` AND no `changes` is inert: it can never be compared with another option, whatever values are supplied later, and the whole decision becomes unanswerable. The option marked is_status_quo is meant to be empty \u2014 it is compared by holding today\u2019s levels, so leave it empty. If the brief does not say what an option changes, still decide which factors it ACTS ON \u2014 that is a structural claim \u2014 and then give each one a level. '
  + 'EVERY FACTOR IT ACTS ON NEEDS A LEVEL: for every option except the one marked is_status_quo, put one `interventions` entry for EACH factor it acts on \u2014 the user\u2019s own number where the brief states one, otherwise your estimated resulting level (value_kind:"absolute", provenance ai_proposed) in that factor\u2019s own unit and plausible_max frame. A factor an option acts on with no level leaves the user a value question before anything can be calculated. Use `changes` ONLY for a factor where no defensible level exists, and name that missing level in `unknowns`. Every factor an option acts on also needs a baseline_value (a provisional estimate with baseline_known:false when the brief gives none). An option (other than the one marked is_status_quo) that names no interventions and no changes is disconnected from the decision and cannot be analysed at all, so this is not optional bookkeeping.',
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
  // ⛔ A FIGURE RULE NEVER REMOVES STRUCTURE (DL #75 5916217417): drafted models with NO risk rose from ≤8% (20–27 Sep)
  // to 81% (30 Sep). Measured on staging 68c9789c (MG, 0 retries): both MRR briefs drafted 0 risks, hiring 2, funding
  // 1. Every rule below that limits how a risk is LINKED or SIZED had been read as a reason to leave the risk out.
  + 'and up to 4 to 6 outcomes and risks between them, only where they materially change the reasoning (the outcome the factors act through, the risk that could reverse the answer). '
  + 'ALWAYS KEEP AT LEAST ONE RISK: the downside that could reverse the answer is part of the decision the user must weigh. The rules below limit how a risk is LINKED or SIZED; none of them is a reason to leave a risk out. '
  // K3 (R3 #75 5925627855, #85 5931851041; DL 380e54 5932372585: GO, generalised, never money-specific): a downside
  // the user NAMES is theirs to weigh, so it is never traded away for one Olumi thought of (Paul's "we'll run out of
  // money soon" was drawn 0/4 with A4b, 1/4 before).
  + 'EVERY RISK THE USER NAMES IS DRAWN AS A RISK NODE: each downside the user states in their own words (for example that they will run out of money, lose a key customer, or miss a deadline) is its own risk, linked to what it threatens, even when you also draw a risk of your own. '
  // K3 precedence (Codex CR @5d3841dc, DL 9d9666): seven user-named risks cannot fit "up to 4 to 6 outcomes and risks",
  // so the envelope and K3 contradicted each other. The user's risks win; Olumi's own additions give way first.
  + 'A RISK THE USER NAMED OUTRANKS THE ENVELOPE: when the risks the user named do not all fit beside your own, leave out your own risks and outcomes first; never leave out or merge a risk the user named, even when that takes the model past 6 outcomes and risks. '
  + 'A model below this envelope cannot carry the reasoning; a model above it buries it. Do NOT widen beyond it on this turn: no speculative options, secondary factors, or decorative risks and outcomes. '
  + 'Anything you judge material but that does not meet that bar belongs in `unknowns` as a question, NOT as a node \u2014 it can become a proposal later. '
  // ⛔ THE COUNT IS THE GATE'S (AIQ #70 5858990481 item 5: the first draft's budget is the truth-safe lever). The rule
  // named only the decision's links, but admission also links each option to each factor it acts on, and the held
  // status quo to each factor the others act on (`admit-model.ts`): a served-shape draft the rule counted at 23 was
  // 33 at the gate (`construction-first-draft-link-budget.test.ts`).
  + `Stay within ${COMPACT_LIMITS.maxNodes} nodes and ${COMPACT_LIMITS.maxEdges} links in total, counting one link from the decision to each option, one from each option to each factor it acts on (for the option that keeps things as they are, each factor the other options act on) and each entry in \`links\`. Correct, connected items beat a comprehensive map: an oversized first model is refused before it reaches the canvas. THE ONE EXCEPTION IS THE USER'S OWN MATERIAL: when what the user stated (their options, figures, relationships and the risks they named) cannot fit this budget, keep all of it and leave out your own additions; that model is admitted, not refused.`,
  // ⛔ AN ADDED OPTION THE MODEL CANNOT TELL APART IS A DEAD START (DL #70 5842361028 / 5842400604). Served ef99a97 and
  // cb1778b added "Test £59 with AI release" beside the user's £59 option; the fill made them identical and the run
  // refused NOTHING_TO_COMPARE. Admission withholds such an option and says so (`admit-model.ts`), but withholding
  // alone leaves one valued option, which still cannot run (measured: `construction-no-identical-options.test.ts`,
  // RECORDED LIMIT) — so the drafter is told the shape to add instead.
  'Every option you add must differ from every other option in at least one factor level; a test, pilot or phased rollout of another option is not a separate option unless it sets a factor the model holds to a different level, such as the share of customers it reaches.',
  'Mark provenance honestly on EVERY item: "explicit" only for what the user stated, "inferred" for what you read out of the brief, "ai_proposed" for anything you added beyond it.',
  /*
   * ⛔ THE COMPANION INSTRUCTION TO `target_stated`. The schema now lets the model say
   * "no target was given"; nothing yet told it WHEN to. Without this the nullable field
   * is a capability no caller uses — and a 0 attributed to the user is the worst of the
   * available wrong answers, because it reads as a deliberate choice they made.
   */
  'A GOAL TARGET THE BRIEF DOES NOT STATE MUST BE LEFT UNSTATED. If the user named a number to reach \u2014 "to 40%", "by \u00a33m", "under 4 weeks" \u2014 set `target_stated: true` and put that number in `goal.value`. If they only named a DIRECTION \u2014 "increase productivity", "cut churn", "improve velocity" \u2014 then set `target_stated: false` and `goal.value: null`. Never substitute 0, never invent a plausible target, and never treat the absence of a number as a target of zero: a direction with no number is a complete and ordinary goal, and the analysis compares options against it perfectly well. Getting this wrong tells the user they asked for something they did not ask for. State the goal\u2019s `frame`: "level" when the user names the level to reach ("MRR to \u00a3250k", "keep the bill under \u00a340k"); "change_rel" when they name a PERCENTAGE change from today ("cut the cloud bill by 15%", "grow MRR by 10%"): `value` is that signed percentage (-15, or 10); "change_abs" when they name a change from today in the metric\u2019s own unit ("reduce churn by 2 points", "grow revenue by \u00a35k"): `value` is that signed amount. With no number, "level". `unit` is always the goal metric\u2019s own unit, the unit of its current level.',
  // ⛔ C46 (#70 5841314428): "£20k MRR" silently became Pro MRR on Paul's captured brief.
  'NEVER PICK THE SCOPE OF THE GOAL SILENTLY. When the goal metric could mean one part or the whole — the brief says "MRR" or "revenue" and the decision is about one plan, product, segment or region — set `goal.scope`: `modelled` is what your model actually measures (e.g. "the Pro plan only"), `alternative` is the other reading (e.g. "all plans together"), and `stated_in_brief` is true only when the brief itself says which. Keep `goal.metric` in the user’s own words: Olumi states the modelled scope as its own assumption and asks the user which they meant from `goal.scope`. When the goal metric has no part-or-whole reading, `goal.scope` is null.',
  // ⛔ C46 (#70 5841215337): the analysis adds effects up, so a product is approximated and its sign can flip.
  'DECLARE A PRODUCT ONLY WHERE ONE HOLDS BY DEFINITION. When a quantity you keep is, by definition, other quantities you keep multiplied together — a plan’s revenue is its price times its paying subscribers; a cost is headcount times cost per head — add one entry to `identities`: `outcome` is that quantity’s EXACT label, `operation` "product", and `factors` the EXACT labels of every quantity multiplied. Still state each factor’s own link toward the outcome in `links`. Only a definition, never a correlation or a guess. `identities` is empty when none holds.',
  // ⭐ CEE #4 (Science goals §(v)): a goal with a deadline over a stock that churns and grows is about that stock AT the
  // deadline, which a model of today's levels cannot see. Admission (`accumulation-identity.ts`) refuses any shape below
  // that does not hold, and says why.
  'A STOCK AT THE DEADLINE IS WORKED OUT, NEVER GUESSED. Only when the goal states a deadline in months AND the goal depends on a stock that loses a share each month and gains an amount each month (paying subscribers with monthly churn and new sign-ups): add an outcome labelled with the stock and the deadline (e.g. "Pro subscribers at month 12"), link the stock today, its monthly churn and its monthly new additions each DIRECTLY to that outcome, and add one entry to `identities` with `operation` "accumulation", `outcome` that label, and `factors` EXACTLY [the stock today, the churn as a percentage per month (unit "%"), the amount added per month], in that order. Each of the three needs today\u2019s level. Whenever an accumulation is declared, the goal\u2019s PRODUCT in `identities` over [the price-like part, "<stock> at month N"] is REQUIRED; link both parts directly to the goal. Never use it for a churn stated per year, or without a stated deadline.',
  'When the brief states the goal’s level today and its monthly change, the accumulation outcome may be the GOAL itself, with no product required. Use TWO factors [the level today, the net amount added per month] and reading "net" ONLY for a stated net change or an amount it "grows by"; a gross inflow with no stated losses has reading "gross" and is refused without assuming losses.',
  'THE GOAL METRIC MUST BE THE TERMINAL NODE. Every option needs a causal path that ends at the goal metric you named in `goal.metric`. Use that EXACT label as the endpoint of the final link \u2014 do not invent a near-synonym outcome like "X Improvement" for a goal called "X change", because a separate synonym leaves the goal disconnected and the model cannot be analysed at all.',
  'EVERY LIMIT MUST NAME A NODE THE ANALYSIS CAN CHECK. Each `constraints[].metric` must be the EXACT label of a factor or outcome you keep in this model \u2014 a limit whose metric names no node is withheld from the model, and the analysis cannot check it. If the user limits a total such as cost, budget or spend, keep that total in the model as a factor the options set or an outcome their factors feed, wired toward the goal like every other factor, and use its exact label as the metric. State the `frame` of each limit: "level" when the user limits the value itself ("total first-year cost under \u00a3250k", "gross margin above 70%"); "change_abs" when they limit a CHANGE from today in the quantity\u2019s own unit ("churn no more than 2 points higher than now"); "change_rel" when they limit a PERCENTAGE change from today ("cost no more than 10% above today", "cut spend by at least 15%"): give `value` as that signed percentage (10, or -15) and `unit` "%". When the limit is on a cost, budget or spend, give that factor a `baseline_value` at what is spent on it today: 0 when nothing is, as for a new hire, a new system or a new budget. When the user limits a quantity whose current level the brief does not state, still give it a `baseline_value`: your provisional estimate, with baseline_known:false and provenance ai_proposed, never the user\u2019s (the user is asked for theirs) \u2014 a limit on a quantity with no level cannot be checked. Keep the direction the user stated: a budget, cost or spend cap is an upper bound and a floor such as a minimum margin is a lower bound; never add the opposite bound to the same limit. Type the comparator the user wrote: "<" for "under", "below" or "less than"; "<=" for "at most", "no more than" or "up to"; ">" for "over", "above" or "more than"; ">=" for "at least" or "no less than".',
  // ⛔ THE LINK CONTRACT (#63 ruling 5793252993). There is NO default-positive
  // factor->goal repair in admission, by ruling: a sign nobody stated would be a
  // fabricated belief. So the drafter itself must state every link toward the
  // goal as a HYPOTHESIS with a direction, or say it cannot and ask. The measured
  // failure it answers: served 553254d, option->factor links only, goal orphaned.
  'EVERY RISK AND EVERY FACTOR MUST BE WIRED IN. A node with no link, or with links that dead-end before the goal (except at a limit the user set: see THE ONE EXCEPTION below), is not merely decorative \u2014 it stops the ENTIRE model being analysed. Measured on a real model: 8 of 20 nodes were unreachable, all five risks among them, and the analysis refused outright. '
  + 'EVERY FACTOR YOU KEEP NEEDS ITS OWN LINK TOWARD THE GOAL in `links` (or toward a quantity the user only limits, THE ONE EXCEPTION below): straight to the goal metric (its EXACT label), or to a kept outcome that itself links to the goal metric. An option naming a factor in `changes` connects the option TO the factor; it does NOT connect the factor to anything, so a factor that only receives links from options dead-ends. Measured on a real first model: two factors, both fed only by options, neither linked on, the goal orphaned and the analysis refused. Give every risk a link to what it threatens. '
  // ⛔ A LIMITED QUANTITY MAY END AT ITS LIMIT (R3 #75 5903589565; AIQ 5903604206; readiness `graph-structure-validator.ts`
  // loop 2 accepts a lever-driven limit branch as a sink). Served cut-costs: 3 of 4 first drafts invented
  // "migration downtime → monthly spend" to satisfy the sentence above; downtime does not change the cloud bill.
  + 'THE ONE EXCEPTION: a quantity the user only LIMITS ("no more than 2 weeks of migration downtime") may END at that limit, and so may the factors that only feed it, because a limit is judged on the quantity it names, not through the goal. Link into it what the options change, and link it on toward the goal ONLY if it really changes the goal metric. Never add a link to the goal just to connect it: migration downtime does not change the cloud bill. '
  + 'AND NEVER LINK AN OPTION STRAIGHT TO A RISK. An option changes a FACTOR, and it is the factor that raises or lowers the risk, so state it as `option -> factor` (through `changes`/`interventions`) and then `factor -> risk` with its own direction, and the risk on to what it threatens. A bare option -> risk link is the one shape that LOOKS connected and cannot be analysed at all: Olumi has to stop and ask how that option changes that risk before ANY of the model can run. Measured: ONE such link refuses the whole analysis, and a real first model carried four of them. If you cannot name the factor in between, do not draw the link: ask which factor carries it in `unknowns`.',
  'EACH LINK IS A CAUSAL HYPOTHESIS, AND ITS DIRECTION MUST BE STATED, NOT DEFAULTED. Take the direction from the brief where it says so; otherwise from the causal reasoning you could state in one line ("more delivery capacity raises velocity"; "a higher price raises churn"; "higher churn lowers recurring revenue"). '
  + 'Such a link is Olumi\'s hypothesis, not the user\'s claim: provenance "inferred" when it is read out of the brief, "ai_proposed" when it is your own reasoning, and "explicit" ONLY when the user stated that relationship. '
  + 'WHICH option is better is the question the analysis answers \u2014 it is never a reason to mark a factor\'s link to the goal "unknown": more capacity raises velocity whichever option supplies it. '
  + 'Only when you genuinely cannot say which way a link runs, set its direction to "unknown" AND add a question to `unknowns` asking the user which way it runs. An "unknown" link is withheld from the model and never counts as a path, so every option must still reach the goal through links whose direction you can state.',
  // ⭐ THE MAGNITUDE CONTRACT (D1): ONE sentence. Admission reads the size on each end's own frame and never
  // lets it run a bounded quantity out of its range (served T3: a frame-blind 0.5 moved churn by about 50 points).
  'STATE EACH LINK’S SIZE IN NATURAL UNITS: `effect_amount` is the signed change in the target’s own unit (in points for a percentage, so 4% to 3% is -1) caused by `effect_per_source_change` of the source in its own unit (1 for switching a yes/no on), negative whenever the link’s direction is negative, and `basis` one short line on why that size and direction hold, with `effect_provenance` "explicit" only when the user stated that size, and all three null when you cannot give a defensible size.',
  // ⛔ A4 (R3 #75 5918453000; AIQ 5918516441 / 5918523203; R3 5918513716; DL 5918542181): Paul's brief states investment
  // firms "do deals between £1-2m", and no node or link carried it, so every £ figure into his goal was Olumi's
  // default. The size is per DEAL, never per conversation (that would claim every conversation brings £1m). One general
  // rule, no domain example: the countable the size is per becomes a quantity, and a stated range gives its LOW end.
  'A MONEY SIZE THE BRIEF STATES PER ONE OF SOMETHING (per deal, per contract, per subscriber) belongs on the link from THAT countable to the money goal. Keep the countable as its own quantity (an outcome such as "Deals closed", unit "deals", with a `plausible_max`), link it to the goal with that size per one (`effect_per_source_change` 1, `effect_provenance` "explicit"), and never put the size on a link from anything else. When the brief gives a RANGE for that size, use its LOW end. What moves the countable (how many conversations become deals, say) is not stated: link it with your own estimate or no size, never "explicit", and ask it in `unknowns`.',
  // ⛔ R-c (AI Quality 5881541947 / 5882087383): a limit is checked only when every link from what an option changes to
  // the limited quantity carries a size in that quantity's own unit, and a risk has no unit. Measured (MG 7×3, 29 Sep):
  // 10 of 12 A/C churn limits reached churn only through a risk, so none of them could be checked. The first wording
  // ("never route a cause … through a risk") left a risk → churn link on 2 of 6 A/C drafts; the ban is now structural.
  // ⛔ ONE MECHANISM, ONE ROUTE (AIQ 5883228443; PR Review CR on #2276 @ 729ce9d3): "link the risk to the goal metric"
  // kept a price-sensitivity risk → MRR beside the new sized price → churn path on 5/21 drafts (A-0, A-2, C-1, cloud-2,
  // techlead-1): the same loss counted twice. No domain example: a worked example steers every brief. A first wording
  // ("keep a risk only for a separate harm … otherwise leave it out") also dropped separate harms: risks 23 → 10 (lsD).
  'A LIMIT CAN ONLY BE CHECKED THROUGH SIZED LINKS. NO LINK MAY POINT FROM A RISK TO A QUANTITY IN `constraints`: a risk has no unit, so that link cannot be sized and the user’s limit cannot be checked. Instead, link every factor an option changes that moves the limited quantity STRAIGHT to it and give that link its size. That sized link already carries the limited quantity moving the wrong way, so do not size that loss a second time: keep that risk as a node, linked to the goal metric with all three size fields null. Every OTHER risk stays exactly as you would draw it, linked to the goal metric or to the quantity it threatens.',
  'GIVE EVERY FACTOR A `plausible_max`. IT IS REQUIRED AND NEVER NULL, for every factor, whether or not it has a baseline today. A number above 1 with no range beside it CANNOT BE ANALYSED \u2014 the engine has nothing to read it against, Olumi refuses the WHOLE analysis rather than guess, and NO LATER EDIT CAN SUPPLY THE RANGE: the only remedy is rebuilding the model. The range is a SCALE, not a forecast: 100 for a percentage or a score out of 100, exactly 1 for something already between 0 and 1, and a round number comfortably above anything realistic for a count, an amount or a price. Measured twice on real models.',
  'Labels are NAMES, not sentences.',
  'Set `decision_question` to the question the brief asks, copied VERBATIM from the brief (only the question itself, without any lead-in clause), or null if it asks none. Never reword it.',
  'Output only the schema.',
].join(' ');

/** Only a brief attested by the deterministic reader may delegate its empty event forecast to admission. */
export function buildInstructionsForBrief(brief: string, construction?: ConstructionAdmission): string {
  return (construction?.event_by_date_prompted ?? briefAttestsEventByDate(brief))
    ? `${BUILD_INSTRUCTIONS} The deterministic reader attests an event by a date. The event-share parts replace ordinary causal goal links. When no stated facts belong in these collections, leave its factors, risks, outcomes, links and identities empty for this slice. Keep every stated limit, factor, risk, option setting and link; admission will disclose any link the deadline forecast cannot use.`
    : BUILD_INSTRUCTIONS;
}

export type CallStructuredModel = (req: {
  model: string; instructions: string; input: string;
  max_output_tokens: number; schema: Record<string, unknown>;
  reasoning_effort?: 'low' | 'medium' | 'high';
}, deadlineAt?: number) => Promise<{
  text: string; usage?: Record<string, unknown>;
  /**
   * The Responses API's own completion status (AIX-001), e.g. `incomplete` with reason `max_output_tokens` —
   * or the route's own `incomplete` / `construction_timeout`: the call ran out of turn budget, no answer came.
   */
  status?: string; incomplete_reason?: string;
}>;

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
export function retrySchemaPinningGoal(
  goal: CandidateModel['goal'],
  /**
   * The first draft's copied question, pinned the same way: a compaction may not re-choose the question either, and a
   * question admission took as the user's is user material (`keepsEveryUserStatedIdentity`). Absent (a candidate from
   * before the key) pins to "no question" (null).
   */
  decisionQuestion?: string | null,
): Record<string, unknown> {
  const schema = buildCandidateSchema();
  const properties = schema['properties'] as Record<string, Record<string, unknown>>;
  properties['decision_question'] = typeof decisionQuestion === 'string'
    ? { type: 'string', enum: [decisionQuestion] }
    : { type: 'null' };
  const goalSchema = properties['goal'];
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
    // R1 S4-core: the frame the target is stated in is part of the goal, so a compaction cannot turn "cut by 15%" into a
    // level of 15. An absent frame (a candidate from before the field) pins to "level", exactly what it meant.
    frame: { type: 'string', enum: [goal.frame ?? 'level'] },
    // The current level is part of the goal, so it is pinned too; an absent value
    // (a candidate from before the field) pins to "not given".
    baseline_known: { type: 'boolean', enum: [goal.baseline_known === true] },
    baseline_value: typeof goal.baseline_value === 'number'
      ? { type: 'number', enum: [goal.baseline_value] }
      : { type: 'null' },
    baseline_provenance: { type: 'string', enum: [goal.baseline_provenance ?? goal.provenance] },
    // C46: the scope is part of the goal, so a compaction cannot switch readings or drop the
    // question. An absent scope (a candidate from before the field) pins to "none" (null).
    scope: goal.scope === null || goal.scope === undefined || typeof goal.scope !== 'object'
      ? { type: 'null' }
      : {
          type: 'object', additionalProperties: false, required: ['modelled', 'alternative', 'stated_in_brief'],
          properties: {
            modelled: { type: 'string', enum: [goal.scope.modelled] },
            alternative: { type: 'string', enum: [goal.scope.alternative] },
            stated_in_brief: { type: 'boolean', enum: [goal.scope.stated_in_brief] },
          },
        },
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
 *   A LOOP is not found here: it is admission's verdict (`loopIssues`, below).
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
const OPERATOR_WORDS: Readonly<Record<string, string>> = LIMIT_OPERATOR_WORDS;
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
    // R1 S4-core: a limit on a CHANGE from today is said as that change ("Cost, no more than 10% above today"), in the
    // frame admission would have written (`writtenLimitFrame`); a level exactly as before.
    const written = writtenLimitFrame(c);
    const limit = isChangeFrame(written.frame) && (c.operator === '<=' || c.operator === '>=' || c.operator === '<' || c.operator === '>')
      ? `${c.metric}, ${sayLimitInFrame({ operator: c.operator, value: written.value, unit: written.unit, frame: written.frame, words: LIMIT_OPERATOR_WORDS, figure: (v, u) => `${v}${u === undefined || u === '' ? '' : u.startsWith('%') ? u : ` ${u}`}` })}`
      : `${c.metric} of ${bound} ${c.value}${unit}`;
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

export function prepareProvisionalCandidate(drafted: CandidateModel, brief?: string): {
  candidate: CandidateModel;
  /** Olumi option levels on a limited node the same option's levers move, dropped (`option-level-over-own-levers.ts`). */
  levels_over_own_levers: OptionLevelOverOwnLevers[];
  mechanism_issues: string[];
  additions_without_total: AdditionWithoutTotal[];
  provenance_demoted: DemotedProvenance[];
  level_gaps: LevelGap[];
  baseline_gaps: BaselineGap[];
} {
  // ⛔ BEFORE the demotion below: a level the user stated is still `explicit` here, so the guard never drops it (a
  // demoted user total is rewritten to `ai_proposed` and would otherwise be read as Olumi's).
  const { model, dropped: levels_over_own_levers } = dropOptionLevelsOverOwnLevers(drafted);
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
        if (intervention.provenance === 'explicit' && unknownBaseline
          && !(factors[0]!.baseline_value === 0 && verifiedOptionSetting(model, option, intervention, brief))) {
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
      // A stated addition to known zero IS the stated figure, regardless of who named the factor.
      const statedFigure = intervention.provenance === 'explicit' && factor.baseline_known === true && factor.baseline_value === 0;
      interventions.push({
        ...intervention, value_kind: 'absolute', value: factor.baseline_value + intervention.value,
        provenance: statedFigure || (factor.baseline_known && factor.provenance === 'explicit' && intervention.provenance === 'explicit')
          ? 'explicit' : 'ai_proposed',
        // ⛔ A TOTAL WE COMPUTED IS NOT A FIGURE THE USER WROTE (RT-4 class A, #2603; Codex r1): a stated 5% today plus a
        // stated 2% is the user's 7%, but "7%" appears nowhere as theirs, and an unrelated "Churn is 7%" was credited to it.
        // Admission marks the level (`constructedLevel`) so the not-modelled manifest never credits a brief literal to it.
        ...(statedFigure ? {} : { derived_total: true }),
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
  const { level_gaps, baseline_gaps } = findCoverageGaps(model, additions_without_total);
  return { candidate: { ...model, options }, levels_over_own_levers, mechanism_issues, additions_without_total, provenance_demoted, level_gaps, baseline_gaps };
}

/**
 * ⛔ A LOOP CLOSED BY ONE OF OLUMI'S OWN LINKS, as a construction issue for the one repair retry (served
 * bdd43f4a: "AI feature availability" and "AI release delay" linked both ways; readiness refused the whole
 * model on CYCLE_DETECTED). ADMISSION'S VERDICT, not a second derivation (review of f504b8e0, (c)): each
 * loop `breakLoops` had to break in the admitted model, over exactly the edges admission registers — so a
 * "loop" through a label the draft never declared, a direction-unknown link or a folded shortcut, which
 * admission never registers, costs no retry call. A loop made only of the user's links and the structural
 * edges is kept and said by admission, and is never an issue: it is theirs to resolve.
 */
/**
 * ⭐ A4 ON THE SERVED DRAFT — A MONEY RANGE THE BRIEF WRITES THAT NO LINK CARRIES (R3 5921213011; diagnosis 5921266982).
 * Served `5479e15e`: Paul's "deals between £1-2m" reached no link, because the drafter drew the route as an effort
 * lever with no countable, and the per-one rule (#2409) had nothing to size. Each written money range that no admitted
 * link carries as the user's own size (`natural_effect.stated_range`, bound to its span by #2409) is one construction
 * issue for the EXISTING repair retry. The retry is adopted only when it CARRIES more ranges (`carriedRanges`), so a
 * range that is no per-one size (a budget, a target) costs one retry and changes nothing.
 */
export function carriedRanges(admitted: Pick<AdmittedModel, 'edges'>): Set<string> {
  const texts = admitted.edges.map((e) => (e.provenance as { natural_effect?: { stated_range?: { text?: unknown } } } | undefined)?.natural_effect?.stated_range?.text);
  return new Set(texts.filter((t): t is string => typeof t === 'string'));
}

/**
 * A range written inside a QUESTION ("Should we focus on firms that do deals between £1-2m?") is not asked of the
 * retry (CODEX CEE BUDDY 5921351458): a question states no size. Its sentence ends at the next . ! ? before a space or
 * the end, or a new line (a decimal point never ends it); a "?" there makes it a question.
 */
function inAQuestion(text: string, at: number): boolean {
  const end = text.slice(at).search(/[.?!](?=\s|$)|\n/);
  return end !== -1 && text.charAt(at + end) === '?';
}

/**
 * The MONEY the draft holds as a value, each with the ONE quantity that holds it: the goal's target and today's level,
 * each factor's today, each option's level for a factor, each limit, in a currency unit. Never a frame (`plausible_max`),
 * a count, a horizon or any number in another unit (CODEX CEE BUDDY 5921470248: an hours factor's `plausible_max` of
 * 1000 once "held" £1m).
 */
function moneyHeldBy(drafted: CandidateModel): { readonly label: string; readonly value: number; readonly unit: string }[] {
  const out: { label: string; value: number; unit: string }[] = [];
  const add = (label: unknown, value: unknown, unit: unknown) => {
    if (typeof label !== 'string' || label === '' || typeof value !== 'number' || !Number.isFinite(value) || typeof unit !== 'string') return;
    if (readCurrencyUnitWithQualifiers(unit).kind !== 'currency') return;
    out.push({ label, value, unit });
  };
  add(drafted.goal.metric, drafted.goal.value, drafted.goal.unit);
  add(drafted.goal.metric, drafted.goal.baseline_value, drafted.goal.unit);
  for (const f of drafted.factors) add(f.label, f.baseline_value, f.unit);
  for (const o of drafted.options) for (const iv of o.interventions ?? []) add(iv.factor_label, iv.value, iv.unit);
  for (const c of drafted.constraints) add(c.metric, c.value, c.unit);
  return out;
}

/**
 * ⛔ A RANGE IS HELD ONLY BY THE ONE QUANTITY IT IS WRITTEN ABOUT (CODEX CEE BUDDY 5921674571; PTL 5921699859). Pooling
 * every £ value let an unrelated £1m valuation and £2m payroll "hold" "deals between £1-2m", and A4 was never asked. Held
 * = ONE quantity holds BOTH ends as values, and the brief's span at each end is that value, in its unit and currency,
 * written about that quantity (`figureTheUserWroteFor`, strict, read `at` that end: the scoped reader #2409's door binds with).
 * Every miss asks the retry, which is adopted only when a link then CARRIES the range: asking costs one call, never a figure.
 */
export function uncarriedRangeIssues(brief: string, admitted: Pick<AdmittedModel, 'edges'>, drafted: CandidateModel): string[] {
  const carried = carriedRanges(admitted);
  const held = moneyHeldBy(drafted);
  const quantities = [drafted.goal.metric, ...drafted.factors.map((f) => f.label), ...drafted.outcomes.map((o) => o.label), ...drafted.risks.map((r) => r.label)];
  // The written amount AT that end is this quantity's value, in its unit and currency, and written about it.
  const holdsAt = (label: string, end: { readonly index: number }) => held.some((h) => h.label === label
    && figureTheUserWroteFor(h.value, h.unit, brief, { target: [label], others: quantities.filter((q) => q !== label), strict: true, at: end.index }));
  const heldAsOne = (r: StatedRange) => [...new Set(held.map((h) => h.label))].some((label) => holdsAt(label, r.low) && holdsAt(label, r.high));
  return [...new Map(findStatedRanges(brief).map((r) => [r.text, r] as const)).values()]
    .filter((r) => !carried.has(r.text) && !heldAsOne(r) && !inAQuestion(brief, r.high.index))
    // `written`, never a one-letter name: a quoted `"${t}"` reads as a currency token to the currency-vocabulary guard.
    .map((r) => r.text).map((written) =>
    `The brief writes "${written}" and no link in the model carries it. ${perOneRangeRule(written)} If it is not a size `
    + 'per one of anything, change nothing for it.');
}

/** What the per-one rule asks of ONE written range: the same words for the first construct and the repair retry. */
function perOneRangeRule(written: string): string {
  return 'If it is a money size PER ONE of something the brief names '
    + '(per deal, per contract, per customer), apply the per-one rule: keep that countable as its own quantity, link it to the '
    + `money goal, and size that link per one at the LOW end of "${written}" (effect_provenance "explicit").`;
}

/**
 * ⭐ A4 FIRST PASS (MG #85 lease 5944839798; AI HARNESS 5944602546): the range is asked BEFORE the first draft, not only
 * of the retry. On Paul's brief the first pass left his written deal-size range uncarried on 5 of 8 served first briefs (7 of 8
 * paid a second construct, median +15.7 s), and that range retry was adopted 5 times in 6: the first pass skipped real work. Every range the brief
 * writes outside a question gets the retry's own per-one words; the retry stays the backstop, unchanged. A brief that
 * writes no range is sent exactly as before, byte for byte.
 */
export function firstConstructInput(brief: string): string {
  const notes = [...new Set(findStatedRanges(brief).filter((r) => !inAQuestion(brief, r.high.index)).map((r) => r.text))]
    .map((written) => `The brief writes "${written}". ${perOneRangeRule(written)} If it is not a size per one of anything, draw it as you otherwise would.`);
  return notes.length === 0 ? brief : `${brief}\n\nConstruction notes: ${JSON.stringify(notes)}`;
}

/** A missing option-to-goal mechanism, read from what admission actually kept. */
export interface OutcomePathIssue {
  readonly option_id: string;
  readonly option: string;
  readonly factors: readonly string[];
  readonly dead_end_ids: readonly string[];
  readonly dead_ends: readonly string[];
  readonly issue: string;
}

export interface ConstructionGaps {
  readonly path_missing: readonly { readonly option_id: string; readonly option: string; readonly dead_end_ids: readonly string[]; readonly dead_ends: readonly string[] }[];
}

export function pathIssues(admitted: Pick<AdmittedModel, 'nodes' | 'edges' | 'goal_constraints'>): OutcomePathIssue[] {
  const goals = admitted.nodes.filter((n) => n.kind === 'goal');
  if (goals.length === 0) return []; // The existing no-goal refusal owns this case.
  const refusedOptions = optionsWithoutGoalPath(admitted);
  const nodeOf = new Map(admitted.nodes.map((n) => [n.id, n]));
  const directed = admitted.edges.filter((e) => (e as { edge_type?: string }).edge_type !== 'bidirected');
  const outgoing = new Map<string, string[]>();
  for (const edge of directed) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  const quoted = (s: string): string => JSON.stringify(s);
  const goal = goals.map((n) => quoted(n.label)).join(', ');
  return admitted.nodes.filter((n) => n.kind === 'option' && n.is_baseline !== true && refusedOptions.has(n.id)).map((option) => {
    const factors = (outgoing.get(option.id) ?? []).map((id) => nodeOf.get(id)).filter((n) => n?.kind === 'factor').map((n) => n!.label);
    const branch = reachableNodeIds(directed, [option.id]);
    const terminals = [...branch].filter((id) => (outgoing.get(id) ?? []).length === 0);
    // Admission normally breaks loops. A closed cycle still needs an honest name, not an empty dead-end list.
    const dead_end_ids = terminals.length > 0 ? terminals : [...branch];
    const dead_ends = dead_end_ids.map((id) => nodeOf.get(id)?.label ?? id);
    // The structured gap preserves identities; the drafter's existing words stay label-only and deduplicated.
    const deadEndLabels = [...new Set(dead_ends)];
    const actsOn = factors.length > 0 ? factors.map(quoted).join(', ') : 'no connected factor';
    return {
      option_id: option.id, option: option.label, factors, dead_end_ids, dead_ends,
      issue: `${quoted(option.label)} acts on ${actsOn}, whose links end at ${deadEndLabels.map(quoted).join(', ')}; nothing it changes reaches ${goal}. `
        + `Link what it changes, through a mechanism you can state in one line, to ${goal}, or say in unknowns which mechanism is missing.`,
    };
  });
}

export function loopIssues(admitted: Pick<AdmittedModel, 'withheld'>): string[] {
  return admitted.withheld
    .filter((w) => w.reason === 'loop_closing_link' && w.loop !== undefined && w.loop.length > 0)
    .map((w) => `${[...w.loop!, w.loop![0]!].map((l) => `"${l}"`).join(' -> ')} is a loop: a model cannot hold one. `
      + 'Keep the direction that carries the cause toward the goal metric, remove the link that points back, and keep every '
      + 'option and risk connected to the goal through links whose direction you state.');
}

/**
 * ⛔ EVERY OPTION × FACTOR IT ACTS ON NEEDS A LEVEL (served CEE e39f6e0, witness
 * c22): every lever named its factors only in `changes` and two acted-on baselines
 * were null, so readiness asked a value question for every pair and no first
 * analysis ran. These gaps go to the ONE repair retry; nothing here invents a level.
 *  · A `changes` entry, or an option→factor link, with no level on that factor is a
 *    level gap — never on the option marked is_status_quo, which is held, not set
 *    (#1873 B2).
 *  · An acted-on factor with no finite baseline is a baseline gap — EXCEPT one a
 *    user's addition could not become a total on (#1841 B1): that figure is the
 *    user's to give, and no retry is spent on it.
 * Read off the drafter's own candidate, so a degraded addition (moved into
 * `changes` by preparation) is never mistaken for a missing level.
 */
export interface LevelGap { readonly option: string; readonly factor: string }
/**
 * `because: 'limit'` (DL ruling #72 5863840239): a quantity the user LIMITS, at its level, with no level of its own. The
 * limit cannot be checked against a factor with no level (served journey C: `CONSTRAINT_TARGET_NO_OBSERVED_VALUE`, and
 * churn ranked #2 unvalued in 3 of 17 drafts), so it is a gap like an acted-on baseline: the retry gives Olumi's
 * labelled estimate (baseline_known:false), never the user's, and the user is asked for theirs.
 */
/**
 * `because: 'identity'` (MG #72 5865315803): a quantity a declared PRODUCT multiplies, with no level of its own. ISL
 * evaluates a product from its parts' levels, so one part with none leaves the product unevaluable and the Run refused
 * (served journey C run 2, CEE 651a7fd: "MRR = Pro price × Pro subscribers" with no subscriber level — every Run said
 * "the current number of Pro paying subscribers is missing"). The same retry, the same labelled estimate, never the user's.
 */
export interface BaselineGap {
  readonly factor: string;
  readonly because?: 'limit' | 'identity';
  /**
   * The limited quantity was drafted as an OUTCOME, which admission registers as a level-less observable factor
   * (`limitedOutcomeFrame`). Served journey C run 2 (CEE c35f1c7): "Monthly churn" drafted so, the gap was never
   * counted, no retry ran, and the Run scored churn with no level (PJ-B3 rank 2 unvalued, PJ-A3 limit unscored).
   */
  readonly outcome?: true;
}
export function findCoverageGaps(
  model: CandidateModel,
  additionsWithoutTotal: readonly AdditionWithoutTotal[],
): { level_gaps: LevelGap[]; baseline_gaps: BaselineGap[] } {
  const factorLabels = new Set(model.factors.map((f) => f.label));
  const userOwnedBaseline = new Set(additionsWithoutTotal.filter((a) => a.reason === 'baseline_unknown').map((a) => a.factor));
  const level_gaps: LevelGap[] = [];
  const actedOn = new Set<string>();
  for (const option of model.options) {
    if (option.is_status_quo === true) continue;
    const levelled = new Set((option.interventions ?? []).map((i) => i.factor_label));
    for (const f of levelled) if (factorLabels.has(f)) actedOn.add(f);
    // An option can act on a factor through `links` alone (pre-review 5828364580):
    // admission admits that option→factor edge, so readiness asks for its level too.
    // A direction-unknown link is withheld by admission, so it is no pair here.
    const linkedFactors = model.links
      .filter((l) => l.from === option.label && factorLabels.has(l.to) && l.direction !== 'unknown')
      .map((l) => l.to);
    for (const f of [...(option.changes ?? []), ...linkedFactors]) {
      if (!factorLabels.has(f)) continue;
      actedOn.add(f);
      if (!levelled.has(f) && !level_gaps.some((g) => g.option === option.label && g.factor === f)) level_gaps.push({ option: option.label, factor: f });
    }
  }
  const noBaseline = (f: CandidateModel['factors'][number]): boolean => typeof f.baseline_value !== 'number' || !Number.isFinite(f.baseline_value);
  const baseline_gaps: BaselineGap[] = model.factors
    .filter((f) => actedOn.has(f.label) && !userOwnedBaseline.has(f.label))
    .filter(noBaseline)
    .map((f) => ({ factor: f.label }));
  // The quantity of a limit that needs today's level (`limitNeedsTodaysLevel`: a level, or a change RELATIVE to today; an
  // absolute change is read against the status quo and needs none), named as admission names a limit's node
  // (`metricNamesLabel`), so "Monthly Churn" is the factor "Monthly churn" (verifier LOW).
  const limited = (model.constraints ?? []).filter((c) => limitNeedsTodaysLevel(c.frame)).map((c) => c.metric);
  for (const f of model.factors) {
    if (limited.some((m) => metricNamesLabel(m, f.label)) && !actedOn.has(f.label) && !userOwnedBaseline.has(f.label) && noBaseline(f)) {
      baseline_gaps.push({ factor: f.label, because: 'limit' });
    }
  }
  // The same quantity drafted as an OUTCOME: admission registers it as a factor with no level (`limitedOutcomeFrame`),
  // naming it as admission names a limit's node (`metricNamesLabel`: case and surrounding space ignored). Only when the
  // outcome IS what registers: admission keeps ONE node per identity (`assignIds`, `canonicalLabel`), the first declared
  // (goal, options, factors, risks, then outcomes), so an outcome sharing its identity with any of those registers as
  // that entity — a factor is judged by the rules above, once (verifier FIX_FIRST (3) on f773a217: factor AND outcome
  // drew two gaps and two retry lines).
  const rekinded = (model.constraints ?? []).filter((c) => !isChangeFrame(c.frame) && limitedOutcomeFrame(c) !== undefined).map((c) => c.metric);
  const registeredFirst = new Set([
    ...(typeof model.goal?.metric === 'string' ? [model.goal.metric] : []),
    ...model.options.map((o) => o.label), ...model.factors.map((f) => f.label), ...(model.risks ?? []).map((r) => r.label),
  ].map(canonicalLabel));
  for (const o of model.outcomes ?? []) {
    if (registeredFirst.has(canonicalLabel(o.label)) || baseline_gaps.some((g) => canonicalLabel(g.factor) === canonicalLabel(o.label))) continue;
    if (rekinded.some((m) => metricNamesLabel(m, o.label))) baseline_gaps.push({ factor: o.label, because: 'limit', outcome: true });
  }
  // A quantity a declared product multiplies (and no earlier rule already names).
  const multiplied = new Set((model.identities ?? []).filter((i) => i.operation === 'product').flatMap((i) => i.factors ?? []));
  for (const f of model.factors) {
    if (multiplied.has(f.label) && !baseline_gaps.some((g) => g.factor === f.label) && !userOwnedBaseline.has(f.label) && noBaseline(f)) {
      baseline_gaps.push({ factor: f.label, because: 'identity' });
    }
  }
  return { level_gaps, baseline_gaps };
}

/**
 * ⛔ A COVERAGE GAP IS A VALUE QUESTION ON THE MODEL THAT IS REGISTERED (merge of staging's #1967 into #1891).
 * Admission withholds an option Olumi added that another option covers (`options_withheld`, `admit-model.ts`) and
 * re-admits the draft "as if the drafter had never drafted it", so readiness never asks a value question about it:
 * its option × factor pairs, and a baseline only it acts on, are no gap. Re-read off the drafter's own candidate
 * without it — for the first draft, and for the retry only where the first draft did not register it (a retry that
 * makes a registered option indistinct keeps its gaps in the count: COMBINED row 2g; asked only about gaps, it is
 * refused outright at adoption, `keepsEveryRegisteredOption`: rows 2h/2i). Counted, the served dead start's own "Test
 * £59 with AI release" (level-less: the very shape #1967 withholds) spent the one retry, and was listed to it as
 * issues, to level an option the user never sees (`construction-no-identical-options.test.ts`: "no retry is spent", and COMBINED row 2).
 */
function gapsOnRegisteredOptions<P extends ReturnType<typeof prepareProvisionalCandidate>>(
  p: P,
  raw: CandidateModel,
  admitted: Pick<AdmittedModel, 'options_withheld'>,
): P {
  const gone = new Set((admitted.options_withheld ?? []).map((w) => canonicalLabel(w.option)));
  if (gone.size === 0) return p;
  return { ...p, ...findCoverageGaps({ ...raw, options: raw.options.filter((o) => !gone.has(canonicalLabel(o.label))) }, p.additions_without_total) };
}

/**
 * ⛔ A GAP IS ANSWERED ONLY BY WHAT REGISTERS (adversarial verify of e7052de7, blocking: X3-SQ, SQ-H1..H3).
 * `findCoverageGaps` reads the drafter's own words, so a pair missing from a retry's count is not thereby answered.
 * The retry can declare the option the status quo (a status quo's pairs are never gaps). It can give an addition that
 * preparation cannot make a total (`additions_without_total`, which also makes the factor's baseline "the user's").
 * Or it can give a level below zero that admission withholds. Each one reads "fewer gaps" while readiness asks the
 * same value question of the registered model. So a gap the FIRST draft counted stays open until the retry's
 * REGISTERED model answers it, when the retry still drafts its option and factor. The answer is a level on that
 * option node for that factor node, or a baseline on that factor node. This returns the first draft's gaps that are
 * missing from the retry's own count and still unanswered. A retry that no longer drafts an option or factor is
 * judged by the rules that allow or refuse shedding it, never here.
 */
function unansweredOnRegistered(
  first: { readonly level_gaps: readonly LevelGap[]; readonly baseline_gaps: readonly BaselineGap[] },
  retry: { readonly level_gaps: readonly LevelGap[]; readonly baseline_gaps: readonly BaselineGap[] },
  retryRaw: CandidateModel,
  retryAdmitted: Pick<AdmittedModel, 'nodes'>,
): number {
  const is = (a: string) => (b: string) => canonicalLabel(a) === canonicalLabel(b);
  const node = (kind: string, label: string) => retryAdmitted.nodes.find((n) => nodeIdentity(n) === nodeIdentity({ kind, label }));
  const drafts = (labels: readonly { label: string }[], label: string) => labels.some((x) => is(label)(x.label));
  const levelled = (g: LevelGap): boolean => {
    const o = node('option', g.option);
    const f = node('factor', g.factor);
    return o !== undefined && f !== undefined && o.interventions?.[f.id] !== undefined;
  };
  const hasBaseline = (factor: string): boolean => {
    const v = node('factor', factor)?.observed_state?.value;
    return typeof v === 'number' && Number.isFinite(v);
  };
  const levels = first.level_gaps.filter((g) =>
    !retry.level_gaps.some((r) => is(g.option)(r.option) && is(g.factor)(r.factor))
    && drafts(retryRaw.options, g.option) && drafts(retryRaw.factors, g.factor) && !levelled(g));
  const baselines = first.baseline_gaps.filter((g) =>
    !retry.baseline_gaps.some((r) => is(g.factor)(r.factor)) && drafts(retryRaw.factors, g.factor) && !hasBaseline(g.factor));
  return levels.length + baselines.length;
}

/**
 * ⛔ A RETRY NEVER TAKES AWAY THE STATUS QUO THE FIRST DRAFT HELD (adversarial verify of e7052de7, blocking).
 * The declaration decides what admission holds (`wireInertStatusQuo`). Two declared options means neither is held. A
 * declaration moved to an option that acts falls back to the idioms, which do not read "Continue Current Staffing".
 * Either way the held option registers with no edges, and readiness adds OPTION_NO_FACTOR_EDGES and
 * OPTION_NEEDS_MAPPING. Un-declared, an idiom label ("Keep current pricing") is still held, but it loses the
 * `is_baseline` stamp that run admission reads to keep it as a comparator. No retry is asked about the status quo.
 * So every option the first REGISTERED model holds is still held by the retry's, and a stamped one is still stamped.
 * Where the first draft held none, a retry may declare one, which is what `BUILD_INSTRUCTIONS` asks for.
 */
function keepsTheHeldStatusQuo(first: Pick<AdmittedModel, 'nodes' | 'loss'>, retry: Pick<AdmittedModel, 'nodes' | 'loss'>): boolean {
  const held = (m: Pick<AdmittedModel, 'nodes' | 'loss'>) => {
    const ids = new Set(m.loss.map((e) => /^nodes\[(.+)\]\.status_quo_held$/.exec(String(e.field_path))?.[1]).filter((id) => id !== undefined));
    return m.nodes.filter((n) => n.kind === 'option' && ids.has(n.id));
  };
  const now = held(retry);
  return held(first).every((h) => now.some((r) => nodeIdentity(r) === nodeIdentity(h) && (h.is_baseline !== true || r.is_baseline === true)));
}

/**
 * ⛔ THE LIMIT'S OWN FIGURE IS NEVER THE USER'S LEVEL (verifier FIX_FIRST (1) on f773a217, HIGH).
 * A limit gap asks the retry for today's level of the quantity the user limits. A retry that answers with the LIMIT's
 * figure — "under 4%" returned as churn `explicit`, `baseline_known:true`, 4 — passed every author check downstream:
 * admission stamps a known `explicit` baseline `brief_extraction`, and `withdrawUnstatedBaselineStamps` finds "4%" in the
 * brief (as the limit), so the user's limit registered as their stated level today, and nobody was asked. So, for a
 * quantity a first-draft limit gap asked about, a retry baseline the retry calls the user's (`explicit`, known) that
 * equals a figure of a limit on that quantity is taken as Olumi's estimate (`baseline_known:false` → `cee_inference`,
 * and the user is asked for theirs). A level the brief states apart from the limit ("churn is 3% today, keep it under
 * 4%") is a different figure and is untouched: its authorship is judged by the same checks as before. Every miss
 * under-claims: a brief whose today-level equals its own limit ("4% today, keep it under 4%") reads as Olumi's, and asks.
 */
function neverTheLimitAsTodaysLevel(retryRaw: CandidateModel, firstRaw: CandidateModel, gaps: readonly BaselineGap[]): CandidateModel {
  const asked = new Set(gaps.filter((g) => g.because === 'limit').map((g) => canonicalLabel(g.factor)));
  if (asked.size === 0) return retryRaw;
  const limitFigures = (label: string): { value: number; unit?: string | null }[] => [...(firstRaw.constraints ?? []), ...(retryRaw.constraints ?? [])]
    .filter((c) => canonicalLabel(c.metric) === label && typeof c.value === 'number' && Number.isFinite(c.value))
    .map((c) => ({ value: c.value, unit: c.unit }));
  const eq = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  // The limit's figure, or the same PERCENT in the other spelling (DL CHANGES_REQUIRED on 0ebcad51, P06/P20/P21):
  //  · a limit spelt in percent ("under 4%") given back as the share 0.04 — admission's own figureTheUserWrote reads "4%"
  //    as 0.04 on a share (stated-by-user.ts), so that spelling would register the limit as the user's level;
  //  · a limit spelt as a share (|value| < 1: "under 0.04") given back as the percent 4.
  // ÷100 only for a percent unit: "£10,000" is never "£100 today" (P21 — a stated £100 stays the user's).
  const pct = (u: unknown): boolean => typeof u === 'string' && /%|percent/i.test(u);
  const sameFigure = (v: number, l: { value: number; unit?: string | null }): boolean =>
    eq(v, l.value) || (pct(l.unit) && eq(v, l.value / 100)) || (Math.abs(l.value) < 1 && eq(v, l.value * 100));
  return {
    ...retryRaw,
    factors: retryRaw.factors.map((f) => {
      const label = canonicalLabel(f.label);
      const v = f.baseline_value;
      const theLimits = asked.has(label) && f.baseline_known === true && f.provenance === 'explicit'
        && typeof v === 'number' && limitFigures(label).some((x) => sameFigure(v, x));
      return theLimits ? { ...f, baseline_known: false } : f;
    }),
  };
}

/**
 * ⛔ A QUANTITY THE USER NAMED STAYS THEIRS WHEN OLUMI GIVES IT A LEVEL (served journey C run 2, CEE c35f1c7).
 * A limit gap asks the retry for Olumi's estimate "with baseline_known:false, provenance ai_proposed", and a drafted
 * factor carries ONE provenance. Obeyed, the retry re-authors the quantity the user named (their "monthly churn",
 * `explicit` in the first draft) as Olumi's: the node leaves the user's stated material and
 * `keepsEveryUserStatedIdentity` refuses the very retry that was asked for, so the limit still reaches the Run with no
 * level. The quantity keeps the first draft's authorship; its LEVEL stays Olumi's (`baseline_known:false` →
 * `cee_inference`, `estimatedObservedState`). Only for a quantity a first-draft limit gap asked about, and never when
 * the retry claims to know today's level (that figure would read as the user's).
 */
function keepLimitedQuantityAuthor(retryRaw: CandidateModel, firstRaw: CandidateModel, gaps: readonly BaselineGap[]): CandidateModel {
  const stated = new Set([...firstRaw.factors, ...(firstRaw.outcomes ?? [])].filter((e) => e.provenance === 'explicit').map((e) => canonicalLabel(e.label)));
  // A product's part (`because: 'identity'`, #2220) is asked in the same words, so it is refused the same way (measured
  // on f773a217: a user-named part levelled as asked → `kept_first`); it keeps the first draft's authorship too.
  const keep = new Set(gaps.filter((g) => g.because === 'limit' || g.because === 'identity').map((g) => canonicalLabel(g.factor)).filter((l) => stated.has(l)));
  if (keep.size === 0) return retryRaw;
  return {
    ...retryRaw,
    factors: retryRaw.factors.map((f) => (keep.has(canonicalLabel(f.label)) && f.baseline_known !== true ? { ...f, provenance: 'explicit' } : f)),
  };
}

/** The retry's wording for each gap, naming the option and factor exactly. */
function sayCoverageGaps(p: { level_gaps: readonly LevelGap[]; baseline_gaps: readonly BaselineGap[] }): string[] {
  return [
    ...p.level_gaps.map((g) => `${g.option} -> ${g.factor}: give the level this option sets in interventions (the user's number if stated, otherwise an ai_proposed estimate in the factor's unit and plausible_max frame); keep it only in changes if no defensible level exists`),
    ...p.baseline_gaps.map((g) => (g.outcome === true
      // An outcome has no level of its own to carry, so a today-level the BRIEF states was dropped with it: the retry may
      // give THAT figure as the user's (verifier FIX_FIRST (2) on f773a217), never the limit's (`neverTheLimitAsTodaysLevel`).
      ? `${g.factor}: declare it in factors, not outcomes (role observable, with its plausible_max), and give it a baseline_value (a provisional estimate with baseline_known:false, provenance ai_proposed \u2014 never the user's) \u2014 the user limits its level, and the limit cannot be checked without today's level. If the brief itself states today's level of ${g.factor} (never the limit's own figure), give that figure instead, with baseline_known:true, provenance explicit`
      : g.because === 'limit'
      ? `${g.factor}: give a baseline_value (a provisional estimate with baseline_known:false, provenance ai_proposed \u2014 never the user's) \u2014 the user limits it, and the limit cannot be checked without today's level`
      : g.because === 'identity'
        ? `${g.factor}: give a baseline_value (a provisional estimate with baseline_known:false, provenance ai_proposed \u2014 never the user's) \u2014 a product in identities multiplies it, and the product cannot be computed without today's level of every part; when the product's own level is stated, give the level that makes the product hold`
        : `${g.factor}: give a baseline_value (a provisional estimate with baseline_known:false) \u2014 an option acts on it`)),
  ];
}

/**
 * ⛔ A REPAIR MAY ADD WHAT AN OPTION DOES, NEVER TAKE IT AWAY (pre-review 5828705574).
 * Coverage is counted in gaps, so a retry that deleted an option's `changes` would
 * "close" them with no level at all and leave the option changing nothing. Every
 * factor an option acted on in the first draft — through `changes`, a level, or a
 * directed option→factor link — must still be acted on by that option in the retry.
 */
function keepsEveryAction(before: CandidateModel, after: CandidateModel): boolean {
  const actions = (model: CandidateModel, option: CandidateModel['options'][number]): Set<string> => {
    const factors = new Set(model.factors.map((f) => f.label));
    return new Set([
      ...(option.changes ?? []),
      ...(option.interventions ?? []).map((i) => i.factor_label),
      ...model.links.filter((l) => l.from === option.label && l.direction !== 'unknown').map((l) => l.to),
    ].filter((f) => factors.has(f)));
  };
  return before.options.every((o) => {
    const kept = after.options.find((x) => x.label === o.label);
    if (kept === undefined) return false;
    const now = actions(after, kept);
    return [...actions(before, o)].every((f) => now.has(f));
  });
}

/**
 * ⛔ A COMPACTION MAY SHED WHAT THE MODEL ADDED, NEVER WHAT A KEPT OPTION DOES (#1891 delta).
 *
 * `keepsEveryAction` was skipped on EVERY size retry, so a retry that shrank the model AND deleted a user-stated
 * option's `changes` was adopted: "Hire Two Developers" registered with no edges and was listed in
 * `options_that_change_nothing` — coverage gaps closed by deletion, which pre-review 5828705574 forbids. A size
 * retry is told to remove only the items it ADDED and to copy every kept item exactly (#1898,
 * `SIZE_RETRY_EDITS_FIRST_DRAFT`), so for every option the retry KEEPS — the user's, and one the model added
 * (pre-review 5828705574's own case was the model-added "Hire Both"):
 *  · every factor it acted on that the retry still has, it still acts on — through `changes`, a level, or a
 *    directed option→factor link (a direction-unknown link is withheld by admission, so it is no action);
 *  · if it acted on anything, it still acts on something: shedding its only factor may not leave it inert.
 * What a compaction MAY do: shed an option the model added, whole (a user's option may not be dropped —
 * `keepsEveryUserStatedIdentity` refuses that), and shed a factor, taking any option's action on it along. The
 * declared status quo is held, not set (#1873 B2), so a retry that empties it is not refused here.
 * Identity is admission's (`canonicalLabel`), so a factor kept under another spelling is not "shed".
 */
function compactionKeepsWhatOptionsDo(before: CandidateModel, after: CandidateModel): boolean {
  const is = (a: string) => (b: string) => canonicalLabel(a) === canonicalLabel(b);
  const actions = (model: CandidateModel, option: CandidateModel['options'][number]): Set<string> => {
    const factors = new Set(model.factors.map((f) => canonicalLabel(f.label)));
    return new Set([
      ...(option.changes ?? []),
      ...(option.interventions ?? []).map((i) => i.factor_label),
      ...model.links.filter((l) => is(option.label)(l.from) && l.direction !== 'unknown').map((l) => l.to),
    ].map(canonicalLabel).filter((f) => factors.has(f)));
  };
  const retryFactors = new Set(after.factors.map((f) => canonicalLabel(f.label)));
  return before.options.every((o) => {
    if (o.is_status_quo === true) return true;
    const kept = after.options.find((x) => is(o.label)(x.label));
    if (kept === undefined) return true;
    const was = actions(before, o);
    const now = actions(after, kept);
    return [...was].every((f) => !retryFactors.has(f) || now.has(f)) && (was.size === 0 || now.size > 0);
  });
}

/**
 * ⛔ A RETRY NEVER DROPS OR CHANGES A NUMBER THE USER STATED (pre-review 5829011280).
 * Gaps are counted as a total, so a retry supplying seven levels while erasing a
 * stated baseline of 40 "improved" and was adopted; `keepsEveryUserStatedIdentity`
 * guards names, not numbers. Every user-stated baseline (`baseline_known`, explicit)
 * and every explicit level must survive — on ANY retry, compaction included.
 *
 * ⛔ READ OFF THE DRAFTS BEFORE PREPARATION (verdict 5829152814, B1). Preparation
 * demotes an explicit level on an unknown baseline to `ai_proposed`, so a guard on
 * prepared candidates never saw it — and a retry rewrote the user's 60 as 52 while
 * the carried disclosure still said "your 60". So the user's levels come from the
 * RAW first draft, and each retry entry for that pair must be either the user's
 * entry exactly or the first draft's PREPARED form of it (an echo of the demoted 60,
 * or of an addition already made a total). A pair preparation could not make a total
 * (`additions_without_total`) has no prepared form and may be absent from the retry.
 *
 * ⛔ EVERY carrier of the pair must match, not SOME (pre-review 5829120255):
 * admission keeps the LAST entry for a factor, so one matching duplicate proves
 * nothing, and the same number re-stamped `ai_proposed` is no longer the user's.
 */
function keepsEveryUserNumber(firstRaw: CandidateModel, firstPrepared: CandidateModel, retryRaw: CandidateModel): boolean {
  // ⛔ An ambiguous retry is never adopted (pre-review 5829692499): admission folds
  // every option (or factor) object of one label into ONE node, applying each
  // object's levels in turn, so a duplicate object can overwrite the user's level
  // wherever this guard looks. Two objects sharing a label mean "which one?".
  // ⛔ Sharing a label is judged by ADMISSION'S identity rule (`canonicalLabel`:
  // case, trim, whitespace), never exact strings (pre-review 5829776660) — and the
  // guard's own lookups below use the same rule.
  const unique = (labels: string[]) => new Set(labels.map(canonicalLabel)).size === labels.length;
  if (!unique(retryRaw.options.map((o) => o.label)) || !unique(retryRaw.factors.map((f) => f.label))) return false;
  const is = (a: string) => (b: string) => canonicalLabel(a) === canonicalLabel(b);
  type Iv = NonNullable<CandidateModel['options'][number]['interventions']>[number];
  const same = (a: Iv, b: Iv) => a.value === b.value && a.unit === b.unit && a.provenance === b.provenance
    && (a as Iv & { value_kind?: string }).value_kind === (b as Iv & { value_kind?: string }).value_kind;
  const baselinesKept = firstRaw.factors
    .filter((f) => f.baseline_known && f.provenance === 'explicit' && typeof f.baseline_value === 'number')
    .every((f) => {
      const kept = retryRaw.factors.filter((g) => is(f.label)(g.label));
      return kept.length > 0 && kept.every((g) => g.baseline_known && g.provenance === 'explicit' && g.baseline_value === f.baseline_value);
    });
  const levelsKept = firstRaw.options.every((o) => {
    const retried = retryRaw.options.find((x) => is(o.label)(x.label));
    // B1' (5845793528): an option the retry shed WHOLE is keepsEveryUserStatedIdentity's call, not a dropped number.
    if (retried === undefined) return true;
    return (o.interventions ?? [])
      .filter((i) => i.provenance === 'explicit')
      .every((i) => {
        const prepared = (firstPrepared.options.find((x) => is(o.label)(x.label))?.interventions ?? []).filter((j) => is(i.factor_label)(j.factor_label));
        const carriers = (retried.interventions ?? []).filter((j) => is(i.factor_label)(j.factor_label));
        if (carriers.length === 0) return prepared.length === 0;
        return carriers.every((c) => same(c, i) || prepared.some((p) => same(c, p)));
      });
  });
  return baselinesKept && levelsKept;
}

/**
 * A repair may replace an invalid direct edge, but must preserve its signed path.
 *
 * ⛔ ON A COMPACTION IT DOES NOT OWN OPTION RETENTION (B1, verdict 5842265540). It ended "every first-draft option is
 * still there", and since #1891 made every coverage gap a repair issue it is required on the COMBINED size+repair
 * retry too — the served c22 shape. So a retry that did what the size instruction asks (shed the model-added
 * "Hire Both") and levelled every kept lever was refused `model_too_large` and nothing registered, where base staging
 * ef99a97 adopted it. On a compaction (`compaction`: the first draft was oversized) an option shed WHOLE is judged by
 * `keepsEveryUserStatedIdentity` (a user's option may not go) and `compactionKeepsWhatOptionsDo` (what every kept
 * option does), so here it is exempt twice over: from the every-option clause, and from the per-risk path check —
 * a shed option has no path, and requiring one would be requiring the option. Every risk's own checks, and every
 * KEPT option's path to every risk, still hold. A within-size repair (`compaction` false) is unchanged.
 *
 * ⛔ AND ON A COMPACTION IT DOES NOT OWN RISK RETENTION EITHER (B1 at the risk position, verifier at 5d985e75). It still
 * refused ANY first-draft risk missing from the retry, while `retryInstruction` asks the retry to "Remove what you
 * ADDED beyond the brief: … risks and outcomes" — so an oversized c22 draft carrying an Olumi risk, whose retry shed
 * that risk and levelled every lever, was refused `model_too_large` and nothing registered, where staging ef99a97
 * adopted it. On a compaction a first-draft risk ABSENT from the retry is skipped: a risk the user stated is kept by
 * `keepsEveryUserStatedIdentity` (brief-stated nodes by identity), and the shed risk is said in
 * `left_out_to_stay_compact`. Every risk the retry KEEPS keeps every check below — its own path and signs to the goal,
 * and every kept option's path and signs to it.
 *
 * ⛔ ONE IDENTITY RULE PER BRANCH, THE SAME AS ITS SIBLING GUARD. A compaction judges "kept" — options, risks, and every
 * node a path walks through — by admission's identity (`canonicalLabel`), as `compactionKeepsWhatOptionsDo` does: two
 * labels admission folds into one node are one item, so an option or risk kept under an admission-equal spelling is
 * neither exempt as "shed" nor refused for a path the walk could not follow (the verifier's P6a: "hire  BOTH" with its
 * risk path intact was refused, where staging adopted it). A within-size repair keeps exact labels, as
 * `keepsEveryAction` does — byte-for-byte the rule before this delta.
 */
export function retainsRiskHypotheses(before: CandidateModel, after: CandidateModel, compaction: boolean): boolean {
  const id = compaction ? canonicalLabel : (label: string): string => label;
  const keeps = (items: ReadonlyArray<{ label: string }>, label: string): boolean => items.some((kept) => id(kept.label) === id(label));
  const paths = (model: CandidateModel, from: string, to: string): Set<number> => {
    const links = [
      ...model.links.filter((l) => l.direction !== 'unknown').map((l) => ({ from: id(l.from), to: id(l.to), sign: l.direction === 'negative' ? -1 : 1 })),
      ...model.options.flatMap((o) => [...(o.changes ?? []), ...(o.interventions ?? []).map((i) => i.factor_label)]
        .map((factor) => ({ from: id(o.label), to: id(factor), sign: 1 }))),
    ];
    const target = id(to);
    const signs = new Set<number>();
    const walk = (at: string, sign: number, seen: Set<string>): void => {
      if (at === target) { signs.add(sign); return; }
      for (const link of links.filter((l) => l.from === at && !seen.has(l.to))) {
        walk(link.to, sign * link.sign, new Set([...seen, link.to]));
      }
    };
    walk(id(from), 1, new Set([id(from)]));
    return signs;
  };
  for (const risk of before.risks) {
    if (!keeps(after.risks, risk.label)) {
      if (compaction) continue;
      return false;
    }
    const downstream = paths(after, risk.label, after.goal.metric);
    if (downstream.size === 0 || [...paths(before, risk.label, before.goal.metric)].some((s) => !downstream.has(s))) return false;
    for (const option of before.options) {
      if (compaction && !keeps(after.options, option.label)) continue;
      const prior = paths(before, option.label, risk.label);
      const repaired = paths(after, option.label, risk.label);
      if ([...prior].some((s) => !repaired.has(s))) return false;
    }
  }
  return compaction || before.options.every((o) => keeps(after.options, o.label));
}

/** The size retry's edit rule (measured: `construction-size-retry-edits-first-draft.test.ts`). */
const SIZE_RETRY_EDITS_FIRST_DRAFT =
  'Return your previous model with only the items you ADDED beyond the brief removed. Copy every item you keep EXACTLY '
  + 'as it is in your previous model: the same label, wording, provenance and relationships. Do not rename, merge, reword or re-add anything.';
/**
 * ⛔ AN OVERSIZED DRAFT WITH A REPAIR ISSUE IS STILL A COMPACTION (#1891 delta). Once #1891 made a coverage gap a
 * repair issue, an oversized draft with one took the repair branch WITHOUT `SIZE_RETRY_EDITS_FIRST_DRAFT`, so #1898's
 * measured identity fix (0/8 → 8/8) no longer covered it. It now gets both, and this sentence reconciles them: the
 * listed repairs are the only edits a kept item may receive.
 */
const REPAIRS_ARE_THE_ONLY_EDITS =
  'The only other change allowed is the repair each listed construction issue asks for, made in place on the item it names.';
/**
 * ⛔ THE COMPACTION'S REPAIR RULE NEVER SAYS "PRESERVE EVERY OPTION" (B1, verdict 5842265540). Beside
 * `retryInstruction` ("Remove what you ADDED … speculative options") and `SIZE_RETRY_EDITS_FIRST_DRAFT`, the combined
 * size+repair retry was also told "Preserve every option" — two orders that cannot both be obeyed. It now says which
 * options may go (only ones Olumi added), matching what adoption enforces: `keepsEveryUserStatedIdentity` (every option
 * the brief states), `compactionKeepsWhatOptionsDo` (what every kept option does), and `retainsRiskHypotheses` (every
 * kept risk hypothesis, and every kept option's path to it). A within-size repair retry keeps its own rule, byte for byte.
 * ⛔ NOR "PRESERVE EVERY RISK HYPOTHESIS" (B1 at the risk position, verifier at 5d985e75): beside "Remove what you ADDED
 * … risks and outcomes" that was the same two orders at the risk position. It says which risks may go (only ones Olumi
 * added), matching `keepsEveryUserStatedIdentity` (every risk the brief states) and `retainsRiskHypotheses` (every risk
 * the retry keeps keeps its direction and its path to the goal).
 */
const COMPACTION_REPAIR_RULE =
  'Repair only the listed construction issues. Keep every option the brief states, and every other option in your previous model unless you ADDED it beyond the brief: an option you added is the only kind that may go. '
  + 'Every option you keep still acts on each factor it acted on that you keep. Keep every risk the brief states; a risk you added may go. '
  + 'Every risk you keep keeps its causal direction and its path to the goal; do not delete an option or a risk the brief states to clear validation.';

/**
 * ⭐ X5 (DL design `tracks/c6-draft/DESIGN.md` Q3): WHY the one construction retry ran, and what became of it — so
 * AIQ/MG can fix the class that costs the ~20 s (brief C retried on 4 of 9 draws) before any prompt changes.
 * Diagnostic only: told to an observer the route puts on `_diagnostic_trace`, never to the model.
 */
export type ConstructionTrace =
  | { readonly retried: false }
  | {
    readonly retried: true;
    /** What the retry was asked about: an oversized draft, and the counts of each issue class handed to it. */
    readonly reasons: { readonly size: boolean; readonly mechanism: number; readonly coverage: number; readonly loop: number; readonly range: number; readonly chain?: number };
    /** `adopted`: the retry's model registered · `kept_first`: an adoption gate refused it · `retry_failed`: the call or its parse threw. */
    readonly outcome: 'adopted' | 'kept_first' | 'retry_failed';
  };

/**
 * G1b's gate (stand-in for MC 21, 6 Oct): whether a Run of this graph would withhold the options' chances because a link on a
 * goal path is only Olumi's guess. The Run's own two readers (`run-analysis.ts`: the placeholder paths, and the target's P5
 * codes), each product read as evaluated, as a Run that evaluates it does. Pure.
 */
export function chancesWithheldByAGuess(drafted: { readonly nodes: readonly unknown[]; readonly edges: readonly unknown[] }): boolean {
  // The Run reads the graph its participation guard hands PLoT (`run-analysis-participation-guard.ts`, the one literal): a
  // node kept out of the calculation, and every link at it, is not there (the £85k draft's kept-out price risk).
  const out = new Set((drafted.nodes as readonly Record<string, unknown>[])
    .filter((n) => n.analysis_participation === 'retained_excluded' && n.kind !== 'goal').map((n) => n.id));
  const nodes = (drafted.nodes as readonly Record<string, unknown>[]).filter((n) => !out.has(n.id));
  const graph = { nodes, edges: (drafted.edges as readonly Record<string, unknown>[]).filter((e) => !out.has(e.from) && !out.has(e.to)) };
  // A held stock still sets the goal's level when an option changes only price, so an option-path walk cannot attest it.
  const goalProducts = nodes.filter((n) => n.kind === 'goal' && n.nonlinear_identity !== null && typeof n.nonlinear_identity === 'object')
    .map((n) => n.nonlinear_identity as Record<string, unknown>).filter((i) => i.operation === 'product');
  if (goalProducts.some((i) => Array.isArray(i.factor_ids) && i.factor_ids.some((id) => {
    const part = nodes.find((n) => n.id === id);
    return part !== undefined && !identityCanCarryExactLinks(nodes, part.nonlinear_identity);
  }))) return true;
  const options = nodes.filter((n) => n.kind === 'option' && typeof n.id === 'string').map((n) => n.id as string);
  const evaluations = nodes.filter((n) => n.nonlinear_identity !== null && typeof n.nonlinear_identity === 'object').map((n) => {
    const i = n.nonlinear_identity as Record<string, unknown>;
    return { node_id: n.id, evaluated: true, operation: i.operation, factor_ids: i.factor_ids,
      ...(i.operation === 'accumulation' ? { horizon_months: i.horizon_months } : {}) };
  });
  if (unsizedLeaderGoalPaths(graph, options, evaluations).length > 0) return true;
  const verdict = targetTestabilityOf(graph, evaluations) as { failures?: readonly { code?: unknown }[] };
  return (verdict.failures ?? []).some((f) => f.code === 'goal_path_unsized' || f.code === 'goal_path_placeholder');
}

/**
 * G1b's second condition: the options' ways to the goal carry a size the USER stated (`magnitude: 'user_stated'`). The
 * ruling's class is a brief that says how its options work, where Olumi's extra mechanism is the one thing in the way.
 * Where no option path carries a figure of the user's, the chances an unsized risk's absence would "unlock" rest on
 * Olumi's own reading alone (R3/AIQ b3d11a92: ‘Customer backlash’ beside MRR = price × subscribers, with no route of the
 * user's), so the drafted risk stays and is handled as before. Pure.
 */
export function goalPathsCarryTheUsersFigures(graph: { readonly nodes: readonly unknown[]; readonly edges: readonly unknown[] }): boolean {
  const nodes = graph.nodes as readonly Record<string, unknown>[];
  const options = nodes.filter((n) => n.kind === 'option' && typeof n.id === 'string').map((n) => n.id as string);
  const { paths } = reachedGoalPaths(graph, options, new Map(options.map((id) => [id, [id]])));
  return paths.some((p) => p.links.some((l) => {
    const prov = l.provenance;
    return prov !== null && typeof prov === 'object' && (prov as Record<string, unknown>).magnitude === 'user_stated';
  }));
}

export async function buildModelFromBrief(
  scenarioId: string,
  brief: string,
  dispatch: InternalDispatch,
  callStructured: CallStructuredModel,
  observeConstruction?: (t: ConstructionTrace) => void,
  deadlineAt?: number,
  // The plain provider (never the recorder-wrapped drafter). Omitted → no widening: today's path, byte for byte.
  wideningCallStructured?: CallStructuredModel,
  /** Test-only observer of the candidate and shared admission path at the widening boundary. */
  observeAdmissionForTests?: (snapshot: { candidate: CandidateModel; admitted: AdmittedModel; admit: (model: CandidateModel) => AdmittedModel; admitBase: (model: CandidateModel) => AdmittedModel }) => void,
): Promise<ToolResult> {
  const budget = budgetFor('gpt-5.6-terra', 'whole');
  const construction: ConstructionAdmission = { event_by_date_prompted: briefAttestsEventByDate(brief) };
  const buildInstructions = buildInstructionsForBrief(brief, construction);
  let candidate: CandidateModel;
  // ⛔ A CUT-OFF ANSWER IS SAID AS ONE, NEVER AS THE PARSE ERROR IT CAUSES (served 770a477: 2/14 first briefs stopped
  // at output_tokens 6000 exactly and the refusal carried a SyntaxError). Same user words (`construction_failed`).
  let cutOff: string | undefined;
  try {
    const out = await callStructured({
      model: budget.model,
      instructions: buildInstructions,
      input: firstConstructInput(brief),
      max_output_tokens: budget.max_output_tokens,
      reasoning_effort: budget.reasoning_effort,
      schema: strictForTheDrafter(buildCandidateSchema(), { providerBoundary: false }),
    });
    if (out.status === 'incomplete') cutOff = out.incomplete_reason ?? 'unspecified';
    if (out.text.length === 0) {
      // Measured failure mode: at too small a budget, reasoning consumes the
      // whole allowance and no structured answer is emitted at all. A call that ended with NO answer (the route's own
      // `construction_timeout`, or a cut-off before any text) carries the same typed label as a cut-off answer.
      return {
        ok: false, mutated: false, refusal: 'no_structured_output',
        ...(cutOff !== undefined ? { incomplete_reason: cutOff, detail: `incomplete: ${cutOff}` } : {}),
      };
    }
    // A4u: a drafted count × constant money-per-one product is read as the per-one link it is (`per-one-product.ts`).
    candidate = perOneLinksForConstantProducts(JSON.parse(out.text) as CandidateModel);
    if (!construction.event_by_date_prompted && candidate.goal.kind === 'event_by_date' && isQuantityGoalCandidate(candidate.goal)) {
      candidate = { ...candidate, goal: { ...candidate.goal, kind: null } };
    }
    if (!construction.event_by_date_prompted && candidate.goal.kind === 'event_by_date' && !briefAttestsEventByDate(brief, candidate.goal)
      && candidate.factors.length === 0 && candidate.risks.length === 0 && candidate.outcomes.length === 0 && candidate.links.length === 0) {
      return { ok: false, mutated: false, refusal: 'construction_needs_redraft',
        detail: 'That draft has no usable model for this brief. Ask me to draft it again with the factors and links that explain the outcome.' };
    }
  } catch (err) {
    if (cutOff !== undefined) {
      return { ok: false, mutated: false, refusal: 'construction_failed', incomplete_reason: cutOff, detail: `incomplete: ${cutOff}` };
    }
    return { ok: false, mutated: false, refusal: 'construction_failed', detail: String(err).slice(0, 200) };
  }

  // The drafter's own words, kept for a repair retry: re-preparing a PREPARED
  // candidate finds nothing (review 5822933692, B3), so the retry sees the original.
  // ⛔ AN OPTION AND A QUANTITY NEVER SHARE A NAME (`keepOptionsAndQuantitiesApart`, Canvas #72 5884644099): admission
  // makes same-named entities one node, so the factor an option sets vanished into the option. Renamed before any read.
  const apart = keepOptionsAndQuantitiesApart(candidate);
  // Desk 6b (lease check): every outcome and operand of an identity the mint WILL make (`mintOrFold`'s two product mints,
  // dry-run here, pure) is kept by the mechanism rule, so it never drops a part a product multiplies.
  const mintedLater = (c: CandidateModel) => {
    const ids = withReconcilingProductIdentity(withRateCountProducts(withCountInterventionRanges(c, brief), brief).model, brief).identities ?? [];
    const named = new Set(ids.flatMap((i) => [canonicalLabel(i.outcome), ...i.factors.map(canonicalLabel)]));
    return (label: string): boolean => named.has(canonicalLabel(label));
  };
  candidate = apart.model;
  // ⛔ A figure written only as the goal's TARGET is not also its current level (R3 #72 5885498117; DL 5885526452 (3)).
  const writtenAgain = (value: number, unit: unknown): boolean => timesTheUserWrote(value, unit, brief) >= 2;
  // A link size is the user's only where the brief writes it ABOUT THIS LINK (AIQ #2383 5916497454; P0 PARTNER #2389): the
  // strict scoped reading, the link's two ends against every other quantity.
  const sizeWritten = (value: number, unit: unknown, scope: { target: readonly string[]; others: readonly string[] }): boolean =>
    figureTheUserWroteFor(value, unit, brief, { target: scope.target, others: scope.others, strict: true });
  // A4: the range the brief writes that size as one end of ("deals between £1-2m"), said with it (R3 C1/C2).
  const sizeRangeEnd = (value: number, unit: unknown, scope: { source: string; sourceUnit: unknown; others: readonly string[] }) =>
    writtenRangeFor(value, unit, brief, scope);
  // ⛔ A goal whose stated level is the product of its two stated parts is declared one (R3 #72 5886596030).
  // #2286's mint on the goal's two parts, or (when the drafter put the product on a carrier that is the goal's only parent)
  // the carrier folded into the goal under the SAME proof (`goal-product-carrier.ts`, MG #72 5888469185 class 1).
  const mintOrFold = (c0: CandidateModel): { model: CandidateModel; folded: FoldedCarrier | null; dropped: DroppedGoalProduct[]; residual: GapResidual | null } => {
    // FORK (iii) + AIQ 5892219245: a drafter-declared goal product is the drafter's reading, so it is demoted to Olumi's
    // first and waits for the user's Yes like the mint's, or dropped (and said) when its units don't compose.
    const { model: c1, dropped } = unconfirmGoalProducts(c0, brief);
    // ⛔ Olumi's gap residual beside the user's two parts is taken out first (and said), so the reading and card apply.
    const gap = withoutGapResidual(c1, brief);
    const c = gap?.model ?? c1;
    const residual = gap?.residual ?? null;
    // (A) A rate × count drawn as two added links into an outcome is Olumi's product of the two (Science 6008551439 (A)).
    const products = withRateCountProducts(withCountInterventionRanges(c, brief), brief).model;
    const minted = withReconcilingProductIdentity(products, brief);
    return minted !== products ? { model: minted, folded: null, dropped, residual } : { ...foldProductCarrierIntoGoal(products, brief), dropped, residual };
  };
  /**
   * ⭐ G1b (Science d5 #87 6011168471; DL ruling 6 Oct): a mechanism the brief neither sizes nor says is not drafted onto the
   * goal path, and is challenged; a cost never feeds a revenue goal. Before any read, so the retry is drafted from the model
   * without them.
   * ⛔ ONLY WHERE IT IS WHAT STANDS BETWEEN THE USER AND PER-OPTION CHANCES (stand-in for MC 21, 6 Oct): the cut is applied
   * when, on a trial admission (this pass's own steps, pure), the drafted model's chances are withheld by a guess on a goal
   * path and the cut model's are not, AND the cut model's option paths carry a figure the user stated. Anywhere else the drafted model stands: a short brief's model is Olumi's estimates
   * throughout, so a cut there would only take a risk the user can see (DL #75 5916217417, Paul 30 Sep: "new models have
   * fewer risks"; `construction-keeps-drafted-risks.test.ts`) and change no result.
   */
  // Keep the existing repair route available to an ordinary draft before deciding that a failed event
  // admission must refuse. These intermediate graphs are never registered without the final structural gate.
  const eventFallbackRefusals = new WeakMap<AdmittedModel, string>();
  const admitForBuild = (model: CandidateModel, levelCandidate = model): AdmittedModel => {
    const args = [model, {}, brief, goalLevelTheUserWrote(levelCandidate, brief), writtenAgain,
      (c: CandidateModel) => briefGoalLevel(c, brief), sizeWritten, sizeRangeEnd] as const;
    const result = admitCandidateModel(...args, construction);
    const refusal = eventByDateRefusalOf(result);
    if (refusal === null) {
      // An event construction over the size cap keeps the ordinary model when that reaches the goal: the same rule as a
      // failed slice. The cap is met by Olumi's own option x capacity scaffolding, not the draft (census r3 B3-d2: 36 links).
      if (draftedTeamPartOf(result) === null) return result;
      const size = assessConstructionSize(result);
      if (size.within || size.user_material_exceeds_limit) return result;
      try {
        const ordinary = admitOrdinaryCandidateModel(...args);
        if (admittedReachesGoal(ordinary)) return ordinary;
      } catch {
        // No ordinary model: the size gate below decides, as before.
      }
      return result;
    }
    try {
      const ordinary = admitOrdinaryCandidateModel(...args);
      eventFallbackRefusals.set(ordinary, refusal);
      return ordinary;
    } catch {
      eventFallbackRefusals.set(result, refusal);
      return result;
    }
  };
  const trialGraph = (c: CandidateModel) => {
    const a = admitForBuild(mintOrFold(prepareProvisionalCandidate(c, brief).candidate).model, c);
    return { nodes: a.nodes, edges: a.edges };
  };
  const unsupported = withoutUnsupportedMechanisms(candidate, brief, mintedLater(candidate));
  const cutApplies = unsupported.model !== candidate && (() => {
    const after = trialGraph(unsupported.model);
    return !chancesWithheldByAGuess(after) && goalPathsCarryTheUsersFigures(after) && chancesWithheldByAGuess(trialGraph(candidate));
  })();
  if (cutApplies) candidate = unsupported.model;
  let mechanismsUnmodelled: readonly UnmodelledMechanism[] = cutApplies ? unsupported.mechanisms : [];
  let costsOffRevenue: readonly CostOffRevenue[] = cutApplies ? unsupported.costs : [];
  let keptApart = apart.renamed;
  let notToldApart = apart.ambiguous;
  let linksSetAside = apart.setAside;
  const firstCandidate = candidate;
  let preparation = prepareProvisionalCandidate(candidate, brief);
  candidate = preparation.candidate;
  const firstIdentity = mintOrFold(candidate);
  let admissionCandidate = firstIdentity.model;
  let foldedCarrier = firstIdentity.folded;
  let droppedProducts = firstIdentity.dropped;
  let gapResidual = firstIdentity.residual;
  let admitted = admitForBuild(firstIdentity.model, candidate);
  // Widening must attest levels against the same candidate as the adopted base admission.
  let admissionLevelCandidate = candidate;
  preparation = gapsOnRegisteredOptions(preparation, firstCandidate, admitted);

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
  // An option the FIRST draft had withheld as indistinct, which an adopted retry then dropped: still said.
  let carriedWithheld: readonly WithheldOption[] = [];
  const needsSizeRetry = !size.within && !size.user_material_exceeds_limit;
  // A missing risk mechanism, and an option × factor (or acted-on baseline) with no
  // level (c22, `findCoverageGaps`), ask the retry to repair. An addition with no total
  // DEGRADES instead (see `prepareProvisionalCandidate`): the figure is the user's to give.
  const repairIssues = (p: typeof preparation): string[] => [...p.mechanism_issues, ...sayCoverageGaps(p)];
  // ⚠ Counted WITHOUT the first pass's own degraded additions (#1841 B1): a retry that
  // echoes the prepared candidate carries each such pair in `changes`, and that figure
  // is the user's to give — it is never a new gap, so it can never refuse the retry.
  const gapCount = (p: typeof preparation): number => {
    const userOwned = preparation.additions_without_total;
    return p.level_gaps.filter((g) => !userOwned.some((a) => a.option === g.option && a.factor === g.factor)).length
      + p.baseline_gaps.filter((g) => !userOwned.some((a) => a.reason === 'baseline_unknown' && a.factor === g.factor)).length;
  };
  /**
   * ⛔ A LOOP NEVER COSTS THE USER THEIR MODEL (review of f504b8e0, BLOCKING-1).
   *
   * A loop is asked of the retry only when that changes nothing else about the retry. Pushed
   * in beside the mechanism issues, a loop alone moved an OVERSIZED draft off #1898's
   * size-only retry (the one that edits its own draft: measured 8/8 adoptable, against 0/8
   * regenerated) onto the repair route, then held the retry to a risk-retention gate a size
   * retry is never held to and refused it while any loop was left — so an oversized looped
   * draft that base registered came back `model_too_large`, with no model at all.
   *
   * So: an OVERSIZED draft never has its loops asked, with or without a mechanism issue.
   * Without one it takes the size-only retry exactly as before; with one, the retry is asked
   * the mechanism issues only. Either way its loops are left to admission's backstop
   * (`breakLoops`), which withholds and says one of Olumi's links per loop whichever draft is
   * kept. (Asking the loop beside a mechanism issue was refused on the size route: a retry that
   * broke the loop as asked lost the option's signed path through it, failed the risk-retention
   * gate, and the oversized first draft left the user `model_too_large` with no model —
   * adversarial verify of ecc7d9eb, probe P-B1M.) A retry still carrying a loop is adopted or
   * not on its other merits: every loop issue is one admission can break, so refusing a retry
   * for it could only ever cost the user a model. A loop IS asked only of a draft within the
   * limit, where refusing the retry keeps a first draft that registers.
   *
   * ⛔ WITH #1891's COVERAGE GAPS (merge of staging into #1891): a coverage gap is a repair issue
   * like a mechanism issue, so on the size route the retry is asked the mechanism issues AND the
   * gaps — never the loops — as the compaction below (`COMPACTION_REPAIR_RULE`,
   * `compactionKeepsWhatOptionsDo`, `retainsRiskHypotheses(…, compaction)`). Within the limit a
   * loop asked is a reason for the retry in its own right, so the "coverage is the only reason:
   * cover strictly more" clause at adoption does not apply to it — else a loop-only retry, whose
   * gap count is 0 before and after, could never be adopted.
   */
  const loops = loopIssues(admitted);
  const loopsAsked = needsSizeRetry ? [] : loops;
  // Like loops, a path issue never moves an oversized draft onto the repair route.
  const pathsAsked = needsSizeRetry ? [] : pathIssues(admitted);
  const reachedOptions = (a: Pick<AdmittedModel, 'nodes' | 'edges' | 'goal_constraints'>): number => {
    const refused = optionsWithoutGoalPath(a);
    return a.nodes.filter((n) => n.kind === 'option' && n.is_baseline !== true && !refused.has(n.id)).length;
  };
  // A4: a written money range no link carries (never on the size route, where the retry only sheds).
  const rangesAsked = needsSizeRetry ? [] : uncarriedRangeIssues(brief, admitted, candidate);
  // ⭐ d4 (Science d5 (2), DL 6 Oct): the user's two statements collapsed into one Olumi figure are asked of the retry, drawn
  // as the user wrote them. Adopted ONLY when both bind as the user's and the product is gone; otherwise the first stands.
  const chainsAsked = needsSizeRetry ? [] : collapsedChains(candidate, brief);
  const asked = [...repairIssues(preparation), ...loopsAsked, ...pathsAsked.map((p) => p.issue), ...rangesAsked, ...chainsAsked.map(collapsedChainIssue)];
  let trace: ConstructionTrace = { retried: false };
  if (needsSizeRetry || asked.length > 0) {
    sizeRetried = needsSizeRetry;
    constructionRetried = true;
    const reasons = {
      size: needsSizeRetry,
      mechanism: preparation.mechanism_issues.length,
      coverage: sayCoverageGaps(preparation).length,
      loop: loopsAsked.length,
      range: rangesAsked.length,
      chain: chainsAsked.length,
    };
    trace = { retried: true, reasons, outcome: 'kept_first' };
    try {
      const retry = await callStructured({
        model: budget.model,
        // The delta is APPENDED, so every rule the first pass obeyed still holds —
        // provenance, wiring, plausible_max and clearly labelled estimates.
        // ⛔ A SIZE-ONLY RETRY EDITS ITS OWN FIRST DRAFT. Regenerated from the brief alone it renamed the user's
        // options ("Hire two senior engineers" → "hire 2 senior engineers"), so `keepsEveryUserStatedIdentity`
        // rejected it every time: measured 0/8 adoptable vs 8/8 when the retry is handed its draft to edit
        // (construction-size-retry-edits-first-draft.test.ts). An OVERSIZED draft with construction issues gets
        // that rule too, beside the repair instructions (#1891 delta); a within-size repair retry is unchanged.
        instructions: asked.length === 0 && needsSizeRetry
          ? `${buildInstructions} ${retryInstruction(size)} ${SIZE_RETRY_EDITS_FIRST_DRAFT}`
          : needsSizeRetry
            ? `${buildInstructions} ${retryInstruction(size)} ${SIZE_RETRY_EDITS_FIRST_DRAFT} ${REPAIRS_ARE_THE_ONLY_EDITS} ${COMPACTION_REPAIR_RULE}`
            : `${buildInstructions}  Repair only the listed construction issues. Preserve every option and risk hypothesis, its causal direction and path to the goal; do not delete them to clear validation.`,
        input: asked.length > 0
          ? `${brief}\n\nConstruction issues: ${JSON.stringify(asked)}\nCandidate to repair${needsSizeRetry ? ' (your previous model, to shrink)' : ''}: ${JSON.stringify(firstCandidate)}`
          : `${brief}\n\nYour previous model, to shrink: ${JSON.stringify(firstCandidate)}`,
        max_output_tokens: budget.max_output_tokens,
        reasoning_effort: budget.reasoning_effort,
        schema: strictForTheDrafter(retrySchemaPinningGoal(candidate.goal, candidate.decision_question), { providerBoundary: false }),
      });
      if (retry.text.length > 0) {
        const retryApart = keepOptionsAndQuantitiesApart(perOneLinksForConstantProducts(JSON.parse(retry.text) as CandidateModel));
        const retryHeld = holdAcrossRetry(retryApart.model, { model: firstCandidate, renamed: keptApart, setAside: linksSetAside }, retryApart);
        // The retry is held to the same rule: a mechanism it re-drafts with nothing from the brief is taken out again.
        // (Only where the first draft's cut applied: elsewhere the retry is read exactly as before.)
        const retryUnsupported = cutApplies ? withoutUnsupportedMechanisms(retryHeld.model, brief, mintedLater(retryHeld.model))
          : { model: retryHeld.model, mechanisms: [], costs: [] };
        const retryRaw = keepLimitedQuantityAuthor(
          neverTheLimitAsTodaysLevel(retryUnsupported.model, firstCandidate, preparation.baseline_gaps),
          firstCandidate, preparation.baseline_gaps,
        );
        const retryPrepared = prepareProvisionalCandidate(retryRaw, brief);
        const retryCandidate = retryPrepared.candidate;
        const retryIdentity = mintOrFold(retryCandidate);
        const retryAdmitted = admitForBuild(retryIdentity.model, retryCandidate);
        // ⛔ Leave out only what the FIRST draft never registered: withholding a registered option never closes its gaps in the count (adversarial verify of 843c0960).
        const firstGone = new Set((admitted.options_withheld ?? []).map((w) => canonicalLabel(w.option)));
        const firstRegistered = new Set(firstCandidate.options.map((o) => canonicalLabel(o.label)).filter((l) => !firstGone.has(l)));
        const retryPreparation = gapsOnRegisteredOptions(retryPrepared, retryRaw, {
          options_withheld: (retryAdmitted.options_withheld ?? []).filter((w) => !firstRegistered.has(canonicalLabel(w.option))),
        });
        const retrySize = assessConstructionSize(retryAdmitted);
        // ⛔ COVERAGE ALONE NEVER COSTS A REGISTERED OPTION (adversarial verify of 58a22db8, P2-A/P2-E: COMBINED rows 2h/2i).
        // The count above stays honest, the registered model need not: a retry that levels £64 AND makes Olumi's
        // registered £54 indistinct still covers 1 < 2 (or levels £54's own gap while re-pricing it like the user's £59,
        // 0 < 1), and admission withholds £54. So a retry asked only about gaps must register every option the first did.
        const kept = new Set(retryAdmitted.nodes.map(nodeIdentity));
        const keepsEveryRegisteredOption = admitted.nodes.filter((n) => n.kind === 'option').every((n) => kept.has(nodeIdentity(n)));
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
        // ⛔ Counted on what REGISTERS (adversarial verify of e7052de7): a first-draft gap the retry still drafts stays open until its registered model answers it.
        const retryOpen = gapCount(retryPreparation) + unansweredOnRegistered(preparation, retryPreparation, retryRaw, retryAdmitted);
        if (
          (needsSizeRetry ? retrySize.nodes <= size.nodes && retrySize.edges <= size.edges : retrySize.within || retrySize.user_material_exceeds_limit) &&
          keepsUserMaterial && keepsEveryUserNumber(firstCandidate, candidate, retryRaw) && retryPreparation.mechanism_issues.length === 0 &&
          // ⛔ Coverage is repaired where a level is defensible, so a retry may leave a
          // gap — but it must never cover LESS, and when coverage is the only reason
          // for the retry it must cover strictly MORE (c22) and register every option the first draft did. A
          // loop asked within the limit is a reason of its own (#1956), adopted on its other merits.
          retryOpen <= gapCount(preparation) &&
          (needsSizeRetry || preparation.mechanism_issues.length > 0 || loopsAsked.length > 0
            || (pathsAsked.length > 0 && keepsEveryRegisteredOption && reachedOptions(retryAdmitted) > reachedOptions(admitted))
            || (retryOpen < gapCount(preparation) && keepsEveryRegisteredOption)
            // A4: an asked range is a reason only when the retry CARRIES more of them, registering every option.
            || (rangesAsked.length > 0 && carriedRanges(retryAdmitted).size > carriedRanges(admitted).size && keepsEveryRegisteredOption)
            || (chainsAsked.length > 0 && keepsEveryRegisteredOption)) &&
          // Every asked path retry retains options and never reduces reachability; a path-only reason above needs strict progress.
          (pathsAsked.length === 0 || (keepsEveryRegisteredOption && reachedOptions(retryAdmitted) >= reachedOptions(admitted))) &&
          // A chain asked is drawn as the user's, or nothing is adopted (DL: never the product as well, never half).
          chainsAsked.every((c) => drawsChainAsTheUsers(c, retryCandidate, retryAdmitted, firstCandidate)) &&
          // Within the limit, the status quo the first draft held is still held. On a compaction, refusing would cost the user their model.
          (needsSizeRetry || keepsTheHeldStatusQuo(admitted, retryAdmitted)) &&
          // The collapsed quantity is the one risk the chain issue asks the retry to replace.
          (asked.length === 0 || retainsRiskHypotheses({ ...candidate, risks: candidate.risks.filter((r) => !chainsAsked.some((c) => canonicalLabel(c.through) === canonicalLabel(r.label))) }, retryCandidate, needsSizeRetry)) &&
          // A compaction may shed what the model added, never what a kept option does; a repair may not shed an action.
          (needsSizeRetry ? compactionKeepsWhatOptionsDo(candidate, retryCandidate) : keepsEveryAction(candidate, retryCandidate))
        ) {
          carriedWithheld = carryWithheldOptions(admitted, retryAdmitted);
          leftOut = admitted.nodes
            .filter((n) => !kept.has(nodeIdentity(n)))
            .map((n) => ({ kind: String(n.kind), label: String((n as { description?: unknown }).description ?? n.label) }));
          candidate = retryCandidate;
          admissionCandidate = retryIdentity.model;
          admitted = retryAdmitted;
          admissionLevelCandidate = retryCandidate;
          // #2854 sets admissionCandidate here
          foldedCarrier = retryIdentity.folded;
          droppedProducts = retryIdentity.dropped;
          gapResidual = retryIdentity.residual;
          keptApart = retryHeld.renamed;
          notToldApart = retryApart.ambiguous;
          linksSetAside = retryHeld.setAside;
          // What the first draft took out stays said; the retry's own are added once.
          mechanismsUnmodelled = [...mechanismsUnmodelled, ...retryUnsupported.mechanisms.filter((m) => !mechanismsUnmodelled.some((x) => canonicalLabel(x.label) === canonicalLabel(m.label)))];
          costsOffRevenue = [...costsOffRevenue, ...retryUnsupported.costs.filter((c) => !costsOffRevenue.some((x) => canonicalLabel(x.cost) === canonicalLabel(c.cost)))];
          // ⛔ Never said as not modelled when the adopted model carries it (Codex #2662 r1 P2-4: a retry may draw it again as
          // the brief's), nor a cost as off the revenue when the adopted model still links it in.
          const adoptedLabels = new Set([...retryCandidate.factors, ...retryCandidate.risks, ...retryCandidate.outcomes].map((q) => canonicalLabel(q.label)));
          mechanismsUnmodelled = mechanismsUnmodelled.filter((m) => !adoptedLabels.has(canonicalLabel(m.label)));
          costsOffRevenue = costsAgainst(costsOffRevenue, retryCandidate);
          size = retrySize;
          // ⛔ An adopted retry must not erase what the first pass had to disclose
          // (review 5822933692, B3): a retry that echoes the prepared candidate
          // re-prepares to nothing, and the user's 7 would read as Olumi's again.
          preparation = carryFindingsAcrossRetry(preparation, retryPreparation);
          trace = { retried: true, reasons, outcome: 'adopted' };
        }
      }
    } catch {
      // A failed retry costs the retry, never the turn: the refusal below reports
      // the FIRST model's real counts rather than inventing a reason.
      trace = { retried: true, reasons, outcome: 'retry_failed' };
    }
  }
  // Separate from projection losses: a missing path must not change existing disclosure counts or readers.
  const constructionGaps: ConstructionGaps = {
    path_missing: pathIssues(admitted).map(({ option_id, option, dead_end_ids, dead_ends }) => ({ option_id, option, dead_end_ids, dead_ends })),
  };
  try { observeConstruction?.(trace); } catch { /* an observer never costs the build */ }
  // Read before the later steps replace `admitted`; judged on the graph that would be registered (below).
  const eventFallbackRefusal = eventFallbackRefusals.get(admitted);

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
  /**
   * ⭐ THE GOAL'S STATED TARGET SOURCE, DIRECTION AND DEADLINE ARE HELD ON THE GOAL NODE, WHEN THE BRIEF STATES THEM
   * (G1; `holdStatedGoalAttributes`). A factor named in the brief is not a baseline the brief states (DL #70
   * 5851742282): admission now verifies its level with `verifiedFactorLevel`; no second text reader changes that verdict. What the node now holds is no longer a loss, so its ledger line —
   * "GraphV3 has nowhere to put it" / "a consumer cannot tell a floor from a ceiling" — would be false, and goes.
   * What is NOT held keeps its line, exactly as before.
   */
  // ⭐ MG's HORIZON ATTESTATION (`attestHorizon`, PJ-A2 rows 25–27) decides the deadline G1 holds, and its verdict is
  // `statedGoal.horizon` whatever it is. ⚠ HAND-OFF: an `unresolved` deadline's own words ("by Q3") have no stored field
  // yet; they stay on this typed result until the joint work frame (Codex rows 2–3, 27) gives them one.
  // ⛔ FAIL CLOSED AT REGISTRATION (PR Review CHANGES_REQUIRED on #2281 @ b3f0c2ab): a name the rename could not separate
  // would register as ONE node and silently lose the factor or risk that shared it, so nothing is saved; the refusal says
  // which name and why (`REFUSAL_WORDS.option_name_ambiguous`, the Agent reads `detail`).
  if (notToldApart.length > 0) {
    return {
      ok: false,
      mutated: false,
      refusal: 'option_name_ambiguous',
      detail: notToldApart.map(notToldApartLine).join(' '),
      ambiguous_names: notToldApart.map((a) => ({ option: a.option, owners: [...a.owners], because: a.because })),
    };
  }
  // Pure finalization includes event occurrence binding and frame fitting, where additions can affect old entities.
  // The un-widened and every proposed widened admission run the same path before any dispatch.
  const finalizeGraph = (admitted: AdmittedModel) => {
    // Said where the user always sees it: the carrier the model folded into their goal, with their own arithmetic.
    if (foldedCarrier !== null) {
      const f = foldedCarrier;
      admitted = {
        ...admitted,
        loss: [...admitted.loss, {
          field_path: `nodes[${slugId(f.carrier)}].folded_into_goal`, before: f.carrier, after: f.goal, reason: foldedCarrierLines(f).join(' '), severity: 'info',
        } as AdmittedModel['loss'][number]],
      };
    }
    // AIQ 5892219245 (3): a goal product whose units don't compose is not a reading at all; the draft's proposal is said.
    // AIQ 5904406904: the gap residual's drop is SAID, never silent.
    if (gapResidual !== null) {
      const g = gapResidual;
      admitted = {
        ...admitted,
        loss: [...admitted.loss, {
          field_path: `nodes[${slugId(g.label)}].gap_residual`, before: { label: g.label, value: g.value }, after: null, reason: gapResidualLine(g), severity: 'warn',
        } as AdmittedModel['loss'][number]],
      };
    }
    if (droppedProducts.length > 0) {
      admitted = {
        ...admitted,
        loss: [...admitted.loss, ...droppedProducts.map((d) => ({
          field_path: `nodes[${slugId(d.goal)}].nonlinear_identity_rejected`,
          before: { outcome: d.goal, operation: 'product', factors: [...d.factors] }, after: null, reason: droppedGoalProductLine(d), severity: 'warn',
        }) as AdmittedModel['loss'][number])],
      };
    }
    if (keptApart.length > 0 || linksSetAside.length > 0) {
      admitted = {
        ...admitted,
        loss: [...admitted.loss, ...keptApart.map((k) => ({
          field_path: `nodes[${slugId(k.to)}].label_kept_apart`, before: k.from, after: k.to, reason: keptApartLine(k), severity: 'info',
        }) as AdmittedModel['loss'][number]), ...linksSetAside.map((a) => ({
          field_path: `edges[${slugId(a.option)}->${slugId(a.to)}].link_set_aside`, before: { from: a.option, to: a.to }, after: null,
          reason: setAsideLinkLine(a), severity: 'warn',
        }) as AdmittedModel['loss'][number])],
      };
    }
    if (mechanismsUnmodelled.length > 0 || costsOffRevenue.length > 0) {
      admitted = {
        ...admitted,
        loss: [...admitted.loss, ...mechanismsUnmodelled.map((m) => ({
          field_path: `nodes[${slugId(m.label)}].mechanism_not_modelled`, before: { label: m.label }, after: null,
          reason: unmodelledMechanismChallenge(m), severity: 'warn',
        }) as AdmittedModel['loss'][number]), ...(costsOffRevenue.length === 0 ? [] : [{
          field_path: `edges[${slugId(costsOffRevenue[0]!.cost)}->${slugId(costsOffRevenue[0]!.goal)}].cost_not_revenue`,
          before: { costs: costsOffRevenue.map((c) => c.cost), to: costsOffRevenue[0]!.goal }, after: null,
          reason: costOffRevenueLine(costsOffRevenue), severity: 'info',
        } as AdmittedModel['loss'][number]])],
      };
    }
    let heldGoal = holdStatedGoalAttributes(admitted.nodes, candidate.goal, brief);
    // event_risk.v1 slice 2c: only the brief supplies occurrence; a cause keeps the risk ordinary.
    const heldEventRisks = holdStatedEventRisks(heldGoal.nodes, admitted.edges, brief);
    if (heldEventRisks.held.length > 0 || heldEventRisks.refused.length > 0) {
      heldGoal = { ...heldGoal, nodes: [...heldEventRisks.nodes] };
      const riskById = new Map(heldEventRisks.nodes.map((n) => [n.id, n]));
      admitted = {
        // Nodes travel on `heldGoal` (the graph's node source below); `admitted.nodes` keeps its own reading for scope.
        ...admitted, edges: [...heldEventRisks.edges],
        loss: [...admitted.loss, ...heldEventRisks.held.map(({ risk_id }) => {
          const risk = riskById.get(risk_id)!;
          return {
            field_path: `nodes[${risk_id}].event_risk`, before: null, after: risk.event_risk!,
            reason: heldEventRiskLine(String(risk.label), risk.event_risk!), severity: 'info',
          } as AdmittedModel['loss'][number];
        }), ...heldEventRisks.refused.map(({ risk_id }) => ({
          field_path: `nodes[${risk_id}].event_risk`, before: null, after: null,
          reason: refusedEventRiskLine(String(riskById.get(risk_id)!.label)), severity: 'info',
        }) as AdmittedModel['loss'][number])],
      };
    }
    if (heldGoal.held.horizon || heldGoal.held.direction) {
      admitted = {
        ...admitted,
        loss: admitted.loss.filter((l) => !(heldGoal.held.horizon && /\.horizon_months$/.test(l.field_path))
          && !(heldGoal.held.direction && /\.goal_operator$/.test(l.field_path))),
      };
    }
    // ⭐ A HELD CEILING's stated current level (MG #72 5870097103): admission withheld every `<=` level before the brief
    // attested the comparator; with `'<='` now held, the run minimises that goal, so the same rule is asked again
    // (`admitGoalLevelBesideHeldCeiling`). Any other goal: untouched, byte for byte.
    const ceilingLevel = admitGoalLevelBesideHeldCeiling(heldGoal.nodes, candidate.goal, admitted.loss,
      (value, unit) => figureTheUserWrote(value, unit, brief) && levelWrittenApartFromTarget(value, unit, candidate.goal.value, brief));
    if (ceilingLevel.loss !== admitted.loss) admitted = { ...admitted, loss: ceilingLevel.loss };
    // ⛔ R3-B 5893233864 / AIQ 5893340150: a target typed as a DECREASE, the drafter's own comparator a ceiling and none of
    // the user's held → Olumi's reading of the sense, typed on the goal (`goal-sense-reading.ts`) and said below.
    const statedGoal = { ...heldGoal, nodes: [...withGoalSenseReading(ceilingLevel.nodes, candidate.goal)] };
    const senseReading = (statedGoal.nodes.find((n) => n.kind === 'goal') as { goal_sense_reading?: GoalSenseReading; label?: unknown } | undefined);
    if (senseReading?.goal_sense_reading !== undefined) {
      admitted = {
        ...admitted,
        loss: [...admitted.loss, {
          field_path: `nodes[${slugId(String(senseReading.label ?? ''))}].goal_sense_reading`, before: null, after: 'minimise',
          reason: senseReading.goal_sense_reading.words, severity: 'info',
        } as AdmittedModel['loss'][number]],
      };
    }
    /**
     * ⭐ T2 PART 2 (PJ-E-A2; Canonical #2231 `NodeV3.goal_deadline_as_stated`, G1 contract): an `unresolved` deadline's
     * own words ("by Q3") are HELD on the goal — verbatim, never converted to a month count (that needs a year and a
     * fiscal calendar: inventing). Construction is the field's only writer. Words over the field's 60 characters are not
     * held (the schema would read them as absence); `attestHorizon`'s spans are far shorter today, so that is a guard.
     */
    const deadlineWords = statedGoal.horizon.status === 'unresolved' ? statedGoal.horizon.wording.trim() : '';
    const deadlineHeld = deadlineWords !== '' && deadlineWords.length <= 60;
    // ⭐ 0.67.0 `unit_reading` (PTL A; AIQ 5914471584): the goal's unit, said with its author — Olumi's reading unless the
    // brief writes the goal's own target in it. A reading, never a figure (`goal-unit-reading.ts`).
    // ONE authority for the goal node (P0 PARTNER CR on #2381): `user_stated` only where the node holds its target as the user's.
    const unitReading = goalUnitReading(candidate.goal, brief, statedGoal.held.target);
    const goalNodes = deadlineHeld || unitReading !== undefined
      ? statedGoal.nodes.map((n) => (n.kind === 'goal'
        ? { ...n, ...(deadlineHeld ? { goal_deadline_as_stated: deadlineWords } : {}),
          ...(unitReading !== undefined && n.unit_reading?.source !== 'user_stated' ? { unit_reading: unitReading } : {}) }
        : n))
      : statedGoal.nodes;

    // ⭐ A USER-STATED SIZE FITS THE FRAMES BY WIDENING ITS TARGET, every natural size held (AIQ 5895140735; DL 5897504696):
    // served MRR run 4 (57997d1) stated £49 per subscriber on a 106,250 MRR frame (β 2.31), so the Run clamped the user's
    // effect and withheld the chance. Refused (and left to the Run's honest clamp withhold) when a level is set on the
    // target, a spread would move, a new link would be cut, or the target is a bounded scale.
    // ⭐ CLAMP AT PERSIST (DL 5924108406): a link no refit could fit is stored at ±1 with its full β marked (`refit-frames.ts`).
    // ⭐ CEE #4 (Science goals §(v)): a stock worked out to the goal's deadline is carried only on the HELD deadline
    // (`goal_horizon_months`, set above where the brief attests it), so it is admitted here, after the hold. Each refusal
    // is said; a model with no accumulation declared is byte-identical.
    const accumulation = admitAccumulationIdentities(goalNodes, admitted.edges, candidate.identities);
    if (accumulation.loss.length > 0) {
      admitted = { ...admitted, loss: [...admitted.loss, ...accumulation.loss.map((l) => l as AdmittedModel['loss'][number])] };
    }
    const accumulated = withAdmittedAccumulations(goalNodes, admitted.edges, accumulation);
    const statedFitGraph = refitFramesForStatedEffects({
      // The brief's baselines withdrawn where unstated, and the goal's stated attributes held (G1): see `statedGoal`.
      // An option Olumi added carries `proposed_by: 'olumi'` (the Run's filter and the analysis hash read it; never the brief).
      nodes: markOlumiOptions(accumulated.nodes, candidate, brief),
      edges: accumulated.edges,
      ...(admitted.goal_constraints.length > 0
        ? { goal_constraints: admitted.goal_constraints }
        : {}),
    } as Record<string, any>).graph as { nodes: typeof goalNodes; edges: typeof admitted.edges; goal_constraints?: typeof admitted.goal_constraints };
    const olumiFit = refitFramesForOlumiEstimates(statedFitGraph);
    const prePersistGraph = olumiFit.graph as typeof statedFitGraph;
    // Retire every obsolete disclosure for fitted endpoint identities at their one source of truth.
    const fittedOlumiFields = new Set(olumiFit.fitted.flatMap((link) => {
      const path = `edges[${link.replace('→', '::')}]`;
      return [`${path}.set_aside_estimate`, `${path}.magnitude_question`];
    }));
    admitted = { ...admitted, loss: admitted.loss.filter((l) => !fittedOlumiFields.has(l.field_path)) };
    const graph = clampForPersist(prePersistGraph);

    const parked = (candidate as { unknowns?: unknown }).unknowns;
    // ⛔ OLUMI'S SIZE SET ASIDE (`admit-candidate.ts` `.set_aside_estimate`) is asked ONCE, by the magnitude contract's own
    // words ("… the model doesn't hold it yet"). The drafter's question quoting the same amount ("The provisional estimate
    // of £75,000 per conversation …", Paul's funding turn 1) reads as a figure in use, so it is not shown beside it.
    const setAside = setAsideEstimatesOf(admitted.loss);
    const openQuestions = withoutSetAsideAmounts(userFacingDrafterQuestions(parked), setAside);
    // ⭐ THE MAGNITUDE CONTRACT (D5–D8): a size Olumi set aside, a user's size that cannot hold, or a placeholder sized to
    // the target's range is ASKED where the user always sees it — ahead of the drafter's own questions, and behind
    // every question placed below. Admission writes each as a `.magnitude_question` ledger entry (`admit-candidate.ts`).
    openQuestions.unshift(...admitted.loss.filter((l) => /\.magnitude_question$/.test(l.field_path)).map((l) => l.reason));
    // ⭐ DL ruling #72 5863840239 (ii), condition 2: today's level of a quantity the user limits, when the model holds none
    // of theirs, is ASKED — typed (`level_asks`) and said here: behind the scope, deadline, withheld-option and C46
    // product questions (C46's required row keeps its reply slot), ahead of the magnitude and drafter's own — on journey C
    // the second question the reply shows. Non-blocking: nothing in readiness reads it (`limited-level-ask.ts`).
    // DL ruling 5865003207 §1: a limit on a quantity the options SET at Olumi's figures is asked too — one per quantity,
    // naming Olumi's figures and, when it is Olumi's, today's level. Same seam, same slot rules.
    const levelAsks = [
      ...limitedLevelAsks({ nodes: statedGoal.nodes, goal_constraints: admitted.goal_constraints }),
      ...optionSetLimitAsks({ nodes: statedGoal.nodes, goal_constraints: admitted.goal_constraints }),
    ];
    openQuestions.unshift(...levelAsks.map((a) => a.question));
    // ⭐ R3-2 (AIQ #72 5867700610): a limited spend tally held as the SUM of its levers is said ONCE, as Olumi's reading,
    // and §3's precondition failing (a lever reaches the goal only through a user-limited cost roll-up) ASKS Olumi's
    // assumption instead of dropping the edge (AIQ 5867283878). Behind the C46 product questions, ahead of the level asks.
    openQuestions.unshift(...(admitted.pure_limit_asks ?? []).map((a) => a.question), ...sumIdentityOpenQuestions(admitted));
    // ⛔ C46: a declared product whose sign this model cannot prove is ASKED where the user always sees it,
    // not only said in `not_represented` (which only the Agent's model reads). After the scope and deadline
    // questions, ahead of the drafter's own; nothing for a stable product or a linear model.
    openQuestions.unshift(...productIdentityOpenQuestions(admitted));
    // AIQ 5898415568 run 0 / R3 5898443502: Olumi's product refused for a part with no level asks for those figures, once.
    openQuestions.unshift(...unlevelledProductQuestions(admitted));
    // AIQ 5888943993 (1)(c): the carrier folded into the goal, and any Olumi addition left out, said where the user sees it.
    if (foldedCarrier !== null) openQuestions.unshift(...foldedCarrierLines(foldedCarrier));
    // ⭐ DL (dental): a link set aside between an option and its renamed namesake is asked where the user always sees it.
    openQuestions.unshift(...linksSetAside.flatMap((a) => setAsideLinkQuestion(a) ?? []));
    // d5's challenge where the user SEES it (DL: both seats; the server appends the first two to the reply).
    openQuestions.unshift(...mechanismsUnmodelled.map(unmodelledMechanismChallenge));
    // G1b honesty: a cost the BRIEF states, taken off the revenue, is said in the user's words, ahead of Olumi's own challenges.
    openQuestions.unshift(...droppedStatedCostLines(costsOffRevenue, brief));
    /**
     * ⛔ AN OPTION WITHHELD AS INDISTINCT IS SAID WHERE THE USER ALWAYS SEES IT (DL #70 5842400604: "never a
     * silent duplicate"). `not_represented` reaches only the Agent's model; `open_questions` is appended to the
     * reply by the server every time. Placed after the deadline and ahead of the drafter's own questions, so the
     * five-question cap cannot hide it. A group of USER options nothing tells apart is asked about here, once.
     */
    const withheldOptions = [...(admitted.options_withheld ?? []), ...carriedWithheld];
    openQuestions.unshift(
      ...withheldOptions.map((w) => w.sentence),
      ...(admitted.indistinct_stated_options ?? []).map((g) => g.question),
    );
    /**
     * A missing or unresolved deadline remains an open question ahead of the five-question cap. A held month count
     * owes no duplicate question here: decision-input-ask.ts supplies the shared present-number horizon qualification
     * to the draft/Run reply and the Run's typed warning.
     */
    const horizon = candidate.goal?.horizon_months;
    // ⛔ T2 (journey E, PJ-E-A2; served pj-20260928T074951Z E01): a deadline the brief writes but no month count can hold
    // ("by Q3" needs a year and a fiscal calendar) is asked in the brief's OWN words, in this same first slot. Before, the
    // wording `attestHorizon` kept was read by nothing: the served reply never said "Q3" (the drafter's own question sat
    // 8th of 10, two shown), and a month count the drafter typed for it was asked as the deadline. Olumi's count is never
    // asked as the user's. The wording is still held on no field: that is Canonical's shape (PJ-A2 row 27, second half).
    if (draftedTeamPartOf({ nodes: admitted.nodes, edges: admitted.edges }) !== null) {
      openQuestions.unshift(chanceGoalDeadlineAsk(candidate.goal.deliverable!));
    } else if (statedGoal.horizon.status === 'unresolved') {
      const goalName = typeof candidate.goal?.metric === 'string' && candidate.goal.metric.trim() !== '' ? ` for "${candidate.goal.metric}"` : '';
      openQuestions.unshift(deadlineHeld
        ? `Which date does "${deadlineWords}" mean? It is the deadline your brief sets${goalName}; the model keeps your words but no date, so no result answers whether it is met by then.`
        : `Which date does "${statedGoal.horizon.wording}" mean? It is the deadline your brief sets${goalName}, but the model does not hold it yet, so no result answers whether it is met by then.`);
    } else if (typeof horizon === 'number' && Number.isFinite(horizon) && horizon > 0 && !statedGoal.held.horizon) {
      openQuestions.unshift(`Does "${candidate.goal.metric}" get there within ${horizon} months? The model holds no deadline yet, so no result answers that.`);
    }
    // ⛔ C46: the goal's unstated scope (`admit-model.ts` records the question as the reason of
    // its `goal_scope` entry). First, because the ruling requires it clarified or named before
    // analysis; asked here, in the channel the Agent already reads, never only in prose. Ahead of the
    // deadline question (merge of staging #1939): both lead the parked questions, so neither is cut by
    // the five-question cap.
    // ⭐ (b) (Science d5 #87 6006584860 / 6006646752; DL 6 Oct): the drafter's untyped scope question reads a goal that names
    // no part (`metricReadsAsPlainTotal`) as the TOTAL. It is never a withhold (`scopeIssueBlocks`), and it is said once, as the
    // disclosure, only where material and not already stated by the user (`untypedScopeComponents`). Nothing material →
    // nothing asked, assumed or pended. Any other metric may name a part ("Starter MRR", "Non-Pro MRR"): it keeps C46's
    // assumption and question (ask (a)), still non-blocking.
    const scopeLoss = admitted.loss.find((l) => /\.goal_scope$/.test(l.field_path));
    const scopeGoal = admitted.nodes.find((n) => n.kind === 'goal');
    const plainTotal = metricReadsAsPlainTotal(candidate.goal.metric);
    // Science d5 #87 6007341975 (2): the disclosure keys on MATERIALITY, never on the drafter's declaration — a drafter's
    // "no part-or-whole reading" (goal.scope null) is Olumi making the reading silently. Only a scope the BRIEF states is not.
    const readsAsTotal = plainTotal && (scopeLoss !== undefined || !candidate.goal.scope);
    const scopeAsked = scopeLoss !== undefined && !plainTotal
      ? { question: scopeLoss.reason, assumption: typeof scopeLoss.after === 'string' ? scopeLoss.after : undefined }
      : null;
    const identityScopeMaterial = goalIdentityScopeIsMaterial(readsAsTotal, candidate, admitted);
    let retainedScopeQuestion: string | null = null;
    if (readsAsTotal && candidate.goal.scope) {
      // The drafter's own restatement of the part-or-whole question (Codex buddy r1 P2: it carried the C46 "… for the Pro plan
      // only. Which did you mean?" through `unknowns`): keep it when the goal identity makes scope material;
      // otherwise the goal now reads as the total, so it is not asked beside the reading.
      // A restatement names the goal AND both readings AND asks which: an evidence question about the two populations ("can
      // the Pro plan only estimate apply to all plans together?") names no goal and stays (Codex buddy r2 P2).
      const [modelled, alternative, metric] = [candidate.goal.scope.modelled, candidate.goal.scope.alternative, candidate.goal.metric]
        .map((t) => t.trim().toLowerCase());
      for (let i = openQuestions.length - 1; i >= 0; i--) {
        const q = openQuestions[i]!.toLowerCase();
        if (modelled !== '' && alternative !== '' && metric !== '' && q.includes(modelled) && q.includes(alternative) && q.includes(metric)
          && /\b(or|whether|which)\b/.test(q)) {
          if (identityScopeMaterial && retainedScopeQuestion === null) retainedScopeQuestion = openQuestions[i]!;
          else openQuestions.splice(i, 1);
        }
      }
    }
    // DL #2914 r3 CHANGES_REQUIRED: material scope with no drafter restatement falls back to a question
    // naming the modelled part and asking which scope the target uses; it never says "total".
    // Not when the drafter already asks it in other words (its question names the declared modelled scope and the goal,
    // as a question): that only gates the fallback, it never removes a question (R2 B1-A asks "…cover the Pro plan only or all plans?").
    const scopeAlreadyAsked = candidate.goal.scope !== undefined && candidate.goal.scope !== null
      && openQuestions.some((q) => {
        const t = q.toLowerCase(); const [m, g] = [candidate.goal.scope!.modelled, candidate.goal.metric].map((x) => x.trim().toLowerCase());
        return m !== '' && g !== '' && t.includes(m) && t.includes(g) && /\b(or|whether|which)\b/.test(t);
      });
    const materialFallback = identityScopeMaterial && retainedScopeQuestion === null && !scopeAlreadyAsked && candidate.goal.scope
      && candidate.goal.scope.modelled.trim() !== '' && candidate.goal.scope.alternative.trim() !== ''
      ? materialScopeQuestion(candidate.goal.metric, candidate.goal.scope.modelled.trim(), candidate.goal.scope.alternative.trim()) : null;
    const untypedScopeWords = retainedScopeQuestion ?? materialFallback ?? (scopeAsked !== null ? scopeAsked.question
      : readsAsTotal && !identityScopeMaterial && scopeGoal !== undefined
        ? (() => {
          const components = untypedScopeComponents({ nodes: admitted.nodes, edges: admitted.edges }, scopeGoal.id);
          return components.length > 0 ? untypedScopeDisclosure(candidate.goal.metric, components) : null;
        })()
        : null);
    if (untypedScopeWords !== null && !openQuestions.includes(untypedScopeWords)) openQuestions.unshift(untypedScopeWords);

    // ⭐ A4f (AIQ 5923220559): the user's size was asked about as "would be cut short" when it was sized, BEFORE the refit
    // above. Where the refit made it fit, that question is no longer true, so it is not asked. Only the user's own sizes:
    // Remaining Olumi set-aside estimates quote the same words, but their links still hold placeholders.
    const fitted = new Set(graph.edges
      // A clamped link (its full β marked) is still cut in the analysis: its question stays (CODEX 5924186955).
      .filter((e) => e.provenance?.magnitude === 'user_stated' && typeof e.strength?.mean === 'number' && Math.abs(e.strength.mean) <= 1
        && !('clamped_from' in (e.provenance ?? {})))
      .map((e) => `edges[${e.from}::${e.to}].magnitude_question`));
    const noLongerCut = new Set(admitted.loss.filter((l) => fitted.has(l.field_path) && l.reason.includes(NOT_REPRESENTABLE)).map((l) => l.reason));
    for (let i = openQuestions.length - 1; i >= 0; i--) if (noLongerCut.has(openQuestions[i]!)) openQuestions.splice(i, 1);

    return { admitted, prePersistGraph, graph, goalNodes, openQuestions, levelAsks, setAside,
      withheldOptions, scopeAsked, untypedScopeWords };
  };
  const finals = new Map<AdmittedModel, ReturnType<typeof finalizeGraph>>();
  const finalFor = (admission: AdmittedModel) => {
    let final = finals.get(admission);
    if (final === undefined) { final = finalizeGraph(admission); finals.set(admission, final); }
    return final;
  };
  finalFor(admitted);
  const admitWidened = (model: CandidateModel): AdmittedModel => admitForBuild(model, admissionLevelCandidate);
  observeAdmissionForTests?.({ candidate: admissionCandidate, admitted, admit: admitWidened, admitBase: admitForBuild });
  // The construction recorder sees only drafting/retry responses; widening uses the plain provider.
  const widened = wideningCallStructured === undefined ? null : await widenDraft({ admitted, candidate: admissionCandidate, brief, callStructured: wideningCallStructured, deadlineAt,
    finalGraph: (admission) => finalFor(admission).prePersistGraph,
    admit: admitWidened });
  if (widened !== null) {
    admitted = widened.admitted;
    size = assessConstructionSize(admitted);
  }
  const final = finalFor(admitted);
  admitted = final.admitted;
  const { graph, goalNodes, openQuestions, levelAsks, setAside, withheldOptions, scopeAsked, untypedScopeWords } = final;

  // Never persist a graph the product cannot then read.
  const parsed = GraphV3.safeParse(graph);
  if (!parsed.success) {
    return {
      ok: false, mutated: false, refusal: 'admitted_graph_invalid',
      issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')),
    };
  }
  // A flagged draft whose event slice failed keeps its ordinary graph unless that graph, as registered, cannot reach
  // the goal (B3 086e4624). Reachability only: base registers kept user loops (construction-acyclic-verified-arms P-M10).
  if (eventFallbackRefusal !== undefined && draftedTeamPartOf(parsed.data) === null && !admittedReachesGoal(parsed.data as never)) {
    return { ok: false, mutated: false, refusal: 'event_goal_unadmitted', detail: eventFallbackRefusal };
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
  // `fresh`: this read exists to see OTHER writers, so the turn's read cache must not answer it (turn-read-cache.ts).
  const stillEmpty = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph`, { ...FRESH_READ });
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
  // A link left out of a loop has its own sentence (`loop_withheld`, below), and its direction WAS stated.
  const directionless = admitted.withheld.filter((w) => w.reason !== 'loop_closing_link');

  return {
    ok: true,
    mutated: true,
    ...(widened !== null ? { widened: { ...widened.counts } } : {}),
    ...(modelVersion === undefined ? {} : { model_version: modelVersion }),
    ...(replayed ? { replayed: true } : {}),
    // The untyped question's ONE channel for a later answer (the existing reconcile path); it never gates (`scopeIssueBlocks`).
    ...(untypedScopeWords !== null && goalNodes.find(n => n.kind === 'goal') ? {
      pending_action: reconciliationPending(scenarioId, { kind: 'reconcile_goal_scope',
        goal_id: goalNodes.find(n => n.kind === 'goal')!.id, goal_label: candidate.goal.metric,
        ...(candidate.goal.scope ? { declared_scope: candidate.goal.scope } : {}), expected: 'scope',
        question: untypedScopeWords, operands: [], derivations: [] }),
    } : {}),
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
    ...(constructionGaps.path_missing.length > 0 ? { construction_gaps: constructionGaps } : {}),
    ...(admitted.treated_as_context !== undefined ? { treated_as_context: admitted.treated_as_context } : {}),
    // Options that say what they DO, versus options that are inert. An inert
    // option can never be compared, whatever values arrive later.
    options_that_change_nothing: admitted.withheld
      .filter((w) => w.reason === 'option_changes_nothing')
      .map((w) => w.from),
    // Olumi's options withheld as identical by construction — the reason, beside the sentence in `open_questions`.
    ...(withheldOptions.length > 0
      ? { options_withheld: withheldOptions.map((w) => ({ option: w.option, like: w.like, reason: w.reason })) }
      : {}),
    // Carried WITH the graph (GraphV3 declares `goal_constraints`), verified
    // surviving registration on deployed staging.
    goal_constraints_carried: admitted.goal_constraints.length,
    ...(leftOut.length > 0 ? { left_out_to_stay_compact: leftOut } : {}),
    // ⭐ EVERY build, not only a retry: the compact instruction parks Olumi's own
    // strategic additions in `unknowns`, and on the common path (a first pass already
    // within budget — 3 of 3 live benchmark runs) nothing else ever showed them.
    ...(openQuestions.length > 0 ? { open_questions: openQuestions } : {}),
    ...(draftedTeamPartOf({ nodes: admitted.nodes, edges: admitted.edges }) !== null ? { displayed_next_question: chanceGoalDeadlineAsk(candidate.goal.deliverable!) } : {}),
    // Condition 2's typed twin of its sentence in `open_questions`, above.
    ...(levelAsks.length > 0 ? { level_asks: levelAsks } : {}),
    // B1/B2 (review 5822711266), machine-readable beside the sentences below.
    ...(preparation.additions_without_total.length > 0 ? { additions_without_total: preparation.additions_without_total } : {}),
    ...(preparation.provenance_demoted.length > 0 ? { provenance_demoted: preparation.provenance_demoted } : {}),
    // ⛔ C46, machine-readable beside its sentence below. `sign_not_provable` means no leader or
    // decision-grade claim may rest on this model (#70 5841314428). This is construction's report; the
    // leader permission is stamped by `run_analysis` from the node's persisted declaration
    // (`nonlinearIdentityLeaderWithhold`), re-judged on the graph each Run analyses.
    ...(admitted.nonlinear_identities !== undefined ? { nonlinear_identities: admitted.nonlinear_identities } : {}),
    // A user-limited cost roll-up whose Olumi-signed edge into the goal was not drawn (`findPureLimits`), beside its
    // `pure_limit` line below; where a lever reaches the goal only through it, the kept edge asked (`open_questions`).
    ...(admitted.pure_limits !== undefined ? { pure_limits: admitted.pure_limits } : {}),
    ...(admitted.pure_limit_asks !== undefined ? { pure_limit_asks: admitted.pure_limit_asks } : {}),
    // R3-2: limited spend tallies held as the sum of their levers, beside the sentence in `open_questions`.
    ...(admitted.sum_identities !== undefined ? { sum_identities: admitted.sum_identities } : {}),
    // ⛔ Olumi's sizes NO edge carries, typed (AIQ 5914222384): never among the model's inputs, and said as set aside.
    ...(setAside.length > 0 ? { set_aside_estimates: setAside.map(({ from, to, estimate }) => ({ from, to, estimate, status: 'set_aside_not_in_model' as const })) } : {}),
    // A typed subset of the loss ledger, carried to the deterministic reply composer.
    // Other not_represented entries retain their existing narration path.
    ...(admitted.loss.some((l) => /\.event_risk$/.test(l.field_path)) ? {
      event_risk_disclosures: admitted.loss.filter((l) => /\.event_risk$/.test(l.field_path)).map((l) => l.reason),
    } : {}),
    not_represented: [
      // ⛔ C46: the goal's unstated scope, as Olumi's assumption (the `goal_scope` entry's `after`), FIRST.
      // Said here and never written on the goal node: `get_canonical_state` shows a node's description as
      // its `full_label`, so the assumption would read back as the user's metric (re-verification of
      // d2362e9d, item e). Its question is asked first in `open_questions`, above.
      // (b): a plain total's disclosure is said ONCE, in `open_questions` above, never repeated here. Only the part-named
      // metric (ask (a)) still says the modelled part as Olumi's assumption.
      ...(scopeAsked?.assumption !== undefined ? [scopeAsked.assumption] : []),
      // A goal read as a two-part product: an extra direct parent re-pointed or taken out (`product-goal-extra-parent.ts`).
      ...admitted.loss.filter((l) => /\.rate_operand\./.test(l.field_path)).map((l) => l.reason),
      ...admitted.loss.filter((l) => /\.extra_parent\./.test(l.field_path)).map((l) => l.reason),
      ...unattachedLimitLines(candidate, admitted.loss),
      ...preparation.additions_without_total.map(sayAdditionWithoutTotal),
      ...preparation.provenance_demoted.map((d) =>
        `I've treated your ${d.value} for "${d.factor}" in "${d.option}" as a working figure because the current ` +
        `level of "${d.factor}" is unknown \u2014 confirm it and I'll mark it as yours.`),
      ...preparation.levels_over_own_levers.map(sayOptionLevelOverOwnLevers),
      directionless.length > 0
        ? `${directionless.length} relationship(s) were left out because nobody has stated which way they run.`
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
        // `level_restated` / `frame_widened` / `signed_level_withheld`: how a factor's option levels
        // were kept in ONE value space (#69 5835137365) — each changes what a number means, so it is said.
        // `observed_state.baseline`: a goal's current level that could not be carried
        // (`admit-model.ts`) — the user is told why, and what would let it count.
        // `nonlinear_identity[_rejected]` (C46): a declared product the analysis can only add
        // up — the missing capability in plain English — or a declaration that did not hold.
        // `loop_withheld` / `loop_kept`: a loop the model could not hold (`admit-model.ts`,
        // `breakLoops`) — which link was left out, or that the user's own loop was kept.
        // `stated_range_end`: the user's size is one END of a range they wrote, said with the range as a floor (A4, R3 C1/C2).
        // `magnitude_unconvertible`: a stated size that could not be read on the two ends' frames, so the standard
        // placeholder stands in (magnitude contract, D2/D6) — never dropped unseen.
        // `set_aside_estimate`: Olumi's own stated size that no edge carries, said as "Olumi's guess, set aside: NOT in the model".
        // `pure_limit`: a user-limited cost roll-up's Olumi-signed edge into the goal that was not drawn (`findPureLimits`).
        // `one_route`: a factor → risk link left out because the risk only re-drew the factor's own direct link
        // (`oneRoutePerEffect`, PR Review CR on #2276): the risk stays, and why its link went is said.
        // `created_part_zero`: a stated product's part an option creates, held at 0 today as Olumi's reading (Science
        // 6007736377 (i), `admit-model.ts`): said once here, so the user can correct it.
        // `pass_through_sign`: the user's sentence not recorded through Olumi's mediator, because the drawn path runs the
        // other way from it (Desk 6b #2644 Q3, `stated-size-binding.ts`): said, with what to check.
        // `stated_sign`: the user's sentence not recorded on a link drawn the other way from it (DL #2644 pilot): said.
        // `link_set_aside`: a link an option could hold, set aside beside its renamed namesake and asked (DL, dental).
        .filter((l) => /\.(event_risk|event_forecast_not_modelled|added_capacity|horizon_months|stated_range_end|goal_operator|mechanism_missing|status_quo_held|bound_direction|level_restated|frame_widened|signed_level_withheld|nonlinear_identity|nonlinear_identity_rejected|goal_sense_reading|goal_level_reading|loop_withheld|loop_kept|magnitude_unconvertible|set_aside_estimate|pure_limit|one_route|label_kept_apart|folded_into_goal|gap_residual|created_part_zero|pass_through_sign|stated_sign|link_set_aside|mechanism_not_modelled|cost_not_revenue)$|\.observed_state\.baseline$/.test(l.field_path))
        .map((l) => l.reason),
    ].filter((s): s is string => s !== undefined),
  };
}

/**
 * ⛔ A FIELD PATH IS NOT USER COPY (AIC #70 5852012649, DL 5852023249; served on CEE `5668902`, Paul's brief): a drafter
 * item read "The current MRR level was not stated, so goal.baseline_value is intentionally null rather than estimated." —
 * a note, not a question, and the UI now shows every open question verbatim. The DRAFTER's (model-written) items that
 * carry an internal identifier are dropped here; the code-authored questions added after this carry none.
 *
 * The class is the UI's `sanitiseStatusReason` (DGAI `src/utils/sanitiseStatusReason.ts`), mirrored verbatim — node-id
 * prefixes and 3+-segment snake_case — plus the one shape that class does not cover and the served note used: a dotted
 * path with an underscore in it. A syntax test on code tokens, not a reading of meaning ("e.g." never matches).
 */
const UI_NODE_ID_RE = /\b(?:fac|opt|goal|outcome|edge|node|constraint)_[a-z0-9_]+\b/i;
const UI_SNAKE_ID_RE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}\b/;
const carriesFieldPath = (q: string): boolean => UI_NODE_ID_RE.test(q) || UI_SNAKE_ID_RE.test(q)
  || (q.match(/\b[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+\b/g) ?? []).some((t) => t.includes('_'));

interface SetAsideEstimate { readonly from: string; readonly to: string; readonly estimate: string; readonly amount: number | null }

/** Olumi's stated sizes the model does not use, from their ledger entries (`admit-candidate.ts` `magnitudeNotes`). */
function setAsideEstimatesOf(loss: readonly unknown[]): SetAsideEstimate[] {
  return loss.flatMap((l) => {
    const e = l as { field_path?: unknown; before?: { effect_amount?: unknown } | null; after?: { from?: unknown; to?: unknown; estimate?: unknown } | null };
    if (typeof e.field_path !== 'string' || !e.field_path.endsWith('.set_aside_estimate')) return [];
    const a = e.after ?? {};
    if (typeof a.from !== 'string' || typeof a.to !== 'string' || typeof a.estimate !== 'string') return [];
    const amount = typeof e.before?.effect_amount === 'number' && Number.isFinite(e.before.effect_amount) ? e.before.effect_amount : null;
    return [{ from: a.from, to: a.to, estimate: a.estimate, amount }];
  });
}

/** The drafter's questions, less any that writes the amount of a size Olumi set aside (it is asked in the contract's words). */
function withoutSetAsideAmounts(questions: string[], setAside: readonly SetAsideEstimate[]): string[] {
  const amounts = setAside.map((s) => s.amount).filter((a): a is number => a !== null && a !== 0).map(Math.abs);
  if (amounts.length === 0) return questions;
  const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, a, b);
  return questions.filter((q) => !findStatedAmounts(q).some((w) => amounts.some((a) => same(Math.abs(w.magnitude), a))));
}

export function userFacingDrafterQuestions(parked: unknown): string[] {
  return Array.isArray(parked)
    ? parked.filter((q): q is string => typeof q === 'string' && q.trim() !== '' && !carriesFieldPath(q))
    : [];
}
