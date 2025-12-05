# Architecture Overview

**Version**: v1.4.0
**Last Updated**: 2025-01-08

This document provides a comprehensive overview of the Olumi Assistants Service architecture, including request flows, component interactions, and key abstractions.

---

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Directory Structure](#directory-structure)
3. [Request Flow](#request-flow)
4. [Key Components](#key-components)
5. [Configuration System](#configuration-system)
6. [LLM Adapter Layer](#llm-adapter-layer)
7. [CEE Pipeline](#cee-pipeline)
8. [Authentication & Authorization](#authentication--authorization)
9. [Streaming (SSE)](#streaming-sse)
10. [Runbook: Common Operations](#runbook-common-operations)

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client Applications                             │
│                     (Olumi Web App, Mobile, Third-party)                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Load Balancer / Render                            │
│                          (TLS termination, routing)                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Olumi Assistants Service                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        Fastify HTTP Server                           │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │   │
│  │  │   Plugins    │  │   Hooks      │  │       Routes             │  │   │
│  │  │  - Auth      │  │  - Request ID│  │  - /assist/draft-graph   │  │   │
│  │  │  - CORS      │  │  - Logging   │  │  - /assist/clarify-brief │  │   │
│  │  │  - Helmet    │  │  - Telemetry │  │  - /v1/status            │  │   │
│  │  │  - RateLimit │  │  - Timing    │  │  - /healthz              │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                       │                                     │
│  ┌────────────────────────────────────┼────────────────────────────────┐   │
│  │                       Service Layer │                                │   │
│  │  ┌──────────────┐  ┌──────────────┐ │ ┌─────────────────────────┐  │   │
│  │  │   Config     │  │  Centralized │ │ │     CEE Pipeline        │  │   │
│  │  │   (Zod)      │  │    Config    │◀┼▶│  - Clarifier            │  │   │
│  │  └──────────────┘  └──────────────┘ │ │  - Bias Detection       │  │   │
│  │                                     │ │  - Quality Assessment   │  │   │
│  │  ┌──────────────┐  ┌──────────────┐ │ │  - Validation           │  │   │
│  │  │   Context    │  │   Feature    │ │ └─────────────────────────┘  │   │
│  │  │   (Caller)   │  │    Flags     │ │                              │   │
│  │  └──────────────┘  └──────────────┘ │                              │   │
│  └─────────────────────────────────────┼──────────────────────────────┘   │
│                                        │                                    │
│  ┌─────────────────────────────────────┼──────────────────────────────┐   │
│  │                      Adapter Layer  │                               │   │
│  │  ┌────────────────────────────────────────────────────────────┐   │   │
│  │  │                      LLM Router                             │   │   │
│  │  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐   │   │   │
│  │  │  │   Anthropic  │ │    OpenAI    │ │     Fixtures     │   │   │   │
│  │  │  │   Adapter    │ │   Adapter    │ │     Adapter      │   │   │   │
│  │  │  └──────────────┘ └──────────────┘ └──────────────────┘   │   │   │
│  │  └────────────────────────────────────────────────────────────┘   │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │   │
│  │  │   Failover   │  │   Caching    │  │        ISL           │   │   │
│  │  │   Adapter    │  │   Adapter    │  │   (Causal Service)   │   │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           ▼                           ▼                           ▼
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│     OpenAI       │      │    Anthropic     │      │      Redis       │
│   API Service    │      │   API Service    │      │  (Optional)      │
└──────────────────┘      └──────────────────┘      └──────────────────┘
```

---

## Directory Structure

```
src/
├── adapters/                 # External service integrations
│   ├── llm/                  # LLM provider adapters
│   │   ├── anthropic.ts      # Claude API integration
│   │   ├── openai.ts         # GPT API integration
│   │   ├── router.ts         # Provider selection logic
│   │   ├── failover.ts       # Multi-provider failover
│   │   ├── caching.ts        # Response caching layer
│   │   └── types.ts          # Shared adapter types
│   └── isl/                  # ISL (Causal Service) adapter
├── cee/                      # Cognitive Enhancement Engine
│   ├── clarifier/            # Brief clarification system
│   ├── bias/                 # Bias detection & mitigation
│   ├── quality/              # Graph quality assessment
│   ├── validation/           # Pre-decision checks
│   ├── evidence/             # Evidence gathering
│   ├── options/              # Option generation
│   └── decision-review/      # Decision review orchestration
├── config/                   # Configuration management
│   ├── index.ts              # Centralized Zod-validated config
│   ├── models.ts             # LLM model configuration
│   └── timeouts.ts           # Timeout constants
├── context/                  # Request context management
│   ├── caller.ts             # Caller context (auth, correlation)
│   └── index.ts              # Context utilities
├── grounding/                # Document grounding (attachments)
├── plugins/                  # Fastify plugins
│   ├── auth.ts               # Authentication (API key + HMAC)
│   ├── observability.ts      # Logging & telemetry
│   └── performance-monitoring.ts
├── prompts/                  # Prompt management system
│   ├── loader.ts             # Prompt loading
│   ├── store.ts              # Prompt storage (file/Braintrust)
│   └── stores/               # Storage backends
├── routes/                   # HTTP route handlers
│   ├── assist.draft-graph.ts # Primary draft endpoint
│   ├── assist.v1.*.ts        # V1 CEE endpoints
│   └── v1.status.ts          # Diagnostics endpoint
├── schemas/                  # Zod schemas & types
│   ├── assist.ts             # Request/response schemas
│   ├── graph.ts              # Graph data structures
│   └── cee.ts                # CEE-specific schemas
├── services/                 # Business logic
│   ├── repair.ts             # Graph repair logic
│   └── validateClient.ts     # Graph validation
├── utils/                    # Shared utilities
│   ├── telemetry.ts          # Logging, metrics, StatsD
│   ├── quota.ts              # Rate limiting (token bucket)
│   ├── hmac-auth.ts          # HMAC signature verification
│   ├── sse-state.ts          # SSE stream state management
│   └── feature-flags.ts      # Feature flag system
└── server.ts                 # Application entry point
```

---

## Request Flow

### Draft Graph Request (Non-Streaming)

```
Client                    Service                      LLM Provider
  │                         │                              │
  │  POST /assist/draft-graph                              │
  │ ─────────────────────▶  │                              │
  │                         │                              │
  │                    ┌────┴────┐                         │
  │                    │ Auth    │ (HMAC or API Key)       │
  │                    │ Plugin  │                         │
  │                    └────┬────┘                         │
  │                         │                              │
  │                    ┌────┴────┐                         │
  │                    │ Rate    │ (Token bucket)          │
  │                    │ Limit   │                         │
  │                    └────┬────┘                         │
  │                         │                              │
  │                    ┌────┴────┐                         │
  │                    │ Input   │ (Zod validation)        │
  │                    │ Valid.  │                         │
  │                    └────┬────┘                         │
  │                         │                              │
  │                    ┌────┴────┐                         │
  │                    │ Cost    │ (Token estimation)      │
  │                    │ Guard   │                         │
  │                    └────┬────┘                         │
  │                         │                              │
  │                    ┌────┴────┐  draftGraph()           │
  │                    │ LLM     │ ───────────────────────▶│
  │                    │ Adapter │                         │
  │                    │         │◀───────────────────────│
  │                    └────┬────┘  Graph + Usage          │
  │                         │                              │
  │                    ┌────┴────┐                         │
  │                    │ Graph   │ (DAG, limits)           │
  │                    │ Valid.  │                         │
  │                    └────┬────┘                         │
  │                         │                              │
  │                    ┌────┴────┐                         │
  │                    │ Repair  │ (if needed)             │
  │                    │ Logic   │                         │
  │                    └────┬────┘                         │
  │                         │                              │
  │  HTTP 200 + Graph       │                              │
  │ ◀───────────────────────│                              │
  │                         │                              │
```

### Streaming Request (SSE)

```
Client                    Service                      LLM Provider
  │                         │                              │
  │  POST /assist/draft-graph/stream                       │
  │  Accept: text/event-stream                             │
  │ ─────────────────────▶  │                              │
  │                         │                              │
  │                    [Auth + Rate Limit]                 │
  │                         │                              │
  │  HTTP 200 + SSE Headers │                              │
  │ ◀───────────────────────│                              │
  │                         │                              │
  │  event: stage           │                              │
  │  data: {"stage":"llm_start"}                           │
  │ ◀───────────────────────│                              │
  │                         │                              │
  │                         │  draftGraph()                │
  │                         │ ────────────────────────────▶│
  │                         │                              │
  │  event: stage           │                              │
  │  data: {"stage":"llm_complete"}                        │
  │ ◀───────────────────────│◀────────────────────────────│
  │                         │                              │
  │  event: stage           │                              │
  │  data: {"stage":"validation"}                          │
  │ ◀───────────────────────│                              │
  │                         │                              │
  │  event: result          │                              │
  │  data: {"graph":...}    │                              │
  │ ◀───────────────────────│                              │
  │                         │                              │
  │  event: done            │                              │
  │ ◀───────────────────────│                              │
```

---

## Key Components

### 1. Fastify Server (`server.ts`)

The HTTP server built on Fastify, configured with:
- **CORS**: Origin allowlist (configurable via `ALLOWED_ORIGINS`)
- **Helmet**: Security headers (HSTS, X-Frame-Options, etc.)
- **Rate Limiting**: Global + per-key limits
- **Compression**: gzip/brotli for responses

### 2. Authentication Plugin (`plugins/auth.ts`)

Two authentication methods (in priority order):
1. **HMAC Signature**: `X-Olumi-Signature` header with timestamp and nonce
2. **API Key**: `X-Olumi-Assist-Key` header or `Authorization: Bearer`

```typescript
// HMAC headers
X-Olumi-Signature: <hmac-sha256>
X-Olumi-Timestamp: <unix-ms>
X-Olumi-Nonce: <uuid>

// API key header
X-Olumi-Assist-Key: <api-key>
```

### 3. LLM Router (`adapters/llm/router.ts`)

Selects the appropriate LLM adapter based on:
1. Task-specific configuration
2. Environment variables (`LLM_PROVIDER`, `LLM_MODEL`)
3. Defaults (OpenAI for cost-effectiveness)

```typescript
// Get adapter for a task
const adapter = getAdapter('draft_graph');

// Use adapter
const result = await adapter.draftGraph(input, opts);
```

### 4. Centralized Config (`config/index.ts`)

All configuration via Zod-validated schema:

```typescript
import { config } from './config/index.js';

// Type-safe access
config.llm.provider      // 'openai' | 'anthropic' | 'fixtures'
config.auth.hmacSecret   // string | undefined
config.rateLimits.defaultRpm  // number
config.features.grounding     // boolean
```

---

## Configuration System

### Environment Variables

| Category | Variable | Default | Description |
|----------|----------|---------|-------------|
| **LLM** | `LLM_PROVIDER` | `openai` | LLM provider |
| | `OPENAI_API_KEY` | - | OpenAI API key |
| | `ANTHROPIC_API_KEY` | - | Anthropic API key |
| **Auth** | `ASSIST_API_KEYS` | - | Comma-separated API keys |
| | `HMAC_SECRET` | - | HMAC signing secret |
| **Limits** | `RATE_LIMIT_RPM` | `120` | Requests per minute |
| | `SSE_RATE_LIMIT_RPM` | `20` | SSE requests per minute |
| **Features** | `ENABLE_GROUNDING` | `false` | Document grounding |
| | `ENABLE_CLARIFIER` | `true` | Brief clarification |

### Config Reset for Tests

```typescript
import { _resetConfigCache } from './config/index.js';

beforeEach(() => {
  _resetConfigCache();
});
```

---

## LLM Adapter Layer

### Adapter Interface

```typescript
interface LLMAdapter {
  name: 'anthropic' | 'openai' | 'fixtures';
  model: string;

  draftGraph(input: DraftInput, opts: LLMOpts): Promise<DraftGraphResult>;
  clarifyBrief(input: ClarifyInput, opts: LLMOpts): Promise<ClarifyResult>;
  repairGraph(input: RepairInput, opts: LLMOpts): Promise<RepairResult>;
  // ... other methods
}
```

### Adapter Selection

```
┌─────────────────┐
│  getAdapter()   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│ Task Override?  │─Yes─▶│ Use Task Config  │
└────────┬────────┘     └──────────────────┘
         │No
         ▼
┌─────────────────┐     ┌──────────────────┐
│ LLM_PROVIDER?   │─Yes─▶│ Use Env Provider │
└────────┬────────┘     └──────────────────┘
         │No
         ▼
┌─────────────────┐
│ Use OpenAI      │
│ (default)       │
└─────────────────┘
```

### Failover

The `FailoverAdapter` wraps multiple adapters for resilience:

```typescript
const failover = new FailoverAdapter([
  new AnthropicAdapter('claude-3-5-sonnet'),
  new OpenAIAdapter('gpt-4o'),
]);

// First adapter fails → automatically tries second
await failover.draftGraph(input, opts);
```

---

## CEE Pipeline

The Cognitive Enhancement Engine (CEE) provides intelligent assistance:

```
┌─────────────────────────────────────────────────────────────────┐
│                        CEE Pipeline                              │
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│  │ Clarifier│───▶│  Draft   │───▶│ Validate │───▶│  Bias    │ │
│  │          │    │  Graph   │    │          │    │  Check   │ │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘ │
│                                                        │        │
│                                                        ▼        │
│                                              ┌──────────┐      │
│                                              │ Quality  │      │
│                                              │ Assess   │      │
│                                              └──────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### Pipeline Stages

1. **Clarifier**: Asks clarifying questions if brief is ambiguous
2. **Draft**: Generates initial decision graph
3. **Validate**: Ensures graph is valid DAG, within limits
4. **Repair**: Fixes validation issues (LLM or simple repair)
5. **Bias Check**: Detects cognitive biases
6. **Quality**: Assesses confidence and quality tier

---

## Authentication & Authorization

### HMAC Authentication Flow

```
Client                              Service
  │                                    │
  │  1. Create canonical string        │
  │     METHOD\nPATH\nTIMESTAMP\n     │
  │     NONCE\nBODY_HASH              │
  │                                    │
  │  2. Sign with HMAC-SHA256          │
  │                                    │
  │  3. Send request with headers:     │
  │     X-Olumi-Signature              │
  │     X-Olumi-Timestamp              │
  │     X-Olumi-Nonce                  │
  │ ─────────────────────────────────▶│
  │                                    │
  │                                    │  4. Verify timestamp (skew check)
  │                                    │  5. Check nonce (replay protection)
  │                                    │  6. Verify signature
  │                                    │
  │  Success or 403                    │
  │ ◀─────────────────────────────────│
```

### Rate Limiting

Token bucket implementation with:
- **Per-key quotas**: Each API key has independent limits
- **Dual-mode**: Redis (multi-instance) or memory (single instance)
- **SSE limits**: Stricter limits for streaming endpoints

---

## Streaming (SSE)

### SSE Event Types

| Event | Description |
|-------|-------------|
| `stage` | Progress indicator (llm_start, llm_complete, validation) |
| `result` | Final graph payload |
| `error` | Error details |
| `done` | Stream completion |

### Resume Support

For network interruptions:

```typescript
// Client gets resume token on connection
event: resume_token
data: {"token":"eyJ..."}

// Client reconnects with token
POST /assist/draft-graph/stream
X-Olumi-Resume-Token: eyJ...
```

---

## Runbook: Common Operations

### 1. Check Service Health

```bash
curl https://service.example.com/healthz
# {"ok":true,"version":"1.4.0","provider":"openai"}

curl https://service.example.com/v1/status
# Detailed diagnostics
```

### 2. Test Authentication

```bash
# API Key auth
curl -X POST https://service.example.com/assist/draft-graph \
  -H "X-Olumi-Assist-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"brief":"Test decision"}'
```

### 3. Monitor Rate Limits

```bash
curl https://service.example.com/v1/limits \
  -H "X-Olumi-Assist-Key: your-key"
# {"standard":{"tokens":118,"capacity":120},...}
```

### 4. Debug Request

```bash
# Get request ID from response header
curl -i https://service.example.com/assist/draft-graph ...
# X-Request-Id: 550e8400-e29b-41d4-a716-446655440000

# Search logs by request ID
grep "550e8400-e29b-41d4-a716-446655440000" service.log
```

### 5. Rotate API Keys

1. Add new key to `ASSIST_API_KEYS` (comma-separated)
2. Deploy change
3. Migrate clients to new key
4. Remove old key from `ASSIST_API_KEYS`
5. Deploy change

### 6. Emergency Rollback

```bash
# Render rollback (via dashboard or CLI)
render rollback --service assistants-service

# Or redeploy previous commit
git revert HEAD
git push origin main
```

### 7. Scale for Load

Render auto-scaling handles most cases. For manual scaling:
1. Increase instance count in Render dashboard
2. Monitor P95 latency and error rate
3. Scale down when load decreases

---

## Related Documentation

- [SLO.md](../operations/SLO.md) - Service level objectives
- [observability.md](../operations/observability.md) - Logging & monitoring
- [operator-runbook.md](../operations/operator-runbook.md) - Deployment guide
- [privacy-and-data-handling.md](../operations/privacy-and-data-handling.md) - Data policies
