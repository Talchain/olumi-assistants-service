import { describe, it, expect } from "vitest";
import { StreamingEnvelopeStripper } from "../../../../src/orchestrator/pipeline/streaming-xml-stripper.js";

describe("StreamingEnvelopeStripper", () => {
  it("strips envelope tags from a single complete delta", () => {
    const stripper = new StreamingEnvelopeStripper();
    const result = stripper.process("<response><assistant_text>Hello world</assistant_text></response>");
    const flushed = stripper.flush();
    expect((result + flushed).trim()).toBe("Hello world");
  });

  it("strips tags split across multiple deltas", () => {
    const stripper = new StreamingEnvelopeStripper();
    const deltas = ["<respon", "se><assistant_te", "xt>Here are four options</assis", "tant_text></response>"];
    let output = "";
    for (const d of deltas) {
      output += stripper.process(d);
    }
    output += stripper.flush();
    expect(output.trim()).toBe("Here are four options");
  });

  it("suppresses diagnostics content entirely", () => {
    const stripper = new StreamingEnvelopeStripper();
    const input = "<diagnostics>Mode: INTERPRET. Stage: IDEATE.</diagnostics><response><assistant_text>Visible text</assistant_text></response>";
    let output = "";
    // Feed in small chunks to test streaming
    for (let i = 0; i < input.length; i += 10) {
      output += stripper.process(input.substring(i, i + 10));
    }
    output += stripper.flush();
    expect(output.trim()).toBe("Visible text");
    expect(output).not.toContain("Mode:");
    expect(output).not.toContain("INTERPRET");
  });

  it("suppresses blocks section (artefact HTML)", () => {
    const stripper = new StreamingEnvelopeStripper();
    const input = [
      "<response><assistant_text>Here is a summary.</assistant_text>",
      "<blocks><block><type>artefact</type><content><h1>Big HTML</h1></content></block></blocks>",
      "</response>",
    ].join("");
    let output = "";
    for (let i = 0; i < input.length; i += 15) {
      output += stripper.process(input.substring(i, i + 15));
    }
    output += stripper.flush();
    expect(output.trim()).toBe("Here is a summary.");
    expect(output).not.toContain("<h1>");
    expect(output).not.toContain("artefact");
  });

  it("suppresses suggested_actions section", () => {
    const stripper = new StreamingEnvelopeStripper();
    const input = "<response><assistant_text>Answer</assistant_text><suggested_actions><action><label>Do X</label></action></suggested_actions></response>";
    let output = "";
    for (let i = 0; i < input.length; i += 12) {
      output += stripper.process(input.substring(i, i + 12));
    }
    output += stripper.flush();
    expect(output.trim()).toBe("Answer");
    expect(output).not.toContain("Do X");
  });

  it("handles empty deltas gracefully", () => {
    const stripper = new StreamingEnvelopeStripper();
    expect(stripper.process("")).toBe("");
    expect(stripper.flush()).toBe("");
  });

  it("passes through plain text without XML", () => {
    const stripper = new StreamingEnvelopeStripper();
    const result = stripper.process("Just plain text with no tags");
    const flushed = stripper.flush();
    expect((result + flushed).trim()).toBe("Just plain text with no tags");
  });

  it("handles partial tag at delta boundary correctly", () => {
    const stripper = new StreamingEnvelopeStripper();
    // '<' at the end — might be start of a tag
    const r1 = stripper.process("Hello <");
    // Resolves to a non-envelope tag — should pass through
    const r2 = stripper.process("b>bold");
    const r3 = stripper.flush();
    const full = r1 + r2 + r3;
    expect(full).toContain("Hello");
    expect(full).toContain("bold");
  });

  it("no XML tags reach the output", () => {
    const stripper = new StreamingEnvelopeStripper();
    const input = "<diagnostics>Mode: ACT</diagnostics><response><assistant_text>Here are four options to consider for your decision.</assistant_text><blocks><block><type>artefact</type><artefact_type>decision_matrix</artefact_type><title>Matrix</title><description>A matrix</description><content><table><tr><td>Cell</td></tr></table></content></block></blocks><suggested_actions><action><role>facilitator</role><label>Explore</label><message>Let us explore</message></action></suggested_actions></response>";
    let output = "";
    for (let i = 0; i < input.length; i += 7) {
      output += stripper.process(input.substring(i, i + 7));
    }
    output += stripper.flush();
    // Should only contain the assistant_text content
    expect(output.trim()).toBe("Here are four options to consider for your decision.");
    // No envelope tags should leak
    expect(output).not.toContain("<response>");
    expect(output).not.toContain("<assistant_text>");
    expect(output).not.toContain("<diagnostics>");
    expect(output).not.toContain("<blocks>");
    expect(output).not.toContain("<artefact_type>");
    expect(output).not.toContain("<table>");
  });

  it("suppresses bare <block> without <blocks> wrapper (P0 hardening)", () => {
    const stripper = new StreamingEnvelopeStripper();
    const input = "<response><assistant_text>Summary.</assistant_text><block><type>artefact</type><content><h1>Raw HTML</h1></content></block></response>";
    let output = "";
    for (let i = 0; i < input.length; i += 10) {
      output += stripper.process(input.substring(i, i + 10));
    }
    output += stripper.flush();
    expect(output.trim()).toBe("Summary.");
    expect(output).not.toContain("<h1>");
    expect(output).not.toContain("artefact");
    expect(output).not.toContain("Raw HTML");
  });
});
