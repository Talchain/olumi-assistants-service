/**
 * ⛔⛔ THE PARTIAL OUTCOME MUST BE TOLD TRUTHFULLY.
 *
 * Owner finding (PR #1743, note 5799139118, limb 2): the adopted-assumption path
 * saves the factor VALUES in their own registration, then attempts a second
 * registration to attach a range. If that second write is refused, the reply said
 * *"nothing was written"* — while the values had already landed — and still
 * reported applied/mutated success.
 *
 * That is the worst shape of untrue: it invites the user to redo a write that
 * succeeded, and hides that the analysis is still blocked.
 *
 * These are the owner note's own minimum controls: a POSITIVE control (unchanged
 * model accepts the frame) and a PARTIAL-OUTCOME control (value lands, frame CAS
 * refuses → the reply states the saved value and the unattached range).
 */
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> };
const BASE: Node[] = [
  { id: 'monthly_churn_rate', kind: 'factor', label: 'Monthly churn rate' },
  { id: 'pro_subscribers', kind: 'factor', label: 'Pro subscribers' },
];

const ASK = {
  assumptions: [
    { factor_label: 'Monthly churn rate', value: 3.5, unit: '%', basis: 'typical B2B SaaS baseline' },
    { factor_label: 'Pro subscribers', value: 400, unit: 'subscribers', basis: 'implied by a target' },
  ],
};

/**
 * `frameRefusal` refuses ONLY the frame registration, after the values landed.
 *
 * ⛔ `competingWriter` IS THE CONTROL THAT WAS MISSING. CHANGES_REQUIRED on
 * `a6dc18be`: *"The new test double returns 409 without modifying its graph, so
 * its assertions cannot falsify this race."* A GRAPH_STALE refusal MEANS someone
 * else moved the canonical graph — so a double that refuses while leaving the
 * graph untouched is not modelling the refusal at all, and every claim about
 * "unchanged values" passed against it for free.
 *   · 'attaches_range' — the competing writer supplies the very range this turn
 *     was trying to attach. The reply must then NOT say the factor still lacks
 *     one.
 *   · 'changes_value'  — the competing writer overwrites an approved value. The
 *     reply must NOT call it unchanged or safe.
 */
function product(opts: { frameRefusal?: boolean; competingWriter?: 'attaches_range' | 'changes_value'; readbackFails?: boolean } = {}) {
  const posted: { target_id: string; value: number }[] = [];
  // Counted so a control can prove the re-read HAPPENED, not just that the
  // wording changed. Without it the two claims above cannot be derived at all.
  let reads = 0;
  let refused = false;
  const registered: unknown[] = [];
  let nodes: Node[] = BASE.map((n) => ({ ...n }));
  let rev = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      if (opts.frameRefusal === true) {
        // The concurrent writer moved the model between the value write and this
        // — and it ACTUALLY MOVES IT, because that is what GRAPH_STALE means.
        if (opts.competingWriter === 'attaches_range') {
          nodes = nodes.map((n) => (n.id === 'monthly_churn_rate'
            ? { ...n, observed_state: { ...n.observed_state, cap: 100 } }
            : n));
        } else if (opts.competingWriter === 'changes_value') {
          nodes = nodes.map((n) => (n.id === 'monthly_churn_rate'
            ? { ...n, observed_state: { ...n.observed_state, value: 99, raw_value: 99 } }
            : n));
        }
        rev += 1;
        refused = true;
        return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      }
      const g = (b as { graph: { nodes: Node[] } }).graph;
      registered.push(b);
      nodes = g.nodes;
      rev += 1;
      return { status: 200, json: {} };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as { target_id: string; value: number };
      posted.push({ target_id: ev.target_id, value: ev.value });
      nodes = nodes.map((n) => (n.id === ev.target_id
        ? { ...n, observed_state: { ...n.observed_state, value: ev.value, raw_value: ev.value } }
        : n));
      rev += 1;
      return { status: 200, json: { assistant_text: 'Updated.' } };
    }
    reads += 1;
    // Models a readback that fails only AFTER the refusal, so the unknown-state
    // branch is reachable without breaking the entry read the turn depends on.
    if (opts.readbackFails === true && refused) return { status: 503, json: {} };
    return { status: 200, json: { graph: { nodes, edges: [] }, graph_hash: `h${rev}` } };
  };
  return { d, posted, registered, read: () => nodes, reads: () => reads };
}

