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
function product(opts: { frameRefusal?: boolean; competingWriter?: 'attaches_range' | 'changes_value' | 'duplicate_label_frames_the_twin'; readbackFails?: boolean } = {}) {
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
        } else if (opts.competingWriter === 'duplicate_label_frames_the_twin') {
          // ⛔ THE DUPLICATE-LABEL CONTROL. The competing writer renames the SECOND
          // factor to the FIRST one's label and frames only the second. Both now
          // display 'Monthly churn rate'; only `pro_subscribers` has a range, and
          // it appears LATER in the node list — so a `Map<label, node>` built in
          // order resolves BOTH to it and reports every factor as framed, while
          // `monthly_churn_rate` still blocks the analysis.
          nodes = nodes.map((n) => (n.id === 'pro_subscribers'
            ? { ...n, label: 'Monthly churn rate', observed_state: { ...n.observed_state, cap: 1000 } }
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

async function authorise(opts: { frameRefusal?: boolean; competingWriter?: 'attaches_range' | 'changes_value' | 'duplicate_label_frames_the_twin'; readbackFails?: boolean } = {}) {
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

/**
 * ⭐⭐ LIMB 1, THE CALLER-SIDE HALF: an intervening human edit must SURVIVE.
 *
 * The owner note's counterexample: "caller reads label L, another writer renames
 * it, frame update follows — retain the new label or refuse, never restore L."
 * The register route compares in ANALYSIS space, which excludes labels, so the
 * comparison cannot catch this. The only caller-side defence is to stop sending
 * stale bytes: re-read and patch what is actually there.
 */
describe('⛔ LIMB 1 (caller half) — an intervening rename is NOT overwritten', () => {
  /**
   * ⚠ THE WINDOW HAS TO BE THE RIGHT ONE, AND MY FIRST VERSION OF THIS CONTROL
   * WAS VACUOUS. It renamed during the value writes, so the `afterSet` read
   * already contained the rename and BOTH versions preserved it — two mutants
   * passed. Probed the real order instead:
   *
   *   READ(1) propose · READ(2) entry base · VALUE_WRITE · VALUE_WRITE ·
   *   READ(3) afterSet · READ(4) the re-read under test · REGISTER
   *
   * Without the fix there is no READ(4), so the register carries READ(3)'s bytes.
   * The competing rename therefore has to land AFTER READ(3) is served and
   * BEFORE the register — i.e. exactly in the window READ(4) exists to close.
   */
  function renamingProduct(renameAfterRead: number) {
    const registered: { nodes: Node[] }[] = [];
    let nodes: Node[] = BASE.map((n) => ({ ...n }));
    let rev = 0;
    let reads = 0;
    const d: InternalDispatch = async (path, body) => {
      const b = (body ?? {}) as Record<string, unknown>;
      if (path.endsWith('/graph/register')) {
        const g = (b as { graph: { nodes: Node[] } }).graph;
        registered.push({ nodes: g.nodes });
        nodes = g.nodes;
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
      reads += 1;
      const served = { status: 200, json: { graph: { nodes, edges: [] }, graph_hash: `h${rev}` } };
      if (reads === renameAfterRead) {
        // A colleague renames the factor. Invisible to an analysis-space hash,
        // so nothing can refuse it on our behalf — the only defence is to stop
        // sending the bytes we read before it happened.
        nodes = nodes.map((n) => (n.id === 'monthly_churn_rate'
          ? { ...n, label: 'Churn (renamed by a colleague)' }
          : n));
        rev += 1;
      }
      return served;
    };
    return { d, registered, read: () => nodes, reads: () => reads };
  }

  async function run(renameAfterRead: number) {
    const p = renamingProduct(renameAfterRead);
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeAssumptions(ctx as never, ASK as never);
    await caps.authoriseChange(ctx as never, { proposal_id: String(prop.proposal_id) } as never);
    return p;
  }

  it('⛔ the rename SURVIVES a frame write that follows it — it is not restored', async () => {
    const p = await run(3);
    expect(p.reads(), 'the re-read did not happen — control would be vacuous').toBeGreaterThanOrEqual(4);
    const frameWrite = p.registered[p.registered.length - 1];
    expect(frameWrite, 'no register happened — vacuous').toBeDefined();
    const sent = frameWrite.nodes.find((n) => n.id === 'monthly_churn_rate');
    expect(sent, 'factor absent from the written graph').toBeDefined();
    // THE DEFECT: a stale whole-graph replay restores 'Monthly churn rate'.
    expect(sent!.label).toBe('Churn (renamed by a colleague)');
    expect(p.read().find((n) => n.id === 'monthly_churn_rate')?.label).toBe('Churn (renamed by a colleague)');
  });

  it('⭐ and the range it went there to attach still landed', async () => {
    // Preserving the edit must not cost the write its purpose.
    const p = await run(3);
    const os = p.read().find((n) => n.id === 'monthly_churn_rate')?.observed_state as { cap?: number } | undefined;
    expect(os?.cap, 'the range was not attached').toBeGreaterThan(1);
  });
});

/**
 * ⭐⭐ LIMB 1, THE OTHER HALF: the caller must ASSERT the identity it read.
 *
 * Patching fresh bytes (above) preserves an intervening rename. This asserts the
 * complementary property — the write also CARRIES an identity-space expectation,
 * so a rename landing in the window between the caller's read and the route's own
 * is REFUSED rather than silently absorbed.
 *
 * ⛔ WITHOUT THIS THE ROUTE-SIDE CHECK IS DEAD. CEE #1810 makes the register route
 * compare `expected_graph_identity_hash`; if no caller sends one, that comparison
 * never runs and the field is decoration. I split the two halves across PRs and
 * lost this one — the route accepted a field nothing sent.
 */
describe('⛔ LIMB 1 (the assertion half) — the frame write carries the identity it read', () => {
  function identityProduct() {
    const registered: Record<string, unknown>[] = [];
    let nodes: Node[] = BASE.map((n) => ({ ...n }));
    let rev = 0;
    const d: InternalDispatch = async (path, body) => {
      const b = (body ?? {}) as Record<string, unknown>;
      if (path.endsWith('/graph/register')) {
        registered.push(b);
        const g = (b as { graph: { nodes: Node[] } }).graph;
        nodes = g.nodes;
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
      // The read route supplies BOTH hashes; the identity one moves on any edit,
      // including a rename that leaves the analysis hash alone.
      // ⛔⛔ THE ENVELOPE, because that is what the read route actually emits:
      // `graph_identity_hash: computeGraphIdentityHash(graph)` returns
      // `GraphIdentityHash | null` = `{kind, value, algorithm, ...}`
      // (`context/graph-identity.ts:84-91`). This double used to return a BARE
      // STRING, so the suite pinned the opposite of production and could not
      // falsify `String(envelope) === "[object Object]"` — which is exactly what
      // the code under test was sending on every frame write.
      return {
        status: 200,
        json: {
          graph: { nodes, edges: [] },
          graph_hash: `analysis-h${rev}`,
          graph_identity_hash: {
            kind: 'graph_identity_hash',
            value: `identity-h${rev}`,
            algorithm: 'sha256',
            projection_version: 'test',
            graph_schema_version: 'test',
            normaliser_version: 'test',
          },
        },
      };
    };
    return { d, registered };
  }

  it('⭐ the frame write sends expected_graph_identity_hash, from the read it patched', async () => {
    const p = identityProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeAssumptions(ctx as never, ASK as never);
    await caps.authoriseChange(ctx as never, { proposal_id: String(prop.proposal_id) } as never);

    const frame = p.registered[p.registered.length - 1];
    expect(frame, 'no register happened — control would be vacuous').toBeDefined();
    expect(frame.expected_graph_identity_hash, 'the write asserts no identity, so a rename cannot be refused').toMatch(/^identity-h\d+$/);
    // ⛔ THE DISCRIMINATOR: a regression to `String(envelope)` sends this instead,
    // and the register route then refuses EVERY frame write 409 GRAPH_STALE.
    expect(frame.expected_graph_identity_hash).not.toBe('[object Object]');
    // Bound to the SAME read as the analysis expectation, not an older one.
    const n = String(frame.expected_graph_hash).replace('analysis-h', '');
    expect(frame.expected_graph_identity_hash).toBe(`identity-h${n}`);
  });

  it('⛔ it is OMITTED, never fabricated, when the read supplies none', async () => {
    // A hash this code could not read is one it must not assert. Older CEE builds
    // and any degraded read return no identity hash.
    const registered: Record<string, unknown>[] = [];
    let nodes: Node[] = BASE.map((n) => ({ ...n }));
    let rev = 0;
    const d: InternalDispatch = async (path, body) => {
      const b = (body ?? {}) as Record<string, unknown>;
      if (path.endsWith('/graph/register')) { registered.push(b); nodes = (b as { graph: { nodes: Node[] } }).graph.nodes; rev += 1; return { status: 200, json: {} }; }
      if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
        const ev = b.event as { target_id: string; value: number };
        nodes = nodes.map((x) => (x.id === ev.target_id ? { ...x, observed_state: { ...x.observed_state, value: ev.value, raw_value: ev.value } } : x));
        rev += 1; return { status: 200, json: { assistant_text: 'ok' } };
      }
      return { status: 200, json: { graph: { nodes, edges: [] }, graph_hash: `analysis-h${rev}` } };
    };
    const caps = createAgentCapabilities(d, new ProposalStore());
    const prop = await caps.proposeAssumptions(ctx as never, ASK as never);
    await caps.authoriseChange(ctx as never, { proposal_id: String(prop.proposal_id) } as never);
    const frame = registered[registered.length - 1];
    expect(frame).toBeDefined();
    expect('expected_graph_identity_hash' in frame, 'fabricated an identity the read never supplied').toBe(false);
    // The analysis expectation still goes, so the write stays conditional.
    expect(frame.expected_graph_hash).toBeDefined();
  });
});


/**
 * ⛔⛔ THE DUPLICATE-LABEL STALE REFUSAL — accepted from independent review of
 * #1743, and it is the sharper half of that finding.
 *
 * The post-refusal readback joined the fresh canonical nodes by
 * `Map<label, node>`, where the LAST duplicate label wins. A label is a value
 * another object can satisfy, so binding a user-facing claim to one is the
 * estate's own named trap — and I walked into it while fixing the RENAME case,
 * which an id join handles for free.
 *
 * Control: two factors both display 'Monthly churn rate'. `pro_subscribers` is
 * framed by a competing writer and appears later; `monthly_churn_rate` is still
 * unframed and still blocks the analysis.
 */
describe('⛔ THE DUPLICATE-LABEL CONTROL — a claim is bound to the node ID, never to its label', () => {
  it('⛔⛔ THE DEFECT: the still-unframed factor is NOT resolved away by its framed twin', async () => {
    const { r } = await authorise({ frameRefusal: true, competingWriter: 'duplicate_label_frames_the_twin' });
    const agent = r as { ranges_not_attached?: { factor: string }[]; analysis_still_blocked_for?: string[] };
    // With the label join this array was EMPTY and the reply said every factor now
    // had a range — while the analysis stayed blocked.
    expect(agent.ranges_not_attached ?? []).toHaveLength(1);
    expect(agent.analysis_still_blocked_for ?? []).toHaveLength(1);
    await Promise.resolve();
  });

  it('⭐ CONTRAST: with UNIQUE labels the same competing writer classifies correctly', async () => {
    // The discriminator. If the fix merely stopped dropping entries, this would
    // over-report: here the competing writer frames the factor this turn wanted to
    // frame, so it must be dropped.
    const { r } = await authorise({ frameRefusal: true, competingWriter: 'attaches_range' });
    const agent = r as { ranges_not_attached?: { factor: string }[] };
    const named = (agent.ranges_not_attached ?? []).map((f) => f.factor);
    expect(named).not.toContain('Monthly churn rate');
  });

  it('⭐ the wire payload shape is unchanged — the internal id is stripped', async () => {
    // `IntendedFrame` carries `id` internally so the join can be by identity; the
    // emitted entries must still be exactly `{factor, value, range}`.
    const { r } = await authorise({ frameRefusal: true, competingWriter: 'duplicate_label_frames_the_twin' });
    const agent = r as { ranges_not_attached?: Record<string, unknown>[] };
    for (const e of agent.ranges_not_attached ?? []) {
      expect(Object.keys(e).sort()).toEqual(['factor', 'range', 'value']);
    }
  });
});
