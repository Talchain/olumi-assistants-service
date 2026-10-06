/**
 * ⭐ A GUEST'S FIRST DRAFT IS NEVER REFUSED OVER A SHARED NAME (DL ruling; Acceptance e7, prod CEE b38592e, cut 5).
 *
 * The dental brief (red-team brief8) failed to draft 3 of 3 on prod: the drafter named the option AND the factor it sets
 * "Missed-appointment fee", and the factor's link to the risk ‘Patient dissatisfaction from charges’ could have been the
 * option's (an option → risk shortcut), so `option_name_ambiguous` refused the build: "…could not be told apart and nothing
 * was saved". A first-time guest's very first output was a refusal (pd acceptance/successor-20261005 @e5a38f4b,
 * final/rt18-dental-prod{,-2,-3}). Now the factor is renamed, keeps its link to the goal, and the link the option could hold
 * is SET ASIDE, said and asked. The candidate mirrors the served draft (red team nde-2623's graph before the user's rename).
 * Bound by node and edge identity on the graph the real construction door registers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import type { CandidateModel } from '../admit-model.js';

const BRIEF = 'We run a group of 12 dental clinics. Too many patients miss their appointments without warning, and we want no-shows to '
  + 'fall. We are choosing between (A) sending text reminders 48 hours before each appointment, (B) charging a £20 fee for a '
  + 'missed appointment, or (C) letting patients reschedule themselves online. Our front-desk staff think reminders would make '
  + 'the biggest difference.';

const set = (factor_label: string, value: number, unit: string) => ({ factor_label, value, value_kind: 'absolute', unit, provenance: 'ai_proposed' });
const link = (from: string, to: string, direction: 'positive' | 'negative') => ({ from, to, direction, provenance: 'inferred' });

function dental(over: { riskLink?: boolean } = {}): Record<string, unknown> {
  return {
    goal: { metric: 'no-shows', operator: '<=', target_stated: false, frame: 'level', value: null, unit: '% of appointments', horizon_months: null,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null },
    constraints: [],
    options: [
      { label: '48-hour text reminders', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set('48-hour text-reminder coverage', 100, '% of appointments')] },
      { label: 'Missed-appointment fee', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set('Missed-appointment fee', 20, 'GBP per missed appointment')] },
      { label: 'Online self-rescheduling', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set('Online self-rescheduling availability', 90, '% of appointments')] },
      { label: 'Current approach', provenance: 'inferred', is_status_quo: true, changes: [], interventions: [] },
    ],
    factors: [
      { label: '48-hour text-reminder coverage', role: 'controllable', baseline_known: false, baseline_value: 0, unit: '% of appointments', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'Missed-appointment fee', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP per missed appointment', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'Online self-rescheduling availability', role: 'controllable', baseline_known: false, baseline_value: 0, unit: '% of appointments', provenance: 'ai_proposed', plausible_max: 100 },
    ],
    risks: [{ label: 'Patient dissatisfaction from charges', provenance: 'inferred' }],
    outcomes: [{ label: 'Appointments rescheduled before slot', provenance: 'inferred' }],
    links: [
      link('48-hour text-reminder coverage', 'no-shows', 'negative'),
      link('Missed-appointment fee', 'no-shows', 'negative'),
      ...(over.riskLink === false ? [] : [link('Missed-appointment fee', 'Patient dissatisfaction from charges', 'positive')]),
      link('Patient dissatisfaction from charges', 'no-shows', 'positive'),
      link('Online self-rescheduling availability', 'Appointments rescheduled before slot', 'positive'),
      link('Appointments rescheduled before slot', 'no-shows', 'negative'),
    ],
    identities: [], unknowns: [], decision_question: null,
  };
}

type Rec = Record<string, any>;
async function build(wire: Record<string, unknown>): Promise<{ r: Rec; g: Rec | null }> {
  let g: Rec | null = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { g = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const r = await buildModelFromBrief('4c32eae5-0000-4000-8000-0000004c32ea', BRIEF, dispatch, call) as Rec;
  return { r, g };
}

describe('the dental brief\'s first draft is built, never refused over the shared name', () => {
  it('RED (prod 3/3): built; the fee factor is renamed and set by the option; its goal link kept; the risk link set aside, said and asked', async () => {
    const { r, g } = await build(dental());
    expect(r, JSON.stringify(r).slice(0, 400)).toMatchObject({ ok: true });
    expect(r.refusal).toBeUndefined();
    const nodes = g!.nodes as Rec[];
    const edges = g!.edges as Rec[];
    const option = nodes.find((n) => n.kind === 'option' && n.label === 'Missed-appointment fee')!;
    const factor = nodes.find((n) => n.kind === 'factor' && n.label === 'Missed-appointment fee level')!;
    const risk = nodes.find((n) => n.label === 'Patient dissatisfaction from charges')!;
    const goal = nodes.find((n) => n.kind === 'goal')!;
    expect(factor, JSON.stringify(nodes.map((n) => [n.kind, n.label]))).toBeDefined();
    expect(Object.keys(option.interventions ?? {})).toEqual([factor.id]);
    expect(edges.some((e) => e.from === factor.id && e.to === goal.id)).toBe(true);
    expect(edges.filter((e) => e.to === risk.id && (e.from === factor.id || e.from === option.id))).toEqual([]);
    expect(r.not_represented).toContain('The link from "Missed-appointment fee" to "Patient dissatisfaction from charges" could be the option\'s own or '
      + '"Missed-appointment fee level"\'s, so it is set aside and not in the model yet.');
    expect(r.open_questions).toContain('Does "Missed-appointment fee" change "Patient dissatisfaction from charges" directly, or through '
      + '"Missed-appointment fee level"? Until you say, that link is not in the model.');
    // ⛔ DL pre-check: no promise to draw it (the link door asks for the user's own strength and direction first).
    expect(JSON.stringify(r)).not.toContain('draw that link');
  });

  it('CONTROL: with no link the option could hold, the rename alone is said — nothing set aside, nothing asked', async () => {
    const { r } = await build(dental({ riskLink: false }));
    expect(r).toMatchObject({ ok: true });
    expect(r.not_represented).toContain('"Missed-appointment fee" names both an option and the factor it acts on, so the factor is called "Missed-appointment fee level" to keep the two apart.');
    expect([...(r.not_represented ?? []), ...(r.open_questions ?? [])].filter((s: string) => /set aside and not in the model yet|directly, or through/.test(s))).toEqual([]);
  });
});

/**
 * Codex r1 on #2655 (CHANGES, 4 findings), each reproduced on the cloud3 fixture (option "Enterprise discount" sets its
 * namesake factor) through the real register door. Bound by node and edge identity, and by the exact sentences.
 */
