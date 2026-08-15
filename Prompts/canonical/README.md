# `Prompts/canonical/` — the repo-canonical prompt estate

**These files are the verified canonical bytes of the captured PMS prompt set.
PMS is populated FROM here. One current gap is explicit below: `validate_graph`
became live after this capture and does not yet have a verified canonical export.**

Captured 2026-07-27 from CEE commit `74936a650e4b97d9f06d7ee740394c135396edf4`
(which was also the deployed `cee-staging` build at capture time) and the staging
PMS store (Supabase project `etmmuzwxtcjipwphdola`, tables `cee_prompts` /
`cee_prompt_versions`).

## Why this directory exists

The prompt estate lived only in a database and in a hand-maintained markdown register.
Both drift, and the drift always reads as green: the register described the routing prompt
as served `v119` when the store had moved to `v120`, and described the estate as "9 live
prompts" when the derived number is different (see the audit in
`docs-designs/PROMPT-ESTATE-DERIVED-2026-07-27.md`). A prompt is product surface. It
belongs under review, in git, with a diff.

## What is in here

`manifest.json` is the authority: key → served version → sha256 → trigger. Every entry
was cross-checked against what the live service reports it is sending.

| file | PMS task | served version | fires |
|---|---|---|---|
| `routing.txt` | `orchestrator` (alias of `routing`) | v120 | **every turn** — the ORIENT system prompt |
| `draft_graph.txt` | `draft_graph` | v195 | first-brief draft dispatch |
| `edit_graph.txt` | `edit_graph` | v11 | free-text graph-edit turn |
| `repair_edit_graph.txt` | `repair_edit_graph` | v2 | edit retry (attempt ≥ 2) after invalid ops |
| `repair_graph.txt` | `repair_graph` | v6 | **never** — inert compatibility row; the LLM capability is retired |
| `decision_review.txt` | `decision_review` | **v15** | `run_analysis` outcome + the PLoT→CEE decision-review callback |

> ⚠ **This table is a mirror and it drifted.** `decision_review` read `v14` here
> until 2026-08-10 while `manifest.json` — which this README itself calls the
> authority — had recorded `served_version: 15`, `served_hash_verified: true`
> since the 31 Jul regeneration. **Read `manifest.json`, not this table.**

> ⚠ **Known live-export gap:** `validate_graph` is now active at the shipped
> code default (`CEE_VALIDATION_PIPELINE_ENABLED=true`, with the env var acting
> as a kill-switch) and resolves a PMS prompt, but this directory has no
> verified `validate_graph.txt`. Until a live status read is captured and
> exported, its exact served PMS version/hash is not derivable from this
> manifest. Do not silently substitute the bundled default and call it served.

## What is deliberately NOT in here

**Code-constant prompts are not copied into this directory.** Several live prompts are
baked into TypeScript and never touch PMS — `COACHING_SYSTEM`
(`src/cee/unified-pipeline/stages/coaching-pass.ts:75`, a second LLM call on *every* draft
turn), `SUMMARISER_SYSTEM_PROMPT`
(`src/orchestrator-v5/rolling-summary/summariser.ts:27`), `ENRICH_FACTORS_PROMPT`
(`src/prompts/enrich-factors.ts:117`), and the draft reminder/retry directives. They are
already in git at those paths. Copying them here would create a second copy that someone
must remember to sync — the exact hand-maintained-mirror defect this directory exists to
remove. `manifest.json` lists them under `code_constant_live_prompts` with their
authoritative path instead.

**⚠ `enrich_factors` is a live trap.** A PMS row named `enrich_factors` exists and has
**zero runtime readers** — `src/services/review/enrichFactors.ts:429` assigns the code
constant directly and never calls `getSystemPrompt('enrich_factors')`. **Editing that PMS
row silently changes nothing.** Edit `src/prompts/enrich-factors.ts`.

**Dark and dead PMS keys are not exported** (`suggest_options`, `clarify_brief`,
`critique_graph`, `m2_graph_review`, and ~10 dead `*_narrate` rows).
They are listed in `manifest.json` under `dark_or_dead` with the reason each is
unreachable. Exporting them would imply they are product surface; they are not.

`repair_graph` is the deliberate compatibility exception: its historical bytes
remain exported and its PMS row still participates in readiness, but the model
capability and every production caller were removed by ROADMAP 2.763. Source
guards fail if `.repairGraph()` is reintroduced. Retire the PMS row, bundled
default and health metadata together; do not rewire the inert prompt.

