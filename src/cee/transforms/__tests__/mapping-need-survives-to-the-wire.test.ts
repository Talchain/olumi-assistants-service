/**
 * ⭐⭐ THE COUNT SURVIVED TO THE DECISION; THE LIST DID NOT SURVIVE TO THE WIRE.
 *
 * A SECOND, SHARPER WITNESS (user debug bundle 2026-09-21T12:29Z, scenario
 * `65fdde46`, a SIMPLE brief, three options):
 *
 *     opt 00f89f37   ready                2 interventions
 *     opt be215545   needs_user_mapping   2 interventions  unresolved: absent  questions: 0
 *     opt e70301eb   needs_user_mapping   2 interventions  unresolved: absent  questions: 0
 *
 * ⭐ ALL THREE CARRY TWO INTERVENTIONS. That kills the obvious explanation:
 * this is not "no values" and not "no interventions". The three options are
 * structurally alike and two are blocked by an obligation that names nothing.
 *
 * ── WHY IT IS CARRIAGE, NOT COMPUTATION ────────────────────────────────────
 * `projectOptionForAnalysis` READS the list to decide the status and then omits
 * it from the result:
 *
 *     computeAnalysisReadyStatusWithReason(…, option.unresolved_targets?.length ?? 0)
 *     const result: OptionForAnalysisT = { id, label, status, status_reason,
 *                                          interventions, extraction_metadata };
 *
 * With interventions present, the ONLY limb that can return
 * `needs_user_mapping` is the `unresolvedTargetCount > 0` one — settled by
 * execution at this tip, and its reason string has exactly one producer
 * repo-wide:
 *
 *     (2 interventions, 1 target) → needs_user_mapping
 *                                   "A proposed effect still needs a supported mapping"
 *     (0 interventions, 0 targets) → needs_user_mapping "No interventions extracted"
 *     (2 interventions, 0 targets) → ready                      ← the discriminator
 *
 * So the option was blocked BECAUSE of a list the product already held, and
 * then shipped without it. The value exists one line above the omission; this
 * suite pins that it reaches the user.
 *
 * ── THE INVARIANT HAS TWO LIMBS, AND THEY FAIL IN OPPOSITE DIRECTIONS ───────
 * The third probe above is why this suite does not simply demand a list:
 *   · content EXISTS (targets > 0) → it must be CARRIED, never recomputed;
 *   · content genuinely ABSENT (no interventions, no targets, no connectivity)
 *     → the producer must NAME the need, because there is no list to carry.
 * Forcing a list that does not exist would fabricate one; degrading to `ready`
 * would assert analysability that does not exist and is never permitted.
 *
 * ── BINDING ────────────────────────────────────────────────────────────────
 * Assertions name their option BY ID (trap 19). The graph is a REAL committed
 * capture, read only (trap 14b); the measured condition is reproduced on a COPY
 * of a real option record that genuinely carries two interventions.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { assessCanonicalAnalysisReadiness } from "../../../orchestrator/tools/analysis-ready-helper.js";
import type { GraphV3T } from "../../../schemas/cee-v3.js";
import { buildAnalysisReadyPayload } from "../analysis-ready.js";
import { computeAnalysisReadyStatusWithReason } from "../option-status.js";

const CAPTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("./fixtures/held-baseline-journey-2026-09-18.json", import.meta.url),
    ),
    "utf-8",
  ),
) as { draft_graph: GraphV3T };

/** A real captured option that genuinely carries TWO interventions — the
 *  structural twin of `be215545` / `e70301eb` in bundle `65fdde46`. */
const TWO_INTERVENTION_ID = "3fb49c45";
/** A real captured option left untouched, to prove the effect is not global. */
const UNTOUCHED_ID = "68c0488d";
/** A real captured NON-baseline option, emptied to reach the genuinely-empty limb. */
const EMPTIED_ID = "edbad1ba";

const UNRESOLVED = ["brand equity"];

