/**
 * TRACK 2 F2 (21 Oct 2026), CEE half: an event that may happen within a window ("a 5–15% chance our key supplier fails
 * within 12 months"), stated on the core living model, through the real mapper, the stored projection and the Run
 * handler, up to the request PLoT receives (F1_OUT: written for the PLoT → ISL half, `scripts/track2/run-chain.sh`).
 * The engine contract is ISL's `event_risk.v1` (#228): PLoT and ISL need nothing new.
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
import { diffLivingModels } from '../diff.js';
import { applyKernel } from '../kernel.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER } from './fixtures.js';
import {
  CASCADE, CERTAIN_WITHIN_WINDOW, HALF_MITIGATION, NO_CHANCE, NO_WINDOW, OLUMI_CHANCE, PERCENT_PREVENTER, SHARED_PREVENTER, UNATTRIBUTED, supplier,
} from './track2-f2-event-risk.fixtures.js';

type Rec = Record<string, any>;
const SCENARIO = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const stored = (model: LivingModelT): Rec => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(model).graph, living_model: model })) as Rec;

async function requestTheRunSends(name: string, model: LivingModelT): Promise<Rec> {
  expect(LivingModel.safeParse(model).success, `${name} is a valid living model`).toBe(true);
  const graph = stored(model);
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, `f2-${name}`, {
    loadGraphAndBriefText: async () => ({ graph, briefText: null }), readMostRecentPendingActions: async () => [],
  } as never);
  let request: Rec | undefined;
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot, plotClient: { run: vi.fn(), validatePatch: vi.fn() } as never,
    probe: async (p: { plotPayload: Rec }) => { request = p.plotPayload; } } as never);
  const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: `f2-${name}`, kind: 'message', message: 'Run analysis.' },
    requestId: `f2-${name}`, signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  expect(request, JSON.stringify(outcome)).toBeDefined();
  const out = process.env.F1_OUT;
  if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, `${name}.cee-to-plot.json`), JSON.stringify(request, null, 2)); }
  return request!;
}

/** A negative row: the Run is refused (nothing reaches PLoT), or it reaches PLoT with no threshold. Never a chance. */
async function noChanceSent(name: string, model: LivingModelT): Promise<void> {
  const sent = await requestTheRunSends(name, model).catch((e: Error) => e);
  if (sent instanceof Error) expect(sent.message).toMatch(/not analysis-ready|valid living model/);
  else expect((sent.graph.nodes as Rec[]).find((n) => n.id === sent.goal_node_id)!.goal_threshold_raw).toBeUndefined();
}

const node = (r: Rec, id: string) => (r.graph.nodes as Rec[]).find((n) => n.id === id)!;
const reasons = (m: LivingModelT) => mapLivingModel(m).withheld.map((w) => `${w.id}:${w.reason}`);

