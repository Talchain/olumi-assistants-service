# Olumi Assistants Service Documentation

## Quick Start

**New to this codebase?** Start with [Getting Started](GETTING_STARTED.md)

| Document | Audience | Description |
|----------|----------|-------------|
| [Getting Started](GETTING_STARTED.md) | New developers | Setup and first steps |
| [Architecture](ARCHITECTURE.md) | All | System design and technical spec |
| [Developer Guide](DEVELOPER_GUIDE.md) | Developers | Development workflow |
| [API Reference](api/FRONTEND_INTEGRATION.md) | Developers | Complete API documentation |
| [CEE Documentation](cee/CEE-v1.md) | Developers | Decision engine details |

---

## Documentation Structure

```
Docs/
├── GETTING_STARTED.md   # New developer entry point
├── ARCHITECTURE.md      # System design and technical spec
├── DEVELOPER_GUIDE.md   # Development workflow
├── api/                 # API documentation
│   ├── FRONTEND_INTEGRATION.md  # Complete API reference
│   ├── SSE-RESUME-API.md        # Streaming with resume
│   └── provider-configuration.md
├── cee/                 # CEE (Contextual Evidence Engine)
│   ├── CEE-v1.md        # CEE overview and contracts
│   ├── CEE-maintainers-guide.md
│   └── CEE-recipes.md   # Common usage patterns
├── runbooks/            # Incident response
│   ├── operator-runbook.md
│   ├── cee-llm-outage-or-spike.md
│   └── ...
├── archive/             # Historical documents
└── contributing.md      # How to contribute
```

---

## By Role

### Developers

**Getting Started:**
1. [Getting Started Guide](GETTING_STARTED.md) - Setup and first steps
2. [Architecture Overview](ARCHITECTURE.md) - System design
3. [Developer Guide](DEVELOPER_GUIDE.md) - Development workflow
4. [Contributing Guide](contributing.md) - Code style and PR process

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
- [Operator Runbook](runbooks/operator-runbook.md) - Standard procedures
- [CEE Operations](cee/CEE-ops.md) - CEE-specific operations

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

**Last Updated:** 2025-12-02
