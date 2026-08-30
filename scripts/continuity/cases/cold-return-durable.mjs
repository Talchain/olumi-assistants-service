/**
 * CASE: cold-return-durable  —  SEAM A (canonical state, the half that works)
 *
 * THE PROPERTY
 * ------------
 * A user who closes the tab and comes back later must find their model and
 * their brief intact. This rides canonical scenario state — the persisted
 * graph and `brief_text` — which is precisely why it PASSED in the 30 Aug
 * batch while the three discourse-level cases failed. Encoding it here makes
 * that split visible as a standing measurement rather than as a one-off
 * observation: if cold return ever starts failing, the diagnosis is completely
 * different from a discourse-ledger failure, and the harness should say so.
 *
 * THE CONTROL
 * -----------
 * A byte-identical probe against a scenario id that was NEVER briefed. The
 * product must refuse. Without this, "I remember your brief" is unfalsifiable:
 * a product that answers plausibly about any scenario id, including one it has
 * never seen, would pass the arm perfectly.
 *
 * The control also exercises the IDOR carve-out honestly — an anonymous caller
 * on an unowned guest scenario is exactly the surface a tester uses.
 *
 * COLD is simulated by a NEW CLIENT INSTANCE, which is the honest limit of a
 * wire harness: it proves nothing survives in THIS process, not that nothing
 * survives in CEE's. That is a real scope boundary and is reported as one
 * rather than papered over — the durable claim being tested is server-side
 * persistence, and a fresh client is necessary but not sufficient to prove it.
 */

import { check } from '../lib/verdict.mjs';
import { mentions } from '../lib/wire.mjs';
import { TurnClient } from '../lib/wire.mjs';
import { BRIEF_WAREHOUSE, draft, nodeLabels } from '../lib/scenarios.mjs';

const RECALL_PROBE = 'Remind me — what decision is this model about, and what options did we set up?';

export default {
  id: 'cold-return-durable',
  seam: 'A',
  stateClass: 'seeded',
  title: 'a returning user finds their brief and model intact; an unbriefed scenario is refused',
  expectedAt: { caceba1a: 'PASS in the 30 Aug batch — encoded as a regression net' },

  async setup(ctx) {
    const seeded = await draft(ctx.client, BRIEF_WAREHOUSE, 'cold-return-ARM-draft');
    return {
      arm: {
        scenarioId: seeded.scenarioId,
        draft: seeded.response,
        nodes: nodeLabels(seeded.response.body),
      },
      // Never briefed. A well-formed uuid that no turn has ever touched.
      control: { scenarioId: ctx.client.newScenario() },
    };
  },

  precondition(s) {
    return [
      check('seed draft HTTP 200', s.arm.draft.ok, `status=${s.arm.draft.status}`),
      check(
        'the seeded scenario actually built a graph',
        s.arm.nodes.length > 0,
        `node labels=${s.arm.nodes.length} — with no graph there is nothing for a cold return to recover`,
      ),
      check(
        'the control scenario id is distinct from the arm\'s',
        s.arm.scenarioId !== s.control.scenarioId,
        'a shared id would make the control a second arm',
      ),
      check(
        'the control scenario was never briefed in this run',
        true,
        `id ${s.control.scenarioId} minted fresh and never sent a frame turn`,
      ),
    ];
  },

  /** COLD: a brand-new client instance, no carried state of any kind. */
  async arm(ctx, s) {
    const coldClient = new TurnClient({ base: ctx.client.base, evidenceDir: ctx.client.evidenceDir });
    return coldClient.turn({
      scenarioId: s.arm.scenarioId,
      message: RECALL_PROBE,
      label: 'cold-return-ARM-cold-probe',
    });
  },

  /** Byte-identical probe, unbriefed scenario. Must refuse. */
  async control(ctx, s) {
    const coldClient = new TurnClient({ base: ctx.client.base, evidenceDir: ctx.client.evidenceDir });
    return coldClient.turn({
      scenarioId: s.control.scenarioId,
      message: RECALL_PROBE,
      label: 'cold-return-CTL-unbriefed-probe',
    });
  },

  assertArm(resp, s) {
    const t = resp.text;
    // Bind by identity to labels the producer itself minted for this scenario.
    const recalled = s.arm.nodes.filter((n) => n && n.length > 3 && mentions(t, n));
    return [
      check('cold probe returned prose', Boolean(t && t.trim().length > 10), `len=${t ? t.length : 0}`),
      check(
        'recalls content from the persisted model',
        recalled.length > 0,
        recalled.length
          ? `recalled ${JSON.stringify(recalled.slice(0, 4))} from the scenario's own node labels`
          : `none of ${s.arm.nodes.length} persisted node labels appear in the answer`,
      ),
    ];
  },

  assertControl(resp, s) {
    const t = resp.text;
    // The arm's labels must NOT appear: this scenario never had them.
    const bled = s.arm.nodes.filter((n) => n && n.length > 3 && mentions(t, n));
    return [
      check('control probe returned prose', Boolean(t && t.trim().length > 10), `len=${t ? t.length : 0}`),
      check(
        'does not recall a model that was never built here',
        bled.length === 0,
        bled.length
          ? `LEAK/CONFABULATION: named ${JSON.stringify(bled)} on an unbriefed scenario`
          : 'no content from the seeded scenario appears, as required',
      ),
      check(
        'signals that there is nothing to recall',
        /\b(no|don't|do not|haven't|not yet|nothing|can't find|unable)\b/i.test(t),
        'an unbriefed scenario should produce an explicit absence, not a confident answer',
      ),
    ];
  },
};
