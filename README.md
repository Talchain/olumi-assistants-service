# Olumi Assistants Service

[![Nightly Smoke](https://github.com/Talchain/olumi-assistants-service/actions/workflows/nightly-smoke.yml/badge.svg)](https://github.com/Talchain/olumi-assistants-service/actions/workflows/nightly-smoke.yml)
[![Security Scanning](https://github.com/Talchain/olumi-assistants-service/actions/workflows/security-scanning.yml/badge.svg)](https://github.com/Talchain/olumi-assistants-service/actions/workflows/security-scanning.yml)

**AI-powered decision-making service for the Olumi platform**

The Olumi Assistants Service transforms strategic questions into structured decision graphs with provenance, evidence tracking, and quality assessment. It powers the Scenario Sandbox and other Olumi decision-making tools.

---

## 🚀 What Does This Service Do?

The Assistants Service is a **backend API** that helps teams make better decisions by:

- **Generating Decision Graphs** - Converts natural language briefs into structured decision trees with AI
- **Grounding in Evidence** - Incorporates insights from PDFs, CSVs, and documents
- **Assessing Quality** - Evaluates decision quality, detects biases, and provides improvement guidance
- **Streaming Results** - Real-time progress updates with resume capability for unreliable networks
- **Protecting Privacy** - Automatic PII detection and redaction for safe decision sharing

**Example:** Ask "Should we migrate to microservices?" with system architecture docs attached, and get back a structured graph exploring options, evidence, trade-offs, and recommendations.

---

## ⚡ Quick Start

### Prerequisites

- **Node.js** 20+ (recommended: 20.19.x)
- **pnpm** 8+
- **Anthropic API key** (for LLM calls)

### Installation

```bash
# Clone and install dependencies
git clone https://github.com/Talchain/olumi-assistants-service.git
cd olumi-assistants-service
pnpm install

# Set up environment
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### Running Locally

```bash
# Run tests (no API key needed)
pnpm test

# Build the service
pnpm build

# Start development server
pnpm dev

# Check health
curl http://localhost:3101/healthz
```

### Making Your First Request

```bash
curl -X POST http://localhost:3101/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{
    "brief": "Should we adopt a four-day work week?",
    "config": {"streaming": false}
  }'
```

---

## 📊 Status

| Metric | Value |
|--------|-------|
| **Version** | 1.11.1 (as of 2025-11-22) |
| **Production** | https://olumi-assistants-service.onrender.com |
| **Tests** | 544/544 passing ✅ |
| **Nightly Smoke** | A1-A5 PASS ✅ |
| **Test Coverage** | >90% |

---

## 🏗️ Architecture

```
Client (Web/Mobile/Engine)
    │
    ├─ HTTP/SSE ────────────────┐
    │                           │
    ▼                           ▼
┌────────────────────────────────────┐
│   Olumi Assistants Service         │
│   ┌─────────┐   ┌──────────┐      │
│   │ Routes  │──▶│   CEE    │      │
│   └────┬────┘   └──────────┘      │
│        │                           │
│   ┌────▼────────────┐              │
│   │  Orchestrator   │              │
│   └────┬────────────┘              │
└────────┼───────────────────────────┘
         │
    ┌────▼─────────┐   ┌─────────┐
    │  Anthropic   │   │  Redis  │
    │   Claude     │   │ (opt.)  │
    └──────────────┘   └─────────┘
```

**Key Components:**
- **Routes** - API endpoints (draft-graph, streaming, CEE features)
- **Orchestrator** - Request coordination and LLM interaction
- **CEE** - Contextual Evidence Engine (quality, bias detection, guidance)
- **Grounding** - Document processing (PDF, CSV, TXT)

📚 **[Full Architecture Documentation](Docs/getting-started/architecture.md)**

---

## ✨ Key Features

### AI-Assisted Decision Graphs
Powered by Anthropic Claude 3.5 Sonnet, the service generates structured decision trees with:
- Options and alternatives
- Evidence and provenance
- Trade-offs and risks
- Recommendations

### Document Grounding
Incorporate evidence from:
- **PDFs** - Extract and analyze text (5,000 chars/file)
- **CSVs** - Understand data structure and statistics
- **TXT** - Plain text documents

### Streaming with Resume
- **Real-time updates** via Server-Sent Events (SSE)
- **Resume capability** - Reconnect and continue after network interruptions
- **Progress events** - Track drafting, validation, completion

### CEE (Contextual Evidence Engine)
Advanced decision quality features:
- **Bias detection** - Identify potential biases
- **Evidence scoring** - Assess evidence quality
- **Quality bands** - Classify decisions (low/medium/high quality)
- **Guidance** - Actionable improvement suggestions
- **Team perspectives** - Analyze team disagreement

### Privacy & Security
- **API key authentication** with HMAC signatures
- **Automatic PII redaction** (emails, phones, sensitive data)
- **Rate limiting** - Per-key quotas (120 req/min)
- **Evidence packs** - Privacy-preserving decision sharing

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| **[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)** | Quick-start for new developers |
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | Technical specification |
| **[Docs/README.md](Docs/README.md)** | Full documentation index |

### For Developers

- **[Architecture Overview](Docs/getting-started/architecture.md)** - System design and components
- **[Developer Onboarding](Docs/getting-started/onboarding.md)** - Local setup guide
- **[API Reference](Docs/api/FRONTEND_INTEGRATION.md)** - Complete API documentation
- **[CEE Documentation](Docs/cee/CEE-v1.md)** - Contextual Evidence Engine details
- **[Contributing Guide](Docs/contributing.md)** - Development workflow and standards

### For Operators

- **[Operator Runbook](Docs/operations/operator-runbook.md)** - Day-to-day operations
- **[CEE Operations](Docs/cee/CEE-ops.md)** - CEE-specific operations
- **[Incident Runbooks](Docs/runbooks/)** - Troubleshooting playbooks

---

## 🧪 Testing

```bash
# Run all tests (unit + integration)
pnpm test

# Run with coverage report
pnpm test --coverage

# Run live LLM tests (requires ANTHROPIC_API_KEY)
pnpm test:live

# Run specific test file
pnpm test tests/unit/cost-calculation.test.ts

# Watch mode for development
pnpm test:watch
```

See [Contributing Guide](Docs/contributing.md#testing) for testing strategy and requirements.

---

## 🚀 Deployment

The service auto-deploys to Render.com from the `main` branch.

**Production:** https://olumi-assistants-service.onrender.com

**Required Environment Variables:**
- `ANTHROPIC_API_KEY` - Anthropic Claude API key (required for LLM)
- `ASSIST_API_KEYS` - Comma-separated API keys for client authentication (production)
  - Alternative: `ASSIST_API_KEY` - Single API key (local development)
- `ALLOWED_ORIGINS` - CORS whitelist for frontend origins (comma-separated)
  - Example: `https://olumi.app,https://app.olumi.app`
  - Use `*` only for local development

**Optional:**
- `REDIS_URL` - Redis connection for SSE resume (recommended for production)
- `OPENAI_API_KEY` - OpenAI API key for fallback LLM

See [Deployment Guide](Docs/STAGING_SETUP_INSTRUCTIONS.md) for full configuration.

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](Docs/contributing.md) for:

- Code style guidelines
- Pull request process
- Testing requirements
- Development workflow

**Quick Links:**
- [Architecture Overview](Docs/getting-started/architecture.md)
- [API Reference](Docs/api/FRONTEND_INTEGRATION.md)
- [CEE Documentation](Docs/cee/CEE-v1.md)

---

## 📞 Getting Help

- **Documentation:** [Docs/README.md](Docs/README.md)
- **Developer Guide:** [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)
- **Runbooks:** See [Docs/runbooks/](Docs/runbooks/) for incident response
- **Questions:** Open a GitHub issue

---

## 📋 Smoke Tests

Production smoke tests (`nightly-smoke` workflow) validate the live deployment against acceptance criteria A1-A5:

- **A1**: `/healthz` returns 200 with correct version
- **A2**: `/assist/draft-graph` requires authentication
- **A3**: Authenticated draft request returns valid graph (≥3 nodes, ≥2 edges)
- **A4**: Streaming draft emits DRAFTING→COMPLETE within 75s
- **A5**: Feature flags (grounding, critique, clarifier) enabled

### Running Smoke Tests

**Manual Dispatch** (always enabled):
```bash
gh workflow run nightly-smoke.yml
```

**Scheduled Runs** (opt-in):

Scheduled runs (Sundays 02:00 UTC) are **disabled by default**. To enable:

1. Go to repository Settings → Secrets and variables → Actions → Variables
2. Create a new repository variable:
   - Name: `SMOKE_SCHEDULE_ENABLED`
   - Value: `true`
3. Save the variable

To disable scheduled runs, either delete the variable or set its value to `false`.

**Note**: Manual workflow_dispatch runs always execute regardless of the `SMOKE_SCHEDULE_ENABLED` setting.

---

## 📄 License

[Add license information]

---

**Maintained by:** Olumi Engineering Team
**Last Updated:** 2025-11-27
**Service Version:** 1.11.1
