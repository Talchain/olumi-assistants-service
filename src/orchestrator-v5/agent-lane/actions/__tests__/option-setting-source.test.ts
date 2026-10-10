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
import { bindRecentMutationHistoryToPriorFacts } from '../../../context/reconcile-recent-mutation-facts.js';
import { applyOptionInterventionEdit, prepareOptionInterventionEdit } from '../../../system-events/option-intervention-edit.js';
import { buildOptionEffectRawOperation } from '../../../routing/option-effect-write.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import * as census from '../../olumi-estimates-feeding-result.js';
import { actionFactsOf, type ActionRead } from '../state.js';
import { admitCandidateModel, type CandidateModel } from '../../admit-model.js';
import { verifiedFactorLevel, verifiedOptionSetting, verifiedOptionTotal } from '../../verified-option-setting.js';
import { buildModelFromBrief, prepareProvisionalCandidate } from '../../runtime/build-model.js';

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
      prior_turns: [], prior_facts: bindRecentMutationHistoryToPriorFacts([], {
        recent_mutation_facts: [], recent_changes_status: 'complete',
      }), prior_facts_with_turn: [],
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
  it('RUN36 label-named developers count verifies the declared people-frame baseline', () => {
    const initial = operandCandidate(); const baseline = 'We have 5 developers today.';
    const factor = { ...initial.factors[0]!, label: 'Developers', unit: 'people', baseline_evidence: { quote: baseline } };
    const model: CandidateModel = { ...initial, factors: [factor] };
    // DL RUN36: the existing labelStandsForCountUnit identity licenses this count frame.
    expect(verifiedFactorLevel(model, factor, baseline)).toBe(true);
  });
});

const PEOPLE_CLAIM = 'We have 5 developers and will hire 2 more.';
function peopleCandidate(quote = PEOPLE_CLAIM): CandidateModel {
  const initial = operandCandidate();
  return { ...initial,
    factors: [{ ...initial.factors[0]!, label: 'Developers', unit: 'people', plausible_max: 20,
      baseline_evidence: { quote } }],
    options: [{ ...initial.options[0]!, label: 'Hire developers', interventions: [{
      ...initial.options[0]!.interventions![0]!, factor_label: 'Developers', unit: 'people',
      stated_evidence: { ...initial.options[0]!.interventions![0]!.stated_evidence!, quote },
    }] }],
  };
}
describe('RUN36 typed count identity and additive claim role', () => {
  it('the owned people-frame claim verifies current five, additive two, and user-derived seven', () => {
    const model = peopleCandidate(); const option = model.options[0]!;
    expect(verifiedFactorLevel(model, model.factors[0]!, PEOPLE_CLAIM)).toBe(true);
    expect(verifiedOptionSetting(model, option, option.interventions![0]!, PEOPLE_CLAIM)).toBe(true);
    expect(totalReceipt(model, PEOPLE_CLAIM)).toStrictEqual({ verified: true, derived: true,
      basis: `${PEOPLE_CLAIM} ${PEOPLE_CLAIM} (5 + 2 = 7 people)` });
    const prepared = prepareProvisionalCandidate(model, PEOPLE_CLAIM).candidate;
    expect(prepared.options[0]!.interventions![0]).toMatchObject({ value: 7, provenance: 'explicit', derived_total: true });
    const cold = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(admitCandidateModel(prepared, {}, PEOPLE_CLAIM)))));
    expect(cold.nodes.find(n => n.id === 'developers')!.observed_state).toMatchObject({ raw_value: 5, source: 'brief_extraction' });
    expect(cold.nodes.find(n => n.kind === 'option')!.interventions!.developers).toMatchObject({
      raw_value: 7, source: 'brief_extraction', value_confidence: 'medium', basis: `${PEOPLE_CLAIM} ${PEOPLE_CLAIM} (5 + 2 = 7 people)` });
  });
  it('a different counted entity does not license a developers baseline', () => {
    const quote = 'We have 5 contractors and will hire 2 more.';
    const model = peopleCandidate(quote);
    expect(verifiedFactorLevel(model, model.factors[0]!, quote)).toBe(false);
    expect(totalReceipt(model, quote).verified).toBe(false);
  });
  it.each([
    ['bound', 'We have 5 developers and will hire more than 2 developers.'],
    ['third party', 'We have 5 developers and they will hire 2 more.'],
    ['percent of', 'We have 5 developers and will hire 2% of the team.'],
    ['retraction', 'We have 5 developers and will hire 2 more, not really.'],
    ['upper bound', 'We could hire up to 2 developers.'],
    ['opposite direction', 'We could hire 2 fewer developers.'],
    ['target', 'We could hire 2 more developers as our target.'],
  ])('%s cannot license an additive receipt', (_name, quote) => {
    const model = peopleCandidate(quote!);
    expect(verifiedOptionSetting(model, model.options[0]!, model.options[0]!.interventions![0]!, quote)).toBe(false);
    expect(totalReceipt(model, quote).verified).toBe(false);
  });
  it('the point gate still refuses more on an absolute intervention', () => {
    const quote = 'We could hire 2 more developers.'; const model = peopleCandidate(quote);
    expect(verifiedOptionSetting(model, model.options[0]!, { ...model.options[0]!.interventions![0]!, value_kind: 'absolute' }, quote)).toBe(false);
  });
  it('separate current and additive receipts keep their own role under the neighbour guard', () => {
    const baseline = 'We have 5 developers today.'; const addition = 'We could hire 2 more developers.';
    const initial = peopleCandidate(addition); const model: CandidateModel = { ...initial,
      factors: [{ ...initial.factors[0]!, baseline_evidence: { quote: baseline } }],
    };
    const brief = `${baseline} ${addition}`;
    expect(verifiedFactorLevel(model, model.factors[0]!, brief)).toBe(true);
    expect(verifiedOptionSetting(model, model.options[0]!, model.options[0]!.interventions![0]!, brief)).toBe(true);
    expect(totalReceipt(model, brief)).toMatchObject({ verified: true, derived: true });
  });
  it.each(['people/month', 'FTE', 'thousand people'])('count identity cannot discard the declared %s frame', unit => {
    const quote = 'We have 5 developers.'; const initial = peopleCandidate(quote);
    const model: CandidateModel = { ...initial, factors: [{ ...initial.factors[0]!, unit }] };
    expect(verifiedFactorLevel(model, model.factors[0]!, quote)).toBe(false);
  });
  it('an unquoted current or additive operand never becomes user-derived', () => {
    const model = peopleCandidate();
    expect(totalReceipt({ ...model, factors: [{ ...model.factors[0]!, baseline_evidence: null }] }, PEOPLE_CLAIM).verified).toBe(false);
    expect(totalReceipt({ ...model, options: [{ ...model.options[0]!, interventions: [{ ...model.options[0]!.interventions![0]!, stated_evidence: null }] }] }, PEOPLE_CLAIM).verified).toBe(false);
  });
  it('the direct zero-provider producer registers the same verified current and derived total', async () => {
    const initial = peopleCandidate();
    const model: CandidateModel = { ...initial,
      options: [...initial.options, { label: 'Maintain staffing', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [] }],
      links: [{ from: 'Developers', to: 'Productivity', direction: 'positive', provenance: 'ai_proposed',
        effect_amount: null, effect_per_source_change: null, effect_provenance: null }],
    };
    let registered: ReturnType<typeof GraphV3.parse> | undefined; let retainedCallbacks = 0;
    const result = await buildModelFromBrief('33333333-3333-4333-8333-333333333333', PEOPLE_CLAIM,
      async (path, body) => {
        if (path.endsWith('/graph/register') && typeof body === 'object' && body !== null && 'graph' in body) {
          registered = GraphV3.parse(body.graph);
        }
        return { status: 200, json: { graph: { nodes: [], edges: [] } } };
      }, async () => { retainedCallbacks += 1; return { text: JSON.stringify(model) }; });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(retainedCallbacks).toBe(1);
    expect(registered!.nodes.find(n => n.id === 'developers')!.observed_state).toMatchObject({ raw_value: 5, source: 'brief_extraction' });
    expect(registered!.nodes.find(n => n.label === 'Hire developers')!.interventions!.developers).toMatchObject({
      raw_value: 7, source: 'brief_extraction', value_confidence: 'medium' });
    expect(registered!.nodes.find(n => n.label === 'Hire developers')!.interventions!.developers.basis).toContain('(5 + 2 = 7 people)');
  });
});


