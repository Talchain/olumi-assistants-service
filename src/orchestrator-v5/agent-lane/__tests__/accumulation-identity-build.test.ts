/**
 * CEE #4 through the REAL door: `buildModelFromBrief` registers the drafter's accumulation on the derived node only on
 * the deadline the brief attests, and the registered graph survives the cold read (GraphV3).
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, chancesWithheldByAGuess, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

type Rec = Record<string, unknown>;
const SCENARIO = '62626262-6262-4626-8626-626262626262';
const BRIEF = 'Given our goal of reaching £20k Pro MRR within 12 months, should we raise the Pro plan price from £49 to £59? '
  + 'We have 250 Pro subscribers, lose 3% a month and add about 20 new Pro subscribers a month.';
const SUBS12 = 'Pro subscribers at month 12';

function candidate(identities: unknown[]): CandidateModel {
  return {
    goal: {
      metric: 'Pro MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP', horizon_months: 12,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: null, scope: null,
    },
    constraints: [],
    options: [
      { label: 'Raise the Pro plan price to £59', provenance: 'explicit', is_status_quo: false, changes: ['Pro plan price'],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
      { label: 'Keep the Pro plan price at £49', provenance: 'explicit', is_status_quo: true, changes: ['Pro plan price'],
        interventions: [{ factor_label: 'Pro plan price', value: 49, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 100 },
      { label: 'Pro subscribers', role: 'external', baseline_known: true, baseline_value: 250, unit: 'subscribers', provenance: 'explicit', plausible_max: 1000 },
      { label: 'Monthly churn', role: 'external', baseline_known: true, baseline_value: 3, unit: '%', provenance: 'explicit', plausible_max: 100 },
      { label: 'New Pro subscribers per month', role: 'external', baseline_known: true, baseline_value: 20, unit: 'subscribers/month', provenance: 'explicit', plausible_max: 200 },
    ],
    risks: [],
    outcomes: [{ label: SUBS12, provenance: 'inferred' }],
    links: [
      ['Pro subscribers', SUBS12, 'positive'], ['Monthly churn', SUBS12, 'negative'], ['New Pro subscribers per month', SUBS12, 'positive'],
      [SUBS12, 'Pro MRR', 'positive'], ['Pro plan price', 'Pro MRR', 'positive'], ['Pro plan price', 'Monthly churn', 'positive'],
    ].map(([from, to, direction]) => ({ from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null })),
    identities, unknowns: [],
  } as unknown as CandidateModel;
}
const ACC = { outcome: SUBS12, operation: 'accumulation', factors: ['Pro subscribers', 'Monthly churn', 'New Pro subscribers per month'], provenance: 'inferred' };
const PRODUCT = { outcome: 'Pro MRR', operation: 'product', factors: ['Pro plan price', SUBS12], provenance: 'inferred' };
// Only the brief and recorded provider output are copied: no stored graph or live service is trusted by these replays.
const PILOT = JSON.parse(readFileSync(new URL('./fixtures/accumulation-pilot-head.json', import.meta.url), 'utf8')) as
  Record<'B1' | 'ACC', { brief: string; draft: CandidateModel }>;

async function build(brief: string, c: CandidateModel): Promise<{ result: Rec; nodes: Rec[]; graph: ReturnType<typeof GraphV3.parse>; instructions: string }> {
  let stored: string | undefined;
  let instructions = '';
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = JSON.stringify(GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph)));
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const call: CallStructuredModel = async (request) => {
    instructions ||= request.instructions;
    return { text: JSON.stringify(c) };
  };
  const result = await buildModelFromBrief(SCENARIO, brief, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 2000)).toBe(true);
  const graph = GraphV3.parse(JSON.parse(stored!));
  return { result, nodes: graph.nodes as Rec[], graph, instructions };
}
const carrierOn = (nodes: Rec[], label: string): unknown => nodes.find((n) => n.label === label)?.nonlinear_identity;
const said = (r: Rec): string => JSON.stringify(r);

describe('the accumulation reaches the registered graph only on an attested deadline', () => {
  it('registered on the derived node with the brief\'s three levels and an admitted goal product', async () => {
    const { nodes } = await build(BRIEF, candidate([ACC, PRODUCT]));
    const id = (label: string) => nodes.find((n) => n.label === label)!.id;
    expect(carrierOn(nodes, SUBS12)).toEqual({
      operation: 'accumulation',
      factor_ids: [id('Pro subscribers'), id('Monthly churn'), id('New Pro subscribers per month')],
      horizon_months: 12, rate_scale: 0.01, stated_in_brief: true,
    });
    // Registered and cold-read through GraphV3: stock cap 1000, inflow cap 200, horizon 12.
    const carrierNode = nodes.find((n) => n.label === SUBS12)!;
    expect(carrierNode.scale_frame).toBe(6800); // 2 × (1000 + 200 × 12)
    expect(carrierNode.observed_state).toBeUndefined();
  });

  it('CONTRAST: the same declaration on a brief with no deadline is refused, said, and nothing is carried', async () => {
    const { nodes, result } = await build(BRIEF.replace(' within 12 months', ''), candidate([ACC, PRODUCT]));
    expect(carrierOn(nodes, SUBS12)).toBeUndefined();
    expect(said(result)).toMatch(/states no deadline to work it out to/);
  });

  it('CONTROL: no accumulation declared → no carrier and no refusal', async () => {
    const { nodes, result } = await build(BRIEF, candidate([]));
    expect(carrierOn(nodes, SUBS12)).toBeUndefined();
    expect(said(result)).not.toMatch(/worked out month by month/);
  });

  it('the drafter is required to declare the goal product whenever it declares an accumulation', async () => {
    const { instructions } = await build(BRIEF, candidate([ACC, PRODUCT]));
    expect(instructions).toMatch(/(?:REQUIRED|MUST)[^.]*PRODUCT[^.]*price[^.]*month N|PRODUCT[^.]*price[^.]*month N[^.]*(?:REQUIRED|MUST)/i);
  });

  it('an accumulation with only a plain link to the goal is refused and disclosed', async () => {
    const { nodes, result } = await build(BRIEF, candidate([ACC]));
    expect(carrierOn(nodes, SUBS12)).toBeUndefined();
    expect(said(result)).toContain('but nothing in the model works the goal out from it, so that was not used');
  });

  it('an accumulation declared on the goal is refused, said, and nothing is carried', async () => {
    const { nodes, result } = await build(BRIEF, candidate([{ ...ACC, outcome: 'Pro MRR' }]));
    expect(carrierOn(nodes, 'Pro MRR')).toBeUndefined();
    expect(carrierOn(nodes, SUBS12)).toBeUndefined();
    expect(said(result)).toMatch(/the goal itself is never worked out this way/);
  });

  // Bound at ADMISSION: its ledger is where the product checker's refusal lands (the build result does not echo it).
  it('the product checker no longer refuses an accumulation; CONTROL: an unknown operation still is', () => {
    const refusedAs = (identities: unknown[]): string[] => admitCandidateModel(candidate(identities), {}, BRIEF).loss
      .filter((l) => /nonlinear_identity_rejected$/.test(l.field_path)).map((l) => l.reason);
    expect(refusedAs([ACC]).filter((r) => /is not a relationship Olumi can check/.test(r))).toEqual([]);
    expect(refusedAs([{ ...ACC, operation: 'ratio' }]).filter((r) => /"ratio" is not a relationship Olumi can check/.test(r))).toHaveLength(1);
  });
});

describe('recorded head pilot outputs replayed offline through admission and registration', () => {
  it('invented accumulation levels reach neither month-12/MRR reply figures nor Run readiness; stated ACC levels do', async () => {
    // Raw provider_calls[-1].output_text from p45-acc4-pilot-20261008/live2-head/{B1,ACC}-d1.json.
    // The older accumulation-pilot-head fixture has B1 150/5/25 and an ACC draft without its goal product.
    const recorded = JSON.parse(readFileSync(new URL('./fixtures/accumulation-live2-head.json', import.meta.url), 'utf8')) as typeof PILOT;
    const brief = 'Our goal is to reach £20k MRR within 12 months while keeping monthly churn under 8%. Should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';
    expect(recorded.B1.brief).toBe(brief);
    const { result, graph, nodes } = await build(brief, recorded.B1.draft);

    // Enumerate EVERY returned string recursively, including assistant-facing fields and any reply/receipt added later.
    const stringFields = (value: unknown, path = 'result'): [string, string][] => {
      if (typeof value === 'string') return [[path, value]];
      if (Array.isArray(value)) return value.flatMap((item, i) => stringFields(item, `${path}[${i}]`));
      if (value !== null && typeof value === 'object') return Object.entries(value)
        .flatMap(([key, item]) => stringFields(item, `${path}.${key}`));
      return [];
    };
    const fields = stringFields(result);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.some(([path]) => path.startsWith('result.open_questions['))).toBe(true);
    expect(fields.some(([path]) => path.startsWith('result.not_represented['))).toBe(true);
    let inputSentences = 0;
    for (const [path, value] of fields) {
      expect.soft(value, path).not.toMatch(/\b200\s*[×x*]|(?:£|GBP)\s*9[\s,]?800\b|\b314\b/i);
      for (const sentence of value.split(/(?<=[.!?])\s+/u)) {
        // Product reconciliation's "(within 5%)" is a tolerance, not the invented monthly churn level.
        const withoutTolerance = sentence.replace(/\(\s*within\s+5\s*%\s*\)/gi, '');
        if (!/\b(?:200|20)\b|\b5\s*%/.test(withoutTolerance)) continue;
        expect.soft(sentence, `${path}: invented input used in a projection`).not.toMatch(/\bmonth[\s-]*12\b|\bMRR\b|monthly recurring revenue/i);
        if (!/subscrib|churn|inflow|sign.?ups/i.test(value)) continue;
        inputSentences++;
        // The drafter's own question ("The model provisionally assumes 200 …") is the only ask for these figures until the
        // one-card ask (#5) replaces it: a mention must be hedged as an assumption or labelled Olumi's, never stated as fact.
        expect.soft(sentence, `${path}: invented input attribution`).toMatch(/Olumi['’]s estimates?\b|starting figure|provisional|assum|estimat/i);
      }
    }
    expect(inputSentences).toBeGreaterThan(0); // The attribution check must actually see the recorded invented inputs.

    const stock = nodes.find((n) => n.label === SUBS12)!;
    expect.soft(stock.nonlinear_identity, 'B1 carrier').toMatchObject({ operation: 'accumulation', stated_in_brief: false });
    const inputs = (stock.nonlinear_identity as { factor_ids: string[] }).factor_ids.map((id) => nodes.find((n) => n.id === id)!.observed_state as Rec);
    expect(inputs.map((s) => [s.raw_value ?? s.value, s.source])).toEqual([[200, 'cee_inference'], [5, 'cee_inference'], [20, 'cee_inference']]);
    // Census chance_ready = !chancesWithheldByAGuess(graph): p44-2848-pilot-20261008/census3.ts:25.
    // Reuse the Run placeholder/P5 readers in runtime/build-model.ts:1453, rather than inferring readiness from the stamp.
    expect.soft(!chancesWithheldByAGuess(graph), 'B1 chance_ready').toBe(false);

    const accBrief = 'We have 250 Pro subscribers paying £49 a month. We add about 20 new Pro subscribers a month and lose about 3% of them each month. Our goal is to reach £20k MRR within 12 months. Should we raise the Pro price to £59 a month?';
    expect(recorded.ACC.brief).toBe(accBrief);
    const control = await build(accBrief, recorded.ACC.draft);
    expect.soft(carrierOn(control.nodes, SUBS12), 'ACC carrier').toMatchObject({ operation: 'accumulation', stated_in_brief: true });
    expect.soft(!chancesWithheldByAGuess(control.graph), 'ACC chance_ready').toBe(true);
  });

  it('B1 retains its used accumulation as Olumi\'s reading and cannot make chances ready from invented levels', async () => {
    const { graph, nodes } = await build(PILOT.B1.brief, PILOT.B1.draft);
    const stock = nodes.find((n) => n.label === SUBS12)!;
    expect(stock.nonlinear_identity).toMatchObject({ operation: 'accumulation', stated_in_brief: false });
    const identity = stock.nonlinear_identity as { factor_ids: string[] };
    expect(identity.factor_ids.map((id) => (nodes.find((n) => n.id === id)!.observed_state as Rec).source))
      .toEqual(['cee_inference', 'cee_inference', 'cee_inference']);
    expect(nodes.find((n) => n.kind === 'goal')!.nonlinear_identity).toMatchObject({ operation: 'product', factor_ids: expect.arrayContaining([stock.id]) });
    expect(chancesWithheldByAGuess(graph)).toBe(true);
  });

  it('ACC omits the goal product: its unused accumulation is refused with the ledger line', async () => {
    const { nodes, result } = await build(PILOT.ACC.brief, PILOT.ACC.draft);
    expect(carrierOn(nodes, SUBS12)).toBeUndefined();
    expect(said(result)).toContain('but nothing in the model works the goal out from it, so that was not used');
  });

  it('ACC with the required goal product carries the three brief levels as stated and keeps today\'s £12,250', async () => {
    const repaired: CandidateModel = {
      ...structuredClone(PILOT.ACC.draft),
      identities: [...(PILOT.ACC.draft.identities ?? []), { outcome: 'MRR', operation: 'product', factors: ['Pro price', SUBS12], provenance: 'inferred' }],
    };
    const { nodes } = await build(PILOT.ACC.brief, repaired);
    const stock = nodes.find((n) => n.label === SUBS12)!;
    expect(stock.nonlinear_identity).toMatchObject({ operation: 'accumulation', stated_in_brief: true });
    const identity = stock.nonlinear_identity as { factor_ids: string[] };
    expect(identity.factor_ids.map((id) => (nodes.find((n) => n.id === id)!.observed_state as Rec).source))
      .toEqual(['brief_extraction', 'brief_extraction', 'brief_extraction']);
    const goal = nodes.find((n) => n.kind === 'goal')!;
    expect(goal.nonlinear_identity).toMatchObject({ operation: 'product', factor_ids: expect.arrayContaining([stock.id]) });
    expect((goal.observed_state as Rec).raw_value).toBe(12250);
  });
});
