/**
 * Orchestrator prompt scorer.
 *
 * Scores LLM responses against the orchestrator system prompt (cf-v7) spec.
 * The response format is XML (not JSON), so scoring is regex/string-based.
 *
 * Dimensions:
 * - Envelope structure: diagnostics, response, assistant_text, blocks, suggested_actions
 * - Tool selection accuracy
 * - Banned terms compliance
 * - Uncertainty language
 * - Block type validity (commentary, review_card only)
 * - Suggested actions validity (max 2, proper structure)
 * - Coaching correctness
 * - Forbidden phrases
 * - Must-contain substrings
 * - XML well-formedness
 */

import type { OrchestratorFixture, OrchestratorScore } from "./types.js";

// =============================================================================
// Banned internal terms (from prompt CORE_RULES)
// =============================================================================

const BANNED_TERMS = [
  "headline_type",
  "readiness",
  "canonical_state",
  "exists_probability",
  "voi",
  "attribution_stability",
  "rank_flip_rate",
  "model_critiques",
  "elasticity",
  "factor_sensitivity",
  "recommendation_stability",
];

// =============================================================================
// Tool names the prompt defines
// =============================================================================

const VALID_TOOLS = [
  "draft_graph",
  "edit_graph",
  "run_analysis",
  "explain_results",
  "generate_brief",
  "research_topic",
];

// =============================================================================
// Valid block types
// =============================================================================

const VALID_BLOCK_TYPES = ["commentary", "review_card"];

// =============================================================================
// Helpers
// =============================================================================

/** Extract content between two XML-like tags (non-greedy, first match). */
function extractTag(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "i");
  const match = text.match(re);
  return match ? match[0] : null;
}

/** Extract inner content of a tag. */
function extractTagContent(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const match = text.match(re);
  return match ? match[1] : null;
}

/** Extract all occurrences of a tag's inner content. */
function extractAllTagContents(text: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi");
  const results: string[] = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    results.push(match[1]);
  }
  return results;
}

/**
 * Get user-facing text: assistant_text + blocks content + action labels/messages.
 * Excludes diagnostics.
 */
function getUserFacingText(raw: string): string {
  const responseBlock = extractTagContent(raw, "response") ?? "";
  return responseBlock;
}

// =============================================================================
// Main scorer
// =============================================================================

