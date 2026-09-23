/**
 * ⭐⭐ WIRE REPLAY — the fix, against the ACTUAL captured staging responses.
 *
 * The sibling spec proves the predicate on constructed graphs. This one answers the
 * only question a reviewer should care about: **does it resolve the measured
 * failure?** The three fixtures are real `POST /assist/v1/draft-graph?schema=v3`
 * responses from deployed staging, captured 23 Sep — not fixtures written by me.
 * The corpus therefore comes from outside the author's head.
 *
 * The v4 intervention input is RECONSTRUCTED from each captured option as
 * `matched interventions ∪ unresolved_targets`, which is exactly the id set the
 * extractor was handed before it classified them. That reconstruction is checked
 * against the capture's own counts in the first assertion, so a wrong
 * reconstruction fails loudly rather than flattering the fix.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { extractInterventionsForOption } from '../intervention-extractor.js';
import type { EdgeV3T, NodeV3T } from '../../../schemas/cee-v3.js';

/**
 * ⛔ IN-REPO FIXTURES, ON PURPOSE. These were first read from a path outside the
 * repository, which would have made this suite pass VACUOUSLY in CI — the captures
 * are not there, every case would have early-returned, and a green suite would have
 * asserted nothing. They are committed beside this file and their absence now FAILS.
 */
const DIR = new URL('./fixtures/2026-09-23-option-risk-blocked/', import.meta.url).pathname;
const CAPTURES = ['draft.json', 'draft-hiring2.json', 'draft-pricing.json'] as const;

type Capture = {
  nodes: NodeV3T[];
  edges: EdgeV3T[];
  goal_node_id?: string;
  analysis_ready?: { options?: { id?: string; status?: string; unresolved_targets?: string[] }[] };
};

const load = (f: string): Capture | null => {
  const p = `${DIR}${f}`;
  // Fail loudly: a missing capture is a broken suite, never a silent pass.
  if (!existsSync(p)) throw new Error(`missing wire capture ${p} — this suite cannot be vacuous`);
  const d = JSON.parse(readFileSync(p, 'utf8')) as Capture & { code?: string };
  return d.code ? null : d;
};

describe('the captured staging responses are present and carry the defect', () => {
  it('at least one capture exists — otherwise this suite proves nothing', () => {
    const present = CAPTURES.map(load).filter((c) => c !== null);
    expect(present.length, 'no captures found; this suite would be vacuous').toBe(CAPTURES.length);
  });

  it('every captured blocked option was blocked by a RISK target', () => {
    let blocked = 0;
    for (const f of CAPTURES) {
      const cap = load(f);
      if (cap === null) continue;
      const byId = new Map(cap.nodes.map((n) => [(n as { id: string }).id, n]));
      for (const o of cap.analysis_ready?.options ?? []) {
        for (const t of o.unresolved_targets ?? []) {
          blocked += 1;
          const kind = (byId.get(t) as { kind?: string } | undefined)?.kind;
          expect(kind, `${f}: unresolved target ${t} should be a graph node`).toBeDefined();
          expect(kind, `${f}: unresolved target ${t}`).toBe('risk');
        }
      }
    }
    // Non-vacuity: the defect must actually be present in the corpus.
    expect(blocked, 'no blocked options in the captures — nothing to prove').toBeGreaterThan(0);
  });
});

describe('⭐ replayed through the fix, every risk-blocked option becomes ready', () => {
  it.each([...CAPTURES])('%s', (f) => {
    const cap = load(f);
    if (cap === null) return; // a missing capture is covered by the non-vacuity test above
    const goal =
      cap.goal_node_id ??
      ((cap.nodes.find((n) => (n as { kind?: string }).kind === 'goal') as { id: string } | undefined)?.id ?? '');
    const arById = new Map((cap.analysis_ready?.options ?? []).map((o) => [o.id, o]));

    let flipped = 0;
    for (const node of cap.nodes) {
      const n = node as unknown as {
        id: string; kind?: string; label?: string;
        interventions?: Record<string, { value: number }>;
      };
      if (n.kind !== 'option') continue;
      const captured = arById.get(n.id);
      const unresolved = captured?.unresolved_targets ?? [];
      if (unresolved.length === 0) continue; // only the blocked ones are interesting

      // Reconstruct the id set the extractor was handed.
      const v4: Record<string, number> = {};
      for (const [fid, iv] of Object.entries(n.interventions ?? {})) v4[fid] = iv.value;
      for (const t of unresolved) v4[t] = 0.5;
      expect(
        Object.keys(v4).length,
        `${n.label}: reconstruction must cover matched + unresolved`,
      ).toBe(Object.keys(n.interventions ?? {}).length + unresolved.length);

      const out = extractInterventionsForOption(
        String(n.label ?? n.id), undefined, cap.nodes, cap.edges, goal,
        new Set(), [], v4, n.id,
      );

      // THE MEASURED FAILURE, GONE.
      expect(out.unresolved_targets, `${n.label}: risk must not block`).toBeUndefined();
      expect(out.non_factor_targets, `${n.label}: risk recorded, not dropped`).toEqual(
        expect.arrayContaining(unresolved),
      );
      expect(out.status, `${n.label}: was ${captured?.status}`).toBe('ready');
      flipped += 1;
    }
    expect(flipped, `${f}: no blocked option replayed — check the capture`).toBeGreaterThan(0);
  });
});
