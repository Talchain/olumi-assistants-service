import { describe, it, expect } from 'vitest';

import { readFileSync } from 'node:fs';
import {
  buildFlipProposal,
  buildFlipProposalEmit,
  readFlipEntries,
  selectFlipProposal,
  summariseFlipEntries,
  type FlipEntry,
  type FactorNodeInfo,
} from '../flip-proposal.js';
import { finalizeChips } from '../chip-finalizer.js';
import { getDefaultRegistry } from '../../tools/registry.js';
import type { ProposedChangeContext } from '../../types/proposed-change.js';
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
  it('skips an EXPLICIT model value outside [0,1] for a capped factor', () => {
    expect(buildFlipProposal(entry({ flip_value: 1.5, value_scale: 'model' }), { cap: 50 })).toEqual({ ok: false, reason: 'model_value_out_of_range' });
  });
  it('fails closed (ambiguous_scale) for a capped value outside [0,1] with NO value_scale', () => {
    // Pre-contract data omitted value_scale; a capped value >1 could be an
    // unsignalled display value, so we refuse to guess the scale.
    expect(buildFlipProposal(entry({ flip_value: 1.5 }), { cap: 50 })).toEqual({ ok: false, reason: 'ambiguous_scale' });
  });
  it('skips when the inverted user-scale value is not a whole number (no round-and-execute)', () => {
    // flip 0.41 * cap 50 = 20.5 -> not an integer -> skip rather than round to 20/21.
    expect(buildFlipProposal(entry({ flip_value: 0.41, unit: 'engineers' }), { cap: 50, unit: 'engineers' }))
      .toEqual({ ok: false, reason: 'unrenderable_value' });
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

describe('buildFlipProposalEmit — end-to-end emit (chip + apply_proposed_change pending)', () => {
  const ctx = (): ProposedChangeContext => ({
    scenario_id: '11111111-1111-4111-8111-111111111111',
    graph_hash: 'graphhash1234',
    emitted_at_iso: '2026-06-06T00:00:00.000Z',
    registry: getDefaultRegistry(),
  });

  it('emits a chip + pending storing the EXACT numeric user-unit value', () => {
    const enrichment = {
      flip_thresholds: [
        { factor_id: 'fac_eng', factor_label: 'Engineering Capacity', flip_value: 0.4, direction: 'increase', unit: 'engineers' },
      ],
    };
    const lookup = (id: string): FactorNodeInfo | undefined =>
      id === 'fac_eng' ? { cap: 50, unit: 'engineers' } : undefined;
    const res = buildFlipProposalEmit(enrichment, lookup, ctx());
    expect(res.status).toBe('emitted');
    if (res.status !== 'emitted') return;
    expect(res.chip.action_type).toBe('set_factor_value');
    expect(res.chip.id).toMatch(/^prop_[0-9a-f]{12}$/);
    expect(res.chip.label).toBe('Test Engineering Capacity at 20 engineers');
    expect(res.chip.label).not.toMatch(/\d\.\d/);
    // chip <-> pending bridge + exact numeric value (not a formatted string)
    expect(res.pending.action.kind).toBe('apply_proposed_change');
    expect(res.pending.chip_id).toBe(res.chip.id);
    const patch = (res.pending.action as unknown as { inline_patch: { handler_id: string; params: Record<string, unknown>; target_entity_ids: string[] } }).inline_patch;
    expect(patch.handler_id).toBe('set_factor_value');
    expect(patch.target_entity_ids).toEqual(['fac_eng']);
    expect(patch.params).toEqual({ value: { value: 20, cap: 50 } }); // exact numeric, model = 20/50 = 0.4
  });

  it('emits NOTHING for the real staging envelope (all flip_value: null)', () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL('../../../../tests/fixtures/cross-service/v5-turn.run-analysis.staging.json', import.meta.url),
        'utf-8',
      ),
    ) as { blocks: Array<{ enrichment: unknown }> };
    const enrichment = fixture.blocks[0].enrichment;
    // Any lookup — there is nothing to propose because every flip_value is null.
    const res = buildFlipProposalEmit(enrichment, () => ({ cap: 50, unit: 'engineers' }), ctx());
    expect(res.status).toBe('no_proposal');
  });

  it('returns no_proposal when enrichment has no flip_thresholds', () => {
    expect(buildFlipProposalEmit({}, () => ({ cap: 50 }), ctx()).status).toBe('no_proposal');
    expect(buildFlipProposalEmit(null, () => ({ cap: 50 }), ctx()).status).toBe('no_proposal');
  });
});

// ---------------------------------------------------------------------------
// Branch A value-scale fix: consume PLoT display-scale flip values.
// PLoT 964fa37 emits flip_value in user/display units (e.g. 6.055 story_points,
// value_scale "display") — not the legacy model-scale [0,1].
// ---------------------------------------------------------------------------

