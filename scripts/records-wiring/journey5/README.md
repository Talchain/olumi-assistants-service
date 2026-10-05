Journey 5 is prepared only. No signed-in script or served-wire checker was run by this lease.

The harness copies live only in `/private/tmp/mc-wire-out/journey5/`, outside the tracked prompt corpus. The J4 `a1.mjs` and `s3.mjs` are copied byte-for-byte. Only `lib.mjs`'s `J` moved to `/private/tmp/mc-wire-out/journey5`. The Playwright import and account-file lookup remain J4's own. `wire/` exists, so capture cannot silently fail for a missing directory.

Paul runs the signed-in steps after deployment and the design's live=head preflight, with the call budget authorised. Run the scripts separately; check the draft before spending the Run calls.

1. From a clean CEE checkout of the exact deployed merge SHA, compute the expected prompt and schema identities offline:

   ```sh
   node --import tsx scripts/records-wiring/write-deployed-identity.ts /private/tmp/mc-wire-out/journey5/deployed-identity.json
   ```

   The manifest binds the full SHA, `draftRecordsInstructionHash()`, and sha256 of `JSON.stringify(buildStrictDraftRecordsSchema())`. Recompute after merging grammar v-next; do not reuse this lease's hashes across a grammar change.

2. Run the draft witness:

   ```sh
   node /private/tmp/mc-wire-out/journey5/a1.mjs
   ```

3. Select the captured draft `wire/NN-FETCH_proxy_v5_turn_stream-200.json` and check it offline:

   ```sh
   node /private/tmp/mc-wire-out/journey5/check-draft-wire.mjs /private/tmp/mc-wire-out/journey5/wire/NN-FETCH_proxy_v5_turn_stream-200.json /private/tmp/mc-wire-out/journey5/deployed-identity.json
   ```

   The checker accepts SSE COMPLETE frames or buffered JSON. It requires one construction row, matching full records prompt/schema hashes, the retained `agent.construct` alias, OpenAI, zero Anthropic rows, matching deployed `cee_build` on every provider row, the agent-lane exit, and a successful mutated `build_model_from_brief` first tool.

4. Score the saved graph with the design's existing sealed scorer. Report read-time `REJECTED(no_executable_quantity_carrier)` separately from compiler dispositions. Then run:

   ```sh
   node /private/tmp/mc-wire-out/journey5/s3.mjs
   ```

5. Complete the design's after-Run and reload checks: expected option figures £126,000 / £127,350 / £120,000, overlapping ranges, untested nine-month horizon, and identical graph identity/nodes/edges on reload. These are manual served gates, not claims made by this local lease.

Source J4: `/Users/paulslee/Documents/GitHub/output/dl-9d9666-restart-20261004/journey4/`.

Copy identities (SHA-256):

- `a1.mjs`: `6cbe1838fad21ac6234b63e8265432305235fd705c893800874088e56a323103`
- `s3.mjs`: `a3a964d86e48fc96f869edb24703021f0260aebee02b08d8aef635d27ca3313c`
- `lib.mjs`: only line 3 differs from J4, binding `J` to the Journey 5 directory.
