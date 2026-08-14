/**
 * A REPAIR MAY NOT SIGN THE USER'S NAME TO A VALUE IT INVENTED.
 *
 * ── THE WITNESS ────────────────────────────────────────────────────────────
 * First-use acceptance shield, 14 Aug (`first-use-acceptance-2026-08-14/VERDICT.md`
 * P0-3). Brief `D_messy` says *"the team is stretched thin"* and states no burnout
 * figure. The delivered graph carried, on BOTH graph surfaces:
 *
 *   "Team burnout and attrition risk" → { value: 0, source: "brief_extraction",
 *                                         extractionType: "observed" },
 *                                       display_value "0", provenance "from_brief"
 *
 * The product claimed it had OBSERVED, FROM THE USER'S OWN BRIEF, a burnout of
 * zero — a value the user never gave, asserted as theirs, and semantically the
 * inverse of what they wrote. It was **the only `from_brief` claim in the entire
 * streaming-frame surface across 12 draws**: the one time the product asserted the
 * user's authorship, it was wrong.
 *
 * ── THE CHAIN, DERIVED AT THE BYTES ────────────────────────────────────────
 *   `fixObservableMissingData` stamps `extractionType: "observed"`
 *     → `schema-v3.ts:296`   non-`inferred` ⇒ `source: "brief_extraction"`
 *     → `provenance-display.ts:26`  `"observed"` ⇒ `from_brief`
 *
 * ⚠ AND THE DISPATCH DIAGNOSIS NAMED THE WRONG BRANCH. `fixObservableMissingData`
 * has TWO write sites, not one:
 *   A — the DEFAULTED FILL: no numeric value ⇒ writes `0.5` AND the stamp;
 *   B — the BARE STAMP: a value exists, no `extractionType` ⇒ writes the stamp only.
 * Branch A can only ever write `0.5`. The witnessed node carried `value: 0`, which
 * IS a number, so branch A was unreachable for it: **the shipped defect came from
 * branch B.** A fix to A alone would have left the witness alive. Both move here,
 * and both directions are pinned below.
 *
 * ── WHY THE EXISTING HONESTY GUARD DID NOT CATCH IT ────────────────────────
 * `schema-v3.ts:467` withdraws an unearned `from_brief` via `mayClaimFromBrief`,
 * which asks for a brief-backed label AND a numeric value
 * (`factor-value-provenance.ts:114-123`). The repair had just manufactured
 * exactly those two facts. The guard is correct; it cannot defend against a
 * producer that fabricates its own evidence.
 *
 * ── THE ORACLE IS THE PRODUCER'S, NOT THIS AUTHOR'S (trap 13c) ─────────────
 * `inferred` is not a choice of taste. It is the value the SIBLING repair four
 * lines away already writes for the identical situation
 * (`fixControllableMissingData`: `if (data.extractionType === undefined)
 * data.extractionType = "inferred"`), the value the LLM normaliser already writes
 * for its own fill (`adapters/llm/normalisation.ts:993`
 * `extractionType: existingType ?? 'inferred'`), and the value the served prompt
 * itself declares for an unstated baseline (`defaults-v19.ts:154`). The wire enum
 * has exactly four members — `explicit | inferred | range | observed` — and no
 * "defaulted" class, so `inferred` is also the only truthful member available.
 *
 * ── ASSERTIONS BIND BY IDENTITY (trap 19) ──────────────────────────────────
 * Every node is located by its own id. No assertion finds a node by the value it
 * carries, because the repair's whole job is writing values.
 */
import { describe, expect, it } from "vitest";

import { fixObservableMissingData } from "../deterministic-sweep.js";
import type { ValidationIssue } from "../../../../../validators/graph-validator.types.js";
import { nodeProvenanceDisplay } from "../../../../transforms/provenance-display.js";
import { mayClaimFromBrief } from "../../../../provenance/factor-value-provenance.js";

interface TestNode {
  id: string;
  kind: string;
  label?: string;
  category?: string;
  data?: Record<string, unknown>;
}

function graphOf(nodes: TestNode[]): { nodes: TestNode[]; edges: unknown[] } {
  return { nodes, edges: [] };
}

/** The violation the sweep hands this repair — one per offending node. */
function observableViolations(ids: readonly string[]): ValidationIssue[] {
  return ids.map((id) => ({
    code: "OBSERVABLE_MISSING_DATA",
    severity: "error",
    message: `Observable factor "${id}" missing required data`,
    path: `nodes[${id}]`,
  })) as unknown as ValidationIssue[];
}

const nodeById = (g: { nodes: TestNode[] }, id: string) => g.nodes.find((n) => n.id === id)!;

describe("fixObservableMissingData — branch A, the DEFAULTED FILL", () => {
  it("stamps `inferred`, so a value the repair invented is never attributed to the user", () => {
    const graph = graphOf([
      { id: "fac_burnout", kind: "factor", label: "Team burnout", category: "observable" },
    ]);

    const repairs = fixObservableMissingData(graph as never, observableViolations(["fac_burnout"]));

    const node = nodeById(graph, "fac_burnout");
    expect(node.data?.value).toBe(0.5);
    expect(node.data?.extractionType).toBe("inferred");
    // …and the two surfaces that read it agree, end of chain.
    expect(nodeProvenanceDisplay(node.data?.extractionType)).toBe("ai_inferred");
    expect(mayClaimFromBrief(node)).toBe(false);
    // The repair still reports what it did — an honest stamp is not a silent one.
    expect(repairs).toHaveLength(1);
    expect(repairs[0]!.action).toContain("inferred");
    expect(repairs[0]!.action).not.toContain("observed");
  });
});

