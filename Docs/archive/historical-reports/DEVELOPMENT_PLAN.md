# Olumi Assistants Service - Enterprise-Grade Development Plan

**Document Version:** 1.0
**Created:** 2025-11-24
**Status:** Active
**Current Codebase Grade:** A- (87/100)
**Target Grade:** A+ (95/100)

---

## Executive Summary

This development plan outlines a systematic approach to elevate the Olumi Assistants Service from **A- (87/100)** to **A+ (95/100)** enterprise-grade standards. The plan is derived from a comprehensive codebase review covering architecture, security, performance, testing, accessibility, dependency health, and code quality.

### Current State Assessment

**Strengths:**
- ✅ Excellent security implementation (HMAC auth, PII redaction, rate limiting)
- ✅ Comprehensive test coverage (544/544 passing, >90% coverage)
- ✅ Production-hardened error handling and observability
- ✅ Strong architectural separation of concerns
- ✅ Redis-backed resilience with memory fallbacks
- ✅ Multi-provider LLM failover support

**Critical Issues:** 5 dependency vulnerabilities (2 HIGH, 3 MODERATE)

**Primary Gaps:**
- Dependency management automation
- Published SDK for developers
- Performance monitoring instrumentation
- E2E test coverage
- Documentation completeness

### Grading Breakdown

| Category | Current | Target | Priority |
|----------|---------|--------|----------|
| Architecture | A- (90) | A (92) | Medium |
| Security | A (95) | A+ (98) | Critical |
| Performance | B+ (85) | A- (90) | High |
| Testing | A (94) | A+ (96) | High |
| Accessibility | B+ (85) | A- (90) | Medium |
| Dependency Health | C+ (77) | A- (90) | Critical |
| Code Quality | A- (88) | A (92) | Medium |

---

## Phase 1: Critical Security (This Week)

**Goal:** Fix all dependency vulnerabilities and establish security baseline
**Duration:** 3-5 days
**Impact:** Security grade C+ → A

### Tasks

#### 1.1 Update Playwright Dependency (HIGH Severity)
**Issue:** SSL certificate verification bypass (CVE-2025-XXXX)
**Path:** `artillery > artillery-engine-playwright > playwright`
**Current:** `<1.55.1`
**Target:** `>=1.55.1`

```bash
# Update artillery to pull latest playwright
pnpm update artillery@latest

# OR override playwright version if artillery doesn't update
pnpm add -D playwright@latest
```

**Acceptance Criteria:**
- [ ] `playwright >= 1.55.1` in `pnpm-lock.yaml`
- [ ] Artillery performance tests pass (`pnpm perf:baseline`)
- [ ] No regression in test execution time

**Testing Requirements:**
```bash
# Run performance tests
PERF_TARGET_URL=http://localhost:3000 PERF_DURATION_SEC=60 PERF_RPS=1 pnpm perf:baseline

# Verify Playwright functionality
pnpm test tests/perf/
```

**Rollback Plan:** Revert `pnpm-lock.yaml` if tests fail

---

#### 1.2 Update Archiver Dependency (HIGH Severity)
**Issue:** Command injection via glob CLI (CVE-2025-XXXX)
**Path:** `archiver > archiver-utils > glob`
**Current:** `glob 10.2.0-10.4.x`
**Target:** `glob >= 10.5.0` (via archiver update)

```bash
pnpm update archiver@latest
```

**Acceptance Criteria:**
- [ ] `archiver >= 7.0.2` (or latest) in package.json
- [ ] `glob >= 10.5.0` in transitive dependencies
- [ ] Evidence pack generation tests pass

**Testing Requirements:**
```bash
# Test evidence pack functionality
pnpm test tests/unit/evidence-pack.test.ts
pnpm test tests/integration/cee.evidence.test.ts

# Manual smoke test
node -e "const { generateEvidencePack } = require('./dist/src/utils/evidence-pack.js'); console.log('OK');"
```

**Rollback Plan:** Pin archiver to previous version if breaking changes detected

---

#### 1.3 Update Vitest/Esbuild Dependencies (MODERATE Severity)
**Issue:** CORS bypass in esbuild dev server (CVE-2025-XXXX)
**Path:** `vitest > vite > esbuild`
**Current:** `esbuild <=0.24.2`
**Target:** `esbuild >= 0.25.0`

```bash
pnpm update vitest@latest --save-dev
pnpm update vite@latest --save-dev
```

**Acceptance Criteria:**
- [ ] `vitest >= 1.6.1` (or latest 1.x/2.x)
- [ ] `esbuild >= 0.25.0` in transitive dependencies
- [ ] All 544 tests pass
- [ ] Test execution time regression < 10%

**Testing Requirements:**
```bash
# Full test suite
pnpm test

# Specific test categories
pnpm test:unit
pnpm test:integration
pnpm test:chaos

# Measure test duration
time pnpm test
```

**Rollback Plan:** Revert vitest if test failures occur; investigate test-specific issues

---

#### 1.4 Update Swagger CLI / js-yaml (MODERATE Severity)
**Issue:** Prototype pollution in js-yaml merge (CVE-2020-13822)
**Path:** `@apidevtools/swagger-cli > js-yaml`
**Current:** `js-yaml < 3.14.2` and `4.0.0-4.1.0`
**Target:** `js-yaml >= 4.1.1`

