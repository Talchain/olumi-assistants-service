/**
 * ZERO-BEHAVIOUR-CHANGE proof for the model-routing consolidation
 * (ROADMAP 1.185(a), rec-2). Every live (and dark-but-registered) call site
 * resolves to EXACTLY the model it resolved to before the consolidation. These
 * expected ids were captured from the pre-refactor code paths at staging tip
 * fc511053; the consolidation (register opus-4-8, extend the drift guard, anchor
 * the anthropic draft fallback to the task default) MUST NOT move any of them.
 *
 * Mutation check: change any TASK_MODEL_DEFAULTS value (or a bypass default) and
 * the matching row below goes RED — the table discriminates.
 *
 * Note: this pins the CHECKED-IN DEFAULT resolution (no CEE_MODEL_* env override,
 * no per-call / store_model_config override). Those overrides are operator escape
 * hatches orthogonal to this refactor; the router chain that applies them is
 * unchanged.
 */

import { describe, it, expect } from "vitest";
import { getDefaultModelForTask, TASK_MODEL_DEFAULTS } from "../../src/config/model-routing.js";
import { getModelProvider, isModelEnabled, isKnownModel } from "../../src/config/models.js";

/** site → source → expected model id (captured pre-refactor). */
const RESOLUTION_TABLE: ReadonlyArray<{
  site: string;
  source: string;
  expected: string;
}> = [
  // ── LIVE on the V5 conversational path ──────────────────────────────────
  { site: "C1 orchestrator (coach turn)", source: "TASK_MODEL_DEFAULTS.orchestrator", expected: "claude-sonnet-5" },
  // C2/C3 re-pinned 2026-08-08: draft/edit defaults DELIBERATELY moved
  // claude-sonnet-4-6 → claude-sonnet-5 (reconciled to live staging env;
  // Paul's ruling: all Claude tasks on sonnet-5). Not a refactor drift —
  // an intentional default change, tests updated in the same PR.
  { site: "C2 draft_graph", source: "TASK_MODEL_DEFAULTS.draft_graph", expected: "claude-sonnet-5" },
  { site: "C3 edit_graph", source: "TASK_MODEL_DEFAULTS.edit_graph", expected: "claude-sonnet-5" },
  { site: "C4 decision_review", source: "TASK_MODEL_DEFAULTS.decision_review", expected: "gpt-4.1-2025-04-14" },
  { site: "C7/C8 repair_graph", source: "TASK_MODEL_DEFAULTS.repair_graph", expected: "gpt-4.1-2025-04-14" },
  // ── LIVE standalone /assist/* ───────────────────────────────────────────
  { site: "C13 critique_graph", source: "TASK_MODEL_DEFAULTS.critique_graph", expected: "gpt-5.2" },
  { site: "C15 suggest_options", source: "TASK_MODEL_DEFAULTS.suggest_options", expected: "gpt-5.2" },
  // ── DARK but registry-covered (governed by the drift guard) ─────────────
  { site: "C10 m2_graph_review (dark)", source: "TASK_MODEL_DEFAULTS.m2_graph_review", expected: "claude-opus-4-8" },
  // ── R-7 COVERAGE ROWS (30 Jul) — drift alarms, not pre-refactor captures ─
  // The completeness gate below made the table's blindness LOUD: every
  // TASK_MODEL_DEFAULTS key must be pinned here or explicitly excused, so a
  // key added to the defaults without a row REDs (validate_graph went LIVE
  // with ROADMAP 2.146 and this table never saw it — the exact hole).
  // Values pinned at the checked-in default at the time the gate was added.
  { site: "validation Pass 2 (LIVE, 2.146 — the row R-7 found missing)", source: "TASK_MODEL_DEFAULTS.validate_graph", expected: "o4-mini" },
  { site: "assist clarification", source: "TASK_MODEL_DEFAULTS.clarification", expected: "gpt-4.1-2025-04-14" },
  { site: "assist preflight", source: "TASK_MODEL_DEFAULTS.preflight", expected: "gpt-4.1-2025-04-14" },
  { site: "assist explainer", source: "TASK_MODEL_DEFAULTS.explainer", expected: "gpt-4.1-2025-04-14" },
  { site: "assist evidence_helper", source: "TASK_MODEL_DEFAULTS.evidence_helper", expected: "gpt-4.1-2025-04-14" },
  { site: "assist sensitivity_coach", source: "TASK_MODEL_DEFAULTS.sensitivity_coach", expected: "gpt-4.1-2025-04-14" },
  { site: "bias_check", source: "TASK_MODEL_DEFAULTS.bias_check", expected: "claude-sonnet-4-20250514" },
  { site: "options (alias base of C15 suggest_options)", source: "TASK_MODEL_DEFAULTS.options", expected: "gpt-5.2" },
];

