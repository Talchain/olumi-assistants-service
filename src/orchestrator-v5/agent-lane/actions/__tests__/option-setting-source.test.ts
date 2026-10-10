import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphV3, InterventionV3, OptionV3 } from '../../../../schemas/cee-v3.js';
import { ExtractionMetadata, OptionForAnalysis } from '../../../../schemas/analysis-ready.js';
import { transformOptionToAnalysisReady } from '../../../../cee/transforms/analysis-ready.js';
import { OptionForAnalysisSchema } from '@talchain/schemas';
import { EMPTY_DECISION_CONTEXT, TurnContextSchema } from '@talchain/schemas/orchestrator';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { EMPTY_COACHING_STATE } from '../../../coaching/coaching-state.js';
import { EMPTY_COACHING_LIFECYCLE } from '../../../coaching/coaching-lifecycle.js';
import { deriveAnalysisFreshness } from '../../../context/freshness.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import type { RunAnalysisProbeInput } from '../../../tools/handlers/run-analysis-probe.js';
import { encodeOptionInterventionsForEdit } from '../../../../orchestrator/tools/encode-option-interventions.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import * as census from '../../olumi-estimates-feeding-result.js';
import { actionFactsOf, type ActionRead } from '../state.js';
import { admitCandidateModel, type CandidateModel } from '../../admit-model.js';
import { verifiedFactorLevel, verifiedOptionSetting, verifiedOptionTotal } from '../../verified-option-setting.js';
import { prepareProvisionalCandidate } from '../../runtime/build-model.js';

function graph(source?: string) {
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'MRR' },
      { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: 'GBP', source: 'user_edited' } },
      { id: 'raise', kind: 'option', label: 'Raise price', interventions: { price: { value: 0.59, raw_value: 59, unit: 'GBP', ...(source === undefined ? {} : { source }) } } },
    ],
    edges: [{ from: 'price', to: 'goal', exists_probability: 1, strength: { mean: 0.5, std: 0.1 }, effect_direction: 'positive' }],
  };
}

function readSettings(input: unknown) {
  const cold = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(input))));
  const hash = computeAnalysisAffectingGraphHash(cold);
  if (hash === null) throw new Error('Expected graph hash');
  const read: ActionRead = {
    scenarioId: '7d2e3f40-5b6c-4d7e-8f90-a1b2c3d4e5f6', graph: cold, graphHash: hash,
    analysisState: { run_state: { kind: 'complete_current', computed_at: '2026-10-07T12:00:00.000Z' }, usable_for_chips: true,
      leader_claim: { permitted: false, withheld_reason: 'goal_path_unsized' } },
    analysisReady: { status: 'ready', may_run: true },
    analysisResult: { type: 'analysis_result', computed_against_hash: hash, data: {} },
  };
  // Observe the actual state reader's inputs to its existing census; no replacement classifier.
  const spy = vi.spyOn(census, 'olumiEstimatesFeedingResult');
  const facts = actionFactsOf(read);
  expect(facts.readable).toBe(true);
  expect(facts.runBound).toBe(true);
  expect(spy).toHaveBeenCalledOnce();
  return { settings: spy.mock.calls[0]![0].optionSettings, cold, facts };
}

afterEach(() => vi.restoreAllMocks());

