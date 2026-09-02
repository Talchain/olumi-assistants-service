/**
 * add_option TEXT recogniser — the routing corpus.
 *
 * WHAT THIS PINS. `detectAddOptionIntent` decides whether a turn leaves the
 * generic `edit_graph` lane for the focused add-option path. Both directions
 * matter and they are NOT the same risk:
 *   · a MISS costs nothing — the message takes today's edit lane unchanged;
 *   · a FALSE MATCH takes a turn away from a lane that handles it correctly.
 * So the positive corpus proves the capability is reachable by ordinary
 * phrasings, and the negative corpus — which is the load-bearing half — proves
 * every neighbouring intent keeps its existing owner.
 *
 * ⚠ THE CORPUS IS NOT DRAWN FROM THE AUTHOR'S HEAD ALONE (trap 22). The
 * positives include the two sentences the PRODUCT itself emits, imported from
 * their producers rather than re-typed, so chip copy and route cannot drift
 * apart: CEE's widening card (`draft-option-widening-blocks.ts`) and the
 * clarify chip this module builds. The negatives are taken from the phrasings
 * the sibling detectors and the value-update gate already own.
 */
import { describe, it, expect } from 'vitest';

import {
  detectAddOptionIntent,
  buildAddOptionClarifyChipMessage,
  isTargetReference,
  OPTION_NOUN_DETERMINERS,
  TARGET_DEFINITE_DETERMINERS,
  TARGET_QUANTIFIER_DETERMINERS,
  CONTAINER_NOUNS,
} from '../add-option-intent.js';

/** The exact `action_prompt` CEE's widening card sends as free text. */
const WIDENING_CARD_PROMPT = (label: string): string =>
  `Add "${label}" as an option on the model.`;

describe('detectAddOptionIntent — POSITIVE: ordinary confirmed add-option requests', () => {
  const POSITIVE: ReadonlyArray<readonly [string, string]> = [
    // [message, expected label]
    ['Add a third option: partner with a local distributor', 'Partner with a local distributor'],
    [WIDENING_CARD_PROMPT('Licence the technology'), 'Licence the technology'],
    ['Add "Partner with a local distributor" as an option', 'Partner with a local distributor'],
    ['Add Partner with a local distributor as an option', 'Partner with a local distributor'],
    ['Please add an option called Open a Berlin office', 'Open a Berlin office'],
    ['Add an option named "Acquire a local competitor"', 'Acquire a local competitor'],
    ['Add an option: Remote-first German team', 'Remote-first German team'],
    ['Create an option to partner with a distributor', 'Partner with a distributor'],
    ['Add a "Do nothing" option', 'Do nothing'],
    ["I'd like to add an option called Stay UK-only", 'Stay UK-only'],
    ["Let's add another option: Licence the technology", 'Licence the technology'],
    ['Include an alternative called Joint venture', 'Joint venture'],
    ['Introduce a new option named Franchise model', 'Franchise model'],
    ['Can you add an option called Hire a country manager', 'Hire a country manager'],
  ];

  it.each(POSITIVE)('claims %j and extracts the label', (message, expected) => {
    const d = detectAddOptionIntent(message);
    expect(d.matched).toBe(true);
    if (!d.matched) return;
    expect(d.label).toBe(expected);
  });

  it('the clarify chip this module builds round-trips through this detector', () => {
    // The chip is replayed as user text, so a chip the route cannot re-claim
    // is a dead end. Derived from the producer, never re-typed.
    const message = buildAddOptionClarifyChipMessage(
      'Partner with a local distributor',
      'Geographic expansion strategy',
    );
    const d = detectAddOptionIntent(message);
    expect(d.matched).toBe(true);
    if (!d.matched) return;
    expect(d.label).toBe('Partner with a local distributor');
  });

  it('a QUOTED label may carry a number — that is a name, not an effect value', () => {
    const d = detectAddOptionIntent('Add "Cut headcount by 10%" as an option');
    expect(d.matched).toBe(true);
    if (!d.matched) return;
    expect(d.label).toBe('Cut headcount by 10%');
  });
});

