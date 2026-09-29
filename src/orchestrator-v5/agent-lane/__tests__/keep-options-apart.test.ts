/**
 * ⛔ AN OPTION AND A QUANTITY NEVER SHARE A NAME (Canvas #72 5884644099, the morning-path cloud-bill brief). Admission
 * gives one id per name, so a factor named like its option vanished into the option and the model could not be run.
 * Row 1: Canvas's own brief, reproduced on the live route (saved draft), through the real build. Rows 2–6: the pure rule.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { keepOptionsAndQuantitiesApart } from '../keep-options-apart.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import type { CandidateModel } from '../admit-model.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/cloud3-option-factor-same-name-20260929.json', import.meta.url), 'utf8')) as { brief: string; candidate: CandidateModel };

function build(candidate: unknown, brief = FX.brief) {
  let registered: Rec | null = null;
  const fn = vi.fn(async () => ({ text: JSON.stringify(candidate) })) as unknown as CallStructuredModel;
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { registered = (body as { graph: Rec }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
    return { status: 200, json: { versions: [] } };
  }) as unknown as InternalDispatch;
  return buildModelFromBrief('99999999-9999-4999-8999-999999999999', brief, dispatch, fn).then((r) => ({ r: r as Rec, g: registered as unknown as Rec }));
}

describe('Canvas\'s cloud-bill brief (saved live draft): the option and the factor it sets stay two nodes', () => {
  it('PRECONDITION: the drafter named the option AND its factor "Enterprise discount"', () => {
    expect(FX.candidate.options.map((o) => o.label)).toContain('Enterprise discount');
    expect(FX.candidate.factors.map((f) => f.label)).toContain('Enterprise discount');
  });
  it('RED 1 — the discount factor is a node, the option sets it, its link to the bill stays a factor link, and the rename is said', async () => {
    const { r, g } = await build(FX.candidate);
    const option = (g.nodes as Rec[]).find((n) => n.kind === 'option' && n.label === 'Enterprise discount')!;
    const factor = (g.nodes as Rec[]).find((n) => n.kind === 'factor' && n.label === 'Enterprise discount level');
    expect(factor, JSON.stringify((g.nodes as Rec[]).map((n) => [n.id, n.kind, n.label]))).toBeDefined();
    expect(Object.keys(option.interventions ?? option.data?.interventions ?? {})).toEqual([factor!.id]);
    const edges = g.edges as Rec[];
    expect(edges.some((e) => e.from === option.id && e.to === factor!.id)).toBe(true);
    expect(edges.some((e) => e.from === factor!.id && e.to === 'monthly_cloud_bill')).toBe(true);
    expect(edges.some((e) => e.from === option.id && e.to === 'monthly_cloud_bill'), 'no option → goal shortcut').toBe(false);
    expect(r.not_represented).toContain('"Enterprise discount" names both an option and the factor it acts on, so the factor is called "Enterprise discount level" to keep the two apart.');
  });
});

describe('the pure rule', () => {
  const base = (over: Partial<CandidateModel> = {}): CandidateModel => ({
    goal: { metric: 'Monthly cloud bill', operator: '<=', unit: 'GBP', horizon_months: 6, provenance: 'explicit', value: -15, frame: 'change_rel' },
    constraints: [{ metric: 'Discount', operator: '>=', value: 5, unit: '%', provenance: 'explicit' } as never],
    options: [{ label: 'Discount', provenance: 'explicit', interventions: [{ factor_label: 'Discount', value: 10, provenance: 'ai_proposed' }], changes: ['Discount'] }],
    factors: [{ label: 'Discount', role: 'controllable', baseline_known: false, baseline_value: null, unit: '%', provenance: 'inferred' }],
    risks: [], outcomes: [],
    links: [{ from: 'Discount', to: 'Monthly cloud bill', direction: 'negative', provenance: 'inferred' } as never],
    identities: [{ outcome: 'Monthly cloud bill', operation: 'product', factors: ['Discount', 'Usage'], provenance: 'inferred' }],
    ...over,
  } as CandidateModel);
  it('2 — every reference to the factor is renamed: its entry, interventions, changes, links, limits, identities; the option keeps its name', () => {
    const { model, renamed } = keepOptionsAndQuantitiesApart(base());
    expect(renamed).toEqual([{ option: 'Discount', kind: 'factor', from: 'Discount', to: 'Discount level' }]);
    expect(model.options[0]!.label).toBe('Discount');
    expect(model.factors[0]!.label).toBe('Discount level');
    expect(model.options[0]!.interventions![0]!.factor_label).toBe('Discount level');
    expect(model.options[0]!.changes).toEqual(['Discount level']);
    expect(model.links[0]).toMatchObject({ from: 'Discount level', to: 'Monthly cloud bill' });
    expect((model.constraints[0] as Rec).metric).toBe('Discount level');
    expect(model.identities![0]!.factors).toEqual(['Discount level', 'Usage']);
  });
  it('3 — case and spacing do not hide a clash ("Enterprise  Discount" vs "enterprise discount")', () => {
    const c = base({ options: [{ label: 'Enterprise  Discount', provenance: 'explicit' }], factors: [{ label: 'enterprise discount', role: 'controllable', baseline_known: false, baseline_value: null, unit: '%', provenance: 'inferred' }], links: [{ from: 'enterprise discount', to: 'Monthly cloud bill', direction: 'negative', provenance: 'inferred' } as never], constraints: [], identities: [] });
    expect(keepOptionsAndQuantitiesApart(c).renamed.map((k) => k.to)).toEqual(['enterprise discount level']);
  });
  it('4 — a risk named like an option is renamed "<name> risk"', () => {
    const c = base({ options: [{ label: 'Migration', provenance: 'explicit' }], factors: [], risks: [{ label: 'Migration', provenance: 'inferred' }], links: [{ from: 'Migration', to: 'Monthly cloud bill', direction: 'positive', provenance: 'inferred' } as never], constraints: [], identities: [] });
    expect(keepOptionsAndQuantitiesApart(c).renamed.map((k) => k.to)).toEqual(['Migration risk']);
  });
  it('CONTROL 5 — no clash: the candidate is returned as it came (same object), nothing said', () => {
    const c = base({ options: [{ label: 'Negotiate a discount', provenance: 'explicit' }] });
    const out = keepOptionsAndQuantitiesApart(c);
    expect(out.model).toBe(c);
    expect(out.renamed).toEqual([]);
  });
  it('CONTROL 7 — a same-named quantity with NO drawn effect of its own (served journey C) is left to the loop handling; a self-link is not an effect', () => {
    for (const links of [[], [{ from: 'Discount', to: 'Discount', direction: 'positive', provenance: 'inferred' }], [{ from: 'Usage', to: 'Discount', direction: 'positive', provenance: 'inferred' }]]) {
      const c = base({ links: links as never, constraints: [], identities: [] });
      const out = keepOptionsAndQuantitiesApart(c);
      expect(out.renamed).toEqual([]);
      expect(out.model).toBe(c);
    }
  });
  it('CONTROL 6 — a goal named like an option is never renamed', () => {
    const c = base({ options: [{ label: 'Monthly cloud bill', provenance: 'explicit' }], factors: [], links: [], constraints: [], identities: [] });
    expect(keepOptionsAndQuantitiesApart(c).renamed).toEqual([]);
  });
});