describe('action readback keeps intervention authorship honest before source relaxation', () => {
  it('source-less native quantity survives reload as unknown, never user or AI', () => {
    const { settings, cold, facts } = readSettings(graph());
    expect(settings).toStrictEqual([{ id: 'raise:price', label: 'Price under Raise price', authorship: 'unknown' }]);
    const cell = cold.nodes.find(n => n.id === 'raise')!.interventions!.price;
    expect(cell).toMatchObject({ value: 0.59, raw_value: 59, unit: 'GBP' });
    expect(cell).not.toHaveProperty('source');
    expect(facts.olumiEstimates?.count).toBe(0);
  });

  it.each([['brief_extraction', 'user'], ['user_specified', 'user'], ['cee_hypothesis', 'olumi_estimate']])(
    'preserves %s through the existing state reader', (source, authorship) => {
      const { settings } = readSettings(graph(source));
      expect(settings).toStrictEqual([{ id: 'raise:price', label: 'Price under Raise price', authorship }]);
    },
  );

  it('an exact human-approved cell stays user-owned through the existing encoder and reload', () => {
    const approved = encodeOptionInterventionsForEdit(graph(), new Set(['raise']), undefined, [{ optionId: 'raise', factorId: 'price' }]);
    const { settings, cold } = readSettings(approved.graph);
    expect(settings).toStrictEqual([{ id: 'raise:price', label: 'Price under Raise price', authorship: 'user' }]);
    expect(cold.nodes.find(n => n.id === 'raise')!.interventions!.price).toMatchObject({ value: 0.59, raw_value: 59, unit: 'GBP', source: 'user_specified' });
  });

  it('a source-less recovered quantity traverses the builder and reloads as unknown', () => {
    const initial = graph();
    const input = { ...initial, nodes: [initial.nodes[0]!, initial.nodes[1]!,
      { id: 'raise', kind: 'option', label: 'Raise price', data: { interventions: {
        price: { value: 0.59, raw_value: 59, unit: 'GBP' },
      } } }],
    };
    const encoded = encodeOptionInterventionsForEdit(input, new Set(['raise']));
    expect(encoded.unresolvedOptionIds).toStrictEqual([]);
    const { settings, cold } = readSettings(encoded.graph);
    const cell = cold.nodes.find(n => n.id === 'raise')!.interventions!.price;
    expect(cell).toMatchObject({ value: 0.59, raw_value: 59, unit: 'GBP',
      target_match: { node_id: 'price', match_type: 'exact_id', confidence: 'high' } });
    expect(cell).not.toHaveProperty('source');
    expect(settings).toStrictEqual([{ id: 'raise:price', label: 'Price under Raise price', authorship: 'unknown' }]);
  });

  it('a junk source gets no user-authorship fact and leaves its native quantity untouched', () => {
    const { settings, cold } = readSettings(graph('not_a_source'));
    expect(settings).toStrictEqual([]);
    expect(cold.nodes.find(n => n.id === 'raise')!.interventions!.price).toMatchObject({ value: 0.59, raw_value: 59, source: 'not_a_source' });
  });
});


