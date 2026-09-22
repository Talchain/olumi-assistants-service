# Wire-level replay witness — 22 September 2026

**Lane:** AI Coaching / Core correctness.
**Target:** deployed CEE staging, `/healthz` → `build: "9b98fcd"`, `degraded: false`,
`schema_write_version 0.55.0` — i.e. staging head `9b98fcd0a3152b21ad71d97bf3d6f23fbf0afbe7`,
**without** the Gate-1 durable-identity fix.

Everything below was executed this session. Nothing is inferred from comments,
docblocks or a previous document. Where a previous document was contradicted, the
contradiction is named and settled by execution.

---

## 1. Why this witness exists

The predecessor proved replay recovery by calling the durable mechanism **directly**.
That leaves the real path unproven:

```
POST /orchestrate/v2/turn  →  handler routing  →  commit  →  durable replay
```

This is that path, executed.

---

## 2. RESULT — the client's durable turn identity is discarded at the wire

Scenario `21ae5630-56e9-4244-aa66-b300663904f4` (throwaway; graph copied from a live
board so the fixture is capture-derived, not self-authored). Handler `set_factor_value`
on every turn — the handler-routed mutation path, which is exactly the path under test.

| Phase | sent `turn_id` | committed `turn_id` | Δturns | Δversions | `mutation_id` | graph hash after |
|---|---|---|---|---|---|---|
| 1 original | `f2db0d2e…` | **`64c74408…`** | +1 | 0 | `f626b301…` | `c89d81c3498c44f3` |
| 2 retry, **same** `turn_id` | `f2db0d2e…` | **`5cc05e7f…`** | **+1** | 0 | **`78710813…`** | `c89d81c3498c44f3` |
| 3 contrast, **new** `turn_id` | `de0b7e29…` | `e93da445…` | +1 | 0 | `adbf8031…` | `b3d7aa1589a3ef61` |

**The sent identity never appears as a committed `turn_id` in any phase.**

**The retry created a second turn row with a different `mutation_id`.** It is a
genuinely new operation, not a replay of the first.

The contrast control fires: phase 3 moved the graph hash, phase 2 did not. So the probe
distinguishes a real mutation from a no-op, and phase 2's flat hash is a property of the
retry, not of a blind probe.

### Acceptance contract, scored

| Criterion | Result |
|---|---|
| original mutation commits | **PASS** |
| retry creates no second turn | **FAIL** (+1) |
| retry creates no new version | PASS — but vacuous here, see §5 |
| retry recovers the original receipt | **NOT OBSERVABLE** — see §5 |
| a genuinely new operation still acts | fired correctly |

---

## 3. CORRECTION — the failure mode is NOT a 409

The handover describes the symptom as a **409 / stale graph write**. At the wire it is
not. The retry returned:

```
HTTP 200 — "Sales Cycle Length is already set to 14 months."
```

So a client that loses its response and retries is **told a different story**, receives a
**different `mutation_id`**, and **a phantom duplicate turn is written into the user's
conversation history**. No error is raised at any layer.

This matters for how the fix is judged: *"no duplicate occurred"* could never have been
the acceptance test, because the observable failure is silent divergence rather than a
refusal. It also means the defect is **worse** than a 409, not milder — a 409 at least
tells the client something went wrong.

---

## 4. Persistence and the fence are BOTH correct — do not reopen them

Read from the live database with `pg_get_functiondef`.

### `append_turn_atomic_v5` decides replay BEFORE CAS

- replay lookup: lines 82–86 (`SELECT id, model_version_mutation_id, model_version_created
  INTO … WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id; v_turn_preexisting := FOUND;`)
- `IF NOT v_turn_preexisting THEN` opens at line **92**
- the `OLGC1` stale-write raise sits at line **168**
- `END IF` closes that block at line **176**

The CAS raise is **nested inside** the not-preexisting branch, so a replay skips CAS entirely.

> ⚠ **This supersedes a 21 September measurement** recorded as *"deployed
> `append_turn_atomic_v5` puts CAS before the replay check; fix written, NOT deployed."*
> That is now stale — the migration is deployed. The two documents contradicted each
> other, so this was re-derived from the deployed function text rather than resolved by
> preferring the more recent one.

### `v5_claim_turn_fence` is idempotent on a duplicate `turn_id`

