/**
 * ROADMAP 2.989 — the fragile-edge selector, pinned against the two LIVE
 * CAPTURES rather than fixtures this lane wrote.
 *
 * WHY THE FIXTURES ARE CAPTURES. A fixture you wrote yourself is not evidence
 * about the wire (CLAUDE.md trap 16-inverse): a self-authored input encodes the
 * author's model of the producer rather than the producer. The two enrichment
 * objects under `../../compose/__tests__/fixtures/dsk-walk/` are VERBATIM
 * captures from deployed staging, committed whole. Every precondition below is
 * DERIVED from those bytes, never restated as a literal this file also asserts
 * against — so a fixture that is edited or regenerated fails LOUDLY rather than
 * quietly making the behavioural tests mean something else.
 *
 * The ONE authored fixture is the `input_quality: 'degenerate_fallback'` arm,
 * and it is authored because it MUST be: that value occurs ZERO times in either
 * capture (derived below), so without an authored case the gate would be
 * untested. It ships WITH its positive control (`'standard'` ⇒ selected), so
 * the refusal is a discrimination and not an assertion that nothing happens.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  composeEdgeIdentity,
  EDGE_STRENGTH_MAX,
  EDGE_STRENGTH_MIN,
  selectFragileEdge,
  type FragileEdgeDecision,
} from '../select-fragile-edge.js';

type Enrichment = Record<string, unknown>;
type Row = Record<string, unknown>;

function loadCapture(file: string): Enrichment {
  return JSON.parse(
    readFileSync(
      new URL(`../../compose/__tests__/fixtures/dsk-walk/${file}`, import.meta.url),
      'utf8',
    ),
  ) as Enrichment;
}

const SESSION_A = loadCapture('session-a.enrichment.json');
const SESSION_B2 = loadCapture('session-b2.enrichment.json');

// ============================================================================
// Derivations over a capture — the fixture's own bytes, not this file's memory
// ============================================================================

function fragileEdges(enrichment: Enrichment): readonly Row[] {
  const robustness = enrichment.robustness as Row | undefined;
  const rows = robustness?.fragile_edges;
  expect(Array.isArray(rows)).toBe(true);
  return rows as readonly Row[];
}

function edgeEValues(enrichment: Enrichment): readonly Row[] {
  const rows = enrichment.edge_e_values;
  expect(Array.isArray(rows)).toBe(true);
  return rows as readonly Row[];
}

/** Deep clone so a mutation in one test cannot leak into another's capture. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function tupleKey(row: Row): string {
  return `${String(row.from_id)}::${String(row.to_id)}`;
}

/** Independent re-derivation of the stability band, so the gate's inputs are pinned. */
function bandOf(enrichment: Enrichment, fromId: string, toId: string): string {
  const match = edgeEValues(enrichment).find((e) => e.from_id === fromId && e.to_id === toId);
  expect(match, `no edge_e_values row for ${fromId} -> ${toId}`).toBeDefined();
  const stability = match!.stability as Row;
  const n = stability.n_seeds as number;
  const flipped = stability.n_seeds_flipped as number;
  return flipped === 0 || flipped === n ? 'degenerate' : 'usable';
}

// ============================================================================
// A1-T1 — THE JOIN ARITY PIN. The 0-vs-N is the discriminator, not a detail.
// ============================================================================