describe('optional provenance boundaries retain unattributed quantities through Run egress', () => {
  it.each(['unknown', 'approved human'] as const)('%s: native → strict → engine payload → reload', async origin => {
    const input = graph();
    const option = input.nodes.find(n => n.id === 'raise')!;
    if (!option.interventions) throw new Error('Expected option interventions');
    const native = GraphV3.parse({ ...input, nodes: input.nodes.map(n => n.id === 'raise' ? {
      ...n, interventions: { price: { ...option.interventions.price,
        target_match: { node_id: 'price', match_type: 'exact_id', confidence: 'high' },
        value_confidence: 'medium', reasoning: 'Retained quantity reasoning' } },
    } : n) });
    const encoded = encodeOptionInterventionsForEdit(native, new Set(['raise']), undefined,
      origin === 'approved human' ? [{ optionId: 'raise', factorId: 'price' }] : []);
    const canonical = GraphV3.parse(encoded.graph);
    const cell = canonical.nodes.find(n => n.id === 'raise')!.interventions!.price;
    const strict = InterventionV3.parse(cell);
    expect(strict).toMatchObject({ value: 0.59, raw_value: 59, unit: 'GBP',
      value_confidence: 'medium', reasoning: 'Retained quantity reasoning' });
    expect(strict.source).toBe(origin === 'approved human' ? 'user_specified' : undefined);
    if (origin === 'unknown') expect(strict).not.toHaveProperty('source');

    // Structural option authorship is not authority for an unattributed numeric setting.
    const ready = OptionForAnalysis.parse(transformOptionToAnalysisReady(OptionV3.parse({
      id: 'raise', label: 'Raise price', status: 'ready', interventions: { price: strict },
      provenance: { source: 'user_specified' },
    })));
    const metadata = ExtractionMetadata.parse(ready.extraction_metadata);
    expect(metadata).toMatchObject({ confidence: 'medium', reasoning: 'Retained quantity reasoning' });
    expect(metadata.source).toBe(strict.source);
    expect(ready.interventions).toStrictEqual({ price: 0.59 });
    expect(ready.raw_interventions).toStrictEqual({ price: 59 });

    const captured: RunAnalysisProbeInput[] = [];
    const run = vi.fn(async () => { throw new Error('No engine transport permitted'); });
    const validatePatch = vi.fn(async () => { throw new Error('No engine transport permitted'); });
    const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch },
      scenarioReader: async () => ({ graph: canonical, rawPersistedGraph: canonical, goal_node_id: 'goal',
        options: [{ ...ready, interventions: { price: strict } }] }),
      probe: async sent => { captured.push(sent); },
    });
    const requestId = 'req-optional-source';
    const context = { ...TurnContextSchema.parse({ stage: 'analyse',
      entity_registry: { option_ids: ['raise'], goal_id: 'goal' }, capabilities: {}, messages: [],
      session_id: '7d2e3f40-5b6c-4d7e-8f90-a1b2c3d4e5f6', request_id: requestId,
      budgets: { turn_ms: 180000, llm_narrate_ms: 60000 } }),
      prior_turns: [], prior_facts: [], prior_facts_with_turn: [],
      persisted_analysis_freshness: deriveAnalysisFreshness([], computeAnalysisAffectingGraphHash(canonical)),
      scenarioBriefText: null, persistedGraph: canonical, decision_context: EMPTY_DECISION_CONTEXT,
      coaching_state: EMPTY_COACHING_STATE, prior_coaching_state: null, coaching_lifecycle: EMPTY_COACHING_LIFECYCLE };
    const original = JSON.stringify(canonical);
    const result = await handler({ context, payload: makeMessagePayload({
      stage: 'analyse', scenario_id: context.session_id, message: 'Run analysis' }),
      requestId, signal: new AbortController().signal, orientationText: '' });
    expect(captured).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
    expect(validatePatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ llm_calls_used: 0, handler_facts: [] });
    const wireOptions = captured[0]!.plotPayload.options;
    if (!Array.isArray(wireOptions)) throw new Error('Expected wire options');
    const wire = OptionForAnalysisSchema.parse(wireOptions[0]);
    // Existing raw/encoded projection, not a rescale invented by this contract change.
    expect(wire.interventions).toStrictEqual({ price: 59 });
    expect(wire.raw_interventions).toStrictEqual({ price: 59 });
    expect(ExtractionMetadata.parse(wire.extraction_metadata)).toStrictEqual(metadata);
    expect(JSON.stringify(canonical)).toBe(original);
    const { settings, cold } = readSettings(canonical);
    expect(settings).toStrictEqual([{ id: 'raise:price', label: 'Price under Raise price',
      authorship: origin === 'approved human' ? 'user' : 'unknown' }]);
    const reloaded = InterventionV3.parse(cold.nodes.find(n => n.id === 'raise')!.interventions!.price);
    expect(reloaded).toStrictEqual(strict);
    const coldReady = OptionForAnalysis.parse(JSON.parse(JSON.stringify(ready)));
    expect(coldReady.extraction_metadata?.source).toBe(strict.source);
    expect(coldReady.extraction_metadata).toMatchObject({ confidence: 'medium', reasoning: 'Retained quantity reasoning' });
    if (origin === 'unknown') expect(coldReady.extraction_metadata).not.toHaveProperty('source');
  });

  it('only source becomes optional; unsupported origins and required quantity/target/confidence stay refused', () => {
    const target_match = { node_id: 'price', match_type: 'exact_id', confidence: 'high' };
    expect(InterventionV3.safeParse({ value: 59, target_match, source: 'not_a_source' }).success).toBe(false);
    expect(InterventionV3.safeParse({ target_match }).success).toBe(false);
    expect(InterventionV3.safeParse({ value: 59 }).success).toBe(false);
    expect(ExtractionMetadata.safeParse({ reasoning: 'Retained quantity reasoning' }).success).toBe(false);
    expect(ExtractionMetadata.safeParse({ confidence: 'medium', source: 'not_a_source' }).success).toBe(false);
  });
});