type WireOption = {
  option_id: string;
  label?: string;
  status: string;
  status_reason?: string;
  interventions: Record<string, number>;
  unresolved_targets?: string[];
  user_questions?: string[];
};

/**
 * The real chain: a graph whose named options carry `unresolved_targets`, or
 * have had their interventions cleared, driven through the exported readiness
 * authority.
 *
 * ⚠ CLEARING IS NOT OPTIONAL SCAFFOLDING. Every option in this capture projects
 * to `ready` untouched — measured, all five — so an assertion over "the blocked
 * options" would filter an EMPTY set and pass by examining nothing (trap 13).
 * The genuinely-empty limb has to be reproduced deliberately, and its
 * precondition is asserted in-test below.
 */
function wireOptions(opts: {
  unresolvedOn?: readonly string[];
  clearInterventionsOn?: readonly string[];
  disconnect?: readonly string[];
}): WireOption[] {
  const unresolvedOn = opts.unresolvedOn ?? [];
  const clearOn = opts.clearInterventionsOn ?? [];
  const disconnect = opts.disconnect ?? [];
  const graph = {
    ...CAPTURE.draft_graph,
    nodes: CAPTURE.draft_graph.nodes.map((node) => ({
      ...node,
      ...(unresolvedOn.includes(node.id) ? { unresolved_targets: [...UNRESOLVED] } : {}),
      ...(clearOn.includes(node.id) ? { interventions: {} } : {}),
    })),
    edges: CAPTURE.draft_graph.edges.filter((edge) => !disconnect.includes(edge.from)),
  };
  const assessment = assessCanonicalAnalysisReadiness(graph);
  return (assessment.analysisReady?.options ?? []) as unknown as WireOption[];
}

function byId(options: readonly WireOption[], id: string): WireOption {
  const found = options.find((o) => o.option_id === id);
  if (!found) throw new Error(`harness: option ${id} absent from the wire payload`);
  return found;
}

describe("the obligation that blocked the option reaches the user", () => {
  it("PROBE: only the unresolved-target limb blocks an option that HAS interventions", () => {
    // Pins the premise this suite rests on, in-test (trap 13b), including the
    // discriminator that proves the block comes from the targets.
    expect(computeAnalysisReadyStatusWithReason(2, undefined, false, 0, false, 1)).toEqual({
      status: "needs_user_mapping",
      reason: "A proposed effect still needs a supported mapping",
    });
    expect(
      computeAnalysisReadyStatusWithReason(2, undefined, false, 0, false, 0).status,
    ).toBe("ready");
    expect(
      computeAnalysisReadyStatusWithReason(0, undefined, false, 0, false, 0).status,
    ).toBe("needs_user_mapping");
  });

  it("PRECONDITION: the subject reaches needs_user_mapping WITH interventions", () => {
    // Reproduces bundle 65fdde46's shape: blocked, yet not empty.
    const subject = byId(wireOptions({ unresolvedOn: [TWO_INTERVENTION_ID] }), TWO_INTERVENTION_ID);
    expect(subject.status).toBe("needs_user_mapping");
    expect(Object.keys(subject.interventions).length).toBeGreaterThan(0);
    expect(subject.status_reason).toBe("A proposed effect still needs a supported mapping");
  });

  it("RED: the unresolved targets that caused the block are carried, not dropped", () => {
    const subject = byId(wireOptions({ unresolvedOn: [TWO_INTERVENTION_ID] }), TWO_INTERVENTION_ID);
    expect(subject.unresolved_targets).toEqual(UNRESOLVED);
  });

  it("RED: an option blocked with no list to carry still names its need", () => {
    // The OTHER limb: nothing to carry, so the producer must name the need.
    // `edbad1ba` is a real NON-baseline option; clearing its interventions is
    // what reaches this limb at all (see the note on `wireOptions`).
    // ⚠ BOTH HALVES ARE REQUIRED, and that is a finding about this path rather
    // than harness convenience: every option in the capture is CONNECTED, and a
    // connected numberless option is `needs_encoding` — a different status whose
    // obligation ("choose how to represent this on the effect scale") IS
    // meetable. `needs_user_mapping` at this surface means no interventions AND
    // no connectivity, which is exactly the shape the first two bundles carried.
    const options = wireOptions({
      clearInterventionsOn: [EMPTIED_ID],
      disconnect: [EMPTIED_ID],
    });
    const subject = byId(options, EMPTIED_ID);

    // PRECONDITION, asserted so a GREEN can never come from an empty filter.
    expect(subject.status).toBe("needs_user_mapping");
    expect(Object.keys(subject.interventions)).toHaveLength(0);
    expect(subject.unresolved_targets ?? []).toEqual([]);

    const questions = subject.user_questions ?? [];
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.some((q) => q.includes(subject.label ?? ""))).toBe(true);
  });

  it("CONTRAST CONTROL: an untouched option is not given someone else's targets", () => {
    const untouched = byId(wireOptions({ unresolvedOn: [TWO_INTERVENTION_ID] }), UNTOUCHED_ID);
    expect(untouched.unresolved_targets ?? []).toEqual([]);
    expect(untouched.status).toBe("ready");
  });

  it("CONTRAST CONTROL: with no unresolved targets the same option is READY", () => {
    // The discriminating twin of the RED above — proves the carriage assertion
    // is about the list, not about the option.
    const subject = byId(wireOptions({}), TWO_INTERVENTION_ID);
    expect(subject.status).toBe("ready");
    expect(subject.unresolved_targets ?? []).toEqual([]);
  });
});

