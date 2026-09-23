# Interpreter v0.2: bounded prompt module and ownership handoff

This increment packages the already-banked profile without changing it. It is off-path until the existing OpenAI Connected owner mounts it. It does not change runtime routing, tools, model selection, canonical context, state, consent or a service. It makes no provider calls.

## Ownership

- Codex Track B (`Analyse OpenAI architecture`): this new prompt module, its tests and evaluation assets. Prompt/capability quality and implementation guidance within the existing SSOT.
- OpenAI Connected: `agent-v1-turn.ts`, the FP2/FP1/FP3 stack, integration and serving. No route edit in this increment.
- Technical Architecture: the granted `build-model.ts` C1/C2 changes and disjoint runtime support. No competing prompt catalogue or approval route.
- AI Coaching/Core: canonical tools and validated science applicability/protocol, including #1781. No second implementation of Consider-the-Opposite here.
- Shared Data: existing canonical state, provenance and permission carriers. Canvas/Panel own their consumers and presentation.
- Existing independent Codex reviewer: independent assurance of this increment and the mount. This author does not approve its own work.
- Release Control: sequencing, conflicts, landing and the next joined browser acceptance. This module is not a new gate for the fast-path stack.

## Smallest mount (Connected-owned, not part of this change)

At the single final interpretation call introduced by #1786, import `composeAnalysisInterpreterV02` and supply:

```ts
const interpreter = composeAnalysisInterpreterV02(AGENT_INSTRUCTIONS);
// Existing FP3 call:
instructions: interpreter.instructions,
```

Keep `tool_choice: 'none'`, the current result/history, model, call limits, canonical checks and response envelope. Do not apply the profile globally to construction, approval or ordinary conversation. Do not reintroduce `decision_review` or another model call.

The caller can put `interpreter.identity` into its existing diagnostic logging, subject to its current response/log contract. This module does not alter a wire schema. The hash names the full instruction bytes; it does not hash the context/tools and must not be presented as a full request hash, PMS version, cache-hit attestation or authority token.

This is a source-controlled profile, not another PMS registry/cache or context signer. The existing `PromptSnapshot`/`promptSnapshotFrom` infrastructure remains untouched. A short shared kernel and additional profiles remain later increments; do not extract them from the existing Agent tonight and claim the old eval still covers the changed package.

## Evidence and limits

- Exact instruction block from programme-docs `openai/capability-v01/ANALYSIS_INTERPRETER_PROFILE_v0_2.md`, banked report commit `4961b2d174e32baaef0bf0aad8443e08ec74e563`.
- Instruction SHA-256, including final LF: `3d979e8406693be42d3b340fd245d76a501c4b1c191d5ffaa1353f2f0380ba32`.
- Historical screen: 12 current-Agent and 12 Agent-plus-profile responses, one sample per case. The profile was appended, not a standalone replacement.
- This module preserves the recovered profile block; the historical exact request serialisation was not recovered. No claim of reproducing the whole historical request byte-for-byte.
- Local checks establish byte identity and metadata behaviour. They do not establish model quality, product latency or browser acceptance. No new paid evaluation has been performed for this increment.
- Local validation: all five focused Vitest checks pass; ESLint and a strict targeted TypeScript check of the module and test pass. Full application CI and independent review remain separate gates.
- Six proposed journey cases are in `Docs/evals/interpreter/paul-journey-regressions-20260924.json`. These are evaluation inputs and expectations, not completed model runs or a new canonical schema. Expected answers must stay outside model input.
- The existing candidate is authorised for the first FP3 witness by RC #63 comment 5804387119. This packaging is optional for that first witness; Connected may use the banked text directly without waiting for this PR.

## Integration acceptance

1. The request reaching the existing provider contains this profile only on FP3's final interpretation and retains `tool_choice: 'none'`.
2. An unscorable material constraint produces a truthful partial interpretation; prose agrees with Canvas/Panel leader permissions.
3. Stale or changed-during-answer state is not narrated as current. A refused run is not narrated as a successful comparison.
4. The explanation remains useful and compact, honours a declined method and never invents a supported control, sensitivity value or delta.
5. One joined served witness verifies explicit Run, subsequent edit/rerun and reload. Preserve the distinction between a prompt source test and that product evidence.

Rollback is removal of the caller's mount only; no stored state migration is involved.

## Next increment

Validate the real FP3 input against the six proposed Paul-journey regressions before refining the words. Prioritise explicit partial-analysis scope, useful next action without unsupported optimality, and user language (no references to a “fixture”). Keep any changed prompt under a new version and compare against v0.2; do not replace the current candidate while its first served witness is pending.
