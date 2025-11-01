import Anthropic from "@anthropic-ai/sdk";
import type { DocPreview } from "../../services/docProcessing.js";
import type { GraphT, NodeT, EdgeT } from "../../schemas/graph.js";
import { log } from "../../utils/telemetry.js";

export type DraftArgs = {
  brief: string;
  docs: DocPreview[];
  seed: number;
};

type AnthropicNode = {
  id: string;
  kind: string;
  label?: string;
  body?: string;
};

type AnthropicEdge = {
  from: string;
  to: string;
  weight?: number;
  belief?: number;
  provenance?: string;
  provenance_source?: "document" | "metric" | "hypothesis";
};

type AnthropicResponse = {
  nodes: AnthropicNode[];
  edges: AnthropicEdge[];
  rationales: Array<{ target: string; why: string }>;
};

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  log.warn("ANTHROPIC_API_KEY not set, LLM calls will fail");
}

const client = new Anthropic({ apiKey: apiKey || "placeholder" });

const TIMEOUT_MS = 15000;
const MAX_NODES = 12;
const MAX_EDGES = 24;

function buildPrompt(args: DraftArgs): string {
  const docContext = args.docs.length
    ? `\n\n## Attached Documents\n${args.docs
        .map((d) => `**${d.source}** (${d.type}):\n${d.preview}`)
        .join("\n\n")}`
    : "";

  return `You are an expert at drafting small decision graphs from plain-English briefs.

## Brief
${args.brief}
${docContext}

## Your Task
Draft a small decision graph with:
- ≤${MAX_NODES} nodes (goal, decision, option, outcome)
- ≤${MAX_EDGES} edges
- Every edge with belief or weight MUST have:
  - non-empty provenance field (short quote from document, metric name, or hypothesis statement)
  - provenance_source: "document" | "metric" | "hypothesis"
- When citing documents, use short quotes (≤100 chars) from the text above
- Node IDs: lowercase with underscores (e.g., "goal_1", "opt_extend_trial")
- Stable topology: goal → decision → options → outcomes

## Output Format (JSON)
{
  "nodes": [
    { "id": "goal_1", "kind": "goal", "label": "Increase Pro upgrades" },
    { "id": "dec_1", "kind": "decision", "label": "Which levers?" },
    { "id": "opt_1", "kind": "option", "label": "Extend trial" },
    { "id": "out_upgrade", "kind": "outcome", "label": "Upgrade rate" }
  ],
  "edges": [
    {
      "from": "opt_1",
      "to": "out_upgrade",
      "belief": 0.7,
      "weight": 0.2,
      "provenance": "Trial users convert at higher rates",
      "provenance_source": "hypothesis"
    }
  ],
  "rationales": [
    { "target": "edge:opt_1::out_upgrade::0", "why": "Experiential value improves conversion" }
  ]
}

Respond ONLY with valid JSON matching this structure.`;
}

function generateSuggestedPositions(nodes: NodeT[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};

  // Simple layered layout: goals at top, decisions below, options and outcomes spread horizontally
  const goals = nodes.filter((n) => n.kind === "goal");
  const decisions = nodes.filter((n) => n.kind === "decision");
  const options = nodes.filter((n) => n.kind === "option");
  const outcomes = nodes.filter((n) => n.kind === "outcome");

  goals.forEach((n, i) => {
    positions[n.id] = { x: 400, y: 50 + i * 100 };
  });

  decisions.forEach((n, i) => {
    positions[n.id] = { x: 400, y: 200 + i * 100 };
  });

  options.forEach((n, i) => {
    positions[n.id] = { x: 200 + i * 200, y: 350 };
  });

  outcomes.forEach((n, i) => {
    positions[n.id] = { x: 200 + i * 200, y: 500 };
  });

  return positions;
}

function assignStableEdgeIds(edges: EdgeT[]): EdgeT[] {
  const edgeGroups = new Map<string, number>();

  return edges.map((edge) => {
    const key = `${edge.from}::${edge.to}`;
    const idx = edgeGroups.get(key) || 0;
    edgeGroups.set(key, idx + 1);

    return {
      ...edge,
      id: edge.id || `${edge.from}::${edge.to}::${idx}`,
    };
  });
}

function sortGraph(graph: GraphT): GraphT {
  const sortedNodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...graph.edges].sort((a, b) => {
    const fromCmp = a.from.localeCompare(b.from);
    if (fromCmp !== 0) return fromCmp;
    const toCmp = a.to.localeCompare(b.to);
    if (toCmp !== 0) return toCmp;
    return (a.id || "").localeCompare(b.id || "");
  });

  return { ...graph, nodes: sortedNodes, edges: sortedEdges };
}