describe('A1-T1 join arity — (from_id,to_id) joins; edge_id NEVER does', () => {
  it.each([
    ['session-a', SESSION_A],
    ['session-b2', SESSION_B2],
  ])('%s: edge_id join matches ZERO rows while the tuple join matches some', (_name, enrichment) => {
    const fe = fragileEdges(enrichment);
    const ev = edgeEValues(enrichment);
    expect(fe.length).toBeGreaterThan(0);
    expect(ev.length).toBeGreaterThan(0);

    const byEdgeId = new Set(ev.map((r) => String(r.edge_id)));
    const byTuple = new Set(ev.map(tupleKey));

    const edgeIdMatches = fe.filter((r) => byEdgeId.has(String(r.edge_id))).length;
    const tupleMatches = fe.filter((r) => byTuple.has(tupleKey(r))).length;

    // The trap, at the bytes: the two producers spell the SAME edge with
    // different separators, so the string join is empty — and an empty join is
    // indistinguishable from "no e-value data on this run".
    expect(edgeIdMatches).toBe(0);
    expect(tupleMatches).toBeGreaterThan(0);
    expect(tupleMatches).toBeGreaterThan(edgeIdMatches);
  });

  it('session-a pins the exact 0-vs-7 arity the trap was measured at', () => {
    const fe = fragileEdges(SESSION_A);
    const ev = edgeEValues(SESSION_A);
    const byTuple = new Set(ev.map(tupleKey));
    expect(fe.length).toBe(11);
    expect(fe.filter((r) => byTuple.has(tupleKey(r))).length).toBe(7);
  });

  it('the separators genuinely differ (the precondition the arity depends on)', () => {
    const fe = fragileEdges(SESSION_A)[0]!;
    const ev = edgeEValues(SESSION_A).find(
      (e) => e.from_id === fe.from_id && e.to_id === fe.to_id,
    );
    expect(ev, 'the tuple join must find this row for the comparison to mean anything').toBeDefined();
    expect(String(fe.edge_id)).not.toBe(String(ev!.edge_id));
    expect(String(fe.edge_id)).toContain('->');
    expect(String(ev!.edge_id)).toContain('::');
  });

  it('the selector itself does not fall back to an edge_id join', () => {
    // Rot the e-value edge_id strings to nonsense. A tuple join is unaffected;
    // an edge_id join (or an edge_id fallback) would change the outcome.
    const rotted = clone(SESSION_A);
    for (const row of rotted.edge_e_values as Row[]) row.edge_id = 'rotted::rotted';
    expect(selectFragileEdge(rotted)).toStrictEqual(selectFragileEdge(SESSION_A));
  });
});

// ============================================================================
// A1-T13 — PIN THE PRECONDITION IN-TEST. A discriminator whose fixture nothing
// pins decays into a tautology (trap 13b, third face). Every behavioural
// expectation below names the row it is about; these tests prove that row is
// the one the fixture actually contains.
// ============================================================================

const A_EXPECTED_FROM = 'fac_plg_invest';
const A_EXPECTED_TO = 'risk_activation_failure';
const B2_EXPECTED_FROM = 'fac_packing';
const B2_EXPECTED_TO = 'risk_flour_margin';

describe('A1-T13 fixture preconditions', () => {
  it('session-a: the first TWO producer rows are degenerate and the third is the expected usable one', () => {
    const fe = fragileEdges(SESSION_A);
    expect(bandOf(SESSION_A, String(fe[0]!.from_id), String(fe[0]!.to_id))).toBe('degenerate');
    expect(bandOf(SESSION_A, String(fe[1]!.from_id), String(fe[1]!.to_id))).toBe('degenerate');
    expect(fe[2]!.from_id).toBe(A_EXPECTED_FROM);
    expect(fe[2]!.to_id).toBe(A_EXPECTED_TO);
    expect(bandOf(SESSION_A, A_EXPECTED_FROM, A_EXPECTED_TO)).toBe('usable');
  });

  it('session-b2: the FIRST producer row is already usable (a different shape from session-a)', () => {
    const fe = fragileEdges(SESSION_B2);
    expect(fe[0]!.from_id).toBe(B2_EXPECTED_FROM);
    expect(fe[0]!.to_id).toBe(B2_EXPECTED_TO);
    expect(bandOf(SESSION_B2, B2_EXPECTED_FROM, B2_EXPECTED_TO)).toBe('usable');
  });

  it('these two captures happen to be descending; that is not a producer contract', () => {
    for (const enrichment of [SESSION_A, SESSION_B2]) {
      const probs = fragileEdges(enrichment).map((r) => r.switch_probability as number);
      for (let i = 1; i < probs.length; i++) expect(probs[i]!).toBeLessThanOrEqual(probs[i - 1]!);
    }
  });

  it("`input_quality: 'degenerate_fallback'` occurs ZERO times in either capture", () => {
    for (const enrichment of [SESSION_A, SESSION_B2]) {
      const values = (enrichment.factor_sensitivity as Row[]).map(
        (f) => (f.confidence_provenance as Row | undefined)?.input_quality,
      );
      expect(values.length).toBeGreaterThan(0);
      expect(values.every((v) => v === 'standard')).toBe(true);
    }
  });
});

