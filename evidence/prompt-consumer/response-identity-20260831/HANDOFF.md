# Response identity successor — bounded assurance, not serving clearance

This extends #1233/#1252, stacked on approved #1252 head
`3b53105730076df53953bcc450787b37e8e3ea22`.
The exact base is verified by Git; use the full PR head in the delivery comment
for candidate acceptance. #1228 remains parked and unpromoted.

## Capability and evidence

The existing quality operator now re-decodes individual response bodies, retains
instance-specific selections, refuses absent composition/consumer telemetry, and
propagates these limits into promotion evidence. It no longer accepts a generic
verifier's asserted `deployed-provider` scope as deployed response evidence.

`response-identity.test.ts` executes real metadata projection, V5 extraction and
diagnostic construction, plus the actual response-hash implementation. Existing
wire formats cannot produce complete provider-bound PASS. Historical saved-graph
metadata is labelled simulation, never relabelled as an original HTTP capture.

`response-fleet.test.ts` pairs A:X/B:Y with A:Y/B:Y; matching partial hashes remain
unknown, incompatible hashes fail, duplicates neither inflate sample counts nor
erase contradictory headers, and empty/missing-instance evidence stays unknown.
Even matching observed instances never establish universal fleet convergence.

`local-response-identity.test.ts` replays immutable provider bodies using the
real parser/projector and immediate graph consumer at
`3a79b4057b238a5a80d773310f8da076d2922f0a`. It checks the original recorder and
archive hash, not stored PASS fields. Same-brief incumbent/candidate wording
controls are structurally valid but the candidate emits an unsupported baseline;
the source-owned semantic oracle detects it. Real action identity remains intact.
Wrong prompt/model/provider and swapped consumption fail. Missing telemetry and
unaccounted completion/retry contributions remain UNVERIFIED.

Original immutable archive:
`evidence/prompt-consumer/lane-d-20260831/provider-and-serving.tar.gz`, SHA-256
`843b9dd5adf5a38fe87484f406eba591fdc3c1f42f1b3bd79636c0f552c54bd9`.
This is historical local-provider origin plus initial-consumer replay, NOT a new
model draw, observed deployed response, full adapter/canonical lineage or user
journey. No specific prompt block is isolated as the cause of the degradation.

## Independent window-scope correction

[Independent review](https://github.com/Talchain/olumi-assistants-service/pull/1271#issuecomment-5479798614)
at `1e2dd1435de7429078eefe26e46f0390107b6a5a` found one tools-only false FAIL:
fleet excluded a valid pre-cutoff predecessor, but serving/promotion reaggregated
it into current response levels. The review's five-case test reproduced 4/5
before the correction and 5/5 afterward. Its source/reports remain at
programme-docs `26fae0d0636cf959aaa20f09faa8495d94674606`, under
`codex-evidence/resume-20260831/1271-response-review/`.

The existing serving evaluator now reuses the validated fleet's
`windowResponses`, not deduplicated sample counts. Full decoded history remains
retained and receipt/mode/configuration/integrity checked. No caller filtering
is required or accepted. Inside-window and no-cutoff contradictions remain FAIL;
matching current selection remains PASS only at that narrow rung. Complete
response/provider and promotion evidence remain UNVERIFIED.

`response-window.test.ts` adopts the independent five cases and adds vertical
collection-binding, duplicate-association, fleet-authority, historical-integrity,
empty-window and observed-status controls. These are explicitly synthetic
captures through the actual metadata producer/decoder/fleet/serving/promotion,
not new HTTP/provider draws or deployed acceptance. Use the exact corrected head
and validation report in the PR delivery comment; independent re-review is still
required and the original CHANGES_REQUIRED verdict is not self-overturned.

## First unclosed link: assigned serving telemetry

Current-source inspection was pinned to
`87f3e43ece5306e28336bd068dc8007a40b209a5`, matching CEE health at 13:00Z on
2026-08-31. No current AI-draft HTTP capture with the required identities was
available from the release witness. Deterministic edit responses were rejected
as substitutes. No fresh provider calls were made.

At that source the adapter metadata retains selected prompt hash/version,
requested model and cache instance/age/status. It lacks returned model/message
identity and actual instruction/schema/attempt-contribution binding. V5 drops
instance/cache fields and hardcodes the provider. The existing response-hash and
request/turn correlation must remain the sole final response binding.

Minimum additive production boundary was sent to Primary BEFORE any production
edit: [ownership request](https://github.com/Talchain/olumi-programme-docs/issues/26#issuecomment-5478824315).
It spans actual provider request/result capture in `src/adapters/llm/anthropic.ts`
and `types.ts`; outer request correlation in
`src/cee/unified-pipeline/stages/parse.ts`; the safe metadata projection;
`src/orchestrator/tools/draft-graph.ts`; and existing V5 diagnostic construction.
Record each primary/retry/completion, accepted contribution, actual attached
schema (explicit absence on degradation), returned model, output hashes and
consumer invocation. Do not infer invocation from source hashes alone.

This cross-boundary production work remains UNASSIGNED in this successor.
Primary explicitly deferred it until post-Monday in
[ruling 5479713730](https://github.com/Talchain/olumi-programme-docs/issues/26#issuecomment-5479713730).
No `src`, prompt, schema, dependency, model-selection or deployment changes are
included. Primary must assign its exact target/head/integration order before it
is built; CC alone integrates, deploys, promotes or rolls back. Independent
review of #1252 does not certify this successor.

## Replay and resume

Use the existing README's `--responses --input` command for original captured
HTTP bodies; it is offline, refuses overwrite, and returns exit 2 for UNVERIFIED.
Do not synthesize missing capture fields from administrative snapshots.

Focused gate: `pnpm exec vitest run --config vitest.required.config.ts tools/prompt-consumer --maxWorkers=2`.
Required service build and lint remain unchanged. Exact-head hosted CI and any
inherited Security Audit status are recorded on the PR, not assumed from #1252.
No new draws are needed to replay the frozen semantic controls.

Next external step: independent review of this tools-only successor and Primary
assignment of the minimal telemetry boundary. Full per-response deployed identity
and fleet coverage remain UNVERIFIED; this handoff is not a Core release verdict.
