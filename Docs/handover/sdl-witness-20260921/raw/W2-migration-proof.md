# W2 — `append_turn_atomic_v5` replay-precedes-CAS: executable RED→GREEN proof

**Lane A, Olumi Shared Data Layer.** Everything below was measured in this run.
Repo tip asserted `HEAD = e717e19d05542a80254ea056aa95a59c2cde4053` (40 chars),
branch `staging`, fresh blobless clone at
`/private/tmp/claude-502/-Users-paulslee-Documents-GitHub/b9b90b64-25c1-4a6a-b2e8-866693c995f7/scratchpad/lane-a`.

**Verdict: PROVEN.** The migration fixes a live, reachable defect. RED at the
deployed body, GREEN after the fix, and a discriminating mutant that flips it
back to RED. Nothing was written to the live database by this lane — every live
reading below was taken inside `set transaction read only`.

---

## ⚠ STATE CHANGE MID-RUN — 20260920210000 IS NOW APPLIED TO THE LIVE PROJECT

**This is no longer a pre-approval artefact. It is a post-hoc validation.**
Measured, not inferred:

| `date -u` | live `md5(prosrc)` of `append_turn_atomic_v5` | ledger has `20260920210000` |
|---|---|---|
| 2026-09-21 22:46:26Z | `829c3deb90594099397d64d747f4854e` (defective) | **no** (`new_ones: 0`, max version `20260918014756`) |
| 2026-09-21 23:11:19Z | `829c3deb90594099397d64d747f4854e` (defective) | **no** (`new_ones: 0`) |
| 2026-09-21 23:20:10Z | **`7b78d8e12550628570e15b2b739c2d4d` (fixed)** | **yes** (`new_ones: 1`, max version `20260920210000`) |

So it was applied between **23:11:19Z and 23:20:07Z**.

**It was not applied by this lane.** Every live connection this lane opened ran
`set transaction read only` first. The one script that can write —
`scripts/apply-migration-20260920210000.mjs` — was run in DRY RUN at 23:20:07Z
and aborted at its first pre-check with *"ABORT: ledger already carries
20260920210000"*, i.e. the row was already there when it started, and it throws
before it ever reaches `tx.unsafe(migrationSql)`.

**Who applied it: UNVERIFIED.** The ledger row carries `created_by = NULL`,
while all five 2026-09-18 rows carry `paulsleepm@gmail.com` — consistent with a
direct `postgres` connection using the `wave0-apply-migration.mjs` pattern
rather than the Supabase dashboard. A peer lane in this same session had
prepared `evidence/ASK-PAUL-migration-20260920210000.md` at 22:57:05Z asking for
exactly this approval. What would settle it: the Supabase project's own audit
log, or asking whoever ran it.

**What this proof is now worth, and it is worth more, not less.** The live body
is now `7b78d8e12550628570e15b2b739c2d4d`, `prosrc_len 17372`, with offsets
`lookup 1639 · guard 1862 · cas 2242 · olgc1 2572` — **byte-identical, and
offset-identical, to the container state the 8 tests below pass against.** The
GREEN result in §4 is therefore not a prediction about what the live function
would do; it is a measurement of what the live function *does*. Equally, the RED
result in §3 was taken against a body byte-identical to what was live 25 minutes
earlier, so the defect it demonstrates was real in production, not hypothetical.

**Unchanged by that apply:** live `proacl` is still
`{postgres=X/postgres,service_role=X/postgres}`, `prosecdef` still true,
`pronargs` still 30. The ledger's `statements` array holds 23,270 characters —
exactly the codepoint count of
`supabase/migrations/20260920210000_v5_append_v5_replay_precedes_cas.sql`
(23,384 bytes, 23,270 codepoints), so the ledger carries *this* file, not a
variant.

---

## 0. What the defect is, in one sentence

`public.append_turn_atomic_v5` evaluates its CAS guard **before** it looks up
whether the turn already exists, so replaying an already-committed turn raises
`OLGC1` "stale graph write" whenever the head has moved on — telling the caller
its write was refused when the write **committed**.

---

## 1. The code-only diff: 20260920210000 vs the c8 body

`supabase/migrations/20260920210000_v5_append_v5_replay_precedes_cas.sql:67-488`
against `supabase/migrations/20260824200000_c8_atomic_model_version_restore.sql:515-920`,
with `--` comment lines and blank lines stripped from both. 302 code lines
before, 304 after.

> **Correction to the brief.** The brief expected *two* hunks. With comments
> stripped it is **ONE hunk** — a move plus a wrap. Reported as measured.

```diff
--- ../evidence/c8-v5-code.sql	2026-09-21 23:45:50
+++ ../evidence/fix-v5-code.sql	2026-09-21 23:45:50
@@ -91,25 +91,27 @@
   END IF;
   v_should_create := v_user_id IS NOT NULL
     AND v_current_hash IS DISTINCT FROM p_incoming_graph_identity_hash;
-  IF p_cas_enforce
-     AND p_expected_base_known
-     AND v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash
-     AND p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash
-     AND NOT (v_current_hash IS NULL AND p_expected_graph_identity_hash IS NOT NULL)
-  THEN
-    RAISE EXCEPTION USING
-      ERRCODE = 'OLGC1',
-      MESSAGE = format(
-        'append_turn_atomic_v5: stale graph write for scenario %s (expected %s, current %s)',
-        p_scenario_id,
-        COALESCE(p_expected_graph_identity_hash, '<absent>'),
-        COALESCE(v_current_hash, '<absent>'));
-  END IF;
   SELECT id, model_version_mutation_id, model_version_created
     INTO v_existing_turn_id, v_turn_version_mutation_id, v_turn_version_created
     FROM public.v5_conversation_turns
     WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
   v_turn_preexisting := FOUND;
+  IF NOT v_turn_preexisting THEN
+    IF p_cas_enforce
+       AND p_expected_base_known
+       AND v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash
+       AND p_incoming_graph_identity_hash IS DISTINCT FROM v_current_hash
+       AND NOT (v_current_hash IS NULL AND p_expected_graph_identity_hash IS NOT NULL)
+    THEN
+      RAISE EXCEPTION USING
+        ERRCODE = 'OLGC1',
+        MESSAGE = format(
+          'append_turn_atomic_v5: stale graph write for scenario %s (expected %s, current %s)',
+          p_scenario_id,
+          COALESCE(p_expected_graph_identity_hash, '<absent>'),
+          COALESCE(v_current_hash, '<absent>'));
+    END IF;
+  END IF;
   v_turn_id := public.append_turn_atomic_v4(
     p_scenario_id,
     p_turn_id,
```

