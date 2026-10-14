/**
 * ⭐ A4b — A RISK THAT CUTS A MONEY GOAL IS DRAFTED AS THAT MONEY (R3 A4b row; DL 5918678308 / 5923713822).
 *
 * MEASURED (MG #75 5923704064): 0 of 4 raw-captured drafts of Paul's funding brief drew its risk as money ("Fundraising
 * distraction", no unit), so every risk → £ goal link was a ±0.5 placeholder and #2386's definitional link never engaged.
 * With this clause in the drafter's rules: Paul 3/3 + 3/3 typed `definitional` (vs 1/3 in a same-time control), MRR 2/2
 * (its churn-% limit node and row kept), cost goals 0/2 wrongly signed. A prompt clause is only evidenced by those drafts;
 * these rows pin that it is SENT, scoped to money the user wants MORE of, and that the shape it asks for is admitted as
 * `definitional` (the admission half, on Paul's frameless £ goal).
 *
 * Real path: strict candidate schema → `buildModelFromBrief` (ONE scripted drafter call) → `/graph/register` → GraphV3.
 */
import { describe, expect, it } from 'vitest';
import { BUILD_INSTRUCTIONS, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Rec = Record<string, any>;
const PAUL =
  "I need to accelerate securing funding within the next 2 months. We've been focused on investment firms that do deals "
  + "between £1-2 million, mostly based in the UK. We'll keep sending cold emails and trying to find warm connections, but I "
  + "want to explore alternatives to support the funding process, as we'll run out of money soon. For example, angel "
  + 'investors might be able to provide a small amount of funding quicker to buy us more time, but we would need to decide '
  + 'whether the overhead would be worth it.';

/** a4b2-p1's first draft (`/private/tmp/mgc-resume/a4b2-p1/call-1.json`), trimmed to the risk's chain. */
const DRAFT = {
  goal: { metric: 'Funding secured', operator: '>=', target_stated: false, frame: 'level', value: null, unit: '£', horizon_months: 2,
    provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'ai_proposed', scope: null },
  constraints: [],
  options: [
    { label: 'Continue investment-firm outreach', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [] },
    { label: 'Angel outreach pilot', provenance: 'ai_proposed', changes: [], is_status_quo: null, interventions: [
      { factor_label: 'Fundraising admin hours per week', value: 6, value_kind: 'absolute', unit: 'hours/week', provenance: 'ai_proposed' }] },
  ],
  factors: [{ label: 'Fundraising admin hours per week', role: 'controllable', baseline_known: true, baseline_value: 2, unit: 'hours/week', provenance: 'ai_proposed', plausible_max: 40 }],
  risks: [{ label: 'Funding lost to fundraising distraction', provenance: 'inferred', unit: '£', plausible_max: 500000 }],
  outcomes: [],
  links: [
    { from: 'Fundraising admin hours per week', to: 'Funding lost to fundraising distraction', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null },
    { from: 'Funding lost to fundraising distraction', to: 'Funding secured', direction: 'negative', provenance: 'inferred', effect_amount: -1, effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: true },
  ],
  identities: [], unknowns: [], decision_question: null,
};

describe('A4b: a risk that cuts a money goal is drafted, and admitted, as that money', () => {
  it('the rule is in what the drafter is SENT, scoped to money the user wants MORE of (never a cost or a spend)', async () => {
    let sent = '';
    const call = (async (req: { instructions: string }) => { sent = req.instructions; return { text: JSON.stringify(DRAFT) }; }) as unknown as CallStructuredModel;
    const dispatch: InternalDispatch = async (path) => (path.endsWith('/graph/register')
      ? { status: 200, json: { model_version: { version_number: 1 } } } : { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } });
    await buildModelFromBrief('a4b0a4b0-0000-4a4b-8a4b-a4b0a4b0a4b0', PAUL, dispatch, call);
    const rule = String(BUILD_INSTRUCTIONS).match(/A RISK THAT CUTS A MONEY GOAL IS THAT MONEY[^']*?LESS of \(a cost or a spend\)\./)?.[0];
    expect(rule).toBeDefined();
    expect(sent).toContain('A RISK THAT CUTS A MONEY GOAL IS THAT MONEY');
    expect(sent).toContain('money the user wants MORE of');
    expect(sent).toContain('effect_amount -1, effect_per_source_change 1 and definitional true');
  });

  it('the shape it asks for is admitted `definitional` into Paul\'s frameless £ goal (−£1 per £1, natural size exact)', async () => {
    let body: unknown = null;
    const call = (async () => ({ text: JSON.stringify(DRAFT) })) as unknown as CallStructuredModel;
    const dispatch: InternalDispatch = async (path, b) => {
      if (path.endsWith('/graph/register')) { body = structuredClone((b as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
    };
    const out = await buildModelFromBrief('a4b1a4b1-0000-4a4b-8a4b-a4b1a4b1a4b1', PAUL, dispatch, call) as Rec;
    expect(out.ok, JSON.stringify(out).slice(0, 300)).toBe(true);
    const g = GraphV3.parse(body) as unknown as Rec;
    const goal = g.nodes.find((n: Rec) => n.kind === 'goal');
    const risk = g.edges.find((e: Rec) => e.from === 'funding_lost_to_fundraising_distraction' && e.to === goal.id);
    expect(risk.provenance.definitional).toBe(true);
    expect(risk.provenance.natural_effect.amount).toBe(-1);
    expect(Math.abs(risk.strength.mean)).toBeLessThanOrEqual(1);
  });
});
