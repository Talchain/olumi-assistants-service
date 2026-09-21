/**
 * VERDICT-CLASS TRANSPORT GATE — make the persisted-but-untransported verdict
 * debt LOUD and UN-GROWABLE. This file changes NO wire behaviour.
 *
 * ⚠ THE DEFECT CLASS. `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` (compose.ts) and the
 * fixed field set `buildAnalysisResultBlock` destructures out of `fact.result`
 * are both hand-listed and have NO notion of a verdict CLASS. Two independent
 * families proved that silently: `constraint_verdict` (persisted since
 * @talchain/schemas 0.25.0 — the adoption manifest records it "never reaches
 * the wire either way") and `goal_verdict` (ROADMAP 1.298 P0-1, "the persisted
 * `goal_verdict` NEVER REACHES THE UI"). Neither family knew about the other;
 * each had to REMEMBER to add its key, and each forgot. CLAUDE.md trap 12 at
 * the service boundary.
 *
 * WHAT THIS GATE DOES — three derivations and one register, no hand-lists:
 *
 *   (a) DERIVES the verdict-class field set from the PERSISTENCE SOURCE OF
 *       TRUTH: every Zod schema exported by `@talchain/schemas/orchestrator`
 *       (the handler-fact contract CEE writes to `v5_handler_facts`) is walked
 *       structurally. Two legs, unioned, because a name test alone is itself a
 *       convention nobody enforces:
 *         BY NAME      — any key matching {@link VERDICT_CLASS_KEY_PATTERN}.
 *         BY STRUCTURE — any property whose object carries a `*_verdict_state`
 *                        member IS a verdict carrier whatever it is called.
 *       Nothing is listed by hand: add a verdict family to the contract and
 *       this set grows on its own.
 *
 *   (b) DERIVES the transport coverage two ways and unions them: STATICALLY
 *       from `P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP` itself, and BEHAVIOURALLY by
 *       pushing a sentinel through the REAL composer (`composeToolCallResponse`)
 *       at both injection points a verdict could occupy (`fact.result.<field>`
 *       and `fact.result.enrichment.<field>`) and asking whether the sentinel
 *       reaches the composed envelope. The behavioural leg is what makes
 *       "transported" a measurement rather than a claim about a list.
 *
 *   (c) ASSERTS every derived verdict field is TRANSPORTED or carries an entry
 *       in `UNTRANSPORTED_VERDICT_CLASS_REGISTERED_REASONS` naming rowed work.
 *       A third family with neither REDs with a paste-ready message.
 *
 * FAIL-LOUD, NEVER SILENTLY OMIT (CLAUDE.md trap 12 + 13). Two ways the
 * derivation can be defeated, both fatal rather than quiet:
 *   - an UNPARSEABLE node — a schema node this walker cannot introspect (an
 *     unrecognised `_def.typeName`, a missing `.shape`, a throwing getter, a
 *     node from a different Zod major whose `_def` carries no `typeName` at
 *     all). A verdict field could be hiding behind it, so the gate REDs.
 *   - an OPAQUE node (`z.unknown()` / `z.any()`) OUTSIDE a record/map value
 *     position. Inside one it is a DECLARED open map (`enrichment`, PLoT's
 *     untyped passthrough — CLAUDE.md hazard 2) and is reported, not failed;
 *     anywhere else it is an undeclared blind spot and REDs.
 *
 * AND THE ASSERTIONS CARRY CONTROLS (CLAUDE.md trap 13 — "a positive control,
 * or the absence assertion is vacuous"). The sentinel probe is proven able to
 * SEE a presence (a keep-listed field) and to report an absence (a fabricated
 * key) before any verdict field's "not transported" verdict is believed.
 *
 * ⚠ THE ONE THING THIS DERIVATION CANNOT SEE, STATED RATHER THAN OMITTED. CEE
 * also persists verdict content under `enrichment.__cee_claim_safety`
 * (`CEE_CLAIM_SAFETY_ENRICHMENT_KEY`, constraint-feasibility.ts) — the interim
 * stamp whose payload is `{ may_name_leading_option, constraint_verdict_state }`.
 * It is stamped into `z.record(z.string(), z.unknown())`, so NO schema-derived
 * walk can reach it: it is inside one of the `opaque_zones` this gate reports,
 * and its own key carries no `verdict` token. It is disclosed here rather than
 * silently omitted, and it needs no registry row of its own: it is the SAME
 * debt as `constraint_verdict` (a migration ramp — exactly one of the two keys
 * is ever present on a fact, the newer wins) and constraint-feasibility.ts
 * records that it "never reached the wire either way".
 */

