/**
 * Mechanism test — the fallback routing prompt must never teach a tool-call
 * example the live validator would reject (Codex F4).
 *
 * `Prompts/v40.txt` is the production routing FALLBACK prompt, served verbatim
 * whenever PMS is empty or unreachable (route-with-tool-use.ts → the default
 * snapshot). Its `<EXAMPLES>` section once taught invalid vocabulary the
 * enforcing Zod validator rejects — `coaching_mode` values outside the enum,
 * `target_entity` instead of the required `entity`, `resolution_method:
 * contextual` instead of `context_inference`. A model that copied an example
 * verbatim paid a REPAIR_ONCE round-trip (or failed the turn).
 *
 * This test EXTRACTS every fenced ```json tool-call example from the prompt
 * bytes the system actually serves (`LOADED_PROMPT.text`) and runs each through
 * `parseToolCallResponse` — the same enforcing parse the routing turn applies
 * to Sonnet's tool call. One invalid example fails this test loud, so the
 * fallback prompt can never drift from the validator again.
 *
 * Derive-don't-mirror (CLAUDE.md rule 12): there is no hand-listed copy of the
 * examples here. The test reads the ACTUAL example bytes and `JSON.parse`s them
 * — no bespoke grammar to fall out of sync with the prompt, and no allow-list
 * of "known good" shapes to forget to update.
 */

import { describe, expect, it } from 'vitest';

import { LOADED_PROMPT } from '../prompt-loader.js';
import { parseToolCallResponse } from '../tool-schema.js';

/**
 * Every fenced ```json block in the prompt, in document order, as raw strings.
 * JSON.parse is deferred to the per-example test body so a malformed example
 * surfaces as a clean red on THAT example rather than a collection-time crash
 * that kills the whole file (CLAUDE.md rule 12 — a factory throw at collection
 * has masked whole suites here before).
 */
function extractJsonToolCallBlocks(promptText: string): string[] {
  const fence = /```json\s*\n([\s\S]*?)\n```/g;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = fence.exec(promptText)) !== null) {
    out.push(match[1]);
  }
  return out;
}

const promptText = LOADED_PROMPT.text;
const rawBlocks = extractJsonToolCallBlocks(promptText);
const toolCallHeaders = (promptText.match(/^Tool call:\s*$/gm) ?? []).length;

describe('fallback routing prompt (v40) — every tool-call example parses under the live validator', () => {
  // Positive control (CLAUDE.md rule 13 — an absence assertion is vacuous
  // unless it can SEE a presence): the extractor must find examples at all,
  // and exactly one ```json body per "Tool call:" header. If someone adds a
  // "Tool call:" example without a JSON body (or a JSON body without a
  // header), this fails BEFORE the per-example loop can pass by testing
  // nothing. The expected count is DERIVED from the prompt itself (the header
  // count), never hand-pinned.
  it('extracts exactly one JSON tool-call example per "Tool call:" header (non-vacuous)', () => {
    expect(rawBlocks.length).toBeGreaterThan(0);
    expect(rawBlocks.length).toBe(toolCallHeaders);
  });

  // Positive control that the parse DISCRIMINATES: the exact vocabulary this
  // repair removed (`resolution_method: "contextual"`, not a member of the
  // enforcing enum) MUST throw. Without this, a parser that accepted anything
  // would make the per-example loop below vacuously green.
  it('parseToolCallResponse rejects the invalid vocabulary the fix removed', () => {
    expect(() =>
      parseToolCallResponse({
        intent_class: 'execute',
        action: {
          handler_id: 'explain_from_structure',
          entity: {
            id: 'goal_ux',
            kind: 'goal',
            label: 'Improve Product UX',
            resolution_status: 'resolved',
            // `contextual` is NOT a ResolutionMethodSchema member — the exact
            // defect the fallback examples used to teach.
            resolution_method: 'contextual',
          },
        },
      }),
    ).toThrow();
  });

  it.each(rawBlocks.map((raw, index) => [index + 1, raw] as const))(
    'tool-call example #%i is valid JSON and parses under parseToolCallResponse',
    (_exampleNumber, raw) => {
      // A malformed example fails here with a clear JSON error on THIS case.
      const value: unknown = JSON.parse(raw);
      expect(() => parseToolCallResponse(value)).not.toThrow();
    },
  );
});