describe('RUN37 human callers supply authority; generic builders never manufacture it', () => {
  it('a direct canvas edit keeps the human marker and native figure through commit projection and reload', () => {
    const initial = graph('cee_hypothesis');
    const before = GraphV3.parse(projectGraphForPersistence({ ...initial, edges: [...initial.edges,
      { from: 'raise', to: 'price', exists_probability: 1, strength: { mean: 0.5, std: 0.1 }, effect_direction: 'positive' },
    ] }));
    const prepared = prepareOptionInterventionEdit({ persistedGraph: before, optionId: 'raise', factorId: 'price', source: 'user_specified',
      modelValue: 0.64, expectedGraphHash: computeAnalysisAffectingGraphHash(before)! });
    expect(prepared.kind).toBe('prepared');
    if (prepared.kind !== 'prepared') throw new Error('Expected human edit operation');
    expect(prepared.operation.value).toMatchObject({ source: 'user_specified' });
    expect(prepared.operation.rationale).not.toContain('Olumi');
    const out = applyOptionInterventionEdit({ persistedGraph: before, optionId: 'raise', factorId: 'price',
      modelValue: 0.64, expectedGraphHash: computeAnalysisAffectingGraphHash(before)!,
      scenarioId: '7d2e3f40-5b6c-4d7e-8f90-a1b2c3d4e5f6', turnId: 'human-edit', requestId: 'human-edit',
      freshness: 'none', hasExistingAnalysis: false });
    expect(out.kind, JSON.stringify(out)).toBe('candidate');
    if (out.kind !== 'candidate') throw new Error('Expected human edit candidate');
    const { settings, cold } = readSettings(out.graph);
    expect(cold.nodes.find(n => n.id === 'raise')!.interventions!.price)
      .toMatchObject({ value: 0.64, raw_value: 64, unit: 'GBP', source: 'user_specified' });
    expect(settings).toStrictEqual([{ id: 'raise:price', label: 'Price under Raise price', authorship: 'user' }]);
  });

  it('the shared raw builder with no human authority still emits no source', () => {
    const operation = buildOptionEffectRawOperation({ optionId: 'raise', optionLabel: 'Raise price',
      factorId: 'price', factorLabel: 'Price', value: 0.64 });
    expect(operation.value).toStrictEqual({ value: 0.64 });
  });

  it('the shared raw builder carries an explicit caller marker rather than defaulting it', () => {
    const operation = buildOptionEffectRawOperation({ optionId: 'raise', optionLabel: 'Raise price',
      factorId: 'price', factorLabel: 'Price', value: 0.64, source: 'user_specified' });
    expect(operation.value).toStrictEqual({ value: 0.64, source: 'user_specified' });
  });
});
