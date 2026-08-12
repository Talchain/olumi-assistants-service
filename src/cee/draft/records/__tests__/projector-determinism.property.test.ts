/**
 * DRAFT BY RECORDS — the C-K1 determinism battery.
 *
 *
 * C-K1 (protocol §7): "Projection non-determinism — ANY byte divergence:
 * 100 property fixtures ×2 runs + 3 real record sets ×10 runs, canonical
 * serialisation — and not fixable within one seat-day."
 *
 * ── ⭐ WHY HALF THIS FILE IS CONTROLS ──────────────────────────────────────
 * "Every projection matched every other projection" is a claim an EMPTY
 * projector satisfies perfectly. If `projectRecordsToGraph` returned `{}` for
 * every input, all 100 fixtures would agree with themselves, the battery would
 * be fully green, and it would have proven nothing whatsoever about
 * determinism. That is trap 13's shape (an absence/equality probe with no
 * positive control) and trap 13e's (an instrument that cannot fail).
 *
 * So the equality assertions are the SMALLER half. The battery also carries:
 *
 *  (1) A POSITIVE CONTROL — a deliberately non-deterministic projector run
 *      through the SAME comparator, which MUST be detected. Proves the
 *      comparator can see a divergence at all.
 *  (2) A CONTRAST CONTROL — distinct fixtures must produce DISTINCT
 *      fingerprints. Proves the fingerprint is a function of content, not a
 *      constant. This is the one that kills the empty-projector failure mode,
 *      and it is the assertion trap 13e names as the strongest form: absence
 *      of divergence is only meaningful when a same-run contrast reads
 *      non-zero.
 *  (3) A NON-VACUITY CONTROL — the generated fixtures must actually contain
 *      records, and the projections must actually contain nodes. A generator
 *      that silently produced empty record sets would make (1) and (2) run on
 *      nothing (trap 2b's shape: a suite that collects zero is not a pass).
 *  (4) A KEY-ORDER control on `canonicalSerialise` itself — it must be BLIND
 *      to key order and SENSITIVE to content. A serialiser that ignored both
 *      would make every comparison agree for the wrong reason (trap 13b: a
 *      guard agreeing with itself).
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  canonicalSerialise,
  projectRecordsToGraph,
  projectionFingerprint,
  type RecordProjection,
} from "../projector.js";
import {
  DRAFT_RECORD_CATEGORIES,
  DRAFT_RECORD_CLAIM_KINDS,
  DRAFT_RECORD_DIRECTIONS,
  DRAFT_RECORD_EFFECTS,
  DRAFT_RECORD_ROLES,
  DRAFT_RECORD_STATED_KINDS,
  type DraftRecordSet,
} from "../grammar.js";

// ── Generators ──────────────────────────────────────────────────────────────

/**
 * Text deliberately including the classes a real model emits and a naive
 * canonicaliser mishandles: NBSP, CRLF, tabs, combining marks (NFC), emoji,
 * leading/trailing whitespace. A corpus that omitted these could not certify
 * the projector over inputs the grammar admits (trap 13d: check what the corpus
 * EXCLUDES, not what it covers).
 */
const messyText = fc.oneof(
  fc.string({ minLength: 1, maxLength: 40 }),
  fc.constantFrom(
    "cut costs by 20%",
    "reduce  churn\r\n below 5%",
    "\tmargin\tfloor\t",
    "café rollout", // decomposed é — NFC-normalises
    "café rollout", // precomposed é — must canonicalise identically
    "grow ARR 📈 to £6,000",
    "   leading and trailing   ",
  ),
);

const statedItemArb = fc.record(
  {
    kind: fc.constantFrom(...DRAFT_RECORD_STATED_KINDS),
    source_quote: messyText,
    value: fc.oneof(
      fc.constant(undefined),
      // Sign-symmetric and magnitude-wide ON PURPOSE. Trap 13d: an invariant
      // written with the same asymmetry as the code is a guard agreeing with
      // itself, and the estate has shipped exactly that defect on a magnitude
      // path. Negatives, zero and huge values are all admitted by `type:
      // "number"`, so the corpus must contain them.
      fc.double({ min: -1e9, max: 1e9, noNaN: true, noDefaultInfinity: true }),
    ),
    unit: fc.oneof(fc.constant(undefined), fc.constantFrom("GBP", "%", "months", "£")),
    role: fc.oneof(fc.constant(undefined), fc.constantFrom(...DRAFT_RECORD_ROLES)),
    direction: fc.oneof(fc.constant(undefined), fc.constantFrom(...DRAFT_RECORD_DIRECTIONS)),
  },
  { requiredKeys: ["kind", "source_quote"] },
);

