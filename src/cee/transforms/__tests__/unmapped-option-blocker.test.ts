/**
 * ⭐⭐ A REFUSAL THAT HOLDS NAMEABLE STRUCTURE MUST NAME IT — THE OPTION-SCOPED
 * HALF WAS THE ONE CLASS THAT SHIPPED MUTE.
 *
 * THE DEFECT, measured on deployed staging and reproduced here at this tip on
 * REAL CAPTURED GRAPH BYTES. A fresh guest clicks the board's "Run analysis"
 * chip and the product answers *"Olumi needs something more from this model
 * before the next analysis. Ask in the chat and it will explain what is
 * missing."* — the `unspecified` rung of the UI's `composeBlockedReason.ts`.
 * That rung is correct: it is reached only when the verdict carries nothing
 * nameable. The verdict DID carry something nameable, and dropped it.
 *
 * ── THE ASYMMETRY THIS CLOSES, stated as the two mirror classes ─────────────
 *
 * `buildAnalysisReadyPayload` itemises one of them and not the other:
 *
 *   · a FACTOR with no option→factor edge  → `unreachableControllableBlockers`
 *     mints a factor-scoped row. ITEMISED.
 *   · an OPTION with no option→factor edge → NOTHING. The pair-scoped loop
 *     iterates `optionFactorAdj.get(option.id)`, which is EMPTY for exactly
 *     this option, so its body never runs and no row is ever minted.
 *
 * The second class is not an edge case; it is the second-commonest refusal on
 * staging. 60 `cee.analysis_ready.built` events over two hours: `ready` 51 ·
 * `needs_user_mapping` 8 · `needs_user_input` 1 — and the `needs_user_mapping`
 * row reads `blockerCount: 0` beside `optionsNeedingMapping: 1` and
 * `userQuestionCount: 2`.
 *
 * ── WHY THE OPTION SCOPE IS COMPLETE, AND NOTHING IS INVENTED ───────────────
 *
 * `computeAnalysisReadyStatusWithReason` (`option-status.ts:251`) returns
 * `needs_user_mapping` from ONE cell: `interventionCount === 0` AND
 * `connectedFactorCount === 0` (repair-authored edges already excluded by the
 * caller). Every other zero-intervention option is `needs_encoding`. So the
 * status IS the derivation — the blocker below restates a fact the verdict has
 * already computed and names no factor, BECAUSE THERE IS NO FACTOR. That is
 * the honest content of this refusal, and `analysis-ready.ts:161-168` says so
 * in its own words: *"no interventions AND no connected factor — the product
 * genuinely does not know which factor this option moves"*.
 *
 * ── BINDING (trap 19) ──────────────────────────────────────────────────────
 *
 * Every assertion names THE `option_id` from the capture. No assertion is a
 * bare count, and each case PINS ITS OWN PRECONDITION in-test (trap 13b): the
 * payload status and the option's status are asserted before the blocker set
 * is, so a fixture that stopped reproducing the cell REDs instead of passing
 * vacuously.
 *
 * ── THE FIXTURE IS A HISTORIC RECORD, READ NOT EDITED (trap 14b) ────────────
 *
 * `sendable-variance-draws-2026-08-19.json` holds verbatim `draft_graph` blocks
 * captured against deployed staging on 19 Aug 2026. Nothing here edits it. The
 * mapping-only case FILTERS the option list handed to the producer while
 * leaving the captured graph whole — which is what keeps
 * `unreachableControllableBlockers` silent (the other options' edges are still
 * in `graph.edges`, so their factors stay reachable) and therefore exercises
 * THIS cell unmasked rather than the mirror one.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import {
  blockerIssue,
  buildAnalysisRefusalReadiness,
} from "../../../orchestrator/tools/analysis-ready-helper.js";
import { AnalysisBlocker } from "../../../schemas/analysis-ready.js";
import type { GraphV3T, NodeV3T, OptionV3T, InterventionV3T } from "../../../schemas/cee-v3.js";
import { buildAnalysisReadyPayload } from "../analysis-ready.js";
import { computeOptionStatus } from "../option-status.js";

const DRAWS = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/sendable-variance-draws-2026-08-19.json", import.meta.url)),
    "utf-8",
  ),
) as Record<string, { draft_graph: GraphV3T }>;

/**
 * The captured option that sits in the mapping cell. Draw 5's `e405d56a` is
 * connected by two edges that BOTH carry `origin: "repair"` — the product's own
 * status-quo wiring — so its non-repair-authored connected-factor count is
 * zero. It is the cell, in real data, rather than a shape written here.
 */
const UNMAPPED_OPTION_ID = "e405d56a";

