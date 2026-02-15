# UI Brief: Debug Panel Model Configuration Display

**Date:** 2026-01-29
**From:** Backend Team
**To:** UI Claude Code (separate repo)

---

## Summary

We've added per-prompt model configuration to the backend. The debug panel needs to be updated to show:
1. The prompt's **configured** model settings (staging/production)
2. **Why** a particular model was selected (to help debug model selection issues)

---

## Backend Changes (Already Implemented)

### 1. New `modelConfig` Field on Prompts

Each prompt now has an optional `modelConfig` field:

```typescript
interface ModelConfig {
  staging?: string;    // e.g., "gpt-4o-mini"
  production?: string; // e.g., "gpt-4o"
}
```

This is returned by all prompt endpoints:
- `GET /api/admin/prompts` - list all prompts
- `GET /api/admin/prompts/:id` - get single prompt
- `PATCH /api/admin/prompts/:id` - update prompt (accepts `modelConfig`)

### 2. Model Selection Priority

When running a test, the model is selected in this order:
1. **Explicit override** - User selects model in test panel
2. **Prompt's modelConfig** - Based on prompt status (staging → staging model, production → production model)
3. **Task default** - From `TASK_MODEL_DEFAULTS`
4. **Provider default** - Based on `LLM_PROVIDER` config

### 3. API Response Structure

The test endpoint (`POST /api/admin/prompts/:id/test-llm`) returns:

```typescript
{
  prompt: {
    id: string;
    version: number;
    content_hash: string;
    // ... other fields
  },
  llm: {
    model: string;      // The model that was ACTUALLY used
    provider: string;   // The provider that was ACTUALLY used
    raw_output: string;
    // ... other fields
  }
}
```

**Note:** The response does NOT currently include:
- The prompt's `modelConfig` (what it's configured to use)
- The reason why this model was selected

---

## Requested UI Changes

### Option A: Minimal Change (Recommended First Step)

Add the prompt's `modelConfig` to the test response so the UI can display it:

**In the debug panel metrics section, add:**

```html
<!-- After the existing Model metric -->
<template x-if="tc.llmResult.promptModelConfig">
  <div class="llm-metric">
    <span class="llm-metric-label">Configured</span>
    <span class="llm-metric-value">
      <span x-text="selectedPrompt.status === 'production'
        ? tc.llmResult.promptModelConfig.production
        : tc.llmResult.promptModelConfig.staging || '(not set)'">
      </span>
    </span>
  </div>
</template>
```

### Option B: Full Implementation (Enhanced Debugging)

Add a "Model Selection" info panel that shows:

```html
<div class="model-selection-info" style="margin-top: 10px; padding: 10px; background: #f0f9ff; border-radius: 6px; font-size: 0.85rem;">
  <strong>Model Selection:</strong>
  <ul style="margin: 5px 0 0 20px; padding: 0;">
    <li>Used: <code x-text="tc.llmResult.model"></code></li>
    <li x-show="tc.llmResult.modelSelectionReason">
      Reason: <span x-text="tc.llmResult.modelSelectionReason"></span>
    </li>
    <li x-show="selectedPrompt.modelConfig?.staging || selectedPrompt.modelConfig?.production">
      Prompt Config:
      <span x-show="selectedPrompt.modelConfig?.staging">staging=<code x-text="selectedPrompt.modelConfig.staging"></code></span>
      <span x-show="selectedPrompt.modelConfig?.production">prod=<code x-text="selectedPrompt.modelConfig.production"></code></span>
    </li>
  </ul>
</div>
```

### Option C: Backend Enhancement Required

If you want to show the **reason** why a model was selected, the backend needs to be updated to return `modelSelectionReason` in the response. Possible values:

- `"explicit_override"` - User selected model in test panel
- `"prompt_config_staging"` - From prompt's modelConfig.staging
- `"prompt_config_production"` - From prompt's modelConfig.production
- `"task_default"` - From TASK_MODEL_DEFAULTS
- `"provider_default"` - Fallback to LLM_PROVIDER default

---

## Data Already Available in UI

The prompt edit panel already shows modelConfig dropdowns. The `selectedPrompt` object should have:

```javascript
selectedPrompt: {
  id: "...",
  status: "staging", // or "production", "draft"
  modelConfig: {
    staging: "gpt-4o-mini",    // or undefined
    production: "gpt-4o"       // or undefined
  },
  // ... other fields
}
```

So the UI can already show the configured models. The enhancement is to:
1. Show this in the **debug results panel** (not just the edit panel)
2. Compare configured vs actual to help debug mismatches

---

## Example Scenarios to Support

| Scenario | What to Display |
|----------|-----------------|
| Prompt has no modelConfig, using task default | "Model: gpt-4o (task default)" |
| Prompt has modelConfig.staging set | "Model: gpt-4o-mini (prompt config)" |
| User overrode model in test panel | "Model: claude-sonnet-4 (override)" |
| Provider mismatch (config ignored) | "Model: claude-sonnet-4 (provider default - prompt config gpt-4o incompatible with LLM_PROVIDER=anthropic)" |

---

## Files to Modify

In the UI codebase:
- Debug panel component (wherever `tc.llmResult` is rendered)
- Potentially add CSS for `.model-selection-info` styling

---

## Questions for UI Team

1. Should this info be always visible or in a collapsible section?
2. Do you want the backend to add `modelSelectionReason` to the response? (Requires backend change)
3. Should we show a warning icon when configured model differs from actual model used?

---

## Contact

If you need backend changes to support this, update the issue or reach out. The relevant backend files are:
- `src/routes/admin.testing.ts` - Test endpoint (line ~1196)
- `src/routes/admin.prompts.ts` - CRUD endpoints
