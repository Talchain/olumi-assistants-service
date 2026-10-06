/**
 * The drafter-raw record's pure half, its store adapter's outcome classification, and the migration it needs.
 * The served-route behaviour (one record per draft, byte-identity, no windowed write, the draft never pays for the
 * record) is `agent-lane/__tests__/drafter-raw-record.route.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DRAFTER_RAW_MAX_BYTES, DRAFTER_RAW_TABLE, capRawResponse, drafterRawRow, recordingDrafter, type DrafterCallRecord,
} from '../record.js';
import { SupabaseDrafterRawStore, persistDrafterRawRow, settleDrafterRawWritesForTests, type DrafterRawStorePort } from '../index.js';
import type { SupabaseClient } from '@supabase/supabase-js';

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const MARKER = /\n\[\[olumi:drafter_raw_truncated original_bytes=(\d+) kept_bytes=(\d+)\]\]$/;

describe('capRawResponse — 200 KiB of UTF-8, marker included', () => {
  it('under the cap: the SAME string, untouched', () => {
    const t = '{"a": 1}\n';
    const r = capRawResponse(t);
    expect(r.text === t).toBe(true);
    expect(r).toMatchObject({ bytes: Buffer.byteLength(t), truncated: false });
  });

  it('exactly at the cap: untouched (the boundary is inclusive)', () => {
    const t = 'x'.repeat(DRAFTER_RAW_MAX_BYTES);
    expect(capRawResponse(t)).toMatchObject({ text: t, truncated: false });
    expect(capRawResponse(`${t}y`).truncated, 'control: one byte over is cut').toBe(true);
  });

  it('over the cap: ≤ cap bytes in total, a prefix of the original, ending with the marker that states both counts', () => {
    const t = 'z'.repeat(300 * 1024);
    const r = capRawResponse(t);
    expect(r.truncated).toBe(true);
    expect(r.bytes).toBe(300 * 1024);
    expect(Buffer.byteLength(r.text, 'utf8')).toBeLessThanOrEqual(DRAFTER_RAW_MAX_BYTES);
    const m = MARKER.exec(r.text);
    expect(m, 'ends with the marker').not.toBeNull();
    const kept = r.text.slice(0, m!.index);
    expect(Number(m![1])).toBe(300 * 1024);
    expect(Number(m![2])).toBe(Buffer.byteLength(kept, 'utf8'));
    expect(t.startsWith(kept)).toBe(true);
  });

  it.each([['£ (2 bytes)', '£'], ['€ (3 bytes)', '€'], ['😀 (4 bytes)', '😀']])('never cuts inside a character: %s', (_l, ch) => {
    const t = ch.repeat(Math.ceil((DRAFTER_RAW_MAX_BYTES * 1.5) / Buffer.byteLength(ch)));
    const r = capRawResponse(t);
    const kept = r.text.slice(0, MARKER.exec(r.text)!.index);
    expect(kept.includes('�'), 'no replacement character').toBe(false);
    expect(t.startsWith(kept)).toBe(true);
    expect(Buffer.byteLength(r.text, 'utf8')).toBeLessThanOrEqual(DRAFTER_RAW_MAX_BYTES);
  });
});

describe('recordingDrafter — transparent, and keeps what the call returned', () => {
  const req = { model: 'm-1', instructions: 'INSTR', input: 'the brief', max_output_tokens: 99, schema: { type: 'object' }, reasoning_effort: 'medium' as const };

  it('returns the inner result unchanged and records its text byte-identically, with the request identity', async () => {
    const calls: DrafterCallRecord[] = [];
    const out = { text: '{\n  "goal": "£ — ok"\n}\n', status: 'completed', usage: { output_tokens: 3 } };
    const got = await recordingDrafter(async () => out, calls)(req);
    expect(got).toBe(out);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.raw_text === out.text).toBe(true);
    expect(calls[0]).toMatchObject({
      seq: 0, role: 'first', model: 'm-1', prompt_alias: 'agent.construct', prompt_sha256: sha('INSTR'),
      schema_sha256: sha(JSON.stringify({ type: 'object' })), input_sha256: sha('the brief'), reasoning_effort: 'medium',
      max_output_tokens: 99, status: 'completed', usage: { output_tokens: 3 }, threw: false, raw_truncated: false,
    });
    expect(JSON.stringify(calls[0]).includes('the brief'), 'the input itself is not kept').toBe(false);
  });

  it('a throwing call is rethrown unchanged and recorded as threw — its message (which may echo a key) is not kept', async () => {
    const calls: DrafterCallRecord[] = [];
    const err = new Error('openai_401: Incorrect API key provided: sk-proj-****1234');
    await expect(recordingDrafter(async () => { throw err; }, calls)(req)).rejects.toBe(err);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ threw: true, raw_text: '', raw_bytes: 0 });
    expect(JSON.stringify(calls)).not.toMatch(/sk-proj|Incorrect API key/);
  });

  it('the second call is the retry', async () => {
    const calls: DrafterCallRecord[] = [];
    const d = recordingDrafter(async (r) => ({ text: r.input }), calls);
    await d(req); await d({ ...req, input: 'retry input' });
    expect(calls.map((c) => c.role)).toEqual(['first', 'retry']);
    expect(calls[1]!.raw_text).toBe('retry input');
  });
});

describe('drafterRawRow — what the draft became', () => {
  const base = {
    scenarioId: 's', operationId: 'o', requestId: 'r', brief: 'B', calls: [], ceeBuild: 'c', environment: 'test',
    environmentSource: 'x', renderService: null,
  };
  it.each([
    [{ ok: true, mutated: true, model_version: { version_id: '00000000-0000-4000-8000-000000000001' } }, 'registered', null, '00000000-0000-4000-8000-000000000001'],
    [{ ok: true, mutated: false, replayed: true }, 'replayed', null, null],
    [{ ok: false, mutated: false, refusal: 'model_too_large' }, 'refused', 'model_too_large', null],
    [undefined, 'threw', null, null],
    [{ ok: true, mutated: true, model_version: { version_id: 'not-a-uuid' } }, 'registered', null, null],
  ] as const)('%j → %s', (built, outcome, refusal, versionId) => {
    const row = drafterRawRow({ ...base, built: built as never });
    expect(row).toMatchObject({ outcome, refusal, model_version_id: versionId, brief_sha256: sha('B'), brief_chars: 1 });
    expect(JSON.stringify(row).includes('"B"'), 'the brief itself is not kept').toBe(false);
  });
});

describe('SupabaseDrafterRawStore — writes ONE table and classifies the answer', () => {
  const client = (error: unknown, seen: string[]) => ({
    from: (t: string) => { seen.push(t); return { insert: () => ({ abortSignal: async () => ({ error }) }) }; },
  }) as unknown as SupabaseClient;
  const row = drafterRawRow({ scenarioId: 's', operationId: 'o', requestId: 'r', brief: 'B', built: undefined, calls: [], ceeBuild: 'c', environment: 'e', environmentSource: 'x', renderService: null });

  it.each([
    [null, 'written'],
    [{ code: 'PGRST205', message: "Could not find the table 'public.cee_drafter_raw_responses' in the schema cache" }, 'table_absent'],
    [{ code: '42P01', message: 'relation "public.cee_drafter_raw_responses" does not exist' }, 'table_absent'],
    [{ code: '23503', message: 'violates foreign key constraint' }, 'failed'],
  ] as const)('%j → %s, on the dedicated table', async (error, outcome) => {
    const seen: string[] = [];
    expect(await new SupabaseDrafterRawStore(client(error, seen)).insert(row)).toBe(outcome);
    expect(seen).toEqual([DRAFTER_RAW_TABLE]);
  });

  it('persist never rejects: a store that throws is logged and skipped', async () => {
    const store: DrafterRawStorePort = { insert: async () => { throw new Error('down'); } };
    expect(() => persistDrafterRawRow(row, store)).not.toThrow();
    await expect(settleDrafterRawWritesForTests()).resolves.toBeUndefined();
  });
});

describe('the migration, and that NO reader exists (a window cannot count what nothing reads)', () => {
  const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
  const MIG = join(ROOT, 'supabase/migrations/20261006114000_cee_drafter_raw_responses.sql');
  const RB = join(ROOT, 'supabase/migrations/rollback/20261006114000_cee_drafter_raw_responses_rollback.sql.do-not-apply');
  const code = (sql: string) => sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

  it('creates exactly the table the code writes, RLS on + forced, every JWT grant revoked; touches nothing else', () => {
    const sql = code(readFileSync(MIG, 'utf8'));
    expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${DRAFTER_RAW_TABLE} \\(`));
    expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${DRAFTER_RAW_TABLE} ENABLE ROW LEVEL SECURITY;`));
    expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${DRAFTER_RAW_TABLE} FORCE ROW LEVEL SECURITY;`));
    expect(sql).toMatch(new RegExp(`REVOKE ALL ON public\\.${DRAFTER_RAW_TABLE} FROM PUBLIC, anon, authenticated;`));
    const altered = [...sql.matchAll(/ALTER TABLE (?:public\.)?([a-z0-9_]+)/gi)].map((m) => m[1]);
    expect(new Set(altered), 'no existing table is altered').toEqual(new Set([DRAFTER_RAW_TABLE]));
    expect(sql).not.toMatch(/CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER|CREATE POLICY|GRANT [A-Z, ]+ TO (anon|authenticated)/i);
  });

  it('every column the code writes exists in the migration (a missing column would refuse every insert)', () => {
    const sql = code(readFileSync(MIG, 'utf8'));
    const row = drafterRawRow({ scenarioId: 's', operationId: 'o', requestId: 'r', brief: 'B', built: undefined, calls: [], ceeBuild: 'c', environment: 'e', environmentSource: 'x', renderService: null });
    for (const col of Object.keys(row)) expect(sql, col).toMatch(new RegExp(`^\\s+${col}\\s+[A-Z]`, 'm'));
  });

  it('the rollback exists, is never picked up by a runner, and drops only this table', () => {
    expect(existsSync(RB)).toBe(true);
    const sql = code(readFileSync(RB, 'utf8'));
    expect([...sql.matchAll(/DROP TABLE IF EXISTS (?:public\.)?([a-z0-9_]+)/g)].map((m) => m[1])).toEqual([DRAFTER_RAW_TABLE]);
    expect(sql).not.toMatch(/ALTER|DELETE FROM|TRUNCATE/i);
  });

  it('no production file other than the writer names the table — and the probe sees the windowed tables (contrast)', () => {
    const SRC = join(ROOT, 'src');
    const files: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d)) { const f = join(d, e); if (statSync(f).isDirectory()) { if (e !== '__tests__') walk(f); } else if (e.endsWith('.ts') && !e.endsWith('.test.ts')) files.push(f); } };
    walk(SRC);
    // Code only: a comment that DESCRIBES the table is not a reader of it.
    const codeOf = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const naming = (name: string) => files.filter((f) => codeOf(f).includes(name)).map((f) => relative(SRC, f)).sort();
    expect(files.length, 'control: the corpus is the whole service').toBeGreaterThan(1000);
    expect(naming(DRAFTER_RAW_TABLE)).toEqual(['orchestrator-v5/drafter-raw/record.ts']);
    expect(naming('v5_handler_facts').length, 'contrast: a windowed table IS named by its readers').toBeGreaterThan(0);
  });
});
