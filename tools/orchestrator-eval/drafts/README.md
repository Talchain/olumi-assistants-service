# `drafts/` — measured prompt drafts that are NOT yet promoted

A file here is a **candidate prompt that has been evaluated but not promoted**.

## Why drafts live outside `Prompts/canonical/`

`Prompts/canonical/*.txt` is the **manifest-bound export**: the promotion gate
hashes those files and asserts the hash equals the manifest's
`cee_content_hash_16`, which is what PMS actually serves. Moving a canonical
export ahead of the PMS promotion would make the manifest lie about the served
bytes, and the gate would (correctly) go `MANIFEST_EXPORT_SKEW`. So a draft that
has not been promoted **must not** sit at the canonical path.

Nothing in this directory is manifest-bound, pack-discovered
(`packs.ts` scans immediate subdirectories of `src/` for `promotion-pack.ts`),
or read by any runtime code. It is evidence.

## Contents

### `decision_review.v15-draft.txt`

- **sha256[:16] `d2267b7ef33b17ee`**, 32,806 bytes.
- Successor to the served v14 (`b4f15305c2bb32e9`, PMS
  `decision_review_default` **row version 14**).
- ⚠ **Naming:** the PMS row this would become is **version 15**. The historical
  authorial label *"v15′"* refers to the CURRENT row 14 — the draft numbering and
  the PMS row numbering are offset by two. See the corrected note in
  `tools/conversation-harness/prompt-estate/revert-anchors/decision-review-revert-anchor.txt`.
- **Measured**, n=21 (7 fixtures × 3 independent arms), `gpt-4.1`, against the
  UNCHANGED 19-dimension pack. Headline vs the v14 baseline at the same n, same
  fixtures, same scorer: clean outputs **7/21 → 18/21**; `no_internal_vocabulary`
  **4 failures → 0**; `no_raw_probability_decimals` **9 → 0**; `no_dashes`
  **3 → 1**; `tone_alignment` **1 → 0**.
- **NOT PROMOTED.** At n=21 it still carries 3 single-instance failures across 3
  dimensions, so the gate's worst-case floor still derives BLOCK. Promoting it
  would require moving the grandfather baseline to the new hash — a deliberate
  loosening of gate posture, which is a reviewed decision and not this lane's to
  take.
- Full derivation, per-iteration numbers and the residual diagnosis:
  `PHASE0-EVIDENCE-2026-07-28/fix-decision-review-v15.md`.

**The derived scoring contract is byte-identical between v14 and this draft** —
same 10 banned terms, same 21 internal-vocabulary terms, same em-dash ban, same 4
tone rows (`parseServedTerminologyContract` / `parseToneTable`). That is what
makes the before/after numbers comparable at all: the measuring instrument did
not move.
