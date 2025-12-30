# Changelog

All notable changes to the Olumi Assistants Service will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **V3 Schema Now Default for draft-graph:**
  - V3 (`schema_version: "3.0"` with `analysis_ready` payload) is now the default response format
  - No `?schema` query param required - clients receive `analysis_ready` automatically
  - Backward compatibility: `?schema=v1` or `?schema=v2` explicitly requests legacy formats
  - Deprecation logging added for V1/V2 schema requests to aid migration monitoring
  - Goal generation telemetry (`cee.goal_generation`) tracks LLM goal vs outcome classification

- **Improved Goal vs Outcome Distinction in LLM Prompt:**
  - Added explicit prompt guidance to distinguish goal (ultimate objective) from outcome (intermediate result)
  - Goals represent the DESTINATION; outcomes represent the JOURNEY toward the goal
  - Includes brief-type-specific examples (pricing, hiring, etc.) for consistent classification
  - Reduces risk of LLM incorrectly using "outcome" for main objectives

- **Weight Suggestion Generation Always Enabled:**
  - Removed `CEE_WEIGHT_SUGGESTION_GENERATION_ENABLED` feature flag
  - Weight suggestion generation now runs automatically when the verification pipeline detects edges with problematic beliefs (uniform, near-zero, near-one) or weights (uniform, too low, too high)
  - Graceful degradation preserved: generation failures fall back to raw detections

### Security

- **Critical Dependency Updates (Phase 1: Enterprise-Grade Security)**
  - **Fixed 2 HIGH severity vulnerabilities:**
    - Updated `playwright` to 1.56.1 (was <1.55.1) via `artillery 2.0.27` - Fixed SSL certificate verification bypass (CVE-2025-XXXX)
    - Updated `archiver` to ensure `glob >= 10.5.0` - Fixed command injection vulnerability (CVE-2025-XXXX)
  - **Fixed 3 MODERATE severity vulnerabilities:**
    - Updated `vitest` to 4.0.13 (was 1.6.1) with `esbuild 0.25.12` - Fixed CORS bypass in dev server (CVE-2025-XXXX)
    - Updated `js-yaml` to 4.1.1+ via `openapi-typescript` and `eslint 9.39.1` - Fixed prototype pollution (CVE-2020-13822)
  - **Security audit now reports: 0 vulnerabilities** (was 5)
  - Dependency health grade improved: **C+ (77) → A (95)**

### Changed

- **Development Tooling Major Version Upgrades:**
  - Migrated to ESLint 9.39.1 (from 8.57.1) with new flat config format (`eslint.config.js`)
  - Updated @typescript-eslint packages to 8.48.0 (from 7.18.0) for ESLint 9 compatibility
  - Migrated to Vitest 4.0.13 (from 1.6.1) with updated mock syntax

- **Dependency Management Automation:**
  - Added Dependabot configuration (`.github/dependabot.yml`) for automated weekly security updates
  - Configured grouped dependency updates (production vs development) to manage PR volume
  - Set up automatic security advisory monitoring

- **Enterprise-Grade Development Plan:**
  - Created comprehensive development roadmap (`Docs/DEVELOPMENT_PLAN.md`) targeting A+ grade (95/100)
  - Documented 5-phase improvement plan with Phase 1 (Critical Security) now complete
  - Integrated Windsurf feedback for CEE-specific improvements

- **TypeScript SDK Improvements (Phase 2.2):**
  - Updated SDK to Vitest 4.0.13 (aligned with main project)
  - Verified comprehensive API coverage: 13/15 core endpoints supported
    - ✅ All Assistants API endpoints (draft-graph, suggest-options, clarify-brief, critique-graph, explain-diff, evidence-pack)
    - ✅ All CEE v1 endpoints (draft-graph, options, explain-graph, evidence-helper, bias-check, sensitivity-coach, team-perspectives)
    - ✅ Health check endpoint
  - Package validation: 106 files, 656KB compressed, dual-format build (CommonJS + ESM)
  - All 142 SDK tests passing with updated dependencies
  - Comprehensive documentation with JSDoc comments, usage examples, and error handling guide
  - **SDK Publishing Status:** Ready for npm publication (requires org access and version strategy approval)

