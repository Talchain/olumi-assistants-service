/**
 * THE CONTROLS — the reason this harness is evidence rather than theatre.
 *
 * A quality probe with no control is vacuous. This estate shipped a leak test
 * that captured 0 bytes and therefore passed every assertion by testing
 * nothing; the same shape here would be a rubric that reports "all checks
 * passed" because it is reading a field that does not exist.
 *
 * Two controls, pointing in OPPOSITE directions, because one alone proves
 * nothing:
 *
 *  · NEGATIVE (`TERRIBLE_DRAFT`) — hand-built to exhibit every defect the
 *    rubric claims to see, one per check. It must FAIL essentially everything.
 *    Authoring it is legitimate: it tests the instrument's SENSITIVITY, not its
 *    oracle. A rubric that cannot fail this is not measuring.
 *
 *  · POSITIVE (`KNOWN_GOOD_GRAPH_PATH`) — NOT written here. It is a REAL
 *    capture the estate already holds:
 *    `src/cee/context-integrity/__tests__/fixtures/live-4day-week.cold-read.json`,
 *    the pre-cutover draw that MODEL-QUALITY-BAR §1 Q2 names as *"the POSITIVE
 *    CONTROL the corpus already contains"* — the one capture proving the
 *    constraint path CAN mint, with an authored goal label
 *    (`Deliver 4-Day Week Within Budget and CSAT Floor`) rather than a brief
 *    fragment. A positive control I invented would just encode my own idea of a
 *    good draft and agree with the rubric by construction.
 *
 * ⚠ The positive control's EXPECTED score is asserted in the test as a measured
 * figure, not as an aspiration. It is not a perfect draft and must not be
 * pinned as one — what it must do is score MATERIALLY BETTER than the negative
 * control on the same rubric. A pin that demanded perfection would be re-pinned
 * the first time it failed, which is how a control decays into a tautology.
 */

export const KNOWN_GOOD_GRAPH_PATH =
  "src/cee/context-integrity/__tests__/fixtures/live-4day-week.cold-read.json";

/**
 * Every defect at once. Each node/edge below is annotated with the check it is
 * there to trip, so a future edit cannot silently remove a control's teeth.
 */
export const TERRIBLE_DRAFT = {
  version: "3.0",
  nodes: [
    // D1.4 — the hardcoded literal the projector emits at :2278.
    { id: "dec_1", kind: "decision", label: "Decision", provenance: { provenance_class: "projector_structural" } },
    // D1.1 + D1.2 + D1.3 — two goals, both verbatim brief fragments, one with
    // the `Compound Goal:` string join Q1b forbids.
    {
      id: "goal_1",
      kind: "goal",
      label: "we need to work out whether to hire or wait and also protect margin",
      provenance: {
        provenance_class: "stated",
        source_quote: "we need to work out whether to hire or wait and also protect margin",
      },
    },
    {
      id: "goal_2",
      kind: "goal",
      label: "Compound Goal: grow revenue + hold headcount",
      provenance: { provenance_class: "stated", source_quote: "grow revenue" },
    },
    // D4.2 + D4.3 — verbatim option labels, and two that collapse to the same
    // string after canonicalText.
    {
      id: "opt_1",
      kind: "option",
      label: "hire two developers",
      is_baseline: false,
      provenance: { provenance_class: "stated", source_quote: "hire two developers" },
    },
    {
      id: "opt_2",
      kind: "option",
      label: "Hire  two   developers",
      is_baseline: false,
      provenance: { provenance_class: "stated", source_quote: "Hire  two   developers" },
    },
    // D4.5 — an is_baseline option whose label does not contain "Status Quo",
    // which the served prompt mandates at :279.
    {
      id: "opt_3",
      kind: "option",
      label: "keep it as is",
      is_baseline: true,
      provenance: { provenance_class: "stated", source_quote: "keep it as is" },
    },
    // D2.1 — a bare unit-interval number with no unit and no raw_value.
    {
      id: "fac_1",
      kind: "factor",
      label: "Delivery Velocity",
      data: { value: 0.5 },
      provenance: { provenance_class: "ai_inferred" },
    },
    // D8.1 — badged as the user's own, carrying a magnitude the brief never
    // states. This is the fabrication check.
    {
      id: "fac_2",
      kind: "factor",
      label: "Engineering Budget",
      data: { value: 0.4, raw_value: 987654, unit: "£", extractionType: "explicit" },
      provenance: { provenance_class: "stated", source_quote: "budget" },
    },
    // D5.1 — an orphan: no incoming edge, no outgoing edge.
    { id: "fac_orphan", kind: "factor", label: "Unconnected Thing", provenance: { provenance_class: "ai_inferred" } },
    // D3.1 — NO risk node anywhere, against the served prompt's ">=1 risk".
    { id: "out_1", kind: "outcome", label: "Throughput", provenance: { provenance_class: "ai_inferred" } },
  ],
  edges: [
    { id: "e1", from: "dec_1", to: "opt_1" },
    { id: "e2", from: "dec_1", to: "opt_2" },
    { id: "e3", from: "dec_1", to: "opt_3" },
    { id: "e4", from: "opt_1", to: "fac_1" },
    { id: "e5", from: "fac_1", to: "out_1" },
    // D5.2 — `out_1` never reaches a goal, so the chain stops short.
  ],
} as const;

/** The brief the terrible draft claims to be modelling. `987654` is absent. */
export const TERRIBLE_DRAFT_BRIEF =
  "We need to work out whether to hire or wait and also protect margin. Our budget is about £250,000 this year.";