import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import * as OrchestratorContract from '@talchain/schemas/orchestrator';
import {
  composeToolCallResponse,
  P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP,
  UNTRANSPORTED_VERDICT_CLASS_REGISTERED_REASONS,
} from '../compose.js';

/**
 * What counts as verdict-CLASS. `constraint_verdict`, `goal_verdict`, a bare
 * `verdict` — but NOT `constraint_verdict_state`, which is a MEMBER of a
 * verdict object rather than a family of its own (it travels inside whatever
 * carries it, so gating it separately would double-count the same debt).
 */
const VERDICT_CLASS_KEY_PATTERN = /(?:^|_)verdict$/;

/**
 * The STRUCTURAL signature of a verdict carrier, used by leg 2. An object that
 * declares a `*_verdict_state` member IS a verdict object however its holder is
 * named — so a future family that calls its field `claim_safety` or
 * `attainment` is still caught. Naming conventions are exactly the kind of
 * hand-maintained agreement CLAUDE.md trap 12 says will drift.
 */
const VERDICT_CARRIER_MEMBER_PATTERN = /_verdict_state$/;

// ---------------------------------------------------------------------------
// (a) DERIVE the verdict-class fields from the persisted fact contract
// ---------------------------------------------------------------------------

/** Structural containers the walker knows how to descend into. */
const CONTAINER_TYPE_NAMES = new Set([
  'ZodObject',
  'ZodOptional',
  'ZodNullable',
  'ZodArray',
  'ZodRecord',
  'ZodMap',
  'ZodSet',
  'ZodUnion',
  'ZodDiscriminatedUnion',
  'ZodIntersection',
  'ZodTuple',
  'ZodEffects',
  'ZodLazy',
  'ZodDefault',
  'ZodCatch',
  'ZodBranded',
  'ZodPipeline',
  'ZodReadonly',
  'ZodPromise',
]);

/** Scalar terminals — nothing can hide inside one. */
const LEAF_TYPE_NAMES = new Set([
  'ZodString',
  'ZodNumber',
  'ZodBoolean',
  'ZodDate',
  'ZodEnum',
  'ZodNativeEnum',
  'ZodLiteral',
  'ZodNull',
  'ZodUndefined',
  'ZodVoid',
  'ZodNever',
  'ZodNaN',
  'ZodBigInt',
  'ZodSymbol',
]);

/** Terminals that CAN hide fields. Legitimate only as a declared open map. */
const OPAQUE_TYPE_NAMES = new Set(['ZodUnknown', 'ZodAny']);

interface ZodDefLike {
  readonly typeName?: unknown;
  readonly innerType?: unknown;
  readonly type?: unknown;
  readonly schema?: unknown;
  readonly getter?: unknown;
  readonly keyType?: unknown;
  readonly valueType?: unknown;
  readonly options?: unknown;
  readonly optionsMap?: unknown;
  readonly items?: unknown;
  readonly rest?: unknown;
  readonly left?: unknown;
  readonly right?: unknown;
  readonly in?: unknown;
  readonly out?: unknown;
}

interface ZodNodeLike {
  readonly _def?: ZodDefLike;
  readonly shape?: unknown;
}

function isZodNodeLike(value: unknown): value is ZodNodeLike {
  return typeof value === 'object' && value !== null && '_def' in value;
}

interface DerivedVerdictField {
  readonly field: string;
  /** Every declaration site found, e.g. `HandlerFactSchema|run_analysis.result.constraint_verdict`. */
  readonly paths: readonly string[];
  /** Fact types (discriminator values) whose result carries it, where derivable. */
  readonly factTypes: readonly string[];
  /** Which derivation leg(s) found it — `name`, `structure`, or both. */
  readonly derivedBy: readonly string[];
}

interface DerivationResult {
  readonly fields: readonly DerivedVerdictField[];
  /** `z.unknown()` / `z.any()` at a declared open-map value position — reported, not fatal. */
  readonly opaqueZones: readonly string[];
  /** Derivation defeated here. Fatal: a verdict field could be behind it. */
  readonly unparseable: readonly string[];
  /** Names of the exported Zod schemas actually walked. */
  readonly walkedExports: readonly string[];
}

