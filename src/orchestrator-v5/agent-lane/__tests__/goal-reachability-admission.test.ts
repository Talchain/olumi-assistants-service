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
import { admitCandidateModel, defaultFrameFor, type CandidateModel } from '../admit-model.js';

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

/**
 * ⭐ RE-RULED (AIE 19 Oct 02:54Z and 04:12Z): "a risk is by definition something that threatens the goal" no longer wires an
 * unlinked risk into the goal at Olumi's placeholder size. This very fixture shows why: "MRR target miss" is the goal's own
 * failure, an outcome, not a cause of it. A concern left unlinked is RETAINED, visible as untested, and NOT auto-wired.
 */
describe('unlinked risks are kept, not wired in and not deleted', () => {
  it('keeps every unlinked risk, with no link invented, left out of the calculation (retained_excluded)', () => {
    const a = admit();
    const riskIds = a.nodes.filter((n) => n.kind === 'risk').map((n) => n.id);
    // ⭐ Bound by IDENTITY: both risks kept, neither with any edge, both marked untested.
    expect(riskIds).toHaveLength(2);
    for (const id of riskIds) {
      expect(a.edges.filter((x) => x.from === id || x.to === id), `risk ${id} was wired`).toEqual([]);
      expect(a.nodes.find((n) => n.id === id)!.analysis_participation).toBe('retained_excluded');
    }
  });

  it('records why each is left out, and never claims a link', () => {
    const a = admit();
    const said = a.loss.filter((l) => l.field_path.endsWith('.left_out_of_analysis')).map((l) => l.reason);
    expect(said).toEqual([
      '"Churn constraint breach" is kept in the model but left out of this analysis, because nothing in the model says how it affects "Monthly recurring revenue". It has not been connected to "Monthly recurring revenue" as a cause.',
      '"MRR target miss" is kept in the model but left out of this analysis, because nothing in the model says how it affects "Monthly recurring revenue". It has not been connected to "Monthly recurring revenue" as a cause.',
    ]);
    expect(a.loss.some((l) => /was named but never connected|as a negative influence/.test(l.reason))).toBe(false);
  });

  /**
   * ⛔ A RISK WHOSE LINK THE DRAFTER STATED AS `unknown` IS NOT "NEVER CONNECTED".
   *
   * Panel review 5793954535 (B1, probe P3): "Attrition" -> goal stated `unknown`
   * was withheld, then re-added by the repair above as `negative`, defaulted —
   * a sign the drafter explicitly declined to give. Release Control #63
   * 5793252993: where direction is unknown, ASK instead of defaulting. The risk
   * stays in the model, unconnected and named, and the withheld link is the
   * question. The contrast is in the same run: the two risks with NO stated link
   * at all are kept out of the calculation, unwired (AIE 19 Oct).
   */
  const withUnknownRisk = (to: string) => admitCandidateModel({
    ...CANDIDATE,
    risks: [...CANDIDATE.risks, { label: 'Attrition', provenance: 'inferred' }],
    links: [...CANDIDATE.links, { from: 'Attrition', to, direction: 'unknown', provenance: 'inferred' }],
  } as unknown as CandidateModel);

  for (const [what, to] of [['the goal', 'Monthly recurring revenue'], ['a factor', 'Pro plan price']] as const) {
    it(`does NOT invent a sign for a risk whose link to ${what} was stated UNKNOWN`, () => {
      const a = withUnknownRisk(to);
      const attrition = a.nodes.find((n) => n.label === 'Attrition')!;
      // Vacuity guard: the drafter really stated the link, and it was withheld.
      expect(a.withheld).toContainEqual(expect.objectContaining({ from: attrition.id, reason: 'no_authored_direction' }));
      expect(a.edges.filter((e) => e.from === attrition.id), 'no signed edge may leave a risk whose link is unknown').toEqual([]);
      expect(a.loss.some((l) => /The risk "Attrition" was named but never connected/.test(l.reason))).toBe(false);
      // Kept, and named, so the Agent asks rather than the analysis guessing.
      expect(a.nodes.map((n) => n.label)).toContain('Attrition');
      expect(a.loss.filter((l) => /no chain of causes runs from it/.test(l.reason)).map((l) => l.before)).toContain('Attrition');
      // CONTRAST, same run: the declined risk keeps its question, unmarked; the risks with no stated link are kept out, unwired.
      expect(attrition.analysis_participation).toBeUndefined();
      for (const label of ['Churn constraint breach', 'MRR target miss']) {
        const id = a.nodes.find((n) => n.label === label)!.id;
        expect(a.edges.filter((e) => e.from === id || e.to === id), label).toEqual([]);
        expect(a.nodes.find((n) => n.id === id)!.analysis_participation, label).toBe('retained_excluded');
      }
    });
  }
});

