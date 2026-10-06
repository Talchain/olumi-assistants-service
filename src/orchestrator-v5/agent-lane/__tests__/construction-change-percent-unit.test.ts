/**
 * ⛔ A2 — CONSTRUCTION NEVER WRITES THE CHANGE'S "%" AS THE METRIC'S UNIT (DL 0df0e1 founder trace Q1; Paul's scenario
 * 58bd5e71, built on served CEE ccff2601 at 09:39Z on 6 Oct 2026).
 *
 * Served: the brief below was drafted as productivity `change_rel` +10 with unit "%", and `admitStatedGoalChange` copied
 * that "%" into `goal_threshold_unit` (against its own contract: the unit is the METRIC's, the unit of its current
 * level). Stored at 11:28:27Z: `productivity`, `change_rel`, raw 0.1, unit "%", no cap, no observed_state. The first
 * reply then asked "What is it, in %?", and every later door refused Paul's sprint level as "not in %".
 *
 * Rows: the real brief through the real build path (`buildModelFromBrief`, the drafter stubbed with the served shape) →
 * the registered goal. CONTRAST: "grow MRR by 10%" keeps its £ unit. CONTROL: a metric the user measures in % (today's
 * level written as "3%") keeps "%".
 */
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { placeholderAskWords } from '../goal-certainty.js';

const SCENARIO = '58bd5e71-0000-4000-8000-00000000a2a2';
/** Paul's brief, verbatim (v5_conversation_turns, 09:39:49Z). */
const BRIEF = "Should I hire a Tech lead or two developers to increase productivity by at least 10%, while maintaining code quality? We have an urgent launch date in the next three months. We currently have six mid-weight developers, so we're lacking leadership. Our budget is £200,000, but we'd like to spend less.";

const link = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'inferred' });
/** The served draft's goal shape: a +10% change typed with the change's own "%" as its unit, no level stated. */
function candidate(goal: Record<string, unknown> = {}, metric = 'productivity') {
  return {
    goal: {
      metric, operator: '>=', target_stated: true, value: 10, unit: '%', horizon_months: 3,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred', scope: null, frame: 'change_rel',
      ...goal,
    },
    constraints: [],
    options: [
      { label: 'Tech lead', provenance: 'explicit', changes: ['Tech lead hires'], interventions: [], is_status_quo: false },
      { label: 'Two developers', provenance: 'explicit', changes: ['Developer hires'], interventions: [], is_status_quo: false },
    ],
    factors: [
      { label: 'Tech lead hires', role: 'controllable', baseline_known: false, baseline_value: null, unit: 'hires', provenance: 'inferred', plausible_max: 5 },
      { label: 'Developer hires', role: 'controllable', baseline_known: false, baseline_value: null, unit: 'hires', provenance: 'inferred', plausible_max: 10 },
    ],
    risks: [],
    outcomes: [],
    links: [link('Tech lead hires', metric), link('Developer hires', metric)],
    unknowns: [],
  };
}
type Node = Record<string, unknown> & { id?: string; kind?: string };
type Registered = { nodes?: Node[]; edges?: { from: string; to: string }[] } | null;
async function build(payload: unknown, brief = BRIEF): Promise<Registered> {
  let registered: Registered = null;
  const fn = vi.fn(async () => ({ text: JSON.stringify(payload) })) as unknown as CallStructuredModel;
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { registered = (body as { graph: Registered }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
    return { status: 200, json: { versions: [] } };
  }) as unknown as InternalDispatch;
  await buildModelFromBrief(SCENARIO, brief, dispatch, fn);
  return registered;
}
const goalOf = (g: Registered): Node => (g?.nodes ?? []).find((n) => n.kind === 'goal') as Node;

