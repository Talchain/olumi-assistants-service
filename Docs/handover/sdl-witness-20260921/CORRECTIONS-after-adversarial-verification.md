# Corrections after independent adversarial verification

Four verifier agents re-derived each lane's claims by execution. **Two lanes were
NOT upheld, and all four were marked `safeToEscalate: false`.** The corrections
below are applied to this handover rather than left in a subagent transcript.
The migration itself is unaffected — what the verifiers hit was framing, citation
precision and missing controls, not the correctness of the change.

## Corrections to claims I published

**1. The diff is ONE hunk, not two.** I wrote "two hunks" in the migration ask and
in the plan. With `--` comment lines and blanks stripped, `20260920210000:67-488`
vs `20260824200000:515-920` is 302 → 304 code lines in a **single** hunk that moves
the `INTO v_existing_turn_id` lookup above the CAS and wraps the CAS in
`IF NOT v_turn_preexisting THEN`. The five CAS conjuncts and the OLGC1 raise are
byte-identical apart from indentation. Corrected.

**2. The offset convention has to be stated or the numbers look irreproducible.**
Every offset I published — 1743 / 2059 / 2417 before, and 1639 / 1862 / 2242 / 2572
after — is measured from a body slice that **includes the leading `\nBEGIN`**.
Re-measured live just now, both conventions side by side:

| convention | lookup | guard | CAS | OLGC1 | body len |
|---|---|---|---|---|---|
| **including `\nBEGIN`** (what I published) | 1639 | 1862 | 2242 | 2572 | 10,259 |
| after the `BEGIN` token | 1633 | 1856 | 2236 | 2566 | 10,253 |

Exactly six characters apart. The **ordering relation is invariant** either way, so
no conclusion moves — but my prose said "after `BEGIN`" while the numbers are the
inclusive slice. Corrected.

**3. `supabase_migrations.schema_migrations.statements` is `text[]`, not `text`.**
Verified: type `text[]`, one element, `statements[1]` length 23,270. So "23,270
characters" is the length of the single element, not of a text column.

**4. `created_by = NULL` on the applied row is NORMAL, not a suspicion signal.**
Contrast control in the same table: `20260824200000`, `20260802120000`,
`20260731130000` and `20260731120000` all carry NULL too. Direct-SQL applies do not
populate it. I noted the NULL in passing; it means nothing.

## Fair hits I am recording rather than answering

**No outcome metric was named before the fix.** No pre-apply count of
"OLGC1-raised-on-a-replay" was taken, so there is no before/after improvement
number to point at. The nearest thing measured is four CAS conflicts in seven days
(lane P), which is the conflict rate, not the replay-refusal rate. The only
after-measurement that exists — the wire replay retest — shows no change, exactly
as predicted. Anyone re-opening this should take the outcome metric first.

**No wire-level control that any deployed request can reach
`append_turn_atomic_v5` with a pre-existing `turn_id`.** The container proof
supplies the original fence generation by hand. That gap is the substance of the
next item and is why the migration was applied on latent-correctness grounds.

## Where the verifiers changed the picture

**The register route reaches `append_turn_atomic_v3`, NOT v4.** Lane C claimed v4;
the verifier supplied the control (deployed v2 has zero occurrences of
`graph_identity_hash` so it cannot stamp; v3 lines 83-86 do the `UPDATE`). The
conclusion — the route stamps the identity hash while creating no version and
never moving the pointer — survives, but the mechanism citation was wrong.

**The 72 stranded owned scenarios are a CLOSED historical cohort.** Created
2026-08-25 to 2026-08-30, none added since, while registrations have continued to
2026-09-21. This matches what I measured independently (the cohort clusters 27–30
Aug with none since 31 Aug). Any text implying an ongoing leak is wrong.

**⚠ Lane B's "NOT REACHABLE FROM THE WIRE" headline did not survive**, and this
partially qualifies my own replay finding. The verifier derived that
`src/orchestrator/route-v2.ts` passes `turn_id: ingress.turn_id` at **9 of 9**
`commitDirectAnswer`/`commitTurn` sites, and that lane B's message-family replay
was **not** intercepted — it returned 200 and committed a NEW turn row with
`turn_class=clarify` and a NULL `model_version_mutation_id`, i.e. it took the
v4/v3 path and never called v5.

**What this does and does not do to my finding.** My measurement stands as
measured: the client `turn_id` of a **handler-routed** mutation is absent from
`v5_conversation_turns` estate-wide while the draft turn's client id is present
(contrast control, same query). But "the client turn_id is discarded" must be
scoped to the **handler path**, not stated generally — on the direct-answer path
the ingress id IS carried through. The practical consequence for an integrator is
unchanged: a replayed mutation does not return the original receipt. The reason is
narrower than "the id is always thrown away".

**Lane B's own replay is not a clean control either**, by the verifier's account:
same body, different branch, so a 200 there does not demonstrate replay
reachability. Treat both my 409 and lane B's 200 as evidence about *different
paths*, and treat "is the v5 replay arm reachable from the wire?" as **still
open**. It is the single question most worth settling next.

## Net effect on the migration

None. Independently re-verified after the apply: live `prosrc` md5
`7b78d8e12550628570e15b2b739c2d4d` — the same bytes lane A's eight assertions pass
against — one overload, 30 args, ordering fixed, MV409/MV422 and the v4 delegation
intact, grants unchanged, ledger 137 → 138 with `20260920220000` still absent.
The rollback is exact: lane A demonstrated it returns the body to md5
`829c3deb90594099397d64d747f4854e`, byte-identical to the pre-change function.
