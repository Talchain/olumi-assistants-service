/**
 * A NOTICE THAT NAMES A CAUSE MUST BE BOUND TO THAT CAUSE.
 *
 * ── MEASURED IN A USER SESSION (deployed staging, 23 Sep, scenario `399c2814`)
 * Readiness held exactly ONE issue for thirty-seven minutes:
 *   `OPTION_NEEDS_MAPPING` — "How does Two Developers change Coordination
 *   Overhead Risk?" — `repairability: human_input_required`.
 * "Hire a Tech Lead" was `status: ready` throughout.
 *
 * At 23:38:00 the product appended:
 *   "Note: 'Two Developers' does not have effect values yet. Say 'configure the
 *    Two Developers option' … and I'll write in the real numbers."
 *
 * **That was false.** Two Developers already carried effect values on two
 * factors — Delivery Throughput 0.75 and Hiring & Salary Cost £140,000 — and
 * the product had said so itself at 23:15. The user followed the instruction
 * twice; analysis stayed blocked on the edge nobody named.
 *
 * ── THE PREDICATE ──────────────────────────────────────────────────────────
 * `deriveUnconfiguredOptionLabels` selected on `status !== 'ready'`, and
 * `buildUnconfiguredOptionsNotice` then asserted a SPECIFIC fact. Not-ready has
 * several causes (`needs_encoding`, `needs_user_mapping`, …) and only one of
 * them is "no effect values". Trap 19: a claim bound to a predicate another
 * cause satisfies. `option-intervention-write-guard.ts:754` already names this
 * exact sentence as a lie and carries `not_honoured_no_copy` to avoid it.
 *
 * ⚠ SCOPE. These assertions are about WHICH OPTIONS the notice may name. They
 * say nothing about routing — that an "unblock analysis" request reached
 * `adjust_edge_strength` at all is a separate defect with its own fix.
 */
import { describe, expect, it } from 'vitest';

import {
  deriveUnconfiguredOptionLabels,
  buildUnconfiguredOptionsNotice,
  deriveBlockedConfiguredOptions,
  buildBlockedOptionsNotice,
  buildGmHeldAppliedReceipt,
} from '../gm-held-execute.js';

describe('the unconfigured-options notice only names options that are', () => {
  it('EXCLUDES an option that provably HAS effect values — Paul’s exact case', () => {
    const labels = deriveUnconfiguredOptionLabels({
      status: 'needs_user_mapping',
      options: [
        {
          option_id: 'be215545',
          label: 'Two Developers',
          status: 'needs_user_mapping',
          // Blocked by an unmapped EDGE, not by missing values.
          interventions: { fac_throughput: 0.75, fac_hiring_cost: 140000 },
        },
        { option_id: 'e70301eb', label: 'Hire a Tech Lead', status: 'ready' },
      ],
    });
    expect(labels).toEqual([]);
    // …and therefore no false sentence is produced at all.
    expect(buildUnconfiguredOptionsNotice(labels)).toBeNull();
  });

  it('CONTROL: an option with NO effect values is still named', () => {
    const labels = deriveUnconfiguredOptionLabels({
      options: [{ option_id: 'o1', label: 'Do nothing new', status: 'needs_encoding', interventions: {} }],
    });
    expect(labels).toEqual(['Do nothing new']);
    expect(buildUnconfiguredOptionsNotice(labels)).toContain('does not have effect values yet');
  });

  it('CONTROL: absence of the field is NOT proof of absence — behaviour unchanged', () => {
    // The narrow projection predates `interventions`. Where it is missing we
    // cannot prove the option has values, so the notice fires exactly as before.
    const labels = deriveUnconfiguredOptionLabels({
      options: [{ option_id: 'o1', label: 'Legacy shaped option', status: 'needs_user_mapping' }],
    });
    expect(labels).toEqual(['Legacy shaped option']);
  });

  it('CONTROL: a ready option is never named, values or not', () => {
    expect(
      deriveUnconfiguredOptionLabels({
        options: [{ option_id: 'o1', label: 'Ready one', status: 'ready', interventions: {} }],
      }),
    ).toEqual([]);
  });

  it('a mixed board names only the genuinely value-less option', () => {
    const labels = deriveUnconfiguredOptionLabels({
      options: [
        { option_id: 'o1', label: 'Configured but unmapped', status: 'needs_user_mapping', interventions: { f: 0.5 } },
        { option_id: 'o2', label: 'Genuinely empty', status: 'needs_encoding', interventions: {} },
        { option_id: 'o3', label: 'Ready', status: 'ready' },
      ],
    });
    expect(labels).toEqual(['Genuinely empty']);
  });
});

