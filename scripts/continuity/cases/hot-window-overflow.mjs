/**
 * CASE: hot-window-overflow  —  SEAM A
 *
 * The `prior_facts` window is finite (a ~20-turn prose window at caceba1a).
 * This case pushes an early fact well past it and asks whether the fact was
 * PROMOTED into durable state or merely sat in a window that has since rolled.
 *
 * The distinction matters more than the pass/fail: a product that survives
 * because a fact was promoted has continuity; one that survives because the
 * window happened to be long enough has a deadline nobody wrote down.
 *
 * This is also the case that independently reported routing non-determinism —
 * identical message text taking different handlers on consecutive calls. The
 * runner's replay-split rule is what will surface that: disagreeing replays
 * become COULD_NOT_MEASURE plus a finding, never a majority vote.
 */

import { makeRecallCase } from '../lib/recall-case.mjs';
import { BRIEF_WAREHOUSE } from '../lib/scenarios.mjs';

export default makeRecallCase({
  id: 'hot-window-overflow',
  seam: 'A',
  stateClass: 'fresh',
  title: 'a fact stated before the window rolled is still recoverable',
  expectedAt: { caceba1a: 'PASS in the 30 Aug batch; routing non-determinism observed but never controlled' },
  brief: BRIEF_WAREHOUSE,

  fact: 'Important background: our largest customer, Pentland Foods, accounts for 38% of our volume.',
  factToken: 'Pentland',
  probe: 'Which customer did I say accounts for most of our volume?',

  fabricatedProbe: 'Which supplier did I say accounts for most of our inbound cost?',
  fabricatedTokens: ['you said your supplier', 'your largest supplier is', 'accounts for most of your inbound'],

  // Deliberately past the ~20-turn prose window.
  fillerTurns: 30,
});
