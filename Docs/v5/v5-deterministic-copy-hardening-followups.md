# V5 deterministic copy / output-safety hardening — follow-up backlog

Durable backlog for items deliberately deferred out of the bounded
deterministic-copy/output-safety lane ([PR #233](https://github.com/Talchain/olumi-assistants-service/pull/233),
branch `claude/cranky-stonebraker-de5508`). None are blockers; recorded here for
the docs/backlog push so they are not lost in PR comments.

## Deferred follow-ups

1. **SC headline telemetry counter.** The soft-confidence enriched headline
   (case `'SC'` in [analysis-result-headline.ts](../../src/orchestrator-v5/coaching/analysis-result-headline.ts))
   emits no telemetry. `run_analysis` only emits `v5.headline.fell_back` for
   `case === 'E'`, so SC is currently measurable only *indirectly* (a drop in
   `fell_back reason:"soft_confidence"`). Add an additive `SC` counter so the
   enriched-headline rate is directly observable. Requires the 4-spot
   `TelemetryEvents` freeze-gate registration — intentionally out of PR #233.

2. **Clarify bold-entity guard scope.** `neutraliseUnvalidatedBoldEntities`
   ([clarify-entity-guard.ts](../../src/orchestrator-v5/compose/clarify-entity-guard.ts))
   is applied only on the LLM **clarify** turn (`turn-executor.ts`, before
   `composeClarifyResponse`). LLM-bolded non-entity fragments in
   **converse/coach `direct_answer`** prose are not guarded. Extend if the
   behaviour is observed outside clarify turns.

3. **Replay-harness forbidden-term propagation.** The runtime additions to
   `FORBIDDEN_USER_FACING_PHRASES` (`context pack`, `turn class`,
   `direct_answer`, `graph hash`, `node id`, `_meta`, `orchestrator`) flow into
   the replay harness via `findForbiddenMatches`
   ([tools/v5-journey-replay/forbidden-terms.ts](../../tools/v5-journey-replay/forbidden-terms.ts)),
   so replay golden transcripts will be scanned against the expanded list. See
   the replay/assertion brief addendum below.

4. **Double "provisional" on partial-status SC headlines.** When `status_kind`
   is `partial`, the SC caution tail and the partial-status suffix both contain
   "provisional", reading "… treat this as provisional … treat as provisional."
   Inherited from the Case A suffix design; cosmetic. De-duplicate the suffix
   wording in a future copy pass.

5. **Distinct soft-confidence wording.** The SC branch reuses the Case A/C
   grammar verbatim (to avoid allowlist/glossary churn), so a soft-confidence
   lead reads like a normal-confidence fragile result. A future structured-
   coaching copy refinement may want explicit phrasing such as "confidence in
   this result is limited", handled deliberately with the matching
   `HEADLINE_GRAMMAR_REGEXES` / glossary changes.

## Replay / assertion brief addendum

- Before running the replay lane, **verify golden transcripts against the
  expanded forbidden-term list** (`FORBIDDEN_USER_FACING_PHRASES`, including the
  PR #233 internal-vocabulary additions). Any golden whose `assistant_text` or
  chip text contains a newly-added term will now fail `findForbiddenMatches` and
  must be re-captured or the term reviewed.
