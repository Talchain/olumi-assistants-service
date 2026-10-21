/**
 * Context-audit #1 (CONTEXT-SYSTEM-AUDIT-2026-07-22) — conformance for the
 * enrichment→LLM silent-drop seam (keep-list inventory row #2).
 *
 * ⚠ DELETION 10 (track2, 22 Oct 2026): the "derived" read-set used to be
 * OBSERVED AT RUNTIME by running every analysis→LLM enrichment reader against
 * a `Proxy`. Those readers (the prior-facts summary builder and its derivers)
 * were deleted — their only caller discarded the summary — so there is nothing
 * left to observe: every manifest key is now in the skip map with a reason, and
 * the probe, its defensive-read rows and the projection-cap parity row went
 * with them (copy in `evidence/track2-deletion10-20261022/deleted/`).
 */

import { describe,expect,it } from 'vitest';

import {
emitUnknownEnrichmentKeyTelemetry,
ENRICHMENT_ANALYSIS_LLM_SKIP,
ENRICHMENT_PRODUCER_MANIFEST,
findUnknownEnrichmentKeys,
MAX_LOGGED_ENRICHMENT_KEY_LENGTH,
PLOT_RUN_RESPONSE_V3_TOPLEVEL_KEYS,
PLOT_RUN_RESPONSE_V3_TOPLEVEL_KEYS_TIP,
sanitiseEnrichmentKeyName,
type EnrichmentTripwireLogger,
} from '../enrichment-manifest.js';
import {
buildAutoRunProvenance,
buildConstructionAutoRunProvenance,
RUN_PROVENANCE_ENRICHMENT_KEY,
} from '../run-initiator.js';


const sorted = (values: Iterable<string>): string[] => [...values].sort();

/** The nine keys the deleted summary builder and its derivers used to read. */
const FORMER_DERIVED_KEYS = [
  'confidence_tier',
  'critiques',
  'factor_evppi',
  'factor_sensitivity',
  'flip_thresholds',
  'inference_warnings',
  'm1_coaching',
  'option_comparison',
  'robustness',
] as const;

describe('enrichment producer manifest — conformance (context-audit #1 row #2)', () => {
  it('manifest is fully classified: skip == manifest, EXACTLY', () => {
    // Direction 1 (silent-drop guard): a new PLoT field that is not skipped with
    // a reason goes RED. Since deletion 10 there is no derived read set to union in.
    expect(sorted(ENRICHMENT_ANALYSIS_LLM_SKIP.keys())).toEqual(sorted(ENRICHMENT_PRODUCER_MANIFEST));
  });

  it('every skip entry is a manifest field with a non-empty reason', () => {
    for (const [key, reason] of ENRICHMENT_ANALYSIS_LLM_SKIP) {
      expect(ENRICHMENT_PRODUCER_MANIFEST.has(key), `${key} skipped but not in manifest`).toBe(true);
      expect(reason.trim().length, `${key} has an empty skip reason`).toBeGreaterThan(0);
    }
  });

  it('POSITIVE CONTROL — the classification checker SEES a dropped field', () => {
    // Simulate a skip row being silently removed: drop one key from the skip
    // map's key set and prove the equality assertion detects the now-
    // unclassified manifest field (doctrine trap #13).
    const broken = new Set<string>(ENRICHMENT_ANALYSIS_LLM_SKIP.keys());
    broken.delete('flip_thresholds');
    expect(sorted(broken)).not.toEqual(sorted(ENRICHMENT_PRODUCER_MANIFEST));
    const unclassified = [...ENRICHMENT_PRODUCER_MANIFEST].filter((k) => !broken.has(k));
    expect(unclassified).toEqual(['flip_thresholds']);
  });

  it('DELETION 10 — flip_thresholds is skipped with the deletion-10 reason, and is still manifested, emitted and stored', () => {
    const reason = ENRICHMENT_ANALYSIS_LLM_SKIP.get('flip_thresholds');
    expect(reason).toContain('deletion 10');
    expect(reason).toContain('its other CEE readers and its storage on the run_analysis fact are unchanged');
    // The same reason, by identity, on exactly the nine former derived keys.
    const withReason = [...ENRICHMENT_ANALYSIS_LLM_SKIP].filter(([, r]) => r === reason).map(([k]) => k);
    expect(sorted(withReason)).toEqual([...FORMER_DERIVED_KEYS]);
    // Reclassified for the analysis→LLM projection only: still a manifested
    // producer key, still in PLoT's pinned RunResponseV3 set, and a stored body
    // carrying it stays silent on the tripwire (kept, not dropped).
    expect(ENRICHMENT_PRODUCER_MANIFEST.has('flip_thresholds')).toBe(true);
    expect(PLOT_RUN_RESPONSE_V3_TOPLEVEL_KEYS.has('flip_thresholds')).toBe(true);
    expect(findUnknownEnrichmentKeys({ flip_thresholds: [{ factor_id: 'f', flip_value: 2 }] })).toEqual([]);
  });
});

