# Reload/reconstruction and scenario comparison

Code at staging tip. ⓂⒹ = measured against the live database.

---

## 5. RELOAD — it does NOT reproduce the exact canonical semantic state

**The reload read is two columns.**
`POST /assist/v1/scenarios/:id/graph` (`assist.v1.scenario-graph.ts:287`,
registered unconditionally at `server.ts:1336`) →
`loadGraphAndBriefText` → `supabase-store.ts:2233-2237`:

```ts
.from('scenarios').select('graph, brief_text').eq('id', scenarioId).maybeSingle()
```

Everything else on the 200 body — `graph_identity_hash`, `graph_hash`,
`layout_present`, `not_modelled` — is **re-derived in-process from those bytes**,
never read. That discipline is deliberate and stated at `:568-572`.

A second reload path exists: a refresh arriving **as a turn**
(`route-v2.ts:3990-4013`) reconstructs from the persisted graph plus the last
**20** turns (`SESSION_READ_WINDOW_DEFAULT`, `session/index.ts:40`).

### Five concrete gaps

| # | gap | evidence |
|---|---|---|
| **i** | There is a named **persist** projection `projectGraphForPersistence` (3 ordered passes, order declared load-bearing) but **no load counterpart** — reload returns `data.graph ?? null` verbatim. Correct only if *every* writer projects, and **the restore tier is NOT covered** by the invariant floor | `persisted-graph-projection.ts:58-65`; `supabase-store.ts:2254-2257`; `commit.ts:1453-1465` (*"LIVE, not dark"*) |
| **ii** | ⭐ **The hand-written persist/read column pair diverges.** WRITE list includes `pending_actions` + `coaching_state`; the READ projection `V5_CONVERSATION_TURN_COLUMNS` **omits both**. They come back via *different queries with different semantics* — `pending_actions` from the newest row unconditionally, `coaching_state` from the newest row **filtered to non-null** | write `20260717120000:162-165`; read `supabase-store.ts:192-193`; re-reads `:2311-2318`, `:2421-2426` |
| **iii** | `scenarios.brief` (JSONB) is written by the commit seam but **reload reads `brief_text`** — a different column with a different writer. `brief` is consumed only by the share path | `brief-provenance/store-adapter.ts:96-98`; `supabase-store.ts:2235` |
| **iv** | Prose and chips are persisted but **never served on reload**, and there is **no conversation-history route at all**. Contrast control: `/versions` and `/decision-records/:id/outcome` *are* found by the same sweep | `scenario-graph-analysis-read.ts:50-57` |
| **v** | **In-flight runs are unrepresentable.** *"CEE keeps NO in-flight marker anywhere, so mid-run the only honest answer a READ can give is that no fact has landed"* | `scenario-graph-analysis-read.ts:66-70` |

### Alternative / stale sources of truth — 14 found, the dangerous ones

| source | risk |
|---|---|
| **`v5_turn_fence`** | ⛔ the table's own comment records that trimming the newest row lets an **older in-flight turn read as current and CLOBBER a newer graph** (`20260731120000:106`) |
| **`session_state`** | client-echoed, carries `prior_analysis_envelope`, `plays_fired`, `calibrations_provided`; **no DB column anywhere** — destroyed by reload. Contrast control: `pending_actions`/`coaching_state` *are* real columns |
| `SessionLRUCache` | per-process, turns only; multi-instance each process has its own map |
| `scenarios.graph_identity_hash` | `append_turn_atomic_v2` writes `graph` **without** the hash; v2 is selected when `graphCasRpc === 'off'` |
| `model_versions.graph` | diverges whenever versioning is skipped — see DEFECT 1 |
| `scenarios.rolling_summary` | can describe a graph state later overwritten |
| `scenarios.events` | **no reader found in `src`** — consumer may be external, UNVERIFIED |
| share store (Redis/in-process `Map`) | TTL'd **copy of the graph**; in-memory mode not multi-instance safe |
| ⓂⒹ `backup_013c2_scenarios_graph` | 97 rows, a literal backup table |

