BLOCKED: part (a) needs change-tools.ts:923 outside the explicit :404–480 lease. Part (b) is implemented and locally witnessed; this tree deliberately retains the part-(a) acceptance row RED. Do not treat the whole lane as complete or merge-ready.

- Progress: S1/S10 answer durability, real-route local rung: save → failed SDK continuation → answer row → same-turn replay, with no second save/call; two synthetic briefs.
- Next 2 (highest-value? Y): extend L2 to the :923 dispatch seam and complete the declared operand pair; then PL integration/review and the served VERIFIER loop.
- Mistake: initially the hold assertion covered only the approved card still on the latest row.
- Correction APPLIED: a separately minted, unrelated held proposal now arrives during the registration; the catch must retain both pending carriers byte for byte.

Changed files: src/routes/agent-v1-turn.ts (+19/−0); src/orchestrator-v5/path-b/tools/__tests__/goal-level-card.route.test.ts (+98/−2); this report and L2 evidence logs/approach note in recovery-notes/. No change-tools.ts source edit; no DGAI edit; no commit/push. No existing negative or equality weakened.

Part (a), first boundary: proposeChange refuses every multi-op goal-level request at :923 before calling proposeGoalLevel. Its mixed-change condition is outside the permitted hunk. The served K5 capture's sum is declared over current_weekly_orders and two additions; goalSumTodayPart currently recognises generated <goal>_today ids only. A correction cannot reach the leased functions without changing :923. Smallest unblock: explicitly extend the lease to that dispatch seam so the AI-declared pair can reach the goal-level preparation/applier, where the operand and goal can be committed together with one claim. Do not infer an operand from a coincident figure. No claim that the part-(a) pair/save/readback/auto-Run works; its row stops RED before its first card.

Part (b), user-visible replay words: “The reply didn’t arrive. Any changes already saved are kept. Send a new message to continue.” The first error response keeps its existing code and retry_safe. Only a claimed turn with a possible dispatched write appends an ordinary answer row. The conditional wording does not assert that a dispatched write succeeded. Failure to append is logged and leaves the original error intact. Reuse: appendCheckedGraphWrite, latest-held reconciliation, request hash, readAnswer and replayed. This retires the missing-answer outcome for this catch branch; no previous source lines are deleted.

Rows/results (all provider responses scripted; 0 live provider calls; one spec per process):

| Spec | Lane-base result | Final result |
| --- | --- | --- |
| goal-level-card.route.test.ts | 2 pass / 3 fail | 4 pass / 1 fail: declared-sum card, BLOCKED-LEASE |
| change-tools.goal-level.test.ts | Existing negatives retained | 23 pass / 0 fail |
| ai-core-provider-capacity.route.test.ts | Existing capacity/no-write contrasts retained | 3 pass / 0 fail |
| context-summary-diagnostic-only.guard.test.ts | — | 6 pass / 0 fail |
| run-delta-prior-facts-no-default.guard.test.ts | — | 10 pass / 0 fail |
| run-delta-pack-parity.guard.test.ts | — | 5 pass / 0 fail |
| run-delta-flip-thresholds-single-site.guard.test.ts | — | 5 pass / 0 fail |
| tier3-leak-guard.static.guard.test.ts | — | 3 pass / 0 fail |
| tier3-leak-guard.runtime.test.ts | — | 16 pass / 0 fail |

The two changed save-outcome rows are weekly orders corrected to 110 and monthly deliveries corrected to 105. The second includes unrelated revenue 2m, a date, and a deadline; exact quote, source, author and corrected figure remain bound to the delivery claim, recorded once. Replay checks current graph_hash and draft_graph raw value, replayed:true, no tool calls, no extra scripted model calls, no second registration and no additional turn rows. Existing non-sum correction rows still pass.

Mutant pair for changed claim (b):
1. Missing answer: remove the entire 19-line insertion; the route is asserted BYTE-EQUAL to f4022fb82680a428d87117a439044aa9e75adad2 before running the current spec. Both save-outcome rows fail at missing answer; the separate sum row remains RED (2 pass / 3 fail overall). KILLED.
2. Dropped holds: remove only heldProposals reconciliation. Both save-outcome rows fail on exact pending_actions equality (2 fail / 3 filtered). KILLED.
Both mutants restored. Part (a) has no source change and no claimed mutant/green result.

ESLint: exit 0 on both changed TS files, no diagnostics. New cycles: head 9, base 9, NEW/GROWN 0 (required new-cycles.py against f4022fb82680a428d87117a439044aa9e75adad2). Typecheck not run: required process-list probe was unavailable in the sandbox. PL owns the build gate.

pr-shape.sh: used its exact counting logic against the local src/tests diff, replacing only the gh transport because no PR/network is available. Source +19/−0, net +19, 1 file; tests +98/−2, 1 file; fixtures +0/−0; new refusal codes 0, regexes 0, exports 0, if-branches 1. Growth reason: bridge the existing durable answer row to the failed continuation; SDK state alone does not record this application's turn answer. No new store/parser/provider retry. Space freed: 0 bytes; no shared files deleted.

HIGH trace:
Value/source: synthetic user says “about 110 a week” / “about 105 a month”; unrelated figures stay outside that exact quote.
Approved: the issued correction card's id/revision/digest/graph hash, fields [].
Persisted: one registration; goal raw 110/105; exact claim credited once; failure answer and latest pending carriers appended.
This Run: no new scientific Run is claimed by these rows; the provider failed before the ordinary post-loop auto-Run. The independent served loop remains open.
User saw: initial failure unchanged; same-turn replay carries the honest saved-change wording and current graph. No engine-derived chance or recommendation is invented.

NUMBER: figures are the user's literal corrected values, not unrelated revenue/date/deadline digits.
AUTHOR: exact quote and source persist once as said_by:user; other card remains its own Olumi proposal.
CLAIM: replay says any changes already saved are kept; it does not convert a dispatched write into confirmed success.
Product test: preserves the user's authored correction and held reasoning contributions through a failed reply, letting the person continue without repeating a save.

Buddy self-check (not an independent reviewer PASS): correct within the part-(b) scope; part-(a) is blocked. Simpler: reuse the answer row and existing floor, no parallel persistence path.
OpenAI out of the box: runner/Conversation unchanged; app-specific answer durability is the named bridge. No host meaning parsing added; AI-declared source/stance and literal checks unchanged.
Efficiency: one answer append only after a failed continuation with possible writes; 0 new provider calls, and replay performs no model or save call.

Exact proposed commit message (PL commits; whole lane still BLOCKED):
fix(agent): record turn outcomes after failed save continuations

Plan: L2 · Simplest approach? Y — reuse the answer row and held-card floor; extend the dispatch lease for the blocked sum pair · Net src lines: +19
