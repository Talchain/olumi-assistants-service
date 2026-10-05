/**
 * PASS 2 PORTS (DL rulings 5 Oct ~02:1xZ): build-time outputs the legacy constructor produced that the records build
 * must also produce. Every row is bound by IDENTITY — the exact node id, label and value it names — on the body the
 * records build actually sent to `/graph/register`, never on a count another object could satisfy.
 */
import { describe, expect, it } from 'vitest';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';
import { buildModelFromRecords } from '../runtime/build-model-from-records.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { strictRecordsWire } from './records-wire-fixture.js';

const SID = '22222222-2222-4222-8222-222222222222';

async function build(records: DraftRecordSet, brief: string) {
  const writes: Record<string, unknown>[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('Registration body must be an object.');
      writes.push(body as Record<string, unknown>);
      return { status: 200, json: {} };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] } } };
  };
  const result = await buildModelFromRecords(SID, brief, dispatch, async () => ({ text: JSON.stringify(strictRecordsWire(records)) }));
  return { result, writes };
}

type SentGraph = {
  nodes: Array<{ id: string; kind: string; label: string }>;
  goal_constraints?: Array<Record<string, unknown>>;
};

/** One located user limit on claim 1 ("Monthly churn"), stated in the brief. */
const LIMIT_BRIEF = 'MRR. Raise Pro to £59. Monthly churn under 4%.';
const limitRecords = (): DraftRecordSet => ({
  stated_items: [
    { kind: 'goal', source_quote: 'MRR' },
    { kind: 'option', source_quote: 'Raise Pro to £59' },
    { kind: 'constraint', source_quote: 'Monthly churn under 4%', value: 4, unit: '%', direction: 'ceiling',
      direction_span: { start: 14, end: 19 }, value_span: { start: 20, end: 21 }, applies_to_claim: 1 },
  ],
  claims: [
    { claim_kind: 'factor', label: 'Pro plan price', value: 49, unit: 'GBP', value_scale: 'raw_count' },
    { claim_kind: 'factor', label: 'Monthly churn', value: 3, unit: '%', value_scale: 'raw_count' },
    { claim_kind: 'outcome', label: 'Monthly recurring revenue' },
    { claim_kind: 'causal_link', label: 'Price effect', from_claim: 0, to_claim: 2, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Churn effect', from_claim: 1, to_claim: 2, effect: 'negative' },
    { claim_kind: 'causal_link', label: 'Revenue reaches goal', from_claim: 2, to_stated: 0, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Price level', from_stated: 1, to_claim: 0, sets_to: 59, unit: 'GBP', value_scale: 'raw_count', effect: 'positive' },
  ],
});

describe('P2-P1: the stated limit persists with the registered graph, compiled by the compound-goals authority', () => {
  it('registers exactly the churn ceiling, on the churn factor, as a framed level', async () => {
    const { result, writes } = await build(limitRecords(), LIMIT_BRIEF);
    expect(result).toMatchObject({ ok: true, mutated: true, goal_constraints_carried: 1 });
    expect(writes).toHaveLength(1);
    const graph = writes[0]!.graph as SentGraph;
    const churn = graph.nodes.filter((node) => node.kind === 'factor' && node.label === 'Monthly churn');
    expect(churn, 'identity: the one churn factor').toHaveLength(1);
    expect(graph.goal_constraints).toEqual([expect.objectContaining({
      node_id: churn[0]!.id, operator: '<=', value: 0.04, unit: 'fraction', value_frame: 'level',
      source_quote: 'Monthly churn under 4%', provenance: 'explicit',
    })]);
    // Not the raw projection row: its unframed `4 %` is not compilation authority.
    expect(graph.goal_constraints![0]).not.toMatchObject({ value: 4, unit: '%' });
  });

  it('contrast: an unlocated record limit is not replaced by a label-bound regex row from the same brief', async () => {
    const records = limitRecords();
    records.stated_items[2] = { ...records.stated_items[2]!, source_quote: 'Something nobody modelled under 4%', applies_to_claim: 999 } as DraftRecordSet['stated_items'][number];
    const { result, writes } = await build(records, LIMIT_BRIEF);
    expect(result.ok).toBe(true);
    const graph = writes[0]!.graph as SentGraph;
    // The brief's own churn sentence is NOT label-bound onto the churn factor by the regex producer.
    expect('goal_constraints' in graph).toBe(false);
    expect(result.goal_constraints_carried).toBe(0);
  });
});

/** Two options the user named, one Olumi added (an `option_refinement` claim), and the model's own status quo. */
const AUTHORSHIP_BRIEF = 'Hire a tech lead or hire two developers for Delivery reliability.';
const authorshipRecords = (): DraftRecordSet => ({
  stated_items: [
    { kind: 'goal', source_quote: 'Delivery reliability' },
    { kind: 'option', source_quote: 'Hire a tech lead' },
    { kind: 'option', source_quote: 'hire two developers' },
  ],
  claims: [
    { claim_kind: 'factor', label: 'Team capacity', value: 5, unit: 'people', value_scale: 'raw_count' },
    { claim_kind: 'outcome', label: 'Delivery reliability' },
    { claim_kind: 'causal_link', label: 'Lead sets capacity', from_stated: 1, to_claim: 0, sets_to: 7, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Developers set capacity', from_stated: 2, to_claim: 0, sets_to: 8, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'Capacity affects result', from_claim: 0, to_claim: 1, effect: 'positive', strength: 0.5 },
    { claim_kind: 'causal_link', label: 'Result reaches goal', from_claim: 1, to_stated: 0, effect: 'positive', strength: 1 },
    { claim_kind: 'option_refinement', label: 'Phased hiring' },
    { claim_kind: 'causal_link', label: 'Phased level', from_claim: 6, to_claim: 0, sets_to: 6, effect: 'positive' },
    { claim_kind: 'option_refinement', label: 'Carry on as now', is_baseline: true },
  ],
});

type AuthoredNode = { id: string; kind: string; label: string; proposed_by?: string; is_baseline?: boolean; interventions?: Record<string, unknown> };

describe('P2-P2: an option Olumi added carries proposed_by olumi, from the record\'s own typed origin', () => {
  it('marks exactly the claim-minted option, never a stated option or the model\'s status quo', async () => {
    const { result, writes } = await build(authorshipRecords(), AUTHORSHIP_BRIEF);
    expect(result).toMatchObject({ ok: true, mutated: true });
    const options = (writes[0]!.graph as { nodes: AuthoredNode[] }).nodes.filter((node) => node.kind === 'option');
    const byLabel = (label: string) => { const hit = options.filter((o) => o.label === label); expect(hit, label).toHaveLength(1); return hit[0]!; };
    expect(byLabel('Phased hiring').proposed_by).toBe('olumi');
    expect(byLabel('Hire a Tech Lead').proposed_by).toBeUndefined();
    expect(byLabel('Hire Two Developers').proposed_by).toBeUndefined();
    expect(byLabel('Carry on as now')).toMatchObject({ is_baseline: true });
    expect(byLabel('Carry on as now').proposed_by).toBeUndefined();
    expect(options.filter((o) => o.proposed_by === 'olumi').map((o) => o.id)).toEqual([byLabel('Phased hiring').id]);
  });

  it('the licence leaves the Olumi option out exactly as on the legacy path (excluded_olumi_proposed)', async () => {
    const { filterOlumiProposedOptions } = await import('../../tools/handlers/olumi-option-filter.js');
    const { writes } = await build(authorshipRecords(), AUTHORSHIP_BRIEF);
    const graph = writes[0]!.graph as { nodes: AuthoredNode[] };
    const submitted = graph.nodes.filter((n) => n.kind === 'option' && n.is_baseline !== true)
      .map((n) => ({ option_id: n.id, label: n.label, interventions: n.interventions ?? {} }));
    expect(submitted, 'control: three options with levels are submitted').toHaveLength(3);
    const phased = graph.nodes.find((n) => n.kind === 'option' && n.label === 'Phased hiring')!;
    const out = filterOlumiProposedOptions({ submitted, graph });
    expect(out.participation).toEqual([{ option_id: phased.id, state: 'excluded_olumi_proposed' }]);
    expect(out.options.map((o) => o.option_id)).toEqual(submitted.filter((o) => o.option_id !== phased.id).map((o) => o.option_id));
    expect(out.keptOlumiProvisional).toBe(false);
  });
});

describe('P2-P3: an oversized records draft is refused model_too_large by the legacy size gate, before any write', () => {
  it('refuses the 35-extra-factor draft with the legacy refusal shape, zero writes, no retry', async () => {
    const { COMPACT_LIMITS } = await import('../construction-size-gate.js');
    const { oversizedConstructionRecords } = await import('./records-wire-fixture.js');
    const { result, writes } = await build(oversizedConstructionRecords(), 'Hire a tech lead for Delivery reliability.');
    expect(writes, 'nothing registered').toHaveLength(0);
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'model_too_large', retried: false, limits: COMPACT_LIMITS });
    // Counted on the graph that WOULD have registered: the five-claim topology plus 35 factors Olumi added, by origin.
    expect(result.by_kind).toMatchObject({ factor: 36, option: 1, goal: 1, outcome: 1 });
    // Every node minted from an UNBASED claim is Olumi's addition: the 35 extra factors plus the base topology's own two
    // claims (factor 'Team capacity', outcome 'Delivery reliability'); the stated goal and option are the user's.
    expect(result.added_beyond_brief).toBe(35 + 2);
    expect(result.from_your_brief).toBe(2);
    expect(result.nodes).toBeGreaterThan(COMPACT_LIMITS.maxNodes);
  });

  it('contrast: the same topology without the extra factors registers, with the compact verdict on the success', async () => {
    const { constructionRecords } = await import('./records-wire-fixture.js');
    const { result, writes } = await build(constructionRecords(), 'Hire a tech lead for Delivery reliability.');
    expect(writes).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, mutated: true, within_compact_limits: true, size_retried: false });
    expect('admitted_over_limit_because' in result).toBe(false);
  });
});

