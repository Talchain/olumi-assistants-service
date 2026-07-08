# bakeoff-v6 — V6 offline dual-model bake-off platform

**Benchmark tooling ONLY.** Nothing here is imported by `src/**` or any production
surface; never PMS, never deployed, never a live mutation path. This lane is the
**offline graph-generation bake-off** — the only LLM scoring prompt here is the
holistic whole-graph judge. Coaching / decision-review bake-off is a later,
separate lane.

Four arms behind one interface (brief in → GraphV3 candidate out):

| Arm | What it is | Models |
|---|---|---|
| **A** | Current served single-model draft, mirrored as an offline call (PMS untouched; prompt is a slot) | `claude-sonnet-4-6`, temp 0, max_tokens 16384, GA structured outputs |
| **B** | Equal-compute stronger single model at high reasoning effort — **B is the bar** | `claude-opus-4-8`, adaptive thinking, effort `high`, task-budget compute-matched |
| **C** | M1 drafts → M2 critiques and emits **discrete enrichment proposals** → deterministic code merges (never a model) | M1 `claude-sonnet-4-6`, M2 `claude-opus-4-8` |
| **D** | Advisor-tool arm | executor `claude-sonnet-4-6`, advisor `claude-opus-4-8`, beta `advisor-tool-2026-03-01`, tool `advisor_20260301` (`max_tokens: 2048` on the tool) |

Every candidate from every arm is validated against the REAL GraphV3 draft-graph
contract (`src/schemas/cee-v3.ts`, imported read-only — never re-created).
Invalid candidates are **counted per arm**, never dropped, never crash the run.

## Commands

```bash
cd tools/bakeoff-v6
npm install              # tool-local deps (root pnpm lockfile untouched)
npm test                 # 74 tests, RED-first guards + determinism snapshots
npm run typecheck        # tsc --noEmit
npm run provenance       # regenerate provenance.json (pins every seam)

npm run smoke            # deterministic mock run — no network, no keys
npm run preflight -- --run-id preflight-$(date +%Y%m%d)   # key + model-access gate only

# THE press run (see gates below):
ANTHROPIC_API_KEY=... npm run press -- \
  --run-id bakeoff-1 \
  --seeds 17,42,99 \
  --attestations /path/to/attestations.json \
  --holistic-llm
```

Useful flags: `--arms A,B,C,D` · `--briefs buy-vs-build,hire-vs-contract` ·
`--seeds 17,42` · `--results-dir …` · `--run-seed N` (blind-shuffle seed).

## Hard inputs for the REAL benchmark — all of them, no exceptions

The pipeline runs today, but a run is **evidence** only when every one of these
exists. Anything missing ⇒ every report is watermarked
**`PIPELINE SMOKE TEST — NOT EVIDENCE`** (fail-closed by construction: the gate
needs positive attestations; there are no negative flags to "switch off").

