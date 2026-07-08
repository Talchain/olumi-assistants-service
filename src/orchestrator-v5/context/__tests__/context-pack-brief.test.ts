/**
 * Lane 28 — brief pipeline: ContextPack `brief` field.
 *
 * The user's decision brief (`scenarios.brief_text`) previously reached NO LLM
 * after the draft turn — the ContextPack had no brief field (context-architecture
 * dossier gap G2). These tests pin the new projection:
 *
 *   - `projectBrief` size-bounds the brief at CONTEXT_PACK_BRIEF_CHAR_CAP with
 *     DISCLOSED truncation (`truncated` flag + `original_chars` count — never a
 *     silent slice);
 *   - the assembler threads `AssembleContextPackInput.brief` through, and
 *     OMITS the `brief` key entirely when no brief exists (a null is never
 *     serialised into the routing prompt);
 *   - the strict test-env schema gate accepts the new field;
 *   - `buildUserMessage` (route-with-tool-use) carries the brief into the
 *     serialised prompt automatically — and its absence keeps the prompt
 *     brief-free (no fabricated section).
 */

import { describe, expect, it, vi } from 'vitest';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../../adapters/llm/types.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import {
  assembleContextPack,
  projectBrief,
  type ContextPack,
} from '../context-pack-assembler.js';
import {
  CONTEXT_PACK_BRIEF_CHAR_CAP,
  ContextPackSchema,
} from '../context-pack-schema.js';
import { routeWithToolUse } from '../../routing/route-with-tool-use.js';

const BRIEF = 'Should we hire two senior engineers locally or engage an offshore partner? Budget is £250k and the decision is needed by Q3.';

// ---------------------------------------------------------------------------
// projectBrief — pure projection unit
// ---------------------------------------------------------------------------

describe('projectBrief', () => {
  it('returns null for null / undefined / whitespace-only input', () => {
    expect(projectBrief(null)).toBeNull();
    expect(projectBrief(undefined)).toBeNull();
    expect(projectBrief('')).toBeNull();
    expect(projectBrief('   \n\t  ')).toBeNull();
  });

  it('passes a short brief through verbatim (trimmed) with truncated=false', () => {
    const projected = projectBrief(`  ${BRIEF}  `);
    expect(projected).toEqual({
      text: BRIEF,
      truncated: false,
      original_chars: BRIEF.length,
    });
  });

  it('keeps a brief at exactly the cap un-truncated', () => {
    const atCap = 'a'.repeat(CONTEXT_PACK_BRIEF_CHAR_CAP);
    const projected = projectBrief(atCap);
    expect(projected).toEqual({
      text: atCap,
      truncated: false,
      original_chars: CONTEXT_PACK_BRIEF_CHAR_CAP,
    });
  });

  it('truncates an over-cap brief with DISCLOSED truncation (flag + original count)', () => {
    const overCap = 'b'.repeat(CONTEXT_PACK_BRIEF_CHAR_CAP + 500);
    const projected = projectBrief(overCap);
    expect(projected).not.toBeNull();
    expect(projected!.text).toHaveLength(CONTEXT_PACK_BRIEF_CHAR_CAP);
    expect(projected!.text).toBe(overCap.slice(0, CONTEXT_PACK_BRIEF_CHAR_CAP));
    expect(projected!.truncated).toBe(true);
    // Disclosure: the original length is carried so no consumer can mistake
    // the bounded text for the whole brief.
    expect(projected!.original_chars).toBe(CONTEXT_PACK_BRIEF_CHAR_CAP + 500);
  });

  it('measures original_chars on the trimmed input (whitespace padding is not "content lost")', () => {
    const padded = `   ${'c'.repeat(CONTEXT_PACK_BRIEF_CHAR_CAP)}   `;
    const projected = projectBrief(padded);
    expect(projected!.truncated).toBe(false);
    expect(projected!.original_chars).toBe(CONTEXT_PACK_BRIEF_CHAR_CAP);
  });
});

// ---------------------------------------------------------------------------
// Assembler threading + schema gate
// ---------------------------------------------------------------------------

