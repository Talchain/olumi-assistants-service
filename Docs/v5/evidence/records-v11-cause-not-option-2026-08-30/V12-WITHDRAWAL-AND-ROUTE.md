# v11 WITHDRAWN → v12 names the `option_refinement` route (2026-08-30)

⚠ **Nothing in this directory's v11 artefacts has been edited.** `README.md`'s body,
`paired-draws.json`, `records-instruction-v11.txt` and the deployed BEFORE witness are the
record of what was measured and emitted on dated bytes. They are append-only evidence, not
fixtures to keep current (CLAUDE.md trap 14b). This file is an addition.

## Why v11 was withdrawn

v11 read as working — **6 of 9 draws** on the diagnostic briefs stopped filing competing
explanations as options. **All six were clean only via `stated_items[].kind = "claim"`, a value
that does not exist.**

`DRAFT_RECORD_STATED_KINDS` is `["goal","option","constraint","figure"]`, and `grammar.ts:453`
puts that enum in the structured-outputs schema the deployed draft sends (the capture records
`structured_outputs_used: true`). **The route is closed on the wire**, so those six draws could
not have happened in production.

- Of the **3 draws inside the legal enum, 3/3 filed the causes as options.**
- **0 of 27 cause-instances** reached the intended destination.
- **Contrast control:** the illegal kind occurs **25× across 8 AFTER draws, 0× in any BEFORE
  draw** — v11's own wording introduced it.

## The two defects, both about DESTINATION

1. v11 wrote *"File each as a `claim`"* and *"the disagreement itself is a `claim`"* **inside the
   `kind` enumeration**, where `option` / `constraint` / `figure` are the sibling bullets. Read in
   place, `claim` is a fifth `kind`. The model complied, in the only list it was standing in.
2. v11 then said *"the options are what the user could DO about the problem"* while still inside
   `stated_items`, every entry of which must be a **verbatim brief span**. On a brief naming no
   course of action there is no such span — the sentence asked for something the stated grammar
   cannot express and named nowhere else to put it.

## What v12 changes

**No record kind added; the grammar is untouched.** That would solve a carrier problem that does
not exist. `option_refinement` is already a `DRAFT_RECORD_CLAIM_KINDS` member,
`CLAIM_KIND_TO_NODE_KIND` maps it to `option`, and projector pass 1b declines to merge one whose
`basis` names no stated option — so it stands as its own alternative with its own chain.
Independently confirmed by four executable same-module controls at `a18e1943`
(`olumi-programme-docs@f862392d/codex-evidence/resume-20260830/1238-route`).

v12 keeps v11's exclusion verbatim and replaces only the destination:

- `kind` has no fifth value, said **in the list the model was standing in**;
- the cause goes to `claims` as `factor` / `risk`;
- **every hypothesis is retained** — the disagreement is the user's reasoning;
- an action the model puts forward is an `option_refinement`;
- `basis` empty stays honest.

Said with **no provenance vocabulary**: the model has no provenance channel, and the standing
`"says nothing it must not say"` guard forbids the concept — a model told about a stamp it cannot
set will approximate one. The projector delivers the guarantee; the instruction names the array.

Connect half **byte-identical** (`b631a953…` / 4,544).

## Acceptance — and the instrument's limit, stated first

⚠ **These are DETERMINISTIC CONSUMER CONTROLS** over the real
`ingress → projector → projectGraphAndOptionsToV3 → assessCanonicalAnalysisReadiness` chain
(`src/cee/draft/records/__tests__/diagnostic-brief-reaches-analysis.test.ts`, 6/6 by name).

**No provider draws were taken** — the measuring environment had no credentials. So the
`kind:"claim"` count in new draws is **NOT MEASURED**, not measured-zero. The admin harness was
deliberately not used: it sends one system block where the live draft sends two and carries no
grammar, which is exactly how v11's illegal escape went unnoticed.

They prove the pipeline **CAN** carry a diagnostic brief to a completed analysis with attribution
intact. They are **NOT** evidence the model **WILL** emit this shape.

| arm | result |
|---|---|
| (a) explanations no longer filed as options | **MET** — zero explanation-shaped options, and all three hypotheses survive as `factor` nodes |
| (b) genuine-choice briefs keep every real option | **MET, 2/2, zero losses** — two attributed real acts stay options and stay `from_brief` |
| (c) the diagnostic brief reaches a completed analysis | **MET** — `blockingIssues: []`, `status: "ready"`, `safeToAnalyse: true` |

Arm (c) judged on the four things that were asked, not on "zero false options":

- **retained hypotheses** — all three present as factors;
- **correct attribution** — every option `ai_inferred`, never `from_brief`;
- **no unsupported quantities** — all 6 interventions `cee_hypothesis` / `value_confidence: low`,
  never `brief_extraction`;
- **completed analysis** — `safeToAnalyse: true`.

**Discriminating control:** flip ONLY the two claims' role to `factor`, hold every other byte —
`ready` disappears. The verdict is about the route, not a permissive pipeline.

## Owed

A deployed `/assist/v1/draft-graph` witness on the A1 brief, and a grammar-legal provider-emission
measurement. Neither is claimed here. **Rung: TESTED.**
