/**
 * S2 — THE PRESERVATION CONTRACT.
 *
 * ── THE MEASURED, UNDISCLOSED LOSS ─────────────────────────────────────────
 * On the deployed capture for the 4-day-week brief (CEE build `32f06dd`,
 * 2026-08-10T22:50Z) the user stated "Current annual support cost is £1.8m".
 * `handleUnreachableFactors` reclassified `fac_support_cost` observable→
 * external, DELETED `data.value`, and substituted a uniform prior. The V5 turn
 * then returned, verbatim:
 *
 *   { "code": "category_reclassified", "node_id": "fac_support_cost",
 *     "reason": "Reclassified unreachable factor \"Annual Support Cost\" to
 *                external with synthesised prior [0.36, 1]" }
 *
 * The user is told the category moved and a prior appeared. They are NOT told
 * their own figure was removed. Meanwhile the audit that DOES fire —
 * `fieldDeletion(..., 'data.value', 'UNREACHABLE_FACTOR_RECLASSIFIED')` — has
 * no value field, so it is structurally incapable of saying what was destroyed.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 * A stage may transform a value; it may not delete one without declaring what
 * it removed, in a form that reaches the user's receipt.
 *
 * ── WHAT THIS DOES NOT DO, DELIBERATELY ────────────────────────────────────
 * It does not read the brief and it does not restore the value. ROADMAP 2.714
 * tried restoring (PR #853) and was REVERTED 54 minutes later (#856): it was
 * measured writing values 10^6x wrong, values the user had negated, values the
 * user had retracted, and values bound to the wrong node — every one stamped
 * with the user's own provenance. `runGraphDataIntegrityChecks`'s `_brief`
 * parameter is now DELIBERATELY INERT and a guard suite exists to keep it so.
 * S2 takes the honest half of 2.714's intent — the user learns their value was
 * not used — and pays none of its price, because every value it reports was
 * already in the payload. Nothing here re-reads prose.
 */

import { describe, it, expect } from "vitest";

import { handleUnreachableFactors } from "../unreachable-factors.js";
import {
  fieldDeletion,
  type FieldDeletionEvent,
} from "../../../utils/field-deletion-audit.js";
import type { EdgeFormat } from "../../../utils/edge-format.js";

/**
 * ── THE INPUT IS THE DEPLOYED STATE, RECONSTRUCTED FROM THE DEPLOYED OUTPUT ──
 *
 * `handleUnreachableFactors` is a pure function of (graph, format), and the
 * cold-read capture is POST-repair — the very fields under test have already
 * been deleted in it, so it cannot be replayed as an input. The pre-repair
 * value is nevertheless DERIVED from the capture rather than invented:
 *
 *   the deployed wire carries prior { range_min: 0.36, range_max: 1 }
 *   `synthesisePriorFromBaseline` (unreachable-factors.ts:157) is injective on
 *   (0.2, 1): margin = max(0.1, v/2) = v/2, so range_min = v - v/2 = v/2
 *   ⇒ 0.36 = v/2 ⇒ v = 0.72, and range_max = min(1, 1.08) = 1 ✓
 *   and 0.72 = 1_800_000 / 2_500_000 = raw_value / cap ✓ (the stated £1.8m)
 *
 * The derivation is asserted below, so if the prior synthesis ever changes this
 * fixture REDs rather than quietly describing a state the pipeline never
 * produces (trap 16-inverse: bound a claim by what the producer can emit).
 */
const DEPLOYED_PRIOR = { range_min: 0.36, range_max: 1 } as const;
const STATED_RAW_VALUE = 1_800_000;
const STATED_CAP = 2_500_000;
const STATED_UNIT = "£";
const DERIVED_BASELINE = STATED_RAW_VALUE / STATED_CAP; // 0.72

