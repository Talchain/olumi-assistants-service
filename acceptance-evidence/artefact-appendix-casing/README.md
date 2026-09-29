# Artefact-appendix path-casing fix — acceptance evidence

CEE micro-lane. Fixes a production bug found by the 1.13 test-baseline-hygiene
lane (staging `c47f1317`, `REQUIRED_GATE_RED_EXCLUSIONS` 16 → 1) and
CI-reproduced on Linux.

## Bug

`loadArtefactAppendix()` in
`src/orchestrator/pipeline/phase3-llm/prompt-assembler.ts` resolved
`prompts/artefact_appendix.txt` (lowercase) but the file lives at
`Prompts/artefact_appendix.txt` (capital P — matches the sibling
`Prompts/v40.txt` convention). On case-insensitive macOS this silently
worked; on case-sensitive Linux/Render it ENOENTs, and the loader's own
catch-and-warn design returns `null` — so `injectArtefactAppendix: true` has
been a **silent no-op in every deployed environment**. The artefact design
appendix has likely never rendered in production.

## Fix

One-line literal-casing correction (`'prompts'` → `'Prompts'`), plus a
comment on `loadArtefactAppendix()` documenting the hazard.

## RED-first, filesystem-independent regression test

Added to `tests/unit/orchestrator/artefact-detector.test.ts`. Rather than
relying on the OS to resolve a mismatched-case path (which macOS silently
tolerates), the test compares the literal path segment `loadArtefactAppendix()`
uses against the *true* on-disk directory entry returned by
`fs.readdirSync` — `readdirSync` always reports the actual on-disk casing
regardless of filesystem case-sensitivity. This means the test fails on
**any** filesystem, including this session's macOS host, if the casing ever
drifts again — not just on case-sensitive CI.

Confirmed RED before the fix and GREEN after, both captured on this
case-insensitive macOS host (proving the guard isn't masked the way the
original bug was):

- `pre-fix-vitest-RED.txt` — `prompt-assembler.ts` temporarily reverted to
  the buggy `'prompts'` literal; 1/65 tests fail with
  `AssertionError: expected 'prompts' to be 'Prompts'`.
- `post-fix-vitest-green.txt` — fix restored; 65/65 tests pass.

`REQUIRED_GATE_RED_EXCLUSIONS` in `vitest.required.config.ts` is now empty
(the artefact-detector test was the last entry, 16 → 0 across the two lanes).

## Blast radius — behaviour-activating, not just hygiene

`injectArtefactAppendix` is only `true` when **both**:

1. `config.features.artefactAppendixEnabled` (env
   `CEE_ARTEFACT_APPENDIX_ENABLED`, **default `false`** in
   `src/config/index.ts`), and
2. `intentGate.artefact_hint === true` (the user's message looks
   artefact-shaped — comparison tables, SWOT, scoring rubrics, etc; see
   `isArtefactLikely` in `src/orchestrator/intent-gate.ts`).

`CEE_ARTEFACT_APPENDIX_ENABLED` is **not set anywhere in this repo**
(absent from `render.yaml` and every tracked `.env*`) — its value on Render
staging/production is set out-of-band in the Render dashboard, which this
lane could not inspect. **If it is already truthy in an environment, this
fix changes production behaviour the first time an artefact-shaped turn
runs there:** the appendix (`Prompts/artefact_appendix.txt`, 5,122 chars)
starts appending to the system prompt where it previously silently didn't.
If the flag is `false` everywhere (its default), this fix is inert until
someone flips it.

What the appendix does when it loads: it's appended verbatim after Zone 2
(`` `${zone1}\n\n${zone2}${artefactAppendixText}` ``) and as its own
(uncached) prompt-caching block; it's XML-wrapped
(`<ARTEFACT_DESIGN_APPENDIX>...</ARTEFACT_DESIGN_APPENDIX>`) and carries
artefact-design guidance for the LLM's tool calls on artefact-shaped turns.

