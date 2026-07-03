# Handoff — swapping live callers onto the shared robustness candidates

**Status: FINDINGS + PLAN ONLY. No live caller was changed on the quarantined
branch.** Each swap below touches MVP-activation-path files and needs its own
approval + review; all three are behaviour-preserving refactors IF the listed
parity evidence holds at swap time.

## 1. `m2-review.ts` inline model gate → `resolveModelStrict`

- **Candidate**: `src/cee/dual-model/resolve-model-strict.ts` (decision logic in
  the pure `src/cee/dual-model/model-resolution.ts` `checkModelResolution`).
- **Parity evidence**: `model-resolution.test.ts` mirrors the m2-review gate table
  (unset / non-Anthropic provider / mismatch / exact match / fixtures);
  `resolve-model-strict.test.ts` pins resolver-exception propagation (m2-review
  lets `getAdapterWithResolution` throws escape to the `internal_error` backstop).
- **Swap shape**: replace the inline `configuredModel` / provider / exact-match
  block in `reviewDraftGraph` with one `resolveModelStrict('m2_graph_review',
  configuredModel)` call; map `kind` onto the existing `M2ReviewResult`
  `model_not_resolved` causes (identical strings by construction). The warn-log
  lines currently live inline — either keep them at the call site keyed off the
  result, or accept the pure helper's no-logging posture and log in m2-review.
- **Risk**: low; the only observable surface is the three cause codes + detail
  strings on telemetry. Verify detail-string consumers (dashboards) tolerate the
  slightly different `detail` phrasing or preserve the original strings at the
  call site.

## 2. `merge.ts` module-private `wouldCreateCycle` → `dual-model/graph-cycles.ts`

- **Parity evidence**: `graph-cycles-equivalence.test.ts` proves the candidate
  behaviourally identical to the merge's version through public `mergeProposals`
  over enumerated graph families (chains, diamonds, bidirected mixes, same-batch
  closures) and equivalent to `graphGuards.detectCycles` for every candidate edge
  on acyclic bases.
- **Swap shape**: delete the private function, import the candidate. Signature is
  identical (`edges, from, to`); the candidate adds an explicit `from === to ⇒
  true` arm that the merge never reaches (self-loops rejected earlier) — a
  documented no-op for this caller.
- **Import-direction note**: this makes live dual-draft import from
  `src/cee/dual-model/` — flipping the branch's quarantine invariant. Do it only
  when dual-model is accepted as a permanent live namespace (or move the utility
  to `src/utils/` and re-export).

## 3. `graphGuards.detectCycles` callers → shared predicate

- **Finding, not a plan**: `graphGuards` and the merge DIVERGE on dangling-endpoint
  edges (`detectCycles` DROPS edges whose endpoints are missing from the node
  list; the merge has no node list — its `edge_endpoint_missing` guard runs
  first). Pinned in `graph-cycles-equivalence.test.ts` ("documented divergence").
  Any consolidation must decide which semantics win per call site;
  `breakCycles`/`findIsolatedNodes` stay on the node-aware implementation
  regardless. **Recommendation: leave graphGuards alone**; the shared predicate is
  for NEW code and (optionally) the merge swap above.

## 4. `proposal-accounting.ts`

No live swap target — `tallyFromMergeReport`/`checkTallyInvariant` are for future
dual-model stages and dashboards. The property test doubles as a standing
regression tripwire on the merge's exact-one-bucket contract.

## Also recorded while tracing (do not fix here)

- `router.ts` `getAdapter` docblock states a stale precedence order
  (providers.json listed ABOVE `CEE_MODEL_*`; effective behaviour is per_call →
  store_model_config → env_var → task_default → providers_json →
  llm_model_fallback, failover short-circuiting as `llm_model_fallback`). See the
  adversarial findings register.
