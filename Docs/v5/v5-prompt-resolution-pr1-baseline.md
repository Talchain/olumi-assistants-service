# V5 Prompt Resolution — PR1 baseline artefact

Captured 2026-06-05 against staging `cee-staging.onrender.com` (build `7b5a2b7`), **before** the PR1 observability change takes effect on staging. This is the "before" reference for proving the fix later.

## Root cause (confirmed)

Staging resolves the `routing` prompt from the **bundled default** (`Prompts/v40.txt`) instead of PMS, because the staging Supabase (`etmmuzwxtcjipwphdola`) has **no `cee_prompts` row with `task_id='routing'`**. PMS itself is healthy — the other four critical keys resolve from PMS. The prompt uploaded under `task_id='orchestrator'` (v110) is a different, much larger artefact and is **not** the V5 routing prompt.

## `GET /healthz` (before)

```json
{"ok":true,"build":"7b5a2b7","degraded":false,"service":"assistants","version":"1.12.0","prompts_ready":true}
```

Note `prompts_ready:true` **despite** routing-on-default — the existing readiness check counts *any* source as ready. PR1 adds an honest `critical_prompts_pms` boolean alongside it.

## `GET /admin/prompts/status` (before — baseline)

| key | source | version | content_hash | content_chars |
|---|---|---|---|---|
| **routing** | **default** ❌ | **v40** | **75fb1e81b41b82e9** | 21439 |
| edit_graph | pms ✅ | 9 | 313665a44465e8f9 | 28659 |
| draft_graph | pms ✅ | 193 | f6de6580489fe0ac | 58955 |
| decision_review | pms ✅ | 11 | 9477d3b854696a23 | 28006 |
| repair_graph | pms ✅ | 6 | ed4ead640907dc9c | 19864 |

## "After the fix" pass criteria (for later)

The routing prompt is correctly live once, **after Paul uploads the confirmed routing artefact to PMS under `task_id='routing'` and reloads/restarts**:

- `routing` row shows `source:"pms"`, `version` ≠ `v40`, `content_hash` ≠ `75fb1e81b41b82e9`;
- `GET /healthz` → `critical_prompts_pms:true` (PR1 field);
- `GET /healthz/detail.prompts.critical_prompt_coverage.all_pms === true` (PR1 field);
- the loud `v5.prompt_resolution_policy{outcome:"default_on_critical_deployed"}` event stops firing for `routing`;
- **Paul/ChatGPT confirms** the resolved version/hash equals the intended v41.x prompt (not asserted here).

See the unresolved artefact question in the workstream plan (§10) — the exact routing prompt/key/version/size must be confirmed before any PMS upload.
