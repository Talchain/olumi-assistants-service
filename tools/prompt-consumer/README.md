# Bounded prompt → consumer checks

## Lane D operator extension

This is the continuation of #1233, not a new production gate. Nothing here
changes serving prompts, model selection, parsers or consumers. CC alone owns
promotion, rollback, merge and deployment. #1228 remains independent.

The operator keeps five different observations separate: configured task route,
selected PMS bytes/model, loaded cache bytes, local provider-bound request and
deployed/observed behaviour. In particular `/admin/models/routing` is not proof
of the per-call model selected after a PMS override. The #1243 admin harness is
text-only; its disclosure does not make it a records-grammar/consumer replica.

All commands refuse to overwrite an output path. Credentials come from the
environment and are not included in evidence. Sampling uses GET only:

```sh
pnpm exec tsx scripts/prompt-model-quality.ts --observe --out /absolute/new-snapshot.json
pnpm exec tsx scripts/prompt-model-quality.ts --banked --out /absolute/new-replay.json
```

`--banked` re-evaluates the original 54 + 2 emitted-output captures. It makes no
provider calls. Its provenance and invented-measurement failures remain visible;
zero diagnostic options alone is never a hypothesis-preservation pass.

A controlled real-provider experiment is explicit and bounded to one semantic
pair, two directions and incumbent/candidate arms. Commit the runner first, use
a pristine checkout of the exact observed service head, and obtain a fresh
snapshot. The declared settings below request attached grammar for the local
experiment; they do **not** attest deployed environment flags:

```sh
CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true pnpm exec tsx scripts/prompt-model-quality.ts \
  --evaluate --live-provider --runtime-root /absolute/pristine-runtime \
  --runtime-head FULL_40_CHARACTER_SHA --snapshot /absolute/new-snapshot.json \
  --candidate Prompts/candidates/draft_graph_records.txt \
  --out /absolute/new-experiment-directory
```

The additional independent wording control uses
`--corpus tools/prompt-consumer/fixtures/logistics-reworded-v1.json
--pair logistics-disagreement-reworded-v1`. Do not rewrite an oracle after seeing
output. Unknown paraphrases remain `UNVERIFIED`, not a guessed semantic pass.
The closed oracles check proposition identity, attribution, unsupported numbers
and real alternative carriage in both emitted records and actual consumed graph.
Open-ended reasoning quality still needs independent review.

The recorder intercepts the target checkout's own SDK boundary, imports its real
schema/parser/projector/consumer and records their full hashes. It calls the
production draft adapter with explicit preloaded prompt/model, no documents and
a declared timeout. It does **not** reproduce upstream parse-stage retries,
deployment environment, canonical commit, UI or a user journey. Unsupported
provider/configuration, missing request capture or text-only harness stays
`UNVERIFIED`; a known wrong prompt/model/component is `FAIL`.

The promotion packet is evidence for CC, not authorisation. Original incumbent
PMS bytes, exact code and model selection are the rollback pointer. A code-only
state is separately required when code and PMS change together. Cache evidence
needs successful read-only observations spanning source-verified effective
expiry with refreshed loaded timestamps. One anonymous instance is not fleet
convergence. No cache invalidation, promotion or rollback is performed here;
missing post-action evidence remains `UNVERIFIED`.

Replay the original experiment into its manifest and promotion packet without
another model call. Use the same declared settings as the capture (a mismatch
refuses the replay), the original snapshot, and the same pristine runtime:

```sh
CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true pnpm exec tsx scripts/prompt-model-quality.ts \
  --packet --experiment /absolute/new-experiment-directory \
  --runtime-root /absolute/pristine-runtime --runtime-head FULL_40_CHARACTER_SHA \
  --snapshot /absolute/new-snapshot.json --out /absolute/new-packet.json
```

The packet re-runs real functions and source-owned oracles; editing a stored
`PASS` field has no effect. An observed grammar-accepted response is not proof
that every instruction can be honoured. Where the foundation's structural
probes do not match the target source, they stay explicitly historical and the
target structural-compatibility result is `UNVERIFIED`.

## Individual responses and mixed instances

The successor of #1252 adds an offline response-evidence command to this same
operator. It decodes original `/assist/v1/draft-graph` or buffered V5 JSON bodies;
it does not issue requests, activate prompts or load stored PASS annotations:

```sh
pnpm exec tsx scripts/prompt-model-quality.ts --responses \
  --input /absolute/original-response-captures.json --out /absolute/new-identities.json
```

Input format is `olumi.prompt-response-observations.v1` with `mode` (`observed`
or `simulation`), the existing `ServingConfiguration` comparison reference,
`captures`, and `settling` (null unless its authority is known). Each capture
retains `observedAt`, actual `url`, `httpStatus`, expected `requestId`, original
JSON `body`, full `bodySha256`, and optional same-response `serviceBuild` header.
Do not turn a saved graph or reconstructed body into an observed HTTP capture.
Body digests detect corruption; they are not signatures or proof of origin.

The decoder reads identity only where that response actually carries it. A
configuration reference, administrative snapshot or supplied PASS callback
cannot fill an absent instruction, provider-returned model or consumer witness.
The existing V5 response-hash algorithm checks trace/body correlation; a missing
trace is UNVERIFIED and a contradictory trace is FAIL. A hash prefix is reported
as that limited correlation, not upgraded to a full cryptographic attestation.

Every instance retains its own response identities. A:X and B:Y are MIXED even
behind one nominal deployment. Matching samples need two distinct responses per
observed instance spanning the known effective cache expiry, with observed cache
reload. `settling` specifies `notBefore`, `effectiveExpiryMs` and a source
component reference; before-cutoff observations remain in the report. Duplicate
bodies do not count twice. Serving/promotion current-response levels reuse the
issued fleet's **non-deduplicated** window only after validating the complete
receipt collection, mode and configuration. Historical selection differences
remain visible without becoming current-cache failures; corrupt or unbound
history still fails integrity. Without a bound fleet window, all supplied
responses participate. An empty current window is UNVERIFIED, never PASS.
Optional `expectedInstanceIds` is a requested sample
set, not an authoritative fleet inventory. The existing `instance_id` is a
prompt-loader process marker, not a platform inventory. Matching observed instances never
means universal deployment convergence.

At inspected source `87f3e43ece5306e28336bd068dc8007a40b209a5`, complete mounted
response identity remains UNVERIFIED: the adapter does not retain full
provider-returned composition/attempt lineage, and V5 drops instance/cache data.
The precise production telemetry boundary is recorded in the successor evidence
handoff. This tools-only change does not add that instrumentation. The separate
local-response replay checks immutable provider bodies through the real parser
and immediate graph consumer; it does not certify final canonical consumption,
deployed traffic or reasoning quality merely because identity matches.

Primary has explicitly deferred the production telemetry boundary until
post-Monday ([ruling](https://github.com/Talchain/olumi-programme-docs/issues/26#issuecomment-5479713730)).

Exit 1 means a detected contradiction; exit 2 means incomplete proof. Only CC
can assign/integrate serving instrumentation and perform promotion or rollback.

## Existing structural registry

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
