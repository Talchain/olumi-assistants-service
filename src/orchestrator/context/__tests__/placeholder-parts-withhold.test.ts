/**
 * ⛔ R-c — A LIMIT ON A TARGET THE OPTIONS MOVE ONLY THROUGH PARTS ON UNSIZED LINKS IS WITHHELD, LEVEL AND CHANGE FRAMES
 * ALIKE (AI Quality ruling #72 5881541947; Codex DL sequencing 5881593118: RED-first level + `change_abs` journey-C
 * contrasts, the cloud downtime positive control, and the drop-clause mutant).
 *
 * The discriminating pair, both SERVED graphs:
 *   · journey C (`served-journey-c-nonroot-budget-limit-082121Z.json` C15, the T4 verifier's shape): "Additional
 *     Advertising" sets advertising spend and NOT the total; `advertising spend → total spend` carries no magnitude
 *     (a bare placeholder) → WITHHELD, whether the limit is a level or a `change_abs`;
 *   · cloud (`served-cloud-downtime-estimated-parts-20260929.json`): the options set GCP share and readiness, never
 *     downtime; both links into downtime are `olumi_estimate` with `natural_effect` in weeks (and `defaulted: true`, so
 *     `defaulted` cannot be the discriminator) → NOT withheld: the level limit carries its baseline and a `change_abs`
 *     limit takes the normal fold.
 * Every row binds the target by LABEL → id and the limit by constraint_id.
 *
 * ⭐ PER OPTION since AI Quality #72 5900908629 (lock A PJ-A3): the baseline always carries, and only an option that moves
 * the target through a placeholder has ITS P withheld, with the per-option reason and ask; the row folds over the other
 * options and is withheld for its parts only when none is left. The rows below that pinned the per-limit fold (no
 * baseline, the whole row `unscored`, no ask) are re-pinned to that rule, each saying so. Rows: `placeholder-parts-per-option-a3`.
 *
 * ⛔ B6 SUPERSEDES R-e AND THE "SIZED BY OLUMI → FOLDS NORMALLY" CONTROLS (AIQ #75 5916187873; DL 5915507578 item 1):
 * a limit P resting on a link Olumi sized, on Olumi's (non-definitional) level, or on Olumi's single point is Olumi's
 * guess, not a check, and is withheld per option (`limit-rests-on-olumi-guess.test.ts`). Rows whose AXIS is R-c's
 * placeholder rule keep testing it on the user's-level twin (`usersLevel`) and assert the placeholder reason by name.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  collectLimitLevelOwners,
  deriveConstraintVerdict,
  readRatifiedConstraints,
} from '../constraint-feasibility.js';
import { placeholderMovedOptions, targetMovedOnlyThroughPlaceholderParts, sizedLinkTest } from '../placeholder-parts.js';
import { levelLimitBaselineNodeIds } from '../../../orchestrator-v5/tools/handlers/level-limit-baseline.js';
import { limitChecksForAgent } from '../../../orchestrator-v5/agent-lane/limit-checks.js';

type Json = Record<string, any>;
const fixture = (rel: string): Json => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as Json;
const JOURNEY_C = fixture('../../../orchestrator-v5/__tests__/fixtures/served-journey-c-nonroot-budget-limit-082121Z.json').c15 as Json;
const CLOUD = fixture('../../../orchestrator-v5/__tests__/fixtures/served-cloud-downtime-estimated-parts-20260929.json').graph as Json;

describe('goal-test link sizing uses the canonical unit vocabulary', () => {
  it('accepts GBP/month and £/month as the same user-sized target unit', () => {
    const nodes = [
      { id: 'price', kind: 'factor', unit: 'percentage points' },
      { id: 'mrr', kind: 'goal', unit: '£/month', observed_state: { unit: '£/month', value: 120000 } },
    ];
    const edge = {
      from: 'price', to: 'mrr', strength: { mean: 0.1 },
      provenance: { source: 'user_specified', magnitude: 'user_stated', natural_effect: {
        amount: 1200, amount_unit: 'GBP/month', strength_mean: 0.1,
      } },
    };
    expect(sizedLinkTest(nodes)(edge)).toBe(true);
  });
});

const BUDGET_LABEL = 'Total initiative spend';
const BUDGET_LIMIT = 'agent-lane:total_initiative_spend:<=';
const DOWNTIME_LABEL = 'Migration downtime risk';
const DOWNTIME_LIMIT = 'agent-lane:migration_downtime_risk:<=';

const idOf = (graph: Json, label: string): string => {
  const hits = (graph.nodes as Json[]).filter((n) => n.label === label);
  expect(hits, `exactly one node labelled "${label}"`).toHaveLength(1);
  return hits[0].id as string;
};
const goalIdOf = (graph: Json): string => (graph.nodes as Json[]).find((n) => n.kind === 'goal')!.id as string;
/** The options PLoT scores, as run_analysis sends them: `{ option_id, interventions }` keyed by node id. */
const optionsOf = (graph: Json): Json[] =>
  (graph.nodes as Json[]).filter((n) => n.kind === 'option').map((n) => ({ option_id: n.id, interventions: n.interventions ?? {} }));

