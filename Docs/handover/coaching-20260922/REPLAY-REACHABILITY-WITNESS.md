# Is the deployed durable replay arm reachable and does it recover? — **YES, both**

22 Sep 2026. Written in answer to SDL's final adversarial correction, which was
**right**: the earlier report proved the handler path loses the client turn id,
but only *inferred* that the replay mechanism works, from the RPC's docblock and
`committedTurnRowId`. That was reading intent, not behaviour. This settles it by
execution.

## 1. Does a real deployed request ever present a pre-existing `(scenario_id, turn_id)`?

**Yes.** The deployed UI's retry reuses the prior identity —
`DecisionGuideAI/src/canvas/conversation/useConversation.ts`:

```ts
:6145   retryClientTurnId: last.clientTurnId,      // retryLast → sendTurn
:3802   const turnClientId = retryClientTurnId ?? pendingContext?.chainId ?? crypto.randomUUID()
```

`turnClientId` becomes the v5 payload's `turn_id`. So pressing retry after an
unverified send puts the SAME `(scenario_id, turn_id)` on the wire. The producer
exists and is shipped.

## 2. Does `append_turn_atomic_v5` recover the original result from it?

**Yes.** Read live with `pg_get_functiondef` (read-only) and then EXECUTED.

The deployed body carries SDL's applied migration:

```
 69  -- ⛔ REPLAY IS DECIDED BEFORE CAS. THIS LOOKUP MOVED ABOVE THE CAS BLOCK
 82  SELECT id, model_version_mutation_id, model_version_created
 83    INTO v_existing_turn_id, ...
 85    WHERE scenario_id = p_scenario_id AND turn_id = p_turn_id;
 86  v_turn_preexisting := FOUND;
 92  IF NOT v_turn_preexisting THEN        -- CAS runs ONLY for a new turn
205  IF v_turn_preexisting THEN            -- the replay arm
229  RETURN jsonb_build_object('turn_row_id', v_turn_id, 'model_version_receipt', …)
```

Ordering control, derived in the same run rather than eyeballed:
replay lookup at line **86**, CAS raise at line **171**, `replay precedes CAS:
true`. Uniqueness confirmed: `v5_conversation_turns_scenario_turn_unique UNIQUE
(scenario_id, turn_id)`.

### The executed witness — every acceptance clause

`replay-recovery-witness.mjs` in this directory. Throwaway scenario
`0000dead-0000-4000-8000-00000beef00d`, created and **deleted** (verified:
`scenario rows remaining: 0`). Paul authorised the writes.

```
STEP 1  original commit (T1, expected=H0)
        turn_row_id 0b62511d-ed0f-4070-87ee-fc6a18e3138c | receipt PRESENT
        turns=1 versions=1 head=b1b1…

STEP 2  a DIFFERENT turn (T2) moves the head            → head=c2c2…
        turns=2 versions=2       (T1's expected base is now stale)

STEP 3  REPLAY of T1 with its ORIGINAL, now-stale expected=H0
        turn_row_id 0b62511d-… | receipt PRESENT
        SAME turn row as the original?  true
        NO duplicate turn row?          true      turns=2 (unchanged)
        NO duplicate version?           true   versions=2 (unchanged)
        receipt version_id identical?   true

STEP 4  CONTRAST — a genuinely NEW mutation (T3) with the SAME stale expected=H0
        ✅ REFUSED: OLGC1 "stale graph write for scenario …"
        turns=2 versions=2 (unchanged)
```

Commit succeeds → response treated as lost → same operation retried → original
result **and receipt** recovered → no duplicate write or version → a genuinely
stale different mutation still refuses. **All six clauses, executed.**

Step 4 is the discriminating control: without it, step 3 could have passed
because the RPC had simply stopped enforcing CAS.

## 3. Therefore

SDL's branch resolves to the first arm: **YES → fix the handler path so it
preserves the same durable identity into that mechanism.** That is exactly what
`feat/durable-turn-identity` @ `15d6852e745e0c69bd8d4a0ba3c3b5a18b4b3bc8` does —
it routes handler-routed mutations into a mechanism now proven to work.

**Persistence is not at fault. Do not reopen SDL.**

## 4. The peer's "200 + new turn" is explained, not contradicted

A replay that returns 200 and creates a NEW turn is exactly what this trace
predicts for any message family taking the turn-executor path: CEE overwrites
the client's `turn_id` with a fresh `context.request_id`, so the RPC sees a
key that has never been committed, takes the `NOT v_turn_preexisting` branch,
and correctly inserts. It corroborates the diagnosis.

## 5. What is still NOT proven

The witness calls the RPC directly. It does **not** prove the HTTP path from
`POST /orchestrate/v2/turn` down to these arguments is free of other
interference (the turn fence, egress, the finaliser). A full wire witness on
`cee-staging` with a deliberately reused `turn_id` remains the last mile, and it
should be run once `feat/durable-turn-identity` is deployed — at which point it
tests the fix and the path together rather than the path alone.