describe("fixObservableMissingData — branch B, the BARE STAMP (the shipped defect)", () => {
  it("stamps `inferred` on an unstamped value, reproducing the D_messy witness shape", () => {
    // The exact shape from the capture: a value of 0 with no extractionType.
    // `value: 0` is a number, so branch A cannot reach it — this is branch B.
    const graph = graphOf([
      {
        id: "fac_burnout",
        kind: "factor",
        label: "Team burnout and attrition risk",
        category: "observable",
        data: { value: 0 },
      },
    ]);

    fixObservableMissingData(graph as never, observableViolations(["fac_burnout"]));

    const node = nodeById(graph, "fac_burnout");
    // The value the model emitted is UNTOUCHED — this fix is about attribution,
    // never about overwriting content.
    expect(node.data?.value).toBe(0);
    expect(node.data?.extractionType).toBe("inferred");
    expect(nodeProvenanceDisplay(node.data?.extractionType)).toBe("ai_inferred");
    expect(mayClaimFromBrief(node)).toBe(false);
  });

  it("never yields a user-attributed display for ANY defaulted fill (both branches, one sweep)", () => {
    const graph = graphOf([
      { id: "fac_no_value", kind: "factor", category: "observable" },
      { id: "fac_zero", kind: "factor", category: "observable", data: { value: 0 } },
      { id: "fac_mid", kind: "factor", category: "observable", data: { value: 0.42 } },
      {
        id: "fac_unitful",
        kind: "factor",
        category: "observable",
        data: { value: 0.3, raw_value: 30, unit: "%" },
      },
    ]);

    fixObservableMissingData(
      graph as never,
      observableViolations(["fac_no_value", "fac_zero", "fac_mid", "fac_unitful"]),
    );

    for (const id of ["fac_no_value", "fac_zero", "fac_mid", "fac_unitful"]) {
      const node = nodeById(graph, id);
      expect(node.data?.extractionType, `${id} stamp`).toBe("inferred");
      expect(nodeProvenanceDisplay(node.data?.extractionType), `${id} display`).toBe("ai_inferred");
      expect(mayClaimFromBrief(node), `${id} claims the brief`).toBe(false);
    }
  });
});

describe("OPPOSITE TWINS — a genuine brief extraction is untouched", () => {
  it("leaves an `explicit` stamp alone, and it still renders from_brief", () => {
    // The direction that must NOT move: the model DID extract this from the
    // brief and said so. Under-claiming here would be the mirror harm.
    const graph = graphOf([
      {
        id: "fac_churn",
        kind: "factor",
        label: "Annual churn rate",
        category: "observable",
        data: { value: 0.08, raw_value: 8, unit: "%", extractionType: "explicit" },
      },
    ]);

    const repairs = fixObservableMissingData(graph as never, observableViolations(["fac_churn"]));

    const node = nodeById(graph, "fac_churn");
    expect(node.data?.extractionType).toBe("explicit");
    expect(node.data?.value).toBe(0.08);
    expect(nodeProvenanceDisplay(node.data?.extractionType)).toBe("from_brief");
    expect(mayClaimFromBrief(node)).toBe(true);
    // Nothing to repair ⇒ nothing reported.
    expect(repairs).toHaveLength(0);
  });

  it("leaves an `observed` stamp the MODEL itself emitted alone", () => {
    // A model-emitted `observed` is a claim the model made and is entitled to
    // make; this repair only governs stamps IT writes. Narrowness is the point:
    // the fix must not become a blanket rewrite of a vocabulary member.
    const graph = graphOf([
      {
        id: "fac_deploy",
        kind: "factor",
        category: "observable",
        data: { value: 0.75, raw_value: 45, unit: "minutes", extractionType: "observed" },
      },
    ]);

    fixObservableMissingData(graph as never, observableViolations(["fac_deploy"]));

    expect(nodeById(graph, "fac_deploy").data?.extractionType).toBe("observed");
    expect(nodeProvenanceDisplay("observed")).toBe("from_brief");
  });

  it("touches no node outside its remit — controllable factors and non-factors", () => {
    const graph = graphOf([
      { id: "fac_ctrl", kind: "factor", category: "controllable" },
      { id: "opt_a", kind: "option", label: "Do the thing" },
      { id: "goal_1", kind: "goal", label: "Grow ARR" },
    ]);

    const repairs = fixObservableMissingData(
      graph as never,
      observableViolations(["fac_ctrl", "opt_a", "goal_1"]),
    );

    expect(repairs).toHaveLength(0);
    for (const id of ["fac_ctrl", "opt_a", "goal_1"]) {
      expect(nodeById(graph, id).data).toBeUndefined();
    }
  });

  it("is a no-op when the sweep raised no OBSERVABLE_MISSING_DATA at all", () => {
    const graph = graphOf([{ id: "fac_a", kind: "factor", category: "observable" }]);
    expect(fixObservableMissingData(graph as never, [])).toHaveLength(0);
    expect(nodeById(graph, "fac_a").data).toBeUndefined();
  });
});
