# CEE (Contextual Evidence Engine) – Technical Specification

**Version:** 1.0.0
**Last Updated:** 2025-11-27
**Status:** Production

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Purpose & Scope](#2-purpose--scope)
3. [Architecture Overview](#3-architecture-overview)
4. [API Reference](#4-api-reference)
5. [Request Lifecycle](#5-request-lifecycle)
6. [Data Models](#6-data-models)
7. [Integration Guide](#7-integration-guide)
8. [Configuration Reference](#8-configuration-reference)
9. [Observability](#9-observability)
10. [Security & Privacy](#10-security--privacy)
11. [Code Locations](#11-code-locations)
12. [Related Documentation](#12-related-documentation)

---

## 1. Quick Start

### For Developers Building CEE Routes

```typescript
// 1. Import the auth context helpers
import { getRequestCallerContext } from '../plugins/auth.js';
import { contextToTelemetry } from '../context/index.js';
import { emit } from '../utils/telemetry.js';

// 2. In your route handler, get the caller context
const callerCtx = getRequestCallerContext(request);
const telemetryCtx = callerCtx ? contextToTelemetry(callerCtx) : { request_id: request.id };

// 3. Emit telemetry with context
emit(TelemetryEvents.CeeBiasCheckRequested, {
  ...telemetryCtx,
  feature: 'cee_bias_check',
  has_archetype: Boolean(body.archetype),
});
```

### For PLoT/Backend Integration

```typescript
import {
  createCEEClient,
  buildCeeDecisionReviewPayload,
  type CeeDecisionReviewPayload,
} from "@olumi/assistants-sdk";

const cee = createCEEClient({
  apiKey: process.env.CEE_API_KEY!,
  baseUrl: process.env.CEE_BASE_URL,
});

// Call CEE endpoints
const draft = await cee.draftGraph({ brief: "..." });
const bias = await cee.biasCheck({ graph: draft.graph, archetype: draft.archetype });

// Build review payload for UI
const review: CeeDecisionReviewPayload = buildCeeDecisionReviewPayload({ draft, bias });
```

### For Frontend/UI Consumers

**Never call CEE directly.** Consume `ceeReview`, `ceeTrace`, and `ceeError` from your backend (PLoT) API.

---

## 2. Purpose & Scope

### 2.1 What CEE Does

The **Contextual Evidence Engine (CEE)** is the quality, risk, and guidance layer that wraps decision journeys. It:

| Responsibility | Description |
|----------------|-------------|
| **Quality Assessment** | Assigns bands/scores (low/medium/high) to graphs based on structure and content |
| **Bias Detection** | Identifies cognitive biases (confirmation, sunk cost, anchoring) with mitigation guidance |
| **Evidence Scoring** | Evaluates evidence quality, coverage, and gaps |
| **Sensitivity Analysis** | Suggests sensitivity checks for key drivers |
| **Team Alignment** | Aggregates perspectives and detects disagreement |
| **Structural Validation** | Enforces graph constraints (DAG, node caps, edge caps) |

### 2.2 What CEE Does NOT Do

- **Own user identities** – Authentication is handled by the auth plugin
- **Own decision lifecycle** – That's PLoT/engine responsibility
- **Expose raw user content** – Telemetry and logs are metadata-only
- **Make decisions** – CEE provides guidance; humans decide

### 2.3 Key Design Principles

1. **Additive, not central** – Core decision flows work without CEE
2. **Metadata-only externally** – No PII, prompts, or graphs in telemetry
3. **Fail soft** – Return partial envelopes with degraded quality rather than hard failures
4. **Deterministic** – Same inputs + seed = same outputs

---

## 3. Architecture Overview

### 3.1 System Position

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                   │
│  ┌──────────────┐                  ┌──────────────┐             │
│  │   Scenario   │                  │    PLoT      │             │
│  │      UI      │◄─────────────────│   Engine     │             │
│  └──────────────┘  ceeReview       └──────┬───────┘             │
│       (never calls CEE directly)          │                      │
└───────────────────────────────────────────┼──────────────────────┘
                                            │ TypeScript SDK
                                            ▼
┌───────────────────────────────────────────────────────────────────┐
│              OLUMI ASSISTANTS SERVICE                              │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                     /assist/v1/*                             │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌───────────┐ │  │
│  │  │draft-graph │ │bias-check  │ │ options    │ │team-persp.│ │  │
│  │  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬─────┘ │  │
│  └────────┼──────────────┼──────────────┼──────────────┼───────┘  │
│           │              │              │              │          │
│  ┌────────▼──────────────▼──────────────▼──────────────▼───────┐  │
│  │                    CEE ENGINE                                │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │  │
│  │  │ Quality  │  │  Bias    │  │ Evidence │  │   Graph      │ │  │
│  │  │ Scoring  │  │ Detector │  │ Scoring  │  │ Compliance   │ │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘ │  │
│  └──────────────────────────┬───────────────────────────────────┘  │
└─────────────────────────────┼──────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
      ┌──────────┐      ┌──────────┐      ┌──────────┐
      │Anthropic │      │  Redis   │      │   ISL    │
      │ Claude   │      │(optional)│      │(optional)│
      └──────────┘      └──────────┘      └──────────┘
```

### 3.2 Integration Model (D1-D7)

From the CEE-PLoT-Scenario SSOT:

| Decision | Rule |
|----------|------|
| **D1** | PLoT and UI integrate via TypeScript SDK only, not raw OpenAPI |
| **D2** | Only PLoT calls CEE; UI never calls CEE directly |
| **D3** | CEE is optional; engine responses work without CEE |
| **D4-D6** | CEE behaviour is deterministic given same inputs + seed |
| **D7** | CEE secrets are server-side only; UI never holds API keys |

---

## 4. API Reference

### 4.1 Endpoint Summary

All endpoints are under `/assist/v1/*`, require API key auth, and return CEE envelopes.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/assist/v1/draft-graph` | POST | Generate decision graph from brief |
| `/assist/v1/explain-graph` | POST | Summarise graph with explanations |
| `/assist/v1/evidence-helper` | POST | Score and filter evidence items |
| `/assist/v1/bias-check` | POST | Detect biases with mitigations |
| `/assist/v1/options` | POST | Suggest additional options |
| `/assist/v1/sensitivity-coach` | POST | Rank drivers and suggest sensitivity checks |
| `/assist/v1/team-perspectives` | POST | Aggregate team stances and detect disagreement |
| `/assist/v1/decision-review/enhanced` | POST | ISL-enhanced decision review |

### 4.2 Common Response Envelope

Every CEE response includes:

```typescript
interface CEEEnvelope {
  // Core result (endpoint-specific)
  graph?: Graph;
  options?: Option[];
  bias_findings?: BiasFinding[];
  // ...

  // Common envelope fields
  trace: CEETraceMeta;
  quality: CEEQualityMeta;
  validation_issues?: CEEValidationIssue[];
  response_limits: CEEResponseLimits;
  guidance?: CEEGuidanceV1;
}
```

### 4.3 Response Limits

CEE enforces deterministic caps on lists:

| List | Max | Config |
|------|-----|--------|
| `bias_findings` | 10 | `bias_findings_max` |
| `options` | 6 | `options_max` |
| `evidence_suggestions` | 20 | `evidence_suggestions_max` |
| `sensitivity_suggestions` | 10 | `sensitivity_suggestions_max` |

When exceeded, the `*_truncated` flag is set to `true`.

### 4.4 Error Response

CEE errors use a flattened, OlumiErrorV1-style schema on the wire while keeping
`trace` and `details` for backward compatibility:

```typescript
interface CEEErrorResponseV1 {
  schema: "cee.error.v1";

  // Core error fields
  code: CEEErrorCode;        // CEE_TIMEOUT, CEE_RATE_LIMIT, CEE_GRAPH_INVALID, etc.
  message: string;           // Sanitised, no PII
  retryable?: boolean;       // Whether clients may safely retry this request

  // OlumiErrorV1 metadata
  source: "cee";
  request_id?: string;       // Mirrors X-CEE-Request-ID
  degraded?: boolean;        // True when CEE or its dependencies are in degraded mode

  // Domain-level hints (metadata-only, no prompts/graphs/text)
  reason?: string;           // e.g. "empty_graph", "incomplete_structure"
  recovery?: {
    suggestion: string;      // High-level suggestion for how to fix input / proceed
    hints: string[];         // Short, concrete hints (bulleted in docs, plain strings on wire)
    example?: string;        // Optional example brief / graph description
  };
  node_count?: number;       // Graph node count when relevant
  edge_count?: number;       // Graph edge count when relevant
  missing_kinds?: string[];  // e.g. ["goal", "decision"] for incomplete graphs

  // Backward-compat fields (still populated)
  trace?: CEETraceMeta;      // Request/engine metadata
  details?: Record<string, unknown>; // Legacy bag; mirrors key fields above
}
```

These additional fields are **metadata-only** and never include raw briefs,
graphs, or LLM text. They are safe for PLoT and UI clients to rely on for
classification, guidance, and retry decisions.

**Error Code Mapping:**

| Condition | HTTP | Code | Retryable |
|-----------|------|------|-----------|
| Upstream timeout | 504 | `CEE_TIMEOUT` | Yes |
| Rate limited | 429 | `CEE_RATE_LIMIT` | Yes |
| Invalid graph/caps | 400 | `CEE_GRAPH_INVALID` | No |
| Validation failed | 400 | `CEE_VALIDATION_FAILED` | No |
| Service unavailable | 503 | `CEE_SERVICE_UNAVAILABLE` | Yes |
| Internal error | 500 | `CEE_INTERNAL_ERROR` | No |

### 4.5 Response Headers

| Header | Description |
|--------|-------------|
| `X-CEE-API-Version` | Always `v1` |
| `X-CEE-Feature-Version` | Per-endpoint version (e.g., `draft-model-1.0.0`) |
| `X-CEE-Request-ID` | Matches `trace.request_id` |
| `X-CEE-Model-Used` | LLM model used (when model selection enabled) |
| `X-CEE-Model-Tier` | Model tier (`fast`, `quality`, `premium`) |

---

## 5. Request Lifecycle

### 5.1 Flow Diagram

```
Request → Fastify Hooks → Auth Plugin → Schema Validation → Rate Limits →
  → Orchestration → LLM Calls → Graph Compliance → Envelope Assembly → Response
```

### 5.2 Step-by-Step

1. **Ingress & Hooks** ([src/server.ts](../../src/server.ts))
   - Attach request ID via `attachRequestId()`
   - Apply global IP rate limiting
   - Register auth plugin

2. **Authentication** ([src/plugins/auth.ts](../../src/plugins/auth.ts))
   - Validate API key from `X-Olumi-Assist-Key` or `Authorization: Bearer`
   - Optional HMAC signature validation
   - Attach `CallerContext` to request

3. **CallerContext** ([src/context/caller.ts](../../src/context/caller.ts))
   ```typescript
   interface CallerContext {
     requestId: string;      // Unique request identifier
     keyId: string;          // Hashed API key identifier
     correlationId?: string; // For distributed tracing
     timestamp: string;      // ISO 8601
     timestampMs: number;    // Unix milliseconds
     hmacAuth: boolean;      // Whether HMAC auth was used
     sourceIp?: string;      // Client IP (internal only)
     userAgent?: string;     // Client user agent (internal only)
   }
   ```

4. **Schema Validation**
   - Zod validation against schemas from `src/schemas/assist.ts`
   - Generated from `openapi.yaml`

5. **Rate Limits & Cost Guards**
   - Per-feature rate limits (e.g., `CEE_DRAFT_RATE_LIMIT_RPM=5`)
   - Cost estimation via `estimateTokens()`
   - Hard reject when cost exceeds `COST_MAX_USD`

6. **Orchestration** ([src/orchestrator/index.ts](../../src/orchestrator/index.ts))
   - Graph manipulation and guards
   - LLM calls via `src/adapters/llm/router.ts`
   - Optional ISL causal validation

7. **Graph Compliance** (`enforceGraphCompliance`)
   - DAG enforcement (no cycles)
   - Stable edge IDs and sorting
   - Node/edge caps and pruning
   - Meta fields (roots, leaves, layout hints)

8. **Envelope Assembly**
   - Build `trace`, `quality`, `validation_issues`
   - Apply list caps and set `*_truncated` flags
   - Map errors to `CEEErrorResponseV1`

9. **Telemetry** ([src/utils/telemetry.ts](../../src/utils/telemetry.ts))
   - Emit structured events with `contextToTelemetry(callerCtx)`
   - Events include `request_id`, `key_id`, `correlation_id`

---

## 6. Data Models

### 6.1 Graph Model

Defined in [src/schemas/graph.ts](../../src/schemas/graph.ts):

```typescript
interface Node {
  id: string;
  kind: "goal" | "decision" | "option" | "outcome" | "risk" | "action";
  label?: string;
  body?: string;  // max 200 chars
}

interface Edge {
  id?: string;
  from: string;
  to: string;
  weight?: number;
  belief?: number;  // 0-1
  provenance?: StructuredProvenance | string;  // string is legacy
  provenance_source?: "document" | "metric" | "hypothesis" | "engine";
}

interface Graph {
  version: string;
  default_seed: number;
  nodes: Node[];
  edges: Edge[];
  meta: {
    roots: string[];
    leaves: string[];
    suggested_positions: Record<string, Position>;
    source: "assistant" | "fixtures";
  };
}
```

### 6.2 Quality Model

```typescript
interface CEEQualityMeta {
  overall: number;    // 1-10, from engine confidence
  structure: number;  // 1-10, graph complexity
  coverage: number;   // 1-10, options and risks
  safety: number;     // 1-10, minus validation issues
  causality: number;  // 1-10, cause/effect richness
}
```

**Quality Bands:**
- 1-4: **low** quality
- 5-7: **medium** quality
- 8-10: **high** quality

### 6.3 Health Levels

Each envelope has a health level:

| Level | Condition |
|-------|-----------|
| **risk** | Error-level issue, heavy truncation (2+), or quality ≤ 3 |
| **warning** | Any validation issues, any truncation, or quality < 5 |
| **ok** | Otherwise |

### 6.4 Team Disagreement

From Team Perspectives endpoint:

```typescript
interface TeamSummary {
  participant_count: number;
  for_count: number;
  against_count: number;
  neutral_count: number;
  weighted_for_fraction: number;  // 0-1
  disagreement_score: number;     // 0-1
  has_team_disagreement: boolean; // true when participants ≥ 3 AND score ≥ 0.4
}
```

---

## 7. Integration Guide

### 7.1 For PLoT/Backend Services

**1. Create a CEE client:**

```typescript
import { createCEEClient } from "@olumi/assistants-sdk";

const cee = createCEEClient({
  apiKey: process.env.CEE_API_KEY!,
  baseUrl: process.env.CEE_BASE_URL,
  timeout: 60_000,
});
```

**2. Call CEE endpoints:**

```typescript
const draft = await cee.draftGraph({
  brief: briefText,
  seed: 42,
  archetype_hint: "pricing_decision",
});

const bias = await cee.biasCheck({
  graph: draft.graph,
  archetype: draft.archetype,
});
```

**3. Build review payload for UI:**

```typescript
import {
  buildCeeDecisionReviewPayload,
  buildCeeTraceSummary,
  buildCeeIntegrationReviewBundle,
} from "@olumi/assistants-sdk";

const review = buildCeeDecisionReviewPayload({ draft, bias, options, team });
const trace = buildCeeTraceSummary({ trace: draft.trace });
const bundle = buildCeeIntegrationReviewBundle({ review, trace });

// Expose to UI
return {
  ceeReview: bundle.review,
  ceeTrace: bundle.trace,
  ceeError: bundle.error,
};
```

**4. Handle errors:**

```typescript
import { isRetryableCEEError, buildCeeErrorView } from "@olumi/assistants-sdk";

try {
  const result = await cee.draftGraph({ brief });
} catch (error) {
  if (isRetryableCEEError(error)) {
    // Retry with exponential backoff
  }
  const errorView = buildCeeErrorView(error);
  return { ceeError: errorView };
}
```

### 7.2 For UI Consumers

**Never call CEE directly.** Use the backend's `ceeReview`, `ceeTrace`, `ceeError`:

```typescript
interface EngineScenarioReview {
  id: string;
  ceeReview: CeeDecisionReviewPayload | null;
  ceeTrace: CeeTraceSummary | null;
  ceeError?: {
    code?: string;
    retryable: boolean;
    suggestedAction: "retry" | "fix_input" | "fail";
  };
}

// UI rendering
if (response.ceeReview) {
  // Show quality band
  const band = response.ceeReview.journey.health.overallStatus; // "ok" | "warning" | "risk"

  // Show UI flags
  if (response.ceeReview.uiFlags.has_team_disagreement) {
    showBadge("Team is split");
  }
  if (response.ceeReview.uiFlags.has_truncation_somewhere) {
    showChip("Partial view (capped)");
  }
}
```

### 7.3 SDK Helpers Reference

| Helper | Purpose |
|--------|---------|
| `getCEETrace(envelope)` | Extract trace from any CEE response |
| `getCEEQualityOverall(envelope)` | Get overall quality score (1-10) |
| `getCEEValidationIssues(envelope)` | Get validation issues array |
| `ceeAnyTruncated(envelope)` | Check if any lists were truncated |
| `isRetryableCEEError(error)` | Check if error can be retried |
| `buildDecisionStorySummary(envelopes)` | Build narrative summary |
| `buildCeeHealthSummary(name, envelope)` | Build per-envelope health |
| `buildCeeJourneySummary(envelopes)` | Build journey-level summary |
| `buildCeeUiFlags(journey)` | Derive UI-ready boolean flags |
| `buildCeeBiasStructureSnapshot(draft, bias)` | Bias structure for dashboards |
| `buildCeeCausalValidationStats(bias)` | ISL causal validation stats |

---

## 8. Configuration Reference

### 8.1 Required Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `ASSIST_API_KEYS` | Comma-separated client API keys |

### 8.2 CEE Feature Flags

| Variable | Default | Description |
|----------|---------|-------------|
| `CEE_DRAFT_FEATURE_VERSION` | - | Version string in `X-CEE-Feature-Version` |
| `CEE_DRAFT_ARCHETYPES_ENABLED` | `true` | Enable archetype detection |
| `CEE_DRAFT_STRUCTURAL_WARNINGS_ENABLED` | `false` | Enable structural warnings |
| `CEE_BIAS_STRUCTURAL_ENABLED` | `false` | Enable structural bias detectors |
| `CEE_PRE_DECISION_CHECKS_ENABLED` | `false` | Include pre-decision checklist |
| `CEE_CAUSAL_VALIDATION_ENABLED` | `false` | Enable ISL bias enrichment |
| `CEE_PREFLIGHT_ENABLED` | `false` | Enable preflight validation |
| `CEE_PREFLIGHT_STRICT` | `false` | Reject briefs failing preflight |

### 8.3 Rate Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_RPM` | `120` | Global per-key rate limit |
| `CEE_DRAFT_RATE_LIMIT_RPM` | `5` | Draft My Model (`/assist/v1/draft-graph`) rate limit (RPM) |
| `CEE_EXPLAIN_RATE_LIMIT_RPM` | `5` | Explain Graph (`/assist/v1/explain-graph`) rate limit (RPM) |
| `CEE_EVIDENCE_HELPER_RATE_LIMIT_RPM` | `5` | Evidence Helper (`/assist/v1/evidence-helper`) rate limit (RPM) |
| `CEE_BIAS_CHECK_RATE_LIMIT_RPM` | `5` | Bias Check (`/assist/v1/bias-check`) rate limit (RPM) |
| `CEE_OPTIONS_RATE_LIMIT_RPM` | `5` | Options Helper (`/assist/v1/options`) rate limit (RPM) |
| `CEE_SENSITIVITY_COACH_RATE_LIMIT_RPM` | `5` | Sensitivity Coach (`/assist/v1/sensitivity-coach`) rate limit (RPM) |
| `CEE_TEAM_PERSPECTIVES_RATE_LIMIT_RPM` | `5` | Team Perspectives (`/assist/v1/team-perspectives`) rate limit (RPM) |
| `CEE_DECISION_REVIEW_RATE_LIMIT_RPM` | `30` | Enhanced decision review (`/assist/v1/decision-review/enhanced`) rate limit (RPM) |
| `SSE_RATE_LIMIT_RPM` | `20` | SSE-specific rate limit |

### 8.4 Cost & Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `COST_MAX_USD` | `1.00` | Max cost per request |
| `GRAPH_MAX_NODES` | `100` | Maximum nodes per graph |
| `GRAPH_MAX_EDGES` | `200` | Maximum edges per graph |

### 8.5 Caching

| Variable | Default | Description |
|----------|---------|-------------|
| `CEE_CACHE_RESPONSE_ENABLED` | `false` | Enable response caching |
| `CEE_CACHE_RESPONSE_TTL_MS` | `300000` | Cache TTL (5 min) |
| `CEE_CACHE_RESPONSE_MAX_SIZE` | `100` | Max cache entries |

### 8.6 Model Selection (Tiered Routing)

| Variable | Default | Description |
|----------|---------|-------------|
| `CEE_MODEL_SELECTION_ENABLED` | `false` | Enable model selection |
| `CEE_MODEL_OVERRIDE_ALLOWED` | `true` | Allow `X-CEE-Model-Override` header |
| `CEE_MODEL_FALLBACK_ENABLED` | `true` | Enable fallback to higher tier |
| `CEE_MODEL_QUALITY_GATE_ENABLED` | `true` | Protect critical tasks from downgrade |

### 8.7 ISL Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `ISL_BASE_URL` | - | ISL service endpoint |
| `ISL_API_KEY` | - | ISL authentication key |
| `ISL_TIMEOUT_MS` | `5000` | ISL request timeout |
| `ISL_MAX_RETRIES` | `1` | ISL retry attempts |

---

## 9. Observability

### 9.1 Telemetry Events

Each CEE endpoint emits structured events:

| Event | Fields |
|-------|--------|
| `cee.draft_graph.requested` | `request_id`, `key_id?`, `correlation_id?`, `has_seed`, `has_archetype_hint` |
| `cee.draft_graph.succeeded` | `request_id`, `key_id?`, `latency_ms`, `quality_overall`, `graph_nodes`, `any_truncated` |
| `cee.draft_graph.failed` | `request_id`, `key_id?`, `latency_ms`, `error_code`, `http_status` |

Similar patterns for `bias_check`, `options`, `evidence_helper`, `sensitivity_coach`, `team_perspectives`, `explain_graph`.

### 9.2 CallerContext in Telemetry

All events include fields from `contextToTelemetry()`:

```typescript
{
  request_id: string;
  key_id?: string;       // API key identifier
  correlation_id?: string; // For distributed tracing
}
```

### 9.3 Diagnostics Endpoint

`GET /diagnostics` (when `CEE_DIAGNOSTICS_ENABLED=true`):
- Returns recent CEE calls (metadata-only)
- Gated by API key auth
- Limited to specific key IDs via `CEE_DIAGNOSTICS_KEY_IDS`

### 9.4 Runbooks

| Runbook | Purpose |
|---------|---------|
| [CEE-runbook.md](CEE-runbook.md) | Operational procedures |
| [CEE-incident-runbook.md](CEE-incident-runbook.md) | Incident response |
| [CEE-telemetry-playbook.md](CEE-telemetry-playbook.md) | Dashboard setup |

---

## 10. Security & Privacy

### 10.1 Authentication

**API Key:**
```
X-Olumi-Assist-Key: your-api-key-here
```
or
```
Authorization: Bearer your-api-key-here
```

**HMAC (optional):**
```
X-Olumi-Signature: sha256=<hex-signature>
X-Olumi-Timestamp: <unix-timestamp>
```

### 10.2 Privacy Guarantees

| Surface | Guarantee |
|---------|-----------|
| **Telemetry events** | Metadata only (IDs, counts, booleans). No briefs, graphs, or prompts. |
| **Logs** | Request IDs and metrics. PII redacted via `PII_REDACTION_MODE`. |
| **Diagnostics** | Metadata ring buffer. No user content. |
| **CallerContext** | `sourceIp` and `userAgent` internal only; not in telemetry. |

### 10.3 CallerTelemetry

The `CallerTelemetry` type defines the safe subset for external emission:

```typescript
interface CallerTelemetry {
  request_id: string;
  key_id?: string;
  correlation_id?: string;
}
```

---

## 11. Code Locations

### 11.1 Core Files

| File | Purpose |
|------|---------|
| [src/routes/assist.v1.draft-graph.ts](../../src/routes/assist.v1.draft-graph.ts) | Draft Graph endpoint |
| [src/routes/assist.v1.bias-check.ts](../../src/routes/assist.v1.bias-check.ts) | Bias Check endpoint |
| [src/routes/assist.v1.options.ts](../../src/routes/assist.v1.options.ts) | Options endpoint |
| [src/cee/validation/pipeline.ts](../../src/cee/validation/pipeline.ts) | CEE finaliser |
| [src/cee/quality/index.ts](../../src/cee/quality/index.ts) | Quality scoring |
| [src/cee/bias/index.ts](../../src/cee/bias/index.ts) | Bias detection |
| [src/context/caller.ts](../../src/context/caller.ts) | CallerContext |
| [src/utils/telemetry.ts](../../src/utils/telemetry.ts) | Telemetry emission |

### 11.2 Schemas

| File | Purpose |
|------|---------|
| [openapi.yaml](../../openapi.yaml) | OpenAPI specification (source of truth) |
| [src/schemas/assist.ts](../../src/schemas/assist.ts) | Zod schemas |
| [src/schemas/graph.ts](../../src/schemas/graph.ts) | Graph model |
| [schemas/cee-decision-review.v1.json](../../schemas/cee-decision-review.v1.json) | Decision Review JSON Schema |

### 11.3 SDK

| File | Purpose |
|------|---------|
| [sdk/typescript/src/index.ts](../../sdk/typescript/src/index.ts) | SDK exports |
| [sdk/typescript/src/ceeHelpers.ts](../../sdk/typescript/src/ceeHelpers.ts) | CEE helper functions |
| [sdk/typescript/src/types/](../../sdk/typescript/src/types/) | TypeScript types |

### 11.4 Tests

| Test | Purpose |
|------|---------|
| [tests/unit/cee.draft-pipeline.test.ts](../../tests/unit/cee.draft-pipeline.test.ts) | Finaliser tests |
| [tests/integration/cee.draft-graph.test.ts](../../tests/integration/cee.draft-graph.test.ts) | Endpoint tests |
| [tests/integration/cee.telemetry.test.ts](../../tests/integration/cee.telemetry.test.ts) | Telemetry tests |
| [tests/integration/cee.hero-journey.test.ts](../../tests/integration/cee.hero-journey.test.ts) | E2E journeys |
| [tests/unit/cee.bias.test.ts](../../tests/unit/cee.bias.test.ts) | Bias detection |

---

## 12. Related Documentation

### 12.1 Primary References

| Document | Purpose |
|----------|---------|
| [CEE-v1.md](CEE-v1.md) | Developer guide with SDK examples |
| [CEE-decision-review-orchestrator.md](CEE-decision-review-orchestrator.md) | PLoT integration patterns |
| [architecture.md](../getting-started/architecture.md) | Service overview |
| [FRONTEND_INTEGRATION.md](../api/FRONTEND_INTEGRATION.md) | API integration guide |

### 12.2 Operational

| Document | Purpose |
|----------|---------|
| [CEE-runbook.md](CEE-runbook.md) | Day-to-day operations |
| [CEE-incident-runbook.md](CEE-incident-runbook.md) | Incident response |
| [CEE-ops.md](CEE-ops.md) | Operational reference |
| [operator-runbook.md](../operations/operator-runbook.md) | Service operations |

### 12.3 Features

| Document | Purpose |
|----------|---------|
| [ISL-INTEGRATION.md](ISL-INTEGRATION.md) | Causal validation integration |
| [prompt-management.md](prompt-management.md) | Prompt templates system |
| [prompt-runbook.md](prompt-runbook.md) | Prompt operations |
| [SSE-RESUME-API.md](../api/SSE-RESUME-API.md) | Streaming and resume |

### 12.4 Privacy & Security

| Document | Purpose |
|----------|---------|
| [privacy-and-data-handling.md](../operations/privacy-and-data-handling.md) | Privacy controls |
| [CEE-maintainers-guide.md](CEE-maintainers-guide.md) | Safe evolution |

---

## Appendix: Frozen Contracts

### CeeDecisionReviewPayloadV1

**Status:** Frozen. Additive-only changes permitted.

**Schema:** `schemas/cee-decision-review.v1.json`

**Required Fields:**
- `schema`: `"cee.decision-review.v1"`
- `version`: `"1.0.0"`
- `decision_id`: string
- `review.summary`: string
- `review.confidence`: number (0-1)
- `review.recommendations`: array

**Evolution Policy:**
- New optional fields may be added
- No removals or type changes
- Breaking changes require new version (v2)

---

*Generated: 2025-11-27*
*Maintained by: Olumi Engineering Team*