export async function draftGraphWithAnthropic(
  args: DraftArgs
): Promise<{ graph: GraphT; rationales: { target: string; why: string }[] }> {
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const prompt = buildPrompt(args);

  log.info({ brief_chars: args.brief.length, doc_count: args.docs.length }, "calling Anthropic for draft");

  try {
    const response = await Promise.race([
      client.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("anthropic_timeout")), TIMEOUT_MS)
      ),
    ]);

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("unexpected_response_type");
    }

    // Extract JSON from response (handle markdown code blocks if present)
    let jsonText = content.text.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/^```json\n/, "").replace(/\n```$/, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    const parsed = JSON.parse(jsonText) as AnthropicResponse;

    // Validate and cap node/edge counts
    if (parsed.nodes.length > MAX_NODES) {
      log.warn({ count: parsed.nodes.length }, "node count exceeded, trimming");
      parsed.nodes = parsed.nodes.slice(0, MAX_NODES);
    }

    if (parsed.edges.length > MAX_EDGES) {
      log.warn({ count: parsed.edges.length }, "edge count exceeded, trimming");
      parsed.edges = parsed.edges.slice(0, MAX_EDGES);
    }

    // Filter edges to only valid node IDs
    const nodeIds = new Set(parsed.nodes.map((n) => n.id));
    const validEdges = parsed.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

    // Assign stable edge IDs
    const edgesWithIds = assignStableEdgeIds(
      validEdges.map((e) => ({
        from: e.from,
        to: e.to,
        weight: e.weight,
        belief: e.belief,
        provenance: e.provenance,
        provenance_source: e.provenance_source,
      }))
    );

    // Build graph
    const nodes: NodeT[] = parsed.nodes.map((n) => ({
      id: n.id,
      kind: n.kind as NodeT["kind"],
      label: n.label,
      body: n.body,
    }));

    // Calculate roots and leaves
    const roots = nodes
      .filter((n) => !edgesWithIds.some((e) => e.to === n.id))
      .map((n) => n.id);
    const leaves = nodes
      .filter((n) => !edgesWithIds.some((e) => e.from === n.id))
      .map((n) => n.id);

    const graph: GraphT = sortGraph({
      version: "1",
      default_seed: args.seed,
      nodes,
      edges: edgesWithIds,
      meta: {
        roots,
        leaves,
        suggested_positions: generateSuggestedPositions(nodes),
        source: "assistant" as const,
      },
    });

    log.info(
      { nodes: graph.nodes.length, edges: graph.edges.length, roots: roots.length, leaves: leaves.length },
      "draft complete"
    );

    return {
      graph,
      rationales: parsed.rationales || [],
    };
  } catch (error) {
    if (error instanceof Error && error.message === "anthropic_timeout") {
      log.error("Anthropic call timed out after 15s");
      throw error;
    }
    log.error({ error }, "Anthropic call failed");
    throw error;
  }
}

export async function suggestOptionsWithAnthropic(args: {
  goal: string;
  constraints?: Record<string, unknown>;
  existingOptions?: string[];
}): Promise<Array<{ id: string; title: string; pros: string[]; cons: string[]; evidence_to_gather: string[] }>> {
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const existingContext = args.existingOptions?.length
    ? `\n\n## Existing Options\nAvoid duplicating these:\n${args.existingOptions.map((o) => `- ${o}`).join("\n")}`
    : "";

  const constraintsContext = args.constraints
    ? `\n\n## Constraints\n${JSON.stringify(args.constraints, null, 2)}`
    : "";

  const prompt = `You are an expert at generating strategic options for decisions.

## Goal
${args.goal}
${constraintsContext}${existingContext}

## Your Task
Generate 3-5 distinct, actionable options. For each option provide:
- id: short lowercase identifier (e.g., "extend_trial", "in_app_nudges")
- title: concise name (3-8 words)
- pros: 2-3 advantages
- cons: 2-3 disadvantages or risks
- evidence_to_gather: 2-3 data points or metrics to collect

## Output Format (JSON)
{
  "options": [
    {
      "id": "extend_trial",
      "title": "Extend free trial period",
      "pros": ["Experiential value", "Low dev cost"],
      "cons": ["Cost exposure", "Expiry dip risk"],
      "evidence_to_gather": ["Trial→upgrade funnel", "Usage lift during trial"]
    }
  ]
}

Respond ONLY with valid JSON.`;

  try {
    const response = await Promise.race([
      client.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2048,
        temperature: 0.7,
        messages: [{ role: "user", content: prompt }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("anthropic_timeout")), TIMEOUT_MS)
      ),
    ]);

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("unexpected_response_type");
    }

    let jsonText = content.text.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/^```json\n/, "").replace(/\n```$/, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    const parsed = JSON.parse(jsonText) as { options: Array<{ id: string; title: string; pros: string[]; cons: string[]; evidence_to_gather: string[] }> };

    // Ensure 3-5 options
    if (parsed.options.length < 3) {
      log.warn({ count: parsed.options.length }, "too few options, padding");
      // This shouldn't happen, but add a fallback
    }
    if (parsed.options.length > 5) {
      log.warn({ count: parsed.options.length }, "too many options, trimming");
      parsed.options = parsed.options.slice(0, 5);
    }

    return parsed.options;
  } catch (error) {
    if (error instanceof Error && error.message === "anthropic_timeout") {
      log.error("Anthropic call timed out after 15s");
      throw error;
    }
    log.error({ error }, "Anthropic suggest-options call failed");
    throw error;
  }
}
