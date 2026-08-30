/**
 * CASE: long-conversation-retention  —  SEAM A
 *
 * A fact stated early must survive ten intervening turns. This case PASSED in
 * the 30 Aug batch, and that is exactly why it is in the harness: the passes
 * are the regressions that matter. A continuity harness that only encodes
 * today's failures will be silent on the day one of today's successes breaks.
 */

import { makeRecallCase } from '../lib/recall-case.mjs';
import { BRIEF_WAREHOUSE } from '../lib/scenarios.mjs';

export default makeRecallCase({
  id: 'long-conversation-retention',
  seam: 'A',
  stateClass: 'fresh',
  title: 'a fact stated at turn 2 is still available at turn 12',
  expectedAt: { caceba1a: 'PASS in the 30 Aug batch — encoded as a regression net' },
  brief: BRIEF_WAREHOUSE,

  // A distinctive, checkable constraint. "Tuesday" and a specific figure make
  // the recall token hard to satisfy by generic prose about warehouses.
  fact: 'One hard constraint: our lease on the Leeds site expires in 14 months, and we cannot extend it.',
  factToken: '14 month',
  probe: 'What did I tell you about the lease?',

  // Never stated. Same shape, same register, different subject.
  fabricatedProbe: 'What did I tell you about the union agreement?',
  fabricatedTokens: ['union agreement expires', 'you told me the union', 'your union agreement'],

  fillerTurns: 10,
});
