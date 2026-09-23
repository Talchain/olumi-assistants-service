/**
 * OPENAI MUST BE ABLE TO EXPLAIN A DIFF — it was the last task closed to it.
 *
 * `ROUTER_TASK_PROVIDER_CAPABILITIES` is a DENY-LIST of two, not an allow-list:
 * `requireTaskModelAssignmentCapability` returns the assignment unchanged for
 * any task absent from it. So `explain_diff` was closed to OpenAI for exactly
 * one reason — `OpenAIAdapter.explainDiff` threw
 * `openai_explain_diff_not_supported`. With that stub in place an OpenAI-only
 * deployment renders the mounted `ExplainDiffButton`'s honest
 * `explain-diff-unavailable` message instead of rationales.
 *
 * ── WHAT THESE TESTS BIND, AND WHY THEY NEED NO SDK MOCK ────────────────────
 * The method body is invoked against a FAKE `this` carrying only `chat`. That
 * exercises the real parsing, filtering and clamping without constructing an
 * adapter (which needs credentials) and without faking the OpenAI SDK — so no
 * test here can make a provider call, and none of it depends on how `chat`
 * reaches the network.
 *
 * ⚠ NOT ASSERTED: explanation quality, or that the rationales are true of the
 * patch. That is not decidable in a unit test and is not claimed anywhere.
 */
import { describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter, clampRationaleWhy } from '../../src/adapters/llm/openai.js';
import {
  ROUTER_TASK_PROVIDER_CAPABILITIES,
  TASK_MODEL_DEFAULTS,
} from '../../src/config/model-routing.js';
import { MODEL_REGISTRY } from '../../src/config/models.js';
import type { CallOpts, ChatArgs, ChatResult } from '../../src/adapters/llm/types.js';

const ARGS = {
  patch: {
    adds: {
      nodes: [{ id: 'fac_price', kind: 'factor', label: 'Unit price' }],
      edges: [{ id: 'e1', from: 'fac_price', to: 'out_margin' }],
    },
    updates: [],
    removes: [],
  },
  brief: 'We must decide whether to raise prices by 8 percent before Christmas.',
  graph_summary: { node_count: 12, edge_count: 17 },
};
const OPTS: CallOpts = { requestId: 'explain-test-1' };

/** Runs the REAL method body with a scripted `chat`, capturing its args. */
async function runExplainDiff(content: string) {
  const seen: ChatArgs[] = [];
  const chat = vi.fn(async (a: ChatArgs): Promise<ChatResult> => {
    seen.push(a);
    return {
      content,
      usage: { input_tokens: 411, output_tokens: 92 },
      model: 'gpt-5.2',
      latencyMs: 640,
    };
  });
  const fakeThis = { chat } as unknown as OpenAIAdapter;
  const result = await OpenAIAdapter.prototype.explainDiff.call(fakeThis, ARGS, OPTS);
  return { result, seen, chat };
}

describe('OpenAIAdapter.explainDiff returns rationales', () => {
  it('⛔ parses a well-formed reply and carries usage through', async () => {
    const { result, seen } = await runExplainDiff(
      JSON.stringify({
        rationales: [
          { target: 'fac_price', why: 'The brief names an 8% price rise.', provenance_source: 'user_brief' },
          { target: 'e1', why: 'Price feeds margin directly.' },
        ],
      }),
    );
    expect(seen, 'non-vacuity: the adapter must actually have called chat').toHaveLength(1);
    expect(result.rationales).toHaveLength(2);
    expect(result.rationales[0]).toEqual({
      target: 'fac_price',
      why: 'The brief names an 8% price rise.',
      provenance_source: 'user_brief',
    });
    // Omitted, not invented, when the model does not supply it.
    expect('provenance_source' in result.rationales[1]).toBe(false);
    expect(result.usage.input_tokens).toBe(411);
    expect(result.usage.output_tokens).toBe(92);
  });

  it('asks for JSON and the task cap, and sends the brief inside an untrusted envelope', async () => {
    const { seen } = await runExplainDiff(
      JSON.stringify({ rationales: [{ target: 'x', why: 'y' }] }),
    );
    expect(seen[0].responseFormat).toBe('json_object');
    expect(seen[0].maxTokens).toBe(2048);
    // The brief is user input, so it must not arrive as bare instruction text.
    expect(seen[0].userMessage).toContain('[BEGIN_UNTRUSTED_USER_CONTENT]');
    expect(seen[0].userMessage).toContain('[END_UNTRUSTED_USER_CONTENT]');
    // The patch is what is being explained, so it has to be present.
    expect(seen[0].userMessage).toContain('fac_price');
    expect(seen[0].userMessage).toContain('Graph has 12 nodes and 17 edges.');
  });
});

describe('the route contracts that turn a model quirk into a 500', () => {
  /**
   * ⛔ The route sorts with `a.target.localeCompare(b.target)`. A non-string
   * target would throw a TypeError INSIDE the route, so it must never leave
   * here. Dropped rather than coerced — a fabricated id would attach an
   * explanation to the wrong element.
   */
  it('⛔ drops entries whose target is not a usable string', async () => {
    const { result } = await runExplainDiff(
      JSON.stringify({
        rationales: [
          { target: 42, why: 'numeric target' },
          { target: '', why: 'empty target' },
          { target: null, why: 'null target' },
          { target: 'keep_me', why: 'the only well-formed row' },
          { target: 'no_why' },
          'not even an object',
        ],
      }),
    );
    expect(result.rationales).toHaveLength(1);
    expect(result.rationales[0].target).toBe('keep_me');
    for (const r of result.rationales) expect(typeof r.target).toBe('string');
  });

  it('⛔ clamps `why` to the schema ceiling, because 281 chars is an opaque 500', async () => {
    // ExplainDiffOutput caps `why` at 280 (schemas/assist.ts:720).
    const long = `${'The brief states a price rise and the margin effect follows from it. '.repeat(9)}END`;
    expect(long.length, 'the fixture must actually exceed the cap').toBeGreaterThan(280);
    const { result } = await runExplainDiff(
      JSON.stringify({ rationales: [{ target: 'fac_price', why: long }] }),
    );
    expect(result.rationales[0].why.length).toBeLessThanOrEqual(280);
  });
});

