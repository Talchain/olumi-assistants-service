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
const timeout = parseInt(process.env.ISL_TIMEOUT_MS || "30000", 10);

// After
const timeout = config.isl.timeoutMs;
```

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

### Singleton Initialization Challenge

The config module is a **singleton** - it parses environment variables once on first import. This creates challenges when migrating files that are imported early in the module dependency graph, especially in test environments.

### Safe vs. Unsafe Files to Migrate

**✅ Safe to Migrate** (low in import graph):
- Route handlers (`src/routes/**`)
- Service layer (`src/services/**`)
- Adapters (`src/adapters/**`)
- Utility functions called at runtime (not at module initialization)
- CEE modules (`src/cee/**`)

**⚠️ Caution Required** (early in import graph):
- `src/utils/simple-logger.ts` - Imported by many modules including test infrastructure
- `src/version.ts` - Has special package.json fallback logic
- `src/plugins/**` - Registered during server initialization
- Any file that executes code at module initialization time

**❌ Do Not Migrate** (causes test failures):
- Files that create singletons at module scope using config values
- Files imported before test environment setup (e.g., test utilities)
- Files with complex fallback logic beyond simple env var reads

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

4. **Skip or carefully handle early imports**: For files like simple-logger, either:
   - Keep using `process.env` directly
   - Use lazy initialization pattern
   - Ensure all tests set required env vars before ANY imports

### Testing Migrated Files

After migrating a file, verify it doesn't break tests:

```bash
# Run full test suite
pnpm test

# Check for config-related failures
pnpm test 2>&1 | grep "Configuration validation failed"
```

If tests fail with "Invalid configuration" errors, the file is too early in the import graph and should either:
- Be reverted to use `process.env`
- Have its config usage moved to lazy initialization
- Have affected tests updated to set required env vars before imports

### Migration Progress Tracking

Create issues/PRs for each logical group:
- [ ] Phase 1: Route handlers (10-15 files)
- [ ] Phase 2: Adapters (5-8 files)
- [ ] Phase 3: Services (3-5 files)
- [ ] Phase 4: CEE modules (6-10 files)
- [ ] Phase 5: Remaining safe files

## Testing

### Mocking Configuration in Tests

Since the config is initialized once on import, use Vitest's module mocking:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("My Feature", () => {
  beforeEach(() => {
    // Clear module cache
    vi.resetModules();
  });

  it("should work with custom config", async () => {
    // Set environment before importing
    process.env.GROUNDING_ENABLED = "false";

    // Import after setting env
    const { config } = await import("./config/index.js");

    expect(config.features.grounding).toBe(false);
  });
});
```

### Example Test Patterns

```typescript
// Pattern 1: Test with minimal config
it("should handle minimal configuration", async () => {
  process.env = {
    NODE_ENV: "test",
    LLM_PROVIDER: "fixtures",
  };

  const { config } = await import("./config/index.js");
  expect(config.llm.provider).toBe("fixtures");
});

// Pattern 2: Test with specific feature enabled
it("should enable PII guard when configured", async () => {
  process.env = {
    PII_GUARD_ENABLED: "true",
  };

  const { config } = await import("./config/index.js");
  expect(config.features.piiGuard).toBe(true);
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
