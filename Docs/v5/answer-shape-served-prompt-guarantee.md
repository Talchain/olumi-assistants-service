# answer_shape production instruction — where the guarantee actually lives

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
