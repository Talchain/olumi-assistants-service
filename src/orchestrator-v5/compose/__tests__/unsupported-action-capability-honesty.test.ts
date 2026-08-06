/**
 * ⭐ PC1 / ROADMAP 2.663 rider — THE CAPABILITY CLAIM MUST BE TRUE.
 *
 * WITNESSED (consent-witness walk, CEE `bb33751`, 6 Aug 2026, §4):
 *
 *   user   "I wish the conflicting churn constraints would go away …"
 *   olumi  "I can't make structural changes to the model through chat in this
 *           version. You can make this change (edit graph) directly on the
 *           canvas …"
 *
 * TWO TURNS EARLIER, in the same conversation, chat had made a structural
 * change: "Add a constraint keeping churn below 3%" → "Applied", constraints
 * tile 1 → 2, server graph hash moved. The witness recorded the collision
 * verbatim: "A user who just watched it add a constraint cannot reconcile this
 * sentence."
 *
 * ── THE MECHANISM (traced at `0ecf5c67`) ──────────────────────────────────
 * The LLM proposed the UNREGISTERED handler `edit_graph`; the validator
 * returned HANDLER_NOT_FOUND; `composeUnsupportedActionResponse` categorised
 * `edit_graph` as `structural` and emitted a BLANKET denial. The narrow claim
 * ("I can't do edit_graph") was accurate. The blanket one ("I can't make
 * structural changes … through chat") was false, and it is the one the user
 * reads.
 *
 * ── THE INVARIANT UNDER TEST ──────────────────────────────────────────────
 * The refusal may deny only the handler that was actually unavailable, and it
 * must name what the deployment CAN do — DERIVED from the live handler
 * registry, never from a second hand-maintained list that can drift from it
 * (CLAUDE.md trap 12).
 *
 * ── TRAP 12d — DERIVATION IS BLIND TO A SHORT LIST ────────────────────────
 * Deriving the sentence from the registry proves the copy AGREES with what is
 * registered; it can never prove the phrase table is complete. The union
 * assertion at the bottom is the non-derived half: every id in
 * `GRAPH_MUTATING_HANDLER_IDS` must have a phrase, so adding a fourth mutating
 * handler REDs here instead of silently dropping out of the sentence.
 */
import { describe, it, expect } from 'vitest';

import { composeUnsupportedActionResponse } from '../unsupported-action-response.js';
import { MUTATION_CAPABILITY_PHRASES } from '../unsupported-action-response.js';
import { GRAPH_MUTATING_HANDLER_IDS } from '../../routing/mutation-consent.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import type { HandlerValidationRegistry } from '../../routing/validator.js';

/** A registry shaped like the deployed one: the three mutations ARE registered. */
const REGISTRY_WITH_MUTATIONS: HandlerValidationRegistry = {
  run_analysis: {
    handler_id: 'run_analysis',
    accepted_entity_kinds: ['option'],
    confirmation_template: 'ok',
  },
  add_constraint: {
    handler_id: 'add_constraint',
    accepted_entity_kinds: ['node'],
    confirmation_template: 'ok',
  },
  set_factor_value: {
    handler_id: 'set_factor_value',
    accepted_entity_kinds: ['node'],
    confirmation_template: 'ok',
  },
  adjust_edge_strength: {
    handler_id: 'adjust_edge_strength',
    accepted_entity_kinds: ['edge'],
    confirmation_template: 'ok',
  },
} as unknown as HandlerValidationRegistry;

/** The same deployment MINUS every mutating handler — the honest-denial case. */
const REGISTRY_WITHOUT_MUTATIONS: HandlerValidationRegistry = {
  run_analysis: {
    handler_id: 'run_analysis',
    accepted_entity_kinds: ['option'],
    confirmation_template: 'ok',
  },
} as unknown as HandlerValidationRegistry;

function compose(registry: HandlerValidationRegistry, handlerId = 'edit_graph') {
  return composeUnsupportedActionResponse({
    handlerId,
    context: { handlerRegistry: registry },
    stage: 'analyse',
    hasAnalysis: false,
  });
}

