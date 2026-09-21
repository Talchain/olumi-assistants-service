# Draft graph model switch: gpt-4o to gpt-4.1

**Date:** 2026-03-16
**Triggered by:** v184 benchmark pass

## Change summary

| Item | Detail |
|---|---|
| File changed | `src/config/model-routing.ts` |
| Variable | `TASK_MODEL_DEFAULTS.draft_graph` |
| Previous default | `gpt-4o` |
| New default | `gpt-4.1-2025-04-14` |
| Override env var | `CEE_MODEL_DRAFT_GRAPH` |

## What was changed

1. **Default model** in `TASK_MODEL_DEFAULTS` updated from `"gpt-4o"` to `"gpt-4.1-2025-04-14"` (line 45 of `src/config/model-routing.ts`).
2. **`.env.example`** comment updated to reflect the new default.
3. **Test assertions** updated in:
   - `tests/unit/model-routing.test.ts` (2 assertions)
   - `tests/unit/llm-router.test.ts` (1 assertion, 1 comment)
   - `tests/unit/model-selector.test.ts` (1 assertion)
   - `tests/integration/admin.models.test.ts` (1 comment)

No other model references were changed. Edit graph, orchestrator, decision review, and all other tasks retain their existing defaults.

## How to override

Set the environment variable to roll back or select an alternative model:

```bash
CEE_MODEL_DRAFT_GRAPH=gpt-4o
```

This takes precedence over the code default via the existing model routing system (`src/adapters/llm/router.ts`).

## Staging environment

No `.env.staging` file exists in the repository. Staging configuration is managed via Render dashboard environment variables. The variable to set (or verify) is:

```
CEE_MODEL_DRAFT_GRAPH=gpt-4.1-2025-04-14
```

If unset, the new code default applies automatically. Setting it explicitly is recommended for visibility.

## Test results

- **Build:** `tsc -p tsconfig.build.json --noEmit` passes cleanly.
- **Model routing tests:** 69/69 passed (model-routing + llm-router).
- **Model selector tests:** 52/52 passed.
- **Full suite:** 8592 passed, 5 failed (all 5 failures are pre-existing and unrelated to this change).