function assembleWith(brief: string | null | undefined): ContextPack {
  return assembleContextPack({
    payload: makeMessagePayload({ scenario_id: 'scen-brief', message: 'what should I do?' }),
    priorTurns: [],
    priorFacts: [],
    ...(brief !== undefined ? { brief } : {}),
  });
}

describe('assembleContextPack — brief threading', () => {
  it('OMITS the brief key when no brief input is supplied (legacy callers)', () => {
    // Prompt hygiene: a no-brief pack must not carry `brief: null` into the
    // serialised routing prompt — the key is absent entirely.
    const pack = assembleWith(undefined);
    expect('brief' in pack).toBe(false);
  });

  it('OMITS the brief key when the persisted brief is null (nothing persisted yet)', () => {
    const pack = assembleWith(null);
    expect('brief' in pack).toBe(false);
  });

  it('OMITS the brief key when the persisted brief is whitespace-only', () => {
    const pack = assembleWith('   \n ');
    expect('brief' in pack).toBe(false);
  });

  it('a no-brief pack still passes the strict ContextPack schema (key optional)', () => {
    const parsed = ContextPackSchema.safeParse(assembleWith(undefined));
    expect(parsed.success).toBe(true);
  });

  it('projects a persisted brief into the pack', () => {
    const pack = assembleWith(BRIEF);
    expect(pack.brief).toEqual({
      text: BRIEF,
      truncated: false,
      original_chars: BRIEF.length,
    });
  });

  it('the assembled pack (with brief) passes the strict ContextPack schema', () => {
    const pack = assembleWith(BRIEF);
    const parsed = ContextPackSchema.safeParse(pack);
    expect(parsed.success).toBe(true);
  });

  it('the assembled pack with a truncated brief passes the strict schema', () => {
    const pack = assembleWith('d'.repeat(CONTEXT_PACK_BRIEF_CHAR_CAP + 1));
    expect(pack.brief!.truncated).toBe(true);
    const parsed = ContextPackSchema.safeParse(pack);
    expect(parsed.success).toBe(true);
  });

  it('schema rejects an over-cap brief text (bound is enforced, not advisory)', () => {
    const pack = assembleWith(BRIEF);
    const tampered = {
      ...pack,
      brief: {
        text: 'e'.repeat(CONTEXT_PACK_BRIEF_CHAR_CAP + 1),
        truncated: false,
        original_chars: CONTEXT_PACK_BRIEF_CHAR_CAP + 1,
      },
    };
    const parsed = ContextPackSchema.safeParse(tampered);
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prompt carriage — buildUserMessage serialises the pack, so the brief reaches
// the routing LLM with no prompt-template change. Exercised through the public
// routeWithToolUse with a capturing mock adapter (same pattern as
// coaching-context-injection.test.ts).
// ---------------------------------------------------------------------------

function mkResult(content: ToolResponseBlock[]): ChatWithToolsResult {
  return {
    content,
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 1,
  };
}

function mockAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
      .mockResolvedValueOnce(mkResult([{ type: 'text', text: 'ok' }])),
  };
}

async function promptUserMessageFor(brief: string | undefined): Promise<string> {
  const adapter = mockAdapter();
  await routeWithToolUse(assembleWith(brief), 'what should I do?', {
    requestId: 'req-brief-1',
    adapter,
  });
  const args = adapter.chatWithTools.mock.calls[0]![0];
  return args.messages[0]!.content as string;
}

describe('brief reaches the serialised routing prompt', () => {
  it('carries the brief text inside the serialised ContextPack section', async () => {
    const msg = await promptUserMessageFor(BRIEF);
    expect(msg).toContain('"brief"');
    expect(msg).toContain('Budget is £250k');
    expect(msg.indexOf('## ContextPack')).toBeLessThan(msg.indexOf('Budget is £250k'));
  });

  it('serialises NO brief key at all when nothing is persisted (no null in the prompt)', async () => {
    const msg = await promptUserMessageFor(undefined);
    expect(msg).not.toContain('"brief"');
    expect(msg).not.toContain('Budget is £250k');
  });
});
