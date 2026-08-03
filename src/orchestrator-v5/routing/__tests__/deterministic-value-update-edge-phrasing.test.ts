/**
 * ROADMAP 2.389a — THE EDGE-PHRASING NEGATIVE GATE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, measured live on staging build `672b634` by L56
 * (`PHASE0-EVIDENCE-2026-07-28/diagnosis-first-message-deadend.md` §5.1, raw
 * bodies in `scratchpad/l56/out-edge*`):
 *
 *   "Make the link from Ad-Supported Model to Ad Revenue 2"
 *     → `set_factor_value`, `fac_ads_model` 0 → **2**, receipt says "Applied".
 *
 * The user named an EDGE. The product mutated a FACTOR, applied an
 * out-of-range value to it, and returned a receipt every field of which is
 * true. Nothing compares the applied target against the target the message
 * named, so a silent substitution is indistinguishable from a fulfilled
 * request. This is the one path in L56's survey that fails UNSAFE.
 *
 * ⭐ THE MECHANISM — and it is the guard that was supposed to protect us.
 * `turn-executor.ts` narrows the candidate pool to `factorIdSet` before
 * matching. An edge sentence names a factor at one end and a NON-factor
 * (risk / outcome / goal) at the other, so the second endpoint is REMOVED
 * FROM THE POOL and a two-label edge sentence collapses into a single
 * substring match → score 1 → auto-select → `set_factor_value`.
 * **The type filter that exists to stop non-factor nodes being mutated is
 * precisely what makes the edge sentence look unambiguous.**
 *
 * THE FIX: a textual negative gate, a sibling of `HYPOTHETICAL_PATTERNS`.
 * A sentence that names a relationship AND joins two endpoints is not a
 * factor-value update; it belongs to the routing LLM, which L56 MEASURED
 * getting it right (case C2 → `adjust_edge_strength` with the sign
 * preserved; walk case E likewise).
 *
 * ⚠ THE GATE FAILS SAFE BY CONSTRUCTION. Over-gating costs one LLM call on
 * the path the LLM already handles correctly. Under-gating mutates the wrong
 * object and tells the user it worked. The asymmetry is why the predicate is
 * a conjunction rather than a narrow phrase list — and why the PRESERVATION
 * corpus below (drawn from this module's OWN existing tests, hand-written so
 * it can notice a short list — CLAUDE.md trap 12d) is not optional.
 *
 * ⚠ EVERY ASSERTION BINDS BY IDENTITY (trap 19). The pristine defect targets
 * `fac_ads_model` by id; the pins assert the absence of a dispatch and the
 * exact skip reason, never "some value did not change".
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';

import { extractQuantities } from '../../context/cqe/extract-quantities.js';
import type { GraphLookup } from '../validator.js';
import { tryDeterministicValueUpdate } from '../deterministic-value-update.js';

/**
 * A graph lookup that models the REAL shape of the defect: `listEntitiesByKind`
 * returns every node kind under the `'node'` bucket (exactly as
 * `graph-lookup-adapter.ts:toEntityKind` does), and the caller supplies
 * `factorNodeIds` covering only the factor-kind ids. That is the production
 * configuration, and it is what makes a two-endpoint sentence look
 * unambiguous.
 */
function makeMixedGraph(
  nodes: ReadonlyArray<{ id: string; label: string }>,
): GraphLookup {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    findEntityById: (id) => {
      const n = byId.get(id);
      return n ? { id: n.id, kind: 'node', label: n.label } : null;
    },
    listEntitiesByKind: (kind) => {
      if (kind !== 'node') return [];
      return nodes.map((n) => ({ id: n.id, label: n.label }));
    },
  };
}

// ── L56's MEASURED graph (out-edge/00-draft.json labels + causal-edges.json) ─
const ADS_FACTOR_ID = 'fac_ads_model';
const MEASURED_GRAPH = makeMixedGraph([
  { id: ADS_FACTOR_ID, label: 'Ad-Supported Model' },
  { id: 'out_ad_revenue', label: 'Ad Revenue' },
  { id: 'risk_user_erosion', label: 'Competitive User Erosion' },
  { id: 'fac_comp_intensity', label: 'Competitive Response Intensity' },
  { id: 'risk_churn_rate', label: 'Subscriber Churn Rate' },
  { id: 'risk_billing_delay', label: 'Billing Launch Delay' },
  { id: 'goal_revenue', label: 'Grow Revenue to £6 Million' },
]);
/** Production always supplies this. Only the factor-kind ids are in it. */
const MEASURED_FACTOR_IDS: ReadonlySet<string> = new Set([
  ADS_FACTOR_ID,
  'fac_comp_intensity',
]);