```bash
pnpm update @apidevtools/swagger-cli@latest --save-dev

# If swagger-cli doesn't update js-yaml, override:
pnpm add -D js-yaml@latest
```

**Acceptance Criteria:**
- [ ] `js-yaml >= 4.1.1` in all dependency paths
- [ ] OpenAPI validation passes (`pnpm openapi:validate`)
- [ ] Generated types match (`pnpm openapi:generate`)

**Testing Requirements:**
```bash
# Validate OpenAPI spec
pnpm openapi:validate

# Regenerate types and verify no diff
pnpm openapi:generate
git diff src/generated/openapi.d.ts

# Run validation tests
pnpm test tests/validation/
```

**Rollback Plan:** Use pnpm overrides if swagger-cli breaks

---

#### 1.5 Full Test Suite Validation
**Goal:** Ensure no regressions from dependency updates
**Validation Matrix:**

| Test Category | Command | Expected |
|--------------|---------|----------|
| Unit Tests | `pnpm test:unit` | 62 files pass |
| Integration Tests | `pnpm test:integration` | 49 files pass |
| Chaos Tests | `pnpm test:chaos` | 4 files pass |
| Validation Tests | `pnpm test:validation` | 7 files pass |
| Full Suite | `pnpm test` | 544/544 pass |
| TypeScript | `pnpm typecheck` | 0 errors |
| Linting | `pnpm lint` | 0 errors |

**Acceptance Criteria:**
- [ ] All 544 tests pass
- [ ] No TypeScript errors
- [ ] No ESLint errors
- [ ] Test execution time < 5 minutes (CI)
- [ ] No new test flakiness detected

**Performance Baseline:**
- Unit tests: < 10s
- Integration tests: < 2 min
- Full suite: < 3 min

---

#### 1.6 Security Audit Verification
**Goal:** Confirm 0 vulnerabilities at moderate+ severity

```bash
# Run audit
pnpm audit --audit-level=moderate

# Expected output: "found 0 vulnerabilities"
```

**Acceptance Criteria:**
- [ ] `pnpm audit --audit-level=moderate` reports 0 vulnerabilities
- [ ] `pnpm audit --audit-level=high` reports 0 vulnerabilities
- [ ] `pnpm-lock.yaml` committed with updated dependencies
- [ ] CHANGELOG.md updated with security fixes

**Documentation Requirements:**
- [ ] Update CHANGELOG.md with vulnerability fixes
- [ ] Document any breaking changes in dependency updates
- [ ] Create release notes for security patch version

---

### Phase 1 Completion Criteria

**Definition of Done:**
- [ ] All 5 vulnerabilities resolved
- [ ] All 544 tests passing
- [ ] TypeScript and ESLint clean
- [ ] Performance baseline maintained (< 10% regression)
- [ ] Security audit shows 0 moderate+ vulnerabilities
- [ ] CHANGELOG.md updated
- [ ] PR merged to main with security fixes

**Risk Assessment:**
- **Low Risk:** Playwright (dev dependency, isolated)
- **Low Risk:** esbuild (dev dependency, test framework)
- **Medium Risk:** archiver (runtime dependency, evidence packs)
- **Low Risk:** js-yaml (dev dependency, OpenAPI validation)

**Rollback Trigger:** Any test failure or >10% performance regression

---

## Phase 2: Automation & Infrastructure (Sprint 1)

**Goal:** Establish automation and monitoring infrastructure
**Duration:** 1-2 weeks
**Impact:** Dependency Health C+ → A-, Performance B+ → A-

### 2.1 Automated Dependency Management

#### Create Dependabot Configuration
**File:** `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
    open-pull-requests-limit: 10
    groups:
      production-dependencies:
        dependency-type: "production"
        update-types:
          - "minor"
          - "patch"
      development-dependencies:
        dependency-type: "development"
        update-types:
          - "minor"
          - "patch"
    labels:
      - "dependencies"
      - "automated"
    reviewers:
      - "paulslee"
    commit-message:
      prefix: "chore(deps)"
```

**Acceptance Criteria:**
- [ ] Dependabot enabled on GitHub repo
- [ ] First PR batch created (within 24h)
- [ ] PR descriptions include changelog links
- [ ] CI passes on Dependabot PRs
- [ ] Security advisories trigger immediate PRs

**Windsurf Enhancement:**
> Group prod vs dev deps separately; set reasonable PR limits (10) to avoid overwhelming maintainers.

**Testing:**
- [ ] Manually trigger Dependabot via GitHub Actions
- [ ] Verify PR creation and CI integration
- [ ] Test merge workflow (squash + delete branch)

---

#### Add pnpm-lock.yaml Integrity Check to CI
**File:** `.github/workflows/ci.yml`

```yaml
- name: Verify lockfile integrity
  run: pnpm install --frozen-lockfile

- name: Check for dependency drift
  run: |
    if ! git diff --quiet pnpm-lock.yaml; then
      echo "❌ pnpm-lock.yaml has uncommitted changes"
      exit 1
    fi
```

**Acceptance Criteria:**
- [ ] CI fails if pnpm-lock.yaml is out of sync
- [ ] CI fails if lockfile has uncommitted changes
- [ ] Documentation updated (CONTRIBUTING.md)

---

### 2.2 Publish Official TypeScript SDK

**Goal:** Publish `@olumi/assistants-sdk` to npm registry

