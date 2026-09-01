/**
 * ⭐⭐ THE ACCEPTANCE TABLE for `resolveAnswerForKnownSlot` — the slot-aware
 * contract that replaces "infer the slot from the sentence" with "we already
 * asked; do arithmetic against the slot we asked about".
 *
 * EVERY CASE IS BOUND BY IDENTITY (option id AND factor id), never by a value
 * predicate another entity could satisfy: the fixture graph carries a SECOND
 * option and a SECOND factor precisely so a wrong-entity write is observable.
 * A test that asserted only `modelUnitText === '0.25'` would pass while the
 * value landed on the wrong cell — the failure this whole lane exists to stop.
 */
import { describe, expect, it } from 'vitest';
import {
  resolveAnswerForKnownSlot,
  type KnownEffectSlot,
} from '../repair-value-binding.js';

const graph = {
  nodes: [
    { id: 'decision', kind: 'decision', label: 'Approach' },
    { id: 'goal', kind: 'goal', label: 'Retention' },
    { id: 'opt-asked', kind: 'option', label: 'Two Developers' },
    { id: 'opt-other', kind: 'option', label: 'One Contractor' },
    { id: 'fac-asked', kind: 'factor', label: 'Development throughput' },
    { id: 'fac-other', kind: 'factor', label: 'Burn rate' },
    /**
     * ⚠ A REAL FACTOR WHOSE LABEL IS MADE ENTIRELY OF ORDINARY WORDS.
     *
     * This node exists to discriminate the two guards, which a mutation run
     * proved my first suite could not tell apart. "Take Up" is a perfectly
     * ordinary business metric AND both its words are in the filler allowlist,
     * so `remainderIsAllFiller` cannot see it — only `namesForeignEntity`,
     * reading the GRAPH, can. Without this fixture the graph-label guard could
     * be deleted with the whole suite still green (the M1 survivor).
     */
    { id: 'fac-plain', kind: 'factor', label: 'Take Up' },
  ],
  edges: [],
};

const slot: KnownEffectSlot = {
  optionId: 'opt-asked',
  optionLabel: 'Two Developers',
  factorId: 'fac-asked',
  factorLabel: 'Development throughput',
};

const read = (message: string) => resolveAnswerForKnownSlot({ message, slot, graph });

