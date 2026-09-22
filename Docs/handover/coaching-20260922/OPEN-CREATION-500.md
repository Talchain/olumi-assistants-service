# ⛔ OPEN, UNINVESTIGATED — model creation returns HTTP 500 about half the time

**Found 21:10Z on served `9c16e8c`, signed-in, via `/proxy/v5/turn`
(`PROXY_V5_TARGET=orchestrator`, i.e. the CONVENTIONAL route users are on).**

```
run 1: HTTP 500  nodes=0   {"error":"INTERNAL_ERROR","boundary":"B1","direction":"egress",
                            "validator":"draft_graph_pipeline",
                            "details":{"retryable":false,
                                       "reason":"draft_graph_cee_graph_invalid","stage":"frame"…
run 2: HTTP 200  nodes=15
run 3: HTTP 500  nodes=0   (same body)
run 4: HTTP 200  nodes=14

healthy 2/4 · not-healthy 2/4
```

Reproduce: `witness/creation-500.mjs` (needs `WITNESS_OWNER` + `WITNESS_JWT`).

## Why this matters

A user sending their **first brief** — the opening step of the canonical journey —
gets a **500 roughly half the time**, and the error says **`retryable: false`**.

## ⛔ I mischaracterised this earlier, twice. Do not inherit the wrong story.

1. First I saw `nodes=0` inside a full witness run and reported it as a possible
   **regression in conventional creation**. Two standalone re-runs were healthy,
   so I called it **transient**.
2. Then I hardened the witness to report that arm as **NOT MEASURED** rather than
   FAIL, describing the cause as *"the arm depends on an LLM actually drafting a
   model, and that time it drafted none."*

**That explanation was wrong.** The failures are **HTTP 500s from the
`draft_graph_pipeline` egress validator**, not an LLM returning nothing. I never
printed the status code in the early probe, so I inferred a cause from a
symptom — the same root error as the rest of this session: **checking a proxy
for the thing instead of the thing.**

The NOT MEASURED hardening is still correct behaviour (an arm that built no graph
cannot be asked whether it was receipted) — but the **reason** recorded alongside
it was wrong, and this file is the correction.

## Status

**UNINVESTIGATED.** Found at the point of a deliberate session pause; not chased
further rather than half-chase it and hand over a guess.

Next step for whoever picks it up: `reason: draft_graph_cee_graph_invalid` at
`boundary: B1, direction: egress, validator: draft_graph_pipeline` — the drafted
graph is failing CEE's own egress validation about half the time. Start at that
validator and capture a failing graph, rather than assuming it is model variance.
