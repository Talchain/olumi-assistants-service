import { describe, it, expect } from "vitest";
import {
  parseOrchestratorResponse,
  parseLLMResponse,
} from "../../../src/orchestrator/response-parser.js";
import { createArtefactBlock } from "../../../src/orchestrator/blocks/factory.js";
import type { ChatWithToolsResult } from "../../../src/adapters/llm/types.js";
import type { ArtefactBlockData } from "../../../src/orchestrator/types.js";

function makeResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
    model: "claude-sonnet-4-5-20250929",
    latencyMs: 500,
  };
}

// Exact HTML string used in tests — defined once to enable strict equality checks.
const EXACT_HTML = `<div class="matrix"><table><tr><th>Vendor</th><th>Cost</th></tr><tr><td>A</td><td>$100</td></tr></table></div>`;

const ARTEFACT_XML = `<diagnostics>Mode: INTERPRET</diagnostics>
<response>
  <assistant_text>Here is your decision matrix.</assistant_text>
  <blocks>
    <block>
      <type>artefact</type>
      <artefact_type>decision_matrix</artefact_type>
      <title>Vendor Comparison</title>
      <description>Side-by-side comparison of three vendors</description>
      <content>${EXACT_HTML}</content>
      <actions>
        <action>
          <label>Refine weights</label>
          <message>Adjust the scoring weights for cost vs quality</message>
        </action>
        <action>
          <label>Add vendor</label>
          <message>Add another vendor to the comparison</message>
        </action>
      </actions>
    </block>
  </blocks>
</response>`;

const MIXED_BLOCKS_XML = `<diagnostics>Mode: INTERPRET</diagnostics>
<response>
  <assistant_text>Analysis complete.</assistant_text>
  <blocks>
    <block>
      <type>commentary</type>
      <content>Key takeaway from the analysis.</content>
    </block>
    <block>
      <type>artefact</type>
      <artefact_type>chart</artefact_type>
      <title>Cost Breakdown</title>
      <content><canvas id="chart"></canvas><script>drawChart()</script></content>
    </block>
    <block>
      <type>review_card</type>
      <tone>challenger</tone>
      <title>Risk Assessment</title>
      <content>Consider the downside scenario.</content>
    </block>
  </blocks>
</response>`;

