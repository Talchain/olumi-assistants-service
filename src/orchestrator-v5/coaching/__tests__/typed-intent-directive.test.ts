/**
 * The TYPED COACHING-INTENT ARM — routing, honest DSK applicability, directive.
 *
 * These tests exist because MOUNTED sparks silently degraded to generic free
 * prose (see the module docblock). The valuable assertions here are NOT "the
 * arm fires" — they are the two ways this build could itself become the defect
 * class it removes:
 *
 *   1. ROUTING EXACTLY THE SEVEN. The `Intent` enum has ELEVEN members and this
 *      arm routes SEVEN. Routing all eleven because the enum lists them would
 *      open the UI's send gate for intents CEE does not actually serve —
 *      re-creating the silent-drop bug in the other direction. The negative
 *      cases are the point, and `estimate_help` is the sharpest of them: it is
 *      MOUNTED and published and still must not be routed here, because its
 *      spark also carries a deterministic `analysis_readiness` handler that
 *      claims the turn before this arm runs.
 *   2. NEVER CITING SCIENCE THAT DOES NOT APPLY. CEE #830 shipped an id that
 *      existed while the text under it was the model's own prose. The
 *      applicability tests below are written so a wrong badge REDs, and each
 *      absence assertion is paired with a POSITIVE CONTROL on the same probe
 *      so it cannot pass by being blind (CLAUDE.md trap 13).
 */

import { describe, expect, it } from 'vitest';

import { Intent } from '@talchain/schemas/boundary';
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

