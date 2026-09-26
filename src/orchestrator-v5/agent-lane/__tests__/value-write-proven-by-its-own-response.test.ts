/**
 * ⛔ "SAVED" MUST BE PROVEN BY *THIS* WRITE'S OWN RESPONSE — never by the model moving.
 *
 * The defect (#1767, `authoriseChange` → `set_factor_value`): after each
 * `factor_value_edit` the capability re-read the whole graph and counted the
 * write as landed when `r.status === 200 && (receipt || graph_hash moved)`.
 * Two facts about the served wire make that a false "saved":
 *
 *   1. A REFUSED `factor_value_edit` answers HTTP 200. `dispatchFactorValueEdit`
 *      commits the refusal as a turn (`commitPerformed: true, graph: null`), so the
 *      route takes `sendFinalised200` — body `blocks: []`, no `graph_hash`, copy
 *      "I … haven't changed anything" (pinned by
 *      `tests/integration/orchestrator/route-v2-factor-value-edit.test.ts`).
 *   2. A guest gets no `model_version_receipt`, so for a guest the only remaining
 *      signal was "the graph hash moved" — which ANY other writer satisfies.
 *
 * What the served response DOES carry per operation, and only on a committed
 * write of THIS request: a `graph_patch` block `{status: 'applied', operation:
 * 'set_factor_value', target_id}` built from this request's own handler fact.
 * `commit.ts` demotes it to `status: 'noop'` when the RPC wrote nothing for this
 * request (replay / reused id), and the handler itself emits `noop` when the
 * model already held the value. So the fake below answers EXACTLY those shapes.
 *
 * Every case binds by identity: the target id, the status, and the exact rows.
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { nextRequest } from './fixtures/next-request.js';

const SCENARIO = '0c9d8e7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f';
/** A guest: the served build mints no receipt the Agent can read for one. */
const guest = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r-guest' };

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> };

const BASE: Node[] = [
  { id: 'win_rate', kind: 'factor', label: 'Win rate', observed_state: { value: 0.3 } },
  { id: 'pro_share', kind: 'factor', label: 'Pro share' },
  { id: 'discount_depth', kind: 'factor', label: 'Discount depth', observed_state: { value: 0.1 } },
];

/** The served refusal body for a `factor_value_edit` — HTTP 200, nothing written. */
const REFUSED_200 = {
  response_version: 2,
  assistant_text: "I couldn't confirm the scale of that value, so I haven't changed anything. Please tell me the amount and unit you mean.",
  blocks: [],
  suggested_actions: [],
  insights: [],
  stage_indicator: 'frame',
};

type Outcome = 'commit' | 'refuse';

/**
 * The product, answering the wire's own shapes. `foreign` runs BETWEEN our read
 * and our write — another writer landing on the same scenario — and it really
 * moves the model and its hash, because that is the situation being tested.
 */
function product(opts: { outcome: Outcome; foreign?: (nodes: Node[]) => Node[]; patchTargetOverride?: string }) {
  let nodes: Node[] = BASE.map((n) => ({ ...n, ...(n.observed_state ? { observed_state: { ...n.observed_state } } : {}) }));
  let rev = 0;
  const posted: { turn_id: string; target_id: string; value: number }[] = [];
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      nodes = (b as { graph: { nodes: Node[] } }).graph.nodes;
      rev += 1;
      return { status: 200, json: { registered: true, graph_hash: `h${rev}` } };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as { kind: string; target_id: string; value: number };
      posted.push({ turn_id: String(b.turn_id), target_id: ev.target_id, value: ev.value });
      if (opts.foreign !== undefined) {
        nodes = opts.foreign(nodes);
        rev += 1;
      }
      if (opts.outcome === 'refuse') return { status: 200, json: { ...REFUSED_200 } };
      const before = nodes.find((n) => n.id === ev.target_id)?.observed_state;
      // The handler's own no-op rule: the model already holds exactly this value.
      const noop = before !== undefined && before.value === ev.value;
      if (!noop) {
        nodes = nodes.map((n) => (n.id === ev.target_id ? { ...n, observed_state: { ...n.observed_state, value: ev.value } } : n));
        rev += 1;
      }
      return {
        status: 200,
        json: {
          response_version: 2,
          assistant_text: noop ? 'That value is already recorded.' : 'Updated.',
          blocks: [{
            type: 'graph_patch',
            status: noop ? 'noop' : 'applied',
            operation: 'set_factor_value',
            target_id: opts.patchTargetOverride ?? ev.target_id,
            before: before ?? null,
            after: { value: ev.value },
          }],
          suggested_actions: [],
          insights: [],
          stage_indicator: 'frame',
          graph_hash: `h${rev}`,
        },
      };
    }
    return { status: 200, json: { graph: { nodes, edges: [] }, graph_hash: `h${rev}` } };
  };
  return { d, posted, rev: () => rev, node: (id: string) => nodes.find((n) => n.id === id) };
}

