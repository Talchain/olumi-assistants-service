/**
 * ⛔ A LIMIT THE USER STATED IS NEVER DROPPED UNSEEN.
 *
 * Measured offline on the shipped `buildModelFromBrief` (served 9417228), gpt-5.6-terra, the
 * recruitment-firm brief ("I don't want to be under 15% net margin whatever we do"): 1 of 15 builds
 * drafted the margin as a RISK ("Net-margin breach") with no "Net margin" node. `admit-constraint.ts`
 * then correctly WITHHOLDS the limit rather than attach it to a guessed target — but the build still
 * succeeded, registered a model with NO `goal_constraints`, and said nothing: `not_represented` passes
 * only horizon / goal_operator / mechanism_missing / status_quo_held losses, and a count
 * (`goal_constraints_carried: 0`) is not something the Agent can turn into a sentence.
 *
 * The CONTROL (the same brief drafted with a "Net margin" outcome, 14 of 15 live builds) attaches the
 * limit and must say nothing extra.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const SCENARIO = '44444444-4444-4444-8444-444444444444';
const BRIEF = "We're a specialist recruitment firm. The board wants to get back to growth. I think we should specialise in life sciences; my sales director wants to push contract harder. I don't want to be under 15% net margin whatever we do.";

const factor = (label: string, provenance = 'inferred') => ({
  label, role: 'controllable', baseline_known: false, baseline_value: null, unit: null, provenance, plausible_max: 100,
});
const link = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'inferred' });

type Bound = { metric: string; operator: string; value: number; unit?: string; provenance: string };
/** `marginAs`: 'outcome' = the limit's metric is a node (control); 'risk' = drafted as a breach risk (draw 8). */
function candidate(marginAs: 'outcome' | 'risk', constraintProvenance = 'explicit', bounds?: Bound[]) {
  const margin = marginAs === 'outcome' ? 'Net margin' : 'Net-margin breach';
  return {
    goal: { metric: 'Revenue growth', operator: '>', target_stated: false, value: null, unit: '%', horizon_months: null, provenance: 'explicit' },
    constraints: bounds ?? [{ metric: 'Net margin', operator: '>=', value: 15, unit: '%', provenance: constraintProvenance }],
    options: [
      { label: 'Life sciences specialism', provenance: 'explicit', changes: ['Life sciences focus'], interventions: [], is_status_quo: false },
      { label: 'Contract rate push', provenance: 'explicit', changes: ['Contract bill rate'], interventions: [], is_status_quo: false },
    ],
    factors: [factor('Life sciences focus'), factor('Contract bill rate')],
    risks: marginAs === 'risk' ? [{ label: margin, provenance: 'explicit' }] : [],
    outcomes: marginAs === 'outcome' ? [{ label: margin, provenance: 'explicit' }] : [],
    links: [
      link('Life sciences focus', 'Revenue growth'), link('Contract bill rate', 'Revenue growth'),
      link('Life sciences focus', margin), link('Contract bill rate', margin),
    ],
    unknowns: [],
  };
}

function run(c: unknown) {
  let registered: { goal_constraints?: unknown[] } | null = null;
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { registered = (body as { graph: typeof registered }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
    return { status: 200, json: { versions: [] } };
  }) as unknown as InternalDispatch;
  const call = vi.fn(async () => ({ text: JSON.stringify(c) })) as unknown as CallStructuredModel;
  return buildModelFromBrief(SCENARIO, BRIEF, dispatch, call).then((r) => ({ r: r as Record<string, unknown>, registered: registered as { goal_constraints?: unknown[] } | null }));
}
const said = (r: Record<string, unknown>) => ((r.not_represented as string[] | undefined) ?? []).filter((s) => /Net margin/.test(s) && /15/.test(s));

describe('a stated limit that cannot be attached is said, naming the limit', () => {
  it('CONTROL: the limit attaches to a "Net margin" node, and nothing extra is said', async () => {
    const { r, registered } = await run(candidate('outcome'));
    expect(r.ok).toBe(true);
    expect(r.goal_constraints_carried, 'PRECONDITION: attached').toBe(1);
    expect(registered?.goal_constraints?.length).toBe(1);
    expect(said(r)).toEqual([]);
  });

  it('DRAW-8 SHAPE: the margin drafted as a risk — the limit is withheld AND the Agent is told which limit, in words', async () => {
    const { r, registered } = await run(candidate('risk'));
    expect(r.ok, 'the build still succeeds: a withheld limit is not a failed build').toBe(true);
    expect(r.goal_constraints_carried, 'PRECONDITION: the limit did not attach').toBe(0);
    expect(registered?.goal_constraints ?? [], 'PRECONDITION: nothing guessed onto another node').toEqual([]);
    const lines = said(r);
    expect(lines, 'exactly one sentence names the unattached limit').toHaveLength(1);
    expect(lines[0]).toContain('Your limit');
    expect(lines[0]).toContain('Net margin of at least 15%');
    expect(lines[0], 'words, never a symbol, in text the user reads').not.toMatch(/[<>]=?/);
    expect(lines[0]).toMatch(/cannot check it/);
  });

  // Both ORDERS, mixed provenance, and two user bounds (review 5828856904 / pre-review 5828829492): a first-match
  // lookup repeats the first bound and hides the second, with the wrong author.
  const lower = { metric: 'Net margin', operator: '>=', value: 15, unit: '%' };
  const upper = { metric: 'Net margin', operator: '<=', value: 40, unit: '%' };
  const margin = (r: Record<string, unknown>) => ((r.not_represented as string[]) ?? []).filter((s) => /Net margin/.test(s));
  it.each([
    ['user lower first, Olumi upper second', [{ ...lower, provenance: 'explicit' }, { ...upper, provenance: 'ai_proposed' }],
      ['Your limit "Net margin of at least 15%"', 'The limit Olumi proposed ("Net margin of at most 40%")']],
    ['Olumi lower first, user upper second', [{ ...lower, provenance: 'ai_proposed' }, { ...upper, provenance: 'explicit' }],
      ['The limit Olumi proposed ("Net margin of at least 15%")', 'Your limit "Net margin of at most 40%"']],
    ['two user bounds', [{ ...lower, provenance: 'explicit' }, { ...upper, provenance: 'explicit' }],
      ['Your limit "Net margin of at least 15%"', 'Your limit "Net margin of at most 40%"']],
  ])('TWO bounds on one unattached metric (%s): each said once, with its own bound and its own author', async (_name, bounds, want) => {
    const { r } = await run(candidate('risk', 'explicit', bounds as Bound[]));
    expect(r.goal_constraints_carried, 'PRECONDITION: both withheld').toBe(0);
    const lines = margin(r);
    expect(lines, 'one sentence per bound, none repeated').toHaveLength(2);
    for (const w of want) expect(lines.filter((s) => s.startsWith(w)), w).toHaveLength(1);
  });

  it('the SAME bound drafted twice is said once', async () => {
    const b = { metric: 'Net margin', operator: '>=', value: 15, unit: '%', provenance: 'explicit' };
    const { r } = await run(candidate('risk', 'explicit', [b, { ...b }]));
    expect(((r.not_represented as string[]) ?? []).filter((s) => /Net margin/.test(s))).toHaveLength(1);
  });

  it('a limit Olumi proposed (not the user) is said as Olumi\'s, never as "your limit"', async () => {
    const { r } = await run(candidate('risk', 'ai_proposed'));
    const lines = said(r);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('Your limit');
    expect(lines[0]).toContain('Olumi proposed');
  });
});
