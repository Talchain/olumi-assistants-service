# RESUME HERE — AI Coaching / Core Correctness · 22 Sep 2026

## ✅ STATE AT HANDOVER — 21:05Z

`PROXY_V5_TARGET = orchestrator`. Served `9c16e8c`.

**Witnessed on that build: `29 PASS · 2 FAIL · 0 SKIP`.**

```
1=PASS · 2a=PASS · 2b=PASS · 3=PASS · 4=PASS · 5=PASS · 6=PASS · 7=see below
PASS [7] /proxy/v5/turn forwards to the orchestrator — turns=1 blocks=2 analysis_ready=present
PASS [7] a user CAN apply a model edit on their own surface — raw_value 9 → 11
FAIL [7] CONTROL — creation IS receipted — NOT MEASURED (the control built no graph)
FAIL [7] a model created on the user surface mints a receipt — NOT MEASURED
```

⚠ **The 2 FAILs are PROBE-side, not product.** Both creation rows depend on an
LLM actually drafting a model from the brief; that run drafted none, so the rows
report **NOT MEASURED** rather than a false product failure. Re-run to clear
them. Six prior standalone runs of that arm were healthy
(`nodes=14–15, versions=1, head=set`). **Do not read those two as a regression.**

### What happened around 20:50–21:03, so the record is straight

`PROXY_V5_TARGET` was set to `agent` at ~20:50 while four agent-route defects
were open. Measured live: edits silently did not apply (0 turn rows, no receipt)
and the reply quoted the internal `0.45` while claiming the unit was not
recorded — when the node holds `unit: "months"`, `raw_value: 9`. Canvas hit the
same thing independently from a different surface.

**The OpenAI owner then closed the `system_event` gap and the target returned to
`orchestrator` by 21:03.** No config was changed by this lane at any point.

⭐ **The lesson worth keeping:** criterion 7 tracks a *config disposition*, not
this lane's code. It went green → red → green three times today on config alone,
while the underlying code did not change. If it reads FAIL, check
`PROXY_V5_TARGET` **before** looking for a defect.

---


**Everything in this lane is pushed. Nothing lives only in a temp clone.**
All five working clones were swept: **0 dirty, 0 unpushed**. All eight branches
verified present on `origin` by SHA.

---

## 1. THE GOAL, AND EXACTLY WHERE IT STANDS

> *Make the shared deterministic action/state/analysis spine trustworthy for both
> the conventional PoC and OpenAI route… on deployed staging.*

### Conventional route — **COMPLETE AND WITNESSED**

```
### 31 PASS · 0 FAIL · 0 SKIP   on build 7a5fe3e
1=PASS · 2a=PASS · 2b=PASS · 3=PASS · 4=PASS · 5=PASS · 6=PASS · 7=PASS
```

Signed-in throughout, so **no receipt row was vacuously skipped**. Plus the
discriminating replay-vs-conflict witness, **11 PASS / 0 FAIL**.

⭐ **Criterion 7 passed because release control set `PROXY_V5_TARGET=orchestrator`
at 20:08Z — not because my code landed.** That single config change restored the
user's surface to the route where the receipt and `analysis_ready` guarantees
already held. Both defects I had reported on the user surface disappeared
without either of my implementations merging. **The config was the fix.**

### OpenAI route — measured, bounded, **awaiting one word from release control**

`AGENT_LANE_ENABLED=true`, `AGENT_LANE_PREVIEW=false` → mounted in **full mode**,
**not fronted** to users.

| | `/agent/v1/turn` |
|---|---|
| analysis reaches the shared spine · `analysis_result` block delivered | **SATISFIED** (block delivery improved since `a76f1a0`) |
| mutation commits · receipt minted · retry distinguishable | **UNSATISFIABLE** — 0 turn rows, 0 versions, no durable key |
| speaks the user-facing unit | ⛔ **DEFECT 3/3** — quotes stored `0.45`, says *"the model does not state its unit"*, while the node holds `unit: months, raw_value: 9`. **Conventional control 0/2.** |

