/**
 * The R1 reason → contract-kind mapping, and the aggregation over it.
 *
 * ⭐ THE COMPLETENESS GUARD IS THE POINT OF THIS FILE. `NOTICE_KIND_BY_REASON`
 * is typed `Record<DroppedRecordRef["reason"], …>`, so a reason added to the
 * producer's union fails the BUILD. That is the derived half. The derived half
 * cannot notice that the producer's union is itself short, and it cannot notice
 * a mapping that compiles while saying something false — so this file carries
 * the other half: a corpus of every reason the producer declares, written out
 * by hand from its declaration site, asserting the table's coverage is EXACTLY
 * that set in both directions (trap 12d — derivation proves agreement and can
 * never prove completeness; ship both guards, neither supersedes the other).
 *
 * If the producer gains a reason, the type REDs. If this corpus goes stale
 * against the producer, the set assertions RED. A reason can therefore neither
 * arrive unmapped nor leave unnoticed.
 */
import { describe, it, expect } from "vitest";
import { NOTICE_KIND_BY_REASON, buildModelBuildingNotices } from "../model-building-notices.js";

/**
 * Every `DroppedRecordRef["reason"]` the projector declares, transcribed from
 * `projector.ts:348-527`. Hand-written ON PURPOSE: a list derived from the
 * table it checks would agree with itself.
 */
const PRODUCER_REASONS = [
  "unparseable_ref",
  "ref_out_of_range",
  "ref_target_not_a_node",
  "self_loop",
  "missing_ref",
  "unconnected_to_goal",
  "option_budget_exceeded",
  "ambiguous_ref",
  "ref_kind_illegal",
  "refinement_merged_into_stated_option",
  "undeveloped_duplicate_of_stated",
  "undeveloped_duplicate_of_model",
  "endpoint_demoted_duplicate",
  "disconnected_by_shape_gate",
  "constraint_direction_unstated",
  "stated_target_not_represented_as_threshold",
  "stated_target_value_dropped",
  "parallel_intervention_conflict",
  "parallel_causal_link_conflict",
] as const;

const CONTRACT_KINDS = new Set([
  "detail_not_connected",
  "relationship_not_used",
  "alternative_consolidated",
  "conflict_resolved_conservatively",
  "target_not_modelled_as_threshold",
  "other",
]);

describe("NOTICE_KIND_BY_REASON — completeness against the producer", () => {
  it("maps every reason the projector can emit, and no reason it cannot", () => {
    expect(new Set(Object.keys(NOTICE_KIND_BY_REASON))).toEqual(new Set(PRODUCER_REASONS));
  });

  it("maps every reason to a kind the published contract admits", () => {
    for (const reason of PRODUCER_REASONS) {
      expect(CONTRACT_KINDS.has(NOTICE_KIND_BY_REASON[reason])).toBe(true);
    }
  });

  it("does not collapse the vocabulary onto one kind", () => {
    // A table that mapped everything to `other` would satisfy both assertions
    // above while telling the user nothing.
    expect(new Set(Object.values(NOTICE_KIND_BY_REASON)).size).toBeGreaterThanOrEqual(5);
  });
});

describe("buildModelBuildingNotices — aggregation", () => {
  it("returns undefined when nothing was refused", () => {
    expect(buildModelBuildingNotices([])).toBeUndefined();
    expect(buildModelBuildingNotices(undefined)).toBeUndefined();
    expect(buildModelBuildingNotices("not-an-array")).toBeUndefined();
  });

  it("groups by kind and keeps the total faithful to the entry count", () => {
    const notices = buildModelBuildingNotices([
      { reason: "self_loop" },
      { reason: "ref_kind_illegal" },
      { reason: "unconnected_to_goal" },
    ]);
    expect(notices).toEqual({
      total_count: 3,
      groups: [
        { kind: "detail_not_connected", count: 1 },
        { kind: "relationship_not_used", count: 2 },
      ],
      details_redacted: true,
    });
  });

  it("counts an unreadable entry rather than dropping it", () => {
    // The V3 transform counts rather than throws for the same reason: a channel
    // that quietly loses part of its payload reads like one with nothing to say.
    const notices = buildModelBuildingNotices([null, { reason: 42 }, { reason: "self_loop" }]);
    expect(notices).toEqual({
      total_count: 3,
      groups: [
        { kind: "relationship_not_used", count: 1 },
        { kind: "other", count: 2 },
      ],
      details_redacted: true,
    });
  });

  it("folds record_disclosures_omitted into the total under `other`", () => {
    const notices = buildModelBuildingNotices([{ reason: "self_loop" }], 3);
    expect(notices).toEqual({
      total_count: 4,
      groups: [
        { kind: "relationship_not_used", count: 1 },
        { kind: "other", count: 3 },
      ],
      details_redacted: true,
    });
  });

  it("emits notices when the ONLY signal is an omitted count", () => {
    // Every entry unrenderable is the case where the detail channel has nothing
    // and the user would otherwise be told nothing at all.
    expect(buildModelBuildingNotices([], 2)).toEqual({
      total_count: 2,
      groups: [{ kind: "other", count: 2 }],
      details_redacted: true,
    });
  });

  it("treats an unknown wire reason as `other` rather than guessing", () => {
    expect(buildModelBuildingNotices([{ reason: "a_reason_from_a_newer_producer" }])).toEqual({
      total_count: 1,
      groups: [{ kind: "other", count: 1 }],
      details_redacted: true,
    });
  });

  it("emits groups in a stable order regardless of arrival order", () => {
    const a = buildModelBuildingNotices([{ reason: "self_loop" }, { reason: "unconnected_to_goal" }]);
    const b = buildModelBuildingNotices([{ reason: "unconnected_to_goal" }, { reason: "self_loop" }]);
    expect(a).toEqual(b);
  });
});
