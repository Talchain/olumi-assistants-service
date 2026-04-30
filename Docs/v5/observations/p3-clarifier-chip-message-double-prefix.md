# P3 — clarifier chip `.message` double-prefix

**Severity:** P3 (cosmetic, not user-facing copy until clicked).
**Discovered:** 2026-04-30 during v5 journey replay diagnostic capture
on staging build `3bb151b`.

## Symptom

When step 6 of the harness sent the deterministic message
`"Set the Hiring and Staffing Cost factor to 0.7."`, the orchestrator
replied with a clarifier turn whose `suggested_actions[0]` chip carried
a malformed `message` field:

```json
{
  "id": "chip_clarify_factor_0",
  "label": "Hiring and Staffing Cost",
  "action_type": null,
  "message": "Set Hiring and Staffing Cost to Set the Hiring and Staffing Cost factor to 0.7."
}
```

The `message` is the prefix `"Set <label> to "` concatenated with the
operator's original input verbatim, rather than a clean payload like
`"Set the Hiring and Staffing Cost factor to 0.7."` or
`"Set Hiring and Staffing Cost to 0.7."`.

## Why P3 (not P1/P2)

- The chip is prompt-style (`action_type: null`); clicking it resubmits
  the `message` as a fresh user turn.
- The malformed message would be parsed by the orchestrator's normal
  message ingress path, which is robust to redundant prefixes (the
  brief's own clarifier resolves it via the same factor-name disambiguator).
- No user-visible copy on the chip itself (the **label** is clean:
  `"Hiring and Staffing Cost"`).
- Follow-up clicks **do not** appear in the captured trace as user-
  visible text — only in the next turn's request body.

## Suspected source

Likely a string template in the clarifier-chip generator that
constructs `message: \`Set ${label} to ${userOriginalMessage}\``
without stripping the operator's `"Set <label> to "` prefix when it
matches. Suspected file:
`src/orchestrator-v5/compose/chip-generator.ts` or a clarifier-
specific helper invoked from frame-stage edit-graph dispatch.

## Recommended treatment

Defer to a separate cleanup ticket. When the orchestrator's
clarifier-chip message construction is refactored, normalise the
`message` field to either:
- the clean composed payload (`"Set <label> to <value>"`), OR
- the operator's original message verbatim (no prefix wrapping).

## No action in current briefs

This observation does NOT block:
- The analysis-enrichment critique-prose-safety fix brief
  (different surface, different code path).
- The staleness-after-edit Phase 1 harness work
  (orchestrator clarifier behaviour is correct; only the chip's
  `message` field is malformed).
- Any production code change in flight.
