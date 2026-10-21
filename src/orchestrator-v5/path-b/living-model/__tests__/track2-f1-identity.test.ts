/**
 * TRACK 2 F1 (21 Oct 2026), CEE half: a person's definitions ("total = UK + EU; revenue = total × price") through the
 * real mapper, the core persistence projection, the Run snapshot loader and `run_analysis`, up to the request PLoT
 * receives. With F1_OUT set, each request is written there for the PLoT → ISL half (`scripts/track2/run-f1.sh`).
 *
 * The spec (Living Model Richness, identity B): an identity states what a quantity IS, so a fully stated model keeps its
 * chance and no part of the identity is drawn or doubted; what cannot be worked out as stated is refused by name.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tool } from '@openai/agents';
import { describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { BuildModelParams } from '../../tools/draft-tool.js';
import { linkDefaultAssumptionsOf } from '../../../../cee/magnitude/link-default-assumptions.js';
import { goalChanceEstimateCounts } from '../../../agent-lane/goal-chance-estimate-attribution.js';
import { applyExplicitEdit } from '../edit.js';
import { applyKernel } from '../kernel.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER } from './fixtures.js';
import {
  F1_AT_LIMIT, F1_COARSE, F1_CONTRADICTED, F1_CYCLE, F1_DEFINED, F1_EXACT_LINKS, F1_INCONSISTENT, F1_LEVEL_NOT_MADE, F1_OLUMI_READING, F1_OTHER_CAUSE,
  F1_RESTATED, F1_STOCHASTIC_PART, F1_UNIT_MISMATCH,
} from './track2-f1-identity.fixtures.js';

type Rec = Record<string, any>;
const SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const stored = (model: LivingModelT): Rec => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(model).graph, living_model: model })) as Rec;

/** The real Run's PLoT request (as `engine-boundary.test.ts`), written to F1_OUT when set. */
async function requestTheRunSends(name: string, model: LivingModelT): Promise<Rec> {
  expect(LivingModel.safeParse(model).success, `${name} is a valid living model`).toBe(true);
  const graph = stored(model);
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, `f1-${name}`, {
    loadGraphAndBriefText: async () => ({ graph, briefText: null }), readMostRecentPendingActions: async () => [],
  } as never);
  let request: Rec | undefined;
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot,
    plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    probe: async (p: { plotPayload: Rec }) => { request = p.plotPayload; } } as never);
  const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: `f1-${name}`, kind: 'message', message: 'Run analysis.' },
    requestId: `f1-${name}`, signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  expect(request, JSON.stringify(outcome)).toBeDefined();
  const out = process.env.F1_OUT;
  if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, `${name}.cee-to-plot.json`), JSON.stringify(request, null, 2)); }
  return request!;
}

/**
 * A negative row, checked at both ends (the twin of F2's, codex integration review 3: accepting any readiness error never
 * reached the threshold). At the source, the mapper's goal carries no threshold. At the Run, the outcome is exactly the
 * one named: refused with those readiness codes, or sent with no threshold.
 */
async function noChanceSent(name: string, model: LivingModelT, run: 'sent' | 'ORPHAN_NODE,NO_PATH_TO_GOAL' | 'NO_PATH_TO_GOAL'): Promise<void> {
  const goal = (mapLivingModel(model).graph.nodes as Rec[]).find((n) => n.kind === 'goal')!;
  expect(goal, name).not.toHaveProperty('goal_threshold_raw');
  expect(goal, name).not.toHaveProperty('goal_threshold');
  const sent = await requestTheRunSends(name, model).then((r) => r, (e: Error) => e.message);
  if (run !== 'sent') expect(sent, name).toBe(`Persisted graph is not analysis-ready: ${run}`);
  else if (typeof sent === 'string') expect.fail(`${name}: expected the Run to reach PLoT, got "${sent}"`);
  else expect(goalOf(sent), name).not.toHaveProperty('goal_threshold_raw');
}

