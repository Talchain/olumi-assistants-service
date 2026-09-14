/**
 * ⭐⭐ A STATED LIMIT IS NOT A STATEMENT ABOUT WHAT IS CURRENTLY TRUE.
 *
 * The defect, measured on live staging 14 Sep 2026 across 11 fresh drafts of
 * one brief containing *"…while keeping monthly churn under 4%…"*: the 4%
 * reached the wire as the churn node's `observed_state.value`, the field whose
 * own declaration reads *"current or proposed value"*. The model therefore
 * asserts **churn IS 4%** when the user said **keep it under 4%**.
 *
 * The capture under `fixtures/live-churn-limit-as-observation-2026-09-14.json`
 * is the served bytes of one of those drafts — an APPEND-ONLY record of what
 * the product actually emitted on a dated build, never a fixture to keep
 * current (CLAUDE.md trap 14b).
 *
 * Every assertion below binds to its object by NODE ID. Not one of them counts
 * nodes or figures: the product's own manifest already counts this graph's
 * figures as "in the model" while the 4% sits in the wrong role, so a count is
 * exactly the instrument that cannot see this defect.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  deriveStatedQuantityRoles,
  deriveNotModelledManifest,
  STATED_KINDS,
  STATED_KIND_PRODUCERS,
} from "../not-modelled-manifest.js";
import { OBSERVED_STATE_STATED_ROLES } from "../stated-role-vocabulary.js";
import { ObservedStateV3 } from "../../../schemas/cee-v3.js";
import { compactGraph } from "../../../orchestrator/context/graph-compact.js";
import type { GraphV3T } from "../../../schemas/cee-v3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE = JSON.parse(
  readFileSync(join(HERE, "fixtures/live-churn-limit-as-observation-2026-09-14.json"), "utf8"),
) as { _provenance: { brief: string }; draft_graph: Record<string, unknown> };

const LIVE_BRIEF = CAPTURE._provenance.brief;
const LIVE_GRAPH = CAPTURE.draft_graph;
/** The node the served capture put the user's LIMIT on as its observed level. */
const CHURN_NODE = "ab78e513";

/** A minimal graph in the shape the boundary stamp reads. */
function graphWith(
  nodes: Array<Record<string, unknown>>,
  goalConstraints: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return { nodes, edges: [], options: [], goal_constraints: goalConstraints };
}

const churnRow = (over: Record<string, unknown> = {}) => ({
  constraint_id: "constraint_churn_max",
  node_id: "n_churn",
  operator: "<=",
  value: 0.04,
  unit: "fraction",
  label: "Keep monthly churn at or below 4%",
  source_quote: "keeping monthly churn under 4%",
  value_frame: "level",
  ...over,
});

const churnNode = (observed: Record<string, unknown> | null) => ({
  id: "n_churn",
  kind: "factor",
  label: "Monthly Churn Rate",
  ...(observed === null ? {} : { observed_state: observed }),
});

describe("the defect: a stated limit recorded as an observation", () => {
  it("binds the served capture's churn node as a stated limit, by node id", () => {
    const roles = deriveStatedQuantityRoles(LIVE_BRIEF, LIVE_GRAPH);

    expect(roles).toEqual([{ node_id: CHURN_NODE, stated_role: "constraint" }]);

    // And the thing being described is real: that node's `observed_state.value`
    // IS the limit's threshold, which is the whole defect.
    const node = (LIVE_GRAPH.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === CHURN_NODE,
    )!;
    expect((node.observed_state as Record<string, unknown>).value).toBe(0.04);
    const row = (LIVE_GRAPH.goal_constraints as Array<Record<string, unknown>>)[0]!;
    expect(row.node_id).toBe(CHURN_NODE);
    expect(row.value).toBe(0.04);
    expect(row.operator).toBe("<=");
  });

  it("takes the binding from the producer's row, never from a magnitude it matched back", () => {
    // Same graph, same brief, but the row names a DIFFERENT node — the shape a
    // fourth live draft actually produced. A function that re-matched 0.04 to
    // whichever node happens to carry it would still stamp `n_churn`.
    const roles = deriveStatedQuantityRoles(
      "keeping monthly churn under 4%",
      graphWith(
        [churnNode({ value: 0.04, unit: "%" }), { id: "n_other", kind: "risk", label: "Churn Spike" }],
        [churnRow({ node_id: "n_other" })],
      ),
    );
    expect(roles).toEqual([]);
  });
});

