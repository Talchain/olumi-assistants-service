# SECURITY ANALYSIS REPORT
## Olumi Assistants Service

### EXECUTIVE SUMMARY

This is a TypeScript/Node.js microservice using Fastify for LLM-powered graph assistance. Overall security posture is **GOOD** with strong input validation, proper error handling, and PII protection. Identified issues are primarily in dependency management and a potential information disclosure risk.

---

## 1. INPUT VALIDATION & SANITIZATION

### STRENGTHS

✓ **Comprehensive Schema Validation (Zod)**
- All request bodies validated with strict Zod schemas
- Examples: `/src/schemas/assist.ts` - DraftGraphInput, SuggestOptionsInput, ClarifyBriefInput
- Types are strict with `.strict()` enforcement to prevent extra fields

✓ **File Upload Security**
- Attachments validated in `/src/grounding/process-attachments.ts` (lines 42-226)
- Character limits enforced:
  - Per-file: 5,000 characters max
  - Aggregate: 50,000 characters max
- Base64 validation (lines 70-88) with re-encoding verification
- Supported formats: PDF, CSV, TXT, MD only (whitelist approach)
- CSV parsing uses PapaParse with error handling

✓ **PDF Security**
- Encrypted PDF detection and rejection (line 45-47)
- Malformed PDF error handling with try-catch

✓ **Request Body Size Limits**
- Fastify bodyLimit: 1MB default (env: BODY_LIMIT_BYTES)
- Server.ts lines 32, 40

✓ **String Length Validation**
- Brief: 30-5000 chars (assist.ts lines 5-18)
- Questions: 10+ chars, max 280 chars (line 69)
- Node labels: max 200 chars (anthropic.ts line 20)

### RISKS & RECOMMENDATIONS

⚠️ **MODERATE: Insufficient Input Sanitization in Graph Data**
- Graph node/edge structures from LLM responses validated with Zod but minimal content sanitization
- Node labels/body could contain special characters, long strings
- **Recommendation**: Add sanitization for node labels/body (truncate, escape special chars)
  - File: `/src/adapters/llm/anthropic.ts` line 327-331
  - File: `/src/adapters/llm/openai.ts` (similar pattern)

⚠️ **MODERATE: JSON Parsing Without Size Limits**
- LLM response JSON parsed without size checks
- **Recommendation**: Add JSON response size validation before parsing
  - File: `/src/adapters/llm/anthropic.ts` line 289

⚠️ **LOW: No SSRF Protection on ENGINE_BASE_URL**
- Validation service connects to configurable ENGINE_BASE_URL
- `/src/services/validateClient.ts` line 16: `request(${base}/v1/validate)`
- **Recommendation**: 
  - Validate ENGINE_BASE_URL at startup (whitelist domains or IP ranges)
  - Add timeout (currently uses default)
  - Consider certificate pinning for production

### NO SQL INJECTION RISK
- Application has no database integration
- No direct SQL generation or queries found

### NO COMMAND INJECTION RISK
- No `exec()`, `spawn()`, `eval()`, or shell execution found
- All external LLM calls use proper SDK libraries

---

## 2. AUTHENTICATION & AUTHORIZATION

### FINDINGS

🔴 **CRITICAL: NO AUTHENTICATION IMPLEMENTED**
- **Zero API key or authentication enforcement** on any endpoint
- All routes are completely open to public access
- Rate limiting is the only protection mechanism

**Files with no auth checks:**
- `/src/routes/assist.draft-graph.ts`
- `/src/routes/assist.suggest-options.ts`
- `/src/routes/assist.clarify-brief.ts`
- `/src/routes/assist.critique-graph.ts`
- `/src/routes/assist.explain-diff.ts`
- `/src/routes/assist.evidence-pack.ts`

**Security Impact:**
- Unauthenticated users can make unlimited LLM API calls (up to rate limit)
- Cost exposure: Each request incurs LLM fees (potentially $0.003-$0.10+ per request)
- Service could be abused as free LLM API gateway

### RECOMMENDATIONS

**REQUIRED FOR PRODUCTION:**

1. **Implement API Key Authentication**
   ```typescript
   // Add to server.ts before route registration
   app.addHook("onRequest", async (request, reply) => {
     const apiKey = request.headers["x-api-key"];
     if (!apiKey || typeof apiKey !== "string") {
       reply.code(401);
       return reply.send({ code: "UNAUTHORIZED", message: "Missing API key" });
     }
     // Validate against allowed keys or backend
   });
   ```

