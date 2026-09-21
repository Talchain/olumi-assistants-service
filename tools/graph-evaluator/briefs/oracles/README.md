# Sidecar oracles

Front matter ONLY — no brief body. `readBriefs()` (src/io.ts) overlays
`briefs/oracles/<id>.md` onto `briefs/<id>.md`'s own front matter and stamps
`meta.oracle_source: "sidecar"`.

**Why these three live here rather than inline.**
`governed/draft-graph-v5/manifest.json` sha256-PINS the bytes of all fourteen
numbered briefs and `src/governed-draft-graph.ts:622` raises `CORPUS_DRIFT` on any
mismatch. All three currently MATCH their pin. Writing the WP1 oracle into their
front matter would break a governance artefact — and the graph-evaluator CI
ratchet could not see it, by its own documented blind spot (all thirteen governed
problems live in one failing assertion, so a fourteenth changes no signal the
ratchet reads).

Unpinned briefs (`pricing-staging`, `hiring-staging`) carry their oracle inline.
