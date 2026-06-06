import { describe, it, expect } from 'vitest';

import {
  buildFlipProposal,
  readFlipEntries,
  selectFlipProposal,
  type FlipEntry,
  type FactorNodeInfo,
} from '../flip-proposal.js';
// Round-trip is proven against the REAL handler normalisation path.
import { normaliseFactorValue } from '../../tools/handlers/d1-shared/normalise-factor-value.js';
import {
  applyFactorValueOperator,
  evaluateFactorValueProposal,
} from '../../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';

/**
 * Replay a built proposal's params through the EXACT handler path
 * (parse → applyOperator('set') → evaluate → normalise) using the real
 * functions, and return what the handler would store. `factorCap`/
 * `factorUnit` mirror the factor's stored observed_state at execute time.
 */
function replayThroughRealNormaliser(
  params: Readonly<Record<string, unknown>>,
  factorCap?: number,
  factorUnit?: string,
): { raw_value: number; value: number } {
  const v = params.value;
  let numeric: number;
  let unit: string | undefined;
  let proposalCap: number | undefined;
  let inputHasUnit: boolean;
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    numeric = o.value as number;
    unit = typeof o.unit === 'string' ? o.unit : undefined;
    proposalCap = typeof o.cap === 'number' ? o.cap : undefined;
    inputHasUnit = unit !== undefined;
  } else {
    numeric = v as number;
    inputHasUnit = false;
  }
  const effectiveRaw = applyFactorValueOperator(numeric, 'set', numeric);
  // Validation must pass (the handler would otherwise reject at execute).
  const evaln = evaluateFactorValueProposal({
    rawInput: effectiveRaw,
    operator: 'set',
    ...(unit !== undefined ? { unit } : {}),
    ...(proposalCap !== undefined ? { proposalCap } : {}),
    ...(factorCap !== undefined ? { factorCap } : {}),
    ...(factorUnit !== undefined ? { factorUnit } : {}),
    inputHasUnit,
  });
  expect(evaln.ok, JSON.stringify(evaln)).toBe(true);
  return normaliseFactorValue({
    rawInput: effectiveRaw,
    ...(unit !== undefined ? { unit } : {}),
    ...(proposalCap !== undefined ? { proposalCap } : {}),
    ...(factorCap !== undefined ? { factorCap } : {}),
    ...(factorUnit !== undefined ? { factorUnit } : {}),
    inputHasUnit,
  });
}

function entry(over: Partial<FlipEntry> = {}): FlipEntry {
  return {
    factor_id: 'fac_x',
    factor_label: 'Engineering Capacity',
    flip_value: 0.4,
    direction: 'increase',
    unit: null,
    ...over,
  };
}

describe('buildFlipProposal — round-trip safe against the real normaliser', () => {
  // [label, node, entry-overrides, expected raw, expected display, expected model]
  const CASES: Array<{
    name: string;
    node: FactorNodeInfo;
    over: Partial<FlipEntry>;
    rawInput: number;
    display: string;
    model: number;
  }> = [
    { name: 'capped count (engineers)', node: { cap: 50, unit: 'engineers' }, over: { flip_value: 0.4 }, rawInput: 20, display: '20 engineers', model: 0.4 },
    { name: 'capped percentage',        node: { cap: 100, unit: '%' },        over: { flip_value: 0.3, unit: '%' }, rawInput: 30, display: '30%', model: 0.3 },
    { name: 'capped currency',          node: { cap: 500000, unit: '£' },     over: { flip_value: 0.1, unit: '£' }, rawInput: 50000, display: '£50,000', model: 0.1 },
    { name: 'capped months',            node: { cap: 24, unit: 'months' },    over: { flip_value: 0.5, unit: 'months' }, rawInput: 12, display: '12 months', model: 0.5 },
  ];

  for (const c of CASES) {
    it(`builds + round-trips: ${c.name}`, () => {
      const res = buildFlipProposal(entry(c.over), c.node);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.proposal.intent).toBe('set_factor_value');
      expect(res.proposal.target_entity_ids).toEqual(['fac_x']);
      expect(res.proposal.label).toContain(c.display);
      // Replay through the REAL normaliser: no double-normalisation.
      const out = replayThroughRealNormaliser(res.proposal.params, c.node.cap ?? undefined, c.node.unit ?? undefined);
      expect(out.raw_value).toBe(c.rawInput);
      expect(out.value).toBeCloseTo(c.model, 10); // === intended model flip value
    });
  }

  it('uncapped integer factor: model === raw, round-trips', () => {
    const res = buildFlipProposal(entry({ flip_value: 30, unit: 'widgets' }), { cap: null, unit: 'widgets' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.proposal.label).toContain('30 widgets');
    const out = replayThroughRealNormaliser(res.proposal.params, undefined, 'widgets');
    expect(out.raw_value).toBe(30);
    expect(out.value).toBe(30);
  });
});

