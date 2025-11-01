import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { DocPreview } from "../../services/docProcessing.js";
import type { GraphT, NodeT, EdgeT } from "../../schemas/graph.js";
import { ProvenanceSource, NodeKind } from "../../schemas/graph.js";
import { log } from "../../utils/telemetry.js";

export type DraftArgs = {
  brief: string;
  docs: DocPreview[];
  seed: number;
};

// Zod schemas for Anthropic response validation
const AnthropicNode = z.object({
  id: z.string().min(1),
  kind: NodeKind,
  label: z.string().optional(),
  body: z.string().max(200).optional(),
});

const AnthropicEdge = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  weight: z.number().optional(),
  belief: z.number().min(0).max(1).optional(),
  provenance: z.string().min(1).optional(),
  provenance_source: ProvenanceSource.optional(),
});

const AnthropicDraftResponse = z.object({
  nodes: z.array(AnthropicNode),
  edges: z.array(AnthropicEdge),
  rationales: z.array(z.object({ target: z.string(), why: z.string() })).optional(),
});

const AnthropicOptionsResponse = z.object({
  options: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(3),
      pros: z.array(z.string()).min(2).max(3),
      cons: z.array(z.string()).min(2).max(3),
      evidence_to_gather: z.array(z.string()).min(2).max(3),
    })
  ),
});

const apiKey = process.env.ANTHROPIC_API_KEY;

// Lazy initialization to allow testing without API key
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required but not set");
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

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
  const prompt = buildPrompt(args);

  log.info({ brief_chars: args.brief.length, doc_count: args.docs.length }, "calling Anthropic for draft");

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);

  try {
    const apiClient = getClient();
    const response = await apiClient.messages.create(
      {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      },
      { signal: abortController.signal }
    );

    clearTimeout(timeoutId);

    const content = response.content[0];
    if (content.type !== "text") {
      log.error({ content_type: content.type }, "unexpected Anthropic response type");
      throw new Error("unexpected_response_type");
    }

    // Extract JSON from response (handle markdown code blocks if present)
    let jsonText = content.text.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/^```json\n/, "").replace(/\n```$/, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    // Parse and validate with Zod
    const rawJson = JSON.parse(jsonText);
    const parseResult = AnthropicDraftResponse.safeParse(rawJson);

    if (!parseResult.success) {
      log.error({ errors: parseResult.error.flatten() }, "Anthropic response failed schema validation");
      throw new Error("anthropic_response_invalid_schema");
    }

    const parsed = parseResult.data;

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
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === "AbortError" || abortController.signal.aborted) {
        log.error({ timeout_ms: TIMEOUT_MS }, "Anthropic call timed out and was aborted");
        throw new Error("anthropic_timeout");
      }
      if (error.message === "anthropic_response_invalid_schema") {
        log.error("Anthropic returned response that failed schema validation");
        throw error;
      }
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

IMPORTANT: Each option must be distinct. Do not duplicate existing options or create near-duplicates.

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

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);

  try {
    const apiClient = getClient();
    const response = await apiClient.messages.create(
      {
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2048,
        temperature: 0.1, // Low temperature for more deterministic output
        messages: [{ role: "user", content: prompt }],
      },
      { signal: abortController.signal }
    );

    clearTimeout(timeoutId);

    const content = response.content[0];
    if (content.type !== "text") {
      log.error({ content_type: content.type }, "unexpected Anthropic response type");
      throw new Error("unexpected_response_type");
    }

    let jsonText = content.text.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/^```json\n/, "").replace(/\n```$/, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```\n/, "").replace(/\n```$/, "");
    }

    // Parse and validate with Zod
    const rawJson = JSON.parse(jsonText);
    const parseResult = AnthropicOptionsResponse.safeParse(rawJson);

    if (!parseResult.success) {
      log.error({ errors: parseResult.error.flatten() }, "Anthropic options response failed schema validation");
      throw new Error("anthropic_response_invalid_schema");
    }

    let options = parseResult.data.options;

    // De-duplicate against existing options (case-insensitive title match)
    if (args.existingOptions?.length) {
      const existingLower = new Set(args.existingOptions.map((o) => o.toLowerCase()));
      options = options.filter((opt) => !existingLower.has(opt.title.toLowerCase()));
    }

    // De-duplicate within returned options (by ID and title)
    const seen = new Set<string>();
    options = options.filter((opt) => {
      const key = `${opt.id}::${opt.title.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Ensure 3-5 options after de-duplication
    if (options.length < 3) {
      log.warn({ count: options.length, after_dedup: true }, "too few options after de-duplication");
      // This shouldn't happen with good prompts, but log it
    }
    if (options.length > 5) {
      log.warn({ count: options.length }, "too many options, trimming");
      options = options.slice(0, 5);
    }

    return options;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === "AbortError" || abortController.signal.aborted) {
        log.error({ timeout_ms: TIMEOUT_MS }, "Anthropic suggest-options call timed out and was aborted");
        throw new Error("anthropic_timeout");
      }
      if (error.message === "anthropic_response_invalid_schema") {
        log.error("Anthropic options response failed schema validation");
        throw error;
      }
    }

    log.error({ error }, "Anthropic suggest-options call failed");
    throw error;
  }
}