/**
 * ⭐⭐ THE ASK NAMED A FACTOR WHEN THE BLOCKER WAS A RISK — and it cost a whole
 * session, because the user tried to fix something that was not broken.
 *
 * An option→risk edge forces `needs_user_mapping` unconditionally
 * (`buildAnalysisReadyPayload`, the "keep qualitative option→risk hypotheses"
 * branch), and `unresolvedTargetCount > 0` short-circuits
 * `computeAnalysisReadyStatusWithReason` before every other consideration. The
 * readiness issue then rendered `optionMappingAsk`, which knows only the option
 * label and asks a FACTOR-MAPPING question:
 *
 *     Choose which factor "Two Developers" changes and by how much.
 *
 * The producer had already written the correct, risk-naming sentence onto the
 * option (`How does X change <risk label>? …`). The ask simply did not read it.
 *
 * ⚠ SCOPE. This fixes the SENTENCE ONLY. Whether an option→risk edge should
 * gate admission at all is a separate ruling with a contract gap behind it —
 * recorded in the PR body, deliberately NOT decided here.
 */
describe("a risk-blocked option is asked about the risk, not about a factor", () => {
  const RISK_ID = "150def25";

  function issuesFor(optionId: string) {
    const graph = {
      ...CAPTURE.draft_graph,
      edges: [
        ...CAPTURE.draft_graph.edges,
        {
          from: optionId,
          to: RISK_ID,
          strength: { mean: 0.42, std: 0.13 },
          exists_probability: 0.79,
          effect_direction: "positive",
          provenance: { source: "cee_hypothesis", reasoning: "Retained causal hypothesis" },
        },
      ],
    };
    return assessCanonicalAnalysisReadiness(graph).blockingIssues;
  }

  it("PRECONDITION: an option→risk edge really does block the option", () => {
    const issues = issuesFor(TWO_INTERVENTION_ID);
    const mapping = issues.filter(
      (i) => i.option_id === TWO_INTERVENTION_ID && i.code === "OPTION_NEEDS_MAPPING",
    );
    expect(mapping.length).toBeGreaterThan(0);
  });

  it("RED: the message names the risk in the user's own label", () => {
    const riskLabel = CAPTURE.draft_graph.nodes.find((n) => n.id === RISK_ID)?.label ?? "";
    expect(riskLabel).not.toBe("");
    const mapping = issuesFor(TWO_INTERVENTION_ID).filter(
      (i) => i.option_id === TWO_INTERVENTION_ID && i.code === "OPTION_NEEDS_MAPPING",
    );
    expect(mapping.map((i) => i.message).join(" ")).toContain(riskLabel);
  });

  it("RED: it does not ask a factor-mapping question about a risk blocker", () => {
    const mapping = issuesFor(TWO_INTERVENTION_ID).filter(
      (i) => i.option_id === TWO_INTERVENTION_ID && i.code === "OPTION_NEEDS_MAPPING",
    );
    expect(mapping.map((i) => i.message).join(" ")).not.toContain("Choose which factor");
  });

  it("CONTRAST CONTROL: an option with no risk edge keeps the factor ask", () => {
    // The generic ask is CORRECT when the option genuinely has no mapping —
    // this proves the change is scoped to the risk case, not a blanket rewrite.
    const options = wireOptions({
      clearInterventionsOn: [EMPTIED_ID],
      disconnect: [EMPTIED_ID],
    });
    expect(byId(options, EMPTIED_ID).status).toBe("needs_user_mapping");

    const graph = {
      ...CAPTURE.draft_graph,
      nodes: CAPTURE.draft_graph.nodes.map((n) =>
        n.id === EMPTIED_ID ? { ...n, interventions: {} } : n,
      ),
      edges: CAPTURE.draft_graph.edges.filter((e) => e.from !== EMPTIED_ID),
    };
    const issues = assessCanonicalAnalysisReadiness(graph).blockingIssues.filter(
      (i) => i.option_id === EMPTIED_ID && i.code === "OPTION_NEEDS_MAPPING",
    );
    expect(issues.map((i) => i.message).join(" ")).toContain("Choose which factor");
  });
});

