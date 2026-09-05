# Founder-fixture wire harness

Runs the founder fixture's eleven turns against a **deployed** build and decides
`ACCEPTANCE.md` **section A** — the six deterministic criteria — as
**PASS / FAIL / NOT ASSESSED**. Turns 8 and 9, and every section-B quantity, are
**recorded and never decided**.

The fixture is the specification and lives in `Talchain/olumi-programme-docs` on
branch `primary/founder-fixture-2026-09-04`, at `artefacts/founder-fixture/`:
`BRIEF-FOUNDER-VERBATIM.txt` (+ `.sha256`), `SCRIPT.md`, `ACCEPTANCE.md`,
`PROTOCOL.md`, `README.md`. **This tool does not redesign it. It runs it.**

## Why it exists

The agreed condition with the independent reviewer is *"the failed conversation
becomes the acceptance test; engineers must complete it before asking Paul to
repeat it."* Until now nobody could, because the fixture was a protocol a human
follows. Its criteria had already named two defects the estate then spent five
days rediscovering by hand — turn 7's misroute and turn 8's flat 50% strengths.

## Run it

```bash
# live, against deployed staging
pnpm fixture:founder -- \
  --brief /path/to/olumi-programme-docs/artefacts/founder-fixture/BRIEF-FOUNDER-VERBATIM.txt \
  --ui-repo /path/to/DecisionGuideAI \
  --out test-diagnostics/founder-fixture/$(date -u +%Y%m%dT%H%M%SZ).md

# deterministic replay — no network. This is the regression gate.
pnpm fixture:founder:replay

# the classifiers' own tests
pnpm fixture:founder:test
pnpm fixture:founder:typecheck
```

| flag | default | what |
|---|---|---|
| `--brief` | — | **required live.** Path to `BRIEF-FOUNDER-VERBATIM.txt`. Asserted by hash. |
| `--base-url` | `https://cee-staging.onrender.com` | the CEE under test |
| `--ui-base-url` | `https://staging--olumi.netlify.app` | where `/version.json` is read |
| `--origin` | `https://staging--olumi.netlify.app` | the `Origin` header — the route's only gate |
| `--ui-repo` | — | a **DecisionGuideAI checkout with `pnpm install` run**. Without it C4 is NOT ASSESSED. |
| `--expected-build` | — | strict deploy gate: halt unless `/healthz` reports this SHA |
| `--out` | stdout | where the evidence pack is written |
| `--replay` | — | replay a fixture instead of driving a service |
| `--require-fully-assessed` | off | exit 1 when anything is NOT ASSESSED |

### Exit codes

| code | meaning |
|---|---|
| `0` | no criterion FAILED. **Not "the fixture passed"** — read the headline. |
| `1` | at least one criterion FAILED (or, with `--require-fully-assessed`, anything unassessed) |
| `2` | fatal harness error |
| `3` | halted before deciding anything: brief hash mismatch, deploy gate, or the SHA of the service under test could not be established |

## What it can decide, and what it cannot

**This is the most important table in the file.** Several criteria have limbs a
wire harness cannot decide at all. The composition rule is therefore deliberately
pessimistic — **any limb FAIL ⇒ FAIL · every limb PASS ⇒ PASS · otherwise NOT
ASSESSED** — so a criterion carrying a permanently-undecidable limb can be
**refuted** here and never **certified** here.

| | decidable on the wire | not decidable here |
|---|---|---|
| **C1** no leader / rank / "Ahead N%" / "Stable" / "Robust" before the licence | the licence (`permitted_analysis_mode`) and every leader / rank / standing / robustness designation on the payload, on BOTH arms | whether a **badge rendered** — DOM |
| **C2** a refusal names the field and what would change it, and survives reload | `analysis_admission.reasons[].field` + `message`; and the reload half, because the admission is a pure function of the graph and is recomputed | whether it is **shown to the user** — DOM |
| **C3** no routing narration, scratchpad or chain-of-thought | in full | — (see the coverage caveats below) |
| **C4** no surface contradicts another | CX1, CX2, CX4, CX5, CX6, via the UI's own detector | **CX3's visible-body limb** — the detector says so itself: `resultBodyVisible` is "a payload-side proxy, not a DOM fact" |
| **C5** the correction reaches the named object, and turn 6 reruns | in full: the boundary `graph_patch` block carries `status: applied\|noop`, `operation`, `target_id`, `before`, `after` | — |
| **C6** turn 7 answers the question asked | the **misroute**: a `noop` patch with no hash movement, routing narration, or the no-change denial as the answer | whether the reply is a **responsive attribution** — semantic, not machine-decidable |