async function authorise(opts: { frameRefusal?: boolean; competingWriter?: 'attaches_range' | 'changes_value'; readbackFails?: boolean } = {}) {
  const p = product(opts);
  const caps = createAgentCapabilities(p.d, new ProposalStore());
  const prop = await caps.proposeAssumptions(ctx as never, ASK as never);
  const r = await caps.authoriseChange(ctx as never, { proposal_id: String(prop.proposal_id) } as never);
  return { p, r: r as Record<string, unknown> };
}

describe('POSITIVE CONTROL — an unchanged model accepts the intended frame', () => {
  it('⭐ attaches the range and reports NO partial outcome', async () => {
    const { p, r } = await authorise();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(p.posted.length, 'no value was written — the control would be vacuous').toBeGreaterThan(0);
    expect(r.ranges_added_for_analysis, JSON.stringify(r)).toBeDefined();
    // The discriminator: nothing claims a partial outcome when there is none.
    expect(r.partially_applied).toBeUndefined();
    expect(r.ranges_not_attached).toBeUndefined();
    expect(r.analysis_still_blocked_for).toBeUndefined();
  });
});

describe('PARTIAL-OUTCOME CONTROL — the value landed, the range did not', () => {
  it('⛔ NEVER says nothing was written once a value has landed', async () => {
    const { p, r } = await authorise({ frameRefusal: true });
    // Precondition: the values really did land before the frame write failed.
    expect(p.posted.map((x) => x.target_id)).toEqual(['monthly_churn_rate', 'pro_subscribers']);

    const failures = (r.failures ?? []) as { factor?: string; detail: string }[];
    const frame = failures.find((f) => f.factor === 'scale_frame');
    expect(frame, 'no scale_frame failure recorded — this assertion would be vacuous').toBeDefined();
    // THE ORIGINAL DEFECT: this exact sentence was shown to a user whose values
    // had saved.
    expect(frame!.detail).not.toContain('nothing was written');
    // ⚠ AND THE SECOND DEFECT, which this test USED to pin as correct: it then
    // asserted the values "WERE saved and are unchanged". A GRAPH_STALE refusal
    // cannot establish that — the competing writer may have changed them. The
    // reply must describe the model from a re-read instead.
    expect(frame!.detail).not.toContain('unchanged');
    expect(frame!.detail.toLowerCase()).toContain('read');
  });

  it('⭐ reports the saved values and the unattached range SEPARATELY', async () => {
    const { r } = await authorise({ frameRefusal: true });
    // What landed.
    expect(r.adopted_count, JSON.stringify(r)).toBe(2);
    // What did not, by identity — the factors, not a count.
    expect(r.partially_applied).toBe(true);
    const blocked = (r.analysis_still_blocked_for ?? []) as string[];
    expect(blocked.sort()).toEqual(['Monthly churn rate', 'Pro subscribers']);
    const notAttached = (r.ranges_not_attached ?? []) as { factor: string; range: number }[];
    expect(notAttached.length).toBe(2);
    for (const n of notAttached) expect(n.range).toBeGreaterThan(1);
    // And it must NOT also claim the ranges were added.
    expect(r.ranges_added_for_analysis).toBeUndefined();
  });

  it('⛔ does NOT tell the model the values are safe — it directs it to the current model', async () => {
    // ⚠ THIS TEST PREVIOUSLY ASSERTED THE OPPOSITE and was wrong. Telling the
    // user their figures are safe, off a stale read, is advice that can lose
    // their work if a competing writer changed one.
    const { r } = await authorise({ frameRefusal: true });
    const owed = String(r.not_represented ?? '');
    expect(owed).toContain('as it now stands');
    expect(owed).not.toContain('are safe or unchanged unless the current model shows it.'.replace(' unless the current model shows it.', '.'));
  });
});