describe('resolveAnswerForKnownSlot — the asked cell binds by arithmetic, not by pattern', () => {
  // ── THE FOUNDER'S CASE AND ITS ORDINARY-ENGLISH SIBLINGS ──────────────────
  it.each([
    ['25%', '0.25'],
    ['0.25', '0.25'],
    ['about 25%', '0.25'],
    ['make it 25% please', '0.25'],
    ['It should reach about 70%', '0.7'],
    ["I'd put it at 0.7", '0.7'],
    ['make it 0.8 please', '0.8'],
    ['0.7 please', '0.7'],
    ['put it at 0.7', '0.7'],
    ['lets go with 0.7', '0.7'],
    ['try 0.7', '0.7'],
    ['70 percent', '0.7'],
  ])('%s resolves to %s against the ASKED cell', (message, expected) => {
    const result = read(message);
    expect(result.kind).toBe('value');
    if (result.kind !== 'value') return;
    expect(result.modelUnitText).toBe(expected);
    // IDENTITY, not value: the answer is about the cell we asked about.
    expect(result.slot.optionId).toBe('opt-asked');
    expect(result.slot.factorId).toBe('fac-asked');
  });

  // ── OPPOSITE-DIRECTION TWIN: a foreign subject must NEVER bind ────────────
  it.each([
    'One Contractor should be 0.7',
    'set Burn rate to 0.7',
    'make One Contractor 25% please',
  ])('%s names another entity and is declined, never bound', message => {
    const result = read(message);
    expect(result.kind).toBe('declined');
    if (result.kind !== 'declined') return;
    expect(result.reason).toBe('names_other_entity');
  });

  /**
   * ⚠⚠ THE WRONG-ENTITY WRITE THIS LANE NEARLY SHIPPED, pinned so it cannot
   * come back. An earlier cut guarded only against labels PRESENT IN THE GRAPH,
   * and bound `Set Some other factor to 0.9` onto the asked cell — because a
   * guard that only knows the entities that EXIST is blind to the ones a user
   * invents. Caught by an existing spec before merge; these are its twins,
   * owned by this contract.
   *
   * The rule that closes it is an ALLOWLIST over what may surround the figure:
   * an unrecognised noun declines, whether or not it names a real node.
   */
  it.each([
    'Set Some other factor to 0.9',
    'set the burn rate to 0.9',
    'put revenue at 0.4',
    'raise headcount by a third',
    'increase the budget to 0.5',
  ])('%s names a target we cannot verify and is declined, never bound', message => {
    const result = read(message);
    expect(result.kind).toBe('declined');
    if (result.kind !== 'declined') return;
    expect(result.reason).toBe('names_other_entity');
  });

  /**
   * ⭐⭐ THE TWO GUARDS ARE NOT REDUNDANT, and this is the case that proves it.
   *
   * A mutation run showed `namesForeignEntity` could be disabled entirely with
   * the suite still green: every foreign-entity case I had written contained an
   * unusual NOUN, so the filler allowlist was refusing them first and the
   * graph-label guard was doing no observable work.
   *
   * "Take Up" is a real factor in the fixture graph and BOTH its words are
   * ordinary filler, so the allowlist is structurally blind to it. Only a guard
   * that reads the GRAPH can refuse this — which is exactly the class the
   * allowlist cannot cover, and why both guards stay.
   */
  it('refuses a foreign entity whose label is made entirely of ordinary words', () => {
    const result = read('set take up to 0.7');
    expect(result.kind).toBe('declined');
    if (result.kind !== 'declined') return;
    expect(result.reason).toBe('names_other_entity');
  });

  it('naming the ASKED entities is not a foreign subject', () => {
    const result = read('Two Developers on Development throughput should be 0.7');
    expect(result.kind).toBe('value');
    if (result.kind !== 'value') return;
    expect(result.slot.optionId).toBe('opt-asked');
  });

  // ── OUT OF SCALE: no mutation, no success, and the scale is named ─────────
  it.each(['150%', '1.5', 'make it 150% please'])(
    '%s is refused as out of scale — never converted, never written',
    message => {
      const result = read(message);
      expect(result.kind).toBe('out_of_scale');
    },
  );

  // ── THE HONEST EXIT: confirm an explicit figure, never substitute one ─────
  it.each([
    ["I'd put it at a quarter", '0.25'],
    ['a third', '0.33'],
    ['about half', '0.5'],
    ['three quarters', '0.75'],
  ])('%s is CONFIRMED at %s — offered, never silently written', (message, suggested) => {
    const result = read(message);
    expect(result.kind).toBe('confirm');
    if (result.kind !== 'confirm') return;
    expect(result.suggestedModelUnitText).toBe(suggested);
    // The user's own expression is preserved for the reply copy.
    expect(message.toLowerCase()).toContain(result.heardText);
  });

  it('a bare integer is scale-ambiguous and is CONFIRMED, never guessed', () => {
    const result = read('25');
    expect(result.kind).toBe('confirm');
    if (result.kind !== 'confirm') return;
    expect(result.reason).toBe('scale_ambiguous');
    expect(result.suggestedModelUnitText).toBe('0.25');
  });

  // ── QUALITATIVE: no numeric substitution anywhere ─────────────────────────
  it.each(['high', 'a bit more', 'no change', 'much higher than that'])(
    '%s yields no figure at all',
    message => {
      const result = read(message);
      expect(result.kind).toBe('declined');
      if (result.kind !== 'declined') return;
      expect(result.reason).toBe('no_quantity');
    },
  );

  // ── TWO FIGURES: ask, never pick ─────────────────────────────────────────
  it('two quantities in one message are declined rather than picked between', () => {
    const result = read('somewhere between 0.2 and 0.4');
    expect(result.kind).toBe('declined');
    if (result.kind !== 'declined') return;
    expect(result.reason).toBe('several_quantities');
  });

  /**
   * ⭐⭐⭐ THE SIGN CASES — the defect this suite could not see, and the reason
   * it could not see it.
   *
   * MEASURED at `e777309f`, end to end through `resolveRecordedOptionEffectAnswer`
   * on this very fixture:
   *
   *     "-0.9"                 ->  bind valueText=0.9
   *     "set it to -0.9"       ->  bind valueText=0.9
   *     "make it -90% please"  ->  bind valueText=0.9
   *
   * The scan's lookbehind `(?<![\w.])` does not exclude `-`, and the leftover
   * sign was then erased by `remainderIsAllFiller`'s `[^a-z]+`. AT BASE every
   * one of these returned `null` — a safe LOSS — so the contract converted a
   * safe loss into a WRONG WRITE, in a domain where negative effects are
   * ordinary ("Two Developers" on "Burn rate" is naturally negative). The
   * product would have recorded the OPPOSITE DIRECTION of what the user said.
   *
   * ⚠ THIS SUITE CONTAINED ZERO NEGATIVE CASES. The contrast control that
   * proves the omission was real rather than a blind grep: `0.7` appeared 12
   * times in the same file. The corpus excluded a value class the contract
   * admits, so it could not certify the contract over that class — which is
   * why the cases below are written from the SPEC's domain (`[0,1]` is
   * sign-symmetric, so BOTH signs are in the input space) rather than from the
   * shapes that happened to occur to the author.
   */
  it.each([
    ['-0.9', '-0.9'],
    ['set it to -0.9', '-0.9'],
    ['make it -90% please', '-90%'],
    ['−0.9', '−0.9'],
    ['minus 0.9', 'minus 0.9'],
    ['negative 0.9', 'negative 0.9'],
    ['-25', '-25'],
    ['put it at -0.25', '-0.25'],
  ])('%s states a NEGATIVE and is refused, quoting the sign back', (message, quoted) => {
    const result = read(message);
    expect(result.kind).toBe('out_of_scale');
    if (result.kind !== 'out_of_scale') return;
    // The refusal quotes what the user typed. A refusal that echoed `0.9` at
    // someone who wrote `-0.9` would be the sign erasure one seam later.
    expect(result.quantityText).toBe(quoted);
  });

  it('an explicit PLUS is read as positive and binds, because it says so', () => {
    const result = read('+0.9');
    expect(result.kind).toBe('value');
    if (result.kind !== 'value') return;
    expect(result.modelUnitText).toBe('0.9');
    expect(result.slot.factorId).toBe('fac-asked');
  });

  /**
   * ⭐ THE OPPOSITE-DIRECTION TWIN of the negative cases, and it is what keeps
   * the fix from being "refuse anything with a dash in it": a sign glyph that
   * is NOT attached to the figure is genuinely ambiguous between a minus and a
   * dash used as a separator, so it DECLINES — no write, and no false refusal
   * claiming the user's value was off the scale.
   */
  it.each([
    '− 0.9',
    'Development throughput - 0.9',
    '±0.9',
  ])('%s carries an undecidable sign and DECLINES, neither bound nor refused as out of scale', message => {
    const result = read(message);
    expect(result.kind).toBe('declined');
    if (result.kind !== 'declined') return;
    expect(result.reason).toBe('ambiguous_sign');
  });

  /**
   * ⭐⭐⭐ THE SPEC INVARIANT, EXECUTED — written against the CONSUMER'S GATE,
   * never against the failure mode in hand.
   *
   * The consumer's gate is the closed interval [0, 1], which is SIGN-SYMMETRIC.
   * A fix that only handled `-0.9` because that was the case in hand would
   * reproduce this defect on the next asymmetry (CLAUDE.md trap 13d), so the
   * property asserted here is the whole contract rather than the incident:
   *
   *   IF the verdict is `value`, THEN Number(modelUnitText) EQUALS the signed
   *   value the message states, AND lies within [0, 1].
   *
   * The expected value is COMPUTED FROM THE MESSAGE by an independent reader
   * written here, not listed beside each case — a table of hand-written answers
   * would agree with whatever the code does the day it is written.
   */
  describe('SPEC INVARIANT — a bound value equals the signed value stated, inside [0,1]', () => {
    /** An independent signed reading of a message, deliberately naive. */
    const statedValue = (message: string): number | null => {
      const m = /(-|−|–|—|\+)?\s*(\d+(?:\.\d+)?)\s*(%|percent)?/u.exec(message);
      if (m === null) return null;
      const word = /\b(minus|negative)\s+\d/iu.test(message);
      const magnitude = Number(m[2]) / (m[3] === undefined ? 1 : 100);
      const isNegative = word || m[1] === '-' || m[1] === '−' || m[1] === '–' || m[1] === '—';
      return isNegative ? -magnitude : magnitude;
    };

    const corpus = [
      '0.25', '25%', '0.7', '70 percent', '+0.9', '0', '1', '100%',
      '-0.9', '-90%', 'set it to -0.9', 'make it -90% please', '−0.9',
      'minus 0.9', 'negative 0.9', '-25', '150%', '1.5', '-1.5',
      'make it 0.8 please', 'about 25%', 'put it at -0.25',
    ];

    it.each(corpus)('%s never binds a value that misstates the sign or leaves [0,1]', message => {
      const result = read(message);
      if (result.kind !== 'value') return; // refusing is always permitted
      const bound = Number(result.modelUnitText);
      const stated = statedValue(message);
      expect(stated).not.toBeNull();
      // The two halves of the invariant, asserted separately so a failure says
      // WHICH half broke.
      expect(bound).toBe(stated);
      expect(bound).toBeGreaterThanOrEqual(0);
      expect(bound).toBeLessThanOrEqual(1);
    });

    /**
     * ⚠ THE POSITIVE CONTROL. The property above is vacuously true for a
     * contract that declines everything, so it cannot certify anything on its
     * own (trap 13). This asserts the corpus actually EXERCISES the `value`
     * arm, and that every stated negative in it is refused — the discrimination
     * the property is there to make.
     */
    it('the corpus exercises both arms — some bind, and every negative refuses', () => {
      const verdicts = corpus.map(m => ({ m, kind: read(m).kind, stated: statedValue(m) }));
      expect(verdicts.filter(v => v.kind === 'value').length).toBeGreaterThanOrEqual(8);
      const negatives = verdicts.filter(v => (v.stated ?? 0) < 0);
      expect(negatives.length).toBeGreaterThanOrEqual(7);
      for (const v of negatives) expect(v.kind).not.toBe('value');
    });
  });

  // ── THE FACTOR BASELINE MUST NOT MOVE ────────────────────────────────────
  it('resolution is pure and names only the asked slot — no baseline writer reachable', () => {
    const result = read('25%');
    expect(result.kind).toBe('value');
    if (result.kind !== 'value') return;
    // The ONLY entity this contract can name is the asked cell.
    expect(Object.values(result.slot)).toContain('fac-asked');
    expect(Object.values(result.slot)).not.toContain('fac-other');
  });
});
