# Multi-Provider LLM Configuration Guide

**Version:** 1.0.0
**Last Updated:** 2025-11-03
**Status:** Production-Ready

---

## Overview

The Olumi Assistants Service supports multiple LLM providers through a flexible router architecture. This guide covers configuration, API key setup, cost optimization, and deployment best practices.

## Supported Providers

| Provider | Default Model | Use Case | Cost (per 1M tokens) |
|----------|--------------|----------|---------------------|
| **Anthropic** | `claude-3-5-sonnet-20241022` | Production (highest quality) | $3 input / $15 output |
| **OpenAI** | `gpt-4o-mini` | Cost optimization | $0.15 input / $0.60 output |
| **Fixtures** | `fixture-v1` | Testing (no API keys) | Free |

---

## Environment Variables

### Provider Selection

```bash
# LLM_PROVIDER: Choose which provider to use
# Options: anthropic | openai | fixtures
# Default: fixtures (safe for CI/testing)
LLM_PROVIDER=anthropic

# LLM_MODEL: Override default model for selected provider
# Options: auto (use provider default) | specific model ID
# Default: auto
LLM_MODEL=auto

# Examples:
LLM_PROVIDER=anthropic LLM_MODEL=claude-3-opus-20240229  # Use Opus
LLM_PROVIDER=openai LLM_MODEL=gpt-4o                      # Use GPT-4o
LLM_PROVIDER=fixtures                                     # Testing mode
```

### API Keys

**Anthropic:**
```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
```

**OpenAI:**
```bash
OPENAI_API_KEY=sk-proj-...
```

**⚠️ Security Warning:** Never commit API keys to version control. Use environment-specific secrets management:
- Local: `.env.local` (gitignored)
- Staging/Prod: Render.com environment variables or similar secrets manager

---

## Fixtures Adapter (Testing)

The **Fixtures** adapter allows testing without API keys by returning static, deterministic responses.

### When to Use Fixtures

✅ **Use fixtures for:**
- CI/CD pipelines
- Unit tests
- Integration tests
- Local development without API keys
- Performance baseline tests (structure validation only)

❌ **Never use fixtures for:**
- Production deployments
- Staging environments
- Quality validation with real LLMs
- Cost/latency benchmarking

### Fixture Behavior

**`draftGraph`:**
- Returns fixed 5-node graph (goal → decision → 2 options → outcome)
- Zero token usage
- Instant response (<1ms)

**`suggestOptions`:**
- Returns 2 generic options ("Option A", "Option B")
- Zero token usage

**`repairGraph`:**
- Returns input graph unchanged
- Adds rationale: "Fixture repair - no actual changes"

---

## Configuration File (Optional)

For advanced routing (e.g., different providers per task), create `config/providers.json`:

```json
{
  "defaults": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022"
  },
  "overrides": {
    "draft_graph": {
      "provider": "anthropic",
      "model": "claude-3-5-sonnet-20241022"
    },
    "suggest_options": {
      "provider": "openai",
      "model": "gpt-4o-mini"
    },
    "repair_graph": {
      "provider": "anthropic",
      "model": "claude-3-haiku-20240307"
    }
  }
}
```

**Precedence:** Task override → Config defaults → Environment vars → Hard defaults

**Location:** Set via `PROVIDERS_CONFIG_PATH` env var (default: `./config/providers.json`)

---

## Cost Optimization Strategies

### 1. Provider Comparison (Typical Draft Request)

For a typical request (2000 input tokens, 1200 output tokens):

| Provider | Model | Cost | Quality |
|----------|-------|------|---------|
| Anthropic | claude-3-5-sonnet-20241022 | **$0.024** | Highest |
| Anthropic | claude-3-haiku-20240307 | **$0.002** | Good |
| OpenAI | gpt-4o | **$0.017** | High |
| OpenAI | gpt-4o-mini | **$0.001** | Good |

**OpenAI `gpt-4o-mini` is ~24x cheaper than Claude Sonnet for similar quality.**

### 2. Hybrid Strategy (Config-Based)

Use different providers for different tasks:

```json
{
  "overrides": {
    "draft_graph": { "provider": "anthropic" },      // Quality-critical
    "suggest_options": { "provider": "openai" },     // Cost-optimize
    "repair_graph": { "provider": "openai" }         // Cost-optimize
  }
}
```

