/**
 * Edit-graph evaluator adapter.
 *
 * Loads JSON fixtures from fixtures/edit-graph/, builds requests with
 * the graph + edit instruction, scores with edit-graph-scorer.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { extractJSON } from "../json-extractor.js";
import { scoreEditGraph } from "../edit-graph-scorer.js";
import type {
  EvaluatorAdapter,
  EditGraphFixture,
  LLMResponse,
  GenericScoreResult,
} from "../types.js";

export class EditGraphAdapter implements EvaluatorAdapter<EditGraphFixture> {
  async loadCases(dir: string): Promise<EditGraphFixture[]> {
    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();

    const fixtures: EditGraphFixture[] = [];
    for (const file of jsonFiles) {
      const content = await readFile(join(dir, file), "utf-8");
      const fixture = JSON.parse(content) as EditGraphFixture;
      fixtures.push(fixture);
    }
    return fixtures;
  }

  buildRequest(
    fixture: EditGraphFixture,
    prompt: string
  ): { system: string; user: string } {
    const userPayload = JSON.stringify({
      graph: fixture.graph,
      instruction: fixture.edit_instruction,
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
    fixture: EditGraphFixture,
    parsed: Record<string, unknown> | null,
    _response: LLMResponse
  ): GenericScoreResult {
    const result = scoreEditGraph(fixture, parsed);
    return {
      overall: result.overall,
      dimensions: {
        valid_json: result.valid_json,
        correct_shape: result.correct_shape,
        operation_types_correct: result.operation_types_correct,
        topology_compliant: result.topology_compliant,
        has_impact_rationale: result.has_impact_rationale,
        correct_ordering: result.correct_ordering,
        empty_ops_handled: result.empty_ops_handled,
        coaching_present: result.coaching_present,
        path_syntax_valid: result.path_syntax_valid,
      },
    };
  }
}