#### Tasks
1. **Review sdk/typescript/ implementation**
   - [ ] Verify API coverage (all endpoints)
   - [ ] Add TypeScript strict mode
   - [ ] Add JSDoc comments
   - [ ] Add usage examples in README

2. **Add build pipeline**
   ```bash
   cd sdk/typescript
   pnpm build        # TypeScript → dist/
   pnpm test         # Run SDK tests
   pnpm pack         # Verify package contents
   ```

3. **Publish to npm**
   ```bash
   npm login --scope=@olumi
   npm publish --access public
   ```

4. **Create documentation**
   - [ ] sdk/typescript/README.md with quickstart
   - [ ] sdk/typescript/EXAMPLES.md with use cases
   - [ ] Link from main README.md

**Acceptance Criteria:**
- [ ] Package published to npm as `@olumi/assistants-sdk@1.0.0`
- [ ] Installation works: `pnpm add @olumi/assistants-sdk`
- [ ] TypeScript types included and working
- [ ] All SDK tests pass
- [ ] Documentation complete with examples
- [ ] Version badge in README

**Windsurf Enhancement:**
> SDK is high ROI; prioritize wiring a publish pipeline to npm. Include auth (HMAC + API key), SSE resume, and error.v1 handling.

---

### 2.3 Performance Monitoring

**Goal:** Instrument key operations with metrics and alerts

#### Add Performance Plugin
**File:** `src/plugins/performance-monitoring.ts`

```typescript
import type { FastifyPluginAsync } from 'fastify';
import { logger } from '../utils/simple-logger.js';

export const performanceMonitoring: FastifyPluginAsync = async (app) => {
  // Track request start time
  app.addHook('onRequest', async (request) => {
    (request as any).startTime = Date.now();
  });

  // Emit metrics on response
  app.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - ((request as any).startTime || Date.now());

    logger.info({
      event: 'request.completed',
      method: request.method,
      url: request.url,
      route: request.routerPath,
      status_code: reply.statusCode,
      duration_ms: duration,
      // CEE-specific metrics
      cee_route: request.url.startsWith('/assist/v1/'),
      request_id: reply.getHeader('x-request-id'),
    });

    // Emit StatsD metrics if configured
    if (process.env.STATSD_HOST) {
      const tags = [
        `route:${request.routerPath}`,
        `method:${request.method}`,
        `status:${reply.statusCode}`,
      ];
      // statsD.timing('http.request.duration', duration, tags);
    }
  });
};
```

**Metrics to Track (Windsurf Recommendations):**
- **CEE Route Latency Histograms:**
  - `cee.route.duration` (p50, p95, p99) per route
  - `/assist/v1/draft-graph`, `/assist/v1/bias-check`, etc.

- **ISL Integration Metrics:**
  - `isl.call.duration` (success, timeout, error)
  - `isl.call.result` (success, timeout, validation_error, circuit_open)
  - `isl.circuit_breaker.state` (open, closed)
  - `isl.circuit_breaker.events` (opened, closed, reset)

- **Redis/Cache Metrics:**
  - `redis.operation.duration` (get, set, del)
  - `redis.connection.status` (connected, disconnected)
  - `cache.hit_rate` (LLM cache, quota cache)

- **LLM Provider Metrics:**
  - `llm.call.duration` per provider (anthropic, openai, fixtures)
  - `llm.token.usage` (prompt_tokens, completion_tokens)
  - `llm.failover.triggered` (count)

**Acceptance Criteria:**
- [ ] Performance plugin registered in server.ts
- [ ] Metrics logged for all requests
- [ ] StatsD integration (optional, behind flag)
- [ ] Grafana dashboard JSON template (Docs/observability/grafana.json)
- [ ] Alerts configured for p99 > 30s (CEE routes)

**Testing:**
```bash
# Local metrics validation
pnpm dev &
curl http://localhost:3000/healthz
# Check logs for 'request.completed' event

# Load test with metrics
PERF_TARGET_URL=http://localhost:3000 pnpm perf:baseline
# Verify metrics emitted
```

---

### 2.4 E2E Testing

**Goal:** Add Playwright E2E tests for SSE client flows

#### Setup Playwright
```bash
pnpm add -D @playwright/test
npx playwright install chromium
```

#### Create E2E Test Suite
**File:** `tests/e2e/sse-client.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('SSE Client Flow', () => {
  test('should stream events and handle reconnection', async ({ page }) => {
    // Start local server
    await page.goto('http://localhost:3001'); // examples/react-sse-client

    // Submit request
    await page.fill('[data-testid="brief-input"]', 'Test brief');
    await page.click('[data-testid="submit-button"]');

    // Verify streaming events
    await expect(page.locator('[data-testid="event-log"]')).toContainText('graph.started');

    // Simulate network interruption
    await page.route('**/*', route => route.abort());
    await page.waitForTimeout(2000);

    // Restore network and verify resume
    await page.unroute('**/*');
    await expect(page.locator('[data-testid="event-log"]')).toContainText('graph.completed');
  });
});
```

**Test Scenarios:**
1. **Happy Path:**
   - [ ] Stream events from start to completion
   - [ ] Verify all event types received
   - [ ] Verify final graph rendered

2. **Network Interruption:**
   - [ ] Disconnect mid-stream
   - [ ] Verify resume with Last-Event-ID
   - [ ] Verify no duplicate events

