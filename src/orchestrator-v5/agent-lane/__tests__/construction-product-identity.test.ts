/**
 * ⛔ C46 STAGE 1 — A PRODUCT THE ANALYSIS ADDS UP MUST BE DECLARED, CHECKED AND SAID.
 *
 * Ruling (ChatGPT #70 5841314428, binding): do not ship a silent linear approximation as
 * decision-grade analysis where a multiplicative identity can change the sign. MEASURED
 * engine-direct (#70 5841215337): the analyse path is a linear SCM, so £49 -> £59 gives
 * -960 at ANY subscriber level, while MRR = price x subscribers gives -1,360 at 100
 * subscribers and +640 at 300. The sign of the price effect is not stable.
 *
 * The fixture is Paul's captured pricing brief ("£20k MRR within 12 months, churn under
 * 10%, £49 -> £59"), reduced to the shape the served drafter produced in runs
 * f-20260925T231324Z / f-20260925T231546Z: price -> price resistance -> new conversions /
 * churn -> Pro subscribers -> Pro MRR -> MRR.
 *
 * Rules pinned here, every candidate validated against the REAL strict construction
 * schema and served through `buildModelFromBrief` -> `/graph/register` -> `GraphV3.parse`,
 * with the readiness authority read on the registered graph. Assertions bind by node id.
 *  1. A DECLARED product whose inputs an option can push in opposite directions is marked
 *     `sign_not_provable`, naming those options by id, and the missing capability is said
 *     in plain English.
 *  2. A declared product every option moves the same way is `sign_stable_provisional`:
 *     marked provisional, never "cannot say which option does better".
 *  3. Nothing is inferred from a label: the same model with NO declaration is unchanged,
 *     byte for byte (graph and result).
 *  4. A declaration that does not hold structurally (a factor not in the model, a factor
 *     that does not feed the outcome, an outcome not in the model) is rejected and said,
 *     never trusted.
 *
 * ⚠ SCOPE OF THIS FILE. The typed mark lives in the construction carriers (admission loss +
 * the build result). It does NOT yet reach `analysis_state.leader_claim`: no GraphV3 field can
 * carry the identity (NodeV3 strips undeclared keys) and the leader permission is written only
 * in `run-analysis.ts`. That is a HANDOFF, pinned by the last test below so it cannot be
 * mistaken for done.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const BRIEF =
  'Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 10%, should we increase ' +
  'the Pro plan price from £49 to £59 per month with the next AI feature release?';

type Link = { from: string; to: string; direction: 'positive' | 'negative' | 'unknown'; provenance: string };
type Identity = { outcome: string; operation: string; factors: string[]; provenance: string };

const PRO_MRR_IDENTITY: Identity = { outcome: 'Pro MRR', operation: 'product', factors: ['Pro plan price', 'Pro subscribers'], provenance: 'inferred' };

/** The captured pricing shape. `identities` is exactly what the drafter declares; nothing else differs. */
function pricing(identities: Identity[] | undefined): Record<string, unknown> {
  const link = (from: string, to: string, direction: Link['direction']): Link => ({ from, to, direction, provenance: 'inferred' });
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit',
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [{ metric: 'Monthly churn', operator: '<=', value: 10, unit: '%', provenance: 'explicit' }],
    options: [
      { label: 'Keep Pro at £49', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Raise Pro to £59', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
      { label: 'Phase to £54', provenance: 'ai_proposed', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'Pro plan price', value: 54, value_kind: 'absolute', unit: 'GBP', provenance: 'ai_proposed' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
      { label: 'Pro subscribers', role: 'observable', baseline_known: false, baseline_value: 300, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
      { label: 'New Pro conversions', role: 'observable', baseline_known: false, baseline_value: 30, unit: 'per month', provenance: 'ai_proposed', plausible_max: 500 },
      { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: 5, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
    ],
    risks: [{ label: 'Price resistance', provenance: 'inferred' }],
    outcomes: [{ label: 'Pro MRR', provenance: 'inferred' }],
    links: [
      link('Pro plan price', 'Price resistance', 'positive'),
      link('Price resistance', 'New Pro conversions', 'negative'),
      link('Price resistance', 'Monthly churn', 'positive'),
      link('New Pro conversions', 'Pro subscribers', 'positive'),
      link('Monthly churn', 'Pro subscribers', 'negative'),
      link('Pro plan price', 'Pro MRR', 'positive'),
      link('Pro subscribers', 'Pro MRR', 'positive'),
      link('Pro MRR', 'MRR', 'positive'),
    ],
    ...(identities === undefined ? {} : { identities }),
    unknowns: [],
  };
}

/**
 * The same revenue identity, but every option moves its inputs THE SAME WAY: an add-on
 * raises revenue per Pro user AND lowers churn (so raises subscribers) — two inputs, one
 * direction — and a referral scheme raises subscribers only.
 */
function sameSign(): Record<string, unknown> {
  const link = (from: string, to: string, direction: Link['direction']): Link => ({ from, to, direction, provenance: 'inferred' });
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit',
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Launch AI add-on', provenance: 'explicit', is_status_quo: null, changes: ['AI add-on uptake'], interventions: [] },
      { label: 'Referral scheme', provenance: 'ai_proposed', is_status_quo: null, changes: ['Referral volume'], interventions: [] },
    ],
    factors: [
      { label: 'AI add-on uptake', role: 'controllable', baseline_known: false, baseline_value: 0, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'Referral volume', role: 'controllable', baseline_known: false, baseline_value: 10, unit: 'per month', provenance: 'ai_proposed', plausible_max: 1000 },
      { label: 'Revenue per Pro user', role: 'observable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
      { label: 'Pro subscribers', role: 'observable', baseline_known: false, baseline_value: 300, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
      { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: 5, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
    ],
    risks: [],
    outcomes: [{ label: 'Pro MRR', provenance: 'inferred' }],
    links: [
      link('AI add-on uptake', 'Revenue per Pro user', 'positive'),
      link('AI add-on uptake', 'Monthly churn', 'negative'),
      link('Monthly churn', 'Pro subscribers', 'negative'),
      link('Referral volume', 'Pro subscribers', 'positive'),
      link('Revenue per Pro user', 'Pro MRR', 'positive'),
      link('Pro subscribers', 'Pro MRR', 'positive'),
      link('Pro MRR', 'MRR', 'positive'),
    ],
    identities: [{ outcome: 'Pro MRR', operation: 'product', factors: ['Revenue per Pro user', 'Pro subscribers'], provenance: 'inferred' }],
    unknowns: [],
  };
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

type Graph = { nodes: { id: string; kind: string; label: string }[]; edges: { from: string; to: string }[] };

async function build(wire: Record<string, unknown>, { validate = true } = {}) {
  if (validate) expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let registered: unknown = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('46464646-4646-4646-8646-464646464646', BRIEF, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(registered) as unknown as Graph, raw: registered, out };
}

const said = (out: Record<string, unknown>) => (out.not_represented as string[]) ?? [];
const identityLoss = (m: ReturnType<typeof admitCandidateModel>) => m.loss.filter((l) => /\.nonlinear_identity$/.test(l.field_path));
const rejectedLoss = (m: ReturnType<typeof admitCandidateModel>) => m.loss.filter((l) => /\.nonlinear_identity_rejected$/.test(l.field_path));
const blocking = (g: unknown) => assessCanonicalAnalysisReadiness(g).blockingIssues.map((i) => i.code).sort();

describe('rule 1: a declared product whose inputs move apart is marked sign_not_provable, and said', () => {
  it('RED: the typed mark names the outcome, the factors and the options by id', async () => {
    const { out, graph } = await build(pricing([PRO_MRR_IDENTITY]));
    expect(graph.nodes.find((n) => n.id === 'pro_mrr')?.kind).toBe('outcome');
    expect(out.nonlinear_identities).toEqual([{
      outcome_id: 'pro_mrr',
      operation: 'product',
      factor_ids: ['pro_plan_price', 'pro_subscribers'],
      verdict: 'sign_not_provable',
      options_not_sign_stable: ['raise_pro_to_59', 'phase_to_54'],
    }]);
  });

  it('RED: the admission ledger carries the same mark, as a warning on the outcome node', () => {
    const admitted = admitCandidateModel(pricing([PRO_MRR_IDENTITY]) as unknown as CandidateModel);
    const [entry, ...more] = identityLoss(admitted);
    expect(more).toEqual([]);
    expect(entry?.field_path).toBe('nodes[pro_mrr].nonlinear_identity');
    expect(entry?.severity).toBe('warn');
    expect(entry?.before).toEqual({ operation: 'product', factor_ids: ['pro_plan_price', 'pro_subscribers'] });
    expect(entry?.after).toEqual({ verdict: 'sign_not_provable', options_not_sign_stable: ['raise_pro_to_59', 'phase_to_54'] });
    expect(admitted.nonlinear_identities?.map((m) => m.verdict)).toEqual(['sign_not_provable']);
  });

  it('RED: the missing capability is said in plain English, naming the outcome, both factors and the options', async () => {
    const { out } = await build(pricing([PRO_MRR_IDENTITY]));
    const lines = said(out).filter((s) => s.includes('"Pro MRR"') && s.includes('multipl'));
    expect(lines).toHaveLength(1);
    const [line] = lines as [string];
    for (const phrase of ['"Pro plan price"', '"Pro subscribers"', '"Raise Pro to £59"', '"Phase to £54"', 'opposite directions', 'cannot yet multiply', 'which option does better on "MRR"']) {
      expect(line, phrase).toContain(phrase);
    }
    // Words, never codes: the sentence reaches the user.
    expect(line).not.toMatch(/sign_not_provable|nonlinear_identity|pro_mrr/);
  });

  it('the mark adds no readiness blocker: the model still runs, as an approximation', async () => {
    const withIt = await build(pricing([PRO_MRR_IDENTITY]));
    const without = await build(pricing([]));
    expect(blocking(withIt.graph)).toEqual(blocking(without.graph));
  });
});

describe('rule 2: a declared product every option moves the same way is provisional, not withheld', () => {
  it('RED: one lever moving BOTH inputs up, and one moving one input, is sign_stable_provisional', async () => {
    const { out } = await build(sameSign());
    expect(out.nonlinear_identities).toEqual([{
      outcome_id: 'pro_mrr',
      operation: 'product',
      factor_ids: ['revenue_per_pro_user', 'pro_subscribers'],
      verdict: 'sign_stable_provisional',
      options_not_sign_stable: [],
    }]);
    const lines = said(out).filter((s) => s.includes('"Pro MRR"') && s.includes('multipl'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('provisional');
    expect(lines[0]).not.toContain('opposite directions');
    expect(lines[0]).not.toContain('which option does better');
  });

  it('RED: the ledger entry is information, not a warning', () => {
    const [entry] = identityLoss(admitCandidateModel(sameSign() as unknown as CandidateModel));
    expect(entry?.severity).toBe('info');
    expect(entry?.after).toEqual({ verdict: 'sign_stable_provisional', options_not_sign_stable: [] });
  });
});

describe('rule 3 (control): nothing is inferred from a label', () => {
  it('the same pricing labels with NO declaration: no mark, no line, and the graph is byte-identical to the legacy candidate', async () => {
    const declaredNone = await build(pricing([]));
    // A candidate from before the field (no `identities`, no `goal.scope` key) is what staging builds today.
    const legacy = pricing(undefined);
    delete (legacy.goal as Record<string, unknown>).scope;
    const before = await build(legacy, { validate: false });
    expect(JSON.stringify(declaredNone.raw)).toBe(JSON.stringify(before.raw));
    expect(declaredNone.out).toEqual(before.out);
    expect(declaredNone.out).not.toHaveProperty('nonlinear_identities');
    expect(said(declaredNone.out).filter((s) => s.includes('multipl'))).toEqual([]);
    expect(identityLoss(admitCandidateModel(pricing([]) as unknown as CandidateModel))).toEqual([]);
  });

  it('the declaration adds nothing to the registered graph (the typed mark is not graph content)', async () => {
    const withIt = await build(pricing([PRO_MRR_IDENTITY]));
    const without = await build(pricing([]));
    expect(JSON.stringify(withIt.raw)).toBe(JSON.stringify(without.raw));
  });
});

describe('rule 4: a declaration that does not hold structurally is rejected and said, never trusted', () => {
  it('RED: a factor that is not in the model (even beside two that are) rejects the whole declaration', async () => {
    const bad: Identity = { ...PRO_MRR_IDENTITY, factors: ['Pro plan price', 'Pro subscribers', 'Pro seats'] };
    const admitted = admitCandidateModel(pricing([bad]) as unknown as CandidateModel);
    expect(identityLoss(admitted)).toEqual([]);
    expect(rejectedLoss(admitted).map((l) => l.field_path)).toEqual(['nodes[pro_mrr].nonlinear_identity_rejected']);
    const { out } = await build(pricing([bad]));
    expect(out).not.toHaveProperty('nonlinear_identities');
    const lines = said(out).filter((s) => s.includes('"Pro seats"'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('not in the model');
    expect(lines[0]).toContain('not used');
  });

  it('RED: a factor that does not feed the outcome rejects it (Pro MRR does not drive Pro subscribers)', () => {
    const reversed: Identity = { outcome: 'Pro subscribers', operation: 'product', factors: ['Pro MRR', 'Pro plan price'], provenance: 'inferred' };
    const admitted = admitCandidateModel(pricing([reversed]) as unknown as CandidateModel);
    expect(identityLoss(admitted)).toEqual([]);
    const [r] = rejectedLoss(admitted);
    expect(r?.field_path).toBe('nodes[pro_subscribers].nonlinear_identity_rejected');
    expect(r?.reason).toContain('"Pro MRR" does not feed into "Pro subscribers"');
  });

  it('RED: an outcome that is not in the model is rejected', () => {
    const missing: Identity = { ...PRO_MRR_IDENTITY, outcome: 'Pro revenue' };
    const admitted = admitCandidateModel(pricing([missing]) as unknown as CandidateModel);
    expect(identityLoss(admitted)).toEqual([]);
    const [r] = rejectedLoss(admitted);
    expect(r?.reason).toContain('"Pro revenue" is not in the model');
  });

  it('RED: the strict schema admits only a product, and requires the key', () => {
    const wrongOp = { ...pricing([{ ...PRO_MRR_IDENTITY, operation: 'sum' }]) };
    expect(strict(wrongOp)).toBe(false);
    const { identities: _dropped, ...withoutKey } = pricing([]);
    expect(strict(withoutKey), 'strict output must say "none" rather than omit the key').toBe(false);
  });
});

describe('HANDOFF pin: the mark does not reach the persisted graph, so the leader claim cannot read it yet', () => {
  it('GraphV3 has no declared carrier for the identity: an undeclared key on the outcome node is stripped', async () => {
    const { raw } = await build(pricing([PRO_MRR_IDENTITY]));
    const graph = structuredClone(raw) as { nodes: Record<string, unknown>[] };
    const outcome = graph.nodes.find((n) => n.id === 'pro_mrr')!;
    outcome.nonlinear_identity = { operation: 'product', factor_ids: ['pro_plan_price', 'pro_subscribers'] };
    const reparsed = GraphV3.parse(graph) as unknown as { nodes: Record<string, unknown>[] };
    expect(reparsed.nodes.find((n) => n.id === 'pro_mrr')).not.toHaveProperty('nonlinear_identity');
  });
});