// ============================================================================
// A1-T2 / A1-T5 — selection binds by IDENTITY and producer-metric priority
// ============================================================================

describe('A1-T2 selection consumes canonical metric order and binds by identity', () => {
  it('session-a selects the first metric-prioritised row that clears every gate, by id', () => {
    const decision = selectFragileEdge(SESSION_A);
    expect(decision.selected).not.toBeNull();
    expect(decision.selected!.fromId).toBe(A_EXPECTED_FROM);
    expect(decision.selected!.toId).toBe(A_EXPECTED_TO);
    expect(decision.refusalReason).toBeNull();
    expect(decision.eValueJoined).toBe(true);
    expect(decision.stabilityBand).toBe('usable');
  });

  it('session-b2 selects its own first eligible row, by id', () => {
    const decision = selectFragileEdge(SESSION_B2);
    expect(decision.selected!.fromId).toBe(B2_EXPECTED_FROM);
    expect(decision.selected!.toId).toBe(B2_EXPECTED_TO);
  });

  it('HEAD-ONLY MUTANT — reversing rows cannot change a finite-metric answer', () => {
    // A `fragileEdges[0]` implementation changes here; the shared selector does
    // not. This is the regression witnessed on unsorted committed captures.
    const resorted = clone(SESSION_A);
    const robustness = resorted.robustness as Row;
    (robustness.fragile_edges as Row[]).reverse();
    const decision = selectFragileEdge(resorted);
    expect(decision.selected).not.toBeNull();
    expect(decision.selected!.fromId).toBe(A_EXPECTED_FROM);
    expect(decision.selected!.toId).toBe(A_EXPECTED_TO);
  });

  function actionableRows(
    probabilities: readonly unknown[],
  ): Enrichment {
    const rows = probabilities.map((switch_probability, index) => ({
      from_id: `fac_${index}`,
      to_id: `out_${index}`,
      from_label: `Factor ${index}`,
      to_label: `Outcome ${index}`,
      switch_probability,
    }));
    return {
      robustness: { fragile_edges: rows },
      edge_e_values: rows.map((row) => ({
        from_id: row.from_id,
        to_id: row.to_id,
        current_mean: 0.5,
        flip_mean: 0.25,
        flip_direction: 'decrease',
        stability: { n_seeds: 10, n_seeds_flipped: 5 },
      })),
      factor_sensitivity: [],
    };
  }

  it('SELECTOR-BYPASS MUTANT — an unsorted actionable set selects its finite maximum', () => {
    const decision = selectFragileEdge(actionableRows([0.1, 0.8, 0.4]));
    expect(decision.selected?.fromId).toBe('fac_1');
  });

  it('ties retain producer order', () => {
    const decision = selectFragileEdge(actionableRows([0.7, 0.7]));
    expect(decision.selected?.fromId).toBe('fac_0');
  });

  it('the producer head is the compatibility fallback only when no metric is finite', () => {
    const decision = selectFragileEdge(actionableRows([Number.NaN, undefined, Number.POSITIVE_INFINITY]));
    expect(decision.selected?.fromId).toBe('fac_0');
  });

  it('DISCRIMINATING MUTANT PAIR — loosening a DIFFERENT edge leaves the answer unchanged', () => {
    // Twin (a): break the SELECTED edge's gate → the answer MUST move.
    const brokeSelected = clone(SESSION_A);
    for (const row of brokeSelected.edge_e_values as Row[]) {
      if (row.from_id === A_EXPECTED_FROM && row.to_id === A_EXPECTED_TO) {
        (row.stability as Row).n_seeds_flipped = (row.stability as Row).n_seeds;
      }
    }
    const moved = selectFragileEdge(brokeSelected);
    expect(moved.selected?.fromId).not.toBe(A_EXPECTED_FROM);

    // Twin (b): make a DIFFERENT, LOWER-priority edge more attractive → the
    // answer MUST NOT move. Neither twin alone proves binding; the pair does.
    const loosenedOther = clone(SESSION_A);
    for (const row of loosenedOther.edge_e_values as Row[]) {
      if (row.from_id === 'out_new_arr' && row.to_id === 'goal_arr') {
        (row.stability as Row).n_seeds_flipped = 5;
      }
    }
    const unmoved = selectFragileEdge(loosenedOther);
    expect(unmoved.selected!.fromId).toBe(A_EXPECTED_FROM);
    expect(unmoved.selected!.toId).toBe(A_EXPECTED_TO);
  });

  it('A1-T6 EXTRACTOR-DELETION — remove the producer array and the selection is gone', () => {
    const stripped = clone(SESSION_A);
    delete (stripped.robustness as Row).fragile_edges;
    const decision = selectFragileEdge(stripped);
    expect(decision.selected).toBeNull();
    expect(decision.refusalReason).toBe('no_fragile_edges');
  });
});