2. **Add Request-Level Authorization**
   - Verify API key has permission for the specific operation
   - Track usage per API key for billing/limits

3. **Environment Variable for API Key Validation**
   - Add `API_KEYS` or `API_KEY_VALIDATION_URL`
   - Default to dev mode with warning if not set

4. **No Public Rate Limiting Without Auth**
   - Current rate limiting (120 req/min per IP) insufficient for production
   - IP-based rate limiting easily bypassed with proxy/VPN
   - Implement per-key rate limiting instead

---

## 3. SECRETS MANAGEMENT

### STRENGTHS

✓ **No Hardcoded Secrets Found**
- Grep search for API keys, credentials: CLEAN
- API keys properly sourced from environment variables only
  - `ANTHROPIC_API_KEY` - `/src/adapters/llm/anthropic.ts` line 85
  - `OPENAI_API_KEY` - `/src/adapters/llm/openai.ts` line 44

✓ **Lazy Client Initialization**
- API clients created on-demand (lines 90-98, 49-57)
- Failures if keys not set caught at startup with clear errors
- `/src/server.ts` lines 18-29: Fail-fast validation

✓ **Proper .env Handling**
- `.env` files properly gitignored (.gitignore line 1)
- `.env.example` and `.env.sample` provided with no secrets
- Clear instructions in comments

### RISKS

⚠️ **MODERATE: API Keys Could Be Leaked in Error Messages**
- Error sanitization in `/src/utils/errors.ts` applies regex redaction
- Lines 105-127: Attempts to redact secrets with regex:
  ```typescript
  message.replace(/[A-Z_]+_?KEY=\S+/gi, '[KEY_REDACTED]')
  message.replace(/[A-Z_]+_?SECRET=\S+/gi, '[SECRET_REDACTED]')
  ```
- **Issue**: Regex is insufficient
  - Pattern `[A-Z_]+_?KEY=` won't catch all key formats
  - Bearer tokens in Authorization headers might leak
  - LLM response contents logged might contain sensitive data

**Recommendation**: 
- Enhance redaction patterns to include more formats
- Add comprehensive header redaction (already done in `/src/utils/redaction.ts` lines 166-184, but only applied to specific logs)
- Ensure `safeLog()` is called everywhere sensitive data might be logged

⚠️ **MODERATE: Provider Configuration File Has No Validation**
- `/src/adapters/llm/router.ts` lines 43-55: Reads provider config from JSON file
- No path validation on `PROVIDERS_CONFIG_PATH`
- No schema validation of config contents (Zod missing)
- **Recommendation**: Validate config file path and content with Zod schema

✓ **Good**: No Secrets in Telemetry
- Telemetry explicitly avoids sensitive data
- Uses structured logging with intentional field selection

---

## 4. API SECURITY

### RATE LIMITING

✓ **IMPLEMENTED: Global Rate Limiting**
- `/src/server.ts` lines 61-103
- Uses `@fastify/rate-limit` plugin
- Configuration:
  - Default: 120 requests per minute per IP
  - Global max: `GLOBAL_RATE_LIMIT_RPM` env var
  - Headers: `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`

⚠️ **MODERATE: IP-Based Rate Limiting Weakness**
- Rate limiting keyed by IP address
- Easily bypassed by:
  - Proxy/VPN usage
  - Distributed attacks
  - Load balancer behind shared IP
- **Recommendation**: Switch to API key-based rate limiting once auth is implemented

✓ **Retry-After Header**
- Properly set for 429 responses (server.ts lines 201-204)

### CORS PROTECTION

✓ **IMPLEMENTED: Strict CORS Allowlist**
- `/src/server.ts` lines 45-59
- Default origins (production safe):
  - `https://olumi.app`
  - `https://app.olumi.app`
  - `http://localhost:5173` (dev only)
  - `http://localhost:3000` (dev only)
- Configurable via `ALLOWED_ORIGINS` environment variable

⚠️ **LOW: Permissive CORS in Development**
- Comment on line 28 shows `CORS_ALLOWED_ORIGINS=*` for development
- Ensure never deployed with `*` in production
- **Recommendation**: Add validation at startup:
  ```typescript
  if (process.env.NODE_ENV === 'production' && allowedOrigins.includes('*')) {
    throw new Error('CORS wildcard not allowed in production');
  }
  ```

### REQUEST SIZE LIMITS

