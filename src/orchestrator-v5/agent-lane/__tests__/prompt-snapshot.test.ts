/**
 * PMS-BACKED IMMUTABLE PROMPT SNAPSHOT.
 *
 * The prefix cache is keyed on the prompt's (id, version). That key is only
 * sound if the pair is genuinely IMMUTABLE — if the same pair can ever name two
 * different texts, a cache hit serves text the current version does not say.
 *
 * ⛔ THE CASE THAT MAKES THIS MORE THAN BOOKKEEPING. `getActivePrompt` returns
 * `source: 'database' | 'cache' | 'fallback'`, and the fallback arm exists so
 * the product still answers when the PMS is unreachable. A fallback is
 * hardcoded text and may carry NO version at all. Treating it as a versioned
 * snapshot would cache ungoverned text under a governed key — and it would look
 * like a cache hit, not like an outage. So a fallback is admitted as a
 * DELIBERATELY UNCACHEABLE snapshot rather than refused (refusing it would take
 * the product down whenever the PMS blinked) and the request it produces is
 * marked not cacheable.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { promptSnapshotFrom, assembleRequest, issueContextPacket } from '../runtime/request-assembly.js';

const SCEN = '11111111-1111-1111-1111-111111111111';
const UID = 'user-a';
const GREV = 'a'.repeat(64);
const BSECRET = 'server-side-secret-value';
const EXPECT = { scenario_id: SCEN, authenticated_user_id: UID, graph_revision: GREV, current_turn: 7, binding_secret: BSECRET };
const FRESH = () => issueContextPacket({ scenario_id: SCEN, authenticated_user_id: UID, graph_revision: GREV, captured_at_turn: 7, state: {} }, BSECRET);

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const TEXT = 'You are Olumi. Be precise.';

const fromDb = (over = {}) => ({
  content: TEXT,
  source: 'database' as const,
  promptId: 'draft_graph_default',
  version: 202,
  contentHash: sha(TEXT),
  ...over,
});

describe('promptSnapshotFrom — a snapshot must be provably the version it claims', () => {
  it('accepts a database-sourced versioned prompt and reports it governed + cacheable', () => {
    const s = promptSnapshotFrom(fromDb());
    expect(s.governed).toBe(true);
    expect(s.cacheable).toBe(true);
    expect(s.id).toBe('draft_graph_default');
    expect(s.version).toBe(202);
    expect(s.text).toBe(TEXT);
  });

  it('⛔ a FALLBACK is admitted but is NOT cacheable — ungoverned text must never sit under a governed key', () => {
    const s = promptSnapshotFrom(fromDb({ source: 'fallback' }));
    expect(s.governed).toBe(false);
    expect(s.cacheable).toBe(false);
  });

  it('⛔ a prompt with NO version is not cacheable — there is no immutable key to cache it under', () => {
    const s = promptSnapshotFrom(fromDb({ version: undefined }));
    expect(s.cacheable).toBe(false);
  });

  it('⛔ REFUSES content that does not match the contentHash it travelled with', () => {
    expect(() => promptSnapshotFrom(fromDb({ content: 'tampered text' }))).toThrow(/integrity/i);
  });

  it('a cache-sourced prompt is still governed — cache is a transport, not a provenance downgrade', () => {
    const s = promptSnapshotFrom(fromDb({ source: 'cache' }));
    expect(s.governed).toBe(true);
    expect(s.cacheable).toBe(true);
  });

  it('IMMUTABILITY: the same (id, version, text) always yields the same prefix hash', () => {
    const a = promptSnapshotFrom(fromDb());
    const b = promptSnapshotFrom(fromDb({ source: 'cache' }));
    const base = { mode: 'full' as const, context: FRESH(), expectation: EXPECT, history: [] };
    expect(assembleRequest({ ...base, promptSnapshot: b }).hashes.prompt)
      .toBe(assembleRequest({ ...base, promptSnapshot: a }).hashes.prompt);
  });

  it('a request built on an UNCACHEABLE snapshot says so in its diagnostics', () => {
    const s = promptSnapshotFrom(fromDb({ source: 'fallback' }));
    const r = assembleRequest({ promptSnapshot: s, mode: 'full', context: FRESH(), expectation: EXPECT, history: [] });
    expect(r.diagnostics.prefix_cacheable).toBe(false);
    expect(r.diagnostics.prompt_governed).toBe(false);
  });

  it('a governed request reports itself cacheable', () => {
    const r = assembleRequest({
      promptSnapshot: promptSnapshotFrom(fromDb()),
      mode: 'full', context: FRESH(), expectation: EXPECT, history: [],
    });
    expect(r.diagnostics.prefix_cacheable).toBe(true);
  });

  it('the snapshot is frozen — a caller cannot mutate it after the hash was taken', () => {
    const s = promptSnapshotFrom(fromDb());
    expect(Object.isFrozen(s)).toBe(true);
  });
});
