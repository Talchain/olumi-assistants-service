# CORRECTED PREMISES — where the brief's model of the estate is wrong (2026-08-14)

Derived at the bytes on CEE staging `9ecf19f8`. Every claim below names the
artefact it was measured at. `rg -a` used throughout (trap 17).

---

## CP-1 (LOAD-BEARING) — the projector does NOT write a cap. It is deliberate.

The brief: *"the drafter/projector writes factor `observed_state` objects that
carry a `cap` and a framed `value` but NO corroborating `raw_value`"*.

**Refuted at `src/cee/draft/records/projector.ts:895-903`**, whose own heading is
`⚠ NO cap IS STORED, AND THAT IS LOAD-BEARING, NOT AN OMISSION`. The reason given
is derived from the edit seam (`d1-shared/normalise-factor-value.ts`): a stored
cap flips every later user edit to a NORMALISED `observed_state.value` write, and
the golden-journey harness INV-7 binds `observed_state.value === <user-stated raw>`
after an edit — so a faithful edit would read as a failure.

What the projector DOES write, `projector.ts:2112-2113`:
```
factor.observed_state = { ...factor.observed_state, value: baseline / frame, raw_value: baseline };
factor.data          = { ...(factor.data ?? {}),    value: baseline / frame, raw_value: baseline };
```
i.e. it ALREADY writes the `value`/`raw_value` pair, capless, by design. **There
is nothing to fix in `projector.ts`, and adding a cap there would break an
established invariant.** No edit was made to it.

Probe integrity: `rg -ac 'cap' projector.ts` → 21; plain `grep -c 'cap'` → exit 1
(ZERO). The file carries 2 NUL bytes, so the trap-17 blindness is real and was
controlled for.

## CP-2 — the grammar that let a model author `data.cap` is RETIRED.

`src/adapters/llm/anthropic.ts:55-60`: the graph grammar builder "is retained for
exactly one train as the REVERT TARGET for the draft-by-records cutover … It is
deliberately no longer imported here: the draft path attaches the RECORDS
grammar". `projectDraftRecords(rawJson, args.brief)` at `:1982` is UNCONDITIONAL
(no flag). `cap` and `raw_value` are grammar slots only in the retired
`anthropic-graph-schema.ts` (`:251`, `:267`).

**Consequence: on the live draft path a factor `data.cap` is never set**, so the
`schema-v3.ts` pass-through this PR fixes cannot fire at draft time today.

## CP-3 — MEASURED: the defect class has ZERO incidence in the real corpus.

Scanned five banked capture corpora (incl. `staging-draft-captures-2026-08-10.json`
and `staging-mixed-scale-captures-2026-08-13.json`, the round-4/5 evidence base):

```
totalFactorsWithObserved: 71   capped: 50
capNoRaw: 0    capWithRaw: 50    inconsistent: 0
```

CONTRAST CONTROL (trap 13e — an absence claim needs a probe proven able to see a
presence): the same scanner over an injected fixture reported
`capNoRaw: 1, inconsistent: 1` and named the factor. **The zero is real, not
instrument blindness.**

## CP-4 — the goal limb cannot produce the shape either.

`schema-v3.ts:286-293` writes `raw_value: goal_baseline_raw` and
`cap: goal_threshold_cap` as INDEPENDENT optional spreads, which looks like the
same hazard. It is not: the sole mint (`cee/factor-extraction/enricher.ts:736-739`)
writes `goal_baseline` and `goal_baseline_raw` under ONE conditional spread, and
the limb only runs `if (node.goal_baseline != null)`. So `value` present implies
`raw_value` present. Both are divided by the SAME `resolvedCap`
(`enricher.ts:699-710`), so `goal_baseline === goal_baseline_raw / goal_threshold_cap`
holds by construction. **No change made; no fabrication risk.**

---

## THE HONEST STATUS OF THIS PR

**This is DEFENCE IN DEPTH, not a capability unblock.** Stated plainly because the
estate's dominant reporting defect is claiming reach a change does not have:

- the writer fix is correct and tested, but its trigger condition (`data.cap` at
  the V3 transform) is **not reachable from any live CEE producer today**;
- the acceptance line *"a drafted status quo whose factors carry cap+value now
  carries corroborating raw_value throughout"* is **vacuously true**: drafted
  factors carry no cap at all (CP-1);
- the excluded-not-held class from #956's review is therefore **NOT closed by this
  PR** for any real drafted graph. It remains open for graphs whose caps arrive
  from outside CEE's draft path (the UI/autosave writer, legacy persisted graphs,
  or a restored revert-target grammar).

What this PR genuinely delivers:
1. the pass-through seam can no longer PROPAGATE an uncorroborated cap if one ever
   arrives — the residue it cannot truthfully fix is now **LOUD**
   (`cee.v3_transform.uncorroborated_cap`, ids + count only, redaction-safe);
2. a reusable, consumer-bound predicate (`findUncorroboratedCapFactorIds`) that
   catches BOTH failure modes — absent corroboration and a `raw_value` that
   DISAGREES with `value x cap` (a wrong number a presence-only check blesses);
3. the `ambiguous_no_evidence` rejection is **byte-unchanged** —
   `plot-intervention-scale.ts` is not in this diff.

**RECOMMENDED NEXT STEP (not taken — scope-expansion rule):** if the
excluded-not-held class is to be closed for real users, the evidence points at
the writer CEE does not own. The smallest enabling change is to run this same
guard over the PERSISTED graph at the analysis seam and repair-or-disclose there.
That seam is `run-analysis.ts`, which **PR #954 is currently modifying** — a
declared collision. It needs its own lane after #954 lands, briefed on the
persisted-graph writer, not on the drafter.
