/**
 * CASE: edit-rerun-consequence  —  SEAM A, and the instrument that settles §6(a)
 *
 * THE PROPERTY
 * ------------
 * After an edit and a re-run, the product must be able to say what changed
 * between the two runs.
 *
 * ⚠ THIS CASE DELIBERATELY DOES NOT ASSUME THE REPORTED DIAGNOSIS.
 *
 * The originating batch attributed the failure to a gate that threads run
 * facts only when the current turn itself completed a run. But the source at
 * the deployed tip contradicts that: the context pack is assembled with
 * `prior_facts` on EVERY turn, a `run_delta` is built whenever prior facts are
 * present, and there is an explicit prompt block instructing the model to
 * answer from `run_delta` or else say plainly that it cannot compare. On that
 * reading the pack SHOULD have carried the delta, and neither the delta nor
 * the absence rule fired. Which hop actually failed was never measured.
 *
 * So this case is built as a DISCRIMINATOR BETWEEN TWO HYPOTHESES rather than
 * as a regression test for an assumed one:
 *
 *   H1  the delta is present and the DEMONSTRATIVE was never resolved
 *       → this case collapses into `pronoun-identity`, Seam A, same fix
 *   H2  the delta never reached the pack
 *       → a genuinely separate assembly/threading defect
 *
 * The formal arm/control pair is demonstrative-FREE on both sides, so it
 * measures H2 cleanly. The anaphoric variant then runs as a diagnostic. If the
 * demonstrative-free probe answers and the anaphoric one does not, H1 is
 * settled and a lane should not be opened against the threading gate at all.
 *
 * ⚠ ALSO CORRECTED HERE: the original restatement control was not
 * demonstrative-free — both its probes contained the word "that", so a
 * byte-identical response was fully consistent with a pure pronoun failure and
 * the conclusion drawn from it was unsupported. The restatement below names
 * the factor, the option and both values explicitly, with no demonstrative at
 * all. That is the variable the control claimed to be varying.
 */

import { check } from '../lib/verdict.mjs';
import { mentions } from '../lib/wire.mjs';
import { BRIEF_FULLY_SPECIFIED, draft, runStateKind, optionLabels } from '../lib/scenarios.mjs';

const RUN = 'Run the analysis now.';

/** Demonstrative-free. This is the probe the prompt block actually governs. */
const DELTA_PROBE = 'What changed between the last two runs?';

/** Contains a demonstrative. Diagnostic only — settles H1 vs H2. */
const ANAPHORIC_PROBE = 'Why didn\'t that make a difference?';

