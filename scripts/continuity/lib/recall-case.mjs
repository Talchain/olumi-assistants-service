/**
 * Factory for the RECALL family: cold-return, long-conversation, hot-window.
 *
 * WHY A FACTORY AND NOT THREE COPIES
 * ----------------------------------
 * These three cases differ only in what sits BETWEEN the fact and the probe:
 * a process boundary, ten intervening turns, or thirty. The mechanism under
 * test — does a fact stated earlier survive to be recalled — is identical, and
 * so is the shape of the control. Three hand-maintained copies would drift, and
 * the drift would be invisible because each would still pass (CLAUDE.md
 * trap 12: the hand-maintained mirror).
 *
 * THE CONTROL: ANTI-CONFABULATION, NOT ANTI-RECALL
 * ------------------------------------------------
 * The naive control for a recall test is "ask about something else". That is
 * weak: a product that simply echoes plausible-sounding content passes it.
 *
 * The control used here instead probes a fact that was NEVER STATED, phrased
 * exactly like the real one. The required outcome is a REFUSAL. This inverts
 * the failure mode: the arm catches a product that forgets, and the control
 * catches a product that remembers things that never happened — which is the
 * strictly more dangerous defect and the one a recall-only test rewards. A
 * model that confabulates fluently would score 100% on arms alone.
 *
 * Together they bound the behaviour from both sides. Neither half is
 * sufficient, and this estate has repeatedly shipped the half that flatters.
 */

import { check } from '../lib/verdict.mjs';
import { mentions } from '../lib/wire.mjs';
import { draft } from '../lib/scenarios.mjs';

/**
 * @param {object} cfg
 * @param {string} cfg.id
 * @param {string} cfg.brief          brief used to open the scenario
 * @param {string} cfg.fact           the distinctive fact stated in the arm
 * @param {string} cfg.factToken      a token that MUST appear in a correct recall
 * @param {string} cfg.probe          the recall question
 * @param {string} cfg.fabricatedProbe  same shape, about a fact never stated
 * @param {string[]} cfg.fabricatedTokens tokens that must NOT be affirmed
 * @param {number} cfg.fillerTurns    intervening turns before the probe
 * @param {string} cfg.stateClass
 */
export function makeRecallCase(cfg) {
  return {
    id: cfg.id,
    seam: cfg.seam || 'A',
    stateClass: cfg.stateClass || 'fresh',
    title: cfg.title,
    expectedAt: cfg.expectedAt || {},

    async setup(ctx) {
      const [arm, control] = await Promise.all([
        draft(ctx.client, cfg.brief, `${cfg.id}-ARM-draft`),
        draft(ctx.client, cfg.brief, `${cfg.id}-CTL-draft`),
      ]);

      // ARM ONLY: state the distinctive fact. The control scenario is
      // deliberately never told it — that asymmetry is the experiment.
      const stated = await ctx.client.turn({
        scenarioId: arm.scenarioId,
        message: cfg.fact,
        label: `${cfg.id}-ARM-state-fact`,
      });

      return {
        arm: { scenarioId: arm.scenarioId, draft: arm.response, stated },
        control: { scenarioId: control.scenarioId, draft: control.response },
      };
    },

    precondition(s) {
      return [
        check('arm draft HTTP 200', s.arm.draft.ok, `status=${s.arm.draft.status}`),
        check('control draft HTTP 200', s.control.draft.ok, `status=${s.control.draft.status}`),
        check(
          'the fact-stating turn was accepted',
          s.arm.stated.ok,
          `status=${s.arm.stated.status} — if this turn failed, a later non-recall proves nothing about memory`,
        ),
        check(
          'the fact token is a distinctive string',
          cfg.factToken.length >= 3,
          `token="${cfg.factToken}" — a short/common token could be satisfied by unrelated prose`,
        ),
        check(
          'arm and control are DIFFERENT scenarios',
          s.arm.scenarioId !== s.control.scenarioId,
          'shared state would let the control inherit the arm\'s fact',
        ),
      ];
    },

    /** Fill the window, then probe for the fact that WAS stated. */
    async arm(ctx, s) {
      for (let i = 0; i < (cfg.fillerTurns || 0); i += 1) {
        await ctx.client.turn({
          scenarioId: s.arm.scenarioId,
          message: `Noting point ${i + 1}: please continue building the picture.`,
          label: `${cfg.id}-ARM-filler-${i + 1}`,
        });
      }
      return ctx.client.turn({
        scenarioId: s.arm.scenarioId,
        message: cfg.probe,
        label: `${cfg.id}-ARM-probe`,
      });
    },

    /**
     * Same filler depth, same probe SHAPE, but about a fact never stated.
     * Equal depth matters: a control with a shorter history would differ from
     * the arm in two variables at once and could not localise anything.
     */
    async control(ctx, s) {
      for (let i = 0; i < (cfg.fillerTurns || 0); i += 1) {
        await ctx.client.turn({
          scenarioId: s.control.scenarioId,
          message: `Noting point ${i + 1}: please continue building the picture.`,
          label: `${cfg.id}-CTL-filler-${i + 1}`,
        });
      }
      return ctx.client.turn({
        scenarioId: s.control.scenarioId,
        message: cfg.fabricatedProbe,
        label: `${cfg.id}-CTL-fabricated-probe`,
      });
    },

    assertArm(resp) {
      const t = resp.text;
      return [
        check('arm returned prose', Boolean(t && t.trim().length > 10), `len=${t ? t.length : 0}`),
        check(
          'recalls the stated fact',
          mentions(t, cfg.factToken),
          `expected "${cfg.factToken}" — stated ${cfg.fillerTurns} filler turn(s) earlier`,
        ),
      ];
    },

    assertControl(resp) {
      const t = resp.text;
      const affirmed = (cfg.fabricatedTokens || []).filter((tok) => mentions(t, tok));
      return [
        check('control returned prose', Boolean(t && t.trim().length > 10), `len=${t ? t.length : 0}`),
        check(
          'does NOT affirm a fact that was never stated',
          affirmed.length === 0,
          affirmed.length
            ? `confabulated ${JSON.stringify(affirmed)} — the product remembered something that never happened`
            : 'no fabricated token affirmed, as required',
        ),
      ];
    },
  };
}