const claimArb = fc.record(
  {
    claim_kind: fc.constantFrom(...DRAFT_RECORD_CLAIM_KINDS),
    label: messyText,
    basis: fc.oneof(fc.constant(undefined), fc.array(fc.integer({ min: -2, max: 8 }), { maxLength: 4 })),
    // Refs include DELIBERATELY BAD ones — out of range, unparseable, absent.
    // The projector's drop path is behaviour under test, not an edge case.
    from_ref: fc.oneof(
      fc.constant(undefined),
      fc.constantFrom("s0", "s1", "s2", "c0", "c1", "c99", "x1", "s", "", "S0"),
    ),
    to_ref: fc.oneof(
      fc.constant(undefined),
      fc.constantFrom("s0", "s1", "s2", "c0", "c1", "c99", "x1", "s", "", "S0"),
    ),
    effect: fc.oneof(fc.constant(undefined), fc.constantFrom(...DRAFT_RECORD_EFFECTS)),
    strength: fc.oneof(fc.constant(undefined), fc.double({ min: -1, max: 1, noNaN: true })),
    category: fc.oneof(fc.constant(undefined), fc.constantFrom(...DRAFT_RECORD_CATEGORIES)),
    value: fc.oneof(fc.constant(undefined), fc.double({ min: -1e6, max: 1e6, noNaN: true })),
  },
  { requiredKeys: ["claim_kind", "label"] },
);

const recordSetArb: fc.Arbitrary<DraftRecordSet> = fc.record({
  // minLength 1 mirrors the grammar's `minItems: 1`.
  stated_items: fc.array(statedItemArb, { minLength: 1, maxLength: 8 }),
  claims: fc.array(claimArb, { maxLength: 8 }),
}) as fc.Arbitrary<DraftRecordSet>;

/** Deep clone so run 2 cannot share mutable state with run 1. */
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ── Real record sets (the "×10 runs" half) ──────────────────────────────────

/**
 * Hand-authored record sets in the shape of the protocol's frozen briefs.
 *
 * ⚠ SCOPE, STATED PLAINLY. These are STRUCTURAL fixtures for the determinism
 * property. They are NOT the frozen briefs' measured record sets and must not
 * be read as evidence about fidelity — no model has emitted a record set on
 * this arm yet, so no such corpus exists. Trap 16-inverse: a fixture the lane
 * wrote itself is not evidence about the wire. Determinism is a property of the
 * PROJECTOR over its whole input domain, which is what the property battery
 * above certifies; these three pin named, readable, realistic shapes.
 */
const REAL_RECORD_SETS: ReadonlyArray<{ name: string; records: DraftRecordSet }> = [
  {
    name: "crm-control-shape",
    records: {
      stated_items: [
        { kind: "goal", source_quote: "cut customer churn", role: "target" },
        { kind: "option", source_quote: "buy a new CRM" },
        { kind: "option", source_quote: "keep the current system" },
        { kind: "constraint", source_quote: "budget of £6,000", value: 6000, unit: "GBP", direction: "ceiling" },
        { kind: "figure", source_quote: "churn is 12%", value: 12, unit: "%", role: "baseline" },
      ],
      claims: [
        { claim_kind: "factor", label: "implementation cost", basis: [1, 3], category: "controllable", value: 4500 },
        { claim_kind: "factor", label: "churn rate", basis: [4], category: "observable", value: 12 },
        { claim_kind: "causal_link", label: "new CRM reduces churn", basis: [1], from_stated: 1, to_claim: 1, effect: "negative", strength: 0.4 },
        { claim_kind: "causal_link", label: "cost pressures budget", from_claim: 0, to_stated: 3, effect: "positive", strength: 0.6 },
      ],
    },
  },
  {
    name: "b-brief-shape-with-unresolvable-and-unbased",
    records: {
      stated_items: [
        { kind: "goal", source_quote: "grow ARR to £2.4m by Q4", value: 2400000, unit: "GBP", role: "target" },
        { kind: "constraint", source_quote: "do not let gross margin drop below 78%", value: 78, unit: "%", direction: "floor" },
      ],
      claims: [
        // Pure invention — `unbased: true`. The honesty half under test.
        { claim_kind: "prior", label: "market grows 8% annually", value: 8 },
        // Deliberately unresolvable: c9 does not exist. MUST be disclosed.
        { claim_kind: "causal_link", label: "dangling link", from_stated: 0, to_claim: 9 },
        // Deliberately a self-loop. MUST be disclosed.
        { claim_kind: "causal_link", label: "self loop", from_stated: 0, to_stated: 0 },
      ],
    },
  },
  {
    name: "duplicate-quotes-and-no-options",
    records: {
      // Identical (kind, quote) twice — collision suffixing under test.
      stated_items: [
        { kind: "figure", source_quote: "headcount is 40", value: 40 },
        { kind: "figure", source_quote: "headcount is 40", value: 40 },
        { kind: "figure", source_quote: "headcount is  40", value: 40 },
      ],
      claims: [],
    },
  },
];