describe('what still cannot reach the goal is KEPT and named', () => {
  it('keeps every node the candidate named — deleting the unreachable was withdrawn', () => {
    const a = admit();
    // ⭐ The contrast control is the whole list: nothing was thinned. Withholding
    // these two DID clear the blocker when measured, and was withdrawn because
    // the nodes it deletes are the widener's — the strategic richness this lane
    // is judged on — and the analysis stayed blocked on scale regardless.
    // #3045 (Paul's vocabulary, 14 Oct): the decision node SHOWS "Question: <metric>" (its id still slugs from "Decision:").
    expect(labels(a.nodes)).toEqual([
      'Churn constraint breach', 'Hold £49 through release',
      'MRR target miss', 'Monthly recurring revenue', 'Next Pro feature release',
      'Price-change timing', 'Pro plan price', 'Question: Monthly recurring revenue', 'Raise at next release',
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

describe('a factor with no stated range still gets one, derived and disclosed', () => {
  it('frames it by the smallest power of ten above the largest figure the model holds', () => {
    const a = admit();
    // 'Price-change timing' is declared with no plausible_max and no baseline,
    // so nothing frames it — and nothing needs to.
    const timing = a.nodes.find((n) => n.label === 'Price-change timing')!;
    const os = (n: typeof timing) => (n as { node?: { observed_state?: Record<string, unknown> } }).node?.observed_state
      ?? (n as unknown as { observed_state?: Record<string, unknown> }).observed_state;
    expect(os(timing)).toBeUndefined();

    // 'Next Pro feature release' likewise. The contrast that matters is a
    // factor that DOES carry a magnitude with no stated range.
    const framed = admitCandidateModel({
      ...CANDIDATE,
      factors: [{ label: 'Pro subscribers', role: 'observable', baseline_known: true, baseline_value: 250, unit: 'subscribers', provenance: 'inferred' }],
      options: [{ label: 'Grow the base', provenance: 'explicit', interventions: [{ factor_label: 'Pro subscribers', value: 300, unit: 'subscribers', provenance: 'explicit' }] }],
      links: [{ from: 'Pro subscribers', to: 'Monthly recurring revenue', direction: 'positive', provenance: 'inferred' }],
    } as unknown as CandidateModel);
    const subs = framed.nodes.find((n) => n.label === 'Pro subscribers')!;
    // Largest figure the model holds is 300 -> the next power of ten is 1000.
    expect(os(subs)!.cap).toBe(1000);
    expect(os(subs)!.raw_value).toBe(250);
    expect(os(subs)!.value).toBeCloseTo(0.25, 10);
    // ⛔ It must be SAID, not applied quietly — this is the concession.
    const told = framed.loss.find((l) => /No range was stated for "Pro subscribers"/.test(l.reason))!;
    expect(told, JSON.stringify(framed.loss.map((l) => l.reason))).toBeDefined();
    expect(told.reason).toMatch(/a unit of measurement, not a forecast/);
    expect(told.after).toBe(1000);
  });

  it('prefers the range the builder stated over the derived one', () => {
    const a = admit();
    const price = a.nodes.find((n) => n.label === 'Pro plan price')!;
    const os = (price as { node?: { observed_state?: Record<string, unknown> } }).node?.observed_state
      ?? (price as unknown as { observed_state?: Record<string, unknown> }).observed_state;
    // Stated 200; the derived one would have been 100 (largest figure is 59).
    expect(os!.cap).toBe(200);
    expect(a.loss.find((l) => /No range was stated for "Pro plan price"/.test(l.reason))).toBeUndefined();
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

describe('defaultFrameFor — derived, not chosen', () => {
  it('is the smallest power of ten strictly above the magnitude', () => {
    expect(defaultFrameFor(59)).toBe(100);
    expect(defaultFrameFor(250)).toBe(1000);
    // Strictly above: an exact power of ten takes the next step up (AIQ #72 5868446435).
    expect(defaultFrameFor(1000)).toBe(10000);
    expect(defaultFrameFor(1001)).toBe(10000);
    // Anything already within the unit interval needs no frame at all.
    expect(defaultFrameFor(0.7)).toBe(1);
    expect(defaultFrameFor(1)).toBe(1);
  });
});