// ============================================================================
// THE MANIFEST↔PLoT SEAM — the bolt that did not exist.
//
// WHY IT IS BEING ADDED NOW, stated plainly because the reason is the value.
// Every gate above checks manifest↔skip INTERNAL consistency: they prove the
// manifest is self-consistent, and they are all green while the manifest is
// missing a producer field entirely. That is not hypothetical — it is the
// measured history of this file, twice:
//
//   1. Four VOI keys landed at PLoT on 23-24 Jul and went unmanifested for five
//      days. The runtime tripwire fired on every analysis body, correctly, and
//      nobody read it. CI: green throughout.
//   2. The change that fixed those four MISSED A FIFTH from the same window
//      (`driver_order`, PLoT #287/#288) and wrote a false key COUNT dated to the
//      very tip that refutes it. Caught by adversarial review, not by CI, which
//      was green throughout that too.
//
// Both failures have one shape: the seam between this manifest and its producer
// in another repo was checked by a HUMAN REMEMBERING, and the only instrument
// pointed at it reported to a log nobody was reading. A grep for the keys you
// already know about will always confirm the keys you already know about.
//
// SCOPE, precisely (claim-type matters): this compares the manifest against a
// snapshot of PLoT's RunResponseV3 PINNED AT ONE DATED TIP. It catches a key the
// manifest LOSES and a key the manifest LISTS that PLoT no longer emits. It
// CANNOT catch a key PLoT adds after that tip — a pinned snapshot cannot see the
// future, and the runtime tripwire remains the backstop for that. What this
// changes is that an unmanifested producer key is no longer an UNBOUNDED unknown
// discoverable only via telemetry; it is bounded by a tip written down in the
// repo, refreshable with one command, and diffable in review.
// ============================================================================
describe('manifest ↔ PLoT RunResponseV3 (the seam that had no bolt)', () => {
  /** The manifest minus the keys CEE itself writes and the legacy V1 tolerance key. */
  const CEE_INJECTED = new Set([
    'decision_review',
    'coaching_signal_id',
    'coaching_signal_turn_id',
    'coaching_signal_produced_at',
    '_diagnostics',
    'run_provenance',
  ]);
  const LEGACY_V1_ONLY = new Set(['results']);
  const manifestPlotSection = [...ENRICHMENT_PRODUCER_MANIFEST].filter(
    (k) => !CEE_INJECTED.has(k) && !LEGACY_V1_ONLY.has(k),
  );

  it('manifests EVERY key PLoT emits at the pinned tip (the five-day-silence direction)', () => {
    const missing = [...PLOT_RUN_RESPONSE_V3_TOPLEVEL_KEYS].filter(
      (k) => !ENRICHMENT_PRODUCER_MANIFEST.has(k),
    );
    expect(
      missing,
      `Unmanifested PLoT producer key(s) at ${PLOT_RUN_RESPONSE_V3_TOPLEVEL_KEYS_TIP}. ` +
        'Each will fire v5.enrichment.unknown_producer_key on every analysis body ' +
        'carrying it. Add it to ENRICHMENT_PRODUCER_MANIFEST with its engine-v3.ts ' +
        'citation, then EITHER wire a deriver OR add an ENRICHMENT_ANALYSIS_LLM_SKIP ' +
        'row with a reason. Do NOT add it to the transport keep-list without a ' +
        'schemas contract and a withheld-claim ruling.',
    ).toEqual([]);
  });

  it('lists no PLoT key that the pinned tip does not emit (the stale-key direction)', () => {
    const phantom = manifestPlotSection.filter(
      (k) => !PLOT_RUN_RESPONSE_V3_TOPLEVEL_KEYS.has(k),
    );
    expect(
      phantom,
      'Manifest lists PLoT key(s) absent from RunResponseV3 at ' +
        `${PLOT_RUN_RESPONSE_V3_TOPLEVEL_KEYS_TIP}. Either PLoT removed them (drop the rows) ` +
        'or the pinned snapshot is stale (re-run the derivation command in the ' +
        'enrichment-manifest.ts header against PLoT — never edit the snapshot to ' +
        'match the manifest, that inverts the direction of truth).',
    ).toEqual([]);
  });

  it('POSITIVE CONTROL — the seam check SEES an unmanifested producer key', () => {
    // Trap 13. Without this, both assertions above pass just as happily against
    // a snapshot that had accidentally been emptied. Replays the exact defect
    // adversarial review found: driver_order present at PLoT, absent from CEE.
    const manifestWithoutDriverOrder = new Set(ENRICHMENT_PRODUCER_MANIFEST);
    manifestWithoutDriverOrder.delete('driver_order');
    const missing = [...PLOT_RUN_RESPONSE_V3_TOPLEVEL_KEYS].filter(
      (k) => !manifestWithoutDriverOrder.has(k),
    );
    expect(missing).toEqual(['driver_order']);
  });

  it('a body shaped like the REAL RunResponseV3 fires ZERO unknown-key telemetry', () => {
    // The reviewer's probe, promoted to a permanent test. This is the assertion
    // that would have been RED at the PR head: it feeds the REAL tripwire (not a
    // reimplementation) an enrichment carrying every key PLoT actually emits.
    const body: Record<string, unknown> = {};
    for (const key of PLOT_RUN_RESPONSE_V3_TOPLEVEL_KEYS) body[key] = null;

    const calls: Array<{ payload: Record<string, unknown>; message: string }> = [];
    const logger: EnrichmentTripwireLogger = {
      warn: (payload, message) => calls.push({ payload, message }),
    };
    emitUnknownEnrichmentKeyTelemetry(body, logger);

    expect(findUnknownEnrichmentKeys(body)).toEqual([]);
    expect(calls, 'a real PLoT body must be silent on the tripwire').toEqual([]);
  });

  it('POSITIVE CONTROL — the same probe DOES fire on a genuinely new producer key', () => {
    // Proves the silence above is a measurement, not a broken probe.
    const body: Record<string, unknown> = { plot_field_landed_after_the_pin: null };
    for (const key of PLOT_RUN_RESPONSE_V3_TOPLEVEL_KEYS) body[key] = null;

    const calls: Array<{ payload: Record<string, unknown>; message: string }> = [];
    const logger: EnrichmentTripwireLogger = {
      warn: (payload, message) => calls.push({ payload, message }),
    };
    emitUnknownEnrichmentKeyTelemetry(body, logger);

    expect(calls).toHaveLength(1);
    expect(calls[0].payload.unknown_keys).toEqual(['plot_field_landed_after_the_pin']);
  });
});

