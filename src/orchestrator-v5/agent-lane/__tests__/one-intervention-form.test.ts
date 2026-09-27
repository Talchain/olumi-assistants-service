/**
 * ⭐ P2 A5 — AN OPTION'S LEVEL IS PERSISTED IN ONE FORM, WHICHEVER WRITER WROTE IT (DL order 5858777018 item 3).
 *
 * MEASURED on served CEE 523e18d (DL run pj-20260927T181846Z, journey A, scenario 1ceb77d8): journey A persisted
 * THREE key-sets for six option levels. The one that is a defect is the BUILD's (`build_model_from_brief`, turn A01):
 *
 *   raise_pro_to_59_at_release.pro_plan_price  { value: 0.295, source: 'brief_extraction' }
 *
 * The drafter stated 59, and admission divided it by the factor's cap and dropped everything else. It dropped the
 * figure itself, the unit and the factor match, although the add-option writer stores all three for the same factor at
 * A06 (`bb667b99`: `{ value 0.295, raw_value 59, unit, source, target_match }`). The same writer line produced every
 * `{source, value}` level on all five fresh journeys (18 levels).
 *
 * The fix is AT THE WRITER, from facts the construction already holds. Nothing is added when a graph is projected for
 * persistence: projection runs on every later write, so filling a field there would rewrite cells nobody touched and move
 * the hash of an unchanged graph. Rows:
 *  (a) the A-shaped build of "£59 at release" persists the one form, with the factor's OWN cap and unit;
 *  (b) the build writer and the add-option writer produce the same key-set for a framed level;
 *  (c) CONTRAST: a level that is legitimately different keeps its own shape:
 *        · a 0|1 switch (the contract refuses unit or raw on it);
 *        · an unframed level ("value = raw_value (or raw_value omitted)", `cee-v3.ts`);
 *        · a level framed only by the node's `scale_frame` (raw on a node with no cap would change the PLoT wire).
 *  (d) a later write still passes the stored-bytes scope guards and leaves this cell's bytes alone;
 *  (e) the analysis hash of an unchanged graph is unchanged: the served short form projects to itself, byte for byte;
 *  (f) the science guard: on the served A factors, both forms reach PLoT as the same numbers.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildAddOptionsTransaction } from '../../routing/add-option-transaction.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { normaliseGraphNodeKindField } from '../../graph-registration/normalise-node-kind.js';
import { normaliseAbsenceOnly, projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyOptionInterventionEdit } from '../../system-events/option-intervention-edit.js';
import { buildFactorScaleMap, projectRequestInterventionsToWireScale } from '../../tools/plot-intervention-scale.js';

const SCENARIO = '1ceb77d8-4352-4485-aadf-6e30ad429062';
const SERVED_A01 = 'served-a01-build-levels-523e18d.json';
const served = (): { nodes: Node[]; edges: unknown[] } =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', SERVED_A01), 'utf8'));

const PRICE = 'Pro plan price';
const RAISE_59 = 'Raise Pro to £59 at release';
const RAISE_54 = 'Raise Pro to £54 at release';

/**
 * Journey A's construction, rebuilt from the served A01 graph (`served-a01-build-levels-523e18d.json`).
 * The labels, the price baseline 49 on a range of 200 in "GBP/month", the brief's 59 (explicit), Olumi's 54
 * (proposed), the estimates on their ranges and the links are all as served. The drafter's raw output was not captured
 * (A01's `_provider_calls` holds usage only), so this is the smallest candidate the served graph proves. One deliberate
 * difference: the options state their unit as "GBP per month". The level must carry the FACTOR's unit, and a writer
 * that copied the option's spelling instead would show here.
 */
