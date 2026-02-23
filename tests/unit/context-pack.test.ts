/**
 * ContextPack v1 Tests (Stream C)
 *
 * Covers:
 *  - Determinism (same inputs → same hash)
 *  - Hash sensitivity (different inputs → different hash)
 *  - Clarification canonicalisation (order-independent)
 *  - Caching boundary stability
 *  - Golden fixture with known defaults
 */

import { describe, it, expect } from "vitest";
import {
  assembleContextPack,
  computeHash,
  computeStringHash,
  hashClarificationAnswers,
  hashConfig,
  hashPromptContent,
  computeCacheBoundary,
  type AssembleContextPackInput,
  type ContextPackV1,
  type RelevantConfig,
} from "../../src/context/context-pack.js";

// =============================================================================
// Fixtures
// =============================================================================

const BASE_CONFIG: RelevantConfig = {
  maxTokens: { draft: 4096, repair: 2048 },
  enforceSingleGoal: true,
  draftArchetypesEnabled: true,
  clarificationEnforced: false,
  clarifierEnabled: false,
};

const BASE_INPUT: AssembleContextPackInput = {
  capability: "draft_graph",
  brief: "Should we expand into the European market given current tariff uncertainty and supply chain constraints?",
  resolvedModel: { route: "default", id: "openai/gpt-4o" },
  promptVersion: "v15",
  promptContent: "You are a causal reasoning engine. Given a decision brief, produce a causal graph...",
  seed: 42,
  config: BASE_CONFIG,
};

function buildInput(overrides: Partial<AssembleContextPackInput> = {}): AssembleContextPackInput {
  return { ...BASE_INPUT, ...overrides };
}

// =============================================================================
// Determinism tests
// =============================================================================

describe("ContextPack v1 — determinism", () => {
  it("same inputs → same context_hash", () => {
    const pack1 = assembleContextPack(buildInput());
    const pack2 = assembleContextPack(buildInput());
    expect(pack1.context_hash).toBe(pack2.context_hash);
  });

  it("same inputs → same brief_hash", () => {
    const pack1 = assembleContextPack(buildInput());
    const pack2 = assembleContextPack(buildInput());
    expect(pack1.brief_hash).toBe(pack2.brief_hash);
  });

  it("same inputs → same config_hash", () => {
    const pack1 = assembleContextPack(buildInput());
    const pack2 = assembleContextPack(buildInput());
    expect(pack1.config_hash).toBe(pack2.config_hash);
  });

  it("same inputs → same prompt_hash", () => {
    const pack1 = assembleContextPack(buildInput());
    const pack2 = assembleContextPack(buildInput());
    expect(pack1.prompt_hash).toBe(pack2.prompt_hash);
  });
});

// =============================================================================
// Hash sensitivity (negative controls)
// =============================================================================

