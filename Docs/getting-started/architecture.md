# Olumi Assistants Service - Architecture Overview

**Purpose:** AI-powered decision-making service that transforms strategic questions into structured decision graphs
**Audience:** Developers, Technical Leads, Architects
**Last Updated:** 2025-11-22

---

## Table of Contents

- [What is the Olumi Assistants Service?](#what-is-the-olumi-assistants-service)
- [System Architecture](#system-architecture)
- [Component Overview](#component-overview)
- [Data Flow](#data-flow)
- [Technology Stack](#technology-stack)
- [External Dependencies](#external-dependencies)
- [Key Subsystems](#key-subsystems)
- [Authentication & Security](#authentication--security)
- [Deployment Architecture](#deployment-architecture)

---

## What is the Olumi Assistants Service?

The Olumi Assistants Service is a **backend API service** that provides AI-assisted decision-making capabilities for the Olumi platform. It transforms strategic questions (briefs) into **structured decision graphs** with provenance, evidence tracking, and quality assessment.

### Core Capabilities

1. **Draft Graph Generation** - Converts natural language briefs into structured decision trees
2. **Document Grounding** - Incorporates evidence from PDFs, CSVs, and text documents
3. **SSE Streaming** - Real-time streaming with resume capability for unreliable networks
4. **CEE (Contextual Evidence Engine)** - Quality assessment, bias detection, and decision guidance
5. **Evidence Packs** - Privacy-preserving decision sharing via shareable links

### Who Uses It?

- **Frontend Clients** - Scenario Sandbox UI, Olumi web app
- **Engine Service** (legacy) - Being phased out in favor of direct frontend integration
- **Operators** - SRE/DevOps teams managing production deployments

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Web UI     │  │   Mobile     │  │   Engine     │          │
│  │  (Scenario)  │  │              │  │   (Legacy)   │          │
│  └───────┬──────┘  └──────┬───────┘  └──────┬───────┘          │
└──────────┼────────────────┼──────────────────┼──────────────────┘
           │                │                  │
           │  HTTP/SSE      │  HTTP/SSE        │  HTTP/SSE
           │                │                  │
┌──────────▼────────────────▼──────────────────▼──────────────────┐
│              OLUMI ASSISTANTS SERVICE                             │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    FASTIFY SERVER                           │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │                  ROUTES                               │  │ │
│  │  │  /assist/draft-graph  |  /assist/stream  |  /v1/*    │  │ │
│  │  └───────────────────┬──────────────────────────────────┘  │ │
│  └──────────────────────┼─────────────────────────────────────┘ │
│  ┌──────────────────────▼─────────────────────────────────────┐ │
│  │              ORCHESTRATOR                                   │ │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────┐               │ │
│  │  │ Grounding│  │   CEE    │  │   Prompt   │               │ │
│  │  │ Pipeline │  │  Engine  │  │  Builder   │               │ │
│  │  └──────────┘  └──────────┘  └────────────┘               │ │
│  └──────────────────┬──────────────────┬──────────────────────┘ │
└─────────────────────┼──────────────────┼────────────────────────┘
                      │                  │
        ┌─────────────▼──────────┐  ┌───▼──────────────┐
        │   ANTHROPIC CLAUDE     │  │  REDIS           │
        │   (Primary LLM)        │  │  (SSE State)     │
        │                        │  │  (Optional)      │
        └────────────────────────┘  └──────────────────┘
                 │
        ┌────────▼────────────┐
        │   OPENAI            │
        │   (Fallback)        │
        └─────────────────────┘
```

---

## Component Overview

### 1. **Routes** (`/src/routes/`)

HTTP endpoint handlers that define the public API surface.

**Key Routes:**
- `assist.draft-graph.ts` - Main draft generation endpoint (POST /assist/draft-graph)
- `assist.stream.ts` - SSE streaming endpoint (GET /assist/stream)
- `assist.resume.ts` - SSE resume endpoint (POST /assist/resume)
- `assist.share.ts` - Evidence pack sharing (GET /assist/share/:token)
- `v1.cee.*.ts` - CEE endpoints (bias check, evidence helper, etc.)
- `health.ts` - Health check endpoint (GET /healthz)
- `v1.diagnostics.ts` - Operator diagnostics (GET /diagnostics)

### 2. **Orchestrator** (`/src/orchestrator/`)

Coordinates the draft generation workflow:
1. Parses and validates briefs
2. Processes document attachments (grounding)
3. Constructs LLM prompts
4. Calls LLM with streaming
5. Parses and validates graph responses
6. Integrates CEE quality assessments

### 3. **CEE (Contextual Evidence Engine)** (`/src/cee/`)

Quality assessment and evidence management subsystem.

**Capabilities:**
- **Archetypes** - Decision type classification
- **Bias Detection** - Identifies potential biases in graphs
- **Evidence Scoring** - Assesses evidence quality
- **Guidance** - Provides user-facing improvement suggestions
- **Quality Bands** - Classifies graph quality (low/medium/high)
- **Sensitivity Detection** - Flags sensitive decisions
- **Team Perspectives** - Analyzes team disagreement

See [CEE v1 Overview](../CEE-v1.md) for details.

### 4. **Services** (`/src/services/`)

Business logic layer:
- **Graph validation** - Validates graph structure and content
- **Attachment processing** - Extracts text from PDFs, CSVs
- **Evidence pack generation** - Creates shareable decision summaries
- **State management** - SSE resume state storage (Redis)

### 5. **Adapters** (`/src/adapters/`)

External service integrations:
- **LLM Providers** - Anthropic (primary), OpenAI (fallback)
- **Caching** - LLM prompt caching for cost optimization
- **Failover** - Automatic provider switching on errors

### 6. **Utils** (`/src/utils/`)

Shared utilities:
- **Authentication** - API key and HMAC auth
- **PII Guard** - Automatic PII detection and redaction
- **Rate Limiting** - Per-key quota management
- **Telemetry** - Structured event emission
- **SSE Management** - Buffer optimization, resume tokens

---

## Data Flow

### Draft Graph Request Flow

```
1. Client sends POST /assist/draft-graph
   ├─ Brief: "Should we migrate to microservices?"
   ├─ Attachments: [system-architecture.pdf, metrics.csv]
   └─ Config: { streaming: true, grounding: true }

2. Routes → Orchestrator
   ├─ Validate request (Zod schema)
   ├─ Check rate limits (per API key)
   └─ Authenticate (API key or HMAC)

3. Orchestrator → Grounding Pipeline
   ├─ Extract text from PDF (first 5,000 chars per file)
   ├─ Parse CSV data (structure only, no PII)
   └─ Build evidence summary

4. Orchestrator → Prompt Builder
   ├─ Construct system prompt
   ├─ Include grounded evidence
   └─ Apply format constraints

5. Orchestrator → LLM Adapter
   ├─ Call Anthropic Claude 3.5 Sonnet
   ├─ Stream response via SSE
   └─ Cache system prompt (90% cost reduction)

6. Orchestrator → Graph Validator
   ├─ Parse LLM JSON response
   ├─ Validate nodes, edges, metadata
   └─ Ensure graph completeness

7. Orchestrator → CEE Engine
   ├─ Classify decision archetype
   ├─ Detect biases
   ├─ Score evidence quality
   └─ Generate guidance

8. Response → Client
   ├─ SSE: progress events (DRAFTING, COMPLETE)
   ├─ Final: complete graph with provenance
   └─ CEE: quality band, bias flags, guidance
```

### SSE Resume Flow

If connection drops during streaming:

```
1. Client detects disconnect
2. Client calls POST /assist/resume with resume_token
3. Service retrieves state from Redis
4. Service resumes stream from last checkpoint
5. Client receives remaining events
```

---

## Technology Stack

### Runtime
- **Node.js** - 20.19.x (LTS)
- **Runtime Mode** - ECMAScript modules (ESM)

### Framework & Libraries
- **Fastify 5** - High-performance HTTP server
- **Zod 3** - Schema validation
- **Pino** - Structured logging
- **Vitest** - Testing framework

### LLM Providers
- **Anthropic Claude 3.5 Sonnet** (primary)
  - Model: `claude-3-5-sonnet-20241022`
  - Features: Prompt caching, streaming
- **OpenAI GPT-4o** (fallback)
  - Model: `gpt-4o-mini`

### Infrastructure
- **Redis** (optional) - SSE resume state, rate limiting
- **Datadog** (optional) - Metrics and monitoring

### Development Tools
- **TypeScript 5** - Type safety
- **ESLint** - Code linting
- **Artillery** - Performance testing
- **pnpm** - Package management

---

## External Dependencies

### Required

**Anthropic API**
- **Purpose:** Primary LLM for graph generation
- **Endpoint:** https://api.anthropic.com
- **Auth:** API key (`ANTHROPIC_API_KEY`)
- **Fallback:** Service continues with degraded functionality if unavailable

### Optional

**Redis**
- **Purpose:** SSE resume state, distributed rate limiting
- **Connection:** `REDIS_URL` environment variable
- **Fallback:** In-memory state (single instance only)

**OpenAI API**
- **Purpose:** Fallback LLM provider
- **Endpoint:** https://api.openai.com
- **Auth:** API key (`OPENAI_API_KEY`)
- **Fallback:** Anthropic-only operation

**Datadog**
- **Purpose:** Metrics, traces, logs
- **Agent:** Datadog StatsD client
- **Fallback:** Local logging only

---

## Key Subsystems

### SSE (Server-Sent Events) Streaming

**Purpose:** Real-time progress updates for long-running LLM calls

**Features:**
- Event-driven progress (DRAFTING → COMPLETE)
- Resume capability (via resume tokens)
- Buffer optimization (prevents memory bloat)
- Connection timeout handling

**State Storage:**
- Redis (production, multi-instance)
- In-memory (development, single instance)

**Resume Tokens:**
- Format: `resume_<uuid>`
- Expiry: 10 minutes
- Contains: Request params, partial response, checkpoint

See [SSE Resume API](../SSE-RESUME-API.md) for details.

---

### Document Grounding

**Purpose:** Incorporate evidence from user-uploaded documents

**Supported Formats:**
- PDF (text extraction only, no images)
- CSV (structure and statistics, no raw data)
- TXT (plain text)

**Privacy Guardrails:**
- 5,000 character limit per file
- 50,000 character aggregate limit
- CSV data redacted (only counts, types, column names)
- Encrypted PDFs rejected

**Processing Pipeline:**
1. Validate file type and size
2. Extract text content
3. Apply character limits
4. Redact PII (emails, phone numbers, etc.)
5. Include in LLM prompt as "grounded evidence"

---

### Rate Limiting & Quotas

**Three-Tier System:**

1. **Global Rate Limit**
   - 120 req/min per IP
   - Enforced by Fastify plugin
   - Header: `Retry-After`

2. **Per-Key Rate Limit**
   - 120 req/min per API key
   - Enforced by token bucket (Redis/memory)
   - Response: 429 with `error.v1` schema

3. **CEE Feature Limits**
   - 5 req/min per feature per API key
   - Configurable via `CEE_*_RATE_LIMIT_RPM`
   - Example: bias check limited independently from evidence helper

See [CEE Limits & Budgets](../CEE-limits-and-budgets.md) for configuration.

---

## Authentication & Security

### API Key Authentication

**Header Format:**
```
X-Olumi-Assist-Key: your-api-key-here
```

or

```
Authorization: Bearer your-api-key-here
```

**Key Structure:**
- Base64-encoded secret
- Hashed (SHA-256) for rate limit tracking
- Stored in environment variable `ASSIST_API_KEYS` (comma-separated)

### HMAC Signatures (Optional)

For enhanced security, requests can be signed with HMAC-SHA256:

```
X-Olumi-Signature: sha256=<hex-signature>
X-Olumi-Timestamp: <unix-timestamp>
```

**Replay Protection:**
- Timestamp must be within 5 minutes of server time
- Prevents replay attacks

See [Frontend Integration Guide](../FRONTEND_INTEGRATION.md#authentication) for details.

---

### Request Context (CallerContext)

**Purpose:** Propagate authentication and telemetry context through the request lifecycle

**Location:** `src/context/`

**CallerContext Interface:**
```typescript
interface CallerContext {
  requestId: string;       // Unique request identifier
  keyId: string;           // API key identifier (hashed)
  correlationId?: string;  // Distributed tracing ID
  timestamp: string;       // ISO 8601 timestamp
  timestampMs: number;     // Unix milliseconds
  hmacAuth: boolean;       // Whether HMAC auth was used
  sourceIp?: string;       // Client IP (for audit logs)
  userAgent?: string;      // Client user agent
}
```

**Usage in Handlers:**
```typescript
import { getRequestCallerContext } from '../plugins/auth.js';
import { contextToTelemetry } from '../context/index.js';

app.post('/endpoint', async (req, reply) => {
  const ctx = getRequestCallerContext(req);
  if (ctx) {
    // Include context in telemetry
    emit(TelemetryEvents.SomeEvent, {
      ...contextToTelemetry(ctx),
      custom_field: 'value',
    });
  }
});
```

**Lifecycle:**
1. Auth plugin authenticates request
2. `attachCallerContext()` attaches context to request
3. Route handlers retrieve via `getRequestCallerContext()`
4. Context propagated through service calls
5. Telemetry events include context via `contextToTelemetry()`

**Test Utilities:**
```typescript
import { createTestContext } from '../context/index.js';

const ctx = createTestContext({ keyId: 'test-key' });
```

---

### PII Protection

**Automatic Redaction:**
- Emails → `[email]`
- Phone numbers → `[phone]`
- API keys → `[KEY_REDACTED]`
- URLs with auth → `[url]`
- Credit cards, SSNs, etc.

**Redaction Modes:**
- `standard` - Common PII patterns (default)
- `strict` - Includes file paths, potential names
- `off` - No redaction (dev only)

**Configuration:**
```bash
PII_REDACTION_MODE=standard  # or strict, off
```

See [Privacy & Data Handling](../privacy-and-data-handling.md) for details.

---

## Deployment Architecture

### Production (Render.com)

```
┌──────────────────────────────────────────┐
│        Render.com (Web Service)          │
│  ┌────────────────────────────────────┐  │
│  │  Assistants Service                │  │
│  │  - Auto-deploy from main branch    │  │
│  │  - Health check: /healthz          │  │
│  │  - Logs: Render dashboard          │  │
│  └────────────┬───────────────────────┘  │
└───────────────┼──────────────────────────┘
                │
        ┌───────▼────────┐
        │  Redis Cloud   │
        │  (Upstash)     │
        └────────────────┘
```

**Deployment Process:**
1. Push to `main` branch
2. Render auto-builds and deploys
3. Health check (`/healthz`) passes
4. Traffic switched to new version
5. Old version terminated

**Environment Variables:**
- `ANTHROPIC_API_KEY` - Required
- `REDIS_URL` - Optional (enables SSE resume)
- `ASSIST_API_KEYS` - Required (comma-separated)
- `ALLOWED_ORIGINS` - CORS whitelist
- See `.env.example` for full list

### Monitoring

**Health Checks:**
- `/healthz` - Service health (200 OK)
- `/diagnostics` - Operator diagnostics (gated by `CEE_DIAGNOSTICS_ENABLED`)

**Metrics:**
- Datadog StatsD (optional)
- Custom telemetry events (see [CEE Telemetry Playbook](../CEE-telemetry-playbook.md))

**Logs:**
- Structured JSON (Pino)
- Automatic PII redaction
- Request ID propagation

---

## Performance Characteristics

### Latency Targets (M2 SLO)

- **p95 latency** ≤ 8s for draft-graph requests
- **Success rate** ≥ 99% under baseline load
- **Baseline load:** 1 req/sec sustained

See [Baseline Performance Report](../baseline-performance-report.md) for current metrics.

### Cost Optimization

**Anthropic Prompt Caching:**
- System prompts cached with `cache_control: ephemeral`
- Cache hit: 90% cost reduction
- Cache TTL: 5 minutes

**Request Batching:**
- CEE operations batched when possible
- Reduces LLM API calls

### Scalability

**Horizontal Scaling:**
- Stateless design (with Redis)
- Can run multiple instances behind load balancer
- Redis centralizes SSE resume state

**Vertical Scaling:**
- Memory: ~512 MB per instance (recommended)
- CPU: Single-threaded Node.js (1-2 vCPUs sufficient)

---

## See Also

### For Developers
- **[Contributing Guide](../contributing.md)** - Development workflow
- **[Frontend Integration](../FRONTEND_INTEGRATION.md)** - API reference
- **[CEE v1 Overview](../CEE-v1.md)** - CEE subsystem details

### For Operators
- **[Operator Runbook](../CEE-ops.md)** - Day-to-day operations
- **[Incident Runbooks](../runbooks/)** - Troubleshooting guides
- **[Render Deployment](../STAGING_SETUP_INSTRUCTIONS.md)** - Deployment guide

---

**Questions?** See [Docs/README.md](../README.md) for full documentation index.

**Last Updated:** 2025-11-27
**Maintained By:** Olumi Engineering Team
