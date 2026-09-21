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
