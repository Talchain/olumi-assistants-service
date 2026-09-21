# ASK: apply migration `20260920210000` to the shared Supabase project

Prepared 2026-09-21T22:57:05Z. One migration only. Two approvals requested in total (see foot).

## The decision

Apply `20260920210000_v5_append_v5_replay_precedes_cas.sql`, which moves the turn
pre-existence lookup ABOVE the CAS guard in `append_turn_atomic_v5` and wraps the
CAS in `IF NOT v_turn_preexisting`. Nothing else changes.

## Why it matters

The deployed function evaluates CAS BEFORE it checks whether the turn already
exists. So replaying an already-committed turn is refused as a stale write
whenever the head has moved on — which is the normal state during exactly the
interruption a replay exists to recover from. **The caller is told its write was
refused. The write committed.** That breaks exactly-once truth, and it fails in
the direction that invites re-applying a change that already landed.

It is reachable at the deployed posture: `p_cas_enforce` is computed as
`rpcMode === 'enforce'` (`supabase-store.ts:1318`) and Render has
`CEE_V5_GRAPH_CAS_RPC=enforce`. `CEE_V5_GRAPH_CAS_MODE=observe` does NOT enter
that expression — it governs only the app-side hook.

## Evidence

**1. The live function is defective — measured twice, independently.**
`pg_get_functiondef`, body sliced after `BEGIN`, `--` comments stripped:

| statement | offset |
|---|---|
| `IF p_cas_enforce` | 1743 |
| `ERRCODE = 'OLGC1'` | 2059 |
| `INTO v_existing_turn_id` (replay lookup) | **2417** |
| `IF NOT v_turn_preexisting` (the fix) | **absent** |

The Core shared-data-layer session reached the same three offsets by a separate
route. Two sessions, two methods, identical numbers.
⛔ An earlier probe in this estate reported the OPPOSITE because it matched
`v_existing_turn_id` in the DECLARE block. Slicing after `BEGIN` is what prevents that.

**2. The ledger says it is not applied.** `supabase_migrations.schema_migrations`
contains `20260824200000`; `20260920210000` and `20260920220000` are both absent.
Newest applied row: `20260918014756`.

**2b. The proof ran against the DEPLOYED function itself, not an approximation.**
The throwaway container's `pg_proc.prosrc` is **byte-identical to live**:

| | live (15.8) | container (15.19) |
|---|---|---|
| `prosrc` md5 | `829c3deb90594099397d64d747f4854e` | `829c3deb90594099397d64d747f4854e` |
| `prosrc` length | 16,299 | 16,299 |
| body length after `BEGIN` | 10,010 | 10,010 |
| CAS / OLGC1 / replay-lookup offsets | 1743 / 2059 / 2417 | 1743 / 2059 / 2417 |

So the RED below is the deployed body failing, not a reconstruction of it. After
the fix the container reports `REPLAY_LOOKUP_BEFORE_CAS` (lookup 1639, CAS 2242,
guard present at 1862). The mutant keeps the lookup moved but drops the guard
(guard absent, md5 differs from both), which is why it is a genuine third state
and not just a re-run of c8.

**3. RED → GREEN → mutant, executed on real PostgreSQL 15** (docker `postgres:15`,
server 15.19; live is 15.8, same major):

| state | result |
|---|---|
| fix applied | **8 passed** |
| rolled back to the deployed c8 body | **5 failed / 3 passed** |
| mutant: fix applied but the `IF NOT v_turn_preexisting` guard deleted | **5 failed / 3 passed** |

The failing assertions at c8 are the right ones, by name: the installed body
looks up the turn before the CAS; replaying a committed turn after the head moved
returns its receipt rather than raising; the write it was told was stale is still
durably there. Controls that must keep passing do: replay identity is still
guarded (a different mutation id is still refused), and a guest scenario still
commits with a NULL receipt.
⚠ The mutant reproduces the same failures as the full rollback. That is expected
here — deleting the guard makes the CAS unconditional again, which is c8's
behaviour — and it is what proves the GUARD, not merely the reordering, does the work.

**4. The change is two hunks and nothing else.** Same 30-argument signature, same
return shape, same grants, `CREATE OR REPLACE` with no DROP, byte-identical CAS
predicate, v4 delegation untouched, MV409/MV422 replay-identity guards intact.
Rollback file present beside it.

