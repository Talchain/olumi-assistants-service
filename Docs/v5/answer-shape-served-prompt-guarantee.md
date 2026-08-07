# answer_shape production instruction — where the guarantee actually lives

> ## Status re-derived 2026-08-08 at merge (R1 PR-disposition pass) — the served half CLOSED, the fallback half did NOT
>
> This note was written on 2026-07-21 with v118 pending. Both halves re-derived today at the
> bytes, because a governance note about which artefact guards what is worthless if it describes
> an artefact that has moved:
>
> - ✅ **The SERVED prompt now carries the instruction, and it is v120, not v118.**
>   `Prompts/canonical/routing.txt` (the hash-verified export of the served PMS prompt —
>   `manifest.json`: `served_version: 120`, `pms_staging_version: 120`,
>   `cee_content_hash_16: adcc5128d4e6e6bc`, `served_hash_verified: true`) carries the
>   converse/coach `answer_shape` instruction at **line 101**, in substantively the same words
>   this PR adds to the fallback. **The `666d56dd4845e2c7` v118 hash named below is therefore
>   stale — do not use it as a SERVE-VERIFY expectation.**
> - ❌ **The FALLBACK gap this PR closes is STILL OPEN at `staging`.** At CEE `staging`
>   `b5204544`, `Prompts/v40.txt` contains **zero** occurrences of `answer_shape` — and
>   `src/prompts/defaults.ts:2350-2352` still reads that exact file from disk and registers it as
>   the `routing` default (`routing: 'v40'` at `:2388`). So a PMS outage today would silently
>   regress F1 to the #611 defect: the model is never told to emit `answer_shape`, and it arrives
>   only via a `REPAIR_ONCE` round-trip, or not at all.
>
> That split is the whole reason this PR is merged rather than closed as superseded. It was
> queued last in a merge train (`#614 → F1 fallback → belt-delete → #613`) that ended before
> reaching it, and the gap has sat open for 18 days behind a served prompt that looks healthy.
> **The DO-NOT-MERGE label was a state, not a verdict** — it existed because the test was
> deliberately RED until v118 shipped. v118 shipped, then v119 and v120.


Status: governance note (added with #613, the #611 de-fixture). Read this
before trusting any test that mentions the `answer_shape` prompt instruction.

## The two prompts, and why CI can only see one of them

The routing/orchestrator system prompt resolves through
`buildRoutingPromptSnapshot()` → `loadPrompt('routing')`, which is
PMS-backed **with an in-repo default fallback**:

| Path | Source | Readable in CI? |
|------|--------|-----------------|
| **Served** (staging/prod) | PMS `orchestrator_default` — v117, becoming **v118** | **No** — admin-only, not in the repo |
| **Fallback** (PMS down) | in-repo `Prompts/v40.txt` (`routing` default) | Yes — it is a checked-in file |

A CI test can assert on the **fallback** file only. It cannot read the
**served** PMS prompt. This is the exact confusion that let **#611** ship
green: a test that reads like a "served-prompt check" but only ever touched
a fixture-adjacent mirror.

## What guards what

1. **`Prompts/v40.txt` carries the answer_shape production instruction**
   (added in #613, mirroring the v118 delta in
   `parallel-briefs/coach-prompt-v118-candidate/CANDIDATE.md`). This keeps
   the **PMS-down fallback** consistent with v118 — otherwise a PMS outage
   would silently regress F1 back to the #611 defect (model never told to
   emit `answer_shape`, so it only arrives via a REPAIR_ONCE round-trip, or
   not at all).

2. **CI test** `routing-prompt-answer-shape-instruction.test.ts` asserts the
   fallback contains the instruction. It is a fail-loud alarm on the
   **FALLBACK / PMS-down path**. It is **NOT** a served-prompt check and must
   never be read as one.

3. **The SERVED-prompt guarantee lives in the v118 promotion SERVE-VERIFY
   gate**, outside CI, because the served prompt is PMS-managed and
   unreadable in CI. The gate (defined in the v118 candidate pack —
   `parallel-briefs/coach-prompt-v118-candidate/RUNBOOK.md` in the Olumi
   programme docs, NOT in this repo) is:
   - the real-turn served `prompt_hash` equals the expected v118 hash
     (`666d56dd4845e2c7`), proving the v118 content is actually being served;
     and
   - **8/8** sampled live coach/converse turns ship a valid `answer_shape` on
     routing call 1 (no reliance on the REPAIR_ONCE round-trip).

If you are trying to prove the model is producing `answer_shape` in
production, run the SERVE-VERIFY gate. A green CI run proves only that the
fallback prompt would instruct the shape if PMS ever went down.
