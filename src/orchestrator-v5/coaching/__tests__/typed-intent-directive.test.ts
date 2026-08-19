/**
 * The TYPED COACHING-INTENT ARM — routing, honest DSK applicability, directive.
 *
 * These tests exist because four MOUNTED sparks silently degraded to generic
 * free prose (see the module docblock). The valuable assertions here are NOT
 * "the arm fires" — they are the two ways this build could itself become the
 * defect class it removes:
 *
 *   1. ROUTING EXACTLY THE FOUR. The `Intent` enum has eleven members. Routing
 *      all of them because the enum lists them would open the UI's send gate
 *      for intents CEE does not actually serve — re-creating the silent-drop
 *      bug in the other direction. The negative cases are the point.
 *   2. NEVER CITING SCIENCE THAT DOES NOT APPLY. CEE #830 shipped an id that
 *      existed while the text under it was the model's own prose. The
 *      applicability tests below are written so a wrong badge REDs, and each
 *      absence assertion is paired with a POSITIVE CONTROL on the same probe
 *      so it cannot pass by being blind (CLAUDE.md trap 13).
 */

import { describe, expect, it } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import {
  ROUTED_COACHING_INTENTS,
  buildCoachingMethodDirective,
  resolveApplicableProtocol,
  resolveCoachingIntent,
} from '../typed-intent-directive.js';

/**
 * A turn payload carrying a chip. Deliberately minimal and cast at the edge —
 * these tests exercise the two fields the arm reads (`source`, `chip.intent`)
 * and nothing else.
 */
function chipTurn(source: string, intent: string | undefined): MessageTurnPayload {
  return {
    kind: 'message',
    message: 'Widen the options.',
    turn_class: 'clarify',
    source,
    ...(intent === undefined ? {} : { chip: { intent } }),
  } as unknown as MessageTurnPayload;
}

describe('resolveCoachingIntent — routes EXACTLY the four mounted affordances', () => {
  it.each(ROUTED_COACHING_INTENTS)('routes %s from a chip turn', intent => {
    expect(resolveCoachingIntent(chipTurn('chip', intent))).toBe(intent);
    expect(resolveCoachingIntent(chipTurn('chip_click', intent))).toBe(intent);
  });

  it('routes NOTHING from a composer turn, even carrying a routed intent', () => {
    // Positive control on the same probe: the identical intent DOES route from
    // a chip source, so this absence is the source gate, not a blind resolver.
    expect(resolveCoachingIntent(chipTurn('chip', 'elicit_options'))).toBe('elicit_options');
    expect(resolveCoachingIntent(chipTurn('composer', 'elicit_options'))).toBeUndefined();
  });

  it('does NOT claim add_option — that intent belongs to the add-option transaction', () => {
    // `add_option` is the ONE member already in the UI's CEE_ACCEPTED_INTENTS,
    // routed by route-v2's add-option pre-route. If this arm claimed it, two
    // authorities would own one intent (CLAUDE.md trap 21).
    expect(resolveCoachingIntent(chipTurn('chip', 'add_option'))).toBeUndefined();
  });

  it.each(['pre_mortem', 'outside_view', 'elicit_risks', 'estimate_help', 'mitigation_help', 'discuss'])(
    'does NOT route %s — published in the enum but NOT routed by this arm',
    intent => {
      expect(resolveCoachingIntent(chipTurn('chip', intent))).toBeUndefined();
    },
  );

  it('does NOT route the UI STYLING intent — the name-collision guard', () => {
    // `ActionChip.intent` is 'primary' | 'secondary' | 'undo', a different
    // concept from the wire `Intent` set that happens to share a field name.
    // DGAI's sendChip deliberately does not forward it; if it ever did, a
    // plain styled chip must not acquire a coaching method arm.
    for (const styling of ['primary', 'secondary', 'undo']) {
      expect(resolveCoachingIntent(chipTurn('chip', styling))).toBeUndefined();
    }
  });

  it('tolerates a chip turn with no intent at all', () => {
    expect(resolveCoachingIntent(chipTurn('chip', undefined))).toBeUndefined();
  });
});