// ============================================================================
// A1-T3 — the stability gate, BOTH ARMS, on real rows
// ============================================================================

describe('A1-T3 stability band gate discriminates on live data', () => {
  it('a 9-of-10 band is USABLE and a 10-of-10 band is DEGENERATE (both are real rows)', () => {
    // Derived from the capture, not asserted from memory.
    expect(bandOf(SESSION_A, 'fac_outbound_invest', 'risk_ramp_drag')).toBe('usable'); // 9/10
    expect(bandOf(SESSION_A, 'fac_partner_invest', 'out_new_arr')).toBe('degenerate'); // 10/10
  });

  it('the degenerate first row is REFUSED rather than selected', () => {
    // Keep ONLY the degenerate head row: the selector must refuse, and must say why.
    const onlyDegenerate = clone(SESSION_A);
    const robustness = onlyDegenerate.robustness as Row;
    robustness.fragile_edges = [(robustness.fragile_edges as Row[])[0]!];
    const decision = selectFragileEdge(onlyDegenerate);
    expect(decision.selected).toBeNull();
    expect(decision.refusalReason).toBe('degenerate_stability_band');
    expect(decision.eValueJoined).toBe(true);
    expect(decision.stabilityBand).toBe('degenerate');
  });

  it('a band flipped on NONE of the seeds is degenerate too (the other arm)', () => {
    const zeroFlips = clone(SESSION_A);
    const robustness = zeroFlips.robustness as Row;
    robustness.fragile_edges = (robustness.fragile_edges as Row[]).filter(
      (r) => r.from_id === A_EXPECTED_FROM && r.to_id === A_EXPECTED_TO,
    );
    expect(robustness.fragile_edges).toHaveLength(1); // positive control on the filter
    for (const row of zeroFlips.edge_e_values as Row[]) {
      if (row.from_id === A_EXPECTED_FROM && row.to_id === A_EXPECTED_TO) {
        (row.stability as Row).n_seeds_flipped = 0;
      }
    }
    expect(selectFragileEdge(zeroFlips).refusalReason).toBe('degenerate_stability_band');
  });

  it('an unjoined row is refused for the RIGHT reason (not conflated with a degenerate band)', () => {
    const unjoined = clone(SESSION_A);
    const robustness = unjoined.robustness as Row;
    // Row [4] is one of the four the producer emits with no e-value counterpart.
    robustness.fragile_edges = (robustness.fragile_edges as Row[]).filter(
      (r) => r.from_id === 'fac_outbound_invest' && r.to_id === 'risk_conversion_shortfall',
    );
    expect(robustness.fragile_edges).toHaveLength(1); // positive control
    const decision = selectFragileEdge(unjoined);
    expect(decision.refusalReason).toBe('no_e_value_join');
    expect(decision.eValueJoined).toBe(false);
    expect(decision.stabilityBand).toBeNull();
  });
});

