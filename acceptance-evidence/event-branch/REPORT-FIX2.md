# Event branch FIX-2 — r1 #2853

## Client graph ingress enumeration (completed before edits)

1. `/assist/v1/scenarios/:scenario_id/graph/register`: canvas re-registration, file import and in-process CEE construction. Strip client warrants from nodes and options mirrors. Restore a warrant only from the exact CEE construction grant or the same stored event.
2. `/orchestrate/v2/turn` request `graph_state`, parsed by `boundary/request-extensions.ts`: the common turn/stream/proxy boundary feeding first-touch adoption and edit/merge fallback. Strip client warrants before any downstream consumer.
3. Direct `runTurnExecutor(..., { graphState })` callers: defensively sanitize once before reasoning, handler inputs and either first-touch adoption branch. Persisted canonical data keeps priority over the sanitized fallback.

The full pre-edit census is in [fix2-c-ingress-census.md](fix2-c-ingress-census.md). Version save/restore load server graphs; standalone coaching does not adopt or persist a graph or consume occurrence warrants. Stored `GraphStateIngressSchema`/`GraphV3` readers retain legitimate CEE warrants. No other live client graph adoption/import writer was found.

## Source identity and constraints

Worktree `/private/tmp/accel-er-event-cee`; branch `dl/event-risk-olumi-occurrence`; reviewed and final HEAD asserted as `5f54ca8740095fb744ab1f2717a886fc5e3f5c66`. Initial working tree was clean. Working-tree edits only: no commit, push, staging, deployment, tracked-directory removal or changes under `supabase/`.

Required r1 rows were captured RED before changing their owning production modules, then GREEN. Extra Class A adversarial rows used byte-exact `git show 5f54ca87:<path>` source snapshots for the three A/B modules, restored in `finally`, to obtain additional reviewed-source RED evidence without moving HEAD. Other lanes' already-fixed disjoint modules remained in place during these later probes.

## Changes by class

**A:** One `userEventFigures` predicate applies to every risk and probability factor, including orphan, ambiguous, invalid and duplicate factor branches and widener factors. It visits every written percentage or 0–1 figure independently. Clause/comma boundaries and the existing bounded leave/departure and cancel/cancellation equivalents are reused. The existing reader alone admits explicitly bound figures: user occurrence and its own horizon win, with Olumi text cleared. Refused/hedged or ambiguous figures produce the interim sentence and no occurrence. Unfamiliar comma wording can borrow clause context only for quotation. Multiple figures in one fragment stay separate and under-claim rather than binding another event's accepted figure. There is no requirement that the user figure equal the drafter's value. Numeric sign/decimal recognition is quotation-only; no new natural-language likelihood admission rules were added.

**B:** The drafted label is classified before label separation can rename it. A likelihood token anywhere (`probability|likelihood|chance|odds`) removes the factor, its incident links and option references, with disclosure. Ordinary factors remain as built.

**C:** Every enumerated client graph ingress strips basis text. Stored or in-process warrants require the same ID, occurrence, label and description. Exact unchanged CEE construction/stored warrants survive; changing the event clears its warrant.

**D:** A finite positive goal horizon rejects a different Olumi occurrence horizon, with a risk-specific mismatch disclosure; there is no rescaling. A matching horizon or no goal horizon retains the existing Olumi path. `runtime/build-model.ts` is byte-identical to reviewed source except the one requested instruction phrase: `over the goal's horizon in months (if the goal states no horizon, the period you mean)`.

**E:** The common warrant reader must return readable basis text before a root occurrence earns a likelihood count or attribution. A basis-less card displays a placeholder, with neither a numeric likelihood nor “Olumi's estimate”.

**F:** The existing RC4 path walker accepts a second root class, IDs from the counted/warranted occurrence reader, alongside option levers. Its existing sizing census supplies both relationship count and Check estimates; shared downstream links remain deduplicated. No census rewrite was required.

## RED → GREEN rows

