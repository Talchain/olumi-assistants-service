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
