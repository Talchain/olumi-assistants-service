/**
 * Decision-review evaluator adapter.
 *
 * Loads JSON fixtures from fixtures/decision-review/, builds requests
 * with analysis payloads, optionally injects DSK section, scores with
 * decision-review-scorer.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { extractJSON } from "../json-extractor.js";
import { scoreDecisionReview } from "../decision-review-scorer.js";
import type {
  EvaluatorAdapter,
  DecisionReviewFixture,
  LLMResponse,
  GenericScoreResult,
} from "../types.js";

// =============================================================================
// Hardcoded test DSK claims for fixture testing
// =============================================================================

const TEST_DSK_CLAIMS = [
  { claim_id: "DSK_001", protocol_id: "PROTO_001", summary: "Anchoring bias in investment estimates" },
  { claim_id: "DSK_002", protocol_id: "PROTO_002", summary: "Overconfidence in market entry success" },
  { claim_id: "DSK_003", protocol_id: "PROTO_003", summary: "Sunk cost fallacy in expansion decisions" },
  { claim_id: "DSK_004", protocol_id: "PROTO_004", summary: "Availability bias in risk assessment" },
  { claim_id: "DSK_005", protocol_id: "PROTO_005", summary: "Framing effect on competitive response" },
];

function buildScienceClaimsSection(): string {
  const claims = TEST_DSK_CLAIMS.map(
    (c) =>
      `  <claim id="${c.claim_id}" protocol="${c.protocol_id}">${c.summary}</claim>`
  ).join("\n");
  return `\n<SCIENCE_CLAIMS>\n${claims}\n</SCIENCE_CLAIMS>\n`;
}

export function getTestDskClaimIds(): Set<string> {
  return new Set(TEST_DSK_CLAIMS.map((c) => c.claim_id));
}

// =============================================================================
// Adapter
// =============================================================================

export class DecisionReviewAdapter
  implements EvaluatorAdapter<DecisionReviewFixture>
{
  async loadCases(dir: string): Promise<DecisionReviewFixture[]> {
    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();

    const fixtures: DecisionReviewFixture[] = [];
    for (const file of jsonFiles) {
      const content = await readFile(join(dir, file), "utf-8");
      const fixture = JSON.parse(content) as DecisionReviewFixture;
      fixtures.push(fixture);
    }
    return fixtures;
  }

  buildRequest(
    fixture: DecisionReviewFixture,
    prompt: string
  ): { system: string; user: string } {
    let systemPrompt = prompt;

    // Inject SCIENCE_CLAIMS section if fixture requests it
    if (fixture.inject_dsk) {
      systemPrompt += buildScienceClaimsSection();
    }

    const userPayload = JSON.stringify(fixture.input);
    return { system: systemPrompt, user: userPayload };
  }

  parseResponse(raw: string): {
    parsed: Record<string, unknown> | null;
    error?: string;
  } {
    const result = extractJSON(raw);
    if (result.parsed === null) {
      return { parsed: null, error: "No extractable JSON found in response" };
    }
    return { parsed: result.parsed as Record<string, unknown> };
  }

  score(
    fixture: DecisionReviewFixture,
    parsed: Record<string, unknown> | null,
    _response: LLMResponse
  ): GenericScoreResult {
    const dskClaimIds = fixture.inject_dsk
      ? getTestDskClaimIds()
      : undefined;
    const result = scoreDecisionReview(fixture, parsed, dskClaimIds);
    return {
      overall: result.overall,
      dimensions: {
        valid_json: result.valid_json,
        schema_complete: result.schema_complete,
        story_headlines_match: result.story_headlines_match,
        evidence_enhancements_coverage: result.evidence_enhancements_coverage,
        scenario_contexts_valid: result.scenario_contexts_valid,
        grounding_compliance: result.grounding_compliance,
        tone_alignment: result.tone_alignment,
        bias_findings_grounded: result.bias_findings_grounded,
        dsk_fields_correct: result.dsk_fields_correct,
        pre_mortem_correct: result.pre_mortem_correct,
      },
      unmatched_numbers: result.unmatched_numbers,
    };
  }
}
