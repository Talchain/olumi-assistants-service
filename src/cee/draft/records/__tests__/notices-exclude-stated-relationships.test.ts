/**
 * #2576 item 1 INTERIM (DL): a relationship the USER stated is never counted under DGAI's Olumi-attributed
 * `relationship_not_used` ("Connections Olumi proposed but couldn't place in the model"). Only 0.76.0 kinds are emitted.
 * Rows read the projector's own typed rows (`projection.dropped`) from a real replay, bound by `claim_kind`.
 */
import { describe, expect, it } from "vitest";
import { ModelBuildingNoticesSchema } from "@talchain/schemas/boundary";
import { buildModelBuildingNotices, NOTICE_KIND_BY_REASON } from "../model-building-notices.js";
import { STATED_ITEM_DROP_KIND } from "../projector.js";
import { replayRecordSet } from "../replay.js";
import { BRIEF, sealedRecordsVNextLinked } from "./compile-spec/sealed-fixture-vnext.js";

/** The sealed draft plus one user no-effect relationship (stated) and one unresolvable Olumi link (claim). */
const NO_EFFECT = "Raising prices will not change monthly support cost.";
async function dropped() {
  const records = sealedRecordsVNextLinked();
  records.stated_items.push({ kind: "cause", source_quote: NO_EFFECT, relationship: { from_quantity: 3, to_quantity: 13, no_effect_literal: "will not change" } } as never);
  records.claims.push({ claim_kind: "causal_link", label: "Unresolved endpoint", from_claim: 999, to_stated: 6, effect: "positive" });
  const compiled = await replayRecordSet(records, { brief: `${BRIEF} ${NO_EFFECT}` });
  if (!compiled.ok) throw new Error(compiled.detail);
  return compiled.projection.dropped;
}
const olumiCount = (n: ReturnType<typeof buildModelBuildingNotices>) => n?.groups.find((g) => g.kind === "relationship_not_used")?.count ?? 0;

describe("#2576 item 1 interim: user-stated rows are excluded from the Olumi-attributed relationship_not_used count", () => {
  it("a stated row is not counted; an Olumi (claim) row still is; the result parses at the pinned 0.76.0 contract", () => {
    const stated = { claim_index: -1, claim_kind: STATED_ITEM_DROP_KIND, stated_index: 10, label: "Repainting the vans will not change late deliveries.", reason: "user_stated_no_effect" };
    const olumi = { claim_index: 4, claim_kind: "causal_link", label: "Unresolved endpoint", reason: "missing_ref" };
    expect(NOTICE_KIND_BY_REASON.user_stated_no_effect).toBe("relationship_not_used");
    expect(buildModelBuildingNotices([stated])).toBeUndefined();
    const both = buildModelBuildingNotices([stated, olumi]);
    expect(olumiCount(both)).toBe(1);
    expect(both!.total_count).toBe(1);
    expect(ModelBuildingNoticesSchema.safeParse(both).success).toBe(true);
    // Contrast: the same stated reason with no typed claim_kind (the V3 rendering) is counted as before.
    const { claim_kind: _k, ...untyped } = stated;
    expect(olumiCount(buildModelBuildingNotices([untyped, olumi]))).toBe(2);
  });

  it("real replay: every relationship_not_used count equals the CLAIM rows only, and the stated rows are present (non-vacuous)", async () => {
    const rows = await dropped();
    const rel = rows.filter((d) => NOTICE_KIND_BY_REASON[d.reason] === "relationship_not_used");
    const statedRel = rel.filter((d) => d.claim_kind === STATED_ITEM_DROP_KIND);
    const claimRel = rel.filter((d) => d.claim_kind !== STATED_ITEM_DROP_KIND);
    expect(claimRel.length).toBeGreaterThan(0);
    const notices = buildModelBuildingNotices(rows);
    expect(olumiCount(notices)).toBe(claimRel.length);
    expect(ModelBuildingNoticesSchema.safeParse(notices).success).toBe(true);
    // Only 0.76.0 kinds.
    for (const g of notices!.groups) expect(["detail_not_connected", "relationship_not_used", "alternative_consolidated", "conflict_resolved_conservatively", "target_not_modelled_as_threshold", "other"]).toContain(g.kind);
    // Non-vacuous: the user's own relationship IS among the refused rows, and it is not in the count.
    expect(statedRel.filter((d) => d.label === NO_EFFECT).map((d) => d.reason)).toEqual(["user_stated_no_effect"]);
    expect(olumiCount(notices)).toBe(rel.length - statedRel.length);
  });
});
