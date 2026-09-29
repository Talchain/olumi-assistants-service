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
import { describe, it, expect } from 'vitest';

import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';
import { buildOlumiActionTool } from '../tool-schema.js';

function schemaText(): string {
  return JSON.stringify(buildOlumiActionTool());
}

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

  it('⭐ the schema TELLS the model what_would_flip does not take an edge', () => {
    const text = schemaText();
    // Bound to the handler's own guidance paragraph, not to the whole schema —
    // the word "edge" appears legitimately elsewhere (adjust_edge_strength).
    const para = text.split('• what_would_flip')[1]?.split('•')[0] ?? '';
    expect(para.length).toBeGreaterThan(0); // the paragraph must exist at all
    expect(para).toMatch(/NEVER an edge/);
  });

  it('CONTRAST: adjust_edge_strength — which DOES accept an edge — still states so', () => {
    // The discriminating twin. If the assertion above were satisfied by
    // something global rather than by the handler's own paragraph, this would
    // not be able to read the opposite instruction out of a sibling paragraph.
    const accepted = HANDLER_VALIDATION_REGISTRY.adjust_edge_strength?.accepted_entity_kinds;
    expect(accepted).toContain('edge');
    const text = schemaText();
    const para = text.split('• adjust_edge_strength')[1]?.split('•')[0] ?? '';
    expect(para).toMatch(/entity\s*\\?n?\s*kind is "edge"|kind is \\"edge\\"|kind is "edge"/);
  });

  it('⚠ KNOWN GAP, NAMED: explain_results has the identical accepted set and no kind sentence', () => {
    // Not witnessed failing, so not changed — this repo prohibits
    // "while we're here" edits. Pinned so the gap is visible and so closing it
    // is a deliberate act with its own evidence, not a silent widening.
    const accepted = HANDLER_VALIDATION_REGISTRY.explain_results?.accepted_entity_kinds;
    expect(accepted).not.toContain('edge');
    const para = schemaText().split('• explain_results')[1]?.split('•')[0] ?? '';
    expect(para).not.toMatch(/NEVER an edge/);
  });
});
