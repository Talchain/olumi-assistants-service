/**
 * ⛔ A4a / C5 — A RISK OLUMI DRAFTED AS A MEDIATOR IS FOLDED INTO ONE NEW LINK, WITH ITS TOTAL EFFECT KEPT.
 *
 * SERVED (Paul, session a295e4a1, exports 17d1cd3a and 90b8f080, 27 Sep): construction drafted the risk
 * "Price sensitivity" BETWEEN two factors — Pro plan price → Price sensitivity (0.5 ± 0.125, p 0.8) → Monthly churn
 * (0.0075 ± 0.00375, p 0.8), both `cee_hypothesis` — and no direct Pro plan price → Monthly churn link. On the canvas
 * the risk band sits below the factors, so that link runs UP across the bands (Canvas REVIEW C5).
 *
 * RULINGS (AI Quality #70 5854837708 and 5854861848; DL build train 5855068711, row A4): at ADMISSION only, a risk
 * with exactly ONE parent, a factor child, every in/out link Olumi's, no user value, and NO direct parent → child link
 * is folded: for each child k,
 *   mean′ = μ₁·μ₂,   σ′ = √(μ₁²σ₂² + μ₂²σ₁² + σ₁²σ₂²),   exists′ = p₁·p₂,   direction = sign(mean′);
 * not folded at all if |mean′| + 2σ′ > 1 for any child, and never beside a direct p → k link (a mixture, not one
 * normal link). The link stays `cee_hypothesis`, carries the risk's words, and the ledger says
 * "folded risk 'Price sensitivity' into Pro plan price → Monthly churn".
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
/** The ruling's σ′, independent terms (#70 5854837708 item 2), for a NEW link (no direct term: 5854861848). */
const sigmaPrime = (m1: number, s1: number, m2: number, s2: number) =>
  Math.sqrt(m1 ** 2 * s2 ** 2 + m2 ** 2 * s1 ** 2 + s1 ** 2 * s2 ** 2);
/** The same σ′ written out by hand for the served numbers: √(0.25·0.00375² + 0.0075²·0.125² + 0.125²·0.00375²). */
const PAUL_SIGMA = Math.sqrt(3.515625e-6 + 8.7890625e-7 + 2.197265625e-7);

const withLinks = (links: readonly CandidateLink[], extra: Partial<CandidateModel> = {}): CandidateModel => ({ ...PAUL, ...extra, links });
const relink = (from: string, to: string, patch: Partial<CandidateLink>): CandidateLink[] =>
  PAUL.links.map((l) => (l.from === from && l.to === to ? { ...l, ...patch } : l));
const shape = (e: { strength: { mean: number; std: number }; exists_probability: number; effect_direction?: string }) =>
  ({ strength: e.strength, p: e.exists_probability, dir: e.effect_direction });

/**
 * A risk left EXACTLY as drafted: the node and its class, both links present, no fold entry, and (unless the contrast
 * itself re-authored a link) both links exactly as the served draft carried them.
 */
function expectUnfolded(a: AdmittedModel, opts: { servedLinks?: boolean; direct?: boolean } = {}): void {
  expect(a.nodes.some((n) => n.id === RISK && n.kind === 'risk')).toBe(true);
  expect(Object.keys(a.inference_classes)).toContain(RISK);
  expect(foldEntries(a)).toEqual([]);
  if (opts.direct !== true) expect(edge(a, PRICE, CHURN)).toEqual([]);
  expect(edge(a, RISK, CHURN)).toHaveLength(1);
  expect(edge(a, PRICE, RISK)).toHaveLength(1);
  if (opts.servedLinks !== false) {
    expect(shape(edge(a, PRICE, RISK)[0]!)).toEqual(shape(servedEdge(PRICE, RISK)));
    expect(shape(edge(a, RISK, CHURN)[0]!)).toEqual(shape(servedEdge(RISK, CHURN)));
  }
}

