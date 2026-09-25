# AQ-FMC-0.1 prereg addendum 2 (about 00:52Z, 25 Sep, before any paired output existed)

## Why addendum 1 is replaced
- F's joined H trajectory built a model: 16 nodes, 24 edges, admitted as comparative_leader.
- Its automatic first analysis then DISPATCHED a Run. The in-process double cannot answer a Run faithfully, and the real runner reads and writes the shared persistence layer. So F/D1 is BLOCKED_PRECONDITION.
- Therefore an in-process H attempt at R can only end one of two ways:
  - refused (as R/D1 was), or
  - blocked (as F/D1 was).
- So addendum 1's in-process "D1b" cannot supply D2's precondition. It is **replaced**:
  - **The H model is built once on served staging** (c673223, OpenAI only, asserted), where the first analysis really runs. One retry is allowed if the build is refused.
  - **D2 runs in-process at R** against that served state, replayed by the double's `served` mode, with history seeded from the served construction exchange.
  - D2 is paired only if a dry-run fidelity check shows the Agent's `get_canonical_state` result carries the served graph, `leader_claim`, `run_state` and `analysis_result`. Otherwise D2 is **NOT_FAITHFUL** and reported BLOCKED_PRECONDITION.

## Development states
- The development states are D1 (R's genuine refused H construction reply), D2 (if captured faithfully) and D8.
- No D1b is paired. The served construction's final hop is not observable: the served route does not expose model inputs.
- `select.cjs` keeps D1b in its list only as a no-op; it is absent from the data.
- The mean gain is taken over captured development states. None is dropped after its outputs are seen.