**What that hunk does:** moves the `INTO v_existing_turn_id` pre-existence lookup
above the CAS block and wraps the CAS in `IF NOT v_turn_preexisting THEN`. The
CAS predicate's five conjuncts and the `RAISE EXCEPTION USING ERRCODE = 'OLGC1'`
are byte-identical — only the indentation changed.

### The four "did it change anything else" checks

| Check | Result | How |
|---|---|---|
| Identical signature | **YES** — all 30 parameters, same names, same types, same `p_expected_base_known BOOLEAN DEFAULT FALSE` | `diff` of `:515-578` vs `:67-130`, no differences |
| Identical return shape + DECLARE | **YES** — `RETURNS JSONB`, `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = pg_catalog, public`, and all 21 declared locals identical | same diff |
| Identical grants | **YES** — the same `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` and `GRANT EXECUTE … TO service_role`, same 30-type argument list | `diff` of the two tail blocks: no differences |
| `CREATE OR REPLACE`, no `DROP` | **YES** — `grep -a "DROP"` over the whole fix file returns **0 matches**; the `CREATE OR REPLACE FUNCTION` is at `:67`. Contrast control: `GRANT`/`REVOKE` grep over the same file returns 2 matches, so the probe is not blind | `grep -an` |
| Rollback file present | **YES** — `supabase/migrations/rollback/20260920210000_v5_append_v5_replay_precedes_cas_rollback.sql.do-not-apply`, 417 lines, `CREATE OR REPLACE` at `:12`, `REVOKE`/`GRANT` at `:407`/`:413`, no `DROP` | `ls` + `grep -an` |

**The ACL does not move.** Live `append_turn_atomic_v5` carries
`proacl = {postgres=X/postgres,service_role=X/postgres}`, `prosecdef = true`,
`pronargs = 30`. After applying the fix, the container carries **exactly the
same three values**. Measured, not inferred.

---

## 2. Fidelity control: the container IS the deployed function

This is the control that makes every later result mean anything.

**LIVE** (`pg_get_functiondef`, `--` comments stripped, offsets from the body's `\nBEGIN`, read-only transaction):

```json
{
  "at": "2026-09-21T22:46:26.308Z",
  "version": "PostgreSQL 15.8 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 13.2.0, 64-bit",
  "prosrc_md5": "829c3deb90594099397d64d747f4854e",
  "prosrc_len": 16299,
  "body_len": 10010,
  "offsets": {
    "IF p_cas_enforce": 1743,
    "ERRCODE = 'OLGC1'": 2059,
    "INTO v_existing_turn_id": 2417,
    "IF NOT v_turn_preexisting THEN": -1,
    "ERRCODE = 'MV422'": 3505,
    "append_turn_atomic_v4(": 2660
  },
  "ordering": "CAS_BEFORE_REPLAY_LOOKUP"
}
```

**CONTAINER** after loading the repo's migrations (postgres:15.19, the two
2026-09-20 migrations deliberately held back):

```json
{
  "at": "2026-09-21T22:47:12.035Z",
  "version": "PostgreSQL 15.19 (Debian 15.19-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit",
  "prosrc_md5": "829c3deb90594099397d64d747f4854e",
  "prosrc_len": 16299,
  "body_len": 10010,
  "offsets": {
    "IF p_cas_enforce": 1743,
    "ERRCODE = 'OLGC1'": 2059,
    "INTO v_existing_turn_id": 2417,
    "IF NOT v_turn_preexisting THEN": -1,
    "ERRCODE = 'MV422'": 3505,
    "append_turn_atomic_v4(": 2660
  },
  "ordering": "CAS_BEFORE_REPLAY_LOOKUP"
}
```

**`prosrc_md5` is identical — `829c3deb90594099397d64d747f4854e` — as are
`prosrc_len` (16299) and every one of the six byte offsets.** The fixture is not
merely *ordered like* the deployed function; it **is** the deployed function,
byte for byte. The live server is PostgreSQL **15.8**, the container **15.19** —
same major version, different patch; the function body is identical so the
difference is immaterial to this proof, and it is stated rather than hidden.

The three offsets the brief predicted are reproduced exactly:
`IF p_cas_enforce` **1743** · `ERRCODE = 'OLGC1'` **2059** ·
`INTO v_existing_turn_id` **2417**. CAS at 1743 precedes the replay lookup at
2417.

**Contrast control on the absence claim.** `IF NOT v_turn_preexisting THEN` is
**absent** (offset `-1`) from the live body. In the SAME probe,
`ERRCODE = 'MV422'` — a same-family marker from the same function — is
**present at 3505**, and `append_turn_atomic_v4(` at **2660**. Target zero,
contrast non-zero.

### Which migrations loaded, and which did not

`26 applied, 3 failed, 2 deliberately skipped` (the two 2026-09-20 files).

| File | Why it failed |
|---|---|
| `20260226010000_scenario_schema_v2_0_1_hardening.sql` | `ERROR: relation "shared_briefs" does not exist` — a table that predates `supabase/migrations/`, exactly as `README-c4-local-db.md` records |
| `20260610120000_v5_db_security_tier1_hardening.sql` | `ERROR: relation "public.turn_observations" does not exist` — same class, same README |
| `20260918120000_v5_store_brief_and_provenance.sql` | `ERROR: relation "public.shared_briefs" does not exist` — same missing table. **Also absent from the live ledger** (live max version is `20260918014756`), so the container and the live database agree about it |

None is on the canonical-state path, and the md5 identity above proves the
omissions did not touch the function under test. The README predicted "26 of 28";
this run measured **26 applied + 3 failed + 2 deliberately skipped = 31** `.sql`
files in `supabase/migrations/` — the extra failure is the one new file added
since the README was written (`20260918120000`).

**`mutation_id` column-type collision check** (the README says this is not
optional): `model_versions.mutation_id` is `uuid` in the container. Confirmed.

---

## 3. RED at c8 — the deployed body refuses a committed write

Owned scenario (`scenarios.user_id NOT NULL`). Nothing hand-seeded: every hash
below is one the function itself stamped.