describe('buildFlipProposal — skips rather than improvising', () => {
  it('skips a null / absent flip_value', () => {
    expect(buildFlipProposal(entry({ flip_value: null }), { cap: 50 })).toEqual({ ok: false, reason: 'no_flip_value' });
    expect(buildFlipProposal(entry({ flip_value: undefined }), { cap: 50 })).toEqual({ ok: false, reason: 'no_flip_value' });
  });
  it('skips when the factor is not in the graph', () => {
    expect(buildFlipProposal(entry(), undefined)).toEqual({ ok: false, reason: 'factor_not_in_graph' });
  });
  it('skips a non-positive cap (real data had cap=0)', () => {
    expect(buildFlipProposal(entry(), { cap: 0 })).toEqual({ ok: false, reason: 'cap_non_positive' });
  });
  it('skips a model value outside [0,1] for a capped factor', () => {
    expect(buildFlipProposal(entry({ flip_value: 1.5 }), { cap: 50 })).toEqual({ ok: false, reason: 'model_value_out_of_range' });
  });
  it('skips an unrenderable value — bare decimal under cap=1 unitless', () => {
    expect(buildFlipProposal(entry({ flip_value: 0.7, unit: null }), { cap: 1, unit: null })).toEqual({ ok: false, reason: 'unrenderable_value' });
  });
  it('skips the "Adoption Rate at 0.62" case (uncapped bare decimal, no unit)', () => {
    expect(buildFlipProposal(entry({ factor_label: 'Adoption Rate', flip_value: 0.62, unit: null }), { cap: null, unit: null }))
      .toEqual({ ok: false, reason: 'unrenderable_value' });
  });
});

describe('buildFlipProposal — provenance-safe copy', () => {
  it('uses "Test X at N" / "Check whether ..." and never implies a guaranteed flip or a raw decimal', () => {
    const res = buildFlipProposal(entry({ flip_value: 0.4 }), { cap: 50, unit: 'engineers' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.proposal.label).toBe('Test Engineering Capacity at 20 engineers');
    expect(res.proposal.message).toBe('Check whether Engineering Capacity at 20 engineers changes the result.');
    for (const s of [res.proposal.label, res.proposal.message]) {
      expect(s).not.toMatch(/will flip|flip the result|set .* to .* to flip/i);
      expect(s).not.toMatch(/\d\.\d/); // no raw decimal
    }
  });
});

describe('readFlipEntries / selectFlipProposal', () => {
  it('reads enrichment.flip_thresholds defensively (real staging shape, flip_value null)', () => {
    const enrichment = {
      flip_thresholds: [
        { factor_id: 'fac_eng', factor_label: 'Engineering Capacity', current_value: 0.3, flip_value: null, direction: 'decrease', unit: 'engineers' },
        { bogus: true },
        { factor_id: 'fac_q', factor_label: 'Quality', flip_value: 0.4, unit: '%' },
      ],
    };
    const entries = readFlipEntries(enrichment);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ factor_id: 'fac_eng', flip_value: null });
    expect(entries[1]).toMatchObject({ factor_id: 'fac_q', flip_value: 0.4 });
  });

  it('selectFlipProposal picks the first safely-proposable entry', () => {
    const entries: FlipEntry[] = [
      { factor_id: 'a', factor_label: 'A', flip_value: null, unit: null }, // skip (null)
      { factor_id: 'b', factor_label: 'B', flip_value: 0.5, unit: '%' },    // ok
    ];
    const lookup = (id: string): FactorNodeInfo | undefined =>
      id === 'b' ? { cap: 100, unit: '%' } : { cap: 100 };
    const sel = selectFlipProposal(entries, lookup);
    expect(sel?.entry.factor_id).toBe('b');
    expect(sel?.proposal.label).toContain('50%');
  });

  it('selectFlipProposal returns null when nothing is safely proposable', () => {
    const entries: FlipEntry[] = [{ factor_id: 'a', factor_label: 'A', flip_value: null, unit: null }];
    expect(selectFlipProposal(entries, () => ({ cap: 100 }))).toBeNull();
  });
});
