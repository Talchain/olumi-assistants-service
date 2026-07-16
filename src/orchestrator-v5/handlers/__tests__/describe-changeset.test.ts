/**
 * CHANGESET HONESTY MECHANISM (ROADMAP 1.134 — kills F6+F7).
 *
 * Paul's 16-Jul verdict-flip: an applied edit showed as the opaque label
 * "…and 3 more changes" in the hold message, the chip, AND the receipt —
 * GM could not audit its own applied changeset. The edits DID apply; the
 * honesty gap was the DESCRIPTION.
 *
 * Mechanism under test: ONE `describeChangeset` source function derives
 * SPECIFIC, per-operation copy for EVERY operation in the batch, and all
 * three surfaces (hold ask, chip label/message, applied receipt) consume
 * it — so they can never diverge again.
 *
 * RED-first: on the pre-mechanism base, `describeHeldOperationsSubject`
 * names ONLY the first operation and collapses the rest into
 * "and N more changes" — the multi-op pins below fail there by design.
 */

import { describe, expect, it } from 'vitest';

import {
  describeChangeset,
  describeHeldOperationsSubject,
} from '../describe-changeset.js';
import {
  buildGmHeldAssistantText,
  buildGmHeldPublicCopy,
  describeHeldOperationsSubject as refereeGateSeam,
} from '../edit-graph-referee-gate.js';
import { buildGmHeldAppliedReceipt } from '../gm-held-execute.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';
import { isValueUpdatePhrasing } from '../../../orchestrator/routing/value-update-gate.js';