| Finding / class row | Reviewed-source RED | Final GREEN |
| --- | --- | --- |
| r1 #1 exact: “The key developer has a 10% chance he leaves within 6 months”; draft90%/12 | Olumi82–95%/12 overwrote user | User10%/6; no Olumi sidecar |
| r1 #2 exact: developer probably10%/6, Supplier20% chance; with and without draft basis | Olumi occurrence admitted or user figure misattributed | No occurrence/sidecar; interim quote; no “Olumi had drafted” |
| A other user percentages/0–1 values differ from draft | Drafter value matching let Olumi author occurrence | User quote, no occurrence, factors removed |
| A unsupported comma hedge, two figures/no comma, orphan/invalid/ambiguous factors | 6 failures/1 passing no-figure control on original A/B modules | All7 pass |
| A signed explicit/refused figures and duplicate probability factors | All 4 failed on original A/B modules | All 4 pass; user +10% uses shared reader; refused signs/duplicates under-claim |
| r1 #3 exact: option/factor “Key developer departure probability” | Factor renamed to probability level and retained | No factor rename, no probability factor or Revenue link; removal disclosed |
| B middle-token probability/likelihood/chance/odds | Four factors survived | All removed/disclosed; ordinary factor control intact |
| r1 #4 exact: empty first-touch graph with “Invented reference class” | Parser/direct adoption persisted client warrant | Not persisted; not included in Check estimates; options mirrors stripped |
| r1 #8 exact: same ID/occurrence relabelled “Largest client cancels” | Staff-turnover warrant retained | Cleared; description change also clears; unchanged stored/grant controls pass |
| r1 #5: goal12 / draft3 | Olumi occurrence3 admitted | Placeholder, no occurrence/text; specific3→12 warning |
| D controls: goal12 / draft12; no goal horizon / draft6 | Already pass | Admitted with own stated period |
| r1 #7: root Olumi occurrence without basis | Likelihood count1 and attribution shown | Count0; no “Olumi's estimate”; readable basis control passes |
| r1 #6 exact: price→MRR + developer departure→MRR + likelihood | “1 relationship, 1 likelihood”; impact absent from Check estimates | “2 relationships, 1 likelihood”; both impacts listed |
| A no figure about event; B ordinary factor | Already pass | Existing Olumi path / ordinary factor and link remain |

## Test evidence

Every test invocation used the load gate below, at most two files, one worker, `--configLoader=runner`, and stdin from `/dev/null`. Gate failures/CLI errors are not credited as executed tests or killed mutants.

```sh
node -e "process.exit(require('os').loadavg()[0] < 25 ? 0 : 1)" && node_modules/.bin/vitest run <one-or-two-files> --maxWorkers=1 --no-file-parallelism --configLoader=runner < /dev/null
```

| Log | Result |
| --- | --- |
| `fix2-ab-red.log` | 16 expected failures /2 passing controls |
| `fix2-ab-scope-red.log` | 6 expected failures /1 passing control on reviewed A/B source |
| `fix2-ab-signed-duplicate-red.log` | 4 expected failures on reviewed A/B source |
| `fix2-ab-green.log`, `fix2-ab-restored.log` | 30/30 A/B rows |
| `fix2-ab-r1-2-factor-red.log` | All 4 exact r1 #2 basis/factor combinations fail on reviewed A/B source |
| `fix2-ab-r1-2-final-green.log` | 32/32 final A/B rows, with and without factor and basis |
| `fix2-ab-neighbours-admission-labels.log` | 60/60 |
| `fix2-ab-neighbours-reader-horizon.log` | 355/355 |
| `fix2-c-red.log` | Corrected RED8 failures /40 passes |
| `fix2-c-green.log`, `fix2-c-restored-green.log` | 48/48 |
| `fix2-c-neighbours-green.log`, `fix2-c-neighbours-restored.log` | 27/27 |
| `fix2-d-red.log` | 2 expected failures /2 passing controls |
| `fix2-d-green.log` | 9/9 |
| `fix2-d-restored-neighbours.log` | 48/48 |
| `fix2-ef-red.log` | 9 expected failures /2 passes |
| `fix2-ef-green.log`, `fix2-ef-restored.log` | 11/11 |
| `fix2-ef-neighbours.log` | 34/34 |

