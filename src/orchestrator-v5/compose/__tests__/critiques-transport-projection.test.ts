/**
 * schemas 0.31.0 — `critiques` joins the CEE→UI transport keep-list.
 *
 * The producer has been real at BOTH ends for months: PLoT emits populated
 * rows and CEE already buckets them with Paul-approved display copy. The death
 * was this one key's absence from the keep-list — the strip loop dropped it
 * silently, so a fully-built pipeline ended one hop before the browser.
 *
 * ⚠ TRANSPORT IS LICENSED; SANITISATION IS NOT WAIVED — and this is why the
 * projection lives at the TRANSPORT seam rather than relying on the
 * response-finaliser's backstop. That backstop is bypassed WHOLESALE when
 * `CEE_TURN_DEBUG_ENABLED` is on (`response-finaliser.ts`: `debugEnabled ?
 * ceeTraceClean : sanitiseEnrichmentBlocks(...)`), so a keep-list entry with no
 * transport-site projection would put raw D-bucket critiques — internal wording
 * carrying raw node ids — on the wire on exactly those turns.
 *
 * The keep-list licenses the KEY, not the ROW. Per-critique duties pinned here:
 *   - D-bucket critiques NEVER reach the wire (fail-safe: unknown codes are D).
 *   - `user_message` ships; `message` (internal/debug wording) is WITHHELD.
 *   - `affected_option_ids` carries OPTION IDENTITY, so it is gated on the
 *     withheld-claim check — unlike the 0.30.0 VOI family this key is not
 *     trivially leading-option-inert.
 *   - S-bucket copy names an option by label; on a withheld turn it must fall
 *     back to the generic phrase rather than designate.
 */
import { describe, expect, it } from 'vitest';

import {
  P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP,
  toSafeTransportEnrichment,
} from '../../compose.js';
import { projectTransportEnrichmentForWithheldClaim } from '../withheld-claim-projection.js';

/** A row from each bucket, so every branch is exercised by one input. */
const enrichmentWithCritiques = () => ({
  critiques: [
    {
      // U bucket — model prose kept (sanitised), plus a display-safe twin.
      code: 'LOW_EFFECTIVE_SAMPLES',
      severity: 'warning',
      message: 'internal wording referencing node_abc123 raw id',
      user_message: 'This analysis is less reliable than usual.',
      affected_option_ids: ['opt_a'],
      affected_node_ids: ['n1'],
    },
    {
      // S bucket — copy is REPLACED from the approved catalogue.
      code: 'EMPTY_INTERVENTIONS',
      severity: 'warning',
      message: 'internal: option opt_b has no interventions',
      affected_option_ids: ['opt_b'],
    },
    {
      // D bucket — an unknown code defaults to D and must never transport.
      code: 'SOME_UNKNOWN_ENGINE_CODE',
      severity: 'error',
      message: 'raw engine diagnostic with isl_engine internals',
      affected_option_ids: ['opt_a'],
    },
  ],
  option_comparison: [
    { id: 'opt_a', label: 'Alpha' },
    { id: 'opt_b', label: 'Bravo' },
  ],
});

/** Read the transported critiques array, whatever the surrounding shape. */
function critiquesOf(out: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  const c = out?.critiques;
  return Array.isArray(c) ? (c as Array<Record<string, unknown>>) : [];
}

describe('critiques join the transport keep-list', () => {
  it('the key is on the keep-list', () => {
    expect([...P0B_SAFE_TRANSPORT_ENRICHMENT_KEEP]).toContain('critiques');
  });

  it('critiques reach the wire at all (the defect this closes)', () => {
    const out = toSafeTransportEnrichment(enrichmentWithCritiques(), false);
    expect(out).toBeDefined();
    expect(critiquesOf(out).length).toBeGreaterThan(0);
  });
});

describe('per-critique projection — sanitisation is NOT waived by transport', () => {
  const out = toSafeTransportEnrichment(enrichmentWithCritiques(), false);
  const rows = critiquesOf(out);

  it('D-bucket critiques are DROPPED before transport', () => {
    expect(rows.map((r) => r.code)).not.toContain('SOME_UNKNOWN_ENGINE_CODE');
    expect(JSON.stringify(rows)).not.toContain('isl_engine');
  });

  it('POSITIVE CONTROL — the input really did carry a D-bucket row', () => {
    // Without this, "no D-bucket on the wire" passes just as happily against
    // an input that never had one (CLAUDE.md trap 13).
    const input = enrichmentWithCritiques();
    expect(input.critiques.map((c) => c.code)).toContain('SOME_UNKNOWN_ENGINE_CODE');
  });

  it('`message` (internal wording) is WITHHELD from every transported row', () => {
    for (const row of rows) expect(row).not.toHaveProperty('message');
    expect(JSON.stringify(rows)).not.toContain('node_abc123');
  });

  it('`user_message` is what ships', () => {
    for (const row of rows) expect(typeof row.user_message).toBe('string');
    const u = rows.find((r) => r.code === 'LOW_EFFECTIVE_SAMPLES');
    expect(u?.user_message).toContain('less reliable');
  });

  it('S-bucket copy is the approved replacement, with the option LABEL resolved', () => {
    const s = rows.find((r) => r.code === 'EMPTY_INTERVENTIONS');
    expect(s?.user_message).toContain('Bravo');
    expect(s?.user_message).not.toContain('opt_b');
  });

  it('structural fields survive (code / severity / affected_node_ids)', () => {
    const u = rows.find((r) => r.code === 'LOW_EFFECTIVE_SAMPLES');
    expect(u?.severity).toBe('warning');
    expect(u?.affected_node_ids).toEqual(['n1']);
  });
});

describe('withheld turn — option identity is gated', () => {
  const safe = toSafeTransportEnrichment(enrichmentWithCritiques(), true);
  const withheld = projectTransportEnrichmentForWithheldClaim(safe);
  const rows = critiquesOf(withheld);

  it('critiques still travel (the honest degradation is projection, not deletion)', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('`affected_option_ids` is REMOVED on a withheld turn', () => {
    for (const row of rows) expect(row).not.toHaveProperty('affected_option_ids');
  });

  it('POSITIVE CONTROL — affected_option_ids IS present when the claim is not withheld', () => {
    const open = critiquesOf(toSafeTransportEnrichment(enrichmentWithCritiques(), false));
    expect(open.some((r) => Array.isArray(r.affected_option_ids))).toBe(true);
  });

  it('S-bucket copy no longer NAMES an option on a withheld turn', () => {
    const s = rows.find((r) => r.code === 'EMPTY_INTERVENTIONS');
    expect(s?.user_message).toBeDefined();
    expect(s?.user_message).not.toContain('Bravo');
    expect(s?.user_message).not.toContain('opt_b');
  });

  it('no option id or label appears anywhere in the withheld critiques payload', () => {
    const blob = JSON.stringify(rows);
    for (const needle of ['opt_a', 'opt_b', 'Alpha', 'Bravo']) {
      expect(blob).not.toContain(needle);
    }
  });
});