const BASELINE = 'We have 5 engineers.';
const ADDITION = 'One option is to hire 2 engineers.';
const OPERAND_BRIEF = `${BASELINE} ${ADDITION}`;
function operandCandidate(): CandidateModel {
  return {
    goal: { metric: 'Productivity', value: 100, unit: '%', operator: '>=', horizon_months: null, provenance: 'explicit' },
    factors: [{ label: 'Engineers', unit: 'engineers', baseline_value: 5, baseline_known: true,
      role: 'controllable', provenance: 'explicit', baseline_evidence: { quote: BASELINE } }],
    options: [{ label: 'Hire engineers', provenance: 'explicit', interventions: [{
      factor_label: 'Engineers', value: 2, unit: 'engineers', value_kind: 'additional', provenance: 'explicit',
      stated_evidence: { quote: ADDITION, start: BASELINE.length + 1, end: OPERAND_BRIEF.length,
        amount_start: OPERAND_BRIEF.indexOf('2 engineers'), option_quote: 'hire 2 engineers',
        option_start: OPERAND_BRIEF.indexOf('hire'), option_end: OPERAND_BRIEF.length - 1 },
    }] }], constraints: [], outcomes: [], risks: [], links: [],
  };
}
const totalReceipt = (model: CandidateModel, brief = OPERAND_BRIEF) =>
  verifiedOptionTotal(model, model.options[0]!, model.options[0]!.interventions![0]!, brief);

