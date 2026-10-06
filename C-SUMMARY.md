# Option C — factor review on the Agent lane

CODED. Tests have been written but not run; no commit, push or deployment. The brief assigns tests and commits to the DL.

After a successful Agent-lane PLoT Run, the existing `run_analysis` handler calls the existing `enrichFactors` in-process, inside the `agent_v1_turn` provider policy. Its existing Run fact commit carries `result.enrichment.factor_enrichments`. No table, migration, schema bump or PLoT change.

The existing decision-review press reads one rank-1 confidence question from that persisted Run. Live and replay requests use the canonical selected-Run reader, bound to the same scenario/hash/timestamp as the route readback. Cold reload makes no enrichment call. The internal opt-in field is not forwarded by the graph route, transport enrichment or Agent model context.

Served item: `The result moves most with ‘<factor label>’. A question to test it: <question>`. Questions are framed relative to the model (a question lacking that frame receives `In this model, ...`). Generated observations and perspectives are not served. The question and complete item must survive `survivesReplyEditors`: proposal-id scrub, at-rest split, the #2660 ranking ladder (`dropRankingSentences`), exact option-name guard and `textAssertsLeadingOption`. The route still runs its existing identifier scrub, `enforceAgentLaneLeaderClaimsAtWire` and final `enforceLeaderLicenceAtFinalEgress`. Non-question, numerical/elasticity, best/recommend/winner or multi-sentence generated questions are omitted. No elasticity figure is projected.

## Provider assignment

`EnrichFactorsOptions.modelOverride` is the only new optional per-call adapter option. When omitted, the exact legacy call options and prompts remain unchanged. `/assist/v1/review` is untouched.

The Agent structured construction call uses `budgetFor('gpt-5.6-terra', 'whole').model` and sends that id directly to Responses; it has no extraction-compatible assignment resolver. That id is neither in `MODEL_REGISTRY` nor `EXPLICIT_MODEL_ALIASES`. Following the brief's named-constant fallback, `AGENT_LANE_ENRICH_MODEL = 'gpt-4.1-2025-04-14'` is the registered OpenAI extraction assignment. No environment/default changes. The provider/model assertion is on the real extraction adapter and mocked SDK boundary, plus the policy ledger. The brief carry condition `currentProviderPolicy() === undefined` is unchanged, so this adds no M2 callback.

The enrichment uses the adapter's existing timeout machinery, with a five-second per-call limit. Failure/refusal/timeout omits the new member and leaves the completed Run intact. Upstream rank/identity remain authoritative; model output with a different rank/identity is not stored.

## Every file touched

1. `src/services/review/enrichFactors.ts` — optional model override pass-through; default call byte-equivalent.
2. `src/orchestrator-v5/agent-lane/factor-review.ts` — new Agent-only producer, sensitivity/rank normalisation, registered model constant and persisted-array validation.
3. `src/orchestrator-v5/tools/handlers/run-analysis.ts` — call producer before the existing Run fact validation/commit and attach its successful result.
4. `src/routes/scenario-graph-analysis-read.ts` — opt-in internal read of the same selected persisted Run under the existing result-binding gates.
5. `src/orchestrator-v5/agent-lane/decision-review-press.ts` — guarded rank-1 press item, before existing review items.
6. `src/routes/agent-v1-turn.ts` — read persisted enrichment for live/replay review presses and check the same Run identity.
7. `src/orchestrator-v5/agent-lane/__tests__/factor-review-served.test.ts` — required rows and additional failure/timeout/conventional controls.
8. `C-SUMMARY.md` — this handoff.

Existing untracked `CODEX-BRIEF.md`, `MC-DESIGN-NOTE.md` and `tests/integration/mc-probe.factor-review-wire.test.ts` were left unchanged. No existing test was edited or re-pinned. Route source-scanner assertions concerning compose-site count, read-cache writers, turn fences, host lines, disclosures, instructions and final egress ordering remain unchanged by the wiring.

