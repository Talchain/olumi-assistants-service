/**
 * ⭐ THE CAPABILITY CLAIM MUST BE TRUE — the `draft_graph` limb.
 *
 * Sibling of `unsupported-action-capability-honesty.test.ts` (ROADMAP 2.663),
 * which closed this defect for the STRUCTURAL category. The identical defect
 * survived in the GENERIC category for `draft_graph`, and was witnessed live.
 *
 * WITNESSED (fresh-guest capture, deployed staging, 25 Aug 2026 — 1 of 14
 * identity-bound runs; drafting SUCCEEDED in 12 of the other 13 on the same
 * deploy):
 *
 *   olumi  "I can't do draft graph through chat in this version. Here's what
 *           I can help with right now - ask a follow-up, or try one of the
 *           suggestions below."
 *
 * Drafting a model from a decision brief is the product's PRIMARY capability
 * and is dispatched unconditionally by route-v2 (`dispatchDraftGraph`, no
 * flag). The sentence tells the user the deployment does not have a
 * capability it demonstrably has, and offers no route to a model.
 *
 * ── THE MECHANISM (traced at `4a064e60`) ──────────────────────────────────
 * `draft_graph` is dispatched by the ROUTE, before routing, and is therefore
 * absent from BOTH the routing tool-schema enum and
 * `HANDLER_VALIDATION_REGISTRY` (7 ids, identical sets). When the routing
 * model proposes it anyway — an out-of-enum proposal, the only way this
 * composer is reachable at all — the validator returns HANDLER_NOT_FOUND,
 * `categorise('draft_graph')` finds it in none of the three named buckets,
 * and the GENERIC template asserts a version-level capability limit.
 *
 * ── THE INVARIANT UNDER TEST (written against the SPEC, not the case) ─────
 * The version-limit denial may be emitted ONLY where the capability is
 * genuinely unavailable in this deployment. A capability the deployment
 * provides through a different dispatch path is not unavailable — it is
 * merely not reachable as a validator handler, which is an implementation
 * fact the user must never be told as a product limit.
 *
 * ── TRAP 12d — DERIVATION IS BLIND TO A SHORT LIST ────────────────────────
 * `SYSTEM_DISPATCHED_CAPABILITY_PHRASES` is a hand-written table and is
 * therefore the part that can go short. It is pinned BOTH WAYS below: every
 * id in it must be absent from the registry AND from the tool-schema enum
 * (so an id that becomes a real handler REDs here rather than keeping a dead
 * entry), and `draft_graph` is pinned into it BY IDENTITY.
 */
import { describe, it, expect } from 'vitest';

import {
  composeUnsupportedActionResponse,
  SYSTEM_DISPATCHED_CAPABILITY_PHRASES,
} from '../unsupported-action-response.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import { OLUMI_ACTION_TOOL } from '../../routing/tool-schema.js';
import type { HandlerValidationRegistry } from '../../routing/validator.js';

/** The sentence that was false. Bound to the witnessed wording. */
const VERSION_LIMIT_DENIAL = /through chat in this version/i;

function compose(handlerId: string, hasAnalysis = false) {
  return composeUnsupportedActionResponse({
    handlerId,
    context: { handlerRegistry: HANDLER_VALIDATION_REGISTRY },
    stage: 'frame',
    hasAnalysis,
  });
}