```sql
INSERT INTO public.v5_turn_fence (scenario_id, turn_id)
VALUES (p_scenario_id, p_turn_id)
ON CONFLICT (scenario_id, turn_id) DO UPDATE
  SET scenario_id = public.v5_turn_fence.scenario_id
RETURNING generation;
```

A no-op update returning the **existing** generation. So a retry is **not superseded by
its own original**. And if another turn did intervene, the `superseded` branch in
`supabase-store.ts` routes to `tryFirstWriteExemptRecovery`, which recovers as well.

**Both recovery routes are intact. The only missing piece is the durable identity —
exactly what PR #1677 supplies.**

---

## 5. BLOCKER — the receipt half is unreachable from any key-authed harness

The acceptance contract requires recovering *the same authoritative receipt / `version_id`*.
Two independently verified facts make that unreachable without a signed-in user:

1. **A guest scenario mints no receipt at all.**
   Deployed `append_turn_atomic_v5` line 66: `v_should_create := v_user_id IS NOT NULL`,
   and line 217 returns early when `v_user_id IS NULL`.
   Witnessed: `model_version_created = false` and `versions = 0` on every turn in §2.
   **This is why the "no new version" PASS above is vacuous** — no version could have been
   created either way. Recording it as a pass without this note would be a false green.

2. **A key-authed caller may not act on an OWNED scenario.**
   `resolveOwnershipAuthority` refuses a shared-key caller's asserted identity by design
   (the IDOR fix); a body `user_id` is discarded. Executed: HTTP **422**
   `INGRESS_CONTRACT_VIOLATION`, `validator: scenario_preflight`,
   `reason: scenario_requires_authenticated_owner`. Identity is derived **only** from a
   verified `Authorization: Bearer <Supabase JWT>` (`user-identity.ts` reads that header
   and nothing else).

**Consequence:** the receipt half can only be witnessed through a signed-in session — a
dedicated staging test account, or a UI-driven witness. No auth user was created in the
shared production project, because that is a production auth-surface change and is not
this lane's to authorise. Raised on programme issue #63.

---

## 6. Side finding — a user is refused for typing the unit the product displays

Same deployed build, live factor rendered by the UI as **"9 months"**:

| message | outcome |
|---|---|
| `change Sales Cycle Length to 14` | **Updated** 9 months → 14 months |
| `change Sales Cycle Length to 12 months` | **REFUSED** — *"This factor uses months; the value provided is in month."* |
| `change Sales Cycle Length to 14 month` | **REFUSED** — same |

CQE normalises the period to the singular `month`; the canonical unit is the plural
`months`; `unitComparisonKey` folded neither into the other.

PR #1678's first commit did **not** close this — its fold is reached only when a rate
separator is present; a bare unit fell through to a currency-alphabet-and-case fold.
Fixed in that PR's second commit `99b2826642c78e0e7e3a94bd8cb8b374a1caac9e`, using the
closed period table the branch already introduced.

---

## 7. How to re-run this witness after #1677 deploys

The harness is `witness.mjs` (scratchpad, reproduced in this repo's history via this
document's method section). It needs:

- `ASSIST_API_KEY` and `SUPABASE_DB_PASSWORD` from `olumi-assistants-service/.env.staging.local`;
- the Supabase pooler at `aws-0-us-east-1.pooler.supabase.com:5432`, user `postgres.<project-ref>`
  (⚠ `eu-west-1` and `eu-west-2` both answer `Tenant or user not found` — only `us-east-1` resolves);
- ingress body: `{ kind, turn_id, scenario_id, stage, message, turn_class, source }` with
  `turn_class ∈ { frame, clarify, propose, decide, review }` — **`edit` is rejected**, and
  the `handler` class seen in `v5_conversation_turns` is the *committed* class, not an
  ingress value;
- auth header `x-olumi-assist-key`.

**Expected GREEN after #1677 deploys:** phase 2's committed `turn_id` equals the sent
`turn_id`, Δturns = 0, and the same `mutation_id` comes back. **Phase 3 must still fire** —
if it stops firing, the fix has broken ordinary mutation, and that control is what would
catch it.

Until the §5 blocker is resolved, a GREEN run proves turn identity and no-duplicate, but
**not** receipt recovery. Do not report it as the full acceptance contract.
