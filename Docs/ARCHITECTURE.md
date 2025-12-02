# Architecture

Technical specification for the Olumi Assistants Service.

## Overview

AI-powered backend service that transforms strategic questions into structured decision graphs with quality assessment and evidence tracking.

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                   │
│    Web UI (Scenario)  │  Mobile  │  Engine (Legacy)             │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP/SSE
┌────────────────────────────▼────────────────────────────────────┐
│              OLUMI ASSISTANTS SERVICE                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  ROUTES                                                     │ │
│  │  /assist/draft-graph  |  /assist/stream  |  /v1/*          │ │
│  └─────────────────────────────┬──────────────────────────────┘ │
│  ┌─────────────────────────────▼──────────────────────────────┐ │
│  │  ORCHESTRATOR                                               │ │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────┐                │ │
│  │  │ Grounding│  │   CEE    │  │   Prompt   │                │ │
│  │  │ Pipeline │  │  Engine  │  │  Builder   │                │ │
│  │  └──────────┘  └──────────┘  └────────────┘                │ │
│  └─────────────────────────────┬──────────────────────────────┘ │
└────────────────────────────────┼────────────────────────────────┘
                    ┌────────────┴─────────────┐
              ┌─────▼─────┐              ┌─────▼─────┐
              │ Anthropic │              │   Redis   │
              │  Claude   │              │  (State)  │
              └───────────┘              └───────────┘
```

## Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20.x (ESM) |
| Framework | Fastify 5 |
| Validation | Zod 3 |
| Testing | Vitest |
| LLM Primary | Anthropic Claude 3.5 Sonnet |
| LLM Fallback | OpenAI GPT-4o |
| State Store | Redis (optional) |
| Package Manager | pnpm |

## Key Components

### Routes (`src/routes/`)

HTTP endpoints defining the public API:

| Endpoint | Description |
|----------|-------------|
| `POST /assist/draft-graph` | Generate decision graph |
| `GET /assist/stream` | SSE streaming |
| `POST /assist/resume` | Resume interrupted stream |
| `POST /v1/bias-check` | CEE bias detection |
| `GET /healthz` | Health check |

### CEE (`src/cee/`)

Contextual Evidence Engine for quality assessment:

- **Archetypes** - Decision type classification
- **Bias Detection** - Identifies potential biases
- **Evidence Scoring** - Assesses evidence quality
- **Quality Bands** - Classifies graph quality

### Adapters (`src/adapters/`)

External service integrations:

- **LLM Router** - Anthropic primary, OpenAI fallback
- **Caching** - Prompt caching (90% cost reduction)
- **Failover** - Automatic provider switching

### Services (`src/services/`)

Business logic:

- Graph validation
- Attachment processing (PDF, CSV)
- Evidence pack generation
- SSE state management

## Data Flow

```
1. Client POST /assist/draft-graph
   ├─ Brief: "Should we migrate to microservices?"
   └─ Attachments: [architecture.pdf]

2. Validation & Auth
   ├─ Zod schema validation
   ├─ API key authentication
   └─ Rate limit check

3. Grounding Pipeline
   ├─ Extract text from PDF (5K char limit)
   └─ Build evidence summary

4. LLM Call
   ├─ Construct prompt with evidence
   ├─ Stream response via SSE
   └─ Cache system prompt

5. CEE Assessment
   ├─ Classify decision archetype
   ├─ Detect biases
   └─ Score evidence quality

6. Response
   ├─ Complete graph with provenance
   └─ CEE quality assessment
```

## Authentication

### API Key

```
X-Olumi-Assist-Key: your-api-key
# or
Authorization: Bearer your-api-key
```

### HMAC Signature (Optional)

```
X-Olumi-Signature: sha256=<hex-signature>
X-Olumi-Timestamp: <unix-timestamp>
```

## Rate Limiting

| Scope | Limit |
|-------|-------|
| Global | 120 req/min per IP |
| Per-Key | 120 req/min per API key |
| CEE Features | 5 req/min per feature |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Primary LLM provider |
| `ASSIST_API_KEYS` | Yes | Comma-separated API keys |
| `REDIS_URL` | No | SSE resume state |
| `OPENAI_API_KEY` | No | Fallback LLM |
| `ALLOWED_ORIGINS` | No | CORS whitelist |

## Performance Targets

| Metric | Target |
|--------|--------|
| p95 Latency | < 8 seconds |
| Success Rate | > 99% |
| Baseline Load | 1 req/sec |

## Runtime Requirements

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20.x LTS | ESM modules, native fetch |
| pnpm | 8.x+ | Package manager |
| Redis | 6.x+ | Optional: SSE resume, quotas |
| PostgreSQL | 14+ | Optional: Prompt store |

## Deployment Topologies

### Single-Node (Development/Small Scale)

```
┌─────────────────────────────────┐
│  Single Node                    │
│  ├─ All features enabled        │
│  ├─ File-based prompt store     │
│  └─ In-memory SSE state         │
└─────────────────────────────────┘
```

**Safe features:** All CEE, streaming, grounding
**Limitations:** No SSE resume across restarts, no distributed quotas

### Multi-Node with Redis (Production)

```
┌─────────────────┐  ┌─────────────────┐
│  Node 1         │  │  Node 2         │
│  ├─ Stateless   │  │  ├─ Stateless   │
│  └─ Redis conn  │  │  └─ Redis conn  │
└────────┬────────┘  └────────┬────────┘
         │                    │
         └──────────┬─────────┘
                    │
              ┌─────▼─────┐
              │   Redis   │
              │  (State)  │
              └───────────┘
```

**Enables:** SSE resume, distributed quotas, prompt cache
**Required env:** `REDIS_URL`

### Enterprise (Multi-Node + PostgreSQL)

```
┌────────────┐  ┌────────────┐
│  Node 1    │  │  Node 2    │
└─────┬──────┘  └─────┬──────┘
      └───────┬───────┘
              │
    ┌─────────┼─────────┐
    │         │         │
┌───▼───┐ ┌───▼───┐ ┌───▼────┐
│ Redis │ │Postgres│ │ LLM    │
│(state)│ │(prompts)│ │providers│
└───────┘ └────────┘ └────────┘
```

**Enables:** Managed prompts with versioning, A/B experiments, audit logs
**Required env:** `REDIS_URL`, `DATABASE_URL`, `PROMPTS_STORE_TYPE=postgres`

## Deployment

Production runs on Render.com with auto-deploy from `main` branch.

```
┌────────────────────────────────┐
│  Render.com (Web Service)      │
│  ├─ Auto-deploy from main      │
│  ├─ Health check: /healthz     │
│  └─ Logs: Render dashboard     │
└────────────┬───────────────────┘
             │
       ┌─────▼─────┐
       │  Redis    │
       │ (Upstash) │
       └───────────┘
```

---

**Detailed Documentation:** [Docs/getting-started/architecture.md](Docs/getting-started/architecture.md)