Reporting "no misroute markers" as "turn 7 answered the question" would swap the
symptom metric for the outcome metric. The harness states the two apart and
leaves the second to a human.

## A gap in the journey voids everything after it

**The eleven turns are ordered and stateful, so a turn that did not land is not a
missing data point — every turn after it is a different conversation.**

This was found by running the harness live. A blip dropped turns 0–5 of a staging run;
turns 6–11 landed and the harness decided them, reporting **C5 FAIL** and **C4 FAIL**. But
the scenario had never received the brief: *"Rerun."* arrived as the first message of an
empty conversation, and CEE's reply — *"I have not run the analysis, because I did not read
that as a request to run one"* — was correct behaviour. Two product defects fabricated out
of a network failure, on a fixture whose own rule is that a section-A failure is *"fixed or
reverted the same day"*.

So everything at or after the first gap is voided and every criterion that reads one goes
NOT ASSESSED, with a distinct and louder message when the turn that did not land was the
brief itself. Two consequences, both deliberate:

- **A FAIL that landed BEFORE the gap still stands.** Voiding is not amnesia: narration at
  turn 7 is a real leak whatever happened at turn 9.
- **C3 does not read PASS on a partial journey.** Its claim is about all the sends; with
  the brief dropped it scanned nothing, and "no narration found" over an empty corpus is an
  absence claim that could not have seen a presence.

## Six things worth knowing before you trust a result

1. **`NOT ASSESSED` is a first-class outcome.** Exit 0 with four criteria
   unassessed is the normal shape of a wire run, and the report says so in its
   first line. A harness that narrowed its scope to what it can see and reported
   the rest as PASS would be the exact failure this programme keeps paying for.

2. **Every detector runs a positive and a negative control before its verdict is
   believed.** Four criteria are absence claims, and a blind instrument returns a
   confident zero for all four. A detector whose positive control does not fire is
   reported unavailable and its criterion goes NOT ASSESSED. The control table is
   printed in every report.

3. **Nothing is re-implemented.** The narration vocabulary, the leader-claim
   alarm, the ordinal / standing / robustness key families, the claim vocabulary
   and the admission lattice are all **imported from their producers**; the
   contradiction gate is imported from the UI repo or reported unavailable. Two
   hand-kept copies of one vocabulary is the drift defect this estate pays for
   most often.

4. **The two C1 arms are scanned differently, and that is not a convenience.**
   `unrequested-analysis-confinement.ts` drops comparative standing and
   robustness verdicts from the post-draft auto-run; `withheld-claim-projection.ts`
   deliberately **keeps** every per-option probability on a requested run whose
   claim is withheld. Applying the unrequested predicates to a requested turn
   would manufacture a failure on every honest withheld run.

5. **The brief is asserted twice.** Once against the fixture's own `.sha256`
   sidecar, and again against the bytes recovered from the serialised request
   body. A harness that reports which fixture it *thinks* it sent is not
   evidence.

6. **The builds are derived at run time, never passed in.** CEE's SHA comes from
   `/healthz` and is a **hard stop** if it cannot be established. The UI's comes
   from `/version.json` — and a 200 proves nothing there, because the SPA
   fallback serves `index.html` for any path, so only the parsed 40-hex shape is
   evidence. PLoT and ISL are recorded as **unknown** rather than omitted.

## Declared coverage gaps

These are limitations of what is being measured, not of care. They are printed
in every report's caveats.

- **C3's known-uncovered class**, declared by the detector itself: an
  ordinary-English planning sentence with no internal marker (the module names
  *"I should offer concrete candidate values"*) is process narration and is not
  detected. A C3 PASS means "no marker in the canonical vocabulary".
- **C3 guard coverage**: `applyProcessNarrationGuard` has three non-test call
  sites. The 3 Sep witnessed leaks landed on coach / converse / text_only paths,
  which are not among them. A clean scan is evidence about the OUTPUT, not that
  the guard ran.
- **The user-visible field list is a sampled floor.** Every payload is scanned
  twice — once over the fields this harness will say a user sees, once over every
  string in the body. A hit only in the second is RECORDED, never failed: it may
  be a diagnostic field nobody sees, or a rendered field the floor does not know
  about, and the harness cannot tell.