const node = (r: Rec, id: string) => (r.graph.nodes as Rec[]).find((n) => n.id === id)!;
const goalOf = (r: Rec) => node(r, r.goal_node_id);
const reasons = (m: LivingModelT) => mapLivingModel(m).withheld.map((w) => `${w.id}:${w.reason}`);

describe('Track 2 F1: a defined quantity reaches the engine as its definition, with its chance', () => {
  it('fine: total = UK + EU and revenue = total × price reach the engine exact, the parts held, the £6,500 chance kept', async () => {
    expect(reasons(F1_DEFINED)).toEqual([]);
    const r = await requestTheRunSends('fine', F1_DEFINED);
    expect(goalOf(r).goal_threshold_raw).toBe(6500);
    expect(node(r, 'total').nonlinear_identity).toEqual({ operation: 'sum', factor_ids: ['uk', 'eu'], stated_in_brief: true });
    expect(node(r, 'rev').nonlinear_identity).toEqual({ operation: 'product', factor_ids: ['total', 'price'], stated_in_brief: true });
    for (const [from, to] of [['uk', 'total'], ['eu', 'total'], ['total', 'rev'], ['price', 'rev']]) {
      const parts = (r.graph.edges as Rec[]).filter((e) => e.from === from && e.to === to);
      expect(parts, `${from}→${to}`).toHaveLength(1);
      expect(parts[0]).toMatchObject({ exists_probability: 1, strength: { mean: 1 }, provenance: { definitional: true, magnitude: 'user_stated' } });
    }
  });

  it('at the limit: a goal of exactly the defined figure (£6,800) keeps its threshold', async () => {
    expect(goalOf(await requestTheRunSends('at-limit', F1_AT_LIMIT)).goal_threshold_raw).toBe(6800);
  });

  it('coarse: the same reasoning with total customers as the lever keeps its threshold too', async () => {
    expect(reasons(F1_COARSE)).toEqual([]);
    expect(goalOf(await requestTheRunSends('coarse', F1_COARSE)).goal_threshold_raw).toBe(6500);
  });

  it('restated: the person\'s own exact links between the same items are kept in the living model and never counted twice', async () => {
    expect(reasons(F1_RESTATED)).toEqual(['uk_total:identity_restated', 'eu_total:identity_restated']);
    const r = await requestTheRunSends('restated', F1_RESTATED);
    expect(goalOf(r).goal_threshold_raw).toBe(6500);
    expect((r.graph.edges as Rec[]).filter((e) => e.to === 'total')).toHaveLength(2);
  });

  it('CONTROL (unchanged): the breakdown written only as exact links still withholds the chance (exact_not_drawable)', async () => {
    expect(reasons(F1_EXACT_LINKS)).toContain('rev:chance_rests_on_withheld');
    expect(goalOf(await requestTheRunSends('exact-links', F1_EXACT_LINKS)).goal_threshold_raw).toBeUndefined();
  });

  it('NEGATIVE: a missing component is refused by name, never filled: a part with no level, or a definition that leaves one out', async () => {
    const noEu: LivingModelT = { ...F1_DEFINED, factors: F1_DEFINED.factors.map((f) => (f.id === 'eu' ? { ...f, value: null } : f)) };
    expect(reasons(noEu)).toEqual(expect.arrayContaining(['total:identity_part_unknown', 'rev:chance_rests_on_withheld']));
    await noChanceSent('missing-part-level', noEu, 'ORPHAN_NODE,NO_PATH_TO_GOAL');
    // A definition that leaves a part out: 20 customers elsewhere, total stated 170, but defined as UK + EU (150).
    const leftOut: LivingModelT = { ...F1_DEFINED, factors: [...F1_DEFINED.factors.map((f) => (f.id === 'total' ? { ...f, value: 170 } : f)),
      { id: 'row', label: 'Customers elsewhere', value: 20, low: null, high: null, unit: 'customers', defined_as: null, source: 'user', party: null, quote: '20 elsewhere' }] };
    expect(reasons(leftOut)).toEqual(expect.arrayContaining(['total:identity_inconsistent', 'rev:chance_rests_on_withheld']));
    await noChanceSent('missing-part', leftOut, 'ORPHAN_NODE,NO_PATH_TO_GOAL');
  });

  it('NEGATIVE: £ per ORDER × customers is not £, so the definition is refused by name and the chance withheld', async () => {
    expect(reasons(F1_UNIT_MISMATCH)).toEqual(['rev:identity_unit_mismatch', 'rev:chance_rests_on_withheld']);
    expect(mapLivingModel(F1_UNIT_MISMATCH).graph.nodes.find((n) => n.id === 'rev')!.nonlinear_identity).toBeUndefined();
    await noChanceSent('unit-mismatch', F1_UNIT_MISMATCH, 'ORPHAN_NODE,NO_PATH_TO_GOAL');
  });

  it('NEGATIVE: a cause into the defined total itself is one the definition leaves out, so the chance is withheld', async () => {
    expect(reasons(F1_OTHER_CAUSE)).toContain('mkt_total:identity_other_cause');
    await noChanceSent('other-cause', F1_OTHER_CAUSE, 'NO_PATH_TO_GOAL');
  });

  it('NEGATIVE CONTROL: a stated point cause into a PART keeps its drawn spread; only the definition is exact', async () => {
    const r = await requestTheRunSends('stochastic', F1_STOCHASTIC_PART);
    expect(goalOf(r).goal_threshold_raw).toBe(6500);
    const link = (r.graph.edges as Rec[]).find((e) => e.from === 'mkt' && e.to === 'uk')!;
    expect(link.strength.std).toBeCloseTo(Math.abs(link.strength.mean) / 2, 10);
    expect(link.provenance?.definitional).not.toBe(true);
  });

  it('NEGATIVE: a stated level its parts do not make is refused by name (160 ≠ UK + EU; £6,100 ≠ 150 × £40), never rescaled', async () => {
    expect(reasons(F1_INCONSISTENT)).toContain('total:identity_inconsistent');
    await noChanceSent('inconsistent', F1_INCONSISTENT, 'ORPHAN_NODE,NO_PATH_TO_GOAL');
    expect(reasons(F1_LEVEL_NOT_MADE)).toEqual(['rev:identity_inconsistent', 'rev:chance_rests_on_withheld']);
    await noChanceSent('level-not-made', F1_LEVEL_NOT_MADE, 'ORPHAN_NODE,NO_PATH_TO_GOAL');
  });

  it('NEGATIVE: a person\'s link that contradicts the definition (UK → total at −2) withholds the chance; it is never dropped', async () => {
    expect(reasons(F1_CONTRADICTED)).toEqual(['uk_total:identity_contradicted', 'rev:chance_rests_on_withheld']);
    await noChanceSent('contradicted', F1_CONTRADICTED, 'sent');
  });

  it('NEGATIVE (buddy r2): a part\'s link with its OWN stated spread (Normal σ 0.2; a range 0.8–1.2) contradicts an exact definition', () => {
    const uncertain = (effect: LivingModelT['links'][number]['effect']): LivingModelT => ({ ...F1_DEFINED,
      links: [{ id: 'uk_total', from: 'uk', to: 'total', source: 'user', party: null, quote: 'about one each', effect }] });
    expect(reasons(uncertain({ form: 'normal', value: 1, sd: 0.2, low: null, high: null, unit: 'customers', sign: '+' })))
      .toEqual(['uk_total:identity_contradicted', 'rev:chance_rests_on_withheld']);
    expect(reasons(uncertain({ form: 'range', value: 1, sd: null, low: 0.8, high: 1.2, unit: 'customers', sign: '+' })))
      .toEqual(['uk_total:identity_contradicted', 'rev:chance_rests_on_withheld']);
    // CONTROL: the same link stated exactly, or as a bare point (its σ is Olumi's convention, not the person's), restates it.
    expect(reasons(uncertain({ form: 'exact', value: 1, sd: null, low: null, high: null, unit: 'customers', sign: '+' }))).toEqual(['uk_total:identity_restated']);
    expect(reasons(uncertain({ form: 'point', value: 1, sd: null, low: null, high: null, unit: 'customers', sign: '+' }))).toEqual(['uk_total:identity_restated']);
  });

  it('a definition saved without its own attribution (buddy r2) still parses, and reads as unverified: no one\'s yet', () => {
    const saved = structuredClone(F1_DEFINED) as Rec;
    saved.factors[2].defined_as = { op: 'sum', of: ['uk', 'eu'] };
    const parsed = LivingModel.parse(saved);
    expect(parsed.factors[2]!.defined_as).toEqual({ op: 'sum', of: ['uk', 'eu'], source: 'unverified', party: null, quote: null });
    expect((mapLivingModel(parsed).graph.nodes.find((n) => n.id === 'total') as Rec).nonlinear_identity.stated_in_brief).toBe(false);
  });

  it('NEGATIVE: definitions defined by each other are refused, never sent', async () => {
    expect(reasons(F1_CYCLE)).toEqual(expect.arrayContaining(['total:identity_not_in_slice', 'rest:identity_not_in_slice', 'rev:chance_rests_on_withheld']));
    await noChanceSent('cycle', F1_CYCLE, 'ORPHAN_NODE,NO_PATH_TO_GOAL');
  });

  it('AUTHOR: a definition is the brief\'s only when the person stated the DEFINITION; Olumi\'s reading and an unverified one are not', async () => {
    const goal = (m: LivingModelT) => mapLivingModel(m).graph.nodes.find((n) => n.id === 'rev') as Rec;
    const parts = (m: LivingModelT) => (mapLivingModel(m).graph.edges as Rec[]).filter((e) => e.to === 'rev').map((e) => e.provenance);
    expect(goal(F1_DEFINED).nonlinear_identity.stated_in_brief).toBe(true);
    expect(goal(F1_OLUMI_READING).nonlinear_identity.stated_in_brief).toBe(false);
    expect(parts(F1_OLUMI_READING)).toEqual([{ source: 'cee_hypothesis', magnitude: 'olumi_estimate', definitional: true },
      { source: 'cee_hypothesis', magnitude: 'olumi_estimate', definitional: true }]);
    // Sent as Olumi's reading (F1_OUT: PLoT withdraws an inferred goal product, and its parts must not stay pinned).
    expect(goalOf(await requestTheRunSends('olumi-reading', F1_OLUMI_READING)).nonlinear_identity.stated_in_brief).toBe(false);
    // The kernel: the goal's words are found, the definition's are not, so the DEFINITION alone is unverified (no one's yet).
    const { model, relabelled } = applyKernel(F1_DEFINED, ['we need at least £6,500 a month; today it is £6,000', 'we have 100 UK customers',
      'and 50 in the EU', 'each pays £40 a month', 'so 150 customers in total', 'total customers is UK plus EU', 'grow the UK to 120 customers', 'or we carry on as now']);
    expect(relabelled).toEqual([{ id: 'rev:defined_as', was: 'user' }]);
    expect(model.aims[0]!.source).toBe('user');
    expect(goal(model).nonlinear_identity.stated_in_brief).toBe(false);
    expect(parts(model)).toEqual([{ definitional: true }, { definitional: true }]);
  });

  it('POSITIVE CONTROL: the Batch 0 known answer keeps its threshold (the chain can show a chance when one exists)', async () => {
    expect(goalOf(await requestTheRunSends('control', KNOWN_ANSWER)).goal_threshold_raw).toBe(100);
  });

  it('the kernel rewrites a definition\'s ids with the items it names', () => {
    const raw = structuredClone(F1_DEFINED);
    raw.factors[0]!.id = 'UK Customers';
    raw.factors[2]!.defined_as = { ...raw.factors[2]!.defined_as!, of: ['UK Customers', 'eu'] };
    const { model } = applyKernel(raw, []);
    expect(model.factors[0]!.id).toBe('uk_customers');
    expect(model.factors[2]!.defined_as).toMatchObject({ op: 'sum', of: ['uk_customers', 'eu'] });
  });

  it('the definition reaches the AI in the strict tool schema it is sent, and a model saved before reads it as null', () => {
    const sent = JSON.stringify(tool({ name: 'build_model_from_brief', description: 'd', parameters: BuildModelParams, execute: async () => '' }).parameters);
    expect(sent).toContain('A definition, not a cause, so add no links from those factors to it.');
    expect(sent).toContain('its quote is their words for the definition itself');
    const before = structuredClone(KNOWN_ANSWER) as Rec;
    delete before.factors[0].defined_as;
    delete before.aims[0].defined_as;
    const parsed = LivingModel.parse(before);
    expect(parsed.factors[0]!.defined_as).toBeNull();
    expect(parsed.aims[0]!.defined_as).toBeNull();
  });
  // Science 21 Oct (#3544): a stated effect asserts its link exists, so no Olumi existence default is applied. A definition
  // is exact: its parts are the quantity, never drawn in or out. So its edges exist (1) whoever stated it, and whose it
  // is shows in its provenance and in `stated_in_brief`, never as a default that would drop a part in some draws.
  it('#3544 existence rule: a definition\'s parts exist with no Olumi default; whose definition it is shows in its provenance', () => {
    const parts = (m: LivingModelT) => (mapLivingModel(m).graph.edges as Rec[]).filter((e) => e.provenance?.definitional === true);
    for (const e of parts(F1_DEFINED)) {
      expect(e.exists_probability, `${e.from}->${e.to}`).toBe(1);
      expect(linkDefaultAssumptionsOf(e).map((r) => r.code), `${e.from}->${e.to}`).not.toContain('DEFAULT_EXISTS_PROBABILITY');
      expect(e.provenance.magnitude).toBe('user_stated');
    }
    expect(goalChanceEstimateCounts(mapLivingModel(F1_DEFINED).graph, ['hold', 'grow_uk'], 'rev'))
      .toMatchObject({ unverifiedLinks: 0, unverifiedValues: 0, unverifiedSettingsByOption: {} });
    // CONTRAST: Olumi's reading of the product is Olumi's, said by provenance and the identity's own flag.
    const olumis = parts(F1_OLUMI_READING).filter((e) => e.to === 'rev');
    expect(olumis.map((e) => [e.exists_probability, e.provenance.magnitude])).toEqual([[1, 'olumi_estimate'], [1, 'olumi_estimate']]);
    expect((mapLivingModel(F1_OLUMI_READING).graph.nodes as Rec[]).find((n) => n.id === 'rev')!.nonlinear_identity.stated_in_brief).toBe(false);
  });
  // Codex integration review (21 Oct), item 2: the canvas delete of a definition's edge was acknowledged, then redrawn
  // from `defined_as` on regeneration: a false "saved". It is refused by name; the model is unchanged.
  it('a canvas delete of a definition\'s edge is refused by name, never acknowledged and redrawn', () => {
    const del = (removed_node_ids: string[], removed_edges: { from: string; to: string }[]) =>
      applyExplicitEdit(F1_DEFINED, { kind: 'structural_delete', removed_node_ids, removed_edges }, 'rev');
    expect(del([], [{ from: 'uk', to: 'total' }])).toEqual({ refused: 'link_is_definition' });
    // CONTROL: an ordinary stated link is deleted as before.
    const plain = applyExplicitEdit(KNOWN_ANSWER, { kind: 'structural_delete', removed_node_ids: [], removed_edges: [{ from: 'f', to: 'g' }] });
    expect('model' in plain && plain.model.links.map((l) => l.id)).toEqual([]);
    // CONTROL: deleting the part itself applies, and the definition that names it is then refused by name, never redrawn.
    const noEu = del(['eu'], [{ from: 'eu', to: 'total' }]);
    expect('model' in noEu).toBe(true);
    if ('model' in noEu) expect(mapLivingModel(noEu.model, { goal: 'rev' }).withheld).toContainEqual({ id: 'total', reason: 'identity_not_in_slice' });
  });
});
