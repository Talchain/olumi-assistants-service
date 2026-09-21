/**
 * DSK provenance attestation — the lens→protocol map is verified against the
 * BUNDLE BYTES, not against itself.
 *
 * `LENS_DSK_PROVENANCE` is a hand-written map (a lens id cannot be derived
 * from the bundle), so per trap 12 it must FAIL LOUD on drift: every id it
 * names is asserted to exist in `data/dsk/v1.json` with the right type, and
 * every trigger→protocol linkage is asserted against the trigger object's
 * own `linked_protocol_ids`. Mutating any id to an unattested value REDs
 * here — the emission-side analogue of the decision_quality_prompts
 * shape-check warning.
 *
 * ⚠ THE STAKES ROSE AT THE 0.37.0 PIN (ROADMAP 2.490 slice 2). This header
 * used to say the warning "does not cover exercises: the ExerciseBlock wire
 * shape at schemas 0.32.0 is `.strict()` with no dsk field, so provenance
 * rides telemetry, and THIS file is what keeps it honest". The second clause
 * still holds and the first no longer does: `ExerciseBlock.dsk_provenance`
 * exists now, and `phase3-blocks.ts` fills it from the ids this file attests.
 * An unattested id here is therefore a false claim shown to a USER, not a
 * mislabelled telemetry event. The wire-side companion spec is
 * `dsk-protocol-provenance-wire.test.ts`; this file remains the one that binds
 * the hand-written ids to the bundle bytes.
 *
 * Deliberately reads the bundle FILE directly rather than through
 * `dsk-loader.ts`: the loader is env-flag-gated (DSK_ENABLED) and the
 * trigger rules must hold with the flag OFF — no runtime bundle dependence.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LENS_DSK_PROVENANCE } from '../lens-selector.js';

interface BundleObject {
  readonly id: string;
  readonly type: string;
  readonly linked_protocol_ids?: readonly string[];
  readonly deprecated?: boolean;
}

const bundle = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'data/dsk/v1.json'), 'utf-8'),
) as { objects: BundleObject[] };

function byId(id: string): BundleObject | undefined {
  return bundle.objects.find((o) => o.id === id);
}

describe('LENS_DSK_PROVENANCE — attested against data/dsk/v1.json', () => {
  it('maps exactly the two slice-1 DSK lenses, by exact id', () => {
    // Identity-bound: the exact pairs, not "some entries exist".
    expect(LENS_DSK_PROVENANCE).toEqual({
      consider_opposite: { protocolId: 'DSK-P-003', triggerId: 'DSK-TR-003' },
      devils_advocacy: { protocolId: 'DSK-P-005', triggerId: 'DSK-TR-005' },
    });
  });

  it('every named protocol exists in the bundle as a non-deprecated protocol', () => {
    for (const { protocolId } of Object.values(LENS_DSK_PROVENANCE)) {
      const obj = byId(protocolId);
      expect(obj, `${protocolId} must exist in the bundle`).toBeDefined();
      expect(obj!.type).toBe('protocol');
      expect(obj!.deprecated ?? false).toBe(false);
    }
  });

  it('every named trigger exists, is non-deprecated, and links to its mapped protocol', () => {
    for (const { protocolId, triggerId } of Object.values(LENS_DSK_PROVENANCE)) {
      const obj = byId(triggerId);
      expect(obj, `${triggerId} must exist in the bundle`).toBeDefined();
      expect(obj!.type).toBe('trigger');
      expect(obj!.deprecated ?? false).toBe(false);
      expect(
        obj!.linked_protocol_ids,
        `${triggerId} must link ${protocolId}`,
      ).toContain(protocolId);
    }
  });

  it('positive control: the attestation CAN see a missing id', () => {
    // Trap 13 — an absence assertion must first prove it can see a presence.
    expect(byId('DSK-P-999')).toBeUndefined();
    expect(byId('DSK-P-003')).toBeDefined();
  });
});