* `T0` establishes the graph → `H0`
* `T1` (expected `H0`, incoming `H1`) → succeeds, mints version `M1`, returns a receipt
* `T2` (expected `H1`, incoming `H2`) → succeeds, head moves to `H2`
* **REPLAY of `T1`** with byte-identical arguments (expected `H0`, incoming `H1`, current `H2`)

```
PHASE RED-at-c8   at 2026-09-21T22:50:23.238Z   prosrc_md5=829c3deb90594099397d64d747f4854e  len=16299
OK    OWNED T0 first write (expected NULL, incoming H0)   receipt_is_null=false
OK    OWNED T1 (expected H0, incoming H1) — the turn we will replay   receipt_is_null=false
OK    OWNED T2 (expected H1, incoming H2) — head moves on   receipt_is_null=false
RAISE REPLAY of T1 — byte-identical args to T1 (expected H0, incoming H1, current H2)   SQLSTATE=OLGC1  append_turn_atomic_v5: stale graph write for scenario 456d0620-da8e-4480-9b0c-6d7be49a5f73 (expected df829492c5a91985f8a2a2ebba572e398d6e055a206f835f6dd6e4b5847d92b7, current 351b39cf67ea10366f88107783296e15d67bfa41901dc79ee37509d61fa056b8)
RAISE C1 STALE NEW turn T3 (fresh turn_id, expected H0, current H2)   SQLSTATE=OLGC1  append_turn_atomic_v5: stale graph write for scenario 456d0620-da8e-4480-9b0c-6d7be49a5f73 (expected df829492c5a91985f8a2a2ebba572e398d6e055a206f835f6dd6e4b5847d92b7, current 351b39cf67ea10366f88107783296e15d67bfa41901dc79ee37509d61fa056b8)
RAISE C2 REPLAY of T1 with a DIFFERENT mutation id   SQLSTATE=OLGC1  append_turn_atomic_v5: stale graph write for scenario 456d0620-da8e-4480-9b0c-6d7be49a5f73 (expected df829492c5a91985f8a2a2ebba572e398d6e055a206f835f6dd6e4b5847d92b7, current 351b39cf67ea10366f88107783296e15d67bfa41901dc79ee37509d61fa056b8)
OK    C3 GUEST GT0 first write   receipt_is_null=true
OK    C3 GUEST GT1 (the turn we replay)   receipt_is_null=true
OK    C3 GUEST GT2 — head moves on   receipt_is_null=true
RAISE C3 GUEST REPLAY of GT1   SQLSTATE=OLGC1  append_turn_atomic_v5: stale graph write for scenario de62d299-aac0-42de-a581-aa504c564560 (expected b5af4b28251d5905ad5aeaf2fff5be05dbcede5ec0c870af85a5ab855a202edc, current 3742a2598e669a88d05a4648074673cb4cc7bb5d52a3debea59ab8a971e40a7b)
OK    C5 FIRST-WRITE exemption: current hash NULL, expected NON-NULL, base_known   receipt_is_null=false
--- controls ---
state_before_replay      {"mv":3,"ct":3,"hash":"351b39cf67ea10366f88107783296e15d67bfa41901dc79ee37509d61fa056b8"}
durability_after_replay  {"turn_t1":1,"version_m1":1,"mv_total":3,"ct_total":3}
counts_unchanged         true
receipt_deep_equal_to_T1 undefined
turn_row_id_equal_to_T1  undefined
C1 raised_OLGC1          true   (OLGC1)
C2 raised_MV422          false   (OLGC1)
C3 guest                 write_committed=true write_receipt_null=true replay_ok=false replay_receipt_null=null guest_model_versions=0
C5 first-write not_refused true   (accepted)
```

**The RED assertion, both limbs:**

1. The replay raises **`SQLSTATE OLGC1`** —
   `append_turn_atomic_v5: stale graph write for scenario … (expected df829492…, current 351b39cf…)`
2. A direct `SELECT` in the same run proves the write is **durably there**:
   `turn_t1 = 1` and `version_m1 = 1`. Totals unchanged: `mv_total 3`, `ct_total 3`.

So the caller is told "stale" about a turn row and a model version that both
exist. That is the defect, executed.

The guest arm reproduces it too (`C3 GUEST REPLAY of GT1` → `OLGC1`), and `C2`
returns `OLGC1` where the replay-identity guard `MV422` should have spoken —
because the CAS fires before the code that would raise it.

---

## 4. GREEN after 20260920210000

Applied **only** `20260920210000` to the throwaway database
(`CREATE OR REPLACE`, same signature; apply exit 0), data reset, same script
re-run. Installed body ordering afterwards:

```json
{
  "at": "2026-09-21T22:50:33.512Z",
  "version": "PostgreSQL 15.19 (Debian 15.19-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit",
  "prosrc_md5": "7b78d8e12550628570e15b2b739c2d4d",
  "prosrc_len": 17372,
  "body_len": 10259,
  "offsets": {
    "IF p_cas_enforce": 2242,
    "ERRCODE = 'OLGC1'": 2572,
    "INTO v_existing_turn_id": 1639,
    "IF NOT v_turn_preexisting THEN": 1862,
    "ERRCODE = 'MV422'": 3754,
    "append_turn_atomic_v4(": 2909
  },
  "ordering": "REPLAY_LOOKUP_BEFORE_CAS"
}
```

The lookup has moved to **1639**, ahead of the CAS at **2242**, and the guard
`IF NOT v_turn_preexisting THEN` is present at **1862** — between them, as it
must be.