describe('Track 2 F2: an event risk reaches the engine as event_risk.v1, with its chance', () => {
  it('point statements: the risk reaches the engine as an event with its stated chance, window and mitigation', async () => {
    expect(reasons(supplier('point'))).toEqual([]);
    const r = await requestTheRunSends('point', supplier('point'));
    expect(node(r, 'supplier_fails')).toMatchObject({ kind: 'risk', event_risk: { version: 1,
      occurrence: { p_low: 0.05, p_high: 0.15, basis: 'user' }, horizon: { months: 12 },
      mitigations: [{ factor_id: 'dual_sourcing', occurrence_reduction: 0.7 }] } });
    const severity = (r.graph.edges as Rec[]).find((e) => e.from === 'supplier_fails' && e.to === 'gp')!;
    expect(severity).toMatchObject({ exists_probability: 1, provenance: { natural_effect: { amount: -8000 } } });
    expect((r.graph.edges as Rec[]).some((e) => e.from === 'dual_sourcing' && e.to === 'supplier_fails')).toBe(true);
    // CONTRAST for every negative below: here the threshold IS sent, so a missing one there is the risk's refusal, not the goal's.
    expect(node(r, r.goal_node_id)).toMatchObject({ goal_direction: '>=', goal_threshold_raw: 12000 });
  });

  // RULE 1, ruled (Science 21 Oct; CEE #3540 "stay within"): a floor that today's level already clears is a goal, scored on
  // its level at the end of the period. F2 goes THROUGH that path, never around it: the aim is the person's own, their words
  // carry the at-least cue, and the end-of-period reading is said beside it.
  it('a protective floor today already clears is kept as the goal (#3540), on the person\'s own aim and words', () => {
    const out = mapLivingModel(supplier('point'));
    expect(out.withheld).toEqual([]);
    expect((out.graph.nodes as Rec[]).find((n) => n.id === 'gp')).toMatchObject({ goal_direction: '>=', goal_threshold_raw: 12000,
      observed_state: { raw_value: 16000 } });
    expect(out.assumed.map((a) => a.id)).toEqual(['gp']);
    expect(out.assumed[0]!.text).toMatch(/The chance is for its level at the end of the period, not along the way\.$/);
  });

  // The threshold still travels, but with no level today PLoT cannot convert it, so no chance is given (the chain's
  // no-cue row: GOAL_THRESHOLD_NOT_CONVERTIBLE, outcomes present, probability_of_goal absent for both options).
  it('NEGATIVE (no bypass): with no keep or at-least cue in their words, Olumi asks about the floor; no level today is sent', async () => {
    const noCue: LivingModelT = { ...supplier('point'), aims: [{ ...supplier('point').aims[0]!, quote: 'gross profit should be £12k or more; today it is £16k' }] };
    expect(reasons(noCue)).toEqual(['gp:stay_within_unconfirmed']);
    expect(mapLivingModel(noCue).assumed).toEqual([]);
    const r = await requestTheRunSends('no-cue', noCue);
    expect(node(r, r.goal_node_id)).not.toHaveProperty('observed_state');
  });

  it('exact statements: written for the chain (the DL\'s 0.900 / 0.970 row); today\'s rule withholds an exact drawn link', async () => {
    expect(reasons(supplier('exact'))).toEqual(expect.arrayContaining(['fails_gp:exact_not_drawable', 'cost_gp:exact_not_drawable']));
    await requestTheRunSends('exact', supplier('exact')).catch(() => undefined);
  });

  it('certain within its window (p = 1) is an event ISL evaluates: sent as stated, never refused', async () => {
    expect(reasons(CERTAIN_WITHIN_WINDOW)).toEqual([]);
    const r = await requestTheRunSends('certain', CERTAIN_WITHIN_WINDOW);
    expect(node(r, 'supplier_fails').event_risk.occurrence).toEqual({ p_low: 1, p_high: 1, basis: 'user' });
  });

  it('§3C: a present condition is never a risk. The AI is told so (schema row below); a chance only Olumi gave is sent as Olumi\'s', async () => {
    expect(reasons(OLUMI_CHANCE)).toEqual([]);
    const r = await requestTheRunSends('olumi-chance', OLUMI_CHANCE);
    expect(node(r, 'supplier_fails').event_risk.occurrence.basis).toBe('olumi');
    expect((r.graph.edges as Rec[]).find((e) => e.from === 'dual_sourcing' && e.to === 'supplier_fails')!.provenance)
      .toMatchObject({ source: 'cee_hypothesis', magnitude: 'olumi_estimate' });
  });

  it('NEGATIVE (buddy r1): a switch preventing two risks, or a switch in %, is refused by name before ISL sees it', async () => {
    expect(reasons(SHARED_PREVENTER)).toEqual(expect.arrayContaining(['supplier_fails:risk_not_in_slice', 'port_strike:risk_not_in_slice']));
    expect(reasons(PERCENT_PREVENTER)).toEqual(expect.arrayContaining(['supplier_fails:risk_not_in_slice', 'gp:chance_rests_on_withheld']));
    await noChanceSent('shared-preventer', SHARED_PREVENTER);
    await noChanceSent('percent-preventer', PERCENT_PREVENTER);
  });

  it('NEGATIVE: an unstated chance or window is never guessed; unverified words are no one\'s', async () => {
    expect(reasons(NO_CHANCE)).toEqual(['supplier_fails:risk_occurrence_unknown', 'gp:chance_rests_on_withheld']);
    expect(reasons(NO_WINDOW)).toEqual(['supplier_fails:risk_occurrence_unknown', 'gp:chance_rests_on_withheld']);
    expect(reasons(UNATTRIBUTED)).toEqual(['supplier_fails:risk_unattributed', 'gp:chance_rests_on_withheld']);
    for (const [name, m] of [['no-chance', NO_CHANCE], ['no-window', NO_WINDOW], ['unattributed', UNATTRIBUTED]] as const) await noChanceSent(name, m);
  });

  it('NEGATIVE (§9): a cause into the event (a cascade) and a half-measure mitigation are not in this slice', async () => {
    expect(reasons(CASCADE)).toEqual(expect.arrayContaining(['demand_fails:risk_not_in_slice', 'gp:chance_rests_on_withheld']));
    expect(reasons(HALF_MITIGATION)).toEqual(expect.arrayContaining(['supplier_fails:risk_not_in_slice', 'gp:chance_rests_on_withheld']));
    await noChanceSent('cascade', CASCADE);
    await noChanceSent('half-mitigation', HALF_MITIGATION);
  });

  it('POSITIVE CONTROL: the Batch 0 known answer, with no risks, keeps its threshold (the chain can show a chance)', async () => {
    expect(node(await requestTheRunSends('control', KNOWN_ANSWER), 'g').goal_threshold_raw).toBe(100);
  });

  it('the kernel rewrites a risk\'s ids and checks its words; the proposal\'s diff names a changed risk', () => {
    const raw = structuredClone(supplier('point'));
    raw.factors[0]!.id = 'Dual Sourcing';
    raw.options[1]!.settings[0]!.factor_id = 'Dual Sourcing';
    raw.risks[0]!.mitigations[0]!.factor_id = 'Dual Sourcing';
    const { model, relabelled } = applyKernel(raw, ['we need at least £12k a month; today it is £16k']);
    expect(model.risks[0]!.mitigations[0]!.factor_id).toBe('dual_sourcing');
    expect(relabelled).toContainEqual({ id: 'supplier_fails', was: 'user' });
    const lower = { ...supplier('point'), risks: [{ ...supplier('point').risks[0]!, occurrence: { low: 0.05, high: 0.1 } }] };
    expect(diffLivingModels(supplier('point'), lower).map((c) => `${c.kind}:${c.id}:${c.change}`)).toEqual(['risk:supplier_fails:change']);
  });

  it('the AI is told an event is not a present condition; a model saved before risks reads none', () => {
    const sent = JSON.stringify(tool({ name: 'build_model_from_brief', description: 'd', parameters: BuildModelParams, execute: async () => '' }).parameters);
    expect(sent).toContain('a present condition (\\"we lack marketing experience\\") is a factor at its current level, never a risk');
    const before = structuredClone(KNOWN_ANSWER) as Rec;
    delete before.risks;
    expect(LivingModel.parse(before).risks).toEqual([]);
  });
});
