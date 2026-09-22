/**
 * Every admitted node must reach the goal — the structural blocker that
 * survives every value being filled in.
 *
 * ⛔ MEASURED LIVE on 22 Sep at served 877ae800, on the canonical pricing
 * model, AFTER eight assumptions were adopted and no factor lacked a value:
 *
 *     blocked_reason: "ORPHAN_NODE"        (20 nodes, 6 with no edge at all)
 *     -- remove those six, on a registered copy, everything else identical --
 *     blocked_reason: "NO_PATH_TO_GOAL"    (2 more, connected but dead-ended)
 *     -- wire the 5 risks to the goal and withhold the rest --
 *     blockers: 0, and 17 of 20 nodes retained
 *
 * The builder is instructed to wire everything to the goal and did not, which
 * is why this is a deterministic admission rule and not only a prompt.
 */

import { describe, it, expect } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';

/** The live model's shape: a wired spine, five unlinked risks, a dead-end factor. */
const CANDIDATE = {
  goal: { metric: 'Monthly recurring revenue', operator: '>=', value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit' },
  constraints: [],
  options: [
    { label: 'Raise at next release', provenance: 'explicit', interventions: [{ factor_label: 'Pro plan price', value: 59, unit: 'GBP', provenance: 'explicit' }] },
    { label: 'Hold £49 through release', provenance: 'explicit', interventions: [{ factor_label: 'Pro plan price', value: 49, unit: 'GBP', provenance: 'explicit' }] },
  ],
  factors: [
    { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', plausible_max: 200, provenance: 'explicit' },
    // Connected but dead-ended — the NO_PATH_TO_GOAL case.
    { label: 'Price-change timing', role: 'controllable', baseline_known: false, provenance: 'inferred' },
    // No edge at all — the ORPHAN_NODE case.
    { label: 'Next Pro feature release', role: 'external', baseline_known: false, provenance: 'inferred' },
  ],
  risks: [
    { label: 'Churn constraint breach', provenance: 'inferred' },
    { label: 'MRR target miss', provenance: 'inferred' },
  ],
  outcomes: [],
  links: [
    { from: 'Raise at next release', to: 'Pro plan price', direction: 'positive', provenance: 'explicit' },
    { from: 'Hold £49 through release', to: 'Pro plan price', direction: 'positive', provenance: 'explicit' },
    { from: 'Pro plan price', to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred' },
    // Dead end: feeds a factor that reaches nothing.
    { from: 'Price-change timing', to: 'Price-change timing', direction: 'unknown', provenance: 'inferred' },
  ],
  unknowns: [],
};

const admit = () => admitCandidateModel(CANDIDATE as unknown as CandidateModel);
const labels = (ns: readonly { label: string }[]) => ns.map((n) => n.label).sort();

describe('risks are wired in, not deleted', () => {
  it('connects every unlinked risk to the goal, negatively and disclosed', () => {
    const a = admit();
    const goal = a.nodes.find((n) => n.kind === 'goal')!;
    const riskIds = a.nodes.filter((n) => n.kind === 'risk').map((n) => n.id);
    // ⭐ Bound by IDENTITY: both risks, each to the goal, each negative.
    expect(riskIds).toHaveLength(2);
    for (const id of riskIds) {
      const e = a.edges.find((x) => x.from === id && x.to === goal.id);
      expect(e, `risk ${id} has no link to the goal`).toBeDefined();
      expect(e!.effect_direction).toBe('negative');
      expect((e as { defaulted?: boolean }).defaulted).toBe(true);
    }
  });

  it('records the repair rather than performing it silently', () => {
    const a = admit();
    const said = a.loss.filter((l) => /was named but never connected/.test(l.reason));
    expect(said).toHaveLength(2);
    expect(said[0].reason).toMatch(/not from anything you said/);
  });
});

describe('what still cannot reach the goal is KEPT and named', () => {
  it('keeps every node the candidate named — deleting the unreachable was withdrawn', () => {
    const a = admit();
    // ⭐ The contrast control is the whole list: nothing was thinned. Withholding
    // these two DID clear the blocker when measured, and was withdrawn because
    // the nodes it deletes are the widener's — the strategic richness this lane
    // is judged on — and the analysis stayed blocked on scale regardless.
    expect(labels(a.nodes)).toEqual([
      'Churn constraint breach', 'Decision: Monthly recurring…', 'Hold £49 through release',
      'MRR target miss', 'Monthly recurring revenue', 'Next Pro feature release',
      'Price-change timing', 'Pro plan price', 'Raise at next release',
    ]);
  });

  it('names each unreachable node, so the Agent can ask instead of guessing', () => {
    const a = admit();
    const named = a.loss.filter((l) => /no chain of causes runs from it/.test(l.reason)).map((l) => l.before);
    expect([...named].sort()).toEqual(['Next Pro feature release', 'Price-change timing']);
    expect(a.loss.find((l) => /no chain of causes runs from it/.test(l.reason))!.reason)
      .toMatch(/kept rather than deleted/);
  });

  it('does not accuse a node that DOES reach the goal — the contrast control', () => {
    const a = admit();
    const named = a.loss.filter((l) => /no chain of causes runs from it/.test(l.reason)).map((l) => l.before);
    expect(named).not.toContain('Pro plan price');
    expect(named).not.toContain('Churn constraint breach');
  });
});

describe('the SAME frame normalises the baseline and every option level', () => {
  it('puts an option level on the factor\u2019s scale, not raw beside a framed baseline', () => {
    const a = admit();
    const raise = a.nodes.find((n) => n.label === 'Raise at next release')!;
    const hold = a.nodes.find((n) => n.label === 'Hold \u00a349 through release')!;
    const iv = (n: typeof raise) => (n as unknown as { interventions?: Record<string, { value: number }> }).interventions
      ?? (n as { node?: { interventions?: Record<string, { value: number }> } }).node?.interventions;
    // ⛔ THE DEFECT THIS PINS, introduced by the frame itself and measured live
    // as `mixed_scale_unresolved`: baseline 49/200 beside an intervention of 59.
    const price = a.nodes.find((n) => n.label === 'Pro plan price')!;
    expect(iv(raise)![price.id].value).toBeCloseTo(59 / 200, 10);
    expect(iv(hold)![price.id].value).toBeCloseTo(49 / 200, 10);
    // Contrast control: the baseline is on that very same scale.
    const os = (price as { node?: { observed_state?: Record<string, unknown> } }).node?.observed_state
      ?? (price as unknown as { observed_state?: Record<string, unknown> }).observed_state;
    expect(os!.value).toBeCloseTo(49 / 200, 10);
  });
});

describe('a factor keeps its own scale frame', () => {
  it('normalises a baseline above 1 against its plausible range, keeping the raw number', () => {
    const a = admit();
    const price = a.nodes.find((n) => n.label === 'Pro plan price')!;
    const os = (price as { node?: { observed_state?: Record<string, unknown> } }).node?.observed_state
      ?? (price as unknown as { observed_state?: Record<string, unknown> }).observed_state;
    expect(os, JSON.stringify(price)).toBeDefined();
    expect(os!.raw_value).toBe(49);
    expect(os!.cap).toBe(200);
    expect(os!.value).toBeCloseTo(49 / 200, 10);
    // The user's own number is never replaced by the frame.
    expect(os!.unit).toBe('GBP');
  });
});