| Input | Status today | How it lands |
|---|---|---|
| **Real prompts** (M1, M2, advisor/executor, arm A served text, holistic judge) | PLACEHOLDER slots | Drop text into `prompts/*.system.txt`, delete the `# PLACEHOLDER` header line, keep the `# BENCHMARK-ONLY` banner. Machine-verified: any remaining placeholder forces the watermark. |
| **API keys + pre-flight** | Pre-flight PASSED 2026-07-02 (see `PREFLIGHT-2026-07-02.json`) | `ANTHROPIC_API_KEY` in env; every arm must pass the probe (served model IDs recorded; no silent substitution). |
| **Judge clearance** | NOT cleared (Phase I pending Paul's blind labels) | `attestations.json` points at the clearance artifact; the verdict provider must be the cleared judge — the built-in `deterministic_smoke_stub` can never attest. |
| **Labels** | NOT present | `attestations.json` points at the labels file. |
| **R — warranted reference set** | **NOT BUILT — hard input, third human-judgement input** | One file per brief: `fixtures/r-sets/{brief_id}.json`. Without R: reports show **precision + safety only**, recall and full FGQ are `pending R`, and **no claim about which arm found more warranted content can be made**. |
| **Verified arm-D usage/cost shape** | **NOT VERIFIED — required for any D comparison** | The advisor tool's `usage.iterations[]` shape has not been confirmed on a real arm-D generation call (pre-flight only probed *access*, not a full draft). Until the first real advisor generation confirms the shape and the cost mapper is checked against it, arm-D USD cost is **provisional** and **B@D equal-compute matching is provisional** — no D comparison is evidential. |

So the real-benchmark input list, all required, is:

1. Paul's blind labels;
2. proposal-quality judge clearance;
3. real reviewed prompts;
4. warranted reference set **R** (recall / decisive FGQ comparison stays blocked without it);
5. verified arm-D `usage.iterations[]` / cost shape (D comparisons stay provisional without it).

`attestations.json` shape (all fields required; paths must exist on disk):

```json
{
  "real_prompts": true,
  "judge_clearance_path": "…/clearance.json",
  "labels_path": "…/labels.csv",
  "attested_by": "Paul",
  "date": "2026-07-02"
}
```

## What a run produces

`results/{run_id}/`:

- `candidates/*.json` — one record per arm×brief×seed: arm, seed, prompt hashes,
  requested + SERVED model IDs, timestamps, per-call usage (incl. raw
  `usage.iterations[]` for arm D), USD cost, latency, the candidate itself,
  validation outcome, arm-C raw proposals + merge report, defer artifacts, and a
  `canonical_hash` over the timing-free record (determinism proof).
- `presentation_map.SEALED.json` — blind_id ↔ arm map. **Sealed**: scoring code
  never reads it; unblind only after labelling/judging.
- `preflight.json`, `run.json`, `scores.json`, `report.md`.

**Report anatomy** (`report.md`): watermark banner (with reasons) → headline
per-arm table (FGQ precision / recall-or-`pending R` / safety-capped / holistic
det + LLM / true USD cost / latency) → safety cells → equal-compute audit →
latency percentiles → **silent-exclusion accounting** (every candidate and every
proposal in a counted bucket) → cross-arm alignment matrix → blinding note.

## Method notes

- **Equal-compute matching** — currency is **USD** (pinned pricing table with
  source/as-of/staleness provenance in `src/llm/pricing.ts`; runs warn when the
  table is >30 days old). C and D run first per (brief, seed); their realized
  spend sets per-brief token budgets for **B@match_c** and **B@match_d**
  (`output_config.task_budget`, min 20k tokens). Arm-D cost comes from
  `usage.iterations[]` — never top-level tokens. Pre-declared tolerance
  **±20%**; out-of-tolerance comparisons are flagged in the report, never
  silently accepted.
- **Arm-C merge** — deterministic code, not a model. Proposals validated against
  the real `NodeV3`/`EdgeV3`; duplicate ids/labels, dangling endpoints,
  direction/sign mismatches and malformed envelopes are RECORDED failures;
  clarification/uncertainty/evidence-gap proposals are non-mutating defer
  artifacts (FGQ's ratified defer-credit rule applies). Post-merge, the full
  candidate re-validates against the contract.
- **Blinding** — scorers accept only allowlist-built blind payloads
  (brief + structural graph + normalized open questions). A leak scanner with
  tokens derived from the live run config (arm ids, model ids, prompt
  names/hashes, run id, timestamps, proposal provenance) runs on every payload;
  a hit means that payload is REFUSED scoring and counted.
- **Holistic scorer** — two layers, both blind: a deterministic whole-graph
  scorer (connectivity, orphans, referential integrity, duplicates, option
  coverage, parsimony — always runs) and a wired-but-held LLM whole-graph judge
  (`--holistic-llm`, `claude-opus-4-8`). This pair is the guard against arm C
  scoring well merely because its output decomposes cleanly into elements.
- **FGQ** — vendored TS port of the judge scaffold's metric
  (`src/scoring/fgq/fgq.ts`, provenance header inside; all 8 known cases +
  162-point parameter-wobble grid re-asserted in tests). Verdicts flow through a
  provider seam (`src/scoring/verdicts.ts`); the cleared judge plugs in there.

## Arm-A mirror caveats (recorded in provenance.json)

Mirrored from the adapter at the pinned base SHA. UNVERIFIED against live
staging env: structured-outputs flag state (mirrored ON), `CEE_MAX_TOKENS_DRAFT`
(assumed unset ⇒ 16384), and the served PMS prompt text (slot only).

## Hard limits honoured

Additive-only under `tools/bakeoff-v6/`; no edits to `src/**`, schemas, prompts,
PMS, turn executor, coaching/claim-safety surfaces, UI, PLoT, ISL; no staging or
production data writes; no push/PR/deploy/flag flips. The two external judge
directories are read-only reference (`~/v6-proposal-quality-judge`) and sealed
(`~/v6-d8-judge-hardening` — never touched).
