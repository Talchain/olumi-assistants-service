# Bias Mitigation Patches

## Overview

When CEE detects cognitive biases in decision graphs, it can generate conservative graph patches to help mitigate them. These patches provide actionable structural improvements that address identified biases.

## How It Works

1. **Bias Detection**: CEE's bias detection system identifies cognitive biases in the graph
2. **Patch Generation**: For each detected bias, a deterministic patch is generated
3. **Response Enrichment**: Patches are included in the bias-check response

## Patch Characteristics

- **Deterministic**: Same bias finding always produces the same patch
- **Conservative**: Only adds nodes, never deletes or modifies existing nodes
- **One per bias**: Maximum one patch per bias code (deduplication)
- **Stub nodes only**: Minimal structure to prompt consideration, not complete solutions

## Enabling Patches

Bias mitigation patches are controlled by an environment variable:

```bash
CEE_BIAS_MITIGATION_PATCHES_ENABLED=true
```

Default: `false` (disabled)

## Supported Biases

| Bias Code | Patch Type | What's Added |
|-----------|------------|--------------|
| `SELECTION_LOW_OPTION_COUNT` | Add option | Alternative perspective option node |
| `MEASUREMENT_MISSING_RISKS_OR_OUTCOMES` | Add risk/outcome | Missing risk and/or outcome nodes |
| `OPTIMISATION_PRICING_NO_RISKS` | Add risk | Downside risk node for pricing options |
| `FRAMING_SINGLE_GOAL_NO_RISKS` | Add risk | Loss-framed consequence node |

## Response Structure

When patches are enabled, the bias-check response includes a `mitigation_patches` array:

```json
{
  "trace": { ... },
  "quality": { ... },
  "bias_findings": [
    {
      "id": "finding_1",
      "code": "SELECTION_LOW_OPTION_COUNT",
      "severity": "medium",
      "description": "Only one option is defined..."
    }
  ],
  "mitigation_patches": [
    {
      "bias_code": "SELECTION_LOW_OPTION_COUNT",
      "bias_id": "finding_1",
      "description": "Add at least one additional option node so the decision is not based on a single path.",
      "patch": {
        "adds": {
          "nodes": [
            {
              "id": "cee_bias_mitigation_option_1",
              "kind": "option"
            }
          ]
        }
      }
    }
  ]
}
```

## Patch Schema

```typescript
interface CEEBiasMitigationPatchV1 {
  /** The bias code this patch addresses */
  bias_code: string;

  /** ID of the bias finding this patch is for */
  bias_id: string;

  /** Human-readable description of the patch purpose */
  description: string;

  /** The graph patch to apply */
  patch: {
    adds?: {
      nodes?: Array<{
        id: string;
        kind: string;
        label?: string;
      }>;
      edges?: Array<{
        source: string;
        target: string;
      }>;
    };
  };
}
```

## Usage

### Frontend Integration

Patches can be used in the UI to:

1. **Display as suggestions**: Show patch recommendations to users
2. **Apply automatically**: Auto-apply patches to the graph
3. **Coaching prompts**: Present patches as questions to guide thinking

### API Request

```bash
curl -X POST https://api.example.com/assist/v1/bias-check \
  -H "Content-Type: application/json" \
  -H "X-Olumi-Assist-Key: YOUR_KEY" \
  -d '{
    "graph": {
      "nodes": [
        {"id": "decision_1", "kind": "decision"},
        {"id": "option_1", "kind": "option"}
      ],
      "edges": []
    }
  }'
```

### Applying Patches

To apply a patch to a graph:

```typescript
function applyPatch(graph: GraphV1, patch: CEEBiasMitigationPatchV1): GraphV1 {
  const newNodes = [...graph.nodes];

  if (patch.patch.adds?.nodes) {
    for (const node of patch.patch.adds.nodes) {
      newNodes.push(node);
    }
  }

  return {
    ...graph,
    nodes: newNodes,
  };
}
```

## Telemetry

When patches are generated, telemetry events are emitted:

| Event | Description |
|-------|-------------|
| `cee.bias_check.patches_generated` | Patches were generated for bias findings |

Event payload:
```json
{
  "findings_count": 2,
  "patches_count": 2,
  "patch_types": ["option", "risk"]
}
```

## Design Principles

### Why Stub Nodes?

Patches generate minimal stub nodes (no labels, no detailed content) because:

1. **User agency**: Users should flesh out alternatives based on their domain knowledge
2. **No hallucination risk**: We don't generate content that might be wrong
3. **Prompt for thinking**: Empty nodes prompt users to consider alternatives

### Disconnected Nodes

**Important**: Patches add nodes **without edges**. This is intentional:

- The system cannot infer correct edge relationships without domain knowledge
- Some descriptions mention "linked to" but the actual patch creates unconnected nodes
- Consumers (UI or automation) are expected to wire nodes appropriately

Example: `OPTIMISATION_PRICING_NO_RISKS` description says "Add risk node linked to pricing options" but the patch only adds the node—edges must be created by the consumer.


### Why One Patch Per Bias Code?

Deduplication ensures:

1. **No redundant patches**: Multiple findings of the same type don't create duplicate nodes
2. **Predictable output**: Consumers can rely on consistent patch counts
3. **Cleaner UX**: Users aren't overwhelmed with similar suggestions

### First Finding Wins

When multiple bias findings share the same code:

- Only the **first** finding's `bias_id` is attached to the patch
- Later findings of the same code are not referenced
- This is a deliberate simplification for deterministic output


## Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CEE_BIAS_MITIGATION_PATCHES_ENABLED` | boolean | `false` | Enable patch generation |

## Related Documentation

- [Bias Detection](./bias-detection.md) - How biases are detected
- [CEE v1 Overview](./CEE-v1.md) - CEE system architecture
- [Quality Assessment](./quality-assessment.md) - How quality scores are computed
