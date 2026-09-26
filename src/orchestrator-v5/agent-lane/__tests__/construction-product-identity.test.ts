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
 *  5. THE COMPARISON ARM (independent verification of 6e33b95e, B1): two options that move
 *     the product's inputs DIFFERENTLY — different inputs, different signs, different levers
 *     for two inputs, or one moving none of them — can swap places within the plausible
 *     range, so the verdict is `sign_not_provable` even when each option alone is stable. So can
 *     an option that also reaches the goal AROUND the product (a path avoiding the outcome, or an
 *     addend of it) against one moving the same input alone (re-verification of d2362e9d, B1); and
 *     the sentence groups options by how they move the inputs, never "all of these differ" (d).
 *  6. The rules the verification found unpinned (B3): the served two-lever option, an outcome
 *     that does not reach the goal, case/spacing, one or duplicated factors, a path through the
 *     outcome; and a status quo at today's level is never a lever (N-b), a product that is only
 *     part of a total says so, and an inferred declaration is attributed to Olumi (N-c).
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

type Link = { from: string; to: string; direction: 'positive' | 'negative' | 'unknown'; provenance: string; effect_amount?: number | null; effect_per_source_change?: number | null; effect_provenance?: string | null };
type Identity = { outcome: string; operation: string; factors: string[]; provenance: string };

const PRO_MRR_IDENTITY: Identity = { outcome: 'Pro MRR', operation: 'product', factors: ['Pro plan price', 'Pro subscribers'], provenance: 'inferred' };

/** The captured pricing shape. `identities` is exactly what the drafter declares; nothing else differs. */
function pricing(identities: Identity[] | undefined): Record<string, unknown> {
  const link = (from: string, to: string, direction: Link['direction']): Link => ({ from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit',
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [{ metric: 'Monthly churn', operator: '<=', value: 10, unit: '%', provenance: 'explicit', frame: 'level' }],
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
 * The same revenue identity, and each option ALONE moves its inputs one way: an add-on raises
 * revenue per Pro user AND lowers churn (so raises subscribers) — two inputs, one direction —
 * and a referral scheme raises subscribers only.
 *
 * ⛔ B1 (independent verification of 6e33b95e): this used to be the `sign_stable_provisional`
 * fixture, and the sentence said "the direction of the result holds". It does not hold for
 * the COMPARISON: the add-on's gain is ΔR·S + R·ΔS, the referral's R·ΔS′, so which is larger
 * depends on the levels R and S sit at — the leader can flip within the plausible range, and a
 * sum of separate effects cannot see it. The expectation is flipped below (rule 5).
 */
function sameSign(): Record<string, unknown> {
  const link = (from: string, to: string, direction: Link['direction']): Link => ({ from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
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

/**
 * Rule 2's stable shape: every option acts through the SAME one lever, which moves both inputs
 * the same way, so the options differ only in how far they push it and cannot swap places.
 */
function oneLever(): Record<string, unknown> {
  const wire = sameSign() as { options: unknown[] };
  return {
    ...wire,
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Launch AI add-on', provenance: 'explicit', is_status_quo: null, changes: ['AI add-on uptake'], interventions: [] },
      { label: 'Add-on to half the base', provenance: 'ai_proposed', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'AI add-on uptake', value: 50, value_kind: 'absolute', unit: '%', provenance: 'ai_proposed' }] },
    ],
  };
}

type Dir = 'positive' | 'negative';
type SmallOption = { label: string; changes?: string[]; levels?: [string, number][]; sq?: true };
type SmallFactor = { label: string; role?: 'controllable' | 'observable' | 'external'; baseline?: number; known?: boolean; max?: number };

/** A minimal strict-schema candidate, for the rules that need one shape each. Goal "MRR". */
function small(s: {
  options: SmallOption[];
  factors: SmallFactor[];
  links: [string, string, Dir][];
  identities: Identity[];
  outcomes?: string[];
  risks?: string[];
}): Record<string, unknown> {
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit',
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [],
    options: s.options.map((o) => ({
      label: o.label, provenance: 'ai_proposed', is_status_quo: o.sq === true ? true : null, changes: o.changes ?? [],
      interventions: (o.levels ?? []).map(([factor_label, value]) => ({ factor_label, value, value_kind: 'absolute', unit: 'units', provenance: 'ai_proposed' })),
    })),
    factors: s.factors.map((f) => ({
      label: f.label, role: f.role ?? 'observable', baseline_known: f.known ?? false, baseline_value: f.baseline ?? 10,
      unit: 'units', provenance: 'ai_proposed', plausible_max: f.max ?? 1000,
    })),
    risks: (s.risks ?? []).map((label) => ({ label, provenance: 'inferred' })),
    outcomes: (s.outcomes ?? ['Pro MRR']).map((label) => ({ label, provenance: 'inferred' })),
    links: s.links.map(([from, to, direction]) => ({ from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null })),
    identities: s.identities,
    unknowns: [],
  };
}

const REV_X_SUBS: Identity = { outcome: 'Pro MRR', operation: 'product', factors: ['Revenue per Pro user', 'Pro subscribers'], provenance: 'inferred' };
const CARRY_ON: SmallOption = { label: 'Carry on as now', sq: true };
const REVENUE_CHAIN: [string, string, Dir][] = [
  ['Revenue per Pro user', 'Pro MRR', 'positive'],
  ['Pro subscribers', 'Pro MRR', 'positive'],
  ['Pro MRR', 'MRR', 'positive'],
];

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
/** Admission on a candidate the REAL strict schema accepts. */
const admit = (wire: Record<string, unknown>) => {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  return admitCandidateModel(wire as unknown as CandidateModel);
};
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
      comparisons_not_sign_stable: [],
    }]);
  });

  it('RED: the admission ledger carries the same mark, as a warning on the outcome node', () => {
    const admitted = admitCandidateModel(pricing([PRO_MRR_IDENTITY]) as unknown as CandidateModel);
    const [entry, ...more] = identityLoss(admitted);
    expect(more).toEqual([]);
    expect(entry?.field_path).toBe('nodes[pro_mrr].nonlinear_identity');
    expect(entry?.severity).toBe('warn');
    expect(entry?.before).toEqual({ operation: 'product', factor_ids: ['pro_plan_price', 'pro_subscribers'] });
    expect(entry?.after).toEqual({ verdict: 'sign_not_provable', options_not_sign_stable: ['raise_pro_to_59', 'phase_to_54'], comparisons_not_sign_stable: [] });
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
    // N-c: the declaration is the drafter's inference, so the sentence says it is Olumi's reading.
    expect(line.startsWith('Olumi reads "Pro MRR" as "Pro plan price" and "Pro subscribers" multiplied together')).toBe(true);
    // Both options move the inputs the same way, so no comparison is named.
    expect(line).not.toContain('the same way');
    // Words, never codes: the sentence reaches the user.
    expect(line).not.toMatch(/sign_not_provable|nonlinear_identity|pro_mrr/);
  });

  it('the mark adds no readiness blocker: the model still runs, as an approximation', async () => {
    const withIt = await build(pricing([PRO_MRR_IDENTITY]));
    const without = await build(pricing([]));
    expect(blocking(withIt.graph)).toEqual(blocking(without.graph));
  });
});

