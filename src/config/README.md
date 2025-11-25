# Centralized Configuration Module

## Overview

This module provides type-safe, validated access to all environment variables throughout the application. It replaces direct `process.env` usage with a centralized configuration object.

## Benefits

- **Type Safety**: All configuration values have proper TypeScript types
- **Validation**: Invalid configurations fail fast at startup with clear error messages
- **Testability**: Easy to mock and override in tests
- **Documentation**: Single source of truth for all configuration
- **Defaults**: Sensible defaults for optional values
- **IntelliSense**: Auto-completion and documentation in your IDE

## Usage

### Basic Usage

```typescript
import { config } from "./config/index.js";

// Access configuration values with full type safety
const port = config.server.port; // number
const isGroundingEnabled = config.features.grounding; // boolean
const redisUrl = config.redis.url; // string | undefined
```

### Environment Detection

```typescript
import { isProduction, isDevelopment, isTest } from "./config/index.js";

if (isProduction()) {
  // Production-only logic
}

if (isDevelopment()) {
  // Development-only logic
}

if (isTest()) {
  // Test-only logic
}
```

## Configuration Structure

The configuration is organized into logical groups:

### Server Configuration

```typescript
config.server.port          // PORT (default: 3000)
config.server.nodeEnv       // NODE_ENV (default: "development")
config.server.logLevel      // LOG_LEVEL (default: "info")
config.server.version       // SERVICE_VERSION
config.server.baseUrl       // BASE_URL
```

### Authentication

```typescript
config.auth.assistApiKeys   // ASSIST_API_KEYS (array)
config.auth.assistApiKey    // ASSIST_API_KEY (legacy single key)
config.auth.hmacSecret      // HMAC_SECRET
config.auth.hmacMaxSkewMs   // HMAC_MAX_SKEW_MS (default: 300000)
config.auth.islApiKey       // ISL_API_KEY
config.auth.shareSecret     // SHARE_SECRET
```

### LLM Configuration

```typescript
config.llm.provider           // LLM_PROVIDER (default: "anthropic")
config.llm.model              // LLM_MODEL
config.llm.anthropicApiKey    // ANTHROPIC_API_KEY
config.llm.openaiApiKey       // OPENAI_API_KEY
config.llm.failoverProviders  // LLM_FAILOVER_PROVIDERS (array)
config.llm.providersConfigPath // PROVIDERS_CONFIG_PATH
```

### Feature Flags

```typescript
config.features.grounding      // GROUNDING_ENABLED (default: true)
config.features.critique       // CRITIQUE_ENABLED (default: true)
config.features.clarifier      // CLARIFIER_ENABLED (default: true)
config.features.piiGuard       // PII_GUARD_ENABLED (default: false)
config.features.shareReview    // SHARE_REVIEW_ENABLED (default: false)
config.features.enableLegacySSE // ENABLE_LEGACY_SSE (default: false)
```

### Performance Monitoring

```typescript
config.performance.metricsEnabled    // PERF_METRICS_ENABLED (default: true)
config.performance.slowThresholdMs   // PERF_SLOW_THRESHOLD_MS (default: 30000)
config.performance.p99ThresholdMs    // PERF_P99_THRESHOLD_MS (default: 30000)
```

### Redis Configuration

```typescript
config.redis.url                // REDIS_URL
config.redis.tls                // REDIS_TLS (default: false)
config.redis.namespace          // REDIS_NAMESPACE (default: "assistants")
config.redis.connectTimeout     // REDIS_CONNECT_TIMEOUT (default: 10000)
config.redis.commandTimeout     // REDIS_COMMAND_TIMEOUT (default: 5000)
config.redis.quotaEnabled       // REDIS_QUOTA_ENABLED (default: false)
config.redis.hmacNonceEnabled   // REDIS_HMAC_NONCE_ENABLED (default: false)
config.redis.promptCacheEnabled // REDIS_PROMPT_CACHE_ENABLED (default: false)
```

## Migration Guide

### Before (Direct process.env)

```typescript
// ❌ Old way: No type safety, no validation, no defaults
const port = parseInt(process.env.PORT || "3000", 10);
const isGroundingEnabled = process.env.GROUNDING_ENABLED !== "false";
const redisUrl = process.env.REDIS_URL;
const maxNodes = parseInt(process.env.GRAPH_MAX_NODES || "100", 10);
```

### After (Centralized config)

```typescript
// ✅ New way: Type-safe, validated, with defaults
import { config } from "./config/index.js";

const port = config.server.port;
const isGroundingEnabled = config.features.grounding;
const redisUrl = config.redis.url;
const maxNodes = config.graph.maxNodes;
```

### Migration Steps

1. **Import the config module**:
   ```typescript
   import { config } from "./config/index.js";
   ```

2. **Replace process.env access**:
   - Find: `process.env.GROUNDING_ENABLED !== "false"`
   - Replace: `config.features.grounding`

