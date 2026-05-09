# `edit_graph` Routing Truth Check (v9 Workstream Pre-Implementation)

**Date:** 2026-05-09
**Scope:** Read-only audit of the runtime model and provider for `edit_graph`,
including PMS/Supabase entry, `model_config`, code default, version pinning,
repair-path parity, and operator-visibility gaps. No prompts, code, env, PMS
rows, migrations, or model-routing config were modified during this audit.

---

## TL;DR

| Question | Answer |
|---|---|
| Runtime model | **`gpt-4o`** |
| Provider | **OpenAI** |
| Source winning the resolution | `task_default` (code) |
| Prompt version pinned | PMS v8 (active=staging=8) |
| Repair model parity | **Same model** — repair re-uses the primary adapter, only the system prompt swaps |
| `model_config` set in PMS? | **No (null)** — UI shows "Use task default" |
| All sources agree on `gpt-4o`? | **Yes** — no bifurcation today for `edit_graph` |
| Hidden bifurcation risk for OTHER tasks? | **Yes** — see "Operator-visibility gaps" |

---

## 1. PMS / Supabase entry

Live SELECT against `cee_prompts` on staging
(`SUPABASE_URL` from `<repo-root>/.env.staging.local`).

### Reproducible read-only query shape

Two queries were run; neither modifies state. Credentials live in
`<repo-root>/.env.staging.local` (gitignored) — never echo or log them.

> **Path convention note:** this audit used
> `<repo-root>/.env.staging.local` per the convention recorded in the
> agent's memory ("Mirrored at
> `~/Documents/GitHub/olumi-assistants-service/.env.staging.local`
> (gitignored)"). If your local CEE staging env lives elsewhere,
> substitute that path. The file is intentionally gitignored, so the
> exact path is operator-local.

```bash
# Query 1: cee_prompts row for edit_graph + repair_edit_graph
curl -s -G "${SUPABASE_URL}/rest/v1/cee_prompts" \
  --data-urlencode "select=name,task_id,status,active_version,staging_version,model_config,updated_at" \
  --data-urlencode "name=in.(edit_graph,repair_edit_graph)" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"

# Note: the table is `cee_prompts`, not `prompts` — the public.prompts alias
# does not exist in the schema cache. The `is_active` column also does not
# exist on cee_prompts (only is_active on the version row, distinct from
# active_version on the parent). If you see PostgREST errors about either,
# you're on the wrong table or column set.

# Query 2: cee_prompt_versions row for the active edit_graph version
PROMPT_ID=edit_graph_default  # convention: <task_id>_default
curl -s -G "${SUPABASE_URL}/rest/v1/cee_prompt_versions" \
  --data-urlencode "select=prompt_id,version,variables,created_by,created_at,change_note,content_hash,requires_approval,approved_by,approved_at,test_cases" \
  --data-urlencode "prompt_id=eq.${PROMPT_ID}" \
  --data-urlencode "version=eq.8" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

### Result

| Field | `edit_graph` | `repair_edit_graph` |
|---|---|---|
| task_id | `edit_graph` | `repair_edit_graph` |
| status | production | production |
| active_version / staging_version | **8 / 8** | **1 / null** |
| **model_config** | **`null`** | **`null`** |
| updated_at | 2026-03-22T17:46:46Z | 2026-02-25T21:05:38Z |

Peer tasks for comparison — these *do* have explicit `model_config`:
`draft_graph` (`claude-sonnet-4-6`), `decision_review` (`claude-sonnet-4-6`),
`explainer` (`claude-sonnet-4-6`), `orchestrator` (`claude-sonnet-4-6`).
`edit_graph` is in the orphan set alongside `bias_check`, `validate_graph`,
`repair_graph`, `clarify_brief`, etc.

### Version-row schema note (UI label reconciliation)

The version table `cee_prompt_versions` has **no** `model` or `provider`
column. Columns: `prompt_id`, `version`, `content`, `variables`, `created_by`,
`created_at`, **`change_note`**, `content_hash`, `requires_approval`,
`approved_by`, `approved_at`, `test_cases`.

For `edit_graph_default v8`, `change_note` is the literal string
`"Sonnet 4.6 "` (trailing space). The admin UI renders `version.changeNote`
as a free-text label
([`src/routes/admin.ui.ts:1295`](../src/routes/admin.ui.ts:1295)).
That is the source of the misleading "Sonnet 4.6" label observed in the PMS
UI — it is a free-text annotation, **not a model binding**. The
"Model Configuration" panel
([`src/routes/admin.ui.ts:1264-1283`](../src/routes/admin.ui.ts:1264))
correctly shows "Use task default" because `model_config` is null.

Most likely explanation: when v8 was published 2026-03-19 the author intended
to switch to Sonnet 4.6 and wrote it as a label, but never populated
`model_config` (or did populate it then it was nulled later — `cee_prompts`
has no audit trail).

---

## 2. Code default

[`src/config/model-routing.ts:102`](../src/config/model-routing.ts:102):

```ts
edit_graph: "gpt-4o",  // Quality tier - graph editing (override via CEE_MODEL_EDIT_GRAPH)
```

Hardcoded, environment-independent. No staging vs production split in
`TASK_MODEL_DEFAULTS`.

---

## 3. Resolution chain — what actually wins

The model-routing comment block lists six precedence steps (highest first):

1. `per_call` — none of the `edit_graph` call sites pass `modelOverride`
2. `store_model_config` — **not wired for `edit_graph`** (see § 5 below)
3. `env_var` `CEE_MODEL_EDIT_GRAPH` — **unset** in `.env` and `.env.staging.local`
4. `task_default` `TASK_MODEL_DEFAULTS.edit_graph` = `"gpt-4o"` — **wins**
5. `providers_json` task-override — none
6. `llm_model_fallback` `LLM_PROVIDER`/`LLM_MODEL` — `LLM_PROVIDER=openai`

`gpt-4o` resolves to provider `openai`; the provider check passes. Final:
**`gpt-4o` on OpenAI**.

---

## 4. Repair model parity

The repair path is at
[`src/orchestrator/tools/edit-graph.ts:1552`](../src/orchestrator/tools/edit-graph.ts:1552):

```ts
const effectiveInstruction = isRepair
  ? (await getSystemPrompt('repair_edit_graph')) + '\n\n' + contextSection
  : fullSystemPrompt;