**Estimated Savings:** 40-60% cost reduction with minimal quality impact.

### 3. Model Selection by Complexity

| Complexity | Anthropic Model | OpenAI Model | When to Use |
|------------|----------------|--------------|-------------|
| **High** | claude-3-5-sonnet | gpt-4o | Complex multi-stakeholder decisions |
| **Medium** | claude-3-sonnet | gpt-4o-mini | Standard decision graphs |
| **Low** | claude-3-haiku | gpt-3.5-turbo | Simple repairs, suggestions |

---

## Deployment Checklist

### Local Development

```bash
# Option 1: Use fixtures (no API keys needed)
LLM_PROVIDER=fixtures pnpm dev

# Option 2: Use real provider
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
LLM_PROVIDER=anthropic pnpm dev
```

### CI/CD Pipeline

```yaml
# .github/workflows/test.yml
env:
  LLM_PROVIDER: fixtures  # Always use fixtures in CI
  NODE_ENV: test

jobs:
  test:
    - run: pnpm test
    - run: pnpm lint
    - run: pnpm typecheck
```

**✅ Required:** CI must use `LLM_PROVIDER=fixtures` to avoid API costs and maintain determinism.

### Staging Environment

**Render.com Environment Variables:**
```bash
LLM_PROVIDER=openai               # Cost-effective for staging
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=<secret>
NODE_ENV=staging
```

**Validation:**
```bash
# Verify provider selection
curl -X POST https://olumi-staging.onrender.com/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{"brief": "Test brief"}'

# Check logs for provider name
# Should see: "provider":"openai","model":"gpt-4o-mini"
```

### Production Environment

**Render.com Environment Variables:**
```bash
LLM_PROVIDER=anthropic            # Highest quality for production
LLM_MODEL=claude-3-5-sonnet-20241022
ANTHROPIC_API_KEY=<secret>
NODE_ENV=production
```

**⚠️ Critical:** Never deploy with `LLM_PROVIDER=fixtures` in production!

**Pre-Deploy Checklist:**
- [ ] `LLM_PROVIDER` is set to `anthropic` or `openai` (NOT `fixtures`)
- [ ] API key is configured in secrets manager
- [ ] Cost alerts are configured in Datadog
- [ ] Telemetry dashboards show non-zero `cost_usd` metrics

---

## Monitoring & Telemetry

### Cost Tracking

All providers report cost via the `assist.draft.completed` event:

```json
{
  "event": "assist.draft.completed",
  "draft_source": "openai",
  "draft_model": "gpt-4o-mini",
  "cost_usd": 0.00102,
  "usage": {
    "input_tokens": 2000,
    "output_tokens": 1200
  }
}
```

**Datadog Metric:** `olumi.assist.draft.cost_usd` (tagged by provider, model)

### Pricing Tables

**Anthropic:**
- `claude-3-5-sonnet-20241022`: $3 / $15 per 1M tokens
- `claude-3-opus-20240229`: $15 / $75 per 1M tokens
- `claude-3-sonnet-20240229`: $3 / $15 per 1M tokens
- `claude-3-haiku-20240307`: $0.25 / $1.25 per 1M tokens

**OpenAI:**
- `gpt-4o`: $2.50 / $10 per 1M tokens
- `gpt-4o-mini`: $0.15 / $0.60 per 1M tokens
- `gpt-4-turbo`: $10 / $30 per 1M tokens
- `gpt-4`: $30 / $60 per 1M tokens
- `gpt-3.5-turbo`: $0.50 / $1.50 per 1M tokens

**Fixtures:** $0 (no API calls)

