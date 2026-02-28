## Schema & Type Safety Rules

### Default values and enum literals
Before writing any literal default value, enum string, or type assertion:

1. **Locate the Zod schema or TypeScript enum** that validates the target field. Search the codebase — do not rely on brief instructions or memory for valid values.
2. **Confirm the value is a valid member.** If the schema says `z.enum(["cost", "price", "other"])`, only those strings are valid. Do not invent new values.
3. **If no schema exists** for the field, flag it in your response before proceeding.

### Cross-boundary type tracing
When modifying any field that crosses a service boundary (CEE → PLoT → ISL) or passes through Zod validation:

1. **Trace the field from source to consumer.** Find where the value is produced, validated, and consumed.
2. **Check all intermediate schemas.** A value valid in the producer's type may be invalid in the consumer's Zod schema.
3. **Run the relevant test suite** after any change to a shared type or default value.

---

## Pre-commit protocol

Before every commit, run and verify:

```bash
git status && git diff --staged
```

- Only intended changes should be staged. Never commit all uncommitted changes without explicit user approval.
- Never bundle unrelated uncommitted changes into a commit.
- Flag unexpected uncommitted changes or stash entries and get user approval before including them.

---

## Deployment

- Always push to `staging`. Never push to `main` without explicit user confirmation.
- After making commits, always execute `git push` and verify it succeeded. Do not just summarise commands — run them.
- Follow the [Pre-commit protocol](#pre-commit-protocol) before every commit.
- No simultaneous Claude Code sessions on this repository.

---

## Session preamble

At the start of every session, before any other work:

```bash
# 1. Branch, recent history, and working tree state
git branch --show-current && git log --oneline -5 && git status

# 2. Check for stale .js files shadowing .ts sources
find src -name '*.js' -exec sh -c 'test -f "${1%.js}.ts" && echo "STALE: $1"' _ {} \;

# 3. Check for stash entries
git stash list
```

Report the output. If stale `.js` files are found, flag them — they cause silent shadowing bugs where Node resolves the `.js` file instead of the `.ts` source. If unexpected uncommitted changes or stash entries exist, flag them before proceeding.

Confirm the branch is correct for the task before starting any work.

---

## Testing — Three-Tier Process

Testing uses a tiered approach to avoid heavy resource usage on the local machine.
The full suite runs in CI — not after every code change.

### Tier 1: Smoke (after every code change)

Run **only** after making changes, before reporting the task as done.
Targets changed files and their direct dependents — fast and light.

```bash
pnpm exec tsc --noEmit                                # ~60-90s, catches type errors
pnpm exec vitest run --changed --bail=1                # only tests affected by changes
```

If `--changed` finds no related tests, skip the vitest step — typecheck alone is sufficient.
Report: "Typecheck passed. N related tests passed." (or "No related tests for this change.")

### Tier 2: Pre-commit validation

Run before committing. Still lightweight — no full test suite.

```bash
pnpm exec tsc --noEmit
pnpm lint
```

### Tier 3: Full gate (before pushing to staging only)

Run **only** when the user explicitly says to push to staging.

```bash
pnpm test                  # full suite
git push origin staging
```

### Important rules

- **Never run `pnpm test` (full suite) after every code change** — it wastes time and resources.
- CI is the authoritative gate — local testing is a fast feedback loop, not a replacement.

---

## Task completion checklist

Before reporting ANY task as complete, run the **Tier 1 smoke checks** (not the full suite):

```bash
git branch --show-current                              # Correct branch?
git status                                             # Clean state?
pnpm exec tsc --noEmit                                 # TypeScript compiles?
pnpm exec vitest run --changed --bail=1                # Related tests pass?
```

If typecheck or related tests fail, fix before reporting completion.
Do NOT run `pnpm test` (full suite) here — that runs when the user decides to push,
and again in CI. See "Testing — Three-Tier Process" above.

---

## Debugging

- Be aware of stale `.js` files co-located with `.ts` source files in `src/`. Node may resolve the `.js` instead of `.ts`. Check for and remove stale `.js` files when debugging unexpected behaviour.
- When investigating bugs or tracing data flow, check ALL layers of the pipeline: CEE → PLoT adapter → ISL, V2 and V3 adapters, direct error shapes AND PLoT-wrapped error shapes. Do not stop at the first code path found.

### Data flow tracing (mandatory before any fix)

Before implementing any bug fix or feature that touches data flowing between services, trace and document the complete path:

1. Where does the data originate? (CEE LLM response? ISL computation? PLoT assembly?)
2. List every transform/adapter layer it passes through (with file paths)
3. Where is it consumed in the final response?
4. Are there alternate code paths or error shapes? (e.g., direct error vs PLoT-wrapped error, V2 vs V3 adapter)

Only after the trace is documented, implement fixes at ALL affected layers. Do not fix one layer and assume others are correct.

Common multi-layer patterns:
- CEE response → PLoT adapter → ISL request (field name translations like `from` → `from_`)
- ISL response → PLoT V2/V3 adapter → UI store (two adapter shapes)
- Error responses: direct shape AND PLoT-wrapped shape must both be handled
- CEE → store → PLoT chain: check extraction, normalisation, and passthrough at every boundary

---

## Code review analysis

When asked to address code review feedback:

1. Read ALL feedback items first before making any changes
2. For each item, determine independently:
   - Is the feedback valid and does it require a code change?
   - Is it already handled by existing code?
   - Is it incorrect or based on a misunderstanding of the architecture?
3. State your reasoning for each determination before making changes
4. Do not make changes just to appease reviewers if the existing code is correct
5. Group changes by affected file to minimise unnecessary edits

---

## Proactive codebase audit

Run this audit before major deployments or when requested. Check for:

1. **Hardcoded timeouts:** Grep for magic numbers (setTimeout, ms values) that should reference centralised config
2. **Error shape gaps:** In catch blocks and error handlers, verify both direct AND wrapped error formats are handled
3. **Schema drift:** If OpenAPI spec generation exists, regenerate and diff against committed spec
4. **Nullable field mismatches:** Check Zod schemas against actual API response shapes for optional/nullable alignment

Categorise findings as critical/warning/info with production impact assessment.

_(Stale .js files and uncommitted changes are already checked by the [Session preamble](#session-preamble).)_