function run(message: string) {
  return tryDeterministicValueUpdate(
    message,
    extractQuantities(message),
    MEASURED_GRAPH,
    [],
    MEASURED_FACTOR_IDS,
    false,
  );
}

/**
 * ⭐ CORPUS 1 — THE FOUR MEASURED **MISDIRECTS**, verbatim from the raw
 * request bodies (`out-edge/*-MSG.txt` and the walk's own case C). These are
 * the sentences that on the deployed build APPLIED a value to the wrong
 * object. Hand-written, deliberately NOT derived from the gate's own regexes:
 * a list derived from the predicate it polices can only prove agreement,
 * never completeness (trap 12d).
 *
 * ⭐ THIS FIXTURE REPRODUCES THE LIVE DEFECT LOCALLY, exactly. Measured on
 * pristine `672b6347` before the gate existed, by executing the production
 * module against the fixture below:
 *
 *   A1     → set_factor_value  fac_ads_model       score 1  value 0.6
 *   A2     → set_factor_value  fac_ads_model       score 1  value 0.7
 *   B1     → set_factor_value  fac_ads_model       score 1  value **2**
 *   walk-C → set_factor_value  fac_comp_intensity  score 1  value 0.6
 *
 * — the same targets and the same values L56 read off the wire. The `target`
 * is what makes each pin identity-bound: `fac_ads_model` is the object the
 * user never named.
 */
const MEASURED_MISDIRECTS: ReadonlyArray<readonly [tag: string, message: string]> = [
  // out-edge/A1-misdirect-MSG.txt — in-range, "<A> to <B> link strength <n>"
  ['A1', 'Make the Ad-Supported Model to Competitive User Erosion link strength 0.6'],
  // out-edge/A2-control-inrange-MSG.txt — in-range, "link from <A> to <B> <n>"
  ['A2', 'Make the link from Ad-Supported Model to Ad Revenue 0.7'],
  // out-edge/B1-executor-out-of-range-MSG.txt — THE UNSAFE ONE: 2 applied to a factor
  ['B1', 'Make the link from Ad-Supported Model to Ad Revenue 2'],
  // the walk's case C (journey-witness-2026-08-04d, w2b/T2-C-numeric-0.6)
  ['walk-C', 'Make the Competitive Response Intensity to Subscriber Churn Rate link strength 0.6'],
];

/**
 * CORPUS 2 — edge sentences L56 measured going to the routing LLM CORRECTLY
 * (`out-edge2`, all three `exit_path: turn_executor` with a `routing`-role
 * call). They were already safe on pristine, but for an INCIDENTAL reason:
 * neither endpoint is factor-kind, so the pre-route skipped on
 * `no_candidate_match` — measured, not assumed. Pinned so the whole CLASS
 * leaves by one named door and stays observable; NOT counted as evidence the
 * gate fixed anything.
 */
const ALREADY_SAFE_EDGE_SENTENCES: ReadonlyArray<readonly [tag: string, message: string]> = [
  // out-edge2 C1 — non-factor endpoints, out of range → FIX3's copy fires
  ['C1', 'Make the link from Billing Launch Delay to Grow Revenue to £6 Million 2'],
  // out-edge2 C2 — non-factor endpoints, in range → LLM proposed adjust_edge_strength
  ['C2', 'Make the link from Billing Launch Delay to Grow Revenue to £6 Million 0.7'],
  // out-edge2 C4 — explicit "edge strength between <A> and <B>"
  ['C4', 'Make the edge strength between Ad Revenue and Grow Revenue to £6 Million equal to 5'],
];

