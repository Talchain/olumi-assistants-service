import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { BUILD_INSTRUCTIONS, buildCandidateSchema, buildModelFromBrief, prepareProvisionalCandidate } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { narrateWriteOutcome } from '../write-outcome.js';

// Paul's 24 September hiring brief, reconstructed as a corrected producer candidate.
// This is a no-provider contract fixture, not a claim about generated model quality.
function hiring() {
  return {
    goal: { metric: 'Productivity', operator: '>=', target_stated: false, value: null, unit: '%', horizon_months: null, provenance: 'explicit' },
    constraints: [],
    options: [
      { label: 'Hire a tech lead', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [{ factor_label: 'Tech leads', value: 1, value_kind: 'additional', unit: 'people', provenance: 'explicit' }] },
      { label: 'Hire two developers', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [{ factor_label: 'Developers', value: 2, value_kind: 'additional', unit: 'people', provenance: 'explicit' }] },
      { label: 'Maintain current staffing', provenance: 'ai_proposed', is_status_quo: null, changes: [], interventions: [] as { factor_label: string; value: number; value_kind: string; unit: string; provenance: string }[] },
    ],
    factors: [
      { label: 'Tech leads', role: 'controllable' as const, baseline_known: false, baseline_value: 0, unit: 'people', plausible_max: 5, provenance: 'ai_proposed' },
      { label: 'Developers', role: 'controllable' as const, baseline_known: false, baseline_value: 5, unit: 'people', plausible_max: 20, provenance: 'ai_proposed' },
    ],
    risks: [{ label: 'Onboarding disruption', provenance: 'ai_proposed' }, { label: 'Leadership mismatch', provenance: 'ai_proposed' }],
    outcomes: [],
    links: [
      { from: 'Developers', to: 'Productivity', direction: 'positive' as const, provenance: 'ai_proposed' },
      { from: 'Tech leads', to: 'Productivity', direction: 'positive' as const, provenance: 'ai_proposed' },
      { from: 'Developers', to: 'Onboarding disruption', direction: 'positive' as const, provenance: 'ai_proposed' },
      { from: 'Tech leads', to: 'Leadership mismatch', direction: 'positive' as const, provenance: 'ai_proposed' },
      { from: 'Onboarding disruption', to: 'Productivity', direction: 'negative' as const, provenance: 'ai_proposed' },
      { from: 'Leadership mismatch', to: 'Productivity', direction: 'negative' as const, provenance: 'ai_proposed' },
    ],
    unknowns: ['Current headcount is estimated, not confirmed.'],
  };
}

async function construct(...candidates: CandidateModel[]) {
  let graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } | undefined;
  let calls = 0;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) graph = (body as { graph: typeof graph }).graph;
    return { status: 200, json: { graph: { nodes: [], edges: [] } } };
  };
  const result = await buildModelFromBrief('33333333-3333-4333-8333-333333333333',
    'Should I hire a Tech lead or two developers to increase productivity?', dispatch,
    async () => ({ text: JSON.stringify(candidates[Math.min(calls++, candidates.length - 1)]) }));
  return { result, graph, calls };
}

function invalidRisk() {
  const candidate = hiring();
  candidate.links = candidate.links.filter((l) => l.to !== 'Onboarding disruption');
  candidate.links.push({ from: 'Hire two developers', to: 'Onboarding disruption', direction: 'positive', provenance: 'ai_proposed' });
  return candidate;
}

