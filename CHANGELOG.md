# Changelog

All notable changes to the Olumi Assistants Service will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
