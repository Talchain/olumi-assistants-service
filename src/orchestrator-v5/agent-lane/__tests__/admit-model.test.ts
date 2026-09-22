/**
 * Whole-candidate admission, against the captured live run.
 *
 * The fixtures are the verbatim 22 Sep outputs of the banked chain, so these
 * assertions are about a real producer, not about my model of one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { admitCandidateModel, slugId, type CandidateModel, type WidenerAdditions } from '../admit-model.js';

const here = new URL('./fixtures/', import.meta.url);
const faithful = JSON.parse(readFileSync(new URL('faithful.json', here), 'utf8')) as CandidateModel;
const widened = JSON.parse(readFileSync(new URL('widened.json', here), 'utf8')) as WidenerAdditions;

const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

describe('admitCandidateModel — captured candidate', () => {
  it('admits the whole candidate: nodes and edges', () => {
    const m = admitCandidateModel(faithful, widened);
    // 10 faithful entities + 16 widener additions, minus none (no label collisions).
    expect(m.nodes.length).toBeGreaterThanOrEqual(20);
    expect(m.edges.length).toBeGreaterThan(0);
  });

  /**
   * ⭐ A REAL PROPERTY OF THE PRODUCER, FOUND BY RUNNING IT.
   *
   * The builder names the constraint metric "monthly churn" while the factor it
   * plainly refers to is labelled "Monthly churn rate". They are not equal, and
   * attaching on a near-match would be guessing which quantity the user's own
   * constraint governs — the exact fabrication this lane forbids.
   *
   * So the constraint is NOT attached. But it is user-authored, so it must never
   * be dropped quietly either: it leaves a `warn` in the ledger naming the metric
   * that could not be resolved. Resolving it is a question for the user, not a
   * guess for the admitter.
   */
  it("does not attach a user constraint to a near-matching node, and says so loudly", () => {
    const m = admitCandidateModel(faithful, widened);
    expect(faithful.constraints[0].metric).toBe('monthly churn');
    expect(m.nodes.some((n) => n.label === 'Monthly churn rate')).toBe(true);
    expect(m.nodes.some((n) => n.label === 'monthly churn')).toBe(false);

    expect(m.goal_constraints).toHaveLength(0);
    const entry = m.loss.find((l) => l.field_path.includes('monthly churn') && l.field_path.endsWith('.node_id'));
    expect(entry, "a dropped user constraint must be recorded").toBeDefined();
    expect(entry!.severity).toBe('warn');
  });

  it('CONTROL: when the metric does resolve, the constraint IS attached', () => {
    const aligned = {
      ...faithful,
      constraints: [{ ...faithful.constraints[0], metric: 'Monthly churn rate' }],
    } as CandidateModel;
    const m = admitCandidateModel(aligned, widened);
    expect(m.goal_constraints).toHaveLength(1);
    expect(m.goal_constraints[0].operator).toBe('<=');
    expect(m.goal_constraints[0].value).toBe(4);
    expect(m.goal_constraints[0].node_id).toBe('monthly_churn_rate');
  });

  it('every node id is canonical and unique', () => {
    const m = admitCandidateModel(faithful, widened);
    const ids = m.nodes.map((n) => n.id);
    expect(new Set(ids).size, 'ids must be unique').toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9_:-]+$/);
      expect(id.length).toBeLessThanOrEqual(100);
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('is DETERMINISTIC — the same candidate yields a byte-identical model', () => {
    const a = admitCandidateModel(faithful, widened);
    const b = admitCandidateModel(faithful, widened);
    expect(digest({ n: a.nodes, e: a.edges, c: a.goal_constraints }))
      .toBe(digest({ n: b.nodes, e: b.edges, c: b.goal_constraints }));
  });

  it('writes a baseline ONLY where the candidate says one is known', () => {
    const m = admitCandidateModel(faithful, widened);
    const withState = m.nodes.filter((n) => n.observed_state !== undefined);
    const knownInCandidate = faithful.factors.filter((f) => f.baseline_known && typeof f.baseline_value === 'number');
    expect(withState).toHaveLength(knownInCandidate.length);
    // CONTROL: the capture must contain at least one known and one unknown baseline,
    // or this assertion proves nothing.
    expect(knownInCandidate.length).toBeGreaterThan(0);
    expect(faithful.factors.filter((f) => !f.baseline_known).length).toBeGreaterThan(0);
    for (const n of withState) expect(typeof n.observed_state!.value).toBe('number');
  });

  it('never claims user authorship for a widener addition', () => {
    const m = admitCandidateModel(faithful, widened);
    const proposedLabels = new Set([
      ...(widened.proposed_options ?? []).map((o) => o.label),
      ...(widened.proposed_factors ?? []).map((f) => f.label),
      ...(widened.proposed_risks ?? []).map((r) => r.label),
      ...(widened.proposed_outcomes ?? []).map((o) => o.label),
    ]);
    expect(proposedLabels.size).toBeGreaterThan(0);
    for (const n of m.nodes) {
      if (proposedLabels.has(n.label)) {
        // Node display vocabulary is a string enum; `user_set` would be the lie.
        expect(n.provenance, `${n.label} must not read as user-authored`).toBe('ai_inferred');
        expect(m.inference_classes[n.id]).toBe('model_proposed');
      }
    }
  });

  it('withholds a link to an entity the candidate never declared', () => {
    const withDangling = {
      ...widened,
      proposed_links: [
        ...(widened.proposed_links ?? []),
        { from: 'Pro plan price', to: 'A factor nobody declared', direction: 'positive' as const, provenance: 'ai_proposed' },
      ],
    };
    const m = admitCandidateModel(faithful, withDangling);
    const w = m.withheld.find((x) => x.to === 'A factor nobody declared');
    expect(w, 'dangling endpoint must be withheld').toBeDefined();
    expect(w!.reason).toBe('unresolved_endpoint');
    expect(m.edges.some((e) => e.to.includes('nobody_declared'))).toBe(false);
  });

  it('slugId produces canonical tokens', () => {
    expect(slugId('Pro plan price')).toBe('pro_plan_price');
    expect(slugId('£59 / month!')).toBe('59_month');
    expect(slugId('!!!')).toBe('node');
  });
});
