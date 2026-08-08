/**
 * `deriveConversationTextSignals` — the TEXT input class for DSK lens selection
 * (ROADMAP 2.643 slice T1; design `DSK-SELECTOR-INPUT-CLASSES-DESIGN-2026-08-06.md` §3).
 *
 * Written RED-first at pristine `98f2476a`: every signature below names the
 * behaviour before the module exists.
 *
 * THREE THINGS THIS FILE IS DELIBERATELY BUILT TO DO:
 *
 * 1. **Presence control before every absence assertion (trap 13).** Both text
 *    triggers fire on the ABSENCE of vocabulary, so an absence assertion over a
 *    corpus the scan cannot see is vacuous. Every "absent" case here is paired
 *    with the SAME corpus carrying the phrase, asserted present. A scanner that
 *    always returned `false` would pass the absence half and RED the presence half.
 *
 * 2. **Attest the phrase lists against the BUNDLE BYTES (trap 12).** The two
 *    lists are hand-copied constants — a hand-maintained mirror of
 *    `data/dsk/v1.json`. They are asserted to appear VERBATIM inside the
 *    corresponding trigger's `observable_signal`, so a bundle revision that
 *    renames a phrase REDs here instead of silently forking the rule. Per trap
 *    12d this proves AGREEMENT with the bundle, never that the bundle's list is
 *    right — the bundle owns list quality, and its own "not production quality"
 *    label is carried into the module header.
 *
 * 3. **Bind by identity, not by a value predicate (trap 19).** The completeness
 *    verdict is asserted as the exact boolean on the exact field, and the
 *    truncation case pins WHICH input caused it (total > window length), not
 *    merely "some falsy result appeared".
 *
 * Reads the bundle FILE directly, matching `dsk-provenance-attestation.test.ts`:
 * the loader is env-flag-gated (`DSK_ENABLED`) and these rules must hold with
 * the flag OFF.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  REFERENCE_CLASS_PHRASES,
  TRADE_OFF_PHRASES,
  deriveConversationTextSignals,
} from '../conversation-text-signals.js';

import type { SessionTurnWithContent } from '../../session/conversation-content.js';

// ── bundle bytes, for the attestation ────────────────────────────────────────

interface BundleObject {
  readonly id: string;
  readonly type: string;
  readonly observable_signal?: string;
}

const bundle = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'data/dsk/v1.json'), 'utf-8'),
) as { objects: BundleObject[] };

function observableSignal(triggerId: string): string {
  const obj = bundle.objects.find((o) => o.id === triggerId);
  if (!obj || typeof obj.observable_signal !== 'string') {
    throw new Error(`${triggerId} missing observable_signal in data/dsk/v1.json`);
  }
  return obj.observable_signal;
}

// ── fixtures ─────────────────────────────────────────────────────────────────

/**
 * A turn carrying content. Only the two content fields matter to the scan; the
 * rest of `SessionTurn` is structural padding, cast once here so the intent of
 * each test stays visible.
 */
function turn(user_message: string | null, assistant_message: string | null): SessionTurnWithContent {
  return { user_message, assistant_message } as unknown as SessionTurnWithContent;
}

describe('deriveConversationTextSignals — phrase detection (T1-1)', () => {
  it('detects a reference-class phrase in the CURRENT user message, and reports absence when it is removed', () => {
    const withPhrase = deriveConversationTextSignals('we think the base rate is about 30%', [], 0);
    expect(withPhrase.referenceClassVocabularyPresent).toBe(true);

    // Same corpus, phrase removed — the presence control's negative half.
    const without = deriveConversationTextSignals('we think it is about 30%', [], 0);
    expect(without.referenceClassVocabularyPresent).toBe(false);
  });

  it('detects a reference-class phrase in a PRIOR USER message', () => {
    const turns = [turn('what does the reference class look like', 'noted')];
    expect(deriveConversationTextSignals('go on', turns, 1).referenceClassVocabularyPresent).toBe(true);
  });

  it('detects a reference-class phrase in a PRIOR ASSISTANT message (I2: both speakers)', () => {
    const turns = [turn('go on', 'projects like this typically slip by a quarter')];
    expect(deriveConversationTextSignals('ok', turns, 1).referenceClassVocabularyPresent).toBe(true);
  });

  it('is case-insensitive in both directions', () => {
    expect(
      deriveConversationTextSignals('BASE RATE matters here', [], 0).referenceClassVocabularyPresent,
    ).toBe(true);
    expect(
      deriveConversationTextSignals('BaSe RaTe matters here', [], 0).referenceClassVocabularyPresent,
    ).toBe(true);
  });

  it('detects a trade-off phrase, and reports absence when it is removed (TR-004 list)', () => {
    expect(deriveConversationTextSignals('what is the opportunity cost', [], 0).tradeOffVocabularyPresent).toBe(
      true,
    );
    expect(deriveConversationTextSignals('what is the cost', [], 0).tradeOffVocabularyPresent).toBe(false);
  });

  it('keeps the two vocabularies INDEPENDENT — a trade-off phrase does not set the reference-class flag', () => {
    const s = deriveConversationTextSignals('what is the opportunity cost', [], 0);
    expect(s.tradeOffVocabularyPresent).toBe(true);
    expect(s.referenceClassVocabularyPresent).toBe(false);
  });
});