3. **Error Handling:**
   - [ ] Invalid input → error.v1 response
   - [ ] Rate limit → 429 with retry-after
   - [ ] Auth failure → 403 with clear message

**Acceptance Criteria:**
- [ ] 3+ E2E test scenarios implemented
- [ ] Tests run in CI (GitHub Actions)
- [ ] Tests pass on Render.com preview deploys
- [ ] Visual regression tests (optional)
- [ ] Performance budgets enforced (< 30s p95)

**Windsurf Enhancement:**
> E2E SSE tests are a good complement to unit/integration coverage. Test network interruption + resume scenarios specifically.

---

### Phase 2 Completion Criteria

**Definition of Done:**
- [ ] Dependabot enabled and working
- [ ] SDK published to npm
- [ ] Performance monitoring instrumented
- [ ] E2E tests passing in CI
- [ ] Grafana dashboard template created
- [ ] Documentation updated (Docs/monitoring.md, Docs/sdk.md)

**Expected Grade Impact:**
- Dependency Health: C+ (77) → A- (90)
- Performance: B+ (85) → A- (90)
- Testing: A (94) → A+ (96)

---

## Phase 3: Documentation & Tooling (Sprint 2-3)

**Goal:** Improve documentation, centralize config, and add tooling
**Duration:** 2-3 weeks
**Impact:** Accessibility B+ → A-, Code Quality A- → A

### 3.1 Centralize Configuration

**Goal:** Extend existing config pattern to all modules (Windsurf recommendation)

#### Current State
Good patterns exist:
- `src/config/timeouts.ts`
- `src/adapters/isl/config.ts`
- `src/cee/config/limits.ts`

**Action:** Extend this pattern rather than rebuild

#### Create Config Registry
**File:** `src/config/index.ts`

```typescript
import { z } from 'zod';
import { logger } from '../utils/simple-logger.js';

/**
 * Application Configuration Registry
 *
 * Centralizes all environment variable reads and validation.
 * Validates at startup (fail fast) and provides typed access.
 */

// Server config
export const ServerConfigSchema = z.object({
  PORT: z.coerce.number().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

// LLM config
export const LLMConfigSchema = z.object({
  LLM_PROVIDER: z.enum(['anthropic', 'openai', 'fixtures']).default('anthropic'),
  LLM_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LLM_FAILOVER_PROVIDERS: z.string().optional(),
});

// ... more schemas

/**
 * Load and validate configuration at startup
 */
export function loadConfig() {
  try {
    const config = {
      server: ServerConfigSchema.parse(process.env),
      llm: LLMConfigSchema.parse(process.env),
      // ... more
    };

    logger.info({ event: 'config.loaded', config });
    return config;
  } catch (error) {
    logger.error({ event: 'config.validation_failed', error });
    process.exit(1); // Fail fast
  }
}
```

**Usage:**
```typescript
// server.ts
import { loadConfig } from './config/index.js';

const config = loadConfig();
const app = Fastify({ logger: { level: config.server.LOG_LEVEL } });
```

**Acceptance Criteria:**
- [ ] All `process.env` reads migrated to config module
- [ ] Zod schemas validate all env vars
- [ ] Startup fails fast on invalid config (exit code 1)
- [ ] Config documented in Docs/configuration.md
- [ ] `.env.example` updated with all variables

**Windsurf Enhancement:**
> Extend existing patterns (timeouts, ISL) rather than introducing a totally new config system. Use Zod for validation at startup.

---

### 3.2 Architecture Decision Records

**Goal:** Document key architectural choices

#### Create ADR Directory Structure
```
Docs/
└── architecture/
    └── adr/
        ├── README.md           # ADR index
        ├── 001-fastify-web-framework.md
        ├── 002-redis-dual-mode-strategy.md
        ├── 003-llm-adapter-pattern.md
        ├── 004-cee-integration-architecture.md
        ├── 005-isl-circuit-breaker.md
        └── 006-hmac-authentication.md
```

#### ADR Template
**File:** `Docs/architecture/adr/template.md`

```markdown
# ADR-XXX: [Title]

**Status:** [Proposed | Accepted | Deprecated | Superseded]
**Date:** YYYY-MM-DD
**Deciders:** [Names]
**Technical Story:** [Link to issue/PR]

## Context

What is the issue we're trying to solve?

## Decision

What solution did we choose and why?

## Consequences

What becomes easier or harder as a result?

### Positive
- ...

### Negative
- ...

### Neutral
- ...

## Alternatives Considered

What other options did we evaluate?

## References

- [Link to code](...)
- [Related ADR](...)
```

#### Priority ADRs (Windsurf Recommendations)
1. **ADR-001: Fastify Web Framework**
   - Why Fastify over Express
   - Plugin architecture benefits
   - Performance characteristics

2. **ADR-002: Redis Dual-Mode Strategy**
   - Why support memory fallback
   - Trade-offs (consistency vs availability)
   - When to use each mode

3. **ADR-003: LLM Adapter Pattern**
   - Multi-provider strategy
   - Failover logic
   - Caching approach

4. **ADR-004: CEE Integration Architecture**
   - Separation of concerns (CEE routes, orchestrator, validators)
   - Error.v1 format design
   - Telemetry patterns

5. **ADR-005: ISL Circuit Breaker**
   - Global vs per-tenant scoping
   - Threshold and pause duration rationale
   - Conservative retry conditions

