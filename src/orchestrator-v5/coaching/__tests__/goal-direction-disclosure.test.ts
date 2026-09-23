import { describe, expect, it } from 'vitest';
import {
  buildGoalDirectionDisclosure,
  GOAL_DIRECTION_DISCLOSURE_MAX_CHARS,
  GOAL_DIRECTION_DISCLOSURE_RE_SRC,
  GOAL_DIRECTION_DISCLOSURE_SURVIVES_EGRESS,
} from '../goal-direction-disclosure.js';
import { passesAssistantTextContentDefences } from '../assistant-text-defences.js';
import { TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS, MAX_ASSISTANT_TEXT_CHARS } from '../analysis-result-headline.js';

const SUFFIX = buildGoalDirectionDisclosure('minimise');

describe('it fires only when an attestation was actually sent', () => {
  it('discloses when the run attested minimise', () => {
    expect(SUFFIX).not.toBe('');
  });

  /**
   * ⛔ THE TRIGGER IS THE EMITTED VALUE, NEVER A RE-DERIVATION FROM THE LABEL.
   * A second authority answering "is this a reduce goal?" is how a disclosure
   * and the wire come to disagree. Nothing was attested ⇒ nothing is claimed.
   */
  it('says nothing when nothing was attested', () => {
    expect(buildGoalDirectionDisclosure(undefined)).toBe('');
    expect(buildGoalDirectionDisclosure(null)).toBe('');
  });

  it("says nothing for a value this product never emits", () => {
    // `deriveEmittedGoalDirection` returns 'minimise' or nothing, by type. If
    // that ever widens, this disclosure must not start speaking for a sense it
    // has no copy for.
    expect(buildGoalDirectionDisclosure('maximise' as never)).toBe('');
    expect(buildGoalDirectionDisclosure('target' as never)).toBe('');
  });
});

describe('what the copy must and must not say', () => {
  it('⛔ carries NO digits — one decimal would reject the WHOLE summary at egress', () => {
    // `assistant-text-defences` applies RAW_DECIMAL_REGEX to the entire
    // assistant_text, so a number here costs the person every other disclosure
    // and the headline with it, replaced by the locked template.
    expect(SUFFIX).not.toMatch(/\d/);
  });

  it('⛔ names no option and asserts no leader', () => {
    for (const banned of ['lead', 'wins', 'winner', 'best option', 'recommend', 'should']) {
      expect(SUFFIX.toLowerCase()).not.toContain(banned);
    }
  });

  it('⭐ states that it is a READING, distinguishable from something the user set', () => {
    // Charter: "its own assumptions… remain distinguishable… and open to
    // correction". A disclosure that stated the direction as fact would read as
    // the user's own instruction.
    expect(SUFFIX).toContain('reads as');
    expect(SUFFIX).toContain('not something you set');
  });

  it('⭐ names a correction the user can ACTUALLY make', () => {
    // The failure this refuses to repeat is the product's own
    // "Which factor does \"49\" correspond to in the decision model?" — an ask
    // the user cannot act on. The direction derives from the goal LABEL and
    // nothing else, so renaming the goal is a real one-step correction.
    expect(SUFFIX).toContain('Rename the goal');
  });

  it('is a single line', () => {
    expect(SUFFIX).not.toMatch(/[\n\r]/);
  });
});

describe('egress — it must survive its own published grammar', () => {
  it('the module asserted its own survival at import', () => {
    expect(GOAL_DIRECTION_DISCLOSURE_SURVIVES_EGRESS).toBe(true);
  });

  it('the published grammar matches the builder EXACTLY, anchored', () => {
    // Escaped from the very constants the builder emits, so a copy edit breaks
    // this loudly rather than breaking the wire silently.
    expect(new RegExp(`^(?:${GOAL_DIRECTION_DISCLOSURE_RE_SRC})$`).test(SUFFIX)).toBe(true);
  });

  it('⛔ the grammar cannot match the empty string', () => {
    // The anchored template branch of the allowlist depends on this.
    expect(new RegExp(`^(?:${GOAL_DIRECTION_DISCLOSURE_RE_SRC})$`).test('')).toBe(false);
  });

  it('passes the shared assistant-text content defences', () => {
    expect(passesAssistantTextContentDefences(SUFFIX)).toBe(true);
  });

  it('the derived budget is the builder’s own output, not an estimate', () => {
    expect(GOAL_DIRECTION_DISCLOSURE_MAX_CHARS).toBe(SUFFIX.length);
  });
});

describe('registration — the three pieces of plumbing that must all be present', () => {
  /**
   * ⛔ WHY ALL THREE. A disclosure with a grammar but no registration composes
   * correctly and is then REJECTED at egress, replacing the whole summary with
   * the locked template — strictly worse than saying nothing. The sibling
   * families each carry a spec for exactly this half.
   */
  it('the grammar is REGISTERED in the egress allowlist', () => {
    const entry = TEMPLATE_SUFFIX_DISCLOSURE_GRAMMARS.find(
      (g) => g.name === 'GOAL_DIRECTION_DISCLOSURE_RE_SRC',
    );
    expect(entry).toBeDefined();
    expect(entry?.source).toBe(GOAL_DIRECTION_DISCLOSURE_RE_SRC);
  });

  it('the length cap was extended by this family’s budget', () => {
    expect(MAX_ASSISTANT_TEXT_CHARS).toBeGreaterThanOrEqual(GOAL_DIRECTION_DISCLOSURE_MAX_CHARS);
  });

  it('a template plus this suffix is admitted by the registered grammar', () => {
    const template = 'Ran analysis on your current scenario.';
    const composed = `${template}${SUFFIX}`;
    const re = new RegExp(`${GOAL_DIRECTION_DISCLOSURE_RE_SRC}$`);
    expect(re.test(composed)).toBe(true);
  });
});