/** Journey C's verifier shape: "Additional Advertising" sets its PART only (T4 RED row, `run-analysis-budget-limit-baseline`). */
function journeyCPartsOnly(frame: 'level' | 'change_abs'): { graph: Json; options: Json[] } {
  const graph = structuredClone(JOURNEY_C);
  const budgetId = idOf(graph, BUDGET_LABEL);
  graph.edges = (graph.edges as Json[]).filter((e) => !(e.from === 'additional_advertising' && e.to === budgetId));
  const limit = (graph.goal_constraints as Json[]).find((c) => c.constraint_id === BUDGET_LIMIT)!;
  Object.assign(limit, { value: 15000, value_frame: frame });
  const adv = (graph.nodes as Json[]).find((n) => n.id === 'additional_advertising')!;
  adv.interventions = { advertising_spend: adv.interventions.advertising_spend };
  return { graph, options: optionsOf(graph) };
}

function cloudWith(frame: 'level' | 'change_abs', edit?: (g: Json) => void): { graph: Json; options: Json[] } {
  const graph = structuredClone(CLOUD);
  const limit = (graph.goal_constraints as Json[]).find((c) => c.constraint_id === DOWNTIME_LIMIT)!;
  limit.value_frame = frame;
  edit?.(graph);
  return { graph, options: optionsOf(graph) };
}

/** B6's other inputs made the user's: the limited node's level is theirs, so only the link rules speak. */
function usersLevel(graph: Json, nodeId: string): Json {
  const g = structuredClone(graph);
  (g.nodes as Json[]).find((n) => n.id === nodeId)!.observed_state.source = 'user';
  return g;
}

/** A PLoT response in which ISL SCORED the limit on every option, decision-grade, `frame_verdict: 'scored'`. */
function scoredEnvelope(constraintId: string, nodeId: string, options: Json[]): Json {
  return {
    constraints_status: 'computed',
    constraint_results: [{
      constraint_id: constraintId, node_id: nodeId, probability: 0.8,
      scale_provenance: { source: 'unit_percent', range_unified: true, decision_grade: true }, frame_verdict: 'scored',
    }],
    option_comparison: options.map((o) => ({ option_id: o.option_id, win_probability: 1 / options.length, constraint_probabilities: { [constraintId]: 0.8 } })),
    inference_warnings: [],
    critiques: [],
  };
}

function rowFor(graph: Json, options: Json[], constraintId: string) {
  const ratified = readRatifiedConstraints(graph);
  const target = (graph.goal_constraints as Json[]).find((c) => c.constraint_id === constraintId)!.node_id as string;
  const v = deriveConstraintVerdict(
    scoredEnvelope(constraintId, target, options), ratified, options[0]!.option_id, undefined, new Set(),
    collectLimitLevelOwners(graph, ratified, options),
  );
  return v.perLimit?.find((r) => r.constraint_id === constraintId);
}