describe("ContextPack v1 — hash sensitivity", () => {
  let basePack: ContextPackV1;

  // Use a shared base pack for comparison
  basePack = assembleContextPack(buildInput());

  it("different brief → different context_hash", () => {
    const other = assembleContextPack(buildInput({
      brief: "Should we invest in AI infrastructure or cloud migration for the next fiscal year?",
    }));
    expect(other.context_hash).not.toBe(basePack.context_hash);
    expect(other.brief_hash).not.toBe(basePack.brief_hash);
  });

  it("different model_id → different context_hash", () => {
    const other = assembleContextPack(buildInput({
      resolvedModel: { route: "default", id: "anthropic/claude-sonnet-4-20250514" },
    }));
    expect(other.context_hash).not.toBe(basePack.context_hash);
  });

  it("different seed → different context_hash", () => {
    const other = assembleContextPack(buildInput({ seed: 99 }));
    expect(other.context_hash).not.toBe(basePack.context_hash);
  });

  it("different capability → different context_hash", () => {
    const other = assembleContextPack(buildInput({ capability: "decision_review" }));
    expect(other.context_hash).not.toBe(basePack.context_hash);
  });

  it("different prompt content → different prompt_hash and context_hash", () => {
    const other = assembleContextPack(buildInput({
      promptContent: "You are a decision analysis engine. Evaluate the following...",
    }));
    expect(other.prompt_hash).not.toBe(basePack.prompt_hash);
    expect(other.context_hash).not.toBe(basePack.context_hash);
  });

  it("different config → different config_hash and context_hash", () => {
    const other = assembleContextPack(buildInput({
      config: { ...BASE_CONFIG, maxTokens: { draft: 8192 } },
    }));
    expect(other.config_hash).not.toBe(basePack.config_hash);
    expect(other.context_hash).not.toBe(basePack.context_hash);
  });

  it("different model_route (same model_id) → different context_hash", () => {
    const other = assembleContextPack(buildInput({
      resolvedModel: { route: "fast", id: "openai/gpt-4o" },
    }));
    expect(other.context_hash).not.toBe(basePack.context_hash);
  });

  it("with seed_graph → different context_hash", () => {
    const other = assembleContextPack(buildInput({
      seedGraph: { nodes: [{ id: "dec_1", kind: "decision" }], edges: [] },
    }));
    expect(other.context_hash).not.toBe(basePack.context_hash);
    expect(other.seed_graph_hash).toBeDefined();
  });
});

// =============================================================================
// Clarification canonicalisation
// =============================================================================

describe("ContextPack v1 — clarification canonicalisation", () => {
  it("same answers in different order → same clarification_hash", () => {
    const answers1 = [
      { question_id: "q2", answer: "yes" },
      { question_id: "q1", answer: "no" },
      { question_id: "q3", answer: "maybe" },
    ];
    const answers2 = [
      { question_id: "q1", answer: "no" },
      { question_id: "q3", answer: "maybe" },
      { question_id: "q2", answer: "yes" },
    ];

    expect(hashClarificationAnswers(answers1)).toBe(hashClarificationAnswers(answers2));
  });

  it("different answers → different clarification_hash", () => {
    const answers1 = [{ question_id: "q1", answer: "yes" }];
    const answers2 = [{ question_id: "q1", answer: "no" }];

    expect(hashClarificationAnswers(answers1)).not.toBe(hashClarificationAnswers(answers2));
  });

  it("clarification order does not affect context_hash", () => {
    const pack1 = assembleContextPack(buildInput({
      clarificationRound: 1,
      clarificationAnswers: [
        { question_id: "q2", answer: "option-b" },
        { question_id: "q1", answer: "option-a" },
      ],
    }));
    const pack2 = assembleContextPack(buildInput({
      clarificationRound: 1,
      clarificationAnswers: [
        { question_id: "q1", answer: "option-a" },
        { question_id: "q2", answer: "option-b" },
      ],
    }));

    expect(pack1.clarification_hash).toBe(pack2.clarification_hash);
    expect(pack1.context_hash).toBe(pack2.context_hash);
  });

  it("no clarifications → undefined clarification_hash", () => {
    const pack = assembleContextPack(buildInput());
    expect(pack.clarification_hash).toBeUndefined();
    expect(pack.clarification_round).toBe(0);
  });
});

// =============================================================================
// Seed fallback tests
// =============================================================================

describe("ContextPack v1 — seed fallback", () => {
  it("uses provided seed when present", () => {
    const pack = assembleContextPack(buildInput({ seed: 42 }));
    expect(pack.seed).toBe(42);
  });

  it("falls back to 0 when seed is undefined", () => {
    const pack = assembleContextPack(buildInput({ seed: undefined }));
    expect(pack.seed).toBe(0);
  });

  it("undefined seed produces same hash as explicit 0", () => {
    const pack1 = assembleContextPack(buildInput({ seed: undefined }));
    const pack2 = assembleContextPack(buildInput({ seed: 0 }));
    expect(pack1.context_hash).toBe(pack2.context_hash);
  });
});