- **Performance Monitoring (Phase 2.3):**
  - **New Performance Monitoring Plugin** (`src/plugins/performance-monitoring.ts`)
    - Tracks request latency and duration for all routes
    - Calculates p99 latency per route (rolling 1000-sample window)
    - Detects slow requests (>30s threshold, configurable)
    - Emits StatsD metrics for Datadog integration
    - Automatic alerts on p99 threshold violations
  - **Enhanced /v1/status Endpoint**
    - Added `performance` section with metrics:
      - Total requests and slow request count/rate
      - Top 10 routes by traffic with avg duration and p99
    - Enables real-time performance monitoring without external tools
  - **Configurable Thresholds**
    - `PERF_SLOW_THRESHOLD_MS` (default: 30000ms)
    - `PERF_P99_THRESHOLD_MS` (default: 30000ms)
    - `PERF_METRICS_ENABLED` (default: true)

### Security

- **Diagnostics Endpoint Hardening (Security Fix):**
  - **FIXED: Information disclosure vulnerability** in `/diagnostics` endpoint
  - Made authentication **mandatory** for diagnostics access
  - Now requires `CEE_DIAGNOSTICS_KEY_IDS` configuration
  - Returns 403 Forbidden if key ID allowlist not configured
  - Added comprehensive test coverage for unauthorized access scenarios
  - **Impact**: Prevents exposure of internal state to unauthorized clients

- **Automated Security Scanning Infrastructure:**
  - **GitHub CodeQL Analysis** - Static code analysis for security vulnerabilities
    - Runs on every PR and push to main/staging
    - Weekly scheduled scans
    - Automatic upload to GitHub Security tab
  - **Snyk Vulnerability Scanning** - Dependency and code vulnerability detection
    - Integrated with GitHub Security
    - Severity threshold: High/Critical
    - SARIF report generation
  - **Dependency Review** - Automated license and security review
    - Runs on all pull requests
    - Blocks incompatible licenses (GPL-2.0, GPL-3.0)
    - Fails on moderate+ severity vulnerabilities
  - **Auto-Comment on PRs** - Security scan summary posted to pull requests
  - **Documentation**: Comprehensive setup guide in `Docs/SECURITY_SCANNING.md`
  - **README Badge**: Added security scanning status badge

### Added