describe('detectAddOptionIntent — OPPOSITE DIRECTION: every neighbour keeps its owner', () => {
  const NEGATIVE: ReadonlyArray<readonly [string, string]> = [
    // [message, why it must not be claimed]
    ['Should I add an option?', 'deliberation, not a command'],
    ['Should we add an option for partnering', 'deliberative opener'],
    ['What other options are there', 'a question for the coach'],
    ['Would it be worth adding an option here', 'deliberation'],
    ['Add more options', 'plural widening, not one named option'],
    ['Suggest additional options for this decision', "the UI's own explore-more chip"],
    // ⭐ THESE FIVE WERE ADDED BECAUSE A MUTANT SURVIVED. Removing the
    // singular-noun guard left the corpus above fully GREEN — every phrase in
    // it was being declined by the LABEL patterns, not by the guard, so the
    // guard was untested and a tidy-up could have deleted it silently. Each of
    // these is declined now and CLAIMED by the guard-less mutant (measured
    // both ways), which is what makes them evidence. They are also the real
    // harm: "Add options: Berlin office, Munich office" would otherwise create
    // ONE option literally named "Berlin office, Munich office".
    ['Add options: Berlin office, Munich office', 'plural list — would mint one option named after all of them'],
    ['Add options called Berlin and Munich', 'plural list with a separator'],
    ['Add alternatives: partner, acquire, build', 'plural alternatives'],
    ['Create options to expand into Germany and France', 'plural with an infinitive'],
    ['Add choices called A and B', 'plural choices'],
    ['Add a factor called Shipping costs', 'a factor, not an option'],
    ['Add a risk called Regulatory delay', 'a risk, not an option'],
    ['Add an assumption that demand keeps growing', 'an assumption, not an option'],
    ['Add a constraint that spend stays under 200k', 'a constraint, not an option'],
    ['Remove the Berlin option', 'a removal'],
    ['Rename the Berlin option to Munich', 'a rename'],
    ['Set price to 40', 'a value edit — the value-update gate owns it'],
    ['Option B raises churn to 12%', 'an option-effect answer'],
    ['Configure the Berlin office option', 'configure-option intent owns it'],
    ['Help me configure Open a Berlin office.', "the product's own configure chip"],
    ['Split the shared cost factor into per-option links', 'a restructure'],
    ['Add "Berlin office" as an option and remove the Munich one', 'a compound edit'],
    ['Add "Berlin office" as an option that cuts margin to 30%', 'states an effect value'],
    ['Add an option called Cut price by 10 percent', 'an unquoted label carrying a value'],
    ['Add it as an option', 'no usable name'],
    ['Add this as an option', 'no usable name'],
    ['Add an option', 'no name at all'],
    ['Can you add some context about the German market', 'not a model edit at all'],
  ];

  it.each(NEGATIVE)('declines %j (%s)', (message, _why) => {
    expect(detectAddOptionIntent(message).matched).toBe(false);
  });

  it('the compound and value screens are REACHED, not merely implied', () => {
    // A discriminating pair: identical add-option frame, one clean remainder
    // and one carrying another edit verb / a value. If the screens were
    // removed, the first two would flip to matched and this would RED.
    const compound = detectAddOptionIntent(
      'Add "Berlin office" as an option and remove the Munich one',
    );
    const valued = detectAddOptionIntent(
      'Add "Berlin office" as an option that cuts margin to 30%',
    );
    const clean = detectAddOptionIntent('Add "Berlin office" as an option');
    expect(compound.matched).toBe(false);
    expect(valued.matched).toBe(false);
    expect(clean.matched).toBe(true);
    if (compound.matched || valued.matched) return;
    expect(compound.reason).toBe('compound_edit');
    expect(valued.reason).toBe('carries_values');
  });

  it('the derived other-edit-verb screen still recognises verbs OTHER than add', () => {
    // The screen is derived from EDIT_GRAPH_POSITIVE_REGEX with `add` removed.
    // A derivation that silently removed everything would let every compound
    // edit through, and the corpus above would still pass on other grounds —
    // so assert the discrimination directly, in both directions.
    for (const verb of ['remove', 'update', 'set', 'delete', 'increase']) {
      expect(
        detectAddOptionIntent(`Add "Berlin office" as an option and ${verb} the other one`).matched,
      ).toBe(false);
    }
    // ...and that a harmless remainder is NOT screened out.
    expect(detectAddOptionIntent('Add "Berlin office" as an option on the model.').matched).toBe(true);
  });
});

