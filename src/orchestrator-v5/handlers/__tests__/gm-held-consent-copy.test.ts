/**
 * CONSENT-CLARITY AMENDMENT (Paul, 2026-07-11) — GM hold copy builders.
 *
 * Doctrine (a): every consent ask states EXACTLY what the user is
 * confirming, and every receipt names what was confirmed. The GM hold ask
 * previously said "I'm holding that change" (unnamed) with the generic
 * chip 'Continue with this change' / 'Yes'; the applied receipt was a
 * bare "Done. I have applied the change you confirmed.".
 *
 * These pins are RED-first: the builders do not exist on the
 * pre-amendment base.
 */

import { describe, expect, it } from 'vitest';

import {
  buildGmHeldAssistantText,
  buildGmHeldPublicCopy,
  describeHeldOperationsSubject,
  GM_HELD_ASSISTANT_TEXT,
  GM_HELD_CHIP_LABEL,
  GM_HELD_CHIP_MESSAGE,
} from '../edit-graph-referee-gate.js';
import {
  buildGmHeldAppliedReceipt,
  GM_HELD_APPLIED_ASSISTANT_TEXT,
} from '../gm-held-execute.js';
import {
  buildHeldAwareDegradeText,
  HELD_AWARE_DEGRADE_TEXT,
} from '../../coaching/coaching-output-postcheck.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';
import { describeChangeset, clampLabel } from '../describe-changeset.js';

const GRAPH = {
  nodes: [
    { id: 'fac-marketing', kind: 'factor', label: 'Marketing' },
    { id: 'goal-g', kind: 'goal', label: 'Goal' },
  ],
  edges: [{ from: 'fac-marketing', to: 'goal-g' }],
};

describe('describeHeldOperationsSubject — names the held change', () => {
  it("update_node resolves the node label from the graph → update the description of 'Marketing'", () => {
    const subject = describeHeldOperationsSubject(
      [{ op: 'update_node', path: 'fac-marketing', value: { description: 'x' } }],
      GRAPH,
    );
    expect(subject).toBe("update the description of 'Marketing'");
  });

  it("add_node uses the new node's label and kind → add risk 'Customer churn'", () => {
    const subject = describeHeldOperationsSubject(
      [
        {
          op: 'add_node',
          path: 'risk-churn',
          value: { id: 'risk-churn', kind: 'risk', label: 'Customer churn' },
        },
      ],
      GRAPH,
    );
    expect(subject).toBe("add risk 'Customer churn'");
  });

  it("remove_node → remove factor 'Marketing'", () => {
    const subject = describeHeldOperationsSubject(
      [{ op: 'remove_node', path: 'fac-marketing' }],
      GRAPH,
    );
    expect(subject).toBe("remove factor 'Marketing'");
  });

  it("add_edge → link 'Marketing' to 'Goal'", () => {
    const subject = describeHeldOperationsSubject(
      [{ op: 'add_edge', path: 'edges/-', value: { from: 'fac-marketing', to: 'goal-g' } }],
      GRAPH,
    );
    expect(subject).toBe("link 'Marketing' to 'Goal'");
  });

  it('CHANGESET HONESTY (1.134): multi-op batches name EVERY op — never "N more changes"', () => {
    const subject = describeHeldOperationsSubject(
      [
        { op: 'update_node', path: 'fac-marketing', value: { description: 'x' } },
        { op: 'remove_node', path: 'goal-g' },
      ],
      GRAPH,
    );
    expect(subject).toBe(
      "update the description of 'Marketing' and remove goal 'Goal'",
    );
    expect(subject).not.toMatch(/\d+\s+more\s+change/i);
  });

  it('returns null for an empty batch (caller falls back to the generic copy)', () => {
    expect(describeHeldOperationsSubject([], GRAPH)).toBeNull();
  });
});

describe('buildGmHeldAssistantText — the ask names its subject', () => {
  it('names the held change and keeps the consent framing', () => {
    const text = buildGmHeldAssistantText("update 'Marketing'");
    expect(text).toContain("update 'Marketing'");
    expect(text).toContain('Nothing in the model moves until you confirm');
    expect(text).not.toContain('—');
    expect(findForbiddenPhraseHit(text)).toBeNull();
  });

  it('falls back to the generic swept copy when no subject is derivable', () => {
    expect(buildGmHeldAssistantText(null)).toBe(GM_HELD_ASSISTANT_TEXT);
  });
});

