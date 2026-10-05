/**
 * LOCAL-ONLY rows over the banked 20-draw construction bank (vnext-5x3-unresolved-20261005) and the builder's
 * self-authored CEILING pass fixtures (rows (b), (c) bank arms, (h); design DESIGN-SENTENCE-PASS.md §6). Both live in the
 * eval estate, never in this repo (held-out briefs are not copied here), so every row skips when they are absent.
 * Any figure from these rows is a CEILING (self-authored), never a result.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { replayRecordSet } from '../replay.js';
import { buildSentenceInventory, parseSentencePassOutput } from '../sentence-pass.js';
import { mergeSentenceLinks } from '../sentence-links.js';
import { omitOptionalRecordNulls } from '../../../../orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import type { DraftRecordSet } from '../grammar.js';

const EVAL = '/Users/paulslee/Documents/GitHub/output/olumi-aie-eval-executor-20261003/drafting-extraction-20261004';
const BANK = `${EVAL}/vnext-5x3-unresolved-20261005/bank`;
const CEILING = '/private/tmp/mc-sentence-out/ceiling';
const BRIEFS: Record<string, string> = {
  sealed: `${EVAL}/live-draws-20261004/sealed.txt`, heldout1: `${EVAL}/heldout-20261004/brief-1.txt`,
  heldout2: `${EVAL}/heldout-20261004/brief-2.txt`, heldout3: `${EVAL}/heldout-20261004/brief-3-a994c38a.txt`,
};
const present = existsSync(BANK) && Object.values(BRIEFS).every(existsSync) && existsSync(`${CEILING}/sealed.json`);

type Draw = { name: string; draw: number; brief: string; raw: DraftRecordSet };
function draws(): Draw[] {
  const out: Draw[] = [];
  const files = readdirSync(BANK);
  for (const [name, file] of Object.entries(BRIEFS)) {
    const brief = readFileSync(file, 'utf8').trim();
    for (let draw = 1; draw <= 5; draw++) {
      const hit = files.find((f) => new RegExp(`-d${draw}-c1\\.json$`).test(f) && JSON.parse(readFileSync(`${BANK}/${f}`, 'utf8')).brief_sha256 !== undefined
        && JSON.parse(readFileSync(`${BANK}/${f}`, 'utf8')).brief_sha256 === sha(brief));
      if (hit === undefined) continue;
      const body = JSON.parse(JSON.parse(readFileSync(`${BANK}/${hit}`, 'utf8')).raw_body) as { output: { type: string; content?: { type: string; text?: string }[] }[] };
      const text = body.output.filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join('');
      out.push({ name, draw, brief, raw: omitOptionalRecordNulls(JSON.parse(text)) as DraftRecordSet });
    }
  }
  return out;
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ceiling = (name: string) => {
  const parsed = parseSentencePassOutput(readFileSync(`${CEILING}/${name}.json`, 'utf8'));
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.records;
};
async function mergeDraw(d: Draw) {
  const main = await replayRecordSet(d.raw, { brief: d.brief });
  if (!main.ok) throw new Error(main.reason);
  const merge = mergeSentenceLinks({ brief: d.brief, main: d.raw, inventory: buildSentenceInventory(d.brief), pass: ceiling(d.name),
    facts: { dropped: main.projection.dropped, dispositions: main.projection.stated_dispositions ?? [] } });
  const after = await replayRecordSet(merge.records, { brief: d.brief });
  return { main, merge, after };
}

describe.skipIf(!present)('LOCAL-ONLY bank rows (CEILING, self-authored pass)', () => {
  it('(b) quote uniqueness over the 20 banked record sets; a non-unique or non-verbatim quote is never aligned', async () => {
    const all = draws();
    expect(all.length).toBe(20);
    let unique = 0, repeated = 0, absent = 0;
    for (const d of all) for (const item of d.raw.stated_items) {
      const at = d.brief.indexOf(item.source_quote);
      if (at < 0) absent += 1; else if (at !== d.brief.lastIndexOf(item.source_quote)) repeated += 1; else unique += 1;
    }
    // MEASURED here, beside the design's 286/4/1 (its tally may differ: it counted the bank before fix (a)'s shape).
    console.log(JSON.stringify({ row: 'b', unique, repeated, absent }));
    expect(repeated + absent).toBeGreaterThan(0);
    for (const d of all.filter((x) => x.name !== 'heldout3')) {
      const { merge } = await mergeDraw(d);
      for (const fill of merge.fills) {
        if (fill.mode === 'appended') continue;
        const quote = d.raw.stated_items[fill.stated_index]!.source_quote;
        const at = d.brief.indexOf(quote);
        expect(at >= 0 && at === d.brief.lastIndexOf(quote), `${d.name}-d${d.draw} fill on a non-unique quote`).toBe(true);
      }
    }
  });
  it('(c) bakery d1/d2: a goal direction left unresolved is filled floor from "reach"', async () => {
    for (const d of draws().filter((x) => x.name === 'heldout2' && x.draw <= 2)) {
      const { merge } = await mergeDraw(d);
      const goal = d.raw.stated_items.findIndex((i) => i.kind === 'goal');
      const raw = d.raw.stated_items[goal] as unknown as Record<string, unknown>;
      console.log(JSON.stringify({ row: 'c-bakery', draw: d.draw, main_direction: raw.direction, merged: merge.records.stated_items[goal]!.direction }));
      if (raw.direction === 'unresolved') expect(merge.records.stated_items[goal]).toMatchObject({ direction: 'floor', direction_literal: 'reach' });
    }
  });
  // Design §6 said "causes 8-10"; at this HEAD cause 10 is already CARRIED by fix (d), so it must NOT be touched.
  it('(c) sealed d1: the refused causes 8 and 9 are filled and re-judged by the compile; carried cause 10 is never overwritten', async () => {
    const d = draws().find((x) => x.name === 'sealed' && x.draw === 1)!;
    const { merge, after } = await mergeDraw(d);
    const filled = merge.fills.filter((f) => f.field === 'relationship').map((f) => f.stated_index);
    console.log(JSON.stringify({ row: 'c-sealed-d1', filled, refusals: merge.refusals, after: [8, 9, 10].map((i) => after.ok ? after.projection.stated_dispositions!.find((x) => x.stated_index === i) : null).map((x) => x && { i: x.stated_index, d: x.disposition, r: (x as { reason?: string }).reason }) }));
    expect(filled).toEqual(expect.arrayContaining([8, 9]));
    expect(filled).not.toContain(10);
    expect(merge.refusals).toContainEqual(expect.objectContaining({ stated_index: 10, reason: 'main_link_compiled' }));
  });
  it('(h) sealed d1: the invented "Net MRR Change" / "MRR Target Progress" claims are set aside by rule (e) once stated paths exist', async () => {
    const d = draws().find((x) => x.name === 'sealed' && x.draw === 1)!;
    const { after } = await mergeDraw(d);
    if (!after.ok) throw new Error('merged compile refused');
    const labels = (after.graph as { nodes: { label?: string }[] }).nodes.map((n) => n.label);
    const setAside = after.projection.dropped.filter((x) => x.reason === 'superseded_by_stated_path' || x.reason === 'invented_root_level_unknown').map((x) => x.label);
    console.log(JSON.stringify({ row: 'h', labels, setAside }));
    expect(labels).not.toContain('Net MRR Change');
    expect(labels).not.toContain('MRR Target Progress');
  });
});
