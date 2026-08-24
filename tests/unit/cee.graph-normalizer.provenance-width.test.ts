/**
 * decision-review graph-normalizer — PROVENANCE → SAMPLING-WIDTH POLARITY
 *
 * The defect this file pins: `normalizeGraphForISL` derived a node's
 * `ExtractionType` — which multiplies the derived `value_std` via
 * `TYPE_MULTIPLIERS` (`explicit: 1.0`, `inferred: 1.5`) — from a
 * hand-maintained TWO-member reading of `observed_state.source`:
 *
 *     source === 'brief_extraction' ? 'explicit' : 'inferred'
 *
 * The shared contract declares TWELVE literals. Ten of them fell to the
 * `: 'inferred'` arm, so a server-verified named participant's panel answer
 * (`panel_elicited`) was sampled 50% WIDER than the model's own reading of the
 * brief. The polarity was inverted.
 *
 * Every case below is an OPPOSITE-DIRECTION TWIN pair (CLAUDE.md trap 22b):
 * the user-authored literals must TIGHTEN, and `cee_inference`,
 * `brief_extraction` and an absent/unknown stamp must be BYTE-UNCHANGED. The
 * last three are the load-bearing ones — this change must not re-tune anything
 * that is already right.
 *
 * Arithmetic used throughout (value 100, confidence 0.8):
 *   baseCV = 0.2 * (1 - 0.8) + 0.05 = 0.09
 *   explicit → 0.09 * 100 * 1.0 = 9
 *   inferred → 0.09 * 100 * 1.5 = 13.5
 * Both clear every floor, so the two buckets are distinguishable by value.
 */

import { describe, it, expect } from 'vitest';

import { OBSERVED_STATE_SOURCE_LITERALS } from '@talchain/schemas';

import { normalizeGraphForISL } from '../../src/cee/decision-review/graph-normalizer.js';
import {
  SOURCE_EXTRACTION_TYPE_TABLE,
  UNATTRIBUTED_EXTRACTION_TYPE,
  extractionTypeForSource,
} from '../../src/cee/decision-review/value-source-extraction-type.js';
import { classifyValueSource } from '../../src/cee/graph-readiness/obligation-provenance.js';
import type { GraphV1 } from '../../src/contracts/plot/engine.js';

const TIGHT_STD = 9;
const WIDE_STD = 13.5;

/**
 * A single factor node carrying BOTH a V3 `observed_state` stamp and the
 * extraction `confidence` that switches `normalizeGraphForISL` onto the
 * `deriveValueUncertainty` path. `data.extractionType` is deliberately absent:
 * the pipeline's own stamp takes precedence when present, and the defect lives
 * entirely in the FALLBACK.
 */
function graphWithSource(source: string | undefined): GraphV1 {
  const observed_state: Record<string, unknown> = { value: 100, unit: '£' };
  if (source !== undefined) observed_state.source = source;

  return {
    version: '1',
    default_seed: 42,
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Goal' },
      {
        id: 'fac_target',
        kind: 'factor',
        label: 'Target factor',
        observed_state,
        data: { confidence: 0.8 },
      } as unknown as GraphV1['nodes'][0],
    ],
    edges: [],
  } as unknown as GraphV1;
}

/** Read back the two carriers the normalizer writes for the target node. */
function widthOf(source: string | undefined): {
  extractionType: unknown;
  valueStd: unknown;
  uncertaintyStd: unknown;
} {
  const normalized = normalizeGraphForISL(graphWithSource(source));
  const node = normalized.nodes.find((n) => n.id === 'fac_target');
  const uncertainty = normalized.parameter_uncertainties?.find(
    (u) => u.node_id === 'fac_target',
  );
  return {
    extractionType: (node?.data as Record<string, unknown> | undefined)?.extractionType,
    valueStd: (node?.data as Record<string, unknown> | undefined)?.value_std,
    uncertaintyStd: uncertainty?.std,
  };
}

