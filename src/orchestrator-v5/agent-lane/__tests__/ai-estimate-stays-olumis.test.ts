/**
 * ⛔ AN AI ESTIMATE IS OLUMI'S FIGURE, NEVER THE USER'S — AND IT MUST NOT BE DROPPED.
 *
 * At staging 8428207a, `admitCandidateModel` wrote `observed_state` only when
 * `baseline_known && typeof baseline_value === 'number'`. A factor the builder
 * ESTIMATED (`baseline_known: false`, a finite `baseline_value`) lost its number
 * entirely, so a freshly built model had nothing to run a provisional first
 * analysis on. The fix keeps the number, framed, and stamped `cee_inference`,
 * in the CAPLESS shape `set_factor_value` itself writes when a user adopts a value
 * on a `scale_frame` factor (`construction-range-carrier.test.ts`): no
 * `observed_state.cap`, no `declared_scale`. A capped shape would let Olumi's own
 * guessed range refuse the user's later correction.
 *
 * Every assertion is bound to a node by its id, read off the admitted or the
 * REGISTERED graph (the real `buildModelFromBrief` → `/graph/register` payload,
 * parsed with CEE's own `GraphV3`), never to a value another node could satisfy.
 */
import { describe, it, expect } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Factor = CandidateModel['factors'][number];

/** Hiring-shaped. Each factor is named for the case it carries. */
function candidate(extra: Partial<Record<'estimated' | 'zero' | 'absent' | 'stated' | 'unframeable', Partial<Factor>>> = {}): CandidateModel {
  const f = (label: string, over: Partial<Factor> = {}): Factor => ({
    label, role: 'controllable', baseline_known: false, baseline_value: null, unit: 'FTE', provenance: 'inferred', plausible_max: 100, ...over,
  });
  const stated = f('Stated headcount', { baseline_known: true, baseline_value: 49, unit: 'GBP', plausible_max: 200, provenance: 'explicit', ...extra.stated });
  if (stated.baseline_known && stated.provenance === 'explicit' && stated.baseline_value === 49 && stated.unit === 'GBP') {
    stated.baseline_evidence = { quote: 'Our stated headcount is £49.' };
  }
  return {
    goal: { metric: 'Delivery velocity', operator: '>=', value: 30, unit: 'points per sprint', horizon_months: null, provenance: 'explicit' },
    constraints: [],
    options: [
      { label: 'Hire Two Developers', provenance: 'explicit', changes: ['Estimated headcount', 'Stated headcount'],
        interventions: [{ factor_label: 'Estimated headcount', value: 12, unit: 'FTE', provenance: 'explicit' }] },
      { label: 'Hire a Tech Lead', provenance: 'explicit', changes: ['Zero tech leads', 'Absent contractors', 'Unframeable backlog'],
        interventions: [{ factor_label: 'Zero tech leads', value: 1, unit: 'FTE', provenance: 'explicit' }] },
    ],
    factors: [
      // The builder's guess, on a factor the USER named ('explicit'): the entity is
      // theirs, the number is not — so it must not inherit `brief_extraction`.
      f('Estimated headcount', { baseline_value: 10, provenance: 'explicit', ...extra.estimated }),
      f('Zero tech leads', { baseline_value: 0, plausible_max: 10, ...extra.zero }),
      f('Absent contractors', { ...extra.absent }),
      stated,
      // No supplied range; A3 can derive a coordinate frame from this named-unit estimate.
      f('Unframeable backlog', { baseline_value: 250, unit: 'tickets', plausible_max: null, ...extra.unframeable }),
    ],
    risks: [],
    outcomes: [],
    links: ['Estimated headcount', 'Zero tech leads', 'Absent contractors', 'Stated headcount', 'Unframeable backlog'].map((from) => ({
      from, to: 'Delivery velocity', direction: 'positive' as const, provenance: 'inferred',
    })),
  } as CandidateModel;
}

const admitted = (model: CandidateModel) => admitCandidateModel(model, {}, 'Our stated headcount is £49.');

const byId = (m: { nodes: readonly { id: string }[] }, id: string) => {
  const n = m.nodes.find((x) => x.id === id);
  expect(n, `node ${id}`).toBeDefined();
  return n as Record<string, unknown> & { observed_state?: Record<string, unknown>; scale_frame?: number };
};