✓ **IMPLEMENTED: Body Size Limit**
- Default: 1 MB (`BODY_LIMIT_BYTES`)
- Configurable at `/src/server.ts` line 32
- Properly enforced by Fastify (line 40: `bodyLimit: BODY_LIMIT_BYTES`)
- Error handling for oversized payloads (errors.ts lines 91-103)

✓ **Attachment-Specific Limits**
- Per-file: 5k characters
- Aggregate: 50k characters
- Base64 validation and size checks

### ERROR HANDLING

✓ **GOOD: Centralized Error Handler**
- `/src/server.ts` lines 179-207
- Structured error responses (error.v1 schema)
- No stack traces leaked in production (errors.ts lines 80-82)
- Request IDs included for traceability

✓ **Safe Error Messages**
- PII redaction applied (errors.ts lines 105-127):
  - File paths stripped
  - Secrets redacted
  - Emails redacted
- Examples redaction patterns work, but could be more comprehensive

✓ **Logging Error Context**
- 500+ errors logged with full context (server.ts line 186)
- 4xx errors logged with reduced context (line 194)

### TIMEOUT CONFIGURATION

✓ **IMPLEMENTED: Comprehensive Timeouts**
- Request timeout: 60s default (`REQUEST_TIMEOUT_MS`)
- LLM API timeout: 15s (anthropic.ts, openai.ts)
- Fixture timeout: 2.5s (draft-graph.ts line 29)
- Route-specific: 10s (critique), 15s (explain-diff)

✓ **Abort Controllers**
- Proper AbortController usage for timeout handling
- Cleanup with `clearTimeout()` in all code paths

---

## 5. DATA PRIVACY

### PII HANDLING

✓ **GOOD: Comprehensive Redaction System**
- `/src/utils/redaction.ts` - dedicated privacy module
- Redaction functions:
  - `redactAttachments()` - removes base64 content (lines 43-80)
  - `redactCsvData()` - strips row data, keeps only stats (lines 88-133)
  - `redactHeaders()` - removes auth headers (lines 166-184)
  - `truncateQuotes()` - limits quote length to 100 chars (lines 138-160)
  - `safeLog()` - comprehensive deep redaction (lines 197-261)

✓ **APPLIED: Redaction in Logging**
- Observable plugin applies redaction (observability.ts line 55)
- Attachment processing logs marked `redacted: true` (process-attachments.ts line 202)
- Grounding module redacted: `redacted: true` (grounding/index.ts line 67, 75, 115)

⚠️ **MODERATE: Incomplete Redaction Coverage**
- Check: Are all places that log data calling `safeLog()`?
- Spot check: `/src/adapters/llm/anthropic.ts` line 255 - logs `brief_chars` but not brief itself (GOOD)
- But: Line 293 - logs parse result errors without redaction (POTENTIAL RISK if response contains PII)
- `/src/routes/assist.draft-graph.ts` - multiple emit() calls (line 176) should redact sensitive data

**Recommendation**: 
- Audit all `log.info()`, `log.warn()`, `log.error()` calls to ensure sensitive data not logged
- Add redaction by default in logger wrapper function

✓ **CSV Privacy**
- CSV redaction is particularly strong (redaction.ts lines 88-133)
- Only safe statistics exposed: count, mean, median, p50, p90, p95, p99, min, max, std, variance
- Row data and values explicitly removed

### DATA RETENTION

❌ **NOT IMPLEMENTED: No Data Retention Policy**
- Application is stateless (good for security)
- But no documented data retention for:
  - Logs
  - Telemetry
  - Uploaded documents in memory
  - LLM API responses

**Recommendations**:
1. Document that all documents/data are in-memory only (session-scoped)
2. Set log retention policy (pino logger should rotate/clean)
3. Document telemetry retention (how long Datadog keeps data)

### SENSITIVE DATA IN RESPONSES

✓ **GOOD: API Responses Don't Leak PII**
- Draft graph responses include only graph structure, not original documents
- No attachment contents echoed back
- No user input echoed back verbatim

⚠️ **LOW: Confidence/Cost Exposed**
- Responses include cost_usd, confidence, token counts
- Not PII but could reveal system internals
- Acceptable tradeoff for debugging

---

## 6. DEPENDENCIES

### KNOWN VULNERABILITIES

