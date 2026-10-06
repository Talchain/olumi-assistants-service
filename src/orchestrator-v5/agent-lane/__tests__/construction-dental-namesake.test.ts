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
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

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
      + '"Missed-appointment fee level"? Say which and I\'ll draw that link.');
  });

  it('CONTROL: with no link the option could hold, the rename alone is said — nothing set aside, nothing asked', async () => {
    const { r } = await build(dental({ riskLink: false }));
    expect(r).toMatchObject({ ok: true });
    expect(r.not_represented).toContain('"Missed-appointment fee" names both an option and the factor it acts on, so the factor is called "Missed-appointment fee level" to keep the two apart.');
    expect([...(r.not_represented ?? []), ...(r.open_questions ?? [])].filter((s: string) => /set aside and not in the model yet|directly, or through/.test(s))).toEqual([]);
  });
});
