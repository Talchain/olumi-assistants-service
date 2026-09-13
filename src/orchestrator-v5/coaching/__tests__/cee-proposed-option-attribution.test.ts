/**
 * ⭐⭐ AN OPTION OLUMI INVENTED IS PRESENTED AS IF THE USER HAD STATED IT.
 *
 * ── THE WITNESSED DEFECT ───────────────────────────────────────────────────
 * The founder's own session: his stated option was a no-op, the product
 * invented `Raise Price to £54 (Soft Increase)`, and £54 won at 73% — a price
 * he never named, with nothing on screen saying the option was ours.
 *
 * The user meets the option set FIRST as prose, in the post-draft narrative's
 * `Options compared` / `Options on the canvas` bullet list. That list is built
 * from labels ONLY: `collectLabels` (`post-draft-narrative.ts`) projects each
 * node to its `label` string and `buildOptionsBlock` takes `readonly string[]`,
 * so the provenance verdict the projector already stamped on every option node
 * is discarded two lines before it would be read.
 *
 * ── THE CREATIVE BEHAVIOUR IS NOT THE DEFECT ───────────────────────────────
 * Inventing a fourth, hybrid option is the product doing its job, and nothing
 * here suppresses it. The defect is that the invention is UNATTRIBUTED.
 *
 * ── WHY A CONJUNCTION, AND NOT THE OBVIOUS SINGLE SIGNAL ───────────────────
 * `node.provenance === 'ai_inferred'` ALONE IS NOT SAFE, and the producer says
 * so in its own header. `bindOptionLabelToBrief` shares a 3-character
 * specificity floor whose second consumer was undocumented when it landed:
 * `brief-binding.ts:153-157` records that a genuine two-character option the
 * user wrote (`"Go"`) "now reads `cee_hypothesis` rather than
 * `brief_extraction`". Marking on that signal alone would tell a user that
 * their own option was our suggestion — a false claim about authorship, which
 * is the opposite-direction harm and strictly worse than the silence it
 * replaces.
 *
 * So the claim is made only when TWO INDEPENDENT SIGNALS AGREE:
 *   1. `provenance === 'ai_inferred'`  — the projected verdict, and
 *   2. no `source_quote`               — a STRUCTURAL fact about the contract.
 *
 * (2) is the strong one. A user-stated option arrives in `stated_items[]`,
 * whose schema REQUIRES `source_quote` (`grammar.ts:484`); an invented option
 * arrives in `claims[]`, which has no `source_quote` field at all. The
 * projector states the consequence directly (`projector.ts:4257-4259`): an
 * `ai_inferred` claim node "has no `source_quote` and whose label was never the
 * user's".
 *
 * ── FAIL-SAFE DIRECTION, STATED ────────────────────────────────────────────
 * UNDER-disclosing our own suggestion is recoverable; falsely telling a user we
 * invented THEIR option is not. Every ambiguous shape therefore goes UNMARKED —
 * an absent provenance stamp, a legacy graph, a stated option whose short label
 * failed the binding floor. This mirrors the ruling the goal opener already
 * made one surface over (`post-draft-narrative.ts`: "UNDER-crediting the user
 * is recoverable, OVER-crediting them is the lie").
 *
 * ── EVIDENCE CLASS ─────────────────────────────────────────────────────────
 * The anti-vacuity control reads the FROZEN GOVERNED CAPTURE — real
 * `claude-sonnet-4-6` production output — rather than a fixture written here,
 * because a fixture the author writes encodes the author's model of the
 * producer rather than the producer (trap 16-inverse). That capture is READ,
 * never written.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildPostDraftNarrative } from '../post-draft-narrative.js';
import type { GraphV3T } from '../../../orchestrator/types.js';

/** The frozen governed baseline — real production model output. */
const GOVERNED_RUN =
  'tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json';

const CEE_PROPOSED_MARKER = ' — my suggestion';

function makeGraph(nodes: unknown[]): GraphV3T {
  return { nodes, edges: [] } as unknown as GraphV3T;
}

function narrative(nodes: unknown[]): string {
  const result = buildPostDraftNarrative({
    graph: makeGraph(nodes),
    analysisReady: { status: 'ready' },
  });
  expect(result.text.length, 'narrative must be non-empty').toBeGreaterThan(0);
  return result.text;
}

const GOAL_NODE = {
  id: 'goal_attr',
  kind: 'goal',
  provenance: 'from_brief',
  source_quote: 'protect margin on rural deliveries',
  label: 'Protect Margin on Rural Deliveries',
};

/** A user-stated option: `stated_items[]` REQUIRES `source_quote`. */
const STATED_OPTION = {
  id: 'opt_stated',
  kind: 'option',
  provenance: 'from_brief',
  source_quote: 'outsource the rural routes to a partner',
  label: 'Outsource the Rural Routes to a Partner',
};