describe('provisional hiring construction uses real admission and registration payload', () => {
  it('fits the actual structured schema, adds headcount once, and retains estimated provenance', async () => {
    const validate = new Ajv({ strict: false }).compile(buildCandidateSchema());
    expect(validate(hiring()), JSON.stringify(validate.errors)).toBe(true);
    const prepared = prepareProvisionalCandidate(hiring());
    expect(prepared.additions_without_total).toEqual([]);
    expect(prepared.provenance_demoted).toEqual([]);
    expect(prepared.candidate.factors[1]).toMatchObject({ baseline_known: false, baseline_value: 5, provenance: 'ai_proposed' });
    expect(prepared.candidate.options[1].interventions?.[0]).toMatchObject({ value: 7, provenance: 'ai_proposed' });
    // RC fix (3): "hire a tech lead" is ONE MORE on an estimated baseline of 0 — a total of 1, and Olumi's.
    expect(prepared.candidate.options[0].interventions?.[0]).toMatchObject({ value: 1, value_kind: 'absolute', provenance: 'ai_proposed' });
    expect(prepareProvisionalCandidate(prepared.candidate).candidate).toEqual(prepared.candidate);
    const { result, graph, calls } = await construct(hiring());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(calls).toBe(1);
    const option = graph?.nodes.find((n) => n.label === 'Hire two developers');
    expect(option?.interventions).toEqual({ developers: { value: 0.35, source: 'cee_hypothesis' } });
    expect(graph?.nodes.find((n) => n.kind === 'goal')).not.toHaveProperty('goal_threshold_raw');
    // RC fix (1): the current-state option carries NO levels — it is held (#1838), not set to the baselines.
    expect(graph?.nodes.find((n) => n.id === 'maintain_current_staffing')).not.toHaveProperty('interventions');
    // RC fix (4): #1838's disclosure reaches the Agent, verbatim.
    expect(result.not_represented).toContain(
      "'Maintain current staffing' reads as carrying on as now, so I connected it to Tech leads and Developers with no level of its own; "
      + 'the analysis holds each at its starting value, which may be an estimate rather than a figure you gave. '
      + 'If carrying on as now would itself change any of them, say how.',
    );
  });

  it('RC fix (1): the construction contract no longer tells the producer to give the current-state option levels', () => {
    expect(BUILD_INSTRUCTIONS).not.toMatch(/current-state option/i);
    expect(JSON.stringify(buildCandidateSchema())).not.toMatch(/current-state option/i);
  });

  it('RC fix (3): an explicit ABSOLUTE level on a factor with no known baseline is demoted to ai_proposed', () => {
    const c = hiring();
    c.options[1].interventions[0].value_kind = 'absolute';
    expect(prepareProvisionalCandidate(c).candidate.options[1].interventions?.[0]).toMatchObject({ value: 2, provenance: 'ai_proposed' });
    // …and the level cell admission writes for it is Olumi's hypothesis, not the brief's.
    const admitted = admitCandidateModel(prepareProvisionalCandidate(c).candidate, {});
    expect(admitted.nodes.find((n) => n.id === 'hire_two_developers')?.interventions?.developers?.source).toBe('cee_hypothesis');
  });

  it('keeps true user-supplied totals and distinguishes an absolute two from an additional two', () => {
    const c = hiring();
    c.options[1].interventions[0].value_kind = 'absolute';
    c.factors[1].baseline_known = true;
    c.factors[1].provenance = 'explicit';
    expect(prepareProvisionalCandidate(c).candidate.options[1].interventions?.[0]).toMatchObject({ value: 2, provenance: 'explicit' });
    c.options[1].interventions[0].value_kind = 'additional';
    const prepared = prepareProvisionalCandidate(c).candidate;
    expect(prepared.options[1].interventions?.[0]).toMatchObject({ value: 7, provenance: 'explicit' });
    expect(admitCandidateModel(prepared, {}).nodes.find((n) => n.label === 'Developers')?.observed_state).toMatchObject({ raw_value: 5, source: 'brief_extraction' });
  });

  /**
   * B1 (review 5822711266): an addition that cannot become a total DEGRADES — it is
   * never a refusal. "Should we hire two more engineers?" with no team size must still
   * give the user a model on turn 1: the option keeps acting on the factor (a
   * structural `changes` entry, no level invented), and the user is told what is
   * missing and how to supply it.
   */
  it.each([
    ['missing baseline', 'the current level of "Developers" is not known'],
    ['unit drift', 'is stated in developers, while "Developers" is measured in people'],
  ])('B1 RED: an unresolvable addition degrades to a level-free change and is said, never refused: %s', async (fault, said) => {
    const c: CandidateModel = hiring();
    if (fault === 'missing baseline') c.factors[1].baseline_value = null;
    else c.options[1].interventions![0].unit = 'developers';
    const { result, graph, calls } = await construct(c);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result).not.toHaveProperty('refusal');
    expect(calls, 'no retry is spent on a figure only the user can supply').toBe(1);
    // The option still acts on the factor — by an edge, with NO level.
    const option = graph?.nodes.find((n) => n.id === 'hire_two_developers');
    expect(option, 'the option is still in the model').toBeDefined();
    expect((option?.interventions ?? {}) as Record<string, unknown>).not.toHaveProperty('developers');
    expect(graph?.edges.some((e) => e.from === 'hire_two_developers' && e.to === 'developers')).toBe(true);
    // Machine-readable, and said.
    expect(result.additions_without_total).toEqual([
      expect.objectContaining({ option: 'Hire two developers', factor: 'Developers', value: 2 }),
    ]);
    const lines = (result.not_represented as string[]).filter((x) => x.includes('Hire two developers') && x.includes(said));
    expect(lines, JSON.stringify(result.not_represented)).toHaveLength(1);
    expect(lines[0]).toMatch(/becomes a total/);
    // The user never reads a raw refusal code.
    const n = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [result as never]);
    expect(n.status).not.toMatch(/construction_needs_semantic_repair|refused/);
  });

  /**
   * B2 (review 5822711266): a user's own number must never SILENTLY read as Olumi's
   * hypothesis. "Grow the team to 7" on an estimated baseline is stored as a working
   * figure — and the build result says so, by option, factor and value.
   */
  it('B2 RED: an explicit total demoted to a working figure is returned and said, never silent', async () => {
    const c = hiring();
    c.options[1].interventions[0] = { factor_label: 'Developers', value: 7, value_kind: 'absolute', unit: 'people', provenance: 'explicit' };
    const { result, graph } = await construct(c);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((graph?.nodes.find((n) => n.id === 'hire_two_developers')?.interventions as Record<string, { source: string }>).developers?.source).toBe('cee_hypothesis');
    expect(result.provenance_demoted).toEqual([{ option: 'Hire two developers', factor: 'Developers', value: 7 }]);
    const lines = (result.not_represented as string[]).filter((x) => x.includes('your 7'));
    expect(lines, JSON.stringify(result.not_represented)).toHaveLength(1);
    expect(lines[0]).toContain('"Developers"');
    expect(lines[0]).toContain("confirm it and I'll mark it as yours");
  });

  it('B2 control: a candidate with no value_kind (stored before the field) keeps its stated provenance, exactly as on staging', () => {
    const c = hiring();
    c.options[1].interventions[0] = { factor_label: 'Developers', value: 7, unit: 'people', provenance: 'explicit' } as never;
    const prepared = prepareProvisionalCandidate(c);
    expect(prepared.candidate.options[1].interventions?.[0]).toMatchObject({ value: 7, provenance: 'explicit' });
    expect(prepared.provenance_demoted).toEqual([]);
  });

  /**
   * B3 (review 5822933692): an ADOPTED repair retry must not erase what the first
   * pass had to say. The retry here ECHOES the prepared first candidate — exactly
   * what a model shown the prepared candidate would return — with the risk mechanism
   * restored, so it is adopted. The live hiring capture takes this path.
   */
  const withRiskShortcut = (c: ReturnType<typeof hiring>) => {
    c.links = c.links.filter((l) => l.to !== 'Onboarding disruption');
    c.links.push({ from: 'Hire two developers', to: 'Onboarding disruption', direction: 'positive', provenance: 'ai_proposed' });
    return c;
  };

  it('B3 RED (B1 on the repair path): an addition with no total is still said after an adopted retry', async () => {
    const first = hiring(); (first.factors[1] as { baseline_value: number | null }).baseline_value = null;
    const repaired = hiring(); (repaired.factors[1] as { baseline_value: number | null }).baseline_value = null;
    const echo = prepareProvisionalCandidate(repaired).candidate;
    const { result, graph, calls } = await construct(withRiskShortcut(first), echo);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(calls, 'the mechanism repair was attempted').toBe(2);
    expect(graph?.edges.some((e) => e.from === 'developers' && e.to === 'onboarding_disruption'), 'the retry was ADOPTED').toBe(true);
    expect(result.additions_without_total).toEqual([expect.objectContaining({ option: 'Hire two developers', factor: 'Developers', value: 2, reason: 'baseline_unknown' })]);
    expect((result.not_represented as string[]).filter((x) => x.includes('the current level of "Developers" is not known'))).toHaveLength(1);
  });

  it('B3 RED (B2 on the repair path): a demoted user total is still said after an adopted retry', async () => {
    const seven = { factor_label: 'Developers', value: 7, value_kind: 'absolute', unit: 'people', provenance: 'explicit' };
    const first = hiring(); first.options[1].interventions[0] = { ...seven };
    const repaired = hiring(); repaired.options[1].interventions[0] = { ...seven };
    const echo = prepareProvisionalCandidate(repaired).candidate;
    const { result, graph, calls } = await construct(withRiskShortcut(first), echo);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(calls).toBe(2);
    expect(graph?.edges.some((e) => e.from === 'developers' && e.to === 'onboarding_disruption'), 'the retry was ADOPTED').toBe(true);
    expect(result.provenance_demoted).toEqual([{ option: 'Hire two developers', factor: 'Developers', value: 7 }]);
    expect((result.not_represented as string[]).filter((x) => x.includes('your 7'))).toHaveLength(1);
  });

  it('B3 control: a finding the adopted retry genuinely resolved is NOT carried', async () => {
    const first = hiring(); (first.factors[1] as { baseline_value: number | null }).baseline_value = null;
    // The retry states the current headcount, so "hire two" becomes a real total.
    const { result, graph } = await construct(withRiskShortcut(first), hiring());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(graph?.edges.some((e) => e.from === 'developers' && e.to === 'onboarding_disruption')).toBe(true);
    expect(result).not.toHaveProperty('additions_without_total');
    expect((graph?.nodes.find((n) => n.id === 'hire_two_developers')?.interventions as Record<string, unknown>)).toHaveProperty('developers');
  });

  it('B3: the repair retry is shown the drafter’s ORIGINAL candidate, not the prepared one', async () => {
    const first = hiring(); (first.factors[1] as { baseline_value: number | null }).baseline_value = null;
    const inputs: string[] = [];
    const dispatch: InternalDispatch = async () => ({ status: 200, json: { graph: { nodes: [], edges: [] } } });
    let n = 0;
    await buildModelFromBrief('33333333-3333-4333-8333-333333333333', 'Should I hire?', dispatch,
      async (req) => { inputs.push(String((req as { input: unknown }).input)); return { text: JSON.stringify(n++ === 0 ? withRiskShortcut(first) : hiring()) }; });
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain('"value_kind":"additional"');
  });

  it('N2: an addition naming a factor that does not exist is said as unknown, not ambiguous', async () => {
    const c = hiring();
    c.options[1].interventions[0] = { factor_label: 'Contractors', value: 2, value_kind: 'additional', unit: 'people', provenance: 'explicit' };
    const { result } = await construct(c);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.additions_without_total).toEqual([expect.objectContaining({ factor: 'Contractors', reason: 'factor_unknown' })]);
    expect((result.not_represented as string[]).filter((x) => x.includes('no factor called "Contractors" is in the model'))).toHaveLength(1);
  });

  it('repairs a direct option-risk hypothesis through a factor without dropping its downstream effect', async () => {
    const { result, graph, calls } = await construct(invalidRisk(), hiring());
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(calls).toBe(2);
    expect(graph?.edges.some((e) => e.from === 'developers' && e.to === 'onboarding_disruption')).toBe(true);
    expect(graph?.edges.some((e) => e.from === 'onboarding_disruption' && e.to === 'productivity')).toBe(true);
  });

  it.each(['strand risk', 'reverse risk'])('does not adopt a repair that changes the hypothesis; #1830 keeps and discloses the original: %s', async (fault) => {
    const c = hiring();
    if (fault === 'strand risk') c.links = c.links.filter((l) => l.to !== 'Onboarding disruption');
    else c.links = c.links.map((l) => l.from === 'Onboarding disruption' ? { ...l, direction: 'positive' } : l);
    const { result, graph, calls } = await construct(invalidRisk(), c);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(calls).toBe(2);
    // The ORIGINAL was kept: its option -> risk hypothesis survives, no sign invented …
    const kept = graph?.edges.find((e) => e.from === 'hire_two_developers' && e.to === 'onboarding_disruption');
    expect(kept?.effect_direction).toBe('positive');
    // … and the repair proposal reaches the Agent.
    expect((result.not_represented as string[]).filter((x) => x.includes('Hire two developers') && x.includes('Onboarding disruption'))).toHaveLength(1);
  });

  it('RC fix (2): a machine shortcut OVER an existing mechanism is never an issue — admission folds it (#1830), with no retry', async () => {
    const c = hiring();
    c.links.push({ from: 'Hire two developers', to: 'Onboarding disruption', direction: 'positive', provenance: 'ai_proposed' });
    expect(prepareProvisionalCandidate(c).mechanism_issues).toEqual([]);
    const { result, graph, calls } = await construct(c);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(calls).toBe(1);
    expect(graph?.edges.find((e) => e.from === 'hire_two_developers' && e.to === 'onboarding_disruption')).toBeUndefined();
  });

  it('RC fix (2), joint RED: the live hiring capture plus ONE user-stated option -> risk link builds first time and keeps the user edge', async () => {
    const live = JSON.parse(readFileSync(new URL('./fixtures/live-hiring-envelope-candidate-20260923.json', import.meta.url), 'utf8')).candidate as CandidateModel;
    // A link with NO mechanism in the capture ("Maintain Current Staffing" acts only on
    // "Existing team continuity", which never reaches "Hiring delay"), so only the
    // user's authorship — not a mechanism — can keep it from being an issue.
    const withUserLink = { ...live, links: [...live.links, { from: 'Maintain Current Staffing', to: 'Hiring delay', direction: 'negative' as const, provenance: 'explicit' }] } as CandidateModel;
    const { result, graph, calls } = await construct(withUserLink);
    expect(result.ok, JSON.stringify(result).slice(0, 400)).toBe(true);
    expect(calls).toBe(1);
    const userEdge = graph?.edges.find((e) => e.from === 'maintain_current_staffing' && e.to === 'hiring_delay');
    expect(userEdge?.provenance).toMatchObject({ source: 'brief_extraction' });
    expect(userEdge?.effect_direction).toBe('negative');
    expect(prepareProvisionalCandidate(withUserLink).mechanism_issues).toEqual([]);
  });
});