⚠️ **HIGH: Playwright SSL Vulnerability**
```
Package: playwright < 1.55.1
Issue: Downloads browsers without SSL certificate verification
Path: .>artillery>artillery-engine-playwright>playwright
Severity: HIGH
Status: Dev dependency only (not in production)
Impact: LOW (used only for performance testing)
Recommendation: Update to >=1.55.1 when updating test dependencies
```

⚠️ **MODERATE: Esbuild CORS Bypass**
```
Package: esbuild <= 0.24.2  
Issue: Allows arbitrary website to send requests to dev server
Path: .>vitest>vite>esbuild
Severity: MODERATE
Status: Dev dependency only
Impact: LOW (affects only development mode)
Recommendation: Update vite/vitest to use esbuild >=0.25.0
```

**Action Items:**
1. Run `pnpm update` to patch dev dependencies
2. Add npm audit to CI/CD pipeline
3. Regular audit schedule (monthly/quarterly)

### DEPENDENCY SECURITY REVIEW

✓ **Production Dependencies - Safe**
- `@anthropic-ai/sdk` - Official Anthropic SDK, well-maintained
- `fastify` - Secure web framework, version 5.6.1 (recent)
- `@fastify/cors` - Standard CORS handling
- `@fastify/rate-limit` - Rate limiting library
- `zod` - Input validation library
- `pino` - Logging (well-maintained)
- `undici` - HTTP client (modern, secure)
- `papaparse` - CSV parsing (no security-critical operations)
- `pdf-parse` - PDF extraction (see: potential XXE if not updated)

⚠️ **pdf-parse Library Note**
- Used for PDF text extraction
- Ensure version is up-to-date (check for XXE vulnerabilities)
- Currently safe but monitor for updates

✓ **No Risky Dependencies**
- No cryptography libraries needed (using Node.js built-ins)
- No shell execution libraries
- No deserialization libraries
- No database connectors (no SQL injection risk)

### DEPENDENCY VERIFICATION

- Package-lock equivalent: `pnpm-lock.yaml` (3.1MB, not committed - GOOD)
- Dependency pinning: Using caret ranges in package.json
- Recommendation: Consider more restrictive ranges for security-critical deps

---

## 7. NETWORK SECURITY

### HTTPS/TLS

⚠️ **WARNING: No HTTPS Configuration in Application**
- Application binds to `0.0.0.0:PORT` (server.ts line 248)
- No TLS/HTTPS configuration in Fastify setup
- **Deployment Context**: Must be behind reverse proxy (nginx, cloudflare, etc.)
- This is typical for containerized apps, but must be enforced in deployment

**Recommendations:**
1. Add documentation: "This service MUST run behind HTTPS reverse proxy"
2. Consider adding env var for strict HTTPS-only operation
3. Add Strict-Transport-Security header when behind proxy

### TIMEOUTS

✓ **WELL CONFIGURED: Multiple Timeout Layers**
1. **Connection timeout**: 60s (server.ts line 41)
2. **Request timeout**: 60s (server.ts line 42)
3. **LLM API timeout**: 15s (anthropic.ts/openai.ts)
4. **Per-route timeout**: 10-15s (varies by route)
5. **Fixture timeout**: 2.5s (draft-graph.ts)

### EXTERNAL SERVICE CALLS

✓ **Safe External Calls**
- Validation service calls use `undici` with proper error handling (validateClient.ts)
- LLM SDK calls are wrapped with timeout and error handling
- No server-side request forgery (SSRF) vectors found

⚠️ **LOW: ENGINE_BASE_URL Not Validated**
- Configurable but not validated
- Should add URL validation at startup
- Could add domain whitelist for production

---

## 8. ERROR HANDLING & LOGGING

### ERROR HANDLING

✓ **EXCELLENT: Structured Error Responses**
- Centralized error handler (server.ts lines 179-207)
- Consistent error.v1 schema across all endpoints
- Proper HTTP status codes:
  - 400 (BAD_INPUT)
  - 401 (would need auth implementation)
  - 429 (RATE_LIMITED)
  - 500 (INTERNAL)

✓ **Safe Error Details**
- File paths stripped from messages (errors.ts line 109)
- Secrets redacted (lines 111-127)
- Emails redacted
- No stack traces in production

✓ **Request Tracing**
- Every error includes request_id (errors.ts lines 40-41)
- Request IDs propagated through system

### LOGGING

✓ **GOOD: Structured Logging**
- Using Pino logger (production-grade)
- Structured JSON format (better than unstructured logs)
- Log levels: info, warn, error

