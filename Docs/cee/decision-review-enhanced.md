# Enhanced Decision Review Guide

The Enhanced Decision Review provides ISL-powered analysis of decision graphs, including sensitivity analysis, contrastive explanations, conformal predictions, and validation strategies.

## Overview

The Enhanced Decision Review endpoint extends basic graph critique with:

- **Sensitivity Analysis**: Identifies critical assumptions that could change outcomes
- **Contrastive Explanations**: Suggests alternative decisions with expected improvements
- **Conformal Predictions**: Provides statistically rigorous confidence intervals
- **Validation Strategies**: Recommends ways to improve model quality

## Endpoint

```
POST /assist/v1/decision-review/enhanced
```

### Request

```json
{
  "graph": {
    "nodes": [...],
    "edges": [...]
  },
  "target_nodes": ["dec_1", "opt_2"],  // Optional: specific nodes to analyze
  "correlation_id": "req-12345",
  "config": {
    "enable_sensitivity": true,
    "enable_contrastive": true,
    "enable_conformal": false,
    "enable_validation_strategies": true,
    "max_nodes": 20,
    "include_formatted_summary": true
  }
}
```

### Response

```json
{
  "summary": {
    "nodesAnalyzed": 8,
    "bySeverity": {
      "critical": 1,
      "high": 2,
      "medium": 3,
      "low": 2
    },
    "overallRisk": "medium"
  },
  "nodeCritiques": [
    {
      "nodeId": "dec_1",
      "nodeKind": "decision",
      "nodeTitle": "Which pricing strategy?",
      "severity": "high",
      "issues": ["Missing risk assessment", "No provenance on key assumptions"],
      "recommendations": ["Add risk nodes for each option", "Document assumptions"],
      "sensitivity": {
        "available": true,
        "score": 0.78,
        "classification": "high",
        "factors": ["market_size", "competitor_response"]
      },
      "contrastive": {
        "available": true,
        "alternatives": [
          {
            "description": "Consider hybrid pricing model",
            "expectedImprovement": "+15% revenue confidence",
            "changeRequired": "Add tiered pricing node"
          }
        ]
      },
      "conformal": {
        "available": false,
        "error": "Insufficient calibration data"
      },
      "validationSuggestions": {
        "available": true,
        "strategies": [
          {
            "type": "data_collection",
            "description": "Gather competitor pricing data",
            "priority": "high"
          }
        ]
      }
    }
  ],
  "islAvailability": {
    "serviceAvailable": true,
    "endpointsUsed": ["sensitivity", "contrastive", "validation"],
    "endpointsFailed": ["conformal"]
  },
  "trace": {
    "requestId": "req-abc123",
    "correlationId": "req-12345",
    "latencyMs": 1250
  },
  "formatted_summary": "## Decision Review Summary\n\n..."
}
```

## ISL Integration

The review leverages four ISL endpoints:

| Endpoint | Purpose | Response Field |
|----------|---------|----------------|
| `/causal/sensitivity/detailed` | Assumption impact analysis | `sensitivity` |
| `/explain/contrastive` | Alternative suggestions | `contrastive` |
| `/causal/counterfactual/conformal` | Confidence intervals | `conformal` |
| `/causal/validate/strategies` | Model improvements | `validationSuggestions` |

### Graceful Degradation

Each ISL endpoint fails independently. If an endpoint is unavailable:

- The corresponding field shows `available: false`
- An `error` message explains the failure
- Other fields continue to populate normally
- The review completes with whatever data is available

Example with ISL unavailable:

```json
{
  "sensitivity": {
    "available": false,
    "error": "ISL sensitivity analysis unavailable"
  },
  "contrastive": {
    "available": false,
    "error": "ISL contrastive explanation unavailable"
  },
  "conformal": {
    "available": false,
    "error": "ISL conformal prediction unavailable"
  },
  "validationSuggestions": {
    "available": false,
    "error": "ISL validation strategies unavailable"
  }
}
```

## Configuration

### Environment Variables

```bash
# Enable ISL integration
CEE_CAUSAL_VALIDATION_ENABLED=true

# ISL service URL
ISL_BASE_URL=http://isl-service:8080

# Timeouts
ISL_TIMEOUT_MS=8000
ISL_MAX_RETRIES=2
```

### Request Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enable_sensitivity` | boolean | true | Include sensitivity analysis |
| `enable_contrastive` | boolean | true | Include contrastive explanations |
| `enable_conformal` | boolean | false | Include conformal predictions |
| `enable_validation_strategies` | boolean | true | Include validation strategies |
| `max_nodes` | number | 20 | Maximum nodes to analyze |
| `include_formatted_summary` | boolean | false | Include markdown summary |

## Severity Levels

Node critiques are categorized by severity:

