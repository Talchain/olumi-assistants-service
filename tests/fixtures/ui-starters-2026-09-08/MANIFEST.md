# UI bundled starter drafts — CAPTURED CORPUS, APPEND-ONLY

These five files are **byte-exact copies** of the starter graphs the deployed UI
bundles and applies to the canvas. They are not fixtures written for these tests:
they are recorded evidence, and are therefore **append-only — never edited to keep
them current** (CLAUDE.md trap 14b). If one genuinely must change, that is a
finding to report, not an edit to make.

## Where they came from

`Talchain/DecisionGuideAI` @ `5889379c`, `src/canvas/starters/data/<id>.draft.json`,
copied verbatim on 2026-09-08.

| file | sha256 | nodes | edges | factors | options |
|---|---|---|---|---|---|
| `build-vs-buy.draft.json` | `a32baac73de8fc98e4bc1659ccf06a7052ba6f7ebf9e1c83e34f62efffd7eac5` | 19 | 37 | 8 | 4 |
| `headcount-allocation.draft.json` | `fdc2fa6af5b697f9325927099ecebb22217d109c663638cc349b73450f6b7fdf` | 16 | 25 | 5 | 4 |
| `market-entry.draft.json` | `8b051247f126f5bfa8a94d72e565c2a1bcdee35a0627320e7af0ffca91886507` | 18 | 32 | 8 | 3 |
| `pricing-model.draft.json` | `1076c5a811f5b535250b5acf8279f93cc4d4256ac8653d07ed193cdbe2ce4660` | 15 | 30 | 5 | 4 |
| `vendor-selection.draft.json` | `377cca4ed831e69d97aad7344bcb9051f41435c6879cd4acca131f1e7699354b` | 19 | 39 | 8 | 4 |

## ⭐ Why a CEE test suite vendors a UI artefact

**Because these are CEE's own output.** The UI's generated manifest
(`src/canvas/starters/starters.manifest.json`, `_generated` by
`scripts/build-starter-fixtures.mjs`) records for every one of them:

```
"source": "POST https://cee-staging.onrender.com/assist/v1/draft-graph",
"ceeBuild": "cb54320",  "model": "claude-sonnet-4-6",
"promptVersion": "draft_graph_default@v195 (staging)",
"captureFile": "docs/evidence/starters/raw/<id>.capture.json",
"captureSha256": "..."
```

They are captures of this service's `draft-graph` responses, `schema_version: 3.0`.
So a test asserting CEE can read them back is not a test about the UI's taste in
payloads — it is a test that **CEE can parse its own egress**, which on
2026-09-08 it could not.

A hand-written fixture would have encoded this lane's model of the producer
rather than the producer, and would have missed the defect exactly as every
existing suite did: **163 of 163 edges** across these five carry
`"provenance": {"source": "cee_hypothesis"}` and nothing else, and not one CEE
test corpus contained that shape.
