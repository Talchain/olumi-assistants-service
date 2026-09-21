/**
 * Label-value divergence — the ADD-ONLY leg, bound to a LIVE CAPTURE.
 *
 * The captured live defect (staging build `69d6e6e`, run
 * `20260811T012704Z-fresh-5e036e`, 2026-08-11): a user typed
 * "Change Annual CRM Spend to £63,000.". `change` is deliberately excluded from
 * the value-update gate's suppressor, so the turn dispatched to the edit_graph
 * LLM, which emitted a LABEL-ONLY `update_node`:
 *
 *   label:          "Annual CRM Spend"  →  "Annual CRM Spend (£63,000)"
 *   observed_state: BYTE-IDENTICAL — still raw_value 50000, display_value "£50k"
 *
 * The product renamed a node to ASSERT a figure it does not hold. The existing
 * detector could not see it: `detectOne` required a REPLACED quantity (an
 * old-only AND a new-only token), and the old label carried no quantity at all,
 * so an ADDED annotation was excluded BY DESIGN (label-value-divergence.ts, the
 * "A pure rename, an added annotation, or a formatting-only change is NOT a
 * divergence" clause).
 *
 * ⚠ THE FIXTURE IS A CAPTURE, NOT A CONVENIENCE. Every graph in these tests is
 * the verbatim wire payload from that run. A self-authored payload cannot prove
 * a pipeline behaviour (CLAUDE.md trap 16-inverse) — the whole reason the
 * original detector's scope looked adequate is that its corpus was written from
 * the same head that wrote the predicate.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  detectLabelValueDivergences,
  buildLabelValueDivergenceNote,
  buildLabelValueDivergenceActions,
  buildLabelValueDivergenceDescription,
} from '../label-value-divergence.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
  applyEgressForbiddenPhraseGuard,
} from '../compose/forbidden-user-facing-phrases.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/label-value-divergence-capture-5e036e.json', import.meta.url),
);

interface CaptureFixture {
  readonly _provenance: Record<string, unknown>;
  readonly pre_graph: { nodes: Record<string, unknown>[] };
  readonly post_graph: { nodes: Record<string, unknown>[] };
}

const capture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as CaptureFixture;

const TARGET_ID = 'fac_annual_crm_cost';
const PRE_LABEL = 'Annual CRM Spend';
const POST_LABEL = 'Annual CRM Spend (£63,000)';

/** Deep structural clone via JSON — the fixture is pure JSON by construction. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function preGraph(): unknown {
  return clone(capture.pre_graph);
}
function postGraph(): unknown {
  return clone(capture.post_graph);
}

function nodeIn(graph: unknown, id: string): Record<string, unknown> {
  const nodes = (graph as { nodes: Record<string, unknown>[] }).nodes;
  const n = nodes.find((x) => x.id === id);
  if (!n) throw new Error(`fixture is missing node ${id}`);
  return n;
}

/** The op the LLM actually emitted on the captured turn. */
function capturedOp(): unknown {
  return {
    op: 'update_node',
    path: TARGET_ID,
    value: { label: POST_LABEL },
    old_value: { label: PRE_LABEL },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A — CONTROL. Prove the instrument sees a PRESENCE before any absence claim,
//     and that the fixture is the payload under test (trap 13).
// ─────────────────────────────────────────────────────────────────────────────
describe('CONTROL — the captured fixture is the live payload under test', () => {
  it('carries the capture provenance of the failing staging run', () => {
    expect(capture._provenance.run).toBe('20260811T012704Z-fresh-5e036e');
    expect(capture._provenance.build_sha).toBe('69d6e6e');
    expect(capture._provenance.environment).toBe('staging');
    expect(capture._provenance.user_message_T4).toBe('Change Annual CRM Spend to £63,000.');
  });

  it('records what the product ACTUALLY served: the neutral fallback, and no actions', () => {
    // Append-only evidence. The egress guard correctly killed the LLM's false
    // success sentence; nothing honest replaced it, and the user was told
    // nothing about the divergence. This is the harm being closed.
    expect(capture._provenance.served_assistant_text_T4).toBe(
      "Let me know what you'd like me to do next, and I'll take it from there.",
    );
    expect(capture._provenance.served_suggested_actions_T4).toEqual([]);
  });

  it('is non-empty and the target node diverged in LABEL ONLY', () => {
    const pre = preGraph();
    const post = postGraph();
    expect((pre as { nodes: unknown[] }).nodes.length).toBe(14);
    expect((post as { nodes: unknown[] }).nodes.length).toBe(14);

    const preNode = nodeIn(pre, TARGET_ID);
    const postNode = nodeIn(post, TARGET_ID);
    expect(preNode.label).toBe(PRE_LABEL);
    expect(postNode.label).toBe(POST_LABEL);

    // The modelled value is BYTE-IDENTICAL across the edit — this is the defect.
    expect(postNode.observed_state).toEqual(preNode.observed_state);
    expect((preNode.observed_state as Record<string, unknown>).raw_value).toBe(50000);
    expect(preNode.display_value).toBe('£50k');
    // …and `observed_state.value` is NORMALISED (50000/cap 50000), NOT a
    // magnitude. Comparing a label token to it would be a category error.
    expect((preNode.observed_state as Record<string, unknown>).value).toBe(1);
    expect((preNode.observed_state as Record<string, unknown>).cap).toBe(50000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B — THE FIX. RED at pristine.
// ─────────────────────────────────────────────────────────────────────────────
describe('detectLabelValueDivergences — the ADD-ONLY case (captured payload)', () => {
  it('flags the captured label-only rename that ADDS a quantity the model does not hold', () => {
    const divs = detectLabelValueDivergences([capturedOp()], preGraph(), postGraph());
    expect(divs).toHaveLength(1);
    // Bind by IDENTITY, never by a value predicate another node could satisfy.
    expect(divs[0]!.path).toBe(TARGET_ID);
    expect(divs[0]!.isOption).toBe(false);
    expect(divs[0]!.newLabel).toBe(POST_LABEL);
    expect(divs[0]!.oldLabel).toBe(PRE_LABEL);
  });

  it('names the ADDED token as new and the MODELLED value as old', () => {
    const divs = detectLabelValueDivergences([capturedOp()], preGraph(), postGraph());
    expect(divs[0]!.newValueToken).toBe('£63,000');
    // The old token cannot come from the old label (it carried no quantity) —
    // it must be derived from the node's own modelled magnitude.
    expect(divs[0]!.oldValueToken).toBe('£50k');
  });

  it('produces the honest disclosure note, naming BOTH numbers and ASKING', () => {
    const divs = detectLabelValueDivergences([capturedOp()], preGraph(), postGraph());
    const note = buildLabelValueDivergenceNote(divs);
    expect(note).not.toBeNull();
    const text = note!;
    expect(text).toContain('£63,000'); // the figure the label now asserts
    expect(text).toContain('£50k'); // the figure the model actually holds
    expect(text).toContain('label text only');
    expect(text).toContain('modelled value is unchanged');
    expect(text).toContain('?'); // it ASKS; it does not claim
    expect(text.toLowerCase()).toContain('factor');
  });

  it('offers the typed affordance that can actually change the value', () => {
    const divs = detectLabelValueDivergences([capturedOp()], preGraph(), postGraph());
    const actions = buildLabelValueDivergenceActions(divs);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.prompt.toLowerCase()).toContain('set ');
    expect(actions[0]!.prompt).toContain('£63,000');
  });

  it('gives the receipt a description that can never read as a completed value change', () => {
    const divs = detectLabelValueDivergences([capturedOp()], preGraph(), postGraph());
    const desc = buildLabelValueDivergenceDescription(divs[0]!);
    expect(desc).toContain('display text only');
    expect(desc).toContain('£50k');
    expect(desc).toContain('£63,000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C — OPPOSITE-DIRECTION TWINS (CLAUDE.md trap 22b: every case gets its twin).
// ─────────────────────────────────────────────────────────────────────────────
describe('TWIN — the REPLACED case must behave exactly as before (no #647 regression)', () => {
  it('still fires, and still names the OLD LABEL token as the old value', () => {
    const op = {
      op: 'update_node',
      path: TARGET_ID,
      value: { label: 'Annual CRM Spend (£63,000)' },
      old_value: { label: 'Annual CRM Spend (£50,000)' },
    };
    const divs = detectLabelValueDivergences([op], preGraph(), postGraph());
    expect(divs).toHaveLength(1);
    expect(divs[0]!.path).toBe(TARGET_ID);
    // Unchanged behaviour: the replaced-token path reads the OLD LABEL, so the
    // token is "£50,000" (the label's own formatting), NOT the node's "£50k".
    expect(divs[0]!.oldValueToken).toBe('£50,000');
    expect(divs[0]!.newValueToken).toBe('£63,000');
  });
});

describe('TWIN — an ADDED quantity that AGREES with the modelled value must stay SILENT', () => {
  it('does not fire when the added token equals the modelled magnitude', () => {
    const op = {
      op: 'update_node',
      path: TARGET_ID,
      value: { label: 'Annual CRM Spend (£50,000)' },
      old_value: { label: PRE_LABEL },
    };
    expect(detectLabelValueDivergences([op], preGraph(), postGraph())).toHaveLength(0);
  });

  it('does not fire on a FORMATTING-equivalent agreement (£50k === £50,000)', () => {
    const op = {
      op: 'update_node',
      path: TARGET_ID,
      value: { label: 'Annual CRM Spend (£50k)' },
      old_value: { label: PRE_LABEL },
    };
    expect(detectLabelValueDivergences([op], preGraph(), postGraph())).toHaveLength(0);
  });

  it('stays silent on a pure rename that adds no quantity at all', () => {
    const op = {
      op: 'update_node',
      path: TARGET_ID,
      value: { label: 'Yearly CRM Spend' },
      old_value: { label: PRE_LABEL },
    };
    expect(detectLabelValueDivergences([op], preGraph(), postGraph())).toHaveLength(0);
  });

  it('stays silent when the SAME op also changes the modelled value', () => {
    const op = {
      op: 'update_node',
      path: TARGET_ID,
      value: { label: POST_LABEL, observed_state: { value: 1, raw_value: 63000, cap: 63000 } },
      old_value: { label: PRE_LABEL },
    };
    expect(detectLabelValueDivergences([op], preGraph(), postGraph())).toHaveLength(0);
  });

  it('stays silent when a SIBLING op changes that node’s modelled value', () => {
    const ops = [
      { op: 'update_node', path: TARGET_ID, value: { label: POST_LABEL }, old_value: { label: PRE_LABEL } },
      { op: 'update_node', path: TARGET_ID, value: { observed_state: { value: 1, raw_value: 63000 } } },
    ];
    expect(detectLabelValueDivergences(ops, preGraph(), postGraph())).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D — SAFE-BIASED NEGATIVES for the new path. A disclosure that names a number
//     must be able to name a TRUE one; where the modelled magnitude is
//     ambiguous or absent, silence is the honest answer.
// ─────────────────────────────────────────────────────────────────────────────
function graphWith(node: Record<string, unknown>): unknown {
  return { nodes: [node], edges: [], options: [], goal_node_id: null };
}

describe('ADD-ONLY — safe-biased: no comparable modelled magnitude ⇒ no claim', () => {
  it('stays silent on a node whose only modelled value is a NORMALISED unit-interval value', () => {
    // `observed_state.value` alone is 0..1 normalised. It is NOT a magnitude,
    // so "the model holds 0.7, your label says £63,000" would be a fabrication.
    const node = { id: 'n1', kind: 'factor', label: 'Adoption', observed_state: { value: 0.7 } };
    const op = {
      op: 'update_node',
      path: 'n1',
      value: { label: 'Adoption (£63,000)' },
      old_value: { label: 'Adoption' },
    };
    expect(detectLabelValueDivergences([op], graphWith(node), graphWith(node))).toHaveLength(0);
  });

  it('stays silent when the node’s own magnitude sources DISAGREE with each other', () => {
    const node = {
      id: 'n1',
      kind: 'factor',
      label: 'Spend',
      observed_state: { value: 1, unit: '£', raw_value: 50000, cap: 50000 },
      display_value: '£42k', // stale/disagreeing — we cannot name one true number
    };
    const op = {
      op: 'update_node',
      path: 'n1',
      value: { label: 'Spend (£63,000)' },
      old_value: { label: 'Spend' },
    };
    expect(detectLabelValueDivergences([op], graphWith(node), graphWith(node))).toHaveLength(0);
  });

  it('stays silent on an option whose interventions carry AMBIGUOUS magnitudes', () => {
    const node = {
      id: 'opt_x',
      kind: 'option',
      label: 'Raise',
      interventions: {
        fac_price: { value: 0.49, raw_value: 49 },
        fac_cost: { value: 0.2, raw_value: 20 },
      },
    };
    const op = {
      op: 'update_node',
      path: 'opt_x',
      value: { label: 'Raise ($39)' },
      old_value: { label: 'Raise' },
    };
    expect(detectLabelValueDivergences([op], graphWith(node), graphWith(node))).toHaveLength(0);
  });

  it('KNOWN-DROPPED — an added label carrying SEVERAL quantities stays silent', () => {
    // "(£63,000 over 3 years)" adds two tokens and there is no defensible way
    // to tell which is the value claim. Naming the wrong one would be a
    // confident falsehood; a gap is honest. Pinned so the class stays VISIBLE:
    // this test must RED if the behaviour changes in either direction.
    const op = {
      op: 'update_node',
      path: TARGET_ID,
      value: { label: 'Annual CRM Spend (£63,000 over 3 years)' },
      old_value: { label: PRE_LABEL },
    };
    expect(detectLabelValueDivergences([op], preGraph(), postGraph())).toHaveLength(0);
  });

  it('DOES fire on an option whose single intervention magnitude is DENOMINATED', () => {
    const node = {
      id: 'opt_x',
      kind: 'option',
      label: 'Raise',
      interventions: { fac_price: { value: 0.49, raw_value: 49, unit: 'GBP' } },
    };
    const op = {
      op: 'update_node',
      path: 'opt_x',
      value: { label: 'Raise (£39)' },
      old_value: { label: 'Raise' },
    };
    const divs = detectLabelValueDivergences([op], graphWith(node), graphWith(node));
    expect(divs).toHaveLength(1);
    expect(divs[0]!.path).toBe('opt_x');
    expect(divs[0]!.isOption).toBe(true);
    expect(divs[0]!.newValueToken).toBe('£39');
    expect(divs[0]!.oldValueToken).toBe('£49');
  });

  it('a BARE number against a BARE magnitude is not a value claim either', () => {
    // The case the unit-agreement rule CANNOT catch, because both sides are
    // equally undenominated: "49" vs "39" passes a type check trivially. Only
    // the semantic rule — a magnitude must be a real-world quantity — stops the
    // product saying "will still use 49, not 39" about two bare scores.
    //
    // Added after a mutant showed the neighbouring KNOWN-DROPPED case was
    // pinned by unit agreement rather than by the semantic rule, so the
    // semantic rule had no independent guard on this shape.
    const node = {
      id: 'opt_x',
      kind: 'option',
      label: 'Raise',
      interventions: { fac_price: { value: 0.49, raw_value: 49 } },
    };
    const op = {
      op: 'update_node',
      path: 'opt_x',
      value: { label: 'Raise (39)' },
      old_value: { label: 'Raise' },
    };
    expect(detectLabelValueDivergences([op], graphWith(node), graphWith(node))).toHaveLength(0);
  });

  it('KNOWN-DROPPED — an UNDENOMINATED intervention magnitude cannot be quoted', () => {
    // Same option, but the intervention carries no unit, so "49" is a bare
    // number. We cannot type-check the label's "$39" against it, and quoting an
    // undenominated figure at the user is the P2-1 defect. Silence is honest.
    const node = {
      id: 'opt_x',
      kind: 'option',
      label: 'Raise',
      interventions: { fac_price: { value: 0.49, raw_value: 49 } },
    };
    const op = {
      op: 'update_node',
      path: 'opt_x',
      value: { label: 'Raise ($39)' },
      old_value: { label: 'Raise' },
    };
    expect(detectLabelValueDivergences([op], graphWith(node), graphWith(node))).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D2 — PERCENT NODES. The unit has to be part of the comparison key, or the
//      detector is simultaneously a liar and mute on the same node class.
//      (Round-1 review, P1-1 / P1-2 — found by a corpus written outside the
//      author's head, and invisible to an all-currency one.)
// ─────────────────────────────────────────────────────────────────────────────
function percentNode(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'fac_churn',
    kind: 'factor',
    label: 'Monthly churn',
    observed_state: { value: 0.05, unit: '%', raw_value: 5 },
    ...extra,
  };
}

const percentOp = (label: string) => ({
  op: 'update_node',
  path: 'fac_churn',
  value: { label },
  old_value: { label: 'Monthly churn' },
});

describe('PERCENT — the unit is part of the key', () => {
  it('P1-1 — an AGREEING percent label is silent (it must not say "5%, not 5%")', () => {
    const node = percentNode();
    const divs = detectLabelValueDivergences(
      [percentOp('Monthly churn (5%)')],
      graphWith(node),
      graphWith(node),
    );
    expect(divs).toHaveLength(0);
  });

  it('P1-1 twin — a DIVERGENT percent label fires and names both figures', () => {
    const node = percentNode();
    const divs = detectLabelValueDivergences(
      [percentOp('Monthly churn (8%)')],
      graphWith(node),
      graphWith(node),
    );
    expect(divs).toHaveLength(1);
    expect(divs[0]!.path).toBe('fac_churn');
    expect(divs[0]!.oldValueToken).toBe('5%');
    expect(divs[0]!.newValueToken).toBe('8%');
    const note = buildLabelValueDivergenceNote(divs)!;
    expect(note).toContain('5%');
    expect(note).toContain('8%');
    // The false sentence this class produced before the fix.
    expect(note).not.toContain('still use 5%, not 5%');
  });

  it('P1-2 — a percent node WITH an agreeing display_value is not read as "disagreeing"', () => {
    const node = percentNode({ display_value: '5%' });
    // Silent when the label agrees …
    expect(
      detectLabelValueDivergences([percentOp('Monthly churn (5%)')], graphWith(node), graphWith(node)),
    ).toHaveLength(0);
    // … and NOT silent on a genuine divergence — the P1-2 harm was that this
    // shape was mute in every direction.
    const divs = detectLabelValueDivergences(
      [percentOp('Monthly churn (8%)')],
      graphWith(node),
      graphWith(node),
    );
    expect(divs).toHaveLength(1);
    expect(divs[0]!.oldValueToken).toBe('5%');
    expect(divs[0]!.newValueToken).toBe('8%');
  });

  it('KNOWN-DROPPED — a CROSS-UNIT assertion (currency on a percent node) stays silent', () => {
    // "£63,000" on a percent factor is denominated differently from the value
    // it would be read against, so there is no honest magnitude comparison to
    // state. Reported to the coordinator as a deliberate consequence of the
    // unit-agreement rule rather than silently absorbed.
    const node = percentNode({ display_value: '5%' });
    expect(
      detectLabelValueDivergences(
        [percentOp('Monthly churn (£63,000)')],
        graphWith(node),
        graphWith(node),
      ),
    ).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D3 — BARE DIGITS. LEG 1's replaced-token requirement was the only brake on
//      this; LEG 2 removed it. Every case below is on the REAL captured node,
//      and each previously produced a false sentence AND a live chip that would
//      have committed the wrong number to the model. (Round-1 review, P1-3.)
// ─────────────────────────────────────────────────────────────────────────────
describe('BARE DIGITS — an added number with no denomination is not a value claim', () => {
  const cases: readonly [string, string][] = [
    ['a fiscal-year suffix', 'Annual CRM Spend FY26'],
    ['a phase annotation', 'Annual CRM Spend (Phase 2)'],
    ['a count in prose', 'Annual CRM Spend across top 3 vendors'],
    ['a quarter and a year', 'Annual CRM Spend (renewal Q1 2027)'],
    ['an ordinal', 'Annual CRM Spend (2nd revision)'],
  ];

  it.each(cases)('stays silent on %s', (_why, label) => {
    const op = {
      op: 'update_node',
      path: TARGET_ID,
      value: { label },
      old_value: { label: PRE_LABEL },
    };
    expect(detectLabelValueDivergences([op], preGraph(), postGraph())).toHaveLength(0);
  });

  it('CONTRAST CONTROL — the same node still fires on a DENOMINATED figure', () => {
    // Without this, every row above would pass on a detector that had simply
    // stopped working (trap 20: a probe returning the same answer for every
    // input is reporting on itself).
    const divs = detectLabelValueDivergences([capturedOp()], preGraph(), postGraph());
    expect(divs).toHaveLength(1);
    expect(divs[0]!.newValueToken).toBe('£63,000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D4 — P2-1: the normalised-value exclusion must guard the SEMANTIC, not a
//      field name. This node is from the captured graph, not invented.
// ─────────────────────────────────────────────────────────────────────────────
describe('NORMALISED SCORES — excluded by what they ARE, not by where they are read from', () => {
  it('stays silent on the captured node whose score reaches display_value', () => {
    const node = nodeIn(preGraph(), 'fac_platform_capability');
    // PIN THE PRECONDITION: this fixture only tests what it claims while it
    // really does carry a bare score with no raw_value (trap 13b).
    expect((node.observed_state as Record<string, unknown>).raw_value).toBeUndefined();
    expect(node.display_value).toBe('Moderate (0.4)');

    const op = {
      op: 'update_node',
      path: 'fac_platform_capability',
      value: { label: `${String(node.label)} (0.5)` },
      old_value: { label: String(node.label) },
    };
    expect(detectLabelValueDivergences([op], preGraph(), postGraph())).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E — THE FIX MUST BE INCAPABLE OF MUTATING ANYTHING.
// ─────────────────────────────────────────────────────────────────────────────
describe('DISCLOSURE ONLY — the detector cannot change a value or an op', () => {
  it('leaves the ops, the pre-graph and the post-graph byte-identical', () => {
    const ops = [capturedOp()];
    const pre = preGraph();
    const post = postGraph();
    const opsBefore = JSON.stringify(ops);
    const preBefore = JSON.stringify(pre);
    const postBefore = JSON.stringify(post);

    const divs = detectLabelValueDivergences(ops, pre, post);
    // Positive control FIRST: the run must actually have DONE something, or
    // "nothing changed" is vacuous. Asserting it before the builders also keeps
    // a suppression mutant failing on a clean assertion rather than on a
    // dereference of divs[0], so the mutant table stays readable.
    expect(divs).toHaveLength(1);

    buildLabelValueDivergenceNote(divs);
    buildLabelValueDivergenceActions(divs);
    buildLabelValueDivergenceDescription(divs[0]!);

    expect(JSON.stringify(ops)).toBe(opsBefore);
    expect(JSON.stringify(pre)).toBe(preBefore);
    expect(JSON.stringify(post)).toBe(postBefore);
  });

  it('runs to completion against DEEP-FROZEN inputs (a write would throw in strict mode)', () => {
    const deepFreeze = <T>(v: T): T => {
      if (v && typeof v === 'object') {
        Object.getOwnPropertyNames(v).forEach((k) => deepFreeze((v as Record<string, unknown>)[k]));
        Object.freeze(v);
      }
      return v;
    };
    const ops = deepFreeze([capturedOp()]);
    const pre = deepFreeze(preGraph());
    const post = deepFreeze(postGraph());

    let divs: ReturnType<typeof detectLabelValueDivergences> = [];
    expect(() => {
      divs = detectLabelValueDivergences(ops, pre, post);
      buildLabelValueDivergenceNote(divs);
      buildLabelValueDivergenceActions(divs);
    }).not.toThrow();
    expect(divs).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F — SURVIVING THE SEAM THAT DESTROYED THE ORIGINAL SENTENCE.
//     On the captured turn the LLM's success sentence tripped the finaliser
//     egress guard and the WHOLE assistant_text was replaced. That guard runs
//     LAST over the concatenated text (edit-graph-dispatch.ts, the
//     `applyEgressForbiddenPhraseGuard` finaliser hook), so a disclosure that
//     itself trips it would be destroyed the same way — and the user would
//     again be told nothing.
// ─────────────────────────────────────────────────────────────────────────────
describe('EGRESS — the disclosure note must pass the guard that killed the original text', () => {
  /**
   * ⚠ PIN THE PRECONDITION IN-TEST. `buildLabelValueDivergenceNote([])` returns
   * null, and `findForbiddenPhraseHit(null as never)` coerces to the string
   * "null" and reports no hit — so without this assertion every test below
   * would PASS VACUOUSLY at pristine, certifying a sentence that does not
   * exist. (Measured: they did exactly that on the RED-first run.)
   */
  const note = (): string => {
    const text = buildLabelValueDivergenceNote(
      detectLabelValueDivergences([capturedOp()], preGraph(), postGraph()),
    );
    expect(text).not.toBeNull();
    expect(typeof text).toBe('string');
    expect((text ?? '').length).toBeGreaterThan(80);
    return text!;
  };

  it('contains no forbidden user-facing phrase', () => {
    expect(findForbiddenPhraseHit(note())).toBeNull();
  });

  it('contains no success-claim phrase (it must never read as a completed change)', () => {
    expect(findSuccessClaimHit(note())).toBeNull();
  });

  it('survives the finaliser egress guard byte-for-byte', () => {
    const text = note();
    const guarded = applyEgressForbiddenPhraseGuard(text);
    expect(guarded.rewritten).toBe(false);
    expect(guarded.remedy).toBe('none');
    expect(guarded.text).toBe(text);
  });

  it('POSITIVE CONTROL — the guard is live and does destroy a fatal-class text', () => {
    // Derived, not assumed: `applyEgressForbiddenPhraseGuard` consults
    // FORBIDDEN_USER_FACING_PHRASES only. A success claim ("I've successfully
    // updated…") is NOT in that list — it is caught by the separate
    // `findSuccessClaimHit` path — so using one here would have made this
    // control silently non-discriminating. This is the denial class, which is
    // fatal and has no terminology rewrite.
    const fatal = applyEgressForbiddenPhraseGuard(
      "I haven't applied any changes to the factor.",
    );
    expect(fatal.rewritten).toBe(true);
    expect(fatal.remedy).toBe('fallback_replacement');
    expect(fatal.text).toBe("Let me know what you'd like me to do next, and I'll take it from there.");
  });
});
