# CEE (Contextual Evidence Engine) Documentation

The **Contextual Evidence Engine (CEE)** is the quality assessment and evidence management subsystem for the Olumi Assistants Service. It provides bias detection, evidence scoring, decision guidance, and quality classification for AI-generated decision graphs.

**For the complete documentation index**, see [Docs/README.md](../README.md).

---

## Quick Start

**New to CEE?** Start here:
1. **[CEE v1 Overview](CEE-v1.md)** - Core concepts, features, and API reference
2. **[CEE Maintainer's Guide](CEE-maintainers-guide.md)** - Internal architecture and development
3. **[CEE Recipes](CEE-recipes.md)** - Common usage patterns and examples

**Operating CEE in production?**
- **[CEE Operations Guide](CEE-ops.md)** - Day-to-day operations runbook
- **[CEE Runbook](CEE-runbook.md)** - Operational procedures and health checks
- **[CEE Incident Runbook](CEE-incident-runbook.md)** - Incident response procedures

---

## Documentation by Category

### Core Documentation

**[CEE v1 Overview](CEE-v1.md)**
- **Purpose:** Comprehensive CEE documentation covering all features and capabilities
- **Audience:** Developers, integrators, product managers
- **Contents:**
  - Core features (bias detection, evidence scoring, quality bands)
  - API reference for all CEE endpoints
  - Request/response schemas
  - Feature flags and configuration

**[CEE Maintainer's Guide](CEE-maintainers-guide.md)**
- **Purpose:** Internal architecture, development practices, and contribution guidelines
- **Audience:** CEE maintainers and contributors
- **Contents:**
  - System architecture and data flow
  - Code structure and module organization
  - Testing strategy and fixture management
  - Development workflow

**[CEE Recipes](CEE-recipes.md)**
- **Purpose:** Common CEE usage patterns and integration examples
- **Audience:** Frontend developers, API consumers
- **Contents:**
  - Example API requests and responses
  - Common integration patterns
  - Error handling and retry strategies

---

### Integration & Configuration

**[CEE Sandbox Integration](CEE-sandbox-integration.md)**
- **Purpose:** Integration guide for Scenario Sandbox frontend
- **Audience:** Frontend developers
- **Contents:**
  - API endpoint documentation
  - Client SDK usage
  - Error handling patterns
  - Feature flag integration

**[CEE Decision Review Orchestrator](CEE-decision-review-orchestrator.md)**
- **Purpose:** Request orchestration and coordination logic
- **Audience:** Backend developers, architects
- **Contents:**
  - Orchestrator architecture
  - Request flow and state management
  - LLM coordination patterns

**[CEE Limits & Budgets](CEE-limits-and-budgets.md)**
- **Purpose:** Rate limiting, quotas, and resource management
- **Audience:** Operators, developers
- **Contents:**
  - Per-feature rate limits
  - Cost budgets and thresholds
  - Quota configuration
  - Monitoring and alerting

---

### Operations & Monitoring

**[CEE Operations Guide](CEE-ops.md)**
- **Purpose:** Day-to-day operations runbook for production CEE deployment
- **Audience:** SRE, DevOps, operators
- **Contents:**
  - Health check procedures
  - Configuration management
  - Common operational tasks
  - Troubleshooting quick reference

**[CEE Runbook](CEE-runbook.md)**
- **Purpose:** Operational procedures and health monitoring
- **Audience:** SRE, operators
- **Contents:**
  - Service health indicators
  - Diagnostic procedures
  - Performance monitoring
  - Alert response procedures

**[CEE Incident Runbook](CEE-incident-runbook.md)**
- **Purpose:** Incident response procedures for CEE-specific failures
- **Audience:** On-call engineers, SRE
- **Contents:**
  - Incident classification
  - Response procedures
  - Escalation paths
  - Postmortem guidelines

**[CEE Telemetry Playbook](CEE-telemetry-playbook.md)**
- **Purpose:** Observability, metrics, and monitoring guidance
- **Audience:** SRE, operators, developers
- **Contents:**
  - Telemetry events reference
  - Metrics and dashboards
  - Alerting guidelines
  - Log analysis procedures

**[CEE Cost Telemetry](CEE-cost-telemetry.md)**
- **Purpose:** LLM cost tracking and analysis for CEE operations
- **Audience:** Operators, finance, engineering managers
- **Contents:**
  - Cost calculation methodology
  - Cost telemetry events
  - Budget monitoring
  - Cost optimization strategies

---

### Quality & Testing

**[CEE Calibration](CEE-calibration.md)**
- **Purpose:** Quality calibration and tuning procedures
- **Audience:** ML engineers, quality analysts
- **Contents:**
  - Quality band calibration
  - Evidence scoring thresholds
  - Bias detection tuning
  - Validation procedures

**[CEE Golden Journeys](CEE-golden-journeys.md)**
- **Purpose:** Test fixtures and regression test scenarios
- **Audience:** QA engineers, developers
- **Contents:**
  - Golden journey definitions
  - Test fixture data
  - Regression test scenarios
  - Acceptance criteria

**[CEE Baseline Performance](CEE-baseline-performance.md)**
- **Purpose:** Performance targets and benchmarking results
- **Audience:** Performance engineers, SRE
- **Contents:**
  - Performance baselines (p50, p95, p99)
  - Latency targets by endpoint
  - Throughput benchmarks
  - Performance regression tests

---

### Architecture & Design

**[ADR: CEE Streaming v1](ADR-CEE-streaming-v1.md)**
- **Purpose:** Architecture Decision Record for CEE streaming implementation
- **Audience:** Architects, senior engineers
- **Contents:**
  - Problem statement and context
  - Decision rationale
  - Alternatives considered
  - Consequences and trade-offs

---

## See Also

### Related Documentation
- **[Architecture Overview](../getting-started/architecture.md)** - Full system architecture
- **[Contributing Guide](../contributing.md)** - Development workflow and standards
- **[Frontend Integration](../FRONTEND_INTEGRATION.md)** - Complete API reference
- **[Incident Runbooks](../runbooks/)** - Service-wide incident response

### External Resources
- **Production Dashboard:** [Render.com](https://olumi-assistants-service.onrender.com)
- **GitHub Repository:** [olumi-assistants-service](https://github.com/Talchain/olumi-assistants-service)

---

**Last Updated:** 2025-11-22
**Maintained By:** Olumi Engineering Team
