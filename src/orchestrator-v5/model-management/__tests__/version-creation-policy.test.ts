import { describe, expect, it } from "vitest";

import { decideModelVersionCreation } from "../version-creation-policy.js";

/**
 * The fixture graph's shape, declared rather than inferred.
 *
 * Declared because the tests below MUTATE the clone, and an inferred type
 * freezes each field at the exact shape the literal happens to spell — so
 * adding `evidence_id` to a provenance object reads as an excess property
 * against `{ source: string }`, even though the ingress node schema is
 * `.passthrough()` and carries any such field through to the identity
 * projection (which is precisely what the evidence/provenance case asserts).
 */
type TestNode = {
  id: string;
  kind: string;
  label: string;
  observed_state?: { value: number };
  provenance?: { source: string; evidence_id?: string };
  position?: { x: number; y: number };
  description?: string;
};
type TestGraph = { nodes: TestNode[]; edges: { from: string; to: string }[] };

const BASE: TestGraph = {
  nodes: [
    {
      id: "factor-price",
      kind: "factor",
      label: "Price",
      observed_state: { value: 10 },
      provenance: { source: "brief" },
      position: { x: 1, y: 2 },
    },
  ],
  edges: [],
};

describe("model-version creation policy", () => {
  it("no-op creates no version", () => {
    expect(decideModelVersionCreation(BASE, structuredClone(BASE))).toEqual({
      create: false,
      reason: "no_op",
    });
  });

  it("pure layout changes create no version", () => {
    const presentation = structuredClone(BASE);
    presentation.nodes[0]!.position = { x: 90, y: 120 };
    expect(decideModelVersionCreation(BASE, presentation)).toEqual({
      create: false,
      reason: "presentation_only",
    });
  });

  it("label/description changes create a semantic version", () => {
    const wording = structuredClone(BASE);
    wording.nodes[0]!.label = "Current list price";
    wording.nodes[0]!.description = "The price customers pay before discounts.";
    expect(decideModelVersionCreation(BASE, wording)).toEqual({
      create: true,
      reason: "semantic_change",
    });
  });

  it("evidence/provenance change creates a version even when analysis inputs are unchanged", () => {
    const evidence = structuredClone(BASE);
    evidence.nodes[0]!.provenance = {
      source: "customer interview",
      evidence_id: "ev-9",
    };
    expect(decideModelVersionCreation(BASE, evidence)).toEqual({
      create: true,
      reason: "semantic_change",
    });
  });
});

/**
 * CODEX C8-A REVIEW — DEFECT 4: the presentation classifier collided with
 * NODE IDS, and a real semantic edit vanished as `presentation_only`.
 *
 * `stripPresentation` matched a BARE KEY NAME at EVERY depth. Graph entries
 * carry records KEYED BY NODE ID — `option.data.interventions[<factor_id>]` is
 * the live one (`handlers/edit-graph-dispatch.ts` writes
 * `/nodes/<opt>/data/interventions/<factor_id>`). A factor whose id is
 * `position` therefore had its whole intervention entry deleted from BOTH
 * sides, the two sides compared equal, and the policy answered
 * `presentation_only`: no version, no head move, no event, no receipt, for an
 * edit that genuinely changed the model.
 *
 * Each case below is a DISCRIMINATING PAIR — the colliding id and a
 * non-colliding twin under the identical edit. The twin is what proves the
 * classifier is sensitive to THIS entry rather than to the edit in general; a
 * single assertion would pass against a policy that simply always versions.
 */