describe('buildGmHeldPublicCopy — chip copy names its subject', () => {
  it('label and message both carry the subject', () => {
    const copy = buildGmHeldPublicCopy("update 'Marketing'");
    expect(copy.label).toBe("Update 'Marketing'");
    expect(copy.message).toBe("Yes, update 'Marketing'.");
  });

  it('falls back to the generic chip copy when no subject is derivable', () => {
    const copy = buildGmHeldPublicCopy(null);
    expect(copy.label).toBe(GM_HELD_CHIP_LABEL);
    expect(copy.message).toBe(GM_HELD_CHIP_MESSAGE);
  });

  it('falls back when the subject would leak unsafe copy (em dash)', () => {
    const copy = buildGmHeldPublicCopy("update 'Bad — label'");
    expect(copy.label).toBe(GM_HELD_CHIP_LABEL);
    expect(copy.message).toBe(GM_HELD_CHIP_MESSAGE);
  });
});

describe('buildGmHeldAppliedReceipt — receipts name what was confirmed', () => {
  it('single subject → "Confirmed: <subject>." plus the rerun guidance', () => {
    const text = buildGmHeldAppliedReceipt(["update 'Marketing'"]);
    expect(text).toContain("Confirmed: update 'Marketing'.");
    expect(text).toContain('Run the analysis again');
    expect(text).not.toContain('—');
    expect(findForbiddenPhraseHit(text)).toBeNull();
  });

  it('multiple subjects are each named', () => {
    const text = buildGmHeldAppliedReceipt(["update 'Marketing'", "update 'Goal'"]);
    expect(text).toContain("Confirmed: update 'Marketing'.");
    expect(text).toContain("Confirmed: update 'Goal'.");
  });

  it('no derivable subject → the generic applied copy (never blank)', () => {
    expect(buildGmHeldAppliedReceipt([])).toBe(GM_HELD_APPLIED_ASSISTANT_TEXT);
  });
});

describe('buildHeldAwareDegradeText — the degrade re-ask names the hold', () => {
  it('names the restated hold and keeps the consent framing', () => {
    const text = buildHeldAwareDegradeText("Update 'Marketing'");
    expect(text).toContain("update 'Marketing'");
    expect(text).toContain('Nothing in the model moves until you confirm');
    expect(text).not.toContain('—');
    expect(findForbiddenPhraseHit(text)).toBeNull();
  });

  it.each([
    ['legacy GM chip label', 'Continue with this change'],
    ['render-safe fallback', 'Apply this change'],
    ['blank', '   '],
    ['undefined', undefined],
  ])('%s → the unnamed swept copy', (_kind, label) => {
    expect(buildHeldAwareDegradeText(label)).toBe(HELD_AWARE_DEGRADE_TEXT);
  });
});

describe('buildGmHeldPublicCopy — wave-2 ask #20: the chip label is CLAMPED, the message never is', () => {
  // The R8 live probe found the confirm chip label was the entire ~300-char
  // changeset sentence (four edge removals + an option name). The label is
  // now clamped to chip length; the FULL description still reaches the user
  // via the hold ask and the held_proposal card summary, and the message
  // keeps the full subject because chip-click routing exact-matches it.
  const LONG_SUBJECT =
    "remove the link from 'Local Talent Market Tightness' to 'Hiring and Staffing Cost', " +
    "remove the link from 'Engineering Capacity' to 'Onboarding and Ramp-Up Delay', " +
    "remove the link from 'Offshore Engagement' to 'Budget Overrun Risk', " +
    "remove the link from 'Team Capability' to 'Roadmap Delivery' and add option 'Hire Two Senior Engineers Locally'";

  it('a multi-op subject yields a label of at most 60 chars, ellipsised', () => {
    const copy = buildGmHeldPublicCopy(LONG_SUBJECT);
    expect(LONG_SUBJECT.length).toBeGreaterThan(200); // positive control
    expect(copy.label.length).toBeLessThanOrEqual(60);
    expect(copy.label.endsWith('...')).toBe(true);
    expect(copy.label.charAt(0)).toBe('R'); // still the capitalised subject, not a generic
  });

  it('the MESSAGE keeps the full subject verbatim (exact-match routing depends on it)', () => {
    const copy = buildGmHeldPublicCopy(LONG_SUBJECT);
    expect(copy.message).toBe(`Yes, ${LONG_SUBJECT}.`);
  });

  it('a short subject is untouched (pre-#20 behaviour preserved byte-for-byte)', () => {
    const copy = buildGmHeldPublicCopy("update 'Marketing'");
    expect(copy.label).toBe("Update 'Marketing'");
    expect(copy.message).toBe("Yes, update 'Marketing'.");
  });

  it('two different long holds still get DISTINCT labels (1.16j identical-chips class)', () => {
    const other = LONG_SUBJECT.replace('Local Talent Market Tightness', 'A Completely Different Factor');
    expect(buildGmHeldPublicCopy(LONG_SUBJECT).label).not.toBe(buildGmHeldPublicCopy(other).label);
  });
});

