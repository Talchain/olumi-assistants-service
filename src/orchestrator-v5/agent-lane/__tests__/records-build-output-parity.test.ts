/** DL decision rows: retained output requirements, deliberately RED where records has no producer. */
import { describe, expect, it } from 'vitest';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';
// RESTACK2: the served wire is the v-next strict schema; the legacy sealed records no longer build on it, so these rows
// read the v-next hand-typed delta of the SAME sealed brief (sealedRecordsVNext) to keep measuring the loss.
import { BRIEF, sealedRecordsVNext as sealedRecords } from '../../../cee/draft/records/__tests__/compile-spec/sealed-fixture-vnext.js';
import { replayRecordSet } from '../../../cee/draft/records/replay.js';
import { buildModelFromRecords } from '../runtime/build-model-from-records.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { constructionRecords, oversizedConstructionRecords, strictRecordsWire } from './records-wire-fixture.js';

async function build(records: DraftRecordSet, brief: string) {
  const writes: Record<string, unknown>[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('Registration body must be an object.');
      writes.push(body as Record<string, unknown>);
      return { status: 200, json: {} };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] } } };
  };
  const result = await buildModelFromRecords('11111111-1111-4111-8111-111111111111', brief, dispatch,
    async () => ({ text: JSON.stringify(strictRecordsWire(records)) }));
  return { result, writes };
}

describe('DL: accept the loss or port the build-time output', () => {
  // STILL RED, NOT ACCEPTABLE: served readers key on open_questions (write-outcome.ts openQuestionsOf; agent-v1-turn.ts
  // `_agent.open_questions`; UI serverOpenQuestions.ts:84-88). No DL port ruling yet.
  it('asks whether the stated deadline is met on the first reply', async () => {
    const { result } = await build(sealedRecords(), BRIEF);
    expect(result.ok).toBe(true);
    expect(result.open_questions).toContain('Does "Monthly recurring revenue" get there within 9 months? The model holds the deadline; no result answers that yet.');
  });

  // STILL RED, NOT ACCEPTABLE: served readers key on pending_action reconcile_goal_scope (agent-v1-turn.ts:2993,
  // commit.ts:628/1459, persist-graph-write.ts:352, compose/goal-scope-claim-input.ts:18). Needs a records scope carrier.
  it('holds a reconcile_goal_scope action for an ambiguous part-or-whole MRR goal', async () => {
    const records = constructionRecords('Raise Pro to £59', 'MRR', 'Pro plan price');
    const { result } = await build(records, 'Should we raise the Pro plan from £49 to £59 to reach £20k MRR?');
    expect(result.ok).toBe(true);
    expect(result.pending_action).toMatchObject({ action: { kind: 'reconcile_goal_scope' } });
  });

  it('refuses model_too_large before any registration', async () => {
    const { result, writes } = await build(oversizedConstructionRecords(), 'Hire a tech lead for Delivery reliability.');
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'model_too_large' });
    expect(writes).toHaveLength(0);
  });

  it('reports the compact verdict on a successfully built first model', async () => {
    const { result } = await build(constructionRecords(), 'Hire a tech lead for Delivery reliability.');
    expect(result.ok).toBe(true);
    expect(result.within_compact_limits).toBe(true);
    expect(result.size_retried).toBe(false);
  });

  it('marks a machine-added option proposed_by olumi in the persisted graph', async () => {
    const records = constructionRecords(); const ref = records.claims.length;
    records.claims.push({ claim_kind: 'option_refinement', label: 'Phased hiring' },
      { claim_kind: 'causal_link', label: 'Phased level', from_claim: ref, to_claim: 0, sets_to: 6, effect: 'positive' });
    const { result, writes } = await build(records, 'Hire a tech lead for Delivery reliability.');
    expect(result.ok).toBe(true);
    const graph = writes[0]!.graph as { nodes: Array<{ kind: string; label: string; proposed_by?: string }> };
    const option = graph.nodes.find(node => node.kind === 'option' && node.label === 'Phased hiring');
    expect(option, 'contrast control: this machine-added option must survive').toBeDefined();
    expect(option!.proposed_by).toBe('olumi');
  });

  // STILL RED, NOT ACCEPTABLE: served readers key on provenance.clamped_from / natural_effect (refit-frames.ts:116,
  // adjust-edge-strength.ts:509, link-effect-edit.ts:230; UI naturalEffect.ts, edgeSizePhrase.ts). No DL port ruling yet.
  it('stores an unfit stated effect at one with its full coefficient clamped_from', async () => {
    const records = sealedRecords();
    // Keep the user's effect evidence. Widening the source frame makes this coefficient exceed one.
    records.claims[0] = { ...records.claims[0]!, value: 1000000 };
    const compiled = await replayRecordSet(records, { brief: BRIEF });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.detail);
    // Bind by the records' quantity namespace, even when the unfit effect's provenance was withdrawn.
    const sources = compiled.projection.graph.nodes.filter(node => node.kind === 'factor' && node.quantity_ref === records.claims[0]!.quantity);
    const targets = compiled.projection.graph.nodes.filter(node => node.kind === 'outcome' && node.quantity_ref === records.claims[3]!.quantity);
    expect(sources).toHaveLength(1); expect(targets).toHaveLength(1);
    const { result, writes } = await build(records, BRIEF);
    expect(result.ok).toBe(true);
    const graph = writes[0]!.graph as { edges: Array<{ from: string; to: string; strength: { mean: number }; provenance?: {
      source_quote?: string; clamped_from?: number; natural_effect?: { strength_mean: number };
    } }> };
    const edge = graph.edges.find(row => row.from === sources[0]!.id && row.to === targets[0]!.id);
    expect(edge, 'identity: the actual gross-price stated effect').toBeDefined();
    expect(edge!.strength.mean).toBe(1);
    expect(edge!.provenance!.clamped_from).toBeGreaterThan(1);
    expect(edge!.provenance!.natural_effect?.strength_mean).toBe(edge!.provenance!.clamped_from);
    expect(edge!.provenance!.source_quote).toBe(records.stated_items[8]!.source_quote);
  });
});