describe('PRECONDITIONS — the pair differs in the links, read off the served bytes', () => {
  it('journey C: the link from the part the option sets into the total carries no magnitude', () => {
    const { graph } = journeyCPartsOnly('change_abs');
    const link = (graph.edges as Json[]).find((e) => e.from === 'advertising_spend' && e.to === idOf(graph, BUDGET_LABEL))!;
    expect(link.provenance?.magnitude).toBeUndefined();
  });
  it('cloud: both links into downtime are olumi_estimate in weeks, AND defaulted — so defaulted is not the discriminator', () => {
    const into = (CLOUD.edges as Json[]).filter((e) => e.to === idOf(CLOUD, DOWNTIME_LABEL));
    expect(into.map((e) => e.from).sort()).toEqual(['gcp_workload_share', 'migration_execution_readiness']);
    for (const e of into) {
      expect(e.provenance.magnitude).toBe('olumi_estimate');
      expect(e.provenance.natural_effect.amount_unit).toBe('weeks');
      expect(e.defaulted).toBe(true);
    }
    const movers = optionsOf(CLOUD).filter((o) => Object.keys(o.interventions).length > 0);
    expect(movers.length).toBeGreaterThan(0);
    for (const o of movers) expect(Object.keys(o.interventions)).not.toContain(idOf(CLOUD, DOWNTIME_LABEL));
  });
});

describe('the ONE predicate (targetMovedOnlyThroughPlaceholderParts)', () => {
  const on = (g: Json, o: Json[], label: string) => targetMovedOnlyThroughPlaceholderParts(idOf(g, label), g.nodes, g.edges, o);

  it('R-c: journey C total, moved only through a part on a bare placeholder link → parts_links_placeholder', () => {
    const { graph, options } = journeyCPartsOnly('change_abs');
    expect(on(graph, options, BUDGET_LABEL)).toBe('parts_links_placeholder');
  });
  it('B6 SUPERSEDES R-e (AIQ 5916187873 (i)): cloud downtime, moved only through parts on Olumi-sized links in weeks → Olumi\'s guess, not a placeholder', () => {
    const { graph, options } = cloudWith('change_abs');
    expect(on(graph, options, DOWNTIME_LABEL)).toBe('limit_rests_on_olumi_guess');
  });
  it('(ii): the same sized links, but the target declares a nonlinear identity → parts_identity_unmodelled', () => {
    const { graph, options } = cloudWith('change_abs', (g) => {
      (g.nodes as Json[]).find((n) => n.label === DOWNTIME_LABEL)!.nonlinear_identity = {
        operation: 'product', factor_ids: ['gcp_workload_share', 'migration_execution_readiness'], stated_in_brief: false,
      };
    });
    expect(on(graph, options, DOWNTIME_LABEL)).toBe('parts_identity_unmodelled');
  });
  it('a sized link in ANOTHER unit than the node it points at is not sized for this target → withheld', () => {
    const { graph, options } = cloudWith('change_abs', (g) => {
      (g.edges as Json[]).find((e) => e.from === 'gcp_workload_share' && e.to === 'migration_downtime_risk')!
        .provenance.natural_effect.amount_unit = 'GBP/month';
    });
    expect(on(graph, options, DOWNTIME_LABEL)).toBe('parts_links_placeholder');
  });
  it('an olumi_placeholder magnitude on one of the two links → withheld', () => {
    const { graph, options } = cloudWith('change_abs', (g) => {
      (g.edges as Json[]).find((e) => e.from === 'migration_execution_readiness' && e.to === 'migration_downtime_risk')!
        .provenance.magnitude = 'olumi_placeholder';
    });
    expect(on(graph, options, DOWNTIME_LABEL)).toBe('parts_links_placeholder');
  });
  it('a sized link whose mean has moved since it was sized (the natural effect no longer describes it) → withheld', () => {
    const { graph, options } = cloudWith('change_abs', (g) => {
      (g.edges as Json[]).find((e) => e.from === 'gcp_workload_share' && e.to === 'migration_downtime_risk')!.strength.mean = 0.5;
    });
    expect(on(graph, options, DOWNTIME_LABEL)).toBe('parts_links_placeholder');
  });
  it('CONTROL (served C15): every option that moves a part also sets the total → not withheld', () => {
    expect(on(JOURNEY_C, optionsOf(JOURNEY_C), BUDGET_LABEL)).toBeNull();
  });
});

