# SDL / Model State — RESUME HERE

**Written 2026-09-22 ~00:2x BST, before a terminal restart.** Everything below is
on the remote. Nothing you need lives only in a scratchpad.

---

## 0. THE ONE THING THAT CHANGED THE WORLD

⛔ **Migration `20260920210000` IS APPLIED to the shared Supabase project.**
Applied 2026-09-21T23:13:34Z on Paul's explicit instruction. This is a PRODUCTION
schema change — one Supabase project serves staging, production and demo.

| | |
|---|---|
| live `append_turn_atomic_v5` prosrc md5 | `7b78d8e12550628570e15b2b739c2d4d` |
| ordering | `REPLAY_BEFORE_CAS` (fixed) |
| ledger | 137 → 138 rows; `20260920210000` present |
| `20260920220000` | deliberately **NOT** applied |
| rollback | proven exact, returns md5 to `829c3deb90594099397d64d747f4854e` |

Rollback command (guarded; refuses without the flag):
```bash
MIGRATION_APPLY_APPROVED=1 node scripts/witness/apply-migration.mjs --rollback
```
Read-only check, safe any time: `node scripts/witness/apply-migration.mjs --check`

**There is a synthetic auth user** `sdl-witness-…@olumi-witness.test`
(id `0a43a097-2917-4860-b0bb-89fdaeac5b01`), created with Paul's approval and
**deliberately left in place** — deleting from `auth.users` risks cascading into
scenario rows. Witness scenario: `b6bf8e80-960f-48f8-818e-e7b02d890332`.

---

## 1. WHERE THE WORK IS (all pushed, all remote-verified at 40 chars)

| branch | head | what it is |
|---|---|---|
| `feat/single-snapshot-run-analysis` | **the branch this file is on** | the witness, all evidence, corrections, and a RED single-snapshot test |
| `feat/sdl-replay-precedes-cas-proof` | `a626f87bc1196577d6563e7c922c9705ec1b2636` | executable RED→GREEN→mutant proof of the migration on real Postgres 15 |
| `feat/sdl-state-spine-witness` | `9ce6d44ee4f60f862996a2673f036086c2ac2b75` | the 696-line reachability harness (headline refuted — see §4) |
| `handover/sdl-model-state-2026-09-21` | `6be83825…` (superseded by `551f681b…`) | the prior lane's handover |

Everything in this directory, plus `raw/` (146 files: container probes, SQL bodies,
RED/GREEN/mutant JSON, verifier reports, Render and DB captures).

**Base for all of it:** staging moved during the session from
`e717e19d05542a80254ea056aa95a59c2cde4053` to
`bd35cc9e1a838159ec3949a278a89820acb01151` when **PR #1659 merged** (the dark
"replacement" conversation module, plus an unapplied migration
`20260920120000_v5_replacement_state.sql`). Lanes A and B are pinned at the older
tip; the witness and the snapshot test are on the newer one.

---

## 2. WHAT IS PROVEN — do not re-derive these

**CORE STATE SPINE: PASS** on the deployed build, owned scenario, from DB rows and
wire JSON only (`W3-CORE-STATE-SPINE-PASS.md`):
`initial` → `committed_mutation` chain with correct parentage and root, pointer at
head, scenario identity hash == head version's, reload agreeing on **both** hash
families, run_analysis fact bound to the version it ran against, and a stale result
correctly **withheld** (`complete_stale` / `graph_changed`, `analysis_result: null`).

**The `committed_mutation` scarcity is usage, not a defect**
(`ORCH-committed-mutation-resolved.md`). Zero owned turns were silently suppressed
across September (contrast control: `initial` versions written daily). No signed-in
scenario had a second graph-changing turn between 11 and 21 Sep, which is the whole
explanation for the 3,053 : 296 split. `creation_kind` is decided in SQL:
`initial` iff the scenario has no versions yet, else `committed_mutation`.

**The alien-fact-row defect has never fired** — 7 days, zero hits on every probe,
against a control showing thousands of successful reads. No code needed.

**The migration's correctness** — proven against a container whose pre-fix body was
byte-identical to the deployed function (same md5, same length, same offsets).

---

## 3. WHAT IS OPEN

**(a) Single-snapshot race — REPRODUCED, fix not landed.** A run turn reads
`scenarios.graph` twice, unlocked, and nothing joins the reads: freshness comes
from `build-turn-context.ts:907`, while `graph_hash_at_run` comes from
`tools/registry.ts:716` → `loadScenarioSnapshotForRunAnalysis`. Committed failing
test: `src/orchestrator-v5/__tests__/run-analysis-single-snapshot.test.ts`
(measured `08efc1d87bd245cb` vs `038423e339e50c1a`, no refusal; the control with
an unchanging store PASSES).
**Why the fix was not landed:** `ScenarioReader` is `(scenarioId, signal?)` and the
handler invocation carries no turn context, so a guard would be DEAD until turn
context is threaded through `turn-executor.ts`. Core measured with a positive
control that **PR #1660 touches neither call site** — the race is *unowned*, not
scheduled elsewhere.

