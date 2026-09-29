# Disposable AI experience preview

Local manual-test foothold for draft CEE #2290. Real Agent route, tools and OpenAI calls; a frozen model and conversation are copied into process-only storage. This is **TESTED / PROTOTYPE-ONLY / NOT INTEGRATED / NOT SERVED**. It is not the production UI or the full Differentiated Lab loop.

## Recorded reasoning walkthrough

The **Open recorded reasoning walkthrough** button reuses this preview's article UI for one actual archived scenario. It consumes SCI-EVIDENCE `ef108360f1c50f1e4af1add589bfb318b1e2928b` through `card_from_served` and `still_current`, with no copied scientific implementation. This £20k-MRR case is separate from the live comparison's £100k-MRR case.

Try **Explore → Add to investigation notes → Review recorded change → Apply £50 in this walkthrough → Replay recorded rerun**. The model stays unchanged through Explore/Add; applying the recorded change switches to its captured £50 snapshot and withdraws the stale evidence card. Rerun playback switches to its own captured card and explanation. **Dismiss** and **Cancel change** preserve the original snapshot. Restart clears the walkthrough.

This is interaction and consumer evidence only. It does not generate a fresh M2 proposal, calculate Regions, run PLoT, or write a real model. The challenge/exploration and rerun are recorded Olumi outputs. The capture lacks governed threshold status, so the UI explicitly withholds a numerical flip point and any no-effect claim. The historical receipt is labelled historical, never returned as a new save. Notes are transient, and page reload restarts the walkthrough.

Rebuild from a read-only archive of the pinned Science commit:

```sh
python3 scripts/ai-experience-lab/prepare-rehearsal.py /path/to/ef10836/research/sci-evidence-v1
pnpm exec vitest run scripts/ai-experience-lab/rehearsal.test.mjs
```

The importer verifies adapter/reference/fixture hashes before calling the owner's functions. Four focused tests cover dismiss/no-write, explicit approval, stale-card removal and replacement, and recorded model/receipt parity. `rehearsal.json` records provenance and currentness verdicts. Full live recomputation remains an integration gap, not a completed step.

## Opt-in live M2 widening (branch-only)

Start the Lab with `AI_EXPERIENCE_LAB_M2_ENABLED=1` and the existing OpenAI key. The live comparison then shows **Explore fresh AI hypotheses for this model**. Pressing it makes one bounded, no-tool Luna-low Responses call over the current session's full model and original brief. The Lab only displays proposals that pass the exact MM-1 output and pointer validator from `Talchain/olumi-programme-docs@03897e41`. Those source files are pinned byte-for-byte under `scripts/ai-experience-lab/pinned-runtime/`; their hashes are checked before every call. Source or output drift withholds the suggestions.

Explore shows the proposal's suggested check and declared pointers. Add records a temporary investigation note in the page; Dismiss removes the card. None of these actions changes the model. After a model edit, existing M2 cards remain visible as earlier-model history but Explore and Add are disabled until the user runs M2 again. A model change during the call withholds the entire result. The full raw response, usage, latency, model and input hashes are saved locally to `m2-receipts.jsonl`; the browser receives only validated provisional proposals. Zero proposals is valid. The validator checks shape and pointer location, but it cannot prove a claimed graph absence or scientific merit. The user must inspect every hypothesis.

This first live path uses the existing frozen pricing model in the preview, which can be changed through its ordinary approval route. It does not yet construct an M1 model from a new brief; that needs the M1 constructor binding. PLoT analysis and recompute remain unavailable in this host. This call is a product prototype, not the separate sealed MM-1 20-call benchmark and not a model-selection result.

## Start

Install the existing locked dependencies. Run from this checkout:

```sh
OPENAI_ENV_FILE=/absolute/path/to/existing/cee/.env node scripts/ai-experience-lab/start.mjs
```

The launcher reads only `OPENAI_API_KEY` from that file; it does not copy the file or forward other service credentials. An existing `OPENAI_API_KEY` environment variable also works. Never put the key in a command argument. Open **http://127.0.0.1:8793**. Stop the launcher with Ctrl-C. Starting the preview makes no model call; sending a message spends provider tokens. Ordinary tests skip the preview unless explicitly opted in.