describe("negative controls — a fix that reclassifies everything is worse than the defect", () => {
  it("leaves a genuinely observed value stated as an observation alone", () => {
    // "churn is currently 1.9%" — an observation, no limit anywhere.
    const roles = deriveStatedQuantityRoles(
      "monthly churn is currently 1.9% and we want to grow revenue",
      graphWith([churnNode({ value: 0.019, unit: "%" })], []),
    );
    expect(roles).toEqual([]);
  });

  it("leaves a node whose level is independent of the limit alone", () => {
    // Both stated: the observation is 1.9%, the ceiling is 4%. The node holds a
    // real measurement, so nothing here has anything to say about it.
    const roles = deriveStatedQuantityRoles(
      "monthly churn is currently 1.9%, and we are keeping monthly churn under 4%",
      graphWith([churnNode({ value: 0.019, unit: "%" })], [churnRow()]),
    );
    expect(roles).toEqual([]);
  });

  it("refuses when the same magnitude is stated twice, in two roles", () => {
    // ⛔ THE LIE DIRECTION. "churn is currently 4% and we must keep it under 4%"
    // — the observed 0.04 genuinely IS an observation here, and stamping it
    // would tell a user that a rate they measured is only a cap.
    const roles = deriveStatedQuantityRoles(
      "monthly churn is currently 4%, and we are keeping monthly churn under 4%",
      graphWith([churnNode({ value: 0.04, unit: "%" })], [churnRow()]),
    );
    expect(roles).toEqual([]);
  });

  it("says nothing about a node that carries no observed value at all", () => {
    const roles = deriveStatedQuantityRoles(
      "keeping monthly churn under 4%",
      graphWith([churnNode(null)], [churnRow()]),
    );
    expect(roles).toEqual([]);
  });

  it("discards a source_quote that is not in the brief — the fabrication gate", () => {
    const roles = deriveStatedQuantityRoles(
      "keeping monthly churn under 4%",
      graphWith(
        [churnNode({ value: 0.04, unit: "%" })],
        [churnRow({ source_quote: "we agreed a hard ceiling of 4% at the board meeting" })],
      ),
    );
    expect(roles).toEqual([]);
  });

  it("refuses a row whose quoted sentence carries no number at all", () => {
    // ⛔ NOT AN EQUIVALENT MUTANT — DEMONSTRATED. Removing `inSpan.length === 0`
    // from the derivation left the whole suite green until this case existed,
    // and the branch it guards is reachable: a row can quote a sentence with no
    // magnitude in it ("keep monthly churn low") while carrying a threshold the
    // model supplied from elsewhere. Then the row's number did not come from the
    // words it quotes, so there is no evidence the node's level IS that
    // threshold — and the coincidence of two 0.04s is not that evidence.
    const roles = deriveStatedQuantityRoles(
      "we are keeping monthly churn low while we grow",
      graphWith(
        [churnNode({ value: 0.04, unit: "%" })],
        [churnRow({ source_quote: "keeping monthly churn low" })],
      ),
    );
    expect(roles).toEqual([]);
  });

  it("says nothing when there is no brief to check the quote against", () => {
    expect(
      deriveStatedQuantityRoles(null, graphWith([churnNode({ value: 0.04 })], [churnRow()])),
    ).toEqual([]);
    expect(deriveStatedQuantityRoles("keeping monthly churn under 4%", null)).toEqual([]);
  });
});

describe("the manifest's own classification is untouched", () => {
  it("still reports every figure in the served capture as `figure`", () => {
    // ⚠ A MEASURED FACT ABOUT THE SHIPPED AUTHORITY, PINNED SO THIS CHANGE
    // CANNOT HAVE MOVED IT. `classifyStatedKind` compares the brief-frame
    // magnitude (4, percentage points as written) with the producer-frame value
    // (0.04, `value_frame: "level"`), and `numbersEqual` performs no frame
    // conversion — so for this fraction-framed percent row the `constraint`
    // conjunction cannot hold and every figure classifies `figure`. That is a
    // separate, reported finding; it is NOT repaired here, and this assertion
    // exists so a repair of it is a visible decision rather than a side effect.
    const manifest = deriveNotModelledManifest(LIVE_BRIEF, LIVE_GRAPH);
    expect(manifest.status).toBe("derived");
    const kinds = manifest.quantities!.items.map((i) => `${i.literal}:${i.stated_kind}`);
    expect(kinds).toEqual([
      "£49:figure",
      "£59:figure",
      "4%:figure",
      "£20k:figure",
      "12 months:figure",
    ]);
  });
});