describe('P2-ACCEPT: build-result keys a SERVED reader keys on are mapped to their records equivalent', () => {
  it('admitted_graph_invalid: a graph GraphV3 cannot read is refused with the legacy code and issue paths, nothing written', async () => {
    const { vi } = await import('vitest');
    const { GraphV3 } = await import('../../../schemas/cee-v3.js');
    const { constructionRecords } = await import('./records-wire-fixture.js');
    const { narrateWriteOutcome, withWriteOutcome } = await import('../write-outcome.js');
    const spy = vi.spyOn(GraphV3, 'safeParse').mockReturnValueOnce(GraphV3.safeParse({ nodes: 'not-an-array', edges: [] }));
    try {
      const { result, writes } = await build(constructionRecords(), 'Hire a tech lead for Delivery reliability.');
      expect(writes).toHaveLength(0);
      expect(result).toEqual({ ok: false, mutated: false, refusal: 'admitted_graph_invalid', issues: ['nodes'] });
      // The served reader: its own words for this code, not the generic construction failure.
      const reply = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [result]);
      expect(withWriteOutcome(reply.text, reply.status))
        .toBe('The model was not built: what came back did not form a valid model, so nothing was saved — ask me to try again.');
    } finally { spy.mockRestore(); }
  });

  it('left_out_to_stay_compact: records never compacts, so the served reader says nothing was left out', async () => {
    const { constructionRecords } = await import('./records-wire-fixture.js');
    const { narrateWriteOutcome, withWriteOutcome } = await import('../write-outcome.js');
    const { result } = await build(constructionRecords(), 'Hire a tech lead for Delivery reliability.');
    expect(result).toMatchObject({ ok: true, size_retried: false });
    expect('left_out_to_stay_compact' in result).toBe(false);
    const reply = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [result]);
    const said = withWriteOutcome(reply.text, reply.status);
    expect(said, 'control: the success line was produced').not.toBe('');
    expect(said).not.toContain('To keep it readable');
  });

  it('option_name_ambiguous: an option and a factor sharing one name stay two identities (index-bound), so no refusal applies', async () => {
    const records: DraftRecordSet = {
      stated_items: [{ kind: 'goal', source_quote: 'Delivery reliability' }, { kind: 'option', source_quote: 'Hire a tech lead' }],
      claims: [
        { claim_kind: 'factor', label: 'Hire a tech lead', value: 0, unit: 'people', value_scale: 'raw_count' },
        { claim_kind: 'outcome', label: 'Delivery reliability' },
        { claim_kind: 'causal_link', label: 'Option sets it', from_stated: 1, to_claim: 0, sets_to: 1, effect: 'positive' },
        { claim_kind: 'causal_link', label: 'It affects result', from_claim: 0, to_claim: 1, effect: 'positive', strength: 0.5 },
        { claim_kind: 'causal_link', label: 'Result reaches goal', from_claim: 1, to_stated: 0, effect: 'positive', strength: 1 },
      ],
    };
    const { result, writes } = await build(records, 'Hire a tech lead for Delivery reliability.');
    expect(result).toMatchObject({ ok: true, mutated: true });
    const nodes = (writes[0]!.graph as SentGraph).nodes;
    const option = nodes.filter((n) => n.kind === 'option'); const factor = nodes.filter((n) => n.kind === 'factor');
    expect(option).toHaveLength(1); expect(factor).toHaveLength(1);
    expect(factor[0]!.label).toBe('Hire a tech lead');
    expect(option[0]!.id).not.toBe(factor[0]!.id);
  });
});