describe('draft_graph refusal — the version-limit denial must not claim a capability the deployment has', () => {
  it('⭐ THE WITNESSED FALSE CLAIM — draft_graph does NOT get the version-limit denial', () => {
    const { response } = compose('draft_graph');
    expect(response.assistant_text).not.toMatch(VERSION_LIMIT_DENIAL);
    // The exact witnessed sentence, verbatim-ish, must be gone.
    expect(response.assistant_text.toLowerCase()).not.toContain(
      "i can't do draft graph through chat",
    );
  });

  it('⭐ OPPOSITE-DIRECTION TWIN — a genuinely unavailable action STILL gets the version-limit denial', () => {
    // The fix must not delete an honest sentence. `export_to_pdf` is not a
    // capability this deployment has by any dispatch path, so the claim is
    // true and must survive.
    const { response, category } = compose('export_to_pdf');
    expect(category).toBe('generic');
    expect(response.assistant_text).toMatch(VERSION_LIMIT_DENIAL);
  });

  it('⭐ the draft refusal names the REAL path forward — describe the decision', () => {
    const { response } = compose('draft_graph');
    const text = response.assistant_text.toLowerCase();
    // A concrete user action, not "ask a follow-up".
    expect(text).toContain('decision');
    expect(text).toMatch(/tell me|describe/);
    // And it affirms the capability rather than denying it.
    expect(text).toMatch(/i can|something i can do/);
  });

  it('⭐ it makes NO claim about the model or analysis state', () => {
    // A refusal must never assert that nothing was built / nothing was saved:
    // this composer has no view of the persisted graph, and the same sentence
    // is reachable on a continuation scenario that DOES hold a model.
    const { response } = compose('draft_graph');
    const text = response.assistant_text.toLowerCase();
    for (const falseStateClaim of [
      'nothing has been built',
      'nothing was saved',
      'no model',
      'your model was lost',
      'the analysis',
    ]) {
      expect(text).not.toContain(falseStateClaim);
    }
  });

  it('no internal handler vocabulary reaches the user', () => {
    const { response } = compose('draft_graph');
    expect(response.assistant_text).not.toContain('draft_graph');
  });

  it('⭐ every path still produces at least one chip (compose-layer contract)', () => {
    const { response } = compose('draft_graph');
    expect(response.suggested_actions.length).toBeGreaterThan(0);
  });

  it('⭐ REGRESSION TWIN — the 2.663 structural branch is untouched (edit_graph stays structural)', () => {
    const { category } = compose('edit_graph');
    expect(category).toBe('structural');
  });

  describe('trap 12d — the phrase table is pinned BOTH WAYS', () => {
    it('draft_graph is IN the table, by identity', () => {
      expect(Object.keys(SYSTEM_DISPATCHED_CAPABILITY_PHRASES)).toContain('draft_graph');
    });

    it('⭐ every id in the table is absent from the PRODUCTION validation registry', () => {
      // If one of these ever becomes a real validator handler, HANDLER_NOT_FOUND
      // can no longer fire for it and the table entry is dead code — RED here
      // rather than leaving a stale honesty branch nobody reaches.
      for (const id of Object.keys(SYSTEM_DISPATCHED_CAPABILITY_PHRASES)) {
        expect(HANDLER_VALIDATION_REGISTRY[id]).toBeUndefined();
      }
    });

    it('⭐ every id in the table is absent from the routing tool-schema enum', () => {
      const enumIds = OLUMI_ACTION_TOOL.input_schema.properties.action.properties
        .handler_id.enum as readonly string[];
      // Positive control: the enum is non-empty and holds a known handler, so
      // a silently-empty read cannot make this assertion vacuous.
      expect(enumIds.length).toBeGreaterThan(0);
      expect(enumIds).toContain('run_analysis');
      for (const id of Object.keys(SYSTEM_DISPATCHED_CAPABILITY_PHRASES)) {
        expect(enumIds).not.toContain(id);
      }
    });
  });

  it('⭐ NOT DARK — an injected registry cannot re-open the false claim', () => {
    // trap 18's cousin: prove the honest branch does not depend on the
    // registry the executor happens to thread in.
    const minimal = {
      run_analysis: {
        handler_id: 'run_analysis',
        accepted_entity_kinds: ['option'],
        confirmation_template: 'ok',
      },
    } as unknown as HandlerValidationRegistry;
    const { response } = composeUnsupportedActionResponse({
      handlerId: 'draft_graph',
      context: { handlerRegistry: minimal },
      stage: 'frame',
      hasAnalysis: false,
    });
    expect(response.assistant_text).not.toMatch(VERSION_LIMIT_DENIAL);
  });
});
