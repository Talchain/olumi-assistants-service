import type { GraphV1 } from "../../contracts/plot/engine.js";
import { emit, log, TelemetryEvents } from "../../utils/telemetry.js";
import { buildAnswerIncorporationPrompt } from "./prompts.js";
import { retrieveQuestion } from "./question-cache.js";
import type { LLMAdapter, CallOpts } from "../../adapters/llm/types.js";
import { getAdapter } from "../../adapters/llm/router.js";
import { randomUUID } from "node:crypto";

export interface AnswerProcessorInput {
  graph: GraphV1;
  brief: string;
  clarifier_response: {
    question_id: string;
    answer: string;
  };
  conversation_history?: Array<{
    question_id: string;
    question: string;
    answer: string;
  }>;
  requestId?: string;
}

export interface AnswerProcessorOutput {
  refined_graph: GraphV1;
  changes_made: boolean;
  reasoning?: string;
  error?: string;
}

interface GraphPatch {
  adds: { nodes: any[]; edges: any[] };
  updates: any[];
  removes: any[];
}

function computeGraphPatch(
  original: GraphV1,
  refined: GraphV1
): GraphPatch {
  const patch: GraphPatch = {
    adds: { nodes: [], edges: [] },
    updates: [],
    removes: [],
  };

  const originalNodeIds = new Set(
    (original.nodes ?? []).map((n: any) => n.id as string)
  );
  const refinedNodeIds = new Set(
    (refined.nodes ?? []).map((n: any) => n.id as string)
  );

  // Find added nodes
  for (const node of refined.nodes ?? []) {
    if (!originalNodeIds.has((node as any).id)) {
      patch.adds.nodes.push(node);
    }
  }

  // Find removed nodes
  for (const node of original.nodes ?? []) {
    if (!refinedNodeIds.has((node as any).id)) {
      patch.removes.push({ type: "node", id: (node as any).id });
    }
  }

  // Similar for edges
  const originalEdges = ((original as any).edges ?? []) as any[];
  const refinedEdges = ((refined as any).edges ?? []) as any[];

  const originalEdgeSet = new Set(
    originalEdges.map((e: any) => `${e.from}->${e.to}`)
  );
  const refinedEdgeSet = new Set(
    refinedEdges.map((e: any) => `${e.from}->${e.to}`)
  );

  for (const edge of refinedEdges) {
    const key = `${edge.from}->${edge.to}`;
    if (!originalEdgeSet.has(key)) {
      patch.adds.edges.push(edge);
    }
  }

  for (const edge of originalEdges) {
    const key = `${edge.from}->${edge.to}`;
    if (!refinedEdgeSet.has(key)) {
      patch.removes.push({ type: "edge", from: edge.from, to: edge.to });
    }
  }

  return patch;
}

function hasSignificantChanges(patch: GraphPatch): boolean {
  return (
    patch.adds.nodes.length > 0 ||
    patch.adds.edges.length > 0 ||
    patch.removes.length > 0
  );
}

export async function incorporateAnswer(
  input: AnswerProcessorInput
): Promise<AnswerProcessorOutput> {
  const {
    graph,
    brief,
    clarifier_response,
    conversation_history = [],
    requestId = randomUUID(),
  } = input;

  const startTime = Date.now();

  // Retrieve the cached question
  const cachedQuestion = await retrieveQuestion(clarifier_response.question_id);

  if (!cachedQuestion) {
    log.warn(
      { question_id: clarifier_response.question_id, request_id: requestId },
      "Question not found in cache, cannot incorporate answer"
    );
    return {
      refined_graph: graph,
      changes_made: false,
      error: "Question not found in cache - it may have expired",
    };
  }

  // Build conversation history for prompt
  const historyForPrompt = conversation_history.map((h) => ({
    question: h.question,
    answer: h.answer,
  }));

  try {
    // Get LLM adapter (Fix 1.3: use correct task ID for model routing)
    const adapter = getAdapter("draft_graph") as LLMAdapter;

    // Build the enhanced brief with answer incorporation prompt
    const enhancedBrief = buildAnswerIncorporationPrompt(
      graph,
      brief,
      cachedQuestion.question,
      clarifier_response.answer,
      historyForPrompt
    );

    const callOpts: CallOpts = {
      requestId,
      timeoutMs: 30000, // 30 second timeout for refinement
    };

    log.debug(
      {
        request_id: requestId,
        question_id: clarifier_response.question_id,
        answer_length: clarifier_response.answer.length,
      },
      "Calling LLM to incorporate answer"
    );

    // Call draftGraph with the enhanced brief
    const response = await adapter.draftGraph(
      {
        brief: enhancedBrief,
        seed: Date.now(), // Use current timestamp as seed for some variation
      },
      callOpts
    );

    if (!response.graph) {
      log.warn({ request_id: requestId }, "LLM returned no graph in response");
      return {
        refined_graph: graph,
        changes_made: false,
        error: "LLM did not return a valid graph",
      };
    }

    const refinedGraph = response.graph as unknown as GraphV1;
    const patch = computeGraphPatch(graph, refinedGraph);
    const changesMade = hasSignificantChanges(patch);

    const latencyMs = Date.now() - startTime;

    emit(TelemetryEvents.CeeClarifierAnswerIncorporated, {
      request_id: requestId,
      question_id: clarifier_response.question_id,
      changes_made: changesMade,
      nodes_added: patch.adds.nodes.length,
      edges_added: patch.adds.edges.length,
      items_removed: patch.removes.length,
      latency_ms: latencyMs,
    });

    log.info(
      {
        request_id: requestId,
        question_id: clarifier_response.question_id,
        changes_made: changesMade,
        nodes_added: patch.adds.nodes.length,
        edges_added: patch.adds.edges.length,
        latency_ms: latencyMs,
      },
      "Answer incorporated into graph"
    );

    return {
      refined_graph: refinedGraph,
      changes_made: changesMade,
      reasoning: response.rationales
        ?.map((r) => `${r.target}: ${r.why}`)
        .join("; "),
    };
  } catch (error) {
    log.error(
      { error, request_id: requestId, question_id: clarifier_response.question_id },
      "Failed to incorporate answer"
    );

    return {
      refined_graph: graph,
      changes_made: false,
      error: `Failed to process answer: ${(error as Error).message}`,
    };
  }
}