function liveGraph() {
  return {
    nodes: [
      { id: "opt_4day", kind: "option", label: "Move to a 4-day week" },
      { id: "opt_status_quo", kind: "option", label: "Keep the 5-day week" },
      { id: "out_csat", kind: "outcome", label: "Customer Satisfaction Score" },
      {
        id: "fac_support_cost",
        kind: "factor",
        label: "Annual Support Cost",
        category: "observable",
        provenance: "from_brief",
        data: {
          value: DERIVED_BASELINE,
          raw_value: STATED_RAW_VALUE,
          cap: STATED_CAP,
          unit: STATED_UNIT,
          factor_type: "cost",
          extractionType: "explicit",
        },
      },
    ],
    // fac_support_cost is deliberately UNCONNECTED to any option — that is the
    // condition that makes it unreachable and triggers the repair.
    //
    // ⚠ V1_FLAT (`strength_mean`/`strength_std`/`belief_exists`), because this
    // repair runs BEFORE the V3 transform, where edges still carry the flat
    // fields rather than the nested `strength: {mean, std}` the cold read shows.
    // An earlier draft of this fixture passed a format string that does not
    // exist in `EdgeFormat` ("from_to") — the tests still went green, because
    // the value is only consulted when the repair PATCHES an edge, so a
    // meaningless format silently exercised a narrower path than production.
    // `tsconfig.build.json` excludes tests, so the local typecheck could not
    // see it; the CI Typecheck Drift ratchet did.
    edges: [
      { from: "opt_4day", to: "out_csat", kind: "causal", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9 },
      { from: "opt_status_quo", to: "out_csat", kind: "causal", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9 },
    ],
  } as any;
}

const EDGE_FORMAT: EdgeFormat = "V1_FLAT";

function runRepair() {
  const graph = liveGraph();
  const result = handleUnreachableFactors(graph, EDGE_FORMAT);
  const node = graph.nodes.find((n: any) => n.id === "fac_support_cost");
  return { graph, result, node };
}

describe("S2 · the fixture reproduces the deployed behaviour it claims to be about", () => {
  it("PRECONDITION: the repair fires on this node and synthesises the deployed prior", () => {
    // trap 13b: a discriminator must PIN ITS OWN PRECONDITION in-test. Without
    // this, every assertion below could pass on a graph where nothing happened.
    const { result, node } = runRepair();
    expect(result.reclassified).toContain("fac_support_cost");
    expect(node.category).toBe("external");
    expect(node.prior).toMatchObject(DEPLOYED_PRIOR);
    expect(node.data?.value).toBeUndefined();
  });
});

describe("S2 · the audit can say WHAT it deleted", () => {
  it("carries the deleted value, unit and provenance on the data.value event", () => {
    const { result } = runRepair();
    const ev = result.fieldDeletions.find(
      (d) => d.node_id === "fac_support_cost" && d.field === "data.value",
    );
    expect(ev, "the data.value deletion is audited").toBeDefined();
    expect(ev!.reason).toBe("UNREACHABLE_FACTOR_RECLASSIFIED");
    expect(ev!.previous_value).toBe(DERIVED_BASELINE);
    expect(ev!.previous_raw_value).toBe(STATED_RAW_VALUE);
    expect(ev!.previous_unit).toBe(STATED_UNIT);
    expect(ev!.previous_provenance).toBe("from_brief");
  });

  it("leaves stated_item_id null — the Stated Ledger (S3) is not built, and a fabricated id is worse than none", () => {
    const { result } = runRepair();
    const ev = result.fieldDeletions.find((d) => d.field === "data.value")!;
    expect(ev.stated_item_id).toBeNull();
  });

  it("still records a deletion when there is no value to report — absence of a value is not absence of a deletion", () => {
    // OPPOSITE-DIRECTION TWIN. Fail CLOSED (design §4.4): where a stage cannot
    // tell what it removed, it declares the removal anyway. Over-declaring is
    // noise; under-declaring is the defect.
    const graph = liveGraph();
    const n = graph.nodes.find((x: any) => x.id === "fac_support_cost");
    n.data = { value: 0.5 }; // no raw_value, no cap, no unit
    delete n.provenance;
    const result = handleUnreachableFactors(graph, EDGE_FORMAT);
    const ev = result.fieldDeletions.find((d) => d.field === "data.value");
    expect(ev).toBeDefined();
    expect(ev!.previous_value).toBe(0.5);
    expect(ev!.previous_unit).toBeUndefined();
    expect(ev!.previous_provenance).toBeUndefined();
  });

  it("fieldDeletion() with no previous state is byte-identical to the pre-S2 event — every other call site is untouched", () => {
    const bare = fieldDeletion("threshold-sweep", "n1", "goal_threshold", "THRESHOLD_STRIPPED_NO_RAW");
    expect(Object.keys(bare).sort()).toEqual(["field", "node_id", "reason", "stage"]);
  });
});

