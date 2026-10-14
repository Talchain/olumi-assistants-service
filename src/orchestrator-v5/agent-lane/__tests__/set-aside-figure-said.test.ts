/**
 * ⭐ A KEPT QUESTION NEVER STATES A SET-ASIDE FIGURE AS THE MODEL'S (DL 14 Oct; undeployed/INVENTED-FIGURES.md, the one
 * unsupported AI figure in 457). Served hiring post3021 turn 01: the drafter's question restating its £120,000 / £90,000
 * cost estimates was kept beside the contract's "…so it was not used" for those links, and the AI said "The model has
 * provisional annual cost estimates of £120,000 … and £90,000". The model holds a placeholder.
 *
 * Corpus: that turn's recorded drafter answer and its brief (`fixtures/hiring-post3021-turn01-drafter.json`, `_source`),
 * through the real `buildModelFromBrief`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/hiring-post3021-turn01-drafter.json', import.meta.url), 'utf8')) as { brief: string; text: string };
const sid = '3caff495-5f7b-452e-92b3-4ba24eb90bef';
const COSTS = 'Olumi’s provisional annual fully loaded cost estimates are £120,000 for a Tech lead and £90,000 per mid-weight developer. Do these match the relevant hiring costs and the period covered by the £200,000 budget?';
const NOTE = ' Olumi set those estimates aside, so the model does not use them yet: ‘Tech lead hires’ → ‘Hiring spend’ and ‘Developer hires’ → ‘Hiring spend’.';

async function asked(draft: Rec = JSON.parse(SERVED.text) as Rec): Promise<string[]> {
  const result = await buildModelFromBrief(sid, SERVED.brief, (async (path: string) => {
    if (path.endsWith('/graph/register')) return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: JSON.stringify(draft), status: 'completed' })) as never) as Rec;
  if (result.ok !== true) throw new Error(JSON.stringify(result).slice(0, 1500));
  return result.open_questions as string[];
}
const withQuestion = (q: string, concerns: string[]): Rec => {
  const d = JSON.parse(SERVED.text) as Rec;
  d.unknowns = [...d.unknowns, q];
  d.unknown_concerns = [...d.unknown_concerns, { unknown: q, concerns }];
  return d;
};

describe('a kept question that states a figure Olumi set aside says that the model does not use it', () => {
  it('PRECONDITION (served): both cost links are set aside, and the contract asks each with "it was not used"', async () => {
    const qs = await asked();
    expect(qs.filter((q) => /raises "Hiring spend" by .* so it was not used/.test(q))).toHaveLength(2);
  });

  it('RED (served turn 01): the drafter\'s cost question is kept, and says once that those estimates are not in the model', async () => {
    const qs = await asked();
    expect(qs).toContain(COSTS + NOTE);
    expect(qs.filter((q) => q.startsWith(COSTS))).toHaveLength(1);
  });

  it('CONTRAST: a question bound to a set-aside link that states no figure is unchanged', async () => {
    const q = 'Which costs should count against the hiring budget?';
    expect(await asked(withQuestion(q, ['Tech lead hires → Hiring spend', 'Hiring spend']))).toContain(q);
  });

  it('CONTRAST (no number match): the same figure in a question NOT bound to a set-aside link is unchanged', async () => {
    const q = 'Is £120,000 of the budget already committed elsewhere?';
    expect(await asked(withQuestion(q, ['Hiring spend']))).toContain(q);
  });

  it('CONTROL: the productivity question (its links are not set aside) is unchanged', async () => {
    const d = JSON.parse(SERVED.text) as Rec;
    const qs = await asked();
    expect(qs).toContain(d.unknowns[0]);
  });
});
