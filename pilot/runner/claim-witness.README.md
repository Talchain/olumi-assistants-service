# S1e attributed-claim witness kit

Founder accepts the DL 13:54 kit-only lease. Product files, the stock run-pilot.mjs, existing frozen cases and their runners are unchanged.
The four inputs in claim-witness.config.json were written fresh for this kit: own assertion, named team report, unresolved source, and a scoped correction with a separate conditional view retained.
The configuration follows CLAIM-RECORD-SPEC.md and the AIE 14:00 amendments: no inferred legacy approval, no erased dissent, no automatic unknown-to-Olumi authorship, and no range-to-mean or approval-to-science licence.

## Readiness and execution

Preparation is offline. These commands open no old case corpus, use no credentials and send no requests:

    node pilot/runner/claim-witness.mjs --selfcheck
    node pilot/runner/claim-witness.mjs --offline --out pilot/runner/claim-witness-offline

The offline output is a plan and local-control evidence. It is neither a staging dry run nor a product PASS.
Existing run-pilot.mjs owns the turn, approval, Run, graph-read, authentication and stamp helpers. The small configuration driver adds only the conditional witness sequence and calls the existing version-list/restore endpoints for committed Undo.

The existing DL/operator owns the served GO, tuple protection, test identity and provider allowance. No old proof budget is inherited.
The executable requires an explicit allowance and a per-turn reserve that the DL/operator has verified against the actual server's physical-attempt ceiling, including nested calls and retries:

    node pilot/runner/claim-witness.mjs --execute \
      --token-file OPERATOR_SUPPLIED_TEST_IDENTITY_FILE \
      --max-calls VERIFIED_REMAINING_ALLOWANCE \
      --reserve-calls VERIFIED_ONE_TURN_MAXIMUM \
      --out OPERATOR_CHOSEN_NEW_CAPTURE_DIRECTORY

The client counts returned provider entries and reserves room before each turn. It cannot independently enforce a physical-attempt ceiling inside one server request.
If that reserve, the allowance or the completeness of provider accounting is unverified, do not launch. Missing accounting, transport/stream failure, 429, exhausted reserve or tuple movement stops further turns. No automatic retry is made.
No token or Render key is printed. The existing stamp helper reads its existing Render credential only during a served run; offline mode never calls it.

No served run or operator/judge slot has been booked by this kit.
The v6.0 baseline deadline of 18:30 UTC and S3 window starting 18:45 UTC remain DL planning times, not observed start/finish times.
Actual served duration is UNMEASURED until RUN.json contains start/end timestamps and elapsed_ms.
The configured upper bound is 29 outer turn requests plus one committed restore request and one version-list request. This is not a count or allowance of physical provider calls.
The request timeout is five minutes, so the request ceiling alone does not establish that the entire set fits a 45-minute capture window.

## What is captured

Each case retains start/end UI, CEE, PLoT and ISL stamps; each step carries its bracketed case tuple and full response/read.
All current records and their complete statements, source, quote, reading, conditions, status, approval and history are copied without interpretation. Missing legacy fields remain missing.
The local_record_index is an address within that captured read, never a fabricated durable claim id. Original product identities and fields remain in the full record.
The wire request, issued card/revision/digest, actual operator press, returned tool result, complete saved read, Run identities, revision/hash bindings, coaching and raw comparison fields are retained.
Scripted operator presses are real test operations, not evidence of a human's semantic acceptance or a release waiver. Judges must still check whether the displayed card matches the request.
A card is pressed only when one current card is attributable by proposal id to an actually captured successful claim proposer. A correction accepts only a card issued at or after that correction request. Ambiguous, stale, unsupported or missing cards produce NOT-REACHED.
At most two cards are pressed per stage: the claim and, if actually offered, its separate law/working-point interpretation. Other proposed changes are not automatically accepted.

The first three cases cover source attribution, save/readback and a fresh server-session read. CW4 additionally records the actual preceding Run, the English-only correction, retained French-file claim, automatic analysis evidence, committed restore and cold read.
The version restored is selected only from a real product version list by an exact match to the full identity read before the correction. No version id or approval receipt is invented.
Restore uses the existing POST /bff/cee/scenarios/:id/versions/restore API, its actual version id, a fresh mutation id and the current expected full identity.
The response receipt, restored full identity and complete claim records are checked separately. One HTTP request is not a claim about the number of physical database writes; revision movement never proves duplicates.

## Boundaries for independent judging

All served cases remain UNJUDGED. Local controls cannot create a served verdict.
An actual run_analysis result after a card press is recorded as automatic wire evidence, with the preceding/current Run and saved-read identities; this is not by itself a same-revision/claim-use/coaching/comparison PASS.
A manually sent Run is labelled manual_run_control. It can provide a comparison baseline or restored-state calculation, but never substitutes for automatic analysis.
The committed restore is a real server operation, not a UI Undo click. The no-browser driver does not execute or witness UI-owned automatic post-Undo continuation. Unless the server itself returns it, that automatic rung stays NOT-REACHED; the optional scripted Run stays a control.
Cold reopen means a fresh requested agent_session_id which the reply actually adopts, followed by an unchanged server graph read. Browser-cache persistence and UI-save preservation remain outside this witness.
Missing model/card/receipt/version/analysis/comparison/coaching stages remain absent or NOT-REACHED. They are not converted into refusals, generic PASSes or claims of a complete user journey.
Judges must check the actual same-revision source-labelled analysis, exact immediate-prior Run comparison, selective supersession/history, restored current claim, retained dissent and useful source-aware coaching from the raw records.
They must also check that party/unknown/Olumi figures are never called the user's own, and that a range or a modal centre alone never supplies an expected mean, spread, distribution or goal chance.

The stock runner's --dry mode is not used for offline preparation because it still stamps live services and accesses the stamp credential.
Do not run the stock selftest for this task: it opens existing case/capture corpora. The kit's selfcheck uses only freshly synthetic local controls.
