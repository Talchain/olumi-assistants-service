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

const GRAPH = {
  nodes: [
    { id: 'fac-marketing', kind: 'factor', label: 'Marketing' },
    { id: 'goal-g', kind: 'goal', label: 'Goal' },
  ],
  edges: [{ from: 'fac-marketing', to: 'goal-g' }],
};

describe('describeHeldOperationsSubject — names the held change', () => {
  it("update_node resolves the node label from the graph → update 'Marketing'", () => {
    const subject = describeHeldOperationsSubject(
      [{ op: 'update_node', path: 'fac-marketing', value: { description: 'x' } }],
      GRAPH,
    );
    expect(subject).toBe("update 'Marketing'");
  });

  it("add_node uses the new node's label → add 'Customer churn'", () => {
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
    expect(subject).toBe("add 'Customer churn'");
  });

  it("remove_node → remove 'Marketing'", () => {
    const subject = describeHeldOperationsSubject(
      [{ op: 'remove_node', path: 'fac-marketing' }],
      GRAPH,
    );
    expect(subject).toBe("remove 'Marketing'");
  });

  it("add_edge → link 'Marketing' to 'Goal'", () => {
    const subject = describeHeldOperationsSubject(
      [{ op: 'add_edge', path: 'edges/-', value: { from: 'fac-marketing', to: 'goal-g' } }],
      GRAPH,
    );
    expect(subject).toBe("link 'Marketing' to 'Goal'");
  });

  it('multi-op batches name the first op and count the rest', () => {
    const subject = describeHeldOperationsSubject(
      [
        { op: 'update_node', path: 'fac-marketing', value: { description: 'x' } },
        { op: 'remove_node', path: 'goal-g' },
      ],
      GRAPH,
    );
    expect(subject).toBe("update 'Marketing' and 1 more change");
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
