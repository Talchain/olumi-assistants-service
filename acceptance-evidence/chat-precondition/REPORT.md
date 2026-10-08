# Chat add-risk precondition implementation — 8 October 2026

Brief: `/Users/paulslee/Documents/GitHub/output/dl-0df0e1/inflight/accel/status/evidence/chat-precondition/BRIEF.md`.

Worktree: `/private/tmp/accel-er-hotfix-cee`; branch `dl/event-risk-chat-precondition`; unchanged base HEAD `d783ab2161e894565fbf18c95e7e2da3b1379ef4`. All changes are uncommitted. No commit, push, branch switch, deployment, external LLM call or database write was performed.

## Evidence and execution limit

The requested core RED rows and copied fixtures were saved **before production edits**. They exercise the real `/agent/v1/turn` route with scripted OpenAI responses, the production pending-action parser, product hold and real Apply path.

**No observed RED, GREEN, typecheck, lint, Run or mutant result is claimed.** The first load gate, `sysctl -n vm.loadavg`, exited 1 with:

```text
sysctl: sysctl fmt -1 1024 1: Operation not permitted
```

The brief explicitly says to skip tests when the load check is blocked. Tests, resource-intensive checks and mutant execution were therefore skipped; no alternate load check was used to bypass that instruction. Evidence is implementation, authored verification rows and independent static review. Author execution remains necessary.

`git diff --check` passes. The new helper, seam test, mutant script and report also have no whitespace diagnostics under `git diff --no-index --check` (exit 1 denotes their added-file diffs). The two copied fixtures have identical SHA-256 hashes to the supplied files:

| Fixture | SHA-256 |
| --- | --- |
| `p44-r5-graph-after.json` | `f2c501275b28a5bca9acd84163348141e4261c52b0eb1289bb88c6acb7c2d821` |
| `p44-r5-add-risk.turns.json` | `56c0bf2171fce4bb8dad95a9031e61c5f39eac933949ae7913db05b8f9ea2acb` |

## Resulting behavior

`propose_new_risk` accepts an optional `relies_on_option` **label**. The host verifies the label against the canonical graph: a unique label must name an option that is neither the status quo nor explicitly baseline on either persisted surface. A content word of at least four letters from the risk label must share its four-letter prefix with a word in that option's label, a decision node's label/description, or the stored brief.

For a verified lease, both proposed link arrays are dropped before ordinary target/direction validation. The host supplies `{ option_id }` through the same existing `buildAddRiskTransaction` third argument and `holdAddRiskInProcess` input used by More-risks. The model never authors `relies_on` on a node. Existing hold/apply revalidation and generic field safety remain in place.

The approved card carries the unchanged Science sentence:

> ‘Feature release slips’: ‘Raise Pro price to £59’ relies on this not happening. This model can't yet apply that risk to that option alone, so the Run leaves it out, and that option's chance doesn't include it yet.

The risk is held as one stamped add-node operation with zero links. Existing RC3 readers keep it on the model and leave it out of readiness and Run inputs. No new readiness or option-chance disclosure machinery was introduced; the identity-keyed readers already carry those semantics.

An invalid, unrelated, ambiguous, id-shaped or baseline lease is ignored and uses today's ordinary risk path. A valid precondition takes precedence even over unresolvable model links. When links were supplied and dropped, the deterministic reply explicitly says they were dropped because the risk is a precondition of the named option. Empty-link proposals preserve the existing More-risks reply wording.

A user-stated, valid likelihood **with its time horizon** is retained as `event_risk` alongside the precondition stamp. Current schemas and hold/apply guards support both, so no fallback or schema widening was needed. The entire stamped risk, including occurrence, stays out of the Run. The reply preserves both the option-label figures and likelihood quote, and says the likelihood is kept for when the model can apply the risk to that option. Today's parser still does not invent an occurrence block from verbal likelihood or a probability without a supported horizon.

## Files and hot surfaces

| File | Reason |
| --- | --- |
| `src/orchestrator-v5/agent-lane/runtime/agent-tools.ts` **hot** | Optional label lease, tool guidance and capability argument type; affects remains a required array and is `[]` for a precondition. |
| `src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts` **hot** | Preserve stored `brief_text` from the same canonical read; verify chat lease; retain the strict widen path; discard links for preconditions; forward host stamps; retain valid user occurrence; return typed dropped-link disclosure. |
| `src/orchestrator-v5/agent-lane/proposal-reply.ts` **hot** | Render Science plus dropped-link/likelihood disclosures when applicable; validate likelihood before either reply branch; carry both option label and occurrence quote through figure-preservation checks. |
| `src/orchestrator-v5/routing/chat-risk-precondition.ts` **new** | Pure canonical label/baseline resolution and lexical sanity gate; does not infer a precondition from shape. |
| `src/orchestrator-v5/routing/add-risk-transaction.ts` | Comment only: document the verified chat lease as another host-only stamp origin. Builder behavior unchanged. |
| `src/orchestrator-v5/system-events/dispatch.ts` | Comment only: update the existing host input's origin documentation. Hold/Apply behavior unchanged. |
| `src/orchestrator-v5/agent-lane/__tests__/agent-chat-precondition-door-seam.test.ts` **new** | RED-first requested real-door rows and targeted authority, conflicting-link, likelihood, deterministic-reply and ordinary-driver controls. |
| `src/orchestrator-v5/agent-lane/__tests__/fixtures/chat-precondition/p44-r5-graph-after.json` **new** | Exact supplied P44 graph envelope, including stored brief. |
| `src/orchestrator-v5/agent-lane/__tests__/fixtures/chat-precondition/p44-r5-add-risk.turns.json` **new** | Exact supplied served turns for the existing card control. |
| `scripts/chat-precondition-mutants.mjs` **new** | Isolated requested mutants with load gating, baseline checks, relevant assertion failures and paired controls. |
| `acceptance-evidence/chat-precondition/REPORT.md` **new** | This restartable report. |