…
chatResult = await adapter.chat(
  { system: effectiveInstruction, userMessage, … },
  callOpts,
);
```

`adapter` is captured **outside** the attempt loop (line 1564 in the parent
`handleEditGraph` scope; the loop begins at line 1521). On repair, only the
system prompt is swapped — the adapter, model, and provider do not change by
construction.

Implication: `cee_prompts.repair_edit_graph.model_config` is **operationally
inert** — even if it were set to a different model, the runtime would not
read it. Repair model = primary model = **`gpt-4o`** today.

---

## 5. Operator-visibility gaps (ranked by severity)

### 5a. `store_model_config` is not wired for `edit_graph`

The model-routing comment block lists `store_model_config` as precedence
step 2, citing
[`src/cee/unified-pipeline/stages/parse.ts:99-115`](../src/cee/unified-pipeline/stages/parse.ts:99).
That block hardcodes `"draft_graph"`:

```ts
const promptMeta = getSystemPromptMeta("draft_graph");  // ← only draft_graph
if (promptMeta.modelConfig) { … }
```

Every `edit_graph` call site uses `getAdapter('edit_graph')` with no
override:

| Call site | |
|---|---|
| [`src/routes/assist.v1.edit-graph.ts:71`](../src/routes/assist.v1.edit-graph.ts:71) | `getAdapter("edit_graph")` |
| [`src/orchestrator-v5/handlers/edit-graph-dispatch.ts:477`](../src/orchestrator-v5/handlers/edit-graph-dispatch.ts:477) | `getAdapter('edit_graph')` |
| [`src/orchestrator/turn-handler.ts:988`](../src/orchestrator/turn-handler.ts:988) | `getAdapter('edit_graph')` |
| [`src/orchestrator/tools/dispatch.ts:300`](../src/orchestrator/tools/dispatch.ts:300) | `getAdapter('edit_graph')` |

The router itself
([`src/adapters/llm/router.ts:670-830`](../src/adapters/llm/router.ts:670))
honours `modelOverride` if passed but does **not** read the prompt store.

**Implication:** the admin UI's "Model Configuration" panel for `edit_graph`
is a **write-only field** today. Setting `model_config` for `edit_graph`
appears to save but has zero runtime effect. Same gap likely affects every
task except `draft_graph`. (The `orchestrator` and `decision_review` rows
that show `model_config = claude-sonnet-4-6` may also be inert unless they
have their own dedicated wiring — would require a separate audit per call
site.)

This gap is **deferred** for the v9 workstream per Paul's brief; flagged
here for follow-up.

### 5b. No `model.resolution` log on the `edit_graph` path

`model.resolution` is emitted by
[`parse.ts:124-133`](../src/cee/unified-pipeline/stages/parse.ts:124) but
only for `draft_graph`. The edit_graph dispatch logs `prompt_source` and
`prompt_version`
([`edit-graph.ts:1478-1488`](../src/orchestrator/tools/edit-graph.ts:1478))
but does **not** log resolved model or resolution_source. Operators have no
per-call log line proving which model an `edit_graph` call used.

### 5c. No way to list recent turn_ids

[`/admin/v1/turn-debug/:turn_id`](../src/routes/admin.v1.turn-debug.ts:43)
is keyed-lookup only. There is no list/recent endpoint to enumerate edit_graph
turns.

### 5d. Admin UI conflates `change_note` with model label

A `change_note` reading "Sonnet 4.6" sits adjacent to a
"Model Configuration" panel saying "Use task default" — internally consistent
but visually misleading. (Cf. § 1 above.)

### 5e. Startup `model.task_resolved` log diverges from runtime

[`src/config/model-resolution-logger.ts:93-110`](../src/config/model-resolution-logger.ts:93)
emits `model.task_resolved` at boot but does not consult PMS, so for tasks
with non-null `model_config` it under-reports. For `edit_graph` it happens
to be correct today — only because `model_config` is null. If an operator
later sets `model_config` on `edit_graph` in PMS, startup log will silently
lie (and once 5a is wired, runtime would silently change).

---

## 6. Agreement matrix

| Source | Says | Agrees with runtime? |
|---|---|---|
| `cee_prompts.model_config` (binding) | `null` ⇒ "Use task default" | ✅ |
| `cee_prompt_versions.change_note` (label only, free text) | `"Sonnet 4.6 "` | ❌ — UI label is misleading; not a binding |
| `TASK_MODEL_DEFAULTS['edit_graph']` (code default) | `gpt-4o` | ✅ |
| `CEE_MODEL_EDIT_GRAPH` env var | unset | ✅ |
| `LLM_PROVIDER` | `openai` | ✅ |
| Caller-side store consult for `edit_graph` | absent (only `draft_graph`) | ✅ (no override path active) |
| Per-call `model.resolution` log on `edit_graph` path | not emitted | n/a (visibility gap, not a divergence) |

**No bifurcation for `edit_graph` today.** The bifurcation risk would only
materialise if § 5a is fixed without coordinating with § 1 — at that point
the misleading UI label could become load-bearing.

---

## 7. Runtime-log evidence

Static routing evidence (PMS row, code defaults, env vars, call-site
inspection) **indicates** the runtime model for `edit_graph` is `gpt-4o`
on OpenAI.

**Runtime confirmation is explicitly unavailable** in this audit:

- No recent staging `model.resolution` entry could be retrieved without a
  known `turn_id` (cf. § 5b, § 5c — there is no `model.resolution` log on
  the `edit_graph` path, and `/admin/v1/turn-debug/:turn_id` is keyed-
  lookup only, with no list/recent endpoint).
- Available staging Supabase credentials do not extend to log ingest
  (Render / Datadog).

For a runtime-confirmed answer, Paul would need to supply either a recent
deployed log sample containing the `edit_graph completed` log line and the
surrounding adapter log, OR a `turn_id` from a recent staging edit_graph
turn. Until then, the agreement matrix in § 6 reflects static evidence
only.

---

## 8. Recommendations (out of scope for v9 workstream — flagged)

These are **not** implemented; flagging for separate work items.

1. **Wire `store_model_config` for `edit_graph`** (and audit other tasks).
   Either centralise the override in the dispatch site or replicate the
   `parse.ts` block. Until then, the admin UI's Model Configuration panel
   for non-`draft_graph` tasks is misleading.
2. **Emit `model.resolution` from the `edit_graph` dispatch.** The wiring
   for this — `getAdapterWithResolution` — already exists
   ([`router.ts:673`](../src/adapters/llm/router.ts:673)). One-line change
   per call site.
3. **Distinguish or remove `change_note` from version row labels** in the
   admin UI; or pull binding model from `model_config` and render it in the
   row. Reduces misleading "Sonnet 4.6"-type UI states.

---

## Provenance

- Author: Claude Code (Opus 4.7), invoked by Paul
- Method: read-only file reads, grep, and SELECT against staging Supabase
  using `<repo-root>/.env.staging.local` credentials
- No prompts, code, env, PMS rows, migrations, or model-routing config were
  modified during this audit

---

## Related artefacts

- [edit_graph_v9_deferred_items.md](edit_graph_v9_deferred_items.md) — DL
  list for this workstream (worktree pnpm, telemetry sunset, `extractJson`
  follow-up, doc-path convention).
- [tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts](../tests/unit/orchestrator/tools/edit-graph-bare-array-safe-envelope.test.ts) —
  Phase 1 failing-tests artefact (red-state baseline for Phase 2).

> If a cross-workstream V5 war-room / decision-log source of truth exists
> outside this repo, add a one-line pointer from there to this file. None
> was found in `Docs/v5/` at audit time; do not duplicate the report
> content.
