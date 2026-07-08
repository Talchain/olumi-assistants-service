# orchestrator-eval

The durable regression gate for the CEE orchestrator prompt. Both prompt
workstreams' #1 recommendation was: **no orchestrator prompt should ship to
staging without an A/B run.** This is the foundation slice of that gate — a
small, honest chassis that catches a real, previously-shipped defect, plus the
seams a fuller eval plugs into.

## What it does (foundation)

For each fixture it:

1. **Runs the fixture's raw analysis through the REAL production assembly**
   (`src/orchestrator-v5/format/format-analysis-for-context.ts`). This is the
   exact stage the goal-fit fix lives in — it keeps `win_probability` and
   `target_fit` as two distinct percent vocabularies. The eval uses the runtime
   formatter itself, not a re-specified copy, so it cannot drift from what the
   prompt is actually grounded on.
2. **Scores each candidate response deterministically** on three dimensions:
   - `no_forbidden_terms` — the runtime's `findForbiddenMatches` (forbidden
     user-facing phrases + raw-id / graph-hash / dev-phrase leaks).
   - `no_mutation_language` — the runtime's `containsMutationLanguage` (prose
     that reads as an unbacked graph mutation).
   - `no_goal_fit_conflation` — this pack's worked assertion: the leading
     option's **win %** must not be narrated as the chance of **meeting the
     target**, grounded in the actual numbers the assembly produced.
3. **Checks each verdict against the fixture's `expected` map** and exits
   non-zero on any disagreement.

Dimensions 1–2 are **imported wholesale from the runtime** (`src/guards.ts`) —
the whole point is that the gate scores with the same code the runtime uses to
strip bad output, so a prompt cannot pass the eval and then fail in production.
A re-specified copy would drift; the older `tools/graph-evaluator`
orchestrator-scorer (which carries its own `BANNED_TERMS` array) shows exactly
that failure mode.

## The worked defect: win% ≠ target-fit

`fixtures/goal-fit-conflation.json` reproduces staging scenario **90385279** (a
bug fixed twice): the leading option **wins 89%** of the time but has only a
**29%** modelled probability of meeting the target. House doctrine: producers
own meaning, the UI renders only — `win_probability` ("beats the alternatives")
is not `target_fit` ("meets your target").

The fixture ships four recorded candidate responses:

| candidate | expected | why |
|---|---|---|
| `good` | PASS | 89% is the win probability; 29% is the target-fit — kept apart. |
| `good_terse` | PASS | compound sentence, each number bound to its own claim. |
| `regression` | FAIL | "89% chance of reaching your target" — the exact defect. |
| `regression_subtle` | FAIL | "89% likely to meet your target" — same conflation, no "chance". |

If a future edit regresses the production formatter (drops `target_fit` or the
`TARGET_FIT_DEFINITION` disclosure), the assembly-fidelity test fails; if a
candidate prompt starts conflating the two numbers, the gate fails it.

## Run it

```bash
pnpm eval:orchestrator        # run the chassis over every fixture (offline, deterministic)
pnpm eval:orchestrator:test   # run the vitest suite (assembly fidelity + gate + guard wiring)
```

Both are **offline** — no paid LLM call in the default path.

## Add a fixture

1. Create `fixtures/<name>.json`:
   - `id`, `description`, `user_message`.
   - `analysis` — a raw `ContextPackAnalysis` (see the type in
     `src/orchestrator-v5/context/context-pack-assembler.ts`). The chassis runs
     it through the production formatter.
   - `candidates[]` — each `{ label, note, source: "recorded", text }`.
   - `expected` — `{ "<label>": true | false }` (true = should pass the gate).
2. `pnpm eval:orchestrator:test`.

No code change is needed for a new fixture that reuses the existing dimensions.
A fixture that needs a new scenario-specific assertion adds it under `src/` and
wires it into `scorer.ts`.

## Where a live model / paid judge plugs in

The default path is deterministic and offline. Two seams (typed and documented
in `src/judge-seam.ts`) let a fuller eval go live **without changing the gate**:

- **Live candidate** — instead of reading `candidates[*].text`, produce the
  response from a real model at run time. Reuse
  `tools/graph-evaluator/src/providers/*` (openai/anthropic) and its
  `adapters/orchestrator.ts` request shaping. The produced text is scored by the
  same deterministic scorer.
- **Paid judge** — layer an LLM judge (reuse
  `tools/graph-evaluator/src/orchestrator-judge.ts`) on top for subjective
  quality signal. Off by default; the deterministic verdict always stands alone.

## Layout

```
tools/orchestrator-eval/
├── cli.ts                       # chassis entry (pnpm eval:orchestrator)
├── fixtures/
│   └── goal-fit-conflation.json # the worked defect
├── src/
│   ├── types.ts                 # fixture + result types
│   ├── assemble.ts              # REAL assembly via production formatAnalysisForContext
│   ├── guards.ts                # re-exports of PRODUCTION guards (never re-specified)
│   ├── goal-fit-conflation.ts   # the worked win%-vs-target-fit assertion
│   ├── scorer.ts                # deterministic scorer wrapper (3 dimensions)
│   ├── run.ts                   # the chassis: load → assemble → score → agree
│   └── judge-seam.ts            # live-model / paid-judge seams (documented)
└── __tests__/
    └── orchestrator-eval.test.ts
```

## Deliberately deferred (co-owned with the prompt workstream / "Brief I")

- **Full fixture set + R-sets** — the real corpus of orchestrator turns
  (framing, draft, explain, edit, post-analysis) and their regression sets.
- **Full prompt compose** — the foundation exercises the analysis-projection
  stage; wiring the whole context-pack → system-prompt compose is the next step.
- **Paid LLM judge** — the deterministic scorer is the floor; the judge is
  additive.
- **CI gate wiring** — this is NOT yet a blocking CI gate. Once the fixture set
  is real, wire it so no orchestrator prompt reaches staging without a green
  `pnpm eval:orchestrator`.
