1. S5/S10 first loss: change-tools.ts:923 refuses every multi-op goal-level correction before proposeGoalLevel (:404–480); the captured declared sum uses current_weekly_orders, not a generated *_today operand.
2. Smallest enabling change for (a): re-lease the :923 dispatch seam plus a declared operand carrier into the existing goal-level writer; no guessing an operand from matching numbers. BLOCKED-LEASE outside :404–480; retain a RED real-route class row.
3. S1/S10 loss (b): agent-v1-turn.ts catch keeps a claimed turn after a possible save but never records its answer; resend waits 151s then 409.
4. Smallest (b): append the ordinary answer row in that catch when !released && writesDispatched>0 && claimAppendSucceeded; keep original error response.
5. Reuse appendCheckedGraphWrite, heldProposals reconciliation, requestHash, readAnswer and replayed; the latest pending row remains authoritative.
6. Supersedes the missing-answer outcome for a failed continuation after a save; no new store, parser, export, provider call or retry mechanism. Existing pending holds carry proposals and approvals for the user and replay reader.
7. Reject rerunning the SDK/save or reporting every dispatched write as confirmed; the reply says any saved changes are kept, and replay reads current state.
8. Class proof: real route correction/approval/save/provider-failure → answer → immediate same-turn replay, holds retained; second brief; no-write refusal and unrelated-number/author negatives retained; two mutants for (b).