**Size-guard check:** the appendix is injected *after*
`ZONE2_CHAR_BUDGET` (8,000 chars) is enforced on `zone2Sections` — it has no
dedicated size guard of its own in this V2 assembler path. The
`[18500, 20500]` sanity-range guard other lanes reference lives in
`src/orchestrator-v5/routing/prompt-loader.ts` — a different pipeline (v5
routing) — and does not apply here. Locally, injecting the appendix took
total system-prompt size from 57,852 → 62,976 chars (delta ≈ 5,124 chars,
matching the appendix's own length), with no assertion or guard tripping.

## Gates (fresh worktree off `origin/staging` @ `c47f1317`)

| Gate | Result | Evidence file |
|---|---|---|
| `pnpm typecheck:src` | clean | `typecheck-src.txt` |
| `scripts/ci/typecheck-ratchet.sh` | within baseline (drift shrank by 1 unrelated file) | `typecheck-ratchet.txt` |
| Targeted `vitest run tests/unit/orchestrator/artefact-detector.test.ts` | RED before / GREEN after (65/65) | `pre-fix-vitest-RED.txt`, `post-fix-vitest-green.txt` |
| `pnpm test:required` | 991 files / 19,419 tests passed, 0 failures | `test-required-summary.txt` (tail) |
| `scripts/validate-prepush.sh` | all checks OK | `validate-prepush.txt` |
| Required CI check `Lint, TypeCheck, Unit Tests` | see below | `pr-395-ci-checks.txt` |

Note: this repo's committed `node_modules` had a pre-existing stale
symlink (`node_modules/fastify` → `.pnpm/fastify@5.8.1`, while
`pnpm-lock.yaml` pins `fastify@5.8.5` via a security override) unrelated to
this change — reproduced identically on a pristine `origin/staging`
worktree with zero code changes (a plain `pnpm typecheck:src` there failed
on `openapi-typescript: command not found` before `pnpm install
--frozen-lockfile` was run). Ran `pnpm install --frozen-lockfile` to resync
node_modules for gate execution; the extraneous `node_modules` diff was
never staged — only the 3 intended files
(`prompt-assembler.ts`, `artefact-detector.test.ts`,
`vitest.required.config.ts`) were committed.

The "Security Audit" CI job (transitive `undici`/`ws`/`artillery`
advisories) fails on `origin/staging` tip (`c47f1317`) identically —
confirmed via `gh api .../commits/c47f1317.../check-runs` — and is
unrelated to this PR.

## PR / merge

- PR: https://github.com/Talchain/olumi-assistants-service/pull/395 (MERGED)
- Branch: `claude-cee/artefact-appendix-casing` (deleted post-merge)
- Commit (pre-squash): `b7727673d50bda326881cb280ab149f246770a94`
- Squash-merge SHA: `60bd72b74283caf094f53107482649b153c1d581`
- `git ls-remote` confirmation (HARD RULE): `git ls-remote
  https://github.com/Talchain/olumi-assistants-service.git
  refs/heads/staging` returned `60bd72b7...` — matches
  `gh pr view 395 --json mergeCommit` exactly.
- Required check `Lint, TypeCheck, Unit Tests`: **pass** (see
  `pr-395-ci-checks.txt`). `Security Audit` and `Integration Tests
  (advisory)` both fail — pre-existing/advisory, unrelated (Security
  Audit confirmed failing identically on `origin/staging` @ `c47f1317`
  before this PR, via `gh api .../commits/c47f1317.../check-runs`).
- `gh pr diff 395 --name-only` confirms the true merged diff is exactly
  the 3 intended files.

## Post-merge deploy-verify

- Render deploy `dep-d97jv6d8nd3s73dr0ao0` for commit `60bd72b7` went
  `live` (service `cee-staging`, `srv-d4slpaili9vc73eiq4og`).
- `GET https://cee-staging.onrender.com/healthz` →
  `{"ok":true,"build":"60bd72b",...}` — **build matches the merge tip**
  (`post-deploy-healthz.json`).
- **Env audit**: paginated all 108 env vars on `cee-staging` via the
  Render API — `CEE_ARTEFACT_APPENDIX_ENABLED` is **not set** (defaults to
  `false`, per `src/config/index.ts`). This means `injectArtefactAppendix`
  is `false` for every turn on staging right now regardless of message
  content, so `loadArtefactAppendix()` (the function this fix touches) is
  **never invoked live in this environment** — the fix is currently inert
  on staging by design, exactly as flagged in the PR body's blast-radius
  section.
- Three disposable turns against a fresh scenario
  (`afed3662-aa63-4277-b5cc-5ea507d9a7a6`), all confirming `build_sha:
  "60bd72b"` in `_diagnostic_trace.environment`:
  1. `live-turn1-frame-guard.json` — artefact-shaped message on an empty
     scenario; short-circuited at the `frame_no_brief_guard` preflight
     before reaching any LLM call (200, ~0.2s). Doesn't exercise
     `assembleV2SystemPrompt`.
  2. `live-turn2-draft-graph.json` — a fully-framed decision message;
     routed to `draft_graph` (a separate LLM path, not the V2
     coaching/converse assembler this fix touches), completed successfully
     (200, ~54s, real Anthropic `draft_graph` LLM call, 3-option graph
     produced). Confirms the deploy is healthy and the core LLM pipeline
     is unaffected.
  3. `live-turn3-followup-generic-failure.json` — an artefact-shaped
     follow-up on the now-graphed scenario, intended to route through the
     `turn_executor`/coaching path where `assembleV2SystemPrompt` (and
     thus `loadArtefactAppendix`) lives. Returned a generic
     "couldn't complete that turn cleanly" fallback (200, ~43s, zero
     LLM calls recorded, `exit_path: "turn_executor"`). **Not attributable
     to this fix**: `loadArtefactAppendix()` is only ever called when
     `injectArtefactAppendix` is `true`, which requires
     `CEE_ARTEFACT_APPENDIX_ENABLED` — confirmed unset above — so the
     changed code path cannot have executed on this turn. Reads as
     pre-existing coaching-pipeline brittleness (consistent with prior
     lanes' notes on LLM output-format brittleness in this area), not a
     regression introduced here; not investigated further as out of this
     micro-lane's scope.
- **Net result**: deploy confirmed live and healthy at the correct tip;
  the specific code path this PR touches could not be observed executing
  live because the gating feature flag is off in this environment (by
  design, not a defect) — the in-process regression test suite
  (`post-fix-vitest-green.txt`) is the authoritative proof that the fix
  itself works. If/when `CEE_ARTEFACT_APPENDIX_ENABLED` is turned on for
  an environment, the appendix will now load correctly there for the
  first time.