**The open ask (#63 comment 5783575389): "ACCEPTED" or "FIX FIRST".**
⚠ If ACCEPTED, the bound must carry **"do not front this route until these are
fixed"** — otherwise it is a trap for whoever flips `PROXY_V5_TARGET` next.

---

## 2. MERGED, DEPLOYED, WITNESSED TODAY (7)

| PR | what |
|---|---|
| **#1686** | a factor whose unit IS a proportion accepts a proportion |
| **#1679** | refuse when the persisted graph moves under an analysis |
| **#1685** | a replayed commit reconciles against authoritative current state |
| **#1688** | a reused operation id refuses truthfully; reconciliation guard uses the **resolved** store; conflict does not leak the prior receipt |
| **#1692** | removed the dead reachability duplicate that had staging red for 4 commits |
| **#1690** | pins the strict/inclusive collapse in CI (**code-bounds** a release-critical defect) |
| **#1697** | corrects that pin's own instruction, which was wrong for the fix it recommends |

---

## 3. OPEN, WITH EXACT HEADS

| PR | head | state |
|---|---|---|
| **#1691** registration receipt | `b3643ccb028c` | **NOT MINE** — OpenAI Architecture owns it per the 18:12 assignment. ⚠ Its red was **inherited** from the staging breakage; a `gh run rerun` **cannot** clear it (it re-uses the original merge commit). Only updating the branch picks up #1692 — and that **moves the head** release control asked for a REVIEW_REQUEST on. |
| **#1680** goal-direction | `02627c475de4` | green ×2, `behind=0`, awaiting verdict. PLoT half (#365) already merged and measured a safe no-op alone. Reach **1.3%** of live boards. |
| #1681 / #1682 / #1683 | — | untouched all session; low priority |

**Branch, no PR:** `feat/agent-route-discloses-readiness` @ `0595718252e6…` —
`analysis_ready` derived on the agent route from `assessCanonicalAnalysisReadiness`
(the one authority, pure function of the graph), guarded so it can never become a
second producer. Two mutants killed, 199 files / 4541 passed. **Held, not opened**,
per the assignment. Take it or drop it.

---

## 4. HOW TO RESUME THE WITNESS (one command)

Harness lives at `Docs/handover/coaching-20260922/witness/` on branch
`docs/coaching-handover-20260922` (@ `bae77007`, plus this file).

```bash
# credentials: olumi-assistants-service/.env.staging.local (SUPABASE_SERVICE_ROLE_KEY_NEW)
node mint.mjs ./witness-user.json          # mints a signed-in witness (JWT lasts 1h)
WITNESS_OWNER=<userId> WITNESS_JWT=<token> node spine.mjs        # 31 assertions, criteria 1-7
WITNESS_OWNER=… WITNESS_JWT=… node replay-vs-conflict.mjs        # the discriminating pair
```

⚠ **A JWT expires after ~1 hour.** An expired one makes every arm return the same
answer — if all arms agree, suspect the probe, not the product.
⚠ Receipt rows report **SKIP, never PASS**, without a signed-in owner.
⚠ The witness prints the served build and writes it into the JSON. **A green run
against the wrong build proves nothing.**

---

## 5. SETTLED — DO NOT RE-DERIVE

- The RPC decides `creation_kind` (`CASE WHEN NOT v_has_versions THEN 'initial'`)
  and **requires** `committed_mutation` from callers. All 3,162 scenario-first
  versions are `initial`.
- `assessCanonicalAnalysisReadiness(graph)` is **pure** (no I/O).
  `deriveAnalysisFreshness` needs `priorFacts` → a DB read. That is why the
  readiness fix belongs in the agent route, **not** in the shared readback, whose
  docblock states it is deliberately I/O-free.
- `ConstraintMetadata` is `.passthrough()`; `QuantityExtractionResultSchema` is
  **CEE-local**, not `@talchain/schemas`. A strictness marker is therefore a
  CEE-only change — I published the opposite and was wrong.
- `factor_value_edit` HAS a receipt-bearing carrier; guest `0` is the known
  guest-conditional skip. CEE reads **no `category`** on the value write path.
- Branch protection on `staging`: `contexts: ["Lint, TypeCheck, Unit Tests"]`,
  `strict: false`, `reviews: null`. But the **premerge guard** additionally
  requires a **published verdict bound to the exact head for ANY merge**,
  regardless of risk class. Do not route around it.

## 6. METHOD ERRORS WORTH INHERITING

Six mistakes this session shared **one root cause — checking a proxy for the
thing instead of the thing**:

1. Polled `verdicts`/`mergeable`/`checks-running` instead of **PR state** →
   reported #1692 blocked for 20 min after it merged.
2. Checked a **branch tip** instead of the merge commit CI compiles → wrongly
   told #1691's owner their red was their own.
3. **`gh run rerun` re-uses the original merge commit** — it cannot pick up a
   fixed base. Update the branch instead.
4. A test grep matched **my own prose** in a comment, not code.
5. A witness row reported a **probe** failure (LLM drafted no graph) as a
   **product** failure. Now reports NOT MEASURED.
6. Withdrew a real units defect as "intermittent" on a 2-run sample. At 3/3 with
   a control it stands. **The withdrawal was the error, not the finding.**

⭐ And the one worth most: **a commissioned adversarial review earned its keep
three times** — it caught a vacuity hole, a trap in my own docblock, and two
unreproducible numbers I had published. Instruct it to *find a reason to refuse*
and to *re-derive your numbers*, never to "check this over".