describe("S2 · the loss reaches the user's receipt, not just a trace", () => {
  it("puts the deleted value on the repair record so boundary can project it into model_adjustments.before", () => {
    const { result } = runRepair();
    const repair = result.repairs.find((r) => r.path.includes("fac_support_cost"));
    expect(repair, "the reclassification repair exists").toBeDefined();
    expect(repair!.code).toBe("UNREACHABLE_FACTOR_RECLASSIFIED");
    expect(repair!.deleted_value).toBe(DERIVED_BASELINE);
    expect(repair!.deleted_raw_value).toBe(STATED_RAW_VALUE);
    expect(repair!.deleted_unit).toBe(STATED_UNIT);
  });

  it("says in the user-visible reason that the stated figure is not in the maths", () => {
    const { result } = runRepair();
    const repair = result.repairs.find((r) => r.path.includes("fac_support_cost"))!;
    // The magnitude the USER wrote (£1.8m), not the normalised 0.72 — a ratio
    // presented as a business figure is the `fac_support_cost` display defect
    // one level up (rendered "£0.4 to £1" for a stated £1.8m).
    expect(repair.action).toContain("£1,800,000");
    expect(repair.action.toLowerCase()).toContain("not used");
  });

  it("does NOT claim the value came from the brief — the pipeline extracted it, and over-claiming provenance is the 2.714 defect", () => {
    const { result } = runRepair();
    const repair = result.repairs.find((r) => r.path.includes("fac_support_cost"))!;
    expect(repair.action).not.toMatch(/you (said|stated|told)/i);
    expect(repair.action).not.toMatch(/your own words/i);
  });

  it("omits the figure sentence entirely when no figure was deleted — never an empty promise", () => {
    // OPPOSITE-DIRECTION TWIN: a node with no data must not gain a sentence
    // about a value that never existed.
    const graph = liveGraph();
    const n = graph.nodes.find((x: any) => x.id === "fac_support_cost");
    delete n.data;
    const result = handleUnreachableFactors(graph, EDGE_FORMAT);
    const repair = result.repairs.find((r) => r.path.includes("fac_support_cost"))!;
    expect(repair.action.toLowerCase()).not.toContain("not used");
    expect(repair.deleted_value).toBeUndefined();
  });

  it("binds every deletion event to a node that exists in the graph (the elements_added id-validation, mirrored)", () => {
    const { graph, result } = runRepair();
    const ids = new Set(graph.nodes.map((n: any) => n.id));
    for (const d of result.fieldDeletions) {
      expect(ids.has(d.node_id), `${d.node_id} resolves in nodes[]`).toBe(true);
    }
  });
});

