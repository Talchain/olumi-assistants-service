import { describe, it, expect } from "vitest";
import {
  createGraphPatchBlock,
  createFactBlock,
  createReviewCardBlock,
  createBriefBlock,
  createCommentaryBlock,
  createFramingBlock,
} from "../../../src/orchestrator/blocks/factory.js";

describe("Block Factory", () => {
  const turnId = "test-turn-123";

  // =========================================================================
  // Deterministic IDs
  // =========================================================================
  describe("deterministic IDs", () => {
    it("produces stable ID for same GraphPatchBlock input", () => {
      const data = {
        patch_type: "full_draft" as const,
        operations: [{ op: "add_node" as const, path: "/nodes/n1", value: { id: "n1" } }],
        status: "proposed" as const,
      };

      const block1 = createGraphPatchBlock(data, turnId);
      const block2 = createGraphPatchBlock(data, turnId);
      expect(block1.block_id).toBe(block2.block_id);
    });

    it("produces different ID for different operations", () => {
      const data1 = {
        patch_type: "full_draft" as const,
        operations: [{ op: "add_node" as const, path: "/nodes/n1", value: { id: "n1" } }],
        status: "proposed" as const,
      };
      const data2 = {
        patch_type: "full_draft" as const,
        operations: [{ op: "add_node" as const, path: "/nodes/n2", value: { id: "n2" } }],
        status: "proposed" as const,
      };

      const block1 = createGraphPatchBlock(data1, turnId);
      const block2 = createGraphPatchBlock(data2, turnId);
      expect(block1.block_id).not.toBe(block2.block_id);
    });

    it("GraphPatchBlock ID excludes status and summary", () => {
      const data1 = {
        patch_type: "edit" as const,
        operations: [{ op: "add_node" as const, path: "/nodes/n1", value: { id: "n1" } }],
        status: "proposed" as const,
        summary: "Added node",
      };
      const data2 = {
        patch_type: "edit" as const,
        operations: [{ op: "add_node" as const, path: "/nodes/n1", value: { id: "n1" } }],
        status: "accepted" as const,
        summary: "Different summary",
      };

      const block1 = createGraphPatchBlock(data1, turnId);
      const block2 = createGraphPatchBlock(data2, turnId);
      // Should be same since ops are the same (status/summary excluded from hash)
      expect(block1.block_id).toBe(block2.block_id);
    });

    it("FactBlock ID is deterministic from fact_type + facts", () => {
      const data = { fact_type: "option_comparison", facts: [{ label: "A", prob: 0.6 }] };
      const block1 = createFactBlock(data, turnId, "hash1", 42);
      const block2 = createFactBlock(data, turnId, "hash1", 42);
      expect(block1.block_id).toBe(block2.block_id);
    });

    it("FactBlock ID changes with different facts", () => {
      const data1 = { fact_type: "option_comparison", facts: [{ label: "A", prob: 0.6 }] };
      const data2 = { fact_type: "option_comparison", facts: [{ label: "B", prob: 0.4 }] };
      const block1 = createFactBlock(data1, turnId);
      const block2 = createFactBlock(data2, turnId);
      expect(block1.block_id).not.toBe(block2.block_id);
    });

    it("ReviewCardBlock ID is deterministic from card content", () => {
      const card = { title: "Evidence Priority", items: ["item1"] };
      const block1 = createReviewCardBlock(card, turnId);
      const block2 = createReviewCardBlock(card, turnId);
      expect(block1.block_id).toBe(block2.block_id);
    });

    it("BriefBlock ID is deterministic from brief content", () => {
      const brief = { recommendation: "Choose option A", reasons: ["low cost"] };
      const block1 = createBriefBlock(brief, turnId);
      const block2 = createBriefBlock(brief, turnId);
      expect(block1.block_id).toBe(block2.block_id);
    });
  });

  // =========================================================================
  // Ephemeral IDs
  // =========================================================================
  describe("ephemeral IDs", () => {
    it("CommentaryBlock produces unique IDs", () => {
      const block1 = createCommentaryBlock("text1", turnId, "tool:explain");
      const block2 = createCommentaryBlock("text1", turnId, "tool:explain");
      expect(block1.block_id).not.toBe(block2.block_id);
    });

    it("FramingBlock produces unique IDs", () => {
      const block1 = createFramingBlock("frame", turnId, "goal");
      const block2 = createFramingBlock("frame", turnId, "goal");
      expect(block1.block_id).not.toBe(block2.block_id);
    });
  });

  // =========================================================================
  // Block ID Format
  // =========================================================================
  describe("block ID format", () => {
    it("follows blk_<type>_<16-char-hex> format", () => {
      const graphBlock = createGraphPatchBlock(
        { patch_type: "full_draft", operations: [], status: "proposed" },
        turnId,
      );
      expect(graphBlock.block_id).toMatch(/^blk_graph_patch_[0-9a-f]{16}$/);

      const factBlock = createFactBlock({ fact_type: "test", facts: [] }, turnId);
      expect(factBlock.block_id).toMatch(/^blk_fact_[0-9a-f]{16}$/);

      const commentaryBlock = createCommentaryBlock("text", turnId, "trigger");
      expect(commentaryBlock.block_id).toMatch(/^blk_commentary_[0-9a-f]{16}$/);

      const framingBlock = createFramingBlock("frame", turnId);
      expect(framingBlock.block_id).toMatch(/^blk_framing_[0-9a-f]{16}$/);

      const reviewBlock = createReviewCardBlock({ card: true }, turnId);
      expect(reviewBlock.block_id).toMatch(/^blk_review_card_[0-9a-f]{16}$/);

      const briefBlock = createBriefBlock({ brief: true }, turnId);
      expect(briefBlock.block_id).toMatch(/^blk_brief_[0-9a-f]{16}$/);
    });
  });

  // =========================================================================
  // Block Type and Provenance
  // =========================================================================
  describe("block type and provenance", () => {
    it("sets correct block_type", () => {
      expect(createGraphPatchBlock({ patch_type: "full_draft", operations: [], status: "proposed" }, turnId).block_type).toBe("graph_patch");
      expect(createFactBlock({ fact_type: "test", facts: [] }, turnId).block_type).toBe("fact");
      expect(createCommentaryBlock("text", turnId, "trigger").block_type).toBe("commentary");
      expect(createFramingBlock("ideate", turnId).block_type).toBe("framing");
      expect(createReviewCardBlock({}, turnId).block_type).toBe("review_card");
      expect(createBriefBlock({}, turnId).block_type).toBe("brief");
    });

    it("sets provenance with turn_id and timestamp", () => {
      const block = createFactBlock({ fact_type: "test", facts: [] }, turnId);
      expect(block.provenance.turn_id).toBe(turnId);
      expect(block.provenance.timestamp).toBeDefined();
      expect(new Date(block.provenance.timestamp).getTime()).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Hash stability: array order preserved, key order normalised
  // =========================================================================
  describe("hash stability", () => {
    it("preserves operation array order in GraphPatchBlock hash", () => {
      const ops1 = [
        { op: "add_node" as const, path: "/nodes/n1", value: { id: "n1" } },
        { op: "add_node" as const, path: "/nodes/n2", value: { id: "n2" } },
      ];
      const ops2 = [
        { op: "add_node" as const, path: "/nodes/n2", value: { id: "n2" } },
        { op: "add_node" as const, path: "/nodes/n1", value: { id: "n1" } },
      ];

      const block1 = createGraphPatchBlock({ patch_type: "full_draft", operations: ops1, status: "proposed" }, turnId);
      const block2 = createGraphPatchBlock({ patch_type: "full_draft", operations: ops2, status: "proposed" }, turnId);
      // Different order → different hash (array order is preserved)
      expect(block1.block_id).not.toBe(block2.block_id);
    });

    it("normalises key order within objects (sorted keys)", () => {
      const fact1 = { fact_type: "test", facts: [{ z_field: 1, a_field: 2 }] };
      const fact2 = { fact_type: "test", facts: [{ a_field: 2, z_field: 1 }] };

      const block1 = createFactBlock(fact1, turnId);
      const block2 = createFactBlock(fact2, turnId);
      // Same content, different key order → same hash (keys are sorted)
      expect(block1.block_id).toBe(block2.block_id);
    });
  });
});
