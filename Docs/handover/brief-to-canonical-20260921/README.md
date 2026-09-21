# Brief → Trusted Canonical Model — handover, 21 Sep 2026

**For the successor workstream. Start at `01`, then `04`.**

| file | what it answers |
|---|---|
| `01-FIRST-WRONG-BOUNDARY.md` | the measured boundary + what is RULED OUT |
| `02-THE-CAUSAL-CHAIN.md` | the full chain, and the **provenance contradiction to rule first** |
| `03-CURRENT-WORK.md` | exact branches/SHAs/CI, what to keep or supersede |
| `04-MEASURED-FAILURES-AND-ROOT-CAUSES.md` | F1–F6, each with its first wrong boundary |
| `05-ARCHITECTURAL-JUDGEMENT.md` | what to simplify; where repair damages; redesign |
| `06-SUCCESS-CONTRACT.md` | the smallest battery that would prove the contract |

## The three things to read first

1. **`grammar.ts:686`** makes a stated figure's `value` optional. Measured on
   the deployed wire: **15 of 22,488 stated items carry a number (0.067%)**,
   across 4,000 draft events. That is the earliest boundary where user meaning
   is lost and it is upstream of every other failure here.

2. **`schema-v3.ts:457-459`** collapses a 12-member authorship enum to two by a
   ternary on `"inferred"` alone, so **everything not explicitly inferred
   defaults to `brief_extraction`** — which `obligation-provenance.ts` classes
   as `user_stated`. Machine-authored values inherit the user's authority by
   default.

3. **Two live rulings contradict each other** on whether a number read out of
   the brief is the user's statement. `obligation-provenance.ts` says yes;
   `no-brief-derived-user-override.writers.test.ts` says no and a module was
   deleted over it. **Rule this before building anything** — it decides the
   shape of the user-authority layer.

## Status of this lane

#1674 is at `3b9a0b9f`, required check fixed, **approval stale** (it was issued
against `ce28ab22`). Per instruction this lane **stops after #1674 pending
release control**. Schemas #63/#64 are parked open.

## Provenance of the evidence

- Deployed measurements: Render API, `cee-staging`, 30-day window ending
  2026-09-21T19:23Z, fully paginated, de-duplicated. Positive controls stated
  inline.
- Code claims: fresh blobless clone at `ce28ab22aa05959ac7b0eaf9e13a055b52772c4a`,
  `HEAD` asserted equal before reading.
- ⚠ **Which prompt version is actually served was NOT resolved.** Findings
  attributed to v187/v201 rest on in-repo comments citing captures, not on a
  measurement made this session. Settle it first.
