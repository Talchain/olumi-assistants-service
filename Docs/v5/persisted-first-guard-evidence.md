# Persisted-first contract guard: evidence pack (component 1)

**Branch:** `claude/harness-c1-persisted-first-guard`. **Baseline:** `origin/staging` @ `3e4b86115` (post-#316). **Date:** 2026-07-02.
This file is the durable home for the guard's one-off RED transcripts (the committed fixture RED cases re-run in CI forever; these one-off proofs cannot, so they live here rather than in an ephemeral scratchpad).

## What the guard proves, in plain language

The list of factors an option already controls must always be computed from the saved model, never from whatever copy of the model the browser sent up. Three earlier fixes (#309, #314, #316) each corrected one such site by hand; this guard makes the whole class unrepresentable: every call of the authority function must match a reviewed allowlist, and the only sanctioned way to reference the function at all is a direct named import plus a direct call.

## Review hardening applied (2026-07-02 code review)

The adversarial review of the first design found and fixed four real holes, each now pinned by a committed RED case:

1. **String-hidden code (fail-open).** The naive comment stripper treated `//` or `/*` inside string literals as comments, deleting following code, so a rogue call after a URL string was invisible. Replaced with a length-preserving tokeniser (comments and string contents blanked character-for-character, newlines kept, template interpolations still visible, regex literals handled).
2. **Bare-reference laundering (fail-open).** `const f = collectInterventionControlledFactorIds; f(g)` and point-free `xs.map(collectInterventionControlledFactorIds)` evaded both the call scan and the import rules. A reference-discipline rule now forbids any appearance of the name that is neither a direct call nor a direct named-import specifier.
3. **Wrong line numbers.** Reported lines were computed on comment-collapsed text and drifted by hundreds of lines in doc-heavy files (1041 reported for true 1208). The tokenised views preserve newlines; correctness is proven drift-robustly (see hole 7 below).
4. **Sync-junk false RED.** The tree walker now skips the editor/sync duplicate files this repo already defends against elsewhere (a stray `turn-executor 2.ts` no longer fails the gate as a rogue site), and covers .ts/.tsx/.mts/.cts.

A second review round (PR #317) found two more fail-open holes, both now pinned by committed RED cases and by an end-to-end synthetic drill:

5. **`$`-prefixed alias evasion (fail-open).** The alias rule matched `… as \w+`, but a JS identifier may start with `$` (`import { collectInterventionControlledFactorIds as $ids }`), which has no leading `\w` — so the alias produced zero violations and the aliased call shipped. The rule now flags `… as` followed by a word boundary, regardless of the alias identifier.
6. **Backtick dynamic-import evasion (fail-open).** The dynamic-import rule matched only single/double-quoted paths, so `import(`…/intervention-controlled-drivers`)` (a template literal) plus computed access `mod[`collect…`](g)` bypassed every rule. The rule now includes the backtick quote form; the static namespace rule stays string-only because a static `import * as … from` cannot take a template literal per spec.

7. **Line-number test made drift-robust.** Instead of pinning absolute line numbers (`[1208, 3283, 4515]`) — which would false-RED on every unrelated edit that shifts lines above a site in `turn-executor.ts`, the rank-1 collision file — the test now asserts each reported line's source content contains the authority call. Correctness is still proven (an off-by-one lands on the argument/surrounding line, not the callee name) and the guard no longer manufactures false reds on harmless drift. Non-blocking per review, but taken because a gate that false-reds on unrelated churn gets ignored — the exact failure mode this guard's philosophy rejects.

Also applied from review round 1: the anti-rot site floor is derived from the allowlist (no hand-maintained duplicate), a cheap literal pre-filter keeps the scan's cost pinned as the tree grows (measured ~48ms to ~27ms across ~740 files), and the balanced-block capturer is shared between the scanner and the Rule-2 test (one implementation, not two).

## Historical RED (one-off): the scanner over the pre-#316 tip

Command: the committed pure scanner fed `git show e364c7332:src/orchestrator-v5/turn-executor.ts`.

```
pre-#316 turn-executor.ts (e364c7332): 3 authority call sites
  line 1208: context.persistedGraph ?? options.graphState
  line 3269: options.graphState ?? context.persistedGraph
  line 4501: context.persistedGraph ?? options.graphState

violations: 1
  RED: orchestrator-v5/turn-executor.ts:3269 — authority argument `options.graphState ?? context.persistedGraph`
       is not an allowlisted persisted-first form for this file.
       Allowed: `context.persistedGraph ?? options.graphState`.

Historical RED proven: the guard flags the real pre-#316 request-first site.
```

Precise claim: over that single file blob, the scanner reports exactly one allowlist violation, at the true source line of the request-first run-comparison site #316 fixed, and classifies the other two sites as conforming. (An earlier run of the pre-review scanner produced the same single violation but at a drifted line number, 3102; the transcript above is from the tokenised scanner.)

## Synthetic mutation RED (one-off, reverted; nothing committed touches production files)

Four simultaneous uncommitted mutations, then one guard run:

1. `turn-executor.ts:1209` flipped to `options.graphState ?? context.persistedGraph`;
2. `state-query-guard.ts`: alias-imported rogue call (`import { … as __rogueCollect }`);
3. `proposal-dismissal.ts`: rogue call on the same line as a URL string (`'https://internal.example/authority'`), the shape that was invisible to the first design;
4. `deterministic-short-confirm.ts`: aliased import plus bare rebinding.

Guard output (all four flagged in one run; excerpt):

```
orchestrator-v5/routing/deterministic-short-confirm.ts — aliases collectInterventionControlledFactorIds (`… as <alias>`) …
orchestrator-v5/routing/state-query-guard.ts — aliases collectInterventionControlledFactorIds (`… as <alias>`) …
orchestrator-v5/routing/proposal-dismissal.ts:109 — NEW call site of collectInterventionControlledFactorIds in a file not on the allowlist (arg: `g`) …
orchestrator-v5/turn-executor.ts:1208 — authority argument `options.graphState ?? context.persistedGraph` is not an allowlisted persisted-first form …
Tests  2 failed | 14 passed (16)
```

Mutations reverted; clean-tree run: 16/16 green. The pure bare-rebinding and point-free shapes (unaliased import) are additionally pinned as committed fixture RED cases that run in CI on every pass.

Second drill (PR #317 review round), for the two newly-closed holes: a `$`-alias rogue in `state-query-guard.ts` and a backtick dynamic import + computed-access rogue in `proposal-dismissal.ts`, injected together. Both flagged in one `scanRepository` run (`aliases …` and `dynamically imports …`); reverted; clean-tree 16/16 green. The `$`-alias, backtick dynamic-import, and backtick-require shapes are also pinned as committed fixture RED cases.

## The five-site authority manifest (scope: production files under `src/`, tests and the defining module excluded)

| File | Line | Argument | Posture |
|---|---|---|---|
| `orchestrator-v5/turn-executor.ts` | 1208 | `context.persistedGraph ?? options.graphState` | persisted-first (context pack) |
| `orchestrator-v5/turn-executor.ts` | 3283 | `context.persistedGraph ?? options.graphState` | persisted-first (run comparison; the #316 fix) |
| `orchestrator-v5/turn-executor.ts` | 4515 | `context.persistedGraph ?? options.graphState` | persisted-first (routed flip filter) |
| `orchestrator-v5/handlers/chip-click-dispatch.ts` | 1247 | `context.persistedGraph` | persisted-only |
| `orchestrator-v5/tools/handlers/run-analysis.ts` | 662 | `snapshot.rawPersistedGraph ?? { options: snapshot.options }` | persisted-derived |

Two-layer defence: this structural scan plus the #316 behavioural seam-spy test, which asserts the runtime authority value at the run-comparison seam (covering semantic laundering a text scan cannot see).

## Known residual limits (stated, not hidden)

- The tokeniser is a state machine, not a TypeScript parser; exotic syntax could in principle confuse it. Every known confusion class (strings, block comments, regex literals, template interpolations) is pinned by a committed RED case, and any NEW way of referencing the function that produces neither a direct call nor a clean import fails the bare-reference rule by construction.
- Re-exports of the module from another file would be caught only as a bare reference/alias in the re-exporting file.
- Semantic laundering upstream of the argument (rebinding `context.persistedGraph` itself) is out of scan reach by design; the behavioural seam-spy owns that layer.
- A dynamic import whose path is an indirected variable (`const p = '…drivers'; import(p)`) rather than a literal is out of scan reach — the module-path rules require the literal adjacent to `import(`/`require(`. This is deliberate evasion, not an accidental new call site, so it falls to the same behavioural layer; the literal backtick/quote forms an ordinary contributor would write are all closed.
