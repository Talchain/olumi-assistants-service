/**
 * Clarify v2 — `clarify_v2_round` pending-action contract (E0-B).
 *
 * Pins: (1) parse accepts the emitted shape and rejects malformed rows
 * fail-closed; (2) the kind is classified non-mutating and is NOT
 * claimable by the short-confirm or clarification resumers (a bare "yes"
 * against a live clarify round belongs to the clarify-v2 resume's own
 * proceed rule, never to TurnExecutor's pending synthesis); (3) the
 * numeric brief cap in the parser matches the draft pipeline's Zod max
 * (the parser cannot import the schemas module, so the mirror is pinned
 * here instead — trap-12 discipline: a mirror must fail loud on drift).
 */
import { describe, it, expect } from "vitest";

import {
  parsePendingAction,
  RESUMABLE_ACTION_TYPES,
  CHIP_DERIVABLE_ACTION_TYPES,
  CONFIRMATION_EXPECTING_ACTION_TYPES,
} from "../../src/orchestrator-v5/session/pending-action.js";
import { PENDING_ACTION_KIND_SAFETY } from "../../src/orchestrator-v5/routing/clarification-resume.js";
import { tryClarificationResume } from "../../src/orchestrator-v5/routing/clarification-resume.js";
import { tryShortConfirmResume } from "../../src/orchestrator-v5/routing/deterministic-short-confirm.js";
import { DRAFT_GRAPH_MAX_BRIEF_LENGTH } from "../../src/schemas/assist.js";

const NOW = Date.parse("2026-07-16T12:00:00Z");

function validRow(overrides: Record<string, unknown> = {}, actionOverrides: Record<string, unknown> = {}) {
  return {
    id: "cv2_turn-1",
    scenario_id: "scenario-1",
    chip_id: "cv2_proceed_default",
    action: {
      kind: "clarify_v2_round",
      brief: "Should we expand into the German market?",
      asked_dimensions: ["goal", "options"],
      round: 1,
      ...actionOverrides,
    },
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: new Date(NOW + 60_000).toISOString(),
    emitted_at_iso: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe("parsePendingAction — clarify_v2_round", () => {
  it("accepts the emitted shape", () => {
    expect(parsePendingAction(validRow())).not.toBeNull();
  });

  it.each([
    ["empty brief", { brief: "   " }],
    ["over-long brief", { brief: "x".repeat(5001) }],
    ["non-string brief", { brief: 42 }],
    ["unknown dimension", { asked_dimensions: ["goal", "confidence"] }],
    ["non-array asked_dimensions", { asked_dimensions: "goal" }],
    ["oversized asked_dimensions", { asked_dimensions: new Array(9).fill("goal") }],
    ["round zero", { round: 0 }],
    ["fractional round", { round: 1.5 }],
    ["runaway round", { round: 6 }],
  ])("rejects fail-closed: %s", (_name, actionOverrides) => {
    expect(parsePendingAction(validRow({}, actionOverrides))).toBeNull();
  });

  it("brief cap mirrors DRAFT_GRAPH_MAX_BRIEF_LENGTH (pinned mirror — fails loud on drift)", () => {
    expect(DRAFT_GRAPH_MAX_BRIEF_LENGTH).toBe(5000);
    expect(
      parsePendingAction(validRow({}, { brief: "x".repeat(DRAFT_GRAPH_MAX_BRIEF_LENGTH) })),
    ).not.toBeNull();
    expect(
      parsePendingAction(validRow({}, { brief: "x".repeat(DRAFT_GRAPH_MAX_BRIEF_LENGTH + 1) })),
    ).toBeNull();
  });
});

describe("clarify_v2_round — resumer ownership boundaries", () => {
  const pending = parsePendingAction(validRow());
  if (pending === null) throw new Error("fixture must parse");

  it("is registered resumable (parse accepts it) but NOT chip-derivable and NOT confirmation-expecting", () => {
    expect(RESUMABLE_ACTION_TYPES.has("clarify_v2_round")).toBe(true);
    expect(CHIP_DERIVABLE_ACTION_TYPES.has("clarify_v2_round")).toBe(false);
    expect(CONFIRMATION_EXPECTING_ACTION_TYPES.has("clarify_v2_round")).toBe(false);
  });

  it("is classified non_mutating (no graph exists pre-draft)", () => {
    expect(PENDING_ACTION_KIND_SAFETY.byKind.clarify_v2_round).toBe("non_mutating");
  });

  it("tryClarificationResume never claims it", () => {
    const result = tryClarificationResume({
      message: "The goal is to increase revenue",
      pendingActions: [pending],
      graphLookup: undefined,
      nowMs: NOW,
    });
    expect(result.matched).toBe(false);
  });

  it("a bare 'yes' short-confirm never resumes it through TurnExecutor synthesis", () => {
    const result = tryShortConfirmResume({
      message: "yes",
      pendingActions: [pending],
      nowMs: NOW,
      currentTurnIndex: 1,
    });
    expect(result.matched).toBe(false);
    if (result.matched === false) {
      expect(result.skip_reason).toBe("kind_not_yet_resumable");
    }
  });
});