export function scoreOrchestrator(
  fixture: OrchestratorFixture,
  raw: string | null
): OrchestratorScore {
  if (!raw || raw.trim().length === 0) {
    return {
      valid_envelope: false,
      diagnostics_present: false,
      assistant_text_present: false,
      blocks_tag_present: false,
      actions_tag_present: false,
      tool_selection_correct: false,
      no_banned_terms: false,
      uncertainty_language: false,
      block_types_valid: false,
      suggested_actions_valid: false,
      coaching_correct: false,
      no_forbidden_phrases: false,
      must_contain_met: false,
      xml_well_formed: false,
      overall: 0,
    };
  }

  // ── Envelope structure ────────────────────────────────────────────────────
  const diagnosticsBlock = extractTag(raw, "diagnostics");
  const responseBlock = extractTag(raw, "response");
  const assistantText = extractTagContent(raw, "assistant_text");
  const blocksTag = extractTag(raw, "blocks");
  const actionsTag = extractTag(raw, "suggested_actions");

  const diagnostics_present = diagnosticsBlock !== null;
  const assistant_text_present = assistantText !== null && assistantText.trim().length > 0;
  const blocks_tag_present = blocksTag !== null;
  const actions_tag_present = actionsTag !== null;

  // Valid envelope: diagnostics + response with all three child tags
  const valid_envelope =
    diagnostics_present &&
    responseBlock !== null &&
    assistant_text_present &&
    blocks_tag_present &&
    actions_tag_present;

  // Check diagnostics comes before response
  const diagnosticsFirst =
    diagnostics_present &&
    responseBlock !== null &&
    raw.indexOf("<diagnostics>") < raw.indexOf("<response>");

  // ── Tool selection ────────────────────────────────────────────────────────
  const expectedTool = fixture.expected.expected_tool;
  let tool_selection_correct = true;

  if (expectedTool !== null) {
    // Check if the diagnostics or response mentions the tool
    const diagnosticsContent = extractTagContent(raw, "diagnostics") ?? "";
    const fullText = diagnosticsContent + " " + (assistantText ?? "");
    const mentionsTool = fullText.toLowerCase().includes(expectedTool.toLowerCase());

    // Also check for tool_call patterns or "Tool: <name>" in diagnostics
    const toolCallPattern = new RegExp(
      `tool[:\\s]+${expectedTool}|invoke[s]?\\s+${expectedTool}|select[s]?[:\\s]+${expectedTool}`,
      "i"
    );
    const hasToolRef = mentionsTool || toolCallPattern.test(diagnosticsContent);

    tool_selection_correct = hasToolRef;
  } else {
    // No tool expected — check that no tool is invoked
    // (Allow mentioning tools in diagnostics as "no tool needed")
    const diagnosticsContent = extractTagContent(raw, "diagnostics") ?? "";
    const noToolPhrases = ["no tool", "no tool needed", "conversational", "not invok"];
    const mentionsNoTool = noToolPhrases.some((p) =>
      diagnosticsContent.toLowerCase().includes(p)
    );
    // Also acceptable: just doesn't mention any tool action
    const mentionsToolAction = VALID_TOOLS.some((t) => {
      const pattern = new RegExp(`tool[:\\s]+${t}|invoke[s]?\\s+${t}`, "i");
      return pattern.test(diagnosticsContent);
    });
    tool_selection_correct = mentionsNoTool || !mentionsToolAction;
  }

  // ── Banned terms ──────────────────────────────────────────────────────────
  let no_banned_terms = true;
  if (fixture.expected.banned_terms_checked) {
    const userFacing = getUserFacingText(raw).toLowerCase();
    for (const term of BANNED_TERMS) {
      if (userFacing.includes(term.toLowerCase())) {
        no_banned_terms = false;
        break;
      }
    }
  }

  // ── Uncertainty language ──────────────────────────────────────────────────
  let uncertainty_language = true;
  if (fixture.expected.expects_uncertainty_language) {
    const text = (assistantText ?? "").toLowerCase();
    const blocksContent = (extractTagContent(raw, "blocks") ?? "").toLowerCase();
    const combined = text + " " + blocksContent;

    // Must have hedging phrases
    const hedgePhrases = [
      "suggests", "based on", "under this model", "current assumptions",
      "the analysis", "indicates", "appears", "likely", "may",
    ];
    const hasHedging = hedgePhrases.some((p) => combined.includes(p));

    // Must not have absolute phrases
    const absolutePhrases = ["definitely", "guaranteed", "it's impossible", "certainly will"];
    const hasAbsolute = absolutePhrases.some((p) => combined.includes(p));

    uncertainty_language = hasHedging && !hasAbsolute;
  }

  // ── Block types ───────────────────────────────────────────────────────────
  let block_types_valid = true;
  const blockTypeMatches = extractAllTagContents(raw, "type");
  // Only check types within <blocks> context
  const blocksContent = extractTagContent(raw, "blocks") ?? "";
  const blockTypesInBlocks = extractAllTagContents(blocksContent, "type");
  for (const bt of blockTypesInBlocks) {
    if (!VALID_BLOCK_TYPES.includes(bt.trim())) {
      block_types_valid = false;
      break;
    }
  }

  // ── Suggested actions ─────────────────────────────────────────────────────
  let suggested_actions_valid = true;
  const actionsContent = extractTagContent(raw, "suggested_actions") ?? "";
  const actionBlocks = extractAllTagContents(actionsContent, "action");
  const actionCount = actionBlocks.length;

  if (actionCount > fixture.expected.max_actions) {
    suggested_actions_valid = false;
  }
  if (actionCount < fixture.expected.min_actions) {
    suggested_actions_valid = false;
  }

  // Each action should have role, label, message
  for (const action of actionBlocks) {
    const hasRole = /<role>/.test(action);
    const hasLabel = /<label>/.test(action);
    const hasMessage = /<message>/.test(action);
    if (!hasRole || !hasLabel || !hasMessage) {
      suggested_actions_valid = false;
      break;
    }
  }

  // ── Coaching correctness ──────────────────────────────────────────────────
  let coaching_correct = true;
  if (fixture.expected.expects_coaching) {
    // Must have at least one review_card block
    const hasReviewCard = blocksContent.includes("<type>review_card</type>");
    coaching_correct = hasReviewCard;
  } else {
    // Not expecting coaching — review_card blocks are fine but not required
    coaching_correct = true;
  }

  // ── Forbidden phrases ─────────────────────────────────────────────────────
  let no_forbidden_phrases = true;
  if (fixture.expected.forbidden_phrases && fixture.expected.forbidden_phrases.length > 0) {
    const userFacing = getUserFacingText(raw).toLowerCase();
    for (const phrase of fixture.expected.forbidden_phrases) {
      if (userFacing.includes(phrase.toLowerCase())) {
        no_forbidden_phrases = false;
        break;
      }
    }
  }

  // ── Must-contain substrings ───────────────────────────────────────────────
  let must_contain_met = true;
  if (fixture.expected.must_contain && fixture.expected.must_contain.length > 0) {
    const userFacing = getUserFacingText(raw).toLowerCase();
    for (const substr of fixture.expected.must_contain) {
      if (!userFacing.includes(substr.toLowerCase())) {
        must_contain_met = false;
        break;
      }
    }
  }

  // ── XML well-formedness ───────────────────────────────────────────────────
  // Basic check: every opened tag has a matching close tag for the main envelope
  const requiredPairs = [
    ["<diagnostics>", "</diagnostics>"],
    ["<response>", "</response>"],
    ["<assistant_text>", "</assistant_text>"],
    ["<blocks>", "</blocks>"],
    ["<suggested_actions>", "</suggested_actions>"],
  ];
  let xml_well_formed = true;
  for (const [open, close] of requiredPairs) {
    const openCount = raw.split(open).length - 1;
    const closeCount = raw.split(close).length - 1;
    if (openCount !== closeCount) {
      xml_well_formed = false;
      break;
    }
  }
  // Also check diagnostics comes first
  if (!diagnosticsFirst) {
    xml_well_formed = false;
  }

  // ── Overall score ─────────────────────────────────────────────────────────
  const dimensions = [
    valid_envelope,
    diagnostics_present,
    assistant_text_present,
    blocks_tag_present,
    actions_tag_present,
    tool_selection_correct,
    no_banned_terms,
    uncertainty_language,
    block_types_valid,
    suggested_actions_valid,
    coaching_correct,
    no_forbidden_phrases,
    must_contain_met,
    xml_well_formed,
  ];

  // Weighted scoring — envelope and tool selection are worth more
  const weights: Record<string, number> = {
    valid_envelope: 2.0,
    diagnostics_present: 1.0,
    assistant_text_present: 1.0,
    blocks_tag_present: 1.0,
    actions_tag_present: 1.0,
    tool_selection_correct: 2.0,
    no_banned_terms: 1.5,
    uncertainty_language: 1.0,
    block_types_valid: 1.0,
    suggested_actions_valid: 1.0,
    coaching_correct: 1.5,
    no_forbidden_phrases: 1.0,
    must_contain_met: 1.0,
    xml_well_formed: 1.5,
  };

  const names = Object.keys(weights);
  let totalWeight = 0;
  let weightedScore = 0;
  for (let i = 0; i < names.length; i++) {
    const w = weights[names[i]];
    totalWeight += w;
    if (dimensions[i]) weightedScore += w;
  }

  const overall = totalWeight > 0 ? weightedScore / totalWeight : 0;

  return {
    valid_envelope,
    diagnostics_present,
    assistant_text_present,
    blocks_tag_present,
    actions_tag_present,
    tool_selection_correct,
    no_banned_terms,
    uncertainty_language,
    block_types_valid,
    suggested_actions_valid,
    coaching_correct,
    no_forbidden_phrases,
    must_contain_met,
    xml_well_formed,
    overall,
  };
}
