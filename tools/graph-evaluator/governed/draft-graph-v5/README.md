# Governed `draft_graph` V5 evaluation pack

This directory is the only evaluation authority for a `draft_graph` prompt-quality claim on serving build `b9389df`. It freezes the exact PMS v195 bytes, ordered code-owned prompt layers, model assignment, production records contract, V1-to-V3 transform, canonical readiness authority, and exactly 14 ordered briefs.

Status: **BASELINE FROZEN — CANDIDATE HOLD WITH EVIDENCE.** No candidate prompt bytes were created and no PMS, model, cache, environment, or serving configuration was changed.

## Frozen baseline outcome

The single authorised pass used `claude-sonnet-4-6`, exactly 14 logical primary calls, no manual retries, and at most one adapter-owned additive completion per case. All 14 calls returned through the production records adapter with structured outputs attested, but only 1 of 14 projected graphs passed canonical analysis readiness. The readiness authority reported 91 blocking findings: 46 missing option values, 26 orphan nodes, and smaller sets of unreachable controllable factors, graph-cap breaches, missing goals, unmapped options, missing option-to-factor edges, and one missing path to the goal.

Equivalence is deliberately narrow: the pass attests the first-primary prompt composition and model under the pinned direct-adapter configuration. It does not claim byte equivalence for the whole HTTP route or request. The frozen result's older `request_bytes_and_model` label is governed by this narrower scope; its captured cases and reported measurements remain byte-for-byte unchanged.

Provenance classes were present on every node and edge, but 136 AI-inferred elements were unbased. The projector emitted 156 refusal disclosures; the live `AnthropicAdapter` wrapper drops that sidecar, so none survives to the serving route. This is reported as `RECORD_DISCLOSURE_UNSURFACED`, not hidden or scored as a prompt success.

The retired raw-graph rubric could score only 5 of 14 records-contract graphs. Its topology validator rejected legitimate/current shapes such as factor-to-goal links, so its 0.6423 mean over the five scorable cases is informational only and cannot authorize promotion. Production adapter success, canonical readiness, provenance and disclosure survival are the governing axes.

Total primary-path latency was 360.3 seconds: mean 25.7s, p50 23.1s, p95 37.1s, maximum 38.1s. Reported usage was 28,522 regular input tokens, 19,934 output tokens, 17,566 cache-creation input tokens, and 228,358 cache-read input tokens. Applying the model file's base rates to all reported input categories gives a $1.122 configured-rate estimate; exact cache-tier and additive-completion costs are not surfaced by the adapter result. The run remained below the authorised $3.40 cap.

## Why candidate work is held

- Only the forced-binary brief was canonically ready. Richer strategic work is materially less likely to reach downstream science, while narrow framing is easiest to operationalise.
- The exact serving SHA produced `draft_graph_cee_graph_invalid` in automatic run 31931611366, then succeeded minutes later in run 31931789517. The same failure also occurred before the science change in run 31876646668. Reliability is stochastic and cannot be erased by selecting the successful rerun.
- The old scalar quality measure has only 5/14 coverage and can reward ungrounded numeric diversity or superficial completeness. It is executable for diagnosis only: even complete matched gains cannot authorize promotion until a grounding-sensitive positive-quality authority is governed.
- The live wrapper suppresses all generated projector disclosures. Improving prompt bytes while users remain unable to see refused assertions would optimize around a downstream authority loss.

The frozen result, including safe graph captures, per-case scores, exact identity, failure taxonomy, latency, token and cost evidence, is `baseline/run-b9389df-claude-sonnet-4-6.json` and is hash-pinned by `manifest.json`.

## Reproducible workflow

1. Run `npm run governed:draft-graph:verify`. Any prompt, code-layer, corpus, model, evidence, disposition, or result hash drift is a hard stop. Verification deterministically re-scores every frozen capture and recomputes the summary, so re-hashing edited precomputed values does not establish trust.
2. Use `npm run governed:draft-graph:rescore` only to re-run deterministic local scoring over the frozen captures. It makes no provider call; a controlled manifest hash update is required afterward.
3. Do not re-run the live baseline, manually retry a case, or add a candidate arm without a new bounded authorization and a newly frozen result identity.
4. A future candidate must have a distinct path and SHA-256 pin, then use the same 14 briefs in exact order, model, production adapter, records grammar, completion policy and composition. The comparator re-scores both capture sets and enforces adapter, structure, readiness, provenance and disclosure non-regression. Identity, configuration, coverage, stored-evidence or disclosure ineligibility is always `HOLD` and dominates any simultaneous regression signal. Only an otherwise exact and disclosure-complete pair can `FAIL` an authentic replayed non-regression breach. An eligible non-regressing pair remains `HOLD: QUALITY_AUTHORITY_UNAVAILABLE` until a separate grounding-sensitive positive-quality authority is governed; legacy score gains never produce `PASS` or a quality `FAIL`.

## Legacy disposition

- **KEEP:** exact v195 baseline snapshot, current production records/readiness authorities, and the old scorer only as a labelled informational diagnostic.
- **REPLACE:** the raw draft runner and raw provider adapter for any governed quality or promotion claim.
- **QUARANTINE:** historical prompt experiments and the stale topology-plan reminder; archaeology only.
- **REMOVE:** one byte-identical v175 duplicate and the two ad-hoc staging briefs from governed selection. Files remain untouched pending controlled review; the verifier proves they cannot enter the canonical 14.

See `legacy-disposition.json` for the itemised matrix, `failure-taxonomy.json` for failure semantics, and `deployed-evidence.json` for the pinned staging observations.
