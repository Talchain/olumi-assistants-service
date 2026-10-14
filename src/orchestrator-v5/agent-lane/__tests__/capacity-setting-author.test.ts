/**
 * ⛔ THE USER'S STATED OPTION SETTING IS NEVER OLUMI'S (capacity authorship, DL 14 Oct, (B); judge capacity-post3017 row 7).
 *
 * Served capacity on CEE 5b6e5eb7: the user wrote "Add one specialist adds one specialist."; the drafter quoted it, typed it
 * `explicit`, value 1, `amount_start` on the figure. Construction demoted it to `ai_proposed` because the host figure binder
 * (`verified-option-setting.ts` `figureTheUserWroteForSpan`) refused the sentence, and admission saved it as `cee_hypothesis`,
 * so the chance line counted "Olumi's estimates: … 1 option setting".
 *
 * Now the setting is the user's by its own quote (`quotedOptionSetting`): a whole statement of the brief, the option's label
 * in it, the figure at the drafter's offset in it. A setting that fails is UNKNOWN (`user_material_unverified`), never Olumi's.
 *
 * Real construction (`buildModelFromBrief`) on the PERSISTED served answer (`fixtures/capacity-setting-author-raw-20261014.json`,
 * byte-exact, sha256 checked); the provider is scripted. The failing rows edit one field of that answer each.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { quotedOptionSetting } from '../quoted-option-setting.js';
import { settingAuthorshipOf } from '../../../cee/provenance/provenance-of.js';
import { goalChanceEstimateCounts } from '../goal-chance-estimate-attribution.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/capacity-setting-author-raw-20261014.json', import.meta.url), 'utf8')) as {
  brief: string; brief_sha256: string; raw_text: string; raw_sha256: string };
const QUOTE = 'Add one specialist adds one specialist.';
const draft = (): Rec => JSON.parse(FX.raw_text) as Rec;
const addOne = (d: Rec): Rec => (d.options as Rec[]).find((o) => o.label === 'Add one specialist')!;

async function construct(answer: Rec, brief = FX.brief): Promise<{ graph: Rec; result: Rec }> {
  let graph: Rec | undefined;
  const result = await buildModelFromBrief('ca9ac17e-0000-4000-8000-0000000000c7', brief, (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
  }) as never, (async () => ({ text: JSON.stringify(answer), status: 'completed' })) as never) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 600)).toBe(true);
  return { graph: graph!, result };
}
const nodeOf = (g: Rec, label: string): Rec => (g.nodes as Rec[]).find((n) => n.label === label)!;
/** The option's stored setting on "Additional specialists", and its author by the one authority. */
const setting = (g: Rec, option: string): { cell: Rec; author: string } => {
  const target = nodeOf(g, 'Additional specialists');
  const cell = (nodeOf(g, option).interventions as Rec)[target.id] as Rec;
  return { cell, author: settingAuthorshipOf(cell, target) };
};
const census = (g: Rec, option: string) => {
  const id = nodeOf(g, option).id as string;
  const counts = goalChanceEstimateCounts(g, [id], nodeOf(g, 'Weekly support capacity').id);
  return { olumi: counts.settingsByOption[id] ?? 0, unverified: counts.unverifiedSettingsByOption[id] ?? 0 };
};

describe('an option setting the user stated is theirs by its own quote; otherwise unknown, never Olumi\'s', () => {
  it('PRECONDITION: the persisted answer is byte-exact; the drafter quoted the user\'s sentence with the figure\'s offset', () => {
    expect(createHash('sha256').update(FX.raw_text, 'utf8').digest('hex')).toBe(FX.raw_sha256);
    expect(createHash('sha256').update(FX.brief, 'utf8').digest('hex')).toBe(FX.brief_sha256);
    const iv = addOne(draft()).interventions[0];
    expect(iv).toMatchObject({ factor_label: 'Additional specialists', value: 1, provenance: 'explicit', stated_evidence: { quote: QUOTE, amount_start: 272 } });
    expect(FX.brief.slice(272, 275)).toBe('one');
    expect(quotedOptionSetting(addOne(draft()) as never, iv, FX.brief)).toBe(true);
  });

  it('⭐ RED→GREEN served 5b6e5eb7: "Add one specialist" is saved as the user\'s, not counted as Olumi\'s; Olumi\'s own option stays Olumi\'s', async () => {
    const { graph } = await construct(draft());
    const mine = setting(graph, 'Add one specialist');
    expect(mine.cell).toMatchObject({ source: 'brief_extraction', raw_value: 1 });
    expect(mine.cell).not.toHaveProperty('user_material_unverified');
    expect(mine.author).toBe('user');
    expect(census(graph, 'Add one specialist')).toEqual({ olumi: 0, unverified: 0 });
    // CONTRAST: the option Olumi proposed ("Add two specialists", `ai_proposed`, no quote) is still Olumi's, and counted.
    const olumi = setting(graph, 'Add two specialists');
    expect(olumi.cell).toMatchObject({ source: 'cee_hypothesis', raw_value: 2 });
    expect(olumi.author).toBe('olumi_estimate');
    expect(census(graph, 'Add two specialists')).toEqual({ olumi: 1, unverified: 0 });
  });

  it('a quote that does not hold the option\'s own label → UNKNOWN, never Olumi\'s', async () => {
    const brief = FX.brief.replace(QUOTE, `${QUOTE} The new hire adds one specialist.`);
    const d = draft();
    const other = 'The new hire adds one specialist.';
    addOne(d).interventions[0].stated_evidence = { ...addOne(d).interventions[0].stated_evidence, quote: other, amount_start: brief.indexOf(other) + other.indexOf('one') };
    expect(quotedOptionSetting(addOne(d) as never, addOne(d).interventions[0], brief), 'PRECONDITION: whole, figure placed, label absent').toBe(false);
    const { graph } = await construct(d, brief);
    const mine = setting(graph, 'Add one specialist');
    expect(mine.cell).toMatchObject({ source: 'cee_hypothesis', raw_value: 1, user_material_unverified: true });
    expect(mine.author).toBe('unknown');
    expect(census(graph, 'Add one specialist')).toEqual({ olumi: 0, unverified: 1 });
  });

  it('a figure not at the drafter\'s amount_start (it points at "adds") → UNKNOWN, never Olumi\'s', async () => {
    const d = draft();
    addOne(d).interventions[0].stated_evidence = { ...addOne(d).interventions[0].stated_evidence, amount_start: 267 };
    expect(FX.brief.slice(267, 271)).toBe('adds');
    const { graph } = await construct(d);
    const mine = setting(graph, 'Add one specialist');
    expect(mine.cell).toMatchObject({ source: 'cee_hypothesis', raw_value: 1, user_material_unverified: true });
    expect(mine.author).toBe('unknown');
    expect(census(graph, 'Add one specialist')).toEqual({ olumi: 0, unverified: 1 });
  });

  it('a quote that is not a whole statement of the brief ("adds one specialist.") → not the user\'s', () => {
    const iv = { ...addOne(draft()).interventions[0], stated_evidence: { ...addOne(draft()).interventions[0].stated_evidence, quote: 'adds one specialist.' } };
    expect(quotedOptionSetting(addOne(draft()) as never, iv, FX.brief)).toBe(false);
  });
});