describe('R-c at the fold: a limit moved only through placeholder parts is WITHHELD, never scored or estimate_only', () => {
  it('PER OPTION (AIQ 5900908629) — journey C, change_abs: only "Additional Advertising" has its own P withheld; the row folds over the options that set the total (scored on the user\'s base)', () => {
    const { graph, options } = journeyCPartsOnly('change_abs');
    const owners = collectLimitLevelOwners(graph, readRatifiedConstraints(graph), options);
    expect([...(owners.placeholderMovedOptionIds.get(BUDGET_LIMIT) ?? [])]).toEqual(['additional_advertising']);
    expect(owners.placeholderPartsReasons.has(BUDGET_LIMIT)).toBe(false);
    expect(rowFor(graph, options, BUDGET_LIMIT)).toEqual({ constraint_id: BUDGET_LIMIT, state: 'scored' });
  });
  it('PER OPTION — the same, with every option moving the total only through the placeholder part: none is left, so the ROW is withheld (unscored / parts_links_placeholder)', () => {
    const { graph } = journeyCPartsOnly('change_abs');
    const options = optionsOf(graph).filter((o) => o.option_id === 'additional_advertising');
    expect(rowFor(graph, options, BUDGET_LIMIT)).toEqual({ constraint_id: BUDGET_LIMIT, state: 'unscored', reason: 'parts_links_placeholder' });
  });
  it('R-e — cloud downtime, change_abs, ISL scored it → the normal fold (Olumi\'s level: estimate_only), NOT withheld', () => {
    const { graph, options } = cloudWith('change_abs');
    expect(rowFor(graph, options, DOWNTIME_LIMIT)).toEqual({ constraint_id: DOWNTIME_LIMIT, state: 'estimate_only', reason: 'level_olumi_estimate' });
  });
  it('said per option (AIQ 5900908629): the row was checked; the withheld option is named, with the link-size question', () => {
    const { graph, options } = journeyCPartsOnly('change_abs');
    const row = rowFor(graph, options, BUDGET_LIMIT)!;
    const checks = limitChecksForAgent(graph, { per_limit: [row], joint: { state: row.state } } as never)!;
    const check = checks.find((c) => c.constraint_id === BUDGET_LIMIT)!;
    expect(check.say).toBe('‘Total initiative spend’ was checked against the figures in your model. For ‘Additional Advertising’ it couldn’t be checked: '
      + 'that option moves it through a link Olumi hasn’t sized in this limit’s units.');
    expect(check.withheld_for).toEqual(['Additional Advertising']);
    // A scored row has no level ask; the link-size question is MG's ask, never the sentence's.
    expect(check.ask).toBe('How much does ‘Advertising spend’ change ‘Total initiative spend’?');
  });
  it('a row withheld for its parts (none left) keeps its own sentence and asks nothing', () => {
    const { graph } = journeyCPartsOnly('change_abs');
    const row = rowFor(graph, optionsOf(graph).filter((o) => o.option_id === 'additional_advertising'), BUDGET_LIMIT)!;
    const check = limitChecksForAgent(graph, { per_limit: [row], joint: { state: 'unscored', reason: row.reason } } as never)!
      .find((c) => c.constraint_id === BUDGET_LIMIT)!;
    expect(check.say).toBe('‘Total initiative spend’ cannot be checked in this model yet: Olumi hasn’t sized the links from its parts to it in this limit’s units.');
    expect(check.ask).toBeUndefined();
  });
  it('without the options PLoT scores, the fold withholds nothing (the level owners are unchanged)', () => {
    const { graph } = journeyCPartsOnly('change_abs');
    const ratified = readRatifiedConstraints(graph);
    expect(collectLimitLevelOwners(graph, ratified).placeholderPartsReasons.size).toBe(0);
  });
});