describe('A2 — "increase productivity by at least 10%": the change\'s "%" is not productivity\'s unit', () => {
  it('RED (served 58bd5e71: unit "%"): change_rel +0.10 is admitted with NO metric unit, no cap and no level', async () => {
    const g = goalOf(await build(candidate()));
    expect(g, 'PRECONDITION: the change itself is written exactly as stated').toMatchObject({
      label: 'productivity', goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1,
    });
    expect(Object.keys(g)).not.toContain('goal_threshold_unit');
    expect(Object.keys(g)).not.toContain('goal_threshold_cap');
    expect(Object.keys(g)).not.toContain('observed_state');
  });

  it('the +10% stays the user\'s own target (held from the brief, with its comparator)', async () => {
    const g = goalOf(await build(candidate()));
    expect(g['threshold_source']).toBe('brief_extraction');
    expect(g['goal_direction']).toBe('>=');
  });

  it('RED (served reply "What is it, in %?"): the first ask for today\'s level of productivity names no "%"', async () => {
    const reg = await build(candidate());
    const g = goalOf(reg);
    const into = (reg?.edges ?? []).filter((e) => e.to === g.id).map((e) => ({ from: e.from, to: e.to }));
    expect(into.length, 'PRECONDITION: links into the goal').toBeGreaterThan(0);
    const said = placeholderAskWords(reg, into)?.message ?? '';
    expect(said, 'PRECONDITION: the goal\'s level is asked first').toContain('I first need today’s level of ‘productivity’');
    expect(said).toContain('What is it?');
    expect(said).not.toMatch(/in %|percent/i);
  });

  it('CONTRAST: "grow MRR by 10%" keeps the metric\'s own £ unit (a unit that is not the change\'s)', async () => {
    const brief = 'We want to grow MRR by 10% this year. Should we raise the Pro price or launch an annual plan?';
    const g = goalOf(await build(candidate({ unit: 'GBP per month', horizon_months: 12 }, 'MRR'), brief));
    expect(g).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1, goal_threshold_unit: 'GBP per month' });
  });

  // ⛔ AIE review on #87 (6016108422) (1): never strip a "%" that IS the metric's unit. Must-keep rows.
  it('MUST-KEEP: "cut churn rate by 10%" is a relative change of a % metric — the metric\'s unit stays "%"', async () => {
    const brief = 'We need to cut our churn rate by 10% this year. Should we add onboarding calls or an annual discount?';
    const g = goalOf(await build(candidate({ value: -10, operator: '<=', horizon_months: 12 }, 'churn rate'), brief));
    expect(g).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.1, goal_threshold_unit: '%' });
  });

  it('MUST-KEEP: "grow our win rate by 10%" — a rate is measured in %, so "%" stays its unit', async () => {
    const brief = 'We want to grow our win rate by 10%. Should we hire a sales engineer or cut the discount?';
    const g = goalOf(await build(candidate({}, 'Win rate'), brief));
    expect(g).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1, goal_threshold_unit: '%' });
  });

  it('MUST-KEEP: "increase conversion rate from 3% to 4%" — an absolute % level keeps "%" on its 0–100 scale', async () => {
    const brief = 'Increase our conversion rate from 3% to 4%. Should we redesign checkout or add reviews?';
    const g = goalOf(await build(candidate({ frame: 'level', value: 4, baseline_known: true, baseline_value: 3, baseline_provenance: 'explicit', horizon_months: 6 }, 'conversion rate'), brief));
    expect(g).toMatchObject({ goal_threshold_frame: 'level', goal_threshold_raw: 4, goal_threshold_unit: '%', goal_threshold_cap: 100 });
    expect(g['observed_state']).toMatchObject({ unit: '%', raw_value: 3, cap: 100 });
  });

  it('CONTROL: a metric the user measures in % (today\'s level written as "3%") keeps "%" as its own unit, on its 0–100 scale', async () => {
    const brief = 'Our conversion rate is 3% today and we want to increase it by 10%. Should we redesign checkout or add reviews?';
    const g = goalOf(await build(candidate({ baseline_known: true, baseline_value: 3, baseline_provenance: 'explicit', horizon_months: 6 }, 'conversion rate'), brief));
    expect(g).toMatchObject({ goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1, goal_threshold_unit: '%', goal_threshold_cap: 100 });
    expect(g['observed_state']).toMatchObject({ unit: '%', raw_value: 3, cap: 100, source: 'brief_extraction' });
  });
});