/**
 * P2-FRAME-CHECK (DL ruling 5 Oct): the wiring must not change compute. 0-LLM: for the SAME compiled graph (the sealed
 * v-next records with a declared `plausible_max` on the starter-subscriber quantity), built by the SERVED records builder,
 * stored as the register route stores it, read by the run path's REAL loader (`loadScenarioSnapshotForRunAnalysis`) and
 * scaled by the run handler's OWN wire step (`buildFactorScaleMap` + `projectRequestInterventionsToWireScale`,
 * `run-analysis.ts` :811/:837), the cells PLoT computes on — (cap, the level sent, sent ÷ cap) — equal the legacy
 * construct's cells for the same figures (`framedObservedState` + the same wire step over its `{value, raw_value}` level).
 * Both paths send the RAW level; PLoT's gate divides a value above 1 by the factor's cap (CEE #2573 F9). Restack 1 found
 * the records cap missing (STOP); #2573 F9 now writes the legacy `observed_state.cap`. A difference is a STOP.
 */
describe('P2-FRAME-CHECK: (cap, sent level, sent ÷ cap) on /v2/run equal the legacy path for the same compiled graph', () => {
  const recordsCells = async (plausibleMax: number) => {
    const { sealedRecordsVNext, BRIEF } = await import('../../../cee/draft/records/__tests__/compile-spec/sealed-fixture-vnext.js');
    const { projectGraphForPersistence } = await import('../../persisted-graph-projection.js');
    const { assignEntityRefs } = await import('../../graph/entity-refs.js');
    const { buildFactorScaleMap, projectRequestInterventionsToWireScale } = await import('../../tools/plot-intervention-scale.js');
    const { loadScenarioSnapshotForRunAnalysis } = await import('../../build-turn-context.js');
    const records = sealedRecordsVNext(); records.stated_items[11]!.plausible_max = plausibleMax;
    const { result, writes } = await build(records, BRIEF);
    expect(result.ok, JSON.stringify(result).slice(0, 300)).toBe(true);
    const storedGraph = assignEntityRefs(projectGraphForPersistence(writes[0]!.graph as never,
      { scenarioId: SID, turnClass: 'direct_answer', source: 'graph_registration' }), null).graph as unknown as {
      nodes: Array<{ id: string; kind: string; label: string; source_quote?: string;
        observed_state?: { unit?: string }; interventions?: Record<string, { raw_value?: number }> }>;
    };
    const factorLabel = records.claims.find((c) => c.quantity === 11 && c.claim_kind === 'factor')!.label!;
    const factor = storedGraph.nodes.filter((n) => n.kind === 'factor' && n.label === factorLabel);
    const option = storedGraph.nodes.filter((n) => n.kind === 'option' && n.source_quote === records.stated_items[4]!.source_quote);
    expect(factor, 'identity: the starter-subscriber factor').toHaveLength(1);
    expect(option, 'identity: the starter option').toHaveLength(1);
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'frame-check',
      { loadGraphAndBriefText: async () => ({ graph: storedGraph, briefText: BRIEF }), readMostRecentPendingActions: async () => [] } as never);
    const snapOption = (snapshot.options as Array<{ option_id?: string; id?: string; interventions?: Record<string, unknown> }>)
      .filter((o) => (o.option_id ?? o.id) === option[0]!.id);
    expect(snapOption, 'identity: the starter option in the run snapshot').toHaveLength(1);
    const scale = buildFactorScaleMap((snapshot.graph as { nodes?: unknown[] }).nodes);
    const wire = projectRequestInterventionsToWireScale([snapOption[0]!.interventions ?? {}], scale, [new Set()]);
    const cap = scale.get(factor[0]!.id)?.cap;
    const sent = wire.perOption[0]![factor[0]!.id];
    return { cells: { cap, sent, sent_over_cap: sent === undefined || cap === undefined ? undefined : sent / cap },
      raw: option[0]!.interventions![factor[0]!.id]!.raw_value!, unit: factor[0]!.observed_state?.unit ?? null };
  };
  /** The legacy construct's cells for the same figures: its framed factor and its `{value, raw_value}` option level. */
  const legacyCells = async (frame: number, raw: number, unit: string | null) => {
    const { framedObservedState } = await import('../admit-model.js');
    const { buildFactorScaleMap, projectRequestInterventionsToWireScale } = await import('../../tools/plot-intervention-scale.js');
    const nodes = [{ id: 'f', kind: 'factor', observed_state: framedObservedState({ baseline_value: 0, unit, provenance: 'explicit', plausible_max: frame }) }];
    const scale = buildFactorScaleMap(nodes);
    const sent = projectRequestInterventionsToWireScale([{ f: { value: raw / frame, raw_value: raw, unit, source: 'brief_extraction' } }], scale, [new Set()]).perOption[0]!.f;
    const cap = scale.get('f')?.cap;
    return { cap, sent, sent_over_cap: sent === undefined || cap === undefined ? undefined : sent / cap };
  };

  it('a declared range above the level (300): records cells = legacy cells (cap 300, sent 150, 0.5)', async () => {
    const { cells, raw, unit } = await recordsCells(300);
    expect(raw, 'control: the starter option sets 150').toBe(150);
    expect(cells).toEqual(await legacyCells(300, raw, unit));
    expect(cells).toEqual({ cap: 300, sent: 150, sent_over_cap: 0.5 });
  });

  it('a level above the declared range (100): records cells = legacy cells on the widened frame (cap 1000, sent 150, 0.15)', async () => {
    const { defaultFrameFor } = await import('../admit-model.js');
    const { cells, raw, unit } = await recordsCells(100);
    expect(raw, 'control: the option level exceeds the declared range').toBeGreaterThan(100);
    expect(cells).toEqual(await legacyCells(defaultFrameFor(raw), raw, unit));
    expect(cells).toEqual({ cap: 1000, sent: 150, sent_over_cap: 0.15 });
  });
});