## Field writers and readers

New Run path:

- Producer: `factor-review.ts:agentFactorEnrichments` calls `enrichFactors`; the extraction adapter validates the per-call assignment and records `extraction.openai` inside the existing policy ledger.
- Field writer: `run-analysis.ts:createRunAnalysisHandler` adds `factor_enrichments` to the existing Run enrichment before `RunAnalysisHandlerFactSchema.safeParse`.
- Existing persistence carrier: `chip-click-dispatch.ts` / `turn-executor.ts` pass `handler_facts` through `commitDirectAnswer` → `appendCheckedGraphWrite` → the session store's existing `append` / atomic Run-fact write. No independent writer or second store.
- Persisted reader: `scenario-graph-analysis-read.ts:readScenarioAnalysis`, only with `includeFactorEnrichments: true`, reads the canonical selected fact's `result.enrichment.factor_enrichments`. Default callers do not receive the internal property.
- Validator: `factor-review.ts:readFactorEnrichments` validates the stored array for that reader and the press.
- Internal consumer: `agent-v1-turn.ts:persistedFactorReviewFor` checks the selected Run against the route's current bound Run and passes the array to both live/replay `decisionReviewFor` calls.
- Prose consumer: `decision-review-press.ts:factorReviewPressLine` selects the engine's rank-1 factor, resolves its label against the graph and emits only its guarded confidence question.

Existing field path, retained:

- `assist.v1.review.ts` writes `ReviewResponse.factor_enrichments`; its default model resolution is unchanged.
- `schemas/review.ts` declares the optional response array.
- `context/enrichment-manifest.ts` enumerates it, assigns it to the CEE panel and excludes it from Agent context. The transport keep-list still omits it.
- Generic Run persistence/read infrastructure carries opaque enrichment; the wire projection continues to omit this member.
- External readers/writer recorded in the design note (not changed here): PLoT `run.ts` review response writer; DGAI `useResultsSectionData.ts` → `DriversSection.tsx`. This implementation does not rely on those surfaces being mounted.

## Rows and base expectations

- **(a) RED at base:** the real Run handler + existing commit writes no factor enrichment, and the real Agent review press has no factor item. Assert one exact item and no raw elasticity.
- **(b) RED at base:** the Agent Run makes no extraction call today. Assert the extraction adapter's exact override, resolved provider/model, mocked OpenAI SDK model and one allowed `extraction.openai` ledger row, with zero Anthropic calls.
- **(c) Legacy control:** exercise the actual `/assist/v1/review?schema=v2` route under `claude-sonnet-5` configured extraction; assert no override and the Anthropic SDK model. Behaviour should remain unchanged at base.
- **(d) No-sensitivity control:** no stored member, no served item, zero extraction calls/ledger rows. Behaviour should remain unchanged at base.
- **(e) RED at base:** discard in-memory row references via JSON round-trip; the canonical persisted reader and served press have no stored enrichment today. Assert the same words and zero new SDK/extraction calls.
- **(f) Must-fail controls:** planted best/recommend/raw-elasticity questions are confirmed present in the persisted enrichment, then withheld by the press and served route. The positive stored-data premise is RED at base; once the producer exists, removing the question guard must make the unsafe-output assertion fail.
- Additional controls: conventional Run makes no enrichment call; SDK failure and a hung SDK call leave the completed Run intact, with the latter bounded by fake-time advancement over the existing adapter timeout.
- Source wiring row: both live/replay press calls use the persisted reader and the brief gate stays shut.

Applying the test file alone to base also fails imports for the new internal helpers; the behavioural RED reasons above are the intended producer/write/read/consumer discriminators, not a claim that base was tested here.

## DL validation

Run the new `factor-review-served.test.ts`, existing decision-review press/route rows, Run handler rows, canonical scenario-analysis read/serialisation rows, source scanners, and required checks. No vitest, sysctl or commit was run in this sandbox. `git diff --check` was clean; test, CI, served and journey evidence remain unverified.