describe('normalizeGraphForISL — provenance→width polarity', () => {
  // ── TWIN 1: user-authored literals must reach the TIGHT bucket ──────────
  // Every literal the shared contract declares as the user speaking. At
  // pristine ALL of these except `brief_extraction` land on `inferred`/13.5.
  const USER_AUTHORED_TIGHT = [
    'brief_extraction',
    'explicit',
    'user',
    'user_override',
    'user_confirmed',
    'user_edited',
    'user_calibration',
    'panel_elicited',
  ] as const;

  for (const source of USER_AUTHORED_TIGHT) {
    it(`user-authored source "${source}" is sampled at the TIGHT (explicit) width`, () => {
      const { extractionType, valueStd, uncertaintyStd } = widthOf(source);
      expect(extractionType).toBe('explicit');
      expect(valueStd).toBeCloseTo(TIGHT_STD, 10);
      expect(uncertaintyStd).toBeCloseTo(TIGHT_STD, 10);
    });
  }

  // ── TWIN 2: the model's own estimates keep the WIDE bucket ──────────────
  const MODEL_AUTHORED_WIDE = ['cee_inference', 'inferred', 'cee_repair'] as const;

  for (const source of MODEL_AUTHORED_WIDE) {
    it(`model-authored source "${source}" keeps the WIDE (inferred) width — unchanged`, () => {
      const { extractionType, valueStd, uncertaintyStd } = widthOf(source);
      expect(extractionType).toBe('inferred');
      expect(valueStd).toBeCloseTo(WIDE_STD, 10);
      expect(uncertaintyStd).toBeCloseTo(WIDE_STD, 10);
    });
  }

  // ── TWIN 3: brief_extraction is BYTE-UNCHANGED ──────────────────────────
  it('brief_extraction is byte-unchanged — it was already tight and stays tight', () => {
    const { extractionType, valueStd, uncertaintyStd } = widthOf('brief_extraction');
    expect(extractionType).toBe('explicit');
    expect(valueStd).toBeCloseTo(TIGHT_STD, 10);
    expect(uncertaintyStd).toBeCloseTo(TIGHT_STD, 10);
  });

  // ── TWIN 4: absent / unknown stamps keep today's conservative behaviour ──
  it('an ABSENT source keeps today\'s conservative WIDE behaviour — unchanged', () => {
    const { extractionType, valueStd, uncertaintyStd } = widthOf(undefined);
    expect(extractionType).toBe('inferred');
    expect(valueStd).toBeCloseTo(WIDE_STD, 10);
    expect(uncertaintyStd).toBeCloseTo(WIDE_STD, 10);
  });

  it('an UNRECOGNISED source keeps today\'s conservative WIDE behaviour — never a guessed tightening', () => {
    const { extractionType, valueStd, uncertaintyStd } = widthOf('some_future_producer_stamp');
    expect(extractionType).toBe('inferred');
    expect(valueStd).toBeCloseTo(WIDE_STD, 10);
    expect(uncertaintyStd).toBeCloseTo(WIDE_STD, 10);
  });

  it('user_assumption keeps the WIDE bucket — a declared guess is a guess, and this is unchanged', () => {
    const { extractionType, valueStd } = widthOf('user_assumption');
    expect(extractionType).toBe('inferred');
    expect(valueStd).toBeCloseTo(WIDE_STD, 10);
  });

  // ── Precedence: the pipeline's own stamp still wins ─────────────────────
  it('an explicit data.extractionType still takes precedence over the source-derived fallback', () => {
    const graph = graphWithSource('panel_elicited');
    const node = graph.nodes[1] as unknown as { data: Record<string, unknown> };
    node.data.extractionType = 'inferred';

    const normalized = normalizeGraphForISL(graph);
    const out = normalized.nodes.find((n) => n.id === 'fac_target');
    expect((out?.data as Record<string, unknown> | undefined)?.extractionType).toBe('inferred');
    expect((out?.data as Record<string, unknown> | undefined)?.value_std).toBeCloseTo(WIDE_STD, 10);
  });
});