describe('buildGmHeldPublicCopy — wave-2 ask #20: chip detail carries the full sentence behind a clamped label', () => {
  const LONG =
    "remove the link from 'Local Talent Market Tightness' to 'Hiring and Staffing Cost', " +
    "remove the link from 'Engineering Capacity' to 'Onboarding and Ramp-Up Delay' " +
    "and add option 'Hire Two Senior Engineers Locally'";

  it('clamped label → detail is the FULL capitalised sentence, verbatim', () => {
    const copy = buildGmHeldPublicCopy(LONG);
    expect(copy.label.endsWith('...')).toBe(true); // positive control: clamp fired
    expect(copy.detail).toBe(LONG.charAt(0).toUpperCase() + LONG.slice(1));
  });

  it('short label → detail ABSENT (the label already says everything)', () => {
    expect(buildGmHeldPublicCopy("update 'Marketing'").detail).toBeUndefined();
  });

  it('no safe subject → generic copy, no detail', () => {
    expect(buildGmHeldPublicCopy(null).detail).toBeUndefined();
  });
});

/**
 * ⭐ ONE CHANGE PER LINE (AI Conversation, Paul's test 27 Sep; #70 5855355688). Served, the grandfathering approval's
 * `detail` was ONE comma run of ~500 characters under the approve button. Given the SAME items the subject was
 * joined from, `detail` is those items, one per line: the same content, nothing summarised or dropped.
 * The ops mirror Paul's served add (export 90b8f080 user_actions[15]): an option, a factor, and its links.
 */
describe('buildGmHeldPublicCopy — a multi-part hold lists one change per line', () => {
  const graph = {
    nodes: [
      { id: 'dec', kind: 'decision', label: 'Decision: MRR' },
      { id: 'churn', kind: 'factor', label: 'Monthly churn' },
      { id: 'mrr', kind: 'goal', label: 'MRR' },
    ],
    edges: [],
  };
  const OPT = '£59 for new Pro customers; grandfather existing customers';
  const ops = [
    { op: 'add_node', path: 'opt-gf', value: { id: 'opt-gf', kind: 'option', label: OPT } },
    { op: 'add_node', path: 'fac-gf', value: { id: 'fac-gf', kind: 'factor', label: 'Existing customers grandfathered' } },
    { op: 'add_edge', path: 'dec->opt-gf', value: { from: 'dec', to: 'opt-gf' } },
    { op: 'add_edge', path: 'fac-gf->churn', value: { from: 'fac-gf', to: 'churn' } },
    { op: 'add_edge', path: 'fac-gf->mrr', value: { from: 'fac-gf', to: 'mrr' } },
  ];

  it('RED: the clamped chip\'s detail is the items, capitalised, ONE PER LINE: the same parts as the subject, in order', () => {
    const d = describeChangeset(ops, graph);
    expect(d, 'positive control: the ops describe').not.toBeNull();
    expect(d!.items.length).toBe(5);
    const copy = buildGmHeldPublicCopy(d!.subject, d!.items);
    const whole = d!.subject.charAt(0).toUpperCase() + d!.subject.slice(1);
    expect(clampLabel(whole) !== whole, 'positive control: the clamp fires on this subject').toBe(true);
    // ⭐ A short, WHOLE button: how many changes it approves, never a sentence cut mid-word (the list is the detail).
    expect(copy.label).toBe('Approve 5 changes');
    expect(copy.label).not.toMatch(/\.\.\.$|…$/);
    const lines = copy.detail!.split('\n');
    expect(lines).toEqual(d!.items.map((i) => i.charAt(0).toUpperCase() + i.slice(1)));
    expect(lines[0]).toContain(`'${OPT}'`);
    // Nothing summarised: every part of the subject is on a line of its own.
    for (const item of d!.items) expect(d!.subject).toContain(item);
    // The message still names the whole subject (exact-match routing depends on it).
    expect(copy.message).toBe(`Yes, ${d!.subject}.`);
  });

  it('CONTROL: one item, or no items passed → the detail is the capitalised sentence, as before', () => {
    const LONG = "add option '£59 for new Pro customers; grandfather existing customers and more words'";
    expect(buildGmHeldPublicCopy(LONG, [LONG]).detail).toBe(LONG.charAt(0).toUpperCase() + LONG.slice(1));
    expect(buildGmHeldPublicCopy(LONG).detail).toBe(LONG.charAt(0).toUpperCase() + LONG.slice(1));
    // One change keeps its own (clamped) words on the button: there is no list to count.
    expect(buildGmHeldPublicCopy(LONG, [LONG]).label.endsWith('...')).toBe(true);
    expect(buildGmHeldPublicCopy(LONG).label.endsWith('...')).toBe(true);
  });

  it('a short subject still carries no detail, whatever the items', () => {
    expect(buildGmHeldPublicCopy("update 'Marketing'", ["update 'Marketing'", 'x']).detail).toBeUndefined();
  });
});
