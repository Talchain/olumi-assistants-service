/**
 * CASE: answer-grounded-to-version  —  SEAM A (canonical state, the half that works)
 *
 * THE PROPERTY
 * ------------
 * After the user edits the model, an answer about the model must describe the
 * model as it NOW is. An answer grounded to a superseded version is worse than
 * a refusal, because it is indistinguishable from a correct one.
 *
 * This PASSED in the 30 Aug batch. It is encoded because it is the case most
 * likely to regress silently: version-grounding failures produce fluent,
 * plausible, confidently wrong answers, and no user can detect one from the
 * outside.
 *
 * THE CONTROL
 * -----------
 * An identical scenario where NO edit is made, asked the identical question.
 * It must report no change and must not invent one. This catches the opposite
 * defect — a product that narrates a difference whenever it is asked about
 * one, which would pass an edit-only arm every time.
 *
 * ADJACENT FINDING CARRIED AS A DIAGNOSTIC
 * ----------------------------------------
 * The originating batch saw a designed confirmation hold emitted as
 * `{"type":"error","error_code":"INTERNAL_ERROR"}` while its own verdict field
 * read "held". A UI keying on `error_code` would render a normal safety hold
 * as a fault. Whether it does is a RENDER question this wire harness cannot
 * answer, so it is reported as an observation with its rung stated, not scored.
 */

import { check } from '../lib/verdict.mjs';
import { mentions } from '../lib/wire.mjs';
import { BRIEF_FULLY_SPECIFIED, draft, nodeLabels, nodeCount, optionLabels } from '../lib/scenarios.mjs';

const INVENTORY_PROBE = 'List the factors currently in the model.';
const NEW_FACTOR = 'Support Ticket Volume';

export default {
  id: 'answer-grounded-to-version',
  seam: 'A',
  stateClass: 'fresh',
  title: 'an answer about the model describes the model as it now is',
  expectedAt: { caceba1a: 'PASS in the 30 Aug batch — encoded as a regression net' },

  async setup(ctx) {
    const [arm, control] = await Promise.all([
      draft(ctx.client, BRIEF_FULLY_SPECIFIED, 'version-ARM-draft'),
      draft(ctx.client, BRIEF_FULLY_SPECIFIED, 'version-CTL-draft'),
    ]);

    // Baseline inventory BEFORE any edit, so "changed" is measured, not assumed.
    const armBefore = await ctx.client.turn({
      scenarioId: arm.scenarioId,
      message: INVENTORY_PROBE,
      label: 'version-ARM-inventory-before',
    });

    // ARM ONLY: add a factor whose name appears nowhere in the brief.
    const armEdit = await ctx.client.turn({
      scenarioId: arm.scenarioId,
      message: `Add a factor called ${NEW_FACTOR} that is affected by the price change.`,
      label: 'version-ARM-edit',
    });

    const ctlBefore = await ctx.client.turn({
      scenarioId: control.scenarioId,
      message: INVENTORY_PROBE,
      label: 'version-CTL-inventory-before',
    });

    return {
      arm: {
        scenarioId: arm.scenarioId,
        draft: arm.response,
        before: armBefore,
        edit: armEdit,
        baselineNodes: nodeLabels(arm.response.body),
        baselineCount: nodeCount(arm.response.body),
      },
      control: {
        scenarioId: control.scenarioId,
        draft: control.response,
        before: ctlBefore,
        baselineNodes: nodeLabels(control.response.body),
      },
    };
  },

  precondition(s) {
    const factorAbsentAtBaseline = !s.arm.baselineNodes.some((n) => mentions(n, NEW_FACTOR));
    return [
      check('arm draft HTTP 200', s.arm.draft.ok, `status=${s.arm.draft.status}`),
      check('control draft HTTP 200', s.control.draft.ok, `status=${s.control.draft.status}`),
      check('arm baseline inventory accepted', s.arm.before.ok, `status=${s.arm.before.status}`),
      check('arm edit turn accepted', s.arm.edit.ok, `status=${s.arm.edit.status}`),
      check(
        'the arm drafted a non-empty model',
        s.arm.baselineNodes.length > 0,
        `${s.arm.baselineNodes.length} node label(s)`,
      ),
      check(
        `"${NEW_FACTOR}" is ABSENT before the edit`,
        factorAbsentAtBaseline,
        factorAbsentAtBaseline
          ? 'the added factor is genuinely new, so naming it later can only come from the edit'
          : 'the factor already existed at baseline — the edit would prove nothing',
      ),
    ];
  },

  /** Re-ask after the edit. The new factor must appear. */
  async arm(ctx, s) {
    return ctx.client.turn({
      scenarioId: s.arm.scenarioId,
      message: INVENTORY_PROBE,
      label: 'version-ARM-inventory-after',
    });
  },

  /** Identical question, no edit. Must not invent the factor. */
  async control(ctx, s) {
    return ctx.client.turn({
      scenarioId: s.control.scenarioId,
      message: INVENTORY_PROBE,
      label: 'version-CTL-inventory-after',
    });
  },

  assertArm(resp, s) {
    const t = resp.text;
    return [
      check('arm returned prose', Boolean(t && t.trim().length > 10), `len=${t ? t.length : 0}`),
      check(
        'the post-edit answer includes the newly added factor',
        mentions(t, NEW_FACTOR),
        `expected "${NEW_FACTOR}" — added one turn earlier and absent at baseline`,
      ),
      check(
        'still describes the pre-existing model too',
        s.arm.baselineNodes.some((n) => n && n.length > 3 && mentions(t, n)),
        'an inventory that lost the original factors would be grounded to the wrong version in the other direction',
      ),
    ];
  },

  assertControl(resp, s) {
    const t = resp.text;
    return [
      check('control returned prose', Boolean(t && t.trim().length > 10), `len=${t ? t.length : 0}`),
      check(
        'does NOT name a factor that was never added here',
        !mentions(t, NEW_FACTOR),
        mentions(t, NEW_FACTOR)
          ? `CONFABULATION: named "${NEW_FACTOR}" in a scenario where it was never added`
          : 'the unedited scenario does not mention the arm\'s added factor',
      ),
    ];
  },

  async diagnostic(ctx, s) {
    // Observation only: does any turn in this case surface a hold as an error?
    const body = s.arm.edit.body || {};
    const blocks = Array.isArray(body.blocks) ? body.blocks : [];
    const errorShaped = blocks.filter((b) => b && (b.type === 'error' || b.error_code));
    return {
      name: 'confirmation hold emitted with an error shape (render-question, not scored)',
      ok: true,
      detail: errorShaped.length
        ? `observed ${errorShaped.length} error-shaped block(s): ${JSON.stringify(errorShaped.map((b) => b.error_code || b.type))} — ` +
          'RUNG: wire-witnessed. Whether the UI renders these as a fault is UNMEASURED and needs a browser journey.'
        : 'no error-shaped block observed on the edit turn in this run',
    };
  },
};