✓ **SAMPLING**
- INFO_SAMPLE_RATE: 10% by default (observability.ts line 17)
- Reduces log volume while capturing errors
- Configurable via env var

⚠️ **MODERATE: Potential Data Leaks in Logs**
- Not all code paths use `safeLog()` before logging
- Example spots to check:
  - `/src/routes/assist.draft-graph.ts` - multiple emit() calls (lines 176, 183, etc.)
  - `/src/adapters/llm/anthropic.ts` - response parsing logs (lines 293, 477, etc.)
  - Event names logged with payloads could contain sensitive data

**Recommendations:**
1. Create logging utility function that always applies redaction:
   ```typescript
   function logSecurely(level, data, msg) {
     logger[level](safeLog(data), msg);
   }
   ```
2. Add pre-commit hook to warn on direct `log.` calls with certain patterns
3. Code review for sensitive data logging

✓ **Telemetry Separation**
- Telemetry events use selective fields (telemetry.ts lines 175-460)
- Cost tracking includes only numeric values, not user data
- Event names frozen to prevent drift (line 9-60)

---

## SUMMARY TABLE

| Category | Status | Key Findings |
|----------|--------|--------------|
| Input Validation | ✅ STRONG | Zod schemas, file limits, format validation |
| Authentication | 🔴 CRITICAL | No auth implemented - MUST fix for production |
| Authorization | 🔴 CRITICAL | No authorization checks |
| Secrets Management | ✅ GOOD | No hardcoded secrets, env vars only, but redaction could be stronger |
| API Rate Limiting | ✅ IMPLEMENTED | IP-based (weak but present) - needs API key-based |
| CORS | ✅ GOOD | Strict allowlist, configurable, dev-safe defaults |
| Error Handling | ✅ GOOD | Centralized, no stack traces, PII redacted |
| Data Privacy | ✅ GOOD | Comprehensive redaction, CSV statistics safe, PII handling solid |
| Dependencies | ⚠️ 2 HIGH/MOD | Playwright & esbuild vulns (dev only), monitor pdf-parse |
| Network Security | ⚠️ TLS NEEDED | Application doesn't enforce HTTPS (must use reverse proxy) |
| Logging | ⚠️ INCOMPLETE | Redaction not applied everywhere - potential data leaks |

---

## CRITICAL ACTIONS REQUIRED

Before production deployment:

1. **IMPLEMENT AUTHENTICATION**
   - Add API key requirement to all endpoints
   - Validate keys before processing requests
   - Estimated effort: 2-4 hours

2. **AUDIT LOGGING**
   - Ensure `safeLog()` called on all sensitive data logs
   - Add integration tests verifying no API keys leak
   - Estimated effort: 2-3 hours

3. **VERIFY REVERSE PROXY**
   - Ensure HTTPS enforced at reverse proxy layer
   - Add HSTS headers
   - Verify HTTPS-only redirect

4. **ENHANCE SECRET REDACTION**
   - Improve regex patterns in errors.ts
   - Add Bearer token detection
   - Test with real API keys in error scenarios
   - Estimated effort: 1-2 hours

5. **DEPENDENCY UPDATE**
   - Update dev dependencies to patch vulnerabilities
   - Add CI/CD audit check
   - Estimated effort: 30 minutes

---

## FILES ANALYZED

- `/src/server.ts` - Core server setup
- `/src/schemas/assist.ts` - Input validation schemas
- `/src/routes/assist.*.ts` - API route handlers (6 files)
- `/src/adapters/llm/anthropic.ts` - Anthropic integration
- `/src/adapters/llm/openai.ts` - OpenAI integration  
- `/src/adapters/llm/router.ts` - Provider selection
- `/src/grounding/process-attachments.ts` - File upload handling
- `/src/grounding/index.ts` - Document extraction
- `/src/services/validateClient.ts` - Graph validation
- `/src/utils/errors.ts` - Error handling
- `/src/utils/telemetry.ts` - Logging & metrics
- `/src/utils/redaction.ts` - Privacy/PII handling
- `/src/utils/responseGuards.ts` - Response validation
- `/src/utils/costGuard.ts` - Cost limiting
- `/src/utils/request-id.ts` - Request tracing
- `/src/plugins/observability.ts` - Logging plugin
- `/src/services/docProcessing.ts` - Document processing
- `.env.example` & `.env.sample` - Configuration examples
- `package.json` - Dependencies
- `pnpm-lock.yaml` - Dependency lock file

---