/** The real PLoT delivery_gap flip-threshold entry (build 964fa37) shape. */
function plotDeliveryGapEntry(over: Partial<FlipEntry> = {}): FlipEntry {
  return {
    factor_id: 'delivery_gap',
    factor_label: 'Delivery gap (demand minus capacity)',
    flip_value: 6.055000000000001,
    direction: 'increase',
    unit: 'story_points',
    value_scale: 'display',
    ...over,
  };
}
const DELIVERY_GAP_NODE: FactorNodeInfo = { cap: 10, unit: 'story_points' };

describe('buildFlipProposal — PLoT display-scale fixture (Branch A)', () => {
  it('emits a proposal for flip_value 6.055 story_points (value_scale display, cap 10)', () => {
    const res = buildFlipProposal(plotDeliveryGapEntry(), DELIVERY_GAP_NODE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Chip copy: approximate, honest "around" wording, humanised unit.
    expect(res.proposal.label).toBe(
      'Test Delivery gap (demand minus capacity) at around 6.1 story points',
    );
    expect(res.proposal.message).toBe(
      'Check whether Delivery gap (demand minus capacity) at around 6.1 story points changes the result.',
    );
    // Action payload stores the EXACT numeric value (not the rounded 6.1).
    expect(res.proposal.params).toEqual({ value: { value: 6.055000000000001, cap: 10 } });
    expect(res.proposal.target_entity_ids).toEqual(['delivery_gap']);
  });

  it('reads value_scale from the nested margin_sensitivity.value_scale (current PLoT shape)', () => {
    const enrichment = {
      flip_thresholds: [
        {
          factor_id: 'delivery_gap',
          factor_label: 'Delivery gap (demand minus capacity)',
          flip_value: 6.055000000000001,
          direction: 'increase',
          unit: 'story_points',
          margin_sensitivity: { movement: 'flipped', value_scale: 'display' },
        },
      ],
    };
    const entries = readFlipEntries(enrichment);
    expect(entries[0]?.value_scale).toBe('display');
    // …and that scale flows through to a successful build.
    const res = buildFlipProposal(entries[0]!, DELIVERY_GAP_NODE);
    expect(res.ok).toBe(true);
  });

  it('round-trips the EXACT display-scale payload through the real normaliser (6.055 → model 0.6055)', () => {
    const res = buildFlipProposal(plotDeliveryGapEntry(), DELIVERY_GAP_NODE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The handler applies the exact stored user value, normalising model = raw / cap.
    const out = replayThroughRealNormaliser(res.proposal.params, 10, 'story_points');
    expect(out.raw_value).toBeCloseTo(6.055, 6); // exact user value, NOT rounded 6.1
    expect(out.value).toBeCloseTo(0.6055, 6); // model = 6.055 / cap 10
  });

  it('display-scale uncapped: stores the exact value as both raw and model (no × cap)', () => {
    const res = buildFlipProposal(plotDeliveryGapEntry({ unit: 'widgets' }), { cap: null, unit: 'widgets' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.proposal.label).toContain('around 6.1 widgets');
    expect(res.proposal.params).toEqual({ value: 6.055000000000001 });
    const out = replayThroughRealNormaliser(res.proposal.params, undefined, 'widgets');
    expect(out.raw_value).toBeCloseTo(6.055, 6);
    expect(out.value).toBeCloseTo(6.055, 6); // uncapped: model === user
  });
});

describe('buildFlipProposal — display/executed invariant', () => {
  it('uses "around" only when the display rounds away from the exact payload value', () => {
    // 6.055 rounds to 6.1 → approximate wording, exact payload preserved.
    const approxRes = buildFlipProposal(plotDeliveryGapEntry(), DELIVERY_GAP_NODE);
    expect(approxRes.ok).toBe(true);
    if (!approxRes.ok) return;
    expect(approxRes.proposal.label).toContain('around 6.1 story points');
    expect((approxRes.proposal.params as { value: { value: number } }).value.value).toBeCloseTo(6.055, 6);

    // A display value that needs no rounding is stated EXACTLY (no "around").
    const exactRes = buildFlipProposal(plotDeliveryGapEntry({ flip_value: 6 }), DELIVERY_GAP_NODE);
    expect(exactRes.ok).toBe(true);
    if (!exactRes.ok) return;
    expect(exactRes.proposal.label).toBe('Test Delivery gap (demand minus capacity) at 6 story points');
    expect(exactRes.proposal.label).not.toContain('around');
    expect(exactRes.proposal.params).toEqual({ value: { value: 6, cap: 10 } });
  });

  it('never shows the rounded number as if exact while applying a different value', () => {
    const res = buildFlipProposal(plotDeliveryGapEntry(), DELIVERY_GAP_NODE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const payload = (res.proposal.params as { value: { value: number } }).value.value;
    // Displayed 6.1 ≠ executed 6.055 → the copy MUST carry the "around" hedge.
    expect(res.proposal.label).toMatch(/around 6\.1/);
    expect(payload).not.toBe(6.1);
    expect(payload).toBeCloseTo(6.055, 6);
  });
});

describe('buildFlipProposal — legacy/model-scale compatibility', () => {
  it('keeps explicit model-scale values working (0.4 × cap 50 = 20)', () => {
    const res = buildFlipProposal(
      { factor_id: 'fac_x', factor_label: 'Engineering Capacity', flip_value: 0.4, unit: 'engineers', value_scale: 'model' },
      { cap: 50, unit: 'engineers' },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.proposal.label).toBe('Test Engineering Capacity at 20 engineers');
    expect(res.proposal.params).toEqual({ value: { value: 20, cap: 50 } });
  });

  it('treats an absent value_scale in [0,1] as legacy model-scale (backward compatible)', () => {
    const res = buildFlipProposal({ factor_id: 'f', factor_label: 'Cap', flip_value: 0.3, unit: '%' }, { cap: 100, unit: '%' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.proposal.label).toContain('30%');
  });

  it('fails closed for an unrecognised value_scale', () => {
    expect(buildFlipProposal(plotDeliveryGapEntry({ value_scale: 'percentage_points' }), DELIVERY_GAP_NODE))
      .toEqual({ ok: false, reason: 'ambiguous_scale' });
  });
});

describe('buildFlipProposal — display-scale safety', () => {
  it('never leaks the raw model-scale decimal into the copy', () => {
    const res = buildFlipProposal(plotDeliveryGapEntry(), DELIVERY_GAP_NODE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const s of [res.proposal.label, res.proposal.message]) {
      // model value would be 6.055/10 = 0.6055 — must NOT appear.
      expect(s).not.toContain('0.6');
      expect(s).not.toMatch(/0\.\d/); // no bare normalised decimal
    }
  });

  it('renders story_points as a unit, never as a percentage', () => {
    const res = buildFlipProposal(plotDeliveryGapEntry(), DELIVERY_GAP_NODE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.proposal.label).toContain('story points');
    expect(res.proposal.label).not.toContain('%');
  });

  it('fails closed when a display value exceeds the cap (would be rejected at execute)', () => {
    expect(buildFlipProposal(plotDeliveryGapEntry({ flip_value: 15 }), DELIVERY_GAP_NODE))
      .toEqual({ ok: false, reason: 'display_value_exceeds_cap' });
  });

  it('accepts a display value exactly AT the cap (inclusive [0, cap] boundary)', () => {
    const res = buildFlipProposal(plotDeliveryGapEntry({ flip_value: 10 }), DELIVERY_GAP_NODE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.proposal.label).toBe('Test Delivery gap (demand minus capacity) at 10 story points');
    expect(res.proposal.params).toEqual({ value: { value: 10, cap: 10 } });
  });

  it('fails closed for a malformed (non-finite) value regardless of scale', () => {
    expect(buildFlipProposal(plotDeliveryGapEntry({ flip_value: Number.NaN }), DELIVERY_GAP_NODE))
      .toEqual({ ok: false, reason: 'no_flip_value' });
  });
});

describe('buildFlipProposalEmit — display-scale chip survives #239 finalisation', () => {
  const emitCtx = (): ProposedChangeContext => ({
    scenario_id: '22222222-2222-4222-8222-222222222222',
    graph_hash: 'graphhashabcd',
    emitted_at_iso: '2026-06-08T00:00:00.000Z',
    registry: getDefaultRegistry(),
  });

  it('emits a pending-bearing proposal chip with the exact payload, preserved by finalizeChips', () => {
    const enrichment = {
      flip_thresholds: [
        {
          factor_id: 'delivery_gap',
          factor_label: 'Delivery gap (demand minus capacity)',
          flip_value: 6.055000000000001,
          direction: 'increase',
          unit: 'story_points',
          margin_sensitivity: { value_scale: 'display' },
        },
      ],
    };
    const lookup = (id: string): FactorNodeInfo | undefined =>
      id === 'delivery_gap' ? DELIVERY_GAP_NODE : undefined;
    const res = buildFlipProposalEmit(enrichment, lookup, emitCtx());
    expect(res.status).toBe('emitted');
    if (res.status !== 'emitted') return;

    // Exact value lives in the pending payload (NOT the rounded display).
    const patch = (res.pending.action as unknown as { inline_patch: { params: Record<string, unknown> } }).inline_patch;
    expect(patch.params).toEqual({ value: { value: 6.055000000000001, cap: 10 } });
    expect(res.chip.label).toContain('around 6.1 story points');

    // #239 finaliser: the validated proposal chip must survive untouched —
    // not dropped, deduped, trimmed, or rewritten.
    const { chips } = finalizeChips([res.chip]);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toEqual(res.chip); // id + label + message + action_type intact
    expect(chips[0]!.id).toBe(res.chip.id);
  });

  it('emits NO pending when the factor label carries an unsafe decimal (egress would drop the chip)', () => {
    // A high-precision decimal interpolated from the factor label would be
    // dropped at egress by the #239 raw-decimal rule; the emit must fail closed
    // so no orphan apply_proposed_change pending is persisted without a chip.
    const enrichment = {
      flip_thresholds: [
        {
          factor_id: 'fac_conf',
          factor_label: 'Confidence 0.4732',
          flip_value: 6.055000000000001,
          direction: 'increase',
          unit: 'story_points',
          margin_sensitivity: { value_scale: 'display' },
        },
      ],
    };
    const lookup = (): FactorNodeInfo => DELIVERY_GAP_NODE;
    const res = buildFlipProposalEmit(enrichment, lookup, emitCtx());
    expect(res.status).toBe('unsafe_copy');
    expect(res.status).not.toBe('emitted'); // no chip AND no pending materialised
  });
});

// V5 P0-B — flip_reason + content-aware margin_supports_flip + summary verdict.
describe('readFlipEntries — captures flip_reason + margin_supports_flip (content, not presence)', () => {
  it('reads flip_reason and treats margin_sensitivity{movement:"none"} as NOT support (the live staging shape)', () => {
    // Mirrors enrichment.flip_thresholds from the staging debug bundle
    // (build cef69b0, scenario e22aa97b): flip_value null, no_effect reason,
    // and a margin_sensitivity object that reports zero movement.
    const enrichment = {
      flip_thresholds: [
        {
          factor_id: 'fac_hiring_cost',
          factor_label: 'Hiring and Salary Cost',
          flip_value: null,
          direction: 'increase',
          flip_reason: 'no_effect_within_bounds',
          margin_sensitivity: {
            movement: 'none',
            strongest_delta: null,
            strongest_delta_abs: null,
            min_probe_delta: 0,
            max_probe_delta: 0,
            display_value_available: false,
          },
        },
      ],
    };
    const [entry] = readFlipEntries(enrichment);
    expect(entry.flip_reason).toBe('no_effect_within_bounds');
    // Presence of a margin_sensitivity object is NOT support — movement is none.
    expect(entry.margin_supports_flip).toBe(false);
  });

  it('treats real movement (movement !== "none" OR strongest_delta_abs > 0) as support', () => {
    const enrichment = {
      flip_thresholds: [
        {
          factor_id: 'f1',
          factor_label: 'F1',
          flip_value: null,
          margin_sensitivity: { movement: 'flipped' },
        },
        {
          factor_id: 'f2',
          factor_label: 'F2',
          flip_value: null,
          margin_sensitivity: { movement: 'none', strongest_delta_abs: 0.12 },
        },
      ],
    };
    const entries = readFlipEntries(enrichment);
    expect(entries[0].margin_supports_flip).toBe(true); // movement flipped
    expect(entries[1].margin_supports_flip).toBe(true); // non-zero strongest delta
  });
});

describe('summariseFlipEntries — overall_status verdict', () => {
  const entry = (over: Partial<FlipEntry>): FlipEntry => ({
    factor_id: 'f',
    factor_label: 'F',
    flip_value: null,
    flip_reason: null,
    margin_supports_flip: false,
    ...over,
  });

  it('empty → none', () => {
    expect(summariseFlipEntries([]).overall_status).toBe('none');
  });

  it('all null + no_effect_within_bounds → no_practical_flip (margin not supporting)', () => {
    const s = summariseFlipEntries([
      entry({ flip_reason: 'no_effect_within_bounds' }),
      entry({ flip_reason: 'no_effect_within_bounds' }),
    ]);
    expect(s.overall_status).toBe('no_practical_flip');
    expect(s.margin_supports_flip).toBe(false);
  });

  it('any finite flip_value → concrete', () => {
    const s = summariseFlipEntries([
      entry({ flip_reason: 'no_effect_within_bounds' }),
      entry({ flip_value: 0.42 }),
    ]);
    expect(s.overall_status).toBe('concrete');
  });

  it('null without no_effect reason → insufficient_data', () => {
    const s = summariseFlipEntries([entry({ flip_reason: 'max_iterations' })]);
    expect(s.overall_status).toBe('insufficient_data');
  });

  it('margin_supports_flip aggregates across entries (some=true → true)', () => {
    const s = summariseFlipEntries([
      entry({ flip_reason: 'no_effect_within_bounds' }),
      entry({ flip_value: 0.5, margin_supports_flip: true }),
    ]);
    expect(s.margin_supports_flip).toBe(true);
  });
});