function optionsFromGraph(graph: GraphV3T): OptionV3T[] {
  return (graph.nodes as NodeV3T[])
    .filter((node) => node.kind === "option")
    .map((node) => {
      const raw = node as unknown as {
        id: string;
        label: string;
        interventions?: Record<string, InterventionV3T>;
      };
      const interventions = raw.interventions ?? {};
      return {
        id: raw.id,
        label: raw.label,
        status: computeOptionStatus({ interventions }).status,
        interventions,
      } as unknown as OptionV3T;
    });
}

function build(drawKey: string, keep: (option: OptionV3T) => boolean = () => true) {
  const graph = DRAWS[drawKey].draft_graph;
  const goal = (graph.nodes as NodeV3T[]).find((node) => node.kind === "goal")!;
  const payload = buildAnalysisReadyPayload(optionsFromGraph(graph).filter(keep), goal.id, graph);
  return { payload, blockers: payload.blockers ?? [] };
}

describe("an option in the mapping cell is named by the refusal", () => {
  it("draw-5, mapping-only — the refusal carries a blocker naming the option", () => {
    const { payload, blockers } = build("draw-5", (o) => o.id === UNMAPPED_OPTION_ID);

    // PRECONDITION, pinned in-test: this payload really is the witnessed cell.
    // Without these the blocker assertion could pass on a different state.
    expect(payload.status).toBe("needs_user_mapping");
    expect(payload.options.map((o) => `${o.id}:${o.status}`)).toEqual([
      `${UNMAPPED_OPTION_ID}:needs_user_mapping`,
    ]);
    // The verdict holds nameable structure — this is what makes the silence a
    // defect rather than an honest "nothing to say".
    expect(payload.user_questions ?? []).not.toHaveLength(0);

    // RED at pristine: `blockers` is ABSENT on this payload.
    const named = blockers.filter((b) => b.option_id === UNMAPPED_OPTION_ID);
    expect(named).toHaveLength(1);
    expect(named[0].option_label).toBe(
      payload.options.find((o) => o.id === UNMAPPED_OPTION_ID)!.label,
    );
    // No factor is named, because the cell is DEFINED by there being none.
    expect(named[0].factor_id).toBeUndefined();
    expect(named[0].message.trim().length).toBeGreaterThan(0);
  });

  it("draw-5, whole capture — the omitted option joins the ones already itemised", () => {
    const { payload, blockers } = build("draw-5");

    // PRECONDITION: the capture still reproduces one mapping-cell option beside
    // options that DO get pair-scoped rows. That mixture is the point — the
    // refusal used to itemise the others and silently drop this one.
    expect(
      payload.options.find((o) => o.id === UNMAPPED_OPTION_ID)!.status,
    ).toBe("needs_user_mapping");
    expect(blockers.filter((b) => b.factor_id !== undefined).length).toBeGreaterThan(0);

    // RED at pristine: two rows, neither naming `e405d56a`.
    expect(blockers.map((b) => b.option_id)).toContain(UNMAPPED_OPTION_ID);
  });

  it("the blocker maps to an ACTIONABLE boundary code the UI can compose from", () => {
    // The consumer reads `analysis_state.readiness.blockers`, produced by
    // `mapWireBlockers` → `blockerIssue`. A row that maps to `null`, or to the
    // one advisory code, would be filtered out by the UI's `actionableBlockers`
    // and reproduce the exact defect this spec pins — so the mapping is
    // asserted here rather than assumed.
    const { payload, blockers } = build("draw-5", (o) => o.id === UNMAPPED_OPTION_ID);
    const row = blockers.find((b) => b.option_id === UNMAPPED_OPTION_ID);
    expect(row, "the mapping-cell option must have a blocker to map").toBeDefined();

    const issue = blockerIssue(row, 0, payload.status);
    expect(issue).not.toBeNull();
    // `CONSTRAINT_REVIEW_REQUIRED` is the sole member of the UI's
    // ADVISORY_BLOCKER_CODES; anything else survives `actionableBlockers`.
    expect(issue!.code).not.toBe("CONSTRAINT_REVIEW_REQUIRED");
    expect(issue!.message.trim().length).toBeGreaterThan(0);
    expect(issue!.option_id).toBe(UNMAPPED_OPTION_ID);
  });
});