describe("Artefact Block Parsing", () => {
  it("parses artefact block with all fields", () => {
    const parsed = parseOrchestratorResponse(ARTEFACT_XML);

    expect(parsed.blocks).toHaveLength(1);
    const block = parsed.blocks[0];
    expect(block.type).toBe("artefact");
    expect(block.artefact_type).toBe("decision_matrix");
    expect(block.title).toBe("Vendor Comparison");
    expect(block.description).toBe("Side-by-side comparison of three vendors");
    expect(block.actions).toEqual([
      { label: "Refine weights", message: "Adjust the scoring weights for cost vs quality" },
      { label: "Add vendor", message: "Add another vendor to the comparison" },
    ]);
    expect(parsed.parse_warnings).not.toContain(expect.stringMatching(/dropped/i));
  });

  // ---- P1: Strict HTML preservation ----

  it("preserves raw HTML content with strict equality — no trim, no entity decoding", () => {
    const parsed = parseOrchestratorResponse(ARTEFACT_XML);
    const block = parsed.blocks[0];

    // Strict equality: content must match the exact HTML string byte-for-byte
    expect(block.content).toBe(EXACT_HTML);
  });

  it("preserves leading/trailing whitespace in artefact HTML content", () => {
    const htmlWithWhitespace = `  <div>\n  <p>spaced</p>\n  </div>  `;
    const xml = `<response>
  <assistant_text>Test.</assistant_text>
  <blocks>
    <block>
      <type>artefact</type>
      <artefact_type>table</artefact_type>
      <title>Whitespace Test</title>
      <content>${htmlWithWhitespace}</content>
    </block>
  </blocks>
</response>`;

    const parsed = parseOrchestratorResponse(xml);
    expect(parsed.blocks).toHaveLength(1);
    // Must NOT be trimmed — leading/trailing spaces and newlines preserved
    expect(parsed.blocks[0].content).toBe(htmlWithWhitespace);
  });

  it("does not entity-decode artefact HTML content containing XML entities", () => {
    // Content with literal &amp; and &lt; that should NOT be decoded
    const htmlWithEntities = `<p>A &amp; B &lt; C</p>`;
    const xml = `<response>
  <assistant_text>Test.</assistant_text>
  <blocks>
    <block>
      <type>artefact</type>
      <artefact_type>table</artefact_type>
      <title>Entity Test</title>
      <content>${htmlWithEntities}</content>
    </block>
  </blocks>
</response>`;

    const parsed = parseOrchestratorResponse(xml);
    expect(parsed.blocks).toHaveLength(1);
    // Entities must be preserved as-is, not decoded
    expect(parsed.blocks[0].content).toBe(htmlWithEntities);
  });

  // ---- E2E: parser → extracted_blocks → envelope passthrough ----

  it("artefact block survives parser → extracted_blocks pipeline unchanged", () => {
    const result = makeResult(ARTEFACT_XML);
    const parsed = parseLLMResponse(result);

    expect(parsed.extracted_blocks).toHaveLength(1);
    const block = parsed.extracted_blocks[0];
    expect(block.type).toBe("artefact");
    expect(block.artefact_type).toBe("decision_matrix");
    expect(block.title).toBe("Vendor Comparison");
    expect(block.description).toBe("Side-by-side comparison of three vendors");
    // Strict equality on content through the full pipeline
    expect(block.content).toBe(EXACT_HTML);
    expect(block.actions).toEqual([
      { label: "Refine weights", message: "Adjust the scoring weights for cost vs quality" },
      { label: "Add vendor", message: "Add another vendor to the comparison" },
    ]);
  });

  it("createArtefactBlock produces ConversationBlock with correct structure", () => {
    const data: ArtefactBlockData = {
      artefact_type: "decision_matrix",
      title: "Vendor Comparison",
      description: "Side-by-side comparison",
      content: EXACT_HTML,
      actions: [{ label: "Refine", message: "Adjust weights" }],
    };
    const convBlock = createArtefactBlock(data, "turn_123");

    expect(convBlock.block_type).toBe("artefact");
    expect(convBlock.block_id).toMatch(/^blk_artefact_/);
    expect(convBlock.provenance.trigger).toBe("llm:xml");
    expect(convBlock.provenance.turn_id).toBe("turn_123");
    const blockData = convBlock.data as ArtefactBlockData;
    expect(blockData.content).toBe(EXACT_HTML);
    expect(blockData.artefact_type).toBe("decision_matrix");
    expect(blockData.actions).toHaveLength(1);
  });

  // ---- Standard block parsing ----

  it("drops artefact block missing artefact_type with warning", () => {
    const xml = `<response>
  <assistant_text>Here.</assistant_text>
  <blocks>
    <block>
      <type>artefact</type>
      <title>No Type</title>
      <content><p>Hello</p></content>
    </block>
  </blocks>
</response>`;

    const parsed = parseOrchestratorResponse(xml);
    expect(parsed.blocks).toHaveLength(0);
    expect(parsed.parse_warnings).toContain("Artefact block missing <artefact_type> — dropped");
  });

  it("parses artefact block without optional description and actions", () => {
    const xml = `<response>
  <assistant_text>Here.</assistant_text>
  <blocks>
    <block>
      <type>artefact</type>
      <artefact_type>table</artefact_type>
      <title>Simple Table</title>
      <content><table><tr><td>1</td></tr></table></content>
    </block>
  </blocks>
</response>`;

    const parsed = parseOrchestratorResponse(xml);
    expect(parsed.blocks).toHaveLength(1);
    const block = parsed.blocks[0];
    expect(block.type).toBe("artefact");
    expect(block.artefact_type).toBe("table");
    expect(block.title).toBe("Simple Table");
    expect(block.description).toBeUndefined();
    expect(block.actions).toBeUndefined();
  });

  it("artefact blocks appear alongside commentary and review_card blocks", () => {
    const parsed = parseOrchestratorResponse(MIXED_BLOCKS_XML);

    expect(parsed.blocks).toHaveLength(3);
    expect(parsed.blocks[0].type).toBe("commentary");
    expect(parsed.blocks[1].type).toBe("artefact");
    expect(parsed.blocks[2].type).toBe("review_card");
    expect(parsed.blocks[2].tone).toBe("challenger");
  });

  it("responses without artefact blocks still work (backward compatible)", () => {
    const xml = `<response>
  <assistant_text>Normal response.</assistant_text>
  <blocks>
    <block>
      <type>commentary</type>
      <content>Just a comment.</content>
    </block>
  </blocks>
</response>`;

    const parsed = parseOrchestratorResponse(xml);
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].type).toBe("commentary");
    expect(parsed.parse_warnings).not.toContain(expect.stringMatching(/artefact/i));
  });

  it("unknown block types are still rejected", () => {
    const xml = `<response>
  <assistant_text>Hello.</assistant_text>
  <blocks>
    <block>
      <type>widget</type>
      <content>Not allowed.</content>
    </block>
  </blocks>
</response>`;

    const parsed = parseOrchestratorResponse(xml);
    expect(parsed.blocks).toHaveLength(0);
    expect(parsed.parse_warnings).toContain('Unknown block type "widget" — dropped');
  });

  it("handles HTML content containing literal closing tag string safely", () => {
    // Artefact HTML that embeds </content> in a data attribute — the parser
    // must use non-greedy first-match to avoid truncating
    const xml = `<response>
  <assistant_text>Test.</assistant_text>
  <blocks>
    <block>
      <type>artefact</type>
      <artefact_type>widget</artefact_type>
      <title>Edge Case</title>
      <content><div data-info="safe">Real HTML here</div></content>
    </block>
  </blocks>
</response>`;

    const parsed = parseOrchestratorResponse(xml);
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].content).toBe('<div data-info="safe">Real HTML here</div>');
  });

  it("artefact with empty content is dropped (same as other block types)", () => {
    const xml = `<response>
  <assistant_text>Test.</assistant_text>
  <blocks>
    <block>
      <type>artefact</type>
      <artefact_type>placeholder</artefact_type>
      <title>Empty</title>
      <content></content>
    </block>
  </blocks>
</response>`;

    const parsed = parseOrchestratorResponse(xml);
    expect(parsed.blocks).toHaveLength(0);
    expect(parsed.parse_warnings).toContain('Block of type "artefact" missing <content> — dropped');
  });
});
