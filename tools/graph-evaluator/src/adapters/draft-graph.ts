/**
 * Draft-graph evaluator adapter.
 *
 * Wraps the existing scorer and brief-loading logic behind the
 * EvaluatorAdapter interface for unified CLI support.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import matter from "gray-matter";
import { extractJSON } from "../json-extractor.js";
import { score as scoreDraftGraph } from "../scorer.js";
import type {
  EvaluatorAdapter,
  Brief,
  BriefMeta,
  LLMResponse,
  GenericScoreResult,
} from "../types.js";

export class DraftGraphAdapter implements EvaluatorAdapter<Brief> {
  async loadCases(dir: string): Promise<Brief[]> {
    const files = await readdir(dir);
    const mdFiles = files.filter((f) => f.endsWith(".md")).sort();

    const briefs: Brief[] = [];
    for (const file of mdFiles) {
      const content = await readFile(join(dir, file), "utf-8");
      const parsed = matter(content);
      const id = basename(file, ".md");
      const meta: BriefMeta = {
        expect_status_quo: Boolean(parsed.data["expect_status_quo"] ?? true),
        has_numeric_target: Boolean(parsed.data["has_numeric_target"] ?? false),
        complexity:
          (parsed.data["complexity"] as BriefMeta["complexity"]) ?? "simple",
      };
      briefs.push({ id, meta, body: parsed.content.trim() });
    }
    return briefs;
  }

  buildRequest(
    fixture: Brief,
    prompt: string
  ): { system: string; user: string } {
    return { system: prompt, user: fixture.body };
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
    fixture: Brief,
    parsed: Record<string, unknown> | null,
    response: LLMResponse
  ): GenericScoreResult {
    const result = scoreDraftGraph(response, fixture);
    return {
      overall: result.overall_score,
      dimensions: {
        structural_valid: result.structural_valid,
        param_quality: result.param_quality,
        option_diff: result.option_diff,
        completeness: result.completeness,
      },
      parse_error: response.failure_code === "parse_failed"
        ? response.error_message ?? "Parse failed"
        : undefined,
    };
  }
}
