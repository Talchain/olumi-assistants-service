/**
 * ⭐⭐ A STATED LIMIT THE PRODUCT DID NOT ENFORCE LEADS THE FIRST RESPONSE.
 *
 * Measured on the fresh pricing draft, native request
 * `3d5ce286-9804-4a59-ad4e-d6921d31141f` (9 Sep 2026, CEE `a03ead1a`,
 * `output/playwright/olumi-pricing-20260909-0348/`): the first thing the person
 * read was "I've built a first model", then an option inventory, and only then
 * anything about the limit they had stated. Their brief said "keeping monthly
 * churn under 4%"; the server captured ZERO constraints for it.
 *
 * ⚠ WHAT THIS IS NOT. The same turn recorded the model's coaching summary
 *   rejected `no_tradeoff_or_gap`, and the raw candidate was NOT captured — so
 *   nothing here claims a good answer was filtered, and the gate is untouched.
 *
 * ⛔ AND A CLAIM I MADE AND WITHDRAW: I wrote that a first draft can never use
 *    the model summary because `post-draft-narrative.ts:590` requires
 *    `analysisReady.status === 'ready'` and "analysis has not run yet". That is
 *    FALSE. `analysisReady` means ready TO ANALYSE, not already analysed, so a
 *    first draft CAN be `ready` and CAN ship an accepted summary — `:548-635`
 *    permits exactly that. What was true of THIS turn is only true of this
 *    turn: its joined `analysis_ready.built` was `needs_user_input` with ONE
 *    blocker (all three readyOptions) at 03:48:34.446, and the copy gate
 *    separately rejected. A property of one capture is not a property of the
 *    path, and the READY first-draft case below is the control that keeps me
 *    honest about it.
 *
 * ⚠ AND NOTHING IS INVENTED. The promoted text is the existing
 *   `pickDirectionClarifications` line — the carrier the weighing section's own
 *   comment already ranks above a coaching suggestion — MOVED, not duplicated,
 *   and not restated. An unbound constraint stays honestly unbound.
 *
 * Not run locally; hosted CI is the only execution.
 */
import { describe, expect, it } from 'vitest';

import { buildPostDraftNarrative } from '../post-draft-narrative.js';

const GOAL = {
  id: 'g1',
  kind: 'goal',
  provenance: 'from_brief',
  label: 'Reach £20k MRR within 12 months',
};
const OPTION_A = { id: 'o1', kind: 'option', label: 'Raise Pro to £59' };
const OPTION_B = { id: 'o2', kind: 'option', label: 'Hold at £49' };

const CLARIFICATION_DETAIL =
  'You said monthly churn should stay under 4%. The model has not captured that as a limit yet — which measure should it apply to?';

/**
 * ⚠ The id PREFIX is what marks a direction clarification —
 * `direction_unresolved_`, read from the producer
 * (`cee/compound-goal/direction-gate.ts`), not guessed. My first fixture used
 * `direction_clarification:` and would have been classified as an ordinary
 * strengthen item, so the positive control would have measured nothing.
 */
const DIRECTION_ITEM = {
  id: 'direction_unresolved_churn',
  label: 'Churn limit',
  detail: CLARIFICATION_DETAIL,
  action_type: 'add_constraint',
};

function narrative(strengthenItems: ReadonlyArray<unknown> | undefined): string {
  return buildPostDraftNarrative({
    graph: { nodes: [GOAL, OPTION_A, OPTION_B], edges: [] },
    analysisReady: { status: 'not_ready' },
    ...(strengthenItems === undefined ? {} : { strengthenItems }),
  } as never).text;
}

describe('the first response leads with the stated limit, not the inventory', () => {
  it('the clarification precedes the change inventory', () => {
    const text = narrative([DIRECTION_ITEM]);
    const lead = text.indexOf('monthly churn');
    const inventory = text.indexOf('Options compared');
    expect(lead).toBeGreaterThan(-1);
    expect(inventory).toBeGreaterThan(-1);
    expect(lead).toBeLessThan(inventory);
  });

  it('it is MOVED, not duplicated — the person reads it once', () => {
    const text = narrative([DIRECTION_ITEM]);
    expect(text.split('monthly churn')).toHaveLength(2);
  });

  it('NEGATIVE — with no direction clarification the assembly is unchanged', () => {
    // The served #1395 shape: confirm, then inventory, then weighing. If this
    // moved, every ordinary first draft would have moved with it.
    const text = narrative(undefined);
    const confirm = text.indexOf("I've built a first");
    const inventory = text.indexOf('Options compared');
    const weighing = text.indexOf('What the model is weighing');
    expect(confirm).toBe(0);
    expect(inventory).toBeGreaterThan(confirm);
    expect(weighing).toBeGreaterThan(inventory);
  });

  it('⭐ READY FIRST DRAFT + accepted summary still ships the model summary, untouched by this change', () => {
    // The control the withdrawn claim would have made unthinkable. A first draft
    // CAN be ready, and when its summary passes the copy gate the shortcut at
    // `:590` ships it verbatim — the deterministic builder, and therefore this
    // promotion, never runs. If this ever starts returning the sectioned
    // narrative, the change has widened to all first responses, which is exactly
    // what it must not do.
    const accepted =
      'This decision comes down to one trade-off: raising the price protects margin while risking churn, and the churn limit is the constraint to weigh. Next, set that limit so the model can test it.';
    const text = buildPostDraftNarrative({
      graph: { nodes: [GOAL, OPTION_A, OPTION_B], edges: [] },
      analysisReady: { status: 'ready' },
      coachingSummary: accepted,
      strengthenItems: [DIRECTION_ITEM],
    } as never).text;
    expect(text).toContain('one trade-off');
    expect(text).not.toContain('Options compared');
  });

  it('NEGATIVE — the unbound limit is raised as a question, never asserted as captured', () => {
    const text = narrative([DIRECTION_ITEM]);
    expect(text).toContain('has not captured that as a limit yet');
    expect(text).not.toContain('constraint has been applied');
  });
});