describe("the vocabulary is a subset of the authority, derived rather than transcribed", () => {
  it("declares only roles the authority knows", () => {
    for (const role of OBSERVED_STATE_STATED_ROLES) {
      expect(STATED_KINDS as readonly string[]).toContain(role);
    }
  });

  it("declares every sourced kind except the authority's own default", () => {
    // Fails loud in BOTH directions: a new live producer in
    // `STATED_KIND_PRODUCERS` that this alphabet cannot express REDs here, and
    // so does a member here the authority does not source.
    const sourced = STATED_KINDS.filter((k) => STATED_KIND_PRODUCERS[k] !== undefined);
    const expressible = sourced.filter((k) => k !== "figure");
    expect([...OBSERVED_STATE_STATED_ROLES].sort()).toEqual([...expressible].sort());
  });
});

describe("the wire carries the role", () => {
  it("accepts the stamp on observed_state", () => {
    const parsed = ObservedStateV3.parse({ value: 0.04, unit: "%", stated_role: "constraint" });
    expect(parsed.stated_role).toBe("constraint");
  });

  it("refuses a role the producer cannot emit", () => {
    expect(ObservedStateV3.safeParse({ value: 0.04, stated_role: "target" }).success).toBe(false);
  });

  it("treats absence as undeclared, not as an observation", () => {
    expect(ObservedStateV3.parse({ value: 0.04 }).stated_role).toBeUndefined();
  });
});

describe("the consumer honours it — the model's own view of the graph", () => {
  const nodeWith = (observed: Record<string, unknown>) =>
    ({
      nodes: [{ id: "n_churn", kind: "factor", label: "Monthly Churn Rate", observed_state: observed }],
      edges: [],
      options: [],
    }) as unknown as GraphV3T;

  const OBSERVED_AS_SERVED = { value: 0.04, unit: "%", source: "brief_extraction", extractionType: "explicit" };

  it("stops telling the model the user stated this level", () => {
    const compact = compactGraph(nodeWith({ ...OBSERVED_AS_SERVED, stated_role: "constraint" }));
    const node = compact.nodes.find((n) => n.id === "n_churn")!;
    expect(node.stated_role).toBe("constraint");
    expect(node.source).toBe("assumption");
    expect(node.provenance).toBe("ai_inferred");
    // The magnitude itself is the user's and is untouched.
    expect(node.value).toBe(0.04);
    expect(node.unit).toBe("%");
  });

  it("DISCRIMINATING TWIN — the same node without the stamp still reads as the user's own", () => {
    // Without this arm the arm above proves only that the compact is sensitive
    // to SOMETHING. The pair proves it is sensitive to the ROLE, on this node,
    // and that nothing else in the payload moved authorship.
    const compact = compactGraph(nodeWith(OBSERVED_AS_SERVED));
    const node = compact.nodes.find((n) => n.id === "n_churn")!;
    expect(node.stated_role).toBeUndefined();
    expect(node.source).toBe("user");
    expect(node.provenance).toBe("from_brief");
    expect(node.value).toBe(0.04);
  });
});

describe("the negative controls fail for the reason they name", () => {
  /**
   * ⚠ PIN THE PRECONDITION IN-TEST (CLAUDE.md trap 13b). Two of the controls
   * above assert an EMPTY result, and an empty result has several possible
   * causes — most cheaply, a `source_quote` that does not locate in the brief,
   * which the fabrication gate discards before any of this module's own logic
   * runs. A control refusing for that reason is not testing what it claims.
   *
   * It happened: the first draft of the two-roles control wrote a brief saying
   * *"we must keep"* against a row quoting *"keeping"*, so the quote never
   * located and the case passed while the guard it was written for was
   * DISARMED — proven by a mutant that removed the guard and stayed green.
   * These assertions are what caught it, and are what stop it recurring.
   */
  const locates = (brief: string, quote: string) => brief.includes(quote);

  it("the two-roles control's quote really is in its brief", () => {
    expect(
      locates(
        "monthly churn is currently 4%, and we are keeping monthly churn under 4%",
        "keeping monthly churn under 4%",
      ),
    ).toBe(true);
  });

  it("the independent-level control's quote really is in its brief", () => {
    expect(
      locates(
        "monthly churn is currently 1.9%, and we are keeping monthly churn under 4%",
        "keeping monthly churn under 4%",
      ),
    ).toBe(true);
  });

  it("and the fabrication-gate control's quote really is NOT — the contrast", () => {
    expect(
      locates(
        "keeping monthly churn under 4%",
        "we agreed a hard ceiling of 4% at the board meeting",
      ),
    ).toBe(false);
  });
});
