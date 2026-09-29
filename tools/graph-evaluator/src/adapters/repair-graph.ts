/**
 * Repair-graph evaluator adapter.
 *
 * Loads JSON fixtures from fixtures/repair-graph/, builds a request with
 * the broken graph + violation list, and scores with repair-graph-scorer.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { extractJSON } from "../json-extractor.js";
import { scoreRepairGraph } from "../repair-graph-scorer.js";
import type {
  EvaluatorAdapter,
  RepairGraphFixture,
  LLMResponse,
  GenericScoreResult,
} from "../types.js";

export class RepairGraphAdapter implements EvaluatorAdapter<RepairGraphFixture> {
  async loadCases(dir: string): Promise<RepairGraphFixture[]> {
    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json") && !/\s\d+\.json$/.test(f)).sort();

    const fixtures: RepairGraphFixture[] = [];
    for (const file of jsonFiles) {
      const content = await readFile(join(dir, file), "utf-8");
      const fixture = JSON.parse(content) as RepairGraphFixture;
      fixtures.push(fixture);
    }
    return fixtures;
  }

  buildRequest(
    fixture: RepairGraphFixture,
    prompt: string
  ): { system: string; user: string } {
    const userPayload = JSON.stringify({
      graph: fixture.graph,
      violations: fixture.violations,
      ...(fixture.brief ? { brief: fixture.brief } : {}),
    });
    return { system: prompt, user: userPayload };
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
    fixture: RepairGraphFixture,
    parsed: Record<string, unknown> | null,
    response: LLMResponse
  ): GenericScoreResult {
    const rawText = response.raw_text ?? "";
    const result = scoreRepairGraph(fixture, parsed, rawText);
    return {
      overall: result.overall,
      dimensions: {
        valid_json: result.valid_json,
        correct_schema: result.correct_schema,
        violations_addressed: result.violations_addressed,
        ids_preserved: result.ids_preserved,
        forbidden_edges_removed: result.forbidden_edges_removed,
        required_edges_present: result.required_edges_present,
        no_bridge_edges: result.no_bridge_edges,
        bidirected_preserved: result.bidirected_preserved,
        external_prior_present: result.external_prior_present,
        inbound_sum_valid: result.inbound_sum_valid,
        no_json_comments: result.no_json_comments,
      },
    };
  }
}
