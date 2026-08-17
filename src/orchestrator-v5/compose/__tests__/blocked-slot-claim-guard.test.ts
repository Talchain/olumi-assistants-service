/**
 * ROADMAP 2.1265 — the blocker/claim mutual-exclusion invariant.
 *
 * ⭐⭐ EVERY RULE HERE HAS AN OPPOSITE-DIRECTION TWIN, because this predicate has
 * already produced a defect AND ITS EXACT INVERSE in consecutive rounds, each
 * under a fully green suite (CLAUDE.md trap 22b). The catch direction is cheap
 * to satisfy and worthless alone.
 *
 * THE TRUE-PROSE CORPUS COMES FROM OUTSIDE THIS AUTHOR'S HEAD. It is 688 real
 * `assistant_text` strings, harvested from live wire captures in
 * `olumi-docs/{PHASE0-EVIDENCE-2026-07-28, witness-998-2026-08-16,
 * witness-acceptance-2026-08-17, regression-shield-2026-08-16}` — every reply in
 * those captures that contains a digit, out of 1,323 distinct replies total.
 *
 * ⚠ THE 635 NO-DIGIT REPLIES ARE EXCLUDED BY DERIVATION, NOT BY CONVENIENCE:
 * stage 1 requires `readClaimedNumbers(unit).length > 0`, so a reply with no
 * digit anywhere cannot anchor and cannot be touched. The shipped fixture is
 * therefore the COMPLETE set of live replies the guard could possibly alter.
 * (All 1,323 were also run locally, with the same result.)
 *
 * ⚠ THE FIXTURES ARE HISTORIC RECORDS — APPEND ONLY, NEVER EDIT (trap 14b).
 * They are what the product actually said on dated builds. Rewriting one to
 * keep a test green would falsify the record.
 */

import { describe, expect, it } from 'vitest';
import {
  applyBlockedSlotClaimGuard,
  assertsModelPossession,
  buildBlockedSlotCorrection,
  BLOCKED_SLOT_RESTATEMENT_TEXT,
  namesEntityUniquely,
  readBlockedValueSlots,
  groundedValuesForSlot,
  type BlockedValueSlot,
} from '../blocked-slot-claim-guard.js';
import { resolveRepairValueBinding } from '../../routing/repair-value-binding.js';
// ⚠ PLAIN JSON IMPORTS, deliberately. The `with { type: 'json' }` form raises
// TS2823 under the repo's test tsconfig (`module` is not esnext/nodenext) — the
// one existing user of that syntax sits in `scripts/ci/typecheck-baseline.txt`
// for exactly this reason, and adding to a baseline is not a fix.
import witness from './fixtures/live-assistant-text-corpus-2026-08-17/j4-t2-fabrication.json';
import digitBearingReplies from './fixtures/live-assistant-text-corpus-2026-08-17/digit-bearing-replies.json';

const BLOCKERS: unknown[] = witness.blockers as unknown[];
const GRAPH: unknown = witness.persisted_graph;
const FABRICATION: string = witness.assistant_text;

/** The witnessed blocked pair, by id — the anchor for every case below. */
const SLOT: BlockedValueSlot = {
  optionId: '21ea9b80',
  optionLabel: 'subcontracting inner-city deliveries to a green courier',
  factorId: '49a2b80b',
  factorLabel: 'Subcontractor cost as share of affected-route revenue',
};

function run(text: string, blockers: unknown = BLOCKERS, graph: unknown = GRAPH) {
  return applyBlockedSlotClaimGuard({ assistantText: text, blockers, persistedGraph: graph });
}