## How the version pointer resolves

`cee-staging` sets `PROMPTS_USE_STAGING=True`, so the served version is
`staging_version ?? active_version` (`src/prompts/stores/supabase.ts:612`).
`active_version` is the *production* pointer and on several keys it deliberately lags.
**Never read `active_version` as "what staging serves".**

## Version-bump procedure

A prompt change is a code change. It goes through review here first.

1. **Edit the file in this directory** on a branch. Open a PR. The diff is the review.
2. **Merge to `staging`.**
3. **Upload the new bytes as a NEW PMS version** — never edit a version in place:
   `POST /admin/prompts/<prompt_id>/versions` with the file contents and a change note
   that says what changed and why.
4. **Pin it on staging:** `PATCH /admin/prompts/<prompt_id>` `{"stagingVersion": N}`.
   Leave `activeVersion` alone — that is the production pointer.
   For a task with a real eval pack, the admin route now requires a current,
   hash-matched, floor-passing committed promotion report before either pointer
   can move. A rejection is atomic and returns `prompt_promotion_eval_required`.
5. **Reload:** `POST /admin/prompts/reload`. *A re-pin without a reload silently no-ops.*
6. **Verify the SERVED bytes, not the pointer.** `GET /admin/prompts/status` returns
   `content_hash` = `sha256(content).hex[:16]` (`src/prompts/loader.ts:33`). Confirm it
   equals the `sha256` prefix in `manifest.json` for the file you just shipped.
   **Sample it several times** — CEE runs multiple instances with a ~5-minute loader TTL,
   so a single read can catch an instance that has not expired its cache yet. A split
   reading is a finding, not noise.
7. **Update `manifest.json`** in the same PR as step 1 (version + sha256).

To revert: `PATCH {"stagingVersion": <previous>}` + reload, then confirm the hash again.

### Standing hazards

- **`decision_review` v12 is POISON — never promote it.** It is a mis-uploaded
  `draft_graph` prompt (its content opens with the draft `<ROLE>` block; 48,631 chars
  against v14's 27,256). Promoting it destroys the review panel. Its `change_note` in PMS
  has been marked `⛔ POISONED — DO NOT PROMOTE`; a full byte backup is at
  `docs-designs/pms-v12-backup-2026-07-27.json` in the programme docs.
  Valid lineage: v11 (prod pointer) → v13 (revert anchor `ac07859bec2dfc77`) → v14 → **v15
  (current staging pointer, sha256 `ba4879dd…`)**.
  ⚠ **CORRECTED 2026-08-10: this bullet used to end "Never create a v15".** It was written
  before the fix-decision-review-v15 lane created and promoted exactly that on 2026-07-31
  (`manifest.json` `_meta.decision_review_regen_note`, hash read back from the live
  `/admin/prompts/status`). Leaving the instruction standing meant the estate's own
  version-bump doctrine forbade the version it was already serving — and the next author
  would have skipped a number for a reason that no longer existed. **The next version is
  v16.** The original naming trap is still documented at
  `tools/conversation-harness/prompt-estate/revert-anchors/decision-review-revert-anchor.txt`;
  what it warns about is confusing the POISONED v12 with a good version, not the number 15.
  The poisoned hash is now blocked by the runtime promotion-evidence gate: a
  `stagingVersion: 12` or `activeVersion: 12` mutation cannot clear without a
  current passing report bound to those exact bytes. The existing approval
  guard remains separate and still applies to a `status`→`production`
  transition.
- **The `routing` key resolves the PMS task `orchestrator`**, not `routing`
  (`src/prompts/tracked.ts:88` `PMS_TASK_ALIAS`). Bump the `orchestrator` row.
- **`Prompts/v40.txt` (the parent directory) is the routing FALLBACK** read from disk at
  module import (`src/orchestrator-v5/routing/prompt-loader.ts:64`), served when Supabase
  is unavailable. It is **not** what staging normally serves and is intentionally a
  different, smaller prompt. Do not "sync" it to `canonical/routing.txt`.
  The directory name casing `Prompts` is load-bearing and test-enforced
  (`src/orchestrator-v5/routing/__tests__/prompt-loader.test.ts:70`).