/** The real registration path: the payload `buildModelFromBrief` sends, parsed as CEE parses it. */
async function registered(model: CandidateModel) {
  let graph: unknown = null;
  const call = (async () => ({ text: JSON.stringify({ ...model, unknowns: [] }) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      graph = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('44444444-4444-4444-8444-444444444444', "Our stated headcount is £49.\n\nShould I hire a tech lead or two developers?", d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return GraphV3.parse(graph);
}

describe('an AI estimate is kept as Olumi’s figure (T1-T5)', () => {
  it('T1 RED: a finite estimate survives, framed on the node’s scale_frame and stamped cee_inference — capless', () => {
    const m = admitted(candidate());
    const n = byId(m, 'estimated_headcount');
    expect(n.observed_state).toStrictEqual({ value: 10 / 100, raw_value: 10, unit: 'FTE', source: 'cee_inference', extractionType: 'inferred' });
    expect(n.scale_frame).toBe(100);
    expect(n.observed_state).not.toHaveProperty('cap');
    expect(n.observed_state).not.toHaveProperty('declared_scale');
  });

  it('T1 RED (round trip): the same shape survives the register payload and CEE’s GraphV3 parse', async () => {
    const g = await registered(candidate());
    const n = byId(g, 'estimated_headcount');
    expect(n.observed_state).toMatchObject({ value: 0.1, raw_value: 10, unit: 'FTE', source: 'cee_inference' });
    expect(n.observed_state).not.toHaveProperty('cap');
    expect(n.observed_state).not.toHaveProperty('declared_scale');
    expect(n.scale_frame).toBe(100);
  });

  it('T2 RED: an estimate of ZERO survives — no truthiness guard', () => {
    const n = byId(admitted(candidate()), 'zero_tech_leads');
    expect(n.observed_state).toStrictEqual({ value: 0, raw_value: 0, unit: 'FTE', source: 'cee_inference', extractionType: 'inferred' });
    expect(n.scale_frame).toBe(10);
  });

  it('T3 control: a truly absent baseline stays absent, and keeps its frame', () => {
    const n = byId(admitted(candidate()), 'absent_contractors');
    expect(n).not.toHaveProperty('observed_state');
    expect(n.scale_frame).toBe(100);
  });

  it('T4 control: an explicit known baseline is byte-identical and stays brief_extraction', () => {
    const n = byId(admitted(candidate()), 'stated_headcount');
    expect(n.observed_state).toStrictEqual({
      value: 49 / 200, raw_value: 49, cap: 200, declared_scale: 'unit_interval', unit: 'GBP', source: 'brief_extraction',
      extractionType: 'explicit', // S7: the verifier-credited quantity carries the existing explicit type; figures unchanged
    });
    expect(n).not.toHaveProperty('scale_frame');
  });

  it('A3: a named-unit estimate gets a coordinate frame; a truly absent level still blocks', async () => {
    const withEstimate = await registered(candidate());
    const withoutEstimate = await registered(candidate({ unframeable: { baseline_value: null } }));
    const n = byId(withEstimate, 'unframeable_backlog');
    expect(n.observed_state).toStrictEqual({ value: 0.25, raw_value: 250, unit: 'tickets', source: 'cee_inference', extractionType: 'inferred' });
    expect(n.scale_frame).toBe(1000);
    const blockers = (g: unknown) => assessCanonicalAnalysisReadiness(g).blockingIssues.map((i) => `${i.code}:${i.factor_id}`).sort();
    expect(blockers(withEstimate)).toEqual(['MISSING_FACTOR_LEVEL:absent_contractors',
      'MISSING_OPTION_VALUE:absent_contractors', 'MISSING_OPTION_VALUE:stated_headcount', 'MISSING_OPTION_VALUE:unframeable_backlog']);
    expect(blockers(withoutEstimate)).toEqual(['MISSING_FACTOR_LEVEL:absent_contractors', 'MISSING_FACTOR_LEVEL:unframeable_backlog',
      'MISSING_OPTION_VALUE:absent_contractors', 'MISSING_OPTION_VALUE:stated_headcount', 'MISSING_OPTION_VALUE:unframeable_backlog']);
  });

  it('T5b: an estimate outside its stated range stays missing; the range still travels', () => {
    const n = byId(admitted(candidate({ estimated: { baseline_value: 150 } })), 'estimated_headcount');
    expect(n).not.toHaveProperty('observed_state');
    expect(n.scale_frame).toBe(100);
  });

  it('nothing constructed claims user authority', () => {
    const m = admitted(candidate());
    const text = JSON.stringify(m.nodes);
    for (const stamp of ['user_override', 'user_stated', 'user_assumption', 'user_specified']) expect(text).not.toContain(stamp);
  });

  it('A3: the derived coordinate frame discloses its exact value and estimated origin', () => {
    // No stated range or intervention: the coordinate frame must disclose that its number came from Olumi's estimate.
    const m = admitted(candidate({ unframeable: { baseline_value: 250, plausible_max: null } }));
    expect(m.loss.filter((l) => l.field_path === 'nodes[unframeable_backlog].observed_state.cap')).toEqual([{
      field_path: 'nodes[unframeable_backlog].observed_state.cap', before: null, after: 1000, severity: 'warn',
      reason: 'No range was stated for "Unframeable backlog", and a number above 1 with no range cannot be analysed at all — nor can a range be added afterwards. A range of 0 to 1000 has been used, taken from the largest figure the model already holds for it. That is a unit of measurement, not a forecast or a limit, and the figures it was taken from are Olumi\'s own estimates, not figures you gave, and are stored unchanged beside it.',
    }]);
  });

  it('a defaulted frame over Olumi’s own figures does not call them "your own figures"', () => {
    // Range derived from an INFERRED intervention level; the baseline is Olumi's estimate.
    const model = candidate({ unframeable: { baseline_value: 250, plausible_max: null } });
    const tweaked = {
      ...model,
      options: [
        model.options[0]!,
        { ...model.options[1]!, interventions: [
          ...(model.options[1]!.interventions ?? []),
          { factor_label: 'Unframeable backlog', value: 300, unit: 'tickets', provenance: 'inferred' },
        ] },
      ],
    } as CandidateModel;
    const m = admitted(tweaked);
    const [entry] = m.loss.filter((l) => l.field_path === 'nodes[unframeable_backlog].observed_state.cap');
    expect(entry?.after).toBe(1000);
    expect(entry?.reason).not.toContain('your own figures');
    expect(entry?.reason).toContain('Olumi');
    // …and with the frame now defined, the estimate is carried on it, as Olumi's.
    expect(byId(m, 'unframeable_backlog').observed_state).toStrictEqual({ value: 0.25, raw_value: 250, unit: 'tickets', source: 'cee_inference', extractionType: 'inferred' });
  });
});