## How to apply it

A guarded, ledger-aware runner is ready. Its read-only check has already been run
against live and printed the defective ordering and the absent ledger row.

```bash
# 1. read-only, writes nothing — run this first
node /private/tmp/claude-502/-Users-paulslee-Documents-GitHub/b9b90b64-25c1-4a6a-b2e8-866693c995f7/scratchpad/witness-auth/apply-migration.mjs --check

# 2. the apply (refuses without the flag; Paul only)
MIGRATION_APPLY_APPROVED=1 node /private/tmp/claude-502/-Users-paulslee-Documents-GitHub/b9b90b64-25c1-4a6a-b2e8-866693c995f7/scratchpad/witness-auth/apply-migration.mjs --apply

# rollback, same guard
MIGRATION_APPLY_APPROVED=1 node /private/tmp/claude-502/-Users-paulslee-Documents-GitHub/b9b90b64-25c1-4a6a-b2e8-866693c995f7/scratchpad/witness-auth/apply-migration.mjs --rollback
```

It refuses unless `MIGRATION_APPLY_APPROVED=1`; refuses if the ledger already has
the row; rejects the file if it does not `CREATE OR REPLACE` the expected function
or if it contains a destructive statement; runs inside a transaction; re-measures
the body afterwards and **rolls back automatically** if the post-state ordering is
not `REPLAY_BEFORE_CAS`; and inserts the `schema_migrations` row so the change is
visible to every later "has this landed?" question.

## ⚠ SCOPE CORRECTION — measured live AFTER this ask was first drafted

Applying this migration does **not**, on its own, restore exactly-once for user
mutations. It must not be sold that way.

A live replay test on an owned staging scenario (head confirmed moved between the
write and the replay) returned **409 `GRAPH_DIVERGED`, `conflict_category:
turn_fence_superseded`** — refused by the turn fence, not by the v5 CAS. No
duplicate version was created (5 → 5), so there is no corruption; what is lost is
recovery.

The reason the SQL replay path never engaged is more basic: **the client's
`turn_id` is discarded on handler-routed turns**, which is the path that commits a
model version. Measured with a contrast control in the same query — the draft
turn's client id `0ee1cf2f…` IS stored, while mutation turn `883ed691…` appears
**nowhere** in the table and was stored as `003261ae…` instead. The RPC's replay
lookup keys on that server-minted id, so a client replaying with its own id
presents a key that can never match.

**What the migration still buys, honestly stated:** it fixes a real ordering
defect, proven RED→GREEN against a byte-identical copy of the deployed function,
and it removes a latent trap for every caller that CAN present the same
`p_turn_id` — the server-side and port-level callers, including the
`createApplyOperations` seam the OpenAI lane intends to use. It is worth applying.
It is simply not the whole of exactly-once.

The remaining half — threading the client `turn_id` through the handler path so the
idempotency key is one the client holds — is a separate change, is not in scope
tonight, and is **not** requested here.

## Risk

`append_turn_atomic_v5` is the single production write path for a versioned graph
commit. The CAS predicate is unchanged, so genuinely stale writes are still
refused — proven by control C1. The only behavioural change is that a replay of a
turn that already committed now returns its original receipt instead of raising.
Guest behaviour is unchanged (NULL receipt). Reverting is one command.

⚠ One shared Supabase project serves staging, production and demo, so this is a
production schema change. That is why it is your call and not mine.

## `20260920220000` is NOT requested

It reorders the optional MV409 CAS below the dedupe arm in `create_model_version`
and `restore_model_version` — reached only by `/versions/save` and non-atomic
restore, and only when the caller supplies `expected_graph_identity_hash`. No
current PoC witness path exercises it. Reconsider only if a witness step calls one
of those with an expected hash and a legitimate replay (same mutation id) is
refused MV409 instead of returning `deduped: true`.

## The second approval

Create ONE synthetic auth user at `@olumi-witness.test` so the witness can prove
the versioned chain on an OWNED scenario — guest scenarios never version by
design, so there is no other way to prove that link. Recommend leaving the row in
place rather than deleting it: deletion risks cascading into scenario rows, and
two such accounts already exist among the project's 3,484 synthetic users. The
helper is written and refuses to run without `WITNESS_AUTH_APPROVED=1`; both
endpoints it uses are already verified reachable read-only.
