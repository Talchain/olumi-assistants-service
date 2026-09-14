import { describe, expect, it } from 'vitest';
import {
  isFlatInterventionKey,
  parseFlatInterventionKey,
} from '../encode-option-interventions.js';

/**
 * The recogniser gap that made a valid edit fail, measured live on staging
 * 14 Sep 2026 and fixed by deriving this module's predicate from the atomicity
 * POSTCONDITION (`isInterventionSubtreeKey`, canonicalise-value-ops.ts) rather
 * than from one guessed prefix family.
 *
 * Symptom: setting an option's effect on a factor the option demonstrably
 * intervenes on returned an INTERNAL_ERROR block reading "I couldn't complete
 * that change... Try again in a moment." Nothing threw. The edit LLM wrote a
 * spelling the encoder could not see, so the write was left verbatim, stripped
 * by the GraphV3 parse, and refused by the atomicity guard —
 * OPERATION_DID_NOT_LAND. The failure is DETERMINISTIC, so the retry the copy
 * invites cannot succeed.
 */
describe('flat intervention-key recogniser', () => {
  describe('the refusal gap — spellings the postcondition accepts', () => {
    // Each of these was invisible to the old `/^data\/interventions\/(.+)$/`
    // and is accepted by `isInterventionSubtreeKey`. The asymmetry WAS the bug.
    it.each([
      ['data/interventions/fac1', 'the spelling the served prompt teaches'],
      ['interventions/fac1', 'bare root, slash'],
      ['interventions.fac1', 'bare root, dot'],
      ['observed_state/interventions/fac1', 'the canonical observed root'],
      ['data.interventions.fac1', 'dot-separated data root'],
    ])('recovers the factor id from %s (%s)', (key) => {
      expect(parseFlatInterventionKey(key)).toBe('fac1');
      expect(isFlatInterventionKey(key)).toBe(true);
    });
  });

  describe('⭐ the bundle key is NOT a flat key — a mutation here deletes saved data', () => {
    /**
     * `isInterventionSubtreeKey('interventions')` returns TRUE, and the
     * promotion sweep runs AFTER `node.interventions = bundle`. A recogniser
     * that accepted the bare key would delete the canonical bundle this module
     * has just written. This is the single most destructive mutation available
     * in the module, so it is pinned on its own.
     */
    it('never treats the canonical bundle key as a flat write', () => {
      expect(isFlatInterventionKey('interventions')).toBe(false);
      expect(parseFlatInterventionKey('interventions')).toBeUndefined();
    });

    it.each(['data', 'observed_state', 'label', 'value', 'raw_value', 'unit', 'cap', 'id', 'kind'])(
      'leaves the ordinary node key %s alone',
      (key) => {
        expect(isFlatInterventionKey(key)).toBe(false);
      },
    );
  });

  describe('⛔ KNOWN-DROPPED: field-level writes are refused honestly, never silently applied', () => {
    /**
     * The old capture group was `(.+)`, so `data/interventions/<fac>/value`
     * captured the factor id as `"<fac>/value"` — an intervention keyed on a
     * factor that does not exist. The canonical bundle then DIFFERED from the
     * pre-edit one, `batchFullyLanded` returned TRUE, and the turn reported the
     * edit APPLIED while the real factor's value never moved. A silent false
     * success about saved data is worse than an honest refusal.
     *
     * This set is pinned EXACTLY so the suite REDs if it grows OR shrinks: a new
     * member means a new silent-drop class, and a departing member means someone
     * has taught the encoder a field-level encoding and must say so here.
     */
    const KNOWN_DROPPED = [
      'data/interventions/fac1/value',
      'data/interventions/fac1/raw_value',
      'data/interventions/fac1/unit',
      'interventions/fac1/value',
      'observed_state/interventions/fac1/cap',
    ] as const;

    it.each(KNOWN_DROPPED)('does not gather %s as a factor write', (key) => {
      expect(parseFlatInterventionKey(key)).toBeUndefined();
    });

    it('still SWEEPS every known-dropped key, so no verbatim spelling survives promotion', () => {
      // Not gathered is not the same as not cleaned up: once the canonical
      // bundle is written, every verbatim spelling must leave the node.
      for (const key of KNOWN_DROPPED) {
        expect(isFlatInterventionKey(key)).toBe(true);
      }
    });

    it('drops for the RIGHT reason — depth, not the prefix family', () => {
      // The discriminating pair: same prefix, one trailing segment vs two.
      // If this ever passed because the prefix stopped being recognised, the
      // first expectation would fail and the gap tests above would too.
      expect(parseFlatInterventionKey('interventions/fac1')).toBe('fac1');
      expect(parseFlatInterventionKey('interventions/fac1/value')).toBeUndefined();
    });
  });

  describe('separator and shape edge cases', () => {
    it('ignores a prefix that merely starts with the root name', () => {
      expect(isFlatInterventionKey('interventions_backup/fac1')).toBe(false);
      expect(isFlatInterventionKey('data_interventions/fac1')).toBe(false);
    });

    it('ignores a root with no factor segment', () => {
      expect(parseFlatInterventionKey('data/interventions')).toBeUndefined();
      expect(parseFlatInterventionKey('observed_state/interventions')).toBeUndefined();
    });

    it('tolerates redundant separators the way the postcondition does', () => {
      expect(parseFlatInterventionKey('data//interventions//fac1')).toBe('fac1');
    });
  });
});
