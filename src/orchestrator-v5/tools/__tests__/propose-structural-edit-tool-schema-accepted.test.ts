/**
 * ROADMAP 2.655 — THE COMPOSER'S TOOL SCHEMA MUST BE ONE THE API ACCEPTS.
 *
 * ── WHAT WAS MEASURED, IN THE LIVE LOGS ───────────────────────────────────
 * cee-staging, 2026-08-05T14:34:38Z through 2026-08-06T03:19:15Z:
 *   · 18 × `v5.structural_edit_tool.entry decision=call_failed`
 *   · 18 × `v5.structural_edit_tool.call_failed`, every one of them:
 *
 *       UpstreamHTTPError :: Anthropic chat_with_tools failed: 400
 *       {"type":"invalid_request_error","message":"tools.0.custom: For
 *        'object' type, 'additionalProperties: true' is not supported.
 *        Please set 'additionalProperties' to false"}
 *
 *   · ZERO `engaged` or `engaged_split` entries in the whole window.
 *
 * So the 2.474/A3 batch splitter had never composed once on the deployed
 * build. It was not "declining sometimes"; it was dead at the transport, and
 * every turn that reached it fell back to the rulebook's refusal. The walk's
 * own turn sits in that window (03:18:29 and 03:19:15), which is why ROADMAP
 * 2.655 was filed as "THE BATCH SPLITTER NEVER ENGAGED".
 *
 * ── WHY A SCHEMA-SHAPE GUARD AND NOT A CALL ───────────────────────────────
 * The honest thing this test can prove is that the SHAPE the API named as
 * unsupported is not in the schema we send. It cannot prove the API accepts
 * the replacement — that is a live claim and belongs to deploy-verify, whose
 * witness is a `decision=engaged` entry appearing in these same logs. The test
 * is written so that distinction is visible rather than assumed (CLAUDE.md:
 * never write a verification result the measurement did not return).
 *
 * ── THE SWEEP IS DERIVED ──────────────────────────────────────────────────
 * It walks the WHOLE emitted schema rather than pinning the one property that
 * was wrong. Pinning `properties.operations.items.properties.value` would pass
 * the day someone adds a second open object elsewhere in the same schema.
 */
import { describe, it, expect } from 'vitest';
import {
  buildProposeStructuralEditTool,
  buildStructuralEditGrounding,
  type StructuralEditGrounding,
} from '../propose-structural-edit.js';

const GROUNDING: StructuralEditGrounding = buildStructuralEditGrounding({
  nodes: [
    { id: 'dec_mrr', kind: 'decision', label: 'MRR Growth Strategy' },
    { id: 'goal_mrr', kind: 'goal', label: 'Reach £250,000 MRR' },
  ],
  edges: [{ from: 'dec_mrr', to: 'goal_mrr' }],
})!;

/** Every `[path, value]` pair for `additionalProperties`, anywhere in the tree. */
function additionalPropertiesEntries(
  node: unknown,
  path = '$',
): { path: string; value: unknown }[] {
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => additionalPropertiesEntries(child, `${path}[${i}]`));
  }
  if (node === null || typeof node !== 'object') return [];
  const out: { path: string; value: unknown }[] = [];
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'additionalProperties') out.push({ path: `${path}.${key}`, value: child });
    else out.push(...additionalPropertiesEntries(child, `${path}.${key}`));
  }
  return out;
}

describe('⭐⭐ 2.655 — the propose_structural_edit tool schema carries no rejected shape', () => {
  const tool = buildProposeStructuralEditTool(GROUNDING);

  it('the sweep actually reaches into the schema (it is not vacuous)', () => {
    // Positive control: `additionalProperties: false` IS present and IS found,
    // so a walker that silently returned [] could not pass this file.
    const entries = additionalPropertiesEntries(tool.input_schema);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.value === false)).toBe(true);
  });

  it('⭐ no object anywhere declares `additionalProperties: true`', () => {
    const offenders = additionalPropertiesEntries(tool.input_schema).filter(
      (e) => e.value === true,
    );
    expect(
      offenders,
      `Anthropic rejects this shape outright: "For 'object' type, 'additionalProperties: true' ` +
        `is not supported". Offending paths: ${offenders.map((o) => o.path).join(', ')}`,
    ).toEqual([]);
  });

  it('⭐ the content object is closed AND carries fields — never closed to nothing', () => {
    // ⚠ THIS TEST PINNED THE DEFECT UNTIL 2026-08-07. It asserted, verbatim,
    // `expect('additionalProperties' in valueSchema).toBe(false)` and
    // `expect(valueSchema.properties ?? null).toBeNull()` — i.e. it required
    // the exact shape the API then rejected for a second day running
    // ("'additionalProperties' must be explicitly set to false", deterministic
    // 6/6). The reasoning behind it was sound and is preserved below; only the
    // conclusion was wrong, because OMITTING the key was never a third option.
    //
    // The concern it existed for is real and is now asserted directly: closing
    // an object that declares NO properties would be worse than the crash —
    // every call would succeed and the composer could only ever emit `{}`. So
    // the pin is now "closed AND non-empty", which is the property that
    // actually matters, and it holds whichever way a future edit moves.
    const value = (
      (
        (tool.input_schema as Record<string, never>).properties as Record<string, never>
      ).operations as Record<string, never>
    ).items as Record<string, unknown>;
    const valueSchema = (value.properties as Record<string, Record<string, unknown>>).value;
    expect(valueSchema.type).toBe('object');
    expect(valueSchema.additionalProperties).toBe(false);
    const declared = Object.keys(
      (valueSchema.properties ?? {}) as Record<string, unknown>,
    );
    expect(declared.length).toBeGreaterThan(0);
    // The fields the tool's own description promises the model it may write.
    // Bound by IDENTITY (exact key names), never by a count another edit could
    // satisfy (CLAUDE.md trap 19).
    expect(declared).toEqual(
      expect.arrayContaining([
        'kind',
        'label',
        'from',
        'to',
        'strength',
        'exists_probability',
        'effect_direction',
      ]),
    );
  });
});
