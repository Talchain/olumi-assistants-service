/**
 * Validate-graph evaluator adapter.
 *
 * Loads JSON fixtures from fixtures/validate-graph/, builds a request with
 * the graph + brief, and scores with validate-graph-scorer.
 *
 * Filters input graph edges to only in-scope causal/bridge edges before
 * passing to the LLM (structural and bidirected edges excluded from the
 * user payload so the model sees only edges it should estimate).
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { extractJSON } from "../json-extractor.js";
import { scoreValidateGraph } from "../validate-graph-scorer.js";
import type {
  EvaluatorAdapter,
  ValidateGraphFixture,
  LLMResponse,
  GenericScoreResult,
  GraphNode,
  GraphEdge,
} from "../types.js";

/** Returns true if this edge is a structural edge (decision→option, option→factor). */
function isStructuralEdge(nodes: GraphNode[], edge: GraphEdge): boolean {
  const fromNode = nodes.find((n) => n.id === edge.from);
  const toNode = nodes.find((n) => n.id === edge.to);
  if (!fromNode || !toNode) return false;
  return (
    (fromNode.kind === "decision" && toNode.kind === "option") ||
    (fromNode.kind === "option" && toNode.kind === "factor")
  );
}

/** Returns true if this edge is bidirected. */
function isBidirectedEdge(edge: GraphEdge): boolean {
  return edge.edge_type === "bidirected";
}

/** Filter to only in-scope edges (causal + bridge = not structural, not bidirected). */
function filterInScopeEdges(nodes: GraphNode[], edges: GraphEdge[]): GraphEdge[] {
  return edges.filter((e) => !isStructuralEdge(nodes, e) && !isBidirectedEdge(e));
}

export class ValidateGraphAdapter implements EvaluatorAdapter<ValidateGraphFixture> {
  async loadCases(dir: string): Promise<ValidateGraphFixture[]> {
    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json") && !/\s\d+\.json$/.test(f)).sort();

    const fixtures: ValidateGraphFixture[] = [];
    for (const file of jsonFiles) {
      const content = await readFile(join(dir, file), "utf-8");
      const raw = JSON.parse(content) as Record<string, unknown>;
      // Skip legacy fixtures that use flat nodes/edges instead of graph wrapper
      if (!raw.graph || !raw.expected) continue;
      fixtures.push(raw as unknown as ValidateGraphFixture);
    }
    return fixtures;
  }

  buildRequest(
    fixture: ValidateGraphFixture,
    prompt: string
  ): { system: string; user: string } {
    // Filter to only in-scope edges for the LLM payload
    const inScopeEdges = filterInScopeEdges(fixture.graph.nodes, fixture.graph.edges);

    const userPayload = JSON.stringify({
      graph: {
        nodes: fixture.graph.nodes,
        edges: fixture.graph.edges, // Full graph so model can see structure
      },
      brief: fixture.brief,
      in_scope_edge_count: inScopeEdges.length,
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
    fixture: ValidateGraphFixture,
    parsed: Record<string, unknown> | null,
    _response: LLMResponse
  ): GenericScoreResult {
    const result = scoreValidateGraph(fixture, parsed);
    return {
      overall: result.overall,
      dimensions: {
        valid_json: result.valid_json,
        edge_coverage: result.edge_coverage,
        budget_constraint: result.budget_constraint,
        uncertainty_constraint: result.uncertainty_constraint,
        basis_consistency: result.basis_consistency,
        no_zero_means: result.no_zero_means,
        differentiation: result.differentiation,
        edge_ordering: result.edge_ordering,
        precision: result.precision,
      },
    };
  }
}
