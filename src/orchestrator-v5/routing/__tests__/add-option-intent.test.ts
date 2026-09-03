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
  ALL_ADD_OPTION_TRIGGERS,
  GENERIC_LABELS,
  DETERMINER_FRAGMENT,
  KNOWN_OPEN_CONTAINER_GAP,
  CLOSED_COORDINATED_INSTRUCTION,
  KNOWN_OPEN_COORDINATED_NAME,
  KNOWN_OPEN_ANAPHORA,
  KNOWN_OPEN_SEPARATOR_NAMING,
  KNOWN_OPEN_DEFERRAL_LABEL,
  NAMING_WORDS,
  COORDINATED_EDIT_INSTRUCTION_SOURCE,
  mentionsContainer,
  TARGET_DEFINITE_DETERMINERS,
  TARGET_QUANTIFIER_DETERMINERS,
  CONTAINER_NOUNS,
} from '../add-option-intent.js';

/** The exact `action_prompt` CEE's widening card sends as free text. */
const WIDENING_CARD_PROMPT = (label: string): string =>
  `Add "${label}" as an option on the model.`;

describe('detectAddOptionIntent — POSITIVE: ordinary confirmed add-option requests', () => {
  // ⚠ THREE COLON-NAMED ROWS WERE REMOVED FROM THIS CORPUS on 3 Sep 2026 and
  // are now GAPS, pinned in `KNOWN_OPEN_SEPARATOR_NAMING`. Punctuation no
  // longer counts as a naming word, because granting `explicitlyNamed` on a
  // colon or a dash switched the whole target screen off and the product was
  // minting "TBD", "your call" and "the model" as strategic option names. The
  // capability loss is real and deliberate: a gap costs less than a lie.
  const POSITIVE: ReadonlyArray<readonly [string, string]> = [
    // [message, expected label]
    [WIDENING_CARD_PROMPT('Licence the technology'), 'Licence the technology'],
    ['Add "Partner with a local distributor" as an option', 'Partner with a local distributor'],
    ['Add Partner with a local distributor as an option', 'Partner with a local distributor'],
    ['Please add an option called Open a Berlin office', 'Open a Berlin office'],
    ['Add an option named "Acquire a local competitor"', 'Acquire a local competitor'],
    ['Create an option to partner with a distributor', 'Partner with a distributor'],
    ['Add a "Do nothing" option', 'Do nothing'],
    ["I'd like to add an option called Stay UK-only", 'Stay UK-only'],
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
    // ⭐ THESE WERE ADDED BECAUSE A MUTANT SURVIVED. Removing the
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
// WHY THIS EXISTS AND THE PAIRS ABOVE DO NOT REPLACE IT. The first version
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
  // ⭐ EVERY CONTAINER NOUN THAT IS ALSO A VERB GETS A TWIN. The pairs
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

describe('the target screen is on EVERY trigger that INFERS a label', () => {
  // ⭐ The flagship defect was still alive at 2d935680 through a sibling door:
  // the screen was on `option_to` alone, so `Add the model as an option` went
  // through `unquoted_as_option` and minted "Model".
  const INFERRED_TARGETS = [
    'Add the model as an option',
    'Add the pricing decision as an option',
    'Add my model as an option',
    'Add each decision as an option',
    'Add our analysis as an option',
    'Add the canvas as an option',
    'Create the scenario as an option',
  ];
  it.each(INFERRED_TARGETS)('LIE: %j must not mint the container', (message) => {
    const d = detectAddOptionIntent(message);
    expect(d.matched, `"${message}" must not mint the user's own container`).toBe(false);
    if (d.matched) return;
    expect(d.reason).toBe('target_not_a_label');
  });

  // ⚠ ...and NOT on the triggers that are HANDED a label. Screening all five
  // declines every row below, one of which is this module's own discriminator.
  //
  // `all five` is KEPT on purpose: it counts a CLOSED UNION DECLARED ELSEWHERE
  // (`AddOptionIntentTrigger`), which the reader cannot recount from this line,
  // so it carries information rather than mirroring a visible list — and the
  // deliberately-quoted "SCREEN ALL FIVE TRIGGERS" below depends on it for
  // sense. It is pinned by `ALL_ADD_OPTION_TRIGGERS`, whose exhaustiveness the
  // COMPILER enforces. A previous sweep deleted it as if it were a mirror and
  // severed this sentence doing so; both are repaired here.
  const EXPLICITLY_NAMED: ReadonlyArray<readonly [string, string]> = [
    ['Add an option called The Big Bet', 'The Big Bet'],
    ['Add "The Berlin office" as an option', 'The Berlin office'],
    ['Add a "The Big Bet" option', 'The Big Bet'],
    ['Add an option named "A Clean Break"', 'A Clean Break'],
  ];
  it.each(EXPLICITLY_NAMED)('GAP: %j is a name the user wrote — keep it verbatim', (message, expected) => {
    const d = detectAddOptionIntent(message);
    expect(d.matched, message).toBe(true);
    if (!d.matched) return;
    expect(d.label).toBe(expected);
  });

  // ⭐ THE DISCRIMINATING PAIR for the two inferring triggers. `as an option`
  // already says X is the option, so a determiner alone proves nothing there;
  // the prepositional form has no such marker. Screening `as an option` with
  // the prepositional rule REDs line 1; not screening it REDs line 2.
  it('the two inferring triggers ask DIFFERENT questions, and both bite', () => {
    const named = detectAddOptionIntent('Add the Berlin office as an option');
    expect(named.matched).toBe(true);
    if (named.matched) expect(named.label).toBe('Berlin office');
    expect(detectAddOptionIntent('Add the model as an option').matched).toBe(false);
    // ...while the prepositional form screens on the determiner alone.
    expect(detectAddOptionIntent('Add an option to the big bet').matched).toBe(false);
  });
});

describe('⭐ the DERIVED determiner fragment really is what it replaced', () => {
  // The file's comment claimed this was asserted and no assertion existed.
  // A comment claiming a guard that is not there is worse than neither.
  it('rebuilds the exact regex source the hand-written literal carried', () => {
    const HAND_WRITTEN =
      '(?:(?:a|an|another|one\\s+more|the|a\\s+new|a\\s+further|a\\s+possible|' +
      'a\\s+second|a\\s+third|a\\s+fourth|a\\s+fifth)\\s+)?';
    const derived =
      '(?:(?:' + OPTION_NOUN_DETERMINERS.map((d) => d.replace(/ /g, '\\s+')).join('|') + ')\\s+)?';
    expect(derived).toBe(HAND_WRITTEN);
  });
});

describe('⚠ the gaps this module ships OPEN, pinned exactly', () => {
  // A derived corpus proves the copies agree and can NEVER prove the list is
  // right: `LIE_CASES` above is generated from the very alphabets it certifies,
  // so it is structurally blind to a short list. `CONTAINER_NOUNS` is an OPEN
  // class of English common nouns and no list closes it. Rather than hide that,
  // it is pinned: this REDs if a case starts declining (someone closed one —
  // move it out and say so) and REDs if the set grows (a new one was found).
  it('every KNOWN-OPEN container case is still claimed — the set has not SHRUNK', () => {
    for (const message of KNOWN_OPEN_CONTAINER_GAP) {
      const d = detectAddOptionIntent(message);
      expect(
        d.matched,
        `"${message}" now DECLINES. That is an improvement — remove it from KNOWN_OPEN_CONTAINER_GAP and say so.`,
      ).toBe(true);
    }
  });

  it('...and the set has not GROWN silently', () => {
    // 8 at 0e703c71; 10 after the independent reviewer's two rows
    // ("said decision", "each workspace") were added so the DECLARED scope
    // matches what is actually measured rather than what was first imagined.
    expect(KNOWN_OPEN_CONTAINER_GAP.length).toBe(10);
    expect(CLOSED_COORDINATED_INSTRUCTION.length).toBe(4);
    expect(KNOWN_OPEN_COORDINATED_NAME.length).toBe(11);
    // Positive control: the set is not vacuous and these really are container
    // references a human would call targets.
    expect(KNOWN_OPEN_CONTAINER_GAP).toContain('Add an option to each node');
    expect(KNOWN_OPEN_CONTAINER_GAP).toContain('Add an option to six decisions');
  });

  it('a coordinated second instruction is swallowed into an INFERRED label', () => {
    for (const message of CLOSED_COORDINATED_INSTRUCTION) {
      const d = detectAddOptionIntent(message);
      expect(d.matched, `"${message}" drops a user instruction and must decline`).toBe(false);
      if (d.matched) continue;
      expect(d.reason).toBe('compound_edit');
    }
    // ...and the QUOTED form, whose label is bounded, correctly declines.
    const quoted = detectAddOptionIntent(
      'Add "Partner with a distributor" as an option and remove the old one',
    );
    expect(quoted.matched).toBe(false);
    if (!quoted.matched) expect(quoted.reason).toBe('compound_edit');
  });
});

describe('the derived DETERMINER fragment is byte-for-byte the literal it replaced', () => {
  // ⚠ A HISTORIC RECORD, APPEND-ONLY. This is the exact source string the
  // hand-written literal produced before it became a derived list. It is not a
  // fixture to keep current: if the list legitimately grows, this constant does
  // NOT move — a new one is added beside it and this one keeps pinning the
  // migration that already happened.
  const LITERAL_AT_2d935680 =
    "(?:(?:a|an|another|one\\s+more|the|a\\s+new|a\\s+further|a\\s+possible|a\\s+second|a\\s+third|a\\s+fourth|a\\s+fifth)\\s+)?";

  it('produces the identical fragment, ORDER INCLUDED', () => {
    expect(DETERMINER_FRAGMENT).toBe(LITERAL_AT_2d935680);
  });

  it('positive control: the assertion can fail — reordering the list breaks it', () => {
    const reordered = [...OPTION_NOUN_DETERMINERS].reverse();
    const rebuilt = `(?:(?:${reordered.map((d) => d.replace(/ /g, '\\s+')).join('|')})\\s+)?`;
    expect(rebuilt).not.toBe(LITERAL_AT_2d935680);
  });
});

describe('the target screen is wired to EVERY inferring trigger, not one', () => {
  // ⭐ The flagship defect survived four rounds through a SIBLING TRIGGER:
  // `Add the model as an option` minted "Model" while `Add an option to the
  // model` correctly declined. The scope is now derived from the file's own
  // `explicitlyNamed` predicate — the same one `tidyLabel` already used.
  it.each([
    'Add the model as an option',
    'Add the pricing decision as an option',
    'Add my model as an option',
    'Add each decision as an option',
    'Add every decision as an option',
    'Add the canvas as an option',
    'Add an option to the model',
    'Add an option for each decision',
  ])('LIE: %j names the container through its own trigger', (message) => {
    const d = detectAddOptionIntent(message);
    expect(d.matched, `"${message}" must not mint the container`).toBe(false);
    if (d.matched) return;
    expect(d.reason).toBe('target_not_a_label');
  });

  it.each([
    ['Add an option called The Big Bet', 'The Big Bet'],
    ['Add "The Berlin office" as an option', 'The Berlin office'],
    ['Add an option named "A Clean Break"', 'A Clean Break'],
    ['Add a "The Big Bet" option', 'The Big Bet'],
    // ⚠ AND THE TWIN THAT MAKES THE TWO TRIGGERS DIFFERENT QUESTIONS. The
    // `as an option` frame ALREADY says X is the option, so a determiner there
    // proves nothing — only a CONTAINER reference is a target. Screening this
    // trigger with the prepositional rule declines the rows beneath this note.
    ['Add the Berlin office as an option', 'Berlin office'],
    ['Add the Poland joint venture as an option', 'Poland joint venture'],
    // NB the possessive is NOT stripped — tidyLabel strips the|a|an only, so
    // 'my' stays as part of what the user wrote. Oracle corrected at the bytes.
    ['Add my preferred supplier as an option', 'My preferred supplier'],
  ])('GAP: %j is the user’s own name and must survive', (message, expected) => {
    const d = detectAddOptionIntent(message);
    expect(d.matched, `"${message}" must survive`).toBe(true);
    if (!d.matched) return;
    expect(d.label).toBe(expected);
  });

  it('the two inferring triggers apply DIFFERENT predicates — the discriminating pair', () => {
    // Same words, different frame, opposite answers. Collapse the two and one
    // of these flips.
    expect(detectAddOptionIntent('Add an option to the big bet').matched).toBe(false);
    expect(detectAddOptionIntent('Add the big bet as an option').matched).toBe(true);
    // ...and the container test is what separates them.
    expect(mentionsContainer('the model')).toBe(true);
    expect(mentionsContainer('the big bet')).toBe(false);
  });
});

describe('⭐⭐ THE GAPS THIS MODULE SHIPS OPEN, ASSERTED AS AN EXACT SET', () => {
  // A gap recorded in the suite is honest; a gap invisible to it is how four
  // rounds happened. These REDs if the set SHRINKS (someone closed one — move
  // it out and say so) and if it GROWS (a new gap arrived — say so).
  it('every KNOWN_OPEN_CONTAINER_GAP case still mints the container — the set has not shrunk', () => {
    for (const message of KNOWN_OPEN_CONTAINER_GAP) {
      const d = detectAddOptionIntent(message);
      expect(d.matched, `"${message}" now DECLINES — the gap closed; move it out of the set`).toBe(true);
    }
  });

  it('...and nothing outside the set is silently in it — the container class is otherwise closed', () => {
    // The contrast control. Every noun the alphabet DOES carry must decline, so
    // a shrinking CONTAINER_NOUNS list REDs here rather than quietly widening
    // the known-open set.
    for (const n of CONTAINER_NOUNS) {
      const d = detectAddOptionIntent(`Add an option to each ${n}`);
      expect(d.matched, `"each ${n}" is in the alphabet and must decline`).toBe(false);
    }
  });

  it('CLOSED: a coordinated second instruction no longer rides inside the label', () => {
    for (const message of CLOSED_COORDINATED_INSTRUCTION) {
      const d = detectAddOptionIntent(message);
      expect(d.matched, `"${message}" drops a user instruction and must decline`).toBe(false);
      if (d.matched) continue;
      expect(d.reason).toBe('compound_edit');
    }
  });

  it('...while the QUOTED form of the same message still declines — the bound is the quoting', () => {
    const d = detectAddOptionIntent(
      'Add "Partner with a distributor" as an option and remove the old one',
    );
    expect(d.matched).toBe(false);
    if (d.matched) return;
    expect(d.reason).toBe('compound_edit');
  });

  it('both known-open sets are non-empty — an empty set would pass vacuously', () => {
    expect(KNOWN_OPEN_CONTAINER_GAP.length).toBeGreaterThan(3);
    expect(CLOSED_COORDINATED_INSTRUCTION.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// ⭐⭐ THE DISCRIMINATORS A MUTANT KIT FORCED, AND WHY THEY ARE NOT
// REDUNDANT WITH THE CASES ABOVE.
//
// Three mutations SURVIVED the first kit against this file: dropping
// `explicitlyNamed` entirely, replacing the `as an option` conjunction with the
// container test alone, and DELETING A NOUN from `CONTAINER_NOUNS`. None was an
// equivalent mutant — each was a real hole:
//   · no explicitly-named case in the corpus mentioned a container, so the
//     screen could be widened to every trigger and nothing noticed;
//   · no verb phrase in the corpus mentioned a container, so `isTargetReference`
//     could be dropped from that branch and nothing noticed;
//   · the container control is GENERATED FROM the alphabet it certifies, so it
//     shrank with the list and stayed green — a derived guard proving the copies
//     agree and never that the list is right.
// A survivor is a claim either way and has to be demonstrated. These are the
// demonstrations.
// ---------------------------------------------------------------------------

describe('the screen’s two conjunctions each bite, on their own case', () => {
  it.each([
    ['Add an option called The Model Overhaul', 'The Model Overhaul'],
    ['Add "The pricing decision review" as an option', 'The pricing decision review'],
    ['Add a "Model refresh" option', 'Model refresh'],
  ])('EXPLICITLY NAMED survives even when the name mentions the container: %j', (message, expected) => {
    // Drop `explicitlyNamed` and every row above REDs. Without a container noun
    // inside an explicitly-named label, widening the screen to every trigger
    // passes every other test in this file.
    const d = detectAddOptionIntent(message);
    expect(d.matched, `"${message}" is the user's own name and must survive`).toBe(true);
    if (!d.matched) return;
    expect(d.label).toBe(expected);
  });

  it.each([
    ['Add franchise the model as an option', 'Franchise the model'],
    ['Add rebuild the pricing model as an option', 'Rebuild the pricing model'],
  ])('a VERB PHRASE mentioning the container is still an ordinary add: %j', (message, expected) => {
    // Drop `isTargetReference` from the `as an option` branch and these RED.
    const d = detectAddOptionIntent(message);
    expect(d.matched, `"${message}" must survive`).toBe(true);
    if (!d.matched) return;
    expect(d.label).toBe(expected);
  });

  it('⭐ CONTAINER_NOUNS is pinned BY HAND — a generated control cannot see it SHRINK', () => {
    // The hand-written half. The generated contrast control above cannot fail
    // when the alphabet loses a member, because it iterates that same alphabet.
    expect([...CONTAINER_NOUNS].sort()).toEqual(
      [
        'analysis', 'board', 'canvas', 'decision', 'diagram', 'graph', 'list',
        'map', 'mix', 'model', 'page', 'plan', 'project', 'scenario', 'set',
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// ⭐ THE COORDINATED-INSTRUCTION SCREEN — both columns, measured independently.
// Proposed by an independent reviewer after this PR reverted an edit-verb-only
// screen that collided with "set up a joint venture". This one requires the
// CONJUNCTION BEFORE the verb and excludes `set` and `add`.
// ---------------------------------------------------------------------------
describe('a coordinated second instruction is a DROPPED INSTRUCTION, not a name', () => {
  it.each(CLOSED_COORDINATED_INSTRUCTION)('LIE: %j must decline', (message) => {
    const d = detectAddOptionIntent(message);
    expect(d.matched, `"${message}" silently drops half of what the user asked for`).toBe(false);
    if (d.matched) return;
    expect(d.reason).toBe('compound_edit');
  });

  it.each([
    // OPPOSITE DIRECTION. Labels that BEGIN with an edit verb, and
    // coordinations of nouns, must be untouched — this is where the reverted
    // verb-only screen died.
    'Add an option to set up a joint venture',
    'Add an option to remove the middleman',
    'Add an option to change supplier',
    'Add an option to merge with a rival',
    'Add an option to increase prices gradually',
    'Add an option to buy and build',
    'Add an option to expand into Germany and France',
    'Add an option to partner with Siemens and Bosch',
    'Add an option to acquire and integrate a competitor',
    'Add an option to open a Berlin office and a Munich hub',
    'Add an option to hire and train locally',
  ])('GAP: %j is a legitimate name and must stay claimed', (message) => {
    expect(detectAddOptionIntent(message).matched, `"${message}" must survive`).toBe(true);
  });

  it('⭐ IMMUNE to the historical ", and" class this estate ruled unwinnable', () => {
    // Four rounds oscillated on a coordination-boundary predicate over ", and".
    // This screen only fires when an EDIT VERB follows the conjunction, so the
    // constraint sentences from that work cannot reach it. Claimed immunity is
    // still a claim — this is the measurement.
    for (const s of [
      'Do not, and this is firm, let gross margin drop below 78%',
      'Do not, under any circumstances, let gross margin drop below 78%',
      'Keep churn under 5%, and margin above 40%',
      'We must not, and I mean this, drop below 78% margin',
      'Hold price, and do not discount',
    ]) {
      expect(
        /\b(?:,\s*)?(?:and|then|and then)\s+(?:remove|delete|drop|rename|replace|update|change|increase|decrease|raise|lower|configure|split|merge|reset|edit|adjust)\b/i.test(s),
        `the screen must not fire on "${s}"`,
      ).toBe(false);
    }
  });

  it('⚠ THE PRICE, pinned: a NAME that coordinates two actions now declines', () => {
    // Not free, and the reviewer's 19-row corpus could not see it — none of its
    // rows coordinates a SECOND VERB from the list. These are GAPS (the generic
    // edit lane serves them), traded deliberately against a dropped
    // instruction, which is a LIE.
    for (const message of KNOWN_OPEN_COORDINATED_NAME) {
      const d = detectAddOptionIntent(message);
      expect(
        d.matched,
        `"${message}" now CLAIMS — the gap closed; move it out of KNOWN_OPEN_COORDINATED_NAME and say so`,
      ).toBe(false);
    }
  });

  it('⭐ the EDIT-VERB list is pinned BY HAND — a derived check cannot see it shrink', () => {
    // Same lesson as CONTAINER_NOUNS: every other assertion here is generated
    // from the screen itself, so only a hand-written list observes a deletion.
    const src = COORDINATED_EDIT_INSTRUCTION_SOURCE;
    for (const v of [
      'remove', 'delete', 'drop', 'rename', 'replace', 'update', 'change',
      'increase', 'decrease', 'raise', 'lower', 'configure', 'split', 'merge',
      'reset', 'edit', 'adjust',
    ]) {
      expect(src, `"${v}" must remain in the coordinated-edit verb list`).toContain(v);
    }
    // ...and the two deliberate EXCLUSIONS, which are what let the screen
    // coexist with the verb-collision class.
    expect(src).not.toContain('|set|');
    expect(src).not.toContain('|add|');
  });
});

// ---------------------------------------------------------------------------
// ⭐ PUNCTUATION IS A SEPARATOR, NOT A NAMING WORD.
// `explicitlyNamed` switches the entire target screen off, so the naming
// alternation is a PERMISSION LIST — and `:` `-` `–` `—` were in it.
// ---------------------------------------------------------------------------
describe('a separator never confers "the user named this"', () => {
  it.each([
    // Determiner-led targets straight through the bypass.
    'Add an option: the model',
    'Add an option - the pricing decision',
    'Add an option: each decision',
    "Add an option - Paul's model",
    'Add an option — the canvas',
    'Add an option – the graph',
    // ⭐ The hedges, which are the worst of it: the product was minting these
    // as the NAME of a strategic option.
    'Add an option: TBD',
    'Add an option - not sure which yet',
    'Add an option: can we brainstorm together',
    'Add an option - your call',
    // ...and the hyphen matched INSIDE a word.
    'Add an option-level breakdown of the risks',
  ])('LIE: %j must not be minted as an option name', (message) => {
    expect(detectAddOptionIntent(message).matched, `"${message}" must decline`).toBe(false);
  });

  it.each([
    // CONTROL: real naming WORDS are untouched.
    ['Add an option called Outsource to Poland', 'Outsource to Poland'],
    ['Add an option named "Acquire a local competitor"', 'Acquire a local competitor'],
    ['Add an option called The Big Bet', 'The Big Bet'],
    ['Add an option titled Stay UK-only', 'Stay UK-only'],
  ])('GAP: %j is named by a WORD and must survive', (message, expected) => {
    const d = detectAddOptionIntent(message);
    expect(d.matched, `"${message}" must survive`).toBe(true);
    if (!d.matched) return;
    expect(d.label).toBe(expected);
  });

  it('a naming word needs WHITESPACE on both sides — it is a word, not a substring', () => {
    // Demonstrating a survivor rather than asserting it was equivalent:
    // loosening the two `\\s+` back to `\\s*` makes "calledOutsource" claim
    // "Outsource". Degenerate input, real discrimination, one line to pin.
    expect(detectAddOptionIntent('Add an option calledOutsource').matched).toBe(false);
    expect(detectAddOptionIntent('Add an optioncalled Outsource').matched).toBe(false);
    expect(detectAddOptionIntent('Add an option called Outsource').matched).toBe(true);
  });

  it('⭐ NAMING_WORDS is pinned BY HAND — a corpus generated from it shrinks with it', () => {
    // The defect found at 0e703c71: every derived assertion loses its own case
    // when the list loses a member. This is the only assertion that can see a
    // deletion, and the only one that can see punctuation creep back in.
    expect([...NAMING_WORDS]).toEqual(['called', 'named', 'titled', 'labelled', 'labeled']);
    for (const sep of [':', '-', '–', '—']) {
      expect(NAMING_WORDS as readonly string[], `"${sep}" must never be a naming word`).not.toContain(sep);
    }
  });

  it.each(KNOWN_OPEN_SEPARATOR_NAMING)('⚠ THE PRICE, pinned: %j is now a gap', (message) => {
    expect(
      detectAddOptionIntent(message).matched,
      `"${message}" now CLAIMS — the gap closed; move it out of KNOWN_OPEN_SEPARATOR_NAMING and say so`,
    ).toBe(false);
  });
});

describe('⚠ ANAPHORA ships OPEN — a pointer is not a name, and pointers are an open class', () => {
  it.each(KNOWN_OPEN_ANAPHORA)('KNOWN-OPEN, still open: %j', (message) => {
    expect(
      detectAddOptionIntent(message).matched,
      `"${message}" now DECLINES — the gap closed; move it out of KNOWN_OPEN_ANAPHORA and say so`,
    ).toBe(true);
  });

  it('the DISCRIMINATING CONTROL: a determiner-led phrase with a real referent is a NAME', () => {
    // This is why the class is not closed by widening GENERIC_LABELS: the
    // pointers and the names have the same shape.
    const d = detectAddOptionIntent('Add the Berlin office as an option');
    expect(d.matched).toBe(true);
    if (!d.matched) return;
    expect(d.label).toBe('Berlin office');
  });

  it('both new sets are exact-length — they RED if they grow or shrink', () => {
    expect(KNOWN_OPEN_ANAPHORA.length).toBe(9);
    expect(KNOWN_OPEN_SEPARATOR_NAMING.length).toBe(4);
    expect(KNOWN_OPEN_DEFERRAL_LABEL.length).toBe(2);
  });
});

describe('the courtesy-prefix header now matches the code', () => {
  it('INTERROGATIVE deliberation is excluded — by QUESTION_LEAD, as the header now says', () => {
    for (const m of [
      'Should we add an option to think about this later',
      'Would it be worth adding an option to expand',
      'What if we add an option to expand',
    ]) {
      expect(detectAddOptionIntent(m).matched, m).toBe(false);
    }
  });

  it('DIRECTIVE first-person openers are accepted — deliberately, and the header says so', () => {
    const d = detectAddOptionIntent('We should add an option called Outsource to Poland');
    expect(d.matched).toBe(true);
    if (!d.matched) return;
    expect(d.label).toBe('Outsource to Poland');
  });

  it.each(KNOWN_OPEN_DEFERRAL_LABEL)('KNOWN-OPEN, still open: %j', (message) => {
    expect(
      detectAddOptionIntent(message).matched,
      'this now DECLINES — move it out of KNOWN_OPEN_DEFERRAL_LABEL and say so',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⭐⭐ EVERY ALPHABET CARRIES A HAND-WRITTEN PIN — closing the CLASS, not the
// two instances that were found.
//
// `CONTAINER_NOUNS` and `NAMING_WORDS` were pinned by hand after a mutant proved
// a generated control cannot see its own list shrink: the corpus is built FROM
// the alphabet, so deleting an entry deletes its own test case and the suite
// stays green — the test COUNT dropping by one was the only tell.
//
// The determiner alphabets had exactly the same hole and were left open, which
// is the instance-vs-class error this PR kept demonstrating.
//
// ⚠ AND A SENTENCE COUNTING THE ALPHABETS WAS WRONG WHILE THE PINS BESIDE IT
// WERE RIGHT — twice, in two files, both times understating them. The one it
// missed is `OPTION_NOUN_DETERMINERS`, which BUILDS the recogniser regex and
// was already hand-pinned: `DETERMINER_FRAGMENT` is asserted byte-for-byte
// against the historical literal, with a positive control proving a reorder
// breaks it.
//
// ⭐⭐ THE RULE THAT CAME OUT OF IT, stated exactly, because it has two halves
// and getting either wrong costs a round:
//
//   · DELETE a number that RESTATES A LIST THE READER CAN SEE. It is a
//     hand-maintained mirror with a sample size of one — no test sees it, no
//     reader recounts it. It went wrong four times in this PR: twice by drift,
//     and twice BORN WRONG at authoring ("EIGHT of these are also verbs" beside
//     a parenthetical listing ten; "these three" above a four-entry array —
//     neither ever true at any commit).
//
//   · KEEP a number that COUNTS A CLOSED SET DECLARED ELSEWHERE. The reader
//     cannot recover it from the line, so it carries information. "all five
//     triggers" is this, and a sweep deleted it as though it were a mirror —
//     severing a sentence in the process. THEN PIN IT: see
//     `ALL_ADD_OPTION_TRIGGERS`, whose exhaustiveness the compiler enforces.
//
//   · KEEP dated measurements ("10 of 10 probes lost", "left all 353 green")
//     and quotations. They record what happened and cannot drift; rewriting
//     them would falsify the record.
//
// ⚠ AND THE HONEST SCOPE OF THIS SWEEP, because a claim to have closed a class
// is exactly the kind of sentence that tells the next reader to stop looking.
// It was applied ONCE, to these two files, over the QUANTIFIER forms ("the ten
// pairs", "EIGHT of these", "four punctuation marks") and the DEMONSTRATIVE
// forms ("these three", "all three of these"), each swept with a contrast
// control so an empty result meant something. PROSE IS WRITTEN CONTINUOUSLY, so
// this is a rule applied at a point in time, NOT a permanently closed class —
// the same standing the sampled floor has. The next comment written can
// reintroduce it, and nothing here will notice.
//
// THE LIST IS THE RECORD. The assertions below name every alphabet
// individually, so they cannot disagree with a sentence that states no total.
// ---------------------------------------------------------------------------
describe('the trigger set is closed, and "all five" is a checked claim', () => {
  it('ALL_ADD_OPTION_TRIGGERS has exactly five members', () => {
    // The prose says "all five triggers" in two places and quotes it in a
    // third. This is what makes that a claim rather than a sentence. The
    // COMPILER catches an omission from the union (`_TriggersExhaustive`); this
    // catches the count drifting away from the prose.
    expect(ALL_ADD_OPTION_TRIGGERS.length).toBe(5);
    expect([...ALL_ADD_OPTION_TRIGGERS].sort()).toEqual([
      'option_called', 'option_to', 'quoted_as_option', 'quoted_option_noun',
      'unquoted_as_option',
    ]);
  });

  it('every trigger is reachable — the set is not aspirational', () => {
    // A pinned list nothing can produce would be a guard agreeing with itself.
    const seen = new Set<string>();
    for (const m of [
      'Add "Partner with a distributor" as an option',
      'Add Partner with a distributor as an option',
      'Add an option called Stay UK-only',
      'Add an option to expand into Germany',
      'Add a "Do nothing" option',
    ]) {
      const d = detectAddOptionIntent(m);
      if (d.matched) seen.add(d.trigger);
    }
    expect([...seen].sort()).toEqual([...ALL_ADD_OPTION_TRIGGERS].sort());
  });
});

describe('every alphabet in this module is pinned BY HAND', () => {
  it('TARGET_DEFINITE_DETERMINERS — the presupposing determiners, exactly', () => {
    expect([...TARGET_DEFINITE_DETERMINERS].sort()).toEqual([
      'her', 'his', 'its', 'my', 'our', 'that', 'the', 'their', 'these', 'this',
      'those', 'whose', 'your',
    ]);
  });

  it('TARGET_QUANTIFIER_DETERMINERS — the rest of the closed class, exactly', () => {
    expect([...TARGET_QUANTIFIER_DETERMINERS].sort()).toEqual([
      'a', 'all', 'an', 'another', 'any', 'both', 'each', 'either', 'enough',
      'every', 'few', 'fewer', 'fifth', 'final', 'first', 'five', 'four',
      'fourth', 'half', 'last', 'least', 'less', 'little', 'many', 'more',
      'most', 'much', 'neither', 'next', 'no', 'none', 'one', 'other', 'plenty',
      'same', 'second', 'several', 'some', 'such', 'third', 'three', 'two',
      'what', 'whatever', 'which', 'whichever',
    ]);
  });

  it('the two determiner alphabets stay DISJOINT — a word may not carry two rules', () => {
    // The definite half presupposes a referent and is a target whatever the head
    // noun; the quantifier half needs a container noun. A word in both would
    // silently take whichever rule is tested first.
    //
    // Proven by COPYING `same` into the definite alphabet — an insert, leaving
    // the quantifier entry in place, so both lists still contain it. (An
    // earlier note called this mutation a "move"; it was never a move, and the
    // distinction matters: a move would relocate the word and this assertion
    // would stay green, whereas a copy is what actually creates the ambiguity.)
    const overlap = TARGET_DEFINITE_DETERMINERS.filter((w) =>
      (TARGET_QUANTIFIER_DETERMINERS as readonly string[]).includes(w),
    );
    expect(overlap).toEqual([]);
  });

  it('⭐ GENERIC_LABELS is pinned BY HAND — the sixth list, and the only defence', () => {
    // The module's header calls this "the only defence" against the anaphora
    // class, which this module deliberately ships OPEN. It had NO shrink pin:
    // deleting an entry left all 353 tests green, while deleting a
    // CONTAINER_NOUNS entry REDs two named tests — so the suite could see
    // shrinkage in general and simply could not see it here.
    //
    // ⚠ THIS GUARDS DRIFT, NOT MEMBERSHIP. Whether these are the right members is a
    // separate question this PR does not answer. Do not widen it here.
    expect([...GENERIC_LABELS].sort()).toEqual([
      'a new one', 'another one', 'here', 'it', 'one', 'something', 'that',
      'the new one', 'there', 'this',
    ]);
    expect(GENERIC_LABELS.size).toBe(10);
  });

  it('every alphabet is hand-pinned — the completeness check on this suite', () => {
    // A derived guard proves the copies agree and can never prove a list is
    // right. These are the only assertions in this file that can see an
    // alphabet SHRINK.
    //
    // ⚠ The fifth entry is not decoration: `OPTION_NOUN_DETERMINERS` builds the
    // recogniser regex, and a comment claiming "four alphabets" left it
    // uncounted here while it was in fact pinned elsewhere (see the
    // DETERMINER_FRAGMENT block). Counted explicitly so the sentence and the
    // assertions cannot drift apart again.
    expect(TARGET_DEFINITE_DETERMINERS.length).toBe(13);
    expect(TARGET_QUANTIFIER_DETERMINERS.length).toBe(46);
    expect(CONTAINER_NOUNS.length).toBe(15);
    expect(NAMING_WORDS.length).toBe(5);
    expect(OPTION_NOUN_DETERMINERS.length).toBe(12);
  });
});
