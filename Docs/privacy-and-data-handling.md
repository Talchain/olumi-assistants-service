# Privacy and Data Handling

**Service:** Olumi Assistants Service
**Version:** 1.1.1
**Last Updated:** 2025-01-07

## Overview

The Olumi Assistants Service implements comprehensive privacy protections to ensure personally identifiable information (PII) and sensitive data are never exposed through logs, error messages, or API responses.

## Core Privacy Principles

1. **No Raw Data Exposure**: Never log or return raw file contents (base64 attachments, CSV rows, full documents)
2. **Truncated References Only**: Limit quotes to 100 characters maximum
3. **Aggregate Statistics Only**: For CSV data, expose only count/mean/percentiles, never individual row values
4. **Redacted Logging**: All logs automatically strip sensitive data before emission
5. **Structured Error Responses**: Error messages never leak stack traces or internal details
6. **Evidence Packs**: Downloadable provenance contains only redacted citations and statistics

## Data Flow and Processing

### Input Processing

When users submit requests with attachments (PDFs, CSVs, text files):

1. **Document Grounding** (feature flag: `ENABLE_GROUNDING`)
   - Extracts text and metadata for LLM context
   - Creates citations with truncated quotes (≤100 chars)
   - For CSVs: generates statistics only, discards row data
   - Base64 content is decoded but never logged

2. **Attachment Redaction**
   - Before logging any payload, `redactAttachments()` replaces base64 content with `[REDACTED]:hash_prefix`
   - Hash prefix (first 8 chars) allows tracking without exposing data

### LLM Processing

When sending data to LLM providers:

1. **Context Building**
   - Document summaries and citations included in prompt
   - CSV statistics (not rows) included in prompt
   - Original attachments never sent to LLM

2. **Response Handling**
   - LLM generates graph nodes, edges, rationales
   - Rationales may reference documents with short quotes
   - All quotes truncated to 100 characters before storage

### Output Generation

When returning results to users:

1. **Standard Responses**
   - Graph structure (nodes, edges)
   - Rationales with document provenance
   - Citations with location and truncated quotes
   - CSV statistics (if grounding enabled)

2. **Evidence Packs** (feature flag: `ENABLE_EVIDENCE_PACK`)
   - Downloadable JSON with complete provenance
   - Document citations: source, location, quote (≤100 chars)
   - CSV statistics: filename, row_count, column_count, aggregates
   - Privacy notice explaining what's included/excluded

## Redaction Utilities

### `src/utils/redaction.ts`

#### Functions

**`redactAttachments(payload)`**
- Replaces base64 attachment content with `[REDACTED]:hash_prefix`
- Preserves filename, mime_type for tracking
- Hash prefix allows correlation without exposing data

**`redactCsvData(obj)`**
- Removes: `rows`, `data`, `values`, `raw_data` fields
- Keeps: `count`, `mean`, `median`, `p50`, `p90`, `p95`, `p99`, `min`, `max`, `std`, `variance`
- Recursively scans nested objects

**`truncateQuotes(obj)`**
- Finds all `quote` fields in nested structures
- Truncates to 100 characters with ellipsis
- Preserves structure, only modifies quote strings

**`redactHeaders(headers)`**
- Removes: `authorization`, `x-api-key`, `cookie`, `set-cookie`, `x-auth-token`
- Preserves other headers for debugging

**`safeLog(obj)`**
- Applies all redactions in order
- Deep clones to avoid mutating original
- Adds `redacted: true` flag for audit trail
- Use this for all structured logging

#### Example Usage

```typescript
import { safeLog } from "./utils/redaction.js";

// Before logging request payload
app.log.info(safeLog({
  request_id: "abc123",
  payload: req.body
}), "Request received");

// Attachments automatically redacted
// CSV data automatically filtered
// Quotes automatically truncated
```

## Logging Policy

### What We Log

**Info Level (sampled at 10%)**:
- Request ID, method, URL, status code
- Duration in milliseconds
- User agent (for debugging)
- Graph size (node/edge counts)
- Feature flags used

**Warn Level (always)**:
- Client errors (4xx status codes)
- Validation failures
- Rate limit hits
- Guard violations

**Error Level (always)**:
- Server errors (5xx status codes)
- LLM provider errors
- Unexpected exceptions

### What We Never Log

- ❌ Base64 attachment content
- ❌ CSV row data or individual values
- ❌ Full document text (only truncated quotes)
- ❌ Stack traces (unless `LOG_STACK=1` in dev)
- ❌ Authorization headers or API keys
- ❌ User PII (names, emails, addresses)

### Observability Plugin

The observability plugin (`src/plugins/observability.ts`) automatically:
- Samples info-level logs (10% by default, configurable via `INFO_SAMPLE_RATE`)
- Always logs errors (no sampling)
- Applies redaction via `safeLog()` before emission
- Tracks request duration
- Propagates request IDs

## Evidence Pack Generation

### Purpose

Evidence packs provide auditable decision provenance without exposing sensitive data. They enable users to:
- Understand which documents influenced decisions
- Review statistical reasoning (for CSV data)
- Trace rationales back to source materials
- Download for compliance/audit purposes

### What's Included

**Document Citations**:
```json
{
  "source": "requirements.pdf",
  "location": "page 3, paragraph 2",
  "quote": "Scalability is a top priority for our platform architecture...",
  "provenance_source": "doc_0"
}
```

**CSV Statistics**:
```json
{
  "filename": "sales_data.csv",
  "row_count": 1000,
  "column_count": 5,
  "statistics": {
    "revenue": {
      "count": 1000,
      "mean": 45000,
      "p50": 42000,
      "p90": 78000,
      "p95": 92000,
      "min": 1000,
      "max": 150000
    }
  }
}
```

