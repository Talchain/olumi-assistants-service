/**
 * ⛔ AN INTERNAL CODE IS NEVER USER PROSE — even when a readiness message carries one.
 *
 * The readiness view is what the Agent narrates from (ChatGPT 5839692762: the typed code stays machine-readable
 * on the wire; users get the plain-English explanation). A message that is itself a code, or embeds one, is
 * dropped rather than passed on. The admission verdict is stubbed here ONLY to supply such a message: no
 * current producer emits one (Paul's stored graph carries none), so without a stub the guard is untested.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../cee/graph-readiness/canonical-readiness.js', () => ({
  assessRouteAdmission: () => ({
    may_run: false,
    readiness_issues: [
      { code: 'OPTION_NOT_LINKED_TO_DECISION', message: 'OPTION_NOT_LINKED_TO_DECISION', repairability: 'human_input_required', obligation: 'required' },
      { code: 'X', message: 'Blocked: MISSING_OPTION_VALUE on price', repairability: 'human_input_required', obligation: 'required' },
      { code: 'NO_GOAL', message: 'The model has no goal yet. Say what you want to achieve.', repairability: 'human_input_required', obligation: 'required' },
    ],
    scaffold_plan: { excluded_option_ids: [] },
  }),
}));

describe('readinessViewOf keeps codes out of what the Agent narrates', () => {
  it('drops a message that is, or embeds, a code; keeps the plain one', async () => {
    const { readinessViewOf, readinessSentence } = await import('../readiness-view.js');
    const view = readinessViewOf({ nodes: [], edges: [] });
    expect(view.needs_from_user.map((i) => i.message)).toEqual(['The model has no goal yet. Say what you want to achieve.']);
    expect(readinessSentence(view)).toBe("The analysis can't run yet. The model has no goal yet. Say what you want to achieve.");
  });
});