describe('SOURCE_EXTRACTION_TYPE_TABLE — completeness and the ONE deliberate divergence', () => {
  it('covers the canonical literal list EXACTLY — no member missing, no member invented', () => {
    // The typecheck guard in the module is what makes a 13th literal a BUILD
    // failure. This is its runtime twin: it also notices a literal the table
    // names that the contract has RETIRED, which a `Record<…>` annotation
    // catches at compile time but which is worth a red here too.
    expect(Object.keys(SOURCE_EXTRACTION_TYPE_TABLE).sort()).toEqual(
      [...OBSERVED_STATE_SOURCE_LITERALS].sort(),
    );
    expect(OBSERVED_STATE_SOURCE_LITERALS.length).toBe(12);
  });

  it('every literal resolves through extractionTypeForSource to the table entry', () => {
    for (const literal of OBSERVED_STATE_SOURCE_LITERALS) {
      expect(extractionTypeForSource(literal)).toBe(SOURCE_EXTRACTION_TYPE_TABLE[literal]);
    }
  });

  it('targets only the two POINT buckets — never `range`, never `observed`', () => {
    // `range` is not a width: routing a provenance stamp there switches
    // deriveValueUncertainty onto a bounds-based branch. `observed` duplicates
    // `explicit`'s multiplier with no extra meaning on this axis. Both belong
    // to the extraction pipeline, not to a provenance mapping.
    for (const literal of OBSERVED_STATE_SOURCE_LITERALS) {
      expect(['explicit', 'inferred']).toContain(SOURCE_EXTRACTION_TYPE_TABLE[literal]);
    }
  });

  it('non-string and unrecognised stamps fall to the conservative WIDE default', () => {
    expect(UNATTRIBUTED_EXTRACTION_TYPE).toBe('inferred');
    for (const stamp of [undefined, null, 42, {}, [], '', 'not_a_literal']) {
      expect(extractionTypeForSource(stamp)).toBe(UNATTRIBUTED_EXTRACTION_TYPE);
    }
  });

  /**
   * THE CROSS-AUTHORITY GUARD (CLAUDE.md traps 12 and 21).
   *
   * `graph-readiness/obligation-provenance.ts` classifies the SAME vocabulary
   * for a DIFFERENT question ("may this gap be demanded of the user?"). The two
   * tables must agree except where a divergence is deliberate — and the
   * divergence set is pinned EXACTLY, so this REDs if it grows OR shrinks
   * (trap 22f: a gap recorded in the suite is honest; a gap invisible to it is
   * how a silent re-bucketing ships).
   */
  const KNOWN_DIVERGENT_FROM_OBLIGATION = new Set<string>(['user_assumption']);

  it('agrees with obligation-provenance on every literal EXCEPT the pinned divergence set', () => {
    const observedDivergences = new Set<string>();

    for (const literal of OBSERVED_STATE_SOURCE_LITERALS) {
      const obligationSaysUser = classifyValueSource(literal) === 'user_stated';
      const widthSaysTight = SOURCE_EXTRACTION_TYPE_TABLE[literal] === 'explicit';
      if (obligationSaysUser !== widthSaysTight) observedDivergences.add(literal);
    }

    expect([...observedDivergences].sort()).toEqual(
      [...KNOWN_DIVERGENT_FROM_OBLIGATION].sort(),
    );
  });

  it('the pinned divergence is real — user_assumption is user_stated for obligation and WIDE for width', () => {
    // Pins the precondition in-test (trap 13b): if this stopped being true the
    // guard above would agree vacuously.
    expect(classifyValueSource('user_assumption')).toBe('user_stated');
    expect(SOURCE_EXTRACTION_TYPE_TABLE.user_assumption).toBe('inferred');
  });

  it('every literal obligation-provenance calls ai_drafted or system_repaired stays WIDE', () => {
    // The direction that must never invert: nothing the MODEL authored may
    // reach the tight bucket.
    for (const literal of OBSERVED_STATE_SOURCE_LITERALS) {
      const authored = classifyValueSource(literal);
      if (authored === 'ai_drafted' || authored === 'system_repaired') {
        expect(SOURCE_EXTRACTION_TYPE_TABLE[literal]).toBe('inferred');
      }
    }
  });
});
