/**
 * ⭐ A CHIP MUST NOT OFFER AN ACTION THAT CAN ONLY END IN REFUSAL — the
 * `system_dispatched` (`draft_graph`) limb.
 *
 * Sibling of `unsupported-action-draft-capability-honesty.test.ts` (#1098),
 * which made this branch's SENTENCE honest. The same branch's CHIP stayed
 * dishonest, one level down.
 *
 * ── THE DEFECT (derived at `ba92130e`) ────────────────────────────────────
 * `buildChips()` returned `curatedHandlerChips(context.handlerRegistry)` for
 * EVERY category, and `USER_FACING_HANDLERS` is `['run_analysis']` — so the
 * only chip this composer could emit was **Run analysis**. The
 * `system_dispatched` copy says:
 *
 *   "I can build a model from your decision brief. I couldn't read that
 *    message as a brief, though. Tell me the decision you're weighing …
 *    and I'll draft it."
 *
 * and handed the user a **Run analysis** button. For a user with no model
 * that button can only terminate in a refusal: there is nothing to analyse.
 *
 * ── WHY NOT A "BUILD THE MODEL" CHIP INSTEAD ──────────────────────────────
 * Because it would be a second dead end. Drafting is reachable from a chip
 * ONLY through the draft-offer pending-action resume (`resolveDraftOfferResume`,
 * `trigger: 'copy_replay'`), which requires a COMMITTED `draft_graph` pending
 * carrying a brief seed. This composer returns a response object; it commits
 * no pending, and by construction it has no usable brief seed (the message
 * failed to read as a brief — that is why we are here). Absent that pending,
 * a chip falls through to the draft HEURISTIC, whose `draftShapedTurn`
 * conjunction excludes `ingress.source !== 'chip_click'` outright
 * (route-v2.ts). Either way the chip cannot draft. The invariant below is
 * therefore written against the SPEC — *no chip may promise what the click
 * cannot deliver* — not against the one string that was wrong.
 *
 * ── BOTH DIRECTIONS ───────────────────────────────────────────────────────
 * The same composer path is reachable on a continuation that DOES hold a
 * model, and this composer deliberately has no view of model state
 * (`buildText` constraint 3). The fix must not trade a false affordance for
 * a dead end: the with-model direction is pinned below to a live next step,
 * and the three OTHER categories keep their genuine `run_analysis` chip.
 */
import { describe, it, expect } from 'vitest';

import { composeUnsupportedActionResponse } from '../unsupported-action-response.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import { isDraftShapedText } from '../../../schemas/assist.js';
import type { SuggestedAction } from '../types.js';

function compose(handlerId: string, hasAnalysis = false) {
  return composeUnsupportedActionResponse({
    handlerId,
    context: { handlerRegistry: HANDLER_VALIDATION_REGISTRY },
    stage: 'frame',
    hasAnalysis,
  });
}

/** A chip that fires a handler carries `action_type`; a text prompt does not. */
function handlerChips(chips: readonly SuggestedAction[]): readonly SuggestedAction[] {
  return chips.filter((c) => c.action_type != null);
}