/** B1: the provisional sentence, exactly. It never says a comparison's direction holds. */
const PROVISIONAL_ADD_ON =
  'Olumi reads "Pro MRR" as "Revenue per Pro user" and "Pro subscribers" multiplied together, and Olumi\'s analysis ' +
  'adds effects up rather than multiplying them, so its figures for "Pro MRR" are an approximation. Each option that ' +
  'changes them moves them only one way, so whether that option raises or lowers "Pro MRR" should hold; treat the size ' +
  'of every effect, and any gap between the options, as provisional.';

describe('rule 2: a declared product every option moves the same way, through one lever, is provisional, not withheld', () => {
  it('RED: two options through the SAME lever, which moves BOTH inputs up, are sign_stable_provisional', async () => {
    const { out } = await build(oneLever());
    expect(out.nonlinear_identities).toEqual([{
      outcome_id: 'pro_mrr',
      operation: 'product',
      factor_ids: ['revenue_per_pro_user', 'pro_subscribers'],
      verdict: 'sign_stable_provisional',
      options_not_sign_stable: [],
      comparisons_not_sign_stable: [],
    }]);
    const lines = said(out).filter((s) => s.includes('"Pro MRR"') && s.includes('multipl'));
    expect(lines).toEqual([PROVISIONAL_ADD_ON]);
  });

  it('RED (B1): the provisional sentence never claims the direction of a result or a comparison holds', () => {
    const [entry] = identityLoss(admit(oneLever()));
    expect(entry?.reason).toBe(PROVISIONAL_ADD_ON);
    expect(entry?.reason).not.toMatch(/direction of the result holds|which option does better|leader/);
  });

  it('RED: the ledger entry is information, not a warning', () => {
    const [entry] = identityLoss(admit(oneLever()));
    expect(entry?.severity).toBe('info');
    expect(entry?.after).toEqual({ verdict: 'sign_stable_provisional', options_not_sign_stable: [], comparisons_not_sign_stable: [] });
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

  it('the declaration adds ONLY its carrier on the product\'s node (C46 (a)) — the verdict is not graph content', async () => {
    const withIt = await build(pricing([PRO_MRR_IDENTITY]));
    const without = await build(pricing([]));
    const nodes = (withIt.raw as { nodes: Record<string, unknown>[] }).nodes;
    // By identity: the one carrier sits on the declared product's node, and says which nodes multiply.
    expect(nodes.filter((n) => 'nonlinear_identity' in n).map((n) => n.id)).toEqual(['pro_mrr']);
    expect(nodes.find((n) => n.id === 'pro_mrr')!.nonlinear_identity)
      .toEqual({ operation: 'product', factor_ids: ['pro_plan_price', 'pro_subscribers'], stated_in_brief: false });
    // And nothing else moved: without that one key the graph is byte-identical to the undeclared build.
    const stripped = structuredClone(withIt.raw) as { nodes: Record<string, unknown>[] };
    for (const n of stripped.nodes) delete n.nonlinear_identity;
    expect(JSON.stringify(stripped)).toBe(JSON.stringify(without.raw));
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

const marks = (wire: Record<string, unknown>) => admit(wire).nonlinear_identities ?? [];
const markLine = (wire: Record<string, unknown>) => identityLoss(admit(wire)).map((l) => l.reason as string);

describe('rule 5 (B1): two options that move the inputs differently cannot be ranked — the comparison arm', () => {
  it('RED (flipped): the add-on (both inputs) against the referral scheme (one input) is sign_not_provable, naming the pair', () => {
    expect(marks(sameSign())).toEqual([{
      outcome_id: 'pro_mrr',
      operation: 'product',
      factor_ids: ['revenue_per_pro_user', 'pro_subscribers'],
      verdict: 'sign_not_provable',
      options_not_sign_stable: ['launch_ai_add_on', 'referral_scheme'],
      comparisons_not_sign_stable: [['launch_ai_add_on', 'referral_scheme']],
    }]);
    const [entry] = identityLoss(admit(sameSign()));
    expect(entry?.severity).toBe('warn');
    const line = entry?.reason as string;
    expect(line).toContain('"Launch AI add-on" and "Referral scheme" do not move "Revenue per Pro user" and "Pro subscribers" the same way');
    expect(line).toContain('which option does better on "MRR"');
    // Each option alone moves its inputs one way: no "opposite directions" claim about either.
    expect(line).not.toContain('opposite directions');
    expect(line).not.toMatch(/sign_not_provable|launch_ai_add_on/);
  });

  it('RED P1: two options each moving a DIFFERENT input — one per option, each stable alone — is sign_not_provable', () => {
    const wire = small({
      options: [CARRY_ON, { label: 'Paid add-on', changes: ['Add-on price'] }, { label: 'Referral scheme', changes: ['Referral volume'] }],
      factors: [
        { label: 'Add-on price', role: 'controllable' }, { label: 'Referral volume', role: 'controllable' },
        { label: 'Revenue per Pro user', baseline: 49 }, { label: 'Pro subscribers', baseline: 300 },
      ],
      links: [['Add-on price', 'Revenue per Pro user', 'positive'], ['Referral volume', 'Pro subscribers', 'positive'], ...REVENUE_CHAIN],
      identities: [REV_X_SUBS],
    });
    expect(marks(wire)).toEqual([{
      outcome_id: 'pro_mrr', operation: 'product', factor_ids: ['revenue_per_pro_user', 'pro_subscribers'],
      verdict: 'sign_not_provable',
      options_not_sign_stable: ['paid_add_on', 'referral_scheme'],
      comparisons_not_sign_stable: [['paid_add_on', 'referral_scheme']],
    }]);
  });

  it('RED P1b: two options each moving BOTH inputs up, but through DIFFERENT levers, is sign_not_provable', () => {
    const wire = small({
      options: [CARRY_ON, { label: 'Premium bundle', changes: ['Bundle uptake'] }, { label: 'Loyalty perks', changes: ['Perk budget'] }],
      factors: [
        { label: 'Bundle uptake', role: 'controllable' }, { label: 'Perk budget', role: 'controllable' },
        { label: 'Revenue per Pro user', baseline: 49 }, { label: 'Pro subscribers', baseline: 300 },
      ],
      links: [
        ['Bundle uptake', 'Revenue per Pro user', 'positive'], ['Bundle uptake', 'Pro subscribers', 'positive'],
        ['Perk budget', 'Revenue per Pro user', 'positive'], ['Perk budget', 'Pro subscribers', 'positive'],
        ...REVENUE_CHAIN,
      ],
      identities: [REV_X_SUBS],
    });
    const [m] = marks(wire);
    expect(m?.verdict).toBe('sign_not_provable');
    expect(m?.comparisons_not_sign_stable).toEqual([['premium_bundle', 'loyalty_perks']]);
  });

  it('RED P1c: an option that reaches the goal WITHOUT the product, against one that moves an input, is sign_not_provable', () => {
    const wire = small({
      options: [CARRY_ON, { label: 'Referral scheme', changes: ['Referral volume'] }, { label: 'Grow Basic plan', changes: ['Basic plan marketing'] }],
      factors: [
        { label: 'Referral volume', role: 'controllable' }, { label: 'Basic plan marketing', role: 'controllable' },
        { label: 'Revenue per Pro user', baseline: 49 }, { label: 'Pro subscribers', baseline: 300 }, { label: 'Non-Pro MRR', baseline: 5000, max: 50000 },
      ],
      links: [
        ['Referral volume', 'Pro subscribers', 'positive'], ['Basic plan marketing', 'Non-Pro MRR', 'positive'], ['Non-Pro MRR', 'MRR', 'positive'],
        ...REVENUE_CHAIN,
      ],
      identities: [REV_X_SUBS],
    });
    const [m] = marks(wire);
    expect(m?.verdict).toBe('sign_not_provable');
    expect(m?.options_not_sign_stable).toEqual(['referral_scheme', 'grow_basic_plan']);
    expect(m?.comparisons_not_sign_stable).toEqual([['referral_scheme', 'grow_basic_plan']]);
  });

  it('CONTROL: two options moving the SAME one input the same way (different levers) keep one ranking — provisional', () => {
    const wire = small({
      options: [CARRY_ON, { label: 'Referral scheme', changes: ['Referral volume'] }, { label: 'Paid ads', changes: ['Ad spend'] }],
      factors: [
        { label: 'Referral volume', role: 'controllable' }, { label: 'Ad spend', role: 'controllable' },
        { label: 'Revenue per Pro user', baseline: 49 }, { label: 'Pro subscribers', baseline: 300 },
      ],
      links: [['Referral volume', 'Pro subscribers', 'positive'], ['Ad spend', 'Pro subscribers', 'positive'], ...REVENUE_CHAIN],
      identities: [REV_X_SUBS],
    });
    expect(marks(wire).map((m) => [m.verdict, m.options_not_sign_stable, m.comparisons_not_sign_stable])).toEqual([['sign_stable_provisional', [], []]]);
  });

  /**
   * ⛔ B1, re-verification of d2362e9d: an option that moves an input AND reaches the goal AROUND the
   * product had the same signature as one that moves only that input. The referral scheme gains
   * R·ΔS_r + ΔN (subscribers, and Basic sign-ups straight into MRR); paid ads gain R·ΔS_a. Which is
   * larger depends on the level R sits at, and a sum of separate effects fixes it at one value.
   */
  const aroundWire = (extra: [string, string, Dir][], factors: SmallFactor[] = [], outcomes?: string[], chain = REVENUE_CHAIN, identity = REV_X_SUBS) => small({
    options: [CARRY_ON, { label: 'Referral scheme', changes: ['Referral volume'] }, { label: 'Paid ads', changes: ['Ad spend'] }],
    factors: [
      { label: 'Referral volume', role: 'controllable' }, { label: 'Ad spend', role: 'controllable' },
      { label: 'Revenue per Pro user', baseline: 49 }, { label: 'Pro subscribers', baseline: 300 }, ...factors,
    ],
    links: [['Referral volume', 'Pro subscribers', 'positive'], ['Ad spend', 'Pro subscribers', 'positive'], ...extra, ...chain],
    identities: [identity],
    ...(outcomes === undefined ? {} : { outcomes }),
  });

  it('RED B1 (around): moving an input AND reaching the goal around the product is not ranked with moving that input alone', () => {
    const wire = aroundWire([['Referral volume', 'Non-Pro MRR', 'positive'], ['Non-Pro MRR', 'MRR', 'positive']], [{ label: 'Non-Pro MRR', baseline: 5000, max: 50000 }]);
    expect(marks(wire)).toEqual([{
      outcome_id: 'pro_mrr', operation: 'product', factor_ids: ['revenue_per_pro_user', 'pro_subscribers'],
      verdict: 'sign_not_provable',
      options_not_sign_stable: ['referral_scheme', 'paid_ads'],
      comparisons_not_sign_stable: [['referral_scheme', 'paid_ads']],
    }]);
    const [line] = markLine(wire);
    expect(line).toContain(
      '"Referral scheme" changes "MRR" other than through "Revenue per Pro user" and "Pro subscribers" multiplied together, ' +
      'so how it compares with the other options depends on the levels those quantities are at');
    // Both move the one input the same way: no "do not move the same way" claim.
    expect(line).not.toContain('the same way');
  });

  it('RED B1 (around, addend): reaching a separate addend of the outcome is around the product too', () => {
    // Pro MRR = revenue x subscribers + referral bonuses: the bonuses are not part of the product.
    const wire = aroundWire([['Referral volume', 'Referral bonuses', 'positive'], ['Referral bonuses', 'Pro MRR', 'positive']], [{ label: 'Referral bonuses', baseline: 500, max: 50000 }]);
    const [m] = marks(wire);
    expect(m?.verdict).toBe('sign_not_provable');
    expect(m?.comparisons_not_sign_stable).toEqual([['referral_scheme', 'paid_ads']]);
    expect(markLine(wire)[0]?.startsWith('Olumi reads part of "Pro MRR" as')).toBe(true);
  });

  it('RED B1 (around, product on the goal): with MRR itself the product, reaching its other addend is around it', () => {
    const onGoal: [string, string, Dir][] = [['Revenue per Pro user', 'MRR', 'positive'], ['Pro subscribers', 'MRR', 'positive']];
    const wire = aroundWire(
      [['Referral volume', 'Non-Pro MRR', 'positive'], ['Non-Pro MRR', 'MRR', 'positive']], [{ label: 'Non-Pro MRR', baseline: 5000, max: 50000 }],
      [], onGoal, { ...REV_X_SUBS, outcome: 'MRR' },
    );
    const [m] = marks(wire);
    expect(m?.outcome_id).toBe('mrr');
    expect(m?.verdict).toBe('sign_not_provable');
    expect(m?.comparisons_not_sign_stable).toEqual([['referral_scheme', 'paid_ads']]);
    expect(markLine(wire)[0]).toContain('"Referral scheme" changes "MRR" other than through "Revenue per Pro user" and "Pro subscribers" multiplied together');
  });

  it('CONTROL B1: the same two options with no way around the product keep one ranking — provisional', () => {
    expect(marks(aroundWire([])).map((m) => [m.verdict, m.comparisons_not_sign_stable])).toEqual([['sign_stable_provisional', []]]);
  });

  it('RED (d): with three options, two moving the inputs the same way are never said to differ — grouped by how they move them', () => {
    const wire = small({
      options: [CARRY_ON, { label: 'Paid add-on', changes: ['Add-on price'] }, { label: 'Referral scheme', changes: ['Referral volume'] }, { label: 'Paid ads', changes: ['Ad spend'] }],
      factors: [
        { label: 'Add-on price', role: 'controllable' }, { label: 'Referral volume', role: 'controllable' }, { label: 'Ad spend', role: 'controllable' },
        { label: 'Revenue per Pro user', baseline: 49 }, { label: 'Pro subscribers', baseline: 300 },
      ],
      links: [
        ['Add-on price', 'Revenue per Pro user', 'positive'], ['Referral volume', 'Pro subscribers', 'positive'], ['Ad spend', 'Pro subscribers', 'positive'],
        ...REVENUE_CHAIN,
      ],
      identities: [REV_X_SUBS],
    });
    const [m] = marks(wire);
    expect(m?.comparisons_not_sign_stable).toEqual([['paid_add_on', 'referral_scheme'], ['paid_add_on', 'paid_ads']]);
    const [line] = markLine(wire);
    expect(line).toContain(
      '"Paid add-on" moves "Revenue per Pro user" and "Pro subscribers" one way; "Referral scheme" and "Paid ads" move them ' +
      'another, so which of those ways does better depends on the levels those quantities are at');
    expect(line).not.toContain('"Paid add-on", "Referral scheme" and "Paid ads" do not move');
  });

  it('RED (d): three options that each move the inputs differently are said to — never as one pair', () => {
    const wire = small({
      options: [CARRY_ON, { label: 'Paid add-on', changes: ['Add-on price'] }, { label: 'Referral scheme', changes: ['Referral volume'] }, { label: 'Premium bundle', changes: ['Bundle uptake'] }],
      factors: [
        { label: 'Add-on price', role: 'controllable' }, { label: 'Referral volume', role: 'controllable' }, { label: 'Bundle uptake', role: 'controllable' },
        { label: 'Revenue per Pro user', baseline: 49 }, { label: 'Pro subscribers', baseline: 300 },
      ],
      links: [
        ['Add-on price', 'Revenue per Pro user', 'positive'], ['Referral volume', 'Pro subscribers', 'positive'],
        ['Bundle uptake', 'Revenue per Pro user', 'positive'], ['Bundle uptake', 'Pro subscribers', 'positive'],
        ...REVENUE_CHAIN,
      ],
      identities: [REV_X_SUBS],
    });
    expect(marks(wire)[0]?.comparisons_not_sign_stable).toEqual([
      ['paid_add_on', 'referral_scheme'], ['paid_add_on', 'premium_bundle'], ['referral_scheme', 'premium_bundle'],
    ]);
    expect(markLine(wire)[0]).toContain('"Paid add-on", "Referral scheme" and "Premium bundle" each move "Revenue per Pro user" and "Pro subscribers" a different way');
  });
});

/**
 * ⛔ RULE 7 — A ROUTE AROUND THE PRODUCT THAT OPPOSES THE ROUTE THROUGH IT (verification of 1047641f, findings 3
 * and 4 — one class).
 *  · (3) THE ANCESTOR ARM. A direct cause of the outcome that ALSO feeds a factor ("Annual discount" -> Pro
 *    subscribers, and -> MRR directly) was not counted as an addend, so a lever on it was not around the product;
 *    with MRR itself the product no path can avoid it. The discount was marked sign-stable, said to move MRR "only
 *    one way … should hold" — false: it has a + route and a − route — and the Run named it leader.
 *  · (4) AGAINST CARRYING ON AS NOW. An option whose effect on the goal runs through the product one way and around
 *    it the other (a price rise: + through Pro MRR, − through refunds) cannot be signed even against an option that
 *    moves nothing: R·ΔS against −ΔN depends on the level R sits at, which a sum of effects fixes at one value.
 *    Routes that agree in direction keep the sign (the controls): the wider reading — any route around the product
 *    withholds against the status quo — is AI Quality's to rule (D4), and is not taken here.
 */
describe('rule 7: a route around the product that opposes the route through it cannot be signed — even against carrying on as now', () => {
  const MRR_PRODUCT: Identity = { outcome: 'MRR', operation: 'product', factors: ['Pro plan price', 'Pro subscribers'], provenance: 'inferred' };
  /** The verifier's P3: the discount raises Pro subscribers, and reaches MRR directly (`direct`). */
  const discountWire = (direct: Dir, withReferral: boolean) => small({
    options: [CARRY_ON, { label: 'Offer annual discount', changes: ['Annual discount'] },
      ...(withReferral ? [{ label: 'Referral scheme', changes: ['Referral volume'] }] : [])],
    factors: [
      { label: 'Annual discount', role: 'controllable' },
      ...(withReferral ? [{ label: 'Referral volume', role: 'controllable' } as SmallFactor] : []),
      { label: 'Pro plan price', baseline: 49 }, { label: 'Pro subscribers', baseline: 300 },
    ],
    links: [
      ['Annual discount', 'Pro subscribers', 'positive'], ['Annual discount', 'MRR', direct],
      ...(withReferral ? [['Referral volume', 'Pro subscribers', 'positive'] as [string, string, Dir]] : []),
      ['Pro plan price', 'MRR', 'positive'], ['Pro subscribers', 'MRR', 'positive'],
    ],
    identities: [MRR_PRODUCT],
    outcomes: [],
  });
  /** The verifier's P4 shape: a price rise lifts Pro MRR, and lifts refunds, which reach MRR `refunds`-ly. */
  const refundsWire = (refunds: Dir) => small({
    options: [CARRY_ON, { label: 'Raise Pro price', changes: ['Revenue per Pro user'] }],
    factors: [{ label: 'Revenue per Pro user', role: 'controllable', baseline: 49 }, { label: 'Pro subscribers', baseline: 300 }, { label: 'Refunds', baseline: 200 }],
    links: [['Revenue per Pro user', 'Refunds', 'positive'], ['Refunds', 'MRR', refunds], ...REVENUE_CHAIN],
    identities: [REV_X_SUBS],
  });
  const DISCOUNT_BOTH_WAYS =
    '"Offer annual discount" can push "MRR" one way through "Pro plan price" and "Pro subscribers" multiplied together and the ' +
    'other way by another route, so whether it raises or lowers "MRR" depends on the levels those quantities are at — and ' +
    'adding the effects up can get even that direction wrong.';
  const RAISE_BOTH_WAYS =
    '"Raise Pro price" can push "MRR" one way through "Revenue per Pro user" and "Pro subscribers" multiplied together and the ' +
    'other way by another route, so whether it raises or lowers "MRR" depends on the levels those quantities are at — and ' +
    'adding the effects up can get even that direction wrong.';
  const summary = (wire: Record<string, unknown>) => marks(wire).map((m) => [m.verdict, m.options_not_sign_stable, m.comparisons_not_sign_stable]);

  it('RED (3): a direct cause of MRR that also feeds a factor is an addend — the discount goes around the product, and is paired', () => {
    const wire = discountWire('negative', true);
    expect(marks(wire)).toEqual([{
      outcome_id: 'mrr', operation: 'product', factor_ids: ['pro_plan_price', 'pro_subscribers'],
      verdict: 'sign_not_provable',
      options_not_sign_stable: ['offer_annual_discount', 'referral_scheme'],
      comparisons_not_sign_stable: [['offer_annual_discount', 'referral_scheme']],
    }]);
    const [line] = markLine(wire);
    expect(line?.startsWith('Olumi reads part of "MRR" as "Pro plan price" and "Pro subscribers" multiplied together, but')).toBe(true);
    expect(line).toContain(DISCOUNT_BOTH_WAYS);
    expect(line).not.toContain('should hold');
    // Said once, in its own words — not again as merely "other than through".
    expect(line).not.toContain('"Offer annual discount" changes "MRR" other than through');
  });

  it('RED (3)+(4): against carrying on as now ALONE, the discount\'s + and − routes leave its sign unproven', () => {
    const wire = discountWire('negative', false);
    expect(marks(wire)).toEqual([{
      outcome_id: 'mrr', operation: 'product', factor_ids: ['pro_plan_price', 'pro_subscribers'],
      verdict: 'sign_not_provable', options_not_sign_stable: ['offer_annual_discount'], comparisons_not_sign_stable: [],
    }]);
    const [line] = markLine(wire);
    expect(line).toContain(DISCOUNT_BOTH_WAYS);
    expect(line).not.toContain('should hold');
  });

  it('RED (3) + CONTROL: reaching MRR directly the SAME way, the discount is PART of MRR (an addend) and keeps its sign against carrying on as now', () => {
    const wire = discountWire('positive', false);
    expect(summary(wire)).toEqual([['sign_stable_provisional', [], []]]);
    const [line] = markLine(wire);
    expect(line?.startsWith('Olumi reads part of "MRR" as "Pro plan price" and "Pro subscribers" multiplied together, and')).toBe(true);
    expect(line).toContain('whether that option raises or lowers "MRR" should hold');
  });

  it('RED (4): a price rise lifting Pro MRR and, through refunds, lowering MRR cannot be signed against carrying on as now', () => {
    const wire = refundsWire('negative');
    expect(marks(wire)).toEqual([{
      outcome_id: 'pro_mrr', operation: 'product', factor_ids: ['revenue_per_pro_user', 'pro_subscribers'],
      verdict: 'sign_not_provable', options_not_sign_stable: ['raise_pro_price'], comparisons_not_sign_stable: [],
    }]);
    const [line] = markLine(wire);
    expect(line).toContain(RAISE_BOTH_WAYS);
    expect(line).not.toContain('should hold');
  });

  it('RED (4): the outcome\'s OWN direction onto the goal is carried — a product that LOWERS MRR, against a route that raises it', () => {
    // Discount cost = discount rate × Pro subscribers, and it comes OFF MRR; the discount also adds subscribers,
    // who reach MRR directly. Through the product the discount lowers MRR, around it raises MRR.
    const wire = small({
      options: [CARRY_ON, { label: 'Offer discount', changes: ['Discount rate'] }],
      factors: [{ label: 'Discount rate', role: 'controllable', baseline: 5 }, { label: 'Pro subscribers', baseline: 300 }],
      outcomes: ['Discount cost'],
      links: [
        ['Discount rate', 'Discount cost', 'positive'], ['Discount rate', 'Pro subscribers', 'positive'],
        ['Pro subscribers', 'Discount cost', 'positive'], ['Pro subscribers', 'MRR', 'positive'], ['Discount cost', 'MRR', 'negative'],
      ],
      identities: [{ outcome: 'Discount cost', operation: 'product', factors: ['Discount rate', 'Pro subscribers'], provenance: 'inferred' }],
    });
    expect(marks(wire)).toEqual([{
      outcome_id: 'discount_cost', operation: 'product', factor_ids: ['discount_rate', 'pro_subscribers'],
      verdict: 'sign_not_provable', options_not_sign_stable: ['offer_discount'], comparisons_not_sign_stable: [],
    }]);
    expect(markLine(wire)[0]).toContain(
      '"Offer discount" can push "MRR" one way through "Discount rate" and "Pro subscribers" multiplied together and the other way by another route');
  });

  it('CONTROL (4): the same two routes agreeing in direction keep the sign — provisional, as before', () => {
    expect(summary(refundsWire('positive'))).toEqual([['sign_stable_provisional', [], []]]);
    expect(markLine(refundsWire('positive'))[0]).not.toContain('by another route');
  });
});

/**
 * B3.1 — the SERVED two-lever option. READ-ONLY capture
 * output/rc-delivery-lead-20260925/scratchpad/acceptance-f-runs/f-20260925T231546Z/01-F1-brief.json
 * (sha256 573ada07a2a2853bb021db5f33236f60f815d7c7193bb89d1b860c056814b0d4), `draft_graph`: "Raise to £59"
 * sets the Pro price AND AI feature availability; price -> price sensitivity -> churn -| Pro subscribers,
 * AI -> conversions -> Pro subscribers, both -> Pro MRR -> MRR <- Non-Pro MRR. The candidate is reconstructed
 * label for label, and its admitted edges are bound to the captured edge set below (the AI <-> release-delay
 * cycle included, as served). The identity is the one the ruling names: Pro MRR = price x Pro subscribers.
 */
// ⚠ Since staging #1956 (6dd42ebf, "a first model is never a loop"), admission withholds Olumi's closing link of
// the served AI <-> release-delay cycle (`ai_feature_availability>ai_release_delay:-`) and says so; the rest of
// the captured structure is unchanged, and so is every C46 rule this fixture pins.
const CAPTURED_EDGES = [
  'ai_feature_availability>new_pro_conversions', 'ai_feature_availability>pro_mrr',
  'ai_release_delay>ai_feature_availability:-', 'decision_mrr>keep_49_price', 'decision_mrr>phased_54_price', 'decision_mrr>raise_to_59',
  'keep_49_price>ai_feature_availability:repair', 'keep_49_price>pro_plan_price:repair', 'monthly_churn>pro_subscribers:-',
  'new_pro_conversions>pro_subscribers', 'non_pro_mrr>mrr', 'phased_54_price>ai_feature_availability', 'phased_54_price>pro_plan_price',
  'price_sensitivity>monthly_churn', 'pro_mrr>mrr', 'pro_plan_price>price_sensitivity', 'pro_plan_price>pro_mrr', 'pro_subscribers>pro_mrr',
  'raise_to_59>ai_feature_availability', 'raise_to_59>pro_plan_price',
];

function served({ without }: { without?: [string, string] } = {}): Record<string, unknown> {
  const link = (from: string, to: string, direction: Dir): Link => ({ from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
  const iv = (factor_label: string, value: number, unit: string, provenance: string) => ({ factor_label, value, value_kind: 'absolute', unit, provenance });
  const factor = (label: string, role: string, known: boolean, baseline_value: number, unit: string, provenance: string, plausible_max: number) =>
    ({ label, role, baseline_known: known, baseline_value, unit, provenance, plausible_max });
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP/month', horizon_months: 12, provenance: 'explicit',
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
    },
    constraints: [{ metric: 'Monthly churn', operator: '<=', value: 10, unit: '%', provenance: 'explicit', frame: 'level' }],
    options: [
      { label: 'Keep £49 Price', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Raise to £59', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [iv('Pro plan price', 59, 'GBP/month', 'explicit'), iv('AI feature availability', 1, 'release index', 'ai_proposed')] },
      { label: 'Phased £54 Price', provenance: 'ai_proposed', is_status_quo: null, changes: [],
        interventions: [iv('Pro plan price', 54, 'GBP/month', 'ai_proposed'), iv('AI feature availability', 1, 'release index', 'ai_proposed')] },
    ],
    factors: [
      factor('Pro plan price', 'controllable', true, 49, 'GBP/month', 'explicit', 200),
      factor('AI feature availability', 'controllable', false, 0, 'release index', 'ai_proposed', 2),
      factor('Pro subscribers', 'observable', false, 250, 'subscribers', 'ai_proposed', 2000),
      factor('New Pro conversions', 'observable', false, 25, 'subscribers/month', 'ai_proposed', 500),
      factor('Monthly churn', 'observable', false, 7, '%', 'ai_proposed', 100),
      factor('Non-Pro MRR', 'observable', false, 5000, 'GBP/month', 'ai_proposed', 50000),
    ],
    risks: [{ label: 'Price sensitivity', provenance: 'inferred' }, { label: 'AI release delay', provenance: 'inferred' }],
    outcomes: [{ label: 'Pro MRR', provenance: 'inferred' }],
    links: [
      link('Pro plan price', 'Pro MRR', 'positive'),
      link('Pro plan price', 'Price sensitivity', 'positive'),
      link('AI feature availability', 'New Pro conversions', 'positive'),
      link('AI feature availability', 'AI release delay', 'negative'),
      link('AI feature availability', 'Pro MRR', 'positive'),
      link('Pro subscribers', 'Pro MRR', 'positive'),
      link('New Pro conversions', 'Pro subscribers', 'positive'),
      link('Monthly churn', 'Pro subscribers', 'negative'),
      link('Price sensitivity', 'Monthly churn', 'positive'),
      link('AI release delay', 'AI feature availability', 'negative'),
      link('Pro MRR', 'MRR', 'positive'),
      link('Non-Pro MRR', 'MRR', 'positive'),
    ].filter((l) => without === undefined || l.from !== without[0] || l.to !== without[1]),
    identities: [PRO_MRR_IDENTITY],
    unknowns: [],
  };
}

const edgeKeys = (m: ReturnType<typeof admitCandidateModel>) => m.edges
  .map((e) => `${e.from}>${e.to}${e.effect_direction === 'negative' ? ':-' : ''}${(e as { origin?: string }).origin === 'repair' ? ':repair' : ''}`)
  .sort();

describe('rule 6 (B3): the rules the verification found unpinned', () => {
  it('the reconstructed served candidate admits to exactly the captured structure', () => {
    expect(edgeKeys(admit(served()))).toEqual(CAPTURED_EDGES);
  });

  it('RED B3.1: the served two-lever option (price + AI availability) is sign_not_provable, naming both priced options', () => {
    // ⚠ RE-PINNED, NOT LOOSENED (verification of 1047641f, finding 3 — the ancestor arm). AI feature availability
    // drives a factor (-> New Pro conversions -> Pro subscribers) AND links into Pro MRR directly: that direct link
    // is a term the analysis ADDS to price × subscribers, so it is an addend, both priced options reach the goal
    // around the product, and their comparison is now named too (it was already unprovable: each is `opposite`).
    expect(marks(served())).toEqual([{
      outcome_id: 'pro_mrr', operation: 'product', factor_ids: ['pro_plan_price', 'pro_subscribers'],
      verdict: 'sign_not_provable',
      options_not_sign_stable: ['raise_to_59', 'phased_54_price'],
      comparisons_not_sign_stable: [['raise_to_59', 'phased_54_price']],
    }]);
    expect(markLine(served())[0]?.startsWith('Olumi reads part of "Pro MRR" as "Pro plan price" and "Pro subscribers" multiplied together')).toBe(true);
  });

  it('RED B3.1b: the served shape with the price -> sensitivity link removed still has two separate levers — not provable', () => {
    // Each lever now moves ONE input one way (price +; AI -> conversions -> subscribers +), so only the
    // two-lever rule decides: the structure does not say the two levers move the same way.
    const wire = served({ without: ['Pro plan price', 'Price sensitivity'] });
    const [m] = marks(wire);
    expect(m?.verdict).toBe('sign_not_provable');
    expect(m?.options_not_sign_stable).toEqual(['raise_to_59', 'phased_54_price']);
    // (b) Its own sentence: every path moves the inputs UP, so "opposite directions" would be false.
    const [line] = markLine(wire);
    expect(line).toContain(
      '"Raise to £59" and "Phased £54 Price" move "Pro plan price" and "Pro subscribers" through separate levers whose ' +
      'relative size the model does not state');
    expect(line).not.toContain('opposite directions');
  });

  it('RED (b): a lever an option leaves at today\'s level is dropped per lever, not only when every lever is', () => {
    // "Raise to £59" now leaves AI availability at today's 0: its one real lever is the price.
    const wire = served({ without: ['Pro plan price', 'Price sensitivity'] }) as { options: { label: string; interventions: { factor_label: string; value: number }[] }[] };
    const raise = wire.options.find((o) => o.label === 'Raise to £59')!;
    raise.interventions = raise.interventions.map((i) => (i.factor_label === 'AI feature availability' ? { ...i, value: 0 } : i));
    const [m] = marks(wire as unknown as Record<string, unknown>);
    expect(m?.verdict).toBe('sign_not_provable');
    // Raise moves the price alone; Phased moves both through two levers — so they are a comparison.
    expect(m?.comparisons_not_sign_stable).toEqual([['raise_to_59', 'phased_54_price']]);
    const [line] = markLine(wire as unknown as Record<string, unknown>);
    expect(line).toContain('"Phased £54 Price" moves "Pro plan price" and "Pro subscribers" through separate levers');
    expect(line).not.toContain('"Raise to £59" and "Phased £54 Price" move "Pro plan price" and "Pro subscribers" through separate levers');
  });

  it('RED (b): "only one way" is said only when no option moves an input both ways', () => {
    // The referral scheme adds subscribers and, through support strain, loses some: one input, both ways.
    const wire = small({
      options: [CARRY_ON, { label: 'Referral scheme', changes: ['Referral volume'] }],
      factors: [{ label: 'Referral volume', role: 'controllable' }, { label: 'Revenue per Pro user', baseline: 49 }, { label: 'Pro subscribers', baseline: 300 }],
      risks: ['Support strain'],
      links: [
        ['Referral volume', 'Pro subscribers', 'positive'], ['Referral volume', 'Support strain', 'positive'], ['Support strain', 'Pro subscribers', 'negative'],
        ...REVENUE_CHAIN,
      ],
      identities: [REV_X_SUBS],
    });
    expect(marks(wire).map((m) => m.verdict)).toEqual(['sign_stable_provisional']);
    const [line] = markLine(wire);
    expect(line).not.toContain('only one way');
    expect(line).toBe(
      'Olumi reads "Pro MRR" as "Revenue per Pro user" and "Pro subscribers" multiplied together, and Olumi\'s analysis ' +
      'adds effects up rather than multiplying them, so its figures for "Pro MRR" are an approximation; treat the size of ' +
      'every effect, and any gap between the options, as provisional.');
  });

  it('RED B3.2: a product whose outcome does not reach the goal bears on no comparison — no mark, no rejection', () => {
    const wire = pricing([{ outcome: 'Support load', operation: 'product', factors: ['Pro subscribers', 'Tickets per subscriber'], provenance: 'inferred' }]) as {
      factors: unknown[]; outcomes: unknown[]; links: unknown[];
    };
    wire.factors.push({ label: 'Tickets per subscriber', role: 'observable', baseline_known: false, baseline_value: 2, unit: 'tickets', provenance: 'ai_proposed', plausible_max: 20 });
    wire.outcomes.push({ label: 'Support load', provenance: 'inferred' });
    wire.links.push(
      { from: 'Pro subscribers', to: 'Support load', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
      { from: 'Tickets per subscriber', to: 'Support load', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
    );
    const admitted = admit(wire as Record<string, unknown>);
    expect(admitted.nodes.find((n) => n.id === 'support_load')?.kind).toBe('outcome');
    expect(identityLoss(admitted)).toEqual([]);
    expect(rejectedLoss(admitted)).toEqual([]);
    expect(admitted).not.toHaveProperty('nonlinear_identities');
  });

  it('RED B3.3: labels that differ only by case and spacing resolve to the same nodes', () => {
    const spaced: Identity = { outcome: 'pro  mrr', operation: 'product', factors: ['PRO PLAN PRICE', ' Pro   subscribers '], provenance: 'inferred' };
    const admitted = admit(pricing([spaced]));
    expect(rejectedLoss(admitted)).toEqual([]);
    expect(admitted.nonlinear_identities?.map((m) => [m.outcome_id, m.factor_ids, m.verdict]))
      .toEqual([['pro_mrr', ['pro_plan_price', 'pro_subscribers'], 'sign_not_provable']]);
  });

  it('RED B3.4a: a declaration with ONE factor is rejected, never marked', () => {
    const admitted = admit(pricing([{ ...PRO_MRR_IDENTITY, factors: ['Pro subscribers'] }]));
    expect(identityLoss(admitted)).toEqual([]);
    const [r, ...more] = rejectedLoss(admitted);
    expect(more).toEqual([]);
    expect(r?.field_path).toBe('nodes[pro_mrr].nonlinear_identity_rejected');
    expect(r?.reason).toContain('a product needs at least two different quantities');
  });

  it('RED B3.4b: a declaration naming the same factor twice is rejected, never marked', () => {
    const admitted = admit(pricing([{ ...PRO_MRR_IDENTITY, factors: ['Pro subscribers', 'Pro subscribers'] }]));
    expect(identityLoss(admitted)).toEqual([]);
    expect(rejectedLoss(admitted).map((r) => r.reason)).toEqual([expect.stringContaining('a product needs at least two different quantities')]);
  });

  it('RED B3.5: a path that runs THROUGH the outcome is not counted as moving an input', () => {
    // Referral volume -> Pro subscribers -> Pro MRR -> Discount pressure -| Pro plan price: the only way the
    // referral scheme "moves" the price is through the product itself — a feedback, not a lever.
    const wire = small({
      options: [CARRY_ON, { label: 'Referral scheme', changes: ['Referral volume'] }],
      factors: [
        { label: 'Referral volume', role: 'controllable' },
        { label: 'Pro plan price', baseline: 49, known: true, max: 200 }, { label: 'Pro subscribers', baseline: 300 },
      ],
      risks: ['Discount pressure'],
      links: [
        ['Referral volume', 'Pro subscribers', 'positive'],
        ['Pro plan price', 'Pro MRR', 'positive'], ['Pro subscribers', 'Pro MRR', 'positive'], ['Pro MRR', 'MRR', 'positive'],
        ['Pro MRR', 'Discount pressure', 'positive'], ['Discount pressure', 'Pro plan price', 'negative'],
      ],
      identities: [PRO_MRR_IDENTITY],
    });
    expect(edgeKeys(admit(wire))).toContain('discount_pressure>pro_plan_price:-');
    expect(marks(wire).map((m) => [m.verdict, m.options_not_sign_stable])).toEqual([['sign_stable_provisional', []]]);
  });
});

describe('N-b: an option at today\'s level is not a lever', () => {
  const withOptions = (options: unknown[]) => ({ ...pricing([PRO_MRR_IDENTITY]), options });
  const RAISE = { label: 'Raise Pro to £59', provenance: 'explicit', is_status_quo: null, changes: [],
    interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] };
  const at = (label: string, value: number, sq: boolean) => ({ label, provenance: 'explicit', is_status_quo: sq ? true : null, changes: [],
    interventions: [{ factor_label: 'Pro plan price', value, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] });

  it('RED: the declared status quo that states today\'s price (£49) is never named', () => {
    const [m] = marks(withOptions([at('Keep Pro at £49', 49, true), RAISE]));
    expect(m?.options_not_sign_stable).toEqual(['raise_pro_to_59']);
  });

  it('RED: an unflagged option that sets today\'s price is never named either', () => {
    const [m] = marks(withOptions([{ label: 'Keep Pro at £49', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] }, at('Hold at £49', 49, false), RAISE]));
    expect(m?.options_not_sign_stable).toEqual(['raise_pro_to_59']);
  });

  it('RED: the declared status quo that names the price with NO level of its own is never named', () => {
    const [m] = marks(withOptions([{ label: 'Keep Pro at £49', provenance: 'explicit', is_status_quo: true, changes: ['Pro plan price'], interventions: [] }, RAISE]));
    expect(m?.options_not_sign_stable).toEqual(['raise_pro_to_59']);
  });

  it('CONTROL: a "status quo" whose level is NOT today\'s is still a lever, and is named', () => {
    const [m] = marks(withOptions([at('Keep Pro at £52', 52, true), RAISE]));
    expect(m?.options_not_sign_stable).toEqual(['keep_pro_at_52', 'raise_pro_to_59']);
  });
});

describe('N-c: whose reading it is, and whether it is the whole of the total', () => {
  const onTotal = (addend: boolean): Record<string, unknown> => {
    const wire = pricing([{ outcome: 'MRR', operation: 'product', factors: ['Pro plan price', 'Pro subscribers'], provenance: 'inferred' }]) as {
      factors: unknown[]; links: unknown[];
    };
    if (addend) {
      wire.factors.push({ label: 'Non-Pro MRR', role: 'observable', baseline_known: false, baseline_value: 5000, unit: 'GBP', provenance: 'ai_proposed', plausible_max: 50000 });
      wire.links.push({ from: 'Non-Pro MRR', to: 'MRR', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
    }
    return wire as Record<string, unknown>;
  };

  it('RED: a product declared on a TOTAL that has another addend is said to be only PART of it', () => {
    const [line] = markLine(onTotal(true));
    expect(line?.startsWith('Olumi reads part of "MRR" as "Pro plan price" and "Pro subscribers" multiplied together')).toBe(true);
  });

  it('RED (c): an addend DRIVEN by a factor (Pro subscribers -> Non-Pro MRR -> MRR) is still an addend — part of MRR', () => {
    const wire = onTotal(true) as { links: { from: string; to: string }[] };
    wire.links.push({ from: 'Pro subscribers', to: 'Non-Pro MRR', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null } as never);
    const admitted = admit(wire as unknown as Record<string, unknown>);
    expect(edgeKeys(admitted)).toContain('pro_subscribers>non_pro_mrr');
    const [line] = markLine(wire as unknown as Record<string, unknown>);
    expect(line?.startsWith('Olumi reads part of "MRR" as "Pro plan price" and "Pro subscribers" multiplied together')).toBe(true);
  });

  it('CONTROL: the chain through Pro MRR is not an addend — the whole of MRR', () => {
    const [line] = markLine(onTotal(false));
    expect(line?.startsWith('Olumi reads "MRR" as "Pro plan price" and "Pro subscribers" multiplied together')).toBe(true);
  });

  it('RED: a declaration the brief itself states is not attributed to Olumi', () => {
    const [line] = markLine(pricing([{ ...PRO_MRR_IDENTITY, provenance: 'explicit' }]));
    expect(line?.startsWith('"Pro MRR" is "Pro plan price" and "Pro subscribers" multiplied together, but')).toBe(true);
  });
});

/**
 * Was the HANDOFF pin ("GraphV3 has no declared carrier, so the mark cannot reach the leader claim"). C46 (a)
 * closes it: NodeV3 now DECLARES `nonlinear_identity`, so the checked declaration survives the strict parse
 * on the run path, and a malformed one is dropped rather than refusing the stored graph. The end-to-end leg
 * (register → parse → loader → `run_analysis`) is `c46-leader-withheld-on-a-product.test.ts`.
 */
describe('CARRIER pin (C46 (a)): the declaration reaches the persisted graph, the leader claim reads it', () => {
  it('GraphV3 keeps the carrier admission wrote on the product\'s node', async () => {
    const { raw } = await build(pricing([PRO_MRR_IDENTITY]));
    const reparsed = GraphV3.parse(structuredClone(raw)) as unknown as { nodes: Record<string, unknown>[] };
    expect(reparsed.nodes.find((n) => n.id === 'pro_mrr')!.nonlinear_identity)
      .toEqual({ operation: 'product', factor_ids: ['pro_plan_price', 'pro_subscribers'], stated_in_brief: false });
  });

  it('a malformed carrier (no `stated_in_brief`) is dropped, never a reason to refuse the stored graph', async () => {
    const { raw } = await build(pricing([PRO_MRR_IDENTITY]));
    const graph = structuredClone(raw) as { nodes: Record<string, unknown>[] };
    graph.nodes.find((n) => n.id === 'pro_mrr')!.nonlinear_identity = { operation: 'product', factor_ids: ['pro_plan_price', 'pro_subscribers'] };
    const reparsed = GraphV3.parse(graph) as unknown as { nodes: Record<string, unknown>[] };
    expect(reparsed.nodes.find((n) => n.id === 'pro_mrr')!.nonlinear_identity).toBeUndefined();
  });
});
