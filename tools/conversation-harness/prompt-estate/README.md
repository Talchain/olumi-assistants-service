# prompt-estate — rescued orchestrator-prompt lineage & revert anchors

**Archival snapshot. Not a live/maintained mirror.** Copied **2026-07-19** from the
laptop directory `~/Documents/GitHub/orchestrator-prompt-workstream/` — a **non-git,
single-copy** working dir that existed nowhere else. This rescue exists because a laptop
failure would have erased the only copies of the served-prompt lineage and the PMS
revert anchors (investigation I3).

> **Source-of-record note.** The laptop dir **remains the source-of-record for in-flight
> workstream work** (planning docs, raw run transcripts, built prompt stores) until the
> orchestrator-prompt workstream formally migrates. This directory is a frozen rescue of
> the *durable, at-risk* artefacts only — treat every file here as a point-in-time copy,
> never as a competing source of truth for anything that also lives in `src/`.

## What is here

| Path | What it is | Why it is load-bearing |
|------|-----------|------------------------|
| `revert-anchors/pms-revert-anchor.txt` | `orchestrator_default` staging revert anchor (v116/v117 identity + rollback recipe) | The authoritative recipe to roll back the served orchestrator prompt. Irreplaceable. |
| `revert-anchors/decision-review-revert-anchor.txt` | `decision_review_default` staging revert anchor (v13/v14 identity + rollback recipe) | Same, for the decision-review prompt. Irreplaceable. |
| `candidates/v42.2*.txt`, `candidates/s5*.txt` | The full assembled orchestrator-prompt candidate corpus (13 versions, ~22KB each) | The served-prompt **lineage** in canonical text form. |
| `candidates/build-*.py`, `build-stores.py` | The generators that assembled each candidate | How each version in the lineage was built. |
| `candidates/*.md`, `candidates/runs/comparison-*.md` | Eval **results summaries** (iteration report, round-1, validation, bisect/hardening, A/B comparisons) | The load-bearing verdicts behind the promotions. |
| `candidates/journey-*.json`, `hardening-*.json`, `boot-*.sh`, `run-*.sh`, `preflight-*.ts`, `score-run.ts`, `compare-runs.py`, `pms-file-shim.mjs` | The run recipes / eval inputs the corpus was scored against | Reproduce the eval that produced the results. |
| `guide/HARNESS-GUIDE.md`, `guide/UPLOAD-RUNBOOK-v42.2g.md` | The PMS-upload + revert mechanism guide (**not** covered by this harness's `README.md`) | The procedure that pairs with the revert anchors. |
| `scoring/scores.json`, `scoring/scores.md` | The baseline scoring results | Eval output; no live counterpart in `src/`. |

## What was deliberately EXCLUDED (and why)

Nothing here contained a real credential (every file was scanned for key/token/bearer
patterns before staging — the only hits were placeholders like `<paste staging admin key
here — do not commit>`, the header *name* `x-admin-key`, and meta-discussion of the
separately-tracked admin-key rotation item; **no key value is present**).

Excluded classes:

- **`candidates/stores/`** (~2.7 MB built prompt stores) — these *mirror served PMS
  content* and are **regenerable** from the `build-*.py` scripts; the lineage text is
  already fully preserved in the `v42.2*.txt` / `s5*.txt` corpus. The harness
  `.gitignore` designates `stores/` local-only.
- **`candidates/runs/` raw transcripts + `*.log`** (~10 MB) — the harness `.gitignore`
  policy is explicit: *run artifacts are never committed wholesale — they can embed
  staging payloads and served prompt content.* Only the three `comparison-*.md`
  summaries were kept.
- **`candidates/staging-parity.env`** — config values (local-only per `.gitignore`); the
  names-only `staging-parity.env.example` already lives in the harness root.
- **`scoring/mutation-language.ts`, `scoring/forbidden-user-facing-phrases.ts`,
  `scoring/score-baseline.ts`, `scoring/preflight-v422c.ts`** — these were **stale
  verbatim snapshots (dated 7 Jul) of live source** that still lives fresher in
  `src/orchestrator-v5/compose/forbidden-user-facing-phrases.ts` and
  `src/orchestrator-v5/routing/mutation-language.ts`. Committing them would create a
  hand-maintained mirror that drifts and mis-answers a grep. **The live source of truth
  is `src/`**, not this archive.

## Pointers

- Live prompt-eval scorers: `tools/conversation-harness/scorer/`.
- Live localisation/forbidden-phrase source: `src/orchestrator-v5/`.
- The broader workstream (STATUS, PROPOSAL, HANDOVER, patch plans, raw evidence) stays on
  the laptop until the workstream migrates.
