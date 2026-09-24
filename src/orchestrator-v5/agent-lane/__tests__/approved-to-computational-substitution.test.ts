/**
 * ⛔⛔ THE TWO-WRITE SEQUENCE — the case the lane's other tests could not reach,
 * because they INJECTED the substitution fact instead of producing one.
 *
 * ⚠ CHANGES_REQUIRED at `4c2d40b6`, accepted in full, and it is the same shape as
 * the disclosure defect one layer down: the READER was innocent, the PRODUCER was
 * wrong.
 *
 * A person approves a bare amount of 40 on a factor with no range.
 *   write 1 (values) → stores 40
 *   write 2 (frame)  → attaches a 0-to-100 range, registers {value: 0.4, raw_value: 40, cap: 100}
 * `rescaled_by_the_model` was computed from the read taken BEFORE write 2, so it
 * came out EMPTY — and the reply said the approved figures were "stored unchanged"
 * while the analysis went on to compute with 0.4.
 *
 * The person authored 40; 0.4 is the product's encoding of it. Authorship requires
 * the translation to be legible, and no consumer could recover it because the fact
 * was never emitted.
 */
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> };

/**
 * A live-shaped double: the value write lands via the turn route, the frame write
 * lands via `/graph/register`, and every read returns the CURRENT nodes — so the
 * two writes are genuinely sequential and the second is visible to a later read.
 * That sequencing is the whole test; a double that froze the graph could not
 * distinguish the pre-frame row from the post-frame one.
 */
function product(startFramed: boolean) {
  const registered: unknown[] = [];
  let nodes: Node[] = [{
    id: 'monthly_churn_rate',
    kind: 'factor',
    label: 'Monthly churn rate',
    ...(startFramed ? { observed_state: { cap: 100 } } : {}),
  }];
  let rev = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      registered.push(b);
      const g = (b as { graph?: { nodes?: Node[] } }).graph;
      if (g?.nodes !== undefined) nodes = g.nodes;
      rev += 1;
      return { status: 200, json: {} };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as { target_id: string; value: number };
      nodes = nodes.map((n) => (n.id === ev.target_id
        ? { ...n, observed_state: { ...n.observed_state, value: ev.value, raw_value: ev.value } }
        : n));
      rev += 1;
      return { status: 200, json: { assistant_text: 'Updated.' } };
    }
    return { status: 200, json: { graph: { nodes, edges: [] }, graph_hash: `h${rev}` } };
  };
  return { d, registered, read: () => nodes };
}

async function authorise(value: number, startFramed = false) {
  const p = product(startFramed);
  const caps = createAgentCapabilities(p.d, new ProposalStore());
  const prop = await caps.proposeAssumptions(
    ctx as never,
    { assumptions: [{ factor_label: 'Monthly churn rate', value, unit: '%', basis: 'stated' }] } as never,
  );
  const r = await caps.authoriseChange(ctx as never, { proposal_id: String(prop.proposal_id) } as never);
  return { p, r: r as Record<string, unknown> };
}

describe('a first bare amount: the approved→computational substitution is EMITTED', () => {
  it('⛔⛔ THE DEFECT: `rescaled_by_the_model` names the 40 → 0.4 substitution', async () => {
    const { r } = await authorise(40);
    const agent = r as {
      ranges_added_for_analysis?: { factor: string; range: number }[];
      rescaled_by_the_model?: { factor: string; requested: number; recorded: number | null }[];
      must_disclose_rescaling?: boolean;
    };
    // ⭐ PREMISE, asserted rather than assumed: a range really was attached. Without
    // this the headline could pass because nothing happened at all.
    const range = (agent.ranges_added_for_analysis ?? [])[0]?.range;
    expect(range, 'premise fails: no range attached, so there is no substitution to report').toBeGreaterThan(1);
    // ⭐ THE REPAIR: the pair is emitted, and it is the FINAL pair, not the pre-frame one.
    const pairs = agent.rescaled_by_the_model ?? [];
    expect(pairs, 'the approved→computational substitution was not emitted at all').toHaveLength(1);
    expect(pairs[0].requested).toBe(40);
    expect(pairs[0].recorded).toBeCloseTo(40 / (range as number), 12);
    expect(pairs[0].recorded).not.toBe(40);
    expect(agent.must_disclose_rescaling).toBe(true);
  });

  it('⛔ and the reply no longer claims the approved figures are "stored unchanged"', async () => {
    // That sentence is what hid the translation. Bound to the CLAIM, so a reword
    // that keeps the falsehood still fails.
    const { r } = await authorise(40);
    const text = String((r as { not_represented?: unknown }).not_represented ?? '');
    expect(text).not.toContain('stored unchanged');
    // ⭐ BOTH representations named: the authored figure and the computed one.
    expect(text).toContain('kept exactly as they gave it');
    expect(text).toContain('measured against its range');
    expect(text).toContain('state BOTH');
  });

  it('⭐ CONTRAST: a factor that already HAS a range reports no new substitution claim', async () => {
    // The discriminator. If the re-derivation were unconditional it would invent a
    // substitution here, where no frame was added by this turn.
    const { r } = await authorise(40, true);
    expect((r as { ranges_added_for_analysis?: unknown[] }).ranges_added_for_analysis ?? []).toHaveLength(0);
    expect(String(r.not_represented ?? '')).not.toContain('state BOTH');
  });
});
