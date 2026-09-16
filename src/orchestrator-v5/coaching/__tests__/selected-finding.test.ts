/**
 * ⭐⭐⭐ THE FINDING THE USER CLICKED — controls.
 *
 * The premise of this whole component is that `block_id` is RE-DERIVABLE:
 * `uuidv5("{prefix}:{key}:{graph_hash}")` under a frozen namespace. S1 proves
 * that against PRODUCTION BYTES rather than against ids this repo minted for
 * itself — the corpus is an append-only record of blocks CEE really emitted on
 * a real user session (16 Sep 2026, request 1dd2133d).
 *
 * ⚠ THE CORPUS IS COMMITTED, NOT READ FROM ~/Downloads. A spec in this estate
 * once read a capture from an absolute home path and failed an entire CI shard
 * with ENOENT before collecting a single test. Keep the real bytes; commit them.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { V5_PHASE3_BLOCK_ID_NAMESPACE, deterministicBlockId } from '../../compose/block-id.js';
import {
  buildSelectedFindingContextBlock,
  type SelectedFindingContext,
} from '../../routing/route-with-tool-use.js';
import { readSelectedFindingBlockId, resolveSelectedFinding } from '../selected-finding.js';

const CORPUS = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', 'live-phase3-blocks-1dd2133d-20260916.json'),
    'utf8',
  ),
) as {
  graph_hash_at_run: string;
  namespace: string;
  blocks: Array<{
    block_id: string;
    signal_id: string;
    type: string;
    coaching_kind?: string;
    title?: string;
    body?: string;
  }>;
};

// ── S1 — the derivation, against production bytes ───────────────────────────

describe('S1 — production block ids re-derive exactly', () => {
  it('S1a PRECONDITION: the corpus is real and non-trivial', () => {
    expect(CORPUS.blocks.length, 'a real session emitted these').toBeGreaterThan(5);
    expect(CORPUS.graph_hash_at_run).toBe('f45e54f21f8c3a66');
  });

  it('S1b every captured block_id is uuidv5 of its captured signal_id', () => {
    for (const block of CORPUS.blocks) {
      expect(
        deterministicBlockId(block.signal_id),
        `${block.signal_id} must derive ${block.block_id}`,
      ).toBe(block.block_id);
    }
  });

  it('S1c CONTRAST: a MOVED graph hash derives a DIFFERENT id — so a stale selection cannot match', () => {
    for (const block of CORPUS.blocks.slice(0, 3)) {
      const moved = block.signal_id.replace(CORPUS.graph_hash_at_run, '0000000000000000');
      expect(moved, 'the hash really was substituted').not.toBe(block.signal_id);
      expect(deterministicBlockId(moved)).not.toBe(block.block_id);
    }
  });

  it('S1d CONTRAST: the namespace is load-bearing, so the derivation is not hash-of-name alone', () => {
    const sha1OfNameOnly = createHash('sha1').update(CORPUS.blocks[0]!.signal_id).digest('hex');
    expect(CORPUS.blocks[0]!.block_id.replace(/-/g, '')).not.toBe(sha1OfNameOnly.slice(0, 32));
    expect(V5_PHASE3_BLOCK_ID_NAMESPACE).toBe(CORPUS.namespace);
  });
});

// ── S2 — reading the id off the payload ─────────────────────────────────────

const chipPayload = (chip: unknown, source = 'chip_click') =>
  ({ source, chip }) as Parameters<typeof readSelectedFindingBlockId>[0];

describe('S2 — the id is read from ONE key, with no fallback', () => {
  const real = CORPUS.blocks[0]!.block_id;

  it('S2a reads parameters.block_id on a chip_click turn', () => {
    expect(readSelectedFindingBlockId(chipPayload({ parameters: { block_id: real } }))).toBe(real);
  });

  it('S2b reads it on a chip turn too', () => {
    expect(
      readSelectedFindingBlockId(chipPayload({ parameters: { block_id: real } }, 'chip')),
    ).toBe(real);
  });

  it('S2c NEGATIVE — a composer turn is ignored even if it carries the bag', () => {
    expect(
      readSelectedFindingBlockId(chipPayload({ parameters: { block_id: real } }, 'composer')),
    ).toBeUndefined();
  });

  it('S2d NEGATIVE — chip.id is NOT a fallback, because it would resolve the WRONG finding', () => {
    // The UI chain prefers entry.id when minting the item id, so a "helpful"
    // fallback here answers confidently about something the user did not click.
    expect(
      readSelectedFindingBlockId(chipPayload({ id: `strengthen:phase3:${real}` })),
    ).toBeUndefined();
  });

  it('S2e NEGATIVE — no other parameter key is consulted', () => {
    for (const key of ['id', 'signal_id', 'entry_id', 'blockId', 'index']) {
      expect(
        readSelectedFindingBlockId(chipPayload({ parameters: { [key]: real } })),
        `${key} must not be read`,
      ).toBeUndefined();
    }
  });

  it('S2f NEGATIVE — an empty or non-string block_id is not a selection', () => {
    for (const bad of ['', 42, null, undefined, {}, []]) {
      expect(readSelectedFindingBlockId(chipPayload({ parameters: { block_id: bad } }))).toBeUndefined();
    }
  });

  it('S2g the UI\'s SYNTHETIC POSITIONAL id is read but cannot resolve — hazard (b)', () => {
    // It is a string, so it is read; it is not a block id, so it misses. That
    // is the correct landing place for it: the unresolved path, never a match.
    const synthetic = 'strengthen:phase3_blocks[0]';
    expect(readSelectedFindingBlockId(chipPayload({ parameters: { block_id: synthetic } }))).toBe(
      synthetic,
    );
    expect(CORPUS.blocks.some((b) => b.block_id === synthetic)).toBe(false);
  });
});

// ── S3 — the guard paths, which need no rebuilt blocks ──────────────────────

const FACT = (graphHash: unknown) =>
  ({ fact_type: 'run_analysis', result: { graph_hash_at_run: graphHash } }) as never;

describe('S3 — unresolved reasons stay DISTINCT, never collapsed', () => {
  const blockId = CORPUS.blocks[0]!.block_id;

  it('S3a no fact at all → could_not_check, NOT not_in_model', () => {
    const r = resolveSelectedFinding({
      blockId, fact: null, freshness: 'fresh', persistedGraph: null,
    });
    expect(r.status).toBe('unresolved');
    expect(r.status === 'unresolved' && r.reason).toBe('could_not_check');
  });

  it('S3b a legacy fact with no graph hash → could_not_check', () => {
    const r = resolveSelectedFinding({
      blockId, fact: FACT(undefined), freshness: 'fresh', persistedGraph: null,
    });
    expect(r.status === 'unresolved' && r.reason).toBe('could_not_check');
  });

  it.each(['stale', 'unknown', 'none', undefined] as const)(
    'S3c freshness %s → graph_moved, its OWN reason',
    (freshness) => {
      const r = resolveSelectedFinding({
        blockId, fact: FACT(CORPUS.graph_hash_at_run), freshness, persistedGraph: null,
      });
      expect(r.status === 'unresolved' && r.reason).toBe('graph_moved');
    },
  );

  it('S3d ⭐ THE REASONS MUST NOT COLLAPSE — each is a different remedy', () => {
    // "I could not read the model" and "that is not in the model" are opposite
    // claims. Collapsing them lets an instrument failure be reported to the user
    // as a fact about their model.
    const couldNotCheck = resolveSelectedFinding({
      blockId, fact: null, freshness: 'fresh', persistedGraph: null,
    });
    const graphMoved = resolveSelectedFinding({
      blockId, fact: FACT(CORPUS.graph_hash_at_run), freshness: 'stale', persistedGraph: null,
    });
    expect(couldNotCheck.status === 'unresolved' && couldNotCheck.reason).not.toBe(
      graphMoved.status === 'unresolved' ? graphMoved.reason : null,
    );
  });

  it('S3e nothing is FABRICATED on any unresolved path', () => {
    for (const args of [
      { fact: null, freshness: 'fresh' as const },
      { fact: FACT(undefined), freshness: 'fresh' as const },
      { fact: FACT(CORPUS.graph_hash_at_run), freshness: 'stale' as const },
    ]) {
      const r = resolveSelectedFinding({ blockId, persistedGraph: null, ...args });
      expect(r.status).toBe('unresolved');
      expect('finding' in r, 'an unresolved result carries no finding').toBe(false);
    }
  });
});

// ── S4 — authorship: the finding is context, never the user's claim ─────────

describe('S4 — the rendered block never attributes the finding to the user', () => {
  const realBlock = CORPUS.blocks.find((b) => (b.body ?? '').includes('£200,000')) ?? CORPUS.blocks[1]!;
  const finding: SelectedFindingContext = {
    block_id: realBlock.block_id,
    block_type: realBlock.type,
    ...(realBlock.coaching_kind === undefined ? {} : { coaching_kind: realBlock.coaching_kind }),
    title: realBlock.title ?? null,
    body: realBlock.body ?? null,
  };
  const rendered = buildSelectedFindingContextBlock(finding);

  it('S4a PRECONDITION: this is real captured product text, not invented', () => {
    expect(realBlock.body ?? '', 'the corpus body is substantive').not.toHaveLength(0);
  });

  it('S4b the producer\'s own words reach the prompt', () => {
    expect(rendered).toContain(realBlock.body);
  });

  it('S4c it is stated to be OLUMI\'s earlier output, not the user\'s', () => {
    expect(rendered).toContain("Olumi's own earlier finding");
    expect(rendered).toMatch(/NOT the user's claim/);
  });

  it('S4d it forbids quoting the finding back as something the user said', () => {
    expect(rendered).toMatch(/never quote it back as something they said/);
  });

  it('S4e ⭐ it forbids treating a selection as licence to change the model', () => {
    // The same ruling FOCUS_INSTRUCTION already makes for canvas selections:
    // pointing at something is a request to DISCUSS it.
    expect(rendered).toMatch(/not an instruction to change the model/);
  });

  it('S4f it is its own section — it does NOT masquerade as the user turn', () => {
    expect(rendered.startsWith('## Selected finding')).toBe(true);
    expect(rendered).not.toContain('## User turn');
  });
});
