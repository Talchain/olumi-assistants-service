/**
 * ⛔ C5 — A RISK OLUMI DRAFTED AS A MEDIATOR IS FOLDED INTO THE DIRECT LINK, WITH ITS TOTAL EFFECT KEPT.
 *
 * SERVED (Paul, session a295e4a1, exports 17d1cd3a and 90b8f080, 27 Sep): construction drafted the risk
 * "Price sensitivity" BETWEEN two factors — Pro plan price → Price sensitivity (0.5 ± 0.125) → Monthly churn
 * (0.0075 ± 0.00375), both `cee_hypothesis` — and no direct Pro plan price → Monthly churn link. On the canvas
 * the risk band sits below the factors, so that link runs UP across the bands (Canvas REVIEW C5).
 *
 * RULING (AI Quality #70 5854837708, on MG 5854828033 item 5): at ADMISSION only, a risk with exactly ONE parent,
 * a factor child, every in/out link Olumi's and no user value is folded: for each child k,
 *   mean′ = mean(direct p→k) + μ₁·μ₂,   σ′ = √(σ_d² + μ₁²σ₂² + μ₂²σ₁² + σ₁²σ₂²),   direction = sign(mean′);
 * not folded at all if |mean′| + 2σ′ > 1 for any child. The link stays `cee_hypothesis`, carries the risk's words,
 * and the ledger says "folded risk 'Price sensitivity' into Pro plan price → Monthly churn".
 *
 * THE CANDIDATE is reconstructed from the served draft (its `_provenance` says how) and is CHECKED against the
 * wire here: every link admission keeps equals the served one, and the two links the fold consumed — which its
 * own ledger entry records — equal the served risk links exactly.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { admitCandidateModel, type AdmittedModel, type CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import type { CandidateLink } from '../admit-candidate.js';

interface ServedEdge {
  from: string; to: string; strength: { mean: number; std: number }; exists_probability: number;
  effect_direction: string; defaulted?: boolean; provenance?: { source: string; magnitude?: string };
}
const BANKED = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'served-paul-risk-mediator-90b8f080-candidate.json'), 'utf8')) as {
  candidate: CandidateModel; served_draft_edges: ServedEdge[];
};
const PAUL = BANKED.candidate;
const SERVED = BANKED.served_draft_edges;
const servedEdge = (from: string, to: string): ServedEdge => {
  const e = SERVED.find((x) => x.from === from && x.to === to);
  if (e === undefined) throw new Error(`served edge ${from} -> ${to} missing from the fixture`);
  return e;
};

const PRICE = 'pro_plan_price';
const RISK = 'price_sensitivity';
const CHURN = 'monthly_churn';
const FOLD_LINE = "folded risk 'Price sensitivity' into Pro plan price → Monthly churn";

const edge = (a: AdmittedModel, from: string, to: string) => a.edges.filter((e) => e.from === from && e.to === to);
const kindOf = (a: AdmittedModel) => new Map(a.nodes.map((n) => [n.id, n.kind] as const));
const foldEntries = (a: AdmittedModel) => a.loss.filter((l) => /\.risk_folded$/.test(String(l.field_path)));
const riskFeedsAFactor = (a: AdmittedModel) => {
  const k = kindOf(a);
  return a.edges.filter((e) => k.get(e.from) === 'risk' && k.get(e.to) === 'factor');
};
/** The ruling's σ′, independent terms (#70 5854837708 item 2). */
const sigmaPrime = (sd: number, m1: number, s1: number, m2: number, s2: number) =>
  Math.sqrt(sd ** 2 + m1 ** 2 * s2 ** 2 + m2 ** 2 * s1 ** 2 + s1 ** 2 * s2 ** 2);

const withLinks = (links: readonly CandidateLink[], extra: Partial<CandidateModel> = {}): CandidateModel => ({ ...PAUL, ...extra, links });
const relink = (from: string, to: string, patch: Partial<CandidateLink>): CandidateLink[] =>
  PAUL.links.map((l) => (l.from === from && l.to === to ? { ...l, ...patch } : l));

/** A risk left EXACTLY as drafted: the node, both links as the served draft sized them, no direct link, no fold entry. */
function expectUnfolded(a: AdmittedModel): void {
  expect(a.nodes.some((n) => n.id === RISK && n.kind === 'risk')).toBe(true);
  expect(foldEntries(a)).toEqual([]);
  expect(edge(a, PRICE, CHURN)).toEqual([]);
  expect(edge(a, RISK, CHURN)).toHaveLength(1);
  expect(edge(a, PRICE, RISK)).toHaveLength(1);
}