describe("the blocker survives the refusal carrier that feeds the wire", () => {
  /**
   * ⭐ THE HOP THAT MADE THIS A DEAD END RATHER THAN A DROPPED FIELD.
   *
   * The Run chip does not ship the structural payload. `chip-click-dispatch`
   * hands it to `buildAnalysisRefusalReadiness`, which re-stamps the status to
   * `blocked` and keeps only the model's IDENTITY plus any blocker rows that
   * satisfy the published `AnalysisBlocker` contract — everything else is
   * dropped as output the turn declined to produce.
   *
   * So a row that the producer mints but the carrier rejects would look fixed
   * in the producer's own suite and still reach the user as silence. This binds
   * the carry, and it is also the pin on the schema change: before it,
   * `factor_id` was REQUIRED, so an option-scoped row FAILED `safeParse` here
   * and was dropped on this exact line.
   */
  it("the option-scoped row survives buildAnalysisRefusalReadiness's contract filter", () => {
    const { payload } = build("draw-5", (o) => o.id === UNMAPPED_OPTION_ID);

    // PRECONDITION: the carrier's identity branch is genuinely reached — an
    // early return would carry no blockers for an unrelated reason and this
    // test would pass on the wrong thing.
    expect(payload.status).not.toBe("ready");
    expect(typeof payload.goal_node_id).toBe("string");
    expect(payload.options.length).toBeGreaterThan(0);

    const refusal = buildAnalysisRefusalReadiness(
      "MISSING_OPTION_VALUE",
      payload as unknown as Parameters<typeof buildAnalysisRefusalReadiness>[1],
    );

    expect(refusal.status).toBe("blocked");
    // The carrier holds the BASE wire payload type, whose `blockers` is
    // deliberately unnarrowed; parse each row back through the published
    // contract rather than casting, so this assertion is about a row that
    // genuinely satisfies `AnalysisBlocker` and not about a shape asserted here.
    const carried = (refusal.blockers ?? [])
      .map((row) => AnalysisBlocker.safeParse(row))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
      .filter((b) => b.option_id === UNMAPPED_OPTION_ID);
    expect(carried).toHaveLength(1);

    // And the mapped form the UI actually reads is actionable, so the floor
    // rung is not reached. `analysisBlockedSentences` returns its `unspecified`
    // sentence for an EMPTY list; a non-empty actionable list with a non-empty
    // message is exactly the condition under which it does not.
    const issue = blockerIssue(carried[0], 0, refusal.status);
    expect(issue).not.toBeNull();
    expect(issue!.code).not.toBe("CONSTRAINT_REVIEW_REQUIRED");
    expect(issue!.message.trim().length).toBeGreaterThan(0);
  });
});

describe("the scope rule that replaced the old factor-required strictness", () => {
  /**
   * The former shape enforced "name a FACTOR". That was stricter than the wire
   * contract and silenced a whole class. What actually has to hold is "name a
   * SCOPE" — a blocker with neither gives a surface nothing to render, link or
   * resolve. These pin the replacement so it cannot quietly become a no-op.
   */
  it("rejects a blocker that names no scope at all", () => {
    const scopeless = {
      blocker_type: "missing_connection",
      message: "Something is missing.",
      suggested_action: "add_edge",
    };
    expect(AnalysisBlocker.safeParse(scopeless).success).toBe(false);
  });

  it("accepts an option-only scope, and still accepts a factor-only one", () => {
    expect(
      AnalysisBlocker.safeParse({
        option_id: "opt_1",
        option_label: "Option one",
        blocker_type: "missing_connection",
        message: "Option \"Option one\" has no effect values yet.",
        suggested_action: "add_edge",
      }).success,
    ).toBe(true);
    expect(
      AnalysisBlocker.safeParse({
        factor_id: "f_1",
        factor_label: "Factor one",
        blocker_type: "missing_value",
        message: "Factor \"Factor one\" is not connected to any option",
        suggested_action: "add_value",
      }).success,
    ).toBe(true);
  });

  it("still rejects the #1126 smuggle fixture, so that pin is untouched", () => {
    // The property those specs protect — this carrier passes through nothing it
    // was merely handed — must survive the widening.
    expect(AnalysisBlocker.safeParse({ kind: "missing_value" }).success).toBe(false);
  });
});

describe("nothing is manufactured where the verdict has nothing to say", () => {
  it("draw-4, ready-only — a ready payload gains no blockers", () => {
    // `unspecified` must stay reachable for a genuinely empty verdict. This is
    // the floor the lane is forbidden to remove.
    const { payload } = build("draw-4", (o) =>
      ["4abad64d", "939d4630", "e755ec33"].includes(o.id),
    );
    expect(payload.status).toBe("ready");
    expect(payload.blockers).toBeUndefined();
  });

  it("draw-9 — no option is in the mapping cell, so the blocker set is unchanged", () => {
    // The discriminating GREEN half: every option here is `needs_encoding`
    // (connected, awaiting a magnitude), which is a DIFFERENT question with a
    // different remedy. A fix that fired on emptiness rather than on the
    // mapping cell would add rows here, and this REDs.
    const { payload, blockers } = build("draw-9");
    expect(payload.options.some((o) => o.status === "needs_user_mapping")).toBe(false);
    expect(blockers).toHaveLength(7);
    expect(blockers.every((b) => b.factor_id !== undefined)).toBe(true);
  });
});