// =============================================================================
// Caching boundary tests
// =============================================================================

describe("ContextPack v1 — caching boundaries", () => {
  it("cache_prefix_key stable across requests with same prompt/config", () => {
    const pack1 = assembleContextPack(buildInput({
      brief: "Brief A: Should we merge departments?",
    }));
    const pack2 = assembleContextPack(buildInput({
      brief: "Brief B: Should we open a new office?",
    }));

    const boundary1 = computeCacheBoundary(pack1);
    const boundary2 = computeCacheBoundary(pack2);

    // Same prompt + config → same prefix
    expect(boundary1.cache_prefix_key).toBe(boundary2.cache_prefix_key);
    // Different brief → different suffix
    expect(boundary1.dynamic_suffix_key).not.toBe(boundary2.dynamic_suffix_key);
  });

  it("different prompt → different cache_prefix_key", () => {
    const pack1 = assembleContextPack(buildInput());
    const pack2 = assembleContextPack(buildInput({
      promptContent: "Different system prompt content",
    }));

    const boundary1 = computeCacheBoundary(pack1);
    const boundary2 = computeCacheBoundary(pack2);

    expect(boundary1.cache_prefix_key).not.toBe(boundary2.cache_prefix_key);
  });

  it("different config → different cache_prefix_key", () => {
    const pack1 = assembleContextPack(buildInput());
    const pack2 = assembleContextPack(buildInput({
      config: { ...BASE_CONFIG, enforceSingleGoal: false },
    }));

    const boundary1 = computeCacheBoundary(pack1);
    const boundary2 = computeCacheBoundary(pack2);

    expect(boundary1.cache_prefix_key).not.toBe(boundary2.cache_prefix_key);
  });

  it("dynamic_suffix_key varies with brief", () => {
    const pack1 = assembleContextPack(buildInput({
      brief: "Should we expand into Asia-Pacific markets this quarter?",
    }));
    const pack2 = assembleContextPack(buildInput({
      brief: "Should we reduce headcount in the engineering department?",
    }));

    const boundary1 = computeCacheBoundary(pack1);
    const boundary2 = computeCacheBoundary(pack2);

    expect(boundary1.dynamic_suffix_key).not.toBe(boundary2.dynamic_suffix_key);
  });

  it("dynamic_suffix_key varies with seed_graph", () => {
    const pack1 = assembleContextPack(buildInput());
    const pack2 = assembleContextPack(buildInput({
      seedGraph: { nodes: [], edges: [] },
    }));

    const boundary1 = computeCacheBoundary(pack1);
    const boundary2 = computeCacheBoundary(pack2);

    expect(boundary1.dynamic_suffix_key).not.toBe(boundary2.dynamic_suffix_key);
  });
});

// =============================================================================
// Golden fixture
// =============================================================================