- Security scanning workflow (`.github/workflows/security-scanning.yml`)
- Security scanning documentation (`Docs/SECURITY_SCANNING.md`)
- Performance monitoring plugin with StatsD integration
- Performance metrics endpoint in `/v1/status`
- **E2E Testing Infrastructure (Phase 2.4):**
  - **Playwright E2E Test Framework** (`tests/e2e/`)
    - Installed Playwright 1.56.1 and @playwright/test for browser-based testing
    - Configured Playwright with optimized settings for local development and CI
    - Created comprehensive test suite for SSE streaming (`sse-streaming.spec.ts`)
    - Implemented fetch()-based SSE client (EventSource doesn't support custom headers)
    - Test server startup script with proper environment configuration
  - **Test Coverage:**
    - 8 comprehensive E2E test scenarios covering SSE streaming
    - Authentication failure handling (401)
    - Invalid endpoint handling (404)
    - Manual connection close
    - Complete workflow with multiple messages
    - Rapid successive connections
    - Large response streams
    - Connection abortion
  - **Package.json Scripts:**
    - `pnpm test:e2e` - Run E2E tests with Playwright
    - `pnpm test:e2e:ui` - Run with interactive UI for debugging
    - `pnpm test:e2e:headed` - Run in headed mode (visible browser)
    - `pnpm test:e2e:report` - View HTML test report
  - **Configuration:**
    - E2E tests excluded from Vitest to prevent test runner conflicts
    - Test server configured to use fixtures adapter for deterministic testing
    - Automatic server startup/shutdown for E2E test execution
  - **Documentation:**
    - Comprehensive E2E testing guide in `tests/e2e/README.md`
    - Known issues and next steps documented
    - Debugging instructions and common troubleshooting

- **Centralized Configuration Module (Phase 3):**
  - **Type-Safe Configuration with Zod** (`src/config/index.ts`)
    - Centralized configuration module replacing scattered `process.env` usage
    - Zod schema validation for all 72 environment variables
    - Custom boolean coercion handling string "true"/"false" correctly
    - Custom URL validation handling empty strings and undefined values
    - Type-safe access with full IntelliSense support
    - Organized into logical groups: server, auth, llm, features, redis, sse, cee, isl, graph, validation, performance, pii, share
  - **Configuration Benefits:**
    - **Type Safety**: All config values have proper TypeScript types
    - **Validation**: Invalid configurations fail fast at startup with clear error messages
    - **Testability**: Easy to mock and override in tests
    - **Defaults**: Sensible defaults for all optional values (corrected to match actual usage)
    - **Documentation**: Single source of truth for configuration
  - **Environment Detection Helpers:**
    - `isProduction()` - Check if running in production
    - `isDevelopment()` - Check if running in development
    - `isTest()` - Check if running in test environment
  - **Comprehensive Test Coverage:**
    - 16 unit tests for configuration module
    - Tests for type coercion, validation, defaults, array transformation
    - Tests for environment detection and error handling
    - Tests for optional URL validation with empty strings
  - **Migration Documentation:**
    - Complete migration guide in `src/config/README.md`
    - **Migration Strategy section** documenting singleton initialization challenges
    - Guidance on safe vs. unsafe files to migrate based on import graph position
    - Recommended phased migration approach starting with route handlers
    - Before/after examples for common patterns
    - Testing strategies and best practices
    - Step-by-step migration instructions
  - **Phase 3 Improvements:**
    - Fixed optional URL validation (BASE_URL, ISL_BASE_URL, ENGINE_BASE_URL)
    - Corrected rate limit defaults (defaultRpm: 60→120, sseRpm: optional→20)
    - Documented migration blocker: Singleton pattern incompatible with test architecture
    - **Migration Status**: Infrastructure complete, awaiting architectural decision on initialization pattern

### Fixed

- **Test Compatibility:**
  - Fixed `vi.fn` type signature for Vitest 4.x in `tests/unit/validateClientWithCache.test.ts`
  - Fixed Vitest configuration to exclude Playwright E2E tests from Vitest runner
  - All 1,260 tests passing (134 test files) including 16 new configuration tests

### Testing

- Full test suite validated after major dependency updates (Vitest 4.x, ESLint 9.x)
- E2E testing infrastructure established with Playwright
- Configuration module with comprehensive unit test coverage
- TypeScript compilation clean with updated tooling
- Performance baseline maintained (test duration ~8.5s)

## [1.11.1] - 2025-11-22

### Changed

- **CEE Diagnostics Ring**
  - CEE internal diagnostics ring buffer now retains only non-OK calls, preserving error visibility while keeping the external `/diagnostics` contract unchanged.
- **CEE Rate Limit Config**
  - Hardened `resolveCeeRateLimit` to clamp invalid, negative, or non-finite RPM values back to safe defaults while keeping existing HTTP behavior stable.
- **Diagnostics Access Control**
  - `/diagnostics` endpoint is now gated to operator-only keys configured via `CEE_DIAGNOSTICS_KEY_IDS`, returning a standard `FORBIDDEN` `error.v1` payload for non-operator keys.

### Security

- **CORS Wildcard Guard**
  - Introduced a shared `resolveAllowedOrigins()` helper and fail-fast guard that rejects `ALLOWED_ORIGINS` lists containing `*` in production.
  - Aligned Render production config and deployment docs to use a strict allowlist for CORS instead of `CORS_ALLOWED_ORIGINS=*`.
- **Error Message Redaction**
  - Integrated `redactLogMessage` / PII Guard into `toErrorV1`, extending error message scrubbing to cover bearer tokens, JWTs, URLs with embedded credentials, and other potential secrets.
- **CI Security Audit**
  - CI security job now runs `pnpm audit --audit-level=high` without `|| true`, causing the job to fail visibly when high-severity dependency issues are detected.
- **Duplicate Shadow Files**
  - Removed tracked `* 2.ts` duplicate source and test files and added a CI guard that fails the security job if any new `* 2.ts` files are introduced.

### Added

- **Ops & Versioning Docs**
  - New `Docs/versioning-strategy.md` outlining API stability guarantees, version identifiers, and upgrade expectations.
  - Render deployment guide now documents an optional `NODE_OPTIONS=--max-old-space-size=512` heap cap for operators who want an extra guardrail against OOM, with guidance to validate in staging.
- **Perf Baseline Workflow**
  - Optional GitHub Actions workflow (`perf-baseline.yml`) that runs the existing Artillery baseline (`pnpm perf:baseline`) against a configurable target URL via `workflow_dispatch`, with a commented-out schedule for future nightly runs.

### Testing

- Full `pnpm preflight` suite (lint, typecheck, tests, OpenAPI validation) passes with the new hardening changes.
- SDK TypeScript tests continue to pass against the updated core service behavior.

## [1.11.0] - 2025-11-15

### Added

- **SSE Diagnostics & Limits**
  - Final JSON success responses now include `diagnostics = { resumes, trims, recovered_events, correlation_id }`.
  - SSE `COMPLETE` events and resume snapshot fallbacks carry the same diagnostics payload for parity.
  - `/v1/limits` exposes graph caps (50 nodes / 200 edges) plus live quota hints and quota backend name.

- **Windowed Performance Gate**
  - Live SSE resume perf harness emits windowed metrics (10s windows) including resume success rate, trim rate, reconnect p50/p95, and error rate.
  - GitHub Actions perf gate job now summarizes windowed metrics with ✅/❌ per gate and interpolated window size.

### Changed

- **Degraded Mode & Chaos Telemetry**
  - When Redis is unavailable, `/assist/draft-graph/stream` returns HTTP 200 with `X-Olumi-Degraded: redis`, disables resume, and emits degraded-mode telemetry while leaving no stray Redis state.

- **SDK SSE Auto-Reconnect**
  - TypeScript SDK `streamDraftGraphWithAutoReconnect` prefers server-provided `retry_after_seconds` over static backoff when handling `RATE_LIMITED` errors.
  - SDK safely reads `X-Olumi-Degraded` headers and surfaces them via an optional `onDegraded(kind)` hook without assuming headers are always present in test or production environments.

- **Perf Gate Workflow**
  - SSE Live Resume Performance Gate uses diagnostics-based trim counting (`diagnostics.trims`) from final `COMPLETE` events.
  - CI perf gate enforcement is now mode-sensitive: `PERF_MODE=dry` (PRs) yields soft gates (no CI failure), while `PERF_MODE=full` (main/nightly) enforces hard gates.

### Fixed

- **SSE Heartbeat Leak**
  - Heartbeat interval timers on `/assist/draft-graph/stream` are cleared on write failure and when the stream ends, preventing timer leaks.

- **Chaos & Test Housekeeping**
  - Chaos Redis blip tests use briefs that satisfy schema minimum length, ensuring degraded-mode paths are exercised without schema failures.
  - Unused imports were removed from SSE resume integration tests and other unit tests to keep the suite clean.

### Testing

- Full Vitest suite passes (900+ tests) with new diagnostics, limits, degraded mode, and perf gate behaviors covered by unit, integration, and chaos tests.

## [1.10.0] - 2025-11-14

### Added

- **Performance & Chaos Validation**
  - SSE live resume performance test (`perf/sse-live-resume.mjs`) with 60s concurrent stream simulation
  - Performance gates: resume success ≥98%, buffer trim ≤0.5%, p95 latency <12s
  - Extended perf-gate CI workflow with SSE-specific metrics and job summary
  - Chaos tests for mid-stream disconnects (`tests/chaos/disconnect.test.ts`) - 10%, 50%, 90% positions
  - Chaos tests for Redis blips (`tests/chaos/redis-blip.test.ts`) - graceful degradation validation

- **Buffer & Bandwidth Optimization**
  - Event payload trimming (`src/utils/buffer-optimization.ts`) - keeps essential fields only
  - Optional gzip compression behind `SSE_BUFFER_COMPRESS=true` flag (~40% savings)
  - Priority-based trimming: heartbeats → trace → stage deltas (COMPLETE/ERROR never trimmed)
  - Buffer savings telemetry: `original_size`, `optimized_size`, `savings_percent`
  - Backward-compatible decompression with legacy event support

- **SDK Exemplars & DX Polish**
  - React + Vite example (`examples/react-vite-sse-resume/`) with auto-reconnect hook
  - Next.js App Router example (`examples/nextjs-ssr-sse-resume/`) with server actions
  - SDK dual build: ESM (`dist/esm/`) + CJS (`dist/cjs/`) with tree-shaking support
  - `sideEffects: false` for optimized bundling
  - SDK build CI job (`.github/workflows/sdk-build.yml`) with size snapshot artifacts

- **Ops: Dashboards, Alerts, Runbooks**
  - Production runbook: `Docs/runbooks/resume-failures.md` - 401/404/410 diagnostics
  - Production runbook: `Docs/runbooks/buffer-pressure.md` - buffer trim mitigation
  - Production runbook: `Docs/runbooks/redis-incidents.md` - Redis outage response
  - Incident response procedures with escalation paths and SLO targets

- **HMAC/Redis Operational Hardening**
  - HMAC rotation helper (`scripts/rotate-hmac.mjs`) - zero-downtime gradual rotation
  - Secret generation, verification, and rotation guidance
  - Cryptographically secure 32-byte (256-bit) secret generation

### Changed

- **SDK version** bumped to 1.10.0 with dual module format
- SSE buffer events now use base64-encoded compressed format in Redis
- Event payload trimming enabled by default (`SSE_BUFFER_TRIM_PAYLOADS=true`)
- Buffer optimization logged at debug level with size savings metrics
- Graph caps contract raised to 50 nodes / 200 edges (configurable via `LIMIT_MAX_NODES` / `LIMIT_MAX_EDGES` and surfaced by `/v1/limits`).

### Performance

- **Buffer optimization** reduces Redis memory usage by 30-50% (with trimming + compression)
- **Dual build** enables tree-shaking for smaller client bundles
- **Priority trimming** protects critical events (COMPLETE/ERROR) from removal

### Security

- **HMAC rotation** without token invalidation using gradual two-secret approach
- **Constant-time verification** maintained in all optimization paths
- **No secret logging** in rotation helper output (shows first 8 chars only)

### Fixed

- **CRITICAL: Buffer accounting bug** - Fixed size tracking to use compressed byte length (not base64 string length) when trimming events, preventing buffer size drift and false quota exhaustion under load
- TypeScript type safety for `response.headers["content-type"]` in chaos tests
- Base64 encoding/decoding for compressed events in Redis storage
- Fallback handling for legacy uncompressed events during migration

### Documentation

- Added comprehensive runbooks for production incidents
- React SSE hook with exponential backoff and visual feedback
- Next.js SSR streaming patterns with server-side HMAC
- SDK build size optimization guide

### Notes

- Buffer compression is opt-in (`SSE_BUFFER_COMPRESS=true`) due to CPU trade-off - see runbook for guidance
- Chaos tests skip gracefully when Redis/secrets unavailable
- Dual build increases SDK package size but enables better tree-shaking
- Operational runbooks assume Render deployment (adapt for other platforms)
- Priority-based trimming uses O(n) scan on overflow - acceptable at default limits (256 events), consider metadata optimization for higher limits (v1.11+)

## [1.8.0] - 2025-11-13

### Added
- **SSE Resilience II: Resumable Streaming** (Feature A)
  - HMAC-signed resume tokens (X-Resume-Token header)
  - Redis-backed stream state management with event buffering
  - Automatic buffer trimming (256 events, 1.5 MB limits)
  - Resume endpoint: `POST /assist/draft-graph/resume`
  - Snapshot fallback for late resume after stream completion
  - 15-minute token TTL with constant-time verification
  - Base64url-encoded tokens (URL-safe, no padding)

- **Resume Token Utilities** (`src/utils/sse-resume-token.ts`)
  - `createResumeToken()` - Generate resume token with request_id, step, seq
  - `verifyResumeToken()` - HMAC signature verification with expiration check
  - Falls back to HMAC_SECRET if SSE_RESUME_SECRET not configured

- **SSE State Management** (`src/utils/sse-state.ts`)
  - `initStreamState()` - Initialize stream with Redis state tracking
  - `bufferEvent()` - Buffer events with automatic size/count trimming
  - `getBufferedEvents()` - Retrieve events from sequence for replay
  - `markStreamComplete()` - Save completion snapshot (15-minute TTL, matches token expiry)
  - `getSnapshot()` - Retrieve snapshot for late resume
  - `cleanupStreamState()` - Clean up after stream ends

- **Resume Telemetry Events**
  - `SseResumeIssued` - Token generated on first event
  - `SseResumeAttempt` - Client attempts reconnection
  - `SseResumeSuccess` - Resume successful with event replay
  - `SseResumeExpired` - Token expired or state unavailable
  - `SseResumeIncompatible` - Step mismatch on resume
  - `SseResumeReplayCount` - Number of events replayed
  - `SsePartialRecovery` - Snapshot fallback used
  - `SseBufferTrimmed` - Buffer limit exceeded, oldest events removed
  - `SseSnapshotCreated` - Completion snapshot saved

- **Test Coverage**
  - `tests/unit/sse-resume-token.test.ts` - 18 unit tests for token generation/verification
  - `tests/unit/sse-state.test.ts` - 20 unit tests for state management (Redis-dependent)
  - `tests/integration/sse-resume.test.ts` - 14 integration tests including E2E replay-only flow
  - `qa-smoke.mjs` - Optional A4R smoke test for production resume validation (opt-in via `SMOKE_RESUME_ENABLED`)

- **SDK (TypeScript) - SSE Streaming Support** (`sdk/typescript@1.8.0`)
  - `streamDraftGraph()` - Async generator for SSE streaming with token capture
  - `resumeDraftGraph()` - Resume interrupted streams with replay-only behavior
  - `extractResumeTokenFromEvent()` - Helper to extract token from SSE events
  - Full type support for SSE events (`SseEvent`, `SseStageEvent`, `SseResumeEvent`, etc.)
  - HMAC authentication support for streaming endpoints
  - Comprehensive README with resilient streaming patterns
  - 17 new SDK tests (59 total SDK tests passing)

### Security
- **Constant-time signature verification** - HMAC comparison uses bitwise XOR to prevent timing attacks
- **Graceful secret handling** - Resume endpoint returns 426 (Upgrade Required) when secrets not configured
- **Rate limiting** - Resume endpoint shares SSE rate limit (20 req/min) to prevent abuse
- **Buffer trimming observability** - `SseBufferTrimmed` telemetry emitted when events are dropped
- **Token expiration enforcement** - 15-minute TTL prevents replay of old tokens
- **No PII in tokens** - Only request_id, step, and sequence stored

### Changed
- SSE streaming endpoint now buffers all events for resume capability
- First event now includes `event: resume` with X-Resume-Token
- Stream completion now saves snapshot for late reconnection (15-minute TTL, up from 60s)
- All stage events are buffered in Redis with size/count limits
- Resume endpoint now includes rate limiting (20 req/min, matching stream endpoint)

### Security
- Resume tokens use HMAC-SHA256 with constant-time verification
- No PII stored in tokens (only request_id, step, seq, expires_at)
- Token expiry enforced at 15 minutes
- Redis keys use TTL-based expiration (15 min state, 60s snapshot)

### Fixed
- **Snapshot TTL alignment** - Increased completion snapshot TTL from 60s to 900s (15 minutes) to match token expiry, enabling late resume within token validity window
- **Rate limit enforcement** - Added rate limiting to resume endpoint to prevent abuse and match stream endpoint protection

### Notes
- Resume functionality requires Redis for production use
- In-memory fallback not implemented (Redis-only feature)
- Tests skip gracefully when Redis unavailable
- Backward compatible - existing clients work without resume support
- **Smoke test:** A4R resume check is opt-in via `SMOKE_RESUME_ENABLED=true` environment variable

## [1.3.1] - 2025-11-11

### Added
- **Undici Timeout Configuration** (v04 Resilience)
  - Connect timeout: 3s (fail fast on connection issues)
  - Headers timeout: 65s (align with 65s deadline)
  - Body timeout: 60s (budget for LLM response streaming)
  - Applied to OpenAI adapter via global dispatcher

- **SSE Heartbeats** (v04 Resilience)
  - SSE comment lines (`: heartbeat\n\n`) every 10s
  - Prevents proxy idle timeouts on long-running LLM calls
  - Applied to `/assist/draft-graph/stream` endpoint

- **Nightly Smoke Retry Logic** (v04 Resilience)
  - Retry A3/A4 tests once on 408/504/500 errors (upstream timeout)
  - 2s backoff between retries
  - 75s total timeout for smoke tests

### Fixed
- **Legacy SSE Auth Bypass**
  - Auth plugin now skips legacy SSE deprecation path
  - Allows 426 Upgrade Required response with migration guide
  - Fixes regression where auth returned 401 before route could return 426

### Notes
- No breaking changes
- Backward compatible with v1.3.0

## [1.3.0] - 2025-11-10

### Added
- **Spec v04 Graph Guards** (Task E)
  - Stable edge ID format: `${from}::${to}::${index}`
  - Deterministic node and edge sorting (by ID)
  - DAG enforcement with cycle detection and breaking
  - Isolated node pruning for clean graph topology
  - Automatic metadata calculation (roots, leaves, suggested_positions)
  - Node/edge caps (maxNodes=12, maxEdges=24) with overflow protection
  - `enforceGraphCompliance()` entry point in `src/utils/graphGuards.ts`

- **Per-Key Authentication & Quotas** (Task G)
  - Multi-key support via `ASSIST_API_KEYS` (comma-separated)
  - Backwards compatible with single `ASSIST_API_KEY`
  - Token bucket rate limiting per API key
    - General endpoints: 120 requests/minute
    - SSE endpoints: 20 requests/minute (stricter for long-lived connections)
  - API key via `X-Olumi-Assist-Key` or `Authorization: Bearer` header
  - Public routes bypass auth (e.g., `/healthz`)
  - Auth telemetry events: `AuthSuccess`, `AuthFailed`, `RateLimited`

- **Legacy SSE Migration Flag** (Task H)
  - `ENABLE_LEGACY_SSE` environment variable (default: **false**)
  - When disabled: `POST /assist/draft-graph` with `Accept: text/event-stream` returns 426 (Upgrade Required)
  - Error response includes migration guide and recommended endpoint
  - Recommended: Use `POST /assist/draft-graph/stream` for SSE
  - When enabled: Legacy behavior preserved with deprecation telemetry

- **CI Coverage Gates** (Task I)
  - Coverage thresholds enforced: 90% lines/functions/statements, 85% branches
  - Codecov integration for coverage tracking
  - Security audit job (`pnpm audit --audit-level=high`)
  - Spec v04 compliance workflow (separate)

### Changed
- All graph outputs now use deterministic edge IDs and sorting
- Graph orchestrator uses new `enforceGraphCompliance()` guard
- Rate limiting moved from IP-based to API key-based
- Default legacy SSE path disabled (opt-in for backwards compatibility)

### Fixed
- **Critical: Auth Plugin Encapsulation**
  - Fixed auth plugin not using `fastify-plugin`, causing hooks to not apply to routes
  - Auth hooks now correctly enforce authentication on all protected endpoints
  - Resolved issue where plugin encapsulation prevented `onRequest` hook from running
- **Test Infrastructure Improvements**
  - Fixed module caching issues causing test flakiness (100% pass rate achieved)
  - Resolved 64+ TypeScript errors in test code with test helper utilities
  - Improved `breakCycles` to remove only specific edge IDs, not all edges for a pair
  - Added `vi.resetModules()` pattern for tests modifying environment variables
  - Fixed `@vitest/coverage-v8` version mismatch (updated to 1.6.1)
  - Added test type helpers in `tests/helpers/test-types.ts`
  - Updated vitest configuration with coverage thresholds

### Security
- Per-key rate limiting prevents abuse and enables quota management
- API keys hashed (SHA-256 prefix) for safe logging
- Auth telemetry uses key ID, not raw key value

### Testing
- **100% test pass rate** (516/516 tests across 43 test files)
- **0 TypeScript errors** (down from 64+)
- Unit tests for graph guards (23 test cases)
- Integration tests for multi-key auth (11 test cases)
- Integration tests for legacy SSE flag (4 test cases)
- CI enforces coverage thresholds on all PRs

### Documentation
- Updated CHANGELOG.md with v1.3.0 features
- Auth configuration guide (single vs multi-key)
- Legacy SSE migration guide
- Graph guards API documentation

## [1.1.0] - 2025-01-06

### Added
- **Document Grounding System**
  - PDF text extraction with page markers (`[PAGE N]`)
  - CSV safe summarization (count/mean/p50/p90 only - no row data leakage)
  - TXT/MD line-numbered extraction
  - Per-file character limit (5,000 chars) with clear error messages
  - Aggregate character limit (50,000 chars) across all attachments
  - Structured citations with source, quote (≤100 chars), and location
  - Privacy-first logging (`redacted: true` on all file operations)
  - Base64 payload validation and sanitization

- **Feature Flag System**
  - `ENABLE_GROUNDING` - Document grounding control (default: **false** for safety)
  - `ENABLE_CRITIQUE` - Graph critique endpoint control (default: true)
  - `ENABLE_CLARIFIER` - Clarifying questions control (default: true)
  - Per-request flag overrides via `flags` field in request bodies
  - Priority order: Per-request > Environment > Default

- **New Endpoint: Explain Diff**
  - `POST /assist/explain-diff` - Generate rationales for graph patch changes
  - Accepts patch with adds/updates/removes
  - Returns structured rationales with optional provenance sources
  - Deterministic ordering (alphabetically by target)

- **Enhanced Health Endpoint**
  - `GET /healthz` now includes `feature_flags` object
  - Shows current state of all feature flags
  - Enables ops visibility without environment access

- **Schema Updates**
  - `attachments` field in DraftGraphInput and CritiqueGraphInput
  - `attachment_payloads` field for base64-encoded file content
  - `flags` field in all input schemas for per-request overrides
  - OpenAPI documentation for suggest-options and explain-diff endpoints

### Changed
- Feature flags now respect conservative defaults (grounding opt-in)
- Error messages for attachment processing include filename context
- Aggregate size limit errors provide tailored hints (5k vs 50k)
- Health endpoint schema expanded with version, provider, model, flags

### Fixed
- Base64 whitespace handling (strip before validation/decoding)
- Critique route now accepts `flags` field (schema validation fix)

### Security
- CSV processing never exposes row data or column headers
- All file content logs marked `redacted: true`
- Base64 payloads validated before processing to prevent corruption
- Character limits protect against DoS via large file uploads

### Testing
- Added 39 new tests (345 total, up from 306)
- Unit tests for feature flags (14 tests)
- Integration tests for grounding (18 tests)
- Unit tests for PDF/CSV/TXT extraction and privacy
- Health endpoint tests (7 tests)

### Documentation
- Complete OpenAPI spec with new endpoints
- Operator runbook updated with feature flags matrix
- Render deployment guide updated with grounding instructions
- PR documentation with acceptance criteria and rollback plan
- Smoke test script for automated validation

## [1.0.1] - 2025-01-05

### Added
- **Capability Error Mapping**
  - `_not_supported` errors mapped to 400 BAD_INPUT with helpful hints
  - Provider-specific error messages for unsupported features

- **MCQ-First Clarifier Ordering**
  - Multiple-choice questions appear before open-ended questions
  - Improves user experience with structured options first

- **Confidence-Based Stop Rule**
  - Clarifier stops when confidence ≥ 0.8
  - `should_continue` field indicates if more questions needed
  - Prevents unnecessary clarification rounds

- **Deterministic Critique Ordering**
  - Issues sorted: BLOCKER → IMPROVEMENT → OBSERVATION
  - Predictable output for testing and UX consistency

- **JSON ↔ SSE Parity**
  - Server-Sent Events implementation matches JSON response format
  - RFC 8895 framing for proper SSE spec compliance
  - Dedicated `/assist/draft-graph/stream` endpoint

- **Version Single Source of Truth**
  - `SERVICE_VERSION` constant reads from package.json
  - Used by `/healthz` and all telemetry events
  - Works correctly in dev (tsx) and prod (node) modes

### Changed
- Clarifier now has maximum 2 rounds (down from unlimited)
- SSE responses use proper `event: stage` and `data: {...}` format
- Health endpoint shows service version from SSOT

### Testing
- Added 306 tests (100% passing)
- Integration tests for clarifier flow
- SSE parity tests
- Contract tests for JSON/SSE equivalence

### Documentation
- Operator runbook created with smoke tests
- Render deployment guide
- OpenAPI spec validated and complete
- Version SSOT architecture documented

## [1.0.0] - 2025-01-04

### Initial Release
- **Draft Graph Generation** (`POST /assist/draft-graph`)
  - Generate decision graphs from natural language briefs
  - Support for streaming (SSE) and JSON responses
  - Confidence scoring and quality tiers

- **Clarify Brief** (`POST /assist/clarify-brief`)
  - Ask clarifying questions to improve draft quality
  - Support for multiple-choice and open-ended questions
  - Round tracking and confidence-based termination

- **Critique Graph** (`POST /assist/critique-graph`)
  - Review decision graphs for issues and improvements
  - Focus areas: structure, completeness, feasibility, provenance
  - Three severity levels: BLOCKER, IMPROVEMENT, OBSERVATION

- **Suggest Options** (`POST /assist/suggest-options`)
  - Generate 3-5 strategic options for a goal
  - Constraint consideration
  - Avoids duplicating existing options

- **Health Check** (`GET /healthz`)
  - Service status and configuration info
  - LLM provider and model information
  - Graph limits source (engine vs config)

- **LLM Provider Support**
  - OpenAI integration (GPT-4o-mini)
  - Anthropic integration (Claude 3.5 Sonnet)
  - Fixtures mode for testing

- **Quality & Validation**
  - Graph validation with repair capabilities
  - DAG enforcement and cycle detection
  - Deterministic edge ID generation
  - Telemetry events for observability

### Infrastructure
- Fastify HTTP server
- Rate limiting and CORS support
- Zod schema validation
- OpenAPI specification
- Comprehensive test suite

---

## Release Notes Format
- **[Version]** - Date in YYYY-MM-DD
- **Added**: New features
- **Changed**: Changes to existing features
- **Fixed**: Bug fixes
- **Security**: Security improvements
- **Deprecated**: Features marked for removal
- **Removed**: Features removed
- **Testing**: Test coverage updates
- **Documentation**: Docs updates

## [1.3.0] – Released
- GitHub Release: https://github.com/Talchain/olumi-assistants-service/releases/tag/v1.3.0
- Nightly smoke (latest): https://github.com/Talchain/olumi-assistants-service/actions/runs/19263197136
- Notes: Telemetry event validation; dotenv restored; lockfile regenerated; CI pin for pnpm/action-setup; 544/544 tests passing; TypeScript clean.