describe('resolveApplicableProtocol — cites science ONLY where the bundle says it applies', () => {
  it('cites DSK-P-004 for elicit_options at the frame stage', () => {
    // POSITIVE CONTROL for every absence assertion below: it proves the bundle
    // is readable, hash-verified, and that a protocol CAN be resolved. Without
    // it, an unreadable bundle would make every "no citation" test pass while
    // testing nothing.
    const p = resolveApplicableProtocol('elicit_options', 'frame');
    expect(p).not.toBeNull();
    expect(p!.id).toBe('DSK-P-004');
    expect(p!.stage_applicability).toContain('frame');
  });

  it('does NOT cite DSK-P-004 at a stage the bundle does not list', () => {
    // The published record is stage_applicability ["frame","ideate"].
    expect(resolveApplicableProtocol('elicit_options', 'decide')).toBeNull();
    expect(resolveApplicableProtocol('elicit_options', 'review')).toBeNull();
  });

  it('cites DSK-P-003 for challenge_assumption at the decide stage only', () => {
    const applicable = resolveApplicableProtocol('challenge_assumption', 'decide');
    expect(applicable).not.toBeNull();
    expect(applicable!.id).toBe('DSK-P-003');
    // DSK-P-003 requires "analysis results showing a clear winner" and is
    // stage_applicability ["evaluate","decide"] — at the PRE-ANALYSIS frame
    // stage, where the reflect_bias spark also lives, it must not be cited.
    expect(resolveApplicableProtocol('challenge_assumption', 'frame')).toBeNull();
  });

  it('pins the ONE cell where exact-token matching under-serves the live stage mapper', () => {
    // ⭐ AN HONEST KNOWN GAP, PINNED SO IT CANNOT MOVE SILENTLY.
    //
    // `mapStageToDecisionStage` (handlers/edit-graph-dispatch.ts:754-767) maps
    // `analyse → evaluate`, and DSK-P-003 is stage_applicability
    // ["evaluate","decide"] — so under the live mapper, `challenge_assumption`
    // on an ANALYSE turn WOULD be citable. This arm's exact-token gate does
    // not see it, and deliberately so: reusing the mapper needs an export from
    // a file under a live three-way conflict, and copying it would create a
    // second authority for one question.
    //
    // The gap is recorded here as an EXACT SET rather than left invisible, so
    // the suite REDs if it grows OR shrinks (the known-dropped-set discipline).
    // Whoever exports the shared mapper deletes this test with the gate.
    const KNOWN_UNDER_SERVED: ReadonlyArray<readonly [string, string]> = [
      ['challenge_assumption', 'analyse'],
    ];

    // Every recorded cell is genuinely uncited today...
    for (const [intent, stage] of KNOWN_UNDER_SERVED) {
      expect(
        resolveApplicableProtocol(intent as 'challenge_assumption', stage),
      ).toBeNull();
    }

    // ...and the SET does not grow: the only other cell the live mapper could
    // add is `elicit_options` at a stage mapping into ["frame","ideate"], and
    // `frame` already maps to itself, so this arm already serves it. If that
    // stops being true, this assertion goes red rather than the gap widening
    // unobserved.
    expect(resolveApplicableProtocol('elicit_options', 'frame')).not.toBeNull();
    expect(resolveApplicableProtocol('challenge_assumption', 'decide')).not.toBeNull();
    expect(KNOWN_UNDER_SERVED).toHaveLength(1);
  });

  it.each(['frame', 'analyse', 'decide', 'review'])(
    'NEVER cites a protocol for challenge_frame at stage %s',
    stage => {
      // No published protocol names a frame-challenge exercise. DSK-P-005
      // (Devil's advocate) requires analysis results with a dominant factor;
      // stamping it would be CEE #830 exactly.
      expect(resolveApplicableProtocol('challenge_frame', stage)).toBeNull();
    },
  );

  it.each(['frame', 'analyse', 'decide', 'review'])(
    'NEVER cites a protocol for define_success at stage %s',
    stage => {
      // DSK-P-006 (Implementation intentions) is stage ["decide"] and is
      // explicitly contraindicated before the user has decided.
      expect(resolveApplicableProtocol('define_success', stage)).toBeNull();
    },
  );
});

describe('buildCoachingMethodDirective', () => {
  it.each(ROUTED_COACHING_INTENTS)(
    '%s produces an actionable, method-shaped directive — never generic encouragement',
    intent => {
      const { directive } = buildCoachingMethodDirective(intent, 'frame');
      expect(directive).toContain('## Requested coaching method (explicit)');
      expect(directive).toContain('do not reply with general encouragement');
      expect(directive).toContain('Work through this method:');
      // At least three concrete method steps, so the arm cannot degrade to a
      // one-line nudge without this going RED.
      const steps = directive.split('\n').filter(l => l.startsWith('- '));
      expect(steps.length).toBeGreaterThanOrEqual(3);
    },
  );

  it('names the published protocol and its expected outputs when one applies', () => {
    const { directive, dskProtocolId } = buildCoachingMethodDirective('elicit_options', 'frame');
    expect(dskProtocolId).toBe('DSK-P-004');
    expect(directive).toContain('Opportunity cost prompting exercise');
    // The expected outputs are READ FROM THE BUNDLE, not restated in the
    // source, so this asserts the derivation actually happened.
    expect(directive).toContain('explicit acknowledgement of opportunity costs');
  });

  it('emits NO protocol claim when none applies — paired with its positive control', () => {
    // Positive control (same function, same shape): the applicable case DOES
    // carry a DSK id, so the absence below is a real absence.
    const applicable = buildCoachingMethodDirective('elicit_options', 'frame');
    expect(applicable.directive).toContain('published');
    expect(applicable.dskProtocolId).toBe('DSK-P-004');

    for (const intent of ['challenge_frame', 'define_success'] as const) {
      const { directive, dskProtocolId } = buildCoachingMethodDirective(intent, 'frame');
      expect(dskProtocolId).toBeNull();
      expect(directive).not.toContain('DSK-P-');
      expect(directive).not.toContain('published');
    }
  });

  it('always demands grounding and forbids inventing the user\'s numbers', () => {
    for (const intent of ROUTED_COACHING_INTENTS) {
      const { directive } = buildCoachingMethodDirective(intent, 'frame');
      expect(directive).toContain('Ground every claim');
      expect(directive).toContain('Never present an invented number');
    }
  });
});
