# Olumi Assistants Service

[![Tests](https://img.shields.io/badge/tests-544%2F544-brightgreen)]()
[![Version](https://img.shields.io/badge/version-1.11.1-blue)]()

AI-powered decision-making service for the Olumi platform. Transforms strategic questions into structured decision graphs with evidence tracking, bias detection, and quality assessment.

**Production:** https://olumi-assistants-service.onrender.com

---

## What It Does

Ask: "Should we migrate to microservices?"

Get back: Structured decision graph with options, evidence, trade-offs, and recommendations.

**Key Features:**
- **Decision Graphs** - AI-generated structured decisions
- **Document Grounding** - Incorporates PDFs, CSVs, docs
- **Quality Assessment** - Bias detection, evidence scoring
- **Streaming** - Real-time updates with resume capability
- **Privacy** - Automatic PII redaction

---

## Quick Start

### Prerequisites
- Node.js 20+, pnpm 8+
- Anthropic API key

### Install & Run
```bash
git clone https://github.com/Talchain/olumi-assistants-service.git
cd olumi-assistants-service
pnpm install
cp .env.example .env
# Add ANTHROPIC_API_KEY to .env

pnpm test    # Run tests
pnpm dev     # Start server (:3101)
```

### First Request
```bash
curl -X POST http://localhost:3101/assist/draft-graph \
  -H "X-Olumi-Assist-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"brief": "Should we adopt remote work?"}'
```

---

## Documentation

**New developers:** Start with [Getting Started Guide](Docs/GETTING_STARTED.md)

| Document | Purpose |
|----------|---------|
| [Getting Started](Docs/GETTING_STARTED.md) | Setup and first steps |
| [Architecture](Docs/ARCHITECTURE.md) | System design |
| [CEE Documentation](Docs/cee/CEE-v1.md) | Decision engine |
| [API Reference](Docs/api/FRONTEND_INTEGRATION.md) | All endpoints |
| [Developer Guide](Docs/DEVELOPER_GUIDE.md) | Development workflow |
| [Operator Runbook](Docs/runbooks/operator-runbook.md) | Operations |

Full index: [Docs/README.md](Docs/README.md)

---

## Architecture

```
Client --> Assistants Service --> CEE --> LLM (Claude)
                             |
                          Redis (optional)
```

**Components:**
- **Routes** - API endpoints
- **Orchestrator** - Request coordination
- **CEE** - Quality assessment, bias detection
- **Grounding** - Document processing

---

## Testing

```bash
pnpm test              # All tests
pnpm test:watch        # Watch mode
pnpm test:live         # Live LLM tests (requires API key)
pnpm test --coverage   # With coverage
```

**Status:** 544/544 passing

---

## Deployment

Auto-deploys from `main` to Render.com.

**Required env vars:**
- `ANTHROPIC_API_KEY` - Claude API key
- `ASSIST_API_KEY` - Client authentication
- `ALLOWED_ORIGINS` - CORS whitelist

See [Docs/api/STAGING_SETUP_INSTRUCTIONS.md](Docs/api/STAGING_SETUP_INSTRUCTIONS.md) for full configuration.

---

## Status

| Metric | Value |
|--------|-------|
| Version | 1.11.1 |
| Tests | 544/544 |
| Coverage | >90% |
| Production | Live |

---

## Contributing

See [Docs/contributing.md](Docs/contributing.md) for:
- Code style
- PR process
- Testing requirements

---

## Getting Help

- **Setup issues:** [Getting Started](Docs/GETTING_STARTED.md)
- **Architecture questions:** [ARCHITECTURE.md](Docs/ARCHITECTURE.md)
- **Production issues:** [Runbooks](Docs/runbooks/)
- **Bugs:** Open GitHub issue

---

**Maintained by:** Olumi Engineering
**Last Updated:** 2025-12-02
**Service Version:** 1.11.1
