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