describe('deriveConversationTextSignals — numeric estimate (T1-1b)', () => {
  it('reads USER text only: a digit in a USER message sets the flag', () => {
    expect(deriveConversationTextSignals('about 30% I reckon', [], 0).numericEstimatePresent).toBe(true);
  });

  it('a digit in an ASSISTANT message does NOT set the flag (clause is "user provides a numeric estimate")', () => {
    const turns = [turn('no numbers from me', 'I estimate 30% for that branch')];
    expect(deriveConversationTextSignals('still none', turns, 1).numericEstimatePresent).toBe(false);
  });

  it('is false on wholly non-numeric user text', () => {
    expect(deriveConversationTextSignals('no numbers at all', [], 0).numericEstimatePresent).toBe(false);
  });
});

describe('deriveConversationTextSignals — fail-closed completeness (T1-2, invariant I3)', () => {
  it('is complete when the window holds every turn and all content is present', () => {
    const turns = [turn('a', 'b'), turn('c', 'd')];
    const s = deriveConversationTextSignals('now', turns, 2);
    expect(s.windowComplete).toBe(true);
    expect(s.scannedTurnCount).toBe(2);
  });

  it('is INCOMPLETE when the store total exceeds the window length (truncation)', () => {
    const turns = [turn('a', 'b'), turn('c', 'd')];
    // Precondition pin (trap 13b): the SAME corpus is complete at total === length,
    // so the incompleteness below is provably the TOTAL's doing, not the content's.
    expect(deriveConversationTextSignals('now', turns, 2).windowComplete).toBe(true);
    expect(deriveConversationTextSignals('now', turns, 57).windowComplete).toBe(false);
  });

  it('is INCOMPLETE when an in-window user_message is null (pre-migration row)', () => {
    const complete = [turn('a', 'b')];
    const holed = [turn(null, 'b')];
    // Precondition pin: identical shape, only the null differs.
    expect(deriveConversationTextSignals('now', complete, 1).windowComplete).toBe(true);
    expect(deriveConversationTextSignals('now', holed, 1).windowComplete).toBe(false);
  });

  it('is INCOMPLETE when an in-window assistant_message is null', () => {
    expect(deriveConversationTextSignals('now', [turn('a', null)], 1).windowComplete).toBe(false);
  });

  it('is INCOMPLETE when the store total is UNKNOWN (null) — absence over an unknown corpus is vacuous', () => {
    expect(deriveConversationTextSignals('now', [turn('a', 'b')], null).windowComplete).toBe(false);
  });

  it('an empty conversation with a known total of 0 is COMPLETE (the first turn is scannable)', () => {
    const s = deriveConversationTextSignals('first message', [], 0);
    expect(s.windowComplete).toBe(true);
    expect(s.scannedTurnCount).toBe(0);
  });

  it('still reports the vocabulary it DID see on an incomplete window (completeness is the caller’s gate, not a mask)', () => {
    // The module reports what it saw; invariant I3 is enforced by the CONSUMER
    // refusing to fire on `windowComplete === false`. Masking here would hide a
    // real presence and make the consumer's suppression untestable.
    const s = deriveConversationTextSignals('the base rate is 30%', [turn('a', 'b')], 99);
    expect(s.windowComplete).toBe(false);
    expect(s.referenceClassVocabularyPresent).toBe(true);
  });
});

describe('deriveConversationTextSignals — stable shape (T1-4)', () => {
  it('stamps signalVersion 1', () => {
    expect(deriveConversationTextSignals('x', [], 0).signalVersion).toBe(1);
  });

  it('counts scanned turns as the window length actually read', () => {
    expect(deriveConversationTextSignals('x', [turn('a', 'b'), turn('c', 'd'), turn('e', 'f')], 3).scannedTurnCount).toBe(
      3,
    );
  });
});

describe('phrase lists — attested against data/dsk/v1.json bytes (T1-3, trap 12)', () => {
  it('every reference-class phrase appears VERBATIM in DSK-TR-002 observable_signal', () => {
    const signal = observableSignal('DSK-TR-002').toLowerCase();
    expect(REFERENCE_CLASS_PHRASES.length).toBeGreaterThan(0);
    for (const phrase of REFERENCE_CLASS_PHRASES) {
      expect(signal, `TR-002 must contain "${phrase}"`).toContain(phrase);
    }
  });

  it('every trade-off phrase appears VERBATIM in DSK-TR-004 observable_signal', () => {
    const signal = observableSignal('DSK-TR-004').toLowerCase();
    expect(TRADE_OFF_PHRASES.length).toBeGreaterThan(0);
    for (const phrase of TRADE_OFF_PHRASES) {
      expect(signal, `TR-004 must contain "${phrase}"`).toContain(phrase);
    }
  });

  it('pins the EXACT reference-class list, so a silent addition or drop REDs (identity, not count)', () => {
    expect([...REFERENCE_CLASS_PHRASES]).toEqual([
      'base rate',
      'reference class',
      'typically',
      'historically',
      'similar decisions',
      'compared to',
      'on average',
    ]);
  });

  it('pins the EXACT trade-off list', () => {
    expect([...TRADE_OFF_PHRASES]).toEqual([
      'opportunity cost',
      'trade-off',
      'giving up',
      'instead of',
      'alternative use',
      'what else could',
      'other options',
    ]);
  });

  it('every phrase is already lower-cased (the scan lower-cases both ends; an upper-cased constant could never match)', () => {
    for (const phrase of [...REFERENCE_CLASS_PHRASES, ...TRADE_OFF_PHRASES]) {
      expect(phrase).toBe(phrase.toLowerCase());
    }
  });
});
