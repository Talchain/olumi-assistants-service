# PMS candidate — draft_graph: make `goal_constraints[]` emission non-optional

**Status: CANDIDATE ONLY. NOT uploaded to PMS. Requires Paul's ruling + a PMS
upload runbook pass before it can serve.**

Target prompt: `draft_graph_default` (served staging `@v196`, hash `ba2d8b15d194`).
Repo default fallback: `src/prompts/defaults-v187.ts`.

---

## Why a prompt change is the lever here

Live staging build `08781d5`, scenario `94587fa3-f2d2-4352-8e8b-8ba07b533bb5`.
Brief contained: *"Hard constraint: first-year budget cannot exceed £50,000 —
anything over is unaffordable, full stop"*.

Result: the model created `fac_first_year_cost` (verbatim from the v196 worked
example) and `risk_budget_breach`, but emitted **no** `goal_constraints[]`.

The verdict is **NOT-EMITTED**, not stripped. Two code facts establish this:

1. **The JSON schema that appears to require the field is never sent.**
   `ANTHROPIC_DRAFT_GRAPH_SCHEMA` lists `goal_constraints` in `required`
   (`src/cee/draft/anthropic-graph-schema.ts:267-275`), but the schema is
   attached to the request **only** when `useStructuredOutputs` is true
   (`src/adapters/llm/anthropic.ts:694-704`). That flag requires
   (`anthropic.ts:587-590`):
   - `config.cee.anthropicStructuredOutputs` — **defaults `false`**
     (`src/config/index.ts:950`), and
   - the model to be in `STRUCTURED_OUTPUTS_SUPPORTED_MODELS` — and
     **claude-sonnet-5 is deliberately excluded** (`anthropic.ts:452-461`,
     which names sonnet-5 as "the model staging serves for every live
     `/orchestrate/v2/turn`").

   So on the live path the model runs in **prompt-only JSON mode**. The
   `required: ["goal_constraints"]` guarantee is **inert**. Emission is
   governed by the prompt text alone.

2. **The prompt currently tells the model the field is optional.**
   `src/prompts/defaults-v187.ts:436-437`:

   ```
   Required keys: "nodes", "edges", "causal_claims", "topology_plan", "coaching".
   Optional keys: "goal_constraints".
   ```

   This directly contradicts the schema, and the prompt's own instruction at
   `:337` — *"Primary target → goal node. Guardrails → outcome/risk nodes +
   goal_constraints[]"* — is the half the model obeyed only partially: it
   produced the **risk node** (`risk_budget_breach`) and skipped the
   **goal_constraints** half, which is precisely what an "Optional" label
   invites under output-length pressure.

The pipeline was proven NOT to strip the field: an LLM-emitted constraint whose
`node_id` matches a real graph node survives to the serialized wire bytes
(regression-pinned in `tests/unit/cee.draft-goal-constraints-egress.test.ts`).

> ⚠ Verify before upload: the "Optional keys" line above is read from the repo
> default **v187**, not from the served **v196** text (PMS is not readable from
> this lane). Confirm the line is still present in v196 before applying — if
> v196 already promoted it, the diagnosis changes to pure model
> non-compliance and the emphasis edit below is the remaining lever.

---

## Proposed edit 1 — promote the key (minimal, highest confidence)

Replace:

```
Required keys: "nodes", "edges", "causal_claims", "topology_plan", "coaching".
Optional keys: "goal_constraints".
```

with:

```
Required keys: "nodes", "edges", "causal_claims", "topology_plan", "coaching", "goal_constraints".
Emit "goal_constraints": [] only when the brief contains no numeric limit. If the
brief states any numeric limit, ceiling, floor, budget, cap, deadline, or
threshold, "goal_constraints" MUST contain one entry per limit.
```

This aligns the prompt with the schema's stated contract and removes the
"optional" escape hatch, while still permitting a legitimately empty array.

## Proposed edit 2 — close the risk-node substitution (recommended alongside)

Append to the `GOAL CONSTRAINTS` block (after `defaults-v187.ts:318-319`):

```
A risk or outcome node is NOT a substitute for a goal_constraints[] entry.
A hard limit produces BOTH: the measurable node AND the goal_constraints[] row
that bounds it. Emitting only the node silently loses the numeric bound —
downstream analysis cannot recover the threshold from a node label.

Each goal_constraints[] entry binds to an EXISTING node: "node_id" MUST be the
exact id of a node you emitted in "nodes". Do not invent an id, and do not
abbreviate one you already used.
```

The `node_id`-must-exist sentence matters because the pipeline drops any
constraint whose `node_id` does not match an emitted node
(`src/cee/unified-pipeline/stages/repair/compound-goals.ts:71-76`) — that drop
is now logged as `cee.compound_goal.llm_dropped`, but prevention is cheaper.

---

## Post-upload verification

Re-run the £50,000 brief and assert:

1. `draft_graph.goal_constraints` is present, with one entry
   `{ node_id: "fac_first_year_cost", operator: "<=", value: 50000 }`
   (`value` must be `50000` from the brief — note the live run emitted the
   worked example's `cap: 60000` verbatim on the node, so also confirm the
   model is reading the brief's number rather than copying the example's).
2. Staging logs show **no** `cee.compound_goal.llm_dropped` warn for the turn.
   If that warn appears with `skipped_node_ids`, the model is emitting but
   mis-binding — a different fix (target remapping) applies, not more prompt
   emphasis.
