/**
 * ⛔ A LEVEL THE BRIEF STATES FOR A FACTOR IS THE USER'S, WHATEVER THE DRAFTER TAGGED IT (R3 #72 5896630173 (2); DL
 * 5896669522). Served `03b720e0` on `a20cfd6`, Paul's MRR brief: the drafter gave "Pro plan paying subscribers" 1,500 as an
 * ESTIMATE, it was saved `cee_inference`, the MRR product had no two user-stated parts, and the Run showed 6 goal chances.
 * THE PATH: the REAL `buildModelFromBrief` (drafter faked with the served draft's shape) → `/graph/register` → the saved
 * graph → the card detector the Run reads (`proposeProductIdentity`). 0 LLM.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { creditStatedFactorLevels } from '../stated-by-user.js';
import { proposeProductIdentity } from '../identity-proposal.js';
import type { CandidateModel } from '../admit-model.js';

type Rec = Record<string, unknown>;
type Node = Rec & { id: string; kind: string; label: string };
const SCENARIO = '0b3c7d2e-1f4a-4b5c-9d6e-7f8a9b0c1d2e';
/** Paul's MRR brief, verbatim as served (`03b720e0`). */
const MRR = 'Should we raise our Pro plan price from £49 to £59 a month? We have 1,500 paying subscribers and £75k MRR. Monthly churn must stay below 5%, and we want MRR above £85k within a year.';