describe('C5: the served risk mediator is folded at admission, its total effect kept', () => {
  const a = admitCandidateModel(PAUL);
  const s1 = servedEdge(PRICE, RISK);
  const s2 = servedEdge(RISK, CHURN);

  it('the reconstruction is the wire: every served link is admitted exactly as served, or consumed by the fold', () => {
    const key = (e: { from: string; to: string }) => `${e.from}::${e.to}`;
    const consumed = new Set(((foldEntries(a)[0]?.before as { links?: { from: string; to: string }[] } | undefined)?.links ?? []).map(key));
    for (const s of SERVED) {
      if (consumed.has(key(s))) continue;
      const e = edge(a, s.from, s.to);
      expect(e, key(s)).toHaveLength(1);
      expect({ strength: e[0]!.strength, p: e[0]!.exists_probability, dir: e[0]!.effect_direction, magnitude: e[0]!.provenance?.magnitude, defaulted: e[0]!.defaulted },
        key(s)).toEqual({ strength: s.strength, p: s.exists_probability, dir: s.effect_direction, magnitude: s.provenance?.magnitude, defaulted: s.defaulted });
    }
    const servedKeys = new Set(SERVED.map(key));
    expect(a.edges.filter((e) => !servedKeys.has(key(e))).map(key)).toEqual(consumed.size > 0 ? [`${PRICE}::${CHURN}`] : []);
  });

  it('RED: no admitted risk feeds a factor, and the risk and its two links are gone', () => {
    expect(riskFeedsAFactor(a)).toEqual([]);
    expect(a.nodes.some((n) => n.id === RISK)).toBe(false);
    expect(a.edges.filter((e) => e.from === RISK || e.to === RISK)).toEqual([]);
  });

  it('RED: Pro plan price → Monthly churn carries mean′ = μ₁·μ₂ = 0.00375 (1e-9), positive', () => {
    const merged = edge(a, PRICE, CHURN);
    expect(merged).toHaveLength(1);
    expect(Math.abs(merged[0]!.strength.mean - 0.00375)).toBeLessThan(1e-9);
    expect(Math.abs(merged[0]!.strength.mean - s1.strength.mean * s2.strength.mean)).toBeLessThan(1e-9);
    expect(merged[0]!.effect_direction).toBe('positive');
  });

  it('RED (σ row): σ′ = √(μ₁²σ₂² + μ₂²σ₁² + σ₁²σ₂²) to 1e-9, which is the ruling\'s 0.00215', () => {
    const merged = edge(a, PRICE, CHURN)[0]!;
    const expected = sigmaPrime(0, s1.strength.mean, s1.strength.std, s2.strength.mean, s2.strength.std);
    expect(Math.abs(merged.strength.std - expected)).toBeLessThan(1e-9);
    expect(Math.abs(merged.strength.std - 0.00215)).toBeLessThan(5e-6);
  });

  it('RED: the link stays Olumi\'s hypothesis — cee_hypothesis, defaulted, placeholder — and carries the risk\'s words', () => {
    const merged = edge(a, PRICE, CHURN)[0]!;
    expect(merged.provenance?.source).toBe('cee_hypothesis');
    expect(merged.defaulted).toBe(true);
    expect(merged.provenance?.magnitude).toBe('olumi_placeholder');
    expect(merged.provenance?.reasoning).toContain('Price sensitivity');
    // exists_probability: MG's choice (p₁·p₂), AIQ to confirm.
    expect(Math.abs(merged.exists_probability - s1.exists_probability * s2.exists_probability)).toBeLessThan(1e-12);
  });

  it('RED: the ledger records the fold in words, and what it consumed is the served pair exactly', () => {
    const f = foldEntries(a);
    expect(f).toHaveLength(1);
    expect(f[0]!.field_path).toBe(`nodes[${RISK}].risk_folded`);
    expect(String(f[0]!.reason)).toContain(FOLD_LINE);
    const before = f[0]!.before as { links: { from: string; to: string; strength: { mean: number; std: number }; exists_probability: number }[] };
    expect(before.links.map((l) => ({ from: l.from, to: l.to, strength: l.strength, p: l.exists_probability })))
      .toEqual([s1, s2].map((s) => ({ from: s.from, to: s.to, strength: s.strength, p: s.exists_probability })));
  });

  it('RED: nothing admission emits still names the folded risk', () => {
    expect(Object.keys(a.inference_classes)).not.toContain(RISK);
    expect(a.goal_constraints.map((c) => c.node_id)).not.toContain(RISK);
    for (const n of a.nodes) expect(Object.keys(n.interventions ?? {})).not.toContain(RISK);
    expect(a.withheld.filter((w) => w.from === RISK || w.to === RISK || w.from === 'Price sensitivity' || w.to === 'Price sensitivity')).toEqual([]);
    const stale = a.loss.filter((l) => !/\.risk_folded$/.test(String(l.field_path))
      && (String(l.field_path).includes(RISK) || String(l.reason).includes('Price sensitivity')));
    expect(stale, JSON.stringify(stale.map((l) => l.field_path))).toEqual([]);
  });

  it('RED: the build result says the fold in not_represented and asks nothing about the folded risk', async () => {
    let registered: { nodes: { id: string; kind: string }[]; edges: { from: string; to: string }[] } | undefined;
    const d: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph/register')) registered = (body as { graph: typeof registered }).graph;
      return { status: 200, json: { registered: true } };
    };
    const fn = vi.fn(async () => ({ text: JSON.stringify(PAUL) })) as unknown as CallStructuredModel;
    const out = await buildModelFromBrief('55555555-5555-4555-8555-555555555555', 'Pro plan £49 → £59?', d, fn);
    expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
    const said = (out['not_represented'] as string[]) ?? [];
    expect(said.filter((s) => s.includes(FOLD_LINE)), JSON.stringify(said)).toHaveLength(1);
    const asked = (out['open_questions'] as string[]) ?? [];
    expect(asked.filter((q) => q.includes('Price sensitivity')), JSON.stringify(asked)).toEqual([]);
    expect(registered?.nodes.some((n) => n.id === RISK)).toBe(false);
    expect(registered?.edges.filter((e) => e.from === PRICE && e.to === CHURN)).toHaveLength(1);
  });
});

