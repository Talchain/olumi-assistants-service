/**
 * ROADMAP 2.1242 — a prompt row read back from Postgres must parse.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * `z.string().datetime()` with no arguments is NOT "is this an ISO-8601
 * timestamp?". Zod's bare form accepts only a `Z` suffix and REJECTS an explicit
 * numeric offset. Postgres/PostgREST renders a `timestamptz` with an explicit
 * offset (`+00:00`), so every prompt row read back through the Supabase store
 * threw at the governed boundary's `PromptDefinitionSchema.parse()` — surfacing
 * as `prompt.seed.error` on boot, after which the service served bundled
 * defaults.
 *
 * ── THE FIXTURES COME FROM THE PRODUCER, NOT FROM THIS FILE'S AUTHOR ───────
 * Every accepted case below is a rendering a real store emits: PostgREST's
 * microsecond `+00:00` form, the `pg` driver's `toISOString()` form (which the
 * Postgres store already hand-normalises to), and the `Z` form the in-memory
 * and file stores write. A corpus assembled from what the schema "ought" to
 * accept would have been written with the same blind spot as the schema.
 *
 * ── AND THE REJECTIONS ARE THE OTHER HALF ──────────────────────────────────
 * A widening is only correct if it is a widening. `z.string()` alone would pass
 * every accept case here and is plainly wrong; the reject cases are what
 * separates the fix from that.
 */

import { describe, it, expect } from 'vitest';
import {
  CompiledPromptSchema,
  PromptDefinitionSchema,
  PromptVersionSchema,
} from '../../src/prompts/schema.js';

/** PostgREST's rendering of `timestamptz` — the form that was being rejected. */
const POSTGREST = '2026-08-16T10:00:00.123456+00:00';
/** What the `pg` driver's Date → `toISOString()` produces (Postgres store). */
const PG_DRIVER = '2026-08-16T10:00:00.123Z';
/** A non-UTC deployment's rendering; still valid ISO-8601 with an offset. */
const POSTGREST_OFFSET = '2026-08-16T11:00:00.123456+01:00';

function versionRow(createdAt: string, approvedAt?: string) {
  return {
    version: 1,
    content: 'You are a decision-modelling assistant. Draft a graph from the brief.',
    variables: [],
    createdBy: 'system',
    createdAt,
    contentHash: 'a'.repeat(64),
    requiresApproval: false,
    ...(approvedAt !== undefined ? { approvedAt } : {}),
    testCases: [],
  };
}

function promptRow(timestamp: string) {
  return {
    id: 'draft_graph_default',
    name: 'Draft Graph',
    taskId: 'draft_graph',
    status: 'production',
    versions: [versionRow(timestamp, timestamp)],
    activeVersion: 1,
    modelConfig: undefined,
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('ROADMAP 2.1242 — prompt schemas accept every store\'s timestamp rendering', () => {
  it('accepts a PostgREST-rendered timestamptz (the form that was throwing on boot)', () => {
    const parsed = PromptDefinitionSchema.safeParse(promptRow(POSTGREST));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('accepts a non-UTC offset', () => {
    expect(PromptDefinitionSchema.safeParse(promptRow(POSTGREST_OFFSET)).success).toBe(true);
  });

  it('still accepts the `Z` form the pg-driver and in-memory stores produce', () => {
    // The widening must not trade one store for another.
    expect(PromptDefinitionSchema.safeParse(promptRow(PG_DRIVER)).success).toBe(true);
  });

  it('covers the version-level timestamps too, not just the prompt-level ones', () => {
    // `createdAt` and `approvedAt` on a VERSION are separate fields on a
    // separate schema, populated from the same columns. A fix applied to the
    // outer object only would pass the tests above and still throw on any row
    // carrying an approval.
    const parsed = PromptVersionSchema.safeParse(versionRow(POSTGREST, POSTGREST));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('covers the compiled-prompt boundary, which parses through the same governed detach', () => {
    const parsed = CompiledPromptSchema.safeParse({
      promptId: 'draft_graph_default',
      version: 1,
      content: 'compiled body',
      compiledAt: POSTGREST,
      modelConfig: undefined,
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  describe('it is a widening, not a weakening', () => {
    it.each([
      ['not a timestamp at all', 'not-a-date'],
      ['empty', ''],
      ['space-separated (psql console rendering, never on the wire)', '2026-08-16 10:00:00+00'],
      ['date only', '2026-08-16'],
      ['a number', 1_755_338_400_000 as unknown as string],
    ])('still rejects %s', (_label, value) => {
      expect(PromptDefinitionSchema.safeParse(promptRow(value)).success).toBe(false);
    });
  });
});
