/**
 * ⭐ CAPACITY: THE GOAL'S CURRENT LEVEL NO LONGER DEPENDS ON DRAFTER LUCK (DL 14 Oct priority call).
 *
 * Served capacity on 732ebe50 (JUDGE-capacity-post3001): "Chance not shown yet: Weekly support capacity's current level is
 * missing"; on 9e72fd2a the same brief showed 36 %. Replayed 2×2 (each persisted raw through `buildModelFromBrief` at both
 * builds): each raw gives the same graph at both, so admission did not change; the raws differ. The 732e draft leaves the
 * goal's level null, and it also drafts a sibling factor "Tickets resolved per specialist", whose shared words made
 * `verifiedFactorLevel` refuse the identical quote "Our existing team resolves 80 tickets per week.".
 *
 * THIS PR IS (a) ONLY (DL option 1, 14 Oct): a goal level the drafter left null comes from a factor quote that verifies.
 * It does NOT fix the 732e draw: the sibling still makes `verifiedFactorLevel` refuse the existing team's quote (KNOWN GAP
 * row below), and that is the class fix (b) on #3002's verifier.
 *
 * Construction replayed for real (`buildModelFromBrief`) from the two PERSISTED drafter answers
 * (`fixtures/capacity-persisted-raws-20261014.json`, byte-exact, sha256 checked). Scripted: the provider.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/capacity-persisted-raws-20261014.json', import.meta.url), 'utf8')) as {
  brief: string; brief_sha256: string; drafts: { row: string; cee_build: string; raw_text: string; raw_sha256: string }[] };
const RAW_9E72 = FX.drafts.find((d) => d.cee_build === '9e72fd2a')!;
const RAW_732E = FX.drafts.find((d) => d.cee_build === '732ebe50')!;
const QUOTE = 'Our existing team resolves 80 tickets per week.';
const GOAL_SENTENCE = 'Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity.';
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

async function construct(rawText: string, brief = FX.brief): Promise<{ goal: Rec; existing: Rec }> {
  let graph: Rec | undefined;
  const dispatch = async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
  };
  const drafter = async () => ({ text: rawText, status: 'completed' });
  const result = await buildModelFromBrief('00000000-0000-4000-8000-0000000000c2', brief, dispatch as never, drafter as never) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 2000)).toBe(true);
  const nodes = graph!.nodes as Rec[];
  return { goal: nodes.find((n) => n.kind === 'goal')!, existing: nodes.find((n) => n.id === 'existing_team_capacity')! };
}
/** The 9e72 answer with the goal's level left null as the 732e draw left it (and any further edit), re-serialised. */
const nulledGoal9e72 = (edit: (draft: Rec) => void = () => {}): string => {
  const draft = JSON.parse(RAW_9E72.raw_text) as Rec;
  Object.assign(draft.goal, { baseline_known: false, baseline_value: null, baseline_provenance: 'inferred' });
  edit(draft);
  return JSON.stringify(draft);
};
const factor = (draft: Rec, label: string): Rec => (draft.factors as Rec[]).find((f) => f.label === label)!;
const USERS_80 = { raw_value: 80, unit: 'tickets per week', source: 'brief_extraction', extractionType: 'explicit' };

describe('capacity (a): a goal level the drafter left null comes from the user\'s verified quote', () => {
  it('PRECONDITION: the persisted answers are byte-exact; one leaves the goal\'s level null; both quote the existing team\'s 80', () => {
    expect(sha(FX.brief)).toBe(FX.brief_sha256);
    for (const d of FX.drafts) expect(sha(d.raw_text), d.row).toBe(d.raw_sha256);
    expect(JSON.parse(RAW_9E72.raw_text).goal).toMatchObject({ baseline_known: true, baseline_value: 80 });
    expect(JSON.parse(RAW_732E.raw_text).goal).toMatchObject({ baseline_known: false, baseline_value: null });
    for (const d of FX.drafts) {
      expect(factor(JSON.parse(d.raw_text), 'Existing team capacity'), d.row)
        .toMatchObject({ baseline_value: 80, unit: 'tickets per week', baseline_evidence: { quote: QUOTE } });
    }
    expect(factor(JSON.parse(RAW_732E.raw_text), 'Tickets resolved per specialist')).toMatchObject({ baseline_evidence: null });
    expect(FX.brief).toContain(QUOTE);
    expect(FX.brief).toContain(GOAL_SENTENCE);
  });

  it('KNOWN GAP 825be021 (732ebe50): the sibling still refuses the existing team\'s quote, so the goal\'s level stays unknown (class fix (b), #3002)', async () => {
    const { goal, existing } = await construct(RAW_732E.raw_text);
    expect(goal.observed_state ?? null).toBeNull();
    expect(existing.observed_state).toMatchObject({ raw_value: 80, source: 'cee_inference', user_material_unverified: true });
  });

  it('70c179df (9e72fd2a): the draft that gave the level keeps it, the same way', async () => {
    const { goal, existing } = await construct(RAW_9E72.raw_text);
    expect(goal.observed_state).toMatchObject(USERS_80);
    expect(existing.observed_state).toMatchObject(USERS_80);
  });

  it('⭐ RED→GREEN: the 9e72 answer with its goal level left null (732e\'s draw on the goal alone) holds the user\'s 80 from the verified quote', async () => {
    const { goal, existing } = await construct(nulledGoal9e72());
    expect(goal.observed_state).toMatchObject(USERS_80);
    expect(existing.observed_state).toMatchObject(USERS_80);
    expect(existing.observed_state.user_material_unverified).toBeUndefined();
  });

  it('a verified level in another unit (5 support agents) neither becomes the goal\'s level nor blocks the user\'s 80', async () => {
    const AGENTS = 'We have 5 support agents.';
    const { goal } = await construct(nulledGoal9e72((d) => {
      (d.factors as Rec[]).push({ label: 'Support agents', role: 'observable', baseline_known: true, baseline_evidence: { quote: AGENTS },
        baseline_value: 5, unit: 'agents', provenance: 'explicit', plausible_max: 50 });
    }), FX.brief.replace(QUOTE, `${QUOTE} ${AGENTS}`));
    expect(goal.observed_state).toMatchObject(USERS_80);
  });

  it('CONTRAST: a quote with no figure verifies nothing; the goal\'s level stays unknown, never Olumi\'s', async () => {
    const { goal, existing } = await construct(nulledGoal9e72((d) => {
      factor(d, 'Existing team capacity').baseline_evidence = { quote: 'Keep current staffing adds no specialist.' };
    }));
    expect(goal.observed_state ?? null).toBeNull();
    expect(existing.observed_state).toMatchObject({ raw_value: 80, source: 'cee_inference', user_material_unverified: true });
  });

  it('CONTRAST: a figure in the wrong unit verifies nothing; the goal\'s level stays unknown', async () => {
    const { goal, existing } = await construct(nulledGoal9e72((d) => { factor(d, 'Existing team capacity').unit = 'tickets per month'; }));
    expect(goal.observed_state ?? null).toBeNull();
    expect(existing.observed_state).toMatchObject({ source: 'cee_inference', user_material_unverified: true });
  });

  it('CONTRAST: with no sentence writing the figure for the goal, the verified factor does not become the goal\'s level', async () => {
    const { goal, existing } = await construct(nulledGoal9e72(), FX.brief.replace(`${GOAL_SENTENCE} `, ''));
    expect(existing.observed_state).toMatchObject(USERS_80);
    expect(goal.observed_state ?? null).toBeNull();
  });
});