/**
 * ⭐ THE LAST LINE BEFORE THE WIRE, and it must be able to fail.
 *
 * `buildAnalysisReadyPayload` is EXPORTED and called directly, and both of
 * today's production callers already name the need upstream — so a mutant that
 * removes the projection's own `nameMappingNeed` call SURVIVES against the
 * graph-driven cases above. A guard nothing can fail is a guard that rots
 * (CLAUDE.md trap 13c: a survivor is a claim, and equivalence must be
 * demonstrated, not asserted).
 *
 * This binds the guard to the function's own contract instead: a producer that
 * hands it a blocked option naming nothing must not get that option back
 * unexplained. It is what makes the rule hold for the NEXT producer, rather
 * than only for the two that exist today.
 */
describe("the projection is the last line before the wire", () => {
  const GOAL_ID = CAPTURE.draft_graph.nodes.find((n) => n.kind === "goal")?.id ?? "";

  it("HARNESS: the capture supplies a goal", () => {
    expect(GOAL_ID).not.toBe("");
  });

  it("a blocked option handed in naming nothing is not passed through unexplained", () => {
    const graph = {
      ...CAPTURE.draft_graph,
      edges: CAPTURE.draft_graph.edges.filter((e) => e.from !== EMPTIED_ID),
    };
    const node = CAPTURE.draft_graph.nodes.find((n) => n.id === EMPTIED_ID);
    expect(node).toBeDefined();

    // A producer that computed the status and wrote no obligation.
    const payload = buildAnalysisReadyPayload(
      [
        {
          id: EMPTIED_ID,
          label: node?.label ?? EMPTIED_ID,
          status: "needs_user_mapping",
          interventions: {},
        },
      ],
      GOAL_ID,
      graph,
    );

    const projected = payload.options.find((o) => o.id === EMPTIED_ID);
    expect(projected?.status).toBe("needs_user_mapping");
    const questions = (projected as { user_questions?: string[] } | undefined)?.user_questions ?? [];
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.some((q) => q.includes(node?.label ?? ""))).toBe(true);
  });
});
