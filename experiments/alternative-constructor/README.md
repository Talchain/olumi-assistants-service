# Alternative constructor experiment

The primary pair is **pragmatic vs source_first**. Freeze A's long-label repair and MG #2300 in the common base before live comparison. `control` exists for historical context and may alias pragmatic; it is not an independent arm unless verified and recorded with `ALT_CONTROL_INDEPENDENT=1`. No hybrid arm is defined.

`four-cases.json` freezes literal source bytes, their SHA-256 digests and independent semantic expectations before outputs. Paul's MRR brief is deliberately distinct from Baseline A. £49 × 1,500 = £73,500 does not equal the supplied £75k; preserve both and ask about scope. Do not award an unqualified exact identity a fidelity pass.

The provider-free scorer checks entity + role + raw value + currency/unit/period + strict operator, source-item binding, option ownership, referential integrity and target-bound identities. It reports omissions, invention and semantic errors first. The user-quality question is recorded after every draft; a lead/human must supply its score and attribution, otherwise the score remains null. There is no synthetic quality score and no automatic winner from schema/size.

## Offline checks

```sh
node experiments/alternative-constructor/offline-checks.mjs
ALT_CONSTRUCTOR_OFFLINE_BOOT=1 node_modules/.bin/vitest run --config experiments/alternative-constructor/vitest.config.ts
node experiments/alternative-constructor/score.mjs <records.jsonl>
node_modules/.bin/vitest run --config experiments/alternative-constructor/vitest.config.ts
```

The offline-boot command mounts the real route and refuses every network request, recording an expected 502 with zero provider calls. The last command skips live calls unless explicitly enabled. Existing dependencies are required; no install is performed.

## Lead-operated first comparison

These commands are launch instructions, not authorization. The lead owns the provider queue and decides when to start. Set `OPENAI_API_KEY` in the environment or point `ALT_CONSTRUCTOR_ENV_FILE` at the existing credentials file. Secrets are never printed.

```sh
ALT_CONSTRUCTOR_LIVE=1 node experiments/alternative-constructor/run.mjs pragmatic
ALT_CONSTRUCTOR_LIVE=1 node experiments/alternative-constructor/run.mjs source_first
```

Default is the four frozen cases, one repeat, sequentially. A third positional argument filters IDs, for example `paul-mrr`; `ALT_CONSTRUCTOR_REPS` controls explicitly requested repeats. Do not launch a broad matrix until the first four have signal. No model screen until one architecture leads; then hold architecture, input and semantic instruction policy fixed and change only the authorized model knob.

Outputs default to `.artifacts/alternative-constructor/<arm>.jsonl` and `<arm>.jsonl.scores.jsonl`. Every record includes sent model/effort/output ceiling, prompt/schema hashes, source hash, raw provider output, call duration/tokens, actual registration payload, reply and independent score. Override output with `ALT_CONSTRUCTOR_OUT` if needed.

All arms share `.artifacts/alternative-constructor/provider-ledger.jsonl` and its exclusive `.lock` directory. **At most 60 total provider attempts, including errors and retries, across all agents.** `ALT_CONSTRUCTOR_LEDGER` may point to the lead's shared ledger; never create a fresh ledger to reset budget. The optional attempt limit may lower, never raise, 60. Reservations are durable before network transmission. A crash may leave the lock; inspect its owner before manual removal. The wrapper does not retry a failed request itself.

## Evidence boundary

This runner adapts MG's real Agent route/admission runner. Registration and session storage are intentionally in memory, and automatic analysis returns an explicit unavailable response. It scores **the payload actually sent to registration**, not any unregistered draft. Evidence is labelled `admitted_registration_payload_only`; it cannot prove persistent canonical state, analysis, recovery, edit/rerun or browser reload. Use the existing Shared Data experimental API/UI for the leading arm's joined journey and capture its actual canonical readback. The scorer accepts `canonical_graph` only when supplied by such a witness, with explicit `shared_spine_journey` evidence level and verified analysis/recovery fields.

Source binding checks exact quotes against original bytes and the expected source item; matching text is separate from correct semantic role. Unbound graph facts are reported rather than credited based on the candidate's narrative. Schema-specific metadata absent from the existing graph remains a visible source-binding limitation. Historical MG numeric rows can still be run unchanged, but their broad number-membership and any-node identity results are not substitutes for these checks.