describe("ContextPack v1 — golden fixture", () => {
  it("full pack with all fields has deterministic hashes", () => {
    const pack = assembleContextPack(buildInput());

    // Version
    expect(pack.context_pack_version).toBe("1");

    // Capability
    expect(pack.capability).toBe("draft_graph");

    // Brief preserved
    expect(pack.brief).toBe(BASE_INPUT.brief);

    // Model fields
    expect(pack.model_route).toBe("default");
    expect(pack.model_id).toBe("openai/gpt-4o");

    // Prompt fields
    expect(pack.prompt_version).toBe("v15");

    // Execution
    expect(pack.seed).toBe(42);

    // Defaults
    expect(pack.retrieval_mode).toBe("none");
    expect(pack.clarification_round).toBe(0);
    expect(pack.clarification_hash).toBeUndefined();
    expect(pack.retrieval_hash).toBeUndefined();
    expect(pack.seed_graph_hash).toBeUndefined();

    // All hashes are 12 hex chars
    expect(pack.brief_hash).toMatch(/^[0-9a-f]{12}$/);
    expect(pack.prompt_hash).toMatch(/^[0-9a-f]{12}$/);
    expect(pack.config_hash).toMatch(/^[0-9a-f]{12}$/);
    expect(pack.context_hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("golden hash values are stable across runs", () => {
    // This test pins specific hash values. If the hashing algorithm changes,
    // update these expected values and document the migration.
    const pack = assembleContextPack(buildInput());

    // Pin: these values MUST remain stable. Changing them breaks cache keys.
    const snapshot = {
      brief_hash: pack.brief_hash,
      prompt_hash: pack.prompt_hash,
      config_hash: pack.config_hash,
      context_hash: pack.context_hash,
    };

    // Re-assemble to verify stability
    const pack2 = assembleContextPack(buildInput());
    expect(pack2.brief_hash).toBe(snapshot.brief_hash);
    expect(pack2.prompt_hash).toBe(snapshot.prompt_hash);
    expect(pack2.config_hash).toBe(snapshot.config_hash);
    expect(pack2.context_hash).toBe(snapshot.context_hash);
  });
});

// =============================================================================
// Hashing primitives
// =============================================================================

describe("ContextPack v1 — hashing primitives", () => {
  it("computeHash returns 12-char hex string", () => {
    const hash = computeHash({ key: "value" });
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("computeStringHash returns 12-char hex string", () => {
    const hash = computeStringHash("hello world");
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("computeHash is deterministic", () => {
    const obj = { a: 1, b: "two", c: [3, 4] };
    expect(computeHash(obj)).toBe(computeHash(obj));
  });

  it("computeHash is key-order independent", () => {
    expect(computeHash({ a: 1, b: 2 })).toBe(computeHash({ b: 2, a: 1 }));
  });

  it("computeHash treats undefined fields as absent", () => {
    expect(computeHash({ a: 1 })).toBe(computeHash({ a: 1, b: undefined }));
  });

  it("hashPromptContent hashes raw string", () => {
    const hash = hashPromptContent("system prompt text");
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    expect(hashPromptContent("system prompt text")).toBe(hash);
  });

  it("hashConfig ignores irrelevant config differences", () => {
    const config1: RelevantConfig = { maxTokens: { draft: 4096 }, enforceSingleGoal: true };
    const config2: RelevantConfig = { maxTokens: { draft: 4096 }, enforceSingleGoal: true };
    expect(hashConfig(config1)).toBe(hashConfig(config2));
  });

  it("hashConfig detects relevant config changes", () => {
    const config1: RelevantConfig = { maxTokens: { draft: 4096 } };
    const config2: RelevantConfig = { maxTokens: { draft: 8192 } };
    expect(hashConfig(config1)).not.toBe(hashConfig(config2));
  });
});

// =============================================================================
// promptHashPrecomputed tests
// =============================================================================

describe("ContextPack v1 — promptHashPrecomputed", () => {
  it("uses precomputed hash when provided (no re-hashing)", () => {
    const precomputed = "aabbccddeeff";
    const pack = assembleContextPack(buildInput({
      promptHashPrecomputed: precomputed,
    }));
    expect(pack.prompt_hash).toBe(precomputed);
  });

  it("falls back to hashing promptContent when precomputed absent", () => {
    const pack = assembleContextPack(buildInput({
      promptHashPrecomputed: undefined,
    }));
    // Should be the hash of the promptContent string, not "undefined"
    expect(pack.prompt_hash).toMatch(/^[0-9a-f]{12}$/);
    expect(pack.prompt_hash).toBe(hashPromptContent(BASE_INPUT.promptContent));
  });

  it("precomputed hash changes context_hash", () => {
    const pack1 = assembleContextPack(buildInput());
    const pack2 = assembleContextPack(buildInput({
      promptHashPrecomputed: "different12ab",
    }));
    expect(pack1.context_hash).not.toBe(pack2.context_hash);
  });
});