const GRAPH = {
  nodes: [
    { id: 'fac-marketing', kind: 'factor', label: 'Marketing' },
    { id: 'fac-revenue', kind: 'factor', label: 'Revenue' },
    { id: 'opt-hire', kind: 'option', label: 'Hire a recruiter' },
    { id: 'goal-g', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    { from: 'fac-marketing', to: 'goal-g' },
    { from: 'fac-revenue', to: 'goal-g' },
  ],
};

/** Paul's F7 shape — one add plus two more changes. The defect under kill:
 *  every op past the first was an opaque count on all three surfaces. */
const F7_BATCH = [
  {
    op: 'add_node',
    path: 'fac-wasted-time',
    value: {
      id: 'fac-wasted-time',
      kind: 'factor',
      label: 'Wasted time searching for a co-founder',
    },
  },
  {
    op: 'update_node',
    path: 'fac-marketing',
    value: { observed_state: { value: 0.8 } },
  },
  {
    op: 'add_edge',
    path: 'edges/-',
    value: { from: 'fac-revenue', to: 'goal-g' },
  },
];

describe('describeChangeset — every operation is named, never a count', () => {
  it('names EVERY operation in the F7 multi-op batch (the defect pin)', () => {
    const described = describeChangeset(F7_BATCH, GRAPH);
    expect(described).not.toBeNull();
    // One item per operation, order-preserving.
    expect(described!.items).toHaveLength(3);
    expect(described!.items[0]).toBe(
      "add factor 'Wasted time searching for a co-founder'",
    );
    expect(described!.items[1]).toBe("change 'Marketing' to 0.8");
    expect(described!.items[2]).toBe("link 'Revenue' to 'Goal'");
    // The joined subject enumerates all three.
    expect(described!.subject).toBe(
      "add factor 'Wasted time searching for a co-founder', " +
        "change 'Marketing' to 0.8 and link 'Revenue' to 'Goal'",
    );
    // The opaque-count vocabulary is dead.
    expect(described!.subject).not.toMatch(/\d+\s+more\s+change/i);
  });

  it('describeHeldOperationsSubject (the shared surface seam) returns the enumerated subject', () => {
    const subject = describeHeldOperationsSubject(F7_BATCH, GRAPH);
    expect(subject).toBe(describeChangeset(F7_BATCH, GRAPH)!.subject);
    expect(subject).not.toMatch(/\d+\s+more\s+change/i);
  });

  it('two operations join with a plain "and"', () => {
    const subject = describeHeldOperationsSubject(
      [
        { op: 'remove_node', path: 'opt-hire' },
        { op: 'update_node', path: 'fac-marketing', value: { description: 'x' } },
      ],
      GRAPH,
    );
    expect(subject).toBe(
      "remove option 'Hire a recruiter' and update the description of 'Marketing'",
    );
  });

  it('returns null only for an empty batch (callers fall back to generic copy)', () => {
    expect(describeChangeset([], GRAPH)).toBeNull();
    expect(describeHeldOperationsSubject([], GRAPH)).toBeNull();
  });
});

describe('describeChangeset — per-operation vocabulary coverage', () => {
  it("add_node names the kind for known kinds → add option 'X'", () => {
    const d = describeChangeset(
      [
        {
          op: 'add_node',
          path: 'opt-x',
          value: { id: 'opt-x', kind: 'option', label: 'Outsource hiring' },
        },
      ],
      GRAPH,
    );
    expect(d!.subject).toBe("add option 'Outsource hiring'");
  });

  it('add_node of kind constraint stays plain (never "add ... constraint", which the value-update gate claims)', () => {
    const d = describeChangeset(
      [
        {
          op: 'add_node',
          path: 'con-x',
          value: { id: 'con-x', kind: 'constraint', label: 'Budget cap' },
        },
      ],
      GRAPH,
    );
    expect(d!.subject).toBe("add 'Budget cap'");
    expect(isValueUpdatePhrasing(d!.subject)).toBe(false);
  });

  it('add_node without a label is honestly generic, never silent', () => {
    const d = describeChangeset(
      [{ op: 'add_node', path: 'n-x', value: { id: 'n-x', kind: 'risk' } }],
      GRAPH,
    );
    expect(d!.subject).toBe('add a new risk');
  });

  it("remove_node resolves label AND kind from the graph → remove option 'X'", () => {
    const d = describeChangeset([{ op: 'remove_node', path: 'opt-hire' }], GRAPH);
    expect(d!.subject).toBe("remove option 'Hire a recruiter'");
  });

  it('remove_node of an unknown id is honestly generic', () => {
    const d = describeChangeset([{ op: 'remove_node', path: 'nope' }], GRAPH);
    expect(d!.subject).toBe('remove a part of the model');
  });

  it("update_node with observed_state.value names the value → change 'X' to 0.8", () => {
    const d = describeChangeset(
      [
        {
          op: 'update_node',
          path: 'fac-marketing',
          value: { observed_state: { value: 0.8 } },
        },
      ],
      GRAPH,
    );
    expect(d!.subject).toBe("change 'Marketing' to 0.8");
  });

  it('update_node with observed_state value+unit renders the unit', () => {
    const d = describeChangeset(
      [
        {
          op: 'update_node',
          path: 'fac-revenue',
          value: { observed_state: { value: 50000, unit: 'GBP' } },
        },
      ],
      GRAPH,
    );
    expect(d!.subject).toBe("change 'Revenue' to £50,000");
  });

  it("update_node with goal_threshold names the target → change the target for 'Goal' to 15%", () => {
    const d = describeChangeset(
      [
        {
          op: 'update_node',
          path: 'goal-g',
          value: { goal_threshold: 15, unit: '%' },
        },
      ],
      GRAPH,
    );
    expect(d!.subject).toBe("change the target for 'Goal' to 15%");
  });

  it("update_node with a new label is a rename → rename 'Old' to 'New'", () => {
    const d = describeChangeset(
      [{ op: 'update_node', path: 'fac-marketing', value: { label: 'Marketing spend' } }],
      GRAPH,
    );
    expect(d!.subject).toBe("rename 'Marketing' to 'Marketing spend'");
  });

  it("update_node with only a description → update the description of 'X'", () => {
    const d = describeChangeset(
      [{ op: 'update_node', path: 'fac-marketing', value: { description: 'Quarterly ad budget' } }],
      GRAPH,
    );
    expect(d!.subject).toBe("update the description of 'Marketing'");
  });

  it("update_node with other fields stays a named plain update → update 'X'", () => {
    const d = describeChangeset(
      [{ op: 'update_node', path: 'fac-marketing', value: { weighting: 2 } }],
      GRAPH,
    );
    expect(d!.subject).toBe("update 'Marketing'");
  });

  it('update_node of a node added EARLIER IN THE SAME BATCH resolves its label from the batch', () => {
    const d = describeChangeset(
      [
        {
          op: 'add_node',
          path: 'fac-new',
          value: { id: 'fac-new', kind: 'factor', label: 'Churn' },
        },
        { op: 'update_node', path: 'fac-new', value: { observed_state: { value: 0.3 } } },
      ],
      GRAPH,
    );
    expect(d!.items[1]).toBe("change 'Churn' to 0.3");
  });

  it("add_edge resolves both endpoint labels → link 'A' to 'B'", () => {
    const d = describeChangeset(
      [{ op: 'add_edge', path: 'edges/-', value: { from: 'fac-marketing', to: 'goal-g' } }],
      GRAPH,
    );
    expect(d!.subject).toBe("link 'Marketing' to 'Goal'");
  });

  it('add_edge with an unresolvable endpoint is honestly generic', () => {
    const d = describeChangeset(
      [{ op: 'add_edge', path: 'edges/-', value: { from: 'nope', to: 'goal-g' } }],
      GRAPH,
    );
    expect(d!.subject).toBe('add a link');
  });

  it("remove_edge resolves endpoints from its path → remove the link from 'A' to 'B'", () => {
    const d = describeChangeset(
      [{ op: 'remove_edge', path: 'fac-marketing->goal-g' }],
      GRAPH,
    );
    expect(d!.subject).toBe("remove the link from 'Marketing' to 'Goal'");
  });

  it('remove_edge with an unresolvable path is honestly generic', () => {
    const d = describeChangeset([{ op: 'remove_edge', path: 'garbage' }], GRAPH);
    expect(d!.subject).toBe('remove a link');
  });

  it('update_edge with a numeric strength names the new strength', () => {
    const d = describeChangeset(
      [
        {
          op: 'update_edge',
          path: 'fac-marketing->goal-g',
          value: { strength: { mean: 0.4, std: 0.1 } },
        },
      ],
      GRAPH,
    );
    expect(d!.subject).toBe(
      "change the strength of the link from 'Marketing' to 'Goal' to 0.4",
    );
  });

  it('update_edge without a numeric strength stays a named adjust', () => {
    const d = describeChangeset(
      [{ op: 'update_edge', path: 'fac-marketing->goal-g', value: { note: 'x' } }],
      GRAPH,
    );
    expect(d!.subject).toBe("adjust the link from 'Marketing' to 'Goal'");
  });

  it('an UNKNOWN op type gets an honest fallback NAMING the op — never a silent count', () => {
    const d = describeChangeset(
      [
        { op: 'remove_node', path: 'opt-hire' },
        { op: 'replace_subgraph', path: 'x', value: {} },
      ],
      GRAPH,
    );
    expect(d!.items[1]).toBe("apply an unrecognised change of type 'replace subgraph'");
    expect(d!.subject).toBe(
      "remove option 'Hire a recruiter' and apply an unrecognised change of type 'replace subgraph'",
    );
    expect(d!.subject).not.toMatch(/\d+\s+more\s+change/i);
  });

  it('an unknown op with an unprintable op token still names itself generically', () => {
    const d = describeChangeset(
      [{ op: '{"weird":true}', path: 'x' }],
      GRAPH,
    );
    expect(d!.subject).toBe('apply an unrecognised change');
  });
});

describe('all three surfaces render the SAME specific copy (the never-diverge pin)', () => {
  const subject = (): string => describeHeldOperationsSubject(F7_BATCH, GRAPH)!;

  it('hold ask carries every named operation', () => {
    const text = buildGmHeldAssistantText(subject(), F7_BATCH.length);
    expect(text).toContain("add factor 'Wasted time searching for a co-founder'");
    expect(text).toContain("change 'Marketing' to 0.8");
    expect(text).toContain("link 'Revenue' to 'Goal'");
    expect(text).toContain('Nothing in the model moves until you confirm');
    expect(text).not.toMatch(/\d+\s+more\s+change/i);
    expect(text).not.toContain('—');
    expect(findForbiddenPhraseHit(text)).toBeNull();
  });

  it('hold ask pluralises for a multi-op batch (holding these changes, not "that change")', () => {
    const text = buildGmHeldAssistantText(subject(), F7_BATCH.length);
    expect(text).toContain('these changes');
    // Single-op copy keeps the established singular framing.
    const single = buildGmHeldAssistantText("update 'Marketing'", 1);
    expect(single).toContain("the change to update 'Marketing'");
  });

  it('chip label and message carry every named operation', () => {
    const copy = buildGmHeldPublicCopy(subject());
    expect(copy.label).toBe(
      "Add factor 'Wasted time searching for a co-founder', " +
        "change 'Marketing' to 0.8 and link 'Revenue' to 'Goal'",
    );
    expect(copy.message).toBe(
      "Yes, add factor 'Wasted time searching for a co-founder', " +
        "change 'Marketing' to 0.8 and link 'Revenue' to 'Goal'.",
    );
    expect(copy.label).not.toMatch(/\d+\s+more\s+change/i);
  });

  it('applied receipt carries every named operation', () => {
    const text = buildGmHeldAppliedReceipt([subject()]);
    expect(text).toContain(
      "Confirmed: add factor 'Wasted time searching for a co-founder', " +
        "change 'Marketing' to 0.8 and link 'Revenue' to 'Goal'.",
    );
    expect(text).toContain('Run the analysis again');
    expect(text).not.toMatch(/\d+\s+more\s+change/i);
  });

  it('the referee gate re-exports the SAME function — no second same-named implementation can drift', () => {
    // The two-same-named-`generateGraphHash` class: a duplicate
    // implementation under the same name is how this defect survives a
    // fix. The gate's seam must BE the describe-changeset function.
    expect(refereeGateSeam).toBe(describeHeldOperationsSubject);
  });

  it('the three surfaces agree byte-for-byte on the changeset description', () => {
    const s = subject();
    const ask = buildGmHeldAssistantText(s, F7_BATCH.length);
    const chip = buildGmHeldPublicCopy(s);
    const receipt = buildGmHeldAppliedReceipt([s]);
    expect(ask).toContain(s);
    // Chip label capitalises the first character only; the remainder is identical.
    expect(chip.label.charAt(0)).toBe(s.charAt(0).toUpperCase());
    expect(chip.label.slice(1)).toBe(s.slice(1));
    expect(chip.message).toBe(`Yes, ${s}.`);
    expect(receipt).toContain(`Confirmed: ${s}.`);
  });
});

describe('routing safety — the new copy must not trip the value-update gate', () => {
  it('a value-bearing chip message avoids the set/update-to phrasing the gate claims', () => {
    const subject = describeHeldOperationsSubject(
      [
        {
          op: 'update_node',
          path: 'fac-marketing',
          value: { observed_state: { value: 0.8 } },
        },
      ],
      GRAPH,
    );
    const copy = buildGmHeldPublicCopy(subject);
    expect(copy.message).toBe("Yes, change 'Marketing' to 0.8.");
    expect(isValueUpdatePhrasing(copy.message)).toBe(false);
    expect(isValueUpdatePhrasing(copy.label)).toBe(false);
  });

  it('the multi-op F7 chip message also stays outside the gate', () => {
    const copy = buildGmHeldPublicCopy(describeHeldOperationsSubject(F7_BATCH, GRAPH));
    expect(isValueUpdatePhrasing(copy.message)).toBe(false);
  });
});
