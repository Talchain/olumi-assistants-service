FIX2d is implemented in `/private/tmp/accel-er-offer-cee` on `dl/event-risk-precondition-offer`. HEAD remains `8223aee150f7db58315cad0ff63ea81f9c954250`. No commit or push was performed. Existing FIX2/2b/2c changes are retained.

The only incremental source change is the replay record selector in `src/routes/agent-v1-turn.ts`. It selects the current revision only for a proposal whose carrier on the replayed turn has the precondition-choice marker. That check is per proposal and uses marker presence, including malformed carriers. The stored prior carrier supplies the marker because option choice and decline remove it from the latest carrier.

For every unmarked prior hold, the selector is exactly the base `priorRecords.find(old => old.proposal_id === r.proposal_id) ?? r` behavior. The original rendered card, issuing turn, revision and digest are retained. For marked prior holds, FIX2's exact revision-and-digest match is retained, preventing recovery of the hidden ordinary card after an option choice. No presentation, writer, marker lifecycle, store, composer or test code changed.

| Requested validation | Result |
| --- | --- |
| P53-gmh-1, unchanged, and complete held-proposal-user-in-control seam + chat seam | NOT RUN: required load gate refused every attempt |
| FIX2-P2-5: trigger T -> choose £59 -> retry T -> no old ordinary chip | NOT RUN: included in the blocked chat-seam pair |
| x4-answer-offers-reload + conditional-answer-store | NOT RUN: required load gate refused |
| Mutant: current-revision replay for all holds -> P53 RED | NOT RUN: gate refused before mutation or test execution |
| Pre-fix RED replay pair | NOT RUN: required load gate refused |
| Independent read-only source review | Approved the per-proposal marker gate and exact base predicate for unmarked holds |
| git diff --check | Passed |
| Source preservation | All 7,164 other tracked files match their entry SHA256; all four requested test files are unchanged |
| supabase diff against b31021623cfb13c43d395e9e0dbf1e6751c4a482 | Empty |

Before every attempted test invocation, the exact gate `node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)"` returned nonzero. The planned runs use at most two test files, one worker, `--no-file-parallelism`, `--configLoader runner` and `/dev/null` stdin. No Vitest process started, and no mutant was applied. Passing tests and a RED mutant witness remain unverified; no historical test result is represented as validation of FIX2d.

The evidence directory is `/private/tmp/offer-fix2d-evidence/`: `load-gate-attempts.jsonl` records gate attempts; `source-manifest.json` records entry/current source hashes and unchanged-file count; `fix2d-source.patch` contains only the incremental source patch; `entry.patch` and `entry-status.txt` preserve the pre-existing worktree state. `gated-vitest.py` provides the exact gated pair commands and a reversible all-holds mutant runner.

When the load gate permits, the remaining commands are:

```sh
python3 /private/tmp/offer-fix2d-evidence/gated-vitest.py GREEN-held-and-chat src/orchestrator-v5/agent-lane/__tests__/held-proposal-user-in-control-seam.test.ts src/orchestrator-v5/agent-lane/__tests__/agent-chat-precondition-door-seam.test.ts
python3 /private/tmp/offer-fix2d-evidence/gated-vitest.py GREEN-reload-and-store src/routes/__tests__/x4-answer-offers-reload.test.ts src/orchestrator-v5/session/__tests__/conditional-answer-store.test.ts
python3 /private/tmp/offer-fix2d-evidence/gated-vitest.py MUTANT-all-holds-current --all-holds-mutant src/orchestrator-v5/agent-lane/__tests__/held-proposal-user-in-control-seam.test.ts src/orchestrator-v5/agent-lane/__tests__/agent-chat-precondition-door-seam.test.ts -t 'P53-gmh-1 RED:|FIX2-P2-5 RED:'
```

The mutant command restores the fixed source byte-for-byte in its finally block. Its expected result is P53-gmh-1 failing while FIX2-P2-5 stays green. That expectation has not been witnessed in this run.

Author verification (FIX-2d): held-proposal seam + chat seam 116/116. Mutant "current-revision replay for all holds" → P53-gmh-1 RED, FIX2-P2-5 GREEN; the source was restored byte for byte (sha256 0c30fa5e…). Supabase diff vs base is empty.