/**
 * R-7: keys DELIBERATELY not pinned, each with its reason stated where the
 * completeness gate reads it. An entry here is a decision, not an omission.
 */
const EXPLICITLY_UNPINNED_TASKS: Record<string, string> = {
  routing:
    "display-only default (admin UI parity); the v5 routing call site controls " +
    "its own model selection and never reads this value — model-routing.ts's " +
    "own comment on the row",
};

describe("model resolution table — zero behaviour change (checked-in defaults)", () => {
  for (const row of RESOLUTION_TABLE) {
    it(`${row.site} resolves to ${row.expected} via ${row.source}`, () => {
      const task = row.source.replace("TASK_MODEL_DEFAULTS.", "");
      expect(getDefaultModelForTask(task as never)).toBe(row.expected);
    });
  }

  it("every default model in the table is a KNOWN registry id (post-opus-4-8 registration)", () => {
    for (const row of RESOLUTION_TABLE) {
      expect(isKnownModel(row.expected), `${row.expected} (${row.site}) must be registered`).toBe(true);
    }
  });

  it("R-7: DERIVE-OR-RED — every TASK_MODEL_DEFAULTS key is pinned by a row or explicitly excused, in both directions", () => {
    const pinned = new Set(
      RESOLUTION_TABLE.map((r) => r.source.replace("TASK_MODEL_DEFAULTS.", "")),
    );
    const excused = new Set(Object.keys(EXPLICITLY_UNPINNED_TASKS));
    // Forward: a key added to the defaults without a row (or a reasoned
    // excuse) REDs here — the validate_graph hole cannot recur.
    for (const task of Object.keys(TASK_MODEL_DEFAULTS)) {
      expect(
        pinned.has(task) || excused.has(task),
        `TASK_MODEL_DEFAULTS.${task} has no RESOLUTION_TABLE row and no entry in ` +
          `EXPLICITLY_UNPINNED_TASKS — pin its default or state why not.`,
      ).toBe(true);
      // An excused key must not ALSO be pinned: a stale excuse over a live row
      // is exactly the mirror-drift this gate exists to refuse.
      expect(pinned.has(task) && excused.has(task), `${task}: both pinned AND excused`).toBe(false);
    }
    // Reverse: no ghost rows or ghost excuses for keys that no longer exist.
    for (const task of [...pinned, ...excused]) {
      expect(
      Object.hasOwn(TASK_MODEL_DEFAULTS, task),
        `"${task}" is pinned/excused but is not a TASK_MODEL_DEFAULTS key`,
      ).toBe(true);
    }
  });

  it("provider per site is unchanged (anthropic / openai split)", () => {
    // Guards against a cross-provider drift hidden behind an id that still parses.
    expect(getModelProvider("claude-sonnet-5")).toBe("anthropic");
    expect(getModelProvider("claude-sonnet-4-6")).toBe("anthropic");
    expect(getModelProvider("claude-opus-4-8")).toBe("anthropic");
    expect(getModelProvider("gpt-4.1-2025-04-14")).toBe("openai");
    expect(getModelProvider("gpt-5.2")).toBe("openai");
  });
});

describe("router-bypass resolvers resolve to their pre-refactor defaults", () => {
  it("rolling summariser default is claude-haiku-4-5 (no env override)", async () => {
    const { resolveSummaryModel } = await import(
      "../../src/orchestrator-v5/rolling-summary/summariser.js"
    );
    // With CEE_MODEL_SUMMARY unset in the test env, resolves to the haiku default.
    expect(resolveSummaryModel()).toBe("claude-haiku-4-5");
  });

  it("decision-review decompose default is claude-haiku-4-5 (no env override)", async () => {
    const { resolveDecomposeModel } = await import(
      "../../src/cee/decision-review/decompose.js"
    );
    expect(resolveDecomposeModel()).toBe("claude-haiku-4-5");
  });

  it("both bypass defaults are enabled registry ids", () => {
    expect(isKnownModel("claude-haiku-4-5") && isModelEnabled("claude-haiku-4-5")).toBe(true);
  });
});

describe("anthropic draft fallback derives from the task default (no bare literal)", () => {
  it("the value the draft-adapter fallback now derives equals the draft task default", () => {
    // anthropic.ts uses `args.model || getDefaultModelForTask('draft_graph')`.
    // Both the fallback and the router default must be the SAME id — this is what
    // makes removing the hard-coded model literal a zero-change edit.
    // Pinned at the checked-in default (claude-sonnet-5, reconciled 2026-08-08).
    expect(getDefaultModelForTask("draft_graph")).toBe("claude-sonnet-5");
  });
});