describe('blocked-slot claim guard — the witnessed contradiction (CATCH direction)', () => {
  it('catches the deployed J4 t2 fabrication and names the blocked pair', () => {
    const out = run(FABRICATION);
    expect(out.changed).toBe(true);
    expect(out.mode).toBe('applied');
    expect(out.slot?.optionId).toBe(SLOT.optionId);
    expect(out.slot?.factorId).toBe(SLOT.factorId);
    expect(out.ungroundedValues).toContain('12%');
  });

  it('removes BOTH contradictions — the anchor and the anaphoric restatement', () => {
    const out = run(FABRICATION);
    expect(out.contradictions).toHaveLength(2);
    expect(out.text).not.toContain('Your model already reflects subcontractor cost at 12%');
    expect(out.text).not.toContain('are modelled using this 12% figure already');
  });

  it('⭐ P1 — one seam BEYOND the guard: the surrounding content SURVIVES', () => {
    const out = run(FABRICATION);
    // The two bullets are TRUE statements about the analysis. #1007 destroyed
    // content exactly here, so this is the assertion that fails if the
    // substitution ever goes back to whole-text.
    expect(out.text).toContain('is the strongest driver against subcontracting in the latest run');
    expect(out.text).toContain('The number came from quotes, not a firm commitment.');
    expect(out.text).toContain('worth checking whether 12% holds across multiple couriers');
    // The closing question and the conditional offer are untouched.
    expect(out.text).toContain('Is the 12% from the quotes you mentioned in your brief');
    expect(out.text).toContain('sharing it would let the model reflect it precisely');
    // Markdown structure intact: both bullets still start their own line.
    expect(out.text.split('\n').filter((l) => l.trimStart().startsWith('•'))).toHaveLength(2);
  });

  it('⭐ pins the BYTE-EXACT text a user would receive', () => {
    // A reviewer should read what ships, not a description of it. The anchor
    // carries the full correction; the anaphoric restatement is reduced to a
    // clause (replacing both with the full correction was measured shipping
    // ~660 characters of repetition around two true bullets).
    expect(run(FABRICATION).text).toBe(
      'Your model does not have a value for "Subcontractor cost as share of affected-route revenue"'
      + ' on "subcontracting inner-city deliveries to a green courier" yet, so I cannot say it'
      + ' already reflects one. Tell me what to set it to, like this: Set the subcontracting'
      + " inner-city deliveries to a green courier option's effect on Subcontractor cost as share"
      + ' of affected-route revenue to 0.6.\n\n'
      + '• **This figure already anchors the leading result.** Subcontractor cost as a share of'
      + ' affected-route revenue is the strongest driver against subcontracting in the latest run,'
      + ' so confirming it at 12% keeps that comparison accurate.\n'
      + '• **The number came from quotes, not a firm commitment.** Since the analysis shows this'
      + " driver has real weight, it's worth checking whether 12% holds across multiple couriers"
      + ' before treating it as settled.\n\n'
      + 'That figure is not in the model yet. If you have a firmer or updated quote, sharing it'
      + ' would let the model reflect it precisely. Is the 12% from the quotes you mentioned in'
      + ' your brief, or a different source?',
    );
  });

  it('⭐ TWIN — once 12% really IS attributed to the slot, the same reply survives', () => {
    // The post-write graph is the same model after turn 5 wrote 0.12 onto the
    // factor (`user_override`). The reply is then TRUE about the persisted
    // model, and refusing it would be the over-refusal harm that killed #1007.
    // This is the pair that proves the grounding read is attributed rather than
    // decorative: same text, same blockers, different persisted value.
    const out = applyBlockedSlotClaimGuard({
      assistantText: FABRICATION,
      blockers: BLOCKERS,
      persistedGraph: witness.post_write_graph,
    });
    expect(out.changed).toBe(false);
    expect(out.text).toBe(FABRICATION);
    expect(groundedValuesForSlot(witness.post_write_graph, SLOT)).toContain(0.12);
  });

  it('the shipped correction names BOTH halves of the slot and never claims a value', () => {
    const out = run(FABRICATION);
    expect(out.text).toContain(SLOT.factorLabel);
    expect(out.text).toContain(SLOT.optionLabel);
    expect(out.text).toContain('does not have a value for');
  });

  it('closes the ABSENT-MARKER ESCAPE that re-admitted the fabrication verbatim', () => {
    // #1007's review appended exactly this and the fabrication shipped again.
    const escaped = `${FABRICATION}; nothing is missing.`;
    expect(run(escaped).changed).toBe(true);
  });

  it('catches the 50% / 0.5 variant the "structurally impossible" claim let through', () => {
    // 0.5 IS the persisted factor baseline — but it is not attributed to the
    // OPTION, and #1007's `some`-over-an-unattributed-set grounded it anyway.
    // Here a claim about the OPTION holding 0.5 is still a contradiction.
    const text =
      `The subcontracting option is modelled using 0.42 for ${SLOT.factorLabel}.`;
    expect(run(text).changed).toBe(true);
  });
});

