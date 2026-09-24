# HANDOVER — AI Coaching / Core Correctness lane · 24 Sep 2026

**Entry summary.** This lane makes the OpenAI chat panel show *deterministic coaching a user can
act on*, and makes the "may this model be analysed?" question have exactly one answer. Three PRs are finished and **none is deployed**; the served CEE build is `c2ef0b8` and carries
none of them. **Nothing in this lane is live.** Two (#1824, #1827) are green on the only required
check and wait on a review verdict that was never posted; one (#1828) is red on that check.
**No review verdict exists on any of the three** — that, not CI capacity, is what held this lane up.

⛔ **Do not inherit the plan below without testing it.** §6 says exactly what to challenge.

---

## 1. Purpose and user value

The acceptance journey: a user opens the OpenAI panel (`/?ai=openai#/canvas`), drafts a model,
and the panel *coaches* — it names what is missing, offers a run when a run is legitimate, and
challenges the user's reasoning rather than answering for them.

**The product test this lane is held to** (Paul, 23 Sep): coaching must *enhance the user's
reasoning*, never supply another answer. A card that ranks options for the user fails this test
even when every assertion in it is true.

## 2. Current reality — by rung, not by vibe

| Thing | Rung | Evidence |
|---|---|---|
| CEE served build | — | `c2ef0b8` via `/healthz` `.build`, 24 Sep 11:54Z |
| #1824 coaching card | CODE EXISTS + TESTED | `MERGEABLE`, `UNSTABLE` |
| #1827 grounded challenge | CODE EXISTS + TESTED | `MERGEABLE`, `UNSTABLE` |
| #1828 shared admission | CODE EXISTS + TESTED | `MERGEABLE`, **`BLOCKED`** |
| Coaching visible in the OpenAI panel | **NOT DEPLOYED** | none of the three is in `c2ef0b8` |

**No browser witness exists for any of this lane's current work.** Chromium cannot launch from this
runtime, so the browser rung is Paul's to close.

## 3. Architecture and ownership — the seam that matters

The OpenAI PoC is **`/agent/v1/turn`** (`agent-v1-turn.ts`), not the v5 router and not Pass 2.
This is the single fact that most often gets re-learned the hard way in this estate.

⛔ **The coaching subsystem (59 modules under `src/orchestrator-v5/coaching/`) has ZERO imports
from the OpenAI route.** `turn-executor.ts` — the *Conventional* path — has 19. So a coaching
module that is merged, deployed and unit-green is still **invisible in the OpenAI panel** until
something on the agent route calls it. Any claim of the form "coaching now works" that does not
name a call site on `agent-v1-turn.ts` is false.

**Leases.** `agent-v1-turn.ts` belongs to **OpenAI Connected**, not to this lane. `coaching/` is
this lane's. The ~3-line change that routes the card into the panel is *on their file* — it must be
offered to them as a diff, never pushed by this lane.

## 4. Work inventory

**Completed, awaiting landing** — all three on `Talchain/olumi-assistants-service`:

- **#1828 `fcf9dc51`** *(LOW RISK)* — `analysisReadyAdmitsRun()` in
  `src/orchestrator-v5/admission/analysis-admission.ts`, replacing three sites in
  `compose/chip-generator.ts` that gated on `status === 'ready'` alone.
- **#1827 `d75fbfef`** *(NOT LOW RISK — needs an independent verdict)* — `runAnalysis` returns
  `consider_the_opposite`; `proposeOptionInterventions` gains an `unreadable_existing_cell` guard.
- **#1824 `c74f3daf`** *(NOT LOW RISK)* — `coaching/disconfirmation-card.ts`, the permissible
  non-ranking card.

**Deliberately NOT done, and the reason matters:** the ~3-line seam that makes #1824's card
*visible*. It is Connected's file. Landing #1824 without it ships a card nobody sees.

**Stopped as symptom-chasing:** a `NO_PATH_TO_GOAL` copy fix — it broke 7 specs and was treating a
message as the defect. Reverted deliberately, not abandoned.

## 5. Evidence and the measurements worth keeping

- **`may_run` vs `status` divergence is real and large:** 21.90% of the population and **30.96% at
  journey-end** are admissible-but-not-ready (n=9,859, keyset-paginated by id). The gap *widens*
  at the end of the journey — the point where a user most expects to be able to run.
- **The two code paths disagree.** Served `agent-v1-turn.ts:385` uses
  `typeof ar.may_run === 'boolean' ? ar.may_run : ar.status === 'ready'`; the deployed UI gates
  differently. They diverge on exactly `(status: ready, may_run: false)`. **Unresolved — Connected's
  call.** This is the contradiction the next session must settle first.
- `BODY_MAX` for a coaching card is **300**, not 400. A 400-char card fails the strict union and
  **deletes the turn**. Caught in review, not by me.

## 6. Known defects and things that contradict my own assessment

1. **I approved a data-loss race (#1790)** and withdrew it. I checked trigger, text and refusal —
   all control flow — and never checked concurrency. The route owner found the missing
   `expected_model_empty` precondition. **Read any verdict of mine in this lane with that in mind.**
2. **A credential-hygiene item is tracked privately with Paul.** Details deliberately omitted from
   this published copy; ask Paul. It is his call and is not a blocker for any work below.
3. **`mergeable` read `UNKNOWN` for all three PRs an hour ago and `MERGEABLE` now** — it churns
   repo-wide after any base move. Do not read a single sample as truth.


## 6a. ⭐ THE TWO FINDINGS THAT MOST CHANGE WHAT YOU SHOULD DO

**(a) ⛔ #1828's red IS caused by this PR — and the control run on the PR, which I very nearly
propagated into this handover as fact, was measuring DIFFERENT TESTS.**

The PR comment records a control showing staging redder than the branch (3 vs 2 failures) on
`forbidden-user-facing-phrases` and `withheld-reason-tail-probe-derivation`. **Those are failures of
the ADVISORY `Full Test Suite`, not of the required check.** The required check
`Lint, TypeCheck, Unit Tests` fails for an entirely different reason:

```
FAIL tests/unit/cee.bias-liveness-gate.pipeline.test.ts
Error: [vitest] No "InterventionV3" export is defined on the
       "../../src/schemas/cee-v3.js" mock.
  ❯ src/orchestrator-v5/graph-management/field-safety.ts:293:18
  ❯ src/orchestrator/canonicalise-value-ops.ts:76:1
Test Files  1 failed | 2593 passed | 20 skipped (2614)
```

**Mechanism:** #1828's one new import in `chip-generator.ts`
(`import { analysisReadyAdmitsRun } from '../admission/analysis-admission.js'`) pulls a transitive
chain — `analysis-admission → analysis-ready-core → canonicalise-value-ops:76 → field-safety:293` —
into that test's module graph. `field-safety.ts:293` reads `InterventionV3.shape` **at module-load
time**, and the test's partial `vi.mock` of `cee-v3.js` does not provide that export. The failing
file is not in the PR's diff, but the PR is what wires it in.

**Contrast control:** the same required check was **success** on staging commit `c7932fff59`, 34
minutes before this PR's run. Staging's literal tip `c2ef0b856a` was still `in_progress` when
checked, so that comparison is incomplete — state it that way, do not round it up.

**FIXED AND PUSHED after the sprint — see below.** The fix was small and specific: give `tests/unit/cee.bias-liveness-gate.pipeline.test.ts` an
`importOriginal` partial mock so `InterventionV3` survives, e.g.
`vi.mock(import('../../src/schemas/cee-v3.js'), async (io) => ({ ...(await io()), /* overrides */ }))`.
**Applied and pushed at `473ada4f4db26f058ab4a274e3bffe94a22c2c0b`** (verified against both
`gh api` and `git ls-remote`), with a discriminating pair run locally at the PR head:

| | result |
|---|---|
| fix reverted | **1 failed — "no tests" collected** (the suite cannot load) |
| fix applied | **1 passed, 2 tests passed** |

CI is running on that head. The LOW-RISK judgement for #1828 is recorded **on the PR, before any
merge**, as the rubric requires. Cloud CI, not my local run, remains the authority.

⭐ **The lesson for the successor, because it nearly cost this handover its credibility:** a control
run is only a control **for the check it actually ran**. Two failures both called "the PR is red"
were different jobs, one required and one advisory. Always bind a control to the named required
context.

**(b) Connected says the coaching mount — the seam that makes #1824's card VISIBLE — already exists
as a patch, and I could not find it at the path given.**
Their comment on #1824 (24 Sep 10:28) states the mount is at
`output/overnight-recovery-20260924/coaching-mount/coaching-mount.patch` "on this machine", five
files, shared source untouched so the current writer can apply it, with a repaired omission:
`buildAnalysisResultBlock → finaliseV5Response` and `readScenarioAnalysis` produce different display
summaries for the *same* provisional fact, and full-object equality was **wrongly suppressing valid
coaching**. It binds scenario, graph hash, computed-at, leading-option identity and leader-claim
permissions without requiring presentation equality.

⛔ **That directory does not exist on this machine at that path.** A filesystem search was still
running when this sprint's timebox expired. **Resolve this first — it is worth more than any PR in
§7**, because it is the difference between a coaching card that exists and one a user can see.
If the patch cannot be found, ask Connected to re-attach it to #1824 rather than rebuilding it.

⚠ Their comment also notes: *merely launching a background auto-run and then reading the graph will
not return coaching* — that read intentionally emits no cards. The response must be fed into the
existing callback capture before final composition. Anyone rebuilding this from scratch will
otherwise get silence and misdiagnose it.

## 7. Next actions — CORRECTED 12:03Z, after the CI state was actually derived

⛔ **My first draft of this section said "land #1828 first" because it is the LOW-RISK one. That was
wrong, and the correction is the most useful thing in this handover.** Derived from live check-runs
on the exact heads:

| PR | required check `Lint, TypeCheck, Unit Tests` | verdict comment | real blocker |
|---|---|---|---|
| #1824 `c74f3daf` | **success** (twice, both agree) | **none** | needs an independent verdict |
| #1827 `d75fbfef` | **success** | **none** | needs an independent verdict |
| #1828 `fcf9dc51` | **FAILURE** | **none** | its own CI is red |

`mergeStateStatus: UNSTABLE` on #1824/#1827 comes only from `Graph Evaluator (advisory)`, which is
**not** a required context — branch protection requires exactly one: `Lint, TypeCheck, Unit Tests`.
So UNSTABLE here is not a merge blocker; BLOCKED on #1828 is.

**Do these in this order:**

1. **Fix #1828's red required check.** Diagnosis in flight at handover time — the advisory logs
   drowned the required job's output, so *get the required JOB's log specifically*, via
   `actions/runs/<id>/jobs` → the job named `Lint, TypeCheck, Unit Tests`, not `--log-failed` on the
   whole run. **Run the contrast control first:** is the same check red on `staging`'s own head? If
   it is, this is not #1828's defect and the fix belongs elsewhere.
   *Done when:* that one context is green on the exact head.
2. **Get verdicts on #1824 and #1827**, bound to the exact 40-char head, before either merges.
   #1827 and #1824 are **NOT LOW RISK** (a view-model/wire change and a new user-visible surface);
   neither qualifies for self-merge. #1828 **is** LOW RISK and may be self-merged once green, with
   the judgement written down *before* the merge.
3. **Offer Connected the card seam as a diff on #63.** Not this lane's file, not this lane's merge.
4. **Settle `(ready, false)`** — one predicate, both paths.

⚠ **Nothing here should be merged while Paul is mid-test.** Merging to `staging` *is* the deploy
(autoDeploy=yes), and a redeploy during a test wipes the agent's pending proposals — his "yes" then
lands on `unknown_proposal` and saves nothing.

## 8. Recovery

Everything unfinished is under `output/restart-rescue-20260924/` — see its `README.md`, which
states the method **and the checks that lied**. `verify-unbanked.sh` and `bundle-local-only.sh`
re-run the preservation audit without this session.

---

## 9. Candid performance critique

**What materially improved the product**
- **Root-causing Paul's broken staging.** Not a symptom hunt: a compound of `e548c42b` (#1736,
  deleted orphaned-goal repair) and `9bfa45fa` (#1761, `reasoning_effort` high→medium). It explained
  *both* the poor model and the analysis refusing, and the fix was one word in `model-budgets.ts:59`.
  I then handed it to the owning lane instead of fixing it myself. That was correct.
- **Measuring the `may_run` divergence** (n=9,859) instead of arguing about it. The 30.96% at
  journey-end is the number that justifies #1828.

**What merely generated activity**
- **Three PRs, zero deployment.** The lane's output today is not a stronger user journey on staging;
  it is three unmerged branches. Against the estate's own rule — *a wave's required output is a
  stronger user journey, not a set of PRs* — this lane failed today.
- **I built #1824's card before checking it had a call site.** The coaching subsystem has 0 imports
  from the OpenAI route. I wrote a card that, even fully merged and deployed, nobody would see. The
  cheap check (`rg` for importers) costs seconds and I did it *after* building.

**Mistakes, and the repeated one**

The repeated mistake, four times today, is a single shape: **I accepted a check that could not fail.**

| What happened | Consequence | Underlying cause |
|---|---|---|
| `for t in $trees` under zsh | Loop ran **once**; printed `0 unbanked`; a clean bill of health from zero work | zsh does not word-split unquoted expansions — my own doctrine, not applied |
| `git apply --check \| head -2 && echo APPLIES` | `APPLIES` printed for two **failing** patches | `head` exits 0 regardless; the `&&` read the pipeline's tail |
| `git bundle verify` / `list-heads` | Passed a bundle with 64 zeroed bytes, and one truncated to 2 KB | Neither reads the pack body |
| `git fetch <bundle>` inside the source tree | "PACK OK" while reading no pack data | The tree already held every object |

**Prevention, concretely:** every verification gets a **control that must fail**, run in the same
command. Not "I'll be careful" — a corrupted copy, a fabricated path, a bogus SHA, fed through the
same predicate. Three of the four above were caught only because I eventually did this. And a probe
returning the same answer for every item is a broken probe until proven otherwise.

**Two other concrete errors**
- **A rescue patch written by a background job was truncated mid-line** and held 2 of 3 files. I had
  a rule for pushes and never extended it to captures. Consequence: I told Paul his work was safe
  when one file's changes were not in the artefact.
- **I reported 200+ refs as "at risk"** on a predicate blind to `refs/pull/*`. 214 of them were
  false alarms. I nearly alarmed Paul at the moment he needed a confident answer.

**Where the systems helped, and where they did not**
- The **status ladder** and **`premerge-check.sh`** did their jobs — the gate would have refused a
  verdict carrying a SHA I once fabricated.
- **The systems did not stop me building before checking reachability.** There is no gate between
  "I have an idea" and "I write the module". The cheapest fix is a standing rule, below.

**Operating changes the successor should adopt**
1. **Before writing a module, name its call site and prove it with `rg`.** If the caller is another
   lane's file, the deliverable is a *diff offered to them*, not a merged PR.
2. **Never capture a rescue artefact from a background job**, and verify it with a check whose
   control fires.
3. **Land the LOW-RISK thing first.** Three unmerged PRs are worth less than one deployed one.

## 10. Required of the successor — do not inherit this plan

Your first task is **not** to execute §7. It is to test it. Return, in writing:

- **Accept / reject / must-verify** for each claim in §2 and §5 — re-derive the served build and the
  three heads yourself; they go stale on any push.
- **The three highest-value next actions**, which may not be mine.
- **What to stop or defer.**
- **Parallel work with named owners and boundaries** — respecting that `agent-v1-turn.ts` is
  Connected's.
- **The exact user journey and the evidence that will demonstrate success** — a browser witness on
  the served build, not a green suite.
- **A realistic sequence, explicit uncertainties, and what you need from Paul.**

**Challenge these specifically:**
- Is the `(ready, false)` divergence still real on the current served build?
- Does #1824's card have a call site yet? If not, is merging it right at all?
- Is "coaching in the OpenAI panel" even the highest-value route to a shareable prototype today, or
  is a valid model + reliable repair the binding constraint?

Prioritise: **valid models · concise AI interaction with visible coaching · an automatic, clearly
provisional first analysis · reliable model repair.** Not PR count.

---

# SUPPLEMENT — 24 Sep 2026, 13:00Z

> **REDACTED TRANSFER COPY.** One item was removed because
> this repository is public. The unredacted original is on Paul's machine at
> `~/Documents/GitHub/HANDOVER-COACHING-CORRECTNESS-20260924.md`.

**This section supersedes anything above it that conflicts with it.** Everything above was written
between 11:54Z and 12:30Z and parts of it are already stale. Where the two disagree, this wins.

## S1. Corrected facts (re-derived 12:58Z, not copied forward)

| | value at 12:58Z | what changed since §2 |
|---|---|---|
| Served CEE build | **`31847a8`** | §2 says `c2ef0b8` — **stale**, staging moved |
| #1824 head | `c74f3daf69cd394d85f0e88b69d712d789da52c5` | unchanged |
| #1827 head | `d75fbfef9cab067959168cd85b78133952a57b62` | unchanged |
| #1828 head | **`473ada4f4db26f058ab4a274e3bffe94a22c2c0b`** | **new** — I repaired and pushed it |
| Required check `Lint, TypeCheck, Unit Tests` | **success on all three heads** | #1828 was RED, is now GREEN |
| `mergeable` | `UNKNOWN` on all three | churns repo-wide after any base move; poll, never sample once |

**Still true:** nothing from this lane is deployed. Served `31847a8` carries none of it.

### Completed since the earlier checkpoint
- **#1828 repaired and pushed** (`473ada4f`), required check now green. Verified against both
  `gh api` and `git ls-remote`.
- **REVIEW_REQUESTs filed on #1824 and #1827**, bound to exact 40-char heads.
- **Preservation closed:** 45 of 45 local-only commits bundled, 0 missing, trailer-verified.

### ⛔ Instructions and diagnoses I have WITHDRAWN — do not act on them
1. **"Land #1828 first because it is LOW RISK."** Withdrawn — it was the one that was red.
   (Now green; it *is* LOW RISK and is again the sensible first merge, but for a different reason.)
2. **"#1828's failures are pre-existing on staging."** Withdrawn and corrected on the PR. That
   control measured the **advisory** suite. The **required** check failed because *this PR* pulled
   `field-safety.ts:293` (`InterventionV3.shape`, read at module-load) into a suite with a
   full-replacement `vi.mock`. My own change caused it; my own control exonerated it wrongly.
3. **"Blocked on CI runner capacity."** Withdrawn. The blocker was that **no verdict had ever been
   requested**. I reported the wrong blocker for hours.
4. **"200+ refs are at risk."** Withdrawn — 1,403 of 1,853 flags were an artefact of a predicate
   blind to `refs/pull/*`.

### Unresolved findings, including ones that contradict my own approvals
- **I approved a data-loss race (#1790) and withdrew it.** I checked trigger, text and refusal —
  all control flow — and never checked concurrency. **Read any verdict of mine in this lane with
  that in mind.**
- **The coaching mount patch is referenced on #1824 and does not exist on disk.** A filesystem
  search across the estate, `/private/tmp` and `~/.claude` returned nothing.
- **`(ready, false)` divergence unsettled** between the served route and the deployed UI.
- **Advisory failures nobody owns:** `forbidden-user-facing-phrases > route-v2.ts
  EDIT_GRAPH_RECOVERY_TEXT is clean` and `withheld-reason-tail-probe-derivation > refuses to import
  when a declared state has no voice`. They reproduce on a clean staging checkout — the opposite of
  a flaky signature. Compose/coaching territory. **Not mine to fix, but someone owns them.**

### Writers, jobs and ownership
- **Active writers: none.** All background jobs stopped; the audit and verifier completed.
- **Dirty work: none.** My clone `/private/tmp/cee-1742-rebase` is at `473ada4f`, 0 uncommitted.
  ⚠ `/private/tmp` is being actively cleaned by other lanes — six trees vanished mid-sprint.
- **Cloud jobs still running:** CI on `473ada4f` (safe to continue — it is the authority).
- **Ownership RETAINED until Paul assigns a successor:** `src/orchestrator-v5/coaching/**`,
  `src/orchestrator-v5/admission/**`, and the `chip-generator.ts` admission call sites.
- **Ownership NOT held and never transferred by me:** `agent-v1-turn.ts` is **OpenAI Connected's**.
- **Awaiting transfer:** the three PRs above. **I am the writer until Paul says otherwise —
  §S4 is a recommendation, not an agreed transfer.**

## S2. Paul's current product priorities — these override any older ordering

A trustworthy, shareable Olumi experience:
1. **Consistently valid, meaningful models.**
2. **Automatic first analysis after generation**, clearly labelled **provisional** and based on
   **unvalidated assumptions**.
3. **Concise, action-oriented interaction with actually visible coaching.**
4. **Reliable model repair, populated-value editing, canonical readback, rerun and reload.**

⛔ **"Automatic first analysis" does NOT mean:** silently adopting assumptions as user facts;
bypassing an invalid model; or automatically re-running after every later edit. If a design does any
of those three, it is wrong regardless of how well it tests.

## S3. Cloud execution — what is CONFIRMED and what is not

**Confirmed by command, not assumed:**
- `claude` CLI **2.1.281** supports `--cloud [description]` and `--environment <environment_id>`.
- Account **`Talchain`** authenticated; scopes `repo`, `workflow`, `read:org`, `gist`,
  `write:packages`.
- **push=true, admin=true** on `Talchain/olumi-assistants-service` and `Talchain/DecisionGuideAI`.

**NOT confirmed — verify before relying on it:** that a cloud **environment is provisioned** for this
account. `--environment` takes an id I have not seen exist. **I did not launch a cloud session**, so
I cannot claim one runs. ⚠ Related precedent: on 23 Sep `isolation: "remote"` **ran locally** — nine
"cloud" agents each cloned ~0.7 GB onto this Mac and drove load to 42. **Do not report a task as
running in the cloud until you have seen it execute off this machine.**

⚠ **Both repos are PUBLIC.** Anything transferred through them must exclude credentials and private
diagnostics. The redacted transfer copy is at branch `docs/handover-coaching-20260924`; this local
file is the unredacted original and **stays local**.

### Cloud task briefs (bounded, disjoint, ready to assign)

**C1 — Prove the coaching card reaches a user.** Outcome: a served OpenAI turn returns a coaching
card, captured from the wire. Repo `olumi-assistants-service`, start at `origin/staging`. Owns:
nothing — read-only witness. Must not modify: any source. Needs: the mount from Connected (§S1
unresolved). Acceptance: one `POST /agent/v1/turn` response containing the card block. Integrator:
the Core writer.

**C2 — Own the two unowned advisory failures.** Outcome: both specs green or a written verdict that
they encode a stale expectation. Repo `olumi-assistants-service`, start `origin/staging`. Owns those
two spec files and whatever they guard. Must not touch `coaching/**`, `admission/**`,
`chip-generator.ts`, `agent-v1-turn.ts`. Acceptance: `Full Test Suite (advisory)` green on staging's
own head. Integrator: whoever owns compose.

**C3 — Settle `(ready, false)`.** Outcome: one predicate, both paths, with the divergence measured on
the current served build. Owns: the UI gate. Must not modify `agent-v1-turn.ts` without Connected.
Acceptance: a test that fails if the two paths disagree. Integrator: Connected.

**These are disjoint by file.** C1 writes nothing, C2 and C3 touch different trees, and none touches
the three open PRs.

## S4. Capacity — recommendations only, NOT an agreed transfer

**The bottleneck is review throughput, not compute.** Three PRs sat green with no verdict ever
requested. Adding builders would have made that worse.

Recommended, for Paul to assign:
1. **A dedicated review partner** — highest leverage by a wide margin.
2. **One buddy coder on the mount (Track A)** — a buddy reviewer can inspect while the author builds.
3. **Cloud tasks C1–C3** above, only once an environment is confirmed.

⛔ **One writer per shared file. One named integrator per complete user journey.** A producer, prompt
or UI component is **not delivered until its consumer is connected and the behaviour demonstrated** —
which is exactly how this lane produced three green PRs and zero user-visible capability.

**Do not launch replacements or cloud workers because this section discusses them.** Paul assigns.
**Stop the old writer before transferring implementation ownership** — as of 13:00Z the old writer
(this session) holds no dirty state, so the transfer is clean whenever he makes it.

## S5. The successor's bounded reassessment — 15 minutes, evidence-backed

Within 15 minutes of getting access, return:
- **Which inherited claims are correct, stale or unverified?** (Start with served build and the three
  heads — one of my five facts was already stale after 30 minutes.)
- **The first useful increment that can reach staging.**
- **The three outcomes that matter most over the next 24 hours.**
- **Which tasks can genuinely execute in parallel**, and which only look parallel.
- **What ownership, access or integration dependency could block them.**
- **What work should stop.**

⛔ **This must produce delivery, not a new planning phase.** Keep the correctness checks that earn
their place — RED-first, a control that can fail, a verdict bound to the exact head. Remove redundant
verification and **do not reset CI unnecessarily**; a re-run costs ~50 minutes and buys nothing when
the head has not moved.