function deriveVerdictClassFields(): DerivationResult {
  const byField = new Map<string, string[]>();
  const derivedBy = new Map<string, Set<string>>();
  const opaqueZones: string[] = [];
  const unparseable: string[] = [];

  const record = (field: string, path: string, leg: string): void => {
    const paths = byField.get(field) ?? [];
    paths.push(path);
    byField.set(field, paths);
    const legs = derivedBy.get(field) ?? new Set<string>();
    legs.add(leg);
    derivedBy.set(field, legs);
  };

  const walkFrom = (root: unknown, rootName: string): void => {
    // Cycle guard only — scoped PER ROOT so a schema instance shared between
    // two exports is still reported at both declaration paths.
    const seen = new Set<unknown>();

    /**
     * `holder` is the PROPERTY NAME this node was reached through (null at an
     * export root, and through positions where no single property owns the
     * node). Leg 2 needs it: the verdict-class field is the property that HOLDS
     * a `*_verdict_state`-bearing object, not the object's own type name.
     */
    const walk = (
      node: unknown,
      path: string,
      atOpenMapValue: boolean,
      holder: string | null = null,
    ): void => {
      if (!isZodNodeLike(node)) {
        unparseable.push(`${path} :: not a Zod node (${typeof node})`);
        return;
      }
      if (seen.has(node)) return;
      seen.add(node);

      const def = node._def;
      const typeName = def?.typeName;
      if (typeof typeName !== 'string') {
        // A node from a different Zod major (v4 `_def.type`), or a hand-rolled
        // schema-like object. We cannot see inside it — say so, never omit.
        unparseable.push(`${path} :: no _def.typeName (introspection-resistant declaration)`);
        return;
      }
      if (LEAF_TYPE_NAMES.has(typeName)) return;
      if (OPAQUE_TYPE_NAMES.has(typeName)) {
        if (atOpenMapValue) opaqueZones.push(`${path} :: ${typeName} (declared open map)`);
        else unparseable.push(`${path} :: ${typeName} outside a record/map value position`);
        return;
      }
      if (!CONTAINER_TYPE_NAMES.has(typeName)) {
        unparseable.push(`${path} :: unrecognised _def.typeName ${typeName}`);
        return;
      }

      switch (typeName) {
        case 'ZodObject': {
          let shape: unknown;
          try {
            shape = node.shape;
          } catch {
            unparseable.push(`${path} :: .shape getter threw`);
            return;
          }
          if (typeof shape !== 'object' || shape === null) {
            unparseable.push(`${path} :: ZodObject with no readable shape`);
            return;
          }
          const entries = Object.entries(shape as Record<string, unknown>);
          // LEG 2 — structural. This object declares a `*_verdict_state`
          // member, so the property that holds it is a verdict-class field
          // whatever it happens to be called.
          if (holder !== null && entries.some(([k]) => VERDICT_CARRIER_MEMBER_PATTERN.test(k))) {
            record(holder, path, 'structure');
          }
          for (const [key, child] of entries) {
            const childPath = `${path}.${key}`;
            // LEG 1 — by name.
            if (VERDICT_CLASS_KEY_PATTERN.test(key)) record(key, childPath, 'name');
            walk(child, childPath, false, key);
          }
          return;
        }
        case 'ZodOptional':
        case 'ZodNullable':
        case 'ZodDefault':
        case 'ZodCatch':
        case 'ZodBranded':
        case 'ZodReadonly':
        case 'ZodPromise':
          // Transparent wrappers: the open-map position AND the holding
          // property name both survive them.
          walk(def?.innerType ?? def?.type, path, atOpenMapValue, holder);
          return;
        case 'ZodArray':
          walk(def?.type, `${path}[]`, false);
          return;
        case 'ZodSet':
          walk(def?.valueType, `${path}<set>`, false);
          return;
        case 'ZodMap':
          walk(def?.keyType, `${path}<map key>`, false);
          walk(def?.valueType, `${path}<map value>`, true);
          return;
        case 'ZodRecord':
          walk(def?.valueType, `${path}<record value>`, true);
          return;
        case 'ZodEffects':
          walk(def?.schema, path, atOpenMapValue, holder);
          return;
        case 'ZodLazy': {
          const getter = def?.getter;
          if (typeof getter !== 'function') {
            unparseable.push(`${path} :: ZodLazy with no getter`);
            return;
          }
          let inner: unknown;
          try {
            inner = (getter as () => unknown)();
          } catch {
            unparseable.push(`${path} :: ZodLazy getter threw`);
            return;
          }
          walk(inner, path, atOpenMapValue, holder);
          return;
        }
        case 'ZodPipeline':
          walk(def?.in, `${path}<in>`, false);
          walk(def?.out, `${path}<out>`, false);
          return;
        case 'ZodIntersection':
          walk(def?.left, path, false, holder);
          walk(def?.right, path, false, holder);
          return;
        case 'ZodTuple': {
          const items = def?.items;
          if (!Array.isArray(items)) {
            unparseable.push(`${path} :: ZodTuple with no items`);
            return;
          }
          items.forEach((item, i) => walk(item, `${path}[${i}]`, false));
          if (def?.rest !== null && def?.rest !== undefined) walk(def.rest, `${path}[...]`, false);
          return;
        }
        case 'ZodDiscriminatedUnion': {
          const optionsMap = def?.optionsMap;
          if (optionsMap instanceof Map) {
            for (const [discriminant, option] of optionsMap.entries()) {
              walk(option, `${path}|${String(discriminant)}`, false, holder);
            }
            return;
          }
          unparseable.push(`${path} :: ZodDiscriminatedUnion with no optionsMap`);
          return;
        }
        case 'ZodUnion': {
          const options = def?.options;
          if (!Array.isArray(options)) {
            unparseable.push(`${path} :: ZodUnion with no options array`);
            return;
          }
          options.forEach((option, i) => walk(option, `${path}|${i}`, false, holder));
          return;
        }
        default:
          // Unreachable while CONTAINER_TYPE_NAMES and this switch agree; if
          // they ever disagree, say so rather than dropping the subtree.
          unparseable.push(`${path} :: container ${typeName} has no walk case`);
      }
    };

    walk(root, rootName, false);
  };

  const walkedExports: string[] = [];
  for (const [name, value] of Object.entries(
    OrchestratorContract as unknown as Record<string, unknown>,
  ).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isZodNodeLike(value)) continue;
    walkedExports.push(name);
    walkFrom(value, name);
  }

  const fields: DerivedVerdictField[] = [...byField.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, paths]) => ({
      field,
      derivedBy: [...(derivedBy.get(field) ?? [])].sort(),
      paths: [...new Set(paths)].sort(),
      factTypes: [
        ...new Set(
          paths
            .map((p) => /HandlerFactSchema\|([A-Za-z0-9_]+)\./.exec(p)?.[1])
            .filter((v): v is string => typeof v === 'string'),
        ),
      ].sort(),
    }));

  return { fields, opaqueZones, unparseable, walkedExports };
}

