# Olumi Assistants Service Documentation

## Quick Start

| Document | Audience | Description |
|----------|----------|-------------|
| [Architecture](getting-started/architecture.md) | All | System overview and data flow |
| [Developer Onboarding](getting-started/onboarding.md) | Developers | Local setup and development workflow |
| [Contributing](contributing.md) | Developers | Code style, PR process, testing |
| [API Reference](api/FRONTEND_INTEGRATION.md) | Developers | Complete API documentation |

---

## Documentation Structure

```
Docs/
├── getting-started/     # Start here
│   ├── architecture.md  # System design and data flow
│   └── onboarding.md    # Developer setup guide
├── api/                 # API documentation
│   ├── FRONTEND_INTEGRATION.md  # Complete API reference
│   ├── SSE-RESUME-API.md        # Streaming with resume
│   └── provider-configuration.md
├── cee/                 # CEE (Contextual Evidence Engine)
│   ├── CEE-v1.md        # CEE overview and contracts
│   ├── CEE-maintainers-guide.md
│   ├── CEE-recipes.md   # Common usage patterns
│   └── ...
├── operations/          # Production operations
│   ├── operator-runbook.md
│   ├── observability.md
│   └── ...
├── runbooks/            # Incident response
│   ├── cee-llm-outage-or-spike.md
│   ├── buffer-pressure.md
│   └── ...
├── archive/             # Historical documents
└── contributing.md      # How to contribute
```

---

## By Role

### Developers

**Getting Started:**
1. [Architecture Overview](getting-started/architecture.md) - Understand the system
2. [Developer Onboarding](getting-started/onboarding.md) - Set up your environment
3. [Contributing Guide](contributing.md) - Code style and PR process

**API Integration:**
- [Frontend Integration](api/FRONTEND_INTEGRATION.md) - Complete API reference
- [SSE Resume API](api/SSE-RESUME-API.md) - Streaming with resume capability
- [Provider Configuration](api/provider-configuration.md) - LLM provider setup

**CEE Development:**
- [CEE v1 Overview](cee/CEE-v1.md) - CEE contracts and envelopes
- [CEE Maintainers Guide](cee/CEE-maintainers-guide.md) - Internal architecture
- [CEE Recipes](cee/CEE-recipes.md) - Common patterns

### Operators

**Day-to-Day Operations:**
- [Operator Runbook](operations/operator-runbook.md) - Standard procedures
- [CEE Operations](cee/CEE-ops.md) - CEE-specific operations
- [Observability](operations/observability.md) - Monitoring and metrics

**Incident Response:**
- [LLM Outage Runbook](runbooks/cee-llm-outage-or-spike.md)
- [Buffer Pressure](runbooks/buffer-pressure.md)
- [Redis Incidents](runbooks/redis-incidents.md)
- [Resume Failures](runbooks/resume-failures.md)

---

## Common Commands

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run preflight checks
pnpm preflight

# Start dev server
pnpm dev

# Check health
curl http://localhost:3101/healthz
```

---

## Key Concepts

| Term | Description |
|------|-------------|
| **Draft Graph** | AI-generated decision tree with provenance |
| **CEE** | Contextual Evidence Engine - quality assessment |
| **SSE** | Server-Sent Events streaming with resume |
| **Grounding** | Document-based evidence (PDF, CSV, TXT) |
| **Evidence Pack** | Privacy-preserving decision sharing |

---

**Last Updated:** 2025-11-27
