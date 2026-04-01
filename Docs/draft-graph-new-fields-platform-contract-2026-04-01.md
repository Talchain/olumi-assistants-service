# Draft Graph — New Fields Platform Contract
_Date: 2026-04-01 | Issues: CEE-2, CEE-3, CEE-4, CEE-9_

These fields are available in the `POST /assist/v1/draft-graph` response from the current staging deployment onwards (pending v191 prompt update for LLM-generated fields).

---

## 1. `nodes[kind=option].interventions`

| Attribute | Value |
|-----------|-------|
| **Location** | `response.nodes[]` where `kind === "option"` |
| **Type** | `Record<string, InterventionV3>` — same shape as `options[].interventions` |
| **Required** | No (undefined on nodes without a matching entry in `options[]`) |
| **Source** | Copied from `options[]` during response assembly (display-only enrichment) |
| **Purpose (CEE-3)** | Canvas display — ConnRow and intervention label rendering. `options[]` remains the canonical intervention source for analysis. PLoT/ISL consume `options[]`, not graph nodes. |

**Example:**
```json
{
  "id": "opt_keep_current",
  "kind": "option",
  "label": "Keep current structure",
  "interventions": {
    "fac_team_size": { "value": 12, "source": "brief_extraction", "target_match": { ... } }
  }
}
```

---

## 2. `options[].is_baseline` / `nodes[kind=option].is_baseline`

| Attribute | Value |
|-----------|-------|
| **Location** | `response.options[]` and `response.nodes[]` where `kind === "option"` |
| **Type** | `boolean` (optional) |
| **Required** | No (absent in pre-v191 responses) |
| **Source** | Set by the LLM on the option node's `data.is_baseline` field (v191 prompt). Propagated through: Anthropic structured output → normalisation → extraction → `OptionV3` → graph node enrichment. |
| **Purpose (CEE-2)** | Identifies the status-quo / baseline option. Eliminates the need for the UI's 13-keyword regex fallback. Exactly one option should be `true`; PLoT handles deduplication if multiple are flagged. |

**Example:**
```json
{
  "id": "opt_keep_current",
  "label": "Keep current structure",
  "status": "ready",
  "interventions": { ... },
  "is_baseline": true
}
```

---

## 3. `nodes[kind=factor].encoding_map`

| Attribute | Value |
|-----------|-------|
| **Location** | `response.nodes[]` where `kind === "factor"` |
| **Type** | `Record<string, string>` — maps encoded integer keys to display strings |
| **Required** | No (absent when factor labels have no encoding notation) |
| **Source** | Set by the LLM on the factor node's `data.encoding_map` field (v191 prompt). The Anthropic structured output schema emits this as a JSON string (required due to `additionalProperties: false` constraint); the normalisation layer parses it back to an object before the V3 transform copies it to the top-level node. |
| **Purpose (CEE-9)** | Stores encoding information separately from the factor label, allowing the UI to render clean labels and show encoding only where contextually relevant. Replaces inline notation like "Team Structure (0=Developers, 1=Tech Lead)". |

**Example:**
```json
{
  "id": "fac_team_structure",
  "kind": "factor",
  "label": "Team Structure",
  "category": "controllable",
  "observed_state": { "value": 1, "unit": null },
  "encoding_map": {
    "0": "Developers",
    "1": "Tech Lead"
  }
}
```

---

## 4. `nodes[kind=factor, category=external].factor_type` / `.extractionType` / `.uncertainty_drivers`

| Attribute | Value |
|-----------|-------|
| **Location** | `response.nodes[]` where `kind === "factor"` and `category === "external"` |
| **Type** | `factor_type: FactorType` (enum); `extractionType: "explicit" \| "inferred"`; `uncertainty_drivers: string[]` |
| **Required** | No (absent if LLM did not produce them) |
| **Source** | Set by the LLM on the external factor node's `data` fields. Previously deleted by `fixExternalFactorDataViolations()` and `handleUnreachableFactors()`. Now promoted to node-level properties (via the repair stages) and copied to the V3 output. |
| **Purpose (CEE-4)** | Enables downstream enrichment and display logic to classify external factors without a heuristic. `factor_type` allows the UI to show contextual icons/labels. `extractionType` supports data provenance display. `uncertainty_drivers` supports uncertainty narrative generation. |

**Example:**
```json
{
  "id": "fac_market_rate",
  "kind": "factor",
  "label": "Market interest rate",
  "category": "external",
  "prior": { "distribution": "uniform", "range_min": 0.03, "range_max": 0.08 },
  "factor_type": "price",
  "extractionType": "inferred"
}
```

> **Note:** External factors do not have `observed_state` (no current value). `factor_type`, `extractionType`, and `uncertainty_drivers` appear as top-level node properties (not inside `observed_state`).

---

## Availability

| Field | Available now (pre-v191) | Requires v191 prompt |
|-------|--------------------------|----------------------|
| `nodes[option].interventions` | Yes — populated from existing `options[]` data | No |
| `options[].is_baseline` | No — LLM must generate it | Yes |
| `nodes[option].is_baseline` | No — derived from `options[]` | Yes |
| `nodes[factor].encoding_map` | No — LLM must generate it | Yes |
| `nodes[external factor].factor_type` | Yes — if LLM generated it and it survived normalisation | Improved coverage |
| `nodes[external factor].extractionType` | Yes — preserved now (was previously lost) | Improved coverage |
| `nodes[external factor].uncertainty_drivers` | Yes — preserved now (was previously lost) | Improved coverage |

