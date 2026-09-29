# CEE Prompt Management Guide

This guide covers the prompt management system for CEE (Cognitive Evaluation Engine), enabling runtime prompt switching, A/B experiments, and version control.

## Overview

The prompt management system allows:
- **Versioned prompts**: Track changes with full history
- **Staging environments**: Test prompts before production
- **A/B experiments**: Compare prompt variants with traffic splitting
- **Graceful degradation**: Falls back to defaults when store unavailable
- **Admin UI**: Manage prompts through a web interface

## Configuration

### Enabling Prompt Management

Set these environment variables:

```bash
# Enable the prompt store
PROMPTS_ENABLED=true

# Path to store prompts (default: data/prompts.json)
PROMPTS_STORE_PATH=data/prompts.json

# Admin API key for management
ADMIN_API_KEY=your-secure-admin-key
```

### Braintrust Integration (Optional)

For advanced A/B testing with analytics:

```bash
BRAINTRUST_API_KEY=your-braintrust-key
BRAINTRUST_PROJECT=olumi-assistants
```

## CEE Tasks

The following CEE tasks support managed prompts:

| Task ID | Description | Used By |
|---------|-------------|---------|
| `draft_graph` | Generates decision graphs from briefs | `/assist/v1/draft-graph` |
| `suggest_options` | Generates strategic options | `/assist/v1/suggest-options` |
| `repair_graph` | Fixes validation violations | `/assist/v1/repair-graph` |
| `clarify_brief` | Generates clarifying questions | `/assist/v1/clarify-brief` |
| `critique_graph` | Critiques graph quality | `/assist/v1/critique-graph` |
| `bias_check` | Detects cognitive biases | `/assist/v1/bias-check` |
| `explainer` | Explains graph changes | `/assist/v1/explain-diff` |

## Admin API

### Authentication

All admin endpoints require the `X-Admin-Key` header:

```bash
curl -H "X-Admin-Key: your-admin-key" https://api.example.com/admin/prompts
```

### Endpoints

#### List Prompts

```bash
GET /admin/prompts
```

#### Get Prompt

```bash
GET /admin/prompts/:id
```

#### Create Prompt

```bash
POST /admin/prompts
Content-Type: application/json

{
  "id": "draft_graph_v2",
  "name": "Draft Graph V2",
  "description": "Enhanced draft prompt with better provenance",
  "taskId": "draft_graph",
  "content": "You are an expert at drafting decision graphs...",
  "variables": [
    {
      "name": "maxNodes",
      "description": "Maximum nodes allowed",
      "required": true,
      "defaultValue": "20"
    }
  ],
  "tags": ["production", "v2"],
  "createdBy": "admin@example.com"
}
```

#### Create New Version

```bash
POST /admin/prompts/:id/versions
Content-Type: application/json

{
  "content": "Updated prompt content...",
  "createdBy": "admin@example.com",
  "changeNote": "Improved provenance handling"
}
```

#### Update Prompt Metadata

```bash
PATCH /admin/prompts/:id
Content-Type: application/json

{
  "status": "production",
  "activeVersion": 2
}
```

#### Rollback Version

```bash
POST /admin/prompts/:id/rollback
Content-Type: application/json

{
  "targetVersion": 1,
  "rolledBackBy": "admin@example.com",
  "reason": "Version 2 caused quality regression"
}
```

## Prompt Lifecycle

Prompts follow a lifecycle:

```
draft → staging → production → archived
```

### Status Meanings

| Status | Description |
|--------|-------------|
| `draft` | Initial state, not used in production |
| `staging` | Being tested, accessible with `useStaging` flag |
| `production` | Active in production routes |
| `archived` | No longer used, kept for history |

### Single Production Rule

Only one prompt per task can be in `production` status. When promoting a prompt to production, any existing production prompt for that task is automatically archived.

## Variable Interpolation

Prompts support `{{variable}}` placeholders:

```
You are drafting a graph with ≤{{maxNodes}} nodes and ≤{{maxEdges}} edges.
```