**Note:** Pricing as of January 2025. Update [src/utils/telemetry.ts](../src/utils/telemetry.ts#L70-L143) if providers change pricing.

### Cache Hit Tracking

**Anthropic** supports prompt caching:
- `cache_read_input_tokens`: Tokens read from cache (90% discount)
- Metric: `prompt_cache_hit: true/false` in telemetry

**OpenAI** does not currently support prompt caching:
- `cache_read_input_tokens` always 0

---

## Troubleshooting

### Issue: Cost shows $0 in telemetry

**Symptoms:**
- `cost_usd: 0` in logs
- Datadog cost histogram is flat

**Diagnosis:**
```bash
# Check provider and model in logs
grep "draft_source" logs/app.log
# Should NOT see: "draft_source":"fixtures"
```

**Resolution:**
1. Verify `LLM_PROVIDER` is NOT set to `fixtures`
2. Check model is in pricing table ([telemetry.ts](../src/utils/telemetry.ts#L70-L143))
3. If using custom model, add pricing to `ANTHROPIC_PRICING` or `OPENAI_PRICING`

### Issue: API key errors

**Symptoms:**
- 401 Unauthorized errors
- "API key not found" errors

**Resolution:**
```bash
# Anthropic
echo $ANTHROPIC_API_KEY  # Should start with sk-ant-
export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
echo $OPENAI_API_KEY     # Should start with sk-proj- or sk-
export OPENAI_API_KEY=sk-proj-...
```

### Issue: Unexpected provider used

**Symptoms:**
- Expecting OpenAI but seeing Anthropic costs
- Vice versa

**Diagnosis:**
```bash
# Check precedence:
# 1. Config file overrides (if exists)
cat config/providers.json

# 2. Environment variables
echo $LLM_PROVIDER
echo $LLM_MODEL

# 3. Hard defaults (fixtures)
```

**Resolution:**
- Set `LLM_PROVIDER` env var explicitly
- Remove `config/providers.json` if not using task-specific routing
- Check logs for "Using provider from [source]" messages

---

## Migration Guide

### From Anthropic-Only to Multi-Provider

**Step 1:** Add OpenAI API key
```bash
export OPENAI_API_KEY=sk-proj-...
```

**Step 2:** Test with OpenAI
```bash
LLM_PROVIDER=openai pnpm test
```

**Step 3:** Deploy to staging
```bash
# Render.com: Set environment variables
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=<secret>
```

**Step 4:** Monitor costs for 1 week
- Compare Datadog cost metrics
- Validate quality with golden briefs

**Step 5:** Deploy to production (if satisfied)

### From Fixtures to Production

**⚠️ Critical Steps:**

1. **Never skip staging validation:**
   ```bash
   # Test staging with real LLM first
   PERF_TARGET_URL=https://staging.olumi.ai pnpm perf:baseline
   ```

2. **Set production provider:**
   ```bash
   # Render.com Production
   LLM_PROVIDER=anthropic  # or openai
   ANTHROPIC_API_KEY=<secret>
   ```

3. **Verify deployment:**
   ```bash
   # Check first production request
   curl -X POST https://api.olumi.ai/assist/draft-graph -d '{"brief":"test"}'
   # Verify: draft_source is NOT "fixtures"
   ```

4. **Monitor telemetry:**
   - Datadog: `olumi.assist.draft.cost_usd > 0`
   - Logs: No "Unknown model" warnings

---

## API Reference

See [router.ts](../src/adapters/llm/router.ts) for implementation details.

### `getAdapter(task?: string): LLMAdapter`

Get adapter for a specific task (uses routing logic).

```typescript
import { getAdapter } from './adapters/llm/router.js';

const adapter = getAdapter('draft_graph');
const result = await adapter.draftGraph(
  { brief: "Should we expand?", docs: [], seed: 17 },
  { requestId: 'req_123', timeoutMs: 15000 }
);
```

### `getAdapterForProvider(provider, model?): LLMAdapter`

Get adapter for specific provider (bypass routing).

```typescript
import { getAdapterForProvider } from './adapters/llm/router.js';

const anthropic = getAdapterForProvider('anthropic', 'claude-3-5-sonnet-20241022');
const openai = getAdapterForProvider('openai', 'gpt-4o-mini');
const fixtures = getAdapterForProvider('fixtures');
```

### `resetAdapterCache(): void`

Clear adapter instance cache (useful for testing).

```typescript
import { resetAdapterCache } from './adapters/llm/router.js';

beforeEach(() => {
  resetAdapterCache();
});
```

---

## Related Documentation

- [Production Readiness Checklist](production-readiness-checklist.md)
- [Telemetry Strategy](telemetry-strategy.md)
- [Performance Testing Guide](../tests/perf/README.md)
- [OpenAPI Validation](openapi-validation-guide.md)

---

**Questions?** Check troubleshooting section or review [router implementation](../src/adapters/llm/router.ts).