// ── (3) NON-VACUITY CONTROL ─────────────────────────────────────────────────

describe("C-K1 control: the battery is running on something", () => {
  it("generated fixtures are non-empty and project to non-empty graphs", () => {
    let fixtures = 0;
    let totalNodes = 0;
    fc.assert(
      fc.property(recordSetArb, (records) => {
        fixtures += 1;
        const p = projectRecordsToGraph(records);
        totalNodes += p.graph.nodes.length;
        expect(records.stated_items.length).toBeGreaterThan(0);
        // Every stated item maps to a node, so a non-empty input cannot
        // produce an empty graph. If this ever fails the equality assertions
        // below are measuring nothing.
        expect(p.graph.nodes.length).toBeGreaterThan(0);
      }),
      { numRuns: 100, seed: 20260811 },
    );
    expect(fixtures).toBe(100);
    expect(totalNodes).toBeGreaterThan(100);
  });

  it("the real record sets project to graphs with nodes, edges and disclosures", () => {
    const crm = projectRecordsToGraph(REAL_RECORD_SETS[0]!.records);
    expect(crm.graph.nodes.length).toBeGreaterThan(0);
    expect(crm.graph.edges.length).toBeGreaterThan(0);

    // ⭐ THESE RECORD SETS PREDATE THE CONNECTIVITY INSTRUCTION, and that shows.
    // They were captured when the instruction asked only for two lists, so most
    // of their derived material connects to nothing. Pass 3b withdraws it — and
    // the point of asserting it HERE is that the withdrawal is DISCLOSED: every
    // node the projector declines to place is named in `dropped`, so the count
    // that leaves the graph and the count that appears in the disclosure are the
    // same number. Silent loss would satisfy the graph assertion above and fail
    // this one.
    const withdrawn = crm.dropped.filter((d) => d.reason === "unconnected_to_goal");
    expect(withdrawn.length).toBeGreaterThan(0);
    for (const d of withdrawn) expect(d.label.length).toBeGreaterThan(0);

    const b = projectRecordsToGraph(REAL_RECORD_SETS[1]!.records);
    // The two bad refs must be DISCLOSED, not silently swallowed. Asserted as a
    // SET MEMBERSHIP rather than an exact list, because the same `dropped`
    // channel now also carries withdrawals — one vocabulary for "the projector
    // did not place this", which is the point, but it means this assertion must
    // name the reasons it is about.
    const refReasons = b.dropped.map((d) => d.reason).filter((r) => r !== "unconnected_to_goal");
    expect(refReasons.sort()).toEqual(["ref_out_of_range", "self_loop"]);
  });
});

// ── (4) SERIALISER CONTROLS ─────────────────────────────────────────────────

