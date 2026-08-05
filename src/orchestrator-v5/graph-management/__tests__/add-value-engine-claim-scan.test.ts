/**
 * ROADMAP 2.478 — **THE SECOND BEHAVIOUR CHANGE THIS SLICE MAKES, and it was
 * undisclosed until an adversarial review measured it.**
 *
 * Carrying an add op's value into the envelope as `screened_value` was done for
 * check (a), the field allowlist / pipeline-owned screen. But `checkFieldSafety`
 * runs a SECOND check on every envelope — (b), the G14 engine-claim scan over
 * every string leaf of the payload — and that check now sees the add value too.
 * It sees it on **BOTH** add kinds, including `add_edge`, which check (a)
 * deliberately does not screen.
 *
 * MEASURED, both directions:
 *   pristine ACCEPTS `add_node` with description "near the flip point";
 *   this head REJECTS it with ENGINE_CLAIM_IN_TEXT.
 *   pristine ACCEPTS `add_edge` with label "raises EVPI"; this head REJECTS it.
 *
 * ⚠ THE COST IS REAL: a legitimate description containing one of the
 * conservative patterns now rejects the WHOLE batch (the gate returns one
 * batch-governing verdict — A2). That is a user-visible change and it is
 * recorded, not buried.
 *
 * WHY IT IS KEPT (the lane's judgement, offered for overrule rather than
 * assumed): G14's own scope is "EVERY string leaf in the payload … whether as
 * narrative prose OR as a label/value". Before this change the add path was the
 * ONE door that scope did not reach, which left the referee in an incoherent
 * position — it would refuse to RENAME a node to "near the flip point"
 * (`rename_node` carries `to_label` in its payload and is scanned) while
 * happily CREATING one whose description says exactly that. The widening
 * removes that asymmetry rather than inventing a new rule; the patterns are
 * unchanged and remain the conservative set G14 shipped.
 *
 * ⚠ AND IT MAKES ONE SENTENCE ELSEWHERE IMPRECISE, corrected here: `add_edge`
 * is unscreened by check (a) ONLY. It is covered by check (b) from this commit
 * on. "Deliberately unscreened" without that qualifier is wrong.
 */
import { describe, it, expect } from 'vitest';
import { refereeMutation } from '../referee.js';
import { ENGINE_CLAIM_IN_TEXT, STRUCTURAL_APPLY_HELD } from '../reason-codes.js';
import { buildReadyGraph, frameFor, hashOf, makeEnvelope } from './fixtures.js';

const G = buildReadyGraph();

const addNode = (screened?: Record<string, unknown>) =>
  refereeMutation(
    makeEnvelope(
      'add_node',
      {
        node: { id: 'n-new', kind: 'factor', label: 'New factor' },
        ...(screened === undefined ? {} : { screened_value: screened }),
      },
      { base_graph_hash: hashOf(G) },
    ),
    G,
    frameFor(G),
  );

const addEdge = (screened?: Record<string, unknown>) =>
  refereeMutation(
    makeEnvelope(
      'add_edge',
      {
        edge: { from: 'f-spend', to: 'g-profit' },
        ...(screened === undefined ? {} : { screened_value: screened }),
      },
      { base_graph_hash: hashOf(G) },
    ),
    G,
    frameFor(G),
  );

describe('G14 (b) — the engine-claim scan now reaches the ADD value (behaviour change)', () => {
  it('an add_node DESCRIPTION carrying an engine claim is REJECTED (accepted at pristine)', () => {
    const v = addNode({ description: 'This factor sits near the flip point for the goal.' });
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(ENGINE_CLAIM_IN_TEXT);
  });

  it('an add_edge LABEL carrying an engine claim is REJECTED — check (b) covers what (a) does not', () => {
    const v = addEdge({ label: 'raises EVPI' });
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(ENGINE_CLAIM_IN_TEXT);
  });

  it('a quantified-probability claim buried in a nested add value is REJECTED', () => {
    const v = addNode({ meta: { note: 'There is a 70% chance this clears the bar.' } });
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(ENGINE_CLAIM_IN_TEXT);
  });

  it('the SAME claim in a rename was ALREADY refused — this closes an asymmetry, not a new rule', () => {
    const v = refereeMutation(
      makeEnvelope(
        'rename_node',
        { node_id: 'g-profit', to_label: 'Profit near the flip point' },
        { base_graph_hash: hashOf(G) },
      ),
      G,
      frameFor(G),
    );
    expect(v.blocker?.code).toBe(ENGINE_CLAIM_IN_TEXT);
  });
});

describe('G14 (b) — POSITIVE CONTROL: the scan can also PASS', () => {
  it('an ordinary add_node description is not refused', () => {
    const v = addNode({ description: 'Money spent on paid acquisition each quarter.' });
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
  });

  it('an ordinary add_edge value is not refused', () => {
    const v = addEdge({ strength: { mean: 0.5, std: 0.1 }, label: 'increases' });
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
  });

  it('an identity-only add is untouched by the widening', () => {
    expect(addNode().blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
    expect(addEdge().blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
  });
});