describe('it fails CLOSED — a broken explainer must not look like "nothing to explain"', () => {
  // The route rejects an empty patch with 400 BEFORE calling the adapter, so by
  // this point there IS something to explain. Returning nothing quietly would
  // be a false statement about the change.
  it('⛔ throws on non-JSON content', async () => {
    await expect(runExplainDiff('I am afraid I cannot do that.')).rejects.toThrow(
      /openai_explain_diff_unparseable/,
    );
  });

  it('⛔ throws when the reply carries no rationales array', async () => {
    await expect(runExplainDiff(JSON.stringify({ notes: [] }))).rejects.toThrow(
      /openai_explain_diff_malformed/,
    );
  });

  it('⛔ throws when every entry is malformed — `.min(1)` would otherwise 500 opaquely', async () => {
    await expect(
      runExplainDiff(JSON.stringify({ rationales: [{ why: 'no target' }] })),
    ).rejects.toThrow(/openai_explain_diff_empty/);
  });

  /**
   * ⛔ THE ROUTE MAPS ANY MESSAGE CONTAINING `_not_supported` TO A CAPABILITY
   * 400 with "Use LLM_PROVIDER=anthropic or fixtures". If a malformed-reply
   * error used that substring, a real failure would be reported to the user as
   * "OpenAI cannot do this" — the exact false statement this PR removes.
   */
  it('⛔ no failure message can be mistaken for the capability error', async () => {
    for (const body of ['nonsense', JSON.stringify({ notes: [] }), JSON.stringify({ rationales: [{}] })]) {
      await expect(runExplainDiff(body)).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('_not_supported') }),
      );
    }
  });
});

describe('the capability map now states a fact', () => {
  it('⛔ explain_diff lists openai, because the adapter implements it', () => {
    expect(ROUTER_TASK_PROVIDER_CAPABILITIES.explain_diff).toContain('openai');
  });

  it('keeps anthropic and fixtures — this widens, it does not replace', () => {
    expect(ROUTER_TASK_PROVIDER_CAPABILITIES.explain_diff).toContain('anthropic');
    expect(ROUTER_TASK_PROVIDER_CAPABILITIES.explain_diff).toContain('fixtures');
  });

  it('⚠ CONVENTIONAL GUARD — the checked-in default is still an ANTHROPIC model', () => {
    // A capability is permission, not assignment. If this default ever became
    // an OpenAI model every existing explain_diff caller would silently change
    // provider, which the governing brief forbids. Derived through the registry
    // rather than string-matched, so a rename cannot fool it.
    const def = TASK_MODEL_DEFAULTS.explain_diff;
    const entry = MODEL_REGISTRY[def as keyof typeof MODEL_REGISTRY];
    expect(entry, `explain_diff default '${def}' must exist in the registry`).toBeDefined();
    expect(entry.provider).toBe('anthropic');
  });

  it('POSITIVE CONTROL — the throwing stub is gone from executable code', async () => {
    const fs = await import('node:fs/promises');
    const url = await import('node:url');
    const src = await fs.readFile(
      url.fileURLToPath(new URL('../../src/adapters/llm/openai.ts', import.meta.url)),
      'utf8',
    );
    expect(src.length, 'the adapter source must be readable').toBeGreaterThan(1000);
    expect(src).toContain('async explainDiff(');
    // Match the THROW form, not the bare string: the identifier survives in the
    // docblock that records this change, and a prose hit is not a stub.
    expect(src).not.toContain('throw new Error("openai_explain_diff_not_supported');
  });
});

describe('clampRationaleWhy does not cut mid-word', () => {
  it('leaves a short string byte-identical', () => {
    expect(clampRationaleWhy('Short and true.')).toBe('Short and true.');
  });

  it('⛔ a clamped string ends on a whole word, not a fragment', () => {
    const s = `${'alpha beta gamma delta epsilon '.repeat(20)}omega`;
    const out = clampRationaleWhy(s);
    expect(out.length).toBeLessThanOrEqual(280);
    // The ellipsis makes the shortening visible rather than passing a truncated
    // claim off as the whole explanation.
    expect(out.endsWith('…')).toBe(true);
    const body = out.slice(0, -1);
    expect(body, 'must not end mid-word').toMatch(/[A-Za-z0-9.,;:!?)\]]$/);
    expect(s.startsWith(body), 'the kept text must be a true prefix of the original').toBe(true);
  });

  it('still clamps a 280+ run with no spaces at all', () => {
    const out = clampRationaleWhy('x'.repeat(400));
    expect(out.length).toBeLessThanOrEqual(280);
  });

  it('POSITIVE CONTROL — the boundary is real: 280 passes, 281 is clamped', () => {
    expect(clampRationaleWhy('a'.repeat(280))).toHaveLength(280);
    expect(clampRationaleWhy('a'.repeat(281)).length).toBeLessThanOrEqual(280);
  });
});
