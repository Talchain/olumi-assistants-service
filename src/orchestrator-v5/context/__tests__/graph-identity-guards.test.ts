/**
 * Group A — writer / lineage static guards.
 *
 * These are PINS, not resolutions. They freeze three contract invariants so a
 * later change trips a review rather than silently regressing:
 *
 *   1. `store_draft_graph` (the dormant durable writer) has ZERO production
 *      call sites in TS — it stays test/out-of-band only until the A4 plan is
 *      approved. (The A4 SQL fail-closed fix is separate; this guards the TS
 *      surface.)
 *   2. The new `graph-identity` module does not import the V4 patch/apply
 *      lineage (`GraphPatchBlock`, `orchestrator/types`) — no V4 shape may leak
 *      into the canonical identity path (contract §3.12, §4).
 *   3. The new `graph-identity` module does not depend on `graph-management/`
 *      (#341) — Group A is the foundation #341 consumes, never the reverse.
 *
 * Mirrors the repo's existing source-scan guard pattern
 * (context-summary-diagnostic-only.guard.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const SRC_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const IDENTITY_MODULE = fileURLToPath(new URL('../graph-identity.ts', import.meta.url));

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'generated') continue;
      walkTsFiles(full, out);
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test.ts') &&
      !/ \d+\.[cm]?tsx?$/.test(entry)
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('store_draft_graph has zero production call sites (A4 pin)', () => {
  it('no product src file invokes `.storeDraftGraph(`', () => {
    const files = walkTsFiles(SRC_ROOT);
    const callers: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      // A CALL is `.storeDraftGraph(` (method invocation). The interface
      // declaration (`storeDraftGraph(`) and the impl (`async storeDraftGraph(`)
      // have no leading dot, so they are correctly excluded.
      if (/\.storeDraftGraph\s*\(/.test(text)) {
        callers.push(relative(SRC_ROOT, file));
      }
    }
    expect(callers).toEqual([]);
  });
});

describe('graph-identity module lineage (contract §3.12 / #341 boundary)', () => {
  const source = readFileSync(IDENTITY_MODULE, 'utf8');
  const importLines = source
    .split('\n')
    .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+['"]/.test(l));

  it('does not import the V4 patch/apply lineage', () => {
    const offenders = importLines.filter(
      (l) => /GraphPatchBlock/.test(l) || /orchestrator\/types(\.js)?['"]/.test(l),
    );
    expect(offenders).toEqual([]);
  });

  it('does not import graph-management (#341)', () => {
    const offenders = importLines.filter((l) => /graph-management/.test(l));
    expect(offenders).toEqual([]);
  });
});
