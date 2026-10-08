# Event branch: words and occurrence estimate census

Production files owned in this lane:

- `src/orchestrator-v5/agent-lane/goal-chance-estimate-attribution.ts`
- `src/orchestrator-v5/goal-target/goal-chance-licence.ts`
- `src/orchestrator-v5/agent-lane/goal-chance-screen-lines.ts`
- `src/orchestrator-v5/agent-lane/goal-chance-estimate-egress.ts`
- `src/orchestrator-v5/agent-lane/olumi-estimates-feeding-result.ts`
- `src/orchestrator-v5/agent-lane/actions/state.ts`

Root applied the card word tail in `stated-event-risk-draft.ts`. Olumi's occurrence displays whole percentages, preserving the existing user figure formatter. The basis is carried separately by `event_risk_basis_text` and passed to the card words.

The existing relationship count `olumi_estimate_link_count` remains the RC4 link-size count. A separate `olumi_estimate_likelihood_count` is recorded on the Run licence and retained by its agent reader. The line reads `on Olumi's estimates (2 relationships, 1 likelihood)` for mixed estimates and `(1 likelihood)` when the relationship kind is zero. Existing no-likelihood relationship words are byte-compatible.

Independent event risks are counted when their impact reaches the scored goal, including events outside option-lever paths. Malformed event blocks, user occurrences, off-goal events, retained-excluded events and undeclared incoming drivers are excluded. An event is counted once across multiple impact paths. Declared preventers remain supported when their causal parents are absent; structural option/decision parents do not disqualify a root factor.

The named Check estimates action uses the same occurrence items. Its existing RC4 census now includes likelihoods separately and prints the event's card words and basis. This avoids a likelihood-only chance pointing to a zero-estimate disclosure. No likelihood is ranked as a measured driver.

## RED evidence

- `copy-red.log`: five behavior failures and one control pass on unchanged production source. The failing rows were Olumi card words/rounding, missing distinct likelihood count, likelihood-only attribution, stored mixed attribution, and narrator-generated likelihood counts.
- `copy-check-estimates-red.log`: one additional failure on the existing RC4 action census, which reported count zero for a current Run with one Olumi occurrence.

## Final GREEN evidence

Every invocation first ran `node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)"`, used two files or fewer, `--maxWorkers=1 --configLoader=runner`, and `< /dev/null`. Root coordinated an exclusive test lock for each sequence.

- `copy-rc4-green.log`: copy/count rows plus RC4 action wiring, 32 passed.
- `copy-neighbours-census-licence.log`: existing RC4 census and goal-chance licence, 139 passed.
- `copy-neighbours-egress-labelled.log`: estimate egress and labelled-point/sentinel rows, 73 passed.

Final sequence: six test files, 244 passed. Initial `copy-green.log` also captured the earlier 138-pass pair before the Check estimates seam was added; final logs above supersede that validation.

Fourteen focused copy/count rows cover card words, two interior-probability rounding boundaries, separate kinds, zero-kind omission, user/off-goal exclusion, multiple impact paths, supported prevention versus incoming causes, malformed/kept-out/scored-goal scope, summary-form point disclosure, stored Run counts, narrator counts, canonical owed attribution, and the Check estimates action.

## Post-typecheck corrections

An initial source typecheck found inference/narrowing errors in this lane. The analysed graph input now explicitly retains `edges`, and egress explicitly refuses an absent licence before testing its two estimate counts. `copy-typecheck-green.log` is the successful gated `tsc -p tsconfig.build.json --noEmit` rerun.

Root requested two additional boundary controls before changing its card formatter. `copy-posttypecheck-boundary-red.log` records 54 passing existing rows and two expected failures: an interior range 0.001–0.004 was displayed as 0%, and 0.996–0.999 as 100%.

Root corrected the formatter to preserve interior probabilities adaptively. `construction-copy-green.log` is the final follow-up: all fourteen focused copy/count rows and three full construction/register/readback rows passed (17/17), including both boundary cases. The successful source typecheck and earlier neighbour results remain applicable; root is completing the final source-wide typecheck and other required neighbours.

No commit or push. No edits under `supabase/`.