function draft(subscribers: { baseline_known: boolean; provenance: string } = { baseline_known: false, provenance: 'inferred' }): CandidateModel {
  return {
    goal: { metric: 'MRR', operator: '>', target_stated: true, frame: 'level', value: 85000, unit: 'GBP/month', horizon_months: 12, provenance: 'explicit',
      baseline_known: true, baseline_value: 75000, baseline_provenance: 'explicit', scope: null },
    constraints: [{ metric: 'Monthly churn', operator: '<', value: 5, unit: '%', provenance: 'explicit' }],
    options: [
      { label: 'Raise Pro to £59', provenance: 'explicit', is_status_quo: null, changes: ['Pro plan price'],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP per subscriber per month', provenance: 'explicit' }] },
      { label: 'Keep Pro at £49', provenance: 'explicit', is_status_quo: true, changes: ['Pro plan price'],
        interventions: [{ factor_label: 'Pro plan price', value: 49, value_kind: 'absolute', unit: 'GBP per subscriber per month', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP per subscriber per month', provenance: 'explicit', plausible_max: 200 },
      { label: 'Pro plan paying subscribers', role: 'observable', baseline_value: 1500, unit: 'subscribers', plausible_max: 10000, ...subscribers },
      { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: 3.5, unit: '%', provenance: 'inferred', plausible_max: 100 },
    ],
    risks: [], outcomes: [], unknowns: [],
    links: [
      { from: 'Pro plan price', to: 'MRR', direction: 'positive', provenance: 'inferred' },
      { from: 'Pro plan paying subscribers', to: 'MRR', direction: 'positive', provenance: 'inferred' },
      { from: 'Monthly churn', to: 'Pro plan paying subscribers', direction: 'negative', provenance: 'inferred' },
    ],
  } as unknown as CandidateModel;
}

async function build(candidate: unknown): Promise<{ nodes: Node[] } & Rec> {
  let stored: string | undefined;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = JSON.stringify(GraphV3.parse(projectGraphForPersistence((body as { graph: unknown }).graph)));
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  };
  const call: CallStructuredModel = async () => ({ text: JSON.stringify(candidate) });
  const result = await buildModelFromBrief(SCENARIO, MRR, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 600)).toBe(true);
  return GraphV3.parse(JSON.parse(stored!)) as unknown as { nodes: Node[] } & Rec;
}
const node = (g: { nodes: Node[] }, label: string): Node => g.nodes.find((n) => n.label === label)!;
const source = (n: Node): unknown => (n.observed_state as Rec | undefined)?.source;

describe('a level the brief states for a factor is the user\'s, whatever the drafter tagged it', () => {
  it('⭐ RED (served 03b720e0 shape, real build): "1,500 paying subscribers" drafted as an estimate → saved as the user\'s, and the Run\'s card detector finds the MRR product', async () => {
    const g = await build(draft());
    const subs = node(g, 'Pro plan paying subscribers');
    expect(source(subs)).toBe('brief_extraction');
    expect((subs.observed_state as Rec).raw_value).toBe(1500);
    expect(source(node(g, 'Monthly churn')), 'CONTROL: an estimate the brief never states stays Olumi\'s').toBe('cee_inference');
    expect(proposeProductIdentity(g), 'the card the Run offers on the product-shaped goal').not.toBeNull();
  });
  // ⛔ PR Review CR on #2311 @ ff5e7480: the status quo ("keep Pro at £49") sets today's price by definition, so it
  // never excludes the brief's "from £49" as today's level.
  it('⭐ RED (PR Review): the £49 price ALSO drafted as an estimate, beside the status quo\'s £49 → both parts the user\'s, and the card', async () => {
    const d = draft() as unknown as { factors: Rec[] };
    const g = await build({ ...d, factors: d.factors.map((f) => (f.label === 'Pro plan price' ? { ...f, baseline_known: false, provenance: 'inferred' } : f)) });
    expect(source(node(g, 'Pro plan price'))).toBe('brief_extraction');
    expect(source(node(g, 'Pro plan paying subscribers'))).toBe('brief_extraction');
    expect(proposeProductIdentity(g)).not.toBeNull();
  });
  it('CONTROL (the stated count, drafted as the user\'s): the same saved graph', async () => {
    const g = await build(draft({ baseline_known: true, provenance: 'explicit' }));
    expect(source(node(g, 'Pro plan paying subscribers'))).toBe('brief_extraction');
    expect(proposeProductIdentity(g)).not.toBeNull();
  });
});

describe('creditStatedFactorLevels: only a figure the brief writes FOR that factor, never a limit, target or option level', () => {
  const credited = (d: CandidateModel, label: string): boolean => {
    const f = creditStatedFactorLevels(d, MRR).factors.find((x) => x.label === label)!;
    return f.baseline_known === true && f.provenance === 'explicit';
  };
  const withFactor = (f: Rec): CandidateModel => { const d = draft(); return { ...d, factors: [...d.factors, f] } as unknown as CandidateModel; };
  it.each<[string, CandidateModel, string, boolean]>([
    ['the served estimate of the stated count', draft(), 'Pro plan paying subscribers', true],
    ['an estimate the brief never states (churn 3.5%)', draft(), 'Monthly churn', false],
    ['the LIMIT as today\'s churn (5%, "must stay below 5%")',
      { ...draft(), factors: draft().factors.map((f) => (f.label === 'Monthly churn' ? { ...f, baseline_value: 5 } : f)) } as CandidateModel, 'Monthly churn', false],
    ['the STATUS QUO\'s level is today\'s ("from £49", keep Pro at £49): the price estimate of 49',
      { ...draft(), factors: draft().factors.map((f) => (f.label === 'Pro plan price' ? { ...f, baseline_known: false, provenance: 'inferred' } : f)) } as CandidateModel, 'Pro plan price', true],
    ['a PROPOSED option\'s level as today\'s price (£59)',
      { ...draft(), factors: draft().factors.map((f) => (f.label === 'Pro plan price' ? { ...f, baseline_known: false, provenance: 'inferred', baseline_value: 59 } : f)) } as CandidateModel, 'Pro plan price', false],
    ['another factor\'s figure (1,500 as "New subscribers per month")',
      withFactor({ label: 'New subscribers per month', role: 'observable', baseline_known: false, baseline_value: 1500, unit: 'subscribers', provenance: 'inferred', plausible_max: 10000 }), 'New subscribers per month', false],
  ])('%s → credited: %s', (_why, d, label, expected) => {
    expect(credited(d, label)).toBe(expected);
  });
  it('nothing to credit → the same object (no churn in the hash)', () => {
    const d = draft({ baseline_known: true, provenance: 'explicit' });
    expect(creditStatedFactorLevels(d, MRR)).toBe(d);
  });
});
