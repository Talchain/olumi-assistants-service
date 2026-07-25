/**
 * Shared test helper: extract the serialised `## ContextPack` JSON from the
 * message `buildUserMessage` actually sends.
 *
 * WHY THIS IS NOT A ONE-LINER
 * ---------------------------
 * `buildUserMessage` (routing/route-with-tool-use.ts) does NOT end the user
 * message at the pack JSON. It conditionally appends CODE-OWNED instruction
 * blocks BETWEEN the JSON and the `## User turn` marker:
 *
 *   - `COACHING_CONTEXT_INSTRUCTION`  when `coaching_context` is on the pack
 *   - `SUMMARY_PRECEDENCE_INSTRUCTION` when `conversation_summary` is on the pack
 *
 * So the obvious implementation — slice to `'\n\n## User turn'` and
 * `JSON.parse` — slices those blocks INTO the JSON text and THROWS. A test
 * using it is structurally unable to observe a pack carrying either conditional
 * model-facing section, and stays green only for as long as its fixture never
 * populates them.
 *
 * That was a real, verified defect in `context-policy.conformance.test.ts`'s
 * `observeSerialisedKeys` (fixed by the same PR that added this file). It is
 * NOT concealment by the authoring lane: that anchor PREDATES both conditional
 * sections and its commit message claims nothing false — it was correct when
 * written and the pack grew underneath it.
 *
 * This helper brace-matches the JSON object instead, respecting string literals
 * and escapes, so it is correct regardless of what follows the object. Two call
 * sites need it (the policy conformance anchor and the prompt↔pack sanction
 * gate), so it lives here rather than being written a third time.
 */

/**
 * Parse the serialised ContextPack out of a `buildUserMessage` result.
 *
 * @throws if the `## ContextPack` marker is absent or the object is unterminated
 *         — a silent `{}` would turn every downstream key assertion vacuous.
 */
export function observeSerialisedPack(userMessage: string): Record<string, unknown> {
  const marker = '## ContextPack\n';
  const at = userMessage.indexOf(marker);
  if (at < 0) throw new Error('observeSerialisedPack: no `## ContextPack` marker in the user message');
  const rest = userMessage.slice(at + marker.length);

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(rest.slice(0, i + 1)) as Record<string, unknown>;
    }
  }
  throw new Error('observeSerialisedPack: unterminated ContextPack JSON object');
}

/** Ordered top-level keys of the serialised pack — the model-facing key list. */
export function observeSerialisedKeys(userMessage: string): string[] {
  return Object.keys(observeSerialisedPack(userMessage));
}
