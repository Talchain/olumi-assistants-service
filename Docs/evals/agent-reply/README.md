# Agent-reply acceptance fixture — prompt/harness half

This directory holds the **prompt/harness half** of the acceptance fixture shared with the
AI Conversation lane, and the deterministic baseline it was cut from.

| File | What it is |
|---|---|
| `fixtures/cases.json` | 14 captured Agent-lane responses (one or two per case class), ids removed, each with an `expect` block for the prompt/harness side |
| `BASELINE-8428207.md` | The scorer run over the captured replies: current build `8428207` and older builds, separately |

The scorer, CLI, fixture builder and FP3 replay live in `tools/agent-reply-eval/`.

**The rendering half is not here.** The AI Conversation lane adds an `expect_render` block to
the same cases (what the UI must show for that payload). Nothing in this half asserts
anything about rendering.

## A case

```jsonc
{
  "id": "run-leader-withheld-near-tie",
  "class": "run_leader_withheld",              // see tools/agent-reply-eval/src/classify.ts
  "source": { "capture": "c19-8428207", "build": "8428207", "scenario": "A", "turn": "A2r run (typed Run)" },
  "context": {                                   // derived from the surrounding captured turns
    "user_action": "run", "domain": "hiring",
    "rerun_kind": null,                          // after_edit | no_change, for a re-run
    "next_approval_ran": null                    // did the next captured approval run the analysis?
  },
  "payload": { "assistant_text": "…", "suggested_actions": [], "analysis_state": {}, "analysis_ready": {}, "blocks": [], "draft_graph": {}, "_agent": {}, "_diagnostic_trace": {}, "_provider_calls": [] },
  "expect": {
    "max_words_default": 90, "words_soft": true, // "up to about 90 words by default" — no minimum, no cap
    "max_questions": 1,
    "leader_may_be_named": false,                // Runtime PR-B's rule: leader_claim.permitted AND mode comparative_leader
    "leader_withheld_reason": "options_do_not_separate",
    "caveat_required": true, "caveat_reasons": ["robustness very_low", "near tie", "leader withheld: options_do_not_separate"],
    "chips_shown": [],                           // never ask the user to press a chip not in this list
    "forbidden_claims": ["names_or_hints_a_leading_option", "claims_a_save_or_version", "…"],
    "next_move": "only_when_supported",
    "notes": ["…"]
  },
  "served_reply_verdicts": { "LEADER_HONESTY": "FAIL", "…": "…" }   // what the SERVED reply did — a record, not an expectation
}
```

`payload` is the captured response cut to exactly what the scorer reads. The builder proves
that: it refuses to write a case whose stripped payload scores differently from the full
capture, and refuses any case containing a request, session, turn, scenario or proposal id,
a graph hash or a timestamp.

To score a candidate reply against a case, replace `payload.assistant_text` (and
`payload.suggested_actions` if the harness changes them) and call `scoreFixtureCase` from
`tools/agent-reply-eval/src/fixture.ts`.

## What the captures cannot establish

Grounding (needs the tool results the model saw), provenance accuracy for `user_override`
values (a user's entry and an adopted Olumi proposal look the same), the raw model text (the
server strips completion claims before the text exists), and what the UI rendered. Checks
that would need these return `NOT_DECIDABLE`; see the baseline for counts.

## Commands

```bash
# self-tests (discriminating pairs, real captured turns, fixture consistency, replay gate, stack extractor)
pnpm exec vitest run tools/agent-reply-eval
# typecheck the tool (neither repo typecheck gate covers tools/)
pnpm exec tsc -p tools/agent-reply-eval/tsconfig.json --noEmit
# baseline report (CAPTURES_DIR = a construction-witness raw/ directory; local evidence, not in this repo)
pnpm exec tsx tools/agent-reply-eval/cli.ts --captures-dir "$CAPTURES_DIR" --current-build 8428207 \
  --report Docs/evals/agent-reply/BASELINE-8428207.md
# rebuild this fixture
pnpm exec tsx tools/agent-reply-eval/build-fixtures.ts --captures-dir "$CAPTURES_DIR" \
  --cases-out Docs/evals/agent-reply/fixtures/cases.json \
  --test-out tools/agent-reply-eval/__tests__/fixtures/real-turns.json
```

## FP3 explicit-Run replay (prepared, not run)

`tools/agent-reply-eval/replay-fp3.ts` builds MATCHED Responses-API requests for two
instruction stacks over the FP3 captured cases (PR #1791,
`Docs/evals/interpreter/fp3-captured-cases-20260924.json`): model `gpt-5.6-terra`,
`tools: []`, `tool_choice: 'none'`, the captured `input` and `max_output_tokens` — the two
requests for a case differ only in `instructions`.

- **Default is a dry run**: requests and a manifest (with each stack's sha256) are written
  to `--out`; nothing is sent.
- **Sending needs both** `--execute` **and** `AIQ_REPLAY_BUDGET_APPROVED=yes`. `--execute`
  alone exits 2 before any key is read. There is no agreed budget at the time of writing.

Stacks are files. `tools/agent-reply-eval/extract-stack.ts` derives one from a route source
without importing it: it reads the route's own `instructions:` template for the interpreter
call and evaluates only string constants, and makes every config-dependent branch an
explicit `--assume-true/--assume-false` (staging runs the Agent lane in `full` mode, so
`config.proxy.agentLanePreview === true` is false). Checked against the FP3 captures: the
route at their source head `9af274b1f3f2f63cc74ed397b6b6dc46550a3d83` extracts to the
10,019-character `instructions` that all 7 captured requests carry, byte for byte; the
preview branch does not match.

```bash
pnpm exec tsx tools/agent-reply-eval/extract-stack.ts --route <route.ts> --out stack.txt \
  --assume-false 'config.proxy.agentLanePreview === true'
pnpm exec tsx tools/agent-reply-eval/replay-fp3.ts --cases fp3-captured-cases-20260924.json \
  --stack-a a.txt --stack-b b.txt --out <dir>            # dry run: 7 cases × 2 stacks = 14 requests
```