describe("C-K1 control: canonicalSerialise discriminates content, not key order", () => {
  it("is BLIND to key order", () => {
    expect(canonicalSerialise({ a: 1, b: { c: 2, d: 3 } })).toBe(
      canonicalSerialise({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it("is SENSITIVE to values, keys and array order", () => {
    expect(canonicalSerialise({ a: 1 })).not.toBe(canonicalSerialise({ a: 2 }));
    expect(canonicalSerialise({ a: 1 })).not.toBe(canonicalSerialise({ b: 1 }));
    expect(canonicalSerialise([1, 2])).not.toBe(canonicalSerialise([2, 1]));
  });

  it("does not collapse everything to a constant", () => {
    const a = canonicalSerialise(REAL_RECORD_SETS[0]!.records);
    const b = canonicalSerialise(REAL_RECORD_SETS[1]!.records);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(50);
  });
});

// ── (1) POSITIVE CONTROL ────────────────────────────────────────────────────

describe("C-K1 control: the comparator can SEE non-determinism", () => {
  /** A projector that is genuinely non-deterministic, by construction. */
  function nonDeterministicProject(records: DraftRecordSet): RecordProjection {
    const p = projectRecordsToGraph(records);
    return {
      ...p,
      graph: {
        ...p.graph,
        nodes: p.graph.nodes.map((n, i) =>
          i === 0 ? { ...n, label: `${n.label}-${Math.random()}` } : n,
        ),
      },
    };
  }

  it("REDs on an injected non-determinism run through the SAME comparator", () => {
    const records = clone(REAL_RECORD_SETS[0]!.records);
    const a = projectionFingerprint(nonDeterministicProject(records));
    const b = projectionFingerprint(nonDeterministicProject(clone(records)));
    // If this ever passes, the fingerprint is not reading the graph and every
    // equality assertion in this file is vacuous.
    expect(a).not.toBe(b);
  });

  it("REDs on a single changed character in one quote", () => {
    const base = clone(REAL_RECORD_SETS[0]!.records);
    const mutated = clone(base);
    mutated.stated_items[0]!.source_quote = "cut customer churnX";
    expect(projectionFingerprint(projectRecordsToGraph(base))).not.toBe(
      projectionFingerprint(projectRecordsToGraph(mutated)),
    );
  });
});

// ── (2) CONTRAST CONTROL ────────────────────────────────────────────────────

describe("C-K1 control: distinct inputs produce distinct fingerprints", () => {
  it("the three real record sets have three distinct fingerprints", () => {
    const fps = REAL_RECORD_SETS.map((r) => projectionFingerprint(projectRecordsToGraph(r.records)));
    expect(new Set(fps).size).toBe(REAL_RECORD_SETS.length);
  });

  it("100 generated fixtures produce a high proportion of distinct fingerprints", () => {
    const fps: string[] = [];
    fc.assert(
      fc.property(recordSetArb, (records) => {
        fps.push(projectionFingerprint(projectRecordsToGraph(records)));
      }),
      { numRuns: 100, seed: 20260811 },
    );
    // Not 100/100: the generator can legitimately draw the same record set
    // twice, and identical input MUST give an identical fingerprint. A high
    // floor is the honest assertion — a constant fingerprint would read 1.
    expect(new Set(fps).size).toBeGreaterThan(80);
  });
});

// ── C-K1 PROPER ─────────────────────────────────────────────────────────────

describe("C-K1: projector determinism", () => {
  it("100 property fixtures × 2 runs — zero byte divergence", () => {
    let checked = 0;
    fc.assert(
      fc.property(recordSetArb, (records) => {
        const a = projectionFingerprint(projectRecordsToGraph(clone(records)));
        const b = projectionFingerprint(projectRecordsToGraph(clone(records)));
        checked += 1;
        return a === b;
      }),
      { numRuns: 100, seed: 20260811 },
    );
    expect(checked).toBe(100);
  });

  it("100 property fixtures × 2 runs — zero divergence under RAW serialisation too", () => {
    // Canonical serialisation is the protocol's comparison. Raw JSON.stringify
    // is STRICTER (key order counts). Passing both means determinism does not
    // depend on the canonicaliser hiding an ordering wobble — i.e. the pass is
    // not an artefact of the instrument.
    fc.assert(
      fc.property(recordSetArb, (records) => {
        const a = JSON.stringify(projectRecordsToGraph(clone(records)));
        const b = JSON.stringify(projectRecordsToGraph(clone(records)));
        return a === b;
      }),
      { numRuns: 100, seed: 20260811 },
    );
  });

  for (const { name, records } of REAL_RECORD_SETS) {
    it(`real record set "${name}" × 10 runs — one fingerprint`, () => {
      const fps = Array.from({ length: 10 }, () =>
        projectionFingerprint(projectRecordsToGraph(clone(records))),
      );
      expect(new Set(fps).size).toBe(1);
      // Non-vacuity: a fingerprint of "{}" would also be a set of size 1.
      expect(fps[0]!.length).toBeGreaterThan(200);
    });
  }

  it("insertion order is identity-bearing, and reordering is a DIFFERENT graph (not a wobble)", () => {
    const base = clone(REAL_RECORD_SETS[0]!.records);
    const swapped = clone(base);
    [swapped.stated_items[1], swapped.stated_items[2]] = [
      swapped.stated_items[2]!,
      swapped.stated_items[1]!,
    ];
    // Both must be internally stable...
    expect(projectionFingerprint(projectRecordsToGraph(clone(base)))).toBe(
      projectionFingerprint(projectRecordsToGraph(clone(base))),
    );
    expect(projectionFingerprint(projectRecordsToGraph(clone(swapped)))).toBe(
      projectionFingerprint(projectRecordsToGraph(clone(swapped))),
    );
    // ...and DIFFERENT from each other, because `s1`/`s2` refs now point
    // elsewhere. Recording this explicitly so a later reader cannot mistake
    // order-sensitivity for non-determinism: same input ⇒ same output is the
    // claim; different input ⇒ same output would be the real defect.
    expect(projectionFingerprint(projectRecordsToGraph(clone(base)))).not.toBe(
      projectionFingerprint(projectRecordsToGraph(clone(swapped))),
    );
  });
});