describe('R-c for a LEVEL limit: the baseline carrier no longer reads it (per option since AIQ 5900908629)', () => {
  it('journey C, level: the total CARRIES its baseline, so PLoT scores every option; the placeholder-moved option\'s P is withheld after the run', () => {
    const { graph, options } = journeyCPartsOnly('level');
    expect(levelLimitBaselineNodeIds(graph, graph.goal_constraints, goalIdOf(graph), options).has(idOf(graph, BUDGET_LABEL))).toBe(true);
    const owners = collectLimitLevelOwners(graph, readRatifiedConstraints(graph), options);
    expect([...(owners.placeholderMovedOptionIds.get(BUDGET_LIMIT) ?? [])]).toEqual(['additional_advertising']);
  });
  it('R-e, level: cloud downtime (sized links) CARRIES its level as baseline — a T4 with no exception re-blocked it', () => {
    const { graph, options } = cloudWith('level');
    expect(levelLimitBaselineNodeIds(graph, graph.goal_constraints, goalIdOf(graph), options).has(idOf(graph, DOWNTIME_LABEL))).toBe(true);
  });
  it('(ii), level: a nonlinear identity on downtime — the baseline carries; EVERY option moving a part has its own P withheld (parts_identity_unmodelled)', () => {
    const { graph, options } = cloudWith('level', (g) => {
      (g.nodes as Json[]).find((n) => n.label === DOWNTIME_LABEL)!.nonlinear_identity = { operation: 'product', factor_ids: ['gcp_workload_share'], stated_in_brief: false };
    });
    expect(levelLimitBaselineNodeIds(graph, graph.goal_constraints, goalIdOf(graph), options).has(idOf(graph, DOWNTIME_LABEL))).toBe(true);
    const movers = options.filter((o) => Object.keys(o.interventions).length > 0).map((o) => o.option_id).sort();
    const owners = collectLimitLevelOwners(graph, readRatifiedConstraints(graph), options);
    expect([...(owners.placeholderMovedOptionIds.get(DOWNTIME_LIMIT) ?? [])].sort()).toEqual(movers);
  });
});

/**
 * ⛔ R-c EXTENDED TO `onLevel` (AI Quality 5882087383, DL 5882019090) — Paul's served journey A (17d1): "keep monthly churn
 * under 4%". The options set the Pro plan price; churn moves only through `price → price_sensitivity → churn`, whose links
 * carry no size (`olumi_placeholder` into churn). The churn "%" limit rode the `onLevel` proof, so it carried Olumi's 3%
 * and read `estimate_only` from the placeholder's P. It is WITHHELD, with the link-size ask.
 */