async function approve(p: ReturnType<typeof product>, assumptions: Record<string, unknown>[]) {
  const caps = createAgentCapabilities(p.d, new ProposalStore());
  const prop = await caps.proposeAssumptions(guest, { assumptions } as never);
  expect(prop.ok, JSON.stringify(prop)).toBe(true);
  const revAtApproval = p.rev();
  const r = await caps.authoriseChange(nextRequest(guest), { proposal_id: String(prop.proposal_id) });
  return { r: r as Record<string, unknown>, revAtApproval };
}

const REVISE_WIN_RATE = [{ factor_label: 'Win rate', value: 0.35, unit: '', basis: 'the user asked for 35%', revise: true }];
const ADOPT_PRO_SHARE = [{ factor_label: 'Pro share', value: 0.4, unit: '', basis: 'a starting assumption' }];

describe('(i) an UNRELATED concurrent edit does not make a refused write "saved"', () => {
  it('⛔ our write is refused while another writer changes a DIFFERENT factor → NOT saved', async () => {
    const p = product({
      outcome: 'refuse',
      foreign: (ns) => ns.map((n) => (n.id === 'discount_depth' ? { ...n, observed_state: { value: 0.2 } } : n)),
    });
    const { r, revAtApproval } = await approve(p, REVISE_WIN_RATE);
    // Preconditions, or the case is vacuous: our write WAS sent, and the graph hash DID move.
    expect(p.posted.map((x) => x.target_id)).toEqual(['win_rate']);
    expect(p.rev(), 'the other writer must really have moved the model').toBeGreaterThan(revAtApproval);
    // The target still reads back a number (its OLD value) — the trap a read-back falls into.
    expect(p.node('win_rate')?.observed_state?.value).toBe(0.3);

    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.applied).toBe(false);
    expect(r.mutated).toBe(false);
    expect(r.values).toEqual([{ factor: 'Win rate', requested: 0.35, recorded: null }]);
    // Olumi's own words about the refusal travel, so the Agent can say why.
    expect(JSON.stringify(r.failures)).toMatch(/haven't changed anything/);
    // No present-state claim the refusal cannot support: the model DID change (someone else).
    expect(String(r.detail)).not.toMatch(/model is unchanged/i);
  });
});

describe('(ii) a SAME-target concurrent edit is not claimed as ours', () => {
  const sameValue = (ns: Node[]) => ns.map((n) => (n.id === 'pro_share' ? { ...n, observed_state: { value: 0.4 } } : n));

  it('⛔ another writer sets the same factor to the same value and our write is REFUSED → NOT saved', async () => {
    const p = product({ outcome: 'refuse', foreign: sameValue });
    const { r } = await approve(p, ADOPT_PRO_SHARE);
    // Precondition: the value the user approved IS in the model — put there by someone else.
    expect(p.node('pro_share')?.observed_state?.value).toBe(0.4);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.values).toEqual([{ factor: 'Pro share', requested: 0.4, recorded: null }]);
  });

  it('⛔ … and when our write finds the value already there, the handler\'s NO-OP is not claimed either', async () => {
    const p = product({ outcome: 'commit', foreign: sameValue });
    const { r } = await approve(p, ADOPT_PRO_SHARE);
    expect(p.node('pro_share')?.observed_state?.value).toBe(0.4);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.values).toEqual([{ factor: 'Pro share', requested: 0.4, recorded: null }]);
  });
});

describe('(iii) our OWN committed write is saved', () => {
  it('⭐ a committed write with no receipt (a guest) is reported saved, from its own applied patch', async () => {
    const p = product({ outcome: 'commit' });
    const { r } = await approve(p, ADOPT_PRO_SHARE);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.applied).toBe(true);
    expect(r.adopted_count).toBe(1);
    expect(r.values).toEqual([{ factor: 'Pro share', requested: 0.4, recorded: 0.4 }]);
    expect(r.receipts).toEqual([]);
  });

  it('⭐ a revision the user named, committed by our write, is saved at the new figure', async () => {
    const p = product({ outcome: 'commit' });
    const { r } = await approve(p, REVISE_WIN_RATE);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.values).toEqual([{ factor: 'Win rate', requested: 0.35, recorded: 0.35 }]);
  });

  it('⛔ CONTROL: an applied patch for a DIFFERENT target is not proof for this one', async () => {
    const p = product({ outcome: 'commit', patchTargetOverride: 'discount_depth' });
    const { r } = await approve(p, ADOPT_PRO_SHARE);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.values).toEqual([{ factor: 'Pro share', requested: 0.4, recorded: null }]);
  });
});
