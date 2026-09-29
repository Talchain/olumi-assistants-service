/**
 * PROMOTION GATE — pack discovery (DERIVE, don't mirror; trap 12).
 *
 * The GATED SET is "which tasks have an eval pack", and it MUST be derived from
 * what is on disk, never hand-listed — a hand-list would drift the moment a pack
 * lands without an editor remembering to add its row, which reads as green
 * (drift = a prompt silently escaping the gate).
 *
 * A pack advertises itself by placing a `promotion-pack.ts` marker in its
 * directory that default-exports a {@link PackDescriptor}. Discovery scans the
 * pack roots for those markers and imports them. Adding H3's edit_graph pack =
 * dropping in its marker; it falls under the gate automatically, with no edit
 * here. Removing the last marker is a hard error (a gate with zero packs passes
 * by measuring nothing — trap 13, one level above the scorer).
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PackDescriptor } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The directory whose immediate subdirectories may each carry a pack marker. */
export const DEFAULT_PACK_SEARCH_ROOT = join(HERE, '..');

/** The marker filename discovery keys on. EXPORTED so the shrink guard's
 * git-side path constant can be cross-asserted against it rather than
 * hand-mirroring it (trap 12). */
export const MARKER = 'promotion-pack.ts';

function isPackDescriptor(v: unknown): v is PackDescriptor {
  if (v === null || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.task === 'string' &&
    typeof d.canonicalPromptPath === 'string' &&
    typeof d.packDir === 'string'
  );
}

/**
 * Discover every pack under `searchRoot`. Async because it dynamic-imports the
 * marker modules (which is how a pack self-declares rather than being listed).
 *
 * FAIL-LOUD: zero packs discovered throws; a marker that does not export a valid
 * descriptor throws (naming the file). A marker silently skipped would let a
 * task drop out of the gated set unnoticed.
 */
export async function discoverPacks(
  searchRoot: string = DEFAULT_PACK_SEARCH_ROOT,
): Promise<PackDescriptor[]> {
  if (!existsSync(searchRoot)) {
    throw new Error(`promotion-gate: pack search root does not exist: ${searchRoot}`);
  }
  const packs: PackDescriptor[] = [];
  const seenTasks = new Set<string>();
  for (const name of readdirSync(searchRoot).sort()) {
    const dir = join(searchRoot, name);
    if (!statSync(dir).isDirectory()) continue;
    const marker = join(dir, MARKER);
    if (!existsSync(marker)) continue;
    const mod = (await import(pathToFileURL(marker).href)) as {
      default?: unknown;
      PROMOTION_PACK?: unknown;
    };
    const candidate = mod.PROMOTION_PACK ?? mod.default;
    if (!isPackDescriptor(candidate)) {
      throw new Error(
        `promotion-gate: ${marker} does not export a valid PackDescriptor ` +
          '(need `export const PROMOTION_PACK: PackDescriptor`). Refusing to skip a marker silently.',
      );
    }
    if (seenTasks.has(candidate.task)) {
      throw new Error(
        `promotion-gate: two packs both declare task "${candidate.task}" — a task must have exactly one pack.`,
      );
    }
    seenTasks.add(candidate.task);
    packs.push(candidate);
  }
  if (packs.length === 0) {
    throw new Error(
      `promotion-gate: discovered ZERO packs under ${searchRoot}. Refusing to run a gate with an ` +
        'empty gated set — it would pass by measuring nothing. Every pack self-declares via a ' +
        `${MARKER} marker; if you expected a pack here, its marker is missing.`,
    );
  }
  return packs;
}
