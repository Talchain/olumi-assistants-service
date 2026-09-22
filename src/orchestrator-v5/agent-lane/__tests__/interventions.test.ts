/**
 * Typed interventions: the one contract change that makes a model analysable.
 *
 * `configC.json` is a live capture — config B (one pass, gpt-5.6-terra) with a
 * single schema change: options carry `interventions: [{factor_label, value,
 * unit, provenance}]` instead of only a label.
 *
 * ⭐ THE RESULT THAT JUSTIFIES THE CHANGE. The brief says "from £49 to £59".
 * With the old contract, 59 existed only as characters in an option label and
 * the product had to ask the user to restate it. With this one field, the model
 * returns `Pro plan monthly price = 59 GBP/month` with provenance `explicit`,
 * on the option that sets it — and an empty array on the option that changes
 * nothing.
 *
 * Interventions are written to `node.interventions`, which is a DECLARED field
 * on `NodeV3` (`cee-v3.ts`). `node.data.interventions` is the canonical edit
 * location for `edit_graph`, but `NodeV3` strips undeclared keys, so a `data`
 * object written by this lane would not survive persistence.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { extractNumericIntervention } from '../../../orchestrator/tools/analysis-ready-helper.js';

const d = new URL('./fixtures/', import.meta.url);
const configC = () => JSON.parse(readFileSync(new URL('configC.json', d), 'utf8')) as CandidateModel;
const admitted = () => admitCandidateModel(configC(), {});

describe('typed interventions', () => {
  it('the capture really carries the decisive number (control on the fixture)', () => {
    const all = configC().options.flatMap((o) => (o as { interventions?: { value: number }[] }).interventions ?? []);
    expect(all.some((i) => i.value === 59), 'the brief’s target price, as a NUMBER').toBe(true);
  });

  it('writes them onto the option node where the readiness helper reads them', () => {
    const m = admitted();
    const options = m.nodes.filter((n) => n.kind === 'option');
    const withIv = options.filter((o) => o.interventions !== undefined);
    expect(withIv.length).toBeGreaterThan(0);

    // Read them back with CEE's OWN extractor, not my own accessor.
    const values = withIv.flatMap((o) =>
      Object.values(o.interventions ?? {})
        .map((v) => extractNumericIntervention(v)),
    );
    expect(values).toContain(59);
  });

  it('keys interventions by the resolved FACTOR NODE ID, never a label', () => {
    const m = admitted();
    const ids = new Set(m.nodes.map((n) => n.id));
    for (const o of m.nodes.filter((n) => n.kind === 'option')) {
      for (const key of Object.keys(o.interventions ?? {})) {
        expect(ids.has(key), `intervention key ${key} must be a node id`).toBe(true);
      }
    }
  });

  it('withholds an intervention whose factor cannot be resolved, rather than guessing', () => {
    const c = configC() as CandidateModel & { options: { interventions?: unknown[] }[] };
    (c.options[0] as { interventions: unknown[] }).interventions = [
      { factor_label: 'A factor that does not exist', value: 1, unit: 'x', provenance: 'explicit' },
    ];
    const m = admitCandidateModel(c, {});
    expect(m.withheld.some((w) => w.reason === 'unresolved_intervention_target')).toBe(true);
    const opt = m.nodes.find((n) => n.kind === 'option')!;
    expect(Object.keys(opt.interventions ?? {})).toHaveLength(0);
  });

  it('connects an option to every factor it states it changes', () => {
    const m = admitted();
    const withIv = m.nodes.filter((n) => n.kind === 'option' && n.interventions !== undefined);
    expect(withIv.length).toBeGreaterThan(0);
    for (const o of withIv) {
      for (const factorId of Object.keys(o.interventions!)) {
        expect(
          m.edges.some((e) => e.from === o.id && e.to === factorId),
          `option ${o.id} states it sets ${factorId} but is not connected to it`,
        ).toBe(true);
      }
    }
  });

  it('an option with NO stated intervention gets no factor edge — it stays honestly unmapped', () => {
    const m = admitted();
    const unmapped = m.nodes.filter((n) => n.kind === 'option' && n.interventions === undefined);
    expect(unmapped.length, 'the capture has a defer option that changes nothing').toBeGreaterThan(0);
    const factorIds = new Set(m.nodes.filter((n) => n.kind === 'factor').map((n) => n.id));
    for (const o of unmapped) {
      expect(m.edges.some((e) => e.from === o.id && factorIds.has(e.to))).toBe(false);
    }
  });

  it('the graph still passes the validator the write path runs', () => {
    const m = admitted();
    const parsed = GraphV3.safeParse({ nodes: m.nodes, edges: m.edges });
    expect(parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'))).toEqual([]);
  });
});