describe('resolveCoachingIntent — routes EXACTLY the seven mounted affordances', () => {
  /**
   * ⭐⭐ THE HAND-WRITTEN COMPLETENESS PIN — and it is deliberately NOT derived
   * from `ROUTED_COACHING_INTENTS`, because every other assertion in this file
   * is.
   *
   * CLAUDE.md trap 12d: a guard derived from a list proves the CONSUMERS agree
   * with the list; it is structurally incapable of noticing the list is SHORT.
   * Measured, not assumed — at the commit before this arm grew its last three
   * members, every `it.each(ROUTED_COACHING_INTENTS)` case in this file passed
   * while three mounted sparks were unrouted, because the loop simply iterated
   * a shorter array. A derived test cannot see a missing key.
   *
   * So the expected set is SPELLED OUT here, once, by hand. Deleting a member
   * from the registry REDs this and nothing else. If you are adding an intent,
   * this line is supposed to make you stop and state the affordance that sends
   * it (see the registry's provenance block).
   */
  it('routes EXACTLY this hand-written set — the check derivation cannot perform', () => {
    expect([...ROUTED_COACHING_INTENTS].sort()).toEqual(
      [
        'challenge_assumption',
        'challenge_frame',
        'define_success',
        'elicit_options',
        'elicit_risks',
        'outside_view',
        'pre_mortem',
      ].sort(),
    );
  });

  it.each(['outside_view', 'pre_mortem', 'elicit_risks'] as const)(
    'routes %s — the mounted spark that used to degrade to generic prose',
    intent => {
      // Named individually rather than only inside the derived `it.each` below,
      // for the same reason: a derived loop over a short registry passes.
      expect(
        resolveCoachingIntent(chipTurn('chip', intent)),
        `${intent} is mounted in DGAI's pre-analysis panel and declares this ` +
          'intent; unrouted, the click degrades to generic free prose',
      ).toBe(intent);
    },
  );

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

  /**
   * The still-unrouted remainder of the published `Intent` enum.
   *
   * ⚠ THIS LIST SHRANK when `outside_view`, `pre_mortem` and `elicit_risks`
   * were routed, and that is exactly the moment a negative-case list becomes a
   * tautology: an intent that is no longer published, or that quietly gains an
   * arm, would make its own "does NOT route" case pass by testing nothing
   * (CLAUDE.md trap 13b — a guard whose discrimination depends on something
   * nothing pins). So the precondition is asserted in-test below rather than
   * trusted.
   */
  const STILL_UNROUTED = ['estimate_help', 'mitigation_help', 'discuss'] as const;

  it('PRECONDITION — every unrouted control is still PUBLISHED and still UNROUTED', () => {
    // Without this, each negative case below could pass because its token
    // vanished from the enum, not because the gate declined it.
    for (const intent of STILL_UNROUTED) {
      expect(
        Intent.options as readonly string[],
        `${intent} is no longer a published Intent — it cannot serve as a control`,
      ).toContain(intent);
      expect(
        ROUTED_COACHING_INTENTS as readonly string[],
        `${intent} is now ROUTED — this control no longer discriminates and the ` +
          'negative case below is vacuous; pick a different control',
      ).not.toContain(intent);
    }
  });

  it.each(STILL_UNROUTED)(
    'does NOT route %s — published in the enum but NOT routed by this arm',
    intent => {
      expect(resolveCoachingIntent(chipTurn('chip', intent))).toBeUndefined();
    },
  );

  it('does NOT route estimate_help — the DUAL-AUTHORITY guard, not an oversight', () => {
    // ⭐ THE ONE MOUNTED SPARK THAT MUST STAY UNROUTED. `calibrate_estimates`
    // (DGAI constants.ts:571-585) carries `action_type: 'analysis_readiness'`
    // AND `intent: 'estimate_help'`. The readiness handler is a deterministic
    // pre-route that CLAIMS the turn and skips the LLM; this arm runs at the
    // LLM call. Routing it would mean two authorities own one affordance and
    // the directive would never fire on the primary path — wired-looking and
    // dead, the exact failure this module exists to remove.
    //
    // Bound by IDENTITY to the token, not to "some unrouted intent", so
    // appending it to the registry REDs here with a message that says why.
    expect(
      resolveCoachingIntent(chipTurn('chip', 'estimate_help')),
      'estimate_help was routed by the coaching arm — it also carries a ' +
        'deterministic analysis_readiness pre-route that claims the turn first, ' +
        'so this arm would be dead on the primary path. Decide which authority ' +
        'owns the turn before routing it.',
    ).toBeUndefined();

    // Positive control on the same probe: a sibling pre-analysis spark DOES
    // route, so the absence above is the registry declining, not a dead resolver.
    expect(resolveCoachingIntent(chipTurn('chip', 'pre_mortem'))).toBe('pre_mortem');
  });

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

  /**
   * ⭐⭐ THE THREE NEWLY-ROUTED INTENTS CITE NOTHING — AND THIS IS THE ONE
   * ABSENCE IN THIS FILE THAT IS *NOT* "no protocol fits".
   *
   * `data/dsk/v1.json` really does contain DSK-P-001 "Pre-mortem exercise"
   * (["evaluate","decide"]) and DSK-P-002 "Outside view exercise"
   * (["frame","evaluate"]) — exact name matches for two of these three, and
   * DSK-P-002 would resolve TODAY at the live `frame` stage. So a reader who
   * checks the bundle will find the ids and reasonably wonder why they are not
   * wired. The answer is scope: a grounding badge is a user-visible claim of
   * scientific provenance and must be adjudicated against `required_inputs`
   * and `contraindications`, not just `stage_applicability` — DSK-P-001
   * requires "analysis results with fragile edges" and an "identified winning
   * option", which a PRE-ANALYSIS pre-mortem spark does not have.
   *
   * Pinned as an EXACT SET so that wiring them is a deliberate act that REDs
   * here with the argument attached, rather than a quiet pattern-match.
   */
  it.each([
    ['outside_view', 'DSK-P-002 names this exercise and would resolve at `frame`'],
    ['pre_mortem', 'DSK-P-001 names this exercise; its required_inputs are post-analysis'],
    ['elicit_risks', 'no published protocol names a gap-elicitation exercise'],
  ] as const)(
    'does NOT yet cite a protocol for %s — a held scope boundary, not an absence of science',
    (intent, why) => {
      for (const stage of ['frame', 'analyse', 'decide', 'review']) {
        expect(
          resolveApplicableProtocol(intent as 'outside_view', stage),
          `${intent} acquired a DSK citation at stage ${stage} (${why}). That is a ` +
            'claim of scientific grounding on a user-visible surface: adjudicate ' +
            "the protocol's required_inputs and contraindications, not just its " +
            'stage_applicability, and update this pin with the argument.',
        ).toBeNull();
      }
    },
  );

  it('POSITIVE CONTROL for the three absences above — the bundle IS readable here', () => {
    // Without this, every assertion in the block above would pass identically
    // if the bundle failed to load or hash-verify (CLAUDE.md trap 13). The
    // control asserts a DIFFERENT answer on the SAME probe, so a blind
    // resolver cannot fake agreement.
    const p = resolveApplicableProtocol('elicit_options', 'frame');
    expect(p, 'the DSK bundle did not resolve — the absence assertions above are vacuous').not.toBeNull();
    expect(p!.id).toBe('DSK-P-004');
  });
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

    for (const intent of [
      'challenge_frame',
      'define_success',
      'outside_view',
      'pre_mortem',
      'elicit_risks',
    ] as const) {
      const { directive, dskProtocolId } = buildCoachingMethodDirective(intent, 'frame');
      expect(dskProtocolId).toBeNull();
      expect(directive).not.toContain('DSK-P-');
      expect(directive).not.toContain('published');
    }
  });

  /**
   * ⭐⭐ EACH METHOD IS PINNED BY THE MOVE THAT MAKES IT THAT METHOD — because
   * the step-count floor above is a VALUE PREDICATE and a gutted method
   * satisfies it.
   *
   * Measured, not supposed: a mutant deleting the prospective-hindsight framing
   * from `pre_mortem` — the single instruction that makes a pre-mortem a
   * pre-mortem rather than a risk list — SURVIVED the whole suite, because five
   * steps minus one is still ≥ 3. That is CLAUDE.md trap 19 at the level of the
   * directive: the assertion bound to a count another shape could satisfy, not
   * to the thing it was written to protect.
   *
   * These assert the DEFINING MOVE only, never the full wording, so the prose
   * can be improved without a red — but it cannot be hollowed out.
   */
  it.each([
    ['pre_mortem', ['has clearly failed', 'backwards'],
     'prospective hindsight — without it this is a risk list, not a pre-mortem'],
    ['outside_view', ['REFERENCE CLASS', 'never invent a percentage'],
     'the reference class AND the fabrication guard — a base rate is the most ' +
     'inventable number in this arm'],
    ['elicit_risks', ['MISSING, not what is present', 'UPSIDE'],
     'the gap framing AND the upside half — the spark is "Find risks and ' +
     'upside", so a risk-only answer, or one that restates what the model ' +
     'already covers, silently delivers half the affordance'],
  ] as const)('%s keeps the move that makes it that method', (intent, needles, why) => {
    const { directive } = buildCoachingMethodDirective(intent as 'pre_mortem', 'frame');
    for (const needle of needles) {
      expect(directive, `${intent} lost: ${why}`).toContain(needle);
    }
  });

  /**
   * ⭐⭐⭐ AND THE `clicked` PHRASE IS PINNED BY IDENTITY TOO — THE OTHER FIELD
   * OF `INTENT_METHOD`, AND THE ONE THAT TELLS THE COACH *WHICH REQUEST* IT IS
   * ANSWERING.
   *
   * The pin above closed the INSTANCE an earlier mutant exposed (`method`
   * hollowed out) and left the CLASS open: `INTENT_METHOD` records carry TWO
   * fields, and only one of them was bound. Measured by an independent
   * reviewer at `266b1d4f`, not supposed: SWAPPING the `clicked` phrases
   * between `outside_view` and `pre_mortem` left the whole suite GREEN
   * (67/67), shipping a self-contradictory directive — "The user clicked a
   * button to take the outside view on this decision" followed by the
   * prospective-hindsight method. A click on **Run a pre-mortem** would be
   * steered to name the wrong exercise: the precise harm this arm exists to
   * remove, one field to the left of where the guard was placed.
   *
   * ⚠ WHY THE WIRE SUITE CANNOT SEE IT. Its strongest-looking evidence — the
   * directive reaching the router compared against the production builder's
   * own output — is DERIVED FROM `buildCoachingMethodDirective`, so it agrees
   * with any value that function produces (CLAUDE.md trap 12d: derivation
   * proves the consumers agree with the list, never that the list is right).
   * The only instrument that can catch a wrong phrase is a HAND-WRITTEN one,
   * so this table is spelled out by hand and its coverage is asserted, making
   * it a mirror that FAILS LOUD rather than one that drifts green.
   *
   * Closed against the ENUMERATION (all seven routed intents), not against the
   * two the reviewer's mutant happened to swap: the same swap between any
   * other pair would otherwise still survive.
   */
  const CLICKED_PHRASE: Readonly<Record<string, string>> = {
    challenge_frame: 'pressure-test the framing of this decision',
    define_success: 'define a measurable success target for this decision',
    elicit_options: 'widen the set of options under consideration',
    challenge_assumption: 'think through a possible blind spot in how their model leans',
    outside_view: 'take the outside view on this decision',
    pre_mortem: 'run a pre-mortem on this decision',
    elicit_risks: 'find the risks and upside missing from their model',
  };

  it('PRECONDITION — the hand-written clicked table covers EXACTLY the routed set', () => {
    // Without this the per-intent pin below would silently stop covering an
    // intent added to the registry, and the `clicked` field would be unbound
    // again for exactly the newest, least-reviewed member (CLAUDE.md trap 12 —
    // a hand-maintained mirror must fail loud on drift, never assume good).
    expect(
      Object.keys(CLICKED_PHRASE).sort(),
      'the clicked-phrase table and ROUTED_COACHING_INTENTS have diverged; a ' +
        'routed intent with no entry here has an UNPINNED clicked phrase',
    ).toEqual([...ROUTED_COACHING_INTENTS].sort());
  });

  it.each(ROUTED_COACHING_INTENTS)(
    '%s names the request the user actually clicked — bound by identity, not by shape',
    intent => {
      const { directive } = buildCoachingMethodDirective(intent, 'frame');
      // The WHOLE sentence, not a substring of the phrase: this binds the
      // directive to THIS intent's request (CLAUDE.md trap 19 — an assertion
      // must name its object, never a predicate another object could satisfy).
      expect(
        directive,
        `${intent}'s directive does not ask the coach to ` +
          `"${CLICKED_PHRASE[intent]}". A routed chip whose directive names a ` +
          'DIFFERENT exercise steers the coach to answer a question the user ' +
          'did not ask — the exact degradation this arm exists to remove.',
      ).toContain(`The user clicked a button to ${CLICKED_PHRASE[intent]}.`);
    },
  );

  it('always demands grounding and forbids inventing the user\'s numbers', () => {
    for (const intent of ROUTED_COACHING_INTENTS) {
      const { directive } = buildCoachingMethodDirective(intent, 'frame');
      expect(directive).toContain('Ground every claim');
      expect(directive).toContain('Never present an invented number');
    }
  });
});
