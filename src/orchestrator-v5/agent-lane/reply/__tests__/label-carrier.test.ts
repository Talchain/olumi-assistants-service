/**
 * S-A label rule at the goal warning's 400-character carrier (lane COPY-SHAPE; Codex buddy r1 P1 + r2 P1 on #2748).
 * The warning must (a) keep the withheld reason, (b) stay within its carrier, (c) never cut a label mid-word, and (d) carry
 * `first_ask.question` exactly as the question it says, so the current-level ask binds by identity.
 */
import { describe, it, expect } from 'vitest';
import { placeholderGoalWarning } from '../../goal-certainty.js';

const LONG = 'Likelihood of completing all planned enterprise onboarding and implementation work before the next feature-launch deadline while maintaining current support quality and existing customer commitments';
const graphWith = (unit: string) => ({
  goal_node_id: 'goal',
  nodes: [
    { id: 'capacity', kind: 'factor', label: 'Capacity', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'people' } },
    { id: 'goal', kind: 'goal', label: LONG, goal_threshold_unit: unit },
  ],
  edges: [{ from: 'capacity', to: 'goal' }],
});

describe('the goal warning keeps its reason and its question’s identity inside the 400 carrier', () => {
  it.each([
    // S-E GOALS (#2742): a unit naming a chance ("probability of launch …", Codex's r2 unit) is now a chance goal, which
    // asks no level at all; the carrier row keeps a long unit of the same length that measures a level.
    ['a long unit (the question alone is ~308 characters)', 'hours of onboarding per enterprise account (hours)'],
    // P17 (#2780): with a bare '%' unit this label ("Likelihood of completing … before the next feature-launch deadline")
    // is a one-off chance under Science ruling (b), so it asks no level; the short-unit control uses a level unit instead.
    ['CONTROL: a short unit', 'hours'],
  ])('%s', (_what, unit) => {
    const g = graphWith(unit);
    const w = placeholderGoalWarning(g, [{ option_id: 'hire', links: g.edges }] as never, 'GOAL_FIGURES_PLACEHOLDER_PATH');
    expect(w.message, 'the reason is said').toContain("isn't sized in the model yet");
    expect(w.message.length).toBeLessThanOrEqual(400);
    const q = (w.first_ask as { question?: string } | undefined)?.question;
    expect(q, 'the first ask is a question').toBeDefined();
    expect(w.message, 'the question said is the question bound').toContain(q!);
    // Never mid-word: any shortened label ends at a whole word of the original.
    for (const m of w.message.matchAll(/‘([^’]*)…’/g)) expect(LONG.startsWith(m[1]!.trimEnd()) && /\s|^$/.test(LONG.charAt(m[1]!.trimEnd().length) || ' ')).toBe(true);
  });
});
