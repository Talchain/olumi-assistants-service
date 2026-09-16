/**
 * The write for a native option quantity. Its whole job is to add two fields
 * without destroying the six already there, and without ever touching the
 * encoded value the engine computes on.
 */
import { describe, expect, it } from 'vitest';

import {
  buildNativeQuantityOperation,
  formatNativeQuantityAck,
  readCommittedNativeQuantity,
  readExistingIntervention,
} from '../native-quantity-operation.js';

/** A realistic cell: encoded value plus the metadata the draft path writes. */
const CELL = {
  value: 0.7,
  source: 'user_specified',
  target_match: { node_id: '85dd1a1d', match_type: 'exact_id', confidence: 'high' },
  value_confidence: 'medium',
  reasoning: 'from the brief',
  display_value: '0.7',
};

const WRITE = {
  optionId: 'opt_tech_lead',
  optionLabel: 'Hire a Tech Lead',
  factorId: '85dd1a1d',
  factorLabel: 'Hiring Cost',
  nativeValue: 95000,
  unit: 'GBP',
};

const graph = (cell: unknown, optionId = 'opt_tech_lead') => ({
  nodes: [
    { id: '85dd1a1d', kind: 'factor', label: 'Hiring Cost' },
    { id: optionId, kind: 'option', label: 'Hire a Tech Lead', data: { interventions: { '85dd1a1d': cell } } },
  ],
});

/** A calibrated factor: a finite cap in the same unit as the figure. */
const SCALE = { cap: 250000, unit: 'GBP' };

describe('buildNativeQuantityOperation — the native reaches the calibration authority', () => {
  const op = buildNativeQuantityOperation(WRITE, CELL, SCALE)!;

  it('⭐⭐ DROPS the stale encoded value, so the authority re-derives it', () => {
    // Measured (Codex CX-60 witness): carrying the old `value` through makes
    // the encoder's `deriveValue` return it immediately, so the native is
    // stored and NEVER consumed — the cell stays 0.7. The control line in that
    // same run: "same calibrated native without old encoded value" -> 0.6.
    // My "preserve everything" instinct was what blocked the calibration.
    expect(op.value).not.toHaveProperty('value');
  });

  it('drops `display_value` too — it captioned the OLD magnitude', () => {
    expect(op.value).not.toHaveProperty('display_value');
  });

  it('⭐ PRESERVES every other field — siblings and unrelated meaning untouched', () => {
    expect(op.value).toEqual({
      source: CELL.source,
      target_match: CELL.target_match,
      value_confidence: CELL.value_confidence,
      reasoning: CELL.reasoning,
      raw_value: 95000,
      unit: 'GBP',
    });
  });

  it('⛔ NEVER writes the native into the encoded field', () => {
    // 95000 in `value` would move a [0,1] intervention to 95,000.
    expect((op.value as Record<string, unknown>).value).toBeUndefined();
    expect((op.value as Record<string, unknown>).raw_value).toBe(95000);
  });

  it('targets the exact cell by identity', () => {
    expect(op.path).toBe('/nodes/opt_tech_lead/data/interventions/85dd1a1d');
    expect(op.op).toBe('update_node');
  });

  it('carries a real before-state, not null', () => {
    expect(op.old_value).toEqual(CELL);
  });

  it('replaces a stale native rather than duplicating it', () => {
    const withOld = buildNativeQuantityOperation(WRITE, { ...CELL, raw_value: 1, unit: 'USD' }, SCALE)!;
    const v = withOld.value as Record<string, unknown>;
    expect(v.raw_value).toBe(95000);
    expect(v.unit).toBe('GBP');
  });
});

describe('buildNativeQuantityOperation — refuses rather than storing an unsupported figure', () => {
  it('⚠ REFUSES when the factor carries NO CALIBRATION', () => {
    // Executed before this gate: the no-calibration case landed a cell that
    // kept value 0.7 and reported unresolved [] — a silent success over an
    // unsupported conversion. This is also Paul's captured case exactly.
    expect(buildNativeQuantityOperation(WRITE, CELL, undefined)).toBeNull();
    expect(buildNativeQuantityOperation(WRITE, CELL, { unit: 'GBP' })).toBeNull();
  });

  it('⚠ REFUSES when the factor\u2019s declared unit disagrees with the figure', () => {
    // A mismatch is not a conversion opportunity.
    expect(buildNativeQuantityOperation(WRITE, CELL, { cap: 250000, unit: 'USD' })).toBeNull();
  });

  it('refuses when the cell does not exist', () => {
    expect(buildNativeQuantityOperation(WRITE, null, SCALE)).toBeNull();
  });

  it('refuses when there is no encoded value to restate', () => {
    expect(buildNativeQuantityOperation(WRITE, { source: 'user_specified' }, SCALE)).toBeNull();
  });

  it('refuses a non-finite native figure', () => {
    expect(buildNativeQuantityOperation({ ...WRITE, nativeValue: Number.NaN }, CELL, SCALE)).toBeNull();
  });
});

