# Staging confidence pack — v0 (Layer-2 architecture verification runbook)

**Purpose:** the concrete, executable verification that proves the technical/data
architecture track works **on staging** — not just that reversible work and draft PRs are
ready. Green draft PRs mean the code is buildable and unit-proven; **this pack is the real
confidence signal**, run only after the approved merges + staging deploy + the CAS
observe-mode decision.

**Standing gates (unchanged):** nothing in this pack is run automatically. No deploy, live
SQL, migration execution, CAS enforcement, prompt upload, production flag flip, or runtime
feature enablement without explicit Paul approval. Every step below is a *read/observe*
verification except where it drives the normal user journey through already-deployed
endpoints.

---

## 0. Preconditions (what must be true before this pack means anything)

| # | Precondition | Gates it |
|---|---|---|
| P0.1 | The approved hardening set merged: CEE #348, DGAI #229, PLoT #194 | §5 hash-identity + §6 no-write-regression |
| P0.2 | #346 CAS observe-mode merged to staging | §4 CAS-observe |
| P0.3 | Staging deployed from the merged `staging` (cee-staging.onrender.com healthy) | all live steps |
| P0.4 | `CEE_V5_GRAPH_CAS_MODE=observe` set on cee-staging env — **separate Paul approval, post-merge** | §4 (observe telemetry only appears once flipped) |
| P0.5 | Group A `graphIdentityHash` live on staging (already merged, #343 `93d39f1bf`) | §5 identity check |

If P0.2/P0.4 are not yet done, run §1–§3 + §5 (they don't depend on CAS); §4 stays pending.
Model Management (#349) and the re-vendors (DGAI #232 / PLoT #195) are **not** required for
this pack — they are dark / consumer-side and verified separately.

---

## 1. Draft → Analyse → Edit → Rerun (the core journey)

Drive the normal V5 journey against staging (`POST /orchestrate/v2/turn`, the live path;
v1 is 410). Use the existing staging smoke harness as the vehicle:

```
# From a fresh worktree of merged staging:
pnpm assurance:v5:staging       # R/A/G self-cleaning live journey (local-only, never CI)
```

- **Draft graph:** a brief → CEE drafts a decision graph. **Pass:** response carries a graph
  with nodes/edges; `assurance` reports GREEN for the draft leg; no raw IDs / forbidden
  terms in user-facing text.
- **Analyse:** request analysis on the drafted graph. **Pass:** `analysis_ready` payload
  returns with options + `freshness` (§3); PLoT→ISL round-trip completes; no
  `analysis_not_ready` unless the graph is genuinely graphless.
- **Edit:** apply a structural edit (add/rename a factor). **Pass:** the edit commits
  durably (narration follows persisted state — never "added/updated" unless the commit
  succeeded); the returned graph reflects the edit.
- **Rerun:** re-request analysis after the edit. **Pass:** fresh analysis returns; the prior
  result is superseded, not silently reused.

**Overall pass:** `pnpm assurance:v5:staging` ends GREEN (it self-cleans its scenario).

---

## 2. "What changed" honesty

After the §1 edit + rerun, verify the change is described truthfully:

- **Pass:** the "what changed / what would flip" copy never implies a flip that didn't
  happen (close-call honesty, #235), never claims an edit that wasn't durably committed,
  and the edit's effect on results is stated only when analysis actually re-ran.
- **Fail signal:** narration asserting "applied"/"updated"/"changed" on a turn whose commit
  did not persist, or a flip implied on a close call.

---

## 3. Freshness check (product decision recorded 2026-07-05)

Recorded decision: **label-only edits do NOT make analysis stale**; analysis freshness is
owned by the analysis-affecting hash; `graphIdentityHash` may still gate proposal-apply
safety; UI-local freshness is retired/subordinated over time (see
`server-authoritative-freshness-scoping-v0.md`).

- **Substantive edit → stale:** edit an edge strength (analysis-affecting), do NOT rerun.
  **Pass:** `analysis_ready.freshness` = `stale` (or the UI surfaces a re-run affordance);
  `freshness_reason` names a hash divergence.
- **Label-only edit → still fresh (CEE authority):** rename a node label only, do NOT rerun.
  **Pass (CEE):** the wire `freshness` from CEE stays `fresh` (the analysis-affecting hash
  excludes labels). *Known UI gap (tracked backlog A):* the UI-local `generateGraphHash`
  includes labels and may still show stale locally — this is the divergence the
  server-authoritative migration will close; record it, don't treat CEE `fresh` as a bug.

---

## 4. CAS observe-mode check (only after #346 merge + P0.4 env flip)

CAS observe-mode is **app-side stale-write observation, not atomic DB CAS**; enforcement is
OFF (prod auto-downgrades `enforce`→`observe`). This step confirms observe telemetry flows
and nothing blocks.

- **Clean write:** normal edit commit. **Pass:** one `v5.graph_cas.evaluated` telemetry
  event with `category=match` (or `first_write`/`no_expected` on a fresh/draft path); the
  commit proceeds; no `v5.graph_cas.write_blocked`.
- **Concurrent/stale write (if reproducible on staging):** a second writer between turn-start
  and commit. **Pass:** event `category=analysis_affecting_conflict` **or**
  `cosmetic_concurrent_edit` is emitted, and **the commit still proceeds** (observe never
  blocks); `write_blocked` count stays 0.
- **Flag-off parity (sanity):** with `CEE_V5_GRAPH_CAS_MODE` unset/`off`, confirm zero
  `scenarios` SELECT overhead and byte-identical commit behaviour (unit-proven in #346;
  re-confirm no telemetry emitted).
- **What observe gives us:** real conflict-frequency data at the single writer chokepoint —
  the input to decide whether the RPC v3 atomic CAS is worth building (it is markdown-only
  today, `Docs/v5/proposals/append-turn-atomic-v3-graph-cas.md`, Paul-gated).
- **Known limitation:** SELECT-then-write TOCTOU window; observe does not prove system-wide
  absence of stale writes, only measures them on the instrumented app path.

---

## 5. Hash-identity check (cross-service, post-hardening)

The `__proto__` hardening (CEE #348 / DGAI #229 / PLoT #194) must preserve cross-service
hash alignment AND fix the collision. Verified this session; re-confirm on merged staging:

- **Cross-service golden vector:** for the benign payload `{z:1,a:2,m:3}`, all three services
  canonicalise to `{"a":2,"m":3,"z":1}` and hash (sha256, 12-hex) to **`ebba85cfdc0a`**.
  **Pass:** CEE `computeResponseHash`, PLoT `computeOlumiHash`, and DGAI `computePayloadHash`
  all return `ebba85cfdc0a` (empirically confirmed 2026-07-06 pre-merge). *(DGAI's separate
  FNV `computePayloadHashSync` is a UI-local sync fallback, never cross-service-aligned by
  design — do not treat its different value as a regression.)*
- **Collision fixed:** a body differing only by an own `__proto__` key now hashes
  **differently** from the same body without it, in all three services (the
  idempotency-cache-replay hazard PLoT #194 closed).
- **graphIdentityHash (Group A):** a cosmetic-only edit changes the full identity hash while
  the analysis-affecting hash is unchanged (the two-hash contract, pinned by #345). **Pass:**
  identity hash moves on a label edit; analysis hash does not.

---

## 6. No stale/write regression

Confirm the hardening + CAS observe introduced no write-path regression:

- **Idempotency (PLoT):** replaying an identical request under the same Idempotency-Key
  returns the cached response; a *different* body under the same key returns 409
  IDEMPOTENCY_MISMATCH (now correct even for `__proto__`-bearing bodies — no false cache
  replay). **Pass:** both behaviours hold on staging.
- **Durable write invariant (CEE):** every graph-writing turn still persists through the
  single `append_turn_atomic_v2` chokepoint; observe-mode adds one PK SELECT per
  graph-writing commit only; no commit fails that previously succeeded. **Pass:** the §1
  journey's edits all persist; `pnpm test:required` stays green on staging tip.
- **No dark-lane activation:** Model Management (`CEE_MODEL_VERSIONS_ENABLED`), CAS enforce,
  and V6 flags remain OFF/default. **Pass:** `layer1-cross-track-acceptance.test.ts`
  dark-flag pins green on staging.

---

## Sequencing (ties to the review order)

1. Merge + deploy the hardening set (#348/#229/#194) → run §5, §6.
2. Merge #346 + (separately approved) flip staging `observe` → run §4.
3. Run §1–§3 end-to-end (the journey) → the GREEN `assurance:v5:staging`.
4. Only then is the architecture "proven on staging." Model Management (#349, migration
   Paul-gated) and the re-vendors (#232/#195) are verified on their own tracks afterwards.

**Exit criterion:** §1 GREEN, §2–§3 honest, §4 observe telemetry flowing with zero
`write_blocked`, §5 cross-service vector = `ebba85cfdc0a` + collision fixed, §6 no
regression. That is the real confidence signal.
