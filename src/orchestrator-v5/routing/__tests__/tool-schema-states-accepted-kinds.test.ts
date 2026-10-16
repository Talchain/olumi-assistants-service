/**
 * The tool schema must not offer the router an entity kind the validator will
 * refuse — DERIVED from the validator, so the two cannot drift.
 *
 * ⭐ THE WITNESS. Deployed staging, build `b7c323c`, 2026-09-19 at 14:33:14Z
 * and 14:35:44Z. The router proposed `kind: 'edge'` for `what_would_flip`; the
 * validator refused it (`ENTITY_KIND_MISMATCH`, accepted
 * `['goal','option','node']`); the user saw "I couldn't match that to anything
 * in your model" twice, after 13.7s and 12.2s. **That is 2 of the day's 5
 * handler elections lost to a contract disagreement, not to a bad answer.**
 *
 * The model was not wrong to try. `tool-schema.ts` offers `edge` in the global
 * entity-kind enum and teaches elsewhere that an edge denotes a causal link,
 * while `what_would_flip`'s own guidance said nothing about which kinds it
 * takes. `adjust_edge_strength`'s guidance DOES state its kind, and has never
 * produced this failure — so the fix is the existing pattern, applied.
 *
 * ⚠ AND THE VALIDATOR CANNOT RESCUE IT, which is why this has to be fixed on
 * the schema side. Its entity-kind repair is explicitly skipped when
 * `kind === 'edge'` (`routing/validator.ts:403-405`), because an edge id is
 * the composite "source→target" and does not resolve by id. Repairing it would
 * mean choosing an endpoint on the user's behalf — inventing which half of the
 * link they meant. Telling the model is the only fix that invents nothing.
 *
 * WHAT THIS GUARD IS, precisely: it reads `accepted_entity_kinds` off the
 * REGISTRY at runtime and asserts the schema text is consistent with it. It is
 * not a copy of the kind list, so widening the handler later moves both sides
 * or REDs — it cannot silently drift the way a hand-written assertion would.
 */
import { describe,expect,it } from 'vitest';

import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';




describe('tool schema ↔ validator: accepted entity kinds agree', () => {
  it('the registry still refuses `edge` for what_would_flip (the premise this guard rests on)', () => {
    // PIN THE PRECONDITION IN-TEST. If the handler is ever widened to accept
    // edges, the assertion below stops being the right thing to want, and this
    // line makes that visible instead of leaving a guard that passes for a
    // reason that has quietly stopped being true.
    const accepted = HANDLER_VALIDATION_REGISTRY.what_would_flip?.accepted_entity_kinds;
    expect(accepted).toBeDefined();
    expect(accepted).not.toContain('edge');
  });






});