6. **ADR-006: HMAC Authentication**
   - Why HMAC over JWT
   - Replay protection design
   - Nonce storage strategy

**Acceptance Criteria:**
- [ ] 6 core ADRs documented
- [ ] ADR index with status matrix
- [ ] Referenced from main README.md
- [ ] Linked from relevant source code comments

**Windsurf Enhancement:**
> Ensure CEE-specific topics (ISL integration, error.v1 codes, timeouts/retries, circuit breakers) get early ADRs.

---

### 3.3 Error Documentation

**Goal:** Comprehensive error code reference

#### Create Error Catalog
**File:** `Docs/errors.md`

```markdown
# Error Catalog

All API errors follow the `error.v1` schema:

## Error Codes

### BAD_INPUT
**HTTP Status:** 400
**Cause:** Invalid request body or parameters
**Example:**
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "Validation failed",
  "details": {
    "field": "brief",
    "issue": "String must contain at least 10 character(s)"
  },
  "request_id": "req_abc123"
}
```
**Troubleshooting:**
- Verify request body matches OpenAPI schema
- Check required fields are present
- Validate data types match expectations

### RATE_LIMITED
**HTTP Status:** 429
**Cause:** Exceeded rate limit quota
**Example:**
```json
{
  "schema": "error.v1",
  "code": "RATE_LIMITED",
  "message": "Too many requests",
  "details": {
    "retry_after_seconds": 45,
    "limit": 120,
    "window": "1 minute"
  },
  "request_id": "req_def456"
}
```
**Troubleshooting:**
- Wait for `retry_after_seconds` before retrying
- Implement exponential backoff
- Consider requesting quota increase

... [all error codes documented]
```

**Acceptance Criteria:**
- [ ] All 15+ error codes documented
- [ ] HTTP status codes mapped
- [ ] Example responses for each code
- [ ] Troubleshooting steps provided
- [ ] Linked from OpenAPI spec
- [ ] Searchable index

**Windsurf Enhancement:**
> Add a dedicated error catalog with all error.v1 codes, examples, and troubleshooting steps.

---

### 3.4 License Scanning

**Goal:** Ensure license compliance

#### Add License Checker
```bash
pnpm add -D license-checker
```

#### Create License Audit Script
**File:** `scripts/check-licenses.js`

```javascript
const licenseChecker = require('license-checker');

const ALLOWED_LICENSES = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
];

licenseChecker.init({
  start: '.',
  production: true,
}, (err, packages) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }

  const violations = [];
  for (const [name, info] of Object.entries(packages)) {
    const license = info.licenses;
    if (!ALLOWED_LICENSES.includes(license)) {
      violations.push({ name, license });
    }
  }

  if (violations.length > 0) {
    console.error('❌ License violations found:');
    violations.forEach(v => console.error(`  ${v.name}: ${v.license}`));
    process.exit(1);
  }

  console.log('✅ All licenses compliant');
});
```

#### Add to CI
**File:** `.github/workflows/ci.yml`

```yaml
- name: Check licenses
  run: pnpm licenses:check
```

**Acceptance Criteria:**
- [ ] License checker script created
- [ ] CI fails on non-compliant licenses
- [ ] LICENSES.md generated with full list
- [ ] GPLv3 dependencies avoided (if applicable)

---

### 3.5 Code Quality Metrics

**Goal:** Track code health trends

#### Integrate SonarCloud
**File:** `.github/workflows/sonarcloud.yml`

```yaml
name: SonarCloud Analysis
on:
  push:
    branches: [main, develop]
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  sonarcloud:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Shallow clones disabled for analysis

      - name: Run tests with coverage
        run: |
          pnpm install --frozen-lockfile
          pnpm test --coverage

      - name: SonarCloud Scan
        uses: SonarSource/sonarcloud-github-action@master
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
```

**File:** `sonar-project.properties`

```properties
sonar.projectKey=Talchain_olumi-assistants-service
sonar.organization=talchain

