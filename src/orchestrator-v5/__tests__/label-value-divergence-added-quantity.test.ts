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

  it('DOES fire on an option with a single unambiguous intervention magnitude', () => {
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
    const divs = detectLabelValueDivergences([op], graphWith(node), graphWith(node));
    expect(divs).toHaveLength(1);
    expect(divs[0]!.path).toBe('opt_x');
    expect(divs[0]!.isOption).toBe(true);
    expect(divs[0]!.newValueToken).toBe('$39');
    expect(divs[0]!.oldValueToken).toBe('49');
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
