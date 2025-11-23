# Operations Documentation

Complete operations, deployment, and production management documentation for the Olumi Assistants Service. This directory contains everything needed for day-to-day operations, deployments, and incident response.

**For the complete documentation index**, see [Docs/README.md](../README.md).

---

## Quick Start

**New operator?** Start here:
1. **[Operator Runbook](operator-runbook.md)** - Day-to-day operations guide
2. **[Render Deployment Guide](render-deploy.md)** - Deploy to Render.com
3. **[Production Readiness Checklist](production-readiness-checklist.md)** - Pre-launch checklist

**Responding to incidents?**
- **[Incident Runbooks](../runbooks/)** - Service-specific incident response playbooks
- **[CEE Incident Runbook](../cee/CEE-incident-runbook.md)** - CEE-specific incidents

---

## Documentation by Category

### Deployment & Setup

**[Render Deployment Guide](render-deploy.md)**
- **Purpose:** Complete deployment guide for Render.com platform
- **Audience:** Operators, DevOps, SRE
- **Contents:**
  - Initial deployment setup
  - Environment variable configuration
  - Auto-deploy from GitHub
  - Health check configuration
  - Custom domain setup

**[Render Setup Instructions](render-setup.md)**
- **Purpose:** Detailed Render.com configuration and troubleshooting
- **Audience:** Operators
- **Contents:**
  - Render-specific configuration
  - Build and start commands
  - Environment secrets management
  - Service health monitoring

**[Release Rollback](RELEASE_ROLLBACK.md)**
- **Purpose:** How to roll back a problematic release
- **Audience:** On-call engineers, SRE
- **Contents:**
  - Rollback procedures for Render.com
  - Version pinning strategies
  - Smoke test validation after rollback
  - Communication templates

---

### Production Management

**[Operator Runbook](operator-runbook.md)**
- **Purpose:** Day-to-day operations guide and common tasks
- **Audience:** SRE, operators, on-call engineers
- **Contents:**
  - Daily health check procedures
  - Common operational tasks
  - Configuration management
  - Troubleshooting quick reference
  - Escalation procedures

**[Production Readiness Checklist](production-readiness-checklist.md)**
- **Purpose:** Pre-launch checklist for production deployments
- **Audience:** Engineering managers, SRE leads
- **Contents:**
  - Security checklist
  - Performance validation
  - Monitoring and alerting setup
  - Documentation completeness
  - Team readiness assessment

**[Production Grounding Flip Plan](PRODUCTION_GROUNDING_FLIP_PLAN.md)**
- **Purpose:** Feature flag management for document grounding feature
- **Audience:** Product managers, operators
- **Contents:**
  - Feature flag rollout strategy
  - Monitoring during rollout
  - Rollback procedures
  - Success criteria

**[Production Validation (v1.1.1)](PROD_VALIDATION_v1.1.1.md)**
- **Purpose:** Production smoke test procedures and acceptance criteria
- **Audience:** QA, SRE
- **Contents:**
  - Smoke test scenarios (A1-A5)
  - Validation procedures
  - Expected results
  - Failure handling

---

### Monitoring & Observability

**[Observability Guide](observability.md)**
- **Purpose:** Monitoring, logging, and observability setup
- **Audience:** SRE, operators
- **Contents:**
  - Metrics and dashboards
  - Log aggregation and analysis
  - Tracing and distributed debugging
  - Alert configuration
  - Performance monitoring

**[CEE Telemetry Playbook](../cee/CEE-telemetry-playbook.md)**
- **Purpose:** CEE-specific telemetry and metrics (located in CEE docs)
- **Audience:** SRE, operators
- **See:** [Docs/cee/CEE-telemetry-playbook.md](../cee/CEE-telemetry-playbook.md)

---

### Security & Privacy

**[Privacy & Data Handling](privacy-and-data-handling.md)**
- **Purpose:** Privacy requirements and PII protection guidelines
- **Audience:** Operators, developers, compliance teams
- **Contents:**
  - PII redaction policies
  - Data retention policies
  - Compliance requirements (GDPR, CCPA)
  - Secure data handling procedures
  - Audit logging requirements

---

## Common Operational Tasks

### Daily Health Checks
```bash
# Check service health
curl https://olumi-assistants-service.onrender.com/healthz

# Check diagnostics (if enabled)
curl https://olumi-assistants-service.onrender.com/diagnostics \
  -H "X-Olumi-Assist-Key: $ASSIST_API_KEY"

# Check recent errors
gh workflow view nightly-smoke.yml --log
```

### Deployments
```bash
# Deploy to production (auto from main branch)
git push origin main

# Monitor deployment
gh run list --workflow=deploy.yml --limit 1
gh run watch

# Validate deployment
curl https://olumi-assistants-service.onrender.com/healthz
```

### Rollback
```bash
# Roll back to previous version on Render
# See RELEASE_ROLLBACK.md for detailed procedures
```

See **[Operator Runbook](operator-runbook.md)** for complete operational procedures.

---

## Incident Response

For service incidents, see:
- **[Incident Runbooks](../runbooks/)** - Service-wide incident playbooks
  - [LLM Outage/Spike Runbook](../runbooks/cee-llm-outage-or-spike.md)
  - [Buffer Pressure Runbook](../runbooks/buffer-pressure.md)
  - [Redis Incidents Runbook](../runbooks/redis-incidents.md)
  - [Resume Failures Runbook](../runbooks/resume-failures.md)
- **[CEE Incident Runbook](../cee/CEE-incident-runbook.md)** - CEE-specific incidents

---

## Production Environment

### Service URLs
- **Production API:** https://olumi-assistants-service.onrender.com
- **Health Check:** https://olumi-assistants-service.onrender.com/healthz
- **Render Dashboard:** [Render.com Dashboard](https://dashboard.render.com)

### Key Metrics
- **Uptime Target:** 99.9%
- **p95 Latency Target:** ≤ 8s for draft-graph requests
- **Success Rate:** ≥ 99% under baseline load

See **[Baseline Performance Report](../baseline-performance-report.md)** for current metrics.

---

## See Also

### Related Documentation
- **[CEE Operations Guide](../cee/CEE-ops.md)** - CEE-specific operations
- **[API Documentation](../api/README.md)** - API reference and integration
- **[Architecture Overview](../getting-started/architecture.md)** - System architecture
- **[Contributing Guide](../contributing.md)** - Development workflow

---

**Last Updated:** 2025-11-22
**Maintained By:** Olumi Engineering Team