**Rationales with Provenance**:
```json
{
  "target": "node_0",
  "why": "Based on document requirements emphasizing scalability",
  "provenance_source": "doc_0",
  "quote": "Scalability is a top priority...",
  "location": "page 3"
}
```

### What's Excluded

- ❌ Raw file contents or base64 data
- ❌ Individual CSV row values
- ❌ Full text extracts (only ≤100 char quotes)
- ❌ Personally identifiable information

### Privacy Notice

Every evidence pack includes:
```
This evidence pack contains only:
- Document citations with truncated quotes (max 100 characters)
- Aggregated CSV statistics (count, mean, percentiles)
- Rationales with provenance references

It does NOT contain:
- Raw file contents or base64 data
- Individual CSV row values
- Full text extracts
- Personally identifiable information (PII)
```

## CSV Privacy Guarantees

### Processing Pipeline

1. **Upload**: User uploads CSV with base64 encoding
2. **Parsing**: Service decodes and parses CSV structure
3. **Statistics**: Calculate aggregates (count, mean, p50, p90, p95, p99, min, max)
4. **Discard**: Immediately discard row data from memory
5. **LLM Context**: Only statistics sent to LLM, never row values
6. **Response**: Only statistics returned in API response

### Statistical Safety

**Safe to expose**:
- Row count, column count
- Mean, median, min, max
- Percentiles (p50, p90, p95, p99)
- Standard deviation, variance

**Never exposed**:
- Individual row values
- Column names if they contain PII
- Raw CSV text
- Intermediate parsed data

### Validation Test

The integration test `tests/integration/privacy.csv.integration.test.ts` verifies:
- CSV uploaded with PII (names: Alice, Bob)
- Draft generated with grounding enabled
- Response contains ONLY statistics
- Response does NOT contain row values
- Response does NOT contain names from CSV

## Error Handling and Privacy

### Structured Error Responses

All errors use the `error.v1` schema:
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "Validation failed",
  "details": {
    "field": "brief",
    "reason": "Required field missing"
  },
  "request_id": "req_abc123"
}
```

### Error Privacy Rules

1. **Never leak stack traces** to API responses
2. **Never include internal paths** or file names
3. **Never expose environment variables** or config
4. **Generic messages** for 500 errors ("Internal server error")
5. **Specific messages** for 4xx errors (validation, rate limits)
6. **Request ID always included** for support correlation

### Error Logging

- Stack traces logged server-side ONLY if `LOG_STACK=1`
- Errors always include request_id for correlation
- Error details sanitized via `safeLog()` before logging

## Request ID Tracking

Every request receives a unique request ID:
- Accepted from `X-Request-Id` header (if provided)
- Generated as UUID v4 (if not provided)
- Returned in `X-Request-Id` response header
- Included in all log entries
- Included in all error responses

This enables end-to-end tracing without exposing sensitive data.

## CORS and Security

**Allowed Origins** (strict allowlist):
- `https://olumi.app` (production)
- `http://localhost:5173` (dev frontend)
- `http://localhost:3000` (alternative dev)

**Configurable via**: `ALLOWED_ORIGINS` environment variable (comma-separated)

**Why strict allowlist?**
- Prevents unauthorized API access
- Reduces CSRF attack surface
- Enforces intended client usage

## Rate Limiting

**Global rate limit**: 60 requests per minute per IP
**SSE rate limit**: 10 requests per minute per IP

**Privacy benefit**: Prevents automated scraping or bulk data extraction

**Error response includes**:
- `Retry-After` header (seconds to wait)
- Error code: `RATE_LIMITED`
- No details about other users or request patterns

## Compliance Checklist

Before deploying to production, verify:

- [ ] `ENABLE_GROUNDING` defaults to `false` (opt-in only)
- [ ] `ENABLE_EVIDENCE_PACK` defaults to `false` (opt-in only)
- [ ] Observability plugin registered (automatic redaction)
- [ ] Rate limiting enabled (prevents bulk extraction)
- [ ] CORS allowlist configured (no wildcards)
- [ ] Integration test `privacy.csv.integration.test.ts` passes
- [ ] Manual smoke test: upload CSV with PII, verify no leakage
- [ ] Review logs for any `[REDACTED]` markers (proves redaction works)

## Troubleshooting

### "Redaction not working"

**Symptom**: Seeing base64 or CSV rows in logs

**Check**:
1. Is observability plugin registered? (`src/server.ts` line ~96)
2. Are you using `app.log.info(safeLog(data))`?
3. Is `INFO_SAMPLE_RATE` set correctly? (default 0.1)

### "Evidence pack contains PII"

**Symptom**: User reports seeing sensitive data in evidence pack

**Check**:
1. Is quote truncation working? (`truncateQuotes()` in `evidence-pack.ts`)
2. Are CSV statistics filtered? (`redactCsvData()` in `redaction.ts`)
3. Review `buildEvidencePackRedacted()` implementation

### "Logs too verbose"

**Symptom**: Info logs overwhelming log aggregator

**Solution**: Adjust `INFO_SAMPLE_RATE` environment variable (default 0.1 = 10%)

## References

- [Operator Runbook](./operator-runbook.md) - Deployment and monitoring
- [Feature Flags Documentation](../src/utils/feature-flags.ts) - Capability toggles
- [Redaction Utilities](../src/utils/redaction.ts) - Implementation details
- [Evidence Pack Builder](../src/utils/evidence-pack.ts) - Provenance generation

## Contact

For privacy-related questions or incidents:
1. Check logs with request ID for correlation
2. Review this document for expected behavior
3. Escalate to security team if PII exposure suspected
4. Do NOT share logs externally without redaction review