3. **Remove manual parsing**:
   - Find: `parseInt(process.env.PORT || "3000", 10)`
   - Replace: `config.server.port`

4. **Update conditionals**:
   - Find: `process.env.NODE_ENV === "production"`
   - Replace: `isProduction()` or `config.server.nodeEnv === "production"`

### Common Patterns

#### Boolean Feature Flags

```typescript
// Before
if (process.env.GROUNDING_ENABLED !== "false") {
  // Enable grounding
}

// After
if (config.features.grounding) {
  // Enable grounding
}
```

#### Numeric Configuration

```typescript
// Before
const timeout = parseInt(process.env.GRAPH_MAX_NODES || "100", 10);

// After
const timeout = config.graph.maxNodes;
```

> **Note on ISL Configuration:** The ISL adapter uses specialized parsing functions
> (`parseTimeout()`, `parseMaxRetries()`) that handle validation, clamping, and logging
> for invalid values. See `src/adapters/isl/config.ts` for details.

#### Comma-Separated Lists

```typescript
// Before
const keys = (process.env.ASSIST_API_KEYS || "").split(",");

// After
const keys = config.auth.assistApiKeys || [];
```

#### Optional Values

```typescript
// Before
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is required");
}

// After
const redisUrl = config.redis.url;
if (!redisUrl) {
  throw new Error("REDIS_URL is required");
}
// Note: The config module doesn't make this required by default,
// but you can add runtime checks where needed
```

## Migration Strategy

### Lazy Initialization Solution ✅

The config module uses **lazy initialization with Proxy pattern** - environment variables are parsed on first property access, not on module import. This solves the singleton initialization timing issue that was blocking migrations.

**How it works:**
```typescript
// Config is NOT parsed when you import
import { config } from "./config/index.js";

// Config IS parsed when you first access a property
const port = config.server.port; // ← Parsing happens here

// Subsequent accesses use the cached config
const env = config.server.nodeEnv; // ← Fast, no re-parsing
```

**Benefits:**
- ✅ Tests can set environment variables before config is accessed
- ✅ No more "Configuration validation failed" errors from early imports
- ✅ Fully backward compatible with existing code
- ✅ All files are now safe to migrate

### All Files Are Safe to Migrate

With lazy initialization, **all files are now safe to migrate** regardless of position in the import graph.

**Migration Priority** (recommended order):
1. **Route handlers** (`src/routes/**`) - Direct user-facing code
2. **Adapters** (`src/adapters/**`) - External service integrations
3. **Services** (`src/services/**`) - Business logic layer
4. **CEE modules** (`src/cee/**`) - Decision engineering features
5. **Utilities** (`src/utils/**`) - Even early-imported files
6. **Plugins** (`src/plugins/**`) - Server initialization code

**Previously Problematic Files** (now safe):
- ✅ `src/utils/simple-logger.ts` - Can now use config.server.logLevel
- ✅ `src/version.ts` - Can access config.server.version
- ✅ `src/plugins/**` - Can use config values during setup
- ✅ Test utilities - Can import config without initialization errors

### Recommended Migration Approach

1. **Start with route handlers**: These are only imported when the server is built (after test setup)

   ```typescript
   // src/routes/assist.draft-graph.ts
   import { config } from "../config/index.js";

   // Replace process.env usage
   if (config.features.grounding) {
     // Enable grounding
   }
   ```

2. **Move to adapters and services**: These are typically lazy-loaded

   ```typescript
   // src/adapters/llm/anthropic.ts
   import { config } from "../config/index.js";

   const apiKey = config.llm.anthropicApiKey;
   ```

3. **Handle CEE modules**: Safe to migrate as they're only used within routes

   ```typescript
   // src/cee/bias/index.ts
   import { config } from "../config/index.js";

   const biasCheckEnabled = config.cee.biasCheckFeatureVersion !== undefined;
   ```

4. **Migrate all remaining files**: With lazy initialization, no file is too early in the import graph

### Testing Migrated Files

After migrating a file, verify it doesn't break tests:

```bash
# Run full test suite
pnpm test

# Check for TypeScript errors
pnpm typecheck
```

With lazy initialization, configuration errors should no longer occur due to import timing. If tests fail:
- Check that environment variables are set correctly in test setup
- Use `_resetConfigCache()` in tests that need fresh config parsing
- Verify the migration didn't introduce logic errors

### Migration Progress Tracking

Create issues/PRs for each logical group:
- [ ] Phase 1: Route handlers (10-15 files)
- [ ] Phase 2: Adapters (5-8 files)
- [ ] Phase 3: Services (3-5 files)
- [ ] Phase 4: CEE modules (6-10 files)
- [ ] Phase 5: Remaining safe files

## Testing

### Test Helpers

The project provides centralized test helpers in `tests/helpers/env-setup.ts`:

```typescript
import { cleanBaseUrl, cleanCEEFlags, cleanTestEnv } from "../helpers/env-setup.js";

// Clean BASE_URL before building app (prevents config validation errors)
cleanBaseUrl();

// Clean all CEE feature flags
cleanCEEFlags();

// Clean both BASE_URL and CEE flags
cleanTestEnv();
```

### Mocking Configuration in Tests

With lazy initialization, you have three approaches for testing with custom configuration:

**Approach 1: Use test helpers + `_resetConfigCache()`** (Recommended for integration tests)

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("My Feature", () => {
  let app;

  beforeAll(async () => {
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    cleanBaseUrl(); // Prevents "Invalid url" validation errors
    app = await build();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });
});
```

**Approach 2: Dynamic imports with config reset** (Required for tests that change env mid-test)

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("Config-dependent tests", () => {
  beforeEach(async () => {
    vi.resetModules();
    cleanBaseUrl();
    // Reset config cache AFTER vi.resetModules()
    const { _resetConfigCache } = await import("../../src/config/index.js");
    _resetConfigCache();
  });

  it("should respect CEE_CAUSAL_VALIDATION_ENABLED flag", async () => {
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = "true";
    process.env.ISL_BASE_URL = "http://localhost:8080";

    // Dynamic import to get fresh module with new env vars
    const { causalValidationEnabled } = await import("../../src/adapters/isl/config.js");
    expect(causalValidationEnabled()).toBe(true);
  });
});
```

**Approach 3: Simple config reset** (For unit tests with static imports)

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { config, _resetConfigCache } from "./config/index.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("My Feature", () => {
  beforeEach(async () => {
    cleanBaseUrl();
    vi.unstubAllEnvs();
    const { _resetConfigCache } = await import("../../src/config/index.js");
    _resetConfigCache();
  });

  it("should work with custom config", () => {
    process.env.GROUNDING_ENABLED = "false";
    _resetConfigCache();
    expect(config.features.grounding).toBe(false);
  });
});
```

### When to Use Each Pattern

| Pattern | Use When |
|---------|----------|
| Test helpers + `beforeAll` | Integration tests that build the app once |
| Dynamic imports | Tests that change env vars between test cases |
| Simple config reset | Unit tests with static imports |

### Common Test Setup Pattern

For integration tests, the recommended pattern is:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";

describe("My Integration Test", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("ASSIST_API_KEYS", "test-key");
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("should work", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
  });
});
```

### Troubleshooting Test Failures

**"Invalid configuration. Please check environment variables."**

This usually means config was parsed with stale/invalid env vars. Solutions:
1. Add `cleanBaseUrl()` before building the app
2. Use `_resetConfigCache()` after changing env vars
3. Use dynamic imports for config-dependent code

**"Invalid url" validation error for `server.baseUrl`**

The `BASE_URL` env var may be set to an invalid value from a previous test:
```typescript
cleanBaseUrl(); // Add this before building the app
```

**Config values not updating between tests**

The config is cached after first access. Reset it:
```typescript
beforeEach(async () => {
  const { _resetConfigCache } = await import("../../src/config/index.js");
  _resetConfigCache();
});
```

## Validation

The config module validates all values at startup. Invalid configurations will fail with clear error messages:

```
❌ Configuration validation failed:
[
  {
    "code": "invalid_type",
    "expected": "number",
    "received": "string",
    "path": ["server", "port"],
    "message": "Expected number, received string"
  }
]
Error: Invalid configuration. Please check environment variables.
```

## Adding New Configuration

To add a new configuration value:

1. **Add to the schema** in `src/config/index.ts`:
   ```typescript
   myNewFeature: z.object({
     enabled: booleanString.default(false),
     timeout: z.coerce.number().int().positive().default(5000),
   }),
   ```

2. **Add to the rawConfig** in `parseConfig()`:
   ```typescript
   myNewFeature: {
     enabled: env.MY_NEW_FEATURE_ENABLED,
     timeout: env.MY_NEW_FEATURE_TIMEOUT,
   },
   ```

3. **Update this README** with the new configuration

4. **Add tests** in `tests/unit/config.test.ts`

## Environment Variable Reference

See `src/config/index.ts` for the complete mapping of environment variables to configuration fields.

## Performance Considerations

- The configuration is parsed once at module initialization
- Subsequent accesses are instant (just object property access)
- No runtime overhead compared to `process.env` access
- Validation happens only at startup, not on every access

## Future Enhancements

- [ ] Runtime configuration reloading (for non-critical values)
- [ ] Configuration file support (in addition to environment variables)
- [ ] Secret management integration (HashiCorp Vault, AWS Secrets Manager)
- [ ] Configuration schema documentation generation
- [ ] Environment variable presence validation at build time

## References

- [Zod Documentation](https://zod.dev/)
- [12-Factor App Configuration](https://12factor.net/config)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