/** An invented option: `claims[]` carries a model-authored label and no quote. */
const CEE_PROPOSED_OPTION = {
  id: 'opt_cee',
  kind: 'option',
  provenance: 'ai_inferred',
  label: 'Raise Price to £54 (Soft Increase)',
};

// ---------------------------------------------------------------------------
// Instrument controls — before any claim rests on the corpus.
// ---------------------------------------------------------------------------

describe('attribution corpus controls — the instrument can see both classes', () => {
  it('ANTI-VACUITY: real production output genuinely contains BOTH option classes', () => {
    const parsed = JSON.parse(fs.readFileSync(GOVERNED_RUN, 'utf8')) as {
      run?: { cases?: Array<{ graph?: { nodes?: Array<Record<string, unknown>> } }> };
    };
    const cases = parsed.run?.cases ?? [];
    expect(cases.length, 'governed capture yielded no cases').toBeGreaterThan(0);

    let stated = 0;
    let invented = 0;
    for (const c of cases) {
      for (const n of c.graph?.nodes ?? []) {
        if (n.kind !== 'option') continue;
        const prov = n.provenance as { provenance_class?: string; source_quote?: string } | undefined;
        if (prov?.provenance_class === 'stated' && typeof prov.source_quote === 'string') stated++;
        if (prov?.provenance_class === 'ai_inferred' && prov.source_quote === undefined) invented++;
      }
    }
    // Both directions must be present, or every assertion below is empty.
    expect(stated, 'no user-stated options in the capture').toBeGreaterThan(0);
    expect(invented, 'no CEE-invented options in the capture').toBeGreaterThan(0);
  });

  it('CONTROL: the narrative renders both option labels at all', () => {
    const text = narrative([GOAL_NODE, STATED_OPTION, CEE_PROPOSED_OPTION]);
    expect(text).toContain(STATED_OPTION.label);
    expect(text).toContain(CEE_PROPOSED_OPTION.label);
  });
});

// ---------------------------------------------------------------------------
// The defect.
// ---------------------------------------------------------------------------

describe('an option Olumi proposed is marked as ours', () => {
  it('marks the CEE-proposed option, BOUND BY IDENTITY to its own label', () => {
    const text = narrative([GOAL_NODE, STATED_OPTION, CEE_PROPOSED_OPTION]);
    // Bind to the object by identity — a bare "the marker appears somewhere"
    // would pass if the marker landed on the WRONG option (standing brief §3).
    expect(text).toContain(`${CEE_PROPOSED_OPTION.label}${CEE_PROPOSED_MARKER}`);
  });

  it("does NOT mark the user's own stated option", () => {
    const text = narrative([GOAL_NODE, STATED_OPTION, CEE_PROPOSED_OPTION]);
    expect(text).not.toContain(`${STATED_OPTION.label}${CEE_PROPOSED_MARKER}`);
  });

  it('marks a sole invented option on the one-route line', () => {
    const text = narrative([GOAL_NODE, CEE_PROPOSED_OPTION]);
    expect(text).toContain(`${CEE_PROPOSED_OPTION.label}${CEE_PROPOSED_MARKER}`);
  });
});

// ---------------------------------------------------------------------------
// The fail-safe direction. These are the cases that must stay SILENT.
// ---------------------------------------------------------------------------

describe('fail-safe — an ambiguous option is never claimed as ours', () => {
  it('a stated option that FAILED the 3-char binding floor is not marked (the "Go" case)', () => {
    // `brief-binding.ts:153-157`: a genuine two-character option the user wrote
    // reads `cee_hypothesis`/`ai_inferred`. Its `source_quote` is still present,
    // so the conjunction withholds the claim.
    const shortStated = {
      id: 'opt_go',
      kind: 'option',
      provenance: 'ai_inferred',
      source_quote: 'Go',
      label: 'Go',
    };
    const text = narrative([GOAL_NODE, shortStated, STATED_OPTION]);
    expect(text).not.toContain(`${shortStated.label}${CEE_PROPOSED_MARKER}`);
  });

  it('an option carrying NO provenance stamp at all is not marked (legacy graph)', () => {
    const legacy = { id: 'opt_legacy', kind: 'option', label: 'Legacy Route' };
    const text = narrative([GOAL_NODE, legacy, STATED_OPTION]);
    expect(text).not.toContain(`${legacy.label}${CEE_PROPOSED_MARKER}`);
  });

  it('an option whose provenance is from_brief but carries no quote is not marked', () => {
    const noQuote = {
      id: 'opt_nq',
      kind: 'option',
      provenance: 'from_brief',
      label: 'Stated Without A Quote',
    };
    const text = narrative([GOAL_NODE, noQuote, STATED_OPTION]);
    expect(text).not.toContain(`${noQuote.label}${CEE_PROPOSED_MARKER}`);
  });
});
