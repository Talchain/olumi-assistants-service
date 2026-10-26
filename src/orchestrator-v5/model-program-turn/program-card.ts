/**
 * ⭐ A MODEL PROGRAM'S CARD HOLDS WHILE ITS OWN REVISION DOES (inventory F6, part a). A program card is made on one revision of the
 * model: its canonical model and the person's words, the digest a Run receipt carries (`revisionDigest`). It still applies
 * exactly while the saved program's digest is that one, and at no other time:
 *  · not on the analysis hash of the display projection, which misses moves in labels, quotes, approval and the person's
 *    words: the card was served as approvable there, and its press refused `superseded`;
 *  · not on the full graph identity, which moves with a Run stored on an unchanged model (an engine update): the card was
 *    served as approvable, and its press refused `superseded` although nothing of the person's had moved.
 * A card held before this digest was recorded carries none, and keeps the rule it was made under (`undefined` below).
 */
import { revisionDigest, type StoredRun } from './run-receipt.js';
import { livingModelOf, savedProgramOf, type SavedProgram } from './program-store.js';

/** The program's own revision: the digest of its canonical model and the person's words, as the store reads it back. */
export function programDigestOf(program: SavedProgram): string {
  // Read back through the store's own reader, so a card held from a program built in memory and one checked against the
  // saved program agree after any format migration on read.
  const read = savedProgramOf({ living_model: livingModelOf(program) }) ?? program;
  return revisionDigest(read.canonical, read.person_words);
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Whether a held card applies to the saved `graph`, by its program's revision: `undefined` when it is not a program card that
 * carries its base digest (the caller's own rule decides), otherwise whether the saved program's digest is still that base.
 */
export function programCardApplies(proposal: unknown, graph: unknown): boolean | undefined {
  if (!isRec(proposal) || typeof proposal['base_revision_digest'] !== 'string') return undefined;
  if (savedProgramOf({ living_model: proposal['living_model'] }) === undefined) return undefined;
  const saved = savedProgramOf(graph);
  return saved !== undefined && programDigestOf(saved) === proposal['base_revision_digest'];
}

/** `head` is where `runs` began: every Run saved now is one the card's program also carries, in order. */
export function runsExtend(runs: readonly StoredRun[], head: readonly StoredRun[], same: (a: StoredRun, b: StoredRun) => boolean): boolean {
  return head.length <= runs.length && head.every((r, i) => same(r, runs[i]!));
}
