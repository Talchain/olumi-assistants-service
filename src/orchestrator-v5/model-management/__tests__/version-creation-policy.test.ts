import { describe, expect, it } from "vitest";

import { decideModelVersionCreation } from "../version-creation-policy.js";
import { TRANSIENT_UI_KEYS } from "../../context/graph-identity.js";

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
   * ⭐⭐ DERIVED FROM `TRANSIENT_UI_KEYS`, NOT HAND-LISTED — and that is the fix.
   *
   * An earlier revision of this block iterated a hand-written array of ids. It
   * was measured INCAPABLE OF SEEING THE GAP GROW: removing `dragging` REDded
   * it, but ADDING `'label'` to the strip — which would erase every node label
   * from identity — left it fully GREEN, because the test only ever asked about
   * the keys it already knew. Its stated guarantee was false, and it was
   * already short by seven (`isselected`, `ishovered`, `isdragging`, `uistate`,
   * `panelstate`, `__transient`, `_transient`).
   *
   * That is the hand-maintained-mirror defect inside the guard written to
   * prevent it. The list now comes FROM the producer, so a key added to
   * `TRANSIENT_UI_KEYS` is automatically covered here and cannot arrive
   * unobserved.
   */
  const TRANSIENT_KEYS = [...TRANSIENT_UI_KEYS];

  it("PROBE LIVENESS: the derived key set is non-empty and came from the producer", () => {
    // A derived guard that resolved an empty set would agree with everything.
    expect(TRANSIENT_KEYS.length).toBeGreaterThan(10);
    expect(TRANSIENT_KEYS).toContain("viewport");
  });

  /**
   * ⭐⭐ THE LEAD FINDING (measured, 2026-08-25): A FACTOR LABELLED "UI"
   * SILENTLY DESTROYED VERSION HISTORY.
   *
   * `normaliseIdBase("UI")` → `"ui"`, and `CANONICAL_ID_REGEX` requires no
   * prefix, so an ordinary factor name becomes a bare id that is ALSO a member
   * of `TRANSIENT_UI_KEYS`. Options key their interventions BY FACTOR ID
   * (`plot-intervention-scale.ts:444/:653`), so that id appears as an object
   * KEY — and `stripTransientDeep` removes it at every depth. Two genuinely
   * different graphs collapsed to ONE `graph_identity_hash`, the policy answered
   * `no_op`, and `no_op` is a DESIGNED-SILENT arm: graph and turn durable;
   * version, head, event and receipt gone, with no telemetry at all.
   *
   * "UI", "Viewport", "Panel State", "Selection" are entirely ordinary names in
   * a strategic model. This was not an exotic input.
   *
   * THE FIX IS SCOPED, and the scope matters: the policy no longer ASKS
   * `computeGraphIdentityHash` whether anything changed. It compares the graph
   * itself. The identity hash still collides — that is a CAS-authority defect
   * with a separate blast radius (it would need an `IDENTITY_NORMALISER_VERSION`
   * bump and a rehash of every persisted value), and it is ROWED, not absorbed
   * here. What is closed is this PR resting a history decision on a function
   * that collides.
   */
  it.each(TRANSIENT_KEYS)(
    "a factor whose id is %s still versions when its intervention value changes",
    (transientId) => {
      const before = withInterventions({
        [transientId]: { value: 10 },
        "safe-id": { value: 1 },
      });
      const after = withInterventions({
        [transientId]: { value: 999 },
        "safe-id": { value: 1 },
      });
      expect(
        decideModelVersionCreation(before, after),
        `a factor whose id is '${transientId}' had its intervention edited. ` +
          "Answering no_op destroys the version, head, event and receipt " +
          "SILENTLY — no_op is a designed-silent arm, so nothing is emitted " +
          "and nothing can notice.",
      ).toEqual({ create: true, reason: "semantic_change" });
    },
  );

  /**
   * The PRESENTATION_KEYS members this policy owns, fixed by the entry-level
   * strip. Kept separate from the derived set above because they fail for a
   * DIFFERENT reason (this module's own classifier), and a reader must be able
   * to tell the two causes apart.
   */
  const FIXED_BY_THIS_POLICY = ["position", "layout", "dimensions", "style"];

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

/**
 * ⭐⭐ `TRANSIENT_UI_KEYS` IS A REVIEWED SURFACE — pinned EXACTLY, so any change
 * to it REDs and has to be argued for.
 *
 * The version policy no longer depends on this set (see above), but the
 * IDENTITY HASH still does, and that hash is the CAS authority: every member is
 * a key whose presence or absence two different graphs can differ by while
 * hashing IDENTICALLY. `graph-identity.ts` names the hazard itself —
 * "over-EXCLUDING a real persisted field is DANGEROUS (two different graphs
 * collapse to the same hash → a false CAS `match` → silent overwrite)".
 *
 * The previous guard could not see this set GROW: it iterated a hand-written
 * list, so adding `'label'` — which would erase every node label from identity
 * and make two entirely different models collide — left it fully GREEN. An
 * exact-set assertion fails in BOTH directions, which is the only shape that
 * makes a strip list safe to own:
 *   · a key ADDED silently widens what identity is blind to → RED, argue for it;
 *   · a key REMOVED changes every persisted hash → RED, it needs a normaliser
 *     version bump and a rehash, not a quiet edit.
 */
describe("TRANSIENT_UI_KEYS is an exact, reviewed set", () => {
  it("membership is exactly the reviewed list — growth AND shrink both RED", () => {
    expect(
      [...TRANSIENT_UI_KEYS].sort(),
      "This set decides what the identity/CAS hash is BLIND to. If this RED " +
        "because a key was ADDED, that key's values can now differ between two " +
        "graphs that hash identically — a false CAS match and a silent " +
        "overwrite; justify it explicitly. If it RED because a key was " +
        "REMOVED, every persisted graph_identity_hash just changed meaning and " +
        "the change needs an IDENTITY_NORMALISER_VERSION bump plus a rehash, " +
        "not an edit to this list.",
    ).toEqual(
      [
        "__transient",
        "_transient",
        "dragging",
        "hover",
        "hovered",
        "isdragging",
        "ishovered",
        "isselected",
        "panel_state",
        "panelstate",
        "selected",
        "selection",
        "ui",
        "ui_state",
        "uistate",
        "viewport",
      ].sort(),
    );
  });
});