describe('2.663 rider — the structural refusal may not deny a capability the deployment has', () => {
  it('⭐ THE WITNESSED FALSE CLAIM — with the mutating handlers REGISTERED, the blanket denial is gone', () => {
    const { response } = compose(REGISTRY_WITH_MUTATIONS);
    // Bind to the witnessed sentence, which is the thing that was false.
    expect(response.assistant_text).not.toMatch(
      /can'?t make structural changes to the model through chat/i,
    );
  });

  it('⭐ …and it NAMES what chat can do, derived from the registry', () => {
    const { response } = compose(REGISTRY_WITH_MUTATIONS);
    // Every registered mutation's phrase appears — bound to the exported table,
    // not to a re-typed copy of the sentence (trap 12).
    for (const id of ['add_constraint', 'set_factor_value', 'adjust_edge_strength']) {
      expect(response.assistant_text).toContain(MUTATION_CAPABILITY_PHRASES[id]!);
    }
    // No internal vocabulary reaches the user.
    for (const id of GRAPH_MUTATING_HANDLER_IDS) {
      expect(response.assistant_text).not.toContain(id);
    }
  });

  it('⭐ DISCRIMINATING PAIR — a handler REMOVED from the registry is NOT offered', () => {
    const partial = { ...REGISTRY_WITH_MUTATIONS } as Record<string, unknown>;
    delete partial.adjust_edge_strength;
    const { response } = compose(partial as unknown as HandlerValidationRegistry);

    expect(response.assistant_text).toContain(MUTATION_CAPABILITY_PHRASES.add_constraint!);
    expect(response.assistant_text).not.toContain(
      MUTATION_CAPABILITY_PHRASES.adjust_edge_strength!,
    );
  });

  it('⭐ DISCRIMINATING PAIR — with NO mutating handler registered the blanket denial is CORRECT and returns', () => {
    // The fix must not delete an honest sentence: on a deployment that really
    // cannot mutate through chat, the original claim is true and must survive.
    const { response } = compose(REGISTRY_WITHOUT_MUTATIONS);
    expect(response.assistant_text).toMatch(
      /can'?t make structural changes to the model through chat/i,
    );
  });

  it('the narrow denial still names the unavailable handler in plain words', () => {
    const { response } = compose(REGISTRY_WITH_MUTATIONS);
    expect(response.assistant_text.toLowerCase()).toContain('edit graph');
    expect(response.assistant_text).not.toContain('edit_graph');
  });

  it('⭐ NOT DARK — the PRODUCTION validation registry takes the honest branch', () => {
    // CLAUDE.md trap 18's cousin: a fixture proves the code path, never the
    // deployment. `HANDLER_VALIDATION_REGISTRY` is the object the executor
    // actually threads into this composer, so this is the pin that the fix is
    // live rather than reachable only from a test's own registry.
    const { response } = composeUnsupportedActionResponse({
      handlerId: 'edit_graph',
      context: { handlerRegistry: HANDLER_VALIDATION_REGISTRY },
      stage: 'analyse',
      hasAnalysis: false,
    });
    expect(response.assistant_text).not.toMatch(
      /can'?t make structural changes to the model through chat/i,
    );
    expect(response.assistant_text).toContain(MUTATION_CAPABILITY_PHRASES.add_constraint!);
  });

  it('TRAP 12d COMPLETENESS — every graph-mutating handler has a user-facing phrase', () => {
    // NOT derived from the phrase table: derived from the canonical mutating
    // set, so a new mutating handler cannot join silently.
    for (const id of GRAPH_MUTATING_HANDLER_IDS) {
      expect(MUTATION_CAPABILITY_PHRASES[id], `no phrase for ${id}`).toBeTypeOf('string');
      expect(MUTATION_CAPABILITY_PHRASES[id]!.length).toBeGreaterThan(0);
    }
    // …and the table carries nothing that is not a mutating handler, so it
    // cannot quietly advertise something the gate does not cover.
    for (const id of Object.keys(MUTATION_CAPABILITY_PHRASES)) {
      expect(GRAPH_MUTATING_HANDLER_IDS.has(id), `stale phrase for ${id}`).toBe(true);
    }
  });
});
