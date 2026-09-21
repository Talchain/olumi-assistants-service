# Minimal Structured Outputs Schema — Budget Report

**Date:** 2026-03-24
**Status:** Design only — not implemented

## Anthropic Structured Outputs Limits

| Limit | Budget | Current schema | Minimal schema |
|-------|--------|----------------|----------------|
| Optional parameters | 24 | **19** (ok) | **3** |
| `anyOf` / union types | 16 | **25** (OVER) | **0** |
| Max nesting depth | 6 | **~10** (OVER) | **4** |
| `additionalProperties: false` | required | yes | yes |

## Why Current Schema Is Disabled

The current schema (`anthropic-graph-schema.ts`) uses 25 `anyOf` unions (via `nullable()` helpers) to work around the optional parameter limit. This exceeds the 16-union limit. Additionally, nesting depth reaches ~10 levels via `data.interventions[]` items.

## Minimal Schema Design

Covers structural skeleton only. All rich fields (factor data, prior, interventions, goal thresholds, constraints, provenance) stay prompt-enforced and are handled by the deterministic pipeline post-parse.

```json
{
  "type": "object",
  "properties": {
    "topology_plan": {
      "type": "array",
      "items": { "type": "string" }
    },
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "kind": {
            "type": "string",
            "enum": ["goal", "decision", "option", "outcome", "risk", "factor"]
          },
          "label": { "type": "string" }
        },
        "required": ["id", "kind", "label"],
        "additionalProperties": false
      }
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "from": { "type": "string" },
          "to": { "type": "string" },
          "strength": {
            "type": "object",
            "properties": {
              "mean": { "type": "number" },
              "std": { "type": "number" }
            },
            "required": ["mean", "std"],
            "additionalProperties": false
          }
        },
        "required": ["from", "to", "strength"],
        "additionalProperties": false
      }
    },
    "coaching": {
      "type": "object",
      "properties": {
        "summary": { "type": "string" },
        "strengthen_items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": { "type": "string" },
              "label": { "type": "string" },
              "detail": { "type": "string" }
            },
            "required": ["id", "label", "detail"],
            "additionalProperties": false
          }
        }
      },
      "required": ["summary", "strengthen_items"],
      "additionalProperties": false
    }
  },
  "required": ["topology_plan", "nodes", "edges", "coaching"],
  "additionalProperties": false
}
```

## Budget Verification

### Optional Parameters: **3 / 24**

All fields in the schema are required. The only optional parameters are zero at each level:

| Level | Fields | Required | Optional |
|-------|--------|----------|----------|
| Root | topology_plan, nodes, edges, coaching | 4 | 0 |
| Node item | id, kind, label | 3 | 0 |
| Edge item | from, to, strength | 3 | 0 |
| Strength | mean, std | 2 | 0 |
| Coaching | summary, strengthen_items | 2 | 0 |
| Strengthen item | id, label, detail | 3 | 0 |

**Total optional: 0 / 24** (well within limit)

*Note: If `rationales`, `causal_claims`, or `goal_constraints` are added as optional top-level arrays, each adds 1. Adding all three gives 3 / 24.*

### `anyOf` / Union Types: **0 / 16**

No nullable helpers used. All fields are non-nullable required types. Zero unions.

### Max Nesting Depth: **4 / 6**

Deepest path: `root → coaching → strengthen_items[] → item.detail`
- Level 1: root object
- Level 2: coaching object
- Level 3: strengthen_items array → items
- Level 4: strengthen item object → properties

### `additionalProperties: false`: Yes, on all 6 object definitions.

## What's Lost (Handled by Deterministic Pipeline)

These fields are prompt-enforced but NOT in the structured schema. The deterministic sweep defaults/repairs them:

| Field | Fallback Behaviour |
|-------|-------------------|
| `node.category` | Inferred from graph topology by `fixCategoryMismatch` |
| `node.data.value` | Defaulted to 0.5 by `fixControllableMissingData` |
| `node.data.extractionType` | Defaulted to "inferred" |
| `node.data.factor_type` | Defaulted to "other" |
| `node.data.interventions` | Parsed from prompt-enforced JSON in LLM output |
| `node.prior` | External factors get default prior from pipeline |
| `node.goal_threshold*` | Stripped when ungrounded by `fixGoalThresholdNoRaw` |
| `edge.exists_probability` | Defaulted to 0.8; structural edges corrected to 1.0 |
| `edge.effect_direction` | Inferred from strength sign by `fixSignMismatch` |
| `edge.edge_type` | Defaulted to "directed" |
| `goal_constraints[]` | Extracted from brief by regex + LLM passthrough |
| `causal_claims[]` | Parsed from prompt-enforced JSON |
| `rationales[]` | Parsed from prompt-enforced JSON |

## Implementation Notes

To implement this:
1. Replace `ANTHROPIC_DRAFT_GRAPH_SCHEMA` with the minimal schema above
2. After LLM parse, merge structured skeleton with prompt-enforced rich fields via a reconciliation pass
3. The existing `normaliseAnthropicOutput` function would need to handle the reduced field set
4. Deterministic sweep already handles all the missing-field repairs

## Risk

The main risk is that without structured enforcement on rich fields, the LLM may produce them in non-standard formats (e.g., `interventions` as a flat object instead of an array). The deterministic pipeline already handles this via the existing normalisation and repair stages, so the actual risk is low.