describe('C5 contrasts: a risk that is not Olumi\'s one-parent mediator is left exactly as drafted', () => {
  it('a risk with a USER-STATED link (brief_extraction) is unchanged', () => {
    expectUnfolded(admitCandidateModel(withLinks(relink('Pro plan price', 'Price sensitivity', { provenance: 'explicit' }))));
    expectUnfolded(admitCandidateModel(withLinks(relink('Price sensitivity', 'Monthly churn', { provenance: 'explicit' }))));
  });

  it('a risk whose link the user sized (effect_provenance explicit) is unchanged', () => {
    expectUnfolded(admitCandidateModel(withLinks(relink('Price sensitivity', 'Monthly churn', { effect_provenance: 'explicit' }))));
  });

  it('a risk the brief itself names is unchanged', () => {
    expectUnfolded(admitCandidateModel({ ...PAUL, risks: [{ label: 'Price sensitivity', provenance: 'explicit' }] }));
  });

  it('a TWO-PARENT risk is unchanged', () => {
    const a = admitCandidateModel(withLinks([
      ...PAUL.links,
      { from: 'Other MRR growth', to: 'Price sensitivity', direction: 'positive', provenance: 'inferred' },
    ]));
    expectUnfolded(a);
    expect(edge(a, 'other_mrr_growth', RISK)).toHaveLength(1);
  });

  it('an ORDINARY risk (no factor child, only the goal) is unchanged', () => {
    const links = PAUL.links.map((l) => (l.from === 'Price sensitivity' ? { ...l, to: 'MRR', direction: 'negative' as const, effect_amount: null, effect_per_source_change: null } : l));
    const a = admitCandidateModel(withLinks(links));
    expect(a.nodes.some((n) => n.id === RISK && n.kind === 'risk')).toBe(true);
    expect(foldEntries(a)).toEqual([]);
    expect(edge(a, RISK, 'mrr')).toHaveLength(1);
    expect(edge(a, PRICE, RISK)).toHaveLength(1);
  });

  it('the TRUNCATION case (|mean′| + 2σ′ > 1) is unchanged', () => {
    const big = { strength_mean: 0.9, strength_std: 0.3 };
    const links = relink('Pro plan price', 'Price sensitivity', big)
      .map((l) => (l.from === 'Price sensitivity' && l.to === 'Monthly churn' ? { ...l, ...big } : l));
    // 0.81 + 2·√(0.81·0.09·2 + 0.0081) = 1.59 > 1
    expect(0.81 + 2 * sigmaPrime(0, 0.9, 0.3, 0.9, 0.3)).toBeGreaterThan(1);
    const a = admitCandidateModel(withLinks(links));
    expectUnfolded(a);
    expect(edge(a, RISK, CHURN)[0]!.strength).toEqual({ mean: 0.9, std: 0.3 });
  });

  it('an EXISTING direct p→k link is merged: mean′ adds, σ′ includes σ_direct, one link only', () => {
    const a = admitCandidateModel(withLinks([
      ...PAUL.links,
      { from: 'Pro plan price', to: 'Monthly churn', direction: 'positive', provenance: 'inferred', strength_mean: 0.2, strength_std: 0.05 },
    ]));
    expect(a.nodes.some((n) => n.id === RISK)).toBe(false);
    const merged = edge(a, PRICE, CHURN);
    expect(merged).toHaveLength(1);
    const s1 = servedEdge(PRICE, RISK);
    const s2 = servedEdge(RISK, CHURN);
    expect(Math.abs(merged[0]!.strength.mean - (0.2 + s1.strength.mean * s2.strength.mean))).toBeLessThan(1e-9);
    expect(Math.abs(merged[0]!.strength.std - sigmaPrime(0.05, s1.strength.mean, s1.strength.std, s2.strength.mean, s2.strength.std))).toBeLessThan(1e-9);
    // exists_probability: MG's choice, 1 − (1 − p_d)(1 − p₁p₂), AIQ to confirm.
    expect(Math.abs(merged[0]!.exists_probability - (1 - (1 - 0.8) * (1 - s1.exists_probability * s2.exists_probability)))).toBeLessThan(1e-12);
    expect(merged[0]!.effect_direction).toBe('positive');
    expect(String(foldEntries(a)[0]?.reason)).toContain(FOLD_LINE);
  });
});
