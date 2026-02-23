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

### Post-implementation verification
After completing any task that modifies node data, edge data, or constraint structures:

1. Run the **graph-validator** test suite.
2. Run the **graph-orchestrator** test suite.
3. If the change involves fields consumed by PLoT or ISL, verify the Zod schemas in the response assembly path accept the new values.

---

## Deployment

- Always push to `staging`. Never push to `main` without explicit user confirmation.
- After making commits, always execute `git push` and verify it succeeded. Do not just summarise commands — run them.
- Run `git status` and `git diff --staged` before every commit to verify only intended changes are staged.

### Deployment verification protocol

When asked to deploy or merge to staging:

1. Confirm the target branch is `staging` — never push to `main` without explicit user confirmation
2. Before committing, run `git status` and `git diff --staged` to verify ONLY intended changes are staged
3. If there are uncommitted changes from previous sessions, flag them and get user approval before including
4. Actually execute every git command — do not present commands as a summary without running them
5. After push, verify it succeeded by checking the output

Never bundle unrelated uncommitted changes into a deployment commit.

---

## Git workflow

- Before committing, run `git status` and `git diff --staged` to verify only intended changes are staged. Never commit all uncommitted changes without explicit user approval.
- No simultaneous Claude Code sessions on this repository. If you detect unexpected uncommitted changes or stash entries at session start, flag them before proceeding.

---

## Session preamble

At the start of every session, before any other work:

```bash
# 1. Branch and recent history
git branch --show-current && git log --oneline -5 && git status

# 2. Check for stale .js files shadowing .ts sources
find src -name '*.js' -exec sh -c 'test -f "${1%.js}.ts" && echo "STALE: $1"' _ {} \;

# 3. Check for uncommitted changes or stash entries
git stash list
```

Report the output. If stale `.js` files are found, flag them — they cause silent shadowing bugs where Node resolves the `.js` file instead of the `.ts` source. If unexpected uncommitted changes or stash entries exist, flag them before proceeding.

Confirm the branch is correct for the task before starting any work.

---

## Testing

- After any code changes, run the full test suite and typecheck before committing:
  ```bash
  pnpm test
  pnpm exec tsc --noEmit
  ```
- Report the exact number of passing/failing tests.

---

## Task completion checklist

Before reporting ANY task as complete, run and show the output of all five checks:

```bash
# 1. Correct branch?
git branch --show-current

# 2. Clean state? (no accidental uncommitted changes)
git status

# 3. Recent commits match the work just done?
git log --oneline -5

# 4. All tests pass?
pnpm test

# 5. TypeScript compiles cleanly?
pnpm exec tsc --noEmit
```

If any check fails, fix it before reporting completion. Do not report "done" with failing tests or uncommitted changes unless explicitly discussed with the user.

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

Common multi-layer patterns in this codebase:
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

1. **Stale .js files:** `find src -name '*.js' -exec sh -c 'test -f "${1%.js}.ts" && echo "STALE: $1"' _ {} \;`
2. **Hardcoded timeouts:** Grep for magic numbers (setTimeout, ms values) that should reference centralised config
3. **Error shape gaps:** In catch blocks and error handlers, verify both direct AND wrapped error formats are handled
4. **Schema drift:** If OpenAPI spec generation exists, regenerate and diff against committed spec
5. **Nullable field mismatches:** Check Zod schemas against actual API response shapes for optional/nullable alignment
6. **Uncommitted files:** `git status` — flag anything that could accidentally be bundled into the next commit

Categorise findings as critical/warning/info with production impact assessment.