/**
 * ⭐⭐ THE TARGET/LABEL BOUNDARY (independent review of PR #1319, 2 Sep 2026).
 *
 * REPRODUCED before it was fixed: `Add an option to the model` was CLAIMED with
 * label `"Model"`, and `Add an option for the pricing decision` with label
 * `"Pricing decision"` — the product proposing an option named after the thing
 * it was being added to, and in the second case after its own parent decision.
 *
 * ⚠ WHY MY EXISTING GUARDS COULD NOT SEE IT, because that is the transferable
 * part: the id-echo rule holds perfectly here. Every id resolved and echoed its
 * entity's exact label. The WRONG ENTITY was selected, and then labelled
 * correctly — so a guard binding label to id is pointed at the wrong bytes by
 * construction. The fix had to be a different question, asked in two places:
 * "is this a target rather than a name?" (the recogniser, graph-blind) and
 * "is this name already something else on this model?" (the validator,
 * graph-aware).
 *
 * ⭐ EVERY CASE HAS ITS OPPOSITE-DIRECTION TWIN, and the two harms are NOT
 * symmetric: dropping a legitimate add is a GAP (the generic lane still serves
 * the user), minting an option the user never named is a LIE. They must never
 * share one threshold, so the pairs below are asserted together — if a future
 * widening reopens the lie, the left column REDs; if it over-corrects into a
 * gap, the right column REDs.
 */
describe('detectAddOptionIntent — TARGET vs LABEL, in matched pairs', () => {
  const PAIRS: ReadonlyArray<readonly [string, string]> = [
    // [must be DECLINED — X is the target] , [must be CLAIMED — X names the option]
    ['Add an option to the model', 'Add an option to partner with a local distributor'],
    ['Add an option for the pricing decision', 'Add an option for licensing the technology'],
    ['Add an option to my model', 'Add an option to move manufacturing offshore'],
    ['Add an option to this scenario', 'Add an option to acquire a competitor'],
    ['Add an option to the canvas', 'Add an option to open a Berlin office'],
    ['Add an option for the expansion decision', 'Add an option for entering Germany directly'],
    ['Add an option to the graph', 'Add an option to run a six-month trial'],
    ['Add an option to that decision', 'Add an option to hire a country manager'],
    ['Add an option to our analysis', 'Add an option to franchise the model'],
    ['Create an option for the board', 'Create an option to expand into Germany'],
  ];

  it.each(PAIRS)('DECLINES the target %j', (target, _twin) => {
    const d = detectAddOptionIntent(target);
    expect(d.matched, `"${target}" must not mint a label`).toBe(false);
    if (d.matched) return;
    expect(d.reason).toBe('target_not_a_label');
  });

  it.each(PAIRS)('...while still CLAIMING its twin (no over-correction): %j -> %j', (_target, twin) => {
    const d = detectAddOptionIntent(twin);
    expect(d.matched, `"${twin}" is a legitimate add and must survive the fix`).toBe(true);
    if (!d.matched) return;
    // And the label is the OPTION, never a frame word.
    expect(d.label.toLowerCase()).not.toMatch(/^(?:model|decision|canvas|graph|scenario|analysis|board)$/);
    expect(d.label.length).toBeGreaterThan(3);
  });

  it('the screen is bound to the prepositional trigger ONLY — an explicit name keeps its determiner', () => {
    // A determiner after `called` is part of a name the user actually wrote, so
    // the two triggers must NOT share the rule. This is the discriminating pair
    // that proves the screen is scoped rather than global.
    const named = detectAddOptionIntent('Add an option called The Big Bet');
    expect(named.matched).toBe(true);
    if (!named.matched) return;
    expect(named.label).toBe('The Big Bet');
    // ...and the prepositional form with the same words still declines.
    expect(detectAddOptionIntent('Add an option to the big bet').matched).toBe(false);
  });
});

