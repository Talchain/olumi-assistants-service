# PMS candidate — draft-side hard-constraint minting

**Do NOT upload/PATCH/reload PMS from this PR.** This file is the PMS candidate
for the orchestrator to apply via the UPLOAD-RUNBOOK. It records the exact
instruction delta this PR added to the **in-repo fallback** (`draft_graph` v187,
`src/prompts/defaults-v187.ts`) so the same change can be applied to the
**served** draft prompt.

## Which vehicle governs staging

- The **served** `draft_graph` prompt on staging is **PMS-managed** (store version;
  memory records it as **v195**). It is loaded by `getSystemPrompt('draft_graph')`
  from the Supabase prompt store (`src/adapters/llm/prompt-loader.ts`).
- The **in-repo default** is `draft_graph` **v187** (`FALLBACK_VERSIONS.draft_graph = 'v187'`,
  prompt-loader.ts). It only serves when PMS is disabled / the store fetch fails.
- **Therefore a merge of this PR alone does NOT change staging behaviour.** The
  served prompt (PMS v195) must be updated for the fix to reach real users. The
  in-repo v187 change keeps the fallback aligned and is what the tests pin.

## Root-cause (why this is a prompt change, not a schema change)

- CEE emits constraints ONLY as `graph.goal_constraints[]` entries. `run_analysis`
  forwards `graph.goal_constraints` to PLoT (`run-analysis.ts` ~L400), which
  **compiles them into constraint nodes** (`schemas/assist.ts` L160: "PLoT merges
  explicit goal_constraints[] with compiled constraint nodes"). This is exactly
  what the canonical `add_constraint` edit handler writes.
- A `kind:"constraint"` **node** is dead on the producer side: the adapter
  normaliser demotes `'constraint' → 'risk'` (`src/adapters/llm/normalisation.ts`
  L45; documented at `src/cee/transforms/schema-v3.ts` L109-112). So "mint a
  constraint node" == "emit a `goal_constraints[]` entry" at the CEE producer.
- The draft JSON schema (`src/cee/draft/anthropic-graph-schema.ts` L245-265)
  ALREADY allows `goal_constraints[]` with all required fields — **no schema
  change needed**.
- The gap is the prompt: v187/v195 instructed generic `goal_constraints[]`
  extraction but never forced EXPLICIT hard-constraint language to mint a
  constraint entry rather than descriptive factors. Acceptance evidence:
  `acceptance-evidence/real-user-acceptance-2026-07-17/PASS1.md` Step 6.

## The delta to apply to the SERVED prompt (v195 → next)

Apply inside the served prompt's goal-constraints section (in v187 this is the
`GOAL CONSTRAINTS:` block inside `<GOAL_AND_CONSTRAINT_RULES>`). Add:

1. A currency-unit line in the per-constraint value rules:

```
- currency/absolute-quantity constraints use USER units, unit the currency/quantity symbol: "cannot exceed £50,000" → value 50000, unit "£" (NOT a 0-1 fraction). PLoT normalises against the constrained node's cap.
```

2. The hard-constraint minting block + soft-preference negative example:

```
HARD CONSTRAINTS (explicit limits — MUST become a goal_constraints[] entry, never ONLY descriptive factors):
When the brief states a numeric limit in hard-constraint language — "hard constraint", "cannot exceed", "must not exceed", "must stay under", "no more than", "capped at", "cap of", "strict limit", "non-negotiable", "full stop", "unaffordable", or "the budget is £X" — you MUST emit a goal_constraints[] entry for that limit. Do NOT encode the limit ONLY as ordinary factors (e.g. "Budget Breach", "Headroom Within Cap"): descriptive factors leave the analysis with nothing to enforce the limit against.
- Ensure the constrained metric exists as a node in nodes[]. If the limit bounds a quantity the options move (e.g. first-year cost/spend), add ONE controllable factor for that metric (value + raw_value + unit + cap, factor_type "cost" for spend) and let options set it via interventions; reference THAT node's id as the constraint's node_id.
- operator "<=" for upper limits ("cannot exceed", "no more than"), ">=" for floors ("at least", "minimum"). provenance "explicit". source_quote = the limit phrase.
Worked example — brief "first-year budget cannot exceed £50,000 ... full stop": add factor { "id": "fac_first_year_cost", "kind": "factor", "label": "First-Year Cost", "category": "controllable", "data": { "value": 0.5, "raw_value": 50000, "unit": "£", "cap": 60000, "extractionType": "inferred", "factor_type": "cost" } }, have each option set fac_first_year_cost via interventions, then emit goal_constraints[]: { "constraint_id": "gc_budget_cap", "node_id": "fac_first_year_cost", "operator": "<=", "value": 50000, "label": "First-year budget cannot exceed £50k", "unit": "£", "source_quote": "cannot exceed £50,000", "confidence": 1.0, "provenance": "explicit" }.

SOFT PREFERENCES ARE NOT HARD CONSTRAINTS: a numeric wish framed with "ideally", "preferably", "aim to keep", "hope to stay under", "roughly", "around", or "target" expresses a preference, not a limit — keep it as a factor and/or a coaching add_constraint suggestion; do NOT emit a goal_constraints[] entry for it. Example: "ideally under £50k" → factor + coaching, NOT a goal_constraints[] entry.
```

This is byte-identical to the block added to `src/prompts/defaults-v187.ts` in
this PR (see the diff there — the single source of truth).

## Upload steps (orchestrator, not this lane)

1. Fetch the current served `draft_graph` staging version (v195) text from PMS.
2. Apply the two blocks above to its goal-constraints section.
3. POST the new version → PATCH stagingVersion → `POST /admin/prompts/reload` →
   verify the served hash on-wire (per UPLOAD-RUNBOOK; re-pin without reload
   silently no-ops).
4. Re-run the acceptance brief ("Hard constraint: first-year budget cannot
   exceed £50,000 ... full stop") and confirm the drafted graph carries a
   `goal_constraints[]` entry (operator `<=`, value 50000, unit `£`) referencing
   a cost node — then the CEE_CONSTRAINT_INFEASIBLE_GATE / PLoT
   constraint_probabilities chain has a signal to fire on.

## Guardrail note

The grammar-budget for the draft JSON schema is unchanged (this touches prompt
TEXT, not the structured-output schema). No `probe-grammar-compile.mjs` re-check
is required.
