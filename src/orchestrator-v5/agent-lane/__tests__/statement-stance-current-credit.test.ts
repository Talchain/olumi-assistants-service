/**
 * ⭐ STANCE: ONLY A DECLARED CURRENT FIGURE IS CREDITED AS THE USER'S CURRENT LEVEL (DL-3 steer 19 Oct; AIE ask #94 6270168415;
 * approach prompt/STANCE-FIELD/APPROACH-v2.md). Synthetic brief HS3: "Suppose we hired 8 temporary pickers who each packed 25 orders
 * a day." Measured on real drafts + the real admission (hypothetical-n8): the supposed 25 was saved as the factor's current level,
 * credited as the user's, in 4/24 head and 3/24 base drafts. The drafter now DECLARES each figure's stance; the host credits a
 * current level only on `stated_current`, after its existing literal checks. Real buildModelFromBrief + admission; the provider
 * output is the recorded raw (0 calls).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/stance-hs3-raw.json', import.meta.url), 'utf8')) as { brief: string; raw: Rec };
const SID = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';

async function admit(raw: Rec): Promise<Rec> {
  let graph: Rec | undefined; let n = 0;
  const result = await buildModelFromBrief(SID, FX.brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'scratch' } };
  }) as never, (async () => { n += 1; return { text: n === 1 ? JSON.stringify(raw) : JSON.stringify({ options: [], risks: [] }) }; }) as never);
  expect((result as Rec).ok, JSON.stringify(result).slice(0, 400)).toBe(true);
  return graph!;
}
const node = (g: Rec, label: string): Rec => (g.nodes as Rec[]).find((x) => x.label === label)!;
const credited = (n: Rec): boolean => n.provenance === 'from_brief' || n.observed_state?.source === 'brief_extraction';

describe('a figure is credited as the user\'s current level only when its statement declares it current', () => {
  it('RED: the declared-hypothetical 25 per temporary picker is never credited as a current level; the declared-current 1,150 and 30 stay credited', async () => {
    const g = await admit(structuredClone(FX.raw));
    const rate = node(g, 'Orders packed per temporary picker per day');
    expect(credited(rate), JSON.stringify(rate)).toBe(false);
    // Positive controls, same sentence family: the brief's own current figures stay the user's.
    expect(credited(node(g, 'Warehouse staff'))).toBe(true);
    expect((g.nodes as Rec[]).find((x) => x.kind === 'goal')!.observed_state?.raw_value ?? null).not.toBe(25);
  }, 120_000);

  it('RED: a statement-backed figure with NO declared stance is not credited as a current level (fail closed)', async () => {
    const raw = structuredClone(FX.raw);
    for (const s of raw.statements as Rec[]) if (s.value === 25) delete s.stance;
    const rate = node(await admit(raw), 'Orders packed per temporary picker per day');
    expect(credited(rate), JSON.stringify(rate)).toBe(false);
  }, 120_000);

  it('CONTROL: the same figure declared stated_current is credited (the gate reads the declaration, not the sentence\'s words)', async () => {
    const raw = structuredClone(FX.raw);
    for (const s of raw.statements as Rec[]) if (s.value === 25) s.stance = 'stated_current';
    const rate = node(await admit(raw), 'Orders packed per temporary picker per day');
    expect(credited(rate), JSON.stringify(rate)).toBe(true);
  }, 120_000);
});