describe('A4a: the served risk mediator is folded at admission, its total effect kept', () => {
  const a = admitCandidateModel(PAUL);
  const s1 = servedEdge(PRICE, RISK);
  const s2 = servedEdge(RISK, CHURN);

  it('the fixture carries the served mediator: 0.5 ± 0.125 (p 0.8) and 0.0075 ± 0.00375 (p 0.8), no direct link', () => {
    expect(shape(s1)).toEqual({ strength: { mean: 0.5, std: 0.125 }, p: 0.8, dir: 'positive' });
    expect(shape(s2)).toEqual({ strength: { mean: 0.0075, std: 0.00375 }, p: 0.8, dir: 'positive' });
    expect(SERVED.filter((e) => e.from === PRICE && e.to === CHURN)).toEqual([]);
  });

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

  it('RED (σ row): σ′ = √(μ₁²σ₂² + μ₂²σ₁² + σ₁²σ₂²) = 0.0021480824 (1e-9), the ruling\'s 0.00215', () => {
    const merged = edge(a, PRICE, CHURN)[0]!;
    expect(Math.abs(merged.strength.std - sigmaPrime(s1.strength.mean, s1.strength.std, s2.strength.mean, s2.strength.std))).toBeLessThan(1e-9);
    expect(Math.abs(merged.strength.std - PAUL_SIGMA)).toBeLessThan(1e-9);
    expect(Math.abs(merged.strength.std - 0.00214808235701055)).toBeLessThan(1e-9);
    expect(Math.abs(merged.strength.std - 0.00215)).toBeLessThan(5e-6);
  });

  it('RED: exists′ = p₁·p₂ = 0.64 (AIQ 5854861848)', () => {
    const merged = edge(a, PRICE, CHURN)[0]!;
    expect(Math.abs(merged.exists_probability - 0.64)).toBeLessThan(1e-12);
    expect(Math.abs(merged.exists_probability - s1.exists_probability * s2.exists_probability)).toBeLessThan(1e-12);
  });

  it('RED: the link stays Olumi\'s hypothesis — cee_hypothesis, defaulted, placeholder — and carries the risk\'s words', () => {
    const merged = edge(a, PRICE, CHURN)[0]!;
    expect(merged.provenance?.source).toBe('cee_hypothesis');
    expect(merged.defaulted).toBe(true);
    expect(merged.provenance?.magnitude).toBe('olumi_placeholder');
    expect(merged.provenance?.reasoning).toContain('"Price sensitivity"');
    // A size in natural units belongs to one link's β; the folded link has a new β, so none is carried.
    expect(merged.provenance?.natural_effect).toBeUndefined();
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

  it('RED: nothing admission emits still names the folded risk (no risk repair, no shortcut, no stale ledger line)', () => {
    expect(Object.keys(a.inference_classes)).not.toContain(RISK);
    expect(a.goal_constraints.map((c) => c.node_id)).not.toContain(RISK);
    for (const n of a.nodes) expect(Object.keys(n.interventions ?? {})).not.toContain(RISK);
    expect(a.withheld.filter((w) => w.from === RISK || w.to === RISK || w.from === 'Price sensitivity' || w.to === 'Price sensitivity')).toEqual([]);
    const stale = a.loss.filter((l) => !/\.risk_folded$/.test(String(l.field_path))
      && (String(l.field_path).includes(RISK) || String(l.reason).includes('Price sensitivity')));
    expect(stale, JSON.stringify(stale.map((l) => l.field_path))).toEqual([]);
  });

  it('RED: the build result says the fold in not_represented, asks nothing about the folded risk, and never registers it', async () => {
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
    expect(registered).toBeDefined();
    expect(registered!.nodes.some((n) => n.id === RISK)).toBe(false);
    expect(registered!.edges.filter((e) => e.from === RISK || e.to === RISK)).toEqual([]);
    expect(registered!.edges.filter((e) => e.from === PRICE && e.to === CHURN)).toHaveLength(1);
  });
});

describe('A4a contrasts: a risk that is not Olumi\'s one-parent mediator is left exactly as drafted', () => {
  it('the served draft itself, admitted, is a mediator (the contrasts differ from it in ONE thing each)', () => {
    expect(foldEntries(admitCandidateModel(PAUL))).toHaveLength(1);
  });

  it('a risk with a USER-STATED link (brief_extraction) is unchanged', () => {
    expectUnfolded(admitCandidateModel(withLinks(relink('Pro plan price', 'Price sensitivity', { provenance: 'explicit' }))), { servedLinks: false });
    expectUnfolded(admitCandidateModel(withLinks(relink('Price sensitivity', 'Monthly churn', { provenance: 'explicit' }))), { servedLinks: false });
  });

  it('a risk whose link the user sized (effect_provenance explicit) is unchanged', () => {
    expectUnfolded(admitCandidateModel(withLinks(relink('Price sensitivity', 'Monthly churn', { effect_provenance: 'explicit' }))), { servedLinks: false });
  });

  it('a risk the brief itself names is unchanged', () => {
    expectUnfolded(admitCandidateModel({ ...PAUL, risks: [{ label: 'Price sensitivity', provenance: 'explicit' }] }));
  });

  it('a risk a LIMIT names is unchanged (the limit\'s node_id would dangle)', () => {
    const limit = { metric: 'Price sensitivity', operator: '<=', value: 50, unit: '%', provenance: 'inferred', frame: 'level' };
    expectUnfolded(admitCandidateModel({ ...PAUL, constraints: [...PAUL.constraints, limit] as CandidateModel['constraints'] }));
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
    expect(shape(edge(a, PRICE, RISK)[0]!)).toEqual(shape(servedEdge(PRICE, RISK)));
  });

  it('the TRUNCATION case (|mean′| + 2σ′ > 1) is unchanged', () => {
    const big = { strength_mean: 0.9, strength_std: 0.3 };
    const links = relink('Pro plan price', 'Price sensitivity', big)
      .map((l) => (l.from === 'Price sensitivity' && l.to === 'Monthly churn' ? { ...l, ...big } : l));
    // 0.81 + 2·√(0.81·0.09·2 + 0.0081) = 1.59 > 1
    expect(0.81 + 2 * sigmaPrime(0.9, 0.3, 0.9, 0.3)).toBeGreaterThan(1);
    const a = admitCandidateModel(withLinks(links));
    expectUnfolded(a, { servedLinks: false });
    expect(edge(a, RISK, CHURN)[0]!.strength).toEqual({ mean: 0.9, std: 0.3 });
    expect(edge(a, PRICE, RISK)[0]!.strength).toEqual({ mean: 0.9, std: 0.3 });
  });

  it('a mediator BESIDE A DIRECT p → k link is left as drafted (5854861848): the risk, its links and the direct link', () => {
    const a = admitCandidateModel(withLinks([
      ...PAUL.links,
      { from: 'Pro plan price', to: 'Monthly churn', direction: 'positive', provenance: 'inferred', strength_mean: 0.2, strength_std: 0.05 },
    ]));
    expectUnfolded(a, { direct: true });
    const direct = edge(a, PRICE, CHURN);
    expect(direct).toHaveLength(1);
    expect(shape(direct[0]!)).toEqual({ strength: { mean: 0.2, std: 0.05 }, p: 0.8, dir: 'positive' });
    expect(direct[0]!.provenance?.reasoning).toBeUndefined();
    expect(riskFeedsAFactor(a).map((e) => `${e.from}::${e.to}`)).toEqual([`${RISK}::${CHURN}`]);
  });

  it('…and beside a direct p → k link stated with its direction UNKNOWN (withheld, still the drafter\'s link)', () => {
    const a = admitCandidateModel(withLinks([
      ...PAUL.links,
      { from: 'Pro plan price', to: 'Monthly churn', direction: 'unknown', provenance: 'inferred' },
    ]));
    expectUnfolded(a);
    expect(a.withheld.filter((w) => w.from === PRICE && w.to === CHURN)).toHaveLength(1);
  });
});