/**
 * ── ONE ADAPTER SHORT IS THE WHOLE DEFECT ──────────────────────────────────
 *
 * A surfacing spec that asserts on CEE's own output and stops there has proven
 * nothing about what a user reads. The deployed UI
 * (`DecisionGuideAI/src/canvas/components/pre-analysis/ModelAdjustments.tsx`,
 * read at `7b5992fca4556334a00560a6dc142c62670f6dd5`) does NOT render `reason`
 * verbatim: it runs it through `sanitiseDetail()`, which strips quoted
 * lowercase tokens, `nodes[...]` paths, prior notation, and PARENTHESISED BARE
 * NUMBERS, then shows the remainder behind a "Details" toggle.
 *
 * The transform below is a VERBATIM COPY of that function pinned to that
 * commit. It is a historical control, not a mirror to keep current (trap 12b):
 * its job is to prove that the sentence we ship today survives the UI that is
 * deployed today. A `£1,800,000` written as `(1800000)` would be silently
 * deleted by the fourth rule and the user would read a sentence with the figure
 * missing — which is worse than saying nothing.
 */
describe("S2 · the sentence survives the DEPLOYED UI's sanitiser with the figure intact", () => {
  const UI_SHA = "7b5992fca4556334a00560a6dc142c62670f6dd5";

  /** VERBATIM from ModelAdjustments.tsx at UI_SHA. Do not "improve" it. */
  function sanitiseDetail(detail: string): string {
    const signCorrectionPattern =
      /effect_direction\s+["']?\w+["']?\s+contradicts\s+strength[_.]mean\s+sign\s*\([^)]*\)/gi;
    if (signCorrectionPattern.test(detail)) {
      return "Relationship direction didn't match the stated effect. Corrected automatically";
    }
    return detail
      .replace(/\bReclassified unreachable factor\b/gi, "Moved")
      .replace(/\s*with synthesised prior\s*\[[^\]]*\]/gi, "")
      .replace(/["'][a-z_]+(\.[a-z_]+)*["']/g, "")
      .replace(/\b(nodes|edges)\[[^\]]*\]/g, "")
      .replace(/\b(strength\.mean|strength_mean|effect_direction|observed_state\.\w+)\b/g, "")
      .replace(/\s*\(\s*-?[\d.]+\s*\)/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/^\s*[—\-–]\s*/, "")
      .trim();
  }

  it("POSITIVE CONTROL: the sanitiser is live and does strip things — an inert transform would make every assertion below vacuous", () => {
    // trap 13: a test proving something survives must first prove the thing it
    // survives actually bites.
    expect(sanitiseDetail("Reclassified unreachable factor \"X\" to external")).toContain("Moved");
    expect(sanitiseDetail("kept with synthesised prior [0.36, 1]")).not.toContain("0.36");
    expect(sanitiseDetail("dropped (1800000) here")).not.toContain("1800000");
  });

  it(`keeps £1,800,000 legible after the UI at ${UI_SHA} sanitises it`, () => {
    const { result } = runRepair();
    const shown = sanitiseDetail(
      result.repairs.find((r) => r.path.includes("fac_support_cost"))!.action,
    );
    expect(shown).toContain("£1,800,000");
    expect(shown.toLowerCase()).toContain("not used");
    expect(shown.length).toBeGreaterThan(0);
  });

  it("carries the figure STRUCTURALLY too, so the UI need not parse prose to render it honestly", () => {
    const { result } = runRepair();
    const repair = result.repairs.find((r) => r.path.includes("fac_support_cost"))!;
    // `ModelAdjustment.before` is already declared in the shared contract
    // (`schemas/analysis-ready.ts:200`) and has never been populated on this
    // path — the absent projection line. This is the value that fills it.
    expect(repair.deleted_raw_value).toBe(STATED_RAW_VALUE);
    expect(repair.deleted_unit).toBe(STATED_UNIT);
  });
});

describe("S2 · FieldDeletionEvent shape", () => {
  it("keeps every pre-S2 field, so trace.field_deletions consumers are unaffected", () => {
    const ev: FieldDeletionEvent = {
      stage: "unreachable-factors",
      node_id: "fac_x",
      field: "data.value",
      reason: "UNREACHABLE_FACTOR_RECLASSIFIED",
    };
    expect(ev.stage).toBe("unreachable-factors");
    expect(ev.previous_value).toBeUndefined();
  });
});
