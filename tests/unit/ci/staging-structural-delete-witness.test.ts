/**
 * Guards for the structural_delete acceptance witness.
 *
 * THE ONE JOB: prove the witness CAN FAIL.
 *
 * An acceptance script that has only ever been seen passing is not evidence, it
 * is a demonstration. This estate has shipped a leak test that captured zero
 * bytes and passed every assertion by testing nothing, and a `it.each` that
 * scored 9/9 mutants against an oracle that was simply wrong. So every assertion
 * in the witness is exercised here TWICE: once against a REAL capture where it
 * must be silent, and once against a REAL capture where it must speak — with the
 * expected message named, not merely counted.
 *
 * THE FIXTURES ARE THE SAME SCENARIO, ONE STEP APART. Both were captured on
 * 18 Aug 2026 from deployed CEE staging build `83a1157`, scenario
 * `b0b6f54e-1f95-4b6c-b77d-cc48ddd20215`:
 *
 *   `…pre-delete-83a1157.json`  the drafting turn — option `1bf99178` PRESENT
 *   `…committed-83a1157.json`   the structural_delete receipt — `1bf99178` GONE
 *   `…reload-83a1157.json`      a later clarify turn — no draft_graph, options only
 *
 * The pre-delete capture is the POSITIVE CONTROL, and it is deliberately the
 * SAME scenario rather than an invented contrast: a hand-written "broken" body
 * only proves the assertions agree with the author's idea of the shape, which is
 * the one thing an author cannot check. The control here is literally the world
 * in which the delete did not happen.
 *
 * The third fixture guards a defect this witness ALREADY SHIPPED ONCE, in its
 * first live run: a refusal turn carries no `draft_graph` and an EMPTY
 * `analysis_ready.options`, and the witness reported that as *"wholesale loss,
 * not a deletion"* while the very next turn showed the model intact. A turn that
 * names nothing is UNMEASURED, not a loss — and that distinction is pinned below.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

import {
  assertBatchAtomicity,
  assertModelWithout,
  assertNoOrphanedReferences,
  assertNotifyDidNotMutate,
  assertTruthfulAcknowledgement,
  assertTwinInterventionsIntact,
  carriedCommittedGraph,
  classifyRerun,
  countReferencesTo,
  edgePairs,
  interventionKeys,
  looksLikeAnalysisHash,
  pickDeleteTargets,
  pickOrphanTarget,
  readyOptionIds,
  wireGraphOf,
  decideOutcome,
  ACCEPTANCE_CLAUSES,
  CANONICAL_READ_SENTINEL,
  EXIT,
  LEG_COVERAGE,
  RELOAD_EPISTEMICS,
} from "../../../scripts/ci/staging-structural-delete-witness.mjs";

const REPO_ROOT = resolve(__dirname, "../../..");
const FIXTURES = resolve(REPO_ROOT, "tests/unit/ci/fixtures");
const WORKFLOW_PATH = resolve(REPO_ROOT, ".github/workflows/staging-structural-delete-witness.yml");

/**
 * The slice of a turn body these tests touch.
 *
 * Narrow on purpose: `tsc --noEmit` over the WHOLE tree (the Typecheck Drift
 * ratchet) type-checks this file even though `tsconfig.build.json` excludes
 * tests, and reaching through an `unknown` fixture is exactly how a spec adds
 * silent drift. Typing only what is read keeps the fixtures honest without
 * mirroring the whole wire contract here.
 */
interface CaptureNode {
  id: string;
  kind?: string;
  label?: string;
  interventions?: Record<string, unknown>;
}
interface Capture {
  assistant_text?: string;
  draft_graph?: { nodes: CaptureNode[]; edges: Array<{ from: string; to: string }> };
  analysis_ready?: { options?: Array<{ option_id?: string }> };
  [key: string]: unknown;
}

function readJson(p: string): Capture {
  return JSON.parse(readFileSync(p, "utf8")) as Capture;
}

/** The exact label the base graph held for a node — what the acknowledgement must name. */
function labelOf(capture: Capture, id: string): string {
  const node = capture.draft_graph?.nodes.find((n) => n.id === id);
  if (node?.label === undefined) throw new Error(`fixture has no label for '${id}' — the ack test would be vacuous`);
  return node.label;
}