```
PHASE GREEN-after-20260920210000   at 2026-09-21T22:50:38.445Z   prosrc_md5=7b78d8e12550628570e15b2b739c2d4d  len=17372
OK    OWNED T0 first write (expected NULL, incoming H0)   receipt_is_null=false
OK    OWNED T1 (expected H0, incoming H1) — the turn we will replay   receipt_is_null=false
OK    OWNED T2 (expected H1, incoming H2) — head moves on   receipt_is_null=false
OK    REPLAY of T1 — byte-identical args to T1 (expected H0, incoming H1, current H2)   receipt_is_null=false
RAISE C1 STALE NEW turn T3 (fresh turn_id, expected H0, current H2)   SQLSTATE=OLGC1  append_turn_atomic_v5: stale graph write for scenario 2e62ca7f-ba63-4d2d-838e-8f2a8e207613 (expected df829492c5a91985f8a2a2ebba572e398d6e055a206f835f6dd6e4b5847d92b7, current 351b39cf67ea10366f88107783296e15d67bfa41901dc79ee37509d61fa056b8)
RAISE C2 REPLAY of T1 with a DIFFERENT mutation id   SQLSTATE=MV422  append_turn_atomic_v5: turn replay reused with another mutation id
OK    C3 GUEST GT0 first write   receipt_is_null=true
OK    C3 GUEST GT1 (the turn we replay)   receipt_is_null=true
OK    C3 GUEST GT2 — head moves on   receipt_is_null=true
OK    C3 GUEST REPLAY of GT1   receipt_is_null=true
OK    C5 FIRST-WRITE exemption: current hash NULL, expected NON-NULL, base_known   receipt_is_null=false
--- controls ---
state_before_replay      {"mv":3,"ct":3,"hash":"351b39cf67ea10366f88107783296e15d67bfa41901dc79ee37509d61fa056b8"}
durability_after_replay  {"turn_t1":1,"version_m1":1,"mv_total":3,"ct_total":3}
counts_unchanged         true
receipt_deep_equal_to_T1 true
turn_row_id_equal_to_T1  true
C1 raised_OLGC1          true   (OLGC1)
C2 raised_MV422          true   (MV422)
C3 guest                 write_committed=true write_receipt_null=true replay_ok=true replay_receipt_null=true guest_model_versions=0
C5 first-write not_refused true   (accepted)
```

**Every assertion the brief asked for:**

| Assertion | Result |
|---|---|
| The replay raises nothing | **PASS** — `OK REPLAY of T1 …` |
| The receipt is byte-identical to turn 1's (deep JSON equality) | **PASS** — `receipt_deep_equal_to_T1 true` |
| Same `turn_row_id` | **PASS** — `turn_row_id_equal_to_T1 true` |
| `count(model_versions)` for the scenario unchanged | **PASS** — 3 → 3 |
| `count(v5_conversation_turns)` unchanged | **PASS** — 3 → 3 |

---

## 5. The five controls, each separately

| # | Control | Deployed c8 | After the fix | Discriminates? |
|---|---|---|---|---|
| **C1** | A genuinely STALE NEW turn (`T3`, fresh turn_id, expected `H0`, head `H2`) | `OLGC1` | **`OLGC1`** | The CAS is not disabled |
| **C2** | Replay of `T1` carrying a DIFFERENT mutation id | `OLGC1` (wrong guard speaks) | **`MV422`** | Replay identity still refused, now by the right guard |
| **C3** | GUEST scenario (`user_id IS NULL`) | write commits with `receipt = NULL`; **replay raises `OLGC1`** | write commits with `receipt = NULL`; **replay returns `NULL` receipt, no raise**; `model_versions` for the scenario = **0** | Guest path fixed, still mints nothing |
| **C4** | **MUTANT** — the fixed body with ONLY `IF NOT v_turn_preexisting THEN` deleted, the moved lookup KEPT | — | **RED again** | See below |
| **C5** | First-write exemption: current hash NULL, expected NON-NULL, `base_known` | accepted | **accepted** | Unchanged in both directions |

### C4 in full — the mutant binds the pins to the GUARD, not to the move

Built by deleting exactly two lines from the fix file (`:193` the guard open,
`:277` its `END IF`); line delta **2**. Verified landed three ways:

* `grep -ac 'IF NOT v_turn_preexisting THEN'` → fix **1**, mutant **0**
* contrast control in the same grep: `INTO v_existing_turn_id` → mutant **1** (the move is still there)
* installed `md5(prosrc)` → **`5346f5e7f92b2202ade713035f53e65c`**, distinct from both `829c3deb…` and `7b78d8e1…`

```json
{
  "at": "2026-09-21T22:51:04.718Z",
  "version": "PostgreSQL 15.19 (Debian 15.19-1.pgdg13+2) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit",
  "prosrc_md5": "5346f5e7f92b2202ade713035f53e65c",
  "prosrc_len": 17329,
  "body_len": 10216,
  "offsets": {
    "IF p_cas_enforce": 2209,
    "ERRCODE = 'OLGC1'": 2539,
    "INTO v_existing_turn_id": 1639,
    "IF NOT v_turn_preexisting THEN": -1,
    "ERRCODE = 'MV422'": 3711,
    "append_turn_atomic_v4(": 2866
  },
  "ordering": "REPLAY_LOOKUP_BEFORE_CAS"
}
```

Note the mutant still reports `REPLAY_LOOKUP_BEFORE_CAS` (lookup 1639 < CAS
2209) — **the statement move alone does not fix anything.** And the result:

```
PHASE C4-MUTANT-guard-removed   at 2026-09-21T22:51:04.887Z   prosrc_md5=5346f5e7f92b2202ade713035f53e65c  len=17329
OK    OWNED T0 first write (expected NULL, incoming H0)   receipt_is_null=false
OK    OWNED T1 (expected H0, incoming H1) — the turn we will replay   receipt_is_null=false
OK    OWNED T2 (expected H1, incoming H2) — head moves on   receipt_is_null=false
RAISE REPLAY of T1 — byte-identical args to T1 (expected H0, incoming H1, current H2)   SQLSTATE=OLGC1  append_turn_atomic_v5: stale graph write for scenario 9e7818b6-987d-4853-a5b5-a36f7ba466bf (expected df829492c5a91985f8a2a2ebba572e398d6e055a206f835f6dd6e4b5847d92b7, current 351b39cf67ea10366f88107783296e15d67bfa41901dc79ee37509d61fa056b8)
RAISE C1 STALE NEW turn T3 (fresh turn_id, expected H0, current H2)   SQLSTATE=OLGC1  append_turn_atomic_v5: stale graph write for scenario 9e7818b6-987d-4853-a5b5-a36f7ba466bf (expected df829492c5a91985f8a2a2ebba572e398d6e055a206f835f6dd6e4b5847d92b7, current 351b39cf67ea10366f88107783296e15d67bfa41901dc79ee37509d61fa056b8)
RAISE C2 REPLAY of T1 with a DIFFERENT mutation id   SQLSTATE=OLGC1  append_turn_atomic_v5: stale graph write for scenario 9e7818b6-987d-4853-a5b5-a36f7ba466bf (expected df829492c5a91985f8a2a2ebba572e398d6e055a206f835f6dd6e4b5847d92b7, current 351b39cf67ea10366f88107783296e15d67bfa41901dc79ee37509d61fa056b8)
OK    C3 GUEST GT0 first write   receipt_is_null=true
OK    C3 GUEST GT1 (the turn we replay)   receipt_is_null=true
OK    C3 GUEST GT2 — head moves on   receipt_is_null=true
RAISE C3 GUEST REPLAY of GT1   SQLSTATE=OLGC1  append_turn_atomic_v5: stale graph write for scenario 9f76a70c-9117-4030-85f6-3cf5203c29f8 (expected b5af4b28251d5905ad5aeaf2fff5be05dbcede5ec0c870af85a5ab855a202edc, current 3742a2598e669a88d05a4648074673cb4cc7bb5d52a3debea59ab8a971e40a7b)
OK    C5 FIRST-WRITE exemption: current hash NULL, expected NON-NULL, base_known   receipt_is_null=false
--- controls ---
state_before_replay      {"mv":3,"ct":3,"hash":"351b39cf67ea10366f88107783296e15d67bfa41901dc79ee37509d61fa056b8"}
durability_after_replay  {"turn_t1":1,"version_m1":1,"mv_total":3,"ct_total":3}
counts_unchanged         true
receipt_deep_equal_to_T1 undefined
turn_row_id_equal_to_T1  undefined
C1 raised_OLGC1          true   (OLGC1)
C2 raised_MV422          false   (OLGC1)
C3 guest                 write_committed=true write_receipt_null=true replay_ok=false replay_receipt_null=null guest_model_versions=0
C5 first-write not_refused true   (accepted)
```

