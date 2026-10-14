/**
 * ⭐ GEN D4 ITEM A (DL 14 Oct; the AIE's text, packet fc17c200, #94 6163023819): THE DERIVED NO-CHANGE
 * CHANGE IS THE DRIFT FACTOR'S VALUE. T5-integrated (staging 14b1e544) D4, both runs: the drafter set the drift factor
 * to today's structural 0 and carried the +2 weeks on the definitional link (r2 at 2 per 1, a two-for-one), so the
 * no-change path stayed at 8 weeks. The NO-CHANGE FORECAST paragraph named the +2 but never the field that holds it.
 *
 * The text is bound by identity (`tests/fixtures/forecast-drift-value/forecast-drift-value.json`). The corpus is not the
 * author's: T5-integrated D4 r2's registered brief and recorded drafter answer (`_source`), through the real
 * `buildModelFromBrief`. Whether the drafter now writes the drift's value is AI behaviour, measured on the served build.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCandidateSchema, buildModelFromBrief } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const TEXT = (JSON.parse(readFileSync('tests/fixtures/forecast-drift-value/forecast-drift-value.json', 'utf8')) as { drift_value: string }).drift_value;
const D4 = JSON.parse(readFileSync('tests/fixtures/forecast-drift-value/t5-integrated-d4-r2.json', 'utf8')) as { brief: string; text: string };
/** The end of the AIE's signed NO-CHANGE FORECAST paragraph (pinned whole by `constructor-text-d1-d4.test.ts`). */
const ANCHOR = 'Keep the original forecast sentence and its source alongside the derived change in the available evidence and question carriers.';
const sid = '4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d';

/** The first request the real build path sends the drafter for D4's brief (the drafter answers with the recorded raw). */
async function firstRequest(): Promise<Rec> {
  let sent: Rec | undefined;
  await buildModelFromBrief(sid, D4.brief, (async (path: string) => {
    if (path.endsWith('/graph/register')) return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async (req: Rec) => { sent ??= structuredClone(req); return { text: D4.text, status: 'completed' }; }) as never);
  if (sent === undefined) throw new Error('the drafter was never called');
  return sent;
}

describe('GEN D4 item A: the drafter is told the derived change is the drift factor\'s value', () => {
  it('PRECONDITION: the recorded D4 answer drafted the drift at 0 and the +2 on the link, at 2 per 1', () => {
    const draft = JSON.parse(D4.text) as { factors: Rec[]; links: Rec[] };
    const drift = draft.factors.find((f) => /drift/i.test(f.label));
    expect(drift?.baseline_value).toBe(0);
    const link = draft.links.find((l) => l.from === drift?.label);
    expect([link?.effect_amount, link?.effect_per_source_change, link?.definitional]).toEqual([2, 1, true]);
  });

  it('RED: the SENT instructions carry the text directly after the AIE\'s forecast paragraph, which stays whole', async () => {
    const instructions = (await firstRequest()).instructions as string;
    const at = instructions.indexOf(ANCHOR);
    expect(at, 'contrast: the NO-CHANGE FORECAST paragraph is sent').toBeGreaterThan(-1);
    expect(instructions.indexOf(TEXT)).toBe(at + ANCHOR.length + 1);
  });

  it('CONTROL: the definitional link\'s own description still states the forecast as one for one', () => {
    const links = (buildCandidateSchema().properties as Rec).links;
    expect(links.items.properties.definitional.description).toContain(
      'a supported derived no-change forecast change contributes one for one to that SAME quantity at its stated horizon: effect_amount 1, effect_per_source_change 1',
    );
  });
});
