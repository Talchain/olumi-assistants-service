# Olumi Assistants SDK (TypeScript)

Official TypeScript SDK for the Olumi Assistants Service. Build AI-assisted decision-making tools with full type safety.

## Installation

```bash
npm install @olumi/assistants-sdk
# or
pnpm add @olumi/assistants-sdk
# or
yarn add @olumi/assistants-sdk
```

## Quick Start

```typescript
import { OlumiClient } from "@olumi/assistants-sdk";

const client = new OlumiClient({
  apiKey: process.env.OLUMI_API_KEY!,
});

// Draft a decision graph
const result = await client.draftGraph({
  brief: "Should we expand to international markets?",
});

console.log(result.graph);
// {
//   schema: "graph.v1",
//   nodes: [
//     { id: "q1", type: "question", label: "Expand internationally?" },
//     { id: "o1", type: "option", label: "Yes - expand now" },
//     { id: "o2", type: "option", label: "No - focus domestically" }
//   ],
//   edges: [
//     { from: "q1", to: "o1" },
//     { from: "q1", to: "o2" }
//   ]
// }
```

## API Reference

### Client Configuration

```typescript
const client = new OlumiClient({
  apiKey: string;        // Required: Your Olumi API key
  baseUrl?: string;      // Optional: API base URL (default: production)
  timeout?: number;      // Optional: Request timeout in ms (default: 60000)
});
```

### Methods

#### `draftGraph(request)`

Generate a decision graph from a brief description.

```typescript
const response = await client.draftGraph({
  brief: "Should we launch feature X?",
  attachments: [  // Optional
    {
      filename: "data.csv",
      content_type: "text/csv",
      data: "base64-encoded-content",
    },
  ],
});

// response: DraftGraphResponse
// {
//   schema: "draft-graph.v1",
//   graph: Graph,
//   confidence: number,
//   issues?: string[]
// }
```

#### `suggestOptions(request)`

Generate additional options for a question node.

```typescript
const response = await client.suggestOptions({
  graph: existingGraph,
  question_id: "q1",
});

// response: { schema: "suggest-options.v1", suggestions: string[] }
```

#### `clarifyBrief(request)`

Get clarifying questions for an ambiguous brief.

```typescript
const response = await client.clarifyBrief({
  brief: "Improve our product",
  previous_answers: {  // Optional
    "q1": "User retention",
  },
});

// response: ClarifyBriefResponse
// {
//   questions: [{ id, question, reason }],
//   ready: boolean,
//   confidence: number
// }
```

#### `critiqueGraph(request)`

Get quality feedback on a decision graph.

```typescript
const response = await client.critiqueGraph({
  graph: myGraph,
  brief: "Original brief",  // Optional
  focus_areas: ["structure", "completeness"],  // Optional
});

// response: CritiqueGraphResponse
// {
//   overall_quality: "excellent" | "good" | "fair" | "poor",
//   issues: [{ severity, category, message, node_ids? }]
// }
```

#### `explainDiff(request)`

Get natural language explanation of graph changes.

```typescript
const response = await client.explainDiff({
  before: originalGraph,
  after: modifiedGraph,
});

// response: ExplainDiffResponse
// {
//   summary: string,
//   changes: [{ type, node_id?, before?, after? }]
// }
```

#### `evidencePack(request)`

Generate supporting evidence for a node.

```typescript
const response = await client.evidencePack({
  graph: myGraph,
  node_id: "o1",
});

// response: EvidencePackResponse
// {
//   node_id: string,
//   evidence: [{ type: "pro" | "con" | "context", text, confidence }]
// }
```

#### `healthCheck()`

Check service health.

```typescript
const response = await client.healthCheck();
// { status: "ok", version: "1.5.0" }
```

## Error Handling

The SDK throws typed errors for different failure modes:

```typescript
import { OlumiAPIError, OlumiNetworkError, OlumiConfigError } from "@olumi/assistants-sdk";

try {
  const result = await client.draftGraph({ brief: "..." });
} catch (error) {
  if (error instanceof OlumiAPIError) {
    // 4xx/5xx from server
    console.error(`API error: ${error.message}`);
    console.error(`Status: ${error.statusCode}`);
    console.error(`Code: ${error.code}`);
    console.error(`Request ID: ${error.requestId}`);
  } else if (error instanceof OlumiNetworkError) {
    // Network failure, timeout, etc.
    console.error(`Network error: ${error.message}`);
  } else if (error instanceof OlumiConfigError) {
    // Invalid SDK configuration
    console.error(`Config error: ${error.message}`);
  }
}
```

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import type {
  Graph,
  GraphNode,
  GraphEdge,
  DraftGraphRequest,
  DraftGraphResponse,
  // ... and more
} from "@olumi/assistants-sdk";
```

## CEE v1 Helpers (Decision Engine)

The SDK includes a small, deterministic surface area for CEE v1
("Controlled Evaluation Engine"):

- `createCEEClient` – typed client for CEE endpoints.
- `buildDecisionStorySummary` – metadata-only narrative summary.
- `buildCeeJourneySummary` – aggregates per-envelope health and completeness.
- `buildCeeUiFlags` – UI-ready booleans (high risk, truncation, disagreement, completeness).
- `buildCeeDecisionReviewPayload` – compact payload suitable for "decision review" APIs.
- `isRetryableCEEError` – classifies retryable CEE failures.

Recommended reading and examples:

- `Docs/CEE-v1.md` – CEE endpoints, error shapes, and judgement policy.
- `Docs/CEE-recipes.md` – canonical usage patterns (draft-only, draft+options, full journey).
- `sdk/typescript/src/examples/ceeJourneyExample.ts` – simple CEE journey via SDK.
- `sdk/typescript/src/examples/ceeDecisionReviewExample.ts` – Sandbox-style
  decision review payload example.
 - `sdk/typescript/src/examples/ceeCalibrationExample.ts` – small calibration
   snapshot helper focusing on quality bands, truncation, and validation
   issues.
 - `Docs/CEE-sandbox-integration.md` – how to integrate CEE into a
   Scenario/Sandbox-style Decision Review surface.

For contributors touching CEE helpers or contracts, also see
`Docs/CEE-maintainers-guide.md`.

## Examples

See [examples/](../../examples/) directory for complete examples:

- Basic usage
- Error handling
- Streaming responses
- Multi-step workflows

## License

MIT