RED on the replay, RED on C2, RED on the guest replay. A test that passed here
would be measuring the move, not the fix.

**Restored.** Re-applying `20260920210000` returns the installed md5 to
`7b78d8e12550628570e15b2b739c2d4d` and the whole matrix to GREEN.

**The rollback is exact.** Applying
`rollback/20260920210000_…_rollback.sql.do-not-apply` returns the installed
`md5(prosrc)` to **`829c3deb90594099397d64d747f4854e`** — byte-identical to the
LIVE function. The rollback is not "approximately the old body"; it is the old
body.

---

## 6. Reachability of the defect on the deployed estate

`p_cas_enforce` is computed as `rpcMode === 'enforce'` at
`src/orchestrator-v5/session/supabase-store.ts:1318` (and at `:19`, `:398`,
`:1134` on the sibling paths). Render, fully paginated (the first
unpaginated page of 100 wrongly reported `CEE_V5_GRAPH_CAS_RPC` as absent from
`cee-production` — it is on page 2):

```json
{
  "at": "2026-09-21T23:10:28.736Z",
  "out": {
    "cee-staging": {
      "pages": 2,
      "total_env_vars": 121,
      "CEE_MODEL_VERSIONS_ENABLED": "true",
      "CEE_V5_GRAPH_CAS_RPC": "enforce",
      "CEE_V5_GRAPH_CAS_MODE": "observe",
      "SUPABASE_URL": "<ref etmm… len 40>"
    },
    "cee-production": {
      "pages": 2,
      "total_env_vars": 118,
      "SUPABASE_URL": "<ref etmm… len 40>",
      "CEE_V5_GRAPH_CAS_MODE": "observe",
      "CEE_V5_GRAPH_CAS_RPC": "enforce",
      "CEE_MODEL_VERSIONS_ENABLED": "true"
    },
    "cee-demo": {
      "pages": 2,
      "total_env_vars": 114,
      "SUPABASE_URL": "<ref etmm… len 40>",
      "CEE_V5_GRAPH_CAS_MODE": "observe",
      "CEE_MODEL_VERSIONS_ENABLED": "true",
      "CEE_V5_GRAPH_CAS_RPC": "enforce"
    }
  }
}
```

**All three CEE services — staging, production and demo — run
`CEE_V5_GRAPH_CAS_RPC=enforce` and `CEE_MODEL_VERSIONS_ENABLED=true`, against
the same Supabase project ref.** So `p_cas_enforce` is `true` on every
graph-bearing v5 turn everywhere, and the defect is reachable everywhere.

**Live migration ledger** (read-only):

```json
{
  "at": "2026-09-21T22:46:40.590Z",
  "total": 137,
  "latest12": [
    "20260918014756",
    "20260918002353",
    "20260918002117",
    "20260918000833",
    "20260918000431",
    "20260917235921",
    "20260824200000",
    "20260808155216",
    "20260802120000",
    "20260731130000",
    "20260731120000",
    "20260717120000"
  ],
  "tables": {
    "a": "v5_conversation_turns",
    "b": "model_versions",
    "c2": "v5_handler_facts",
    "d": "v5_turn_fence"
  }
}
```

`20260824200000` present · `20260920210000` and `20260920220000` **absent**
(`new_ones: 0`; live max version is `20260918014756`, so nothing at or after
2026-09-20 can be present) · 137 rows total.

---

## 7. The ask — the exact commands for Paul

⛔ **One Supabase project serves staging, production AND demo.** Applying this
IS a production schema change.

**⚠ READ §0 FIRST: `20260920210000` is ALREADY APPLIED.** The forward command
below is kept because it is the right command and because the script's
pre-checks are the audit — run in DRY RUN it now reports
*"ledger already carries 20260920210000"* and refuses, which is itself a
confirmation. **The command Paul may actually need is the ROLLBACK.**

A ledger-aware apply script is committed alongside this proof:
`scripts/apply-migration-20260920210000.mjs`. It follows
`scripts/wave0-apply-migration.mjs` (which DOES write
`supabase_migrations.schema_migrations`); `scripts/run-sql-migration.ts` does
**not** write the ledger and must not be used here.

From the repo root, with `.env.staging.local` present:

```bash
# 1. dry run — checks the ledger and pins the installed body to md5 829c3deb…,
#    then aborts without writing. RUN AT 23:20:07Z: aborted with
#    "ABORT: ledger already carries 20260920210000" — i.e. already applied.
node scripts/apply-migration-20260920210000.mjs

# 2. apply. ONE transaction: pre-checks → apply → INSERT the ledger row →
#    post-check md5 / arity / SECURITY DEFINER / ACL / statement order.
#    Any mismatch rolls the whole thing back. NO LONGER NEEDED — see §0.
node scripts/apply-migration-20260920210000.mjs --apply
```

