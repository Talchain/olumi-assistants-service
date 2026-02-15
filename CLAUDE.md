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