/** The world in which the delete DID NOT happen. Every absence check must fail on it. */
const PRE_DELETE = readJson(resolve(FIXTURES, "structural-delete-pre-delete-83a1157.json"));
/** The world in which it DID. Every check must be silent on it. */
const COMMITTED = readJson(resolve(FIXTURES, "structural-delete-committed-83a1157.json"));
/** A later refusal turn: no graph, empty options — UNMEASURED, not a loss. */
const RELOAD_REFUSAL = readJson(resolve(FIXTURES, "structural-delete-reload-83a1157.json"));

/** The option the real run deleted, and the one it kept. Bound by IDENTITY throughout. */
const DELETED_ID = "1bf99178";
const SURVIVOR_ID = "e75f367a";
/** A factor BOTH options intervened on — never deleted, so a scan for it must SPEAK. */
const NEVER_DELETED_FACTOR = "93e38814";
/** Edges the base graph held incident to the deleted option. Derived, not remembered. */
const INCIDENT_EDGE_COUNT = 3;

describe("fixture preconditions — pinned, so no assertion below can be vacuous", () => {
  // A discriminator whose power depends on a fixture nothing asserts is a
  // discriminator that can silently stop discriminating. These four lines are
  // what make every expectation in this file a measurement.
  it("the pre-delete capture CONTAINS the option, and the committed capture does not", () => {
    const preIds = wireGraphOf(PRE_DELETE).nodes.map((n) => (n as { id: string }).id);
    const postIds = wireGraphOf(COMMITTED).nodes.map((n) => (n as { id: string }).id);
    expect(preIds).toContain(DELETED_ID);
    expect(postIds).not.toContain(DELETED_ID);
    expect(preIds).toContain(SURVIVOR_ID);
    expect(postIds).toContain(SURVIVOR_ID);
  });

  it("both captures carry an applied graph, and the reload fixture carries none", () => {
    expect(carriedCommittedGraph(PRE_DELETE)).toBe(true);
    expect(carriedCommittedGraph(COMMITTED)).toBe(true);
    expect(carriedCommittedGraph(RELOAD_REFUSAL)).toBe(false);
  });

  it("the base graph really held exactly the incident edges the ack claims", () => {
    const incident = edgePairs(PRE_DELETE).filter(
      (p) => p.startsWith(`${DELETED_ID}::`) || p.endsWith(`::${DELETED_ID}`),
    );
    expect(incident).toHaveLength(INCIDENT_EDGE_COUNT);
  });

  it("the surviving option really intervenes on the never-deleted factor", () => {
    const twin = wireGraphOf(COMMITTED).nodes.find((n) => (n as { id: string }).id === SURVIVOR_ID);
    expect(interventionKeys(twin)).toContain(NEVER_DELETED_FACTOR);
  });
});

