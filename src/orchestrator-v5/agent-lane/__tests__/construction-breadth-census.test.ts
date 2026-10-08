/**
 * S7 model construction: the construction-breadth census as a RATCHET (DL re-anchor, #87 6070463409 / 6070497270).
 *
 * Each of the 116 recorded drafter outputs (fixtures/s7-construction-census) is replayed 0-LLM through the real
 * buildModelFromBrief, and the registered graph is scored by the typed predicate diagnoseDraft. A draft is NARROW when
 * it has fewer than two risks, no risk on an active option's path, or no second option on a proven-distinct lever.
 *
 * Done for S7 = 0 narrow drafts. The baseline (scripts/ci/construction-breadth-baseline.json) may only shrink:
 * a newly narrow draft fails, and a draft that became sufficient fails until its id is removed from the baseline.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { diagnoseDraft } from '../runtime/widen-draft.js';

type Rec = Record<string, unknown>;
interface CorpusRow { readonly id: string; readonly brief: string; readonly drafter_texts: readonly string[] }
interface Baseline { readonly narrow_count: number; readonly narrow_ids: readonly string[] }

const CORPUS = path.join(__dirname, 'fixtures/s7-construction-census/corpus.json.gz');
const BASELINE = path.resolve(__dirname, '../../../../scripts/ci/construction-breadth-baseline.json');
const SCENARIO = '00000000-0000-4000-8000-000000000077';

async function registeredGraph(row: CorpusRow): Promise<Rec | null> {
  let i = 0;
  let registered: Rec | null = null;
  const dispatch = async (p: string, body: unknown) => {
    if (p.endsWith('/graph/register')) { registered = body as Rec; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (p.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    if (p.endsWith('/graph')) return { status: 200, json: { graph: (registered?.graph as Rec | undefined) ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
    return { status: 404, json: {} };
  };
  const drafter = async () => ({ text: row.drafter_texts[Math.min(i++, row.drafter_texts.length - 1)]!, status: 'completed' });
  await buildModelFromBrief(SCENARIO, row.brief, dispatch as never, drafter as never);
  return ((registered as Rec | null)?.graph as Rec | undefined) ?? null;
}

describe('S7 construction-breadth census (ratchet)', () => {
  it('narrow drafts never grow, and a fixed draft is removed from the baseline', async () => {
    const corpus = JSON.parse(zlib.gunzipSync(fs.readFileSync(CORPUS)).toString('utf8')) as CorpusRow[];
    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as Baseline;
    expect(corpus).toHaveLength(116);
    expect(baseline.narrow_ids).toHaveLength(baseline.narrow_count);

    const narrow: string[] = [];
    let sufficient = 0;
    for (const row of corpus) {
      const graph = await registeredGraph(row);
      expect(graph, `${row.id}: no graph registered`).not.toBeNull();
      const d = diagnoseDraft(graph);
      if (d.risks !== null || d.options !== null) narrow.push(row.id); else sufficient++;
    }
    // Contrast: the predicate separates the corpus (some of each), so a probe that reads every draft alike fails here.
    expect(narrow.length).toBeGreaterThan(0);
    expect(sufficient).toBeGreaterThan(0);

    const allowed = new Set(baseline.narrow_ids);
    const newlyNarrow = narrow.filter(id => !allowed.has(id));
    expect(newlyNarrow, 'drafts that became NARROW (construction regressed)').toEqual([]);
    const nowSufficient = baseline.narrow_ids.filter(id => !narrow.includes(id));
    expect(nowSufficient, 'drafts now sufficient: remove these ids and lower narrow_count in the baseline').toEqual([]);
  }, 120_000);
});