A first C fixture omitted `effect_direction`; its initial extra failure is not credited as a defect, and corrected RED is retained. Vitest rejected D's initial `--minWorkers` before running tests; corrected commands use only `--maxWorkers=1`. D's first disclosure mutant survived a loose test oracle that accidentally matched “GraphV3”; the field-specific oracle was corrected, GREEN rerun and the same mutant killed. The weak result remains in `fix2-d-mutant-horizon-mismatch-disclosure-off-weak-oracle.log`.

## Mutants (32 killed; sources restored)

A/B manifest: [fix2-ab-mutants.json](fix2-ab-mutants.json); reproducible runner: [fix2-ab-mutants.py](fix2-ab-mutants.py). Every result contains an assertion failure, not merely a nonzero load gate.

| A/B mutant | Claim challenged | Result |
| --- | --- | --- |
| `A-risk-only-user-disabled` | olumi-event-risk-draft.ts | KILLED; `fix2-ab-mutant-A-risk-only-user-disabled.log` |
| `A-refused-figure-gate-disabled` | olumi-event-risk-draft.ts | KILLED; `fix2-ab-mutant-A-refused-figure-gate-disabled.log` |
| `A-drafted-value-only` | olumi-event-risk-draft.ts | KILLED; `fix2-ab-mutant-A-drafted-value-only.log` |
| `A-read-one-skips-clause` | stated-event-risk.ts | KILLED; `fix2-ab-mutant-A-read-one-skips-clause.log` |
| `A-ambiguous-event-applied` | olumi-event-risk-draft.ts | KILLED; `fix2-ab-mutant-A-ambiguous-event-applied.log` |
| `A-unitless-figures-ignored` | stated-event-risk.ts | KILLED; `fix2-ab-mutant-A-unitless-figures-ignored.log` |
| `B-rename-before-classifying` | keep-options-apart.ts | KILLED; `fix2-ab-mutant-B-rename-before-classifying.log` |
| `B-suffix-only` | olumi-event-risk-draft.ts | KILLED; `fix2-ab-mutant-B-suffix-only.log` |
| `B-factor-retained` | olumi-event-risk-draft.ts | KILLED; `fix2-ab-mutant-B-factor-retained.log` |
| `B-removal-undisclosed` | olumi-event-risk-draft.ts | KILLED; `fix2-ab-mutant-B-removal-undisclosed.log` |
| `A-comma-context-refusal-off` | olumi-event-risk-draft.ts | KILLED; `fix2-ab-mutant-A-comma-context-refusal-off.log` |
| `A-same-fragment-figures-collapsed` | stated-event-risk.ts | KILLED; `fix2-ab-mutant-A-same-fragment-figures-collapsed.log` |
| `A-orphan-factor-predicate-off` | olumi-event-risk-draft.ts | KILLED; `fix2-ab-mutant-A-orphan-factor-predicate-off.log` |
| `A-leading-decimal-boundary-off` | stated-event-risk.ts | KILLED; `fix2-ab-mutant-A-leading-decimal-boundary-off.log` |
| `A-signed-figures-ignored` | stated-event-risk.ts | KILLED; `fix2-ab-mutant-A-signed-figures-ignored.log` |
| `A-duplicate-factor-predicate-off` | olumi-event-risk-draft.ts | KILLED; `fix2-ab-mutant-A-duplicate-factor-predicate-off.log` |

C's eight killed mutants cover parser sanitation, direct executor sanitation, registration mirror sanitation, stored label and description, construction label and description, and persisted-first authority. See [fix2-c-report-fragment.md](fix2-c-report-fragment.md) and `fix2-mutant-c*.log`.

