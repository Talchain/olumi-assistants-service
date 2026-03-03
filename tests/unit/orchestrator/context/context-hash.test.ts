import { describe, it, expect } from "vitest";
import { computeContextHash } from "../../../../src/orchestrator/context/context-hash.js";
import type { HashableContext } from "../../../../src/orchestrator/context/context-hash.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeContext(overrides?: Partial<HashableContext>): HashableContext {
  return {
    messages: [],
    ...overrides,
  };
}

function makeMessage(role: 'user' | 'assistant', content: string) {
  return { role, content };
}

// ============================================================================
// Tests
// ============================================================================

describe("computeContextHash", () => {
  it("returns a 64-char lowercase hex string", () => {
    const hash = computeContextHash(makeContext());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same context → same hash", () => {
    const ctx = makeContext({
      messages: [makeMessage("user", "Hello")],
    });
    expect(computeContextHash(ctx)).toBe(computeContextHash(ctx));
  });

  it("same logical context → same hash regardless of object identity", () => {
    const ctx1 = makeContext({ messages: [makeMessage("user", "Hello")] });
    const ctx2 = makeContext({ messages: [makeMessage("user", "Hello")] });
    expect(computeContextHash(ctx1)).toBe(computeContextHash(ctx2));
  });

  it("different message content → different hash", () => {
    const h1 = computeContextHash(makeContext({ messages: [makeMessage("user", "Hello")] }));
    const h2 = computeContextHash(makeContext({ messages: [makeMessage("user", "Goodbye")] }));
    expect(h1).not.toBe(h2);
  });

  it("different message order → different hash (sequence matters)", () => {
    const h1 = computeContextHash(makeContext({
      messages: [makeMessage("user", "First"), makeMessage("assistant", "Second")],
    }));
    const h2 = computeContextHash(makeContext({
      messages: [makeMessage("assistant", "Second"), makeMessage("user", "First")],
    }));
    expect(h1).not.toBe(h2);
  });

  it("selected_elements string[] sorted — ['b','a'] and ['a','b'] → same hash", () => {
    const h1 = computeContextHash(makeContext({ selected_elements: ["b", "a"] }));
    const h2 = computeContextHash(makeContext({ selected_elements: ["a", "b"] }));
    expect(h1).toBe(h2);
  });

  it("selected_elements node_ids sorted — same hash regardless of order", () => {
    const h1 = computeContextHash(makeContext({
      selected_elements: { node_ids: ["n2", "n1"], edge_ids: [] },
    }));
    const h2 = computeContextHash(makeContext({
      selected_elements: { node_ids: ["n1", "n2"], edge_ids: [] },
    }));
    expect(h1).toBe(h2);
  });

  it("framing.constraints sorted — different order → same hash (objects)", () => {
    const h1 = computeContextHash(makeContext({
      framing: { stage: "evaluate", constraints: [{ id: "b" }, { id: "a" }] },
      messages: [],
    }));
    const h2 = computeContextHash(makeContext({
      framing: { stage: "evaluate", constraints: [{ id: "a" }, { id: "b" }] },
      messages: [],
    }));
    expect(h1).toBe(h2);
  });

  it("framing.constraints sorted — different order → same hash (primitive strings)", () => {
    const h1 = computeContextHash(makeContext({
      framing: { stage: "evaluate", constraints: ["c2", "c1"] },
      messages: [],
    }));
    const h2 = computeContextHash(makeContext({
      framing: { stage: "evaluate", constraints: ["c1", "c2"] },
      messages: [],
    }));
    expect(h1).toBe(h2);
  });

  it("framing.options sorted — different order → same hash (objects)", () => {
    const h1 = computeContextHash(makeContext({
      framing: { stage: "evaluate", options: [{ id: "opt_b" }, { id: "opt_a" }] },
      messages: [],
    }));
    const h2 = computeContextHash(makeContext({
      framing: { stage: "evaluate", options: [{ id: "opt_a" }, { id: "opt_b" }] },
      messages: [],
    }));
    expect(h1).toBe(h2);
  });

  it("framing.options sorted — different order → same hash (primitive strings)", () => {
    const h1 = computeContextHash(makeContext({
      framing: { stage: "evaluate", options: ["b", "a"] },
      messages: [],
    }));
    const h2 = computeContextHash(makeContext({
      framing: { stage: "evaluate", options: ["a", "b"] },
      messages: [],
    }));
    expect(h1).toBe(h2);
  });

  it("framing.options included — different options → different hash", () => {
    const h1 = computeContextHash(makeContext({
      framing: { stage: "evaluate", options: [{ id: "opt_a" }] },
      messages: [],
    }));
    const h2 = computeContextHash(makeContext({
      framing: { stage: "evaluate", options: [{ id: "opt_b" }] },
      messages: [],
    }));
    expect(h1).not.toBe(h2);
  });

  it("different stage → different hash", () => {
    const h1 = computeContextHash(makeContext({ framing: { stage: "frame" }, messages: [] }));
    const h2 = computeContextHash(makeContext({ framing: { stage: "evaluate" }, messages: [] }));
    expect(h1).not.toBe(h2);
  });

  it("different graph → different hash", () => {
    const h1 = computeContextHash(makeContext({
      graph: { nodes: [{ id: "n1", kind: "factor", label: "A" }], edges: [], _node_count: 1, _edge_count: 0 },
      messages: [],
    }));
    const h2 = computeContextHash(makeContext({
      graph: { nodes: [{ id: "n2", kind: "factor", label: "B" }], edges: [], _node_count: 1, _edge_count: 0 },
      messages: [],
    }));
    expect(h1).not.toBe(h2);
  });

  it("timestamps excluded — adding a timestamp field does not affect hash", () => {
    // Hash is based only on the explicit fields we pass, not extra fields on messages
    const baseCtx = makeContext({ messages: [makeMessage("user", "Hello")] });
    const h1 = computeContextHash(baseCtx);
    // Simulate a message with an extra 'timestamp' field (should not affect hash)
    const ctxWithTimestamp = makeContext({
      messages: [{ role: "user", content: "Hello", timestamp: "2026-01-01T00:00:00Z" } as never],
    });
    const h2 = computeContextHash(ctxWithTimestamp);
    expect(h1).toBe(h2);
  });

  it("client_turn_id excluded — does not affect hash", () => {
    const ctx1 = makeContext({ messages: [makeMessage("user", "Hello")] });
    const ctx2 = makeContext({
      messages: [{ role: "user", content: "Hello", client_turn_id: "abc-123" } as never],
    });
    expect(computeContextHash(ctx1)).toBe(computeContextHash(ctx2));
  });

  it("event_log_summary excluded — does not affect hash", () => {
    const h1 = computeContextHash(makeContext({ messages: [], event_log_summary: "Framing confirmed." } as HashableContext & { event_log_summary?: string }));
    const h2 = computeContextHash(makeContext({ messages: [], event_log_summary: "Something else." } as HashableContext & { event_log_summary?: string }));
    // event_log_summary is not in HashableContext, so it is excluded from hashing
    // Both should equal the hash of an empty messages context
    const h3 = computeContextHash(makeContext({ messages: [] }));
    expect(h1).toBe(h3);
    expect(h2).toBe(h3);
  });

  it("null graph → same hash as no graph", () => {
    const h1 = computeContextHash(makeContext({ graph: null, messages: [] }));
    const h2 = computeContextHash(makeContext({ messages: [] }));
    expect(h1).toBe(h2);
  });

  it("null analysis_response → same hash as no analysis_response", () => {
    const h1 = computeContextHash(makeContext({ analysis_response: null, messages: [] }));
    const h2 = computeContextHash(makeContext({ messages: [] }));
    expect(h1).toBe(h2);
  });

  it("null framing → same hash as no framing", () => {
    const h1 = computeContextHash(makeContext({ framing: null, messages: [] }));
    const h2 = computeContextHash(makeContext({ messages: [] }));
    expect(h1).toBe(h2);
  });
});