// ============================================================================
// A1-T4 — the input_quality cross-array join, WITH its positive control
// ============================================================================

describe('A1-T4 degenerate-fallback input quality refuses, and the control proves it can select', () => {
  /** The capture, with the SELECTED edge's SOURCE factor's input_quality set. */
  function withSourceInputQuality(quality: string): Enrichment {
    const next = clone(SESSION_A);
    const rows = next.factor_sensitivity as Row[];
    const source = rows.find((r) => r.factor_id === A_EXPECTED_FROM);
    // Precondition, pinned: the cross-array join has something to join TO.
    expect(source, `factor_sensitivity must carry a row for ${A_EXPECTED_FROM}`).toBeDefined();
    (source!.confidence_provenance as Row).input_quality = quality;
    return next;
  }

  it("POSITIVE CONTROL — with 'standard' the edge IS selected", () => {
    const decision = selectFragileEdge(withSourceInputQuality('standard'));
    expect(decision.selected).not.toBeNull();
    expect(decision.selected!.fromId).toBe(A_EXPECTED_FROM);
  });

  it("with 'degenerate_fallback' on the SOURCE factor the edge is refused", () => {
    const decision = selectFragileEdge(withSourceInputQuality('degenerate_fallback'));
    expect(decision.selected?.fromId).not.toBe(A_EXPECTED_FROM);
  });

  it('the gate joins on from_id — a degenerate fallback on an UNRELATED factor changes nothing', () => {
    // The discrimination: it is not "any degenerate_fallback anywhere refuses".
    const unrelated = clone(SESSION_A);
    const rows = unrelated.factor_sensitivity as Row[];
    const other = rows.find((r) => r.factor_id !== A_EXPECTED_FROM);
    expect(other).toBeDefined();
    (other!.confidence_provenance as Row).input_quality = 'degenerate_fallback';
    expect(selectFragileEdge(unrelated).selected!.fromId).toBe(A_EXPECTED_FROM);
  });

  it('every FACTOR-sourced candidate is refused when all factor input quality is degenerate', () => {
    const allBad = clone(SESSION_A);
    const factorIds = new Set((allBad.factor_sensitivity as Row[]).map((r) => String(r.factor_id)));
    for (const row of allBad.factor_sensitivity as Row[]) {
      (row.confidence_provenance as Row).input_quality = 'degenerate_fallback';
    }
    const selected = selectFragileEdge(allBad).selected;
    // Not "nothing is selected" — that would be a claim this gate cannot make
    // (see the coverage limit below). What IS true: no edge whose SOURCE the
    // gate can see survives.
    expect(selected === null || !factorIds.has(selected.fromId)).toBe(true);
    expect(factorIds.has(A_EXPECTED_FROM)).toBe(true); // positive control on the set
  });

  /**
   * ⚠ COVERAGE LIMIT OF THIS GATE, MEASURED — stated rather than discovered
   * later. `input_quality` lives on `factor_sensitivity`, so the gate can only
   * reach edges whose `from_id` IS a factor. `robustness.fragile_edges` also
   * emits edges sourced from RISK and OUTCOME nodes (session-a:
   * `risk_ramp_drag`, `risk_conversion_shortfall`, `out_new_arr`,
   * `out_partner_leverage`), and those carry no `factor_sensitivity` row and
   * therefore no input-quality evidence at all. They are NOT refused — an
   * absent row means "no evidence", never "bad evidence", and refusing on
   * absence would refuse most of the producer's output.
   */
  it('COVERAGE LIMIT — a NON-factor source has no input-quality evidence and is not refused for it', () => {
    const factorIds = new Set(
      (SESSION_A.factor_sensitivity as Row[]).map((r) => String(r.factor_id)),
    );
    const nonFactorSourced = fragileEdges(SESSION_A).filter(
      (r) => !factorIds.has(String(r.from_id)),
    );
    // Precondition: the capture genuinely contains such rows.
    expect(nonFactorSourced.length).toBeGreaterThan(0);

    const allBad = clone(SESSION_A);
    for (const row of allBad.factor_sensitivity as Row[]) {
      (row.confidence_provenance as Row).input_quality = 'degenerate_fallback';
    }
    const selected = selectFragileEdge(allBad).selected;
    expect(selected).not.toBeNull();
    expect(factorIds.has(selected!.fromId)).toBe(false);
  });
});