sonar.sources=src
sonar.tests=tests
sonar.javascript.lcov.reportPaths=coverage/lcov.info
sonar.coverage.exclusions=**/*.test.ts,**/fixtures/**

sonar.qualitygate.wait=true
```

**Metrics to Track:**
- Code coverage (>90%)
- Cyclomatic complexity (<10 per function)
- Code duplication (<3%)
- Security hotspots
- Maintainability rating (A)

**Acceptance Criteria:**
- [ ] SonarCloud project created
- [ ] CI integration working
- [ ] Quality gate passing
- [ ] Dashboard linked from README.md
- [ ] Trends tracked over time

---

### Phase 3 Completion Criteria

**Definition of Done:**
- [ ] Config centralized with Zod validation
- [ ] 6 core ADRs documented
- [ ] Error catalog complete
- [ ] License scanning in CI
- [ ] Code quality metrics tracked
- [ ] All documentation updated

**Expected Grade Impact:**
- Accessibility: B+ (85) → A- (90)
- Code Quality: A- (88) → A (92)
- Architecture: A- (90) → A (92)

---

## Phase 4: Technical Debt & Enhancements (Ongoing)

**Goal:** Long-term code health and feature enhancements
**Duration:** Ongoing / Backlog
**Impact:** Refinement and optimization

### 4.1 Mutation Testing (Limited POC)

**Goal:** Validate test effectiveness on critical modules

**Windsurf Recommendation:**
> Start as a limited POC on a critical CEE module, not full codebase.

#### Setup Stryker
```bash
pnpm add -D @stryker-mutator/core @stryker-mutator/vitest-runner
```

#### Configure Stryker
**File:** `stryker.conf.json`

```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "pnpm",
  "testRunner": "vitest",
  "coverageAnalysis": "perTest",
  "mutate": [
    "src/cee/bias/causal-enrichment.ts",
    "src/adapters/isl/client.ts",
    "src/utils/hmac-auth.ts"
  ],
  "thresholds": {
    "high": 80,
    "low": 60,
    "break": 50
  }
}
```

**Acceptance Criteria:**
- [ ] Stryker configured for 3 critical modules
- [ ] Mutation score >80% on critical modules
- [ ] CI runs on PRs (gated, not blocking)
- [ ] Results documented in Docs/testing/mutation-report.md

**Priority:** Low (Start Q2 2025)

---

### 4.2 Circular Dependency Audit

**Goal:** Reduce circular imports

#### Run Madge Analysis
```bash
npx madge --circular src/
```

#### Expected Issues
- `router.ts` imports fixtures dynamically (line 82) - intentional
- Possible cycles in CEE modules (19 subdirectories)

**Acceptance Criteria:**
- [ ] Madge report generated (Docs/architecture/circular-deps.md)
- [ ] Critical cycles refactored (<5 cycles allowed)
- [ ] CI check added (warning, not blocking)

**Priority:** Low

---

### 4.3 Enable HTTP/2

**Goal:** Performance improvement via HTTP/2

**Windsurf Feedback:**
> HTTP/2 is nice, but only prioritize if infra makes it meaningful. Render.com already provides TLS.

#### Enable in Fastify
```typescript
// server.ts
import { readFileSync } from 'fs';

export async function build() {
  const app = Fastify({
    http2: process.env.ENABLE_HTTP2 === 'true',
    https: process.env.ENABLE_HTTP2 === 'true' ? {
      cert: readFileSync(process.env.TLS_CERT_PATH!),
      key: readFileSync(process.env.TLS_KEY_PATH!),
    } : undefined,
  });
  // ...
}
```

**Acceptance Criteria:**
- [ ] HTTP/2 enabled behind feature flag
- [ ] Performance tests show improvement (>10% for multiplexed requests)
- [ ] No breaking changes for HTTP/1.1 clients

**Priority:** Low (only if infra supports)

---

### 4.4 Webhook Support

**Goal:** Alternative to SSE for async operations

**Windsurf Feedback:**
> Nice-to-have; only prioritize if you see concrete product demand beyond SSE/HTTP APIs.

#### Design Webhook Delivery
**File:** `src/services/webhooks.ts`

```typescript
export interface WebhookConfig {
  url: string;
  events: string[];
  secret: string;
}

export async function deliverWebhook(
  config: WebhookConfig,
  event: string,
  payload: unknown
): Promise<void> {
  const signature = generateHMAC(config.secret, JSON.stringify(payload));

  await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Olumi-Signature': signature,
      'X-Olumi-Event': event,
    },
    body: JSON.stringify(payload),
  });
}
```

**Acceptance Criteria:**
- [ ] Webhook delivery service implemented
- [ ] HMAC signature for webhook verification
- [ ] Retry logic with exponential backoff
- [ ] Webhook configuration API (`POST /v1/webhooks`)
- [ ] Documentation with examples

**Priority:** Low (Product-driven, not engineering)

---

## Phase 5: CEE-Specific Improvements (Parallel Track)

**Goal:** Enhance CEE feature completeness and operations
**Duration:** Parallel with Phases 2-3
**Impact:** CEE quality and observability

**Windsurf Recommendation:**
> Add a CEE-focused track with graph_quality_version, X-CEE-Debug headers, /v1/validate semantic checks, ISL/CEE SLIs, and operations runbook.

### 5.1 CEE Versioning & Debug Headers

#### Add graph_quality_version to CEE Routes
**File:** `src/routes/assist.v1.draft-graph.ts`

```typescript
// Response schema
interface DraftGraphResponseV1 {
  schema: 'draft_graph.v1';
  graph: GraphV1;
  graph_quality_version?: string; // NEW: e.g., "2024-12" for CEE model version
  // ...
}

// Add to response
return {
  schema: 'draft_graph.v1' as const,
  graph: result.graph,
  graph_quality_version: process.env.CEE_MODEL_VERSION || '2024-12',
  // ...
};
```

#### Add X-CEE-Debug Header
**File:** `src/plugins/cee-debug.ts`

```typescript
export const ceeDebugPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    if (request.headers['x-cee-debug'] === 'true') {
      (request as any).ceeDebug = true;
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    if ((request as any).ceeDebug) {
      reply.header('X-CEE-Diagnostics', JSON.stringify({
        bias_checks_run: (request as any).biasChecks || 0,
        isl_called: (request as any).islCalled || false,
        circuit_breaker_state: (request as any).circuitState || 'closed',
        processing_time_ms: (request as any).ceeTime || 0,
      }));
    }
  });
};
```

**Acceptance Criteria:**
- [ ] `graph_quality_version` in all CEE responses
- [ ] `X-CEE-Debug` header support (gated by feature flag)
- [ ] Debug info logged to telemetry
- [ ] Documentation updated (Docs/cee/debugging.md)

---

### 5.2 Semantic Validation Endpoint

#### Implement /v1/validate
**File:** `src/routes/v1.validate.ts`

```typescript
import type { FastifyPluginAsync } from 'fastify';
import { validateGraphSemantics } from '../cee/validation/semantic-validator.js';

export const validateRoute: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: { graph: GraphV1; archetype?: ArchetypeV1 };
  }>('/v1/validate', {
    schema: {
      body: {
        type: 'object',
        required: ['graph'],
        properties: {
          graph: { type: 'object' },
          archetype: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const { graph, archetype } = request.body;

    // Existing structural validation (Zod)
    // NEW: Semantic validation
    const semanticIssues = await validateGraphSemantics(graph, archetype);

    return {
      schema: 'validation_result.v1',
      valid: semanticIssues.length === 0,
      issues: semanticIssues,
      graph_quality_version: process.env.CEE_MODEL_VERSION,
    };
  });
};
```

**Semantic Checks:**
- [ ] Goal nodes have valid connections
- [ ] Evidence nodes support their claims
- [ ] No orphaned nodes
- [ ] Archetype constraints satisfied
- [ ] Bias findings reference valid nodes

**Acceptance Criteria:**
- [ ] `/v1/validate` endpoint implemented
- [ ] 10+ semantic validation rules
- [ ] Integration tests cover edge cases
- [ ] OpenAPI spec updated
- [ ] Performance: < 500ms for 100-node graphs

---

### 5.3 ISL/CEE SLI Dashboard

#### Expand /diagnostics Endpoint
**File:** `src/routes/diagnostics.ts`

```typescript
import { getIslCircuitBreakerStatusForDiagnostics } from '../cee/bias/causal-enrichment.js';

app.get('/diagnostics', async (request, reply) => {
  // ... existing checks

  // NEW: ISL/CEE SLIs
  const islStatus = getIslCircuitBreakerStatusForDiagnostics();
  const ceeMetrics = await getCeeMetrics(); // last 5 min

  return {
    // ... existing
    isl: {
      circuit_breaker: islStatus,
      sli: {
        success_rate: ceeMetrics.successRate, // target: >99%
        timeout_rate: ceeMetrics.timeoutRate,  // target: <0.5%
        p50_latency_ms: ceeMetrics.p50,        // target: <200ms
        p99_latency_ms: ceeMetrics.p99,        // target: <2000ms
      },
    },
    cee: {
      bias_checks: {
        total_checks_last_5min: ceeMetrics.biasChecks,
        avg_findings_per_check: ceeMetrics.avgFindings,
      },
      evidence_quality: {
        avg_score: ceeMetrics.avgEvidenceScore,
      },
    },
  };
});
```

**SLIs to Track:**
- **ISL Integration:**
  - Success rate >99%
  - Timeout rate <0.5%
  - p50 latency <200ms
  - p99 latency <2000ms
  - Circuit breaker events (should be rare)

- **CEE Quality:**
  - Bias checks per request (avg)
  - Findings per check (avg)
  - Evidence quality scores (distribution)

**Acceptance Criteria:**
- [ ] SLI metrics exposed in `/diagnostics`
- [ ] Grafana dashboard JSON template
- [ ] Alert thresholds documented
- [ ] Runbook references SLIs

---

### 5.4 CEE/ISL Operations Runbook

#### Create Operator Runbook
**File:** `Docs/runbooks/cee-isl-operations.md`

```markdown
# CEE/ISL Operations Runbook

## Overview
This runbook guides on-call engineers through common CEE/ISL operational scenarios.

## Monitoring & Alerts

### Key Metrics
- **ISL Success Rate:** >99% (alert if <95%)
- **ISL Circuit Breaker:** Closed (alert if open >5 min)
- **CEE Bias Check Latency:** p99 <2s (alert if >5s)
- **Evidence Quality Score:** >0.7 avg (alert if <0.5)

### Dashboards
- Grafana: [CEE/ISL Dashboard](https://grafana.example.com/d/cee-isl)
- Diagnostics: `GET /diagnostics` (requires auth)

## Incident Response

### Scenario 1: ISL Circuit Breaker Open
**Symptoms:**
- `/diagnostics` shows `isl.circuit_breaker.state: "open"`
- Logs show `isl.circuit_breaker.opened` event
- Bias findings lack causal validation

**Diagnosis:**
```bash
# Check ISL service health
curl https://isl-service.example.com/healthz

# Check recent ISL errors
grep "cee.bias.causal_validation.error" logs.json | tail -20

# Check circuit breaker metrics
curl -H "X-Olumi-Assist-Key: $KEY" https://api.olumi.app/diagnostics | jq '.isl'
```

**Resolution:**
1. **If ISL is down:**
   - Service continues gracefully (unenriched findings)
   - Page ISL on-call
   - Circuit will auto-close after 90s when ISL recovers

2. **If ISL has persistent errors (e.g., validation errors):**
   - Check recent graph changes (may have invalid structure)
   - Review ISL error messages for hints
   - Consider disabling ISL temporarily:
     ```bash
     export CEE_CAUSAL_VALIDATION_ENABLED=false
     # Restart service
     ```

3. **If high load:**
   - Scale ISL horizontally
   - Circuit breaker prevents overload (by design)

**Prevention:**
- Monitor ISL SLIs (success rate, latency)
- Alert on ISL errors before circuit opens
- Regular ISL load testing

... [more scenarios]
```

**Acceptance Criteria:**
- [ ] Runbook covers 5+ common scenarios
- [ ] Diagnosis steps with commands
- [ ] Resolution procedures with rollback
- [ ] Prevention guidance
- [ ] Linked from on-call rotation docs

**Windsurf Enhancement:**
> Add a short CEE/ISL operations runbook for on-call: how to interpret diagnostics, when to toggle flags, etc.

---

### Phase 5 Completion Criteria

**Definition of Done:**
- [ ] `graph_quality_version` in all CEE responses
- [ ] `X-CEE-Debug` header support
- [ ] `/v1/validate` semantic checks implemented
- [ ] ISL/CEE SLIs exposed in `/diagnostics`
- [ ] Grafana dashboard for CEE/ISL metrics
- [ ] CEE/ISL operations runbook complete
- [ ] Documentation updated (Docs/cee/)

**Expected Impact:**
- Improved CEE observability
- Faster incident response
- Better operator experience
- Foundation for SLO tracking

---

## Success Metrics

### Phase 1 (Security)
- ✅ 0 moderate+ vulnerabilities
- ✅ All 544 tests passing
- ✅ CHANGELOG updated

### Phase 2 (Infrastructure)
- ✅ Dependabot PRs created weekly
- ✅ SDK published and documented
- ✅ Performance metrics in logs
- ✅ E2E tests in CI

### Phase 3 (Documentation)
- ✅ Config validation at startup
- ✅ 6 ADRs documented
- ✅ Error catalog complete
- ✅ License compliance verified
- ✅ Code quality metrics tracked

### Phase 4 (Enhancements)
- ✅ Mutation score >80% on critical modules
- ✅ <5 circular dependencies
- ✅ HTTP/2 enabled (if applicable)
- ✅ Webhooks implemented (if product need)

### Phase 5 (CEE)
- ✅ CEE versioning and debug headers
- ✅ Semantic validation endpoint
- ✅ ISL/CEE SLI dashboard
- ✅ Operations runbook

---

## Overall Grading Targets

| Category | Current | Target | Achieved |
|----------|---------|--------|----------|
| Architecture | A- (90) | A (92) | [ ] |
| Security | A (95) | A+ (98) | [ ] |
| Performance | B+ (85) | A- (90) | [ ] |
| Testing | A (94) | A+ (96) | [ ] |
| Accessibility | B+ (85) | A- (90) | [ ] |
| Dependency Health | C+ (77) | A- (90) | [ ] |
| Code Quality | A- (88) | A (92) | [ ] |
| **OVERALL** | **A- (87)** | **A+ (95)** | [ ] |

---

## Risk Management

### Critical Risks

1. **Dependency Update Breaking Changes**
   - **Mitigation:** Full test suite after each update
   - **Rollback:** Revert pnpm-lock.yaml
   - **Testing:** Automated in CI

2. **Performance Regression from Monitoring**
   - **Mitigation:** StatsD emits are async
   - **Rollback:** Disable performance plugin
   - **Testing:** Load tests before/after

3. **SDK Breaking Changes**
   - **Mitigation:** Semantic versioning (1.0.0)
   - **Rollback:** Publish patch release
   - **Testing:** SDK test suite

### Medium Risks

4. **Config Validation Too Strict**
   - **Mitigation:** Graceful defaults
   - **Rollback:** Make validation warnings, not errors
   - **Testing:** Test with various env configurations

5. **E2E Tests Flaky**
   - **Mitigation:** Retry logic, timeouts
   - **Rollback:** Mark as non-blocking in CI
   - **Testing:** Run 10x locally before merge

---

## Communication Plan

### Stakeholder Updates

**Weekly Status (Slack):**
- Phase completion %
- Blockers and risks
- Next week's focus

**Sprint Reviews (Biweekly):**
- Demo new features (SDK, monitoring, E2E)
- Grade improvements
- Retrospective learnings

**Quarterly Review:**
- Overall grade progress (A- → A+)
- ROI analysis (time saved, incidents prevented)
- Next quarter priorities

---

## Appendix

### A. Codebase Review Details

Full review available in conversation history. Key findings:
- 5 security vulnerabilities (2 HIGH, 3 MODERATE)
- Strong architecture with minor coupling issues
- Excellent test coverage (>90%)
- Missing automation and tooling
- Documentation gaps in error handling and ADRs

### B. Windsurf Feedback Integration

Windsurf's recommendations fully incorporated:
- Phase 1: Full test suite after each dependency update ✅
- Phase 2: Specific performance metrics (CEE, ISL, Redis) ✅
- Phase 3: Extend existing config patterns, not rebuild ✅
- Phase 4: Mutation testing as limited POC ✅
- Phase 5: CEE-specific track added ✅

### C. Related Documents

- [Architecture Overview](./getting-started/architecture.md)
- [CEE Documentation](./CEE-v1.md)
- [ISL Integration](./cee/ISL-INTEGRATION.md)
- [Contributing Guide](../CONTRIBUTING.md)
- [Changelog](../CHANGELOG.md)

---

**Document Maintained By:** Engineering Team
**Last Updated:** 2025-11-24
**Next Review:** 2025-12-24 (monthly)
