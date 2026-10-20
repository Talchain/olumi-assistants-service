BLOCKED: the captured registration ACK/own receipt and immediate verification read are absent; the available live shape verifies on the unchanged lane base. No source fix or RED→GREEN is established.

Lane: L26, S4 model generation / S10 shared data layer, LOCAL real-registration-route replay only. Base: 214763469310470b12c25102a9e327521d14913f. No commit, push, network or live provider calls.

Files added:
- src/orchestrator-v5/path-b/tools/__tests__/draft-save-truth.route.test.ts (89 lines)
- src/orchestrator-v5/path-b/tools/__tests__/fixtures/l26-live-save-8d44ed05.json (1170 lines, recorded draft + first saved read, no invented receipt)
- recovery-notes/L26-* (approach, logs, mutant runner, report) and recovery-notes/diagnose.mts.
No production source changed; no lease extension. No disk cleanup; 0 bytes freed.

What the replay establishes
The supplied marketing turn records a 200 register dispatch followed by a 200 graph dispatch and tool refusal not_verified. Its _agent.receipts is empty. It does NOT record the register response JSON, its model_version receipt, or the graph response used inside the verifier. The first external saved read is later.
The recorded drafter answer, converted at the saved user_statements timestamp 2026-10-20T09:19:39.958Z, passes approvedGraphHeld against that first saved read. Feeding it through the REAL graph/register route, with a stateful store double returning a receipt from the route's real version plan, produces exactly that saved graph (11 nodes / 18 edges), and B's UNCHANGED verifier returns VERIFIED_SAVED.
The recorded identity a629796ee47185abe6159244b35820ecb792e1b9af751f11fd02ce5e8960f801 recomputes exactly. The analysis digest is e5542490277b7c3d3c8f63d1a16ea9699a6939f8bb905f1e200794be859f71e4, with the recorded CAS prefix e5542490277b7c3d. The route-generated ACK/receipt agree with those bytes.
Therefore no failing check on a genuine own-receipt save has been identified. A missing receipt and a mismatched immediate read remain possible, unproven causes. Do not ship this as an RC2 fix.
Smallest unblock: provide the internal graph/register response JSON and immediately following graph response JSON for ONE failed build_model_from_brief dispatch, or equivalent server logs identifying which conjunction term failed. Do not rerun a provider merely to generate another draft.

Rows / real results (one spec per process; all offline)
- draft-save-truth.route.test.ts: 3 PASS / 0 FAIL on the UNCHANGED base; restored rerun 3 PASS. Real registration + captured postimage -> VERIFIED_SAVED; missing receipt -> UNKNOWN; unrelated changed postimage -> UNKNOWN. Each row appends exactly once, reads twice. Receipt is a double derived from the real version plan, NOT a recorded live receipt.
- draft-tool.test.ts: 26 PASS / 0 FAIL.
- draft-empty-scenario.route.test.ts: 43 PASS / 0 FAIL. Existing receipt/ACK/postimage/read-unavailable negatives, VERIFIED_NO_WRITE before dispatch, retry/no duplicate write or Run remain unchanged. Existing two-brief route rows pass; no two-brief source repair is claimed.
- No RED→GREEN: the new positive already passes on base. L26 is BLOCKED, not DONE.

Mutant pair (restored source equals base)
- Force the receipt verifier to return UNKNOWN: KILLED, 1 failed / 2 passed (saved positive fails).
- Replace the conjunction with only isSavedRead(after): KILLED, 2 failed / 1 passed (missing receipt and changed postimage falsely pass).
- Restore original source: 3/3 PASS. No mutant source is left in the tree.

Checks
- eslint new TypeScript spec: PASS, exit 0.
- Required command executed: NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc --noEmit -p tsconfig.json. Exit 2; 208 error diagnostics elsewhere (including absent generated OpenAPI declarations), ZERO in the added TypeScript spec or draft-tool.ts. No whole-tree-green or CI Typecheck Drift claim.
- Forbidden boundary gate PASS: warnOnInvalid 0, double casts 43, science fallbacks 6; all equal baseline, no growth.
- new-cycles.py against lane HEAD: head 9 cycles / 100 files; base 9; NEW/GROWN 0.
- pr-shape.sh's unchanged awk formatter applied to the LOCAL uncommitted test/fixture diff (no PR/gh/network; notes excluded): source +0/-0/net 0; tests +1259/-0 in 2 files (the formatter categorises JSON under __tests__ as tests); 0 new codes, regexes, exports or source branches.
- A: no production diff; its code/outcomes are not changed by this test-only tree. No additional A-route spec was run.

User-visible/product test
No served behaviour changed. The desired change is an accurate acknowledgement of the person's saved provisional model while retaining UNKNOWN when own-write proof cannot complete. That supports understanding and authorship; graph existence alone cannot establish whose draft was saved.
HIGH trace: source = user's captured brief plus drafter-declared provisional model; approval = no later change approval manufactured; persisted = exact first saved graph in replay; Run = none added; seen = captured UNKNOWN versus replay VERIFIED_SAVED. First unobserved boundary = internal registration ACK/receipt to immediate verification read.
NUMBER: no figure changed or inferred. AUTHOR: captured statements and authorship are compared exactly. CLAIM: no live receipt, root cause, source repair or served success is asserted.
Buddy: correct to retain the existing safe-save proof; simpler approach is no speculative source change until the missing boundary bytes identify the failure.
OpenAI out-of-box: no SDK/Conversation/tracing replacement; receipt/CAS checks are the permitted host-owned safe-save mechanism.
Host meaning parsing: none added. Efficiency: 0 live provider calls and 0 new production reads/writes/branches.

Exact commit message, ONLY if DL elects to retain this blocked replay evidence:
test(path-b): replay captured persisted draft verification

- Progress: S4/S10 local registration replay proven; served cause unresolved.
- Next 2 (highest-value? Y): obtain failed internal ACK/read pair; replay its exact failing term before changing source.
- Mistake: initial diagnostic used diagnostic-row created_at rather than the actual saved statement timestamp.
- Correction APPLIED: replay uses 09:19:39.958Z and asserts exact stored graph equality; initial apparent mismatch is rejected as evidence.
Plan: L26 · Simplest approach? Preserve verifier until the missing ACK/read proves its failing term · Net src lines: 0
