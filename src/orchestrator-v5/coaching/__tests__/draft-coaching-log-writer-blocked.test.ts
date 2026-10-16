/**
 * P5 (2026-07-27) — the draft-coaching sidecar WRITER stays unwired.
 *
 * `appendDraftCoaching` has zero production callers; its READ end was
 * retired together with ContextPack assembly's cache reader by C1. If a
 * writer is reintroduced, pre-analysis coaching — produced by a prompt with no
 * output-quality eval, on a turn where nothing has been computed — begins
 * flowing into POST-analysis prompts as apparent prior state.
 *
 * The audit's instruction was "row it as a blocked dependency, not a TODO". A
 * comment is a TODO. This is the gate: it DERIVES the caller set from the
 * source tree, so it cannot go stale the way a hand-maintained note would
 * (CLAUDE.md trap 12), and it goes RED the moment somebody wires the writer —
 * making that a deliberate act that must also delete this pin.
 *
 * MUTATION MAP:
 *  - M7  add a call to `appendDraftCoaching` from any non-test file under src/
 *        → "the sidecar writer has no production caller" RED
 *        (guarded by the positive control below, which proves the scanner CAN
 *        see a call — an absence assertion that cannot see a presence is
 *        vacuous, CLAUDE.md trap 13.)
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';

const SRC = resolve(process.cwd(), 'src');
const WRITER = 'appendDraftCoaching';
const mentionsWriter = (source: string) => source.includes(WRITER);
/** The definition site — a declaration is not a call. */
const DEFINITION = join('orchestrator-v5', 'coaching', 'draft-coaching-log.ts');

/** Every .ts file under src/, excluding test directories. */
function productionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === '__mocks__') continue;
      productionFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Files that mention the writer, other than the file that defines it. */
function callerManifest(): string[] {
  return productionFiles(SRC).filter(
    (f) => !f.endsWith(DEFINITION) && mentionsWriter(readFileSync(f, 'utf8')),
  );
}

describe('P5 — the draft-coaching sidecar writer stays unwired (M7)', () => {
  it('the scanner CAN see a call (positive control — the pin is not vacuous)', () => {
    // Prove the detector discriminates before trusting it to assert an absence.
    const files = productionFiles(SRC);
    expect(files.length).toBeGreaterThan(100);
    // C1 deleted the writer and reader; a planted call still exercises the scanner's exact predicate.
    expect(mentionsWriter('appendDraftCoaching(input)')).toBe(true);
    expect(mentionsWriter('readGraph(input)')).toBe(false);
  });

  it('the sidecar writer has no production caller', () => {
    const callers = callerManifest();
    expect(
      callers,
      `appendDraftCoaching has gained a production caller: ${callers
        .map((f) => f.split(`src${sep}`)[1])
        .join(', ')}. ` +
        `Wiring the writer replays UNEVALUATED pre-analysis coaching into post-analysis ` +
        `prompts as apparent prior state if its retired reader is also restored in ContextPack ` +
        `assembly. Land the coaching eval checks on the replayed surface first, then ` +
        `delete this pin deliberately.`,
    ).toEqual([]);
  });

  it('the retired READ end has no production consumer either', () => {
    // C1 deleted coaching-cache-reader: pin the complete remaining reader population at zero.
    expect(productionFiles(SRC).filter(file => readFileSync(file, 'utf8').includes('readLatestDraftCoaching'))).toEqual([]);
  });
});
