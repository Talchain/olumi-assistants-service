/**
 * ⛔⛔ AN EDIT MUST NOT LEAVE A SCALE DECLARATION IT HAS JUST FALSIFIED.
 *
 * ── WIRE-WITNESSED, served CEE `c2ef0b8`, 24 Sep 2026 ───────────────────────
 * Scenario `ba19709c-a022-448a-84a6-8e430d649b0f`, driven end to end with curl:
 * turn → register → `factor_value_edit` → reload. The served constructor produced
 *
 *     observed_state: { value: 0, unit: "unit_interval", source: "cee_inference",
 *                       declared_scale: "unit_interval" }        NO cap, NO scale_frame
 *
 * At that moment the declaration was TRUE — 0 is in [0,1]. One edit to 40 stored
 *
 *     observed_state: { value: 40, raw_value: 40, declared_scale: "unit_interval" }
 *
 * still with no cap, because the persistence merge spreads the prior
 * `observed_state` and only overwrites `value`/`raw_value`.
 *
 * ⛔ The graph then DECLARES the value is on a 0–1 unit interval while holding 40.
 * `value === raw_value` with no cap was already unanalysable
 * (`baseline_scale_unresolved`); the surviving declaration makes the model
 * SELF-CONTRADICTORY, and every downstream reader is entitled to believe it.
 * Measured consequence in the same witness: readiness reported
 * `admitted: true, permitted_analysis_mode: "comparative_leader"` over it.
 *
 * ── WHY CLEARED, NOT RE-DERIVED ─────────────────────────────────────────────
 * Deriving a frame here is REFUSED, with numbers, by
 * `set-factor-value`'s sibling ruling in `stored-scale-frame-edit.test.ts`: the
 * option levels were framed against the DRAFT's frame, so a ladder applied at edit
 * time turns a VISIBLE REFUSAL into a SILENT WRONG ANSWER — 9 of 25 framings
 * distorted the ratio, worst 100x, with a £600,000 status quo landing BELOW a
 * £400,000 option. Clearing a false declaration is the opposite move: it converts a
 * WRONG claim into an ABSENT one, which is this lane's fabrication boundary. The
 * analysis still refuses the pair — honestly, and for the real reason.
 *
 * ── RUNS THE REAL CHAIN ─────────────────────────────────────────────────────
 * `applyFactorValueEdit` for real: validator → `set_factor_value` →
 * `mergeMutatedGraphForPersistence` → `GraphV3.safeParse`. A deletion the
 * persistence merge re-added from the base would pass a handler-only test and still
 * ship the defect, so every assertion reads the COMMITTED merged graph as well as
 * its parse.
 */

import { describe, expect, it } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { applyFactorValueEdit } from '../../../system-events/factor-value-edit.js';

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
/** The witnessed factor's shape, by its witnessed observed_state. */
const TARGET_ID = 'fac_enterprise_sales_effort';
/** An untouched sibling carrying the SAME declaration — the blast-radius control. */
const SIBLING_ID = 'fac_market_competition';

type NodeRecord = Record<string, unknown> & { id: string; observed_state?: Record<string, unknown> };

function persistedGraph(opts: { cap?: number; declared?: string | null; unit?: string | null } = {}): Record<string, unknown> {
  const declared = opts.declared === undefined ? 'unit_interval' : opts.declared;
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: TARGET_ID,
        kind: 'factor',
        label: 'Enterprise sales effort',
        observed_state: {
          value: 0,
          ...(opts.unit === null ? {} : { unit: opts.unit ?? 'unit_interval' }),
          source: 'cee_inference',
          factor_type: 'other',
          uncertainty_drivers: [],
          ...(declared === null ? {} : { declared_scale: declared }),
          ...(opts.cap !== undefined ? { cap: opts.cap } : {}),
        },
      },
      {
        id: SIBLING_ID,
        kind: 'factor',
        label: 'Market competition',
        observed_state: { value: 0.2, declared_scale: 'unit_interval', source: 'cee_inference' },
      },
    ],
    edges: [],
  };
}

function eventFor(value: number): Extract<SystemEventTurnPayload['event'], { kind: 'factor_value_edit' }> {
  return { kind: 'factor_value_edit', target_id: TARGET_ID, value, field: 'value' } as Extract<
    SystemEventTurnPayload['event'],
    { kind: 'factor_value_edit' }
  >;
}

function payloadFor(
  event: Extract<SystemEventTurnPayload['event'], { kind: 'factor_value_edit' }>,
): SystemEventTurnPayload {
  return {
    kind: 'system_event',
    scenario_id: SCENARIO_ID,
    turn_id: '77777777-7777-4777-8777-777777777777',
    stage: 'analyse',
    event,
  } as unknown as SystemEventTurnPayload;
}

function nodeById(graph: unknown, id: string): NodeRecord {
  const nodes = (graph as { nodes?: NodeRecord[] }).nodes ?? [];
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new Error(`node ${id} missing from graph`);
  return node;
}