D's three killed mutants remove the horizon guard, mismatch disclosure, and instruction condition. See [fix2-d-report-fragment.md](fix2-d-report-fragment.md) and `fix2-d-mutant-*.log`.

E/F's five killed mutants remove the warrant reader/card guards, event roots in chance attribution, event roots in Check estimates, and event roots in the shared path walker. See [fix2-ef-mutants.json](fix2-ef-mutants.json) and [fix2-ef-report.md](fix2-ef-report.md).

All mutable sources were restored in `finally`; final restored GREEN and source hashes bind the delivered bytes.

## Changed files

- `src/orchestrator-v5/__tests__/turn-executor-adopt-on-first-touch.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/event-risk-drafter-contract.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/event-risk-fix2-admission.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/event-risk-fix2-attribution.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/event-risk-fix2-claim-scope.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/fix2-event-risk-horizon.test.ts`
- `src/orchestrator-v5/agent-lane/__tests__/olumi-event-risk-admission.test.ts`
- `src/orchestrator-v5/agent-lane/actions/state.ts`
- `src/orchestrator-v5/agent-lane/event-risk-construction-context.ts`
- `src/orchestrator-v5/agent-lane/goal-chance-estimate-attribution.ts`
- `src/orchestrator-v5/agent-lane/keep-options-apart.ts`
- `src/orchestrator-v5/agent-lane/olumi-event-risk-draft.ts`
- `src/orchestrator-v5/agent-lane/runtime/build-model.ts`
- `src/orchestrator-v5/agent-lane/stated-event-risk-draft.ts`
- `src/orchestrator-v5/agent-lane/turn-context/guidance-signals.ts`
- `src/orchestrator-v5/boundary/request-extensions.ts`
- `src/orchestrator-v5/routing/stated-event-risk.ts`
- `src/orchestrator-v5/turn-executor.ts`
- `src/routes/__tests__/assist.v1.scenario-graph-register.event-risk.test.ts`
- `src/routes/assist.v1.scenario-graph-register.ts`
- `tests/unit/contracts/controlled-factor-authority.guard.test.ts`
- `tests/unit/contracts/controlled-factor-authority.scan.ts`

Other working-tree additions are this report and `acceptance-evidence/event-branch/fix2-*` evidence logs, manifests, scripts, census and report fragments. `fix2-source-sha256.json` records the final 22 TypeScript source/test file hashes. Historical FIX-1 evidence remains unchanged.

## Full TypeScript and ESLint

The required **full** command ran with tests included through the root `tsconfig.json`:

```sh
NODE_OPTIONS=--max-old-space-size=8192 node_modules/.bin/tsc --noEmit
```

Result: **0 errors in all 22 changed TypeScript files**. Full command exit 2: **290 diagnostics in unchanged files**. This does not claim a clean repository-wide TypeScript run or independently establish that every unchanged-file diagnostic predates FIX-2. Complete output: [fix2-tsc-full.log](fix2-tsc-full.log); diagnostic census: [fix2-tsc-summary.json](fix2-tsc-summary.json).

ESLint ran with every changed path submitted, including all 22 changed source/test files: `node_modules/.bin/eslint --no-warn-ignored <all-changed-paths>`. **Exit 0; zero lint errors or warnings.** Markdown, logs, JSON and Python have no applicable ESLint configuration; ignored-file notices were suppressed. Evidence: [fix2-eslint.log](fix2-eslint.log), [fix2-eslint-summary.json](fix2-eslint-summary.json), [fix2-changed-files.json](fix2-changed-files.json).

Final checks: exact HEAD and branch assertions, `git diff --check`, final source hashes, instruction-only byte comparison against reviewed source, empty staged diff, no deleted tracked files and no `supabase/` changes all pass.

This is local source, deterministic admission/reader/card evidence and mocked route/adoption evidence. No live provider, deployment or whole-PoC acceptance claim.