function aCandidate(): CandidateModel {
  return {
    goal: {
      metric: 'MRR', operator: '>=', value: 100000, unit: 'GBP/month', horizon_months: 12, provenance: 'explicit',
      baseline_known: true, baseline_value: 75000, baseline_provenance: 'explicit',
    },
    constraints: [{ metric: 'Monthly churn rate', operator: '<=', value: 4, unit: '%', provenance: 'explicit', frame: 'level' }],
    options: [
      { label: 'Keep Pro at £49', provenance: 'inferred', interventions: [], changes: [], is_status_quo: true },
      { label: RAISE_59, provenance: 'explicit', changes: [], is_status_quo: false,
        interventions: [{ factor_label: PRICE, value: 59, unit: 'GBP per month', provenance: 'explicit' }] },
      { label: RAISE_54, provenance: 'ai_proposed', changes: [], is_status_quo: false,
        interventions: [{ factor_label: PRICE, value: 54, unit: 'GBP per month', provenance: 'ai_proposed' }] },
    ],
    factors: [
      { label: PRICE, role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP/month', provenance: 'explicit', plausible_max: 200 },
      { label: 'Pro paying subscribers at month 12', role: 'observable', baseline_known: false, baseline_value: 1360, unit: 'subscribers', provenance: 'inferred', plausible_max: 5000 },
      { label: 'Monthly churn rate', role: 'observable', baseline_known: false, baseline_value: 3, unit: '%', provenance: 'inferred', plausible_max: 100 },
      { label: 'Other-plan MRR at month 12', role: 'observable', baseline_known: false, baseline_value: 26000, unit: 'GBP/month', provenance: 'inferred', plausible_max: 200000 },
    ],
    risks: [{ label: 'Price sensitivity', provenance: 'inferred' }],
    outcomes: [{ label: 'Pro MRR at month 12', provenance: 'inferred' }],
    links: [
      { from: PRICE, to: 'Pro MRR at month 12', direction: 'positive', provenance: 'inferred' },
      { from: 'Pro paying subscribers at month 12', to: 'Pro MRR at month 12', direction: 'positive', provenance: 'inferred' },
      { from: 'Monthly churn rate', to: 'Pro paying subscribers at month 12', direction: 'negative', provenance: 'inferred' },
      { from: PRICE, to: 'Monthly churn rate', direction: 'positive', provenance: 'inferred' },
      { from: PRICE, to: 'Price sensitivity', direction: 'positive', provenance: 'inferred' },
      { from: 'Price sensitivity', to: 'Monthly churn rate', direction: 'positive', provenance: 'inferred' },
      { from: 'Pro MRR at month 12', to: 'MRR', direction: 'positive', provenance: 'inferred' },
      { from: 'Other-plan MRR at month 12', to: 'MRR', direction: 'positive', provenance: 'inferred' },
    ],
  };
}

/** A persisted node, at the shape these rows read. */
interface Node {
  readonly id: string;
  readonly kind: string;
  readonly label?: string;
  readonly observed_state?: unknown;
  readonly scale_frame?: unknown;
  readonly interventions?: Readonly<Record<string, unknown>>;
}
const byLabel = (nodes: readonly Node[], kind: string, label: string): Node => {
  const hits = nodes.filter((n) => n.kind === kind && n.label === label);
  expect(hits, `exactly one ${kind} labelled "${label}"`).toHaveLength(1);
  return hits[0]!;
};
const levelOf = (nodes: readonly Node[], optionLabel: string, factorLabel: string): Record<string, unknown> => {
  const factor = byLabel(nodes, 'factor', factorLabel);
  const cell = byLabel(nodes, 'option', optionLabel).interventions?.[factor.id] as Record<string, unknown> | undefined;
  expect(cell, `${optionLabel} sets a level on ${factorLabel}`).toBeDefined();
  return cell!;
};
const exactMatch = (factorId: string) => ({ node_id: factorId, match_type: 'exact_id', confidence: 'high' });

/** The `/graph/register` route's own pipeline, in its own order: kind normalise → ingress parse → project. */
function persistAsRegistered(graph: unknown): { nodes: Node[]; edges: unknown[] } {
  const normalised = normaliseGraphNodeKindField(graph);
  if (!normalised.ok) throw new Error(`register would refuse: ${normalised.reason}`);
  const parsed = GraphStateIngressSchema.safeParse(normalised.graph);
  if (!parsed.success) throw new Error(`register would refuse: ${parsed.error.issues[0]?.path.join('.')}`);
  const persisted: unknown = projectGraphForPersistence(parsed.data, {
    scenarioId: SCENARIO, turnClass: 'direct_answer', source: 'graph_registration',
  });
  return persisted as { nodes: Node[]; edges: unknown[] };
}

const buildAndPersist = (candidate: CandidateModel) => {
  const admitted = admitCandidateModel(candidate, {});
  return persistAsRegistered({ nodes: admitted.nodes, edges: admitted.edges });
};

describe('(a) the build persists an option level in the one form, from the factor’s own frame', () => {
  it('control: the served A01 build wrote the short form on this exact cell (the defect, on real bytes)', () => {
    const nodes = served().nodes as readonly Node[];
    expect(levelOf(nodes, RAISE_59, PRICE)).toEqual({ value: 0.295, source: 'brief_extraction' });
    expect(levelOf(nodes, RAISE_54, PRICE)).toEqual({ value: 0.27, source: 'cee_hypothesis' });
  });

  it('⭐ "£59 at release" persists {value, raw_value 59, unit, source, target_match}, on the factor’s own cap and unit', () => {
    const { nodes } = buildAndPersist(aCandidate());
    const factor = byLabel(nodes, 'factor', PRICE);
    const os = factor.observed_state as { cap?: number; unit?: string };
    // Read the frame off the factor the same construction wrote; never restated here.
    expect(os.cap, 'the price is framed inside its own observed state').toBe(200);
    expect(os.unit).toBe('GBP/month');
    const cell = levelOf(nodes, RAISE_59, PRICE);
    expect(cell).toEqual({
      value: 59 / os.cap!,
      raw_value: 59,
      unit: os.unit,
      source: 'brief_extraction',
      target_match: exactMatch(factor.id),
    });
    // The encoded value is unchanged from the one served at A01: only what was dropped is now kept.
    expect(cell.value).toBeCloseTo(0.295, 12);
    expect((cell.raw_value as number) / os.cap!).toBeCloseTo(cell.value as number, 12);
  });

  it('Olumi’s proposed £54 is the same form, and keeps its own author', () => {
    const { nodes } = buildAndPersist(aCandidate());
    const factor = byLabel(nodes, 'factor', PRICE);
    const os = factor.observed_state as { cap: number; unit: string };
    expect(levelOf(nodes, RAISE_54, PRICE)).toEqual({
      value: 54 / os.cap, raw_value: 54, unit: os.unit, source: 'cee_hypothesis', target_match: exactMatch(factor.id),
    });
  });

  it('the unit is the FACTOR’s, never the option’s spelling (the candidate says "GBP per month")', () => {
    const c = aCandidate();
    expect(c.options[1]!.interventions![0]!.unit, 'control: the option spells it differently').toBe('GBP per month');
    const { nodes } = buildAndPersist(c);
    expect(levelOf(nodes, RAISE_59, PRICE).unit).toBe((byLabel(nodes, 'factor', PRICE).observed_state as { unit: string }).unit);
  });
});

describe('(b) each writer of a framed level writes the same key-set', () => {
  it('build (admission) and add-option (A06, the agent-lane producer’s framed spec) agree on the keys', () => {
    const { nodes, edges } = buildAndPersist(aCandidate());
    const buildKeys = Object.keys(levelOf(nodes, RAISE_59, PRICE)).sort();
    const decision = nodes.find((n) => n.kind === 'decision')!;
    const factor = byLabel(nodes, 'factor', PRICE);
    // The spec `agent-capabilities.ts` sends for a framed level (served A06: `bb667b99.pro_plan_price`), with A06's
    // grandfathering switch beside it, as served, so it is not a twin of "£59 at release".
    const mrr = nodes.find((n) => n.kind === 'goal')!;
    const built = buildAddOptionsTransaction({
      parent_decision_id: decision.id, label: '£59 for new Pro customers; grandfather existing customers', option_id: 'bb667b99',
      new_factors: [{ key: 'gf', kind: 'switch', label: 'Existing-customer grandfathering', affects: [{ node_id: mrr.id, effect_direction: 'negative' }] }],
      interventions: [
        { factor_id: factor.id, value: 0.295, raw_value: 59, unit: 'GBP/month' },
        { factor_key: 'gf', value: 1, source: 'cee_hypothesis' },
      ],
    }, { nodes: nodes as never, edges: edges as never });
    expect(built.matched, JSON.stringify(built)).toBe(true);
    if (!built.matched) return;
    const addNode = built.operations[0]!.value as { interventions: Record<string, Record<string, unknown>> };
    const addKeys = Object.keys(addNode.interventions[factor.id]!).sort();
    expect(addKeys).toEqual(['raw_value', 'source', 'target_match', 'unit', 'value']);
    expect(buildKeys).toEqual(addKeys);
  });

  it('every framed level the build writes carries all five members (magnitude-checked)', () => {
    const { nodes } = buildAndPersist(aCandidate());
    let framed = 0;
    for (const o of nodes.filter((n) => n.kind === 'option')) {
      for (const [factorId, cell] of Object.entries(o.interventions ?? {})) {
        const f = nodes.find((n) => n.id === factorId)!;
        if (typeof (f.observed_state as { cap?: unknown } | undefined)?.cap !== 'number') continue;
        framed += 1;
        expect(Object.keys(cell as object).sort(), `${o.id} -> ${factorId}`).toEqual(['raw_value', 'source', 'target_match', 'unit', 'value']);
      }
    }
    expect(framed, 'both priced options were seen').toBe(2);
  });
});

describe('(c) CONTRAST — a level the contract makes different keeps its own shape', () => {
  it('a 0|1 SWITCH added with its option is a bare 1: no unit, no raw figure (and one carrying either is refused)', () => {
    const { nodes, edges } = buildAndPersist(aCandidate());
    const decision = nodes.find((n) => n.kind === 'decision')!;
    const mrr = nodes.find((n) => n.kind === 'goal')!;
    const spec = (level: Record<string, unknown>) => ({
      parent_decision_id: decision.id, label: 'Grandfather existing customers', option_id: 'gf000001',
      new_factors: [{ key: 'gf', kind: 'switch', label: 'Existing-customer grandfathering', affects: [{ node_id: mrr.id, effect_direction: 'negative' }] }],
      interventions: [{ factor_key: 'gf', ...level }],
    });
    const on = buildAddOptionsTransaction(spec({ value: 1, source: 'cee_hypothesis' }), { nodes: nodes as never, edges: edges as never });
    expect(on.matched, JSON.stringify(on)).toBe(true);
    if (!on.matched) return;
    const switchId = on.newFactors[0]!.id;
    const cell = (on.operations[0]!.value as { interventions: Record<string, unknown> }).interventions[switchId];
    expect(cell).toEqual({ value: 1, source: 'cee_hypothesis', target_match: exactMatch(switchId) });
    const withUnit = buildAddOptionsTransaction(spec({ value: 1, unit: 'on', raw_value: 1 }), { nodes: nodes as never, edges: edges as never });
    expect(withUnit).toMatchObject({ matched: false, reason: 'new_switch_not_switched_on' });
  });

  it('an UNFRAMED level (no range: the level is its own figure) keeps {value, source, target_match}', () => {
    const c = aCandidate();
    const withToggle: CandidateModel = {
      ...c,
      factors: [...c.factors, { label: 'AI features in release', role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance: 'explicit' }],
      options: c.options.map((o) => o.label !== RAISE_59 ? o
        : { ...o, interventions: [...o.interventions!, { factor_label: 'AI features in release', value: 1, provenance: 'explicit' }] }),
      links: [...c.links, { from: 'AI features in release', to: 'Pro paying subscribers at month 12', direction: 'positive', provenance: 'inferred' }],
    };
    const { nodes } = buildAndPersist(withToggle);
    const f = byLabel(nodes, 'factor', 'AI features in release');
    expect(f.observed_state, 'control: the factor has no frame at all').toBeUndefined();
    expect(levelOf(nodes, RAISE_59, 'AI features in release')).toEqual({ value: 1, source: 'brief_extraction', target_match: exactMatch(f.id) });
  });

  it('a level framed ONLY by the node’s scale_frame keeps no native pair (raw on a cap-less node changes the PLoT wire)', () => {
    const c = aCandidate();
    const withSpend: CandidateModel = {
      ...c,
      factors: [...c.factors, { label: 'Release marketing spend', role: 'controllable', baseline_known: false, baseline_value: null, unit: 'GBP', provenance: 'inferred', plausible_max: 100000 }],
      options: c.options.map((o) => o.label !== RAISE_54 ? o
        : { ...o, interventions: [...o.interventions!, { factor_label: 'Release marketing spend', value: 20000, unit: 'GBP', provenance: 'ai_proposed' }] }),
      links: [...c.links, { from: 'Release marketing spend', to: 'Pro paying subscribers at month 12', direction: 'positive', provenance: 'inferred' }],
    };
    const { nodes } = buildAndPersist(withSpend);
    const f = byLabel(nodes, 'factor', 'Release marketing spend');
    expect((f as { scale_frame?: unknown }).scale_frame, 'control: the frame lives on the node, not in an observed state').toBe(100000);
    expect(f.observed_state).toBeUndefined();
    expect(levelOf(nodes, RAISE_54, 'Release marketing spend')).toEqual({ value: 0.2, source: 'cee_hypothesis', target_match: exactMatch(f.id) });
  });
});

describe('(d) a later write still passes the stored-bytes scope guards', () => {
  it('the persisted build is a fixed point of the projection and of the absence-only guard base', () => {
    const persisted = buildAndPersist(aCandidate());
    expect(projectGraphForPersistence(persisted)).toEqual(persisted);
    expect(normaliseAbsenceOnly(persisted)).toEqual(persisted);
  });

  it('revising the £54 level commits (scope guard passes) and leaves the £59 cell’s bytes exactly as built', () => {
    const persisted = buildAndPersist(aCandidate());
    const factor = byLabel(persisted.nodes, 'factor', PRICE);
    const opt54 = byLabel(persisted.nodes, 'option', RAISE_54);
    const before59 = JSON.stringify(levelOf(persisted.nodes, RAISE_59, PRICE));
    const out = applyOptionInterventionEdit({
      persistedGraph: persisted, optionId: opt54.id, factorId: factor.id, modelValue: 0.26,
      expectedGraphHash: computeAnalysisAffectingGraphHash(persisted as never)!,
      scenarioId: SCENARIO, turnId: 'turn-revise-54', requestId: 'req-revise-54',
      freshness: 'none', hasExistingAnalysis: false,
    });
    expect(out.kind, JSON.stringify(out).slice(0, 300)).toBe('candidate');
    if (out.kind !== 'candidate') return;
    const after: readonly Node[] = out.graph.nodes;
    expect(levelOf(after, RAISE_54, PRICE)).toMatchObject({ value: 0.26, source: 'user_specified', target_match: exactMatch(factor.id) });
    expect(JSON.stringify(levelOf(after, RAISE_59, PRICE))).toBe(before59);
  });
});

describe('(e) the analysis hash of an unchanged graph is unchanged — nothing is filled at projection', () => {
  it('the SERVED short-form graph projects to itself, byte for byte, with the same hash', () => {
    const g = served();
    const { _provenance: _p, ...graph } = g as typeof g & { _provenance?: unknown };
    const parsed = GraphStateIngressSchema.parse(graph);
    const before = JSON.stringify(parsed);
    const hashBefore = computeAnalysisAffectingGraphHash(parsed as never);
    const projected = projectGraphForPersistence(parsed);
    expect(JSON.stringify(projected)).toBe(before);
    expect(computeAnalysisAffectingGraphHash(projected as never)).toBe(hashBefore);
    // and the served cell is still the short form: a stored level is only ever rewritten by a writer
    expect(levelOf(projected.nodes, RAISE_59, PRICE)).toEqual({ value: 0.295, source: 'brief_extraction' });
  });

  it('a graph built in the one form hashes the same after a second projection', () => {
    const persisted = buildAndPersist(aCandidate());
    const h = computeAnalysisAffectingGraphHash(persisted as never);
    expect(h).toBeTruthy();
    expect(computeAnalysisAffectingGraphHash(projectGraphForPersistence(persisted) as never)).toBe(h);
  });
});

describe('(f) the science guard: on the served A factors both forms reach PLoT as the same numbers', () => {
  it('the served short form and the one form emit the identical PLoT interventions', () => {
    const shortForm = served().nodes;
    const { nodes: oneForm } = buildAndPersist(aCandidate());
    const request = (nodes: readonly Node[]) => {
      const opts = nodes.filter((n) => n.kind === 'option' && n.interventions !== undefined && Object.keys(n.interventions).length > 0);
      return projectRequestInterventionsToWireScale(opts.map((o) => ({ ...o.interventions })), buildFactorScaleMap(nodes));
    };
    const a = request(shortForm);
    const b = request(oneForm);
    expect(a.perOption, 'control: the served request is not empty').toHaveLength(2);
    expect(b.perOption).toEqual(a.perOption);
    expect(b.mixedUnresolved).toBe(false);
  });
});
