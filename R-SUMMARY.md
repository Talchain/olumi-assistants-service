# HARNESS item 1 — review handover

Status: SOURCE ONLY. DESIGN.md was written before implementation (50 lines).
No vitest, typecheck, commits, database changes, deployment or external messages.
`git diff --check` passes. Runtime results and base REDs are not claimed.

## Decision

The existing producer identifies the frameless goal through `first_ask` but
had no durable Agent answer carrier. Its exact question now accompanies that
identity. If the question survives final egress, the Agent answer row stores an
`elicit_goal_current_level` action in the existing pending-actions JSONB.

The most recent row's live ask, bound to scenario, subject, goal label and
native unit, deterministically forces the existing `propose_goal_current_level`
tool on a qualifying typed answer. This uses the existing first-call mechanism;
model interpretation, quantity/unit refusal, card preparation and approval
remain in the existing door. Host code never chooses between 4, 8 and 16,
computes size weights, writes a baseline or approves a change.

A clarification retains exact user figure spans and the original user quote,
only when the sent reply repeats a supplied figure and asks for its reading.
That quote reaches the door even after a process restart, when the live typed-
words cache is empty. Confirmation never substitutes Olumi's restatement for
what the user wrote. Clarifications spend the original turn allowance and
preserve wall-clock expiry; an approval card consumes the ask.

Explicit chips, Run, approval, research, methods, preview and withheld-tool
paths retain precedence. Unknown/expired/corrupt/mismatched asks and unsuitable
answers fall through. Shared action classifiers recognise the new kind but the
ordinary bare-number/short-confirm resumer does not claim it.

## Files

- DESIGN.md — producer, storage, routing and planned rows.
- src/orchestrator-v5/agent-lane/goal-certainty.ts — exact producer question on
  the existing typed goal-level ask, keeping compacted question/message parity.
- src/orchestrator-v5/agent-lane/current-level-answer.ts — ask binding, answer
  gate, delivered-question persistence and bounded clarification carry.
- src/routes/agent-v1-turn.ts — first-call forcing and final answer persistence;
  original user quote binding for a qualified confirmation after restart.
- src/orchestrator-v5/session/pending-action.ts — type, bounded JSONB parser
  and recorded-ask/bare-number classifications.
- src/orchestrator-v5/routing/clarification-resume.ts — exhaustive safety map.
- src/orchestrator-v5/agent-lane/__tests__/current-level-answer.route.test.ts —
  new producer/parser/carry controls plus actual route and existing door rows.
- src/orchestrator-v5/agent-lane/__tests__/placeholder-first-ask.test.ts — pins
  the added question, including long-label message parity.
- src/orchestrator-v5/routing/__tests__/clarification-resume.test.ts — existing
  exhaustive safety expectation extended for the new kind.

## Expected RED at base; DL to execute

- Sizes: “We can fit 4 large, 8 medium, 16 small, roughly” after the delivered
  current-level ask: the first model request must name the level tool. Base
  supplies no forced tool; the fixture model returns chat without calling it.
- “The latter.” after the two-way clarification, and “Yes, how do they affect
  this decision?” after the confirmed reading: the same forced call must reach
  the real door and offer the level-16 card with the +10% target unchanged.
  Base has neither the typed carrier nor its confirmation routing.
- Producer-to-answer-row persistence and clarification JSONB round-trip: base
  has no current-level pending action. The retained user quote row also checks
  the door's figure binding with a fresh Agent session.
- Control: “We fit 16 small-update equivalents per sprint.” without an ask still
  reaches the ordinary model-selected door and is not forced.
- Must-not controls: another quantity (£200,000 budget), question back, “I don't
  know; not sure”, and 16% against productivity's non-percent metric fall through.
- Additional controls: a capacity sentence in another factor's unit; missing
  goal/ask, expiry, another subject/scenario, competing route, confirmation with
  no user figure, invented restatement and unrelated closing question.

## DL rulings / limits

- The ambiguous sizes turn is forced to the level door rather than having host
  code select 16. The route fixtures supply the model's 16/sprint interpretation
  to exercise the existing real door. They prove routing/card mechanics, not
  live model interpretation quality. DL must run the founder served replay.
- The latter/yes rows each start at their qualifying prior clarification. If
  the first sizes turn already prepares a card, later yes belongs to approval;
  it must not prepare another level proposal. The earlier-card journey is a DL
  acceptance ruling, not a reason to override approval priority.
- Confirmation grammar is conservative: alternate assistant clarifications
  that do not bind a repeated user figure to the closing question fall through.
  The full served clarification wording is not in ACCEPTANCE-EVIDENCE.md; DL
  should compare it with the retained wire before broadening those shapes.
- Legacy answer rows have no typed ask/question and deliberately fall through.
  A fresh delivered ask is needed for the new deterministic path.
- If three higher-priority live holds occupy the row, the ask cannot fit and is
  logged; the new ask can displace only a Run offer. DL rules any saturated case.

Suggested DL checks: new route suite, placeholder-first-ask and clarification-
resume suites, change-goal-adopts-level-unit, link-sentence-first-call.route,
then the existing Agent route scanner guards and source typecheck.