// ---------------------------------------------------------------------------
// (b) DERIVE the transport coverage — statically AND behaviourally
// ---------------------------------------------------------------------------

const SENTINEL = 'VERDICT_TRANSPORT_PROBE_SENTINEL_9f2c';

/**
 * The claim-safety stamp every production run_analysis fact carries. Present
 * so the probe reaches the LICENSED branch of `buildAnalysisResultBlock`: an
 * unstamped fact fails CLOSED and the withheld projection would drop blobs for
 * a reason that has nothing to do with the verdict class under test (compose
 * test-suite convention — see compose.test.ts's `CLAIM_SAFETY_STAMP`).
 */
const CLAIM_SAFETY_STAMP = {
  may_name_leading_option: true,
  constraint_verdict_state: 'evaluated_feasible',
} as const;

type ProbeSite = 'result' | 'enrichment';

/** Push `key` through the REAL composer at `site` and report whether it lands. */
function probeReachesWire(key: string, site: ProbeSite): boolean {
  const payload = { [SENTINEL]: SENTINEL, probe_key: key };
  const fact = {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-verdict-probe',
      leading_option_id: 'opt-1',
      summary: 'Ran analysis on your current scenario.',
      enrichment: {
        __cee_claim_safety: CLAIM_SAFETY_STAMP,
        ...(site === 'enrichment' ? { [key]: payload } : {}),
      },
      ...(site === 'result' ? { [key]: payload } : {}),
    },
    // The probe injects keys the strict fact schema does not declare — that is
    // the point (it asks "if this key existed, would it cross?"). The cast is
    // the probe's, never the product's.
  } as unknown as HandlerFact;

  const envelope = composeToolCallResponse({
    orientation: 'Running the analysis.',
    confirmation: 'Ran analysis on your current scenario.',
    coaching: null,
    stage: 'analyse',
    answerKind: 'functional',
    handlerFacts: [fact],
  });

  return JSON.stringify(envelope).includes(SENTINEL);
}

