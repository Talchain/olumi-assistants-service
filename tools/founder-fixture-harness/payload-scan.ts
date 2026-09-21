/**
 * Reading a turn payload: which strings a user sees, and which keys make a
 * claim.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THE WIRE BLOCK DISCRIMINANT IS `type`, NOT `block_type`. TWO SHAPES, ONE
 * NAME — read the right one or every block scan reads zero.
 *
 * `src/orchestrator/types.ts` defines `TypedConversationBlock` with
 * `block_type` and a thirteen-member union including `premortem` and `fact`.
 * That is the ORCHESTRATOR-INTERNAL shape. The BOUNDARY schema
 * (`@talchain/schemas/boundary` `blocks.d.ts`, pinned 0.50.0) discriminates on
 * `type` over a DIFFERENT fourteen-member set:
 *
 *   analysis_result · coaching · comparison · draft_graph · error · evidence
 *   exercise · explanation · flip_analysis · graph_patch · held_proposal
 *   review_card · text · ui_directive
 *
 * `premortem` and `fact` are NOT wire block types. A harness that filtered on
 * `block_type` would find nothing on every real turn and report a confident,
 * perfectly clean zero — CLAUDE.md trap 16 in its purest form. The reader below
 * accepts BOTH keys so a fixture written against either shape still scans, and
 * the wire's `type` is the one that decides.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠ THE USER-VISIBLE FIELD LIST IS A SAMPLED FLOOR, NOT AN ENUMERATION.
 *
 * The block members below ARE derived — each is the prose field of a boundary
 * block schema (`text.content`, `coaching.body`/`title`,
 * `explanation.narrative`, `analysis_result.summary`, …). But "everything a
 * user sees" also depends on what the UI chooses to render, and that set lives
 * in another repo; a list of it kept here would be a hand-maintained mirror
 * (CLAUDE.md trap 12). So the scan is run TWICE and reported apart:
 *
 *   `userVisible` — a hit FAILS a criterion. These strings reach a user.
 *   `payloadWide` — every string anywhere in the body. A hit here that is NOT
 *                   also in `userVisible` is RECORDED, never failed: it may be
 *                   a diagnostic field nobody sees, or a rendered field this
 *                   floor does not know about. The harness cannot tell, and
 *                   claiming either way would be the lie.
 *
 * A reviewer reading a payload-wide-only hit is being shown precisely the thing
 * the harness could not decide. That is the point of printing it.
 */

import type { WireBody } from '../golden-journey-harness/observation.js';

/**
 * Prose members of the boundary block schemas, plus the near-miss spellings a
 * replay fixture may carry. Derived from `@talchain/schemas/boundary`
 * `blocks.d.ts` at the 0.50.0 pin — re-derive when the pin moves.
 */
export const USER_VISIBLE_BLOCK_TEXT_KEYS: readonly string[] = Object.freeze([
  'content', // text
  'body', // coaching
  'title', // coaching
  'narrative', // explanation
  'summary', // analysis_result
  'label',
  'message',
  'question',
  'answer',
  'explanation',
  'caption',
  'description',
  'rationale',
  'guidance',
  'headline',
  'prompt',
]);

/** Top-level members of `OlumiResponse` that carry prose to the user. */
export const USER_VISIBLE_TOP_LEVEL_KEYS: readonly string[] = Object.freeze([
  'assistant_text',
  'reasoning',
  'framing_question',
]);

export interface FoundString {
  /** JSON path, e.g. `blocks[2].summary`. Evidence binds by path, never by value. */
  readonly path: string;
  readonly value: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The wire discriminant, tolerating a fixture written against the internal shape. */
export function blockType(block: unknown): string | undefined {
  if (!isPlainObject(block)) return undefined;
  if (typeof block.type === 'string') return block.type;
  if (typeof block.block_type === 'string') return block.block_type;
  return undefined;
}

/** Every string in the payload, with its path. Depth-bounded and cycle-safe. */
export function collectAllStrings(body: unknown, maxDepth = 24): readonly FoundString[] {
  const out: FoundString[] = [];
  const seen = new WeakSet<object>();
  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > maxDepth) return;
    if (typeof node === 'string') {
      if (node.length > 0) out.push({ path, value: node });
      return;
    }
    if (Array.isArray(node)) {
      if (seen.has(node)) return;
      seen.add(node);
      node.forEach((child, i) => walk(child, `${path}[${i}]`, depth + 1));
      return;
    }
    if (isPlainObject(node)) {
      if (seen.has(node)) return;
      seen.add(node);
      for (const [k, v] of Object.entries(node)) {
        walk(v, path === '' ? k : `${path}.${k}`, depth + 1);
      }
    }
  };
  walk(body, '', 0);
  return out;
}

