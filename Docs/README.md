# Olumi Assistants Service Documentation

Welcome to the Olumi Assistants Service documentation! This directory contains comprehensive documentation for developers, operators, and contributors.

## 🚀 Getting Started (Start Here!)

**New to the project?** Start with these documents in order:

1. **[Architecture Overview](getting-started/architecture.md)** - What is this service and how does it work?
2. **[Contributing Guide](contributing.md)** - How to contribute code, tests, and documentation
3. **[Frontend Integration](FRONTEND_INTEGRATION.md)** - Complete API reference for integrating with clients

**Setting up locally?**
- See the [Quick Start](../README.md#quick-start) in the root README
- Read [Staging Setup Instructions](STAGING_SETUP_INSTRUCTIONS.md) for environment configuration

---

## 📚 Documentation by Role

### For Developers

#### API & Integration
- **[Frontend Integration Guide](FRONTEND_INTEGRATION.md)** - Complete API reference with examples
- **[SSE Streaming API](SSE-RESUME-API.md)** - Server-Sent Events with resume capability
- **[Provider Configuration](cee/CEE-sandbox-integration.md)** - LLM provider setup (Anthropic, OpenAI)
- **[OpenAPI Validation](cee/CEE-v1.md)** - API schema and validation

#### CEE (Contextual Evidence Engine)
The CEE subsystem provides quality assessment and evidence management for AI-generated decisions.

📂 **[Complete CEE Documentation Index](cee/README.md)** - Organized guide to all CEE docs

- **[CEE v1 Overview](cee/CEE-v1.md)** - Core CEE documentation and concepts
- **[CEE Maintainer's Guide](cee/CEE-maintainers-guide.md)** - Internal architecture and development guide
- **[CEE Recipes](cee/CEE-recipes.md)** - Common CEE usage patterns
- **[CEE Calibration](cee/CEE-calibration.md)** - Quality calibration and tuning
- **[CEE Golden Journeys](cee/CEE-golden-journeys.md)** - Test fixtures for regression testing
- **[CEE Decision Review Orchestrator](cee/CEE-decision-review-orchestrator.md)** - Request orchestration
- **[CEE Sandbox Integration](cee/CEE-sandbox-integration.md)** - Integration with Scenario Sandbox
- **[CEE Limits & Budgets](cee/CEE-limits-and-budgets.md)** - Rate limiting and quotas
- **[CEE Telemetry Playbook](cee/CEE-telemetry-playbook.md)** - Observability and metrics
- **[CEE Cost Telemetry](cee/CEE-cost-telemetry.md)** - LLM cost tracking and analysis

#### Testing & Performance
- **[Baseline Performance Report](baseline-performance-report.md)** - Current performance baselines
- **[CEE Baseline Performance](cee/CEE-baseline-performance.md)** - CEE-specific performance targets
- **[Performance Testing Plan](PERFORMANCE-ANALYSIS.md)** - Load testing strategy
- **[Golden Brief Fixture Strategy](issues/golden-brief-fixture-strategy.md)** - Test data approach

#### Development Guides
- **[Contributing Guide](contributing.md)** - Code style, PR process, testing requirements
- **[ADR: CEE Streaming v1](ADR-cee/CEE-streaming-v1.md)** - Architecture decision record for streaming

### For Operators

#### Operations & Deployment
- **[Operator Runbook](cee/CEE-ops.md)** - Day-to-day operations guide
- **[CEE Runbook](cee/CEE-runbook.md)** - CEE-specific operations
- **[Render Deployment Guide](STAGING_SETUP_INSTRUCTIONS.md)** - Deploy to Render.com
- **[Production Grounding Flip Plan](PRODUCTION_GROUNDING_FLIP_PLAN.md)** - Feature flag management
- **[Release Rollback](RELEASE_ROLLBACK.md)** - How to roll back a release

#### Incident Response
- **[CEE Incident Runbook](cee/CEE-incident-runbook.md)** - CEE-specific incident response
- **[LLM Outage/Spike Runbook](runbooks/cee-llm-outage-or-spike.md)** - Handle LLM provider issues
- **[Buffer Pressure Runbook](runbooks/buffer-pressure.md)** - SSE buffer pressure scenarios
- **[Redis Incidents Runbook](runbooks/redis-incidents.md)** - Redis failure handling
- **[Resume Failures Runbook](runbooks/resume-failures.md)** - SSE resume troubleshooting

#### Monitoring & Observability
- **[CEE Telemetry Playbook](cee/CEE-telemetry-playbook.md)** - Metrics and monitoring
- **[CEE Cost Telemetry](cee/CEE-cost-telemetry.md)** - Cost tracking and alerting
- **[Production Validation (v1.1.1)](PROD_VALIDATION_v1.1.1.md)** - Production smoke tests

---

## 📁 Documentation Organization

### Subdirectories

- **[releases/](releases/)** - Release notes and version history
- **[runbooks/](runbooks/)** - Incident response playbooks for specific failure scenarios
- **[issues/](issues/)** - Technical investigations and problem analyses
- **[notes/](notes/)** - Development notes and feedback responses
- **[engine-handovers/](engine-handovers/)** - Legacy coordination docs with engine team

### By Topic

#### Release Notes & Version History

📂 **[Complete Release Documentation Index](releases/README.md)** - Organized guide to all releases

- **[V1.1.1 Completion Summary](releases/V1.1.1_COMPLETION_SUMMARY.md)**
- **[Go/No-Go Checklist v1.1.1](releases/GO_NOGO_CHECKLIST_v1.1.1.md)**
- **[PR-001: Fastify 5 Upgrade](releases/PR-001-fastify-5-upgrade.md)**
- **[PR-1 Completion Report](releases/PR-1-completion-report.md)**
- **[PR-1 Production Validation](releases/PR-1-production-validation.md)**
- **[PR Assistants Proxy v1](releases/PR-ASSISTANTS-PROXY-V1.md)**
- **[PR Assistants v1.1.1 Ops](releases/PR-ASSISTANTS-v1.1.1-ops.md)**
- **[PR Assistants v1.3.0 Test Infrastructure](releases/PR-ASSISTANTS-v1.3.0-test-infrastructure.md)**

#### Migration & Upgrade Guides
- **[Fastify 5 Migration Report](releases/fastify-5-migration-report.md)** - Fastify 4 → 5 upgrade details

#### Analysis & Reports
- **[Comprehensive Assessment Report](releases/COMPREHENSIVE-ASSESSMENT-REPORT.md)** - Detailed system assessment
- **[Performance Analysis](PERFORMANCE-ANALYSIS.md)** - Performance deep-dive
- **[Performance Analysis Summary](PERFORMANCE-ANALYSIS-SUMMARY.md)** - Executive summary
- **[Performance Action Items](PERFORMANCE-ACTION-ITEMS.md)** - Performance improvement tasks

---

## 🔍 Quick Reference

### Common Tasks

**Run the service locally:**
```bash
pnpm install
pnpm dev
```

**Run tests:**
```bash
pnpm test              # Unit + integration tests
pnpm test:live         # Live LLM tests (requires API key)
```

**Build and deploy:**
```bash
pnpm build
pnpm start
```

**Check service health:**
```bash
curl http://localhost:3101/healthz
```

### Key Concepts

- **Draft Graph** - AI-generated decision tree with provenance
- **SSE (Server-Sent Events)** - Streaming protocol with resume capability
- **CEE** - Contextual Evidence Engine for decision quality assessment
- **Grounding** - Attachment-based evidence (PDF, CSV, TXT)
- **Evidence Pack** - Privacy-preserving decision sharing

---

## 🤝 Contributing

See [contributing.md](contributing.md) for:
- Code style guidelines
- Testing requirements
- Pull request process
- Development workflow

---

## 📞 Getting Help

- **Issues:** Check [issues/](issues/) for known problems
- **Runbooks:** See [runbooks/](runbooks/) for incident response
- **Architecture Questions:** Start with [getting-started/architecture.md](getting-started/architecture.md)
- **API Questions:** See [FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md)

---

**Last Updated:** 2025-11-22
**Service Version:** 1.11.1
**Maintained By:** Olumi Engineering Team
