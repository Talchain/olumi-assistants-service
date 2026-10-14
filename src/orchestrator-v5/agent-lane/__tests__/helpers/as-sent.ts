/**
 * T1 (b): a converse call sends the Agent instructions as the FIRST input item, a developer `input_text` block carrying an
 * explicit cache breakpoint, instead of top-level `instructions` (`agent-v1-turn.ts`, `withInstructionsBreakpoint`).
 * Rows that pin the prompt's CONTENT read it through this: the request as it was before the carrier moved — the same
 * text in `instructions`, the developer block out of `input`. The carrier itself is pinned by `instructions-breakpoint.test.ts`.
 */
export function asSent<T extends Record<string, unknown>>(body: T): T {
  if (typeof body['instructions'] === 'string' || !Array.isArray(body['input'])) return body;
  const [first, ...rest] = body['input'] as unknown[];
  const block = (first as { role?: unknown; content?: { type?: unknown; text?: unknown }[] } | undefined);
  const text = block?.role === 'developer' && Array.isArray(block.content) && block.content[0]?.type === 'input_text'
    ? block.content[0].text : undefined;
  if (typeof text !== 'string') return body;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'input') { out['instructions'] = text; out['input'] = rest; } else out[k] = v;
  }
  return out as T;
}