describe('runtime tripwire — findUnknownEnrichmentKeys / emit (context-audit #1 row #2)', () => {
  it('returns [] when every top-level key is in the manifest (no false alarm)', () => {
    const allKnown: Record<string, unknown> = {};
    for (const key of ENRICHMENT_PRODUCER_MANIFEST) allKnown[key] = 1;
    expect(findUnknownEnrichmentKeys(allKnown)).toEqual([]);
  });

  it('POSITIVE CONTROL — SEES an unknown key (proves it can detect a presence)', () => {
    const withUnknown = { option_comparison: [], brand_new_plot_field: 42 };
    expect(findUnknownEnrichmentKeys(withUnknown)).toEqual(['brand_new_plot_field']);
  });

  it('sanitises + caps a pathological key name; emits the NAME, never a value', () => {
    const nasty = `weird key/with spaces & ${'x'.repeat(100)}`;
    const out = findUnknownEnrichmentKeys({ [nasty]: 'SECRET_VALUE' });
    expect(out).toHaveLength(1);
    const name = out[0];
    // ≤ 64 chars + a single `~` truncation/replacement marker.
    expect(name.length).toBeLessThanOrEqual(MAX_LOGGED_ENRICHMENT_KEY_LENGTH + 1);
    expect(name.endsWith('~')).toBe(true);
    expect(name).not.toContain(' ');
    expect(name).not.toContain('/');
    // The value must never appear anywhere in the output.
    expect(name).not.toContain('SECRET_VALUE');
  });

  it('sanitiseEnrichmentKeyName leaves a clean short key unchanged', () => {
    expect(sanitiseEnrichmentKeyName('option_comparison')).toBe('option_comparison');
  });

  it('non-object / array input yields no unknown keys', () => {
    expect(findUnknownEnrichmentKeys(null)).toEqual([]);
    expect(findUnknownEnrichmentKeys(undefined)).toEqual([]);
    expect(findUnknownEnrichmentKeys([1, 2, 3])).toEqual([]);
    expect(findUnknownEnrichmentKeys('str')).toEqual([]);
  });

  it('emit fires ONE warn for an unknown key and stays silent for all-known', () => {
    const calls: Array<{ payload: Record<string, unknown>; message: string }> = [];
    const fake: EnrichmentTripwireLogger = {
      warn: (payload, message) => {
        calls.push({ payload, message });
      },
    };

    // All-known → silent (positive control's negative half).
    const allKnown: Record<string, unknown> = {};
    for (const key of ENRICHMENT_PRODUCER_MANIFEST) allKnown[key] = 1;
    emitUnknownEnrichmentKeyTelemetry(allKnown, fake);
    expect(calls).toHaveLength(0);

    // Unknown key → exactly one loud, structured event carrying the sanitised
    // name (never the value).
    emitUnknownEnrichmentKeyTelemetry(
      { option_comparison: [], sneaky_new_field: { secret: 1 } },
      fake,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.event).toBe('v5.enrichment.unknown_producer_key');
    expect(calls[0].payload.unknown_keys).toEqual(['sneaky_new_field']);
    expect(calls[0].payload.unknown_key_count).toBe(1);
  });

  it('emit never throws on malformed input (observe-only contract)', () => {
    const thrower: EnrichmentTripwireLogger = {
      warn: () => {
        throw new Error('logger blew up');
      },
    };
    expect(() =>
      emitUnknownEnrichmentKeyTelemetry({ unknown_x: 1 }, thrower),
    ).not.toThrow();
    expect(() => emitUnknownEnrichmentKeyTelemetry(null, thrower)).not.toThrow();
  });
});



