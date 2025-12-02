# Developer Guide

Quick-start guide for new developers joining the Olumi Assistants Service.

## Prerequisites

- Node.js 20.x LTS
- pnpm 9.x

## Setup

```bash
# Clone and install
git clone https://github.com/Talchain/olumi-assistants-service.git
cd olumi-assistants-service
pnpm install

# Run tests (uses fixtures, no API keys needed)
pnpm test

# Run preflight checks
pnpm preflight
```

## Project Structure

```
src/
├── routes/          # HTTP endpoints (Fastify)
├── cee/             # CEE subsystem (quality assessment)
├── adapters/        # External services (LLM providers)
├── services/        # Business logic
└── utils/           # Shared utilities

tests/
├── unit/            # Unit tests
├── integration/     # Integration tests
└── validation/      # Schema validation tests

Docs/
├── getting-started/ # Architecture and onboarding
├── api/             # API documentation
├── cee/             # CEE documentation
├── operations/      # Operations guides
└── runbooks/        # Incident response
```

## Key Commands

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all tests |
| `pnpm test -- tests/unit/` | Run unit tests only |
| `pnpm preflight` | OpenAPI validation + type generation |
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |

## Environment Variables

For local development, create `.env`:

```bash
# Required for LLM calls (skip for fixture tests)
ANTHROPIC_API_KEY=your-key

# Use fixtures instead of real LLM (for testing)
LLM_PROVIDER=fixtures

# API authentication (for manual testing)
ASSIST_API_KEYS=test-key
```

## Making Changes

1. **Find the route** - Endpoints are in `src/routes/`
2. **Locate the logic** - Business logic in `src/services/` or `src/cee/`
3. **Write tests first** - Add tests in `tests/`
4. **Run checks** - `pnpm test && pnpm preflight`
5. **Update docs** - If changing contracts, update `Docs/`

## Documentation

| Topic | Location |
|-------|----------|
| Architecture | [Docs/getting-started/architecture.md](Docs/getting-started/architecture.md) |
| CEE System | [Docs/cee/CEE-v1.md](Docs/cee/CEE-v1.md) |
| API Reference | [Docs/api/FRONTEND_INTEGRATION.md](Docs/api/FRONTEND_INTEGRATION.md) |
| Contributing | [Docs/contributing.md](Docs/contributing.md) |

## Testing with Fixtures

Most tests run without API keys using fixtures:

```bash
# Fixture-based testing (default)
LLM_PROVIDER=fixtures pnpm test

# Live LLM testing (requires API keys)
pnpm test:live
```

## Common Workflows

### Adding a new endpoint

1. Create route in `src/routes/`
2. Add schema to `openapi.yaml`
3. Run `pnpm openapi:generate`
4. Add tests in `tests/integration/`

### Modifying CEE

1. Locate logic in `src/cee/`
2. Update tests in `tests/unit/cee.*.test.ts`
3. Update SDK types if needed (`sdk/typescript/src/`)

### Debugging

```bash
# Run single test with verbose output
pnpm test -- --reporter=verbose tests/unit/cee.bias.test.ts

# Check TypeScript errors
pnpm typecheck
```

---

**Full Documentation:** [Docs/README.md](Docs/README.md)