function isTransported(field: string): { transported: boolean; via: string } {
  const staticKeep = (P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP as readonly string[]).includes(field);
  const viaResult = probeReachesWire(field, 'result');
  const viaEnrichment = probeReachesWire(field, 'enrichment');
  const via: string[] = [];
  if (staticKeep) via.push('P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP');
  if (viaResult) via.push('fact.result projection');
  if (viaEnrichment) via.push('enrichment projection');
  return {
    transported: staticKeep || viaResult || viaEnrichment,
    via: via.length > 0 ? via.join(' + ') : 'NOWHERE',
  };
}

// ---------------------------------------------------------------------------
// (c) The gate
// ---------------------------------------------------------------------------

interface RegisteredReason {
  readonly field: string;
  readonly rowed: string;
  readonly reason: string;
}

const DERIVED = deriveVerdictClassFields();
// Keyed by `string`, NOT by the `as const` literal union: the whole point is to
// look up fields the register has never heard of.
const REGISTERED: ReadonlyMap<string, RegisteredReason> = new Map<string, RegisteredReason>(
  UNTRANSPORTED_VERDICT_CLASS_REGISTERED_REASONS.map((entry) => [entry.field, entry]),
);

function pasteReadyRemedy(field: string, paths: readonly string[]): string {
  return [
    ``,
    `  ${field}`,
    `    declared at : ${paths.join('\n                  ')}`,
    `    transported : NO — absent from P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP, and a`,
    `                  sentinel pushed through composeToolCallResponse at both`,
    `                  fact.result.${field} and enrichment.${field} did not reach`,
    `                  the composed envelope.`,
    ``,
    `  Do ONE of these, then re-run:`,
    ``,
    `  (A) TRANSPORT IT — project the field in buildAnalysisResultBlock and/or add`,
    `      the key to P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP, IN LOCK-STEP with`,
    `      @talchain/schemas (the strict analysis_result block hard-fails on an`,
    `      unknown nested field, so the UI re-vendors FIRST — see ROADMAP 1.298).`,
    ``,
    `  (B) REGISTER THE DEBT — add to`,
    `      UNTRANSPORTED_VERDICT_CLASS_REGISTERED_REASONS in`,
    `      src/orchestrator-v5/compose.ts:`,
    ``,
    `        {`,
    `          field: '${field}',`,
    `          rowed: 'ROADMAP <major>.<minor>',`,
    `          reason:`,
    `            'Why it cannot cross yet, and what closes it.',`,
    `        },`,
    ``,
    `      An entry with no rowed reference is rejected. Registering is the`,
    `      EXPENSIVE option on purpose: it is a disclosed debt, not a waiver.`,
  ].join('\n');
}