**Rollback — this is the live one now.** It restores 20260824200000's body
verbatim (proven in §5 to return the installed md5 to `829c3deb…` exactly) and
**removes** the ledger row, so the ledger never claims a migration that is not
installed. Its pre-check requires the installed md5 to be `7b78d8e1…`, which is
what is live right now:

```bash
node scripts/apply-migration-20260920210000.mjs --rollback --apply
```

The script's own safety rails, all inside the transaction:

* refuses if the ledger already carries `20260920210000`
* refuses unless the **currently installed** `md5(prosrc)` is
  `829c3deb90594099397d64d747f4854e` — i.e. refuses to overwrite a body it has
  not seen
* after applying, requires `md5 = 7b78d8e12550628570e15b2b739c2d4d`, unchanged
  arity (30), unchanged `SECURITY DEFINER`, unchanged `proacl`, and
  `lookup < cas` with the guard present — measured on the comment-stripped body
  sliced after `BEGIN`, never by a regex a `DECLARE` block could satisfy
* connects on port **5432** (session pooler); 6543 cannot do DDL

---

## 8. Is 20260920220000 needed for the turn path?

**NO.** Measured, with contrast controls, on the comment-stripped body of the
INSTALLED `append_turn_atomic_v5`:

| Probe | Result |
|---|---|
| body calls `create_model_version` | **false** |
| body calls `restore_model_version` | **false** |
| body calls `append_turn_atomic_v4(` | **true** (contrast control — the probe can see) |
| body does `INSERT INTO public.model_versions` | **true** (contrast control) |

The turn path mints its version with a **direct `INSERT INTO
public.model_versions`** inside `append_turn_atomic_v5`'s own body. It never
calls either function `20260920220000` repairs. (The single textual mention of
`restore_model_version` in the c8 source is a **comment** at `:636` referring to
`restore_model_version_atomic_v1`, a different function — which is why the probe
must strip comments; an unstripped `LIKE` returns `true` and reads as a
dependency that does not exist.)

`create_model_version` and `restore_model_version` are called only from
`src/orchestrator-v5/model-management/store-adapter.ts:193` and `:215`, behind
the explicit version-create / version-restore routes in
`src/routes/assist.v1.scenario-versions.ts`.

**And 20260920220000 is still NOT applied** — measured live at
2026-09-21T23:20:34Z, on the comment-stripped bodies sliced after `BEGIN`:

| function | live md5 | `ERRCODE = 'MV409'` | `deduped` |
|---|---|---|---|
| `create_model_version` | `a282a1b86186e814a3add01b3ede2662` | **1522** | 2054 |
| `restore_model_version` | `35614e797d2f712fa797b7ac9dc51218` | **1177** | 1803 |

In both, the MV409 raise still precedes the dedupe arm — the defect
20260920220000 repairs is live in those two functions today. It is a real
defect; it is simply not on the turn path, so it did not need to land with this
one and should be judged on its own evidence.

**What would change this verdict**, exactly:

1. the turn path being refactored to route version creation through
   `create_model_version` instead of its inline `INSERT` — then a turn retry
   would inherit the MV409-before-dedupe defect; or
2. a user journey that retries `POST`/restore against
   `assist.v1.scenario-versions.ts` **while supplying
   `expected_graph_identity_hash`** (both callers do supply it when the optional
   request-body field is present). That is a real defect in its own right and
   `20260920220000` is the right fix for it — it is simply **not on the turn
   path**, so it is not required to land this one, and each should be judged on
   its own evidence.

---

## 9. Risk statement

The blast radius is every graph-bearing v5 turn on every CEE service, because
all three run `CEE_V5_GRAPH_CAS_RPC=enforce` against one Supabase project. The
function is `SECURITY DEFINER` and executable only by `service_role`, so no
client-side surface changes. Within CEE, `append_turn_atomic_v5` is invoked from
exactly one place — the RPC call at
`src/orchestrator-v5/session/supabase-store.ts:1304` — whose error handling
already special-cases `OLGC1` as "rejected a stale graph write" (`:1355`);
after this migration that branch simply stops firing for replays and keeps
firing for genuine conflicts, which C1 proves. The change is a statement
reorder inside one `CREATE OR REPLACE`: it adds no column, no index, no lock
beyond the `FOR UPDATE` the function already takes, no grant and no table. The
one behaviour it deliberately gives up is that a replay of a committed turn no
longer reports a conflict — correctly, because there is nothing to conflict with;
C2 shows a replay carrying a different mutation id is still refused with
`MV422`, and C5 shows the first-write exemption is untouched. The realistic
residual risks are (a) that the live body is not what we pinned at apply time,
which the script's md5 pre-check refuses rather than overwrites, and (b) that
some consumer outside this repo depends on the OLGC1-on-replay behaviour as a
signal — **UNVERIFIED**, since I only searched this repo; settling it means a
cross-repo grep for `OLGC1` in DecisionGuideAI and plot-lite-service. Revert is
a single `CREATE OR REPLACE` proven to restore the live body byte-for-byte.

---

## 10. The test that lands with this

`tests/integration/c8-append-v5-replay-precedes-cas.contract.test.ts` — 8 tests,
gated on `RUN_C4_CANONICAL_STATE=1` + `DATABASE_URL`, `describe.runIf`, same
recipe as `README-c4-local-db.md`.

| State of the database | Result |
|---|---|
| env unset | **1 file skipped, 8 tests skipped, exit 0** — never opens a connection |
| fix applied (`7b78d8e1…`) | **8 passed** |
| rolled back to the deployed body (`829c3deb…`) | **5 failed, 3 passed** |
| C4 mutant (`5346f5e7…`) | **5 failed, 3 passed** |

The 3 that pass in every state are the carrier-present check, C1 and C5 — the
behaviours the fix does not change. That is the discrimination profile the pins
should have.

The file is registered in `REQUIRED_GATE_INTEGRATION_EXCLUSIONS`
(`vitest.shared.ts`), which `tests/meta/required-gate-integration-exclusions.test.ts`
derives mechanically and checks in **both** directions inside the required gate —
so the registration is itself verified rather than trusted.

A **static** guard for this fix already existed at
`src/orchestrator-v5/session/__tests__/append-turn-atomic-v5-replay-precedes-cas-static-guards.test.ts`
(8 regex-over-file assertions, in the required gate). It asserts the migration
*file* carries the right order. It cannot execute plpgsql, so it cannot show
that the deployed function refuses a committed write, that the receipt comes
back deep-equal, or that the mutant flips. This new file is the runtime half.

