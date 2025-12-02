# Getting Started with Olumi Assistants Service

New to this codebase? Start here.

## Prerequisites

- Node.js 20.19+
- pnpm 8+
- API keys: Anthropic (required), OpenAI (optional)

## Setup (5 minutes)

```bash
git clone https://github.com/Talchain/olumi-assistants-service.git
cd olumi-assistants-service
pnpm install
cp .env.example .env
# Add ANTHROPIC_API_KEY to .env
pnpm test  # Should pass
pnpm dev   # Starts on :3101
```

## First Request

```bash
curl -X POST http://localhost:3101/assist/draft-graph \
  -H "X-Olumi-Assist-Key: $(grep ASSIST_API_KEY .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"brief": "Should we adopt a four-day work week?"}'
```

## What to Read Next

1. **[Architecture Overview](ARCHITECTURE.md)** - System design (15 min)
2. **[CEE Documentation](cee/CEE-v1.md)** - Decision engine details (30 min)
3. **[API Reference](api/FRONTEND_INTEGRATION.md)** - All endpoints (reference)
4. **[Contributing Guide](../CONTRIBUTING.md)** - Development workflow (10 min)

## Common Tasks

| Task | Command |
|------|---------|
| Run tests | `pnpm test` |
| Run specific test | `pnpm test <file>` |
| Build | `pnpm build` |
| Lint | `pnpm lint` |
| Type check | `pnpm typecheck` |
| Start dev server | `pnpm dev` |

## Project Structure

```
src/
├── routes/          # API endpoints
├── adapters/        # LLM provider integrations
├── cee/             # Contextual Evidence Engine
│   ├── validation/  # Quality assessment
│   ├── clarifier/   # Multi-turn clarification
│   └── verification/# Response validation
├── schemas/         # Zod schemas and types
├── config/          # Environment config
└── utils/           # Shared utilities

tests/
├── unit/            # Unit tests
├── integration/     # Integration tests
└── fixtures/        # Test fixtures

Docs/
├── api/             # API documentation
├── cee/             # CEE documentation
├── runbooks/        # Operational guides
└── archive/         # Historical docs
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `OPENAI_API_KEY` | No | OpenAI fallback |
| `ASSIST_API_KEY` | Yes (prod) | Client authentication |
| `ALLOWED_ORIGINS` | Yes (prod) | CORS whitelist |
| `REDIS_URL` | No | Redis for caching |

See `.env.example` for full list.

## Getting Help

- Architecture questions: [ARCHITECTURE.md](ARCHITECTURE.md)
- CEE/prompts: [Docs/cee/](cee/)
- Production issues: [Docs/runbooks/](runbooks/)
- GitHub issues for bugs

---

**Next:** Read [Architecture Overview](ARCHITECTURE.md)