- **The no-change denial family and the stability-verdict floor** are the only
  two hand-written pattern sets. Both are sampled from producer literals, pinned
  in both directions by tests, and neither is a tracking mirror — a new phrasing
  upstream will not be caught.
- **Section C's fidelity list is transcribed**, not derived. It feeds only
  recorded measurements, so a stale entry costs a misleading count in a report a
  human reads, never a false PASS.

## Turn 11 is not the user's reload

The browser's continuity is held in `localStorage` — the transcript at
`olumi-canvas-transcript`, the graph at `olumi-canvas-autosave` — and staging
runs `VITE_AUTH_MODE=guest`. A wire harness never had localStorage to lose, so
its "reload" (discard every client-side handle except the scenario id, then send)
measures **CEE-side continuity**, which is strictly more than the browser has.
A PASS here licenses no claim about what a user sees after refreshing.

## What it drives, and what that costs

`POST /proxy/v5/turn` — the **browser's** seam, not the service-to-service one.
The route is declared public in `src/plugins/auth.ts`; its only gate is the
`Origin` allowlist, which `proxy-v5-turn.ts` itself says a non-browser caller can
forge. `user_id` is stripped unconditionally, so a run is always an anonymous
guest. **This harness therefore holds no secret** — there is nothing to leak into
an evidence pack.

Each run mints a **fresh `scenario_id`** and CEE upserts it on the first turn.
There is no idempotency on this seam: two sends are two committed rows, so a
resend contaminates a scenario rather than replacing a turn. Never reuse a
scenario id between runs.

A live run sends twelve turns and consumes real LLM budget. The observed rate
limit is 60 requests/minute, which bounds how many runs can go in parallel for
the n ≥ 5 that section B requires.

## Files

| file | role |
|---|---|
| `index.ts` | CLI, live + `--replay`, deploy gate, exit codes |
| `script.ts` | the eleven turns verbatim, the numbering ruling, the C5 target tokens |
| `brief.ts` | the two hash assertions |
| `proxy-client.ts` | `POST /proxy/v5/turn`, `GET /version.json` |
| `detectors.ts` | the imported instruments + their controls |
| `payload-scan.ts` | user-visible vs payload-wide strings; the `type` vs `block_type` trap |
| `admission.ts` | `analysis_admission`, the graph_patch reader, absence ≠ refusal |
| `criteria.ts` | the six classifiers — pure, so replay and live decide identically |
| `measurements.ts` | turns 8 & 9, and section B as single-draw observations |
| `report.ts` | the evidence pack |
| `fixtures/*.json` | one per FAIL path, plus a negative control and a transport-loss case |

Reuses (does not fork) `../v5-journey-replay/` for the redactor, the healthz
probe, the deploy gate and the claim vocabulary, and
`../golden-journey-harness/observation.ts` for the wire body type.

## Fixtures

Each one exists to prove a criterion **can** fail. `no-failures.json` is the
negative control for the whole set: if it ever fails a criterion, none of the
others' failures are evidence about the thing they mutate.

| fixture | proves |
|---|---|
| `no-failures.json` | nothing FAILS; C1/C2/C4/C6 still NOT ASSESSED |
| `refusal-honest.json` | C2's wire limbs in their PASS direction |
| `red-c1-unlicensed-leader.json` | C1 FAILS on a leader claim, a rank and a stability verdict under `quantified_provisional` |
| `red-c2-silent-refusal.json` | C2 FAILS on a refusal with an empty `reasons[]` |
| `red-c3-narration.json` | C3 (and C6) FAIL on the verbatim 3 Sep routing narration |
| `red-c4-contradiction.json` | C4 FAILS on a CX5 contradiction — **needs `--ui-repo`** |
| `red-c5-noop-correction.json` | C5 FAILS when prose says applied and the patch says `noop` |
| `red-c5-off-target.json` | C5 FAILS when the correction lands on a different object |
| `red-c6-misroute.json` | C6 FAILS on the noop patch + no-change denial |
| `transport-loss.json` | a gap at turn 6 voids turns 6–11; all six criteria NOT ASSESSED |
| `brief-never-landed.json` | the real staging run that fabricated two defects — and it BITES: delete the voiding and C5 FAILS here |

They are **synthetic**. Turning a live run into a committed fixture is the
golden-journey harness's capture flow and needs the same authorisation.