async function edit(value: number, opts: { cap?: number; declared?: string | null; unit?: string | null } = {}) {
  const event = eventFor(value);
  const result = await applyFactorValueEdit({
    payload: payloadFor(event),
    event,
    requestId: `req-declared-scale-${value}`,
    persistedGraph: persistedGraph(opts),
    priorFacts: [],
  });
  expect(result.kind, `edit was not applied: ${JSON.stringify(result)}`).toBe('mutated');
  if (result.kind !== 'mutated') throw new Error('unreachable');
  return result;
}

/** BOTH carriers of the committed write — merged graph and its parse. */
function committed(result: Awaited<ReturnType<typeof edit>>, id = TARGET_ID): NodeRecord[] {
  return [nodeById(result.mutatedGraph, id), nodeById(result.graph, id)];
}

describe('set_factor_value — a value outside the declared scale withdraws the declaration', () => {
  it('⛔⛔ THE WITNESSED DEFECT: 0 → 40 over `declared_scale: "unit_interval"` with no cap stores NO declaration', async () => {
    const result = await edit(40);
    for (const node of committed(result)) {
      const os = node.observed_state ?? {};
      // The write landed.
      expect(os.value).toBe(40);
      // ⭐ THE FIX. ABSENT, not present-but-undefined: `in` and `Object.keys` read a
      // present key as present, and absence is the declared meaning — the same
      // argument the `elicited_from` and `extractionType` deletions make in this
      // handler.
      expect('declared_scale' in os).toBe(false);
      // ⛔ And nothing was invented in its place: no cap is fabricated.
      expect('cap' in os).toBe(false);
      /**
       * ⛔⛔ AND THE SAME FALSEHOOD SPELLED AS A `unit`. WIRE-WITNESSED on served
       * `389051f`: the node carried `unit: "unit_interval"` as well, and after an
       * edit to 55 BOTH survived on a value of 55 with no cap — two false claims.
       * `unit_interval` is not a dimension; it is `declared_scale`'s claim wearing
       * the other field's name.
       */
      expect('unit' in os).toBe(false);
    }
  });

  it('⛔ CONTRAST: a REAL unit is never stripped, even when the declaration is', async () => {
    // The discriminator, and the one that matters most. A unit is normally a
    // DIMENSION and a magnitude change does not falsify a dimension — 40 customers
    // is as much "customers" as 0 was. Clearing a real unit would destroy
    // information, and `currencyPrefix` matches `unit === "GBP"` EXACTLY, so
    // stripping it would silently remove the £ from every later render.
    const result = await edit(40, { unit: 'customers' });
    for (const node of committed(result)) {
      const os = node.observed_state ?? {};
      // The false declaration still goes...
      expect('declared_scale' in os).toBe(false);
      // ...and the true dimension stays.
      expect(os.unit).toBe('customers');
    }
  });

  it('⭐ CONTRAST: a value that IS on the unit interval keeps its true declaration', async () => {
    // The discriminator. A blanket delete would strip a declaration that is still
    // true, which would lose real information rather than a false claim.
    const result = await edit(0.4);
    for (const node of committed(result)) {
      const os = node.observed_state ?? {};
      expect(os.value).toBe(0.4);
      expect(os.declared_scale).toBe('unit_interval');
    }
  });

  it('⭐ CONTRAST: a CAPPED factor is untouched — its cap IS the declared scale', async () => {
    // With a cap the pair is coherent, so the declaration remains true and must
    // survive.
    //
    // ⚠ FIXTURE NOTE, recorded because the first version of this test was WRONG and
    // the product was right: with `cap: 100` and `unit: 'unit_interval'` the handler
    // reads 40 as 4,000, correctly REFUSES it as above an unconfirmed limit, and
    // offers `chip_prompt_rescale_extend_cap`. That refusal is the behaviour this
    // estate wants; my fixture had simply chosen an out-of-range value. The cap here
    // is one the value genuinely fits.
    //
    // ⭐⭐ AND THIS IS THE STRONGEST ARGUMENT FOR THE FIX, found while writing the
    // test. `declared_scale: 'unit_interval'` is LOAD-BEARING FOR INTERPRETATION:
    // with it set, the handler reads the input as a PROPORTION OF THE CAP, so 40
    // against cap 5000 becomes 200,000 and is correctly refused as out of range. A
    // FALSE declaration therefore does not merely mislead a reader — it changes how
    // the NEXT edit is interpreted. Leaving one behind corrupts future writes, not
    // just future reads.
    const result = await edit(0.4, { cap: 5000 });
    for (const node of committed(result)) {
      const os = node.observed_state ?? {};
      expect(os.declared_scale).toBe('unit_interval');
      expect(os.cap).toBe(5000);
    }
  });

  it('⭐ BLAST RADIUS: an untouched sibling keeps its own declaration', async () => {
    // Bound to the edited node only. A clear that reached siblings would silently
    // strip declarations across the graph.
    const result = await edit(40);
    for (const node of committed(result, SIBLING_ID)) {
      expect((node.observed_state ?? {}).declared_scale).toBe('unit_interval');
    }
  });

  it('⭐ a factor with NO declaration gains none', async () => {
    // Nothing is authored here in either direction.
    const result = await edit(40, { declared: null });
    for (const node of committed(result)) {
      expect('declared_scale' in (node.observed_state ?? {})).toBe(false);
    }
  });
});
