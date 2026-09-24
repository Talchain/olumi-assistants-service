/**
 * ⭐ THE PERMISSIBLE NON-RANKING CARD for the state Track B identified: an OpenAI
 * run where `assumption_check` and `calibration_prompt` are unavailable (both read
 * `decision_review`, which this route skips) and `strengthen` is withheld because
 * leader claims are forbidden. Without this the panel offers NOTHING after a run.
 *
 * ⭐ THE FIXTURE IS NOT SELF-AUTHORED. `served-robustness-enrichment.json` is the
 * enrichment captured verbatim from a REAL Agent-lane run against served `16d868a`
 * — 12 fragile edges, real ids and labels. A card that only works on data I made up
 * is not evidence that Paul gets one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { disconfirmationCardFrom } from '../disconfirmation-card.js';

const SERVED = JSON.parse(
  readFileSync(new URL('./fixtures/served-robustness-enrichment.json', import.meta.url), 'utf8'),
);

describe('the non-ranking coaching card', () => {
  it('⭐ is produced from a REAL served run, with a real button', () => {
    const card = disconfirmationCardFrom(SERVED);
    expect(card, 'a served run must ground a card').not.toBeNull();
    // The Panel renders a real action ONLY when BOTH exist (V5CoachingBlock:446-454).
    expect(card!.action_label.length).toBeGreaterThan(0);
    expect(card!.action_prompt.length).toBeGreaterThan(0);
    expect(card!.action_intent).toBe('run_devils_advocacy');
  });

  it('⛔ NAMES NO OPTION — this is why it may be shown when `strengthen` may not', () => {
    const card = disconfirmationCardFrom(SERVED)!;
    const prose = `${card.title} ${card.body} ${card.action_label} ${card.action_prompt}`;
    // A leading-option claim is the thing forbidden in this state. The underlying
    // selector deliberately refuses to read `alternative_winner_label`; this asserts
    // the refusal survives into the card.
    expect(prose).not.toMatch(/\bwinner\b|\bbest option\b|\brecommend/i);
    expect(prose).not.toMatch(/likely to (overturn|flip|reverse)/i);
  });

  it('⭐ points at a real EDGE in the user’s model, not at the result', () => {
    const card = disconfirmationCardFrom(SERVED)!;
    expect(card.target_refs.length).toBe(1);
    expect(card.target_refs[0]!.kind).toBe('edge');
    expect(card.target_refs[0]!.label).toMatch(/ → /);
  });

  it('⭐ declares itself deterministic, NOT decision_review — the source that is skipped here', () => {
    const card = disconfirmationCardFrom(SERVED)!;
    expect(card.source).toBe('deterministic_signal');
    expect(card.coaching_kind).toBe('bias_signal');
  });

  it('⛔ CONTROL: no robustness data -> NULL, never a generic card in the one slot a user reads', () => {
    expect(disconfirmationCardFrom({})).toBeNull();
    expect(disconfirmationCardFrom(undefined)).toBeNull();
    expect(disconfirmationCardFrom({ robustness: { fragile_edges: [] } })).toBeNull();
  });

  it('⛔ CONTROL: malformed enrichment never throws into the turn', () => {
    expect(disconfirmationCardFrom({ robustness: { fragile_edges: 'nope' } })).toBeNull();
    expect(disconfirmationCardFrom('not-an-object')).toBeNull();
  });

  it('⛔ stays within the schema caps the boundary enforces', () => {
    const card = disconfirmationCardFrom(SERVED)!;
    expect(card.title.length).toBeLessThanOrEqual(80);
    expect(card.body.length).toBeLessThanOrEqual(400);
    expect(card.action_label.length).toBeLessThanOrEqual(40);
    expect(card.action_prompt.length).toBeLessThanOrEqual(200);
  });
});