/**
 * Every object KEY in the payload, with its path AND its value.
 * The value rides along because a designating key with a null value designates
 * nothing — the boundary schema forces `analysis_result.leading_option_id` to
 * be present even when it is `null`.
 */
export function collectAllKeys(
  body: unknown,
  maxDepth = 24,
): readonly { path: string; key: string; value: unknown }[] {
  const out: { path: string; key: string; value: unknown }[] = [];
  const seen = new WeakSet<object>();
  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > maxDepth) return;
    if (Array.isArray(node)) {
      if (seen.has(node)) return;
      seen.add(node);
      node.forEach((child, i) => walk(child, `${path}[${i}]`, depth + 1));
      return;
    }
    if (isPlainObject(node)) {
      if (seen.has(node)) return;
      seen.add(node);
      for (const [k, v] of Object.entries(node)) {
        const next = path === '' ? k : `${path}.${k}`;
        out.push({ path: next, key: k, value: v });
        walk(v, next, depth + 1);
      }
    }
  };
  walk(body, '', 0);
  return out;
}

/**
 * The strings this harness is willing to say a user sees.
 * A FLOOR — see the module header, and `collectAllStrings` for what it misses.
 */
export function collectUserVisibleStrings(body: WireBody | undefined): readonly FoundString[] {
  if (body === undefined) return [];
  const out: FoundString[] = [];
  const rec = body as Record<string, unknown>;

  for (const key of USER_VISIBLE_TOP_LEVEL_KEYS) {
    const v = rec[key];
    if (typeof v === 'string' && v.length > 0) out.push({ path: key, value: v });
  }

  const insights = rec.insights;
  if (Array.isArray(insights)) {
    insights.forEach((row, i) => {
      if (isPlainObject(row) && typeof row.text === 'string' && row.text.length > 0) {
        out.push({ path: `insights[${i}].text`, value: row.text });
      }
    });
  }

  const chips = rec.suggested_actions;
  if (Array.isArray(chips)) {
    chips.forEach((chip, i) => {
      if (!isPlainObject(chip)) return;
      for (const key of ['label', 'message', 'detail'] as const) {
        const v = chip[key];
        if (typeof v === 'string' && v.length > 0) {
          out.push({ path: `suggested_actions[${i}].${key}`, value: v });
        }
      }
    });
  }

  const blocks = rec.blocks;
  if (Array.isArray(blocks)) {
    blocks.forEach((block, i) => {
      if (!isPlainObject(block)) return;
      // Wire blocks are flat (`{ type, summary, ... }`); the internal shape
      // nests under `data`. Scan both so either fixture shape is readable.
      const scopes: { prefix: string; obj: Record<string, unknown> }[] = [
        { prefix: `blocks[${i}]`, obj: block },
      ];
      if (isPlainObject(block.data)) scopes.push({ prefix: `blocks[${i}].data`, obj: block.data });

      for (const { prefix, obj } of scopes) {
        for (const key of USER_VISIBLE_BLOCK_TEXT_KEYS) {
          const v = obj[key];
          if (typeof v === 'string' && v.length > 0) out.push({ path: `${prefix}.${key}`, value: v });
        }
        // One nesting level for list-of-prose shapes (bullets, rows, sections).
        for (const [k, v] of Object.entries(obj)) {
          if (!Array.isArray(v)) continue;
          v.forEach((row, j) => {
            if (!isPlainObject(row)) return;
            for (const key of USER_VISIBLE_BLOCK_TEXT_KEYS) {
              const rv = row[key];
              if (typeof rv === 'string' && rv.length > 0) {
                out.push({ path: `${prefix}.${k}[${j}].${key}`, value: rv });
              }
            }
          });
        }
      }
    });
  }

  // De-duplicate by path (the two scopes can overlap on a hybrid fixture).
  const byPath = new Map<string, FoundString>();
  for (const f of out) if (!byPath.has(f.path)) byPath.set(f.path, f);
  return [...byPath.values()];
}

/** Blocks of one wire type, with their index. */
export function blocksOfType(
  body: WireBody | undefined,
  type: string,
): readonly { index: number; block: Record<string, unknown> }[] {
  const blocks = (body as Record<string, unknown> | undefined)?.blocks;
  if (!Array.isArray(blocks)) return [];
  const out: { index: number; block: Record<string, unknown> }[] = [];
  blocks.forEach((b, i) => {
    if (isPlainObject(b) && blockType(b) === type) out.push({ index: i, block: b });
  });
  return out;
}

/** Every block type present, in order. Printed in the report so a reader sees the shape. */
export function blockTypesPresent(body: WireBody | undefined): readonly string[] {
  const blocks = (body as Record<string, unknown> | undefined)?.blocks;
  if (!Array.isArray(blocks)) return [];
  return blocks.map((b) => blockType(b) ?? '<untyped>');
}

/** Trim for an evidence line without losing the discriminating part. */
export function excerpt(value: string, max = 220): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}