describe('readExistingIntervention — binds by identity', () => {
  it('reads the cell under data.interventions', () => {
    expect(readExistingIntervention(graph(CELL), 'opt_tech_lead', '85dd1a1d')).toEqual(CELL);
  });

  it('reads a cell held directly on the node', () => {
    const g = {
      nodes: [{ id: 'opt_a', kind: 'option', interventions: { f1: CELL } }],
    };
    expect(readExistingIntervention(g, 'opt_a', 'f1')).toEqual(CELL);
  });

  it('refuses when the id resolves to a node of the WRONG KIND', () => {
    const g = { nodes: [{ id: 'opt_a', kind: 'factor', interventions: { f1: CELL } }] };
    expect(readExistingIntervention(g, 'opt_a', 'f1')).toBeNull();
  });

  it('refuses a DUPLICATE id — two hits are not a referent', () => {
    const g = {
      nodes: [
        { id: 'opt_a', kind: 'option', interventions: { f1: CELL } },
        { id: 'opt_a', kind: 'option', interventions: { f1: { value: 0.2 } } },
      ],
    };
    expect(readExistingIntervention(g, 'opt_a', 'f1')).toBeNull();
  });

  it('refuses when the factor cell is absent', () => {
    expect(readExistingIntervention(graph(CELL), 'opt_tech_lead', 'other_factor')).toBeNull();
  });
});

describe('readCommittedNativeQuantity — the native path’s own landing check', () => {
  const applied = graph({ ...CELL, raw_value: 95000, unit: 'GBP' });

  it('reads the committed native figure and unit', () => {
    expect(readCommittedNativeQuantity(applied, 'opt_tech_lead', '85dd1a1d')).toEqual({
      rawValue: 95000,
      unit: 'GBP',
    });
  });

  it('⭐ the ENCODED reader would have reported this successful write as a FAILURE', () => {
    // The dispatcher's existing check is `readCommittedOptionEffect(...) === value`.
    // On a native write the encoded value is deliberately untouched, so it
    // returns 0.7 — never the native figure — and the turn falls into the
    // `option_effect_write_did_not_land` branch. This asserts the two readers
    // answer DIFFERENT questions on the same committed graph, which is why the
    // native path needs its own (trap 21).
    const encoded = (readExistingIntervention(applied, 'opt_tech_lead', '85dd1a1d') as { value: number }).value;
    const native = readCommittedNativeQuantity(applied, 'opt_tech_lead', '85dd1a1d')!;
    expect(encoded).toBe(0.7);
    expect(native.rawValue).toBe(95000);
    expect(encoded).not.toBe(native.rawValue);
  });

  it('undefined when no native landed — so a failure still reads as a failure', () => {
    expect(readCommittedNativeQuantity(graph(CELL), 'opt_tech_lead', '85dd1a1d')).toBeUndefined();
  });

  it('undefined when the native landed without a unit', () => {
    const noUnit = graph({ ...CELL, raw_value: 95000 });
    expect(readCommittedNativeQuantity(noUnit, 'opt_tech_lead', '85dd1a1d')).toBeUndefined();
  });
});

describe('formatNativeQuantityAck', () => {
  const text = formatNativeQuantityAck({
    optionLabel: 'Hire a Tech Lead',
    factorLabel: 'Hiring Cost',
    rawValue: 95000,
    unit: 'GBP',
  });

  it('cites the committed figure, the option and the factor', () => {
    expect(text).toContain('GBP 95,000');
    expect(text).toContain('Hire a Tech Lead');
    expect(text).toContain('Hiring Cost');
  });

  it('⚠ says what it did NOT do — the model value and the ranking are unchanged', () => {
    // Recording a cost recalculates nothing. Saying only the first half would
    // let the reader believe the comparison had moved.
    expect(text).toMatch(/unchanged/i);
  });

  it('SURVIVES the egress forbidden-phrase guard, by execution not inspection', async () => {
    // Copy that trips this guard is replaced wholesale by a neutral fallback,
    // so an ack can read perfectly and reach nobody.
    const { applyEgressForbiddenPhraseGuard } = await import(
      '../../compose/forbidden-user-facing-phrases.js'
    );
    const result = applyEgressForbiddenPhraseGuard(text);
    expect(result.text).toBe(text);
  });
});