describe('Codex r1 #2655: what is set aside stays true to the registered model', () => {
  const FX = JSON.parse(readFileSync(new URL('./fixtures/cloud3-option-factor-same-name-20260929.json', import.meta.url), 'utf8')) as { brief: string; candidate: CandidateModel };
  const L = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'inferred' });
  const LOCK_IN_LINE = 'The link from "Enterprise discount" to "Provider lock-in" could be the option\'s own or "Enterprise discount level"\'s, so it is set aside and not in the model yet.';
  const LOCK_IN_ASK = 'Does "Enterprise discount" change "Provider lock-in" directly, or through "Enterprise discount level"? Until you say, that link is not in the model.';
  async function run(c: Rec, brief = FX.brief, repair?: (x: Rec) => void): Promise<{ r: Rec; edges: [string, string][]; said: string[]; asked: string[]; trace: Rec }> {
    let g: Rec | null = null; let calls = 0; let trace: Rec = {};
    const call = (async (req: { input: string }) => {
      calls += 1;
      let x = c;
      if (calls > 1 && repair !== undefined) {
        // The retry is drafted from the candidate the first pass prepared (the prompt's "Candidate to repair"), as served.
        x = JSON.parse(req.input.slice(req.input.indexOf(': {', req.input.indexOf('Candidate to repair')) + 2)) as Rec;
        repair(x);
      }
      return { text: JSON.stringify(x) };
    }) as unknown as CallStructuredModel;
    const dispatch: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph/register')) { g = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
    };
    const r = await buildModelFromBrief('99999999-9999-4999-8999-999999999999', brief, dispatch, call, (t) => { trace = t as unknown as Rec; }) as Rec;
    expect(r.ok, JSON.stringify(r).slice(0, 400)).toBe(true);
    return { r, edges: (g!.edges as Rec[]).map((e) => [e.from, e.to] as [string, string]), said: r.not_represented ?? [], asked: r.open_questions ?? [], trace };
  }
  const withLockIn = (): Rec => {
    const c = structuredClone(FX.candidate) as Rec;
    c.risks.push({ label: 'Provider lock-in', provenance: 'inferred' });
    c.links.push(L('Enterprise discount', 'Provider lock-in'), L('Provider lock-in', c.goal.metric));
    return c;
  };
  const toLockIn = (edges: [string, string][]) => edges.filter(([from, to]) => to === 'provider_lock_in' && from.startsWith('enterprise_discount'));

  it('P2: the same link drawn twice is said once and asked once', async () => {
    const c = withLockIn();
    c.links.push(L('Enterprise discount', 'Provider lock-in'));
    const { said, asked, edges } = await run(c);
    expect(said.filter((x) => x === LOCK_IN_LINE)).toHaveLength(1);
    expect(asked.filter((x) => x === LOCK_IN_ASK)).toHaveLength(1);
    expect(toLockIn(edges)).toEqual([]);
  });

  it('P1 (retry echo): an adopted retry drafted from the renamed candidate still says and asks what the first draft set aside', async () => {
    const c = withLockIn();
    // A coverage gap (Reserved instances sets nothing) forces the retry, which restores the intervention and is adopted.
    c.options[0].interventions = []; c.options[0].changes = ['Reserved-instance coverage'];
    const { said, asked, edges, trace } = await run(c, FX.brief, (x) => {
      x.options[0].interventions = [{ factor_label: 'Reserved-instance coverage', value: 70, value_kind: 'absolute', unit: '% of cloud spend', provenance: 'ai_proposed' }];
    });
    expect(trace).toMatchObject({ retried: true, outcome: 'adopted' });
    expect(said).toContain('"Enterprise discount" names both an option and the factor it acts on, so the factor is called "Enterprise discount level" to keep the two apart.');
    expect(said).toContain(LOCK_IN_LINE);
    expect(asked).toContain(LOCK_IN_ASK);
    expect(toLockIn(edges)).toEqual([]);
  });

  it('P1 (retry guess): a retry that draws "Enterprise discount level" → "Provider lock-in" does not register Olumi\'s guess; it stays asked', async () => {
    const c = withLockIn();
    c.options[0].interventions = []; c.options[0].changes = ['Reserved-instance coverage'];
    const { said, asked, edges, trace } = await run(c, FX.brief, (x) => {
      x.options[0].interventions = [{ factor_label: 'Reserved-instance coverage', value: 70, value_kind: 'absolute', unit: '% of cloud spend', provenance: 'ai_proposed' }];
      x.links.push(L('Enterprise discount level', 'Provider lock-in'));
    });
    expect(trace).toMatchObject({ retried: true, outcome: 'adopted' });
    expect(toLockIn(edges)).toEqual([]);
    expect(said).toContain(LOCK_IN_LINE);
    expect(asked).toContain(LOCK_IN_ASK);
  });

  it('P1 (own action): a link to the factor the option already sets is its own stated action — drawn from it, never "set aside"', async () => {
    const c = structuredClone(FX.candidate) as Rec;
    const opt = c.options.find((o: Rec) => o.label === 'Enterprise discount');
    opt.changes = ['Reserved-instance coverage'];
    opt.interventions.push({ ...c.options[0].interventions[0], value: 75 });
    c.links.push(L('Enterprise discount', 'Reserved-instance coverage'));
    const { said, asked, edges } = await run(c);
    expect(edges).toContainEqual(['enterprise_discount', 'reserved_instance_coverage']);
    expect(edges).not.toContainEqual(['enterprise_discount_level', 'reserved_instance_coverage']);
    expect([...said, ...asked].filter((x) => x.includes('"Reserved-instance coverage"') && /set aside|directly, or through/.test(x))).toEqual([]);
  });

  it('P1 (limited outcome): an outcome a stated limit makes a factor is one the option could act on — set aside, never re-sourced', async () => {
    const c = withLockIn();
    c.outcomes = [{ label: 'Monthly churn', provenance: 'inferred' }];
    c.links = c.links.map((l: Rec) => ({ ...l, to: l.to === 'Service reliability change' ? 'Monthly churn' : l.to }));
    c.constraints = [{ metric: 'Monthly churn', operator: '<=', value: 10, unit: '%', provenance: 'explicit', frame: 'level' }];
    c.links.push(L('Enterprise discount', 'Monthly churn'));
    const { said, asked, edges } = await run(c, `${FX.brief} Keep monthly churn under 10%.`);
    expect(edges.filter(([from, to]) => to === 'monthly_churn' && from.startsWith('enterprise_discount'))).toEqual([]);
    expect(said).toContain('The link from "Enterprise discount" to "Monthly churn" could be the option\'s own or "Enterprise discount level"\'s, so it is set aside and not in the model yet.');
    expect(asked).toContain('Does "Enterprise discount" change "Monthly churn" directly, or through "Enterprise discount level"? Until you say, that link is not in the model.');
  });

  // ── Codex r2 #2655 (cap reached; each reproduced through `buildModelFromBrief`) ──
  it('r2 P1 (retry acts on the held end): the retry\'s new action by the option on "Reserved-instance coverage" is removed; the link stays out and asked', async () => {
    const c = structuredClone(FX.candidate) as Rec;
    c.links.push(L('Enterprise discount', 'Reserved-instance coverage'));
    c.options[0].interventions = []; c.options[0].changes = ['Reserved-instance coverage'];
    const { said, asked, edges } = await run(c, FX.brief, (x) => {
      x.options[0].interventions = [{ factor_label: 'Reserved-instance coverage', value: 70, value_kind: 'absolute', unit: '% of cloud spend', provenance: 'ai_proposed' }];
      const opt = x.options.find((o: Rec) => o.label === 'Enterprise discount');
      opt.changes = ['Reserved-instance coverage'];
      opt.interventions.push({ factor_label: 'Reserved-instance coverage', value: 75, value_kind: 'absolute', unit: '% of cloud spend', provenance: 'ai_proposed' });
      x.links.push(L('Enterprise discount level', 'Reserved-instance coverage'));
    });
    expect(edges.filter(([from, to]) => to === 'reserved_instance_coverage' && from.startsWith('enterprise_discount'))).toEqual([]);
    expect(said).toContain('The link from "Enterprise discount" to "Reserved-instance coverage" could be the option\'s own or "Enterprise discount level"\'s, so it is set aside and not in the model yet.');
    expect(asked).toContain('Does "Enterprise discount" change "Reserved-instance coverage" directly, or through "Enterprise discount level"? Until you say, that link is not in the model.');
  });

  it('r2 P1 (retry renames the quantity): a compaction retry calling it "Negotiated discount rate" never draws it into the risk; the hold follows the name', async () => {
    const c = withLockIn();
    c.options.find((o: Rec) => o.label === 'Enterprise discount').interventions.push({ factor_label: 'Reserved-instance coverage', value: 75, value_kind: 'absolute', unit: '% of cloud spend', provenance: 'ai_proposed' });
    // Twelve extra outcomes force the size retry (a compaction).
    for (let i = 1; i <= 12; i += 1) { c.outcomes.push({ label: `Extra outcome ${i}`, provenance: 'inferred' }); c.links.push(L(`Extra outcome ${i}`, c.goal.metric)); }
    const { said, asked, edges, trace } = await run(c, FX.brief, (x) => {
      x.outcomes = x.outcomes.filter((o: Rec) => !String(o.label).startsWith('Extra outcome'));
      x.links = x.links.filter((l: Rec) => !String(l.from).startsWith('Extra outcome'));
      const rename = (v: string): string => (v === 'Enterprise discount level' ? 'Negotiated discount rate' : v);
      x.factors = x.factors.map((f: Rec) => ({ ...f, label: rename(f.label) }));
      x.options = x.options.map((o: Rec) => ({ ...o, interventions: (o.interventions ?? []).map((i: Rec) => ({ ...i, factor_label: rename(i.factor_label) })) }));
      x.links = x.links.map((l: Rec) => ({ ...l, from: rename(l.from), to: rename(l.to) }));
      x.links.push(L('Negotiated discount rate', 'Provider lock-in'));
    });
    expect(trace).toMatchObject({ retried: true, outcome: 'adopted' });
    expect(edges.filter(([, to]) => to === 'provider_lock_in').map(([from]) => from)).toEqual([]);
    // The hold follows the quantity's new name.
    expect(said).toContain('The link from "Enterprise discount" to "Provider lock-in" could be the option\'s own or "Negotiated discount rate"\'s, so it is set aside and not in the model yet.');
    expect(asked).toContain('Does "Enterprise discount" change "Provider lock-in" directly, or through "Negotiated discount rate"? Until you say, that link is not in the model.');
  });

  it('r2 P1 (rename, no single new name): a compaction retry whose option sets two new quantities never draws its own link to the held end', async () => {
    const c = withLockIn();
    for (let i = 1; i <= 12; i += 1) { c.outcomes.push({ label: `Extra outcome ${i}`, provenance: 'inferred' }); c.links.push(L(`Extra outcome ${i}`, c.goal.metric)); }
    const { edges, trace } = await run(c, FX.brief, (x) => {
      x.outcomes = x.outcomes.filter((o: Rec) => !String(o.label).startsWith('Extra outcome'));
      x.links = x.links.filter((l: Rec) => !String(l.from).startsWith('Extra outcome'));
      const rename = (v: string): string => (v === 'Enterprise discount level' ? 'Negotiated discount rate' : v);
      x.factors = x.factors.map((f: Rec) => ({ ...f, label: rename(f.label) }));
      x.factors.push({ ...x.factors.find((f: Rec) => f.label === 'Negotiated discount rate'), label: 'Discount tier' });
      x.options = x.options.map((o: Rec) => ({ ...o, interventions: (o.interventions ?? []).map((i: Rec) => ({ ...i, factor_label: rename(i.factor_label) })) }));
      x.options.find((o: Rec) => o.label === 'Enterprise discount').interventions.push({ factor_label: 'Discount tier', value: 2, value_kind: 'absolute', unit: '%', provenance: 'ai_proposed' });
      x.links = x.links.map((l: Rec) => ({ ...l, from: rename(l.from), to: rename(l.to) }));
      x.links.push(L('Discount tier', c.goal.metric), L('Enterprise discount', 'Provider lock-in'));
    });
    expect(trace).toMatchObject({ retried: true, outcome: 'adopted' });
    expect(edges).not.toContainEqual(['enterprise_discount', 'provider_lock_in']);
  });

  it('r2 P1 (a spelling admission merges): "Monthly  churn" beside the limited "Monthly churn" is re-kinded with it — its link is set aside, never re-sourced', async () => {
    const c = withLockIn();
    c.outcomes = [{ label: 'Monthly  churn', provenance: 'inferred' }, { label: 'Monthly churn', provenance: 'inferred' }];
    c.links = c.links.map((l: Rec) => ({ ...l, to: l.to === 'Service reliability change' ? 'Monthly  churn' : l.to }));
    c.constraints = [{ metric: 'Monthly churn', operator: '<=', value: 10, unit: '%', provenance: 'explicit', frame: 'level' }];
    c.links.push(L('Enterprise discount', 'Monthly  churn'));
    const { edges, said } = await run(c, `${FX.brief} Keep monthly churn under 10%.`);
    expect(edges.filter(([from, to]) => to === 'monthly_churn' && from.startsWith('enterprise_discount'))).toEqual([]);
    expect(said.some((x) => x.includes('to "Monthly  churn"') && x.includes('set aside and not in the model yet'))).toBe(true);
  });

  it('CONTROL: an outcome with no limit stays the quantity\'s alone — its link is re-sourced, nothing set aside', async () => {
    const c = withLockIn();
    c.links.push(L('Enterprise discount', 'Service reliability change'));
    const { said, edges } = await run(c);
    expect(edges).toContainEqual(['enterprise_discount_level', 'service_reliability_change']);
    expect(said.filter((x) => x.includes('"Service reliability change"') && x.includes('set aside and not in the model yet'))).toEqual([]);
  });
});
