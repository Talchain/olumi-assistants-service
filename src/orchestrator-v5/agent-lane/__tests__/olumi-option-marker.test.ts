/**
 * ⭐ AN OPTION OLUMI ADDED IS MARKED `proposed_by: 'olumi'` ON THE SAVED GRAPH, AND ONLY THEN (DL #72 5887489508 +
 * 5887534233 + 5887755959; Canonical 5887564539; MG 5887738387). The Run's filter, the analysis hash and the intake
 * reconciliation read this one typed field; none of them reads the brief.
 * Rows 1–2: real drafter outputs from MG's live Baseline v1 arms (fixture `_source`), through the real build and
 * `/graph/register`. Rows 3–7: the backstop, pure. A wrongly marked user option would be dropped from the comparison,
 * so every doubt leaves the option unmarked.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { markOlumiOptions, olumiAddedOptionLabels } from '../olumi-option-marker.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import type { CandidateModel } from '../admit-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/olumi-added-options-live-drafts-20260929.json', import.meta.url), 'utf8')) as {
  drafts: { arm: string; brief_id: string; rep: number; brief: string; candidate: CandidateModel }[];
};
const draft = (arm: string, id: string) => FX.drafts.find((d) => d.arm === arm && d.brief_id === id)!;

function build(candidate: unknown, brief: string) {
  let registered: Rec | null = null;
  const fn = vi.fn(async () => ({ text: JSON.stringify(candidate) })) as unknown as CallStructuredModel;
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { registered = (body as { graph: Rec }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
    return { status: 200, json: { versions: [] } };
  }) as unknown as InternalDispatch;
  return buildModelFromBrief('99999999-9999-4999-8999-999999999999', brief, dispatch, fn).then((r) => ({ r: r as Rec, g: registered as unknown as Rec }));
}
const marks = (g: Rec) => Object.fromEntries((g.nodes as Rec[]).filter((n) => n.kind === 'option').map((n) => [n.label, n.proposed_by ?? null]));

describe('real drafts, real build: the saved graph marks Olumi\'s option and nothing else', () => {
  it('1 — brief A (keep £49 / raise £59): "£54 Pro release" is Olumi\'s; the user\'s two options and the status quo are not marked', async () => {
    const d = draft('base', 'A');
    const { r, g } = await build(d.candidate, d.brief);
    expect(r.ok, JSON.stringify(r).slice(0, 400)).toBe(true);
    expect(marks(g)).toEqual({ '£59 Pro release': null, 'Release at £49': null, '£54 Pro release': 'olumi', 'Continue as now': null });
    // The field survives the contract the route parses on registration.
    const parsed = GraphV3.safeParse(g);
    expect(parsed.success).toBe(true);
    expect(((parsed as { data: Rec }).data.nodes as Rec[]).find((n) => n.label === '£54 Pro release')!.proposed_by).toBe('olumi');
  });
  it('2 — brief E: "Hire two junior engineers" is Olumi\'s; "two senior and two junior" sets a level the user wrote, so it is NOT marked', async () => {
    const g0 = (await build(draft('lsG', 'E').candidate, draft('lsG', 'E').brief)).g;
    expect(marks(g0)).toMatchObject({ 'Hire two senior engineers': null, 'Hire four junior engineers': null, 'Hire two junior engineers': 'olumi' });
    const g1 = (await build(draft('lsF', 'E').candidate, draft('lsF', 'E').brief)).g;
    expect(marks(g1)['Hire two senior and two junior']).toBeNull();
    expect(Object.values(marks(g1)).filter((v) => v !== null)).toEqual([]);
  });
});

describe('the backstop (pure)', () => {
  const brief = 'Should we keep the Pro plan at £49 or raise it to £59 per month?';
  const c = (options: Rec[]): CandidateModel => ({
    goal: { metric: 'MRR', operator: '>=', unit: 'GBP', value: 100000, horizon_months: 6, provenance: 'explicit' },
    factors: [{ label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit' }],
    options, links: [], risks: [], outcomes: [], constraints: [], identities: [], unknowns: [],
  } as unknown as CandidateModel);
  const opt = (label: string, provenance: string, value: number | null, is_status_quo: boolean | null = null) =>
    ({ label, provenance, is_status_quo, changes: [], interventions: value === null ? [] : [{ factor_label: 'Pro plan price', value, value_kind: 'absolute', unit: 'GBP', provenance }] });

  it('3 — an ai_proposed option whose NAME the brief says is not marked, at a level the user never wrote (control: another name is)', () => {
    const named = `${brief} A mid price is another thought.`;
    expect([...olumiAddedOptionLabels(c([opt('Mid price', 'ai_proposed', 54)]), named)]).toEqual([]);
    expect([...olumiAddedOptionLabels(c([opt('Middle tier', 'ai_proposed', 54)]), named)]).toEqual(['middle tier']);
  });
  it('4 — an ai_proposed option setting a level the user wrote is not marked', () => {
    expect([...olumiAddedOptionLabels(c([opt('Premium tier', 'ai_proposed', 59)]), brief)]).toEqual([]);
  });
  it('5 — the status quo is never marked: declared (even with a level), undeclared and inert, or stamped is_baseline on its node', () => {
    expect([...olumiAddedOptionLabels(c([opt('Hold steady', 'ai_proposed', 50, true), opt('Carry on as now', 'ai_proposed', null)]), brief)]).toEqual([]);
    const nodes = [{ id: 'k', kind: 'option', label: 'Mid price', is_baseline: true }];
    expect(markOlumiOptions(nodes, c([opt('Mid price', 'ai_proposed', 54)]), brief)).toBe(nodes);
  });
  it('6 — two options sharing a name: neither is marked (and a user tag is never marked)', () => {
    expect([...olumiAddedOptionLabels(c([opt('Mid price', 'ai_proposed', 54), opt('mid  price', 'explicit', 55)]), brief)]).toEqual([]);
    expect([...olumiAddedOptionLabels(c([opt('Mid price', 'explicit', 54), opt('Low price', 'inferred', 39)]), brief)]).toEqual([]);
  });
  it('7 — no Olumi option: the SAME node array comes back (the analysis hash cannot move); two option nodes with one name: neither is marked', () => {
    const nodes = [{ id: 'a', kind: 'option', label: 'Mid price' }, { id: 'g', kind: 'goal', label: 'MRR' }];
    expect(markOlumiOptions(nodes, c([opt('Raise it to £59', 'ai_proposed', 59)]), brief)).toBe(nodes);
    const twin = [{ id: 'a', kind: 'option', label: 'Mid price' }, { id: 'b', kind: 'option', label: 'Mid Price' }];
    expect(markOlumiOptions(twin, c([opt('Mid price', 'ai_proposed', 54)]), brief).map((n) => (n as Rec).proposed_by ?? null)).toEqual([null, null]);
    expect(markOlumiOptions(nodes, c([opt('Mid price', 'ai_proposed', 54)]), brief).map((n) => (n as Rec).proposed_by ?? null)).toEqual(['olumi', null]);
  });
});
