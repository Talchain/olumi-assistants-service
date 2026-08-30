# Factor Quantification v3 mechanism controls

Exact CEE head: `fc358ca02bf11e64020b0de230c25334cb4763b3`.

The positive uses an explicitly defined planning day, historical mean available count 15 of 20, reported daily share standard deviation 0.05, and an explicit same-process transfer assumption. The original ambiguous current-day snapshot remains a separate acceptance control; this run does not relabel it as a valid distribution.

- Base: GREEN.
- Discard parsed estimator output before adoption: RED.
- Drop adopted standard deviation: RED.
- Drop adopted AI provenance: RED.
- Change only descriptive gap wording: GREEN.

Each invocation collected eight assertions and executed exactly the single named positive (seven skipped). Each RED came from the persisted canonical observed-state equality in dispatch.test.ts:155, not setup or collection. Both source worktrees are clean after restoration, and the root remains at the original exact head.

Evidence scope: mocked adapter with real records replay, dispatch, model wrapper, structured parsing, canonical commit and in-memory reload. This does not witness a provider call, durable database, PLoT/ISL consumption or user exposure. No merge or release clearance is implied.

`run-mutants.py` is the replay harness; `report.json` contains exact hashes/commands, each mutation has its patch and raw Vitest output, and `verification.json` asserts collection and canonical failure location.
