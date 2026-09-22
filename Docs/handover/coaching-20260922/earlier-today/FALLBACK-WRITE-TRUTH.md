# Is the fallback (CEE) route trustworthy on write/receipt truth?

**Verified 22 Sep 2026 at deployed staging `bd35cc9e` (post-#1659).** Relevant because the
CEE route is now the hedge, not the architecture being perfected — so the question is whether
it can be trusted while the primary test runs, not whether it is ideal.

## Answer: yes, and by a stronger mechanism than the one #1659 landed

**#1659's guarantee is dark.** `constrainProseToWriteOutcome` / `writeTruthfulnessOf` are
wired only at `replacement/turn-entry.ts:490-491`, and the replacement path cannot persist
state at all — `v5_replacement_state` returns **404** against a working **200** control on
`scenarios`. That matches Codex's own scoping: *"this approves the dark module and its
integration contract; it is not evidence that the feature is enabled or safe to enable."*

**The live route does not rely on constraining model prose after the fact.** It composes
post-write copy **deterministically** — `d1-shared/format-confirmation.ts`
(`formatEdgeStrengthConfirmed` and siblings), `structural-delete.ts:206 buildConfirmationText`
— consumed by `set-factor-value.ts`, `edge-strength-edit.ts` and `turn-executor.ts`. The
model is not the author of the confirmation, so there is no model claim to police.

## The unbacked-claim path is ENFORCING, not observe-only

`turn-executor.ts:14380-14393`, on a registration claim the mutation does not back, takes
**three coordinated actions** rather than only fixing the sentence:

| action | effect |
|---|---|
| swap the text for the honest fallback | the user is told it was not registered |
| `graphForCommit = undefined` | **the graph write is withheld**, so stored state matches the honest text |
| `handlerFactsForCommit = []` | **the "applied" receipt fact is withheld** |

That third one is the subtle and important one, and the code says why: committing an
`applied / noop:false` receipt while withholding the graph write would ground the *next*
turn's model on a phantom edit, because `recent_changes` / `prior_facts` readers have no
persisted graph to cross-check against and take the receipt at face value (recorded as a
DL-7 violation).

No `config.` or `process.env` gate on that branch — **unconditional**.

## What this does and does not establish

- ✅ On the live route, a write that does not land cannot leave behind honest-looking
  confirmation copy, a persisted graph, or a receipt.
- ⚠ It does **not** establish that every user-visible claim is write-backed — only this
  registration path was traced. The broader "model says 'That's saved.' in free prose"
  concern Codex raised on #1659 applies to the replacement path's model-authored text, which
  is dark, and is not a live exposure today.
- ⚠ Verified by reading the deployed source, not by a live witness of a refused write.

## Correction recorded

I first searched for `constrainAssistantTextByWriteOutcome` — the name from Codex's
verdict prose — got zero hits across the whole tree, and briefly took that as the module
having been lost in the merge. The symbol is `constrainProseToWriteOutcome`; the verdict
paraphrased it. A contrast control on the containing module caught it before it became a
claim. Searching for a reviewer's wording rather than the code's identifier is the same
class as grepping a stale tree: the probe was measuring my paraphrase.
