# Olumi Assistants Service

[![Nightly Smoke](https://github.com/Talchain/olumi-assistants-service/actions/workflows/nightly-smoke.yml/badge.svg)](https://github.com/Talchain/olumi-assistants-service/actions/workflows/nightly-smoke.yml)

Production assistants service for Olumi platform (v1.3.0).

## Status

- Version: 1.3.0
- Production: https://olumi-assistants-service.onrender.com
- Tests: 544/544 passing
- Nightly smoke: A1-A5 PASS

## Quick Start

```bash
pnpm install
pnpm test
pnpm build
pnpm start
```

See [DEPLOYMENT_STATUS_v1.3.0.md](DEPLOYMENT_STATUS_v1.3.0.md) for deployment details.

## Smoke Tests

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
