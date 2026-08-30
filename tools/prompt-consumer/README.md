# Bounded prompt → consumer checks

This follow-on does not gate or activate #1228. No production prompt execution
imports this tool. It registers three seams from the existing runtime-task
authority: draft records (including structural completion), readiness recovery,
and edge validation. Factor Quantification is an interface only until its owner
provides the real task, shared definitions, exports and exact head.

Run deterministic checks:

```sh
pnpm exec vitest run --config vitest.required.config.ts tools/prompt-consumer
pnpm exec tsx scripts/check-prompt-consumer-contracts.ts --out /tmp/contracts-new.json
```

For fresh read-only staging identities, add `--live` with `ADMIN_API_KEY` in the
environment. Fetch the matching deployed source object first. `--deployed-head`
accepts the full deployed SHA when staging has moved ahead of the running service.
Output is never overwritten. Exit 1 means a proven contract failure; exit 2 means
unverified closure. A test expecting a known failure can pass while the contract
command correctly fails.

Each probe calls the actual schema/parser/consumer and asserts meaning, with
semantic-breaking and unrelated-content controls. Full source hashes identify
components; they do not prove correctness. PMS selection, loaded-cache identity,
local provider-bound assembly and deployed behaviour are separate evidence rungs.
Unknown prompt bytes lose their exact semantic-review binding; a word match never
substitutes for review or behavioural evidence. The #1228 emitted-output corpus
remains separate from deterministic fixture tests.

The banked activation report includes old PMS/old instruction, old PMS/new
instruction (code-only deployment), candidate/new instruction, and the destroyed
control. Missing code-only evidence fails coverage. Coverage PASS is not semantic
PASS or promotion permission: the real code-only diagnostic created two options.

Current named failures: requested prior confidence under deployed v10;
AI scalar source relabelled at V3; claim-mediated stated percentage loses its unit
and scale authority. Direct stated percentage and consumed edge uncertainty are
opposite controls, not claims that every quantity path works. Hypothesis
attribution/retention is unverified and not solved by zero options. Cross-service
quantity migration and System B referent/pending-answer routing remain outside
this tool. No new PMS promotion dependency is installed; promotion integration
must wait for independently verified provider/deployment bindings.
