/**
 * #2576 item D (DL; Integrator): the agent route carries the construction's `model_building_notices` — route-v2's key
 * and shape — produced by the REAL records build and validated at the pinned contract. Route-v2 is untouched.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ModelBuildingNoticesSchema } from '@talchain/schemas/boundary';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';
import { BRIEF, sealedRecordsVNextLinked } from '../../../cee/draft/records/__tests__/compile-spec/sealed-fixture-vnext.js';
import { replayRecordSet } from '../../../cee/draft/records/replay.js';
import { buildModelBuildingNotices } from '../../../cee/draft/records/model-building-notices.js';
import { buildModelFromRecords, omitOptionalRecordNulls } from '../runtime/build-model-from-records.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { constructionNoticesOf } from '../construction-notices.js';
import { constructionRecords, strictRecordsWire } from './records-wire-fixture.js';

async function build(records: DraftRecordSet, brief: string) {
  const dispatch: InternalDispatch = async (path) => (path.endsWith('/graph/register')
    ? { status: 200, json: {} } : { status: 200, json: { graph: { nodes: [], edges: [] } } });
  const result = await buildModelFromRecords('11111111-1111-4111-8111-111111111111', brief, dispatch, async () => ({ text: JSON.stringify(strictRecordsWire(records)) }));
  expect(result.ok).toBe(true);
  return result;
}
/** The sealed draft with one unresolvable Olumi link: a refusal the notices must count. */
function refusing(): DraftRecordSet {
  const records = sealedRecordsVNextLinked();
  records.claims.push({ claim_kind: 'causal_link', label: 'Unresolved endpoint', from_claim: 999, to_stated: 6, effect: 'positive' });
  return records;
}
const turn = (result: unknown) => ({ tool_calls: [{ name: 'build_model_from_brief' }], tool_results: [result] });

describe('#2576 item D: the agent route\'s construct turn carries notices that parse', () => {
  it('the build carries the producer\'s notices over its own typed rows; the turn reader returns them, valid at 0.76.0', async () => {
    const records = refusing();
    const compiled = await replayRecordSet(records, { brief: BRIEF });
    if (!compiled.ok) throw new Error(compiled.detail);
    const expected = buildModelBuildingNotices(compiled.projection.dropped);
    expect(expected).toBeDefined();
    const result = await build(records, BRIEF);
    expect(result.model_building_notices).toEqual(expected);
    const read = constructionNoticesOf(turn(result));
    expect(read).toEqual(expected);
    expect(ModelBuildingNoticesSchema.safeParse(read).success).toBe(true);
  });

  it('contrast: a build\'s key is exactly the producer\'s over its own rows; no build call → nothing; an invalid carrier is omitted', async () => {
    const records = constructionRecords();
    const brief = 'Hire a tech lead for Delivery reliability.';
    // The build compiles the WIRE (absent required links sent as "unresolved"), so the expectation does too.
    const compiled = await replayRecordSet(omitOptionalRecordNulls(strictRecordsWire(records)) as DraftRecordSet, { brief });
    if (!compiled.ok) throw new Error(compiled.detail);
    const expected = buildModelBuildingNotices(compiled.projection.dropped);
    const other = await build(records, brief);
    if (expected === undefined) expect(other).not.toHaveProperty('model_building_notices');
    else expect(other.model_building_notices).toEqual(expected);
    expect(constructionNoticesOf({ tool_calls: [{ name: 'build_model_from_brief' }], tool_results: [{ ok: false }] })).toBeUndefined();
    expect(constructionNoticesOf({ tool_calls: [{ name: 'read_model' }], tool_results: [{ model_building_notices: { total_count: 1, groups: [{ kind: 'other', count: 1 }], details_redacted: true } }] })).toBeUndefined();
    expect(constructionNoticesOf(turn({ model_building_notices: { total_count: 2, groups: [{ kind: 'other', count: 1 }], details_redacted: true } }))).toBeUndefined();
  });

  it('source pin: the agent route spreads the reader into the response body; route-v2 keeps its own writer unchanged', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route).toMatch(/const notices = constructionNoticesOf\(result\); return notices !== undefined \? \{ model_building_notices: notices \} : \{\};/);
    const v2 = readFileSync(new URL('../../handlers/draft-graph-dispatch.ts', import.meta.url), 'utf8');
    expect(v2).toContain('model_building_notices: result.modelBuildingNotices,');
    expect(v2).not.toContain('constructionNoticesOf');
  });
});