describe('detectAddOptionIntent — totality', () => {
  it('never throws on hostile input', () => {
    const hostile: unknown[] = [
      null, undefined, 42, {}, [], '', '   ', '?', '"', '""', 'add',
      'add an option called ' + 'x'.repeat(500),
      'Add "' + 'y'.repeat(500) + '" as an option',
    ];
    for (const input of hostile) {
      expect(() => detectAddOptionIntent(input)).not.toThrow();
      expect(typeof detectAddOptionIntent(input).matched).toBe('boolean');
    }
  });

  it('an over-long label is declined rather than truncated into a different name', () => {
    const d = detectAddOptionIntent('Add "' + 'y'.repeat(200) + '" as an option');
    expect(d.matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ⭐⭐ THE CLOSED CLASS — the corpus that closes against an ENUMERATION.
//
// WHY THIS EXISTS AND THE TEN PAIRS ABOVE DO NOT REPLACE IT. The first version
// of the target/label screen hand-listed the twelve determiners reproduction
// had turned up, and the pairs above pinned exactly those. English determiners
// are a CLOSED CLASS of ~45, so the class survived one word shorter: measured
// over the corpus below at that commit, 117 of 196 probes still minted the
// user's own container as an option name, and 10 of 10 legitimate verb
// phrasings were dropped in the other direction.
//
// So this corpus is generated from the alphabets rather than typed out, and it
// is written in MATCHED DIRECTIONS throughout: a widening REDs the LIE column,
// an over-correction REDs the GAP column. Neither column alone is evidence.
// ---------------------------------------------------------------------------

describe('detectAddOptionIntent — the determiner CLOSED CLASS, both directions', () => {
  const ALL_TARGET_DETERMINERS = [...TARGET_DEFINITE_DETERMINERS, ...TARGET_QUANTIFIER_DETERMINERS];

  // --- LIE column: every determiner in the class, against a container -------
  const LIE_CASES: string[] = [];
  for (const det of ALL_TARGET_DETERMINERS) {
    LIE_CASES.push(`Add an option to ${det} decision`);
    LIE_CASES.push(`Add an option for ${det} model`);
  }
  for (const det of ['all', 'both', 'these', 'those', 'several', 'some', 'many', 'two']) {
    LIE_CASES.push(`Add an option to ${det} decisions`);
  }
  for (const n of CONTAINER_NOUNS) LIE_CASES.push(`Add an option to ${n}`);
  for (const g of ["Paul's", "Acme's", "everyone's", "the team's", "my colleague's"]) {
    LIE_CASES.push(`Add an option to ${g} model`);
    LIE_CASES.push(`Add an option for ${g} decision`);
  }
  for (const phrase of [
    'a new decision', 'another new decision', 'any other decision', 'the same decision',
    'some existing scenario', 'each strategic decision', 'every remaining decision',
    'the overall analysis', 'this whole model', 'a new distribution model',
  ]) {
    LIE_CASES.push(`Add an option to ${phrase}`);
  }

  it.each(LIE_CASES)('LIE: %j names the container and must NOT be minted as a label', (message) => {
    const d = detectAddOptionIntent(message);
    expect(d.matched, `"${message}" must not mint the user's own container as an option`).toBe(false);
    if (d.matched) return;
    expect(d.reason).toBe('target_not_a_label');
  });

  // --- GAP column: the opposite direction, twinned case by case -------------
  //
  // ⭐ EVERY CONTAINER NOUN THAT IS ALSO A VERB GETS A TWIN. The ten pairs
  // above contain no verb colliding with the noun alphabet, so that corpus
  // shared the code's blind spot — the exact trap matched pairs exist to
  // prevent, reappearing inside them. These are the missing right-hand column.
  const VERB_TWINS: ReadonlyArray<readonly [string, string]> = [
    ['plan', 'Add an option to plan a phased rollout'],
    ['map', 'Add an option to map the supply chain'],
    ['list', 'Add an option to list on the LSE'],
    ['set', 'Add an option to set up a joint venture'],
    ['mix', 'Add an option to mix in-house and outsourced delivery'],
    ['project', 'Add an option to project demand three years out'],
    ['model', 'Add an option to model a two-year ramp'],
    ['graph', 'Add an option to graph the cost curve'],
    ['board', 'Add an option to board the remaining vessels'],
    ['page', 'Add an option to page the on-call team'],
  ];

  it.each(VERB_TWINS)(
    'GAP: %j is a VERB here, so %j is a legitimate option and must be claimed',
    (noun, message) => {
      const d = detectAddOptionIntent(message);
      expect(d.matched, `"${message}" is a legitimate add and must survive the target screen`).toBe(true);
      if (!d.matched) return;
      // ...and the label is the whole verb phrase, not the bare container word.
      expect(d.label.toLowerCase()).not.toBe(noun);
      expect(d.label.toLowerCase().startsWith(noun)).toBe(true);
    },
  );

  it.each([
    // An INDEFINITE determiner with no container is an ordinary option NAME.
    // Widening the target screen to "any determiner" would take all of these.
    ['Add an option to a joint venture with Siemens', 'Joint venture with Siemens'],
    ['Add an option to a wholly-owned subsidiary', 'Wholly-owned subsidiary'],
    ['Add an option to another supplier in Poland', 'Another supplier in Poland'],
    ['Add an option to defer the decision until next year', 'Defer the decision until next year'],
  ])('GAP: %j is an option name, not a container reference', (message, expected) => {
    const d = detectAddOptionIntent(message);
    expect(d.matched, `"${message}" must survive`).toBe(true);
    if (!d.matched) return;
    expect(d.label).toBe(expected);
  });

  it('a BARE container noun is the container; the same word leading a phrase is a verb', () => {
    // The discriminating pair for the anchor. Loosening `BARE_CONTAINER` back
    // to a word boundary REDs the second line; dropping it REDs the first.
    expect(isTargetReference('model')).toBe(true);
    expect(isTargetReference('model a two-year ramp')).toBe(false);
    expect(isTargetReference('plan')).toBe(true);
    expect(isTargetReference('plan a phased rollout')).toBe(false);
  });

  it('a QUANTIFIER is a target only WITH a container — the two conjuncts both bite', () => {
    // Drop the determiner conjunct and line 2 flips; drop the container
    // conjunct and line 3 flips. Neither assertion alone proves the pair.
    expect(isTargetReference('each decision')).toBe(true);
    expect(isTargetReference('franchise the model')).toBe(false); // container, no determiner lead
    expect(isTargetReference('a joint venture with Siemens')).toBe(false); // determiner, no container
  });

  it('a DEFINITE determiner is a target whatever its head noun — quantifiers are not', () => {
    expect(isTargetReference('the big bet')).toBe(true);
    expect(isTargetReference('a big bet')).toBe(false);
  });

  it("⭐ the productive genitive is a possessive determiner and cannot be listed", () => {
    expect(isTargetReference("Paul's model")).toBe(true);
    expect(isTargetReference("the team's decision")).toBe(true);
    // ...and it is scoped to the genitive form, not to any capitalised word.
    expect(isTargetReference('Siemens partnership')).toBe(false);
  });
});

describe('the target alphabet AGREES with the option-noun alphabet it sits beside', () => {
  // ⭐⭐ THE UNION ASSERTION — the guard that would have caught `another`.
  //
  // `another` was already in `OPTION_NOUN_DETERMINERS` while the target screen
  // that needed it hand-listed twelve words of its own. A derived guard proves
  // AGREEMENT and can never prove COMPLETENESS, so this test is deliberately
  // paired with the hand-written closed-class corpus above: drop either and a
  // whole defect class goes unobserved.
  it('every lead word of an option-noun determiner is known to the target screen', () => {
    const known = new Set(
      [...TARGET_DEFINITE_DETERMINERS, ...TARGET_QUANTIFIER_DETERMINERS].map((w) => w.toLowerCase()),
    );
    const missing = OPTION_NOUN_DETERMINERS.map((phrase) => phrase.split(' ')[0]!.toLowerCase()).filter(
      (lead) => !known.has(lead),
    );
    expect(missing, 'a determiner added for the OPTION noun must also be known to the TARGET screen').toEqual([]);
  });

  it('the alphabets are non-empty and disjoint — a word may not carry two rules', () => {
    // A positive control on the assertion above: an empty alphabet would make
    // it vacuously pass.
    expect(TARGET_DEFINITE_DETERMINERS.length).toBeGreaterThan(10);
    expect(TARGET_QUANTIFIER_DETERMINERS.length).toBeGreaterThan(30);
    expect(OPTION_NOUN_DETERMINERS.length).toBeGreaterThan(5);
    expect(CONTAINER_NOUNS.length).toBeGreaterThan(10);
    const overlap = TARGET_DEFINITE_DETERMINERS.filter((w) => TARGET_QUANTIFIER_DETERMINERS.includes(w));
    expect(overlap).toEqual([]);
  });
});

describe('tidyLabel — BOTH directions of the article rule are pinned', () => {
  // ⚠ The strip direction had no red anywhere: deleting the strip line left
  // all 70 tests green, because every positive whose label could lose an
  // article was quoted or explicitly named. These are the missing half.
  it('STRIP: a grammatical article on an UNQUOTED label is scaffolding, not a name', () => {
    for (const [message, expected] of [
      ['Add the Berlin office as an option', 'Berlin office'],
      ['Add a Poland joint venture as an option', 'Poland joint venture'],
      ['Add an Ireland subsidiary as an option', 'Ireland subsidiary'],
    ] as const) {
      const d = detectAddOptionIntent(message);
      expect(d.matched, message).toBe(true);
      if (!d.matched) continue;
      expect(d.label, `"${message}" must not keep its grammatical article`).toBe(expected);
    }
  });

  it('KEEP: an article the USER put inside a name survives verbatim', () => {
    for (const [message, expected] of [
      ['Add an option called The Big Bet', 'The Big Bet'],
      ['Add "The Berlin office" as an option', 'The Berlin office'],
      ['Add an option named "A Clean Break"', 'A Clean Break'],
    ] as const) {
      const d = detectAddOptionIntent(message);
      expect(d.matched, message).toBe(true);
      if (!d.matched) continue;
      expect(d.label, `"${message}" must keep the name the user wrote`).toBe(expected);
    }
  });
});