Variables are interpolated at load time:

```typescript
const prompt = loadPromptSync('draft_graph', {
  maxNodes: 20,
  maxEdges: 30,
});
```

## A/B Experiments

### Registering an Experiment

```typescript
import { registerExperiment } from './adapters/llm/prompt-loader.js';

registerExperiment({
  name: 'draft-prompt-v2-test',
  taskId: 'draft_graph',
  treatmentPercent: 20,  // 20% get treatment
  treatmentUsesStaging: true,  // Treatment uses staging version
});
```

### Experiment Assignment

Users are consistently assigned to variants using a hash of their identifier:

```typescript
const result = await getSystemPromptAsync('draft_graph', {
  userId: 'user-123',  // Used for consistent assignment
  requestId: 'req-456',
});

console.log(result.experimentVariant);  // 'control' or 'treatment'
console.log(result.experimentName);     // 'draft-prompt-v2-test'
```

### Forcing Variants (Testing)

```typescript
const result = await getSystemPromptAsync('draft_graph', {
  forceVariant: 'treatment',  // Override assignment
});
```

### Viewing Active Experiments

```typescript
import { getActiveExperiments } from './adapters/llm/prompt-loader.js';

const experiments = getActiveExperiments();
// [{ name: 'draft-prompt-v2-test', taskId: 'draft_graph', treatmentPercent: 20 }]
```

## Monitoring

### Diagnostics Endpoint

The `/diagnostics` endpoint includes prompt status:

```json
{
  "prompts": {
    "store": {
      "initialized": true,
      "healthy": true,
      "enabled": true,
      "storePath": "data/prompts.json"
    },
    "active_experiments": [
      {
        "name": "draft-prompt-v2-test",
        "taskId": "draft_graph",
        "treatmentPercent": 20
      }
    ],
    "experiment_count": 1
  }
}
```

### Health Check

The `/healthz` endpoint reports degraded status when the prompt store is unhealthy:

```json
{
  "ok": true,
  "degraded": true,
  "prompts": {
    "enabled": true,
    "healthy": false,
    "degraded_reason": "prompt_store_unhealthy"
  }
}
```

### Telemetry Events

| Event | Description |
|-------|-------------|
| `prompt.loader.store` | Prompt loaded from managed store |
| `prompt.loader.default` | Prompt loaded from defaults |
| `prompt.loader.error` | Error loading prompt |
| `prompt.store_error` | Store operation error |
| `prompt.hash_mismatch` | Content hash verification failed |
| `prompt.experiment.assigned` | User assigned to experiment variant |
| `prompt.staging.used` | Staging version used |

## Admin UI

Access the web-based admin UI at `/admin/prompts-ui` when authenticated.

Features:
- View all prompts and their versions
- Edit prompt content
- Promote prompts to production
- View version history and diffs
- Rollback to previous versions

## Best Practices

1. **Always test in staging**: Use `stagingVersion` before promoting to production
2. **Write change notes**: Document why each version was created
3. **Use experiments for risky changes**: A/B test significant prompt changes
4. **Monitor metrics**: Watch for quality regressions after deployments
5. **Keep prompts focused**: Each prompt should have a single responsibility
6. **Use variables for config**: Don't hardcode limits that might change

## Troubleshooting

### Prompt Not Loading

1. Check if prompts are enabled: `PROMPTS_ENABLED=true`
2. Verify store path exists and is writable
3. Check `/healthz` for store health status
4. Look for `prompt.loader.error` in logs

### Experiment Not Applying

1. Verify experiment is registered: check `/diagnostics`
2. Ensure consistent identifier (userId) is provided
3. Check `treatmentPercent` is set correctly
4. Look for `prompt.experiment.assigned` events in logs

### Store Initialization Failed

1. Check file permissions on store path
2. Verify JSON syntax if store file exists
3. Check for hash mismatch errors in logs
4. Try deleting store file to reinitialize