// ============================================================================
// THE MUTATION TARGET — `flip_mean`, never `e_value`
// (orchestrator brief correction, verified at the schema bytes)
// ============================================================================

describe('the offered mutation target is a validated flip_mean, never the E-value', () => {
  it('PREMISE, at the fixture bytes — e_value routinely EXCEEDS the settable strength domain', () => {
    // This is why substituting it would be a fabrication: the handler clamps
    // [-1,1], so an E-value of 3.98 becomes 1.0, a number nothing computed.
    const eValues = edgeEValues(SESSION_A).map((r) => r.e_value as number);
    expect(eValues.some((v) => v > EDGE_STRENGTH_MAX)).toBe(true);
    // …while every flip_mean on this capture IS inside the domain.
    for (const row of edgeEValues(SESSION_A)) {
      expect(row.flip_mean as number).toBeGreaterThanOrEqual(EDGE_STRENGTH_MIN);
      expect(row.flip_mean as number).toBeLessThanOrEqual(EDGE_STRENGTH_MAX);
    }
  });

  it('the selection carries current_mean + flip_mean from the JOINED row, bound by endpoint identity', () => {
    const selected = selectFragileEdge(SESSION_A).selected!;
    const joined = edgeEValues(SESSION_A).find(
      (r) => r.from_id === selected.fromId && r.to_id === selected.toId,
    )!;
    expect(selected.currentMean).toBe(joined.current_mean);
    expect(selected.flipMean).toBe(joined.flip_mean);
    expect(selected.flipDirection).toBe(joined.flip_direction);
  });

  it('the E-value is NOT carried on the selection at all', () => {
    const selected = selectFragileEdge(SESSION_A).selected!;
    expect(Object.keys(selected)).not.toContain('eValue');
    expect(Object.keys(selected)).not.toContain('e_value');
    // …and no carried quantity happens to equal it either (a value predicate
    // another field could satisfy is exactly what identity binding forbids).
    const joined = edgeEValues(SESSION_A).find(
      (r) => r.from_id === selected.fromId && r.to_id === selected.toId,
    )!;
    expect(selected.flipMean).not.toBe(joined.e_value);
  });

  it.each([
    ['above the domain', 1.8],
    ['below the domain', -1.4],
  ])('REFUSES when flip_mean is %s', (_name, flipMean) => {
    const bad = clone(SESSION_A);
    const robustness = bad.robustness as Row;
    robustness.fragile_edges = (robustness.fragile_edges as Row[]).filter(
      (r) => r.from_id === A_EXPECTED_FROM && r.to_id === A_EXPECTED_TO,
    );
    expect(robustness.fragile_edges).toHaveLength(1); // positive control
    for (const row of bad.edge_e_values as Row[]) {
      if (row.from_id === A_EXPECTED_FROM && row.to_id === A_EXPECTED_TO) row.flip_mean = flipMean;
    }
    const decision = selectFragileEdge(bad);
    expect(decision.selected).toBeNull();
    expect(decision.refusalReason).toBe('no_usable_flip_target');
  });

  it('POSITIVE CONTROL — the same shape with an in-domain flip_mean IS selected', () => {
    const good = clone(SESSION_A);
    const robustness = good.robustness as Row;
    robustness.fragile_edges = (robustness.fragile_edges as Row[]).filter(
      (r) => r.from_id === A_EXPECTED_FROM && r.to_id === A_EXPECTED_TO,
    );
    for (const row of good.edge_e_values as Row[]) {
      if (row.from_id === A_EXPECTED_FROM && row.to_id === A_EXPECTED_TO) row.flip_mean = 0.4;
    }
    const decision = selectFragileEdge(good);
    expect(decision.selected).not.toBeNull();
    expect(decision.selected!.flipMean).toBe(0.4);
  });

  it('REFUSES when current_mean is missing (no baseline for the change)', () => {
    const bad = clone(SESSION_A);
    const robustness = bad.robustness as Row;
    robustness.fragile_edges = (robustness.fragile_edges as Row[]).filter(
      (r) => r.from_id === A_EXPECTED_FROM && r.to_id === A_EXPECTED_TO,
    );
    for (const row of bad.edge_e_values as Row[]) {
      if (row.from_id === A_EXPECTED_FROM && row.to_id === A_EXPECTED_TO) delete row.current_mean;
    }
    expect(selectFragileEdge(bad).refusalReason).toBe('no_usable_flip_target');
  });

  /**
   * DERIVED DRIFT GUARD. `EDGE_STRENGTH_MIN/MAX` are a copy of constants that
   * live in a file this lane does not own and that does not export them. A copy
   * with no alarm is the mirror class, so the alarm reads the authority's BYTES.
   */
  it('the strength domain agrees with the handler that performs the mutation', () => {
    const handler = readFileSync(
      new URL('../../tools/handlers/adjust-edge-strength.ts', import.meta.url),
      'utf8',
    );
    const min = /STRENGTH_CLAMP_MIN\s*=\s*(-?\d+(?:\.\d+)?)/.exec(handler);
    const max = /STRENGTH_CLAMP_MAX\s*=\s*(-?\d+(?:\.\d+)?)/.exec(handler);
    // Positive control on the probe itself: if the handler is refactored so the
    // constants stop matching, this fails LOUDLY rather than passing vacuously.
    expect(min, 'STRENGTH_CLAMP_MIN not found — this guard has gone blind').not.toBeNull();
    expect(max, 'STRENGTH_CLAMP_MAX not found — this guard has gone blind').not.toBeNull();
    expect(Number(min![1])).toBe(EDGE_STRENGTH_MIN);
    expect(Number(max![1])).toBe(EDGE_STRENGTH_MAX);
  });
});

