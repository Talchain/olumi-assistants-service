# ACCEPTANCE lane (github-39) — progress

Clone: `~/olumi-work/acceptance-pd` on `acceptance/successor-20261005` (base `09a2f3cd`). Scripts + evidence: `output/acceptance-20261006/`.

## Served tuple read 6 Oct 16:33Z
- UI `/version.json` commit `a8c07268` (deploy `6ac519e84f179a0008ba6fae`, 15:57Z) = DGAI staging head.
- CEE staging head `692fb96e` (13:45Z). Served build = UNVERIFIED until the first capture's `x-olumi-service-build`.
- PLoT head `0f21df07`, ISL head `9ddca912` (branch heads; served = UNVERIFIED).

## Item 1 — founder correction witness: DESIGN NOTE (sent to DL 16:4xZ)
- **Script:** `founder-replay.mjs` + `founder-judge.mjs` (29 self-checks green: each defect has a must-FAIL row and a must-PASS twin).
- **Scenario:** a FRESH staging guest scenario per draw (throwaway profile under `/private/tmp`, deleted after). Never 58bd5e71.
- **Turns:** Paul's four typed messages VERBATIM from CEE `change-goal-adopts-level-unit.test.ts` @692fb96e. The fourth is
  "Yes, how do they affect this decision?" (the addendum's "Yes" is its short form).
- **Sequence:** brief → Run 1 → sizes → "The latter." → "Yes, how…" → card → Approve → Run 2 → cold reload (context closed and relaunched).
- **Rows (pre-declared):**
  - R1 draft: goal `change_rel` 0.1, unit not "%" (A2). Another frame = NOT COMPARABLE, redraw.
  - R2 Run 1: asks today's level with no "%" question.
  - R3–R5: replies recorded verbatim.
  - C1: held card by the end of R5 with level 16, a sprint unit, "your target: up at least 10% from today",
    "Olumi’s reading of your figures in “We can fit 4 large, 8 medium, 16 small, roughly”". No card = FAIL, first wrong hop.
  - C1b (only if C1 fails): the DL's repair sentence "We fit 16 small-update equivalents per sprint." Separates door-refuses from never-called.
  - A1: clicked control = that card (label, chip id, `authorise_change` ok + mutated); persisted unit, `change_rel` 0.1, cap 22,
    level 16, `unit_reading.source = olumi_reading` quoting Paul.
  - S1: earlier Run reads stale. N1: Run 2 asks no "%" and no level again. L1: cold reload keeps all of it, same `graph_hash`.
  - D1 (item 1b): if Run 2 is licensed, `driver_by_option` + "It rests most on …" + shown % = quoted %. Expected NOT REACHED here
    (links into the goal are Olumi's placeholders), so 1b then runs on a stated-target brief (T1b £126k).
  - K1: contest words on any screen.
- **Budget:** ≤17 LLM calls per draw, ≤3 draws, plus one T1b Run for 1b: ≤60 calls. Abort on the first 429.
- **Known instrument limit:** "The latter." only has a referent if Olumi's reply to the sizes turn poses a two-way reading; R3 records that
  question verbatim so a mismatch is visible rather than scored as a product failure.

## Log
- 16:33Z briefs read, tuple read, founder turns taken from the merged tests.
- 16:40Z scripts written, self-check 29/29, design note sent. Proceeding at 16:55Z unless the DL objects.
