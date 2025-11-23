# OpenAPI Validation Automation

**Status:** Implemented
**Related:** Windsurf Finding 5 - OpenAPI coverage drift prevention

---

## Overview

This service maintains an OpenAPI 3.0.3 specification at the root level (`openapi.yaml`). To prevent drift between the specification and the actual implementation, automated validation is integrated into the development workflow and CI/CD pipeline.

---

## Available Commands

### Validate Spec Syntax
```bash
pnpm openapi:validate
```

Validates that `openapi.yaml` conforms to OpenAPI 3.0 specification using swagger-cli.

**Checks:**
- Valid YAML syntax
- Compliant with OpenAPI 3.0.3 schema
- All $ref references resolve correctly
- No conflicting property definitions (e.g., `example` vs `examples`)

### Generate TypeScript Types
```bash
pnpm openapi:generate
```

Generates TypeScript type definitions from the OpenAPI spec into `src/generated/openapi.d.ts`.

**Benefits:**
- Type-safe API client/server development
- Auto-completion in IDEs
- Compile-time validation of request/response shapes
- Documentation embedded in types

### Full Validation Check
```bash
pnpm openapi:check
```

Runs both validation and type generation in sequence. Use this before committing changes.

---

## CI/CD Integration

### GitHub Actions Workflow

The `.github/workflows/openapi-validation.yml` workflow runs automatically on:
- **Pull requests** that modify:
  - `openapi.yaml`
  - Any TypeScript source files in `src/`
  - The workflow file itself
- **Pushes** to `main` and `feat/**` branches

**Workflow Steps:**
1. Install dependencies
2. Validate OpenAPI spec syntax
3. Generate TypeScript types
4. Verify types file was created
5. Upload generated types as artifact (7-day retention)

**Failure Modes:**
- Invalid OpenAPI syntax → PR blocked
- Type generation fails → PR blocked
- Missing required schemas → PR blocked

---

## Common Validation Issues

### Issue 1: `example` vs `examples` Confusion

**Error:**
```
#/components/schemas/MySchema/properties/field must NOT have additional properties
```

**Cause:**
In OpenAPI 3.0, schema properties only support `example` (singular), not `examples` (plural).

**Fix:**
```yaml
# ❌ Wrong
properties:
  location:
    type: string
    example: "page 3"
    examples:
      - "page 12"
      - "row 42"

# ✅ Correct
properties:
  location:
    type: string
    description: Specific location (e.g., "page 12", "row 42")
    example: "page 12"
```

### Issue 2: Unresolved $ref

**Error:**
```
#/components/schemas/MySchema must have required property '$ref'
```

**Cause:**
Referenced schema doesn't exist in `components/schemas`.

**Fix:**
Ensure the referenced schema is defined:
```yaml
components:
  schemas:
    MyReferencedSchema:
      type: object
      properties:
        # ...
```

### Issue 3: Circular Dependencies

**Error:**
```
Circular reference detected
```

**Cause:**
Schema A references B, B references A.

**Fix:**
Break the cycle by using `allOf` or restructuring schemas.

---

## Development Workflow

### Before Committing OpenAPI Changes

1. **Validate syntax:**
   ```bash
   pnpm openapi:validate
   ```

2. **Generate types:**
   ```bash
   pnpm openapi:generate
   ```

3. **Check TypeScript compilation:**
   ```bash
   pnpm typecheck
   ```

4. **Run tests:**
   ```bash
   pnpm test
   ```

### After Modifying API Endpoints

If you change request/response structures in code:

1. **Update `openapi.yaml`** to reflect changes
2. **Run validation:** `pnpm openapi:check`
3. **Commit both** code and spec changes together
4. **Document** breaking changes in PR description

---

## Generated Artifacts

### `src/generated/openapi.d.ts`

Auto-generated TypeScript definitions. **Do not edit manually.**

**Usage Example:**
```typescript
import type { paths, components } from './generated/openapi';

type DraftGraphInput = components['schemas']['DraftGraphInput'];
type DraftGraphResponse = paths['/assist/draft-graph']['post']['responses']['200']['content']['application/json'];

const request: DraftGraphInput = {
  brief: "Should we migrate to microservices?",
  // TypeScript will enforce schema compliance
};
```

**Note:** This file is gitignored and regenerated on each build/validation.

---

## Tools Used

### [@apidevtools/swagger-cli](https://github.com/APIDevTools/swagger-cli) (v4.0.4)
- **Purpose:** OpenAPI spec validation
- **Note:** Deprecated, but still effective. Consider migrating to [@redocly/cli](https://redocly.com/docs/cli/) in the future.

### [openapi-typescript](https://github.com/drwpow/openapi-typescript) (v7.10.1)
- **Purpose:** TypeScript type generation from OpenAPI specs
- **Benefits:**
  - Zero runtime dependencies
  - Generates clean, readable types
  - Supports OpenAPI 3.0 and 3.1

---

## Migration from Legacy Provenance Format

The OpenAPI spec includes deprecation headers for legacy string provenance:
- `X-Deprecated-Provenance-Format: "true"`
- `X-Deprecation-Sunset: "2025-12-01"`
- `X-Deprecation-Link: "https://docs.olumi.ai/provenance-migration"`

See `src/routes/assist.draft-graph.ts` for telemetry implementation.

---

## Roadmap

### Short-Term Improvements
- [ ] Add contract testing with [Schemathesis](https://schemathesis.readthedocs.io/)
- [ ] Generate OpenAPI spec from Fastify routes (bidirectional validation)
- [ ] Add OpenAPI linting rules (naming conventions, description requirements)

### Medium-Term
- [ ] Migrate from swagger-cli to @redocly/cli
- [ ] Add API versioning strategy (v1, v2 paths)
- [ ] Generate API client SDKs for Python, Go

### Long-Term
- [ ] Runtime request/response validation against OpenAPI spec
- [ ] Automatic changelog generation from spec diffs
- [ ] API analytics dashboard (usage by endpoint)

---

## Related Documentation

- **OpenAPI Spec:** `openapi.yaml`
- **Performance Testing:** `Docs/performance-testing-plan.md`
- **Test Issue Tracking:** `Docs/issues/test-mock-refinement.md`
- **Perf Testing Blocker:** `Docs/issues/perf-testing-blocked.md`

---

## Support

For issues with OpenAPI validation:
1. Check error messages against "Common Validation Issues" above
2. Validate spec at [Swagger Editor](https://editor.swagger.io/)
3. Review OpenAPI 3.0 spec: https://spec.openapis.org/oas/v3.0.3
4. File issue with `openapi` label if unresolved