`agent-v1-turn.ts`, `widen-turn.ts`, schemas, generic field safety, Run projection and option-chance disclosure code were not changed. The canonical graph endpoint already returns stored `brief_text`, so no route change or additional store read is needed.

## Authored rows — 17 expanded tests, execution pending

| Row | Assertion |
| --- | --- |
| `chat-precondition-p44-r5` | Exact user turn; Science text on chip and card; same held stamp; one graph-bearing Apply; zero incident edges; unchanged readiness; final Run payload bytes equal the remove-only before graph. |
| `chat-precondition-p44-r5-today` | No lease, served ordinary card detail unchanged; ordinary risk→MRR graph bytes match the supplied fixture with the next allocated risk reference. |
| `chat-precondition-unrelated` | Office flood fails sanity gate; ordinary affects/graph bytes match no-lease control; no stamp. |
| `chat-precondition-forged-*` (four) | Non-option label, status quo, missing option and raw option ID are ignored; ordinary graph bytes match no-lease control. |
| `chat-precondition-ambiguous-option` | Duplicate option labels ignore the lease and preserve ordinary graph bytes. |
| `chat-precondition-split-baseline-*` (two) | Explicit true on either top/data surface wins, including conflicting surfaces and multiple declarations where the status-quo reader returns null. |
| `chat-precondition-conflicting-links` | Valid precondition wins over affects and caused_by; zero edges and stated reason. |
| `chat-precondition-invalid-conflicting-links` | Valid lease drops nonexistent link endpoints before ordinary validation. |
| `chat-precondition-likelihood` | User likelihood+horizon and host precondition stamp survive real Apply together, with zero edges and both card disclosures. |
| `chat-precondition-deterministic-mixed-links` | Actual assistant reply states why links were dropped; one scripted proposal call, no narration call. |
| `chat-precondition-deterministic-likelihood-and-price` | User £59 and occurrence figures are both carried; deterministic Science/likelihood reply; one call; committed stamp and occurrence. |
| `chat-precondition-drives` | Ordinary risk without lease retains its factor→risk driver and risk→MRR threat, with today's hypothesis bytes and no stamp. |
| `chat-precondition-model-cannot-author` | Invented generic model writer refused through Agent door; generic field-safety referee still rejects model-authored stamp operations. |

The Run-input row uses the production snapshot loader and final `createRunAnalysisHandler` payload assembly, stopped at the existing read-only probe immediately before transport. It tests egress assembly, not an executed analytical result.

## Mutants — execution pending

`node scripts/chat-precondition-mutants.mjs` copies the current working tree into isolated temporary directories, links dependencies and never edits workspace production files. It checks load before tests, runs one Vitest worker with ignored stdin, and writes source hashes, commands, logs and JSON assertion results to its evidence directory.

| Mutant | Required failed row | Required passing control |
| --- | --- | --- |
| `sanity-gate-always-true` | `chat-precondition-unrelated` | `chat-precondition-p44-r5` |
| `host-stamp-skipped` | `chat-precondition-p44-r5` | `chat-precondition-unrelated` |

The runner requires the full baseline seam file to pass before mutation evidence counts. Collection, startup, syntax, timeout and unrelated runtime failures do not count as detections. P44 matching distinguishes `p44-r5` from `p44-r5-today`; only the forged family uses suffix matching. Neither mutant was executed or claimed killed.

## Judgement calls and static corrections

- Label resolution normalizes case and whitespace only; ids, descriptions and fuzzy matches cannot acquire the lease. Duplicate labels anywhere on the graph fail conservatively.
- Four-letter prefixes make the sanity gate deliberately bounded and permissive. It is a lexical check, not evidence of causation; the disclosed approval card is the DL-approved safeguard.
- The actual fixture decision label is abbreviated, so the supplied stored brief is essential corroboration for `release`.
- The before fixture removes only the supplied risk and its incident edge, preserving its `ref_high_water.R=2`. The next Add allocates R3; the today row accounts for that without resetting or recycling references.
- The existing widen host binding retains its stricter mixed-link refusal. Only verified chat leases gain the specified precondition-wins behavior.
- Independent static review caught an unconditional extra precondition reply sentence that would change an existing exact widening assertion. It is now emitted only when model-supplied links were dropped. The review also caught and corrected the mutant runner's forged-family row matcher.

## Author verification

After a readable load gate below 25, run the new seam and existing touched-path controls, one worker with stdin closed:

```sh
pnpm exec vitest run --configLoader=runner --maxWorkers=1 --no-file-parallelism src/orchestrator-v5/agent-lane/__tests__/agent-chat-precondition-door-seam.test.ts src/orchestrator-v5/agent-lane/__tests__/agent-event-risk-door-seam.test.ts src/orchestrator-v5/agent-lane/__tests__/proposal-reply-new-risk.test.ts src/orchestrator-v5/agent-lane/__tests__/widen-risks-seam.test.ts src/orchestrator-v5/routing/__tests__/relies-on-risk.test.ts </dev/null
```

The mutant runner performs its own load checks and baseline run:

```sh
node scripts/chat-precondition-mutants.mjs --output-dir /private/tmp/chat-precondition-mutant-evidence </dev/null
```

After a fresh successful load gate, production typechecking can run without generation or build side effects:

```sh
pnpm exec tsc -p tsconfig.build.json --noEmit </dev/null
```

No deployment or served-product fix is claimed by this working-tree implementation.
