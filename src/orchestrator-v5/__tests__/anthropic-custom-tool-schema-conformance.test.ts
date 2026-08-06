/**
 * ROADMAP 2.655 — ONE GUARD FOR A WHOLE API-REQUIREMENT CLASS.
 *
 * ── THE REQUIREMENT, IN THE API'S OWN WORDS ────────────────────────────────
 * Anthropic rejects a custom tool whose schema carries an `object` without an
 * EXPLICIT `additionalProperties: false`. Both spellings of the rejection have
 * now been measured live against this service, three weeks apart in effect but
 * a single day apart on the clock:
 *
 *   tools.0.custom: For 'object' type, 'additionalProperties: true' is not
 *   supported. Please set 'additionalProperties' to false
 *
 *   tools.0.custom: For 'object' type, 'additionalProperties' must be
 *   explicitly set to false
 *
 * The first killed 18 consecutive `propose_structural_edit` calls; #835 removed
 * the offending `true` and shipped, and the SECOND then killed six more
 * (deterministic 6/6 across three fresh scenarios). The requirement is not
 * "do not say true" — it is "say false, on every object, including nested
 * ones". A guard written against the first spelling could not see the second.
 * This one is written against the requirement.
 *
 * ── WHY IT IS AN ESTATE-WIDE GUARD AND NOT A FILE-LOCAL ONE ────────────────
 * The failure class is not a property of one tool. `routing/tool-schema.ts`
 * serves the other custom tool this service sends, and its own test carried a
 * walker that recursed ONLY through `properties` and `items` — so a
 * non-conforming object inside an `anyOf` branch (that file has one, at
 * `parameters.items.properties.value`) was invisible to it. The walker below
 * is TOTAL: it visits every node of the JSON tree, whatever key reached it.
 *
 * ── WHY IT NEEDS NO LIVE CALL ─────────────────────────────────────────────
 * The honest thing a unit test can prove is that the shape the API named as
 * unsupported is absent from what we send. It cannot prove the API accepts the
 * replacement — that is a live claim belonging to deploy-verify, whose witness
 * is a `v5.structural_edit_tool.entry decision=engaged` in the cee-staging
 * logs. The distinction is kept visible rather than assumed (CLAUDE.md: never
 * write a verification result the measurement did not return).
 *
 * ── COMPLETENESS IS CHECKED SEPARATELY FROM CONFORMANCE (trap 12d) ────────
 * The registry below is a hand-written list, and a derived guard over a hand-
 * written list can prove agreement but never completeness. So the last block
 * SCANS THE SOURCE TREE for tool-schema definition sites and asserts the set
 * matches the registry's files. A third tool added tomorrow goes RED here
 * rather than shipping unguarded.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import {
  OLUMI_ACTION_TOOL,
  buildOlumiActionTool,
  buildForcedPillTool,
} from '../routing/tool-schema.js';
import {
  buildProposeStructuralEditTool,
  buildStructuralEditGrounding,
  type StructuralEditGrounding,
} from '../tools/propose-structural-edit.js';

const SRC_ROOT = join(fileURLToPath(new URL('../../', import.meta.url)));

const GROUNDING: StructuralEditGrounding = buildStructuralEditGrounding({
  nodes: [
    { id: 'dec_mrr', kind: 'decision', label: 'MRR Growth Strategy' },
    { id: 'goal_mrr', kind: 'goal', label: 'Reach £250,000 MRR' },
    { id: 'fac_churn', kind: 'factor', label: 'Monthly churn' },
  ],
  edges: [{ from: 'dec_mrr', to: 'goal_mrr' }],
})!;

/**
 * Every custom tool schema this service can send to Anthropic, taken from the
 * PRODUCERS rather than copied — a builder that starts emitting a new branch is
 * covered without anyone remembering to update this file. The two `buildForced*`
 * variants are listed because they are separately CONSTRUCTED objects: a spread
 * that dropped `additionalProperties` would show up only in the variant.
 */
const SERVED_TOOL_SCHEMAS: readonly {
  readonly label: string;
  readonly schema: unknown;
}[] = [
  { label: 'olumi_action (base advert)', schema: OLUMI_ACTION_TOOL.input_schema },
  { label: 'olumi_action (served)', schema: buildOlumiActionTool().input_schema },
  {
    label: 'olumi_action (forced pill: explain_results)',
    schema: buildForcedPillTool('explain_results').input_schema,
  },
  {
    label: 'olumi_action (forced pill: what_would_flip)',
    schema: buildForcedPillTool('what_would_flip').input_schema,
  },
  {
    label: 'propose_structural_edit',
    schema: buildProposeStructuralEditTool(GROUNDING).input_schema,
  },
];

/**
 * Every file that constructs a tool `input_schema`. Cross-checked against the
 * source tree in the last block.
 *
 * ⚠ `adapters/llm/anthropic.ts` is on this list but is NOT in the registry
 * above, and the difference is load-bearing. `buildStrictAnthropicTools` there
 * RE-WRAPS a caller's schema and injects `additionalProperties: false` — at the
 * TOP LEVEL ONLY, with no recursion. So the adapter cannot rescue a nested
 * object, which is precisely how `propose_structural_edit` reached production
 * 400ing on `operations.items.properties.value`. Each schema must therefore be
 * conformant AT ITS PRODUCER, which is what the registry above tests.
 */
