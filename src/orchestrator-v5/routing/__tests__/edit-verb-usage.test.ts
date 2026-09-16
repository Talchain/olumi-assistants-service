/**
 * An edit verb that is a noun, or a description of how things ARE, is not an
 * instruction.
 *
 * Captured hiring session 82f31082, 15 Sep 2026, from the user's own debug
 * export. Three turns reached the V4 edit LLM on a word that was never a
 * command, and two of them carried requirements that the assessment records as
 * never reaching the graph.
 *
 * THE SAFETY DIRECTION IS THE POINT OF THIS SUITE. Suppressing a genuine edit
 * is worse than leaving a question in the editor: the user watches their
 * instruction do nothing and has no way to tell why. So the EDIT half of the
 * independently-authored corpus is asserted in full, and it is what forced the
 * closed-class opener test into the module — the first version of the predicate
 * silently suppressed two of its rows.
 */

import { describe, expect, it } from 'vitest';

import {
  EDIT_VERBS,
  hasOnlyNonInstructionalEditVerbs,
} from '../edit-verb-usage.js';
import { EDIT_GRAPH_POSITIVE_REGEX } from '../../../orchestrator/routing/edit-graph-intent-regex.js';
import { CORPUS } from './mutation-warrant-explicit-veto.test.js';

describe('the verb list does not drift from the gate it mirrors', () => {
  it('EDIT_VERBS covers every verb EDIT_GRAPH_POSITIVE_REGEX alternates over', () => {
    // DERIVED from the canonical regex's own source, so adding a verb there
    // fails here instead of silently leaving this module half-blind. This
    // module cannot import the regex directly — it needs each verb's OFFSET,
    // which a combined boolean regex does not expose — so the mirror is made to
    // fail loud rather than left to rot.
    const canonical = /\(([^)]+)\)/.exec(EDIT_GRAPH_POSITIVE_REGEX.source)?.[1];
    expect(canonical, 'could not read the canonical alternation').toBeDefined();
    const canonicalVerbs = (canonical ?? '').split('|').sort();
    expect([...EDIT_VERBS].sort()).toEqual(canonicalVerbs);
  });
});

describe('captured turns whose edit verb was never a command', () => {
  it.each([
    [
      'turn 8 — the launch-timing requirement, on the NOUN "update"',
      'This is my question: we have a goal of launching our next product update in 6 months, and therefore a requirement to hire or bring in whatever resource we decide upon within 3 months so that they can actually have a chance to make an impact.',
    ],
    [
      'turn 10 — the same requirement restated, same noun',
      'Also, we have to launch our next update in 6 months, so we have to have resources on board within the next 3 months to have any chance of them making an impact.',
    ],
    [
      'turn 0 — a question about state, on the passive "is not set yet"',
      'All of the outcomes and risks say that their strength is not set yet. Is that correct? Is that data missing from the model?',
    ],
  ])('%s', (_name, message) => {
    expect(EDIT_GRAPH_POSITIVE_REGEX.test(message)).toBe(true);
    expect(hasOnlyNonInstructionalEditVerbs(message)).toBe(true);
  });
});

describe('the opposite direction — captured edit intent is still an instruction', () => {
  it.each([
    [
      'turn 3 — explicit itemised edit',
      "Yes, add factor 'Senior Developer Morale', add risk 'Team Disruption from Tech Lead Hire'",
    ],
    ['turn 4 — first-person intended edit', "I want to add the risk that I've just told you about."],
    ['turn 6 — confirmation of a held proposal', 'Okay, add this, and then we can rerun the analysis.'],
  ])('%s', (_name, message) => {
    expect(hasOnlyNonInstructionalEditVerbs(message)).toBe(false);
  });
});

describe('measured against the corpus this lane did not write', () => {
  it('suppresses NO row labelled EDIT', () => {
    const suppressed = CORPUS.filter(
      (c) => c.label === 'EDIT' && hasOnlyNonInstructionalEditVerbs(c.message),
    ).map((c) => c.message);
    // Pinned as an empty list rather than a count, so a failure NAMES the edit
    // that would have been dropped instead of printing a number.
    expect(suppressed).toEqual([]);
  });

  it('the two rows that forced the closed-class opener test stay instructions', () => {
    // Both carry a real command in a second sentence, through verbs
    // (`replace`, `simplify`) that EDIT_GRAPH_POSITIVE_REGEX does not contain —
    // so the only verb this module can see is the noun `update`. Pinned by name
    // because they are the exact shape a future widening would re-break, and a
    // corpus-wide count would not say which row had gone.
    expect(
      hasOnlyNonInstructionalEditVerbs(
        'What did that update do? Replace the pricing factor with margin.',
      ),
    ).toBe(false);
    expect(
      hasOnlyNonInstructionalEditVerbs('What did that update do? Simplify the model.'),
    ).toBe(false);
  });

  it('still recognises the read-questions the corpus labels NON_EDIT', () => {
    // The benefit half. Without this the suite would pass just as well if the
    // predicate had stopped returning true for anything at all.
    const recognised = CORPUS.filter(
      (c) => c.label === 'NON_EDIT' && hasOnlyNonInstructionalEditVerbs(c.message),
    ).map((c) => c.message);
    expect(recognised.sort()).toEqual(
      [
        'What did that update do?',
        'What did the hiring cost update do?',
        'What did the update to hiring cost do?',
        'What did your customer acquisition cost change do?',
      ].sort(),
    );
  });
});
