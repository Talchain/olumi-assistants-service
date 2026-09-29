/**
 * A PROHIBITION WHOSE OBJECT IS A FACTOR IS STILL A PROHIBITION.
 *
 * ── THE MEASURED HARM (JOURNEY-WITNESSED, staging, 2026-08-24) ─────────────
 * Typed into the live product on UI `88cb7e37` / CEE `4e88390`, fresh guest:
 *
 *   "Whatever you do, don't set Rep Adoption Quality to 0.2 — that number is
 *    still disputed. Leave the model as it is and explain what the current
 *    value is doing to the ranking."
 *
 * The product replied "Updated Rep Adoption Quality from 0.7 to 0.2.", changed
 * the graph signature, and stamped the result `provenance: user_set`,
 * `source: user_override` — attributing a disputed number to the user, in the
 * shared model, on a turn that forbade the change twice and asked a question
 * it never answered.
 *
 * ── THE CAUSE, DERIVED AT THE BYTES ────────────────────────────────────────
 * `MODEL_OBJECT_LEXEMES` is exactly {model, models, graph, graphs}. In
 * `findModelObjectAfter` a token that is neither a model object nor a bridge
 * lexeme returns null, so for "...don't set Rep Adoption Quality..." the walk
 * hits "rep" and aborts. No candidate is built, so no veto is possible.
 *
 * The cue machinery was never the problem. Probed at pristine `36e4c5db`:
 * "Do not change the model." and "Don't change the model." both VETO; the two
 * factor-object forms both ALLOW.
 *
 * ── WHY THE FIX BELONGS HERE, AND WHY IT IS NOT A LONGER WORD LIST ─────────
 * Four tokens were standing in for an unbounded class: every entity label in
 * the user's own graph. The GRANT side already resolves those labels against
 * the live graph (`deterministic-value-update.ts` — `normMessage.indexOf(normLabel)`).
 * The VETO side did not. That asymmetry IS the defect: the same sentence that
 * is specific enough to authorise a write was not specific enough to forbid one.
 *
 * So the veto is given the same object domain the grant side already uses. It
 * is not a fifth lexeme; it is the model's own entities, supplied by the caller
 * that already holds them.
 *
 * ── WHAT THIS DOES NOT TOUCH ───────────────────────────────────────────────
 * The `scopedTail` short-circuit and its false-VETO class are NOT changed here.
 * That class is genuinely ambiguous ("Set X to 4.5%. Do not change the model."
 * is self-contradictory on its face), its measured consequence is loss of the
 * deterministic path rather than a dropped edit, and the documented exit for it
 * is to ASK rather than to guess. Trading a conservative wrong answer for a
 * write the user forbade would be a strictly worse error. Rowed separately.
 * "Do not change anything in the model." is a separate object-domain gap with
 * its own twins; also rowed separately, deliberately not folded in here.
 */

import { describe, it, expect } from 'vitest';

import { hasExplicitNoModelChangeIntent } from '../mutation-warrant.js';

/** The labels a real graph would supply. */
const GRAPH_LABELS = ['Rep Adoption Quality', 'Annual CRM Licensing Cost', 'Sales Team Productivity'];

/** Labels short enough, or grammatical enough, to collide with English. */
const JUNK_LABELS = ['It', 'A', 'Me', 'the current'];

describe('no-change veto — a factor named in a prohibition is a model object', () => {
  it('THE P0: a prohibition whose object is a factor in the live graph vetoes the write', () => {
    const message =
      "Whatever you do, don't set Rep Adoption Quality to 0.2 — that number is still disputed. Leave the model as it is and explain what the current value is doing to the ranking.";

    expect(
      hasExplicitNoModelChangeIntent(message, GRAPH_LABELS),
      'the product performed the exact edit this sentence forbids, and reported "Updated Rep Adoption Quality from 0.7 to 0.2"',
    ).toBe(true);
  });

  it('THE P0, reduced to one plain sentence', () => {
    expect(
      hasExplicitNoModelChangeIntent('Do not change the discount rate to 9%.', ['Discount Rate']),
      'the canonical cue and a canonical mutation verb, and the write still went through',
    ).toBe(true);
  });

  it('TWIN — the affirmative form of the SAME sentence must still be an authorised edit', () => {
    // Opposite direction. If this flipped, the fix would have made every
    // mention of a factor look like a prohibition and the product would stop
    // editing anything.
    expect(
      hasExplicitNoModelChangeIntent('Set Rep Adoption Quality to 0.2.', GRAPH_LABELS),
      'a plain instruction to set a factor is not a prohibition',
    ).toBe(false);
  });

  it('TWIN — a label that is NOT in the graph does not become a prohibition object', () => {
    // Binds the new object domain to the MODEL'S OWN ENTITIES by identity,
    // rather than to "any capitalised phrase after a negation" (trap 19). The
    // sentence is identical in shape to the P0; only the graph differs.
    expect(
      hasExplicitNoModelChangeIntent("Whatever you do, don't set Rep Adoption Quality to 0.2.", ['Annual CRM Licensing Cost']),
      'a phrase that names no entity in this graph must not widen the veto',
    ).toBe(false);
  });

  it('CONTROL — the canonical model-object prohibition is unchanged', () => {
    expect(hasExplicitNoModelChangeIntent('Do not change the model.', GRAPH_LABELS)).toBe(true);
    expect(hasExplicitNoModelChangeIntent("Don't change the model.", GRAPH_LABELS)).toBe(true);
  });

  it('CONTROL — with no labels supplied the predicate behaves exactly as before', () => {
    // Backward compatibility for every caller that has no graph in hand.
    expect(hasExplicitNoModelChangeIntent('Do not change the model.')).toBe(true);
    expect(hasExplicitNoModelChangeIntent('Set Rep Adoption Quality to 0.2.')).toBe(false);
    // …and the P0 sentence is still unvetoed WITHOUT labels, which is exactly
    // why the labels have to be threaded from the call site rather than guessed.
    expect(hasExplicitNoModelChangeIntent("Whatever you do, don't set Rep Adoption Quality to 0.2.")).toBe(false);
  });

  it('CONTROL — a label that is a pronoun, an article or a stopword phrase is refused as an object', () => {
    // This repo's own fixtures carry labels `A`, `X`, `y` and `a`. Without a
    // floor, ordinary English becomes a prohibition.
    expect(hasExplicitNoModelChangeIntent('Never reduce it below 0.3.', JUNK_LABELS)).toBe(false);
    expect(hasExplicitNoModelChangeIntent('Set Growth to 0.9, and do not change a thing.', JUNK_LABELS)).toBe(false);
    expect(hasExplicitNoModelChangeIntent('Do not update me on this.', JUNK_LABELS)).toBe(false);
    // …while a real multi-word label alongside them still works.
    expect(hasExplicitNoModelChangeIntent("Don't set Rep Adoption Quality to 0.2.", [...JUNK_LABELS, 'Rep Adoption Quality'])).toBe(true);
  });

  it('CONTROL — an empty or junk label list cannot widen or narrow the predicate', () => {
    expect(hasExplicitNoModelChangeIntent('Do not change the model.', [])).toBe(true);
    expect(hasExplicitNoModelChangeIntent('Do not change the model.', ['', '   '])).toBe(true);
    expect(hasExplicitNoModelChangeIntent('Set Rep Adoption Quality to 0.2.', ['', '   '])).toBe(false);
  });
});