describe('draft_graph refusal — the CHIP must not offer an action that can only refuse', () => {
  it('⭐ THE FALSE AFFORDANCE — the draft refusal offers NO handler-invoking chip', () => {
    const { response, category } = compose('draft_graph');
    // Precondition pinned in-test (trap 13b): this really is the branch under
    // test, and the registry really does hold the handler that was being
    // offered — so a GREEN here cannot come from a hollow fixture.
    expect(category).toBe('system_dispatched');
    expect(HANDLER_VALIDATION_REGISTRY['run_analysis']).toBeDefined();

    expect(handlerChips(response.suggested_actions)).toHaveLength(0);
  });

  it('⭐ bound BY IDENTITY — no chip whose action_type is run_analysis', () => {
    const { response } = compose('draft_graph');
    expect(response.suggested_actions.map((c) => c.action_type)).not.toContain('run_analysis');
    expect(response.suggested_actions.map((c) => c.label)).not.toContain('Run analysis');
  });

  it('⭐ the chip that IS offered cannot need the draft dispatch', () => {
    // A chip click can never reach the draft heuristic (`source !==
    // 'chip_click'` is a conjunct of `draftShapedTurn`), so a chip carrying
    // draft-shaped text would be the same dead end wearing new copy.
    const { response } = compose('draft_graph');
    const [chip] = response.suggested_actions;
    expect(chip).toBeDefined();
    // Positive control for the probe itself: the classifier must be able to
    // SEE a presence, or this assertion is vacuous (trap 13).
    expect(
      isDraftShapedText(
        'Should we hire a tech lead or two developers to ship the platform next quarter?',
      ),
    ).toBe(true);
    expect(isDraftShapedText(chip!.message)).toBe(false);
  });

  it('⭐ BOTH DIRECTIONS — a continuation that HOLDS a model still gets a live next step', () => {
    // `hasAnalysis: true` is a one-way witness of model presence: an analysis
    // envelope cannot exist without a graph. This is the continuation case
    // the composer's own constraint 3 names, and it must not become a dead
    // end — it keeps a real, clickable next step.
    const withModel = compose('draft_graph', true);
    const withoutModel = compose('draft_graph', false);

    expect(withModel.response.suggested_actions.length).toBeGreaterThan(0);
    const [chip] = withModel.response.suggested_actions;
    expect(chip!.label.trim().length).toBeGreaterThan(0);
    expect(chip!.message.trim().length).toBeGreaterThan(0);
    // Neither direction is worse off than the other, and neither is handed a
    // handler the click cannot honour.
    expect(handlerChips(withModel.response.suggested_actions)).toHaveLength(0);
    expect(withModel.response.suggested_actions).toEqual(
      withoutModel.response.suggested_actions,
    );
    // And the copy still makes NO claim about model state (the #1098 rule).
    expect(withModel.response.assistant_text.toLowerCase()).not.toContain('no model');
  });

  it('⭐ the chip agrees with the sentence beside it (it does not say "ask something else")', () => {
    // The witnessed copy asks the user to describe their decision. A chip
    // labelled "Ask a different question" beside it is a second contradiction,
    // not a fix.
    const { response } = compose('draft_graph');
    const [chip] = response.suggested_actions;
    expect(chip!.label.toLowerCase()).not.toContain('different question');
    expect(chip!.message.toLowerCase()).not.toContain('different approach');
  });

  it('⭐ compose-layer contract preserved — at least one chip (#1098 pin)', () => {
    const { response } = compose('draft_graph');
    expect(response.suggested_actions.length).toBeGreaterThan(0);
  });

  describe('⭐ OPPOSITE-DIRECTION TWINS — a GENUINE handler affordance must not be deleted', () => {
    // The fix removes a chip that could only refuse. It must not remove the
    // chip on the three categories where `run_analysis` is a real next step
    // (the user has a model there by construction — they were editing it).
    for (const [handlerId, expectedCategory] of [
      ['add_option', 'structural'],
      ['set_factor_value', 'value_change'],
      ['explain_result', 'analysis_dep'],
    ] as const) {
      it(`${expectedCategory} (${handlerId}) keeps its Run analysis chip`, () => {
        const { response, category } = compose(handlerId);
        expect(category).toBe(expectedCategory);
        expect(response.suggested_actions).toHaveLength(1);
        expect(response.suggested_actions[0]!.action_type).toBe('run_analysis');
        expect(response.suggested_actions[0]!.label).toBe('Run analysis');
      });
    }

    it('generic (export_to_pdf) keeps its Run analysis chip', () => {
      const { response, category } = compose('export_to_pdf');
      expect(category).toBe('generic');
      expect(response.suggested_actions[0]!.action_type).toBe('run_analysis');
    });
  });

  it('⭐ an EMPTY registry still yields a text-prompt chip on the draft path', () => {
    // The suppression must not depend on the registry the executor threads in
    // (trap 18's cousin): with nothing curated to offer, the path still ends
    // in exactly one text-prompt chip, not zero.
    const { response } = composeUnsupportedActionResponse({
      handlerId: 'draft_graph',
      context: { handlerRegistry: {} },
      stage: 'frame',
      hasAnalysis: false,
    });
    expect(response.suggested_actions).toHaveLength(1);
    expect(response.suggested_actions[0]!.action_type).toBeUndefined();
  });
});
