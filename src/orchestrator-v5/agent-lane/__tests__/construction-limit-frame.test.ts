/**
 * ⛔ A LIMIT THE USER STATED WAS ATTACHED, THEN NEVER CHECKED: IT CARRIED NO FRAME.
 *
 * ISL refuses to evaluate a limit whose `value_frame` is absent (`frame_not_stamped` → CONSTRAINT_FRAME_UNSPECIFIED),
 * so CEE's feasibility verdict is `unevaluated` and the leader is withheld. The agent-lane drafter had no way to say
 * whether "keep total first-year cost under £250k" limits the value itself (`level`) or a change from today
 * (`delta`), and admission stamped nothing. Measured offline (programme-docs `evidence/ai-quality-20260925`,
 * cap-attach/): 0/20 caps scored before framing.
 *
 * So the drafter now states each limit's frame from the user's words, admission copies it to
 * `goal_constraints[].value_frame` (`GoalConstraintSchema`, `src/schemas/assist.ts`), and a limit the drafter did not
 * frame stays unframed: the frame is never guessed here.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const SCENARIO = '77777777-7777-4777-8777-777777777777';
const BRIEF = 'We need to decide whether to build our own billing system or buy one. We must keep total first-year cost under £250k.';

const factor = (label: string) => ({
  label, role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance: 'inferred', plausible_max: 100,
});
const link = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'inferred' });
function candidate(frame?: unknown) {
  return {
    goal: { metric: 'Billing capability', operator: '>', target_stated: false, value: null, unit: null, horizon_months: 12, provenance: 'inferred' },
    constraints: [{ metric: 'Total first-year cost', operator: '<', value: 250000, unit: 'GBP', provenance: 'explicit', ...(frame === undefined ? {} : { frame }) }],
    options: [
      { label: 'Build in-house', provenance: 'explicit', changes: ['Engineering spend'], interventions: [], is_status_quo: false },
      { label: 'Buy a platform', provenance: 'explicit', changes: ['Platform fees'], interventions: [], is_status_quo: false },
    ],
    factors: [factor('Engineering spend'), factor('Platform fees')],
    risks: [],
    outcomes: [{ label: 'Total first-year cost', provenance: 'inferred' }],
    links: [
      link('Engineering spend', 'Total first-year cost'), link('Platform fees', 'Total first-year cost'),
      link('Engineering spend', 'Billing capability'), link('Platform fees', 'Billing capability'),
    ],
    unknowns: [],
  };
}
type Registered = { goal_constraints?: Record<string, unknown>[] } | null;
function run(payload: unknown) {
  let registered: Registered = null;
  const reqs: { instructions: string }[] = [];
  const fn = vi.fn(async (req: { instructions: string; input: string }) => {
    reqs.push(req); return { text: JSON.stringify(payload) };
  }) as unknown as CallStructuredModel;
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { registered = (body as { graph: Registered }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
    return { status: 200, json: { versions: [] } };
  }) as unknown as InternalDispatch;
  return buildModelFromBrief(SCENARIO, BRIEF, dispatch, fn).then((r) => ({ r: r as Record<string, unknown>, reqs, registered: registered as Registered }));
}

describe('every limit the drafter writes carries the frame the user stated', () => {
  it('the drafter schema REQUIRES a frame on every limit, level or delta only', () => {
    const items = (buildCandidateSchema() as { properties: { constraints: { items: { properties: Record<string, { enum?: string[] }>; required: string[] } } } })
      .properties.constraints.items;
    expect(items.properties['frame']?.enum).toEqual(['level', 'delta']);
    expect(items.required).toContain('frame');
  });

  it('the drafter is told how to read the frame, and to give a limited factor its current level', async () => {
    const { reqs } = await run(candidate('level'));
    expect(reqs[0]!.instructions).toMatch(/State the `frame` of each limit: "level" when the user limits the value itself/);
    expect(reqs[0]!.instructions).toMatch(/"delta" only when they limit a CHANGE from today/);
    expect(reqs[0]!.instructions).toMatch(/Give a limited factor a `baseline_value` at its CURRENT level/);
  });

  it.each(['level', 'delta'] as const)('WIRE: a limit framed "%s" reaches /graph/register with that value_frame', async (frame) => {
    const { r, registered } = await run(candidate(frame));
    expect(r.goal_constraints_carried, 'PRECONDITION: the limit attached').toBe(1);
    expect(registered?.goal_constraints?.[0]?.['value_frame']).toBe(frame);
  });

  it('NEVER GUESSED: a limit the drafter did not frame is registered with no value_frame key', async () => {
    const { r, registered } = await run(candidate());
    expect(r.goal_constraints_carried, 'PRECONDITION: the limit attached').toBe(1);
    expect(registered?.goal_constraints?.[0]).toBeDefined();
    expect(Object.keys(registered!.goal_constraints![0]!)).not.toContain('value_frame');
  });

  it('NEVER GUESSED: a frame outside the contract ("absolute") is not stamped', async () => {
    const { r, registered } = await run(candidate('absolute'));
    expect(r.goal_constraints_carried, 'PRECONDITION: the limit attached').toBe(1);
    expect(Object.keys(registered!.goal_constraints![0]!)).not.toContain('value_frame');
  });
});
