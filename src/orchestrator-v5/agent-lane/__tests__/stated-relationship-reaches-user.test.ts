/**
 * #2576 item E (DL: NEVER A SILENT DROP): every relationship the user stated that item A leaves out of the
 * Olumi-attributed notice count reaches the user, through the served reader, in their own words with a plain reason.
 */
import { describe, expect, it } from 'vitest';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';
import { BRIEF, sealedRecordsVNextLinked } from '../../../cee/draft/records/__tests__/compile-spec/sealed-fixture-vnext.js';
import { replayRecordSet } from '../../../cee/draft/records/replay.js';
import { NOTICE_KIND_BY_REASON } from '../../../cee/draft/records/model-building-notices.js';
import { STATED_ITEM_DROP_KIND } from '../../../cee/draft/records/projector.js';
import { statedRelationshipQuestions } from '../../../cee/draft/records/stated-relationship-asks.js';
import { buildModelFromRecords } from '../runtime/build-model-from-records.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { openQuestionsForReply } from '../write-outcome.js';
import { constructionRecords, strictRecordsWire } from './records-wire-fixture.js';

const NO_EFFECT = 'Raising prices will not change monthly support cost.';
const BRIEF_E = `${BRIEF} ${NO_EFFECT}`;
function withNoEffect(): DraftRecordSet {
  const records = sealedRecordsVNextLinked();
  records.stated_items.push({ kind: 'cause', source_quote: NO_EFFECT, relationship: { from_quantity: 3, to_quantity: 13, no_effect_literal: 'will not change' } } as never);
  return records;
}
async function build(records: DraftRecordSet, brief: string) {
  const dispatch: InternalDispatch = async (path) => (path.endsWith('/graph/register')
    ? { status: 200, json: {} } : { status: 200, json: { graph: { nodes: [], edges: [] } } });
  const result = await buildModelFromRecords('11111111-1111-4111-8111-111111111111', brief, dispatch, async () => ({ text: JSON.stringify(strictRecordsWire(records)) }));
  expect(result.ok).toBe(true);
  return result;
}

describe('#2576 item E: a user\'s relationship left out of the notice count is asked, never dropped', () => {
  it('every stated relationship_not_used row (the rows item A excludes) is in the served questions, once, by its own words', async () => {
    const records = withNoEffect();
    const compiled = await replayRecordSet(records, { brief: BRIEF_E });
    if (!compiled.ok) throw new Error(compiled.detail);
    const excluded = compiled.projection.dropped.filter((d) => d.claim_kind === STATED_ITEM_DROP_KIND
      && NOTICE_KIND_BY_REASON[d.reason] === 'relationship_not_used');
    expect(excluded.filter((d) => d.label === NO_EFFECT).map((d) => d.reason)).toEqual(['user_stated_no_effect']);
    const questions = openQuestionsForReply(await build(records, BRIEF_E));
    for (const d of excluded) expect(questions.filter((q) => q.includes(`"${d.label}"`)), d.reason).toHaveLength(1);
    // The no-effect statement: the user's own words, what the model did with them, and the one edit offered.
    expect(questions).toContain(`You said "${NO_EFFECT}", so the model has no link between them. If you're not sure, add the link back to see how much it would matter.`);
    for (const q of questions.filter((x) => x.includes(NO_EFFECT))) expect(q).not.toMatch(/[a-z]+_[a-z_]+/);
  });

  it('contrast: a build with no rejected stated relationship asks none of these', async () => {
    const result = await build(constructionRecords(), 'Hire a tech lead for Delivery reliability.');
    expect(openQuestionsForReply(result).some((q) => /add the link back|the model couldn't use this as written/.test(q))).toBe(false);
    expect(statedRelationshipQuestions([])).toEqual([]);
  });

  it('a row the compiler already asks (a stated limit\'s unresolved reference) is not asked twice; a CLAIM row is never asked here', () => {
    const base = { claim_index: -1, claim_kind: STATED_ITEM_DROP_KIND, stated_index: 3, label: 'Cap spend at £50k' };
    expect(statedRelationshipQuestions([{ ...base, reason: 'missing_ref' }])).toEqual([]);
    expect(statedRelationshipQuestions([{ ...base, reason: 'relationship_unsized' }])).toHaveLength(1);
    expect(statedRelationshipQuestions([{ ...base, claim_kind: 'causal_link', claim_index: 4, reason: 'relationship_unsized' }])).toEqual([]);
  });
});