export default {
  id: 'edit-rerun-consequence',
  seam: 'A',
  stateClass: 'fresh',
  title: 'after an edit and a re-run, the product can say what changed',
  expectedAt: {
    caceba1a:
      'COULD_NOT_MEASURE expected unless two runs complete; the failing hop was never established',
  },

  async setup(ctx) {
    const [arm, control] = await Promise.all([
      draft(ctx.client, BRIEF_FULLY_SPECIFIED, 'edit-rerun-ARM-draft'),
      draft(ctx.client, BRIEF_FULLY_SPECIFIED, 'edit-rerun-CTL-draft'),
    ]);

    const armOptions = optionLabels(arm.response.body);

    // ARM: run → edit → run.
    const armRun1 = await ctx.client.turn({ scenarioId: arm.scenarioId, message: RUN, label: 'edit-rerun-ARM-run1' });
    const target = armOptions[1] || armOptions[0];
    const armEdit = await ctx.client.turn({
      scenarioId: arm.scenarioId,
      message: `Change the monthly price per seat for ${target} from 55 to 75.`,
      label: 'edit-rerun-ARM-edit',
    });
    const armRun2 = await ctx.client.turn({ scenarioId: arm.scenarioId, message: RUN, label: 'edit-rerun-ARM-run2' });

    // CONTROL: run → run, with NO edit in between. Everything else identical.
    const ctlRun1 = await ctx.client.turn({ scenarioId: control.scenarioId, message: RUN, label: 'edit-rerun-CTL-run1' });
    const ctlRun2 = await ctx.client.turn({ scenarioId: control.scenarioId, message: RUN, label: 'edit-rerun-CTL-run2' });

    return {
      arm: { scenarioId: arm.scenarioId, draft: arm.response, run1: armRun1, edit: armEdit, run2: armRun2, target },
      control: { scenarioId: control.scenarioId, draft: control.response, run1: ctlRun1, run2: ctlRun2 },
    };
  },

  /**
   * The pins that stop this case producing a meaningless verdict.
   * If two runs did not complete there is nothing to compare, and "the product
   * could not say what changed" would be trivially true and worthless.
   */
  precondition(s) {
    const armK1 = runStateKind(s.arm.run1.body);
    const armK2 = runStateKind(s.arm.run2.body);
    const ctlK2 = runStateKind(s.control.run2.body);
    return [
      check('arm run 1 accepted', s.arm.run1.ok, `status=${s.arm.run1.status}`),
      check('arm edit accepted', s.arm.edit.ok, `status=${s.arm.edit.status}`),
      check('arm run 2 accepted', s.arm.run2.ok, `status=${s.arm.run2.status}`),
      check('control run 2 accepted', s.control.run2.ok, `status=${s.control.run2.status}`),
      check(
        'ARM reached a run state on both runs',
        Boolean(armK1) && Boolean(armK2),
        `run_state.kind run1=${armK1} run2=${armK2} — no run means no delta to ask about`,
      ),
      check(
        'CONTROL reached a run state',
        Boolean(ctlK2),
        `run_state.kind run2=${ctlK2}`,
      ),
      check(
        'the ARM edit named a real option',
        Boolean(s.arm.target),
        `target="${s.arm.target}" bound from analysis_ready.options[]`,
      ),
    ];
  },

  /** ARM: an edit happened. The product must be able to name a change. */
  async arm(ctx, s) {
    return ctx.client.turn({ scenarioId: s.arm.scenarioId, message: DELTA_PROBE, label: 'edit-rerun-ARM-delta-probe' });
  },

  /** CONTROL: no edit happened. The product must say nothing changed. */
  async control(ctx, s) {
    return ctx.client.turn({ scenarioId: s.control.scenarioId, message: DELTA_PROBE, label: 'edit-rerun-CTL-delta-probe' });
  },

  assertArm(resp, s) {
    const t = resp.text;
    const saysCannot = /\b(can'?t compare|cannot compare|unable to compare|don'?t have (?:the )?(?:previous|prior))\b/i.test(t);
    return [
      check('arm returned prose', Boolean(t && t.trim().length > 10), `len=${t ? t.length : 0}`),
      check(
        'does not falsely claim it cannot compare',
        !saysCannot,
        saysCannot ? 'emitted the absence rule despite two completed runs — supports H2' : 'no false absence claim',
      ),
      check(
        'names the edited quantity or a changed figure',
        mentions(t, '75') || mentions(t, s.arm.target) || mentions(t, 'price per seat'),
        `expected a reference to the edit (75 / "${s.arm.target}" / the factor)`,
      ),
    ];
  },

  /**
   * OPPOSITE OUTCOME: with no edit, the honest answer is "nothing changed".
   * A product that narrates a difference here is inventing one.
   */
  assertControl(resp) {
    const t = resp.text;
    const claimsNoChange = /\b(no change|nothing (?:has )?changed|identical|the same|unchanged)\b/i.test(t);
    return [
      check('control returned prose', Boolean(t && t.trim().length > 10), `len=${t ? t.length : 0}`),
      check(
        'reports that nothing changed between two identical runs',
        claimsNoChange,
        claimsNoChange ? 'correctly reports no change' : 'did not report "no change" for two runs with no edit between them',
      ),
      check(
        'does not invent a numeric delta',
        !/\bfrom\s+[\d.]+\s+to\s+[\d.]+/i.test(t),
        'a from→to figure with no edit in between would be fabricated',
      ),
    ];
  },

  /**
   * DIAGNOSTIC — settles H1 vs H2 in one extra turn.
   * Not a gate: it localises the verdict rather than producing one.
   */
  async diagnostic(ctx, s) {
    const anaphoric = await ctx.client.turn({
      scenarioId: s.arm.scenarioId,
      message: ANAPHORIC_PROBE,
      label: 'edit-rerun-DIAG-anaphoric',
    });
    const answered = anaphoric.ok && (mentions(anaphoric.text, '75') || mentions(anaphoric.text, s.arm.target));
    return {
      name: 'H1/H2 discriminator: anaphoric vs demonstrative-free probe',
      ok: true, // informational
      detail: answered
        ? 'the ANAPHORIC probe also resolved — the demonstrative is not the blocker here'
        : 'the ANAPHORIC probe did NOT resolve while the demonstrative-free probe is scored above; ' +
          'if the arm above PASSED, hypothesis H1 holds and this case collapses into pronoun-identity (Seam A)',
    };
  },
};
