BLOCKED

BLOCKED-LEASE: src/orchestrator-v5/agent-lane/core/sdk-turn.ts reconstructs trace rows at lines 184–187 and discards draft_verification. It is outside the named draft-tool lane scope; it has NOT been edited. Smallest unblock: DL applies recovery-notes/L26B-sdk-trace-hook.patch (type-only optional field plus forwarding that field to the existing tool_calls row), or explicitly extends this lane's lease. The patch is prepared but UNTESTED; no route GREEN or DONE is claimed.

Lane L26B, S4 model generation / S10 shared data layer. Rung: LOCAL adapter diagnostics proven; real-route diagnostic delivery RED. Base 214763469310470b12c25102a9e327521d14913f. No commit, push, network or live provider calls; no receipt reconstructed; no A source changed.

Files changed:
- src/orchestrator-v5/path-b/tools/draft-tool.ts: first failed check at the existing verifier exits; no changed decision, status, write, retry, observer or Run behaviour. Non-enumerable symbol metadata keeps deep outcome equality and SDK JSON unchanged.
- src/orchestrator-v5/path-b/tools/outcome.ts: minimal typed carrier within path-b/tools and traceRow projection; fixed check/field enums, 12-character hexadecimal hash prefixes or null, <=8 postimage top-level keys, controlled read failure codes. This companion carrier is necessary for the requested outcome trace; no new store, parser or alternate verifier.
- src/orchestrator-v5/path-b/tools/__tests__/draft-tool.test.ts: 16 diagnostic/byte rows added; original equalities and negatives kept.
- src/orchestrator-v5/path-b/tools/__tests__/draft-empty-scenario.route.test.ts: 31 real-route diagnostic rows added; original 43 rows kept. Only internal-route doubles are expanded for faults.
- recovery-notes/L26B-* evidence, approach, mutation runner and un-applied SDK hook. No other source files changed; no disk cleanup, 0 bytes freed.

Rows and results (one spec per process; 0 live provider calls):
- Lane-base real /agent/v1/turn: draft-empty-scenario.route.test.ts = 31 FAIL / 43 PASS. New rows fail because draft_verification is absent, not because the original negatives changed (L26B-red.log).
- Final real /agent/v1/turn: draft-empty-scenario.route.test.ts = 31 FAIL / 43 PASS. Both synthetic briefs exercise missing/invalid receipt, invalid receipt revision, ACK absent/status/conflict, ACK/receipt/recomputed identity hashes, graph revision, analysis hash, postimage keys and readback failure. Outcome JSON and reply byte assertions pass before the missing-field assertion. VERIFIED_SAVED and VERIFIED_NO_WRITE no-detail negatives pass. Additional first-failure row (missing receipt + unavailable readback) is RED at the same bridge. This is not RED-to-GREEN completion.
- Final draft-tool.test.ts = 42 PASS / 0 FAIL (26 existing + 16 added). Typed first-failure details, dispatch exception/status, correct prefixes, raw-secret exclusion, exact original outcome equality/JSON and effect counts pass. First failure remains in existing verifier order.
- Final outcome.test.ts = 11 PASS / 0 FAIL. Existing schema, unknown-write and trace-shape negatives unchanged.
- A: existing A instructions/schema byte-equality negatives pass in draft-tool.test.ts; no A code changed. No served A journey is claimed.

Mutants (all restored, restoration SHA-256 recorded in L26B-mutants.json):
- Diagnostic visibility/detail pair: drop trace metadata -> KILLED, 16 FAIL / 26 PASS; replace every diagnostic with wrong_check -> KILLED, 16 FAIL / 26 PASS. Every one of the 16 added adapter rows kills both mutations.
- Result isolation pair: serialize diagnostic into the tool result -> KILLED, 22 FAIL / 20 PASS; alter the original UNKNOWN detail bytes -> KILLED, 22 FAIL / 20 PASS.
- Restored source: draft-tool.test.ts 42/42 PASS. No mutant remains.

Checks:
- eslint on all four changed TypeScript files: PASS, exit 0 (only existing unresolved NPM_PACKAGES_TOKEN placeholder warnings).
- Required command `NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc --noEmit -p tsconfig.json`: exit 2, 208 diagnostics in OTHER files, ZERO in each of the four changed files. Final run used restored production source after the three new route-harness type errors were corrected. CI Typecheck Drift remains the required gate; it was not run remotely. The process-list preflight was unavailable in the sandbox (sysmond not found); only one tsc command was issued at a time.
- Boundary gate PASS: warnOnInvalid 0, double casts 43, science fallbacks 6; equal baseline, no growth.
- new-cycles.py against lane base: 9 cycles / 100 files on head; base 9; NEW/GROWN 0.
- tools-dl/pr-shape.sh's exact AWK formatter applied to LOCAL src diff, without gh/network: source +42/-14/net +28 in 2 files; tests +146/-4 in 2 files; fixtures 0; 0 new refusal codes, 1 regex, 3 added export lines (one is the modified existing ToolOutcome type), 13 added if lines replacing the existing ordered conjunction/exit lines. Growth reason: expose existing checks; no new save authority or policy. The prepared SDK hook is excluded because it is not applied.

User-visible/product test: words and behaviour stay unchanged, including honest UNKNOWN and retention of possible saved work. The intended observability enables the existing owner to establish which safe-save proof failed without claiming a false negative or altering human authorship. No RC2 repair or served capability is claimed.
HIGH trace: source = literal user brief and drafter-declared provisional model; approval = no new approval path; persisted = internal route doubles' own test receipt/readback only; THIS Run = none added; user saw = original exact reply bytes. First evidence boundary = registration ACK/receipt -> verifier readback; first delivery loss = core SDK trace projection.
NUMBER: only engine-produced hashes are shortened for diagnostics; no strategic figure changed.
AUTHOR: no words or figures reattributed; raw brief/postimage/error content is excluded from detail.
CLAIM: no live failure cause, saved outcome repair, receipt reconstruction or served success is asserted.
Buddy (self-check, DL independent review still pending): locally correct; real route blocked at a separate leased file. Simplest approach: forward one optional field through the existing recorder, not a new trace/store.
OpenAI out-of-box: SDK runner, Conversation, tools and tracing unchanged; these application receipt/CAS diagnostics are not supplied by the SDK.
Host meaning parsing: none added. Efficiency: 0 new provider calls/reads/writes/retries; only bounded diagnostic work after an already-failed verification.

Exact commit message (after DL resolves the hook and proves route GREEN):
feat(path-b): trace draft save verification failures

- Progress: S4/S10 adapter diagnostic contract proven locally; route projection remains RED.
- Next 2 (highest-value? Y): DL applies/leases the minimal SDK hook; rerun the same 31 route rows to GREEN.
- Mistake: first implementation assumed traceRow fields reached the wire wholesale; the real route exposed the explicit field projection.
- Correction APPLIED: identified the first dropped field, retained the RED rows, and prepared only the forwarding hook without editing the unleased file.
Plan: L26B · Simplest approach? Existing trace metadata plus one DL-owned forwarding hook · Net src lines: +28