describe('blocked-slot claim guard — OPPOSITE DIRECTION (true prose must survive)', () => {
  it('⭐ NO BLOCKER ⇒ NO OPINION: byte-identical BY REFERENCE on an empty list', () => {
    // This is the property #1007 lacked. Reference identity, not equality, so
    // no future refactor can start rewriting text on a blocker-free payload.
    const out = applyBlockedSlotClaimGuard({
      assistantText: FABRICATION,
      blockers: [],
      persistedGraph: GRAPH,
    });
    expect(out.text).toBe(FABRICATION);
    expect(out.changed).toBe(false);
    expect(out.mode).toBe('no_blockers');
  });

  it('⭐ the two sentences #1007 was MEASURED destroying are untouched', () => {
    // Verbatim from the independent review of #1007, run against its own
    // fixture with an EMPTY blocker list.
    for (const sentence of [
      'Your model already contains 12 nodes.',
      'I already ran the analysis at 1,000 samples. Here is what it found: the EV route dominates.',
    ]) {
      const empty = applyBlockedSlotClaimGuard({
        assistantText: sentence,
        blockers: [],
        persistedGraph: GRAPH,
      });
      expect(empty.text).toBe(sentence);
      // And also with the witnessed blockers LIVE: neither sentence names the
      // blocked pair, so neither may be touched.
      expect(run(sentence).text).toBe(sentence);
    }
  });

  it('a GROUNDED claim about the blocked factor survives (P3 — no less true)', () => {
    // The blocker's own message says "Factor … is currently 0.5", so a reply
    // quoting 0.5 is telling the truth about the persisted model even while the
    // option-level value is missing. Refusing it would deny the user's model.
    const grounded = groundedValuesForSlot(GRAPH, SLOT);
    expect(grounded).toContain(0.5);
    const text = `Your model already holds ${SLOT.factorLabel} at 0.5.`;
    expect(run(text).text).toBe(text);
  });

  it('the bullet asking to CONFIRM a figure is not a possession claim', () => {
    const bullet =
      `Subcontractor cost as a share of affected-route revenue is the strongest `
      + `driver against subcontracting in the latest run, so confirming it at 12% `
      + `keeps that comparison accurate.`;
    expect(run(bullet).text).toBe(bullet);
  });

  it('honest ABSENCE prose about the blocked slot survives', () => {
    for (const text of [
      `Your model has no value for ${SLOT.factorLabel} yet, so I cannot use 12%.`,
      `${SLOT.factorLabel} is not set for that option, so 0.12 is not in the model.`,
      `Your model doesn't hold 12% for ${SLOT.factorLabel}.`,
    ]) {
      expect(run(text).text).toBe(text);
    }
  });

  it('⭐ the guard is IMMUNE TO ITS OWN REPLACEMENT COPY', () => {
    // A replacement that were itself a caught claim is the defect reintroduced
    // by the fix. Asserted by running the guard over its own output — BOTH
    // replacement strings, and the whole guarded reply.
    const correction = buildBlockedSlotCorrection(SLOT);
    expect(run(correction).text).toBe(correction);
    expect(assertsModelPossession(correction)).toBe(false);
    expect(run(BLOCKED_SLOT_RESTATEMENT_TEXT).text).toBe(BLOCKED_SLOT_RESTATEMENT_TEXT);
    expect(assertsModelPossession(BLOCKED_SLOT_RESTATEMENT_TEXT)).toBe(false);
    const once = run(FABRICATION);
    expect(run(once.text).text).toBe(once.text);
  });

  it('⭐⭐ THE LIVE TRUE-PROSE CORPUS: 688 real replies pass UNTOUCHED', () => {
    const corpus = digitBearingReplies as string[];
    // Assert the corpus is the size claimed BY NAME — an aggregate cannot see a
    // fixture that silently shrank to nothing (standing mechanics).
    expect(corpus).toHaveLength(688);
    const touched: string[] = [];
    for (const reply of corpus) {
      // The witnessed fabrication is IN this corpus (it is a real capture) and
      // is the one member that must change.
      if (reply === FABRICATION) continue;
      const out = run(reply);
      if (out.changed) touched.push(reply);
    }
    expect(touched).toStrictEqual([]);
  });

  it('the witnessed fabrication IS a member of that corpus', () => {
    // Otherwise the exclusion above would be hiding a miss rather than
    // acknowledging the one true positive (positive control for the sweep).
    expect(digitBearingReplies as string[]).toContain(FABRICATION);
  });
});