describe('same authority verifies each operand before user-derived addition', () => {
  it('verified five plus verified two credits seven with native derivation and operand basis on reload', () => {
    const model = operandCandidate();
    expect(verifiedFactorLevel(model, model.factors[0]!, OPERAND_BRIEF)).toBe(true);
    expect(verifiedOptionSetting(model, model.options[0]!, model.options[0]!.interventions![0]!, OPERAND_BRIEF)).toBe(true);
    expect(totalReceipt(model)).toStrictEqual({ verified: true, derived: true,
      basis: `${BASELINE} ${ADDITION} (5 + 2 = 7 engineers)` });
    const prepared = prepareProvisionalCandidate(model, OPERAND_BRIEF).candidate;
    expect(prepared.options[0]!.interventions![0]).toMatchObject({ value: 7, provenance: 'explicit', derived_total: true,
      basis: `${BASELINE} ${ADDITION} (5 + 2 = 7 engineers)` });
    const cold = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(admitCandidateModel(prepared, {}, OPERAND_BRIEF)))));
    const cell = cold.nodes.find(n => n.kind === 'option')!.interventions!.engineers;
    expect(cell).toMatchObject({ raw_value: 7, source: 'brief_extraction', value_confidence: 'medium',
      basis: `${BASELINE} ${ADDITION} (5 + 2 = 7 engineers)` });
    expect(InterventionV3.parse(cell).source).toBe('brief_extraction');
  });
  it.each(['baseline receipt', 'addition receipt', 'baseline known', 'unit mismatch', 'period mismatch', 'compound basis', 'third party'] as const)(
    '%s withholds derived user credit without altering the computed figure', fault => {
      const initial = operandCandidate();
      const factor = initial.factors[0]!; const option = initial.options[0]!; const addition = option.interventions![0]!;
      const model: CandidateModel = { ...initial,
        factors: [{ ...factor, ...(fault === 'baseline receipt' ? { baseline_evidence: null } : {}),
          ...(fault === 'baseline known' ? { baseline_known: false } : {}) }],
        options: [{ ...option, interventions: [{ ...addition,
          ...(fault === 'addition receipt' ? { stated_evidence: null } : {}),
          ...(fault === 'unit mismatch' ? { unit: 'people' } : {}),
          ...(fault === 'period mismatch' ? { unit: 'engineers/month' } : {}),
          ...(fault === 'compound basis' ? { basis: '5 times 2' } : {}),
          ...(fault === 'third party' ? { stated_evidence: { ...addition.stated_evidence!, quote: 'Our supplier could hire 2 engineers.' } } : {}),
        }] }],
      };
      const brief = fault === 'third party' ? `${BASELINE} Our supplier could hire 2 engineers.` : OPERAND_BRIEF;
      expect(totalReceipt(model, brief).verified).toBe(false);
      const prepared = prepareProvisionalCandidate(model, brief).candidate;
      if (fault !== 'unit mismatch' && fault !== 'period mismatch') {
        expect(prepared.options[0]!.interventions![0]).toMatchObject({ value: 7, provenance: 'ai_proposed' });
      }
    });
  it('an independently stated literal seven stays literal rather than operand-derived', () => {
    const literal = 'One option is to hire 7 engineers.';
    const initial = operandCandidate(); const option = initial.options[0]!; const addition = option.interventions![0]!;
    const model: CandidateModel = { ...initial, options: [{ ...option, interventions: [{ ...addition,
      stated_evidence: { ...addition.stated_evidence!, quote: literal } }] }] };
    expect(totalReceipt(model, literal)).toStrictEqual({ verified: true, derived: false });
    const prepared = prepareProvisionalCandidate(model, literal).candidate.options[0]!.interventions![0]!;
    expect(prepared).toMatchObject({ value: 7, provenance: 'explicit' });
    expect(prepared).not.toHaveProperty('derived_total');
    expect(prepared).not.toHaveProperty('basis');
  });
  it('a stated resulting level is not an additive operand even when the drafter calls it additional', () => {
    const initial = operandCandidate(); const quote = 'One option is to set engineers at 2 engineers.';
    const addition = initial.options[0]!.interventions![0]!;
    const model: CandidateModel = { ...initial, options: [{ ...initial.options[0]!, label: 'Set engineers',
      interventions: [{ ...addition, stated_evidence: { ...addition.stated_evidence!, quote } }] }] };
    const brief = `${BASELINE} ${quote}`;
    expect(verifiedOptionSetting(model, model.options[0]!, { ...model.options[0]!.interventions![0]!, value_kind: 'absolute' }, brief)).toBe(true);
    expect(totalReceipt(model, brief).verified).toBe(false);
  });
  it('percentage-of arithmetic remains unsupported by operand derivation', () => {
    const initial = operandCandidate(); const option = initial.options[0]!; const addition = option.interventions![0]!;
    const baseline = 'Our margin is 5%.'; const quote = 'One option is to increase margin by 2%.';
    const model: CandidateModel = { ...initial,
      factors: [{ ...initial.factors[0]!, label: 'Margin', unit: '%', baseline_evidence: { quote: baseline } }],
      options: [{ ...option, label: 'Increase margin', interventions: [{ ...addition, factor_label: 'Margin', unit: '%',
        stated_evidence: { ...addition.stated_evidence!, quote } }] }],
    };
    expect(totalReceipt(model, `${baseline} ${quote}`).verified).toBe(false);
  });
  it('RUN32 developers-count receipt cannot verify a people-frame baseline', () => {
    const initial = operandCandidate(); const baseline = 'We have 5 developers today.';
    const factor = { ...initial.factors[0]!, label: 'Developers', unit: 'people', baseline_evidence: { quote: baseline } };
    const model: CandidateModel = { ...initial, factors: [factor] };
    expect(verifiedFactorLevel(model, factor, baseline)).toBe(false);
  });
});