describe('R-c on journey A (served 17d1): the churn limit moved by price only through an unsized link is withheld, with an ask', () => {
  const A = JSON.parse(readFileSync('tests/fixtures/cross-service/b5-per-limit/17d1cd3a.graph.json', 'utf8')).graph as Json;
  const CHURN_LIMIT = 'agent-lane:monthly_churn:<=';
  const churnId = () => idOf(A, 'Monthly churn');
  /** The same graph with the price → churn path replaced by ONE link sized in churn's unit, by `magnitude`. */
  /** `amountUnit` defaults to what the sizer writes for churn, a percentage level on 100: "percentage points". */
  const sized = (magnitude: 'olumi_estimate' | 'user_stated', amountUnit = 'percentage points'): Json => {
    const g = structuredClone(A);
    const price = idOf(g, 'Pro plan price');
    const sens = (g.nodes as Json[]).find((n) => n.id === 'price_sensitivity')!.id as string;
    g.edges = (g.edges as Json[]).filter((e) => !(e.from === price && e.to === sens) && !(e.from === sens && e.to === churnId()));
    g.edges.push({ from: price, to: churnId(), strength: { mean: 0.3, std: 0.15 }, defaulted: true,
      provenance: { source: 'cee_hypothesis', magnitude, natural_effect: { amount: 0.4, amount_unit: amountUnit, per_source_change: 10, per_source_change_unit: 'GBP per month', strength_mean: 0.3, strength_mean_frame: 'edge_strength' } } });
    return g;
  };
  const carried = (g: Json) => levelLimitBaselineNodeIds(g, g.goal_constraints, goalIdOf(g), optionsOf(g)).has(churnId());
  const fold = (g: Json) => rowFor(g, optionsOf(g), CHURN_LIMIT);
  /** Per option (AIQ 5900908629): the options whose own churn P is withheld. */
  const withheld = (g: Json) => [...(collectLimitLevelOwners(g, readRatifiedConstraints(g), optionsOf(g)).placeholderMovedOptionIds.get(CHURN_LIMIT) ?? [])].sort();
  /** Per option, WHY (R-c's placeholder vs B6's guess), so a re-pin keeps naming the rule it tests. */
  const why = (g: Json) => Object.fromEntries(placeholderMovedOptions(churnId(), g.nodes, g.edges, optionsOf(g)));
  const PRICE_OPTIONS = ['increase_price_to_54', 'increase_price_to_59'];
  /** Journey A with churn's 3% made the user's: B6's level arm is out, so R-c's rows keep their axis. */
  const mine = (g: Json = A) => usersLevel(g, churnId());
  /** A link the USER sized, as #2274 writes it: their source, no Olumi default. */
  const userSized = (): Json => {
    const g = sized('user_stated');
    const e = (g.edges as Json[]).find((x) => x.to === churnId() && x.from === idOf(g, 'Pro plan price'))!;
    e.provenance.source = 'user_specified';
    delete e.defaulted;
    return g;
  };

  it('PRECONDITION (served bytes): churn\'s only way in is price_sensitivity, on links with no size; the churn limit is a "%" level', () => {
    const into = (A.edges as Json[]).filter((e) => e.to === churnId());
    expect(into.map((e) => e.from)).toEqual(['price_sensitivity']);
    expect(into[0].provenance.magnitude).toBe('olumi_placeholder');
    expect((A.goal_constraints as Json[]).find((c) => c.constraint_id === CHURN_LIMIT)).toMatchObject({ unit: '%', value_frame: 'level' });
  });
  it('PER OPTION — the churn baseline CARRIES (PLoT scores every option); both price options have their own P withheld as placeholders', () => {
    expect(carried(A)).toBe(true);
    expect(withheld(mine())).toEqual(PRICE_OPTIONS);
    expect(why(mine())).toEqual({ increase_price_to_54: 'parts_links_placeholder', increase_price_to_59: 'parts_links_placeholder' });
    // B6 (ii), as served: keep-current's P is Olumi's 3% against the 4% limit, so it is withheld too (AIQ 5916187873 (c)).
    expect(why(A)).toEqual({ ...why(mine()), keep_current_49_price: 'limit_rests_on_olumi_guess' });
  });
  it('PER OPTION — the fold reads only the option no placeholder moves (keep current, the user\'s 3% in the twin): scored, never a price option\'s placeholder P', () => {
    expect(fold(mine())).toEqual({ constraint_id: CHURN_LIMIT, state: 'scored' });
    expect(fold(A)).toMatchObject({ constraint_id: CHURN_LIMIT, state: 'unscored' });
    // With the two price options alone (none left to fold over), the row itself is withheld for its parts.
    const priceOnly = optionsOf(A).filter((o) => PRICE_OPTIONS.includes(o.option_id));
    expect(rowFor(mine(), priceOnly, CHURN_LIMIT)).toEqual({ constraint_id: CHURN_LIMIT, state: 'unscored', reason: 'parts_links_placeholder' });
  });
  it('RULE 3(f) — the leader verdict never reads the placeholder\'s P as the limit met: unevaluated on churn, as for any unchecked limit', () => {
    const options = optionsOf(A);
    const ratified = readRatifiedConstraints(A);
    const v = deriveConstraintVerdict(scoredEnvelope(CHURN_LIMIT, churnId(), options), ratified, options[1]!.option_id, undefined, new Set(),
      collectLimitLevelOwners(A, ratified, options));
    expect(v.state).toBe('unevaluated');
    expect(v.mayNameLeadingOption).toBe(false);
    expect(v.constraints.map((c) => c.constraint_id)).toEqual([CHURN_LIMIT]);
  });
  it('B6 SUPERSEDES RULE 3(f)\'s control (AIQ 5916187873 (i)): the link sized by OLUMI is its guess → unevaluated, the leader withheld', () => {
    const g = sized('olumi_estimate');
    const options = optionsOf(g);
    const ratified = readRatifiedConstraints(g);
    const v = deriveConstraintVerdict(scoredEnvelope(CHURN_LIMIT, churnId(), options), ratified, options[1]!.option_id, undefined, new Set(),
      collectLimitLevelOwners(g, ratified, options));
    expect(v.state).toBe('unevaluated');
    expect(v.mayNameLeadingOption).toBe(false);
  });
  it('RULE 3(f) CONTROL — the link sized by the USER and churn\'s level theirs: the leader is decided on the certified score (evaluated_feasible)', () => {
    const g = mine(userSized());
    const options = optionsOf(g);
    const ratified = readRatifiedConstraints(g);
    const v = deriveConstraintVerdict(scoredEnvelope(CHURN_LIMIT, churnId(), options), ratified, options[1]!.option_id, undefined, new Set(),
      collectLimitLevelOwners(g, ratified, options));
    expect(v.state).toBe('evaluated_feasible');
  });
  it('said per option, WITH the link-size question (AIQ 5900908629 supersedes 5882619314\'s no-ask: a size the user gives is written as theirs, #2274)', () => {
    const g = mine();
    const row = fold(g)!;
    const check = limitChecksForAgent(g, { per_limit: [row], joint: { state: row.state } } as never)!
      .find((c) => c.constraint_id === CHURN_LIMIT)!;
    expect(check.say).toBe('‘Monthly churn’ was checked against the figures in your model. For ‘Increase price to £59’ and '
      + '‘Increase price to £54’ it couldn’t be checked: those options move it through a link Olumi hasn’t sized in this limit’s units.');
    expect(check.withheld_for).toEqual(['Increase price to £59', 'Increase price to £54']);
    expect(check.ask).toMatch(/How much does ‘Pro plan price’ change ‘Monthly churn’\?$/);
  });
  it('B6 SUPERSEDES this control (AIQ 5916187873 (i)+(ii)): the price → churn link SIZED by Olumi still carries, but every P rests on its guess → withheld', () => {
    expect(carried(sized('olumi_estimate'))).toBe(true);
    expect(fold(sized('olumi_estimate'))).toMatchObject({ constraint_id: CHURN_LIMIT, state: 'unscored', reason: 'limit_rests_on_olumi_guess' });
    expect(new Set(Object.values(why(sized('olumi_estimate'))))).toEqual(new Set(['limit_rests_on_olumi_guess']));
  });
  it('PRECONDITION: churn is a percentage LEVEL on 100, so the sizer says a link into it in "percentage points"', () => {
    expect((A.nodes as Json[]).find((n) => n.id === churnId())!.observed_state.unit).toBe('% per month');
    expect(carried(sized('olumi_estimate', 'percentage points'))).toBe(true);
  });
  it('PR Review 5882690939 — "percentage points" on a node that is NOT a percentage level is not its unit → the price options are withheld', () => {
    for (const unit of ['percent change', 'percentile rank', 'subscribers per month']) {
      const g = sized('olumi_estimate', 'percentage points');
      (g.nodes as Json[]).find((n) => n.id === churnId())!.observed_state.unit = unit;
      expect(why(mine(g)), unit).toEqual({ increase_price_to_54: 'parts_links_placeholder', increase_price_to_59: 'parts_links_placeholder' });
    }
    // In churn's own unit the link is SIZED (no placeholder); B6 then names it Olumi's guess, never a placeholder.
    expect(why(mine(sized('olumi_estimate', 'percentage points')))).toEqual({ increase_price_to_54: 'limit_rests_on_olumi_guess', increase_price_to_59: 'limit_rests_on_olumi_guess' });
  });
  it('a natural effect in the node\'s raw spelling ("% per month") is not what the sizer writes for a level on 100 → the price options are withheld', () => {
    expect(why(mine(sized('olumi_estimate', '% per month')))).toEqual({ increase_price_to_54: 'parts_links_placeholder', increase_price_to_59: 'parts_links_placeholder' });
  });
  it('CONTROL — the link sized by the USER and churn\'s level theirs: it carries, and nothing is withheld (scored)', () => {
    expect(carried(userSized())).toBe(true);
    expect(withheld(mine(userSized()))).toEqual([]);
    expect(fold(mine(userSized()))).toEqual({ constraint_id: CHURN_LIMIT, state: 'scored' });
  });
  it('B6 (ii): the link sized by the USER, but churn\'s level Olumi\'s 3% → every option withheld for that level (AIQ 5916187873)', () => {
    expect(new Set(Object.values(why(userSized())))).toEqual(new Set(['limit_rests_on_olumi_guess']));
  });
});
