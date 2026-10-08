BUDGET: 2 live draws on Paul's preserved P44 B1 brief; maximum 4 provider attempts total (the existing construction repair may add one request per draw); checked-in construction baseline drafter model and effort; no prompt-store/configuration writes; fake registration dispatch; no database writes; stop on the first 429. No additional live draws are authorized in this lease.

The exact 5b50b4c8 request was not found in the preserved local recordings. The live pilot uses `/private/tmp/accel-p44/lab/b1.txt`, copied byte-for-byte into `pilot-brief.txt` and hashed in `pilot-brief-source.json`. No replacement 5b50b4c8 brief is invented. Its specified hedge/explicit-word cases are covered by deterministic RED-first rows.

The adapted `pilot.test.ts` pins the outgoing provider body to the current `agent-v1-turn.ts` builder, including `strictForTheDrafter`, and records every outgoing prompt/schema hash, provider response, usage, retry and admitted graph. It inherits the original harness limitation of no served turn deadline or usage-ledger write; per-call latency over the nominal served deadline is flagged.

Credentials are read from the existing process environment or the read-only CEE staging Render environment and passed only through a child process environment. The runner never prints or persists their values. It changes no credentials or provider configuration.

The budget uses the checked-in construction baseline, `budgetFor('gpt-5.6-terra', 'whole')`; live staging routing was not independently verified in this execution. Both evidence suites skip in ordinary CI unless their explicit replay/live environment gates are set.
