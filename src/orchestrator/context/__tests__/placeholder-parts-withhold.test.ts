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
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  collectLimitLevelOwners,
  deriveConstraintVerdict,
  readRatifiedConstraints,
} from '../constraint-feasibility.js';
import { targetMovedOnlyThroughPlaceholderParts } from '../placeholder-parts.js';
import { levelLimitBaselineNodeIds } from '../../../orchestrator-v5/tools/handlers/level-limit-baseline.js';
import { limitChecksForAgent } from '../../../orchestrator-v5/agent-lane/limit-checks.js';

type Json = Record<string, any>;
const fixture = (rel: string): Json => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as Json;
const JOURNEY_C = fixture('../../../orchestrator-v5/__tests__/fixtures/served-journey-c-nonroot-budget-limit-082121Z.json').c15 as Json;
const CLOUD = fixture('../../../orchestrator-v5/__tests__/fixtures/served-cloud-downtime-estimated-parts-20260929.json').graph as Json;

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
  const options = optionsOf(graph).map((o) =>
    o.option_id === 'additional_advertising' ? { ...o, interventions: { advertising_spend: o.interventions.advertising_spend } } : o,
  );
  return { graph, options };
}

function cloudWith(frame: 'level' | 'change_abs', edit?: (g: Json) => void): { graph: Json; options: Json[] } {
  const graph = structuredClone(CLOUD);
  const limit = (graph.goal_constraints as Json[]).find((c) => c.constraint_id === DOWNTIME_LIMIT)!;
  limit.value_frame = frame;
  edit?.(graph);
  return { graph, options: optionsOf(graph) };
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
  it('R-e: cloud downtime, moved only through parts on Olumi-sized links in weeks → not withheld', () => {
    const { graph, options } = cloudWith('change_abs');
    expect(on(graph, options, DOWNTIME_LABEL)).toBeNull();
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
  it('CONTROL (served C15): every option that moves a part also sets the total → not withheld', () => {
    expect(on(JOURNEY_C, optionsOf(JOURNEY_C), BUDGET_LABEL)).toBeNull();
  });
});

describe('R-c at the fold: a change_abs limit moved only through placeholder parts is WITHHELD, never scored or estimate_only', () => {
  it('RED — journey C, change_abs, ISL scored it on the user\'s own base → unscored / parts_links_placeholder', () => {
    const { graph, options } = journeyCPartsOnly('change_abs');
    expect(rowFor(graph, options, BUDGET_LIMIT)).toEqual({ constraint_id: BUDGET_LIMIT, state: 'unscored', reason: 'parts_links_placeholder' });
  });
  it('R-e — cloud downtime, change_abs, ISL scored it → the normal fold (Olumi\'s level: estimate_only), NOT withheld', () => {
    const { graph, options } = cloudWith('change_abs');
    expect(rowFor(graph, options, DOWNTIME_LIMIT)).toEqual({ constraint_id: DOWNTIME_LIMIT, state: 'estimate_only', reason: 'level_olumi_estimate' });
  });
  it('the reason is said in words: Olumi\'s links to it are placeholders', () => {
    const { graph, options } = journeyCPartsOnly('change_abs');
    const row = rowFor(graph, options, BUDGET_LIMIT)!;
    const checks = limitChecksForAgent(graph, { per_limit: [row], joint: { state: 'unscored', reason: row.reason } } as never)!;
    const check = checks.find((c) => c.constraint_id === BUDGET_LIMIT)!;
    expect(check.say).toBe('‘Total initiative spend’ cannot be checked in this model yet: Olumi’s links from its parts to it are placeholders, not estimates.');
    expect(check.ask, 'a today-level cannot make it checkable, so it is never asked for').toBeUndefined();
  });
  it('without the options PLoT scores, the fold withholds nothing it did not before (the level owners are unchanged)', () => {
    const { graph } = journeyCPartsOnly('change_abs');
    const ratified = readRatifiedConstraints(graph);
    expect(collectLimitLevelOwners(graph, ratified).placeholderPartsReasons.size).toBe(0);
  });
});

describe('R-c for a LEVEL limit: the same predicate gates T4\'s baseline carrier', () => {
  it('journey C, level: the total carries NO baseline (ISL refuses it, missing_target_baseline) — as at base', () => {
    const { graph, options } = journeyCPartsOnly('level');
    expect(levelLimitBaselineNodeIds(graph, graph.goal_constraints, goalIdOf(graph), options).has(idOf(graph, BUDGET_LABEL))).toBe(false);
  });
  it('R-e, level: cloud downtime (sized links) CARRIES its level as baseline — a T4 with no exception re-blocked it', () => {
    const { graph, options } = cloudWith('level');
    expect(levelLimitBaselineNodeIds(graph, graph.goal_constraints, goalIdOf(graph), options).has(idOf(graph, DOWNTIME_LABEL))).toBe(true);
  });
  it('(ii), level: the same cloud graph with a nonlinear identity on downtime carries nothing', () => {
    const { graph, options } = cloudWith('level', (g) => {
      (g.nodes as Json[]).find((n) => n.label === DOWNTIME_LABEL)!.nonlinear_identity = { operation: 'product', factor_ids: ['gcp_workload_share'], stated_in_brief: false };
    });
    expect(levelLimitBaselineNodeIds(graph, graph.goal_constraints, goalIdOf(graph), options).has(idOf(graph, DOWNTIME_LABEL))).toBe(false);
  });
});