const TOOL_SCHEMA_CONSTRUCTION_FILES: readonly string[] = [
  'adapters/llm/anthropic.ts',
  'orchestrator-v5/routing/tool-schema.ts',
  'orchestrator-v5/tools/propose-structural-edit.ts',
];

interface ObjectNode {
  readonly path: string;
  readonly additionalProperties: unknown;
  readonly declaresKey: boolean;
  /** How many properties this object declares. 0 = it can only ever be `{}`. */
  readonly propertyCount: number;
}

/**
 * Every `type: "object"` node anywhere in the tree.
 *
 * TOTAL recursion: it descends through EVERY key, not just `properties` and
 * `items`, so `anyOf` / `allOf` / `oneOf` branches and any future composition
 * keyword are covered without this walker being taught about them.
 */
function objectNodesIn(node: unknown, path = '$'): ObjectNode[] {
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => objectNodesIn(child, `${path}[${i}]`));
  }
  if (node === null || typeof node !== 'object') return [];
  const record = node as Record<string, unknown>;
  const out: ObjectNode[] = [];
  if (record.type === 'object') {
    const properties = record.properties;
    out.push({
      path,
      additionalProperties: record.additionalProperties,
      declaresKey: 'additionalProperties' in record,
      propertyCount:
        properties !== null && typeof properties === 'object' && !Array.isArray(properties)
          ? Object.keys(properties as Record<string, unknown>).length
          : 0,
    });
  }
  for (const [key, child] of Object.entries(record)) {
    out.push(...objectNodesIn(child, `${path}.${key}`));
  }
  return out;
}

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist') continue;
      out.push(...tsFilesUnder(full));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('⭐⭐ 2.655 — every custom tool schema Anthropic is sent is API-conformant', () => {
  it('the walker reaches into the schemas (positive control: it is not vacuous)', () => {
    // If the walker silently returned [], every assertion below would pass by
    // testing nothing. Each served schema must contribute at least one
    // `type:"object"` node, and the aggregate must be plural.
    const perTool = SERVED_TOOL_SCHEMAS.map((t) => ({
      label: t.label,
      count: objectNodesIn(t.schema).length,
    }));
    for (const { label, count } of perTool) {
      expect(count, `${label} contributed no object nodes to the sweep`).toBeGreaterThan(0);
    }
    expect(perTool.reduce((n, t) => n + t.count, 0)).toBeGreaterThan(
      SERVED_TOOL_SCHEMAS.length,
    );
  });

  it.each(SERVED_TOOL_SCHEMAS.map((t) => [t.label, t.schema] as const))(
    '⭐ %s — every object declares `additionalProperties: false`',
    (label, schema) => {
      const offenders = objectNodesIn(schema).filter((n) => n.additionalProperties !== false);
      expect(
        offenders.map((o) => `${o.path} (${o.declaresKey ? 'declared as ' : 'key OMITTED, '}${String(o.additionalProperties)})`),
        `Anthropic rejects this tool outright: "For 'object' type, ` +
          `'additionalProperties' must be explicitly set to false". ` +
          `OMITTING the key fails exactly as ${'`true`'} does — #835 removed the ` +
          `${'`true`'} and left the key off, and the composer 400'd for another day.`,
      ).toEqual([]);
      void label;
    },
  );

  it('⭐ no object is closed to nothing (a tool that can only ever emit `{}`)', () => {
    // The other way to satisfy the assertion above is `additionalProperties:
    // false` on an object that declares NO properties. That is worse than the
    // 400: the call succeeds and the model is told the only legal payload is
    // the empty object, so the composer would compose nothing while every
    // request looked healthy. Strictly harder to notice than a crash.
    const closedToNothing = SERVED_TOOL_SCHEMAS.flatMap((t) =>
      objectNodesIn(t.schema)
        .filter((n) => n.additionalProperties === false && n.propertyCount === 0)
        .map((n) => `${t.label} ${n.path}`),
    );
    expect(
      closedToNothing,
      'These objects forbid every field AND declare none, so the only payload ' +
        'they permit is `{}`. Closing an open bag is not a fix for the 400 — ' +
        'declare the fields it legitimately carries instead.',
    ).toEqual([]);
  });

  it('the closed-to-nothing screen can SEE a violation (positive control)', () => {
    // Without this, the assertion above would pass on a walker that never
    // populated `propertyCount` — a guard agreeing with itself (trap 13b).
    const rot = { type: 'object', additionalProperties: false } as const;
    const seen = objectNodesIn(rot);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.propertyCount).toBe(0);
    expect(seen[0]?.additionalProperties).toBe(false);
  });

  it('the registry covers EVERY tool-schema definition site in the tree (completeness)', () => {
    // Trap 12d: a guard derived from a list proves the copies agree, never that
    // the list is right. This block is the completeness half — it is derived
    // from the SOURCE TREE, not from the registry, so a third tool cannot be
    // added without a row here.
    const found = tsFilesUnder(SRC_ROOT)
      .filter((file) => /^\s*input_schema:\s*\{/m.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC_ROOT, file).split(sep).join('/'))
      .sort();
    expect(
      found,
      'A file constructs a tool input_schema and is not accounted for here. ' +
        'Add it to TOOL_SCHEMA_CONSTRUCTION_FILES, and — unless it merely ' +
        're-wraps another schema — add its built tool to SERVED_TOOL_SCHEMAS ' +
        'so the conformance sweep actually covers it.',
    ).toEqual([...TOOL_SCHEMA_CONSTRUCTION_FILES].sort());
  });
});