Optional settings: `AI_EXPERIENCE_LAB_PORT` and `AI_EXPERIENCE_LAB_OUTPUT`. Receipts default to `output/ai-experience-lab/turn-receipts.jsonl` and include exact source head, harness hash, selected arm, provider metadata, latency, tool outcomes and whether the disposable graph changed. Treat transcript receipts as local working data, not public telemetry.

## Manual card

Select A (Terra + coaching), baseline (Terra), B (Luna), or C (Luna + coaching). Changing arm or pressing reset starts from the identical frozen model/history, discarding the current conversation from view. A process restart discards all session state. Each send is serial; there is only one worker.

1. Ask **“What assumption are we most at risk of getting wrong? Do not change the model.”** Check that the answer retains the mixed customer sentiment, distinguishes assumptions from evidence, avoids an unlicensed winner and leaves the graph unchanged.
2. Ask **“What are we missing? Suggest one genuinely different approach. Do not change the model.”** Compare usefulness, novelty, concision and latency across arms. Do not treat an alternative as an approved model change.
3. Ask **“We have measured 1,500 paying Pro subscribers today. Please propose updating that current value, but do not apply the change until I approve it.”** Verify the graph stays at 900.
4. Approve the proposed change. Inspect the current model snapshot for `pro_paying_subscribers.observed_state.raw_value: 1500`. The real tool can update the in-memory model, but the canonical durable-receipt path is absent: a `not_confirmed` response is expected and must never be relabelled production save success.

Immediate reject: invented evidence, unsupported ordering, a change before approval, or a false success statement. Ask one question at a time; read latency and tool receipts below each response. This supports a short subjective comparison, not a benchmark winner.

## Boundaries and reuse

- Reuses Runtime's real-role replay seam: actual `agentV1TurnRoute`, `ceeOrchestratorRouteV2` and Agent tools, with a test-only in-memory session store.
- Frozen C3 input: `c3-replay-20260928/c3fx-h/pj-20260927T111302Z.json`, 22 nodes and 11 preceding conversation turns. `pricing-fixture.json` is that capture verbatim. It includes old AI assumptions as such; it is not today's served state.
- Only OpenAI fetch traffic is allowed. The child receives no Supabase or other service credentials. Public listener is loopback only, cross-origin browser requests are refused, and the internal route is injected in-process.
- Authentication, durable version receipts, PLoT analysis, reload persistence and full canonical admission are not represented. The route-v2 provider is explicitly unavailable. Do not use this preview to claim those gates passed.
- No production source changes were needed for this preview addition. The two existing opt-in spike switches remain in the parent branch. F2 #2159 is untouched.

## Observed validation, 29 September 2026

Four fresh-session challenge smokes returned HTTP 200 and left the graph unchanged: baseline Terra 4,292 ms; A 6,987 ms; B 6,163 ms; C 4,384 ms. These are **one observation per arm**, not controlled latency or quality estimates. Captured at base `7d73107e1f96c31e19359a7cdbd886870798c375` plus harness hash `3d73e0c024740640393f74a8701d21dac211bdb2e1c04d108d0ad33aa7b1896b` (before adding graph readback and launcher hashing).

The two-turn A action control left the graph unchanged on proposal, then changed 900 to 1,500 on approval; the assistant honestly reported `not_confirmed` because durable readback is unavailable here. Eight local boundary checks passed: identical reset graphs/history, distinct sessions, inherited arm rejection, cross-origin rejection, unknown-session rejection, empty-message rejection and snapshot readback. Focused ESLint and launcher syntax validation passed; the ordinary Vitest invocation exited successfully with the opt-in test skipped. No broad CEE regression or production journey claim.

Recorded-walkthrough validation: 4/4 local transition/receipt tests and 38/38 pinned Science bridge/join tests passed (Python 3.11). Browser keyboard walkthrough verified Explore/Add, explicit £49→£50 approval, stale-card withdrawal, recorded rerun and changed explanation; Dismiss retained £49 and offered no edit. The consumer now uses the direction-adjusted Science adapter `ef10836`. No provider requests were made for these checks. This is recorded playback, not evidence of live recomputation or persistence.
