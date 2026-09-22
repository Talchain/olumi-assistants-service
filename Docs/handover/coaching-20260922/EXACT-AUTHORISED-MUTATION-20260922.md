# Exact authorised mutation — witnessed on deployed staging
**22 Sep 2026 · build `c12a54d` · scenario `d83df456-fff9-423b-affa-c5ac37091cb1`**

The last unprobed link in this lane's remit: *user action → correct semantic
interpretation → stable operation identity → **exact authorised mutation** →
canonical state → truthful receipt*.

## The journey, executed

| step | product behaviour | state |
|---|---|---|
| `"make the sales cycle much shorter"` | **asks** rather than guessing — *"directional but not a specific number, so I want to check"* | 9 |
| `"6 months"` | **holds** — *"Nothing has been changed. I want to confirm this with you before I edit the model"* | 9 |
| `"actually make it 4 months"` | supersedes; stored patch becomes `inline_patch.params.value = {unit:'month', value:4}` | 9 |
| `"yes please"` (two live) | **refuses to guess** — *"I have more than one change waiting… Reply with a number, 'all of them', or 'none'"* | 9 |
| `"which ones are waiting?"` | *"There's one open confirmation waiting: setting Sales Cycle Length to **4 months**. Earlier you said 6 months, then corrected that to 4 months… nothing has been changed yet."* | 9 |
| `"yes, apply it"` | *"Applying… Updated Sales Cycle Length from 9 months to **4 months**."* | **4** |

**The value stayed 9 through the entire held phase**, and the applied value is the
**latest** offer, not the superseded one.

⭐ **The documented stale-patch hazard does NOT occur.** The concern was that a
held change replays from its stored patch and never re-reads the message, so a
correction could be silently discarded and the ORIGINAL offer applied with a
receipt. Measured: the stored patch carried **4**, the correction the user made —
supersession is honoured at the patch, not merely in the prose.

## ⚠ Two corrections to my own probe, recorded so the numbers are not misread

1. My first run scored *"applied 9 when I authorised 6"* as a **defect**. It is
   not — the product had correctly **held** and said so. The probe's verdict
   labels assumed authorisation where the product had asked for it.
2. I flagged `"1) Set this value 2) Set this value"` as a stuck state. It is
   **transient** disambiguation copy; once the superseded offer lapsed the
   product correctly reported **one** open confirmation, with its value.

## BOUNDED — pending-action labels carry no value

In the two-live-offers prompt the options render **identically**:
`1) Set this value 2) Set this value`. Also seen as *"The held change 'Set this
value' has lapsed"* and *"Applying: Set this value."*

⛔ **DO NOT "FIX" THIS AT THE CHIP LABEL.** `compose/warrant-demotion.ts:52-61`
states the label is *"deliberately GENERIC and digit-free"* because
`emitProposedChange` **refuses** copy carrying a raw decimal, and a refusal there
would **DROP the change rather than offer it — the one outcome INV-1 forbids**.
Putting the value in the label makes it strictly worse. I started to do exactly
that and stopped when I read the constraint.

**This is already known in-repo with an earlier witness** (`warrant-demotion.ts:213-240`,
CEE staging `8e4efce0`, 14 Sep): *"1) Add this limit 2) Add this limit"*, graph
hash unchanged, *"no way to choose between them"*. Root cause recorded there:
`CHIP_COPY` is a per-intent **constant**, so two proposals differing only in
`params` cannot differ in label.

**My case is a different population from that one.** There, the second proposal
was never appliable (a parameter-sufficiency gap, since addressed). Here **both
offers were legitimately appliable** (6 and 4), so that fix does not cover it.

### Why this is bounded rather than release-critical

- **Nothing is applied.** The ambiguous confirmation is refused, not guessed.
- **State is untouched** — value stayed 9 and the graph hash did not move.
- **A working recovery path exists and was verified**: asking *"which ones are
  waiting?"* returns the correct offer **with its value** and an accurate history
  of the correction.

It is a **disclosure** defect on a safe path, not an integrity one.

### The right layer, if it is fixed

The **assistant text**, not the chip. `warrant-demotion.ts` says the specifics
*"live in the assistant text, which is not subject to the chip filter and can
therefore be honest about numbers"* — and the pending already carries the value
in `inline_patch.params`. The numbered list is built from `c.label`
(`turn-executor.ts:5666`); building it from a params-derived description would
distinguish the options without touching the chip contract.

**Not done here**: it is a consent-copy change in a 17,000-line controller, on an
already-safe path, while two PRs are mid-CI. Rowed, with the root cause and the
correct layer named, rather than half-done at speed.
