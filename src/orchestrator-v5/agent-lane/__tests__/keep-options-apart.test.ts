/**
 * ⛔ AN OPTION AND A QUANTITY NEVER SHARE A NAME (Canvas #72 5884644099, the morning-path cloud-bill brief). Admission
 * gives one id per name, so a factor named like its option vanished into the option and the model could not be run.
 * Row 1: Canvas's own brief, reproduced on the live route (saved draft), through the real build. Rows 2–7: the pure rule.
 * Rows 8–9 (PR Review CHANGES_REQUIRED on #2281 @ bcd8d856; 8c @ e73b6dbd): a link from the shared name that the OPTION could hold
 * (to a factor, a risk, an option, an unnamed label, or itself) is never re-sourced to the quantity; the candidate is left
 * as it came. Row 10 (AI Quality 5885116642): a rename never collides with a label already in the draft. Rows 11–12 (@ 97bff479):
 * an option's name carried by more than one other item is never split by guesswork; nothing is renamed and it is said.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { keepOptionsAndQuantitiesApart, notToldApartLine } from '../keep-options-apart.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { narrateWriteOutcome } from '../write-outcome.js';
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
  it('12 (real build) — option, factor AND risk all "Enterprise discount": FAIL CLOSED AT REGISTRATION — nothing is saved, the refusal names why', async () => {
    const c = structuredClone(FX.candidate) as Rec;
    c.risks = [...(c.risks ?? []), { label: 'Enterprise discount', provenance: 'inferred' }];
    const pure = keepOptionsAndQuantitiesApart(c as CandidateModel);
    expect(pure.renamed).toEqual([]);
    expect(pure.ambiguous).toEqual([{ option: 'Enterprise discount', owners: ['factor', 'risk'], because: 'owners' }]);
    const { r, g } = await build(c);
    expect(g).toBeNull();
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'option_name_ambiguous' });
    expect(r.detail).toBe('"Enterprise discount" names an option and also a factor and a risk in this model, so they could not be told apart and nothing was saved. Say what each one is, in different words, and the model can be built.');
    expect(r.ambiguous_names).toEqual([{ option: 'Enterprise discount', owners: ['factor', 'risk'], because: 'owners' }]);
    // What the USER reads: the server-owned status line for the build tool (never the Agent-only tool result, never a code).
    const status = String(narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [r as never]).status);
    expect(status).toContain('the model uses one name for an option and for something else in the model, so they could not be told apart and nothing was saved');
    expect(status).not.toMatch(/option_name_ambiguous/);
  });
  it('8 (real build) — a link from the shared name to a RISK may be the option\'s: nothing is renamed, and the build FAILS CLOSED (nothing saved, the reason named)', async () => {
    const c = structuredClone(FX.candidate) as Rec;
    c.risks = [...(c.risks ?? []), { label: 'Provider lock-in', provenance: 'inferred' }];
    c.links = [...c.links, { from: 'Enterprise discount', to: 'Provider lock-in', direction: 'positive', provenance: 'inferred' }];
    expect(keepOptionsAndQuantitiesApart(c as CandidateModel).renamed).toEqual([]);
    const { r, g } = await build(c);
    expect(g).toBeNull();
    expect(r).toMatchObject({ ok: false, refusal: 'option_name_ambiguous' });
    expect(r.ambiguous_names).toEqual([{ option: 'Enterprise discount', owners: ['factor'], because: 'links' }]);
    expect(r.detail).toMatch(/and a link from "Enterprise discount" could belong to either/);
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
  it('8b — FAIL CLOSED: a link from the shared name to a risk, a factor, another option or an unnamed label leaves the candidate exactly as it came, even beside a goal link', () => {
    const risk = { label: 'Churn risk', provenance: 'inferred' };
    const usage = { label: 'Usage', role: 'observable', baseline_known: false, baseline_value: null, unit: 'GBP', provenance: 'inferred' };
    const goalLink = { from: 'Discount', to: 'Monthly cloud bill', direction: 'negative', provenance: 'inferred' };
    for (const [to, extra] of [['Churn risk', { risks: [risk] }], ['Usage', { factors: [base().factors[0]!, usage] }], ['Switch provider', { options: [...base().options, { label: 'Switch provider', provenance: 'explicit' }] }], ['Something unnamed', {}]] as const) {
      for (const links of [[{ from: 'Discount', to, direction: 'positive', provenance: 'inferred' }], [goalLink, { from: 'Discount', to, direction: 'positive', provenance: 'inferred' }]]) {
        const c = base({ ...(extra as Partial<CandidateModel>), links: links as never });
        const out = keepOptionsAndQuantitiesApart(c);
        expect(out.renamed, `${to} / ${links.length}`).toEqual([]);
        expect(out.model).toBe(c);
        expect(out.model.links.every((l) => l.from === 'Discount')).toBe(true);
        expect(out.ambiguous, `${to} / ${links.length}`).toEqual([{ option: 'Discount', owners: ['factor'], because: 'links' }]);
      }
    }
  });
  it('8c — FAIL CLOSED: a self-link on the shared name beside a goal link is never re-sourced as a factor self-loop', () => {
    const c = base({ links: [
      { from: 'Discount', to: 'Discount', direction: 'positive', provenance: 'explicit' },
      { from: 'Discount', to: 'Monthly cloud bill', direction: 'negative', provenance: 'inferred' },
    ] as never, constraints: [], identities: [] });
    const out = keepOptionsAndQuantitiesApart(c);
    expect(out.renamed).toEqual([]);
    expect(out.model).toBe(c);
    expect(out.model.links[0]).toMatchObject({ from: 'Discount', to: 'Discount' });
    expect(out.ambiguous).toEqual([{ option: 'Discount', owners: ['factor'], because: 'links' }]);
  });
  it('10 — COLLISION: "<name> level" already in the draft → the renamed quantity is "<name> level 2", never merged into it', () => {
    const existing = { label: 'Discount level', role: 'observable', baseline_known: false, baseline_value: null, unit: '%', provenance: 'inferred' };
    const c = base({ factors: [base().factors[0]!, existing] as never, constraints: [], identities: [] });
    const out = keepOptionsAndQuantitiesApart(c);
    expect(out.renamed.map((k) => k.to)).toEqual(['Discount level 2']);
    const labels = out.model.factors.map((f) => f.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(['discount level 2', 'discount level']);
    expect(out.model.options[0]!.interventions![0]!.factor_label).toBe('Discount level 2');
    expect(out.model.links[0]).toMatchObject({ from: 'Discount level 2', to: 'Monthly cloud bill' });
  });
  it('11 — SEVERAL OWNERS: the option\'s name also carried by two quantities (any kinds), by a quantity and the goal, or by a second option → nothing renamed, the ambiguity named', () => {
    const f = base().factors[0]!;
    const cases: [Partial<CandidateModel>, string[]][] = [
      [{ risks: [{ label: 'Discount', provenance: 'inferred' }] as never }, ['factor', 'risk']],
      [{ factors: [f, { ...f, label: 'discount' }] as never }, ['factor', 'factor']],
      [{ outcomes: [{ label: 'DISCOUNT', provenance: 'inferred' }] as never }, ['factor', 'outcome']],
      [{ goal: { ...base().goal, metric: 'Discount' } as never }, ['factor', 'goal']],
      [{ options: [...base().options, { label: 'discount', provenance: 'explicit' }] as never }, ['factor', 'option']],
    ];
    for (const [over, owners] of cases) {
      const c = base({ ...over, constraints: [], identities: [] });
      const out = keepOptionsAndQuantitiesApart(c);
      expect(out.renamed, owners.join('+')).toEqual([]);
      expect(out.model).toBe(c);
      expect(out.ambiguous).toEqual([{ option: 'Discount', owners, because: 'owners' }]);
    }
  });
  it('11b — the refusal\'s reason names every other owner, and why they could not be separated', () => {
    expect(notToldApartLine({ option: 'Discount', owners: ['factor', 'risk'], because: 'owners' })).toBe('"Discount" names an option and also a factor and a risk in this model, so they could not be told apart and nothing was saved. Say what each one is, in different words, and the model can be built.');
    expect(notToldApartLine({ option: 'Discount', owners: ['factor', 'factor', 'goal'], because: 'owners' })).toMatch(/also 2 factors and the goal in this model/);
    expect(notToldApartLine({ option: 'Discount', owners: ['factor'], because: 'links' })).toMatch(/^"Discount" names an option and also a factor in this model, and a link from "Discount" could belong to either/);
  });
  it('9 — a link from the shared name to an OUTCOME is the quantity\'s (an option never holds one): renamed', () => {
    const c = base({ outcomes: [{ label: 'Savings', provenance: 'inferred' }], links: [{ from: 'Discount', to: 'Savings', direction: 'positive', provenance: 'inferred' } as never] });
    const out = keepOptionsAndQuantitiesApart(c);
    expect(out.renamed.map((k) => k.to)).toEqual(['Discount level']);
    expect(out.model.links[0]).toMatchObject({ from: 'Discount level', to: 'Savings' });
  });
  it('CONTROL 6 — a goal named like an option is never renamed', () => {
    const c = base({ options: [{ label: 'Monthly cloud bill', provenance: 'explicit' }], factors: [], links: [], constraints: [], identities: [] });
    expect(keepOptionsAndQuantitiesApart(c).renamed).toEqual([]);
  });
});