describe("assertModelWithout — absence paired with presence", () => {
  it("is SILENT on the committed capture", () => {
    const r = assertModelWithout("t", COMMITTED, { absentIds: [DELETED_ID], presentIds: [SURVIVOR_ID] });
    expect(r.observable).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it("POSITIVE CONTROL: SPEAKS on the pre-delete capture — the option is still there", () => {
    const r = assertModelWithout("t", PRE_DELETE, { absentIds: [DELETED_ID], presentIds: [SURVIVOR_ID] });
    expect(r.observable).toBe(true);
    // Named signature, not a count: both surfaces must be reported, because a
    // resurrection can appear on either one.
    expect(r.findings.join("\n")).toContain(`draft_graph still contains the deleted node '${DELETED_ID}'`);
    expect(r.findings.join("\n")).toContain(`analysis_ready.options still names the deleted option '${DELETED_ID}'`);
    expect(r.findings).toHaveLength(2);
  });

  it("POSITIVE CONTROL: SPEAKS when the SURVIVOR is missing — absence alone is not deletion", () => {
    // The anti-vacuity anchor. Without it, a payload emptied of everything reads
    // as a perfect deletion.
    const r = assertModelWithout("t", COMMITTED, { absentIds: [DELETED_ID], presentIds: ["no-such-node"] });
    expect(r.observable).toBe(true);
    expect(r.findings.join("\n")).toContain("this is loss, not a deletion");
  });

  it("reports a turn that names NOTHING as UNMEASURED, not as loss (the defect this witness shipped once)", () => {
    const bare: Capture = { ...RELOAD_REFUSAL, analysis_ready: { options: [] } };
    const r = assertModelWithout("t", bare, { absentIds: [DELETED_ID], presentIds: [SURVIVOR_ID] });
    expect(r.observable).toBe(false);
    expect(r.findings).toEqual([]); // no verdict either way
    expect(r.why).toContain("cannot be told apart from");
  });

  it("still MEASURES a reload turn that carries options but no graph", () => {
    // The RELOAD leg's real shape: no draft_graph, but a populated options list.
    // It must remain a measurable surface, or the leg silently stops asserting.
    const r = assertModelWithout("t", RELOAD_REFUSAL, { absentIds: [DELETED_ID], presentIds: [SURVIVOR_ID] });
    expect(readyOptionIds(RELOAD_REFUSAL)).toContain(SURVIVOR_ID);
    expect(r.observable).toBe(true);
    expect(r.findings).toEqual([]);
  });
});

describe("assertTruthfulAcknowledgement — no silent 200, and the magnitude must be right", () => {
  const expected = { id: DELETED_ID, label: labelOf(PRE_DELETE, DELETED_ID), incidentEdgeCount: INCIDENT_EDGE_COUNT };

  it("is SILENT on the real receipt", () => {
    expect(assertTruthfulAcknowledgement("t", 200, COMMITTED, expected)).toEqual([]);
  });

  it("POSITIVE CONTROL: a 200 with no applied graph is a refusal, not an acceptance", () => {
    // Every refusal arm of structural_delete answers 200 with prose. This is the
    // check that stops the witness blessing one as a deletion.
    const refusal = {
      response_version: 2,
      assistant_text:
        "I couldn't find everything you deleted in the saved model, so I haven't removed anything.",
      blocks: [],
    };
    const f = assertTruthfulAcknowledgement("t", 200, refusal, expected);
    expect(f.join("\n")).toContain("HTTP 200 with NO applied graph");
  });

  it("POSITIVE CONTROL: a committed delete that says NOTHING is a silent 200", () => {
    const silent: Capture = { ...COMMITTED, assistant_text: "" };
    expect(assertTruthfulAcknowledgement("t", 200, silent, expected).join("\n")).toContain(
      "the product said NOTHING — a silent HTTP 200",
    );
  });

  it("POSITIVE CONTROL: an acknowledgement that does not NAME what went", () => {
    const vague: Capture = { ...COMMITTED, assistant_text: "Done. That change is saved." };
    expect(assertTruthfulAcknowledgement("t", 200, vague, expected).join("\n")).toContain(
      "does not name what was removed",
    );
  });

  it("POSITIVE CONTROL: the connection COUNT must match the base graph, not just be present", () => {
    // A magnitude check, not a sign check. The real ack says 3; a receipt saying
    // 1 about a 3-edge cascade is false, and every other assertion here passes it.
    const f = assertTruthfulAcknowledgement("t", 200, COMMITTED, { ...expected, incidentEdgeCount: 1 });
    expect(f.join("\n")).toContain("A receipt whose magnitude is wrong is a false receipt");
  });

  it("POSITIVE CONTROL: a 409 is reported with its conflict category, never swallowed", () => {
    const conflict = {
      error: "GRAPH_DIVERGED",
      details: { conflict_category: "rpc_cas_conflict", reason: "graph_write_conflict" },
    };
    expect(assertTruthfulAcknowledgement("t", 409, conflict, expected).join("\n")).toContain(
      "conflict_category=rpc_cas_conflict",
    );
  });
});

describe("assertBatchAtomicity — the cascade took its edges, and nothing else", () => {
  const baseEdges = edgePairs(PRE_DELETE);

  it("is SILENT on the real receipt", () => {
    expect(assertBatchAtomicity("t", COMMITTED, baseEdges, [DELETED_ID])).toEqual([]);
  });

  it("POSITIVE CONTROL: with NOTHING declared removed, the missing edges read as over-reach", () => {
    // The discriminating pair: the same bytes, a different claim about what was
    // removed. If the assertion were insensitive to the removed set, this would
    // stay green.
    const f = assertBatchAtomicity("t", COMMITTED, baseEdges, []);
    expect(f.join("\n")).toContain("the cascade over-reached");
    expect(f.length).toBe(INCIDENT_EDGE_COUNT);
  });

  it("POSITIVE CONTROL: a surviving edge whose endpoint is gone is caught as dangling", () => {
    const dangling: Capture = {
      ...COMMITTED,
      draft_graph: {
        nodes: COMMITTED.draft_graph?.nodes ?? [],
        edges: [...(COMMITTED.draft_graph?.edges ?? []), { from: DELETED_ID, to: SURVIVOR_ID }],
      },
    };
    const f = assertBatchAtomicity("t", dangling, baseEdges, [DELETED_ID]);
    expect(f.join("\n")).toContain("referential integrity is broken");
  });

  it("POSITIVE CONTROL: a response with no applied graph cannot be judged, and says so", () => {
    expect(assertBatchAtomicity("t", RELOAD_REFUSAL, baseEdges, [DELETED_ID]).join("\n")).toContain(
      "batch atomicity cannot be judged",
    );
  });
});

describe("assertNoOrphanedReferences — and the non-vacuity counter that makes it mean something", () => {
  it("is SILENT scanning the committed graph for the node that WAS removed", () => {
    expect(assertNoOrphanedReferences("s", wireGraphOf(COMMITTED), [DELETED_ID])).toEqual([]);
  });

  it("POSITIVE CONTROL: SPEAKS scanning the same graph for a factor that was NOT removed", () => {
    // This is the pair that proves the previous test is a measurement rather than
    // a blind function. Same bytes, same scanner, different id — and the surviving
    // option genuinely names this one.
    const f = assertNoOrphanedReferences("s", wireGraphOf(COMMITTED), [NEVER_DELETED_FACTOR]);
    expect(f.join("\n")).toContain(`interventions still has a key naming the removed node '${NEVER_DELETED_FACTOR}'`);
  });

  it("POSITIVE CONTROL: catches a surviving options[] entry — the P0 wearing a different field name", () => {
    const row = { nodes: [], options: [{ id: DELETED_ID, label: "x" }] };
    expect(assertNoOrphanedReferences("db", row, [DELETED_ID]).join("\n")).toContain(
      `options[] still lists the removed option '${DELETED_ID}'`,
    );
  });

  it("POSITIVE CONTROL: catches meta.roots / meta.leaves and goal_node_id", () => {
    const row = { nodes: [], meta: { roots: [DELETED_ID], leaves: ["x"] }, goal_node_id: DELETED_ID };
    const f = assertNoOrphanedReferences("db", row, [DELETED_ID]).join("\n");
    expect(f).toContain(`meta.roots still names the removed node '${DELETED_ID}'`);
    expect(f).toContain(`goal_node_id still names the removed node '${DELETED_ID}'`);
  });

  it("countReferencesTo reads ZERO for an option delete on the wire — which is WHY the leg needs it", () => {
    // Interventions are keyed on FACTOR ids, so deleting an OPTION orphans nothing
    // observable on the wire. Without this counter, the orphan leg would report a
    // clean scan as PASS on every single run: a guard agreeing with itself.
    expect(countReferencesTo(wireGraphOf(PRE_DELETE), [DELETED_ID])).toBe(0);
    // …and non-zero for the factor both options name, which is what the FACTOR
    // mode exists to exercise.
    expect(countReferencesTo(wireGraphOf(PRE_DELETE), [NEVER_DELETED_FACTOR])).toBeGreaterThan(0);
  });
});

describe("assertTwinInterventionsIntact — the opposite-direction twin of the prune", () => {
  const keys = interventionKeys(
    wireGraphOf(PRE_DELETE).nodes.find((n) => (n as { id: string }).id === SURVIVOR_ID),
  );

  it("is SILENT: the survivor kept exactly its intervention targets", () => {
    expect(assertTwinInterventionsIntact("t", COMMITTED, SURVIVOR_ID, keys)).toEqual([]);
  });

  it("POSITIVE CONTROL: a survivor that LOST a target is reported as over-reach", () => {
    expect(
      assertTwinInterventionsIntact("t", COMMITTED, SURVIVOR_ID, [...keys, "would-have-been-lost"]).join("\n"),
    ).toContain("the delete over-reached");
  });

  it("POSITIVE CONTROL: a survivor absent from the applied graph is reported", () => {
    expect(assertTwinInterventionsIntact("t", COMMITTED, "no-such-option", []).join("\n")).toContain(
      "is not on the applied graph at all",
    );
  });
});

describe("assertNotifyDidNotMutate — direct_graph_edit is not a second mutation authority", () => {
  it("is SILENT when the canonical hash did not move", () => {
    expect(assertNotifyDidNotMutate("t", "5e5bbce61404eb06", "5e5bbce61404eb06")).toEqual([]);
  });

  it("POSITIVE CONTROL: SPEAKS when a notification changed the graph", () => {
    expect(assertNotifyDidNotMutate("t", "5e5bbce61404eb06", "3a015ca1bce077ea").join("\n")).toContain(
      "second, unaudited mutation authority",
    );
  });

  it("an unreadable hash is UNPROVEN, never proven — a missing measurement is not a pass", () => {
    expect(assertNotifyDidNotMutate("t", null, "3a015ca1bce077ea").join("\n")).toContain("UNPROVEN, not proven");
  });
});

describe("classifyRerun — a refusal that names something you deleted is THIS domain's defect", () => {
  it("recognises a completed recomputation", () => {
    const body = { analysis_state: { run_state: { kind: "complete_current", computed_at: "2026-08-18T03:45:51Z" } } };
    expect(classifyRerun(body, [DELETED_ID])).toMatchObject({ kind: "complete_current", recomputed: true, namesRemoved: [] });
  });

  it("does NOT treat an unrelated readiness refusal as a delete regression", () => {
    // Failing on this would make the witness flaky about the Model Compiler
    // domain's defect rather than about the delete.
    const body = { analysis_state: { run_state: { kind: "refused", reason_code: "MISSING_OPTION_VALUE" } } };
    const c = classifyRerun(body, [DELETED_ID]);
    expect(c.recomputed).toBe(false);
    expect(c.namesRemoved).toEqual([]);
  });

  it("POSITIVE CONTROL: a refusal that NAMES a removed node is caught", () => {
    const body = {
      analysis_state: {
        run_state: { kind: "blocked", reason_code: "MISSING_OPTION_VALUE", blockers: [{ target_id: DELETED_ID }] },
      },
    };
    expect(classifyRerun(body, [DELETED_ID]).namesRemoved).toEqual([DELETED_ID]);
  });
});

describe("pickDeleteTargets / pickOrphanTarget — deterministic, and they refuse rather than guess", () => {
  it("binds a target and a twin from the real drafted model, sorted by id", () => {
    const p = pickDeleteTargets(PRE_DELETE);
    expect(p.error).toBeUndefined();
    if (p.error !== undefined) return;
    expect(p.target.id).toBe(DELETED_ID);
    expect(p.twin.id).toBe(SURVIVOR_ID);
    expect(p.incidentEdgePairs).toHaveLength(INCIDENT_EDGE_COUNT);
    // The named edge makes this the BATCHED path rather than a bare node delete.
    expect(p.namedEdge).toBe(p.incidentEdgePairs[0]);
  });

  it("REFUSES a model with fewer than two options instead of weakening its own precondition", () => {
    const thin = { draft_graph: { nodes: [{ id: "a", kind: "option" }], edges: [] } };
    const p = pickDeleteTargets(thin);
    expect(p.error).toContain("the acceptance needs 2");
  });

  it("prefers FACTOR mode when the survivor names two intervention targets", () => {
    const twin = { id: SURVIVOR_ID, interventions: { f1: 1, f2: 1 } };
    expect(pickOrphanTarget({ wireGraph: { nodes: [] }, dbGraph: null, twin, excludeIds: [] })).toMatchObject({
      mode: "FACTOR",
      id: "f1",
    });
  });

  it("falls back to META mode, and never offers the goal node", () => {
    // The goal is excluded because structural_delete deliberately REFUSES to
    // remove it. Choosing it would test the refusal, not the prune.
    const r = pickOrphanTarget({
      wireGraph: { nodes: [{ id: "g" }, { id: "r1" }] },
      dbGraph: { goal_node_id: "g", meta: { roots: ["g", "r1"], leaves: ["g"] } },
      twin: { id: SURVIVOR_ID, interventions: {} },
      excludeIds: [],
    });
    expect(r).toMatchObject({ mode: "META", id: "r1" });
  });

  it("returns NONE — not a guess — when nothing orphanable is readable", () => {
    const r = pickOrphanTarget({ wireGraph: { nodes: [] }, dbGraph: null, twin: { id: "x", interventions: {} }, excludeIds: [] });
    expect(r.id).toBeNull();
    expect(r.why).toContain("canonical-DB arm is not configured");
  });
});

describe("small predicates", () => {
  it("looksLikeAnalysisHash accepts the 16-hex analysis hash and rejects the 64-hex identity hash", () => {
    // The two hashes live in DIFFERENT spaces, and the 409's rpc_cas_conflict arm
    // returns the identity one in a field the client must fill with the analysis
    // one. This predicate is what stops the witness sending it back.
    expect(looksLikeAnalysisHash("5e5bbce61404eb06")).toBe(true);
    expect(looksLikeAnalysisHash("87a5791b1cf5b1652ce485a5c804b71d3a637666de5b1d8500000000deadbeef")).toBe(false);
    expect(looksLikeAnalysisHash(CANONICAL_READ_SENTINEL)).toBe(false);
    expect(looksLikeAnalysisHash(null)).toBe(false);
  });

  it("the canonical-read sentinel cannot be mistaken for a hash", () => {
    expect(CANONICAL_READ_SENTINEL).not.toMatch(/^[0-9a-f]+$/);
  });

  it("every leg the witness can report carries a stated scope", () => {
    for (const leg of ["BUILD", "DRAFT", "CONTROL-STALE", "CONTROL-DGE", "DELETE", "PERSISTED", "ORPHAN", "RERUN", "RELOAD", "CANONICAL-DB"]) {
      expect(LEG_COVERAGE[leg], `${leg} has no stated scope`).toBeTruthy();
    }
    expect(RELOAD_EPISTEMICS.does_not_prove).toContain("browser");
  });
});

describe("decideOutcome — an UNKNOWN leg may never be reported as, or contribute to, a PASS", () => {
  /**
   * THE DEFECT THIS BLOCK PINS, measured on deployed build `293da07` before the
   * fix: the report exited 0 and printed
   *
   *   "PASS — a deleted option was acknowledged truthfully, left the persisted
   *    canonical graph, and stayed gone across a rerun and a fresh uncached read
   *    of the canonical state."
   *
   * whenever no leg had FAILED — including when RERUN was UNKNOWN (the analysis
   * never recomputed, because the deployed build has no option-effect write verb
   * so the readiness repair it advises cannot be applied) and CANONICAL-DB was
   * UNKNOWN (Supabase vars unset). Two of that sentence's clauses were therefore
   * asserted without being measured, by the acceptance authority for a domain
   * closure.
   *
   * These cases are written against the SPEC (the founder's acceptance chain),
   * not against that one failure mode — so a future leg cannot slip past them.
   */
  type Leg = { name: string; verdict: string; detail: string; findings: string[] };
  const leg = (name: string, verdict: string, detail = ""): Leg => ({ name, verdict, detail, findings: [] });
  const CLAUSE_LEGS = Object.keys(ACCEPTANCE_CLAUSES);
  /**
   * BIND TO THE CLAIM MARKER, NOT TO THE WHOLE BLOB.
   *
   * The first version of these tests asserted `banner.not.toContain(clause)`,
   * and every clause case FAILED — because the banner names a withheld clause
   * under "NOT ESTABLISHED", which is the correct behaviour and the opposite of
   * a claim. A substring test over the whole text cannot tell "asserted" from
   * "explicitly withheld", so it was a predicate a different object satisfied.
   * `claimed` reads only the lines the report marks with `+`.
   */
  const claimed = (lines: string[]): string =>
    lines.filter((l) => l.trim().startsWith("+ ")).join("\n");
  const withheld = (lines: string[]): string =>
    lines.filter((l) => l.trim().startsWith("- ") || l.trim().startsWith("REMEDY:")).join("\n");
  const allPass = (): Leg[] => [leg("BUILD", "PASS"), leg("DRAFT", "PASS"), ...CLAUSE_LEGS.map((n) => leg(n, "PASS"))];

  it("PRECONDITION: the all-PASS fixture really does cover every acceptance clause", () => {
    // Without this, every "…is not a PASS" case below could pass vacuously.
    const names = new Set(allPass().map((l) => l.name));
    for (const c of CLAUSE_LEGS) expect(names.has(c), `${c} missing from the all-PASS fixture`).toBe(true);
    expect(decideOutcome(allPass()).status).toBe("PASS");
  });

  it("a fully-witnessed run is PASS, exits 0, and lists every clause it established", () => {
    const out = decideOutcome(allPass());
    expect(out.status).toBe("PASS");
    expect(out.exitCode).toBe(0);
    for (const clause of Object.values(ACCEPTANCE_CLAUSES)) expect(claimed(out.lines)).toContain(clause);
    expect(withheld(out.lines)).toBe("");
  });

  it("POSITIVE CONTROL — THE SHIPPED DEFECT: RERUN + CANONICAL-DB UNKNOWN is INCOMPLETE, never PASS", () => {
    const legs = allPass().map((l) =>
      l.name === "RERUN" || l.name === "CANONICAL-DB" ? { ...l, verdict: "UNKNOWN" } : l,
    );
    const out = decideOutcome(legs);
    expect(out.status).toBe("INCOMPLETE");
    expect(out.exitCode).not.toBe(0);
    const text = out.lines.join("\n");
    // The old banner's two unmeasured clauses must NOT be CLAIMED…
    expect(claimed(out.lines)).not.toContain(ACCEPTANCE_CLAUSES.RERUN);
    expect(claimed(out.lines)).not.toContain(ACCEPTANCE_CLAUSES["CANONICAL-DB"]);
    // …and must instead be NAMED as withheld, which is the requirement.
    expect(withheld(out.lines)).toContain(ACCEPTANCE_CLAUSES.RERUN);
    expect(withheld(out.lines)).toContain(ACCEPTANCE_CLAUSES["CANONICAL-DB"]);
    expect(text).toContain("NOT witnessed");
    expect(text).toContain("NOT ESTABLISHED");
    expect(text).toContain("RERUN");
    expect(text).toContain("CANONICAL-DB");
    // The clauses that WERE measured are still credited — this is not a blunt refusal.
    expect(claimed(out.lines)).toContain(ACCEPTANCE_CLAUSES.DELETE);
    expect(claimed(out.lines)).toContain(ACCEPTANCE_CLAUSES.PERSISTED);
  });

  it("the INCOMPLETE code is distinct from PASS, FAIL and the preflight refusal code", () => {
    // A caller must be able to tell "not measured" from both "witnessed" and
    // "broken", and 2 stays reserved for the missing-secret / production refusals.
    const codes = [EXIT.PASS, EXIT.FAIL, EXIT.PREFLIGHT, EXIT.INCOMPLETE];
    expect(new Set(codes).size).toBe(4);
    expect(EXIT.INCOMPLETE).not.toBe(EXIT.PREFLIGHT);
  });

  it("a FAIL outranks an UNKNOWN and keeps its own exit code", () => {
    const legs = allPass().map((l) => (l.name === "DELETE" ? { ...l, verdict: "FAIL" } : l));
    legs.push(leg("CANONICAL-DB", "UNKNOWN"));
    const out = decideOutcome(legs);
    expect(out.status).toBe("FAIL");
    expect(out.exitCode).toBe(EXIT.FAIL);
    expect(out.lines.join("\n")).toContain("NOT witnessed");
  });

  it.each(CLAUSE_LEGS)(
    "DERIVED, so a new leg cannot escape it: with %s UNKNOWN the banner never claims that clause",
    (legName) => {
      const legs = allPass().map((l) => (l.name === legName ? { ...l, verdict: "UNKNOWN" } : l));
      const out = decideOutcome(legs);
      const clause = ACCEPTANCE_CLAUSES[legName as keyof typeof ACCEPTANCE_CLAUSES];
      expect(out.status, `${legName} UNKNOWN must not be a PASS`).toBe("INCOMPLETE");
      expect(out.exitCode).toBe(EXIT.INCOMPLETE);
      expect(claimed(out.lines), `${legName}'s clause was CLAIMED while UNKNOWN`).not.toContain(clause);
      // Opposite-direction twin: withholding must be VISIBLE, not silent.
      expect(withheld(out.lines), `${legName} was dropped rather than withheld`).toContain(clause);
      expect(out.lines.join("\n")).toContain(legName);
    },
  );

  it("a clause whose leg NEVER RAN is withheld too — an early return is not a pass", () => {
    const out = decideOutcome([leg("BUILD", "PASS"), leg("DRAFT", "PASS")]);
    expect(out.status).toBe("INCOMPLETE");
    expect(out.lines.join("\n")).toContain("NEVER REACHED");
  });

  it("no legs at all is INCOMPLETE — an empty run is the emptiest possible pass", () => {
    for (const empty of [[], null, undefined]) {
      const out = decideOutcome(empty as never);
      expect(out.status).toBe("INCOMPLETE");
      expect(out.exitCode).toBe(EXIT.INCOMPLETE);
    }
  });

  it("CANONICAL-DB UNKNOWN is LOUD: it names the env vars and what stays unverifiable", () => {
    const legs = allPass().map((l) => (l.name === "CANONICAL-DB" ? { ...l, verdict: "UNKNOWN" } : l));
    const text = decideOutcome(legs).lines.join("\n");
    expect(text).toContain("WITNESS_SUPABASE_URL");
    expect(text).toContain("WITNESS_SUPABASE_KEY");
    // The point that makes it loud rather than a footnote: these fields are not
    // on the CEE wire at all, so nothing else can verify them.
    expect(text).toContain("options[]");
    expect(text).toContain("meta.roots");
    expect(text).toContain("EVERY SURFACE");
  });

  it("BUILD RECORDED is surfaced as not-asserted, so an unpinned build is visible", () => {
    const legs = allPass().map((l) => (l.name === "BUILD" ? { ...l, verdict: "RECORDED" } : l));
    const out = decideOutcome(legs);
    expect(out.lines.join("\n")).toContain("WITNESS_EXPECT_SHA");
  });

  it("UNION ASSERTION: every acceptance clause names a real leg with a stated scope", () => {
    // Guards the short-list defect: a clause pointing at a leg the witness never
    // records would be permanently unestablished and silently block every PASS.
    for (const legName of CLAUSE_LEGS) {
      expect(LEG_COVERAGE[legName], `${legName} is claimed as a clause but has no stated scope`).toBeTruthy();
    }
  });

  it("the chain covers the founder's five clauses, with the SECOND DELETE bound to ORPHAN", () => {
    // RERUN re-runs the ANALYSIS; ORPHAN issues the second structural_delete.
    // These two were conflated once — pinned here so the mapping cannot drift.
    for (const legName of ["DELETE", "PERSISTED", "RERUN", "RELOAD", "ORPHAN"]) {
      expect(CLAUSE_LEGS, `${legName} is not in the acceptance chain`).toContain(legName);
    }
    expect(ACCEPTANCE_CLAUSES.ORPHAN).toContain("second delete");
    expect(ACCEPTANCE_CLAUSES.RERUN).toContain("re-running the analysis");
  });
});

describe("the workflow cannot be silenced quietly", () => {
  // Derived from the YAML, so there is no second hand-maintained copy to drift.
  // The sibling journey gate learned this the expensive way: two earlier smoke
  // workflows were dead via `continue-on-error` and an unset `vars.` gate, and
  // nobody noticed for months.
  const raw = readFileSync(WORKFLOW_PATH, "utf8");
  const wf = parse(raw) as Record<string, unknown>;

  it("has no continue-on-error anywhere", () => {
    expect(JSON.stringify(wf)).not.toContain("continue-on-error");
  });

  it("has no `vars.` enable-gate — it cannot be switched off by leaving a variable unset", () => {
    expect(JSON.stringify(wf)).not.toContain("vars.WITNESS");
  });

  it("targets staging, never production", () => {
    expect(raw).not.toContain("olumi-assistants-service.onrender.com");
    expect(raw).toContain("cee-staging.onrender.com");
  });

  it("uses `shell: bash` so a piped node run cannot exit 0 through tee", () => {
    // GitHub's default Linux shell is `bash -e {0}` WITHOUT pipefail.
    expect(raw).toContain("shell: bash");
  });

  it("declares why it is dispatch-only, so the choice is visible rather than assumed", () => {
    expect(raw).toContain("workflow_dispatch");
    expect(raw.toLowerCase()).toContain("why this is not on push");
  });
});
