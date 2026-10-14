/**
 * ⭐ STATED CAPACITY CHAIN (DL 14 Oct 17:21Z; HIRING's diagnosis of Paul's scenario c1494f4d). Paul's brief states the team's
 * capacity (six developers, 25% of their time on legacy fixes). The served drafter declared developers × feature time as a
 * product, but its "Legacy-code reduction" option set only the legacy share (25 → 15), never the feature-time share in the product, so the option never
 * touched the chain and the forecast showed it identical to carrying on as now.
 *
 * The drafter text now asks for the chain as an identity, for every share an option frees or takes, and for the option's
 * setting on the chain's own factors. A time-freeing option has ONE mechanism, the chain (HIRING's identity ratio; DL 17:5xZ):
 * it gets no Olumi pace (`added_capacity`), so the forecast never counts it twice. The text is bound by identity (`tests/fixtures/drafter-capacity-chain/chain.json`). The corpus is
 * not the author's: Paul's served brief and the drafter's recorded answer to it (`served-c1494f4d.json`, `_source`), through
 * the real `buildModelFromBrief`. Whether the drafter now behaves so is AI behaviour, measured on the served build.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILD_INSTRUCTIONS, buildModelFromBrief } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const TEXT = JSON.parse(readFileSync('tests/fixtures/drafter-capacity-chain/chain.json', 'utf8')) as { chain: string };
const HIRE_PACE = 'Each option adding capacity supplies added_capacity {monthly_share_pct, lead_months_low, lead_months_high}: your estimate of extra percentage of the deliverable per month (0–100%) and recruitment/notice/onboarding lead time.';
const SERVED = JSON.parse(readFileSync('tests/fixtures/drafter-capacity-chain/served-c1494f4d.json', 'utf8')) as { brief: string; draft: Rec };
const sid = '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';

/** The real build of Paul's brief, the drafter answering `draft`: the first request sent and the registered graph. */
async function build(draft: Rec): Promise<{ sent: Rec; graph: Rec }> {
  let sent: Rec | undefined;
  let graph: Rec | undefined;
  const result = await buildModelFromBrief(sid, SERVED.brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async (req: Rec) => { sent ??= structuredClone(req); return { text: JSON.stringify(draft), status: 'completed' }; }) as never) as Rec;
  if (result.ok !== true || sent === undefined || graph === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return { sent, graph };
}

describe('the stated capacity chain is drafted as an identity the options act through', () => {
  it('RED: the SENT drafter request for Paul\'s brief carries the chain rule once, after the unchanged hiring pace', async () => {
    const { sent } = await build(SERVED.draft);
    const sentText = sent.instructions as string;
    expect(sentText.split(TEXT.chain)).toHaveLength(2);
    expect(BUILD_INSTRUCTIONS.split(TEXT.chain)).toHaveLength(2);
    // Contrast in the same request: the pace for an option that adds people is sent unchanged, and the status quo still has none.
    expect(sentText).toContain(`${HIRE_PACE} Disclose these as Olumi’s estimates, never user figures. The status quo has added_capacity null. ${TEXT.chain} Preserve stated limits`);
  });

  it('PRECONDITION (served answer): the legacy option sets only the legacy share, never the product\'s feature-time share, so it never reaches the product', () => {
    const { draft } = SERVED;
    expect(draft.identities).toEqual([expect.objectContaining({ outcome: 'Feature development capacity', operation: 'product', factors: ['Mid-weight developers', 'Time on feature work'] })]);
    const legacy = (draft.options as Rec[]).find((o) => o.label === 'Legacy-code reduction')!;
    expect(legacy.interventions.map((i: Rec) => [i.factor_label, i.value])).toEqual([['Time on legacy fixes', 15]]);
    expect(legacy.added_capacity).toBeNull(); // Right under the DL's ruling: its one mechanism is the chain.
    // Contrast: the hire option does act on a chain factor (developers 6 → 8), with its pace.
    const hire = (draft.options as Rec[]).find((o) => o.label === 'Add two developers')!;
    expect(hire.interventions.map((i: Rec) => [i.factor_label, i.value])).toEqual([['Mid-weight developers', 8]]);
    expect(hire.added_capacity).toEqual({ monthly_share_pct: 8, lead_months_low: 2, lead_months_high: 4 });
  });
});