// ============================================================================
// The auto-run provenance stamp is a CEE-injected key on the SAME persisted
// record (chip-click-dispatch.ts stampAutoRunProvenance). Until it was
// manifested, every auto-run fact fired the unknown-key tripwire — a standing
// false alarm on exactly the facts the provisional label exists for.
// ============================================================================
describe('the auto-run provenance stamp is manifested (CEE-injected)', () => {
  it('a stamped fact from EITHER initiator fires no unknown-key telemetry', () => {
    for (const stamp of [
      buildAutoRunProvenance('draft-turn-abc'),
      buildConstructionAutoRunProvenance('graph_registration:dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
    ]) {
      const enrichment = { analysis_status: 'computed', [RUN_PROVENANCE_ENRICHMENT_KEY]: stamp };
      expect(findUnknownEnrichmentKeys(enrichment)).toEqual([]);
    }
  });

  it('it is manifested as CEE-injected and skipped by the analysis→LLM projection, with a reason', () => {
    expect(ENRICHMENT_PRODUCER_MANIFEST.has(RUN_PROVENANCE_ENRICHMENT_KEY)).toBe(true);
    expect(ENRICHMENT_ANALYSIS_LLM_SKIP.get(RUN_PROVENANCE_ENRICHMENT_KEY)?.trim().length ?? 0).toBeGreaterThan(0);
    // Not a PLoT key: it must not appear in the pinned PLoT response set.
    expect(PLOT_RUN_RESPONSE_V3_TOPLEVEL_KEYS.has(RUN_PROVENANCE_ENRICHMENT_KEY)).toBe(false);
  });
});