// ============================================================================
// C5 — THE `visible` RULING (§0.5 left this to the lane; it is pinned here)
// ============================================================================

describe('C5 the producer `visible` flag is NOT a filter — ruling, pinned', () => {
  it('precondition: session-a marks only ONE of eleven rows visible, and it is not the selected one', () => {
    const fe = fragileEdges(SESSION_A);
    expect(fe.filter((r) => r.visible === true)).toHaveLength(1);
    const selected = fe.find((r) => r.from_id === A_EXPECTED_FROM && r.to_id === A_EXPECTED_TO)!;
    expect(selected.visible).toBe(false);
  });

  it('a row marked visible:false is still selectable', () => {
    // Ruling (derived, not preferred): the live UI consumer
    // `useResultsSectionData.ts::challengeFragileEdges` filters on label +
    // switch_probability presence and a resolvable alternative winner — it
    // never reads `visible`. Honouring the flag here would make the assistant
    // refuse to name relationships the results panel is displaying, and would
    // return honest-empty on session-a, a run with four joinable usable rows.
    expect(selectFragileEdge(SESSION_A).selected).not.toBeNull();
  });

  it('flipping every `visible` flag changes nothing', () => {
    const flipped = clone(SESSION_A);
    for (const row of (flipped.robustness as Row).fragile_edges as Row[]) {
      row.visible = !(row.visible === true);
    }
    expect(selectFragileEdge(flipped)).toStrictEqual(selectFragileEdge(SESSION_A));
  });

  it('severity is carried by the producer as a label, never used as a hard gate', () => {
    // Precondition: `critical` occurs zero times, so a critical-only gate would
    // select nothing on either capture.
    for (const enrichment of [SESSION_A, SESSION_B2]) {
      expect(fragileEdges(enrichment).every((r) => r.severity === 'warning')).toBe(true);
      expect(selectFragileEdge(enrichment).selected).not.toBeNull();
    }
  });
});