**(b) Wire-level idempotency.** A client cannot replay a mutation and recover its
receipt. See §4 — the scope of this is now contested and is the next thing to settle.

**(c) `/graph/register` creates no version and never moves the pointer.** It reaches
`append_turn_atomic_v3` (NOT v4 — a verifier corrected that), stamps
`graph_identity_hash`, and leaves Model Management blind. Relevant if the OpenAI
lane wants whole-graph creation. Contract: `OPENAI-SEAM-CONTRACT.md`.

**(d) A unit-parser dead end blocks the natural mutation phrasing.**
"Change X to £62 per month" on a `£/month` factor is refused as *"the value
provided is in £"*; same shape for percentage points. Setting a factor that has no
value yet DOES work (`Set Monthly Churn Rate to 3%.`). Producer-lane territory.

---

## 4. ⚠ THE CONTESTED FINDING — read before quoting it

I measured, with a contrast control in the same query, that the client `turn_id` of
a **handler-routed** mutation is absent from `v5_conversation_turns` estate-wide
while the draft turn's client id is present, and that a verbatim wire replay
returns `409 GRAPH_DIVERGED` / `turn_fence_superseded` with no duplicate version.

An independent verifier then refuted the *general* form: `route-v2.ts` passes
`turn_id: ingress.turn_id` at **9 of 9** commit sites, and a peer lane's
message-family replay was **not** intercepted — 200, a new turn row,
`turn_class=clarify`, NULL mutation id, so it never called v5.

**Net:** scope the claim to the handler path. Whether the v5 replay arm is
reachable from the wire at all is **OPEN**. My 409 and the peer's 200 are evidence
about different paths and neither controls for the other. Full detail in
`CORRECTIONS-after-adversarial-verification.md`.

---

## 5. ⛔ THE REQUIRED CI GATE IS RED AT BASE — do not attribute it to these branches

`pnpm test:required` exits 1 at **both** base and head: 17 tests failing, ~43,512
collected, three overlapping failing files. Lists in `raw/base-failfiles.txt`,
`raw/head-failfiles.txt`, `raw/base-failtests.txt`, `raw/head-failtests.txt`.
The two 51MB raw run logs were **not** committed (size); they were at
`<scratchpad>/evidence/{gate-13-test-required,base-test-required-FULL}.log` and are
regenerable with `pnpm test:required`.

**Nothing here is merge-ready** while that is true, and none of it was proposed for
merge. `feat/single-snapshot-run-analysis` carries a deliberately RED test and
**must not be merged** as-is.

---

## 6. HOW TO GET ACCESS AGAIN

Credentials: `olumi-assistants-service/.env.staging.local` (Render key, Supabase
URL, DB password, `SUPABASE_SERVICE_ROLE_KEY_NEW` — use the `_NEW` one, the other is
rotated out and 401s uniformly). Anon key: `DecisionGuideAI/.env.local`
(do **not** blanket-source that file — it carries `VITE_*` flags).

Postgres: `psql` is not installed; use node-postgres against the **session pooler**
`aws-0-us-east-1.pooler.supabase.com:5432` (6543 cannot do DDL), user
`postgres.<project-ref>`, `ssl:{rejectUnauthorized:false}`. Always
`set transaction read only` first unless you intend a production write.

Scripts (committed at `scripts/witness/`): `apply-migration.mjs` (guarded,
ledger-aware, self-verifying), `auth.mjs` (approval-gated user creation + sign-in),
`witness.mjs` (the owned-scenario witness).

**Offset convention:** every offset published in this handover is measured from a
body slice that **includes** the leading `\nBEGIN`. Slicing after the token gives
six fewer. The ordering relation is invariant either way.

---

## 7. THE NEXT THREE THINGS, IN ORDER

1. **Settle whether the v5 replay arm is wire-reachable** (§4). One clean
   experiment: replay a turn on the direct-answer path that DID carry a version
   carrier, and check `model_version_mutation_id` on the row the replay writes.
2. **Land the single-snapshot fix** (§3a) — thread the turn's graph into the
   run-analysis reader, or refuse on hash divergence. The failing test is already
   committed and admits either shape.
3. **Take an outcome metric before any further change here.** A verifier's fair
   hit: no before-count of replay refusals was taken, so the migration has no
   measurable before/after. Do that first next time.