/**
 * ⛔ REMOVING A LIE MUST NOT LEAVE SILENCE. An independent review found that
 * filtering the false "no effect values" sentence left an option that genuinely
 * blocks the analysis with NO surface naming it — and being told nothing is how
 * a user spends thirty-seven minutes on the wrong obligation. The claim is
 * narrowed, not deleted.
 */
describe('an option blocked for another reason is still named', () => {
  const readiness = {
    options: [
      {
        option_id: 'be215545',
        label: 'Two Developers',
        status: 'needs_user_mapping',
        interventions: { fac_throughput: 0.75, fac_hiring_cost: 140000 },
        status_reason: 'A proposed effect still needs a supported mapping',
      },
      { option_id: 'e70301eb', label: 'Hire a Tech Lead', status: 'ready' },
    ],
  };

  it("names the option and the projection's OWN reason", () => {
    const blocked = deriveBlockedConfiguredOptions(readiness);
    expect(blocked).toEqual([
      { label: 'Two Developers', reason: 'A proposed effect still needs a supported mapping' },
    ]);
    const notice = buildBlockedOptionsNotice(blocked);
    expect(notice).toContain("'Two Developers' still blocks the analysis");
    expect(notice).toContain('A proposed effect still needs a supported mapping');
    // ⛔ and it must NOT resurrect the false cause.
    expect(notice).not.toMatch(/effect values/i);
  });

  it("invents no cause when the projection carries none", () => {
    const notice = buildBlockedOptionsNotice([{ label: 'X' }]);
    expect(notice).toBe("Note: 'X' still blocks the analysis.");
  });

  it('the applied receipt carries the true notice end to end', () => {
    const text = buildGmHeldAppliedReceipt(
      ["link 'Two Developers' to 'Team Technical Capability'"],
      deriveUnconfiguredOptionLabels(readiness),
      deriveBlockedConfiguredOptions(readiness),
    );
    expect(text).toContain('Confirmed:');
    expect(text).toContain("'Two Developers' still blocks the analysis");
    // The measured misdirection must be gone from the whole receipt.
    expect(text).not.toMatch(/does not have effect values/i);
  });

  it('CONTROL: a ready board adds no blocked notice at all', () => {
    const ready = { options: [{ option_id: 'o1', label: 'A', status: 'ready', interventions: { f: 1 } }] };
    expect(deriveBlockedConfiguredOptions(ready)).toEqual([]);
    expect(buildBlockedOptionsNotice([])).toBeNull();
  });

  it('a NULL interventions value does not throw (Object.keys(null) would)', () => {
    // The reviewer's surviving mutant: dropping the `iv === null` conjunct.
    const nulled = {
      options: [{ option_id: 'o1', label: 'Nulled', status: 'needs_user_mapping', interventions: null }],
    } as unknown as { readonly options: readonly never[] };
    expect(() => deriveUnconfiguredOptionLabels(nulled)).not.toThrow();
    expect(deriveUnconfiguredOptionLabels(nulled)).toEqual(['Nulled']);
    expect(() => deriveBlockedConfiguredOptions(nulled)).not.toThrow();
    expect(deriveBlockedConfiguredOptions(nulled)).toEqual([]);
  });
});