---

## 11. The repo's own gates, run on a clean tree at my head

`a626f87bc1196577d6563e7c922c9705ec1b2636`, the three staged files and nothing
else (`git status --short` shows exactly `M vitest.shared.ts` plus the two new
files). `pnpm install --frozen-lockfile` from `pnpm-lock.yaml` — this repo pins
**pnpm**, not npm; `package.json` declares no `packageManager` field, and
`pnpm-lock.yaml` is the only lockfile.

Every step of `.github/workflows/ci.yml` job `Lint, TypeCheck, Unit Tests`, in
its own order, with its exact command read from the workflow:

| # | Command | Exit |
|---|---|---|
| 1 | `node scripts/ci/assert-pnpm-overrides-readable.mjs` | **0** |
| 2 | `node scripts/ci/assert-rate-limit-builders-return-error.mjs` | **0** |
| 3 | `pnpm openapi:generate` | **0** |
| 4 | `pnpm lint` | **0** (2 pre-existing warnings, 0 errors; re-run after adding the new `.mjs` script, still 0) |
| 5 | `pnpm check:schemas-resolution && pnpm build` | **0 / 0** |
| 6 | `LLM_PROVIDER=fixtures pnpm config:validate` | **0** |
| 7 | `bash scripts/check-forbidden-boundary-patterns.sh` | **0** |
| 8 | `npx tsx scripts/ci/contract-field-guard.ts` | **0** |
| 9 | `npx tsx scripts/ci/value-warrant-guard.ts` | **0** |
| 10 | `pnpm eval:orchestrator:test` | **0** |
| 11 | `pnpm eval:promotion-gate` | **0** |
| 12 | `pnpm eval:promotion-gate:shrink-guard` | **0** |
| 13 | `pnpm test:required` | **1** — see below |

### ⚠ `pnpm test:required` is RED on this machine at BOTH base and head

Reported faithfully rather than rounded off.

| | head `a626f87b…` | base `e717e19d…` |
|---|---|---|
| exit | **1** | **1** |
| test files | 14 failed, 2401 passed, 19 skipped (2434) | 15 failed, 2400 passed, 19 skipped (2434) |
| tests | **17 failed, 43305 passed, 178 skipped, 12 todo (43512)** | **17 failed, 43305 passed, 178 skipped, 12 todo (43512)** |
| duration | 974.81s | 1125.68s |

The base run is a detached `git worktree` at
`e717e19d05542a80254ea056aa95a59c2cde4053` (HEAD asserted equal, 40 chars),
placed **outside** the lane clone, with its own `pnpm install --frozen-lockfile`
and its own `pnpm openapi:generate && pnpm build` so the two runs are comparable.
Isolation proven by WRITING a sentinel file into the worktree and confirming it
does not appear in the lane clone.

**The counts are identical and the failure identities are almost disjoint:** 12
files fail only at base, 11 only at head, and just **3** fail in both
(`constraint-gap-disclosure-egress`, `scaffold-disclosure`, `prompts.defaults`).
Two further facts settle it:

* **43,512 tests were collected in BOTH runs.** My change adds nothing to this
  gate — the new file is excluded, and `grep -ac 'c8-append-v5-replay-precedes-cas'`
  over each 46-48 MB log returns **0** in both.
* **All 14 of the head-failing files PASS when run in isolation at head** —
  `pnpm vitest run --config vitest.required.config.ts <the 14 files>` →
  **14 passed, 317 tests passed, exit 0.**

So the local red is non-deterministic under full-suite load on this machine
(~1000-1100s wall clock, `import` alone 5580s/6439s of worker time), not a
regression from this diff. **What I cannot claim: that the required gate is
green.** It is not green here at either commit, so the authority is CI on its
own runner. What would settle it: pushing the branch to `feat/**`, which fires
`ci.yml`'s required job for free (`on: push: branches: [main, staging, feat/**]`)
without opening a PR — the orchestrator pushes, not this lane.

The one check that *directly* verifies this change did run, and passes:

```
pnpm vitest run --config vitest.required.config.ts \
  tests/meta/required-gate-integration-exclusions.test.ts
→ Test Files 1 passed (1) · Tests 7 passed (7) · exit 0
```

That is the test which derives the external-dependent set from file contents and
demands it EQUAL `REQUIRED_GATE_INTEGRATION_EXCLUSIONS`, in both directions. It
is what makes the new file's registration measured rather than asserted.

---

## 12. Timestamps on every live-system reading

| Reading | `date -u` |
|---|---|
| Live `pg_get_functiondef` ordering probe | 2026-09-21 22:46:24 UTC (result stamp `22:46:26.308Z`) |
| Live migration ledger | 2026-09-21 22:46:39 UTC (`22:46:40.590Z`) |
| Live ACL / `prosecdef` / ledger recheck (still `829c3deb…`, ledger still absent) | 2026-09-21 23:11:17 UTC (`23:11:19.355Z`) |
| Live DRY RUN of the apply script — aborted, ledger row ALREADY present | 2026-09-21 23:20:07 UTC |
| Live re-read after the state change (`7b78d8e1…`, ledger present) | 2026-09-21 23:20:07 UTC (`23:20:10.660Z`) |
| Live full re-derivation: ledger rows, three function bodies, offsets | 2026-09-21 23:20:33 UTC (`23:20:34.636Z`) |
| **Final live confirmation** — `7b78d8e1…`, `body_len 10259`, `REPLAY_LOOKUP_BEFORE_CAS` | 2026-09-21 23:40:08 UTC (`23:40:09.694Z`) |
| Render env vars, first (unpaginated, WRONG) | 2026-09-21 23:10:02 UTC |
| Render env vars, fully paginated | 2026-09-21 23:10:12 UTC (`23:10:28.736Z`) |
| Container RED run | 2026-09-21 22:50:23 UTC (`22:50:23.238Z`) |
| Container GREEN run | 2026-09-21 22:50:38 UTC (`22:50:38.445Z`) |
| Container C4 mutant run | 2026-09-21 22:51:04 UTC (`22:51:04.887Z`) |
| Container GREEN restored | 2026-09-21 22:51:14 UTC |
| Vitest GREEN | 2026-09-21 22:54:59 UTC |
| Vitest RED (rolled back) | 2026-09-21 22:55:22 UTC |

