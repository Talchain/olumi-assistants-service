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

## Deployment

- Always push to `staging` unless explicitly told otherwise. Never push to `main` without explicit user confirmation.
- After making commits, always execute `git push` and verify it succeeded.
- Run `bash scripts/pre-push-validate.sh` before every push.

## Git workflow

- Before committing, run `git status` and `git diff --staged` to verify only intended changes are staged.
- No simultaneous Claude Code sessions on this repository.
- If you detect unexpected uncommitted changes or stash entries at session start, flag them before proceeding.

## Session preamble

At the start of every session, before any other work:
```
git branch --show-current && git log --oneline -3 && git status
```
Report the output and confirm the branch is correct.

## Testing

- After any code changes, run the full test suite and typecheck before committing. Report exact pass/fail counts.

## Debugging

- When investigating bugs, check ALL pipeline stages — LLM draft, normalisation, enrichment, STRP, repair, boundary validation. Do not stop at the first code path found.
- Be aware of stale `.js` files co-located with `.ts` source files.

## API / Schema changes

- When modifying API schemas or renaming fields, regenerate the OpenAPI spec (if generation exists) before pushing.

## Code review

- When asked to critically analyse code review feedback, evaluate each point independently. Do not make changes just to appease reviewers if the existing code is correct.