describe('verdict-class transport gate (derived — CLAUDE.md trap 12 at the wire)', () => {
  it('the derivation is not defeated anywhere (UNPARSEABLE fails loud, never omits)', () => {
    expect(DERIVED.walkedExports.length).toBeGreaterThan(0);
    if (DERIVED.unparseable.length > 0) {
      throw new Error(
        [
          `VERDICT-CLASS DERIVATION DEFEATED at ${DERIVED.unparseable.length} node(s).`,
          ``,
          `A verdict-class field could be declared behind any of these and this`,
          `gate would never see it — so the gate REDs rather than report a set it`,
          `cannot stand behind (CLAUDE.md trap 13: an absence assertion that cannot`,
          `see a presence is vacuous).`,
          ``,
          ...DERIVED.unparseable.map((u) => `  - ${u}`),
          ``,
          `Fix the declaration so it is structurally introspectable, or teach this`,
          `walker the node type — do NOT narrow the walk to make this pass.`,
        ].join('\n'),
      );
    }
  });

  it('the probe can SEE a presence and report an absence (controls — trap 13)', () => {
    // POSITIVE: a keep-listed enrichment field must land, or every "not
    // transported" verdict below is measuring nothing.
    expect(probeReachesWire('robustness', 'enrichment')).toBe(true);
    // NEGATIVE: a fabricated key must not land, or the probe says yes to
    // everything and the gate can never fire.
    expect(probeReachesWire('__probe_key_that_is_transported_by_nothing__', 'enrichment')).toBe(
      false,
    );
    expect(probeReachesWire('__probe_key_that_is_transported_by_nothing__', 'result')).toBe(false);
  });

  it('every derived verdict-class field is TRANSPORTED or REGISTERED with rowed work', () => {
    const undisclosed: string[] = [];
    for (const { field, paths } of DERIVED.fields) {
      if (isTransported(field).transported) continue;
      if (REGISTERED.has(field)) continue;
      undisclosed.push(pasteReadyRemedy(field, paths));
    }
    if (undisclosed.length > 0) {
      throw new Error(
        [
          `${undisclosed.length} persisted verdict-class field(s) reach NEITHER the`,
          `wire NOR the registered-reasons table.`,
          ``,
          `This is the exact shape of the two defects this gate exists for:`,
          `constraint_verdict and goal_verdict were each persisted, each read`,
          `server-side, and each silently absent from the UI payload — so the UI`,
          `cannot tell WITHHELD from NO-ANALYSIS-EXISTS from DROPPED-BY-PIN-SKEW.`,
          ...undisclosed,
        ].join('\n'),
      );
    }
    expect(undisclosed).toEqual([]);
  });

  it('a registered reason is deleted once its field is transported (shrink-only)', () => {
    const paidOff = UNTRANSPORTED_VERDICT_CLASS_REGISTERED_REASONS.filter((entry) => {
      const derived = DERIVED.fields.some((f) => f.field === entry.field);
      return derived && isTransported(entry.field).transported;
    });
    expect(
      paidOff.map(
        (e) =>
          `${e.field} is now transported (${isTransported(e.field).via}) — DELETE its entry from ` +
          `UNTRANSPORTED_VERDICT_CLASS_REGISTERED_REASONS; a debt register that keeps ` +
          `settled entries is the stale mirror this gate exists to prevent.`,
      ),
    ).toEqual([]);
  });

  it('every registered reason names rowed work and the table is unique + sorted', () => {
    for (const entry of UNTRANSPORTED_VERDICT_CLASS_REGISTERED_REASONS) {
      expect(
        /^ROADMAP \d+\.\d+$/.test(entry.rowed),
        `registered reason for '${entry.field}' must name a rowed reference like ` +
          `'ROADMAP 1.306'; got '${entry.rowed}'. A registered exemption with no rowed ` +
          `work is a waiver, and waivers are how the keep-list rotted.`,
      ).toBe(true);
      expect(
        entry.reason.trim().length,
        `registered reason for '${entry.field}' must say why it cannot cross yet`,
      ).toBeGreaterThan(40);
    }
    const fields = UNTRANSPORTED_VERDICT_CLASS_REGISTERED_REASONS.map((e) => e.field);
    expect(new Set(fields).size, 'duplicate fields in the registered-reasons table').toBe(
      fields.length,
    );
    expect(fields, 'keep the registered-reasons table alphabetical for reviewable diffs').toEqual(
      [...fields].sort(),
    );
  });

  it('records the derived manifest (the evidence, printed on every run)', () => {
    const manifest = DERIVED.fields.map((f) => {
      const t = isTransported(f.field);
      const registered = REGISTERED.get(f.field);
      return {
        field: f.field,
        derivedBy: f.derivedBy,
        factTypes: f.factTypes,
        paths: f.paths,
        status: t.transported ? 'TRANSPORTED' : registered ? 'REGISTERED' : 'UNDISCLOSED',
        via: t.via,
        rowed: registered?.rowed ?? null,
      };
    });
    const pending = UNTRANSPORTED_VERDICT_CLASS_REGISTERED_REASONS.filter(
      (e) => !DERIVED.fields.some((f) => f.field === e.field),
    ).map((e) => `${e.field} (${e.rowed})`);

    // The manifest IS the artefact this gate produces — printed on every run so
    // a CI log carries the evidence, not just a pass/fail bit.
    console.log(
      JSON.stringify(
        {
          verdict_class_transport_manifest: {
            walked_exports: DERIVED.walkedExports.length,
            derived_fields: manifest,
            transported: manifest.filter((m) => m.status === 'TRANSPORTED').length,
            registered: manifest.filter((m) => m.status === 'REGISTERED').length,
            undisclosed: manifest.filter((m) => m.status === 'UNDISCLOSED').length,
            // Registered but not (yet) declared at this schemas pin — a
            // forward-declaration, so the family cannot land dark.
            registered_pending_declaration: pending,
            opaque_zones: DERIVED.opaqueZones,
            unparseable: DERIVED.unparseable,
          },
        },
        null,
        2,
      ),
    );

    expect(manifest.every((m) => m.status !== 'UNDISCLOSED')).toBe(true);
  });
});
