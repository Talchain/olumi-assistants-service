/**
 * SENTENCE PASS WIRING in `buildModelFromRecords` — rows (f) build-level control, (g) the never-worse gate on the
 * served path, (i) parallel timing with fake timers (design DESIGN-SENTENCE-PASS.md §3, §6). Synthetic brief only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildModelFromRecords, buildStrictSentencePassSchema } from '../runtime/build-model-from-records.js';
import type { CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { SENTENCE_PASS_INSTRUCTION, SENTENCE_PASS_SCHEMA_NAME, SENTENCE_PASS_PROMPT_ALIAS } from '../../../cee/draft/records/sentence-pass.js';
import { SYN, synMain, synPass } from '../../../cee/draft/records/__tests__/fixtures/sentence-pass-syn.js';

const SCENARIO = '22222222-2222-4222-8222-222222222222';
function harness() {
  const registered: unknown[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { registered.push(body); return { status: 200, json: { model_version: 1 } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [], edges: [] } } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  return { dispatch, registered };
}
const mainCall = (delayMs = 0): CallStructuredModel => async () => {
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  return { text: JSON.stringify(synMain()), status: 'completed' };
};
const passCall = (text: string, delayMs = 0, seen?: { signal?: AbortSignal; req?: Parameters<CallStructuredModel>[0] }): CallStructuredModel => async (req) => {
  if (seen !== undefined) { seen.signal = req.signal; seen.req = req; }
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  return { text, status: 'completed' };
};
const passText = () => JSON.stringify({ records: synPass() });

afterEach(() => { vi.useRealTimers(); });

describe('(f) control: with the pass absent the build is byte-identical to the main-only build', () => {
  it('no pass transport, and a pass that answers no text, register the same bytes and return the same result', async () => {
    const a = harness(); const b = harness();
    const none = await buildModelFromRecords(SCENARIO, SYN, a.dispatch, mainCall());
    const empty = await buildModelFromRecords(SCENARIO, SYN, b.dispatch, mainCall(), undefined, undefined, passCall(''));
    expect(JSON.stringify(empty)).toBe(JSON.stringify(none));
    expect(JSON.stringify(b.registered)).toBe(JSON.stringify(a.registered));
    expect(none).not.toHaveProperty('sentence_pass');
  });
  it('contrast: a pass that answers merges, carries a receipt and registers different bytes', async () => {
    const a = harness(); const b = harness();
    await buildModelFromRecords(SCENARIO, SYN, a.dispatch, mainCall());
    const withPass = await buildModelFromRecords(SCENARIO, SYN, b.dispatch, mainCall(), undefined, undefined, passCall(passText()));
    expect(withPass).toMatchObject({ ok: true, sentence_pass: { status: 'merged' } });
    expect(JSON.stringify(b.registered)).not.toBe(JSON.stringify(a.registered));
  });
  it('the pass request is its own: its schema name, prompt alias, instruction, strict schema and budget', async () => {
    const seen: { req?: Parameters<CallStructuredModel>[0] } = {};
    await buildModelFromRecords(SCENARIO, SYN, harness().dispatch, mainCall(), undefined, undefined, passCall(passText(), 0, seen));
    expect(seen.req).toMatchObject({ model: 'gpt-5.6-terra', max_output_tokens: 4000, reasoning_effort: 'low', schema_name: SENTENCE_PASS_SCHEMA_NAME,
      prompt_alias: SENTENCE_PASS_PROMPT_ALIAS, instructions: SENTENCE_PASS_INSTRUCTION });
    expect(seen.req!.schema).toEqual(buildStrictSentencePassSchema());
    expect(seen.req!.input.startsWith(`BRIEF\n${SYN}\n`)).toBe(true);
  });
});

describe('(i) parallel timing (fake timers)', () => {
  it('the main call is not delayed by the pass; a pass still running when the main call ends is abandoned with a receipt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const started: string[] = [];
    const seen: { signal?: AbortSignal } = {};
    const main: CallStructuredModel = async (req) => { started.push(`main@${Date.now()}`); return mainCall(5_000)(req); };
    const pass: CallStructuredModel = async (req) => { started.push(`pass@${Date.now()}`); return passCall(passText(), 20_000, seen)(req); };
    const t0 = Date.now();
    const build = buildModelFromRecords(SCENARIO, SYN, harness().dispatch, main, undefined, undefined, pass);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await build;
    expect(started).toEqual([`pass@${t0}`, `main@${t0}`]);
    expect(result).toMatchObject({ ok: true, sentence_pass: { status: 'sentence_pass_not_ready' } });
    expect(seen.signal?.aborted).toBe(true);
    expect(Date.now() - t0).toBe(5_000);
  });
  it('contrast: a pass that finishes before the main call is merged', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const seen: { signal?: AbortSignal } = {};
    const build = buildModelFromRecords(SCENARIO, SYN, harness().dispatch, mainCall(5_000), undefined, undefined, passCall(passText(), 3_000, seen));
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await build;
    expect(result).toMatchObject({ ok: true, sentence_pass: { status: 'merged' } });
    expect(seen.signal?.aborted).toBe(false);
  });
});

describe('(g) never-worse on the served path', () => {
  it('a merged compile that would stop carrying a main item is not served: the main compile is, with the lost index', async () => {
    vi.resetModules();
    const real = await vi.importActual<typeof import('../../../cee/draft/records/replay.js')>('../../../cee/draft/records/replay.js');
    let call = 0;
    vi.doMock('../../../cee/draft/records/replay.js', () => ({ ...real, replayRecordSet: async (...args: Parameters<typeof real.replayRecordSet>) => {
      const out = await real.replayRecordSet(...args);
      call += 1;
      if (call === 2 && out.ok) {
        // The merged compile: index 1 (a carried figure) no longer carried.
        return { ...out, projection: { ...out.projection, stated_dispositions: out.projection.stated_dispositions!.map((d) =>
          d.stated_index === 1 ? { stated_index: 1, stated_item: d.stated_item, disposition: 'rejected' as const, reason: 'carrier_removed' as const } : d) } };
      }
      return out;
    } }));
    const { buildModelFromRecords: build } = await import('../runtime/build-model-from-records.js');
    const a = harness(); const b = harness();
    const result = await build(SCENARIO, SYN, a.dispatch, mainCall(), undefined, undefined, passCall(passText()));
    expect(result).toMatchObject({ ok: true, sentence_pass: { status: 'never_worse_refused', lost: [1] } });
    vi.doUnmock('../../../cee/draft/records/replay.js');
    vi.resetModules();
    const { buildModelFromRecords: plain } = await import('../runtime/build-model-from-records.js');
    await plain(SCENARIO, SYN, b.dispatch, mainCall());
    expect(JSON.stringify(a.registered)).toBe(JSON.stringify(b.registered));
  });
});
