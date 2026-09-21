/**
 * ⭐ A HELD-CHANGE LABEL IS A DESCRIPTION, NOT A NAME — so it must never be
 * wrapped in a second layer of quotes.
 *
 * WITNESSED ON STAGING, 21 Sep 2026, reported by the panel lane:
 *   The held change 'Add 'competitor price reaction'' has lapsed.
 *
 * `public_label` describes a change ("Add 'competitor price reaction'") and
 * routinely carries its own quoted element names, because that is how the
 * estate names graph elements everywhere else. Wrapping it again produces
 * `''` and a reader cannot tell where the inner name ends.
 *
 * The corpus below is NOT invented: the labels are the shapes the producer
 * actually emits (an element name quoted inside a change description).
 */
import { describe, it, expect } from 'vitest';
import { buildHeldLapseNotice } from '../commit.js';
import { buildHoldMutationLapseNotice } from '../handlers/hold-thread-through.js';

function hold(publicLabel: string): Parameters<typeof buildHeldLapseNotice>[0] {
  return {
    action: { kind: 'apply_proposed_change', public_label: publicLabel },
  } as unknown as Parameters<typeof buildHeldLapseNotice>[0];
}

describe('buildHeldLapseNotice — never nests quotes', () => {
  const QUOTED_LABELS = [
    "Add 'competitor price reaction'",
    "add factor 'Competitor Price Reaction' and link 'Competitor Price Reaction' to 'Churn Spike on Price Rise'",
    "set 'Monthly Churn Rate' to 3%",
  ];

  it('never emits a doubled quote for a label that already quotes an element', () => {
    for (const label of QUOTED_LABELS) {
      const out = buildHeldLapseNotice(hold(label));
      expect(out, `nested quotes for ${JSON.stringify(label)}`).not.toContain("''");
      // the label must still be legible in full — suppressing it is not a fix
      expect(out).toContain(label);
    }
  });

  it('still names the change, and still says it lapsed', () => {
    const out = buildHeldLapseNotice(hold("Add 'competitor price reaction'"));
    expect(out).toContain('lapsed');
    expect(out).toContain('competitor price reaction');
  });

  /** CONTRAST CONTROL: an unquoted label must also come through intact and
   *  un-doubled, so a fix that merely strips quotes would be caught. */
  it('an unquoted label is unharmed', () => {
    const out = buildHeldLapseNotice(hold('Add a competitor price reaction factor'));
    expect(out).toContain('Add a competitor price reaction factor');
    expect(out).not.toContain("''");
  });

  it('falls back cleanly when there is no label', () => {
    const out = buildHeldLapseNotice({ action: { kind: 'apply_proposed_change' } } as never);
    expect(out).toContain('A held change has lapsed');
  });
});

/**
 * ⭐ THE SECOND PRODUCER. `hold-thread-through.ts` emits the model-changed
 * variant of the same sentence and carried the IDENTICAL defect. It was missed
 * on the first pass because the original grep was truncated with `head -5` —
 * a manifest built from a truncated list is not a manifest.
 */
describe('the model-changed lapse notice never nests quotes either', () => {
  it('does not double-quote a label that already quotes an element', () => {
    const out = buildHoldMutationLapseNotice(hold("Add 'competitor price reaction'"));
    expect(out).not.toContain("''");
    expect(out).toContain("Add 'competitor price reaction'");
    expect(out).toContain('lapsed');
  });
});
