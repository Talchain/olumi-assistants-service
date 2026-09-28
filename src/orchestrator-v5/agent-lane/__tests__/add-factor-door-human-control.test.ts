/**
 * ⛔ HUMAN CONTROL IS THE PROVENANCE GATE — the add-factor door on the Delivery Lead's own probe corpus (DL ruling on
 * #2235, 14:05Z 28 Sep; corpus `rv2235c-harness/cases.json`, 32 messages × their calls, copied verbatim as
 * `fixtures/efig-door-probe-cases.json` — written by the reviewer, not the author).
 *
 * Three review rounds showed that WHOSE figure it is cannot be read from word proximity in free text: each fix moved the
 * failure to another common phrasing ("£120k a year for seniors…", "respectively", brackets). THE RULE: when the
 * message writes two figures or more, or the change adds two factors or more, the door credits NOTHING by the words
 * alone. A figure must still be WRITTEN in the message (else refused, as before); it is held with Olumi's pairing and the
 * user's own sentence (`quoteOfFigure`), and the user's approval of that card makes it theirs (`confirmed_by_approval`).
 * One figure for one new factor: the strict match decides, as before (`written_about`).
 *
 * Driven through the REAL door (`createAgentCapabilities().proposeNewFactor`) on journey E's served graph, in both units
 * the reviewer used; the product's hold is stubbed to record what it would hold.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { figuresWrittenIn, quoteOfFigure } from '../stated-by-user.js';
import { gmHeldProposalRef } from '../../handlers/edit-graph-referee-gate.js';

type G = { nodes: { id: string; kind: string; label: string }[]; edges: unknown[] };
type Case = { id: string; msg: string; calls: { name: string; factors: { label: string; value: number }[] }[] };
const E07 = JSON.parse(readFileSync(new URL('./fixtures/journey-e-e07-draft-graph.json', import.meta.url), 'utf8')) as G;
const CASES = JSON.parse(readFileSync(new URL('./fixtures/efig-door-probe-cases.json', import.meta.url), 'utf8')) as Case[];
const SID = '550e8400-e29b-41d4-a716-4466554400ab';
const TARGET = E07.nodes.find((n) => n.kind === 'outcome')!.label;

type Held = { label: string; basis?: string; quote?: string; raw: unknown }[];
const doorFor = () => {
  let held: Held | null = null;
  const d: InternalDispatch = async (path) => (path.endsWith('/graph')
    ? { status: 200, json: { graph: { nodes: E07.nodes, edges: E07.edges }, graph_hash: 'h1' } }
    : { status: 404, json: {} });
  const caps = createAgentCapabilities(d, new ProposalStore(), undefined, 'full', undefined, {
    holdAddFactor: async (input) => {
      held = input.factors.map((f) => ({ label: f.label, basis: f.basis, quote: f.quote, raw: (f.observed_state as { raw_value?: unknown }).raw_value }));
      const ids = input.factors.map((f) => f.id!);
      return { status: 'held', proposal_id: gmHeldProposalRef(SID, `node:${ids[0]!}`), factor_ids: ids, public_label: 'Add these factors', held_message: 'Yes, add them.' };
    },
  } as never) as unknown as { proposeNewFactor: (ctx: unknown, args: unknown) => Promise<Record<string, unknown>> };
  return {
    async propose(msg: string, unit: string, factors: { label: string; value: number }[]) {
      held = null;
      const ctx = { scenario_id: SID, authenticated_user_id: null, request_id: 'r', user_text: msg, user_turn_text: msg };
      const args = { factors: factors.map((f) => ({ label: f.label, unit, today: { value: f.value }, affects: TARGET, direction: 'positive' })), rationale: 'probe' };
      const r = await caps.proposeNewFactor(ctx, args);
      return { r, held: held as Held | null };
    },
  };
};

describe('DL ruling on #2235: on the reviewer\'s 32-message corpus, the door never credits a figure by the words when a message holds two figures or the change two factors', () => {
  it.each(['GBP/year per engineer', 'GBP/year'])('RED (unit %s): 0 auto-credits; every held figure is WRITTEN and carries the user\'s own sentence; one figure for one factor keeps the strict match', async (unit) => {
    const door = doorFor();
    let heldCalls = 0;
    let confirmCalls = 0;
    const autoCredits: string[] = [];
    for (const c of CASES) {
      for (const call of c.calls) {
        const { r, held } = await door.propose(c.msg, unit, call.factors);
        const several = figuresWrittenIn(c.msg) >= 2 || call.factors.length >= 2;
        const where = `${c.id}/${call.name}`;
        if (r.ok !== true) {
          expect(held, `${where}: a refused call holds nothing`).toBeNull();
          continue;
        }
        heldCalls += 1;
        expect(held, where).not.toBeNull();
        const shown = r.factors as { label: string; current_value: { value: number; stated_by: string; quote?: string } }[];
        for (const [i, f] of call.factors.entries()) {
          const quote = quoteOfFigure(f.value, unit, c.msg);
          expect(quote, `${where}: a held figure is written in the message`).not.toBeNull();
          expect(held![i]!.quote, where).toBe(quote);
          expect(shown[i]!.current_value.quote, where).toBe(quote);
          if (several) {
            if (held![i]!.basis !== 'confirmed_by_approval' || shown[i]!.current_value.stated_by !== 'user_to_confirm') autoCredits.push(`${where}:${f.label}=${f.value}`);
          } else {
            expect([held![i]!.basis, shown[i]!.current_value.stated_by], where).toEqual(['written_about', 'user']);
          }
        }
        if (several) confirmCalls += 1;
      }
    }
    expect(autoCredits, 'a figure credited by the words alone').toEqual([]);
    // Positive controls: the corpus does reach the hold, and mostly on the confirm path.
    expect(heldCalls).toBeGreaterThan(40);
    expect(confirmCalls).toBeGreaterThan(30);
  }, 120_000);

  it('the served E04 message: the correct pairing AND the swap are both shown for confirmation — each with the user\'s whole sentence; the £400k it never wrote is refused', async () => {
    const door = doorFor();
    const e04 = CASES.find((c) => c.id === 'E04')!.msg;
    for (const pair of [[120000, 65000], [65000, 120000]] as const) {
      const { r, held } = await door.propose(e04, 'GBP/year per engineer', [
        { label: 'Senior engineer salary', value: pair[0] }, { label: 'Junior engineer salary', value: pair[1] }]);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(held!.map((h) => [h.label, h.raw, h.basis, h.quote])).toEqual([
        ['Senior engineer salary', pair[0], 'confirmed_by_approval', e04],
        ['Junior engineer salary', pair[1], 'confirmed_by_approval', e04],
      ]);
    }
    const { r, held } = await door.propose(CASES.find((c) => c.id === 'E04k')!.msg, 'GBP/year per engineer', [{ label: 'Senior engineer salary', value: 400000 }]);
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'today_not_set' }));
    expect(held).toBeNull();
  }, 60_000);
});