describe('⛔ THE COMPETING WRITER CONTROL — a refusal means the model MOVED', () => {
  it('⭐ does NOT claim a factor still lacks a range when the other writer supplied one', async () => {
    // The refusal proves only that THIS frame write did not land. If the
    // competing writer attached the very range we wanted, saying it is still
    // missing is a false statement about the user's model.
    const { r } = await authorise({ frameRefusal: true, competingWriter: 'attaches_range' });
    const blocked = (r.analysis_still_blocked_for ?? []) as string[];
    expect(blocked).not.toContain('Monthly churn rate');
    const failures = (r.failures ?? []) as { factor?: string; detail: string }[];
    const frame = failures.find((f) => f.factor === 'scale_frame');
    expect(frame, 'no scale_frame failure — vacuous').toBeDefined();
    expect(frame!.detail).not.toContain('still have no range: Monthly churn rate');
  });

  it('⛔ NEVER calls the values unchanged or safe when another writer changed one', async () => {
    const { r } = await authorise({ frameRefusal: true, competingWriter: 'changes_value' });
    const failures = (r.failures ?? []) as { factor?: string; detail: string }[];
    const frame = failures.find((f) => f.factor === 'scale_frame')!;
    for (const forbidden of ['are unchanged', 'WERE saved', 'Do not re-enter', 'do NOT need']) {
      expect(frame.detail, `asserted "${forbidden}" about a model it had not re-read`).not.toContain(forbidden);
    }
    // ⚠ PRECISE, NOT CRUDE. The guidance legitimately contains the WORD
    // "unchanged" while forbidding the claim ("do not tell the user their
    // figures are safe or unchanged unless the current model shows it"), so a
    // bare substring ban would fail on correct copy. Ban the ASSERTION.
    const owed = String(r.not_represented ?? '');
    expect(owed).not.toContain('values were saved and are unchanged');
    expect(owed).toContain('as it now stands');
  });

  it('⭐ it RE-READS on refusal — the claim is derived, not asserted', async () => {
    // Discriminator: without the re-read the reply cannot know either of the
    // two facts above, so this pins the mechanism and not just the wording.
    const { p } = await authorise({ frameRefusal: true, competingWriter: 'attaches_range' });
    // A read after the refused register is what makes the derivation possible.
    expect(p.reads(), 'no graph read happened after the refusal').toBeGreaterThan(1);
  });

  it('⛔ when the re-read is UNAVAILABLE it says the current state is unknown', async () => {
    const { r } = await authorise({ frameRefusal: true, readbackFails: true });
    const failures = (r.failures ?? []) as { factor?: string; detail: string }[];
    const frame = failures.find((f) => f.factor === 'scale_frame')!;
    expect(frame.detail).toContain('ALL UNKNOWN');
    expect(frame.detail).not.toContain('Do not re-enter');
    // ⚠ The historical fact is allowed, but ONLY bound to its own tense — it may
    // not read as a claim about the model now. Stating a bare fact beside an
    // UNKNOWN invites the reader to act on the fact.
    expect(frame.detail).toContain('AT THE TIME');
    expect(frame.detail).not.toContain('are unchanged');
    expect(frame.detail).toContain('do not tell the user their figures are safe');
  });
});


describe('⛔ THE FIELD NAME CARRIES ITS OWN GUARANTEE', () => {
  it('⭐ `ranges_not_attached` appears ONLY when a readback verified the absence', async () => {
    // CHANGES_REQUIRED on #1751 f028650d: a consumer cannot distinguish a
    // verified absence from an intended one, so it inferred "still needs a
    // range" from the field alone. The contract is fixed HERE: no verification,
    // no field.
    const { r } = await authorise({ frameRefusal: true, readbackFails: true });
    expect(r.ranges_not_attached).toBeUndefined();
    expect(r.analysis_still_blocked_for).toBeUndefined();
    expect(r.current_state_unknown).toBe(true);
    expect(r.partially_applied).toBe(true);
  });

  it('⭐ a verified absence DOES carry the field, and no unknown marker', async () => {
    const { r } = await authorise({ frameRefusal: true });
    const notAttached = (r.ranges_not_attached ?? []) as { factor: string }[];
    expect(notAttached.length).toBeGreaterThan(0);
    expect(r.current_state_unknown).toBeUndefined();
  });

  it('⛔ a competing writer that SUPPLIED the range removes it from the field', async () => {
    // The discriminator between "verified" and "intended": this factor is no
    // longer unranged, so the field must not name it.
    const { r } = await authorise({ frameRefusal: true, competingWriter: 'attaches_range' });
    const notAttached = ((r.ranges_not_attached ?? []) as { factor: string }[]).map((f) => f.factor);
    expect(notAttached).not.toContain('Monthly churn rate');
  });
});