// ============================================================================
// A1-T7 — the honest empty, and total-function behaviour on junk
// ============================================================================

describe('A1-T7 honest empty', () => {
  it.each<[string, unknown, string]>([
    ['null enrichment', null, 'no_fragile_edges'],
    ['empty object', {}, 'no_fragile_edges'],
    ['robustness with an empty array', { robustness: { fragile_edges: [] } }, 'no_fragile_edges'],
    ['a non-array fragile_edges', { robustness: { fragile_edges: 'nope' } }, 'no_fragile_edges'],
  ])('%s ⇒ null selection with an honest reason', (_name, enrichment, reason) => {
    const decision: FragileEdgeDecision = selectFragileEdge(enrichment);
    expect(decision.selected).toBeNull();
    expect(decision.refusalReason).toBe(reason);
  });

  it('a row with only ONE endpoint is never half-composed', () => {
    const half = { robustness: { fragile_edges: [{ from_id: 'fac_a', from_label: 'A' }] } };
    const decision = selectFragileEdge(half);
    expect(decision.selected).toBeNull();
    expect(decision.refusalReason).toBe('no_edge_identity');
  });

  it('a joined, usable row with no labels is refused rather than named by id', () => {
    const unlabelled = {
      robustness: {
        fragile_edges: [{ from_id: 'fac_a', to_id: 'out_b', switch_probability: 0.5 }],
      },
      edge_e_values: [
        {
          from_id: 'fac_a',
          to_id: 'out_b',
          // Everything ELSE about this row is usable, so the refusal isolates
          // the missing labels rather than tripping an earlier gate.
          current_mean: 0.5,
          flip_mean: 0.2,
          stability: { n_seeds: 10, n_seeds_flipped: 4 },
        },
      ],
    };
    const decision = selectFragileEdge(unlabelled);
    expect(decision.selected).toBeNull();
    expect(decision.refusalReason).toBe('no_edge_identity');
  });
});

// ============================================================================
// A1-T10 — the composite id the graph-edit path accepts
// ============================================================================

describe('A1-T10 composed edge identity', () => {
  it('composes `from→to` from the ENDPOINT PAIR, never from either producer edge_id', () => {
    const decision = selectFragileEdge(SESSION_A);
    const selected = decision.selected!;
    expect(selected.edgeIdentity).toBe(composeEdgeIdentity(A_EXPECTED_FROM, A_EXPECTED_TO));
    expect(selected.edgeIdentity).toBe(`${A_EXPECTED_FROM}→${A_EXPECTED_TO}`);
    // The two producers' own spellings, neither of which is what we compose.
    expect(selected.edgeIdentity).not.toContain('::');
    expect(selected.edgeIdentity).not.toContain('->');
  });
});
