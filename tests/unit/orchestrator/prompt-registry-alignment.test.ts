/**
 * Prompt-to-Registry Alignment Test
 *
 * Prevents silent drift between the orchestrator system prompt's <TOOLS> section
 * and the tool registry (the source of truth for LLM-visible tool definitions).
 *
 * Failure modes caught:
 * - Tool added to prompt but handler not created in registry
 * - Tool handler renamed in registry but prompt not updated
 *
 * Intentional exceptions (documented below):
 * - `undo_patch`: has a handler in dispatch.ts but is NOT in the LLM registry or
 *   the system prompt — it is a latent stub excluded by design (see registry.ts:L9).
 */

import { describe, it, expect } from "vitest";
import { getToolNames } from "../../../src/orchestrator/tools/registry.js";
import { ORCHESTRATOR_PROMPT_CF_V4 } from "../../../src/prompts/orchestrator-cf-v4.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract tool names from the prompt's <TOOLS> block.
 *
 * Each tool is listed as: `toolname — description text`
 * We match lines starting with a lowercase identifier followed by " — ".
 */
function parsePromptToolNames(prompt: string): string[] {
  // Extract content between <TOOLS> and </TOOLS>
  const toolsMatch = prompt.match(/<TOOLS>([\s\S]*?)<\/TOOLS>/);
  if (!toolsMatch) {
    return [];
  }

  const toolsSection = toolsMatch[1];

  // Match lines of the form: `toolname — ...` (em-dash delimiter)
  // Tool names are snake_case identifiers at the start of a line (after optional whitespace)
  const names: string[] = [];
  for (const line of toolsSection.split('\n')) {
    const match = line.match(/^\s*([a-z][a-z_]+)\s+—/);
    if (match) {
      names.push(match[1]);
    }
  }

  return [...new Set(names)];
}

// ============================================================================
// Tests
// ============================================================================

describe("orchestrator prompt ↔ tool registry alignment", () => {
  it("extracts tool names from the <TOOLS> section", () => {
    const promptTools = parsePromptToolNames(ORCHESTRATOR_PROMPT_CF_V4);
    // Sanity check: prompt must list at least one tool
    expect(promptTools.length).toBeGreaterThan(0);
  });

  it("every tool in the prompt exists in the registry", () => {
    const promptTools = parsePromptToolNames(ORCHESTRATOR_PROMPT_CF_V4);
    const registryTools = new Set(getToolNames());

    const promptOnlyTools = promptTools.filter((t) => !registryTools.has(t));
    expect(promptOnlyTools).toEqual([]);
  });

  it("every tool in the registry exists in the prompt", () => {
    const promptTools = new Set(parsePromptToolNames(ORCHESTRATOR_PROMPT_CF_V4));
    const registryTools = getToolNames();

    const registryOnlyTools = registryTools.filter((t) => !promptTools.has(t));
    expect(registryOnlyTools).toEqual([]);
  });

  it("bidirectional alignment — prompt and registry have the same tool set", () => {
    const promptTools = parsePromptToolNames(ORCHESTRATOR_PROMPT_CF_V4).sort();
    const registryTools = getToolNames().sort();

    expect(promptTools).toEqual(registryTools);
  });
});
