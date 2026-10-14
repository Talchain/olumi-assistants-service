/**
 * ⛔ THE USER'S STATED OPTION SETTING IS NEVER OLUMI'S (capacity authorship row 7, DL 14 Oct; judge capacity-post3017 row 7).
 *
 * Served capacity on CEE 5b6e5eb7: the user wrote "Add one specialist adds one specialist."; the drafter quoted it and typed
 * it `explicit`, value 1. The verifier (`verifiedOptionSetting`) cannot credit that sentence, so construction demoted it to
 * `ai_proposed`, admission saved it as `cee_hypothesis`, and the chance line counted "Olumi's estimates: … 1 option setting".
 *
 * Now a setting the drafter called the user's that the verifier cannot credit is UNKNOWN (`user_material_unverified`): the
 * one authority reads it so, and the census discloses it as unverified, never as Olumi's estimate. What the verifier credits
 * is unchanged (its precision corpus, r5, is untouched), and Olumi's own proposals stay Olumi's.
 *
 * Real construction (`buildModelFromBrief`) on the PERSISTED served answer (`fixtures/capacity-setting-author-raw-20261014.json`,
 * byte-exact, sha256 checked); the provider is scripted.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { verifiedOptionSetting } from '../verified-option-setting.js';
import { settingAuthorshipOf } from '../../../cee/provenance/provenance-of.js';
import { goalChanceEstimateCounts } from '../goal-chance-estimate-attribution.js';
import { admitted, level, prepare, probes } from './fixtures/r5-verified-cases.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/capacity-setting-author-raw-20261014.json', import.meta.url), 'utf8')) as {
  brief: string; brief_sha256: string; raw_text: string; raw_sha256: string };
const QUOTE = 'Add one specialist adds one specialist.';
const draft = (): Rec => JSON.parse(FX.raw_text) as Rec;
const addOne = (d: Rec): Rec => (d.options as Rec[]).find((o) => o.label === 'Add one specialist')!;

async function construct(answer: Rec): Promise<Rec> {
  let graph: Rec | undefined;
  const result = await buildModelFromBrief('ca9ac17e-0000-4000-8000-0000000000c7', FX.brief, (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
  }) as never, (async () => ({ text: JSON.stringify(answer), status: 'completed' })) as never) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 600)).toBe(true);
  return graph!;
}
const nodeOf = (g: Rec, label: string): Rec => (g.nodes as Rec[]).find((n) => n.label === label)!;
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

describe('a setting the drafter called the user\'s that the verifier cannot credit is UNKNOWN, never Olumi\'s', () => {
  it('PRECONDITION: the persisted answer is byte-exact; the drafter quoted the user\'s sentence; the verifier cannot credit it', () => {
    expect(createHash('sha256').update(FX.raw_text, 'utf8').digest('hex')).toBe(FX.raw_sha256);
    expect(createHash('sha256').update(FX.brief, 'utf8').digest('hex')).toBe(FX.brief_sha256);
    const iv = addOne(draft()).interventions[0];
    expect(iv).toMatchObject({ factor_label: 'Additional specialists', value: 1, provenance: 'explicit', stated_evidence: { quote: QUOTE } });
    expect(verifiedOptionSetting(draft() as never, addOne(draft()) as never, iv, FX.brief)).toBe(false);
  });

  it('⭐ RED→GREEN served 5b6e5eb7: "Add one specialist" is UNKNOWN (disclosed as unverified), never counted as Olumi\'s; Olumi\'s own option stays Olumi\'s', async () => {
    const graph = await construct(draft());
    const mine = setting(graph, 'Add one specialist');
    expect(mine.cell).toMatchObject({ source: 'cee_hypothesis', raw_value: 1, user_material_unverified: true });
    expect(mine.author).toBe('unknown');
    expect(census(graph, 'Add one specialist')).toEqual({ olumi: 0, unverified: 1 });
    // CONTRAST: the option Olumi proposed ("Add two specialists", `ai_proposed`, no quote) is still Olumi's, and counted.
    const olumi = setting(graph, 'Add two specialists');
    expect(olumi.cell).toMatchObject({ source: 'cee_hypothesis', raw_value: 2 });
    expect(olumi.cell).not.toHaveProperty('user_material_unverified');
    expect(olumi.author).toBe('olumi_estimate');
    expect(census(graph, 'Add two specialists')).toEqual({ olumi: 1, unverified: 0 });
  });

  it('CONTRAST: a setting the verifier credits (r5 B-N0, the served clinic sentence) is still the user\'s, with no unknown stamp', () => {
    const p = probes.find((x) => x.id === 'B-N0')!;
    const m = structuredClone(p.model);
    Object.assign(level(m, p.option, p.factor), { stated_evidence: p.evidence });
    const prepared = prepare(m, p.brief).candidate;
    expect(level(prepared, p.option, p.factor).provenance).toBe('explicit');
    const a = admitted(prepared, p.brief);
    const factor = a.nodes.find((n) => n.label === p.factor)!;
    const cell = a.nodes.find((n) => n.label === p.option)!.interventions![factor.id] as Rec;
    expect(cell.source).toBe('brief_extraction');
    expect(cell).not.toHaveProperty('user_material_unverified');
    expect(settingAuthorshipOf(cell, factor)).toBe('user');
  });
});
