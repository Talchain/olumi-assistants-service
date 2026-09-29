/**
 * BIAS-SURFACE LIVENESS GATE — shared positive-control fixtures.
 *
 * Design record binding (derive-don't-mirror; rule-12 discipline):
 *   - AI-EXPERIENCE-DESIGN-DRAFT-2026-07-14.md §1.5 — behavioural-bias
 *     coaching is a NAMED, load-bearing surface. Any change that silences
 *     a bias surface must turn this gate RED, whatever the commit message
 *     says (the 30-Mar node-icon strip shipped under a false "reuse
 *     unchanged" message; this gate exists so that class of deletion can
 *     never again read as green).
 *   - BIAS-COACHING-PROPOSAL-2026-07-16.md §4 — legs 1 (positive control)
 *     and 2 (wire) consume THIS fixture. The UI surface leg (leg 3) and
 *     the served-prompt behavioural leg (leg 4,
 *     scripts/bias-prompt-liveness-postcheck.ts) bind to the same §1.5
 *     surface list.
 *
 * POSITIVE CONTROL (trap-13): every downstream absence assertion
 * ("no bias content rendered / emitted") is vacuous unless this graph
 * PROVABLY triggers findings. The graph below is constructed to trip TWO
 * deterministic detectors that do NOT depend on the
 * CEE_BIAS_STRUCTURAL_ENABLED flag or on archetype metadata, so the gate
 * holds under the minimum engine posture:
 *
 *   1. SELECTION_LOW_OPTION_COUNT  — exactly one option node.
 *   2. MEASUREMENT_MISSING_RISKS_OR_OUTCOMES — zero risk AND zero
 *      outcome nodes.
 *
 * If a detector rename/removal ever breaks these ids, the gate goes RED —
 * that is the intended behaviour: renaming a detector is a change to a
 * named design surface and must be reconciled here AND in the design
 * record, not silently absorbed.
 */

/** Minimal GraphV1-shaped decision graph that provably triggers >=2 biases. */
export const BIAS_LIVENESS_GRAPH = {
  version: "1",
  default_seed: 17,
  nodes: [
    { id: "goal_liveness", kind: "goal", label: "Cut fulfilment cost per unit" },
    { id: "opt_continue", kind: "option", label: "Continue current vendor rollout" },
    {
      id: "fac_invested_spend",
      kind: "factor",
      label: "Capital already invested",
      category: "controllable",
    },
    {
      id: "fac_vendor_quote",
      kind: "factor",
      label: "Vendor phase-two quote",
      category: "external",
    },
  ],
  edges: [
    {
      id: "e_opt_goal",
      from: "opt_continue",
      to: "goal_liveness",
      strength_mean: 0.6,
      strength_std: 0.15,
      belief_exists: 0.9,
      effect_direction: "positive",
    },
    {
      id: "e_fac_opt",
      from: "fac_invested_spend",
      to: "opt_continue",
      strength_mean: 0.5,
      strength_std: 0.2,
      belief_exists: 0.8,
      effect_direction: "positive",
    },
  ],
  meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
};

/**
 * The finding ids the fixture MUST trigger (flag-independent detectors).
 * Leg 1 asserts both are present; legs 2a/2b carry the same findings
 * through the wire seams.
 */
export const BIAS_LIVENESS_EXPECTED_FINDING_IDS = [
  "selection_low_option_count",
  "measurement_missing_risks_or_outcomes",
] as const;

/**
 * Decision-review LLM output fragment (the `decision_review` enrichment
 * shape consumed by buildReviewCardBlocks). Mirrors the served
 * decision_review prompt's OUTPUT_SCHEMA bias_findings entries
 * ({type, description, affected_elements, ...}). Used by leg 2b to prove
 * a bias finding still becomes a `review_card` block with
 * `card_kind: 'bias'`.
 *
 * Prose constraints match the ratified card spec
 * (COACHING-REVIEW-UI-BRIEF.md): no raw node ids in user-facing text, no
 * "bias detected" banner language, behaviour described, not diagnosis.
 */
export const DECISION_REVIEW_BIAS_FIXTURE = {
  bias_findings: [
    {
      type: "SUNK_COST",
      source: "structural",
      description:
        "The case for continuing leans on capital already spent rather than on forward-looking returns.",
      affected_elements: ["fac_invested_spend"],
      suggested_action: "Re-evaluate the decision using only future costs and benefits.",
    },
    {
      type: "ANCHORING",
      source: "structural",
      description:
        "Planning figures cluster around the vendor's first quote rather than independently derived estimates.",
      affected_elements: ["fac_vendor_quote"],
      suggested_action: "Source an independent cost estimate before committing.",
    },
  ],
};

/** Graph nodes for buildGraphNodeLookup in leg 2b (label resolution). */
export const BIAS_LIVENESS_REVIEW_GRAPH_NODES = [
  { id: "fac_invested_spend", label: "Capital already invested", kind: "factor" },
  { id: "fac_vendor_quote", label: "Vendor phase-two quote", kind: "factor" },
];
