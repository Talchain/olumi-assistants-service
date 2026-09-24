# Blind review of `blind/PACK.md` — scores, unblinded

- **Pack:** sha256 `514c6ef7…`. It was posted on programme-docs #63 as comment 5821984254.
- **Key:** `blind/KEY.json`. Its sha256 `7b2afb5f…` was committed on #63 **before** scoring.
- **Scorer:** the independent ChatGPT task "Review OpenAI PoC Context". Its scores arrived in #63 comment 5822982121, before the key was unblinded.
- The pack showed rep 1 of each version only.

## Scores (0–24) and the version behind each letter

| Case | Reply scores | Mapping | Reviewer's pick | Reviewer's reason |
|---|---|---|---|---|
| 1 hiring construction | A 22 · B 15 | A=C1, B=M | **C1** | B (M) falsely promises that approval will run |
| 2 pricing construction | A 16 · B 21 | A=M, B=C1 | **C1** | A (M) falsely promises that approval will run |
| 3 held-out construction | A 21 · B 17 | A=C1, B=M | **C1** | B (M) invents an option level and promises a run |
| 4 pricing Run, leader withheld | A 10 · B 19 · C 17 | A=M, B=C2, C=C1 | none pass | **all three name a leader while it is withheld** |
| 5 hiring Run, blocked | A 20 · B 23 · C 22 | A=M, B=C2, C=C1 | C2 (by 1 point over C1) | — |

## Agreement with the deterministic scorer (same rep-1 replies)
- **Cases 1–3.** The scorer's hard FAIL for M is ACTION_TRUTH `promises_run_after_approval`, and it is the reviewer's reason in all three. C1 has 0 hard FAILs, and the reviewer prefers C1 in all three.
- **Case 3, M's "invented option level".** No deterministic check covers this. The critic had already listed it as UNVERIFIED ("implied modelled level of two dedicated triage nurses"). **It is a scorer gap.**
- **Case 4.** On rep 1 the scorer flags all three:
  - M: LEADER_HONESTY plus WIN_PCT_WHILE_WITHHELD;
  - C1: LEADER_HONESTY_SPLIT;
  - C2: LEADER_HONESTY_SPLIT.
  **That is 3 of 3 in agreement.** Across n=3 the rates are M 3/3, C1 1/3 and C2 3/3.
- **Case 5.** No hard FAIL in any version, and the reviewer's spread is small (20–23).

## Conclusion
- **Construction copy: C1 (copy v2) is better on every case,** by both the blind reviewer and the scorer.
- **The withheld leader: no prompt version is safe** (Codex: "do not call a candidate safe on aggregate points while Case 4 fails"). The claim boundary has to be deterministic.
  - On #1854's own stack, the wire leader gate edited 0 of 18 replies. It rewrites an exact-label claim, but passes paraphrases such as "the £59-at-release path produces the strongest MRR…".
  - See `~/olumi-ai-quality-20260924/stack-1854/RESULTS.md` (AI Quality working folder).
- **FP3 interpreter:** C2 (v0.3) edges C1 on points in cases 4 and 5 (rep 1), but names the leader in 3/3 reps against C1's 1/3. **Not selected**; v0.2 stays.

## Publishing note (public repository)
- **Every UUID** in these files was replaced by a placeholder of the form `00000000-0000-4000-8000-0000000001NN` **after** the runs. The byte hashes recorded in MANIFEST and the ledgers refer to the unscrubbed originals, which AI Quality keeps privately.
- **`blind/PACK.md` and `blind/KEY.json` contained no UUID,** so their published hashes are the committed ones.
- **Home-directory paths** were shortened to `~`.
