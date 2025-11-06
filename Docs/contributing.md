# Contributing to Olumi Assistants Service

This guide covers development workflow, testing practices, and deployment procedures.

---

## Development Setup

### Prerequisites
- **Node.js**: v20+ (recommended: v20.19.x)
- **pnpm**: v8+ (`npm install -g pnpm`)
- **Anthropic API Key**: Required for live LLM tests

### Installation

```bash
# Clone repository
git clone https://github.com/your-org/olumi-assistants-service.git
cd olumi-assistants-service

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

---

## Running Tests

This service has two types of tests:

### Unit Tests (No API Key Required)

**Fast, deterministic tests using mocks:**

```bash
# Run all unit tests
pnpm test

# Watch mode for development
pnpm test:watch
```

**What's included:**
- Schema validation tests
- Route handler tests with mocked LLM responses
- Graph manipulation tests
- Repair logic tests
- Golden brief archetype tests (fixture-based)

**What's excluded:**
- Adversarial input tests (require real API calls)
- Golden brief validation runner (requires real API calls)

---

### Live LLM Tests (API Key Required)

**Integration tests that make real Anthropic API calls:**

```bash
# Set required environment variables
export ANTHROPIC_API_KEY="sk-ant-api03-..."
export LIVE_LLM=1

# Run live tests
pnpm test:live
```

**What's included:**
- `tests/integration/adversarial.test.ts` - Adversarial input handling
- `tests/validation/golden-briefs-runner.test.ts` - Golden brief validation

**Why separate?**
1. **CI can pass without secrets** - Unit tests run in CI without API keys
2. **Cost control** - Live tests cost $0.001-0.002 per call
3. **Speed** - Unit tests run in ~1s, live tests take ~30s

**When to run live tests:**
- Before creating a pull request
- After modifying LLM interaction code
- When validating golden brief stability

---

## Testing Best Practices

### Writing New Tests

**For business logic / graph manipulation:**
```typescript
// Use unit tests with mocks
vi.mock("../../src/adapters/llm/anthropic.js", () => ({
  draftGraphWithAnthropic: vi.fn().mockResolvedValue({
    graph: { /* mock graph */ },
    rationales: [],
    usage: mockUsage,
  }),
}));
```

**For LLM integration validation:**
```typescript
// Add to test:live suite
// Check for LIVE_LLM environment variable
if (process.env.LIVE_LLM !== "1") {
  throw new Error("This test requires LIVE_LLM=1");
}
```

### Golden Briefs

**Golden briefs** are pre-recorded decision patterns used for:
1. **Unit tests**: Fast, deterministic archetype validation
2. **Live validation**: Comparing real LLM output against fixtures

**Location**: `tests/fixtures/golden-briefs/*.json`

**Adding a new golden brief:**

1. Create fixture:
```json
{
  "brief": "Your decision brief here...",
  "expected_response": {
    "graph": { "nodes": [...], "edges": [...] },
    "rationales": [...]
  },
  "metadata": {
    "archetype": "your-archetype-name",
    "description": "Brief description"
  }
}
```

2. Add to `tests/utils/fixtures.ts`:
```typescript
export const GOLDEN_BRIEFS = {
  // ...existing briefs
  YOUR_ARCHETYPE: "your-archetype-name",
} as const;
```

3. Update validation runner in `tests/validation/golden-briefs-runner.test.ts`

---

## Code Quality

### Linting and Type Checking

```bash
# Run ESLint
pnpm lint

# Fix auto-fixable issues
pnpm lint --fix

# Type check (no output = success)
pnpm typecheck
```

**Pre-commit checklist:**
- ✅ `pnpm lint` passes
- ✅ `pnpm typecheck` passes
- ✅ `pnpm test` passes (48 tests)
- ✅ `pnpm test:live` passes (if modifying LLM code)

---

## Local Development

### Running the Service Locally

```bash
# Development mode (auto-reload)
pnpm dev

# Production mode
pnpm build
pnpm start
```

**Environment variables:**
```bash
# Required
ANTHROPIC_API_KEY=sk-ant-api03-...

# Optional (defaults shown)
PORT=3101
NODE_ENV=development
ENGINE_BASE_URL=http://localhost:3100
ALLOWED_ORIGINS=*
BODY_LIMIT_BYTES=1048576
```

### Testing Against Local API

```bash
# Draft a graph
curl -X POST http://localhost:3101/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{
    "brief": "Should we hire full-time engineers or use contractors for our 6-month project?"
  }'
```

---

## Deployment

### Staging

Staging deploys automatically on push to `feat/fastify-5-upgrade`:

```bash
git push origin feat/fastify-5-upgrade
# Render auto-deploys: https://olumi-assistants-service-staging.onrender.com
```

**After deployment:**
1. Check service health: `https://olumi-assistants-service-staging.onrender.com/healthz`
2. Run Artillery baseline: `artillery run tests/perf/baseline.yml`
3. Validate p95 ≤ 8s

See [render-setup.md](./render-setup.md) for complete deployment guide.

### Production

Production deploys manually after validation:

1. ✅ All tests pass (`pnpm test` + `pnpm test:live`)
2. ✅ Staging performance validated (p95 ≤ 8s)
3. ✅ Code review approved
4. → Manually trigger deploy in Render dashboard

---

## Debugging

### Common Issues

**Service won't start:**
```
Error: ANTHROPIC_API_KEY environment variable is required
```
→ Add `ANTHROPIC_API_KEY` to `.env` or environment variables

**Tests fail with "LIVE_LLM=1 required":**
```
Error: Adversarial tests require LIVE_LLM=1
```
→ You're trying to run live tests without the flag:
```bash
LIVE_LLM=1 ANTHROPIC_API_KEY=sk-... pnpm test:live
```

**Vitest says "no test files found":**
→ vitest.config.ts excludes live tests by default
→ Use `pnpm test:live` to run them explicitly

---

## Performance Testing

### Running Artillery Locally

```bash
# Warm up the service first
curl -X POST http://localhost:3101/assist/draft-graph \
  -H "Content-Type: application/json" \
  -d '{"brief":"test warm-up"}'

# Run 5-minute baseline test
artillery run tests/perf/baseline.yml

# Generate HTML report
artillery report tests/perf/baseline-results.json \
  --output tests/perf/baseline-report.html

# Open report
open tests/perf/baseline-report.html
```

**Expected metrics:**
- p95 latency: ≤ 8s
- Error rate: 0%
- Throughput: ≥ 1 req/sec

See [performance-testing-plan.md](./performance-testing-plan.md) for detailed strategy.

---

## Git Workflow

### Branch Strategy

- `main` - Production (stable)
- `staging` - Pre-production validation
- `feat/*` - Feature branches

### Commit Messages

Follow conventional commits:

```
feat: add new golden brief archetype for technical debt
fix: resolve race condition in graph repair
docs: update contributing guide with test instructions
test: add coverage for edge case in provenance tracking
```

### Pull Request Process

1. Create feature branch from `staging`
2. Make changes + add tests
3. Ensure all checks pass:
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm test:live` (if modifying LLM code)
4. Push and create PR
5. CI runs automatically (unit tests only)
6. Request review
7. Merge to `staging` after approval
8. Validate in staging environment
9. Promote to `main` for production

---

## CI/CD

### GitHub Actions

**Job 1: Required Checks (No Secrets)**
- Runs on all PRs
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` (unit tests only)

**Job 2: Live LLM Tests (Optional)**
- Runs only when `ANTHROPIC_API_KEY` secret is set
- `pnpm test:live`
- Requires manual approval for external PRs

See `.github/workflows/ci.yml` for configuration.

---

## Telemetry

The service emits Datadog metrics for production monitoring:

**Events tracked:**
- `assist.draft.started` - Request received
- `assist.draft.stage` - Pipeline stages (clarify, LLM, repair, etc.)
- `assist.draft.completed` - Final response sent

**Tags:**
- `confidence_tier`: low/medium/high
- `draft_source`: anthropic/fallback
- `repair_triggered`: true/false

See [telemetry-aggregation-strategy.md](./telemetry-aggregation-strategy.md) for details.

---

## Getting Help

- **Bug reports**: Create issue in GitHub
- **Feature requests**: Discuss in team Slack
- **Questions**: Check [docs/](.) or ask in #eng-olumi

---

**Last Updated:** 2025-11-02
**Maintained By:** Olumi Engineering Team