| Level | Description | Action Required |
|-------|-------------|-----------------|
| `critical` | Structural issues preventing use | Immediate fix needed |
| `high` | Major quality issues | Should be addressed |
| `medium` | Moderate concerns | Recommended to address |
| `low` | Minor suggestions | Nice to have |

## Plain-English Templates

When `include_formatted_summary: true`, the response includes human-readable summaries:

### Sensitivity Warning

```
⚠️ **Critical Assumption:** market_size
Your conclusion depends heavily on this. If wrong by 10%,
outcomes could shift by 23%.
**Suggestion:** Conduct market research to validate assumption
```

### Actionable Alternative

```
💡 **Alternative Path:**
Instead of fixed pricing, consider tiered pricing.
Expected improvement: +15% revenue confidence
Effort: medium
```

### Confidence Statement

```
📊 **Confidence:** 95% guaranteed
Outcome range: $1.2M – $1.8M
We are 95% confident the actual revenue will fall between these bounds.
```

### ISL Unavailable Notice

```
ℹ️ **Note:** Advanced analysis features are temporarily unavailable.
This review is based on core decision analysis only.
```

## Monitoring

### Telemetry Events

| Event | Description |
|-------|-------------|
| `cee.decision_review.requested` | Review request received |
| `cee.decision_review.succeeded` | Review completed successfully |
| `cee.decision_review.failed` | Review failed |
| `cee.decision_review.isl_fallback` | ISL unavailable, using basic review |

### Response Headers

| Header | Description |
|--------|-------------|
| `X-CEE-API-Version` | API version (`v1`) |
| `X-CEE-Feature-Version` | Feature version (`decision-review-2.0.0`) |
| `X-CEE-Request-ID` | Request identifier |
| `X-CEE-ISL-Available` | Whether ISL was available (`true`/`false`) |

### Metrics

```
cee.decision_review.requested     # Counter: review requests
cee.decision_review.succeeded     # Counter: successful reviews
cee.decision_review.failed        # Counter: failed reviews
cee.decision_review.latency_ms    # Histogram: review latency
cee.decision_review.isl_fallback  # Counter: ISL unavailable
```

## Error Responses

### Rate Limited (429)

```json
{
  "code": "CEE_RATE_LIMIT",
  "message": "Decision Review rate limit exceeded",
  "retryable": true,
  "details": {
    "retry_after_seconds": 30
  }
}
```

### Validation Failed (400)

```json
{
  "code": "CEE_VALIDATION_FAILED",
  "message": "Invalid input",
  "retryable": false,
  "details": {
    "field_errors": {
      "graph": "Required"
    }
  }
}
```

### Internal Error (500)

```json
{
  "code": "CEE_INTERNAL_ERROR",
  "message": "internal error",
  "retryable": false
}
```

## Best Practices

1. **Enable ISL for production**: The ISL-powered fields provide significantly richer analysis
2. **Use correlation IDs**: Pass `correlation_id` for request tracing
3. **Handle degraded responses**: Check `islAvailability.serviceAvailable` and handle gracefully
4. **Request only what you need**: Disable unused features to reduce latency
5. **Monitor ISL availability**: Alert on high `isl_fallback` rates

## Example: Full Analysis

```bash
curl -X POST https://api.example.com/assist/v1/decision-review/enhanced \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{
    "graph": {
      "nodes": [
        {"id": "goal_1", "kind": "goal", "label": "Increase revenue"},
        {"id": "dec_1", "kind": "decision", "label": "Pricing strategy"},
        {"id": "opt_1", "kind": "option", "label": "Fixed pricing"},
        {"id": "opt_2", "kind": "option", "label": "Tiered pricing"}
      ],
      "edges": [
        {"from": "goal_1", "to": "dec_1"},
        {"from": "dec_1", "to": "opt_1"},
        {"from": "dec_1", "to": "opt_2"}
      ]
    },
    "config": {
      "enable_sensitivity": true,
      "enable_contrastive": true,
      "include_formatted_summary": true
    }
  }'
```

## Integration with Frontend

The enhanced review is designed for frontend consumption:

1. **Check `islAvailability`** to show appropriate UI
2. **Use severity for styling** (critical=red, high=orange, etc.)
3. **Display formatted_summary** in markdown renderers
4. **Show degradation notices** when ISL unavailable

```typescript
// Frontend example
const review = await fetchDecisionReview(graph);

if (!review.islAvailability.serviceAvailable) {
  showNotice("Advanced analysis temporarily unavailable");
}

for (const critique of review.nodeCritiques) {
  renderNodeCritique(critique);

  if (critique.sensitivity.available) {
    renderSensitivityWarning(critique.sensitivity);
  }

  if (critique.contrastive.available) {
    renderAlternatives(critique.contrastive.alternatives);
  }
}
```