describe("presentation classifier — node ids that collide with presentation keys", () => {
  type Interventions = Record<string, { value: number }>;
  const withInterventions = (interventions: Interventions) => ({
    nodes: [
      { id: "opt-1", kind: "option", label: "Option", data: { interventions } },
      { id: "position", kind: "factor", label: "Colliding id" },
      { id: "safe-id", kind: "factor", label: "Non-colliding id" },
    ],
    edges: [],
  });

  /**
   * The PRESENTATION_KEYS members this policy owns and has now fixed: those
   * that are NOT also stripped by the identity projection. Named individually
   * so a regression that reinstates deep stripping fails by KEY NAME.
   */
  const FIXED_BY_THIS_POLICY = ["position", "layout", "dimensions", "style"];

  /**
   * ⚠⚠ KNOWN RESIDUAL GAP — PINNED EXACTLY, NOT SILENTLY TOLERATED, AND NOT
   * FIXED HERE BECAUSE IT IS NOT THIS MODULE'S DEFECT.
   *
   * For these ids the collision is ONE LEVEL DEEPER than the version policy:
   * `context/graph-identity.ts`'s `stripTransientDeep` removes TRANSIENT_UI_KEYS
   * at every depth, so the two graphs collapse to the SAME
   * `graph_identity_hash` and the policy answers `no_op` before any
   * presentation reasoning happens. Measured, not inferred.
   *
   * That is a defect in the CAS/identity AUTHORITY, and a more serious one than
   * the classifier bug: `graph-identity.ts` itself names the hazard — "over-
   * EXCLUDING a real persisted field is DANGEROUS (two different graphs
   * collapse to the same hash → a false CAS `match` → silent overwrite)".
   *
   * It is deliberately NOT fixed in this lane. Changing the identity projection
   * changes EVERY persisted `graph_identity_hash`, which requires an
   * `IDENTITY_NORMALISER_VERSION` bump and a rehash of stored values — a
   * migration-shaped change well outside a review-defect fix, and one that
   * would silently invalidate live CAS bases if slipped in here.
   *
   * The set is asserted EXACTLY so the suite stays green for the right reason:
   * it REDs if the gap GROWS (a new id starts colliding) and equally if it
   * SHRINKS (someone fixes the identity projection without removing this pin).
   */
  const KNOWN_IDENTITY_LEVEL_COLLISIONS = [
    "viewport",
    "ui",
    "ui_state",
    "panel_state",
    "selected",
    "selection",
    "hover",
    "hovered",
    "dragging",
  ];

  it.each(FIXED_BY_THIS_POLICY)(
    "a factor whose id is %s still versions when its intervention value changes",
    (collidingId) => {
      const before = withInterventions({
        [collidingId]: { value: 10 },
        "safe-id": { value: 1 },
      });
      const after = withInterventions({
        [collidingId]: { value: 999 },
        "safe-id": { value: 1 },
      });
      expect(
        decideModelVersionCreation(before, after),
        `editing the intervention on factor '${collidingId}' is a semantic ` +
          "change. Classifying it presentation_only silently drops the version, " +
          "head move, event and receipt for a real edit.",
      ).toEqual({ create: true, reason: "semantic_change" });
    },
  );

  it("KNOWN GAP: these ids still collide, and they collide in the IDENTITY hash, not in this policy", async () => {
    const { computeGraphIdentityHash } = await import(
      "../../context/graph-identity.js"
    );
    const stillColliding: string[] = [];
    for (const id of KNOWN_IDENTITY_LEVEL_COLLISIONS) {
      const before = withInterventions({
        [id]: { value: 10 },
        "safe-id": { value: 1 },
      });
      const after = withInterventions({
        [id]: { value: 999 },
        "safe-id": { value: 1 },
      });
      const bh = computeGraphIdentityHash(before as never)!.value;
      const ah = computeGraphIdentityHash(after as never)!.value;
      if (bh === ah) stillColliding.push(id);
    }
    expect(
      stillColliding,
      "This pin records a KNOWN, DELIBERATELY UNFIXED gap in the identity " +
        "projection (see the block comment). If it RED because the list GREW, " +
        "a new id now collapses two different graphs to one CAS hash — that is " +
        "a silent-overwrite hazard, fix it. If it RED because the list SHRANK, " +
        "someone repaired context/graph-identity.ts: delete the id from this " +
        "list and move it into FIXED_BY_THIS_POLICY.",
    ).toEqual(KNOWN_IDENTITY_LEVEL_COLLISIONS);
  });

  it("CONTRAST: the same edit on a non-colliding id also versions (the probe is not just always-true)", () => {
    const before = withInterventions({
      position: { value: 10 },
      "safe-id": { value: 1 },
    });
    const after = withInterventions({
      position: { value: 10 },
      "safe-id": { value: 999 },
    });
    expect(decideModelVersionCreation(before, after)).toEqual({
      create: true,
      reason: "semantic_change",
    });
  });

  it("CONTRAST: a genuine presentation field on the ENTRY itself is still free", () => {
    // The behaviour the strip exists for, and which must survive the fix: a
    // node's OWN `position` is presentation and must not mint a version.
    const before = withInterventions({ "safe-id": { value: 1 } });
    const after = structuredClone(before) as typeof before & {
      nodes: Array<Record<string, unknown>>;
    };
    after.nodes[1]!.position = { x: 90, y: 120 };
    expect(
      decideModelVersionCreation(before, after),
      "moving a node on the canvas must remain presentation_only — the fix " +
        "must narrow WHERE the strip applies, not remove it",
    ).toEqual({ create: false, reason: "presentation_only" });
  });
});