⚠ There is **no `graph_json` column** — that is not a divergence axis here
(sweep found only prompt-section names; contrast control `graph_state` returned
live hits).

---

## 6. SCENARIO / MODEL COMPARISON — it exists, it is deterministic, and it is gated

### What already exists

**(A) Version-to-version diff — real and LLM-free.**
`POST /assist/v1/scenarios/:id/versions/compare`
(`assist.v1.scenario-versions.ts:713`) → `ModelManagementService.compareVersions`
(`service.ts:399-424`) → `compareVersionRecords` (`compare.ts`), wire contract
`diff-v1.ts:11-42` — JSON-Pointer diff items, deterministic strict ordering,
server-side GraphV3 snapshots only, **no LLM**.

Declared blind spots are documented: `KNOWN_UNDETECTABLE_MODEL_VERSION_CHANGES`
(`compare.ts:27-31`) — conversation, private contributions, and **brief text is
outside the version snapshot**.

**(B) Run-over-run comparison — independent of `model_versions`.**
`run_delta` (`build-run-delta.ts`) is pure — *"no I/O, no LLM, no clock, no
config read, no DB read"* — consuming `v5_handler_facts`. Natural-language entry
via `tryRunComparisonGate`; chip-click forces `what_changed`. **Unaffected by
empty version history.**

**(C)–(E)** state-query "what changed", `POST /assist/v1/explain-diff`, and an
admin prompt diff.

⚠ **There is no scenario-to-scenario comparison anywhere** — only
version-to-version *within* one scenario (both ids resolved with
`.eq('scenario_id', scenarioId)`). Contrast control: `model_versions` and
`version_number` *are* found by the same sweep; `baseline_version`,
`version_history`, `compareScenarios` return **zero**.

### What depends on version history

**Group (A) entirely; groups (B)–(E) not at all.** With no versions:
`compareVersions` returns typed `version_not_found`, `listVersions` returns an
empty page, `getCurrentVersionId` returns null, restore has nothing to target.

### Is it reachable today? Three gates, and the second is the sharp one

1. **Registered unconditionally** — `server.ts:1338-1341`, explicitly *"no dark
   launches"*. Flag-off is an honest `VERSIONS_DISABLED` 503, not a 404.
2. ⛔ **`CEE_REQUIRE_USER_JWT` defaults OFF**, and `assist.v1.scenario-versions.ts:42-48`
   records the consequence: *"with the flag OFF (its DEFAULT, and unguarded in
   that direction) no caller is ever identified and **every OWNED scenario is
   refused to its OWN owner** on all four endpoints — list, compare, save and
   restore."*
3. **`CEE_MODEL_VERSIONS_ENABLED` is forced `false` in production**
   (`config/index.ts:154-166`). ⚠ Combined with ⓂⒹ one shared Supabase project,
   this means the 3,929 measured versions are staging-authored; **production
   users get no version history regardless of sign-in.**

⚠ **`/versions/compare` is absent from the published contract.**
`rg '/versions|versions/compare' openapi.yaml` → **zero hits**, while
`/assist/v1/explain-diff` (`openapi.yaml:301`) and `/assist/v1/graph-readiness`
(`:994`) *are* present.

### Minimum repairs before comparison is trustworthy

1. Resolve which of `model_versions` (ⓂⒹ 3,929) vs `canvas_versions` (ⓂⒹ 46) is
   authoritative.
2. Fix DEFECT 1 (guest skip) or accept that comparison is sign-in-only.
3. Decide the production flag posture — today comparison cannot work in prod.
4. Fix the `CEE_REQUIRE_USER_JWT` default, or owners cannot reach their own
   versions.
5. Bind analysis to a version (DEFECT 3) so a compared version can be tied to
   the run that produced its numbers.
6. Publish the route in `openapi.yaml`.

**UNVERIFIED:** whether any UI actually calls `/versions/compare` — the client
is in a different repo. The server half is registered and reachable by
construction; a rendered entry point was not proven.