// ⭐ P2-ACCEPT (DL 5 Oct ~02:1xZ: "a loss may be accepted ONLY where no SERVED reader keys on it"). Each row below is
// KEPT, unedited, as `it.fails`: it still runs, and it turns RED the day a producer ports the output, so the acceptance
// cannot go stale silently. Evidence per key: a full grep of CEE src/ at this branch (excluding the legacy producer
// runtime/build-model.ts and tests) and of the whole UI tree at staging dade7fe8 (tarball, 5,594 src files; contrast
// GRAPH_READY 34 files, proposed_by 18). The table is in REPORT-PASS2.txt.
describe('accepted-losses', () => {
  // level_asks: 0 readers outside runtime/build-model.ts in CEE src (grep -rn level_asks src), 0 in UI src @dade7fe8.
  it.fails('returns typed level_asks for a limited quantity estimated by Olumi', async () => {
    const records = constructionRecords('Raise Pro to £59', 'MRR', 'Monthly churn');
    records.claims[0] = { claim_kind: 'factor', label: 'Monthly churn', value: 3, unit: '%', value_scale: 'raw_count' };
    records.stated_items.push({ kind: 'constraint', source_quote: 'monthly churn under 4%', value: 4, unit: '%',
      direction: 'ceiling', direction_span: { start: 14, end: 19 }, value_span: { start: 20, end: 21 }, applies_to_claim: 0 });
    const { result } = await build(records, 'Raise Pro to £59 to lift MRR, with monthly churn under 4%.');
    expect(result.ok).toBe(true);
    expect(result.level_asks).toHaveLength(1);
  });

  // These fields were present on EVERY legacy successful build, independent of a conditional disclosure.
  // construction_retried: 0 CEE readers / 0 UI; the route trace still reports {retried:false} (records-wiring.test.ts).
  // withheld: 0 readers of the BUILD result's key (the route's `withheld` matches are standing/tool-withholding); 0 UI.
  // options_that_change_nothing: 0 readers of the build result's key; the served capability result carries the same
  //   fact from the readback as `structure.options_that_change_nothing` (agent-capabilities.ts structuralFacts); 0 UI.
  for (const [key, expected] of [
    ['construction_retried', false],
    ['withheld', []],
    ['options_that_change_nothing', []],
  ] as const) {
    it.fails(`preserves ${key} on a successful first build`, async () => {
      const { result } = await build(constructionRecords(), 'Hire a tech lead for Delivery reliability.');
      expect(result.ok).toBe(true);
      expect(result[key]).toEqual(expected);
    });
  }
  // projected_field_count: 0 CEE readers outside its legacy producer (build-model.ts:2013); 0 UI.
  it.fails('reports the projected field count for its construction disclosures', async () => {
    const { result } = await build(constructionRecords(), 'Hire a tech lead for Delivery reliability.');
    expect(result.ok).toBe(true);
    expect(result.projected_field_count).toBeTypeOf('number');
  });
});
