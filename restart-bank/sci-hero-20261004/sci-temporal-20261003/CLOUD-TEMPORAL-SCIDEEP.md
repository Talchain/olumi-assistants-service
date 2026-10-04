# Claude Cloud brief: SCI-TEMPORAL (ranges / uncertainty) — consolidated launch brief, rev 2
DL 9d9666, 3 Oct 2026 ~17:45Z. Replaces rev 1 per PTL #87 5971314219 + 5971341049. TEMPORAL SCOPE ONLY (SCI-DEEP has its own brief). One session. Staging only, no users.
Repos: CEE Talchain/olumi-assistants-service · ISL Talchain/Inference-Service-Layer · PLoT Talchain/plot-lite-service. Board: olumi-programme-docs #85 (posts) / #87 (queue); read the newest 40 on each with `?since=`. Rule: anything below marked UNVERIFIED must be re-derived from source before you rely on it.

## BASELINE (re-derive before acting)
Served at 17:30Z: UI f6507480 (+ #2456 030f993c deploying) · CEE b31389c7 · PLoT 8f9e45a6 merged (serving proof owed) · ISL f759de5f.
User-visible goal: the user gives a range ("likely 5–20 days, most likely 10"); it is stored as theirs, carried through the analysis, and shown with honest uncertainty.

## EXISTING WORK TO REUSE (do not rebuild)
- CEE #2382, branch `claude/focused-ritchie-vf0xpz` @ e7f365a6ab4beb048660680578e1c8231736cb46 (OPEN). Round-1 fixes confirmed.
- Follow-up branch `sci-temporal/range-elicit-most-likely` @ ea52aa70a7c83c167adcaefe995bb1126ececd3a: asks for the most likely figure, decided by the typed `most_likely_stated` field; 21/21 rows at the time. Open its PR only after #2382 merges.
- The existing uncertainty carriers (range fields on option interventions; `levelFigureOf`; the inheritance guard in `encode-option-interventions.ts`). Extend these; add no parallel carrier.

## CURRENT P1s (Codex CR round 2 on #2382; line numbers are approximate, derive them)
1. A capless factor drops the approved range (`agent-capabilities.ts` ~859: `levelFigureOf` returns `{}`). Carry the range independently of the cap, or refuse before approval. Real-door test bound to option and factor ids.
2. The stale-range guard is bypassed on numeric whole-map edits (`encode-option-interventions.ts` ~586): "10 days → 10 weeks" keeps the old 5–20. Extend the inheritance guard; rows for unit changes and fresh replacements.
3. The earlier review also recorded a natural-language regex door (4 P1s at round 1). Confirm at the current head that no wording regex decides range behaviour; typed fields only.
Also fix the stale module comment about the conversion-loss fallback.

## REGIONS / EVIDENCE CONTEXT (meaning to carry; context only, nothing to port)
SCI-REGIONS (Codex 01a0e8bb) is a CONTEXT SUPPLIER, not a lane. Bank: `output/sci-regions-restart-20260930/` on the Mac (HANDOFF.md, cases.json, contrastive-vulnerability.json, contrastive-coaching.md, sci-repository.bundle). Frozen sources: 68e8c8874eed528422db186852d3a5a1da9a27da (contrastive) and cef7f7c66f1653d5006194f297fbb1eda6c14392 (typed two-case). If the bank is not reachable from Cloud, ask 01a0e8bb on #87 for the specific case; do not ask it to execute.
- What it showed: on one frozen case (41 × 41 evaluated grid, two uncertain inputs) each input alone still reaches the goal, both together miss. That is an **additive trade-off on evaluated points**. It is not an interaction, a probability, a recommendation or an exhaustive boundary.
- Rules that follow for ranges: (a) hard feasibility (a limit) and goal attainment are separate facts; never merge them into one verdict. (b) A range has a declared domain; outside it the answer is NOT_EVALUATED with a null figure. (c) Zero means "no effect", never "unknown sign". (d) Sign reversal is NOT_EVALUATED unless the user's range admits both signs.
- Reusable tests: use the frozen case as an identity-bound regression fixture when two user ranges combine (each alone attains, both miss). Do not port the grid, renderer or evaluator.
SCI-EVIDENCE (#75 5912672141, docs branch `claude/friendly-fermi-ocqwco` @ ea0d9fa5): the direction of an Olumi-signed link was decision-relevant only when today's level was high (≈4%+), not at Olumi's 3%. Consequence for you: provenance decides wording. A user-stated range is theirs; an Olumi estimate stays labelled as Olumi's; say which uncertainty is worth checking first only from a computed result, never from wording.

## EXACT FIRST TASK
On #2382's existing branch (merge commit from staging, no force-push): one RED row per P1 (1 and 2), bound by option id + factor id, then the fix, then one mutant per fix. Post a LEASE first listing every reader and writer of the range fields and the exact hunks.

## FILES / HUNKS and COLLISIONS
- `src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts` and `src/routes/agent-v1-turn.ts` are CEE hot files: sole writer = Delivery Executor 01a0ff01. Hand those hunks over as a patch on #87; do not push them yourself.
- Runtime owner 01a0fec3 is active in `src/utils/request-timing.ts` and `src/adapters/llm/types.*` (Runtime-L1). Stay out.
- Core B3 gap work (B/Action 01a0fcdb, #2530) touches freshness/graph-hash. If a range change must invalidate a saved Run, raise it with that owner; do not add a second freshness rule.
- ISL #220 → PLoT #431 → CEE #2522 (SCI-CHANGE) belongs to the ScienceUI remote session. Do not edit it.

## TESTS
RED-first rows + discriminating mutants; identity-bound; focused tests at `--maxWorkers=2`; the repo's own pre-push gate; required CI. No full local suites (Paul: PoC throughput). Known-invalid maths blocks a merge; wording review never does.

## DO-NOT-DUPLICATE
No new science engine, grid, renderer, dashboard or sensitivity lane. No VOI/EVPPI work (out of the PoC). No revival of SCI-REGIONS. No second leader authority (Shared Data #2533 is the only one). No new feature flags.

## EXIT
#2382 merged and served with P1s 1–2 closed (Codex pre-review 0 P1; Executor merges), then the most-likely follow-up PR merged and served, then one served witness row: a user range entered → stored as theirs → survives a unit edit correctly → shown after reload. Report rungs honestly (TESTED / MERGED / SERVED / JOURNEY-WITNESSED). Board posts ≤5 lines; checkpoint to your branch at every milestone.