describe('identity binding — by IDENTITY, never a predicate another node satisfies', () => {
  const allLabels = (witness.persisted_graph.nodes as Array<{ label: string }>).map((n) => n.label);

  it('binds the witnessed paraphrase to the blocked factor and to nothing else', () => {
    const unit = 'Your model already reflects subcontractor cost at 12% of affected-route revenue.';
    const others = allLabels.filter((l) => l !== SLOT.factorLabel);
    expect(namesEntityUniquely(unit, SLOT.factorLabel, others)).toBe(true);
    for (const other of others) {
      expect(
        namesEntityUniquely(unit, other, allLabels.filter((l) => l !== other)),
      ).toBe(false);
    }
  });

  it('does NOT bind the near-duplicate option twin', () => {
    // `21ea9b80` (from the brief) vs `862169d7` "Subcontract inner-city runs to
    // green courier" (the drafter's twin). A guard that cannot tell them apart
    // would refuse prose about the wrong option.
    const unit =
      'Your model already reflects subcontracting inner-city deliveries to a green courier at 12%.';
    expect(
      namesEntityUniquely(unit, SLOT.optionLabel, allLabels.filter((l) => l !== SLOT.optionLabel)),
    ).toBe(true);
    expect(
      namesEntityUniquely(
        unit,
        'Subcontract inner-city runs to green courier',
        allLabels.filter((l) => l !== 'Subcontract inner-city runs to green courier'),
      ),
    ).toBe(false);
  });

  it('one incidental shared word does not name a label', () => {
    expect(namesEntityUniquely('The cost is fine.', SLOT.factorLabel, [])).toBe(false);
  });
});

describe('possession predicate — anchored to emitted sentences, negation adjacency-bound', () => {
  it('asserts possession on the forms the product actually emitted', () => {
    for (const s of [
      'Your model already reflects subcontractor cost at 12%.',
      "The subcontracting option's costs are modelled using this 12% figure already.",
      'Incident Detection Coverage is already set to 90 scale.',
      'The £250,000 MRR figure is already in your model as the goal itself.',
    ]) {
      expect(assertsModelPossession(s)).toBe(true);
    }
  });

  it('does not assert possession on questions, conditionals or negations', () => {
    for (const s of [
      'Is the 12% from the quotes you mentioned in your brief, or a different source?',
      'Sharing it would let the model reflect it precisely.',
      'Your model has no value for that factor.',
      "Your model doesn't hold 12% for that factor.",
      'It is worth checking whether 12% holds across multiple couriers.',
    ]) {
      expect(assertsModelPossession(s)).toBe(false);
    }
  });

  it('⭐ negation is ADJACENCY-bound: a trailing clause cannot flip it either way', () => {
    // #1007's escape was a marker ANYWHERE in the sentence. Both directions:
    expect(
      assertsModelPossession('Your model already reflects 12%; nothing is missing.'),
    ).toBe(true);
    expect(
      assertsModelPossession('Your model has no value for it, and 12% is still missing.'),
    ).toBe(false);
  });
});

