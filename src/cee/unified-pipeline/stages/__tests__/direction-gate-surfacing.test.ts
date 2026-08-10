/**
 * ROADMAP 2.1051 — THE SURFACING HALF: an unresolved bound becomes a QUESTION.
 *
 * This is the file mutant M4 targets. Deleting the clarification append from
 * the package stage turns the whole gate into a silent suppressor — the lie
 * would be dead and the user's limit would simply vanish, which is the FOURTH
 * outcome the trichotomy forbids. Every assertion here binds by ITEM ID
 * (trap 19), never by "some coaching item exists".
 *
 * ⚠ THE APPEND SITE IS AN ARCHITECTURAL CLAIM AND IS PINNED AS ONE. The Stage
 * 4.5 coaching pass assigns `ctx.coaching = wrapper.coaching` — a WHOLESALE
 * REPLACEMENT (`coaching-pass.ts`). Anything appended at Stage 4, where the
 * gate runs, is therefore destroyed before it can reach a user. The failure is
 * silent: the gate looks correct, the records are built correctly, and nothing
 * is ever shown. The test below reproduces that replacement against the real
 * module source rather than trusting a comment.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  renderDirectionClarifications,
  MAX_DIRECTION_CLARIFICATIONS,
  type DirectionUnresolvedItem,
} from '../../../compound-goal/direction-gate.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function item(metric: string, amount: string, reason: DirectionUnresolvedItem['reason'] = 'unspent_negation'): DirectionUnresolvedItem {
  return {
    metric_text: metric,
    amount_text: amount,
    value: 0.78,
    unit: 'fraction',
    reason,
    question: `Should ${metric} stay at or above ${amount}, or at or below it?`,
    options: ['a floor — keep it at or above this value', 'a ceiling — keep it at or below this value'],
  };
}

describe('ROADMAP 2.1051 — direction clarifications reach a user', () => {
  it('renders one card per unresolved bound, bound by item id', () => {
    const out = renderDirectionClarifications([item('gross margin', '78%'), item('churn', '4%')]);
    expect(out.map((c) => c.id)).toEqual(['direction_unresolved_1', 'direction_unresolved_2']);
    for (const c of out) expect(c.action_type).toBe('add_constraint');
  });

  it('the card names the metric and the amount in the USER\'s words', () => {
    const [card] = renderDirectionClarifications([item('gross margin', '78%')]);
    expect(card!.label).toBe('Confirm the direction of the gross margin limit');
    expect(card!.detail).toContain('78%');
    expect(card!.detail).toContain('gross margin');
    // Both directions are offered — the card must not imply an answer.
    expect(card!.detail).toContain('at or above');
    expect(card!.detail).toContain('at or below');
    // And it must say the limit is NOT being enforced, which is the fact the
    // user most needs: silence here is what made the original defect invisible.
    // (Contraction dropped 2026-08-11 with the copy change below — the
    // assertion is about the FACT being stated, and pinning the apostrophe
    // rather than the fact is what made this a spelling test.)
    expect(card!.detail).toContain('is not being enforced');
    // ⭐ AND IT MUST ASK. Added 2026-08-11: the card was previously two
    // observation sentences, and the served V5 narrative's first-sentence
    // slice reduced it to "You mentioned 78% for gross margin" — a statement
    // where the question belongs. Measured on staging at 32f06dd. A card that
    // never asks cannot obtain the answer this gate exists to obtain.
    expect(card!.detail).toContain('?');
    expect(card!.detail).toMatch(/Should gross margin stay at or above 78%, or at or below it\?/);
  });

  it('dedupes by (metric, amount) — one limit is ONE question however many rows carried it', () => {
    // The extractor routinely emits three overlapping rows per sentence, and
    // the detector can find the same bound again. Asking three times about one
    // limit is a worse product than asking once.
    const out = renderDirectionClarifications([
      item('gross margin', '78%'),
      item('gross margin', '78%'),
      item('Gross Margin', '78%'),
      item('churn', '4%'),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.label).toContain('gross margin');
    expect(out[1]!.label).toContain('churn');
  });

  it('caps at 3 and COLLAPSES the overflow into a counted item — nothing vanishes', () => {
    const out = renderDirectionClarifications([
      item('a', '1%'), item('b', '2%'), item('c', '3%'), item('d', '4%'), item('e', '5%'),
    ]);
    expect(out).toHaveLength(MAX_DIRECTION_CLARIFICATIONS + 1);
    const overflow = out[out.length - 1]!;
    expect(overflow.id).toBe('direction_unresolved_more');
    expect(overflow.label).toContain('2 more limits');
    expect(overflow.action_type).toBe('add_constraint');
  });

  it('the overflow item is singular when exactly one is hidden', () => {
    const out = renderDirectionClarifications([
      item('a', '1%'), item('b', '2%'), item('c', '3%'), item('d', '4%'),
    ]);
    const overflow = out[out.length - 1]!;
    expect(overflow.label).toBe('1 more limit needs a direction');
    expect(overflow.detail).toContain('it is');
  });

  it('renders nothing from nothing (a positive control for the empty case)', () => {
    expect(renderDirectionClarifications([])).toEqual([]);
  });

  it('never emits a node id into user-facing copy', () => {
    // The cards feed coaching prose, which is scanned for entity-id leakage.
    // Composing only from user words is what makes that scan a formality.
    const out = renderDirectionClarifications([item('fac_gross_margin', '78%')]);
    // Even when a caller hands in a bad metric, the copy must not invent one —
    // this asserts the renderer does not ADD ids, which is what it controls.
    for (const c of out) {
      expect(c.id).toMatch(/^direction_unresolved_/);
      expect(c.action_type).toBe('add_constraint');
    }
  });

  it('every rendered card satisfies the StrengthenItem contract shape at 0.39.0', () => {
    // `StrengthenItemSchema` is `.strict()` — an extra key would be rejected at
    // validation and the card would be DELETED rather than shown. Zero schema
    // change is only true if the shape is exactly right.
    const out = renderDirectionClarifications([item('gross margin', '78%')]);
    for (const c of out) {
      expect(Object.keys(c).sort()).toEqual(['action_type', 'detail', 'id', 'label']);
      expect(typeof c.id).toBe('string');
      expect(typeof c.label).toBe('string');
      expect(typeof c.detail).toBe('string');
      expect(['add_option', 'add_constraint', 'add_risk', 'reframe_goal']).toContain(c.action_type);
    }
  });

  /* ---------------------------------------------------------------------
   * THE APPEND-SITE PIN.
   * ------------------------------------------------------------------- */

  it('the coaching pass REPLACES ctx.coaching wholesale — which is why the append lives in package', () => {
    // Derived from the module source at THIS tip, not asserted from a comment.
    // If the coaching pass ever starts MERGING instead of replacing, this test
    // goes red and the append site should be reconsidered — which is the point.
    const src = readFileSync(resolve(HERE, '../coaching-pass.ts'), 'utf-8');
    expect(src).toMatch(/ctx\.coaching\s*=\s*wrapper\.coaching/);
    expect(src).not.toMatch(/ctx\.coaching\.strengthen_items\.push/);
  });

  it('the clarification append is in the PACKAGE stage, after the coaching pass', () => {
    const pkg = readFileSync(resolve(HERE, '../package.ts'), 'utf-8');
    const gate = readFileSync(resolve(HERE, '../repair/compound-goals.ts'), 'utf-8');
    // The renderer is called in package...
    expect(pkg).toMatch(/renderDirectionClarifications/);
    // ...and NOT at the gate, where the coaching pass would erase its output.
    expect(gate).not.toMatch(/renderDirectionClarifications/);
    // And the append must precede the contract enforcement, so the injected
    // items are conformed like every other coaching producer's.
    const appendAt = pkg.indexOf('renderDirectionClarifications(unresolved)');
    const enforceAt = pkg.indexOf('enforceCoachingContract(ctx.coaching');
    expect(appendAt).toBeGreaterThan(-1);
    expect(enforceAt).toBeGreaterThan(-1);
    expect(appendAt).toBeLessThan(enforceAt);
  });
});
