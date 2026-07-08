/**
 * RED-first: arm-blinding is a TESTED GUARANTEE. The leak detector must fire
 * on a deliberately leaky payload before the allowlist is trusted, and the
 * allowlist projection must strip every identity/provenance channel: arm ID,
 * model names, prompt names, generation order, proposal provenance,
 * timestamps, usage and cost.
 */
import { describe, expect, it } from "vitest";
import {
  buildBlindPayload,
  buildPresentationMap,
  collectOpenQuestions,
  forbiddenTokens,
  scanForLeaks,
} from "../src/scoring/blind.ts";
import { DEFAULT_MODELS } from "../src/config.ts";
import type { RunConfig } from "../src/types.ts";
import { makeRecord, TEST_BRIEF } from "./helpers.ts";

const config: RunConfig = {
  run_id: "leaktest-run",
  arms: ["A", "B", "C", "D"],
  brief_ids: ["buy-vs-build"],
  seeds: [17],
  models: DEFAULT_MODELS,
  mock: true,
  results_dir: "/tmp/unused",
  compute_tolerance: 0.2,
};
const PROMPT_NAMES = ["arm-a.system.txt", "arm-c.m2.system.txt"];
const PROMPT_HASHES = ["cafebabe1234"];
const forbidden = forbiddenTokens(config, PROMPT_NAMES, PROMPT_HASHES);

describe("arm blinding", () => {
  it("RED: the detector fires on a deliberately leaky payload (arm id, model, prompt, run id, timestamp)", () => {
    const leaky = {
      blind_id: "B001",
      brief: TEST_BRIEF,
      arm: "C", // a real leaked field serializes as "arm":"C"
      note_model: "claude-opus-4-8",
      note_prompt: "arm-c.m2.system.txt",
      note_run: "leaktest-run",
      note_time: "2026-07-02T12:00:00Z",
    };
    const scan = scanForLeaks(leaky, forbidden);
    expect(scan.clean).toBe(false);
    expect(scan.hits).toContain('"arm":"C"');
    expect(scan.hits).toContain("claude-opus-4-8");
    expect(scan.hits).toContain("arm-c.m2.system.txt");
    expect(scan.hits).toContain("leaktest-run");
    expect(scan.hits).toContain("<iso-timestamp>");
  });

  it("the allowlist projection of a full record passes the scan", () => {
    const record = makeRecord();
    const blind = buildBlindPayload(record, TEST_BRIEF, "B001");
    const scan = scanForLeaks(blind, forbidden);
    expect(scan.hits).toEqual([]);
    expect(scan.clean).toBe(true);
  });

  it("strips provenance-bearing fields even when the candidate carries them", () => {
    const record = makeRecord();
    const candidate = record.candidate as Record<string, unknown>;
    // Adversarial candidate: provenance/origin markers and trace content that
    // could identify the arm if copied through.
    (candidate.nodes as Record<string, unknown>[])[0].provenance = "ai_inferred";
    (candidate.edges as Record<string, unknown>[])[0].origin = "enrichment";
    (candidate.edges as Record<string, unknown>[])[0].provenance = { source: "cee_hypothesis", reasoning: "from model claude-opus-4-8" };
    candidate.trace = { request_id: "req_123", engine: { model: "claude-opus-4-8" } };
    candidate.meta = { source: "assistant" };
    const blind = buildBlindPayload(record, TEST_BRIEF, "B001");
    const serialized = JSON.stringify(blind);
    expect(serialized).not.toContain("provenance");
    expect(serialized).not.toContain("origin");
    expect(serialized).not.toContain("claude-opus-4-8");
    expect(serialized).not.toContain("req_123");
    expect(serialized).not.toContain("assistant");
    expect(scanForLeaks(blind, forbidden).clean).toBe(true);
  });

  it("arm-C proposal provenance (evidence_pointer, rationale) never reaches the blind payload", () => {
    const record = makeRecord({
      arm: "C",
      arm_c: {
        proposals_raw: [{ type: "added_risk", evidence_pointer: "brief span", rationale: "because" }],
        merge: { proposals_total: 1, applied: 1, artifacts: 0, failures: [], post_merge_valid: true, post_merge_errors: [] },
      },
      artifacts: [{ type: "clarification_proposal", question: "What is the payback horizon?", rationale: "r", evidence_pointer: "e" }],
    });
    const blind = buildBlindPayload(record, TEST_BRIEF, "B002");
    const serialized = JSON.stringify(blind);
    expect(serialized).not.toContain("evidence_pointer");
    expect(serialized).not.toContain("rationale");
    // …but the QUESTION itself (genuine content) is surfaced, normalized for every arm:
    expect(blind.open_questions).toEqual(["What is the payback horizon?"]);
  });

  it("open questions are shape-identical across arms (no C-only channel)", () => {
    const armA = makeRecord();
    const candidate = armA.candidate as { options: Array<Record<string, unknown>> };
    candidate.options[0].user_questions = ["What is the payback horizon?"];
    expect(collectOpenQuestions(armA)).toEqual(["What is the payback horizon?"]);
  });

  it("presentation map is seeded, deterministic, and covers every key exactly once", () => {
    const arms = ["A", "B@match_c", "B@match_d", "C", "D"];
    const keys = arms.flatMap((arm) => [1, 2].map((seed) => ({ arm, brief_id: "b1", seed })));
    const map1 = buildPresentationMap(keys, 42);
    const map2 = buildPresentationMap(keys, 42);
    expect(map1).toEqual(map2);
    expect(new Set(map1.map((e) => e.blind_id)).size).toBe(keys.length);
    expect(new Set(map1.map((e) => `${e.arm}|${e.brief_id}|${e.seed}`)).size).toBe(keys.length);
    const map3 = buildPresentationMap(keys, 43);
    expect(map3.map((e) => `${e.arm}s${e.seed}`).join(",")).not.toBe(map1.map((e) => `${e.arm}s${e.seed}`).join(","));
  });
});
