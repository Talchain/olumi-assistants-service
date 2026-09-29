# API & Integration Documentation

Complete API reference and integration guides for the Olumi Assistants Service. This directory contains everything needed to integrate with and deploy the service.

**For the complete documentation index**, see [Docs/README.md](../README.md).

---

## Quick Start

**New to the API?** Start here:
1. **[Frontend Integration Guide](FRONTEND_INTEGRATION.md)** - Complete API reference with examples
2. **[SSE Streaming API](SSE-RESUME-API.md)** - Server-Sent Events with resume capability
3. **[Provider Configuration](provider-configuration.md)** - LLM provider setup

**Deploying the service?**
- **[Staging Setup Instructions](STAGING_SETUP_INSTRUCTIONS.md)** - Complete deployment guide for Render.com

---

## Documentation by Category

### Core API Reference

**[Frontend Integration Guide](FRONTEND_INTEGRATION.md)**
- **Purpose:** Complete API reference for frontend and client integrations
- **Audience:** Frontend developers, API consumers
- **Contents:**
  - All API endpoints with request/response schemas
  - Authentication methods (API keys, HMAC signatures)
  - Error handling and retry strategies
  - Rate limiting and quotas
  - Feature flags and configuration
  - Code examples for common operations

**[SSE Streaming API](SSE-RESUME-API.md)**
- **Purpose:** Server-Sent Events (SSE) streaming with resume capability
- **Audience:** Frontend developers implementing real-time updates
- **Contents:**
  - SSE protocol and event types
  - Resume token usage for connection recovery
  - Streaming progress events (DRAFTING, COMPLETE, ERROR)
  - Client implementation patterns
  - Connection timeout handling
  - Best practices for unreliable networks

---

### Configuration & Setup

**[Provider Configuration](provider-configuration.md)**
- **Purpose:** LLM provider setup and configuration guide
- **Audience:** Operators, developers
- **Contents:**
  - Anthropic Claude configuration
  - OpenAI GPT configuration
  - Provider failover and fallback strategies
  - API key management
  - Cost optimization with prompt caching

**[Staging Setup Instructions](STAGING_SETUP_INSTRUCTIONS.md)**
- **Purpose:** Complete deployment guide for Render.com and other platforms
- **Audience:** Operators, DevOps, SRE
- **Contents:**
  - Render.com deployment steps
  - Environment variable configuration
  - CORS and security setup
  - Health check configuration
  - Production readiness checklist

---

### Validation & Quality

**[OpenAPI Validation](openapi-validation.md)**
- **Purpose:** OpenAPI schema validation and type generation
- **Audience:** Backend developers, API maintainers
- **Contents:**
  - OpenAPI spec validation workflow
  - TypeScript type generation from schema
  - Schema versioning and breaking changes
  - API contract testing
  - CI/CD integration

---

## API Endpoints

### Draft Graph Generation
- **POST /assist/draft-graph** - Generate decision graph from brief
- **GET /assist/stream** - SSE streaming endpoint for draft generation
- **POST /assist/resume** - Resume interrupted SSE stream

### CEE (Contextual Evidence Engine)
- **POST /assist/v1/bias-check** - Detect potential biases in graph
- **POST /assist/v1/evidence-helper** - Assess evidence quality
- **POST /assist/v1/explain-graph** - Generate graph explanation
- **POST /assist/v1/sensitivity-coach** - Identify sensitive decision aspects
- **POST /assist/v1/team-perspectives** - Analyze team disagreement

See **[Frontend Integration Guide](FRONTEND_INTEGRATION.md)** for complete endpoint documentation.

---

## Authentication

The service supports two authentication methods:

### API Key Authentication
```bash
curl -X POST https://olumi-assistants-service.onrender.com/assist/draft-graph \
  -H "X-Olumi-Assist-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"brief": "Your decision brief"}'
```

### HMAC Signature Authentication
```bash
curl -X POST https://olumi-assistants-service.onrender.com/assist/draft-graph \
  -H "X-Olumi-Signature: sha256=<hex-signature>" \
  -H "X-Olumi-Timestamp: <unix-timestamp>" \
  -H "Content-Type: application/json" \
  -d '{"brief": "Your decision brief"}'
```

See **[Frontend Integration Guide](FRONTEND_INTEGRATION.md#authentication)** for detailed authentication documentation.

---

## Rate Limiting

The service implements three-tier rate limiting:

1. **Global Rate Limit** - 120 req/min per IP
2. **Per-Key Rate Limit** - 120 req/min per API key
3. **CEE Feature Limits** - 5 req/min per CEE feature per API key

Rate limit responses include `Retry-After` header.

See **[Frontend Integration Guide](FRONTEND_INTEGRATION.md#rate-limiting)** for handling rate limits.

---

## Common Integration Patterns

### Basic Draft Generation
```javascript
const response = await fetch('https://olumi-assistants-service.onrender.com/assist/draft-graph', {
  method: 'POST',
  headers: {
    'X-Olumi-Assist-Key': API_KEY,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    brief: 'Should we adopt a four-day work week?',
    config: { streaming: false }
  })
});

const { graph } = await response.json();
```

### SSE Streaming with Resume
```javascript
const eventSource = new EventSource(
  `https://olumi-assistants-service.onrender.com/assist/stream?brief=${encodeURIComponent(brief)}`,
  { headers: { 'X-Olumi-Assist-Key': API_KEY } }
);

eventSource.addEventListener('progress', (event) => {
  const data = JSON.parse(event.data);
  if (data.resume_token) {
    localStorage.setItem('resume_token', data.resume_token);
  }
});

eventSource.addEventListener('complete', (event) => {
  const { graph } = JSON.parse(event.data);
  // Use the completed graph
});
```

See **[Frontend Integration Guide](FRONTEND_INTEGRATION.md#examples)** for more patterns.

---

## Error Handling

All endpoints return standardized error responses:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded for API key",
    "details": {
      "retry_after_seconds": 60
    }
  }
}
```

Common error codes:
- `AUTHENTICATION_FAILED` - Invalid or missing API key
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `INVALID_REQUEST` - Malformed request body
- `LLM_ERROR` - LLM provider error
- `INTERNAL_ERROR` - Server error

See **[Frontend Integration Guide](FRONTEND_INTEGRATION.md#error-handling)** for complete error reference.

---

## See Also

### Related Documentation
- **[CEE Documentation](../cee/README.md)** - CEE subsystem API details
- **[Architecture Overview](../getting-started/architecture.md)** - System architecture
- **[Operator Runbook](../cee/CEE-ops.md)** - Production operations
- **[Contributing Guide](../contributing.md)** - Development workflow

### External Resources
- **Production API:** https://olumi-assistants-service.onrender.com
- **Health Check:** https://olumi-assistants-service.onrender.com/healthz
- **OpenAPI Spec:** [openapi.yaml](../../openapi.yaml)

---

**Last Updated:** 2025-11-22
**Maintained By:** Olumi Engineering Team