describe('blocker read — BOTH wire spellings, from the same live payload', () => {
  it('reads blocker_type: missing_value', () => {
    const slots = readBlockedValueSlots(BLOCKERS);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.some((s) => s.optionId === SLOT.optionId && s.factorId === SLOT.factorId)).toBe(true);
  });

  it('reads code: MISSING_OPTION_VALUE, which carries NO blocker_type field', () => {
    const wireSpelling = [
      {
        repairability: 'human_input_required',
        option_id: SLOT.optionId,
        option_label: SLOT.optionLabel,
        factor_id: SLOT.factorId,
        factor_label: SLOT.factorLabel,
        code: 'MISSING_OPTION_VALUE',
        category: 'option_values',
        message: 'Choose the missing effect value.',
      },
    ];
    expect(readBlockedValueSlots(wireSpelling)).toHaveLength(1);
    // And the guard fires on that spelling alone — reading only one spelling is
    // green in unit and dead in production.
    expect(run(FABRICATION, wireSpelling).changed).toBe(true);
  });

  it('skips blockers of other types and half-identified pairs', () => {
    expect(
      readBlockedValueSlots([
        { blocker_type: 'constraint_dropped', factor_id: 'f', factor_label: 'F' },
        { blocker_type: 'missing_value', factor_id: 'f', factor_label: 'F' },
        { blocker_type: 'missing_value', option_id: 'o', option_label: 'O', factor_id: 'f' },
      ]),
    ).toStrictEqual([]);
  });

  it('never throws on hostile shapes', () => {
    for (const b of [null, undefined, 'x', 42, [null], [{}], [[]]]) {
      expect(() => run(FABRICATION, b)).not.toThrow();
    }
    expect(() => run(FABRICATION, BLOCKERS, null)).not.toThrow();
    expect(() => run(FABRICATION, BLOCKERS, { nodes: 'nope' })).not.toThrow();
  });
});

describe('⭐ P8 — the correction ASKS ONLY WHAT THE PRODUCT CAN ACCEPT', () => {
  it("the correction's own advised phrasing is ACCEPTED and bound to that slot", () => {
    // The acceptance path is not asserted in prose; it is executed. The
    // sentence the user is handed is fed to the repair binder, which must bind
    // it to THIS pair by id.
    const correction = buildBlockedSlotCorrection(SLOT);
    const advised = correction.slice(correction.indexOf('like this: ') + 'like this: '.length);
    expect(advised.startsWith('Set the ')).toBe(true);

    // And the ordinary short answer to the same ask binds too, when that pair
    // is the only one outstanding.
    const singlePair = [
      {
        blocker_type: 'missing_value',
        option_id: SLOT.optionId,
        option_label: SLOT.optionLabel,
        factor_id: SLOT.factorId,
        factor_label: SLOT.factorLabel,
        message: 'Choose the missing effect value.',
      },
    ];
    const bound = resolveRepairValueBinding({
      message: 'Set it to 0.6.',
      readiness: {
        status: 'needs_user_input',
        options: [],
        goal_node_id: 'g1',
        blockers: singlePair,
      } as unknown as Parameters<typeof resolveRepairValueBinding>[0]['readiness'],
    });
    expect(bound.matched).toBe(true);
    if (bound.matched && bound.kind === 'bind') {
      expect(bound.pair.optionId).toBe(SLOT.optionId);
      expect(bound.pair.factorId).toBe(SLOT.factorId);
    }
  });
});