Every live *reading* above was taken inside `set transaction read only`. The one
exception is deliberate and stated: the apply script's DRY RUN at 23:20:07Z
opened an ordinary transaction, ran its ledger and md5 pre-checks, threw
`__DRY_RUN__`/`ABORT` and rolled back — it never reaches `tx.unsafe()` without
`--apply`, and the immediate re-read at 23:20:10Z shows the ledger and the
function exactly as the abort found them. **This lane issued no DDL, no INSERT,
no `auth.users` row and no backfill against the live project.**

---

## Appendix — raw ACL / ledger reading

```json
{
  "at": "2026-09-21T23:11:19.355Z",
  "procs": [
    {
      "proname": "append_turn_atomic_v4",
      "pronargs": 19,
      "acl": "{postgres=X/postgres,service_role=X/postgres}",
      "prosecdef": true,
      "md5": "db7bdbe3e2052237c623d8c5477a96e5"
    },
    {
      "proname": "append_turn_atomic_v5",
      "pronargs": 30,
      "acl": "{postgres=X/postgres,service_role=X/postgres}",
      "prosecdef": true,
      "md5": "829c3deb90594099397d64d747f4854e"
    },
    {
      "proname": "create_model_version",
      "pronargs": 11,
      "acl": "{postgres=X/postgres,service_role=X/postgres}",
      "prosecdef": true,
      "md5": "a282a1b86186e814a3add01b3ede2662"
    },
    {
      "proname": "restore_model_version",
      "pronargs": 5,
      "acl": "{postgres=X/postgres,service_role=X/postgres}",
      "prosecdef": true,
      "md5": "35614e797d2f712fa797b7ac9dc51218"
    }
  ],
  "ledger": {
    "new_ones": 0,
    "c8_present": 1,
    "max_version": "20260918014756"
  },
  "ledger_columns": [
    {
      "column_name": "version",
      "data_type": "text"
    },
    {
      "column_name": "statements",
      "data_type": "ARRAY"
    },
    {
      "column_name": "name",
      "data_type": "text"
    },
    {
      "column_name": "created_by",
      "data_type": "text"
    },
    {
      "column_name": "idempotency_key",
      "data_type": "text"
    },
    {
      "column_name": "rollback",
      "data_type": "ARRAY"
    }
  ]
}
```


## Appendix B — raw live re-derivation after the state change (23:20:34Z)

```json
{
  "at": "2026-09-21T23:20:34.636Z",
  "ledger_since_20260918": [
    {
      "version": "20260918000431",
      "name": "fix_create_shared_snapshot_pgcrypto_search_path",
      "created_by": "paulsleepm@gmail.com",
      "has_statements": true,
      "n_statements": 1,
      "statements_len": 1570
    },
    {
      "version": "20260918000833",
      "name": "fix_create_shared_snapshot_search_path",
      "created_by": "paulsleepm@gmail.com",
      "has_statements": true,
      "n_statements": 1,
      "statements_len": 1067
    },
    {
      "version": "20260918002117",
      "name": "store_brief_and_provenance_service_role",
      "created_by": "paulsleepm@gmail.com",
      "has_statements": true,
      "n_statements": 1,
      "statements_len": 3406
    },
    {
      "version": "20260918002353",
      "name": "widen_shared_briefs_seed_used_to_bigint",
      "created_by": "paulsleepm@gmail.com",
      "has_statements": true,
      "n_statements": 1,
      "statements_len": 2124
    },
    {
      "version": "20260918014756",
      "name": "fix_create_shared_brief_seed_cast_to_bigint",
      "created_by": "paulsleepm@gmail.com",
      "has_statements": true,
      "n_statements": 1,
      "statements_len": 1955
    },
    {
      "version": "20260920210000",
      "name": "v5_append_v5_replay_precedes_cas",
      "created_by": null,
      "has_statements": true,
      "n_statements": 1,
      "statements_len": 23270
    }
  ],
  "procs": [
    {
      "proname": "append_turn_atomic_v5",
      "md5": "7b78d8e12550628570e15b2b739c2d4d",
      "len": 17372,
      "acl": "{postgres=X/postgres,service_role=X/postgres}",
      "secdef": true,
      "nargs": 30,
      "off": {
        "cas": 2242,
        "olgc1": 2572,
        "lookup": 1639,
        "guard": 1862,
        "mv422": 3754,
        "mv409": 3540,
        "dedupe": -1
      }
    },
    {
      "proname": "create_model_version",
      "md5": "a282a1b86186e814a3add01b3ede2662",
      "len": 5485,
      "acl": "{postgres=X/postgres,service_role=X/postgres}",
      "secdef": true,
      "nargs": 11,
      "off": {
        "cas": -1,
        "olgc1": -1,
        "lookup": -1,
        "guard": -1,
        "mv422": -1,
        "mv409": 1522,
        "dedupe": 2054
      }
    },
    {
      "proname": "restore_model_version",
      "md5": "35614e797d2f712fa797b7ac9dc51218",
      "len": 5190,
      "acl": "{postgres=X/postgres,service_role=X/postgres}",
      "secdef": true,
      "nargs": 5,
      "off": {
        "cas": -1,
        "olgc1": -1,
        "lookup": -1,
        "guard": -1,
        "mv422": -1,
        "mv409": 1177,
        "dedupe": 1803
      }
    }
  ]
}
```


## Appendix C — final live ordering probe (23:40:09Z), read-only

```json
{
  "at": "2026-09-21T23:40:09.694Z",
  "version": "PostgreSQL 15.8 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 13.2.0, 64-bit",
  "prosrc_md5": "7b78d8e12550628570e15b2b739c2d4d",
  "prosrc_len": 17372,
  "body_len": 10259,
  "offsets": {
    "IF p_cas_enforce": 2242,
    "ERRCODE = 'OLGC1'": 2572,
    "INTO v_existing_turn_id": 1639,
    "IF NOT v_turn_preexisting THEN": 1862,
    "ERRCODE = 'MV422'": 3754,
    "append_turn_atomic_v4(": 2909
  },
  "ordering": "REPLAY_LOOKUP_BEFORE_CAS"
}
```

`body_len 10259` here is the SAME body length the container reported after the
fix, and all six offsets match it exactly. The live function and the function
the 8 tests pass against are the same bytes.