describe('edge-phrasing negative gate — the four MEASURED misdirects', () => {
  it.each(MEASURED_MISDIRECTS)(
    '%s — an edge sentence is NOT claimed by the factor-value pre-route',
    (_tag, message) => {
      const result = run(message);

      // IDENTITY-BOUND: on pristine this dispatches `set_factor_value`
      // against a NAMED id (`fac_ads_model` / `fac_comp_intensity`, recorded
      // above). Asserting on `matched` makes "no factor was mutated" a
      // statement about the DISPATCH, not about a value nobody read.
      expect(
        result.matched,
        'an edge sentence must fall to the routing LLM, never to the factor-value pre-route',
      ).toBe(false);
      if (result.matched) return;
      expect(result.skip_reason).toBe('edge_phrasing_gate');
    },
  );

  it.each(ALREADY_SAFE_EDGE_SENTENCES)(
    '%s — already safe on pristine (`no_candidate_match`), now leaves by the NAMED door',
    (_tag, message) => {
      const result = run(message);
      expect(result.matched).toBe(false);
      if (result.matched) return;
      expect(result.skip_reason).toBe('edge_phrasing_gate');
    },
  );

  it('B1 — the out-of-range `2` can no longer be applied to a factor at all', () => {
    // The single most damaging measured outcome: `fac_ads_model` 0 → 2 with an
    // "Applied" receipt. Pinned separately from the corpus loop so its
    // regression is legible in a failure report on its own.
    const result = run('Make the link from Ad-Supported Model to Ad Revenue 2');
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.skip_reason).toBe('edge_phrasing_gate');
  });

  it('INSTRUMENT: the fixture really is the defect — CQE extracts the value and one factor survives the type filter', () => {
    // Without this, every `matched === false` above could be passing for a
    // boring reason (no quantity, no candidate) and the gate would be
    // untested. `Ad-Supported Model` is the ONLY factor-kind label in the
    // B1 sentence, which is exactly the collapse the gate exists to stop.
    const message = 'Make the link from Ad-Supported Model to Ad Revenue 2';
    const cqe = extractQuantities(message).filter((q) => q.value !== null);
    expect(cqe.length, 'CQE must find the number, or the pre-route would skip on `no_quantity`').toBeGreaterThan(0);
    expect(cqe.some((q) => q.value === 2)).toBe(true);

    const survivingFactorLabels = ['Ad-Supported Model', 'Ad Revenue']
      .filter((label) => {
        const node = [...MEASURED_FACTOR_IDS].find(
          (id) => MEASURED_GRAPH.findEntityById(id)?.label === label,
        );
        return node !== undefined;
      });
    expect(
      survivingFactorLabels,
      'exactly one endpoint survives `factorIdSet` — that is the mechanism',
    ).toEqual(['Ad-Supported Model']);
  });
});

/**
 * ⭐ THE PRESERVATION CORPUS — the gate must not gut the fast path.
 *
 * Every message here is taken from THIS MODULE'S OWN EXISTING TESTS
 * (`deterministic-value-update.test.ts`, `.from-to.test.ts`,
 * `-option-intervention.test.ts`), i.e. from phrasings the product already
 * promises to answer deterministically. Hand-written rather than derived,
 * for the same reason the misdirect corpus is.
 *
 * A `matched === false` here is allowed ONLY when the skip reason is one that
 * already existed — what must never happen is `edge_phrasing_gate`.
 */
const LEGITIMATE_VALUE_UPDATES: readonly string[] = [
  'Set Ad-Supported Model to 0.6',
  'Set Hiring and Staffing Cost to £300k',
  'Set Engineering Capacity to 8',
  'Set Annual Support Cost to £135,000',
  'Set Advertising budget to £30k',
  'Update Advertising budget to £30k',
  'Increase the budget to £300k',
  'Increase the budget by £20k.',
  'Set Marketing Cost to 20%',
  'Set North America Market Growth Rate to £5m',
  'Set migration cost to £250k.',
  'Set Customer Churn Risk to 20%',
  'Set Hiring and Staffing Cost to £300k for the budget',
  'INCREASE Hiring and Salary Cost FROM £80,000 TO £100,000',
  'increase Market Size from £1bn to £2bn',
  'Raise budget and cost to £30k',
  'Set fastest delivery to 5',
  'Set Hiring and Staffing Cost and Marketing Cost to 50 and 100',
];

describe('edge-phrasing negative gate — PRESERVATION (the fast path is not gutted)', () => {
  it.each(LEGITIMATE_VALUE_UPDATES)(
    'a legitimate value-update phrasing is NEVER diverted by the edge gate: %s',
    (message) => {
      const result = tryDeterministicValueUpdate(
        message,
        extractQuantities(message),
        MEASURED_GRAPH,
        [],
        MEASURED_FACTOR_IDS,
        false,
      );
      if (result.matched) return;
      expect(
        result.skip_reason,
        'this phrasing may skip for a PRE-EXISTING reason, but never because of the edge gate',
      ).not.toBe('edge_phrasing_gate');
    },
  );

  it('OVER-GATING CONTROL: the plain factor update on the SAME graph still auto-selects `set_factor_value` by id', () => {
    // The one arm that would catch a gate widened until it swallows the fast
    // path. Bound to the target id, never to the value (trap 19).
    const result = run('Set Ad-Supported Model to 0.6');
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dispatch).toBe('set_factor_value');
    if (result.dispatch !== 'set_factor_value') return;
    expect(result.candidate.id).toBe(ADS_FACTOR_ID);
  });
});
